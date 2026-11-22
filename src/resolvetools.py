"""The Resolve tab: tools that make editing in DaVinci Resolve easier.

- Fix for Resolve: a steady .mov that Resolve edits smoothly (media.convert_for_resolve).
- Subtitles: listens to the speech (subtitles.py). Checked and fixed in the
  subtitle editor, then "Put in Resolve" makes a timeline file (fcpxml.py) with
  the video and the subtitles as titles, for File > Import > Timeline in Resolve.
- Cut the silence: a timeline file with the quiet parts cut out (every cut can
  still be changed in Resolve), or a new video without them (silence.py).

The list works like the Files tab's (same adding, removing and stopping), so
it's built on files.Files. (Buttons inside Resolve can't be used: the free
Resolve 21 turns off what scripts would need to reach VaultHub.)
"""

import itertools
import json
import os
import re
import shutil
import subprocess
import threading

import drt
import fcpxml
import files
import fixes
import history
import media
import names
import settings
import silence
import subtitles
import textstyles
import waveform

TOOLS = ("fix", "subtitles", "silence")
_thumb_slots = threading.BoundedSemaphore(3)  # pictures for the strip: a few at a time
OUT_FOLDER = os.path.join(settings.DATA_DIR, "Resolve")
OPTIONS_FILE = os.path.join(settings.DATA_DIR, "resolve-options.json")
DEFAULTS = {"fix": "", "style": "normal", "language": "", "model": "best", "level": "normal", "pause": "0.5", "cutAs": "timeline",
            "device": "gpu", "words": "", "perScreen": "0", "textStyle": "", "fadeOut": "off", "fadeLen": "0.3", "fadeGap": "0.5",
            "punct": "keep", "case": "as", "position": "bottom", "reveal": "word"}
FADES = {"reveal": ("line", "word"), "fadeOut": ("off", "pause", "all"), "fadeLen": ("0.15", "0.3", "0.5", "1"), "fadeGap": ("0.3", "0.5", "1"),
         "punct": ("keep", "remove"), "case": ("as", "upper", "lower"), "position": ("bottom", "middle", "top", "style")}
PER_SCREEN = ("0", "1", "3", "6")  # (3.0) most words on screen at once ("0": as many as fit)


def load_options():
    try:
        with open(OPTIONS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, ValueError):
        saved = {}
    o = dict(DEFAULTS)
    if saved.get("fix") in ("", "smooth"):
        o["fix"] = saved["fix"]
    if saved.get("style") in subtitles.STYLES:
        o["style"] = saved["style"]
    if saved.get("language") in subtitles.LANGUAGES:
        o["language"] = saved["language"]
    if saved.get("model") in subtitles.MODELS:
        o["model"] = saved["model"]
    if saved.get("level") in silence.LEVELS:
        o["level"] = saved["level"]
    if saved.get("pause") in silence.PAUSES:
        o["pause"] = saved["pause"]
    if saved.get("device") in ("gpu", "cpu"):
        o["device"] = saved["device"]
    if saved.get("cutAs") in ("timeline", "video"):
        o["cutAs"] = saved["cutAs"]
    for key, allowed in FADES.items():
        if saved.get(key) in allowed:
            o[key] = saved[key]
    if isinstance(saved.get("textStyle"), str) and (not saved["textStyle"] or textstyles.get(saved["textStyle"])):
        o["textStyle"] = saved["textStyle"]
    if saved.get("perScreen") in PER_SCREEN:
        o["perScreen"] = saved["perScreen"]
    if isinstance(saved.get("words"), str):
        o["words"] = saved["words"][:300]
    return o


