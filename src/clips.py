"""Clips to drag out of the trim editor, straight into a video editor.

The first time, the whole video (or song) is fetched once in the picked format
and quality. After that, every new start or end only cuts the clip again from
that copy, which takes a moment. Clips you drag somewhere are kept in a folder
of their own for good, because video editors keep pointing at the file you
dropped in. The others are deleted when the app closes.
"""

import os
import shutil
import tempfile
import threading

import downloader
import media
import names
import settings

CLIP_DIR = os.path.join(settings.DATA_DIR, "Clips")
SOURCE_DIR = os.path.join(tempfile.gettempdir(), "LelonsConverter", "clip-sources")
AUDIO = ("mp3", "m4a", "wav", "flac")


def _label(trim):
    return " ({}-{})".format(*(f"{int(t) // 60}m{int(t) % 60:02d}s" for t in trim))


class Clips:
    def __init__(self, lookup, local_file):
        self.lookup = lookup  # url -> (info, preview), from the download queue
        self.local_file = local_file  # file id -> the Files tab's item
        self.lock = threading.Lock()
        self.clips = {}  # key -> what the trim editor shows
        self.sources = {}  # (url, format, quality) -> the whole thing, fetched once

    # ---- from the page

    def want(self, request):
        """Make (or remake) the clip for this trim editor. Returns its state."""
        key = str(request.get("key") or "")
        fmt = request.get("format")
        trim = request.get("trim")
        if not key or fmt not in (*AUDIO, "mp4", "gif") or not (isinstance(trim, list) and len(trim) == 2):
            raise ValueError("Something's missing for the clip.")
        start, end = float(trim[0]), float(trim[1])
        if end - start < 0.1:
            raise ValueError("Pick a longer part first.")
        if fmt == "gif" and end - start > media.GIF_MAX_SECONDS + 0.05:
            raise ValueError(f"GIFs can be up to {media.GIF_MAX_SECONDS} seconds.")
        wanted = {
            "source": request.get("source") or {}, "title": str(request.get("title") or "clip"), "format": fmt,
            "quality": str(request.get("quality") or ""), "targetMb": request.get("targetMb"),
            "normalize": bool(request.get("normalize")), "trim": (round(start, 3), round(end, 3)),
        }
        with self.lock:
            clip = self.clips.setdefault(key, {"status": "idle", "message": "", "progress": 0, "path": "",
                                               "made": None, "dragged": set(), "running": False})
            clip["wanted"] = wanted
            if clip["made"] == wanted and os.path.isfile(clip["path"]):
                # Back to the clip that's already made (the lines moved and came back): no need to cut it again.
                clip.update(status="ready", message="", progress=100)
                return self._public(clip)
            clip.update(status="working", message="Getting ready...", progress=0)
            if not clip["running"]:
                clip["running"] = True
                threading.Thread(target=self._worker, args=(key,), daemon=True).start()
            return self._public(clip)

    def close(self, key):
        """The trim editor closed: stop a clip that's still being made (and its download)."""
        with self.lock:
            clip = self.clips.get(str(key))
            if clip and clip["status"] == "working":
                clip.update(wanted=None, status="idle", message="", progress=0)

    def state(self, key):
        with self.lock:
            clip = self.clips.get(str(key))
            return self._public(clip) if clip else {"status": "idle"}

    def path(self, key):
        """The finished clip, for dragging it. Kept from now on."""
        with self.lock:
            clip = self.clips.get(str(key))
            if not clip or clip["status"] != "ready":
                return None
            clip["dragged"].add(clip["path"])
            _keep(clip["path"])
            return clip["path"]

    def for_sending(self, key):
        """(path, name, seconds) of the finished clip, to send in the chat."""
        with self.lock:
            clip = self.clips.get(str(key))
            if not clip or clip["status"] != "ready" or not os.path.isfile(clip["path"]):
                return None
            start, end = clip["made"]["trim"]
            return clip["path"], os.path.splitext(os.path.basename(clip["path"]))[0], end - start

    def _public(self, clip):
        return {"status": clip["status"], "message": clip["message"], "progress": clip["progress"],
                "fileName": os.path.basename(clip["path"]) if clip["status"] == "ready" else "",
                "trim": list(clip["made"]["trim"]) if clip["status"] == "ready" else None}

    # ---- the work

    def _set(self, key, **changes):
        with self.lock:
            self.clips[key].update(changes)

    def _worker(self, key):
        while True:
            with self.lock:
                clip = self.clips[key]
                wanted = clip["wanted"]
                if wanted is None or (clip["made"] == wanted and clip["status"] == "ready"):
                    clip["running"] = False
                    return
            try:
                path = self._make(key, wanted)
            except Exception as e:
                with self.lock:
                    if clip["wanted"] is wanted:
                        clip.update(status="error", progress=0, running=False,
                                    message=str(e) if isinstance(e, ValueError) else downloader.friendly_error(e))
                        return
                continue  # changed meanwhile: try the new one
            with self.lock:
                old = clip["path"]
                clip.update(path=path, made=wanted)
                if clip["wanted"] is wanted:
                    clip.update(status="ready", message="", progress=100)
            # The clip before this one was never dragged anywhere: nothing needs it.
            if old and old != path and old not in clip["dragged"]:
                try:
                    os.remove(old)
                except OSError:
                    pass

    def _source(self, key, wanted):
        """The whole video or file to cut from."""
        source = wanted["source"]
        if source.get("file"):
            item = self.local_file(source["file"])
            if not item or not os.path.isfile(item["path"]):
                raise ValueError("That file is gone. Add it again.")
            return item["path"]
        url = source.get("url")
        if not url:
            raise ValueError("Something's missing for the clip.")
        fmt = "mp4" if wanted["format"] == "gif" else wanted["format"]
        quality = wanted["quality"]
        if wanted["format"] == "gif" or quality.startswith("fit"):
            quality = "720"  # made smaller (or into a GIF) when it's cut
        if not settings.is_valid_quality(fmt, quality):
            quality = settings.DEFAULT_QUALITY[fmt]
        found = self.sources.get((url, fmt, quality))
        if found and os.path.isfile(found):
            return found

        def on_progress(d):
            with self.lock:
                if self.clips[key]["wanted"] is None:
                    raise ChangedMeanwhile()  # the trim editor was closed: stop downloading
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                percent = d["downloaded_bytes"] * 100 / total if total else 0
                self._set(key, progress=percent, message=f"Getting the {'video' if fmt == 'mp4' else 'sound'}... {percent:.0f}%")

        self._set(key, message="Getting the video..." if fmt == "mp4" else "Getting the sound...")
        info, _ = self.lookup(url)
        folder = os.path.join(SOURCE_DIR, names.new_mark())
        path = downloader.download(info, folder, fmt, quality, on_progress)
        self.sources[(url, fmt, quality)] = path
        return path

    def _make(self, key, wanted):
        source = self._source(key, wanted)
        fmt, trim = wanted["format"], wanted["trim"]
        length = trim[1] - trim[0]

        def progress(percent):
            with self.lock:
                if self.clips[key]["wanted"] is not wanted:
                    raise ChangedMeanwhile()  # stops ffmpeg: a newer start or end came in
            self._set(key, progress=percent, message=f"Cutting the clip... {percent:.0f}%")

        progress(0)
        os.makedirs(CLIP_DIR, exist_ok=True)
        stem = names.safe_stem(wanted["title"], "clip")
        temp = names.temp_path(CLIP_DIR, stem + _label(trim), "." + fmt)
        quality = wanted["quality"]
        try:
            if fmt == "gif":
                media.make_gif(source, temp, int(quality) if quality.isdigit() else 480, trim, length, progress)
            elif fmt == "mp4":
                target_mb = wanted["targetMb"] or (int(quality[3:]) if quality.startswith("fit") else None)
                media.convert_video(source, temp, int(quality) if quality.isdigit() else None, target_mb, trim,
                                    wanted["normalize"], length, progress)
            else:
                media.convert_audio(source, temp, fmt, quality if quality.isdigit() else "192", trim,
                                    wanted["normalize"], length, progress)
            return names.finish(temp)
        except BaseException:
            if os.path.exists(temp):
                os.remove(temp)
            raise


