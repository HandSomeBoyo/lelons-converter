"""The Clip maker tab: turn a long recording into vertical Shorts and TikToks.

1. Add a long video (a recording, a POV, a stream).
2. "Find the best moments" listens to how loud it is all the way through and
   picks the parts that stand out the most from the rest: shouting, laughing,
   explosions, the crowd going wild. Every moment can be moved, made longer or
   shorter, and you can add your own.
3. Pick a look: fill the screen (cropped), the whole picture on a blurred
   background, or your facecam on top with the game under it.
4. Each moment becomes its own 1080 x 1920 MP4, made on the graphics card when
   there is one, with even sound and, if you want, big subtitles burned in
   (heard on your PC with the same speech engine as the Resolve tab).

The video list is the Resolve tab's (adding, playing, the sound mix, the
wave), so it's built on resolvetools.Tools.
"""

import array
import itertools
import math
import os
import shutil
import subprocess
import tempfile
import threading

import history
import media
import names
import resolvetools
import subtitles

W, H = 1080, 1920
LAYOUTS = ("fill", "blur", "facecam")
CAM_SHARE = 0.4  # the facecam's part of the screen (from the top)
LENGTHS = (15, 30, 45, 60)
FRAME = 0.5  # seconds per loudness value when finding moments
MAX_CLIPS = 20
WORK = os.path.join(tempfile.gettempdir(), "LelonsConverter", "shorts")


class Stopped(Exception):
    pass


# ---------------------------------------------------------------- finding the best moments

