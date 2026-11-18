"""(2.43.0) Game auto-detect: VaultHub sees which game you're playing and sets your Twitch game to match.

How it knows the game, free and on this PC only:
- the game window in front (or any game running) is looked at every 15 seconds,
- games from Steam and Epic are named by their folder (steamapps\\common\\<Game>), and a list of
  well-known games covers the rest (Minecraft, Fortnite, VALORANT...),
- when it guesses wrong, you pick the right game once and it remembers that program.
The name is looked up in Twitch's own game list, so it needs the Twitch sign-in.
"""

import os
import re
import sys
import threading
import time

import settings

EVERY = 15
STEADY = 2  # looks in a row with the same game before changing (a quick alt-tab doesn't count)
JUST_CHATTING = {"id": "509658", "name": "Just Chatting", "art": "https://static-cdn.jtvnw.net/ttv-boxart/509658-104x144.jpg"}
DEFAULTS = {"on": False, "mode": "auto", "chatting": False}

# Well-known games whose program name doesn't say much (lowercase exe -> Twitch game name)
KNOWN = {
    "minecraft.windows.exe": "Minecraft", "fortniteclient-win64-shipping.exe": "Fortnite",
    "valorant-win64-shipping.exe": "VALORANT", "cs2.exe": "Counter-Strike", "rocketleague.exe": "Rocket League",
    "gta5.exe": "Grand Theft Auto V", "gta5_enhanced.exe": "Grand Theft Auto V", "r5apex.exe": "Apex Legends",
    "r5apex_dx12.exe": "Apex Legends", "league of legends.exe": "League of Legends", "overwatch.exe": "Overwatch 2",
    "robloxplayerbeta.exe": "Roblox", "factorygame-win64-shipping.exe": "Satisfactory", "lethal company.exe": "Lethal Company",
    "phasmophobia.exe": "Phasmophobia", "eldenring.exe": "ELDEN RING", "terraria.exe": "Terraria", "valheim.exe": "Valheim",
    "rainbowsix.exe": "Tom Clancy's Rainbow Six Siege", "destiny2.exe": "Destiny 2", "dota2.exe": "Dota 2",
    "rustclient.exe": "Rust", "tslgame.exe": "PUBG: BATTLEGROUNDS", "fallguys_client_game.exe": "Fall Guys",
    "among us.exe": "Among Us", "deadbydaylight-win64-shipping.exe": "Dead by Daylight", "palworld-win64-shipping.exe": "Palworld",
    "helldivers2.exe": "HELLDIVERS 2", "cyberpunk2077.exe": "Cyberpunk 2077", "marvel-win64-shipping.exe": "Marvel Rivals",
    "repo.exe": "R.E.P.O.", "schedulei.exe": "Schedule I", "peak.exe": "PEAK", "deltaforceclient-win64-shipping.exe": "Delta Force",
}
# Programs that are never the game
SKIP = {"steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "obs64.exe", "obs32.exe", "vaulthub.exe", "discord.exe",
        "chrome.exe", "msedge.exe", "firefox.exe", "explorer.exe", "msedgewebview2.exe", "spotify.exe", "python.exe",
        "pythonw.exe", "unitycrashhandler64.exe", "crashreportclient.exe", "easyanticheat.exe", "battleye.exe",
        "eadesktop.exe", "upc.exe", "galaxyclient.exe", "riotclientservices.exe", "battle.net.exe"}

_lock = threading.Lock()
_state = {"seeing": None, "same": 0, "last": [], "ask": None, "error": "", "asked": 0, "applied": ""}
_thread = None
_twitch = None
processes = None  # (tests) a function giving [(path, is_front)] instead of looking at Windows


def prefs():
    saved = settings.load().get("lv_gd")
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: saved[k] for k in DEFAULTS if k in saved})
    out["mode"] = "ask" if out["mode"] == "ask" else "auto"
    return out


def set_prefs(data):
    p = prefs()
    for k in DEFAULTS:
        if k in data:
            p[k] = (str(data[k]) if k == "mode" else bool(data[k]))
    settings.save(lv_gd=p)
    with _lock:
        _state["same"] = 0
        _state["ask"] = None
    return p


def _known():
    k = settings.load().get("lv_gd_known")
    return k if isinstance(k, dict) else {}


def teach(exe, game):
    """You picked the right game for this program (game None = it isn't a game)."""
    exe = os.path.basename(str(exe or "").replace("\\", "/")).lower()[:120]
    if not exe:
        return
    known = _known()
    if game:
        known[exe] = {"id": str(game.get("id") or "")[:20], "name": str(game.get("name") or "")[:100], "art": str(game.get("art") or "")[:300]}
    else:
        known[exe] = {"ignore": True}
    settings.save(lv_gd_known=dict(list(known.items())[-200:]))
    with _lock:
        _state["seeing"], _state["same"], _state["ask"] = None, 0, None


def start(twitch):
    global _thread, _twitch
    _twitch = twitch
    if not (_thread and _thread.is_alive()):
        _thread = threading.Thread(target=_loop, daemon=True)
        _thread.start()


# ---------------------------------------------------------------- what's running (Windows)

