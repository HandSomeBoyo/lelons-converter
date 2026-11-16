"""Twitch for the Live console: chat, viewers, followers, subs, raids and bits.

- Chat is read over Twitch's chat server (IRC), which works with no key at all. Subs, gifted subs,
  raids and bits come through the chat too.
- With a free Twitch "developer app" (dev.twitch.tv, the Live tab's guide) you sign in once. Then
  the app can also write in chat, see new followers, the exact viewer count, and remove messages.
  The sign-in uses Twitch's "device code" way: you type a short code on twitch.tv/activate, so no
  secret is needed and nothing has to listen for a reply.
- Without signing in, the viewer count comes from yt-dlp (the same free way Stream alerts use).
"""

import calendar
import json
import random
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import settings

IRC = ("irc.chat.twitch.tv", 6697)
HELIX = "https://api.twitch.tv/helix/"
ID = "https://id.twitch.tv/oauth2/"
SCOPES = ("chat:read chat:edit moderator:read:followers moderator:manage:chat_messages "
          "moderator:manage:banned_users channel:read:subscriptions bits:read channel:manage:broadcast")
LOOK_EVERY = 30  # seconds between looks at viewers and followers


class Error(Exception):
    pass


class SignedOut(Error):
    pass


def name_of(text):
    """A Twitch link or name as the plain lowercase name ("" if it isn't one)."""
    text = str(text or "").strip()
    m = re.match(r"^(?:https?://)?(?:www\.|m\.)?twitch\.tv/([A-Za-z0-9_]{1,25})", text)
    name = m.group(1) if m else text.lstrip("@")
    return name.lower() if re.fullmatch(r"[A-Za-z0-9_]{1,25}", name) else ""


# ---------------------------------------------------------------- the chat lines

def _unescape(value):
    return (value.replace("\\s", " ").replace("\\:", ";").replace("\\\\", "\\").replace("\\r", "\r").replace("\\n", "\n"))


def parse(line):
    """One IRC line as (tags, prefix, command, params). The last param keeps its spaces."""
    tags = {}
    if line.startswith("@"):
        raw, _, line = line[1:].partition(" ")
        for part in raw.split(";"):
            k, _, v = part.partition("=")
            tags[k] = _unescape(v)
    prefix = ""
    if line.startswith(":"):
        prefix, _, line = line[1:].partition(" ")
    head, sep, last = line.partition(" :")
    params = head.split()
    command = params.pop(0) if params else ""
    if sep:
        params.append(last)
    return tags, prefix, command, params


def _parts(text, emotes):
    """The message as pieces: text, and Twitch emotes as pictures (tag: "25:0-4,12-16/1902:6-10")."""
    spots = []
    for group in (emotes or "").split("/"):
        eid, _, places = group.partition(":")
        for place in places.split(","):
            a, _, b = place.partition("-")
            if eid and a.isdigit() and b.isdigit():
                spots.append((int(a), int(b), eid))
    if not spots:
        return [{"t": text}]
    spots.sort()
    chars = list(text)  # Twitch counts by characters (code points), as Python does
    out, at = [], 0
    for a, b, eid in spots:
        if a < at or b >= len(chars):
            continue
        if a > at:
            out.append({"t": "".join(chars[at:a])})
        out.append({"e": "https://static-cdn.jtvnw.net/emoticons/v2/" + eid + "/default/dark/2.0", "t": "".join(chars[a:b + 1])})
        at = b + 1
    if at < len(chars):
        out.append({"t": "".join(chars[at:])})
    return out


def _badges(tags):
    have = {b.partition("/")[0] for b in (tags.get("badges") or "").split(",") if b}
    out = []
    for key, name in (("broadcaster", "host"), ("moderator", "mod"), ("vip", "vip"), ("subscriber", "sub"), ("founder", "sub")):
        if key in have and name not in out:
            out.append(name)
    return out


