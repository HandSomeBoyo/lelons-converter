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
import shutil
import threading

import drt
import fcpxml
import files
import history
import media
import names
import settings
import silence
import subtitles
import waveform

TOOLS = ("fix", "subtitles", "silence")
OUT_FOLDER = os.path.join(settings.DATA_DIR, "Resolve")
OPTIONS_FILE = os.path.join(settings.DATA_DIR, "resolve-options.json")
DEFAULTS = {"fix": "", "style": "normal", "language": "", "model": "best", "level": "normal", "pause": "0.5", "cutAs": "timeline",
            "device": "gpu", "words": ""}


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

    def _register(self, file_id, name, path, copied):
        super()._register(file_id, name, path, copied)
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

    def send(self, file_id, kind="drt"):
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
        if kind == "fcpxml":
            target = os.path.join(folder, f"{stem} (subtitles).fcpxml")
            fcpxml.make(item["cues"], target, f"{stem} (subtitles)", source, offset=trim[0] if trim else 0)
        else:
            target = os.path.join(folder, f"{stem} (subtitles).drt")
            drt.make(item["cues"], target, f"{stem} (subtitles)", source, offset=trim[0] if trim else 0)
        with self.lock:
            item.update(sent=True, timeline=target)
        return {"file": target, "name": os.path.basename(target)}

    # ---- watching it in VaultHub

    def video_path(self, file_id, copy=False):
        """The file the window plays: the video itself (instant), or the copy made by preview()."""
        item = self.find(file_id)
        if not item:
            return None
        path = item.get("mixed") if copy == "mix" else item.get("preview") if copy else item["path"]
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

    def mix(self, file_id):
        """The window plays only a video's first sound track. With more (OBS: game on one, your mic on
        another), VaultHub mixes them all into one sound file that plays along with the picture.
        Returns {"ready", "progress"}; call again to see how it's going."""
        item = self.find(file_id)
        if not item:
            raise ValueError("This video was removed.")
        with self.lock:
            if item.get("mixed") and os.path.isfile(item["mixed"]):
                return {"ready": True, "progress": 100}
            if item.get("mixError"):
                return {"ready": False, "error": item["mixError"]}
            if not item.get("mixBusy"):
                item.update(mixBusy=True, mixProgress=0)
                threading.Thread(target=self._make_mix, args=(item,), daemon=True).start()
            return {"ready": False, "progress": item.get("mixProgress", 0)}

    def _make_mix(self, item):
        tracks = max(1, item.get("audioTracks") or 1)
        os.makedirs(files.FOLDER, exist_ok=True)
        target = os.path.join(files.FOLDER, f"preview-{item['id']}-mix.m4a")
        temp = target + ".part.m4a"
        inputs = "".join(f"[0:a:{n}]" for n in range(tracks))
        try:
            media.run(["-i", item["path"], "-filter_complex", f"{inputs}amix=inputs={tracks}:normalize=0:dropout_transition=0,"
                       "alimiter=limit=0.95[out]", "-map", "[out]", "-vn", "-ac", "2", "-c:a", "aac", "-b:a", "128k", temp],
                      item["seconds"] or 0, lambda p: item.update(mixProgress=p))
            os.replace(temp, target)
            with self.lock:
                item.update(mixed=target, mixBusy=False, mixProgress=100)
        except Exception:
            try:
                os.remove(temp)
            except OSError:
                pass
            with self.lock:
                item.update(mixBusy=False, mixError="Couldn't mix the sound tracks.")

    def peaks(self, file_id):
        """How loud the sound is along the video, for drawing under the player."""
        item = self.find(file_id)
        if not item:
            raise ValueError("This video was removed.")
        if item.get("peaks") is None:
            item["peaks"] = waveform.peaks_of(item["path"], item["seconds"], max(1, item.get("audioTracks") or 1)) if item["audio"] else []
        return item["peaks"]

    # ---- the subtitle editor

    def cues(self, file_id):
        item = self.find(file_id)
        if not item or not item.get("cues"):
            raise ValueError("These subtitles aren't ready.")
        return item

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
                                                gpu=job.get("device") != "cpu", words=job.get("words", ""),
                                                find_voice=picked == "auto" and tracks > 1)
                path = names.finish(temp)
            except BaseException:
                if os.path.exists(temp):
                    os.remove(temp)
                raise
            self._update(item, cues=cues, message=f"{len(cues)} subtitles. Check them, then put them in Resolve.")
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
                before, after = item["seconds"] or 0, item.get("keptSeconds") or 0
                message = f"Cut {files._clock(max(0, before - after))} of quiet, {files._clock(after)} left"
                if path.endswith(".fcpxml"):
                    message += " · In Resolve: File › Import › Timeline"
                elif path:
                    message = f"Saved as {os.path.basename(path)} · " + message
            elif tool == "subtitles":
                message = item["message"]
            else:
                message = f"Saved as {os.path.basename(path)} · {os.path.getsize(path) / 1e6:.1f} MB · Drag it into Resolve"
            self._update(item, status="done", progress=100, out=path, message=message)
            history.count({"fix": "mov", "subtitles": "srt", "silence": "mov"}[tool], item.get("seconds") or 0)

    def remove(self, file_id):
        item = self.find(file_id)
        super().remove(file_id)
        for path in (item or {}).get("soundCopy"), (item or {}).get("preview"), (item or {}).get("mixed"):
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