class ChangedMeanwhile(Exception):
    pass


KEPT_FILE = os.path.join(CLIP_DIR, ".dragged")  # names of the clips that were dragged somewhere
_kept_lock = threading.Lock()


def _keep(path):
    with _kept_lock:
        try:
            os.makedirs(CLIP_DIR, exist_ok=True)
            with open(KEPT_FILE, "a", encoding="utf-8") as f:
                f.write(os.path.basename(path) + "\n")
        except OSError:
            pass


def clean_up():
    """The fetched videos, and every clip that was never dragged anywhere (nothing points at those)."""
    shutil.rmtree(SOURCE_DIR, ignore_errors=True)
    with _kept_lock:
        try:
            with open(KEPT_FILE, encoding="utf-8") as f:
                kept = {line.strip() for line in f if line.strip()}
        except OSError:
            kept = set()
        try:
            found = os.listdir(CLIP_DIR)
        except OSError:
            return
        for name in found:
            path = os.path.join(CLIP_DIR, name)
            if name != os.path.basename(KEPT_FILE) and name not in kept and os.path.isfile(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        # Forget the dragged clips the user deleted themselves.
        still = sorted(kept & set(found))
        if still != sorted(kept):
            try:
                with open(KEPT_FILE, "w", encoding="utf-8") as f:
                    f.write("".join(n + "\n" for n in still))
            except OSError:
                pass
