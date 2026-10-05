"""The download queue: videos waiting their turn, a few downloading at once."""

import itertools
import os
import threading
import time

import downloader

INFO_TTL = 30 * 60  # download links from a lookup stay valid for a while, not forever
INFO_KEEP = 100  # looked-up videos kept at most (each can be big)
WORKERS = 3  # downloads at the same time

# What the download list says during each step after downloading.
STEPS = {
    "Merger": "Putting the video and sound together",
    "ExtractAudio": "Converting",
    "Cut": "Cutting out your part",
    "Gif": "Making the GIF",
    "Shrink": "Making it smaller",
    "Volume": "Evening out the volume",
    "Metadata": "Adding the title and cover art",
}


class Queue:
    def __init__(self):
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

    def add(self, url, fmt, quality, quality_label, folder, trim=None, normalize=False, preview=None):
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
                    job.update(status="queued", progress=0, message="Waiting...")
                    self.wake.notify()

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

    def _run(self, job):
        def on_progress(d):
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                percent = d["downloaded_bytes"] * 100 / total if total else 0
                self._update(job, progress=percent, message=f"Downloading... {percent:.0f}%")
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
            self._update(job, message="Starting download...")
            path = downloader.download(info, job["folder"], job["format"], job["quality"],
                                       on_progress, job["trim"], job["normalize"])
        except Exception as e:
            self._update(job, status="error", message=downloader.friendly_error(e))
            return
        self._update(job, status="done", progress=100, file=path,
                     message=f"Saved as {os.path.basename(path)}" if path else "Saved")
