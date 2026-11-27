"""(3.4.0) The Clips page: press your key (even in a game) and the last moments are saved as a clip.

It uses OBS's Replay Buffer: OBS always keeps the last 30 seconds or so in memory, and "save" writes them
to a file. VaultHub asks OBS to save, waits for the file, names it after the game you're playing and moves
it into your clips folder (Videos\\VaultHub Clips unless you pick another one). Everything in that folder
shows on the page, also videos you put there yourself. It all stays on your PC.

The key itself is one of the app's hotkeys (see appwindow.set_hotkeys and ui/clips.js).
"""

import hashlib
import json
import os
import re
import shutil
import threading
import time

import media
import obsctl
import settings
import windows

INDEX = os.path.join(settings.DATA_DIR, "clips.json")
THUMBS = os.path.join(settings.DATA_DIR, "clip-thumbs")
VIDEO = (".mp4", ".mkv", ".mov", ".flv", ".webm", ".m4v", ".ts")
KEEP_ON_EVERY = 20  # seconds between "is the clip recorder still on?" looks

_lock = threading.Lock()
_busy = threading.Lock()  # one clip at a time
_last = {"at": 0, "ok": None, "text": "", "clip": None}  # the last press (the pop-up shows it)
_watch = None
popup = None  # main.py: popup(show) shows or hides the "Clipped!" pop-up window


class Error(Exception):
    pass


def folder():
    path = settings.load().get("clips_dir") or ""
    if not path or not os.path.isdir(os.path.dirname(path.rstrip("\\/")) or path):
        path = os.path.join(windows.videos_folder(), "VaultHub Clips")
    return path