def loudness(path, seconds, tracks=1, on_progress=None):
    """How loud the video is every FRAME seconds, in dB (all its sound tracks together)."""
    rate = 2000  # plenty to know how loud it is, and quick to go through
    mix = (["-filter_complex", "".join(f"[0:a:{n}]" for n in range(tracks)) + f"amix=inputs={tracks}:normalize=0[out]",
            "-map", "[out]"] if tracks > 1 else ["-map", "0:a:0"])
    command = [media.ffmpeg(), "-v", "error", "-nostdin", "-i", path, *mix, "-vn", "-ac", "1", "-ar", str(rate),
               "-f", "s16le", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=media.NO_WINDOW)
    size = int(rate * FRAME)
    levels = []
    try:
        while True:
            chunk = process.stdout.read(size * 2 * 120)  # a minute at a time
            if not chunk:
                break
            samples = array.array("h")
            samples.frombytes(chunk[: len(chunk) // 2 * 2])
            for i in range(0, len(samples), size):
                part = samples[i:i + size]
                power = sum(x * x for x in part) / max(1, len(part))
                levels.append(10 * math.log10(power / (32768 * 32768) + 1e-10))
            if on_progress and seconds:
                on_progress(min(99.0, len(levels) * FRAME / seconds * 100))
    except BaseException:
        process.kill()
        raise
    finally:
        process.wait()
    return levels


def _rolling_normal(levels, reach=240, step=20):
    """How loud it normally is around each moment: the middle value of the two minutes around it."""
    n = len(levels)
    points = []
    for i in range(0, n, step):
        part = sorted(levels[max(0, i - reach):i + reach])
        points.append(part[len(part) // 2])
    return [points[min(len(points) - 1, i // step)] for i in range(n)]


def find_moments(levels, length=30, count=5):
    """The parts that stand out the most: [{"start", "end", "score"}], best first, not overlapping."""
    n = len(levels)
    if not n:
        return []
    total = n * FRAME
    if total <= length + 2:
        return [{"start": 0.0, "end": round(total, 2), "score": 100}]
    normal = _rolling_normal(levels)
    quiet = sorted(levels)[n // 10]
    excite = []
    for i, level in enumerate(levels):
        above = max(0.0, level - normal[i])
        before = max(levels[max(0, i - 6):i] or [level])
        jump = 6.0 if level - before > 8 and level > normal[i] else 0.0  # something suddenly got loud
        excite.append(above + jump)
    frames = max(2, int(length / FRAME))
    # A running sum makes every window's score quick to get.
    sums = [0.0]
    for e in excite:
        sums.append(sums[-1] + e)
    scored = []
    for start in range(0, n - frames + 1, 2):
        mean = (sums[start + frames] - sums[start]) / frames
        top = max(excite[start:start + frames])
        loud = (sum(levels[start:start + frames]) / frames) - quiet
        if loud < 3:  # nearly silent all the way through
            continue
        scored.append((mean * 0.7 + top * 0.3, start))
    scored.sort(reverse=True)
    picked = []
    gap = int(2 / FRAME)
    for score, start in scored:
        if len(picked) >= count:
            break
        if all(start + frames + gap <= s or start >= s + frames + gap for _sc, s in picked):
            picked.append((score, start))
    if not picked:
        return []
    best = picked[0][0] or 1
    moments = []
    for score, start in picked:
        a = _quiet_spot(levels, start, -3, 2)  # start and end in a quiet spot, not in the middle of a word
        b = _quiet_spot(levels, start + frames, -2, 3)
        moments.append({"start": round(a * FRAME, 2), "end": round(min(total, b * FRAME), 2),
                        "score": max(1, round(score / best * 100))})
    return moments


def _quiet_spot(levels, at, before, after):
    lo, hi = max(0, at + before), min(len(levels) - 1, at + after)
    if lo > hi:
        return min(at, len(levels))
    return min(range(lo, hi + 1), key=lambda i: (levels[i], abs(i - at)))


# ---------------------------------------------------------------- the look

def _even(x):
    return max(2, int(x) // 2 * 2)


def _fill(width, height, out_w, out_h, pos=0.5, top=0.5):
    """Crop (width x height) to the shape of out_w x out_h, then size it. pos: how far right (0-1)."""
    want = out_w / out_h
    if width / height > want:  # wider: cut off the sides
        cw, ch = _even(height * want), _even(height)
        x, y = (width - cw) * min(1, max(0, pos)), 0
    else:  # taller: cut off the top and bottom
        cw, ch = _even(width), _even(width / want)
        x, y = 0, (height - ch) * min(1, max(0, top))
    return f"crop={cw}:{ch}:{int(x)}:{int(y)},scale={out_w}:{out_h}:flags=lanczos,setsar=1"


def video_filter(layout, width, height, pos=0.5, cam=None, fps=0):
    """The ffmpeg filter that makes the 1080 x 1920 picture, ending in [v]."""
    rate = ",fps=60" if fps > 61 else ""
    if layout == "blur":
        return ("[0:v:0]split=2[bga][fga];"
                f"[bga]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,eq=brightness=-0.08,"
                f"scale={W}:{H},setsar=1[bg];"
                f"[fga]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2{rate},format=yuv420p[v]")
    if layout == "facecam":
        cam = cam or {}
        cx, cy = float(cam.get("x", 0)), float(cam.get("y", 0))
        cw, ch = float(cam.get("w", 0.3)), float(cam.get("h", 0.3))
        cx, cy = min(max(cx, 0), 0.98), min(max(cy, 0), 0.98)
        cw, ch = min(max(cw, 0.02), 1 - cx), min(max(ch, 0.02), 1 - cy)
        top_h = _even(H * CAM_SHARE)
        box = f"crop={_even(width * cw)}:{_even(height * ch)}:{int(width * cx)}:{int(height * cy)}"
        cam_part = f"{box},scale={W}:{top_h}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{top_h},setsar=1"
        game_part = _fill(width, height, W, H - top_h, pos)
        return (f"[0:v:0]split=2[cama][gamea];[cama]{cam_part}[cam];[gamea]{game_part}[game];"
                f"[cam][game]vstack=inputs=2{rate},format=yuv420p[v]")
    return f"[0:v:0]{_fill(width, height, W, H, pos)}{rate},format=yuv420p[v]"


def audio_filter(tracks):
    """Every sound track mixed into one, made as loud as other Shorts. Ends in [a]."""
    if tracks > 1:
        mix = "".join(f"[0:a:{n}]" for n in range(tracks)) + f"amix=inputs={tracks}:normalize=0:dropout_transition=0,alimiter=limit=0.95,"
    else:
        mix = "[0:a:0]"
    return f"{mix}{media.LOUDNORM},aresample=48000[a]"


# ---------------------------------------------------------------- burned-in subtitles

def _font_folder():
    """A folder with one big bold font for the subtitles, and its name. On Windows: Arial Black."""
    folder = os.path.join(WORK, "fonts")
    os.makedirs(folder, exist_ok=True)
    windows = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    choices = [(os.path.join(windows, "ariblk.ttf"), "Arial Black"), (os.path.join(windows, "arialbd.ttf"), "Arial"),
               (os.path.join(windows, "segoeuib.ttf"), "Segoe UI"),
               ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu Sans")]
    for path, name in choices:
        if os.path.isfile(path):
            target = os.path.join(folder, os.path.basename(path))
            if not os.path.isfile(target):
                shutil.copy2(path, target)
            return folder, name
    return folder, "Arial"


def _ass_time(t):
    t = max(0.0, t)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def write_ass(cues, target, font, layout):
    """Big, bold Shorts subtitles: white with a thick black edge, each line pops in."""
    # Where they sit: a bit under the middle (above the buttons YouTube and TikTok put at the bottom),
    # or right where the facecam meets the game.
    margin = int(H * (1 - CAM_SHARE) - 40) if layout == "facecam" else 560
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0",
        "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: Short,{font},86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,7,3,2,70,70,{margin},1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for start, end, text in cues:
        clean = " ".join(str(text).replace("{", "(").replace("}", ")").split())
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Short,,0,0,0,,"
                     "{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}" + clean.upper())
    with open(target, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------- making one Short

def render(source, start, end, target, info, layout="fill", pos=0.5, cam=None, ass=None, fonts=None, on_progress=None):
    """One vertical Short from start to end of the source video."""
    length = end - start
    tracks = info.get("audioTracks") or 0
    graph = video_filter(layout, info["width"], info["height"], pos, cam, info.get("fps") or 0)
    if ass:
        # Run where the subtitle file is, so its path needs no escaping (Windows paths have colons).
        graph = graph[:-3] + f",subtitles={os.path.basename(ass)}:fontsdir={os.path.relpath(fonts, os.path.dirname(ass))}[v]"
    maps = ["-map", "[v]"]
    if tracks:
        graph += ";" + audio_filter(tracks)
        maps += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ac", "2"]
    before = ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", source, "-filter_complex", graph, *maps]
    after = ["-movflags", "+faststart", "-shortest" if tracks else "-an"]
    cwd = os.path.dirname(ass) if ass else None
    _run_video(before, after, target, length, on_progress, cwd)


def _run_video(before, after, target, seconds, on_progress, cwd):
    # media.run_video, but run in the subtitles' folder: try the graphics card, then the processor.
    encoder = media.gpu_encoder()
    target = os.path.abspath(target)
    try:
        return media.run([*before, *media.video_codec(encoder, 12000), *after, target], seconds, on_progress, cwd)
    except OSError as e:
        if not encoder:
            raise
        if media._encoder_broke(getattr(e, "ffmpeg_log", ""), encoder):
            media._gpu_failed()
    media.run([*before, *media.video_codec("", 12000), *after, target], seconds, on_progress, cwd)


# ---------------------------------------------------------------- the tab's list

class Shorts(resolvetools.Tools):
    def __init__(self):
        super().__init__()
        self.ids = (f"s{n}" for n in itertools.count(1))  # apart from the Files and Resolve tabs' ids

    def _register(self, file_id, name, path, copied):
        public = super()._register(file_id, name, path, copied)
        with self.lock:
            item = next(i for i in self.items if i["id"] == file_id)
            item.update(moments=None, finding=False, findProgress=0, made=[], tool="shorts")
            return self._public(item)

    def _public(self, item):
        out = super()._public(item)
        out["made"] = [{k: m[k] for k in ("n", "name", "start", "end", "status", "seconds", "bytes", "subs")}
                       | {"thumb": f"/short-thumb/{item['id']}/{m['n']}" if m.get("thumbPath") else ""}
                       for m in item.get("made") or []]
        out["folderName"] = os.path.basename(item.get("outFolder") or "")
        return out

    # ---- finding the moments

    def find_moments(self, file_id, length=30, count=5):
        """Starts looking (or says how it's going). {"ready", "progress", "moments"}"""
        item = self.find(file_id)
        if not item:
            raise ValueError("This video was removed.")
        if not item["audio"]:
            raise ValueError("This video has no sound, so VaultHub can't hear the best moments. Add them yourself.")
        try:
            length = int(length) if int(length) in LENGTHS else 30
        except (TypeError, ValueError):
            length = 30
        count = max(1, min(10, int(count or 5)))
        with self.lock:
            if item.get("findError"):
                error = item.pop("findError")
                raise ValueError(error)
            if item.get("levels") is not None:
                return {"ready": True, "progress": 100, "moments": find_moments(item["levels"], length, count)}
            if not item.get("finding"):
                item.update(finding=True, findProgress=0)
                threading.Thread(target=self._listen, args=(item,), daemon=True).start()
            return {"ready": False, "progress": item.get("findProgress", 0)}

    def _listen(self, item):
        try:
            levels = loudness(item["path"], item["seconds"], max(1, item.get("audioTracks") or 1),
                              lambda p: item.update(findProgress=p))
            with self.lock:
                item.update(levels=levels, finding=False)
        except Exception:
            with self.lock:
                item.update(finding=False, findError="Couldn't go through the sound of this video.")

    # ---- making the Shorts

    def convert(self, picks, options, folder):
        """picks: one {"id", "clips": [{"start", "end"}]}. options: layout, pos, cam, subs, language."""
        pick = picks[0] if picks else {}
        layout = options.get("layout") if options.get("layout") in LAYOUTS else "fill"
        try:
            pos = min(1.0, max(0.0, float(options.get("pos", 0.5))))
        except (TypeError, ValueError):
            pos = 0.5
        cam = options.get("cam") if isinstance(options.get("cam"), dict) else None
        rt = resolvetools.load_options()
        language = options.get("language") if options.get("language") in subtitles.LANGUAGES else ""
        with self.lock:
            item = next((i for i in self.items if i["id"] == str(pick.get("id"))), None)
            if not item:
                raise ValueError("This video was removed.")
            if item["status"] in ("queued", "active"):
                raise ValueError("It's already making Shorts.")
            if not item["video"]:
                raise ValueError("This file has no video in it.")
            clips = []
            for c in (pick.get("clips") or [])[:MAX_CLIPS]:
                try:
                    start, end = float(c["start"]), float(c["end"])
                except (KeyError, TypeError, ValueError):
                    continue
                start, end = max(0.0, start), min(end, item["seconds"] or end)
                if end - start >= 1:
                    clips.append((start, end))
            if not clips:
                raise ValueError("Pick at least one moment first.")
            stem = os.path.splitext(item["name"])[0] or "Video"
            job = {"format": "shorts", "folder": folder, "layout": layout, "pos": pos, "cam": cam,
                   "subs": bool(options.get("subs")), "language": language, "model": rt["model"], "device": rt["device"],
                   "words": rt.get("words", ""), "clips": clips, "stem": stem, "trim": None}
            made = [{"n": n, "name": "", "start": s, "end": e, "status": "waiting", "seconds": e - s, "bytes": 0,
                     "path": "", "thumbPath": "", "subs": False} for n, (s, e) in enumerate(clips, 1)]
            item.update(status="queued", progress=0, message="Waiting...", job=job, run=item["run"] + 1, made=made,
                        out="", outFolder="")
            self.wake.notify()

    def _run(self, item):
        job = item["job"]
        clips = job["clips"]
        info = item["probe"]
        folder = names.free_path(job["folder"], names.safe_stem(job["stem"] + " Shorts"), "")
        os.makedirs(folder, exist_ok=True)
        with self.lock:
            item["outFolder"] = folder
        work = os.path.join(WORK, item["id"])
        os.makedirs(work, exist_ok=True)
        fonts, font = _font_folder() if job["subs"] else (None, None)
        # Each Short is one share of the bar (with subtitles, listening is about half of it).
        share = 100 / len(clips)

        for index, (start, end) in enumerate(clips):
            made = item["made"][index]
            base = index * share

            def report(text, percent, part=(0, 1)):
                if item.get("cancel"):
                    raise Stopped()
                whole = base + share * (part[0] + (part[1] - part[0]) * percent / 100)
                self._update(item, progress=whole, message=f"Short {index + 1} of {len(clips)}: {text}... {percent:.0f}%")

            made["status"] = "active"
            ass = None
            if job["subs"] and item["audio"]:
                srt = os.path.join(folder, f"Short {index + 1}.srt")
                tracks = max(1, item.get("audioTracks") or 1)
                parts = [(item["path"], start, end - start, 0, s) for s in range(tracks)]
                try:
                    cues = subtitles.make_subtitles(parts, srt, job["model"], job["language"], "short",
                                                    lambda text, p: report(text, p, (0, 0.5)),
                                                    gpu=job["device"] != "cpu", words=job["words"], find_voice=tracks > 1)
                except ValueError:
                    cues = []  # nobody talks in this one: it's made without subtitles
                if cues:
                    ass = os.path.join(work, f"short-{index + 1}.ass")
                    write_ass(cues, ass, font, job["layout"])
                    made["subs"] = True
            temp = names.temp_path(folder, f"Short {index + 1}", ".mp4")
            try:
                render(os.path.abspath(item["path"]), start, end, temp, info, job["layout"], job["pos"], job["cam"], ass,
                       fonts, lambda p: report("Making the video", p, (0.5 if ass else 0, 1)))
                path = names.finish(temp)
            except BaseException:
                if os.path.exists(temp):
                    os.remove(temp)
                made["status"] = "error"
                raise
            thumb = os.path.join(work, f"thumb-{index + 1}-{item['run']}.jpg")
            has = media.thumbnail(path, thumb, min(1.0, (end - start) / 3))
            made.update(status="done", path=path, name=os.path.basename(path), bytes=os.path.getsize(path),
                        thumbPath=thumb if has else "")
            history.count("mp4", end - start)
        return folder

    def _worker(self):
        while True:
            with self.lock:
                while not any(i["status"] == "queued" for i in self.items):
                    self.wake.wait()
                item = next(i for i in self.items if i["status"] == "queued")
                item.update(status="active", message="Starting...", cancel=False)
            try:
                folder = self._run(item)
            except Exception as e:
                if item.get("cancel") or isinstance(e, Stopped):
                    message = "Stopped."
                else:
                    message = str(e) if isinstance(e, (ValueError, OSError)) else "That didn't work."
                for m in item.get("made") or []:
                    if m["status"] in ("waiting", "active"):
                        m["status"] = "stopped"
                self._update(item, status="error", progress=0, message=message)
                continue
            done = sum(1 for m in item["made"] if m["status"] == "done")
            self._update(item, status="done", progress=100, out=folder,
                         message=f"{done} Short{'s' if done != 1 else ''} saved in {os.path.basename(folder)}")

    def short_path(self, file_id, n, thumb=False):
        item = self.find(file_id)
        made = next((m for m in (item or {}).get("made") or [] if str(m["n"]) == str(n)), None)
        path = made and (made["thumbPath"] if thumb else made["path"])
        return path if path and os.path.isfile(path) else None

    def remove(self, file_id):
        super().remove(file_id)
        shutil.rmtree(os.path.join(WORK, str(file_id)), ignore_errors=True)


shorts = None
_lock = threading.Lock()


def get():
    global shorts
    with _lock:
        if shorts is None:
            shorts = Shorts()
        return shorts


def clean_up():
    shutil.rmtree(WORK, ignore_errors=True)
