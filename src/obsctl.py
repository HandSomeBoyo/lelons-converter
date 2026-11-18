"""Controls OBS from the Live console (2.34.0): its live picture, scenes, sound sources, recording,
replay buffer and Virtual Camera, so OBS can stay minimized while you stream.

One lasting connection to OBS's WebSocket server (the same settings as obsstats.py). A thread reads
everything OBS says: answers to our requests, and events (scene changed, mic muted, sound levels...).
The connection only stays up while the page asks for it (it closes 30 s after the last look).
"""

import base64
import hashlib
import math
import re
import socket
import threading
import time

import settings
import wsclient

# What OBS should tell us about by itself: General, Scenes, Inputs, Outputs, InputVolumeMeters.
EVENTS = 1 | 4 | 8 | 64 | 65536

_lock = threading.Lock()
_conn = None
_thread = None
_asked = 0
_state = {"connected": False, "error": "", "scene": "", "scenes": [], "inputs": [], "record": False, "recordPaused": False,
          "replay": None, "vcam": None, "vcamOurs": False, "saved": 0}
_levels = {}  # input name -> (level 0..1, at)
_order = []  # audio inputs in the order OBS lists them


class Error(Exception):
    pass


def _auth(password, auth):
    secret = base64.b64encode(hashlib.sha256((password + auth["salt"]).encode()).digest()).decode()
    return base64.b64encode(hashlib.sha256((secret + auth["challenge"]).encode()).digest()).decode()


class _Conn:
    def __init__(self, port, password):
        self.ws = wsclient.WebSocket(f"ws://127.0.0.1:{port}", timeout=5)
        hello = self.ws.recv_json()
        if hello.get("op") != 0:
            raise Error("That isn't OBS.")
        identify = {"rpcVersion": 1, "eventSubscriptions": EVENTS}
        auth = (hello.get("d") or {}).get("authentication")
        if auth:
            if not password:
                raise Error("OBS asks for a password. Add it in Set up.")
            identify["authentication"] = _auth(password, auth)
        self.ws.send_json({"op": 1, "d": identify})
        try:
            done = self.ws.recv_json()
        except wsclient.Closed:
            raise Error("OBS said the password is wrong.")
        if done.get("op") != 2:
            raise Error("That isn't OBS.")
        self.ws.sock.settimeout(None)  # (the reader waits as long as it takes; close() wakes it)
        self.send_lock = threading.Lock()
        self.n = 0
        self.waiting = {}  # request id -> [Event, answer]
        self.alive = True

    def ask(self, kind, data=None, timeout=5):
        with self.send_lock:
            self.n += 1
            rid = str(self.n)
            slot = [threading.Event(), None]
            self.waiting[rid] = slot
            msg = {"requestType": kind, "requestId": rid}
            if data:
                msg["requestData"] = data
            self.ws.send_json({"op": 6, "d": msg})
        if not slot[0].wait(timeout):
            self.waiting.pop(rid, None)
            raise Error("OBS didn't answer.")
        d = slot[1] or {}
        status = d.get("requestStatus") or {}
        if not status.get("result"):
            raise Error(status.get("comment") or f"OBS said no ({status.get('code')}).")
        return d.get("responseData") or {}

    def read_forever(self):
        try:
            while self.alive:
                msg = self.ws.recv_json()
                op, d = msg.get("op"), msg.get("d") or {}
                if op == 7:
                    slot = self.waiting.pop(d.get("requestId"), None)
                    if slot:
                        slot[1] = d
                        slot[0].set()
                elif op == 5:
                    _event(d.get("eventType"), d.get("eventData") or {})
        except (OSError, wsclient.Closed, ValueError, socket.timeout):
            pass
        finally:
            self.alive = False
            for slot in list(self.waiting.values()):
                slot[0].set()

    def close(self):
        self.alive = False
        try:
            self.ws.close()
        except OSError:
            pass


