"""Multistreaming (2.36.0): OBS sends one stream to VaultHub, and VaultHub passes the very same stream on
to every site that's switched on (Twitch, YouTube, Kick, TikTok). Nothing is encoded again, so it barely
uses the CPU, but each site needs its own share of the upload speed.

How the stream flows:
  OBS --rtmp--> ffmpeg (listens on 127.0.0.1:1935, copies to MPEG-TS) --pipe--> this file
  this file --pipe--> one ffmpeg per site (copies to FLV) --rtmp(s)--> the site
MPEG-TS is cut in 188-byte packets and repeats its headers, so a site can be switched on or off in the
middle of a stream without touching the others.

VaultHub also points OBS at itself when multistreaming is switched on, and back at the old place (most
often Twitch) when it's switched off (obs-websocket: Get/SetStreamServiceSettings).
"""

import http.client
import json
import os
import socket
import ssl
import subprocess
import threading
import time
from collections import deque

import media
import settings

PORT = 1935
APP, KEY = "live", "vaulthub"
OBS_SERVER = f"rtmp://127.0.0.1:{PORT}/{APP}"
PACKET = 188
CHUNK = PACKET * 64  # about 12 KB: a few milliseconds of video
BEHIND_SECONDS = 3  # more than this waiting to go out: the site is falling behind
DROP_SECONDS = 20  # more than this: throw it away and start that site again (it can't catch up)

SITES = {
    "tw": {"name": "Twitch", "server": "rtmp://live.twitch.tv/app", "fixed": True,
           "where": "Twitch dashboard > Settings > Stream > Primary Stream key"},
    "yt": {"name": "YouTube", "server": "rtmp://a.rtmp.youtube.com/live2", "fixed": True,
           "where": "YouTube Studio > Create > Go live > Stream key"},
    "kick": {"name": "Kick", "server": "rtmps://fa723fc1b171.global-contribute.live-video.net/app", "fixed": False,
             "where": "Kick > Creator dashboard > Settings > Stream URL & Key"},
    "tt": {"name": "TikTok", "server": "", "fixed": False,
           "where": "TikTok LIVE Studio or LIVE Center > Stream key (only some accounts get one)"},
}
ORDER = ("tw", "yt", "kick", "tt")
MAIN = "tw"  # never offered as the one to switch off when the upload is too slow

_lock = threading.Lock()
_ingest = None
_sites = {}
_state = {"listening": False, "receiving": False, "since": 0, "error": "", "inRate": 0, "obs": "", "obsError": "",
          "obsPending": None, "test": None, "testing": False}
_rate_in = deque(maxlen=4000)  # (time, bytes) of the last 10 s or so


class Error(Exception):
    pass


def _conf():
    s = settings.load()
    sites = s.get("lv_ms_sites") if isinstance(s.get("lv_ms_sites"), dict) else {}
    out = {}
    for sid in ORDER:
        mine = sites.get(sid) if isinstance(sites.get(sid), dict) else {}
        server = SITES[sid]["server"] if SITES[sid]["fixed"] else str(mine.get("server") or SITES[sid]["server"])
        out[sid] = {"on": bool(mine.get("on")), "server": server, "key": s.get("lv_ms_key_" + sid) or ""}
    return {"on": bool(s.get("lv_ms_on")), "sites": out}


def config():
    """What the setup panel shows. Keys are never sent to the page, only whether one is saved."""
    c = _conf()
    return {"on": c["on"], "obsServer": OBS_SERVER, "obsKey": KEY,
            "sites": {sid: {"on": x["on"], "server": x["server"], "hasKey": bool(x["key"]), "fixed": SITES[sid]["fixed"],
                            "name": SITES[sid]["name"], "where": SITES[sid]["where"]} for sid, x in c["sites"].items()}}