def to_item(line, own_login=""):
    """A chat line as something for the console (a message, an event, a removal), or None."""
    tags, prefix, command, params = parse(line)
    channel_text = params[1] if len(params) > 1 else ""
    at = int(tags.get("tmi-sent-ts") or time.time() * 1000) / 1000
    who = tags.get("display-name") or prefix.partition("!")[0]
    login = tags.get("login") or prefix.partition("!")[0]
    if command == "PRIVMSG":
        text = channel_text
        action = text.startswith("\x01ACTION ") and text.endswith("\x01")
        if action:
            text = text[8:-1]
        msg = {"type": "msg", "p": "tw", "id": tags.get("id") or f"tw{at}{random.random()}", "user": who, "login": login,
               "userId": tags.get("user-id") or "", "color": tags.get("color") or "", "badges": _badges(tags),
               "text": text, "parts": _parts(text, tags.get("emotes")), "at": at, "me": bool(action),
               "first": tags.get("first-msg") == "1"}
        bits = int(tags.get("bits") or 0)
        if bits:
            return [msg, {"type": "event", "kind": "bits", "p": "tw", "id": "b" + msg["id"], "user": who, "amount": bits,
                          "text": text, "at": at}]
        return [msg]
    if command == "USERNOTICE":
        kind = tags.get("msg-id") or ""
        base = {"type": "event", "p": "tw", "id": tags.get("id") or f"tw{at}", "user": who, "at": at, "text": channel_text}
        if kind in ("sub", "resub"):
            return [{**base, "kind": "sub", "months": int(tags.get("msg-param-cumulative-months") or 1),
                     "tier": (tags.get("msg-param-sub-plan") or "1000")}]
        if kind == "subgift":
            return [{**base, "kind": "gift", "to": tags.get("msg-param-recipient-display-name") or "", "amount": 1}]
        if kind == "submysterygift":
            return [{**base, "kind": "gift", "amount": int(tags.get("msg-param-mass-gift-count") or 1)}]
        if kind == "raid":
            return [{**base, "kind": "raid", "user": tags.get("msg-param-displayName") or who,
                     "amount": int(tags.get("msg-param-viewerCount") or 0)}]
        if kind in ("announcement",) and channel_text:
            return [{"type": "msg", "p": "tw", "id": base["id"], "user": who, "login": login, "color": tags.get("color") or "",
                     "badges": _badges(tags), "text": channel_text, "parts": _parts(channel_text, tags.get("emotes")),
                     "at": at, "announce": True}]
        return []
    if command == "CLEARMSG":
        return [{"type": "remove", "p": "tw", "id": tags.get("target-msg-id") or ""}]
    if command == "CLEARCHAT" and len(params) > 1:
        return [{"type": "remove", "p": "tw", "login": params[1].lower()}]
    return []


# ---------------------------------------------------------------- Twitch's web API

def _http(url, data=None, token=None, client=None, method=None, body=None):
    if body is not None:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method=method or "POST")
        req.add_header("Content-Type", "application/json")
    else:
        req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data is not None else None, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if client:
        req.add_header("Client-Id", client)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8")
            return json.loads(text) if text.strip() else {}
    except urllib.error.HTTPError as e:
        try:
            info = json.loads(e.read().decode("utf-8") or "{}")
        except ValueError:
            info = {}
        message = info.get("message") or ""
        if message == "authorization_pending" or message == "slow_down":
            raise Error("pending")
        if e.code == 401 or message in ("Invalid refresh token", "invalid device code"):
            raise SignedOut("Twitch signed the app out. Sign in again on the Live tab.")
        raise Error(message or f"Twitch said no ({e.code}).")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Error("Can't reach Twitch. Check your internet.")


