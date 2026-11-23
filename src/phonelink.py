"""(phone 1.6) Lets the VaultHub phone app use this PC: send it a link to download, add a game from
Steam (the phone can't ask Steam itself) and control OBS from the phone.

While you're logged in, this PC says hello to the database every few seconds ("lelons_pc"). The answer
holds the jobs your phone left for it. When your phone has the OBS card or the "send to PC" sheet open,
the PC says hello faster and adds what OBS is doing, so the phone can show it.
Only your own account's phones can leave jobs for this PC (the database checks that).
"""
import socket
import threading
import time
import uuid

SLOW = 8  # seconds between hellos while no phone looks
FAST = 1.5  # while your phone looks

_started = False
_handlers = {}  # kind -> function(data) -> short text for the phone


def start(on_link):
    """on_link(url, fmt) starts a download and returns what to tell the phone."""
    global _started
    if _started:
        return
    _started = True
    _handlers["link"] = lambda d: on_link(d.get("url"), d.get("fmt"))
    _handlers["game"] = _game
    _handlers["obs"] = _obs
    threading.Thread(target=_loop, daemon=True, name="phone-link").start()


def _pc_id():
    import settings

    saved = settings.load().get("phone_pc_id")
    try:
        return str(uuid.UUID(str(saved)))
    except (ValueError, TypeError):
        new = str(uuid.uuid4())
        settings.save(phone_pc_id=new)
        return new


def _game(data):
    import games

    result = games.games.add(str(data.get("url") or "")[:500], str(data.get("note") or "")[:300])
    if result.get("added"):
        return "Added " + (result["added"][0].get("info") or {}).get("name", "the game")
    if result.get("already"):
        return "Already on the list"
    return "Couldn't add it"


def _obs(data):
    import obsctl

    obsctl.state()  # (connects if it isn't yet)
    for _ in range(20):
        if obsctl._conn and obsctl._conn.alive and obsctl._state.get("connected"):
            break
        time.sleep(0.25)
    obsctl.do(str(data.get("action") or ""), data)
    return "Done"


def _obs_status():
    import obsctl
    import settings

    if not settings.load().get("lv_obs_on", True):
        return {"connected": False, "error": "OBS is turned off in the Live page's Set up."}
    s = obsctl.state()
    return {"connected": bool(s.get("connected")), "error": s.get("error") or "", "scene": s.get("scene") or "",
            "scenes": (s.get("scenes") or [])[:40], "stream": bool(s.get("stream")), "record": bool(s.get("record")),
            "recordPaused": bool(s.get("recordPaused")), "replay": s.get("replay"),
            "inputs": [{"name": i["name"], "muted": bool(i.get("muted"))} for i in (s.get("inputs") or [])[:20]]}


def _run(task, pc):
    import sfx

    fn = _handlers.get(task.get("kind"))
    try:
        if not fn:
            raise ValueError("This PC doesn't know that yet. Update VaultHub.")
        data = task.get("data") if isinstance(task.get("data"), dict) else {}
        ok, result = True, str(fn(data) or "Done")
    except Exception as e:  # noqa: BLE001 (tell the phone what went wrong)
        ok, result = False, str(e) or "Something went wrong."
    try:
        sfx._rpc("lelons_pc", token=sfx.settings.load().get("library_token") or "", what="done", pc=pc,
                 task=task.get("id"), data={"ok": ok, "result": result[:300]})
    except Exception:  # noqa: BLE001
        pass


def _loop():
    import sfx
    import version

    time.sleep(10)
    watch = False
    while True:
        wait = SLOW
        try:
            token = sfx.settings.load().get("library_token") if sfx.configured() else ""
            if token:
                pc = _pc_id()
                status = {"app": version.VERSION}
                if watch:
                    status["obs"] = _obs_status()
                answer = sfx._rpc("lelons_pc", token=token, what="hello", pc=pc,
                                  data={"name": socket.gethostname()[:40] or "PC", "status": status}) or {}
                watch = bool(answer.get("watch"))
                for task in answer.get("tasks") or []:
                    threading.Thread(target=_run, args=(task, pc), daemon=True).start()
                if watch or answer.get("tasks"):
                    wait = FAST
        except Exception:  # noqa: BLE001 (no internet, logged out, old database...)
            wait = 30
        time.sleep(wait)