def setup(data):
    """Save keys, servers and which sites are on (only what's sent)."""
    s = settings.load()
    sites = dict(s.get("lv_ms_sites") or {})
    changes = {}
    for sid, d in (data.get("sites") or {}).items():
        if sid not in SITES or not isinstance(d, dict):
            continue
        mine = dict(sites.get(sid) or {})
        if "on" in d:
            mine["on"] = bool(d["on"])
        if "server" in d and not SITES[sid]["fixed"]:
            server = str(d["server"] or "").strip()
            if server and not server.startswith(("rtmp://", "rtmps://")):
                raise Error(f"The {SITES[sid]['name']} server should start with rtmp:// or rtmps://")
            mine["server"] = server[:300]
        if "key" in d:
            key = str(d["key"] or "").strip()
            if any(c.isspace() for c in key) or len(key) > 300:
                raise Error(f"That {SITES[sid]['name']} stream key doesn't look right.")
            changes["lv_ms_key_" + sid] = key
        sites[sid] = mine
    changes["lv_ms_sites"] = sites
    settings.save(**changes)
    _sync_sites()
    return config()


# ---------------------------------------------------------------- one site

class _Site:
    def __init__(self, sid):
        self.sid = sid
        self.q = deque()
        self.queued = 0
        self.cond = threading.Condition()
        self.proc = None
        self.thread = None
        self.stop = False
        self.state = "starting"  # starting / live / behind / error
        self.error = ""
        self.sent = deque(maxlen=4000)
        self.started = time.time()
        self.drops = 0

    def url(self):
        c = _conf()["sites"][self.sid]
        if not c["key"]:
            return ""
        if not c["server"]:
            return ""
        return c["server"].rstrip("/") + "/" + c["key"]

    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def push(self, chunk):
        with self.cond:
            self.q.append(chunk)
            self.queued += len(chunk)
            rate = in_rate() / 8 or 750_000  # bytes per second (6 Mbps if we don't know yet)
            if self.queued > rate * DROP_SECONDS:
                # It can't keep up at all: drop what's waiting and start the site again from fresh video.
                self.q.clear()
                self.queued = 0
                self.drops += 1
                self.error = "Couldn't keep up, started again."
                if self.proc:
                    try:
                        self.proc.kill()
                    except OSError:
                        pass
            self.cond.notify()

    def backlog_seconds(self):
        rate = in_rate() / 8
        return self.queued / rate if rate else 0

    def rate(self):
        return _rate_of(self.sent)

    def close(self):
        self.stop = True
        with self.cond:
            self.cond.notify()
        if self.proc:
            try:
                self.proc.stdin.close()
            except OSError:
                pass
            try:
                self.proc.wait(3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            except OSError:
                pass

    def _run(self):
        tries = 0
        while not self.stop:
            url = self.url()
            if not url:
                self.state, self.error = "error", "No stream key yet. Add it in Set up."
                return
            self.state, self.started = "starting", time.time()
            try:
                self.proc = subprocess.Popen(
                    [media.ffmpeg(), "-hide_banner", "-loglevel", "error", "-nostats", "-fflags", "+genpts",
                     "-f", "mpegts", "-i", "pipe:0", "-map", "0", "-c", "copy", "-f", "flv", "-flvflags", "no_duration_filesize", url],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=media.NO_WINDOW)
            except OSError as e:
                self.state, self.error = "error", f"Couldn't start: {e}"
                return
            err = []
            reader = threading.Thread(target=lambda p=self.proc: err.extend(p.stderr.read().decode("utf-8", "replace").splitlines()[-5:]), daemon=True)
            reader.start()
            ok_since, drops = time.time(), self.drops
            try:
                while not self.stop:
                    with self.cond:
                        while not self.q and not self.stop:
                            self.cond.wait(1)
                        if self.stop:
                            break
                        chunk = self.q.popleft()
                        self.queued -= len(chunk)
                    self.proc.stdin.write(chunk)
                    self.sent.append((time.time(), len(chunk)))
                    if time.time() - self.started > 4:
                        self.state = "behind" if self.backlog_seconds() > BEHIND_SECONDS else "live"
                        if self.state == "live" and self.error and time.time() - ok_since > 20:
                            self.error = ""
            except (OSError, ValueError):
                pass
            if self.stop:
                return
            try:
                self.proc.wait(2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            reader.join(2)
            if self.drops == drops:  # (when it was dropped for being too slow, that's the message to keep)
                self.error = _explain(err, SITES[self.sid]["name"])
            self.state = "error"
            tries = tries + 1 if time.time() - self.started < 30 else 1
            # Try again (a wrong key keeps failing fast, so wait longer each time).
            wait = min(60, 3 * tries)
            end = time.time() + wait
            while time.time() < end and not self.stop:
                time.sleep(0.5)
            with self.cond:
                self.q.clear()
                self.queued = 0


def _explain(lines, name):
    text = " ".join(lines).lower()
    if not text:
        return f"{name} closed the connection. Trying again..."
    if "401" in text or "403" in text or "unauthorized" in text or "forbidden" in text or "access denied" in text:
        return f"{name} said no. Check the stream key in Set up."
    if "resolve" in text or "name or service" in text or "no such host" in text:
        return f"Couldn't find {name}'s server. Check your internet or the server in Set up."
    if "timed out" in text or "timeout" in text:
        return f"{name} didn't answer. Trying again..."
    if "connection refused" in text:
        return f"{name} refused the connection. Check the server in Set up."
    return f"{name} stopped the stream. Trying again..."


def _rate_of(samples):
    """bits per second over the last ~5 seconds."""
    now = time.time()
    recent = [(t, n) for t, n in list(samples) if now - t < 5]
    if len(recent) < 2:
        return 0
    span = max(1.0, now - recent[0][0])
    return int(sum(n for _, n in recent) * 8 / span)


def in_rate():
    return _rate_of(_rate_in)


# ---------------------------------------------------------------- the stream from OBS

def _ingest_loop():
    """Listen for OBS for as long as multistreaming is on. Each time OBS stops, listen again."""
    global _ingest
    while _conf()["on"]:
        if _port_taken():
            with _lock:
                _state.update(listening=False, error=f"Something else on this PC uses port {PORT}. Close other streaming apps and try again.")
            time.sleep(5)
            continue
        try:
            proc = subprocess.Popen(
                [media.ffmpeg(), "-hide_banner", "-loglevel", "error", "-nostats", "-listen", "1", "-timeout", "-1",
                 "-i", f"{OBS_SERVER}/{KEY}", "-map", "0", "-c", "copy", "-f", "mpegts", "-mpegts_flags", "resend_headers",
                 "-muxdelay", "0", "pipe:1"],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=media.NO_WINDOW)
        except OSError as e:
            with _lock:
                _state.update(listening=False, error=f"Couldn't start: {e}")
            return
        _ingest = proc
        with _lock:
            _state.update(listening=True, error="")
        try:
            while True:
                chunk = proc.stdout.read(CHUNK)
                if not chunk:
                    break
                now = time.time()
                if not _state["receiving"]:
                    with _lock:
                        _state.update(receiving=True, since=now)
                    _sync_sites()
                _rate_in.append((now, len(chunk)))
                for site in list(_sites.values()):
                    site.push(chunk)
                if not _conf()["on"]:
                    break
        except (OSError, ValueError):
            pass
        try:
            proc.kill()
        except OSError:
            pass
        _ingest = None
        with _lock:
            _state.update(receiving=False, listening=False)
        _rate_in.clear()
        _close_sites()
        time.sleep(0.5)
    with _lock:
        _state.update(listening=False, receiving=False)


def _port_taken():
    if _ingest is not None:
        return False
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", PORT))
        return False
    except OSError:
        return True
    finally:
        s.close()


_ingest_thread = None


def _ensure_ingest():
    global _ingest_thread
    if _conf()["on"] and not (_ingest_thread and _ingest_thread.is_alive()):
        _ingest_thread = threading.Thread(target=_ingest_loop, daemon=True)
        _ingest_thread.start()


def _sync_sites():
    """Start the sites that are switched on (while OBS is sending), stop the others."""
    c = _conf()
    want = {sid for sid, x in c["sites"].items() if x["on"]} if (c["on"] and _state["receiving"]) else set()
    with _lock:
        for sid in list(_sites):
            if sid not in want:
                site = _sites.pop(sid)
                threading.Thread(target=site.close, daemon=True).start()
        for sid in want:
            if sid not in _sites:
                site = _Site(sid)
                _sites[sid] = site
                site.start()


def _close_sites():
    with _lock:
        gone = list(_sites.values())
        _sites.clear()
    for site in gone:
        threading.Thread(target=site.close, daemon=True).start()


def switch(on):
    """The big switch on the card: multistreaming on or off. Also points OBS at VaultHub, or back."""
    settings.save(lv_ms_on=bool(on))
    if on:
        _ensure_ingest()
    else:
        if _ingest:
            try:
                _ingest.kill()
            except OSError:
                pass
        _close_sites()
    point_obs(bool(on))
    return status()


def site_switch(sid, on):
    if sid not in SITES:
        raise Error("Unknown site.")
    c = _conf()["sites"][sid]
    if on and not c["key"]:
        raise Error(f"Add your {SITES[sid]['name']} stream key in Set up first.")
    if on and not c["server"]:
        raise Error(f"Add the {SITES[sid]['name']} server in Set up first.")
    setup({"sites": {sid: {"on": bool(on)}}})
    return status()


# ---------------------------------------------------------------- pointing OBS here and back

def point_obs(on):
    """Tell OBS where to send its stream. OBS can't change that while it's streaming, so then it's done
    as soon as the stream ends (the console keeps trying)."""
    import obsctl
    with _lock:
        _state["obsPending"] = on
    try:
        status = obsctl.ask_once("GetStreamStatus")
        if status.get("outputActive"):
            with _lock:
                _state.update(obs="waiting", obsError="")
            return False
        now = obsctl.ask_once("GetStreamServiceSettings")
        ours = _is_ours(now)
        if on:
            if not ours:
                settings.save(lv_ms_obs_saved=json.dumps(now))
                _borrow_twitch_key(now)
                obsctl.ask_once("SetStreamServiceSettings", {"streamServiceType": "rtmp_custom",
                                                             "streamServiceSettings": {"server": OBS_SERVER, "key": KEY, "use_auth": False}})
        else:
            saved = settings.load().get("lv_ms_obs_saved") or ""
            if ours:
                try:
                    old = json.loads(saved) if saved else None
                except ValueError:
                    old = None
                if not old:
                    old = _twitch_service()
                if old:
                    obsctl.ask_once("SetStreamServiceSettings", {"streamServiceType": old.get("streamServiceType") or "rtmp_common",
                                                                 "streamServiceSettings": old.get("streamServiceSettings") or {}})
        with _lock:
            _state.update(obs="done", obsError="", obsPending=None)
        return True
    except obsctl.Error as e:
        with _lock:
            _state.update(obs="failed", obsError=str(e))
        return False


def _is_ours(d):
    s = (d or {}).get("streamServiceSettings") or {}
    return (d or {}).get("streamServiceType") == "rtmp_custom" and str(s.get("server") or "").rstrip("/") == OBS_SERVER


def _twitch_service():
    """If we never saw OBS's own settings, Twitch with the key saved here is the best guess."""
    key = _conf()["sites"]["tw"]["key"]
    if not key:
        return None
    return {"streamServiceType": "rtmp_common", "streamServiceSettings": {"service": "Twitch", "server": "auto", "key": key}}


def _borrow_twitch_key(d):
    """OBS already knows the Twitch stream key: use it, so there's one less thing to paste."""
    s = (d or {}).get("streamServiceSettings") or {}
    if str(s.get("service") or "").lower() == "twitch" and s.get("key") and not _conf()["sites"]["tw"]["key"]:
        settings.save(lv_ms_key_tw=str(s["key"]))
        setup({"sites": {"tw": {"on": True}}})


def _obs_retry_loop():
    """Points OBS once its stream has stopped (it can't be changed during a stream)."""
    while True:
        time.sleep(10)
        pending = _state.get("obsPending")
        if pending is not None:
            try:
                point_obs(pending)
            except Exception:  # noqa: BLE001
                pass


threading.Thread(target=_obs_retry_loop, daemon=True).start()


# ---------------------------------------------------------------- the upload speed check

def speed_test(seconds=6):
    """Upload random bytes to Cloudflare's free speed test for a few seconds and see how fast it goes."""
    with _lock:
        if _state["testing"]:
            raise Error("Already testing.")
        _state["testing"] = True
    try:
        sent = [0]
        stop = time.time() + seconds
        start = time.time()
        blob = os.urandom(64 * 1024)
        errors = []

        def one():
            # Several uploads of up to 20 MB one after another (Cloudflare's own test page does about the same).
            while time.time() < stop:
                try:
                    conn = http.client.HTTPSConnection("speed.cloudflare.com", timeout=10, context=ssl.create_default_context())
                    total, done = 20 * 1024 * 1024, 0
                    conn.putrequest("POST", "/__up")
                    conn.putheader("Content-Type", "application/octet-stream")
                    conn.putheader("Content-Length", str(total))
                    conn.endheaders()
                    while done < total and time.time() < stop:
                        piece = blob[:min(len(blob), total - done)]
                        conn.send(piece)
                        done += len(piece)
                        sent[0] += len(piece)
                    if done >= total:
                        conn.getresponse().read()
                    conn.close()
                except (OSError, http.client.HTTPException) as e:
                    errors.append(str(e))
                    if not sent[0]:
                        return

        threads = [threading.Thread(target=one, daemon=True) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(seconds + 12)
        took = max(1.0, time.time() - start)
        if not sent[0] and errors:
            raise Error("Couldn't test your upload speed. Check your internet.")
        mbps = sent[0] * 8 / took / 1_000_000
        result = {"mbps": round(mbps, 1), "at": time.time()}
        settings.save(lv_ms_test=result)
        with _lock:
            _state["test"] = result
        return result
    finally:
        with _lock:
            _state["testing"] = False


# ---------------------------------------------------------------- what the console shows

def status():
    c = _conf()
    if c["on"]:
        _ensure_ingest()
    test = _state.get("test") or settings.load().get("lv_ms_test")
    rate = in_rate()
    sites = {}
    for sid in ORDER:
        x = c["sites"][sid]
        site = _sites.get(sid)
        if site:
            state, err, r = site.state, site.error, site.rate()
        else:
            state = "off" if not x["on"] else ("nokey" if not x["key"] or not x["server"] else "ready")
            err, r = "", 0
        sites[sid] = {"name": SITES[sid]["name"], "on": x["on"], "hasKey": bool(x["key"]), "state": state, "error": err,
                      "rate": r, "main": sid == MAIN}
    sending = [sid for sid, s in sites.items() if s["state"] in ("live", "behind", "starting")]
    per = rate or 6_000_000
    need = per * len(sending) if sending else per * sum(1 for s in sites.values() if s["on"])
    behind = [sid for sid, s in sites.items() if s["state"] == "behind"]
    # While live, the real upload speed is at least what goes out now; when sites fall behind, about that.
    out_now = sum(s["rate"] for s in sites.values())
    have = (test or {}).get("mbps", 0) * 1_000_000
    slow = bool(behind) or (have and need > have * 0.9)
    if behind and out_now:
        have = min(have, out_now) if have else out_now
    with _lock:
        st = dict(_state)
    return {"on": c["on"], "listening": st["listening"], "receiving": st["receiving"], "since": st["since"], "error": st["error"],
            "inRate": rate, "need": need, "have": int(have), "slow": slow, "behind": behind, "sites": sites,
            "test": test, "testing": st["testing"], "obs": st["obs"], "obsError": st["obsError"], "obsPending": st["obsPending"],
            "obsServer": OBS_SERVER, "obsKey": KEY}


def live():
    """Is VaultHub passing a stream on right now? (Closing the app would stop it on every site.)"""
    return bool(_state["receiving"] and _sites)


def live_sites():
    return [SITES[sid]["name"] for sid, s in list(_sites.items()) if s.state in ("live", "behind", "starting")]


def stop_all():
    settings_on = _conf()["on"]
    if _ingest:
        try:
            _ingest.kill()
        except OSError:
            pass
    _close_sites()
    return settings_on


def start_at_launch():
    """Called when the app opens: if multistreaming was on, listen for OBS again."""
    _ensure_ingest()
