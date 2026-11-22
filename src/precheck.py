"""(3.1) The pre-stream check on the Live page: one button, a few seconds, and you know your stream is ready.

It looks at OBS (open, set to stream to Twitch), the scene you're on, your mic and desktop sound, your
Twitch title and game, the alerts in OBS, and your upload speed. Each thing comes back as good, warn
(works, but you may want to look) or bad (viewers would notice), with one plain line on how to fix it,
and a fix button when VaultHub can fix it for you.

Everything here only reads, except the fixes, which are the same buttons the console already has.
The mic test itself (say something, see the bar move) runs on the page with the OBS card's sound levels.
"""

import configparser
import glob
import json
import os
import re
import time

import obsctl
import settings
import streamlive
import streamoverlay
import streamtwitch

# Scenes you'd rather not start a stream on.
BREAK_SCENE = re.compile(r"\b(brb|be right back|break|pause[ds]?|ending|end screen|outro|offline|away|afk|intermission|bye)\b", re.I)


def _row(key, state, title, text, fix=None, **extra):
    return {"key": key, "state": state, "title": title, "text": text, "fix": fix, **extra}


def _ask(kind, data=None):
    try:
        return obsctl.ask_once(kind, data)
    except obsctl.Error:
        return None


def _connect(wait=4.0):
    """Wakes the console's OBS connection and waits a moment for it."""
    end = time.time() + wait
    st = obsctl.state()
    while not st.get("connected") and time.time() < end:
        time.sleep(0.25)
        st = obsctl.state()
    return st


def _items(scene, depth=0, seen=None, shown=True):
    """Everything in a scene, also inside scenes and groups put in it: [(name, shown, parent scene, item id)]."""
    seen = seen or set()
    seen.add(scene)
    out = []
    for it in (_ask("GetSceneItemList", {"sceneName": scene}) or {}).get("sceneItems") or []:
        name = it.get("sourceName") or ""
        on = shown and it.get("sceneItemEnabled", True) is not False
        out.append((name, on, scene, it.get("sceneItemId")))
        if depth < 3 and name not in seen:
            if it.get("isGroup"):
                for sub in (_ask("GetGroupSceneItemList", {"sceneName": name}) or {}).get("sceneItems") or []:
                    out.append((sub.get("sourceName") or "", on and sub.get("sceneItemEnabled", True) is not False, name, sub.get("sceneItemId")))
            elif it.get("sourceType") == "OBS_SOURCE_TYPE_SCENE":
                out += _items(name, depth + 1, seen, on)
    return out


# ---------------------------------------------------------------- the checks

def _check_obs(st):
    if not st.get("connected"):
        why = st.get("error") or "VaultHub can't reach OBS."
        tip = ("Open OBS. If it's open, go to Tools > WebSocket Server Settings and tick Enable WebSocket server."
               if "isn't open" in why or "can't reach" in why else why)
        return _row("obs", "bad", "OBS isn't connected", tip, "setup")
    live = (_ask("GetStreamStatus") or {}).get("outputActive")
    service = _ask("GetStreamServiceSettings") or {}
    kind, s = service.get("streamServiceType") or "", service.get("streamServiceSettings") or {}
    server, name = str(s.get("server") or ""), str(s.get("service") or "")
    import multistream
    if multistream._is_ours(service):
        where = "VaultHub multistream"
    elif kind == "rtmp_common":
        where = name or "a streaming site"
    else:
        where = "Twitch" if "twitch" in server.lower() else (server or "a custom server")
    if live:
        return _row("obs", "good", "OBS is streaming", f"You're already live, going to {where}.", live=True)
    if not s.get("key") and kind != "whip_custom" and where != "VaultHub multistream":
        return _row("obs", "bad", "OBS has no stream key",
                    "In OBS, open Settings > Stream, pick Twitch and press Connect Account (or paste your stream key).")
    if where not in ("Twitch", "VaultHub multistream"):
        return _row("obs", "warn", f"OBS streams to {where}",
                    "Streaming on Twitch? In OBS, open Settings > Stream and pick Twitch.")
    return _row("obs", "good", "OBS is ready", f"Open and set to stream to {where}.")


def _check_scene(st):
    scene, scenes = st.get("scene") or "", list(st.get("scenes") or [])
    if not scene:
        return _row("scene", "bad", "No scene in OBS", "Make a scene in OBS and add your game or screen to it.", scenes=scenes)
    items = _items(scene)
    if not any(on for _n, on, _p, _i in items):
        return _row("scene", "bad", f"“{scene}” is empty",
                    "Viewers would see a black screen. Add your game or screen to it in OBS, or pick another scene.",
                    "scene", scene=scene, scenes=scenes)
    if BREAK_SCENE.search(scene):
        return _row("scene", "warn", f"You're on “{scene}”",
                    "That's the first thing viewers will see. Pick the scene you want to start on.",
                    "scene", scene=scene, scenes=scenes)
    return _row("scene", "good", f"Starting on “{scene}”", "", "scene", scene=scene, scenes=scenes)


