"""The download queue: videos waiting their turn, downloading one at a time."""

import itertools
import os
import threading
import time

import downloader

INFO_TTL = 30 * 60  # download links from a lookup stay valid for a while, not forever


class Queue:
    def __init__(self):
        self.lock = threading.Lock()
        self.wake = threading.Condition(self.lock)
        self.jobs = []
        self.ids = itertools.count(1)
        self.info_cache = {}  # url -> (time, info, preview)
        threading.Thread(target=self._worker, daemon=True).start()

    # ---- looking videos up

    def lookup(self, url):
        """Preview info for a link, looking it up if needed (may take a few seconds)."""
        cached = self.info_cache.get(url)
        if cached and time.time() - cached[0] < INFO_TTL:
            return cached[2]
        info, preview = downloader.fetch_info(url)
        self.info_cache[url] = (time.time(), info, preview)
        return preview

    # ---- changing the queue

    def add(self, url, fmt, quality, quality_label, folder, trim=None):
        cached = self.info_cache.get(url)
        preview = cached[2] if cached else {"title": url, "channel": "", "duration": "", "thumbnail": "", "seconds": 0}
        job = {
            "id": next(self.ids), "url": url, "format": fmt, "quality": quality,
            "qualityLabel": quality_label, "folder": folder, "file": "", "trim": trim,
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
                self._update(job, progress=100, message="Converting and adding cover art...")

        try:
            cached = self.info_cache.get(job["url"])
            if not cached or time.time() - cached[0] >= INFO_TTL:
                self.lookup(job["url"])
                cached = self.info_cache[job["url"]]
            self._update(job, **cached[2])
            self._update(job, message="Starting download...")
            path = downloader.download(cached[1], job["folder"], job["format"], job["quality"],
                                       on_progress, job["trim"])
        except Exception as e:
            self._update(job, status="error", message=downloader.friendly_error(e))
            return
        self._update(job, status="done", progress=100, file=path,
                     message=f"Saved as {os.path.basename(path)}" if path else "Saved")