def _event(kind, d):
    now = time.time()
    with _lock:
        if kind == "CurrentProgramSceneChanged":
            _state["scene"] = d.get("sceneName") or ""
        elif kind == "SceneListChanged":
            _state["scenes"] = [s.get("sceneName") for s in reversed(d.get("scenes") or []) if s.get("sceneName")]
        elif kind == "InputMuteStateChanged":
            for i in _state["inputs"]:
                if i["name"] == d.get("inputName"):
                    i["muted"] = bool(d.get("inputMuted"))
        elif kind == "InputVolumeMeters":
            names = []
            for i in d.get("inputs") or []:
                name = i.get("inputName")
                if not name:
                    continue
                names.append(name)
                peak = 0.0
                for ch in i.get("inputLevelsMul") or []:
                    if len(ch) > 1:
                        peak = max(peak, float(ch[1] or 0))
                _levels[name] = (peak, now)
            if names != _order:
                _order[:] = names
        elif kind == "RecordStateChanged":
            _state["record"] = bool(d.get("outputActive"))
            _state["recordPaused"] = d.get("outputState") == "OBS_WEBSOCKET_OUTPUT_PAUSED"
        elif kind == "ReplayBufferStateChanged":
            _state["replay"] = bool(d.get("outputActive"))
        elif kind == "ReplayBufferSaved":
            _state["saved"] = now
        elif kind == "VirtualcamStateChanged":
            _state["vcam"] = bool(d.get("outputActive"))
        elif kind == "InputNameChanged":
            for i in _state["inputs"]:
                if i["name"] == d.get("oldInputName"):
                    i["name"] = d.get("inputName")


def _try(conn, kind, data=None):
    try:
        return conn.ask(kind, data)
    except Error:
        return None


def _load(conn):
    """Everything we show, asked once after connecting (then events keep it fresh)."""
    scenes = _try(conn, "GetSceneList") or {}
    rec = _try(conn, "GetRecordStatus") or {}
    replay = _try(conn, "GetReplayBufferStatus")
    vcam = _try(conn, "GetVirtualCamStatus")
    inputs = []
    for i in (_try(conn, "GetInputList") or {}).get("inputs") or []:
        name = i.get("inputName")
        mute = _try(conn, "GetInputMute", {"inputName": name})
        if mute is not None:  # (only sound sources have a mute)
            inputs.append({"name": name, "muted": bool(mute.get("inputMuted"))})
    for special in (_try(conn, "GetSpecialInputs") or {}).values():
        if special and not any(x["name"] == special for x in inputs):
            mute = _try(conn, "GetInputMute", {"inputName": special})
            if mute is not None:
                inputs.insert(0, {"name": special, "muted": bool(mute.get("inputMuted"))})
    with _lock:
        _state.update(connected=True, error="", scene=scenes.get("currentProgramSceneName") or "",
                      scenes=[s.get("sceneName") for s in reversed(scenes.get("scenes") or []) if s.get("sceneName")],
                      record=bool(rec.get("outputActive")), recordPaused=bool(rec.get("outputPaused")),
                      replay=None if replay is None else bool(replay.get("outputActive")),
                      vcam=None if vcam is None else bool(vcam.get("outputActive")), inputs=inputs)


def _run():
    global _conn
    while time.time() - _asked < 30:
        s = settings.load()
        if not s.get("lv_obs_on", True):
            with _lock:
                _state.update(connected=False, error="OBS is turned off in Set up.")
            return
        try:
            conn = _Conn(s.get("lv_obs_port") or 4455, s.get("lv_obs_password") or "")
        except Error as e:
            with _lock:
                _state.update(connected=False, error=str(e))
            time.sleep(8)
            continue
        except (OSError, wsclient.Closed, ValueError):
            with _lock:
                _state.update(connected=False, error="OBS isn't open, or its WebSocket server is off.")
            time.sleep(8)
            continue
        reader = threading.Thread(target=conn.read_forever, daemon=True)
        reader.start()
        _conn = conn
        try:
            _load(conn)
            while conn.alive and time.time() - _asked < 30:
                time.sleep(0.5)
        finally:
            _conn = None
            if _state.get("vcamOurs") and conn.alive:
                _try(conn, "StopVirtualCam")  # (we turned it on for the preview: nobody looks anymore)
            _state["vcamOurs"] = False
            conn.close()
            with _lock:
                _state["connected"] = False
    with _lock:
        _state["connected"] = False


