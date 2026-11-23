"""The download queue: videos waiting their turn, a few downloading at once."""

import itertools
import os
import threading
import time

import downloader

INFO_TTL = 30 * 60  # download links from a lookup stay valid for a while, not forever
INFO_KEEP = 100  # looked-up videos kept at most (each can be big)
WORKERS = 3  # downloads at the same time
STOPPED = "Stopped."

# What the download list says during each step after downloading.
STEPS = {
    "Merger": "Putting the video and sound together",
    "ExtractAudio": "Converting",
    "Cut": "Cutting out your part",
    "Gif": "Making the GIF",
    "Shrink": "Making it smaller",
    "Volume": "Evening out the volume",
    "Metadata": "Adding the title and cover art",
    "Thumbnail": "Getting the thumbnail",
}


def size_text(n):
    return f"{n / 1e9:.1f} GB" if n >= 1e9 else f"{n / 1e6:.1f} MB" if n >= 1e5 else f"{max(1, round(n / 1e3))} KB"


def time_left(seconds):
    seconds = int(seconds)
    if seconds < 60:
        return f"{max(1, seconds)} sec left"
    if seconds < 3600:
        return f"{round(seconds / 60)} min left"
    return f"{seconds // 3600} h {seconds % 3600 // 60} min left"


def download_text(got, total, eta):
    """(3.0) "12.3 MB of 40.1 MB · 30 sec left", or as much of it as is known."""
    parts = [f"{size_text(got)} of {size_text(total)}" if total else size_text(got) if got else ""]
    if eta is not None and total and got < total:
        parts.append(time_left(eta))
    return " · ".join(p for p in parts if p) or "starting"


