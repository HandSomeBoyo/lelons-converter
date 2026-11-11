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

import fcpxml
import files
import history
import media
import names
import settings
import silence
import subtitles

TOOLS = ("fix", "subtitles", "silence")
OUT_FOLDER = os.path.join(settings.DATA_DIR, "Resolve")
OPTIONS_FILE = os.path.join(settings.DATA_DIR, "resolve-options.json")
DEFAULTS = {"fix": "", "style": "normal", "language": "", "model": "quick", "level": "normal", "pause": "0.5", "cutAs": "timeline"}


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
    if saved.get("cutAs") in ("timeline", "video"):
        o["cutAs"] = saved["cutAs"]
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
        found = media.probe(path)
        with self.lock:
            item = next(i for i in self.items if i["id"] == file_id)
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
        job = {"format": tool, "quality": "", "targetMb": None, "normalize": False, "folder": folder, **o}
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

    def send(self, file_id):
        """"Put in Resolve" in the subtitle editor: a timeline file with the video and its subtitles."""
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
        target = os.path.join(folder, f"{stem} (subtitles).fcpxml")
        fcpxml.make(item["cues"], target, f"{stem} (subtitles)", source, offset=trim[0] if trim else 0)
        with self.lock:
            item.update(sent=True, timeline=target)
        return {"file": target, "name": os.path.basename(target)}

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

    def cue_text(self, item):
        """The subtitles as plain lines for the Lua script: "start<TAB>end<TAB>text" (newlines as \\n)."""
        return "".join(f"{s:.3f}\t{e:.3f}\t{t.replace(chr(92), '/').replace(chr(10), chr(92) + 'n')}\n"
                       for s, e, t in item["cues"])

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
            parts = item.get("parts") or [(item["path"], trim[0] if trim else 0, length if trim else None, 0)]
            try:
                cues = subtitles.make_subtitles(parts, temp, job["model"], job["language"], job["style"], report)
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
        if item and item.get("soundCopy"):
            try:
                os.remove(item["soundCopy"])
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