def state():
    """What the OBS card shows (connects if it isn't yet)."""
    global _thread, _asked
    _asked = time.time()
    if not (_thread and _thread.is_alive()):
        _thread = threading.Thread(target=_run, daemon=True)
        _thread.start()
    now = time.time()
    with _lock:
        out = dict(_state)
        out["inputs"] = [dict(i, level=round(_levels.get(i["name"], (0, 0))[0], 4) if now - _levels.get(i["name"], (0, 0))[1] < 1 else 0)
                         for i in _state["inputs"]]
        out["scenes"] = list(_state["scenes"])
    # (audio sources in the order OBS's mixer shows them)
    order = {n: k for k, n in enumerate(_order)}
    out["inputs"].sort(key=lambda i: order.get(i["name"], 999))
    return out


def _need():
    conn = _conn
    if not (conn and conn.alive):
        raise Error("VaultHub isn't connected to OBS right now.")
    return conn


def do(action, data):
    """One button press on the OBS card."""
    conn = _need()
    if action == "scene":
        conn.ask("SetCurrentProgramScene", {"sceneName": str(data.get("scene") or "")})
    elif action == "mute":
        conn.ask("SetInputMute", {"inputName": str(data.get("input") or ""), "inputMuted": bool(data.get("muted"))})
    elif action == "record":
        conn.ask("StopRecord" if _state["record"] else "StartRecord")
    elif action == "pause":
        conn.ask("ResumeRecord" if _state["recordPaused"] else "PauseRecord")
    elif action == "replay-start":
        conn.ask("StartReplayBuffer")
    elif action == "replay-save":
        if not _state.get("replay"):
            raise Error("Turn on the replay buffer first.")
        conn.ask("SaveReplayBuffer")
    elif action == "vcam":
        if data.get("on"):
            if not _state.get("vcam"):
                conn.ask("StartVirtualCam")
                _state["vcamOurs"] = True
        elif _state.get("vcamOurs"):
            conn.ask("StopVirtualCam")
            _state["vcamOurs"] = False
    else:
        raise Error("Unknown button.")
    return state()


def picture(width=640):
    """The program scene as a JPEG data URL (the preview's backup when the Virtual Camera is busy)."""
    conn = _need()
    scene = _state.get("scene")
    if not scene:
        raise Error("OBS has no scene.")
    width = max(160, min(1280, int(width)))
    d = conn.ask("GetSourceScreenshot", {"sourceName": scene, "imageFormat": "jpg", "imageWidth": width,
                                         "imageHeight": int(math.ceil(width * 9 / 16)), "imageCompressionQuality": 70})
    return d.get("imageData") or ""


def ask_once(kind, data=None):
    """One request to OBS, also when the console's connection isn't open (multistreaming, the ad timer).
    Uses the open connection when there is one, or opens one just for this."""
    conn = _conn
    if conn and conn.alive:
        return conn.ask(kind, data)
    s = settings.load()
    if not s.get("lv_obs_on", True):
        raise Error("OBS is turned off in the Live console's Set up.")
    try:
        conn = _Conn(s.get("lv_obs_port") or 4455, s.get("lv_obs_password") or "")
    except (OSError, wsclient.Closed, ValueError):
        raise Error("OBS isn't open, or its WebSocket server is off.")
    reader = threading.Thread(target=conn.read_forever, daemon=True)
    reader.start()
    try:
        return conn.ask(kind, data)
    finally:
        conn.close()


# ---------------------------------------------------------------- one-click mic sound (2.43.0)
# Pro mic filters in OBS, added for you on your mic: noise suppression (RNNoise, built into OBS), a noise
# gate, a compressor (evens out quiet and loud, with a little extra loudness for quiet mics) and a limiter
# (no more clipping when you shout). They're OBS's own filters, named "VaultHub ...", so they keep working
# with VaultHub closed, you can see them in OBS's Filters, and VaultHub never touches your other filters.

