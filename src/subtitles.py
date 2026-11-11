"""Auto subtitles: listens to the speech in a video and writes an .srt file.

Runs on the PC with Whisper (faster-whisper), so nothing is uploaded. The
speech tools (about 50 MB) and the speech model (about 0.5 or 1.6 GB) are
downloaded the first time and kept in DATA_DIR/Speech. The tools come
straight from PyPI as wheels (the same way the app updates yt-dlp), so the
installer stays small.

Also used by the "VaultHub Subtitles" button inside DaVinci Resolve (see
resolve.py): Resolve sends the clips on its timeline, and the subtitles come
back timed to that timeline.
"""

import ctypes
import glob
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
import threading
import types
import urllib.request
import zipfile

import media
import settings
import updater

SPEECH_DIR = os.path.join(settings.DATA_DIR, "Speech")
ENGINE_VERSION = "1"
ENGINE_DIR = os.path.join(SPEECH_DIR, "engine-" + ENGINE_VERSION)
MODEL_DIR = os.path.join(SPEECH_DIR, "models")
GPU_DIR = os.path.join(SPEECH_DIR, "gpu-1")  # NVIDIA's tools, for listening on the graphics card

# Known-good versions. If one has no wheel for this Python, the newest version is used instead.
PACKAGES = (("numpy", "2.5.4"), ("ctranslate2", "4.9.0"), ("onnxruntime", "1.31.1"), ("tokenizers", "0.23.3"),
            ("faster-whisper", "1.2.1"), ("msvc-runtime", "14.51.36231"))

# NVIDIA's own tools for the graphics card (CUDA 12, cuDNN 9: what the speech engine is built for,
# new enough for RTX 50 cards). Only their .dll files are kept. About 1.3 GB to download.
GPU_PACKAGES = (("nvidia-cuda-runtime-cu12", "12.9.79"), ("nvidia-cublas-cu12", "12.9.1.4"),
                ("nvidia-cudnn-cu12", "9.9.0.52"))

# "quick": good and fairly fast. "best": noticeably better, mostly for other languages than English.
MODELS = {
    "quick": "Systran/faster-whisper-small",
    "best": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}
SAMPLE_RATE = 16000

# Subtitle line styles: (most characters on a line, most lines, longest time on screen)
STYLES = {"normal": (42, 2, 6.0), "short": (26, 1, 2.5)}
LANGUAGES = ("", "en", "no", "sv", "da", "de", "es", "fr")


class Stopped(Exception):
    pass


# ---------------------------------------------------------------- getting the speech tools

_ready_lock = threading.Lock()
_model_cache = {}  # model name -> loaded WhisperModel
_gpu_failed = False  # the graphics card didn't work once: don't keep trying


def _wheel_tags():
    cp = f"cp{sys.version_info[0]}{sys.version_info[1]}"
    return (f"-{cp}-{cp}-win_amd64.whl", "-abi3-win_amd64.whl", "-py3-none-win_amd64.whl", "-none-any.whl")


def _pick_wheel(package, version):
    tags = _wheel_tags()
    for url in (f"https://pypi.org/pypi/{package}/{version}/json", f"https://pypi.org/pypi/{package}/json"):
        files = updater._get_json(url)["urls"]
        for tag in tags:
            found = next((f for f in files if f["packagetype"] == "bdist_wheel" and f["filename"].endswith(tag)), None)
            if found:
                return found
    raise OSError(f"The speech tools aren't available for this PC ({package}).")


def _download(url, size, on_bytes, timeout=60):
    """Download url, calling on_bytes(n) as it goes. Returns the bytes."""
    out = io.BytesIO()
    with updater._get(url, timeout=timeout) as response:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)
            on_bytes(len(chunk))
    return out.getvalue()


def engine_ready():
    return os.path.isfile(os.path.join(ENGINE_DIR, "ready"))


def model_ready(model):
    return os.path.isfile(os.path.join(MODEL_DIR, model, "ready"))


