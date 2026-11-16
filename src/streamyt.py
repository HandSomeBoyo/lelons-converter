"""YouTube for the Live console: chat, Super Chats, members and viewers.

- Chat is read the way YouTube's own pop-out chat page reads it, with no key. That way it never
  uses up the free daily limit of your Google key (reading chat through the key would use it all
  up in about an hour).
- Writing in chat and timing people out use your Google sign-in from Channel stats / Comments
  (the "manage your YouTube account" permission the Comments tab asks for).
- Viewers come from your Google sign-in when there is one (exact and cheap), else from yt-dlp.
"""

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import settings

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
LOOK_EVERY = 60  # seconds between looks for the live stream and its viewers


class Error(Exception):
    pass


def _get(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("User-Agent", UA)
    req.add_header("Accept-Language", "en-US,en;q=0.8")
    req.add_header("Cookie", "SOCS=CAI; CONSENT=YES+1")  # skip the cookie question YouTube shows in Europe
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _text(value):
    if not value:
        return ""
    if "simpleText" in value:
        return value["simpleText"]
    return "".join(run.get("text") or "" for run in value.get("runs") or [])


def _parts(message):
    out = []
    for run in (message or {}).get("runs") or []:
        if "text" in run:
            out.append({"t": run["text"]})
        elif "emoji" in run:
            e = run["emoji"]
            thumbs = (e.get("image") or {}).get("thumbnails") or []
            label = (e.get("shortcuts") or [e.get("emojiId") or ""])[0]
            if e.get("isCustomEmoji") and thumbs:
                out.append({"e": thumbs[-1].get("url"), "t": label})
            else:
                out.append({"t": e.get("emojiId") if not e.get("isCustomEmoji") else label})
    return out


def _badges(renderer):
    out = []
    for b in renderer.get("authorBadges") or []:
        b = b.get("liveChatAuthorBadgeRenderer") or {}
        icon = (b.get("icon") or {}).get("iconType") or ""
        tip = (b.get("tooltip") or "").lower()
        if icon == "OWNER":
            out.append("host")
        elif icon == "MODERATOR":
            out.append("mod")
        elif b.get("customThumbnail") or tip.startswith("member") or "member" in tip:
            out.append("member")
    return out


def _amount(text):
    m = re.search(r"(\d[\d.,\s]*)", text or "")
    if not m:
        return 0
    n = re.sub(r"\s", "", m.group(1)).rstrip(".,")
    if "," in n and "." in n:  # the last one is the decimal point: 1.234,50 or 1,234.50
        n = n.replace(".", "").replace(",", ".") if n.rfind(",") > n.rfind(".") else n.replace(",", "")
    elif "," in n:  # 12,50 (decimal) or 1,250 (thousands)
        n = n.replace(",", ".") if len(n) - n.rfind(",") - 1 <= 2 else n.replace(",", "")
    elif n.count(".") > 1 or (len(n) - n.rfind(".") - 1 == 3 and len(n) > 4):
        n = n.replace(".", "")  # 1.250 (thousands)
    try:
        return float(n)
    except ValueError:
        return 0


def to_items(action, old=False):
    """One of YouTube's chat actions as items for the console."""
    add = (action.get("addChatItemAction") or {}).get("item") or {}
    if add:
        kind, r = next(iter(add.items()))
        at = int(r.get("timestampUsec") or time.time() * 1e6) / 1e6
        who = _text(r.get("authorName")) or ""
        base = {"p": "yt", "id": r.get("id") or f"yt{at}", "user": who.lstrip("@"), "channelId": r.get("authorExternalChannelId") or "",
                "at": at}
        if old:
            base["old"] = True
        if kind == "liveChatTextMessageRenderer":
            parts = _parts(r.get("message"))
            return [{**base, "type": "msg", "badges": _badges(r), "text": "".join(p["t"] for p in parts), "parts": parts}]
        if kind in ("liveChatPaidMessageRenderer", "liveChatPaidStickerRenderer"):
            money = _text(r.get("purchaseAmountText"))
            parts = _parts(r.get("message"))
            text = "".join(p["t"] for p in parts)
            items = [{**base, "type": "event", "kind": "superchat" if kind == "liveChatPaidMessageRenderer" else "sticker",
                      "money": money, "amount": _amount(money), "text": text}]
            return items
        if kind == "liveChatMembershipItemRenderer":
            head = _text(r.get("headerPrimaryText"))
            sub = _text(r.get("headerSubtext"))
            months = re.search(r"(\d+)\s*month", head or "")
            return [{**base, "type": "event", "kind": "member", "months": int(months.group(1)) if months else 1,
                     "text": _text(r.get("message")) or sub}]
        if kind == "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer":
            header = ((r.get("header") or {}).get("liveChatSponsorshipsHeaderRenderer") or {})
            text = _text(header.get("primaryText"))
            n = re.search(r"(\d+)", text)
            return [{**base, "user": _text(header.get("authorName")).lstrip("@") or who, "type": "event", "kind": "gift",
                     "amount": int(n.group(1)) if n else 1, "text": text}]
        return []
    gone = action.get("markChatItemAsDeletedAction")
    if gone:
        return [{"type": "remove", "p": "yt", "id": gone.get("targetItemId") or ""}]
    gone = action.get("markChatItemsByAuthorAsDeletedAction")
    if gone:
        return [{"type": "remove", "p": "yt", "channelId": gone.get("externalChannelId") or ""}]
    return []


def _continuation(holder):
    for c in holder.get("continuations") or []:
        for key in ("invalidationContinuationData", "timedContinuationData", "reloadContinuationData"):
            if key in c:
                return c[key].get("continuation"), int(c[key].get("timeoutMs") or 5000)
    return None, 5000


def _initial(page):
    m = re.search(r"(?:window\[\"ytInitialData\"\]|ytInitialData)\s*=\s*(\{.+?\});\s*</script>", page, re.S)
    if not m:
        raise Error("YouTube's chat page looked different than expected.")
    return json.loads(m.group(1))


class YouTube:
    def __init__(self, emit):
        self.emit = emit
        self.lock = threading.Lock()
        self.channel = ""
        self.video = ""
        self.stop = threading.Event()
        self.chat_thread = None
        self.looker = None
        self.status = {"chat": "off", "live": False, "viewers": None, "title": "", "started": None, "video": "",
                       "error": "", "canWrite": False}
        self.chat_id = ""

    def config(self):
        s = settings.load()
        import home
        return {"channel": home.normalize(s.get("lv_youtube") or "") or ""}

    def start(self):
        c = self.config()
        with self.lock:
            if self.channel == c["channel"] and self.looker and self.looker.is_alive():
                return
            self.stop.set()
            self.stop = threading.Event()
            self.channel, self.video, self.chat_id = c["channel"], "", ""
            self.status.update(chat="off", live=False, viewers=None, title="", started=None, video="", error="")
            if not self.channel:
                return
            self.looker = threading.Thread(target=self._look_loop, args=(self.stop,), daemon=True)
            self.looker.start()

    def restart(self):
        with self.lock:
            self.channel = ""
        self.start()

    # ---- is the channel live, and how many watch

    def _signed_in(self):
        try:
            import channelstats
            return bool(channelstats._config()["refresh"])
        except Exception:
            return False

    def _look_loop(self, stop):
        import live
        while not stop.is_set():
            try:
                info = live._youtube(self.channel)
                vid = (info or {}).get("id") or ""
                viewers = (info or {}).get("viewers")
                if vid and self._signed_in():
                    try:
                        import channelstats
                        item = (channelstats._get("videos", part="liveStreamingDetails", id=vid).get("items") or [{}])[0]
                        d = item.get("liveStreamingDetails") or {}
                        if d.get("concurrentViewers") is not None:
                            viewers = int(d["concurrentViewers"])
                        self.chat_id = d.get("activeLiveChatId") or self.chat_id
                    except Exception:
                        pass
                self.status.update(live=bool(info), viewers=viewers, title=(info or {}).get("title") or "",
                                   started=(info or {}).get("started"), video=vid, error="")
                if vid and vid != self.video:
                    self.video = vid
                    self.chat_thread = threading.Thread(target=self._chat_loop, args=(stop, vid), daemon=True)
                    self.chat_thread.start()
                elif not vid:
                    self.video = ""
            except Exception as e:  # noqa: BLE001
                self.status["error"] = "Couldn't look at your YouTube channel just now." if str(e) else ""
            self.status["canWrite"] = self.can_write()
            stop.wait(LOOK_EVERY if self.video else 45)

    # ---- the chat

    def _chat_loop(self, stop, vid):
        tries = 0
        while not stop.is_set() and self.video == vid:
            try:
                page = _get("https://www.youtube.com/live_chat?is_popout=1&v=" + vid)
                key = (re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', page) or [None, ""])[1]
                version = (re.search(r'"clientVersion":"([\d.]+)"', page) or [None, "2.20241101.00.00"])[1]
                data = _initial(page)
                chat = ((data.get("contents") or {}).get("liveChatRenderer")) or {}
                cont, wait = _continuation(chat)
                if not cont:
                    raise Error("no chat")
                for a in chat.get("actions") or []:
                    items = to_items(a, old=True)
                    if items:
                        self.emit(items)
                self.status["chat"] = "on"
                tries = 0
                url = "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false" + ("&key=" + key if key else "")
                while not stop.is_set() and self.video == vid and cont:
                    stop.wait(max(1.0, min(wait, 6000) / 1000))
                    if stop.is_set():
                        break
                    r = json.loads(_get(url, {"context": {"client": {"clientName": "WEB", "clientVersion": version, "hl": "en"}},
                                              "continuation": cont}))
                    live = (r.get("continuationContents") or {}).get("liveChatContinuation")
                    if not live:
                        cont = None
                        break
                    cont, wait = _continuation(live)
                    out = []
                    for a in live.get("actions") or []:
                        out.extend(to_items(a))
                    if out:
                        self.emit(out)
            except Exception:  # noqa: BLE001 (YouTube changed something, or the internet dropped)
                pass
            self.status["chat"] = "reconnecting" if not stop.is_set() else "off"
            tries += 1
            stop.wait(min(60, 3 * tries))
        if self.video != vid:
            self.status["chat"] = "off"

    # ---- writing and moderating (your Google sign-in)

    def can_write(self):
        try:
            import channelstats
            return bool(channelstats._config()["refresh"]) and channelstats.can_reply()
        except Exception:
            return False

    def _chat_id(self):
        import channelstats
        if not self.chat_id and self.video:
            item = (channelstats._get("videos", part="liveStreamingDetails", id=self.video).get("items") or [{}])[0]
            self.chat_id = (item.get("liveStreamingDetails") or {}).get("activeLiveChatId") or ""
        if not self.chat_id:
            raise Error("You don't seem to be live on YouTube right now.")
        return self.chat_id

    def send(self, text):
        import channelstats
        if not self.can_write():
            raise Error("To write in YouTube chat, sign in with Google on the Comments tab (it asks to manage your channel).")
        text = re.sub(r"[\r\n]+", " ", str(text or "")).strip()[:200]
        if not text:
            return None
        channelstats._http(channelstats.DATA_API + "liveChat/messages?part=snippet", token=channelstats._token(), body={
            "snippet": {"liveChatId": self._chat_id(), "type": "textMessageEvent", "textMessageDetails": {"messageText": text}}})
        return True  # (it comes back through the chat by itself)

    def moderate(self, action, channel_id):
        import channelstats
        if not self.can_write():
            raise Error("Sign in with Google on the Comments tab to time people out on YouTube.")
        if not channel_id:
            raise Error("Couldn't find that person on YouTube.")
        snippet = {"liveChatId": self._chat_id(), "type": "temporary" if action == "timeout" else "permanent",
                   "bannedUserDetails": {"channelId": channel_id}}
        if action == "timeout":
            snippet["banDurationSeconds"] = 600
        channelstats._http(channelstats.DATA_API + "liveChat/bans?part=snippet", token=channelstats._token(), body={"snippet": snippet})