MIC_ROOMS = {"quiet": (-42.0, -48.0), "some": (-34.0, -40.0), "noisy": (-28.0, -34.0)}  # gate open, close (dB)
MIC_GAIN = {"quiet": 8.0, "normal": 4.0, "loud": 0.0}  # extra loudness after the compressor (dB)


def mic_prefs():
    saved = settings.load().get("lv_mic")
    out = {"on": False, "mic": "", "room": "some", "voice": "normal"}
    if isinstance(saved, dict):
        out.update({k: saved[k] for k in out if k in saved})
    if out["room"] not in MIC_ROOMS:
        out["room"] = "some"
    if out["voice"] not in MIC_GAIN:
        out["voice"] = "normal"
    return out


def _mic_filters(room, voice):
    open_db, close_db = MIC_ROOMS[room]
    return [
        ("VaultHub noise", "noise_suppress_filter_v2", {"method": "rnnoise"}),
        ("VaultHub gate", "noise_gate_filter", {"open_threshold": open_db, "close_threshold": close_db,
                                                 "attack_time": 25, "hold_time": 200, "release_time": 150}),
        ("VaultHub compressor", "compressor_filter", {"ratio": 4.0, "threshold": -18.0, "attack_time": 6,
                                                      "release_time": 60, "output_gain": MIC_GAIN[voice], "sidechain_source": "none"}),
        ("VaultHub limiter", "limiter_filter", {"threshold": -3.0, "release_time": 60}),
    ]


def _guess_mic():
    names = [i["name"] for i in _state["inputs"]]
    special = _try(_need(), "GetSpecialInputs") or {}
    return special.get("mic1") or next((n for n in names if re.search(r"mic|aux|headset|microphone", n, re.I)), "")


def mic_state():
    p = mic_prefs()
    out = {**p, "sources": [i["name"] for i in _state["inputs"]], "have": [], "others": []}
    if _conn and _conn.alive:
        out["mic"] = p["mic"] or _guess_mic()
        if out["mic"]:
            filters = (_try(_conn, "GetSourceFilterList", {"sourceName": out["mic"]}) or {}).get("filters") or []
            out["have"] = [f.get("filterName") for f in filters if str(f.get("filterName", "")).startswith("VaultHub ")]
            out["others"] = [f.get("filterName") for f in filters if not str(f.get("filterName", "")).startswith("VaultHub ")]
    return out


def mic_set(data):
    """Turn the mic filters on or off, or change the mic, the room or the voice level."""
    conn = _need()
    old = mic_state()
    p = {k: old[k] for k in ("on", "mic", "room", "voice")}
    if "mic" in data:
        p["mic"] = str(data["mic"] or "")[:200]
    if data.get("room") in MIC_ROOMS:
        p["room"] = data["room"]
    if data.get("voice") in MIC_GAIN:
        p["voice"] = data["voice"]
    if "on" in data:
        p["on"] = bool(data["on"])
    if p["on"] and not p["mic"]:
        raise Error("Pick your mic first.")
    if old["mic"] and old["mic"] != p["mic"]:  # (another mic: take them off the old one)
        for name, _kind, _s in _mic_filters(p["room"], p["voice"]):
            _try(conn, "RemoveSourceFilter", {"sourceName": old["mic"], "filterName": name})
    for name, kind, values in _mic_filters(p["room"], p["voice"]):
        if not p["on"]:
            if p["mic"]:
                _try(conn, "RemoveSourceFilter", {"sourceName": p["mic"], "filterName": name})
            continue
        if _try(conn, "GetSourceFilter", {"sourceName": p["mic"], "filterName": name}) is None:
            conn.ask("CreateSourceFilter", {"sourceName": p["mic"], "filterName": name, "filterKind": kind, "filterSettings": values})
        else:
            conn.ask("SetSourceFilterSettings", {"sourceName": p["mic"], "filterName": name, "filterSettings": values, "overlay": True})
            conn.ask("SetSourceFilterEnabled", {"sourceName": p["mic"], "filterName": name, "filterEnabled": True})
    settings.save(lv_mic=p)
    return mic_state()