def _windows_processes():
    import ctypes
    from ctypes import wintypes
    k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
    k32.OpenProcess.restype = wintypes.HANDLE

    def path_of(pid):
        h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(1024)
            return buf.value if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)) else ""
        finally:
            k32.CloseHandle(h)

    front_pid = wintypes.DWORD()
    u32.GetWindowThreadProcessId(u32.GetForegroundWindow(), ctypes.byref(front_pid))
    pids = (wintypes.DWORD * 4096)()
    got = wintypes.DWORD()
    ctypes.windll.psapi.EnumProcesses(pids, ctypes.sizeof(pids), ctypes.byref(got))
    out = []
    for pid in list(pids)[: got.value // ctypes.sizeof(wintypes.DWORD)]:
        p = path_of(pid)
        if p:
            out.append((p, pid == front_pid.value))
    return out


def _running():
    if processes:
        return processes()
    if sys.platform != "win32":
        return []
    try:
        return _windows_processes()
    except Exception:  # noqa: BLE001 (a Windows call failing must not stop the console)
        return []


def guess(path):
    """A game's name from its program's path, or None. Known first, then the Steam/Epic folder."""
    exe = os.path.basename(path.replace("\\", "/")).lower()
    if exe in SKIP:
        return None
    if exe in KNOWN:
        return KNOWN[exe]
    low = path.replace("/", "\\").lower()
    if exe in ("javaw.exe", "java.exe") and ("minecraft" in low or "curseforge" in low or "prism" in low or "modrinth" in low):
        return "Minecraft"
    for marker in ("\\steamapps\\common\\", "\\epic games\\", "\\xboxgames\\", "\\gog galaxy\\games\\", "\\ea games\\"):
        i = low.find(marker)
        if i >= 0:
            folder = path.replace("/", "\\")[i + len(marker):].split("\\")[0]
            if folder and folder.lower() not in ("launcher", "directxredist", "steamworks shared", "common redistributables"):
                return folder
    return None


def _pick():
    """(exe, game name or taught game) for what you're playing, front window first."""
    known = _known()
    rows = sorted(_running(), key=lambda r: not r[1])
    for path, _front in rows:
        exe = os.path.basename(path.replace("\\", "/")).lower()
        k = known.get(exe)
        if k and k.get("ignore"):
            continue
        if k and k.get("id"):
            return exe, path, k
        name = guess(path)
        if name:
            return exe, path, name
    return None


def _clean(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _twitch_game(name):
    """The Twitch game for a name (from Twitch's list, remembered)."""
    cache = settings.load().get("lv_gd_cache")
    cache = cache if isinstance(cache, dict) else {}
    key = _clean(name)
    if key in cache:
        return cache[key]
    found = _twitch.games(name)
    best = next((g for g in found if _clean(g["name"]) == key), None)
    if not best:
        best = next((g for g in found if key and (key in _clean(g["name"]) or _clean(g["name"]) in key)), None)
    game = best or (found[0] if found else None)
    if game:
        cache[key] = game
        settings.save(lv_gd_cache=dict(list(cache.items())[-300:]))
    return game


# ---------------------------------------------------------------- the loop

def _loop():
    while True:
        try:
            _step()
        except Exception as e:  # noqa: BLE001
            with _lock:
                _state["error"] = str(e)[:200]
        time.sleep(EVERY)


def _step():
    p = prefs()
    tw = _twitch
    if not (p["on"] and tw and tw.channel and tw.config().get("refresh")):
        with _lock:
            _state.update(seeing=None, same=0, ask=None)
        return
    picked = _pick()
    if picked:
        exe, path, what = picked
        game = what if isinstance(what, dict) else _twitch_game(what)
        seeing = {"exe": exe, "name": (what.get("name") if isinstance(what, dict) else what), "game": game}
    elif p["chatting"]:
        seeing = {"exe": "", "name": "", "game": JUST_CHATTING}
    else:
        seeing = None
    with _lock:
        before = _state["seeing"]
        same = before and seeing and (before.get("game") or {}).get("id") == (seeing.get("game") or {}).get("id")
        _state["same"] = _state["same"] + 1 if same else 1
        _state["seeing"] = seeing
        _state["error"] = ""
        steady = _state["same"] >= STEADY
    game = (seeing or {}).get("game")
    if not (game and game.get("id") and steady):
        return
    info = tw.status.get("info") or {}
    if not info or time.time() - _state.get("infoAt", 0) > 120:
        info = tw.info()
        _state["infoAt"] = time.time()
    if info.get("gameId") == game["id"]:
        with _lock:
            _state["ask"] = None
        return
    if p["mode"] == "ask":
        with _lock:
            if not _state["ask"] or _state["ask"]["game"]["id"] != game["id"]:
                _state["ask"] = {"game": game, "from": info.get("game") or "", "at": time.time()}
        return
    apply(game, info.get("game") or "")


def apply(game=None, before=""):
    """Change the Twitch game now (the Ask mode's button, or by itself in Auto)."""
    with _lock:
        if game is None and _state["ask"]:
            game, before = _state["ask"]["game"], _state["ask"]["from"]
        _state["ask"] = None
    if not game:
        return status()
    _twitch.set_info(game_id=game["id"])
    _state["infoAt"] = time.time()
    with _lock:
        _state["last"] = ([{"from": before, "to": game["name"], "art": game.get("art") or "", "at": time.time()}] + _state["last"])[:5]
    return status()


def status():
    tw = _twitch
    with _lock:
        out = {k: _state[k] for k in ("seeing", "last", "ask", "error")}
    out["prefs"] = prefs()
    out["ready"] = bool(tw and tw.channel and tw.config().get("refresh"))
    out["twitchGame"] = ((tw.status.get("info") or {}).get("game") or tw.status.get("game") or "") if tw else ""
    return out
