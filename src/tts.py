"""(3.4.0) The Voices page: type something and a natural sounding voice reads it out.

The voices are Kokoro (Apache 2.0), a small speech model that runs on this PC, with no
account and nothing sent anywhere. The model (about 120 MB) is downloaded the first time
you use the page and kept in the app's data folder. The character voices are our own:
a Kokoro voice with its pitch, speed and sound changed by ffmpeg.
"""

import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
import uuid

import media
import settings
import waveform

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = {"kokoro-v1.0.int8.onnx": 92361271, "voices-v1.0.bin": 28214398}  # name -> size in bytes
MODEL_DIR = os.path.join(settings.DATA_DIR, "voices")
MAX_CHARS = 5000
CLIPS_KEPT = 12

# The people: plain Kokoro voices. (id, name, what it sounds like, Kokoro voice, language)
PEOPLE = [
    ("heart", "Heart", "Warm and friendly", "af_heart", "en-us"),
    ("michael", "Michael", "Calm and clear", "am_michael", "en-us"),
    ("bella", "Bella", "Bright and lively", "af_bella", "en-us"),
    ("adam", "Adam", "Laid back", "am_adam", "en-us"),
    ("emma", "Emma", "British, soft", "bf_emma", "en-gb"),
    ("george", "George", "British, deep", "bm_george", "en-gb"),
    ("nicole", "Nicole", "Whispery, close", "af_nicole", "en-us"),
    ("puck", "Puck", "Playful", "am_puck", "en-us"),
]

# The characters: our own, made from a Kokoro voice plus sound effects.
# (id, name, what it sounds like, Kokoro voice, language, speed, ffmpeg filters)
CHARACTERS = [
    ("bigguy", "Big Guy", "Huge, slow and deep", "am_onyx", "en-us", 0.9,
     "asetrate=24000*0.8,aresample=24000,atempo=1.1,bass=g=6:f=110,acompressor=threshold=0.2:ratio=3"),
    ("santa", "Santa", "Jolly old man", "am_santa", "en-us", 0.95, ""),
    ("announcer", "Announcer", "Big arena voice", "am_michael", "en-us", 1.05,
     "asetrate=24000*0.92,aresample=24000,atempo=1.087,acompressor=threshold=0.1:ratio=4:makeup=2,"
     "aecho=0.8:0.5:70|140:0.25|0.12"),
    ("robot", "Robot", "Beep boop", "am_echo", "en-us", 0.95,
     "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75,"
     "asetrate=24000*0.95,aresample=24000"),
    ("chipmunk", "Chipmunk", "Tiny and squeaky", "am_puck", "en-us", 1.0,
     "asetrate=24000*1.55,aresample=24000,atempo=0.75"),
    ("monster", "Monster", "Something under your bed", "am_fenrir", "en-us", 0.85,
     "asetrate=24000*0.62,aresample=24000,atempo=1.3,bass=g=5,aecho=0.8:0.4:40:0.3"),
    ("radio", "Radio", "Old walkie talkie", "bm_george", "en-gb", 1.05,
     "highpass=f=400,lowpass=f=3000,acrusher=bits=10:mix=0.4,volume=1.6"),
    ("ghost", "Ghost", "Spooky whisper", "af_nicole", "en-us", 0.9,
     "asetrate=24000*0.9,aresample=24000,atempo=1.11,aecho=0.8:0.7:300|600:0.4|0.25"),
]
VOICES = {v[0]: v for v in PEOPLE} | {c[0]: c for c in CHARACTERS}


class Error(Exception):
    pass


def voices():
    return {
        "people": [{"id": i, "name": n, "about": a} for i, n, a, *_ in PEOPLE],
        "characters": [{"id": i, "name": n, "about": a} for i, n, a, *_ in CHARACTERS],
    }


def _model_ready():
    return all(os.path.isfile(os.path.join(MODEL_DIR, n)) and os.path.getsize(os.path.join(MODEL_DIR, n)) == size
               for n, size in MODEL_FILES.items())


