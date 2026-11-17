"""Auto-posts in your servers about your own channel: a new video, going live, and subscriber milestones.

Your own app looks at your own YouTube and Twitch (the ones on your profile) every few minutes, but only
while a server you're in wants one of these posts. The database posts each thing once (by its key).
"""
import threading
import time

TICK = 120  # seconds between looks (the channel and live caches have their own timers)
NEW_VIDEO = 12 * 3600  # a video newer than this counts as new

_started = False


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="server-autoposts").start()


def _loop():
    time.sleep(30)
    while True:
        try:
            _once()
        except Exception:  # noqa: BLE001 (no internet, logged out, a site changed...)
            pass
        time.sleep(TICK)


def _once():
    import home
    import live
    import sfx

    import settings

    if not sfx.configured() or not settings.load().get("library_token"):
        return
    watch = set(sfx.library.server("list").get("list", {}).get("watch") or [])
    if not watch:
        return
    me = sfx.library.my_profile()
    youtube = home.normalize(me.get("youtube")) if me.get("youtube") else ""
    twitch = live.twitch_name(me.get("twitch")) or ""
    if youtube and watch & {"video", "milestone"}:
        info = (home.channel(youtube, stats=False) or {}).get("info") or {}
        if "video" in watch:
            now = time.time()
            for v in (info.get("videos") or [])[:3]:
                if v.get("when") and now - v["when"] < NEW_VIDEO:
                    sfx.library.server_event("video", v["id"], {"title": v.get("title") or "", "url": v.get("url") or "",
                                                                 "thumb": v.get("thumbnail") or "",
                                                                 "channel": info.get("name") or ""})
        if "milestone" in watch and info.get("subscribers"):
            sfx.library.server_event("milestone", "subs", {"subs": int(info["subscribers"])})
    if "live" in watch and (youtube or twitch):
        for s in live.live([{"username": me.get("username") or "", "youtube": youtube, "twitch": twitch}]).get("live") or []:
            key = f"{s.get('kind')}:{s.get('id') or s.get('started') or s.get('url')}"
            sfx.library.server_event("live", key, {"title": s.get("title") or "", "url": s.get("url") or "",
                                                   "thumb": s.get("thumbnail") or "",
                                                   "channel": s.get("channel") or s.get("kind") or ""})
