"""The Copyright tab: is this sound a known song?

The sound is turned into an audio fingerprint with fpcalc (Chromaprint, bundled with the app) and
looked up on AcoustID, a free database of millions of songs linked to MusicBrainz. A match means
it's a released song, so it's almost surely copyrighted. No match isn't a promise it's free:
sound effects, memes and short bits of songs are usually not in the database.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import media
import version

FOLDER = os.path.join(tempfile.gettempdir(), "LelonsConverter", "copyright")
LOOKUP = "https://api.acoustid.org/v2/lookup"
TAGS = ("title", "artist", "album_artist", "album", "copyright", "publisher", "date")


class Error(Exception):
    pass


def fpcalc():
    """The fingerprint maker: next to the app on Windows, or one on PATH (for testing)."""
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fpcalc.exe")
    return here if os.path.isfile(here) else shutil.which("fpcalc")


def tags_of(path):
    """What the file itself says it is (title, artist, copyright... tags), from ffmpeg."""
    try:
        text = subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-i", path], capture_output=True,
                              timeout=60, creationflags=media.NO_WINDOW).stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return {}
    found = {}
    for line in text.splitlines():
        match = re.match(r"\s{4}(\w+)\s*:\s(.+)$", line)  # (only the file's own tags, not each stream's)
        if match and match[1].lower() in TAGS and match[1].lower() not in found:
            found[match[1].lower()] = match[2].strip()[:120]
    return found


def fingerprint(path):
    """(seconds, fingerprint) of the first two minutes."""
    tool = fpcalc()
    if not tool:
        raise Error("The copyright checker is missing a part. Reinstall the app.")
    os.makedirs(FOLDER, exist_ok=True)
    wav = os.path.join(FOLDER, f"fp-{uuid.uuid4().hex[:8]}.wav")
    try:
        # Plain sound first, so videos and any format work the same.
        done = subprocess.run([media.ffmpeg(), "-v", "error", "-nostdin", "-y", "-i", path, "-t", "130", "-vn",
                               "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", wav],
                              capture_output=True, timeout=180, creationflags=media.NO_WINDOW)
        if done.returncode or not os.path.isfile(wav):
            raise Error("Couldn't read the sound in that file.")
        result = subprocess.run([tool, "-json", "-length", "120", wav], capture_output=True, timeout=120,
                                creationflags=media.NO_WINDOW)
        try:
            found = json.loads(result.stdout or b"{}")
        except ValueError:
            found = {}
        if not found.get("fingerprint"):
            raise Error("Couldn't listen to that file.")
        return float(found.get("duration") or 0), found["fingerprint"]
    except subprocess.TimeoutExpired:
        raise Error("That took too long. Try a shorter file.") from None
    finally:
        if os.path.exists(wav):
            os.remove(wav)


_lookup_lock = threading.Lock()
_last_lookup = 0.0


def lookup(seconds, fp):
    """AcoustID's answer: the best matching song, or None."""
    global _last_lookup
    if not version.ACOUSTID_KEY:
        raise Error("The copyright checker isn't set up in this version.")
    body = urllib.parse.urlencode({"client": version.ACOUSTID_KEY, "duration": int(round(seconds)), "fingerprint": fp,
                                   "meta": "recordings releasegroups compress", "format": "json"}).encode()
    request = urllib.request.Request(LOOKUP, data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded", "User-Agent": f"VaultHub/{version.VERSION}"})
    with _lookup_lock:  # AcoustID asks for at most 3 lookups a second (just the waiting, not the asking,
        wait = _last_lookup + 0.4 - time.time()  # so one slow answer doesn't hold up everyone else)
        _last_lookup = max(time.time(), _last_lookup + 0.4)
    if wait > 0:
        time.sleep(wait)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            answer = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            answer = json.loads(e.read() or b"{}")
        except ValueError:
            answer = {}
        if not answer.get("error"):
            raise Error("The song database didn't answer. Try again in a bit.") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise Error("Couldn't reach the song database. Check your internet connection.") from None
    if answer.get("status") != "ok":
        message = (answer.get("error") or {}).get("message", "")
        if "api key" in message.lower() or "client" in message.lower():
            raise Error("The copyright checker's key doesn't work any more. Tell the owner.")
        raise Error("The song database said no. Try again in a bit.")
    return best_match(answer.get("results") or [])


def best_match(results):
    """The most likely song from AcoustID's results (None when nothing matches well enough)."""
    results = sorted((r for r in results if r.get("score", 0) >= 0.5), key=lambda r: -r.get("score", 0))
    if not results:
        return None
    top = results[0]
    for result in results:
        for rec in result.get("recordings") or []:
            if rec.get("title"):
                groups = rec.get("releasegroups") or []
                album = next((g for g in groups if g.get("type") == "Album"), groups[0] if groups else None)
                return {"score": round(result["score"], 2), "title": rec["title"],
                        "artist": ", ".join(a.get("name", "") for a in rec.get("artists") or [] if a.get("name")),
                        "album": album.get("title") if album else "",
                        "link": f"https://musicbrainz.org/recording/{rec['id']}" if rec.get("id") else ""}
    # It's in the database, but nobody wrote down which song it is.
    return {"score": round(top["score"], 2), "title": "", "artist": "", "album": "", "link": ""}


class Checker:
    """The files being checked (newest first), each done on its own thread."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items = []
        self.ids = 0

    def add(self, name, stream, length, done=None):
        os.makedirs(FOLDER, exist_ok=True)
        path = os.path.join(FOLDER, f"in-{uuid.uuid4().hex[:8]}{os.path.splitext(name)[1].lower()[:10]}")
        left = length
        try:
            with open(path, "wb") as out:
                while left > 0:
                    chunk = stream.read(min(1024 * 1024, left))
                    if not chunk:
                        break
                    out.write(chunk)
                    left -= len(chunk)
        except OSError:
            left = left or 1
        if left:
            if os.path.exists(path):
                os.remove(path)
            raise Error("The file wasn't copied all the way.")
        return self._start(os.path.basename(name), path, temporary=True, done=done)

    def add_path(self, path, name=None, done=None):
        return self._start(name or os.path.basename(path), path, temporary=False, done=done)

    def _start(self, name, path, temporary, done=None):
        with self.lock:
            self.ids += 1
            item = {"id": str(self.ids), "name": name, "status": "listening", "message": "Listening...",
                    "seconds": 0, "match": None, "tags": {}, "at": time.time()}
            self.items.insert(0, item)
            if len(self.items) > 30:  # only finished ones are forgotten; a check never vanishes mid-way
                busy = [i for i in self.items if i["status"] in ("listening", "checking")]
                self.items = (self.items[:30] + [i for i in busy if i not in self.items[:30]])[:60]
        threading.Thread(target=self._check, args=(item, path, temporary, done), daemon=True).start()
        return dict(item)

    def _set(self, item, **changes):
        with self.lock:
            item.update(changes)

    def _check(self, item, path, temporary, done=None):
        try:
            tags = tags_of(path)
            seconds = media.probe(path)["duration"]
            self._set(item, tags=tags, seconds=seconds)
            fp_seconds, fp = fingerprint(path)
            self._set(item, status="checking", message="Looking it up...")
            match = lookup(fp_seconds, fp)
            self._set(item, status="done", match=match, message="")
            if done:
                try:
                    done({"match": match})
                except Exception:
                    pass
        except Error as e:
            self._set(item, status="error", message=str(e))
        except Exception:
            self._set(item, status="error", message="Couldn't check that file.")
        finally:
            if temporary and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

    def remove(self, item_id):
        with self.lock:
            self.items = [i for i in self.items if i["id"] != str(item_id) or i["status"] not in ("done", "error")]

    def clear(self):
        with self.lock:
            self.items = [i for i in self.items if i["status"] not in ("done", "error")]

    def snapshot(self):
        with self.lock:
            return [dict(i) for i in self.items]


checker = Checker()


def clean_up():
    shutil.rmtree(FOLDER, ignore_errors=True)