def save_options(options):
    o = load_options()
    for key in DEFAULTS:
        if key in options:
            o[key] = options[key]
    try:
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        with open(OPTIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(o, f)
    except OSError:
        pass
    return load_options()


class Stopped(Exception):
    pass


class Tools(files.Files):
    def __init__(self):
        super().__init__()
        self.ids = (f"r{n}" for n in itertools.count(1))  # apart from the Files tab's ids

    # ---- the list

    def _register(self, file_id, name, path, copied, **more):
        # (3.0) **more: the Files tab's add_path passes sub= and watch= since 2.32.0. Without them here,
        # "Add a video" with the Open window broke (only dragging a video in worked).
        super()._register(file_id, name, path, copied, **more)
        with self.lock:
            item = next(i for i in self.items if i["id"] == file_id)
            found = item["probe"]
            item.update(fps=found["fps"], audioTracks=found["audioTracks"], tool="", cues=None, sent=False,
                        fromResolve="", soundCopy="", keep=None)
            return self._public(item)

    def _public(self, item):
        extra = {key: item.get(key) for key in ("fps", "audioTracks", "tool", "fromResolve", "sent")}
        extra["hasCues"] = bool(item.get("cues"))
        extra["outName"] = os.path.basename(item["out"]) if item.get("out") else ""
        extra["kept"] = item.get("keptSeconds")
        extra["timeline"] = os.path.basename(item["timeline"]) if item.get("timeline") else ""
        return super()._public(item) | extra

    def convert(self, picks, options, folder):
        tool = options.get("tool")
        if tool not in TOOLS:
            raise ValueError("Pick what to do first.")
        o = save_options(options)
        job = {"format": tool, "quality": "", "targetMb": None, "normalize": False, "folder": folder, **o,
               "track": str(options.get("track") or "auto")}
        with self.lock:
            for pick in picks:
                item = next((i for i in self.items if i["id"] == str(pick.get("id"))), None)
                if not item or item["status"] in ("queued", "active") or item.get("fromResolve"):
                    continue
                trim = None
                try:
                    start, end = float(pick.get("start")), float(pick.get("end"))
                    if 0 <= start < end and not (start <= 0.05 and end >= item["seconds"] - 0.05):
                        trim = (start, min(end, item["seconds"] or end))
                except (TypeError, ValueError):
                    pass
                item.update(status="queued", progress=0, message="Waiting...", job=dict(job, trim=trim), tool=tool,
                            run=item["run"] + 1, cues=None, sent=False, out="",
                            trimLabel=f"{files._clock(trim[0])} to {files._clock(trim[1])}" if trim else "")
            self.wake.notify()

    def status(self, file_id):
        item = self.find(file_id)
        if not item:
            return {"status": "gone", "message": "It was removed from VaultHub."}
        status = item["status"]
        return {"status": status, "message": item["message"], "progress": item["progress"], "out": item["out"]}

    def _word_by_word(self, item, o, words=None):
        """(3.0) Each line as a row of titles that build it up word by word: "HEY", "HEY GUYS", ...
        each starting when its last word is said. words: {line start: offsets} from the page (what it
        showed in the preview); otherwise worked out from what it heard."""
        out = []
        for start, end, text in item["cues"]:
            spots = [m.end() for m in re.finditer(r"\S+", text)]
            rel = (words or {}).get(round(start, 3))
            if not isinstance(rel, list) or len(rel) != len(spots):
                rel = subtitles.word_offsets(start, end, text, item.get("heard"))
            parts = []
            for k, at in enumerate(rel):
                begin = start + max(0.0, float(at))
                if parts and begin - parts[-1][0] < 0.09:  # (said at the same moment: one title)
                    parts[-1][2] = k
                    continue
                parts.append([begin, None, k])
            for n, part in enumerate(parts):
                part[1] = parts[n + 1][0] if n + 1 < len(parts) else end
            for n, (a, b, k) in enumerate(parts):
                shown = subtitles.dress(text[:spots[k]], o["punct"], o["case"])
                if shown.strip() and b > a:
                    out.append((a, b, shown, n == len(parts) - 1))
        return out

    def send(self, file_id, kind="drt", look=None, words=None):
        """"Put in Resolve" under the subtitles: a timeline file with the video and its subtitles as
        Text+ (a .drt, Resolve's own kind of file), or the old way (FCPXML: a subtitle track)."""
        item = self.find(file_id)
        if not item or not item.get("cues"):
            raise ValueError("There are no subtitles to send yet.")
        source = item["path"]
        if not os.path.isfile(source):
            raise ValueError("Can't find the video anymore.")
        folder = item["job"]["folder"]
        os.makedirs(folder, exist_ok=True)
        stem = os.path.splitext(os.path.basename(item["name"]))[0] or "Video"
        if item.get("copied"):
            # A dropped file is a copy VaultHub cleans up later: keep it next to the timeline instead.
            keep = os.path.join(folder, os.path.basename(item["name"]))
            if not os.path.exists(keep):
                try:
                    os.replace(source, keep)
                except OSError:
                    shutil.copy2(source, keep)
                with self.lock:
                    item.update(path=keep, copied=False)
                source = keep
            elif os.path.getsize(keep) == os.path.getsize(source):
                source = keep
        trim = item["job"].get("trim")
        o = save_options(look or {})
        cues = [(a, b, subtitles.dress(t, o["punct"], o["case"])) for a, b, t in item["cues"]]
        cues = [c for c in cues if c[2].strip()]
        if kind != "fcpxml" and o["reveal"] == "word":
            cues = self._word_by_word(item, o, words)
        if kind == "fcpxml":
            target = os.path.join(folder, f"{stem} (subtitles).fcpxml")
            fcpxml.make(cues, target, f"{stem} (subtitles)", source, offset=trim[0] if trim else 0)
        else:
            target = os.path.join(folder, f"{stem} (subtitles).drt")
            fade = {"when": o["fadeOut"], "seconds": o["fadeLen"], "gap": o["fadeGap"]} if o["fadeOut"] != "off" else None
            own = textstyles.get(o["textStyle"])
            drt.make(cues, target, f"{stem} (subtitles)", source, offset=trim[0] if trim else 0,
                     own=own, fade=fade, position="" if (own and o["position"] == "style") else o["position"])
        with self.lock:
            item.update(sent=True, timeline=target)
        return {"file": target, "name": os.path.basename(target)}

    # ---- watching it in VaultHub

    def video_path(self, file_id, copy=False):
        """The file the window plays: the video itself (instant), or the copy made by preview()."""
        item = self.find(file_id)
        if not item:
            return None
        if copy.startswith("t") and copy[1:].isdigit():  # one sound track, see sound_tracks()
            made = item.get("trackFiles") or []
            path = made[int(copy[1:])] if int(copy[1:]) < len(made) else None
        else:
            path = item.get("preview") if copy else item["path"]
        return path if path and os.path.isfile(path) else None

    def preview(self, file_id):
        """The window couldn't play the video itself (say an MKV or ProRes), so make a copy it can.
        Just repacked when the picture is already fine (a few seconds), else remade on the graphics
        card when there is one. Returns {"ready", "progress"}; call again to see how it's going."""
        item = self.find(file_id)
        if not item:
            raise ValueError("This video was removed.")
        with self.lock:
            if item.get("preview") and os.path.isfile(item["preview"]):
                return {"ready": True, "progress": 100}
            if item.get("previewError"):
                return {"ready": False, "error": item["previewError"]}
            if not item.get("previewBusy"):
                item.update(previewBusy=True, previewProgress=0)
                threading.Thread(target=self._make_preview, args=(item,), daemon=True).start()
            return {"ready": False, "progress": item.get("previewProgress", 0)}

    def _make_preview(self, item):
        found = item.get("probe") or media.probe(item["path"])
        os.makedirs(files.FOLDER, exist_ok=True)
        target = os.path.join(files.FOLDER, f"preview-{item['id']}.mp4")
        temp = target + ".part.mp4"
        seconds = item["seconds"] or 0

        def progress(percent):
            item["previewProgress"] = percent

        sound = ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "160k", "-ac", "2"]
        try:
            if not item["video"]:
                media.run(["-i", item["path"], "-vn", *sound, temp], seconds, progress)
            elif found.get("videoCodec") in ("h264", "vp9", "av1") and not found.get("tenBit"):
                media.run(["-i", item["path"], "-map", "0:v:0", "-c:v", "copy", *sound, "-movflags", "+faststart", temp],
                          seconds, progress)
            else:
                media.run_video(["-i", item["path"], "-map", "0:v:0", "-vf", "scale=-2:'min(720,ih)'"],
                                [*sound, "-movflags", "+faststart"], temp, seconds, progress)
            os.replace(temp, target)
            with self.lock:
                item.update(preview=target, previewBusy=False, previewProgress=100)
        except Exception:
            try:
                os.remove(temp)
            except OSError:
                pass
            with self.lock:
                item.update(previewBusy=False, previewError="VaultHub can't show this video, but the tools still work on it.")

    def sound_tracks(self, file_id):
        """(3.0) The window plays only a video's first sound track. With more (OBS: game on one, your mic
        on another), each track is taken out into its own sound file, so the page can play them all
        along with the picture, each with its own on/off. Copied as it is when it can (a few seconds,
        even for a long recording), else turned into AAC. Returns {"ready", "progress", "count"};
        call again to see how it's going."""
        item = self.find(file_id)
        if not item:
            raise ValueError("This video was removed.")
        count = max(1, item.get("audioTracks") or 1)
        with self.lock:
            done = item.get("trackFiles") or []
            if len(done) == count and all(os.path.isfile(f) for f in done):
                return {"ready": True, "progress": 100, "count": count}
            if item.get("mixError"):
                return {"ready": False, "error": item["mixError"], "count": count}
            if not item.get("mixBusy"):
                item.update(mixBusy=True, mixProgress=0)
                threading.Thread(target=self._split_tracks, args=(item, count), daemon=True).start()
            return {"ready": False, "progress": item.get("mixProgress", 0), "count": count}

    def _split_tracks(self, item, count):
        os.makedirs(files.FOLDER, exist_ok=True)
        made = []
        try:
            for n in range(count):
                target = os.path.join(files.FOLDER, f"preview-{item['id']}-t{n}.m4a")
                temp = target + ".part.m4a"

                def progress(p, n=n):
                    item["mixProgress"] = (n + p / 100) * 100 / count

                # (3.0) Made fresh, with holes in the sound filled, so it stays in step with the video
                # (a straight copy drifted further off the longer the video played).
                media.run(["-i", item["path"], "-map", f"0:a:{n}", "-vn", "-af", subtitles.SOUND_IN_STEP,
                           "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", temp], item["seconds"] or 0, progress)
                os.replace(temp, target)
                made.append(target)
            with self.lock:
                item.update(trackFiles=made, mixBusy=False, mixProgress=100)
        except Exception:
            for path in made:
                try:
                    os.remove(path)
                except OSError:
                    pass
            with self.lock:
                item.update(mixBusy=False, mixError="Couldn't open the other sound tracks.")

    def thumb(self, file_id, n, count):
        """(3.0) A small picture from the video for the strip over the sound wave: picture n of count,
        taken from the middle of its slice. Made once, then kept."""
        item = self.find(file_id)
        if not item or not item["video"] or not 0 <= n < count <= 4000:
            return None
        target = os.path.join(files.FOLDER, f"preview-{item['id']}-f{count}-{n}.jpg")
        if os.path.isfile(target):
            return target
        os.makedirs(files.FOLDER, exist_ok=True)
        at = (item["seconds"] or 0) * (n + 0.5) / count
        with _thumb_slots:
            try:
                subprocess.run([media.ffmpeg(), "-v", "error", "-nostdin", "-y", "-ss", f"{at:.2f}", "-i", item["path"],
                                "-frames:v", "1", "-vf", "scale=-2:96", "-q:v", "5", target + ".part.jpg"],
                               capture_output=True, timeout=30, creationflags=media.NO_WINDOW)
                os.replace(target + ".part.jpg", target)
            except (OSError, subprocess.TimeoutExpired):
                return None
        return target

    def peaks(self, file_id):
        """How loud the sound is along the video, for drawing under the player."""
        item = self.find(file_id)
        if not item:
            raise ValueError("This video was removed.")
        if item.get("peaks") is None:
            # (3.0) 20 values a second, so the timeline can be zoomed in on
            bars = int(max(1200, min(60000, (item["seconds"] or 0) * 20)))
            item["peaks"] = waveform.peaks_of(item["path"], item["seconds"], max(1, item.get("audioTracks") or 1), bars) if item["audio"] else []
        return item["peaks"]

    # ---- the subtitle editor

    def cues(self, file_id):
        item = self.find(file_id)
        if not item or not item.get("cues"):
            raise ValueError("These subtitles aren't ready.")
        return item

    def regroup(self, file_id, per_screen, style):
        """(3.0) Words on screen changed after listening: groups the words it heard again (no listening
        again). Typed fixes are lost, so the page asks first when there are any."""
        item = self.cues(file_id)
        if not item.get("heard"):
            raise ValueError("Make the subtitles again to change this.")
        per = str(per_screen) if str(per_screen) in PER_SCREEN else "0"
        style = style if style in subtitles.STYLES else "normal"
        save_options({"perScreen": per, "style": style})
        cues = fixes.apply(subtitles.make_cues(item["heard"], style, int(per)))
        with self.lock:
            item["cues"] = cues
            item["job"].update(perScreen=per, style=style)
        if item["out"] and os.path.isfile(item["out"]):
            subtitles.write_srt(cues, item["out"])
        return cues

    def heard_so_far(self, file_id):
        """(3.0) The lines it has heard so far, while it still listens."""
        item = self.find(file_id)
        words = (item or {}).get("sofar") or []
        job = item.get("job") or {}
        style = job.get("style") if job.get("style") in subtitles.STYLES else "normal"
        return fixes.apply(subtitles.make_cues(words, style, int(job.get("perScreen") or 0))) if words else []

    def save_cues(self, file_id, cues):
        item = self.cues(file_id)
        clean = []
        for c in cues:
            start, end, text = float(c["start"]), float(c["end"]), str(c.get("text") or "").strip()
            if text and end > start >= 0:
                clean.append((round(start, 3), round(end, 3), text[:300]))
        clean.sort()
        if not clean:
            raise ValueError("There has to be at least one subtitle.")
        with self.lock:
            item["cues"] = clean
        if item["out"] and os.path.isfile(item["out"]):
            subtitles.write_srt(clean, item["out"])
        return clean

    # ---- doing the work

    def _run(self, item):
        job = item["job"]
        tool, trim = job["format"], job["trim"]
        if tool in ("subtitles", "silence") and not item["audio"]:
            raise ValueError("This file has no sound in it.")
        if tool == "fix" and not item["video"]:
            raise ValueError("This file has no video in it.")
        length = (trim[1] - trim[0]) if trim else item["seconds"]
        stem = os.path.splitext(item["name"])[0] or "file"
        if trim:
            stem += " ({}-{})".format(*(f"{int(t) // 60}m{int(t) % 60:02d}s" for t in trim))

        def report(text, percent):
            if item.get("cancel"):
                raise Stopped()
            self._update(item, progress=percent, message=f"{text}... {percent:.0f}%" if percent else text + "...")

        report("Starting", 0)
        folder = job["folder"]
        os.makedirs(folder, exist_ok=True)

        if tool == "subtitles":
            temp = names.temp_path(folder, stem, ".srt")
            # Every sound track (OBS often puts the game, your mic and Discord on separate ones).
            tracks = max(1, item.get("audioTracks") or 1)
            picked = job.get("track", "auto")
            streams = [int(picked)] if picked.isdigit() and int(picked) < tracks else list(range(tracks))
            parts = [(item["path"], trim[0] if trim else 0, length if trim else None, 0, stream) for stream in streams]
            try:
                cues = subtitles.make_subtitles(parts, temp, job["model"], job["language"], job["style"], report,
                                                gpu=job.get("device") != "cpu", words=fixes.words_to_listen_for(job.get("words", "")),
                                                find_voice=picked == "auto" and tracks > 1,
                                                per_screen=int(job.get("perScreen") or 0),
                                                on_words=lambda heard: item.update(heard=heard),
                                                on_partial=lambda heard: item.update(sofar=heard))
                path = names.finish(temp)
            except BaseException:
                item["sofar"] = None
                if os.path.exists(temp):
                    os.remove(temp)
                raise
            self._update(item, cues=cues, sofar=None, message=f"{len(cues)} subtitles. Check them, then put them in Resolve.")
            return path

        if tool == "silence":
            source = item["path"]
            start = trim[0] if trim else 0
            share = 0.3 if job.get("cutAs") == "video" else 1  # (the rest is for cutting the video)
            quiet = silence.find_quiet(source, job["level"], job["pause"], item["seconds"] or length,
                                       lambda p: report("Finding the quiet parts", p * share))
            keep = silence.parts_to_keep(quiet, item["seconds"] or length)
            if trim:
                keep = [(max(s, start), min(e, trim[1])) for s, e in keep if e > start and s < trim[1]]
            kept = sum(e - s for s, e in keep)
            self._update(item, keep=keep, keptSeconds=kept)
            if job.get("cutAs") != "video":
                target = names.temp_path(folder, stem + " (no silence)", ".fcpxml")
                fcpxml.make_cuts(source, keep, target, stem + " (no silence)")
                return names.finish(target)
            temp = names.temp_path(folder, stem + " (no silence)", ".mov")
            try:
                silence.cut(source, keep, temp, on_progress=lambda p: report("Cutting", 30 + p * 0.7))
                return names.finish(temp)
            except BaseException:
                if os.path.exists(temp):
                    os.remove(temp)
                raise

        temp = names.temp_path(folder, stem + " (for Resolve)", ".mov")
        try:
            media.convert_for_resolve(item["path"], temp, job["fix"] == "smooth", trim, length,
                                      lambda p: report("Making it ready for Resolve", p))
            return names.finish(temp)
        except BaseException:
            if os.path.exists(temp):
                os.remove(temp)
            raise

    def _worker(self):
        while True:
            with self.lock:
                while not any(i["status"] == "queued" for i in self.items):
                    self.wake.wait()
                item = next(i for i in self.items if i["status"] == "queued")
                item.update(status="active", message="Starting...", cancel=False)
            try:
                path = self._run(item)
            except Exception as e:
                if item.get("cancel") or isinstance(e, Stopped):
                    message = "Stopped."
                else:
                    message = str(e) if isinstance(e, (ValueError, OSError)) else "That didn't work."
                self._update(item, status="error", progress=0, message=message)
                continue
            tool = item["job"]["format"]
            if tool == "silence":
                # (3.0) the file's name shows under this, so the line only says what was cut. Whole seconds
                # on both sides so they add up (12 s showed "Cut 0:03, 0:08 left"), and only the part used.
                trim = item["job"].get("trim")
                before = round((trim[1] - trim[0]) if trim else item["seconds"] or 0)
                after = min(before, round(item.get("keptSeconds") or 0))
                message = f"Cut {files._clock(before - after)} of quiet, {files._clock(after)} left"
            elif tool == "subtitles":
                message = item["message"]
            else:
                message = f"{os.path.getsize(path) / 1e6:.1f} MB"
            self._update(item, status="done", progress=100, out=path, message=message)
            history.count({"fix": "mov", "subtitles": "srt", "silence": "mov"}[tool], item.get("seconds") or 0)

    def remove(self, file_id):
        item = self.find(file_id)
        super().remove(file_id)
        thumbs = [os.path.join(files.FOLDER, f) for f in os.listdir(files.FOLDER)
                  if f.startswith(f"preview-{file_id}-f")] if item and os.path.isdir(files.FOLDER) else []
        for path in (item or {}).get("soundCopy"), (item or {}).get("preview"), *((item or {}).get("trackFiles") or []), *thumbs:
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass


tools = None
_lock = threading.Lock()


def get():
    global tools
    with _lock:
        if tools is None:
            tools = Tools()
        return tools