def _clean(text):
    text = str(text or "").replace("\r", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:MAX_CHARS]


def _pieces(text, size=380):
    """The text in bits Kokoro reads well: whole sentences, a few at a time."""
    out = []
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        bit = ""
        for sentence in re.split(r"(?<=[.!?…])\s+", para):
            while len(sentence) > size:  # one huge sentence: break it at a comma or a space
                cut = max(sentence.rfind(",", 0, size), sentence.rfind(" ", 0, size))
                cut = cut if cut > 40 else size
                if bit:
                    out.append(bit)
                    bit = ""
                out.append(sentence[:cut + 1].strip())
                sentence = sentence[cut + 1:].strip()
            if bit and len(bit) + len(sentence) + 1 > size:
                out.append(bit)
                bit = ""
            bit = (bit + " " + sentence).strip()
        if bit:
            out.append(bit)
    return out


class Speaker:
    def __init__(self):
        self._lock = threading.Lock()
        self._model_lock = threading.Lock()
        self._kokoro = None
        self.download = {"busy": False, "got": 0, "total": sum(MODEL_FILES.values()), "error": ""}
        self.jobs = {}  # id -> job
        self.clips = []  # newest first: {id, text, voice, name, seconds, file, made}

    # ---- the model
    def state(self):
        with self._lock:
            return {"ok": True, "ready": _model_ready(), "download": dict(self.download), "voices": voices(),
                    "clips": [self._public(c) for c in self.clips], "maxChars": MAX_CHARS}

    def get_model(self):
        with self._lock:
            if self.download["busy"] or _model_ready():
                return {"ok": True}
            self.download.update(busy=True, got=0, error="")
        threading.Thread(target=self._download, daemon=True).start()
        return {"ok": True}

    def _download(self):
        os.makedirs(MODEL_DIR, exist_ok=True)
        done = 0
        try:
            for name, size in MODEL_FILES.items():
                path = os.path.join(MODEL_DIR, name)
                if os.path.isfile(path) and os.path.getsize(path) == size:
                    done += size
                    continue
                part = path + ".part"
                req = urllib.request.Request(MODEL_URL + name, headers={"User-Agent": "VaultHub"})
                with urllib.request.urlopen(req, timeout=60) as res, open(part, "wb") as out:
                    while True:
                        chunk = res.read(256 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                        with self._lock:
                            self.download["got"] = done + out.tell()
                if os.path.getsize(part) != size:
                    os.remove(part)
                    raise Error("The download stopped halfway.")
                os.replace(part, path)
                done += size
        except (OSError, Error) as e:
            with self._lock:
                self.download["error"] = str(e) if isinstance(e, Error) else "Couldn't download the voices. Check your internet and try again."
        with self._lock:
            self.download["busy"] = False

    def _model(self):
        with self._model_lock:
            if self._kokoro is None:
                if not _model_ready():
                    raise Error("The voices aren't downloaded yet.")
                from kokoro_onnx import Kokoro
                self._kokoro = Kokoro(os.path.join(MODEL_DIR, "kokoro-v1.0.int8.onnx"),
                                      os.path.join(MODEL_DIR, "voices-v1.0.bin"))
            return self._kokoro

    # ---- making a clip
    def make(self, text, voice, speed):
        text = _clean(text)
        if not text:
            raise Error("Type something to read out.")
        if voice not in VOICES:
            raise Error("Pick a voice.")
        try:
            speed = min(1.6, max(0.6, float(speed or 1)))
        except (TypeError, ValueError):
            speed = 1.0
        job = {"id": uuid.uuid4().hex[:10], "done": 0, "total": 1, "status": "busy", "error": "", "clip": None}
        with self._lock:
            self.jobs = {k: j for k, j in self.jobs.items() if j["status"] == "busy"}
            self.jobs[job["id"]] = job
        threading.Thread(target=self._make, args=(job, text, voice, speed), daemon=True).start()
        return {"ok": True, "job": job["id"]}

    def job(self, job_id):
        with self._lock:
            job = self.jobs.get(str(job_id or ""))
            if not job:
                return {"ok": False, "error": "That's gone."}
            out = {k: job[k] for k in ("done", "total", "status", "error")}
            out["clip"] = self._public(job["clip"]) if job["clip"] else None
            return {"ok": True, **out}

    def _make(self, job, text, voice_id, speed):
        import numpy
        v = VOICES[voice_id]
        kokoro_voice, lang = v[3], v[4]
        character = len(v) > 5
        if character:
            speed *= v[5]
        filters = v[6] if character else ""
        pieces = _pieces(text)
        job["total"] = len(pieces)
        try:
            model = self._model()
            rate, audio = 24000, []
            for i, piece in enumerate(pieces):
                with self._model_lock:  # one at a time: it uses all the CPU it gets
                    samples, rate = model.create(piece, voice=kokoro_voice, speed=speed, lang=lang)
                audio.append(samples)
                audio.append(numpy.zeros(int(rate * 0.18), dtype=samples.dtype))  # a breath between bits
                job["done"] = i + 1
            os.makedirs(waveform.FOLDER, exist_ok=True)
            clip_id = uuid.uuid4().hex[:10]
            wav = os.path.join(waveform.FOLDER, f"tts-{clip_id}.wav")
            _write_wav(wav, numpy.concatenate(audio), rate)
            name = f"tts-{clip_id}.mp3"
            mp3 = os.path.join(waveform.FOLDER, name)
            chain = ",".join(x for x in ("highpass=f=50", filters, "loudnorm=I=-16:TP=-1.5", "apad=pad_dur=0.2") if x)
            result = subprocess.run([media.ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
                                     "-i", wav, "-af", chain, "-ac", "1", "-ar", "44100", "-b:a", "160k", mp3],
                                    capture_output=True, timeout=300, creationflags=media.NO_WINDOW)
            os.remove(wav)
            if result.returncode or not os.path.isfile(mp3):
                raise Error("Couldn't make the sound file.")
            waveform._files.add(name)
            seconds = media.probe(mp3)["duration"]
            clip = {"id": clip_id, "text": text, "voice": voice_id, "voiceName": v[1], "seconds": round(seconds, 1),
                    "file": mp3, "media": name, "made": time.time(),
                    "name": _file_name(text, v[1])}
            with self._lock:
                self.clips.insert(0, clip)
                for old in self.clips[CLIPS_KEPT:]:
                    self._forget(old)
                del self.clips[CLIPS_KEPT:]
                job.update(status="done", clip=clip)
        except Error as e:
            job.update(status="error", error=str(e))
        except Exception:  # the model choked on something
            job.update(status="error", error="Couldn't read that out. Try other words.")

    def _forget(self, clip):
        waveform._files.discard(clip["media"])
        try:
            os.remove(clip["file"])
        except OSError:
            pass

    @staticmethod
    def _public(clip):
        return {k: clip[k] for k in ("id", "text", "voice", "voiceName", "seconds", "media", "name")}

    def find(self, clip_id):
        with self._lock:
            return next((c for c in self.clips if c["id"] == clip_id and os.path.isfile(c["file"])), None)

    def remove(self, clip_id):
        with self._lock:
            clip = next((c for c in self.clips if c["id"] == clip_id), None)
            if clip:
                self.clips.remove(clip)
                self._forget(clip)
        return {"ok": True}

    def save_to(self, clip_id, folder):
        clip = self.find(str(clip_id or ""))
        if not clip:
            raise Error("That clip is gone. Make it again.")
        base = os.path.join(folder, clip["name"])
        path, n = base + ".mp3", 2
        while os.path.exists(path):
            path, n = f"{base} ({n}).mp3", n + 1
        shutil.copyfile(clip["file"], path)
        return path


def _write_wav(path, samples, rate):
    import wave
    import numpy
    pcm = (numpy.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def _file_name(text, voice_name):
    words = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", " ".join(text.split()[:6])).strip(" .")
    return (f"{voice_name} - {words}" if words else voice_name)[:80]


speaker = Speaker()