def _get_engine(progress):
    if engine_ready():
        return
    wheels = [_pick_wheel(name, version) for name, version in PACKAGES]
    total = sum(w["size"] for w in wheels) or 1
    done = 0
    temp = ENGINE_DIR + ".part"
    shutil.rmtree(temp, ignore_errors=True)
    os.makedirs(os.path.join(temp, "dlls"))
    for wheel in wheels:
        def on_bytes(n):
            nonlocal done
            done += n
            progress("Getting the speech tools ready (only the first time)", done * 100 / total)
        data = _download(wheel["url"], wheel["size"], on_bytes)
        if hashlib.sha256(data).hexdigest() != wheel["digests"]["sha256"]:
            raise OSError("A speech tools download was damaged. Try again.")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if wheel["filename"].startswith("msvc_runtime"):
                # The Microsoft C++ files the speech tools need, in case this PC doesn't have them.
                for name in z.namelist():
                    if name.lower().endswith(".dll"):
                        with z.open(name) as src, open(os.path.join(temp, "dlls", os.path.basename(name)), "wb") as dst:
                            shutil.copyfileobj(src, dst)
            else:
                z.extractall(temp)
    open(os.path.join(temp, "ready"), "w").close()
    shutil.rmtree(ENGINE_DIR, ignore_errors=True)
    os.replace(temp, ENGINE_DIR)
    # Older engine folders from earlier versions of the app.
    for old in glob.glob(os.path.join(SPEECH_DIR, "engine-*")):
        if old != ENGINE_DIR:
            shutil.rmtree(old, ignore_errors=True)