def _index():
    try:
        with open(INDEX, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_index(data):
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    temp = INDEX + ".new"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(temp, INDEX)


def _id(path):
    return hashlib.sha1(os.path.normcase(os.path.abspath(path)).encode("utf-8", "replace")).hexdigest()[:16]


def _game():
    """The game you're playing right now (the window in front first), or ""."""
    try:
        import gamedetect
        found = gamedetect._pick()
    except Exception:  # noqa: BLE001 (never stop a clip over this)
        return ""
    if not found:
        return ""
    taught = found[2]
    return (taught.get("name") or "") if isinstance(taught, dict) else str(taught or "")


def _safe(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip(" .")[:60]


# ---------------------------------------------------------------- the page

def prefs():
    s = settings.load()
    key = s.get("clips_key") if isinstance(s.get("clips_key"), dict) else {}
    return {"keepOn": s.get("clips_keep_on") is not False, "folder": folder(),
            "key": {"vk": int(key.get("vk") or 0), "mods": int(key.get("mods") or 0)}}


def set_prefs(data):
    changes = {}
    if "keepOn" in data:
        changes["clips_keep_on"] = bool(data["keepOn"])
    if "folder" in data:
        path = str(data["folder"] or "")
        if path and not os.path.isdir(path):
            raise Error("That folder isn't there.")
        changes["clips_dir"] = path
    if changes:
        settings.save(**changes)
    return prefs()


def obs_state():
    """{"obs": reachable, "replay": True on / False off / None not turned on in OBS, "seconds", "error"}."""
    out = {"obs": False, "replay": None, "seconds": 0, "error": ""}
    try:
        status = obsctl.ask_once("GetReplayBufferStatus")
        out.update(obs=True, replay=bool((status or {}).get("outputActive")))
    except obsctl.Error as e:
        text = str(e)
        if "isn't open" in text or "turned off" in text or "password" in text.lower():
            out["error"] = text
        else:  # OBS is there, but its replay buffer isn't turned on in its settings
            out["obs"] = True
    if out["obs"]:
        out["seconds"] = _seconds()
    return out


def _seconds():
    try:
        mode = (obsctl.ask_once("GetProfileParameter", {"parameterCategory": "Output", "parameterName": "Mode"}) or {}).get("parameterValue")
        cat = "AdvOut" if mode == "Advanced" else "SimpleOutput"
        value = (obsctl.ask_once("GetProfileParameter", {"parameterCategory": cat, "parameterName": "RecRBTime"}) or {})
        return int(value.get("parameterValue") or value.get("defaultParameterValue") or 0)
    except (obsctl.Error, TypeError, ValueError):
        return 0


def turn_on():
    """Start OBS's replay buffer. When it isn't turned on in OBS's settings yet, turn that on too (OBS
    only picks that up after it's opened again, so the page then says so)."""
    try:
        obsctl.ask_once("StartReplayBuffer")
        return {**obs_state(), "restart": False}
    except obsctl.Error as e:
        if "isn't open" in str(e) or "turned off" in str(e):
            raise Error(str(e))
    for cat in ("SimpleOutput", "AdvOut"):
        try:
            obsctl.ask_once("SetProfileParameter", {"parameterCategory": cat, "parameterName": "RecRB", "parameterValue": "true"})
        except obsctl.Error:
            pass
    time.sleep(0.5)
    try:
        obsctl.ask_once("StartReplayBuffer")
        return {**obs_state(), "restart": False}
    except obsctl.Error:
        return {**obs_state(), "restart": True}


def clips():
    """Every video in the clips folder, newest first."""
    where = folder()
    try:
        names = [n for n in os.listdir(where) if os.path.splitext(n)[1].lower() in VIDEO]
    except OSError:
        names = []
    index = _index()
    out, changed = [], False
    for name in names:
        path = os.path.join(where, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        cid = _id(path)
        meta = index.get(cid)
        if not meta or meta.get("size") != st.st_size:
            info = media.probe(path)
            meta = {**(meta or {}), "size": st.st_size, "seconds": round(info.get("duration") or 0, 1),
                    "w": info.get("width") or 0, "h": info.get("height") or 0,
                    "at": (meta or {}).get("at") or st.st_mtime}
            index[cid] = meta
            changed = True
        out.append({"id": cid, "name": os.path.splitext(name)[0], "file": name, "game": meta.get("game") or "",
                    "at": meta.get("at") or st.st_mtime, "seconds": meta.get("seconds") or 0, "size": st.st_size,
                    "w": meta.get("w") or 0, "h": meta.get("h") or 0, "fav": bool(meta.get("fav"))})
    if changed:
        with _lock:
            _save_index(index)
    out.sort(key=lambda c: -c["at"])
    return out


def path_of(cid):
    where = folder()
    try:
        for name in os.listdir(where):
            if os.path.splitext(name)[1].lower() in VIDEO and _id(os.path.join(where, name)) == cid:
                return os.path.join(where, name)
    except OSError:
        pass
    return None


def thumb(cid):
    """A small picture of the clip (made the first time it's asked for)."""
    target = os.path.join(THUMBS, cid + ".jpg")
    if os.path.isfile(target):
        return target
    path = path_of(cid)
    if not path:
        return None
    os.makedirs(THUMBS, exist_ok=True)
    seconds = (_index().get(cid) or {}).get("seconds") or 0
    return target if media.thumbnail(path, target, min(2.0, seconds / 2) if seconds else 1.0) else None


def rename(cid, name):
    path = path_of(cid)
    if not path:
        raise Error("That clip isn't there anymore.")
    name = _safe(str(name or ""))
    if not name:
        raise Error("Give it a name first.")
    target = os.path.join(os.path.dirname(path), name + os.path.splitext(path)[1])
    if os.path.normcase(target) == os.path.normcase(path):
        return
    if os.path.exists(target):
        raise Error("There's already a clip with that name.")
    try:
        os.rename(path, target)
    except OSError:
        raise Error("Couldn't rename it. Is it open in another program?")
    with _lock:
        index = _index()
        meta = index.pop(cid, None)
        if meta:
            index[_id(target)] = meta
            _save_index(index)
    old = os.path.join(THUMBS, cid + ".jpg")
    if os.path.isfile(old):
        try:
            os.replace(old, os.path.join(THUMBS, _id(target) + ".jpg"))
        except OSError:
            pass


def set_fav(cid, on):
    with _lock:
        index = _index()
        if cid in index:
            index[cid]["fav"] = bool(on)
            _save_index(index)


def delete(cid):
    """Into the Recycle Bin, so a wrong click can be undone there."""
    path = path_of(cid)
    if not path:
        return
    if not _recycle(path):
        raise Error("Couldn't delete it. Is it open in another program?")
    with _lock:
        index = _index()
        if index.pop(cid, None) is not None:
            _save_index(index)
    try:
        os.remove(os.path.join(THUMBS, cid + ".jpg"))
    except OSError:
        pass


def _recycle(path):
    if os.name != "nt":
        try:
            os.remove(path)
            return True
        except OSError:
            return False
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                    ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p),
                    ("lpszProgressTitle", wintypes.LPCWSTR)]
    op = SHFILEOPSTRUCTW(wFunc=3, pFrom=os.path.abspath(path) + "\0", fFlags=0x40 | 0x10 | 0x4 | 0x400)  # DELETE; ALLOWUNDO|NOCONFIRMATION|SILENT|NOERRORUI
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0 and not os.path.exists(path)


# ---------------------------------------------------------------- the key

def last():
    return dict(_last)


def _tell(ok, text, clip=None):
    _last.update(at=time.time(), ok=ok, text=text, clip=clip)
    if popup:
        try:
            popup(True)
        except Exception:  # noqa: BLE001
            pass


def clip_now():
    """The key was pressed: save the last moments. Runs on its own thread; the pop-up tells how it went."""
    if not _busy.acquire(blocking=False):
        return
    try:
        _last.update(at=time.time(), ok=None, text="Saving your clip...", clip=None)
        if popup:
            popup(True)
        try:
            clip = _save()
        except Error as e:
            return _tell(False, str(e))
        _tell(True, (clip["game"] + " · " if clip["game"] else "") + (f"{round(clip['seconds'])} seconds" if clip["seconds"] else "Saved"), clip)
    finally:
        _busy.release()


def _save():
    game = _game()
    try:
        conn, own = obsctl.connect_once()
    except obsctl.Error as e:
        raise Error("OBS isn't open. Open OBS to clip." if "isn't open" in str(e) else str(e))
    try:
        return _keep(_save_with(conn), game)
    finally:
        if own:
            conn.close()


def _save_with(conn):
    def ask(kind):
        return conn.ask(kind) or {}
    try:
        active = ask("GetReplayBufferStatus").get("outputActive")
    except obsctl.Error:
        raise Error("Turn on the Replay Buffer in OBS first (see the Clips page).")
    if not active:
        try:
            ask("StartReplayBuffer")
        except obsctl.Error:
            raise Error("Turn on the Replay Buffer in OBS first (see the Clips page).")
        raise Error("The clip recorder was off. It's on now, so your next clip works.")
    try:
        before = ask("GetLastReplayBufferReplay").get("savedReplayPath") or ""
    except obsctl.Error:
        before = ""
    try:
        ask("SaveReplayBuffer")
    except obsctl.Error:
        raise Error("OBS couldn't save the clip. Try again.")
    path = ""
    end = time.time() + 20
    while time.time() < end:
        time.sleep(0.3)
        try:
            path = ask("GetLastReplayBufferReplay").get("savedReplayPath") or ""
        except obsctl.Error:
            path = ""
        if path and path != before and os.path.isfile(path):
            break
        path = ""
    if not path:
        raise Error("OBS took too long to save the clip.")
    size = -1  # wait until OBS is done writing it
    for _ in range(25):
        try:
            now = os.path.getsize(path)
        except OSError:
            now = -1
        if now == size and now > 0:
            break
        size = now
        time.sleep(0.3)
    return path


def _keep(path, game):
    """Move OBS's file into the clips folder with a good name, and remember the game."""
    where = folder()
    os.makedirs(where, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H.%M.%S")
    base = _safe(f"{game} {stamp}" if game else f"Clip {stamp}") or "Clip"
    ext = os.path.splitext(path)[1].lower() or ".mp4"
    target = os.path.join(where, base + ext)
    n = 2
    while os.path.exists(target):
        target = os.path.join(where, f"{base} ({n}){ext}")
        n += 1
    for _ in range(10):  # OBS may still hold the file for a moment
        try:
            shutil.move(path, target)
            break
        except OSError:
            time.sleep(0.5)
    else:
        target = path  # (couldn't move it: it stays where OBS put it, and shows up there)
    info = media.probe(target)
    meta = {"game": game, "at": time.time(), "size": os.path.getsize(target), "seconds": round(info.get("duration") or 0, 1),
            "w": info.get("width") or 0, "h": info.get("height") or 0}
    cid = _id(target)
    with _lock:
        index = _index()
        index[cid] = meta
        _save_index(index)
    return {"id": cid, "name": os.path.splitext(os.path.basename(target))[0], "path": target, **meta}


# ---------------------------------------------------------------- keep the recorder on

def watch_start():
    """While "Keep it on" is on and you have a clip key, start OBS's replay buffer whenever OBS is open
    and it's off (OBS turns it off every time it closes)."""
    global _watch
    if _watch:
        return
    _watch = threading.Thread(target=_keep_on, daemon=True)
    _watch.start()


def _keep_on():
    while True:
        time.sleep(KEEP_ON_EVERY)
        s = settings.load()
        if s.get("clips_keep_on") is False or not (s.get("clips_key") or {}).get("vk") or s.get("lv_obs_on") is False:
            continue
        try:
            status = obsctl.ask_once("GetReplayBufferStatus")
            if not (status or {}).get("outputActive"):
                obsctl.ask_once("StartReplayBuffer")
        except obsctl.Error:
            pass