class Twitch:
    def __init__(self, emit):
        self.emit = emit  # emit(list of items)
        self.lock = threading.Lock()
        self.channel = ""
        self.sock = None
        self.thread = None
        self.looker = None
        self.stop = threading.Event()
        self.status = {"chat": "off", "live": False, "viewers": None, "title": "", "game": "", "started": None,
                       "followers": None, "error": "", "signedIn": False, "login": ""}
        self.access = {"token": "", "until": 0}
        self.device = None  # the sign-in waiting for the code to be typed
        self.seen_follows = set()
        self.user_id = ""
        self.me_id = ""

    # ---- setup

    def config(self):
        s = settings.load()
        return {"channel": name_of(s.get("lv_twitch")), "client": s.get("lv_tw_client") or "",
                "refresh": s.get("lv_tw_refresh") or "", "login": s.get("lv_tw_login") or ""}

    def start(self):
        """Connect to the channel's chat (again, if the channel or the sign-in changed)."""
        c = self.config()
        with self.lock:
            same = self.channel == c["channel"] and self.thread and self.thread.is_alive()
            if same:
                return
            self.stop_now()
            self.channel = c["channel"]
            self.stop = threading.Event()
            self.status.update(chat="off", live=False, viewers=None, followers=None, error="",
                               signedIn=bool(c["refresh"] and c["client"]), login=c["login"])
            self.seen_follows.clear()
            self.user_id = ""
            if not self.channel:
                return
            self.thread = threading.Thread(target=self._chat_loop, args=(self.stop,), daemon=True)
            self.thread.start()
            self.looker = threading.Thread(target=self._look_loop, args=(self.stop,), daemon=True)
            self.looker.start()

    def stop_now(self):
        self.stop.set()
        sock, self.sock = self.sock, None
        if sock:
            try:
                sock.close()
            except OSError:
                pass

    def restart(self):
        with self.lock:
            self.channel = ""
        self.start()

    # ---- sign in (device code)

    def begin_sign_in(self, client_id):
        client_id = str(client_id or "").strip()
        if not re.fullmatch(r"[a-z0-9]{20,40}", client_id):
            raise Error("That Client ID doesn't look right. It's about 30 letters and numbers, from dev.twitch.tv.")
        r = _http(ID + "device", {"client_id": client_id, "scopes": SCOPES})
        self.device = {"client": client_id, "code": r["device_code"], "every": int(r.get("interval") or 5),
                       "until": time.time() + int(r.get("expires_in") or 1800), "next": 0}
        settings.save(lv_tw_client=client_id)
        return {"userCode": r.get("user_code"), "url": r.get("verification_uri") or "https://www.twitch.tv/activate"}

    def check_sign_in(self):
        """Has the code been typed on twitch.tv/activate yet? True once signed in."""
        d = self.device
        if not d:
            return False
        if time.time() > d["until"]:
            self.device = None
            raise Error("The code ran out. Press Sign in again.")
        if time.time() < d["next"]:
            return False
        d["next"] = time.time() + d["every"]
        try:
            r = _http(ID + "token", {"client_id": d["client"], "scopes": SCOPES, "device_code": d["code"],
                                     "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})
        except Error as e:
            if str(e) == "pending":
                return False
            raise
        self.device = None
        self.access.update(token=r["access_token"], until=time.time() + int(r.get("expires_in") or 3600) - 60)
        who = _http(ID + "validate", token=r["access_token"])
        settings.save(lv_tw_refresh=r.get("refresh_token") or "", lv_tw_login=who.get("login") or "")
        self.me_id = who.get("user_id") or ""
        self.restart()
        return True

    def sign_out(self):
        settings.save(lv_tw_refresh="", lv_tw_login="")
        self.access.update(token="", until=0)
        self.restart()

    def token(self):
        if self.access["token"] and time.time() < self.access["until"]:
            return self.access["token"]
        c = self.config()
        if not (c["client"] and c["refresh"]):
            return ""
        try:
            r = _http(ID + "token", {"client_id": c["client"], "grant_type": "refresh_token", "refresh_token": c["refresh"]})
        except SignedOut:
            settings.save(lv_tw_refresh="")
            self.status["signedIn"] = False
            raise
        self.access.update(token=r["access_token"], until=time.time() + int(r.get("expires_in") or 3600) - 60)
        if r.get("refresh_token"):
            settings.save(lv_tw_refresh=r["refresh_token"])
        return self.access["token"]

    def _helix(self, path, method=None, body=None, **query):
        c = self.config()
        tok = self.token()
        if not tok:
            raise Error("Sign in to Twitch first.")
        url = HELIX + path + ("?" + urllib.parse.urlencode(query) if query else "")
        return _http(url, token=tok, client=c["client"], method=method, body=body)

    def _ids(self):
        if not self.user_id:
            data = self._helix("users", login=self.channel).get("data") or []
            self.user_id = data[0]["id"] if data else ""
        if not self.me_id:
            self.me_id = (_http(ID + "validate", token=self.token()) or {}).get("user_id") or ""
        return self.user_id, self.me_id

    # ---- title and game (2.34.0)

    def info(self):
        """The channel's title and game as they are set now (live or not)."""
        broadcaster, _ = self._ids()
        d = (self._helix("channels", broadcaster_id=broadcaster).get("data") or [{}])[0]
        art = ""
        if d.get("game_id"):
            g = (self._helix("games", id=d["game_id"]).get("data") or [{}])[0]
            art = (g.get("box_art_url") or "").replace("{width}", "104").replace("{height}", "144")
        info = {"title": d.get("title") or "", "game": d.get("game_name") or "", "gameId": d.get("game_id") or "",
                "art": art, "tags": list(d.get("tags") or [])}
        self.status["info"] = info
        return info

    def games(self, query):
        """Twitch categories (games) that match what was typed."""
        query = str(query or "").strip()[:100]
        if not query:
            return []
        data = self._helix("search/categories", query=query, first=8).get("data") or []
        return [{"id": g.get("id") or "", "name": g.get("name") or "",
                 "art": (g.get("box_art_url") or "").replace("52x72", "104x144")} for g in data if g.get("id")]

    def set_info(self, title=None, game_id=None, tags=None):
        c = self.config()
        if c["login"] and c["login"] != self.channel:
            raise Error(f"You're signed in as {c['login']}, but the console shows {self.channel}. Only the channel's owner can change its title.")
        body = {}
        if title is not None:
            title = re.sub(r"\s+", " ", str(title)).strip()
            if not title:
                raise Error("The title can't be empty.")
            body["title"] = title[:140]
        if game_id is not None:
            if not re.fullmatch(r"\d{1,20}", str(game_id)):
                raise Error("Pick a game from the list.")
            body["game_id"] = str(game_id)
        if tags is not None:
            clean = []
            for t in list(tags)[:10]:
                t = re.sub(r"[^\w]", "", str(t), flags=re.UNICODE)[:25]
                if t and t.lower() not in [x.lower() for x in clean]:
                    clean.append(t)
            body["tags"] = clean
        if not body:
            return self.info()
        broadcaster, _ = self._ids()
        try:
            self._helix("channels", method="PATCH", body=body, broadcaster_id=broadcaster)
        except Error as e:
            if "scope" in str(e).lower() or isinstance(e, SignedOut):
                raise Error("Sign in to Twitch again (Set up > Twitch) so the app may change your title and game.")
            raise
        return self.info()

    # ---- the chat

    def _chat_loop(self, stop):
        wait = 2
        while not stop.is_set():
            c = self.config()
            try:
                tok = self.token() if c["refresh"] else ""
            except Error:
                tok = ""
            try:
                raw = socket.create_connection(IRC, timeout=15)
                sock = ssl.create_default_context().wrap_socket(raw, server_hostname=IRC[0])
                sock.settimeout(360)
                self.sock = sock
                if tok and c["login"]:
                    sock.sendall(f"PASS oauth:{tok}\r\nNICK {c['login']}\r\n".encode())
                else:
                    sock.sendall(f"NICK justinfan{random.randint(10000, 99999)}\r\n".encode())
                sock.sendall(b"CAP REQ :twitch.tv/tags twitch.tv/commands\r\n")
                sock.sendall(f"JOIN #{self.channel}\r\n".encode())
                self.status.update(chat="on", error="")
                wait = 2
                buf = b""
                while not stop.is_set():
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
                    while b"\r\n" in buf:
                        line, buf = buf.split(b"\r\n", 1)
                        text = line.decode("utf-8", "replace")
                        if text.startswith("PING"):
                            sock.sendall(("PONG" + text[4:] + "\r\n").encode())
                            continue
                        _, _, command, params = parse(text)
                        if command == "RECONNECT":
                            raise OSError("reconnect")
                        if command == "NOTICE" and params and "authentication failed" in params[-1].lower():
                            self.access.update(token="", until=0)
                            raise OSError("auth")
                        items = to_item(text)
                        if items:
                            self.emit(items)
            except (OSError, ssl.SSLError):
                pass
            self.status["chat"] = "off" if stop.is_set() else "reconnecting"
            stop.wait(wait)
            wait = min(wait * 2, 60)

    def send(self, text):
        c = self.config()
        sock = self.sock
        if not (c["refresh"] and c["login"]):
            raise Error("Sign in to Twitch to write in chat.")
        if not sock:
            raise Error("Twitch chat isn't connected right now.")
        text = re.sub(r"[\r\n]+", " ", str(text or "")).strip()[:500]
        if not text:
            return None
        sock.sendall(f"PRIVMSG #{self.channel} :{text}\r\n".encode())
        # Twitch doesn't send your own message back, so it's added here.
        item = {"type": "msg", "p": "tw", "id": f"own{time.time()}", "user": c["login"], "login": c["login"],
                "color": "", "badges": ["host"] if c["login"] == self.channel else [], "text": text,
                "parts": [{"t": text}], "at": time.time(), "own": True}
        self.emit([item])
        return item

    def moderate(self, action, message_id="", user_id="", login=""):
        broadcaster, me = self._ids()
        if action == "delete":
            self._helix("moderation/chat", method="DELETE", broadcaster_id=broadcaster, moderator_id=me, message_id=message_id)
            return
        if not user_id and login:
            data = self._helix("users", login=login).get("data") or []
            user_id = data[0]["id"] if data else ""
        if not user_id:
            raise Error("Couldn't find that person on Twitch.")
        ban = {"user_id": user_id, "reason": "From VaultHub"}
        if action == "timeout":
            ban["duration"] = 600
        self._helix("moderation/bans", body={"data": ban}, broadcaster_id=broadcaster, moderator_id=me)

    # ---- viewers and followers

    def _look_loop(self, stop):
        first = True
        while not stop.is_set():
            try:
                if self.config()["refresh"]:
                    self._look_signed_in(first)
                else:
                    self._look_public()
                first = False
            except SignedOut as e:
                self.status["error"] = str(e)
            except Error as e:
                self.status["error"] = str(e)
            except Exception:  # noqa: BLE001 (a site changed...)
                pass
            stop.wait(LOOK_EVERY)

    def _look_public(self):
        import live
        info = live._twitch(self.channel)
        self.status.update(live=bool(info), viewers=(info or {}).get("viewers"), title=(info or {}).get("title") or "",
                           started=(info or {}).get("started"), error="")

    def _look_signed_in(self, first):
        broadcaster, me = self._ids()
        data = (self._helix("streams", user_id=broadcaster).get("data") or [None])[0]
        started = None
        if data and data.get("started_at"):
            try:
                started = calendar.timegm(time.strptime(data["started_at"], "%Y-%m-%dT%H:%M:%SZ"))
            except ValueError:
                started = None
        self.status.update(live=bool(data), viewers=(data or {}).get("viewer_count"), title=(data or {}).get("title") or "",
                           game=(data or {}).get("game_name") or "", started=started, error="")
        follows = self._helix("channels/followers", broadcaster_id=broadcaster, first=20)
        self.status["followers"] = follows.get("total")
        new = []
        for f in follows.get("data") or []:
            if f.get("user_id") in self.seen_follows:
                continue
            self.seen_follows.add(f.get("user_id"))
            if not first:
                new.append({"type": "event", "kind": "follow", "p": "tw", "id": "f" + f.get("user_id", ""),
                            "user": f.get("user_name") or f.get("user_login") or "", "at": time.time()})
        if new:
            self.emit(new)
