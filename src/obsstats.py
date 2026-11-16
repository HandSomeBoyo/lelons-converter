"""How your stream is doing inside OBS: upload speed, dropped frames, CPU, recording and disk space.

OBS 28 and newer have a "WebSocket server" built in (Tools > WebSocket Server Settings). The app
connects to it on this PC (port 4455) and asks OBS for its numbers every 2 seconds. It only reads:
it never starts, stops or changes anything in OBS. The graphics card's load comes from nvidia-smi,
which comes with NVIDIA's driver.
"""

import base64
import hashlib
import os
import shutil
import socket
import subprocess
import threading
import time
from collections import deque

import wsclient

EVERY = 2  # seconds between looks
GPU_EVERY = 5

_lock = threading.Lock()
_cfg = {"port": 4455, "password": "", "on": False}
_state = {}
_thread = None
_wake = threading.Event()
_asked = 0  # last time the page wanted the numbers (stops looking when nobody does)


def configure(port=4455, password="", on=True):
    new = {"port": int(port or 4455), "password": str(password or ""), "on": bool(on)}
    with _lock:
        changed = new != _cfg
        _cfg.update(new)
    if changed:
        _wake.set()


def _fresh():
    return {"connected": False, "error": "", "streaming": False, "reconnecting": False, "streamMs": 0,
            "bitrate": 0, "bitrates": [], "dropped": 0, "droppedPct": 0.0, "total": 0, "lagged": 0, "laggedPct": 0.0,
            "fps": 0, "cpu": None, "memory": None, "gpu": None, "gpuTemp": None, "congestion": 0.0,
            "recording": {"active": False, "paused": False, "ms": 0, "bytes": 0, "diskMB": None, "hoursLeft": None},
            "warnings": [], "at": 0}


_state = _fresh()


def state():
    """The newest numbers (starts looking at OBS if it isn't already)."""
    global _thread, _asked
    _asked = time.time()
    with _lock:
        if _cfg["on"] and not (_thread and _thread.is_alive()):
            _thread = threading.Thread(target=_run, daemon=True)
            _thread.start()
        out = dict(_state)
        out["bitrates"] = list(_state["bitrates"])
        out["recording"] = dict(_state["recording"])
        out["warnings"] = list(_state["warnings"])
        out["on"] = _cfg["on"]
    return out


def _auth(password, auth):
    secret = base64.b64encode(hashlib.sha256((password + auth["salt"]).encode()).digest()).decode()
    return base64.b64encode(hashlib.sha256((secret + auth["challenge"]).encode()).digest()).decode()


class _Obs:
    def __init__(self, port, password):
        self.ws = wsclient.WebSocket(f"ws://127.0.0.1:{port}", timeout=5)
        hello = self.ws.recv_json()
        if hello.get("op") != 0:
            raise wsclient.Closed("not OBS")
        identify = {"rpcVersion": 1, "eventSubscriptions": 0}
        auth = (hello.get("d") or {}).get("authentication")
        if auth:
            if not password:
                raise PermissionError("OBS asks for a password. Copy it from OBS (Tools > WebSocket Server Settings > Show Connect Info).")
            identify["authentication"] = _auth(password, auth)
        self.ws.send_json({"op": 1, "d": identify})
        try:
            done = self.ws.recv_json()
        except wsclient.Closed:
            raise PermissionError("OBS said the password is wrong. Copy it again from Tools > WebSocket Server Settings > Show Connect Info.")
        if done.get("op") != 2:
            raise wsclient.Closed("not OBS")
        self.n = 0

    def ask(self, kind):
        self.n += 1
        rid = str(self.n)
        self.ws.send_json({"op": 6, "d": {"requestType": kind, "requestId": rid}})
        while True:
            msg = self.ws.recv_json()
            d = msg.get("d") or {}
            if msg.get("op") == 7 and d.get("requestId") == rid:
                return d.get("responseData") or {} if (d.get("requestStatus") or {}).get("result") else {}

    def close(self):
        self.ws.close()


def _nvidia_smi():
    found = shutil.which("nvidia-smi")
    if not found and os.name == "nt":
        p = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe")
        found = p if os.path.isfile(p) else None
    return found