def _check_sound(st):
    inputs = {i["name"]: i for i in st.get("inputs") or []}
    special = _ask("GetSpecialInputs") or {}
    mic = obsctl.mic_prefs()["mic"]
    if mic not in inputs:
        mic = special.get("mic1") if special.get("mic1") in inputs else \
            next((n for n in inputs if re.search(r"mic|aux|headset|microphone|input", n, re.I)), "")
    desktop = special.get("desktop1") if special.get("desktop1") in inputs else \
        next((n for n in inputs if re.search(r"desktop|speaker|output", n, re.I)), "")
    extra = {"mic": mic, "desktop": desktop, "desktopMuted": bool(desktop and inputs[desktop]["muted"])}
    if not mic:
        return _row("sound", "bad", "OBS has no mic",
                    "In OBS, open Settings > Audio and pick your mic under Mic/Auxiliary Audio.", **extra)
    if mic not in special.values():  # (a mic added to one scene only counts when it's in the scene you're on)
        here = [on for n, on, _p, _i in _items(st.get("scene") or "") if n == mic]
        if not any(here):
            return _row("sound", "bad", f"Your mic isn't in “{st.get('scene')}”",
                        f"Viewers won't hear you. Add “{mic}” to this scene in OBS.", **extra)
    if inputs[mic]["muted"]:
        return _row("sound", "bad", "Your mic is muted", f"“{mic}” is muted in OBS.", "unmute", input=mic, **extra)
    if extra["desktopMuted"]:
        return _row("sound", "warn", "Game sound is muted", f"“{desktop}” is muted in OBS, so viewers won't hear your game.",
                    "unmute", input=desktop, **extra)
    # (good so far: the page now listens for a few seconds and changes it to good or warn)
    return _row("sound", "listen", "Say something", f"Listening to “{mic}”...", **extra)


def _check_twitch():
    c = streamlive.config()
    if not c["twitch"]:
        return _row("twitch", "warn", "Twitch isn't set up", "Type your Twitch name in Set up to check your title and game.", "setup")
    if not c["twitchSignedIn"]:
        return _row("twitch", "warn", "Sign in to Twitch", "Then VaultHub can check your title and game.", "setup")
    try:
        info = streamlive.twitch().info()
    except streamtwitch.Error as e:
        return _row("twitch", "warn", "Couldn't check Twitch", str(e))
    except (OSError, ValueError):
        return _row("twitch", "warn", "Couldn't check Twitch", "Is your internet on?")
    title, game = info.get("title") or "", info.get("game") or ""
    if not title.strip():
        return _row("twitch", "bad", "Your stream has no title", "Give it one so people know what you're doing.", "title", info=info)
    if not game:
        return _row("twitch", "bad", "No game picked", "Pick a game so people browsing it can find you.", "title", info=info)
    past = streamlive.streams()
    if past and past[0].get("title") == title and not (time.time() - (past[0].get("end") or 0) < 3600):
        return _row("twitch", "warn", "Same title as last time", f"“{title}” · {game}", "title", info=info)
    return _row("twitch", "good", title, game, "title", info=info)


def _check_alerts(st):
    src = streamoverlay.SOURCE
    names = [i.get("inputName") for i in (_ask("GetInputList") or {}).get("inputs") or []]
    if src not in names:
        return _row("alerts", "warn", "Alerts aren't in OBS", "Add them and follows, subs and raids pop up on your stream.", "alerts")
    scene = st.get("scene") or ""
    here = [x for x in _items(scene) if x[0] == src]
    if not here:
        return _row("alerts", "warn", f"Alerts aren't in “{scene}”", "Add them to every scene with one click.", "alerts")
    if not any(on for _n, on, _p, _i in here):
        _n, _on, parent, item = here[0]
        return _row("alerts", "warn", "Alerts are hidden in OBS", "The eye next to “VaultHub alerts” is off.", "show",
                    scene=parent, item=item)
    look = (_ask("GetInputSettings", {"inputName": src}) or {}).get("inputSettings") or {}
    if look.get("url") and look.get("url") != streamoverlay.url():
        return _row("alerts", "warn", "Alerts point to an old address", "One click fixes it.", "alerts")
    if not streamoverlay.status()["watching"]:
        return _row("alerts", "warn", "OBS isn't loading the alerts", "Reloading them in OBS usually fixes it.", "reload")
    return _row("alerts", "good", "Alerts are on your stream", "", "test")