class Queue:
    def __init__(self, on_done=None, to_library=None):
        self.on_done = on_done  # called with each finished download
        # (3.1.3) called with a finished download that goes straight into the Library (job, path, update)
        self.to_library = to_library
        self.lock = threading.Lock()
        self.wake = threading.Condition(self.lock)
        self.jobs = []
        self.ids = itertools.count(1)
        self.info_cache = {}  # url -> (time, info, preview)
        self.cache_lock = threading.Lock()
        for _ in range(WORKERS):
            threading.Thread(target=self._worker, daemon=True).start()

    # ---- looking videos up

    def lookup(self, url, fresh=False):
        """(info, preview) for a link, looking it up if needed (may take a few seconds).

        fresh: look it up again if the download links in it may have run out.
        """
        with self.cache_lock:
            cached = self.info_cache.get(url)
        if cached and time.time() - cached[0] < (INFO_TTL if fresh else INFO_TTL * 4):
            return cached[1], cached[2]
        info, preview = downloader.fetch_info(url)
        # Subtitle lists are huge and not used.
        info.pop("automatic_captions", None)
        info.pop("subtitles", None)
        with self.cache_lock:
            now = time.time()
            for old in [u for u, c in self.info_cache.items() if now - c[0] > INFO_TTL * 4]:
                del self.info_cache[old]
            while len(self.info_cache) >= INFO_KEEP:
                del self.info_cache[next(iter(self.info_cache))]  # the oldest
            self.info_cache[url] = (now, info, preview)
        return info, preview

    def preview(self, url):
        return self.lookup(url)[1]

    # ---- changing the queue

    def add(self, url, fmt, quality, quality_label, folder, trim=None, normalize=False, preview=None, library=None):
        with self.cache_lock:
            cached = self.info_cache.get(url)
        preview = preview or (cached[2] if cached else None) or {
            "title": url, "channel": "", "duration": "", "thumbnail": "", "seconds": 0}
        preview = {k: preview.get(k, "") for k in ("title", "channel", "duration", "thumbnail", "seconds")}
        job = {
            "id": next(self.ids), "url": url, "format": fmt, "quality": quality,
            "qualityLabel": quality_label, "folder": folder, "file": "", "trim": trim, "normalize": normalize,
            "trimLabel": " to ".join(downloader.format_duration(t) or "0:00" for t in trim) if trim else "",
            "status": "queued", "progress": 0, "message": "Waiting...", **preview,
        }
        if library:  # (3.1.3) {"name", "category", "categoryName", "genre"}: uploaded, not kept on the PC
            job["library"] = library
        with self.lock:
            self.jobs.append(job)
            self.wake.notify()
        return job

    def remove(self, job_id):
        with self.lock:
            self.jobs = [j for j in self.jobs if not (j["id"] == job_id and j["status"] != "active")]

    def retry(self, job_id):
        with self.lock:
            for job in self.jobs:
                if job["id"] == job_id and job["status"] == "error":
                    job.update(status="queued", progress=0, message="Waiting...", cancel=False)
                    self.wake.notify()

    def cancel(self, job_id):
        """Stop a download. A waiting one stops right away, a running one at its next step."""
        with self.lock:
            for job in self.jobs:
                if job["id"] != job_id:
                    continue
                if job["status"] == "queued":
                    job.update(status="error", progress=0, message=STOPPED)
                elif job["status"] == "active":
                    job.update(cancel=True, message="Stopping...")

    def clear_finished(self):
        with self.lock:
            self.jobs = [j for j in self.jobs if j["status"] in ("queued", "active")]

    def find(self, job_id):
        with self.lock:
            return next((dict(j) for j in self.jobs if j["id"] == job_id), None)

    def snapshot(self):
        with self.lock:
            return [dict(j) for j in self.jobs]

    @property
    def busy(self):
        with self.lock:
            return any(j["status"] in ("queued", "active") for j in self.jobs)

    # ---- the worker

    def _update(self, job, **changes):
        with self.lock:
            job.update(changes)

    def _worker(self):
        while True:
            with self.lock:
                while not any(j["status"] == "queued" for j in self.jobs):
                    self.wake.wait()
                job = next(j for j in self.jobs if j["status"] == "queued")
                job.update(status="active", message="Getting video info...")
            self._run(job)

    def _stop_if_asked(self, job):
        if job.get("cancel"):
            from yt_dlp.utils import DownloadCancelled
            raise DownloadCancelled()

    def _run(self, job):
        def on_progress(d):
            self._stop_if_asked(job)  # raising here stops yt-dlp and ffmpeg
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                got = d.get("downloaded_bytes") or 0
                percent = got * 100 / total if total else 0
                self._update(job, progress=percent, message="Downloading... " + download_text(got, total, d.get("eta")))
            elif d["status"] == "finished":
                self._update(job, progress=100, message="Converting...")
            elif d["status"] == "step" and d["step"] in STEPS:
                if d["step"] == "ExtractAudio":
                    text = f"Converting to {job['format'].upper()}..."
                elif "percent" in d:
                    text = f"{STEPS[d['step']]}... {d['percent']:.0f}%"
                else:
                    text = STEPS[d["step"]] + "..."
                self._update(job, progress=d.get("percent", 100), message=text)

        try:
            info, preview = self.lookup(job["url"], fresh=True)
            if preview.get("playlist"):
                raise ValueError("That's a playlist. Pick the videos you want from the list.")
            self._update(job, **{k: v for k, v in preview.items() if k in ("title", "channel", "duration", "thumbnail", "seconds")})
            self._stop_if_asked(job)
            self._update(job, message="Starting download...")
            if job["format"] == "jpg":  # (3.0) only the video's thumbnail
                path = downloader.save_thumbnail(info, job["folder"], on_progress)
            else:
                path = downloader.download(info, job["folder"], job["format"], job["quality"],
                                           on_progress, job["trim"], job["normalize"])
        except Exception as e:
            self._update(job, status="error", cancel=False,
                         message=STOPPED if job.get("cancel") else downloader.friendly_error(e))
            return
        if job.get("library") and self.to_library:
            # (3.1.3) Straight into the Library: the file was only a temporary one.
            self._update(job, cancel=False, uploading=True, progress=0, message="Adding it to the Library...")
            try:
                self.to_library(dict(job), path, lambda message, progress: self._update(job, message=message, progress=progress))
            except Exception as e:
                self._update(job, status="error", uploading=False, message=str(e) or "Couldn't add it to the Library.")
                return
            self._update(job, status="done", uploading=False, progress=100, message="In the Library! Everyone can hear it now.")
            return
        if job.get("cancel"):  # stopped right at the end: keep the file anyway, it's finished
            self._update(job, cancel=False)
        self._update(job, status="done", progress=100, file=path,
                     message=f"Saved as {os.path.basename(path)}" if path else "Saved")
        if self.on_done:
            try:
                self.on_done(dict(job))
            except Exception:
                pass