def _gpu(tool):
    try:
        out = subprocess.run([tool, "--query-gpu=utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=4, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        load, temp = (int(x.strip()) for x in out.stdout.strip().splitlines()[0].split(",")[:2])
        return load, temp
    except Exception:
        return None, None


def warnings_for(s, history):
    """Plain words for what's going wrong right now (history: recent bitrates)."""
    out = []
    if s["reconnecting"]:
        out.append({"key": "reconnect", "level": "bad", "text": "OBS lost the connection to the stream and is trying again."})
    if s["streaming"] and s["total"] > 300:
        if s["droppedPct"] >= 5:
            out.append({"key": "drop", "level": "bad", "text": f"{s['droppedPct']:.1f}% of frames never reached viewers. Your internet can't keep up: lower the bitrate in OBS."})
        elif s["droppedPct"] >= 1:
            out.append({"key": "drop", "level": "warn", "text": f"Some frames are being dropped ({s['droppedPct']:.1f}%). Your internet is struggling a bit."})
    if s["total"] > 300 and s["laggedPct"] >= 2:
        out.append({"key": "lag", "level": "warn", "text": "OBS can't draw every frame in time. The game may be using the whole graphics card: try a frame limit in the game."})
    recent = [b for b in history[-15:] if b]
    before = [b for b in history[-90:-15] if b]
    if s["streaming"] and len(recent) >= 10 and len(before) >= 30:
        avg = sum(before) / len(before)
        if avg > 500 and sum(recent) / len(recent) < avg * 0.6:
            out.append({"key": "bitrate", "level": "warn", "text": "Your upload speed dropped. Is something else downloading or uploading?"})
    if s["cpu"] is not None and s["cpu"] >= 90:
        out.append({"key": "cpu", "level": "warn", "text": "OBS is using a lot of CPU. The stream may stutter."})
    if s["gpu"] is not None and s["gpu"] >= 97:
        out.append({"key": "gpu", "level": "warn", "text": "The graphics card is at 100%. OBS may skip frames."})
    rec = s["recording"]
    if rec["active"] and rec["hoursLeft"] is not None and rec["hoursLeft"] < 1:
        out.append({"key": "disk", "level": "bad", "text": f"Only about {max(1, int(rec['hoursLeft'] * 60))} minutes of recording space left on the disk."})
    elif s["streaming"] and not rec["active"]:
        out.append({"key": "norec", "level": "info", "text": "OBS isn't recording this stream. Press Start Recording in OBS if you want a copy for YouTube."})
    return out


def _run():
    tool = _nvidia_smi()
    gpu_at = 0
    history = deque(maxlen=180)
    last_bytes = last_rec = None
    while True:
        with _lock:
            cfg = dict(_cfg)
        if not cfg["on"] or time.time() - _asked > 60:
            with _lock:
                _state.update(_fresh())
            return
        try:
            obs = _Obs(cfg["port"], cfg["password"])
        except PermissionError as e:
            with _lock:
                _state.update(_fresh(), error=str(e))
            _wake.wait(15)
            _wake.clear()
            continue
        except (OSError, wsclient.Closed, ValueError):
            with _lock:
                _state.update(_fresh(), error="OBS isn't open, or its WebSocket server is off. In OBS: Tools > WebSocket Server Settings > Enable WebSocket server.")
            _wake.wait(10)
            _wake.clear()
            continue
        try:
            while True:
                with _lock:
                    if (_cfg["port"], _cfg["password"], _cfg["on"]) != (cfg["port"], cfg["password"], cfg["on"]) or time.time() - _asked > 60:
                        break
                now = time.time()
                stats = obs.ask("GetStats")
                stream = obs.ask("GetStreamStatus")
                rec = obs.ask("GetRecordStatus")
                s = _fresh()
                s.update(connected=True, at=now)
                s["streaming"] = bool(stream.get("outputActive"))
                s["reconnecting"] = bool(stream.get("outputReconnecting"))
                s["streamMs"] = int(stream.get("outputDuration") or 0)
                s["congestion"] = float(stream.get("outputCongestion") or 0)
                total, skipped = int(stream.get("outputTotalFrames") or 0), int(stream.get("outputSkippedFrames") or 0)
                s.update(total=total, dropped=skipped, droppedPct=(skipped / total * 100) if total else 0.0)
                rt, rs = int(stats.get("renderTotalFrames") or 0), int(stats.get("renderSkippedFrames") or 0)
                s.update(lagged=rs, laggedPct=(rs / rt * 100) if rt else 0.0)
                s["fps"] = round(float(stats.get("activeFps") or 0))
                s["cpu"] = round(float(stats["cpuUsage"]), 1) if stats.get("cpuUsage") is not None else None
                s["memory"] = round(float(stats["memoryUsage"])) if stats.get("memoryUsage") is not None else None
                sent = int(stream.get("outputBytes") or 0)
                # Too short a gap between two looks gives silly numbers: wait at least a second.
                if s["streaming"] and last_bytes and now - last_bytes[0] < 1:
                    s["bitrate"] = history[-1] if history else 0
                else:
                    if s["streaming"] and last_bytes and sent >= last_bytes[1]:
                        s["bitrate"] = int((sent - last_bytes[1]) * 8 / 1000 / (now - last_bytes[0]))
                    last_bytes = (now, sent) if s["streaming"] else None
                    history.append(s["bitrate"] if s["streaming"] else 0)
                s["bitrates"] = list(history)
                disk = stats.get("availableDiskSpace")
                r = s["recording"]
                r.update(active=bool(rec.get("outputActive")), paused=bool(rec.get("outputPaused")),
                         ms=int(rec.get("outputDuration") or 0), bytes=int(rec.get("outputBytes") or 0),
                         diskMB=int(disk) if disk is not None else None)
                if r["active"] and last_rec and r["bytes"] > last_rec[1] and now - last_rec[0] >= 1 and r["diskMB"] is not None:
                    per_hour = (r["bytes"] - last_rec[1]) / (now - last_rec[0]) * 3600 / 1e6  # MB per hour
                    if per_hour > 0:
                        r["hoursLeft"] = round(r["diskMB"] / per_hour, 1)
                if not (r["active"] and last_rec and now - last_rec[0] < 1):
                    last_rec = (now, r["bytes"]) if r["active"] else None
                if tool and now - gpu_at >= GPU_EVERY:
                    gpu_at = now
                    gpu = _gpu(tool)
                    with _lock:
                        _state["gpu"], _state["gpuTemp"] = gpu
                with _lock:
                    s["gpu"], s["gpuTemp"] = _state.get("gpu"), _state.get("gpuTemp")
                    if r["active"] and r["hoursLeft"] is None:
                        r["hoursLeft"] = _state["recording"].get("hoursLeft")
                    s["warnings"] = warnings_for(s, list(history))
                    _state.update(s)
                _wake.wait(EVERY)
                _wake.clear()
        except (OSError, wsclient.Closed, ValueError, socket.timeout):
            pass
        finally:
            obs.close()
        last_bytes = last_rec = None