def run():
    """Everything but the mic test and the upload speed (those take a few seconds, the page asks for them next)."""
    out = []
    s = settings.load()
    if not s.get("lv_obs_on", True):
        out.append(_row("obs", "bad", "OBS is turned off here", "Turn OBS on in the Live console's Set up.", "setup"))
        st = {"connected": False}
    else:
        st = _connect()
        out.append(_check_obs(st))
    if st.get("connected"):
        out += [_check_scene(st), _check_sound(st)]
    out.append(_check_twitch())
    if st.get("connected"):
        out.append(_check_alerts(st))
    return {"checks": out, "live": bool(out and out[0].get("live")), "at": time.time()}


# ---------------------------------------------------------------- the upload speed

def _profile_dir(name):
    root = os.path.join(os.environ.get("APPDATA") or "", "obs-studio", "basic", "profiles")
    for ini in glob.glob(os.path.join(root, "*", "basic.ini")):
        p = configparser.ConfigParser(strict=False, interpolation=None)
        try:
            p.read(ini, encoding="utf-8-sig")
        except (configparser.Error, OSError, UnicodeError):
            continue
        if p.get("General", "Name", fallback="") == name:
            return os.path.dirname(ini)
    return ""


def bitrate():
    """What OBS sends, in kbps (video + sound), or 0 when we can't tell."""
    def param(cat, key):
        d = _ask("GetProfileParameter", {"parameterCategory": cat, "parameterName": key}) or {}
        v = d.get("parameterValue") or d.get("defaultParameterValue")
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0
    mode = (_ask("GetProfileParameter", {"parameterCategory": "Output", "parameterName": "Mode"}) or {}).get("parameterValue") or "Simple"
    if mode == "Simple":
        video = param("SimpleOutput", "VBitrate")
        return video + (param("SimpleOutput", "ABitrate") or 160) if video else 0
    name = (_ask("GetProfileList") or {}).get("currentProfileName") or ""
    folder = _profile_dir(name) if name else ""
    try:
        with open(os.path.join(folder, "streamEncoder.json"), encoding="utf-8") as f:
            video = int(json.load(f).get("bitrate") or 2500)
    except (OSError, ValueError, TypeError, AttributeError):
        return 0
    return video + 160


def net():
    """Is the upload fast enough for what OBS sends? (While you're live, OBS's own numbers say it, no test.)"""
    import multistream
    import obsstats
    live = obsstats.state()
    if live.get("streaming"):
        pct = live.get("droppedPct") or 0
        if pct >= 1:
            return _row("net", "bad", "Your internet is dropping frames", f"{pct:.1f}% of frames don't reach viewers. Lower the bitrate in OBS > Settings > Output.")
        return _row("net", "good", "Your internet keeps up", f"Sending {live.get('bitrate') or 0:,} kbps with no dropped frames.")
    need = bitrate()
    try:
        mbps = multistream.speed_test(5)["mbps"]
    except multistream.Error as e:
        return _row("net", "warn", "Couldn't test your internet", str(e), "net")
    have = int(mbps * 1000)
    need_text = f"{need / 1000:.1f} Mbps" if need else "about 6 Mbps"
    want = need or 6160
    extra = {"mbps": mbps, "need": need}
    if have >= want * 1.5:
        return _row("net", "good", f"Upload {mbps:g} Mbps", f"Plenty for your stream ({need_text}).", "net", **extra)
    suggest = max(1000, int((have * 0.75 - 160) / 500) * 500)
    lower = f"lower Video Bitrate in OBS (Settings > Output) to {suggest:,}"
    if have >= want * 1.1:
        return _row("net", "warn", f"Upload {mbps:g} Mbps, a bit tight",
                    f"Your stream needs {need_text}. Pause downloads, or {lower}.", "net", **extra)
    return _row("net", "bad", f"Upload {mbps:g} Mbps is too slow",
                f"Your stream needs {need_text}. Use a cable instead of Wi-Fi, or {lower}.", "net", **extra)


# ---------------------------------------------------------------- fixes

def fix(what, data):
    if what == "unmute":
        obsctl.do("mute", {"input": str(data.get("input") or ""), "muted": False})
    elif what == "scene":
        obsctl.do("scene", {"scene": str(data.get("scene") or "")})
    elif what == "alerts":
        streamoverlay.add_to_obs()
    elif what == "show":
        obsctl.ask_once("SetSceneItemEnabled", {"sceneName": str(data.get("scene") or ""), "sceneItemId": int(data.get("item") or 0),
                                               "sceneItemEnabled": True})
    elif what == "reload":
        obsctl.ask_once("PressInputPropertiesButton", {"inputName": streamoverlay.SOURCE, "propertyName": "refreshnocache"})
    elif what == "test":
        streamoverlay.test("follow")
    else:
        raise obsctl.Error("Unknown fix.")
    return run()