def _get_model(model, progress):
    if model_ready(model):
        return
    repo = MODELS[model]
    listing = updater._get_json(f"https://huggingface.co/api/models/{repo}/tree/main")
    wanted = [f for f in listing if f.get("type") == "file" and not f["path"].endswith((".md", ".gitattributes"))
              and "/" not in f["path"]]
    total = sum(f.get("size") or 0 for f in wanted) or 1
    done = 0
    folder = os.path.join(MODEL_DIR, model)
    temp = folder + ".part"
    shutil.rmtree(temp, ignore_errors=True)
    os.makedirs(temp)
    for f in wanted:
        url = f"https://huggingface.co/{repo}/resolve/main/{f['path']}"
        request = urllib.request.Request(url, headers={"User-Agent": updater.USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response, open(os.path.join(temp, f["path"]), "wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                progress("Downloading the speech model (only the first time)", done * 100 / total)
        if f.get("size") and os.path.getsize(os.path.join(temp, f["path"])) != f["size"]:
            raise OSError("The speech model download stopped halfway. Try again.")
    open(os.path.join(temp, "ready"), "w").close()
    shutil.rmtree(folder, ignore_errors=True)
    os.replace(temp, folder)


def has_nvidia():
    """An NVIDIA graphics card with its driver (the driver brings nvcuda.dll)."""
    if os.name != "nt":
        return False
    try:
        ctypes.WinDLL("nvcuda.dll")
        return True
    except OSError:
        return False


def gpu_ready():
    return os.path.isfile(os.path.join(GPU_DIR, "ready"))


def _get_gpu(progress):
    if gpu_ready():
        return
    wheels = [_pick_wheel(name, version) for name, version in GPU_PACKAGES]
    total = sum(w["size"] for w in wheels) or 1
    done = 0
    temp = GPU_DIR + ".part"
    shutil.rmtree(temp, ignore_errors=True)
    os.makedirs(temp)
    download = os.path.join(temp, "download.whl")
    for wheel in wheels:
        # These are big (up to 770 MB), so they go to a file instead of memory.
        digest = hashlib.sha256()
        with updater._get(wheel["url"], timeout=120) as response, open(download, "wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                progress("Getting the graphics card tools (only the first time, about 1.3 GB)", done * 100 / total)
        if digest.hexdigest() != wheel["digests"]["sha256"]:
            raise OSError("A graphics card tools download was damaged. Try again.")
        with zipfile.ZipFile(download) as z:
            for name in z.namelist():
                if name.lower().endswith(".dll"):
                    with z.open(name) as src, open(os.path.join(temp, os.path.basename(name)), "wb") as dst:
                        shutil.copyfileobj(src, dst)
        os.remove(download)
    open(os.path.join(temp, "ready"), "w").close()
    shutil.rmtree(GPU_DIR, ignore_errors=True)
    os.replace(temp, GPU_DIR)


def _use_gpu_files():
    # Newer cards (like RTX 50) get the engine's graphics code translated for them the first time;
    # a bigger cache keeps that from happening again every time.
    os.environ.setdefault("CUDA_CACHE_MAXSIZE", str(2 ** 31))
    os.add_dll_directory(GPU_DIR)
    os.environ["PATH"] = GPU_DIR + os.pathsep + os.environ.get("PATH", "")
    for name in sorted(os.listdir(GPU_DIR)):
        if name.lower().startswith(("cudart64", "cublaslt64", "cublas64")):
            try:
                ctypes.WinDLL(os.path.join(GPU_DIR, name))
            except OSError:
                pass


def _stub_modules():
    """faster-whisper imports a few big packages it only needs for things the app doesn't use
    (reading files itself, downloading models, progress bars). Small stand-ins keep the download small."""
    for name in ("av", "huggingface_hub"):
        if name not in sys.modules:
            try:
                __import__(name)
            except ImportError:
                sys.modules[name] = types.ModuleType(name)
    try:
        import tqdm  # noqa: F401
    except ImportError:
        class tqdm:
            def __init__(self, *args, **kwargs):
                pass

            def update(self, *args):
                pass

            def close(self):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

        module, auto = types.ModuleType("tqdm"), types.ModuleType("tqdm.auto")
        module.tqdm = auto.tqdm = tqdm
        module.auto = auto
        sys.modules["tqdm"], sys.modules["tqdm.auto"] = module, auto


def _load_engine():
    if ENGINE_DIR not in sys.path:
        sys.path.insert(0, ENGINE_DIR)
    dlls = os.path.join(ENGINE_DIR, "dlls")
    if os.name == "nt" and os.path.isdir(dlls):
        os.add_dll_directory(dlls)
        for name in ("msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "vcomp140.dll", "concrt140.dll"):
            path = os.path.join(dlls, name)
            if os.path.isfile(path):
                try:
                    ctypes.WinDLL(path)
                except OSError:
                    pass
    _stub_modules()
    from faster_whisper import WhisperModel

    return WhisperModel


def get_ready(model, progress, gpu=True):
    """Download what's missing and load the model. progress(text, percent). gpu: use an NVIDIA
    graphics card when there is one (much faster); otherwise, or if it doesn't work, the processor."""
    if model not in MODELS:
        model = "quick"
    global _gpu_failed
    gpu = gpu and not _gpu_failed and has_nvidia()
    with _ready_lock:
        cached = _model_cache.get(model)
        if cached and (cached.on_gpu or not gpu):
            return cached
        os.makedirs(SPEECH_DIR, exist_ok=True)
        try:
            _get_engine(progress)
            _get_model(model, progress)
        except (OSError, ValueError, KeyError) as e:
            if isinstance(e, Stopped) or getattr(e, "friendly", False):
                raise
            raise OSError("Couldn't download the speech tools. Check your internet and try again.") from e
        if gpu:
            try:
                _get_gpu(progress)
            except Stopped:
                raise
            except Exception:
                gpu = False  # no graphics card tools this time: the processor still works
        progress("Starting the speech model", 0)
        try:
            WhisperModel = _load_engine()
        except Exception as e:
            shutil.rmtree(ENGINE_DIR, ignore_errors=True)  # a broken download: start over next time
            raise OSError(f"The speech tools didn't start ({type(e).__name__}). Try again; they'll be downloaded fresh.") from e
        loaded = None
        if gpu:
            try:
                _use_gpu_files()
                loaded = WhisperModel(os.path.join(MODEL_DIR, model), device="cuda", compute_type="float16")
                loaded.on_gpu = True
            except Exception:
                loaded = None  # an older card or driver: the processor still works
                _gpu_failed = True
        if loaded is None:
            try:
                # Most of the processor; Windows still puts Resolve and the rest first (see _gentle).
                threads = max(1, min(16, (os.cpu_count() or 4) - 1))
                loaded = WhisperModel(os.path.join(MODEL_DIR, model), device="cpu", compute_type="int8", cpu_threads=threads)
                loaded.on_gpu = False
            except Exception as e:
                shutil.rmtree(os.path.join(MODEL_DIR, model), ignore_errors=True)
                raise OSError(f"The speech tools didn't start ({type(e).__name__}). Try again; they'll be downloaded fresh.") from e
        _model_cache.clear()  # only one model in memory at a time
        _model_cache[model] = loaded
        return loaded


# ---------------------------------------------------------------- listening

def read_audio(path, start=0.0, length=None, stream=0, on_progress=None):
    """The sound of a file as 16 kHz mono floats (what Whisper listens to)."""
    import numpy as np

    command = [media.ffmpeg(), "-hide_banner", "-nostdin", *(["-ss", f"{start:.3f}"] if start else []), "-i", path,
               *(["-t", f"{length:.3f}"] if length else []), "-map", f"0:a:{stream}?", "-vn", "-ac", "1",
               "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=media.NO_WINDOW)
    chunks = []
    try:
        while True:
            chunk = process.stdout.read(SAMPLE_RATE * 4 * 10)
            if not chunk:
                break
            chunks.append(chunk)
            if on_progress:
                on_progress(sum(map(len, chunks)) / 4 / SAMPLE_RATE)
    except BaseException:
        process.kill()
        raise
    finally:
        process.wait()
    data = b"".join(chunks)
    return np.frombuffer(data[: len(data) // 4 * 4], dtype=np.float32)


def listen(model, audio, language, on_progress):
    """Words with times: [(start, end, word)]. Listens to several pieces at once (much faster)."""
    from faster_whisper import BatchedInferencePipeline

    seconds = len(audio) / SAMPLE_RATE
    batched = BatchedInferencePipeline(model=model)
    segments, _info = batched.transcribe(
        audio, language=language or None, word_timestamps=True, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500}, batch_size=16 if getattr(model, "on_gpu", False) else 8)
    words = []
    on_progress(0)
    with _gentle():
        for segment in segments:  # (it listens while this loop runs)
            for w in segment.words or []:
                if w.word.strip():
                    words.append((w.start, w.end, w.word))
            if seconds:
                on_progress(min(99.0, segment.end * 100 / seconds))
    words.sort()
    return words


class _gentle:
    """While listening, Windows gives the app less of the processor than other programs (like Resolve)."""
    BELOW_NORMAL, NORMAL = 0x4000, 0x20

    def __enter__(self):
        self._set(self.BELOW_NORMAL)

    def __exit__(self, *args):
        self._set(self.NORMAL)

    def _set(self, level):
        if os.name == "nt":
            try:
                ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), level)
            except (AttributeError, OSError):
                pass


# ---------------------------------------------------------------- writing the .srt

def _clock(t):
    t = max(0.0, t)
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def make_cues(words, style="normal"):
    """Groups words into subtitles: [(start, end, text)]."""
    width, lines, longest = STYLES.get(style, STYLES["normal"])
    cues, current = [], []

    def flush(keep_tail=False):
        """keep_tail: it got too long, so end it after its last comma or full stop if it has one,
        and start the next subtitle with the words after it ("Hey, | welcome to VaultHub.")."""
        tail = []
        if keep_tail:
            cut = max((i for i, w in enumerate(current[:-1]) if re.search(r"[.!?,;:]$", w[2].strip())), default=-1)
            if cut >= 0:
                tail = current[cut + 1:]
                del current[cut + 1:]
        if current:
            cues.append([current[0][0], current[-1][1], _wrap("".join(w[2] for w in current).strip(), width, lines)])
            current.clear()
        current.extend(tail)

    for word in words:
        if current:
            text = "".join(w[2] for w in current + [word]).strip()
            gap = word[0] - current[-1][1]
            if gap > 1.0 or (re.search(r"[.!?]$", current[-1][2].strip()) and len(text) > width * 0.5):
                flush()
            elif len(text) > width * lines or word[1] - current[0][0] > longest:
                flush(keep_tail=True)
        current.append(word)
        if style == "short" and re.search(r"[.!?,]$", word[2].strip()) and (len(current) > 1 or word[1] - word[0] > 0.6):
            flush()
    flush()
    # Keep each subtitle up long enough to read, without running into the next one.
    for i, cue in enumerate(cues):
        nxt = cues[i + 1][0] if i + 1 < len(cues) else cue[1] + 2
        cue[1] = min(max(cue[1], cue[0] + (0.6 if style == "short" else 1.0)), nxt - 0.02)
        if cue[1] <= cue[0]:
            cue[1] = cue[0] + 0.3
    return [tuple(c) for c in cues]


def _wrap(text, width, lines):
    if lines == 1 or len(text) <= width:
        return text
    # Two lines about as long as each other.
    words = text.split()
    best, best_score = text, None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        score = max(len(a), len(b))
        if best_score is None or score < best_score:
            best, best_score = a + "\n" + b, score
    return best


def write_srt(cues, target):
    with open(target, "w", encoding="utf-8", newline="\r\n") as f:
        for i, (start, end, text) in enumerate(cues, 1):
            f.write(f"{i}\n{_clock(start)} --> {_clock(end)}\n{text}\n\n")


# ---------------------------------------------------------------- the whole thing

def make_subtitles(parts, target, model="quick", language="", style="normal", on_progress=None, sound_copy=None, gpu=True):
    """parts: [(path, from_seconds, length_or_None, at_seconds)]: the bits of sound to listen to and
    where they go in the result (a single file is one part at 0; a Resolve timeline is many).
    on_progress(text, percent). Returns the number of subtitles written."""
    report = on_progress or (lambda text, percent: None)
    whisper = get_ready(model, report, gpu)
    import numpy as np

    pieces, total = [], 0.0
    for i, (path, start, length, at) in enumerate(parts):
        report("Reading the sound", i * 100 / max(1, len(parts)))
        audio = read_audio(path, start, length)
        if length:
            audio = audio[: int(length * SAMPLE_RATE)]
        pieces.append((at, audio))
        total = max(total, at + len(audio) / SAMPLE_RATE)
    if not total:
        raise ValueError("There's no sound to listen to.")
    mix = np.zeros(int(total * SAMPLE_RATE) + 1, dtype=np.float32)
    for at, audio in pieces:
        begin = max(0, int(at * SAMPLE_RATE))
        end = min(len(mix), begin + len(audio))
        mix[begin:end] += audio[: end - begin]  # clips on several tracks play at the same time
    np.clip(mix, -1.0, 1.0, out=mix)
    if sound_copy:
        _save_wav(mix, sound_copy)  # for the subtitle editor, when there's no single file to play
    where = " on the graphics card" if getattr(whisper, "on_gpu", False) else ""
    words = listen(whisper, mix, language, lambda percent: report("Listening" + where, percent))
    if not words:
        raise ValueError("Couldn't hear any speech in this.")
    cues = make_cues(words, style)
    write_srt(cues, target)
    return cues


def _save_wav(audio, target):
    import wave

    import numpy as np

    with wave.open(target, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def read_srt(path):
    """[(start, end, text)] from an .srt file."""
    with open(path, encoding="utf-8-sig") as f:
        blocks = re.split(r"\n\s*\n", f.read().replace("\r\n", "\n").strip())
    cues = []
    for block in blocks:
        lines = block.split("\n")
        for i, line in enumerate(lines):
            found = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", line.strip())
            if found:
                g = [int(x) for x in found.groups()]
                start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
                end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
                cues.append((start, end, "\n".join(lines[i + 1:]).strip()))
                break
    return cues
