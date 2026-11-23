"""(3.2.0) MyVault: your passwords, 2FA codes and notes, locked with a PIN, only on this PC.

How it's locked
- A random 32-byte vault key locks everything. Your PIN (through scrypt, slow on purpose) locks that key,
  so changing the PIN only locks the key again.
- The locking itself is HMAC-SHA256 used as a stream cipher, with a separate HMAC-SHA256 seal over it, so
  a changed or broken file is noticed instead of read wrong. (Python has no AES built in; this is a
  well-known safe construction made only from what Python has.)
- On Windows the whole file is then locked again with DPAPI (settings.lock_secret): a copy of the file
  can't even be tried on another PC or Windows account.
- Wrong PINs: after 5, you wait a minute, then longer each time (kept in settings).
- Nothing ever leaves the PC. A backup file is locked with its own backup password (not the PIN, which is
  only 6 numbers and fine only together with DPAPI).

The page never gets passwords in the list; it asks for one when you press show or copy. Copying goes
through here so the clipboard can be cleared again (and kept out of Windows' clipboard history).

The login pop-up (watch_* below): while it's on, a small thread looks at the window you're in. When it's a
login window of an app it knows (Steam, Epic, Battle.net...) or a browser on a site you saved, it shows a
small VaultHub bubble (appwindow.bubble, ui/myvault-bubble.html). Fill types your username and password
into that window (SendInput), like you would.
"""
import base64
import ctypes
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import struct
import threading
import time
import urllib.parse
import urllib.request

import settings

IS_WINDOWS = os.name == "nt"
PATH = os.path.join(settings.DATA_DIR, "myvault.json")
KDF = {"n": 2 ** 15, "r": 8, "p": 1}
PIN_LEN = 6
MAX_ITEMS = 2000
KINDS = ("account", "codes", "note")

_lock = threading.RLock()
_s = {"key": None, "items": None, "salt": None, "kdf": None, "wrap": None, "last": 0.0}
_clip = {"value": None, "timer": None}


class Error(Exception):
    pass


# ---------------------------------------------------------------- locking

def _sub(key, label):
    return hmac.new(key, label, hashlib.sha256).digest()


def _stream(key, nonce, n):
    out, i = bytearray(), 0
    while len(out) < n:
        out += hmac.new(key, nonce + struct.pack(">Q", i), hashlib.sha256).digest()
        i += 1
    return bytes(out[:n])


def seal(key, plain, label=b"myvault"):
    """plain bytes -> nonce(24) + locked + tag(32)."""
    nonce = secrets.token_bytes(24)
    ek, mk = _sub(key, b"enc:" + label), _sub(key, b"mac:" + label)
    body = bytes(a ^ b for a, b in zip(plain, _stream(ek, nonce, len(plain))))
    return nonce + body + hmac.new(mk, nonce + body, hashlib.sha256).digest()


def unseal(key, blob, label=b"myvault"):
    if len(blob) < 56:
        raise Error("broken")
    nonce, body, tag = blob[:24], blob[24:-32], blob[-32:]
    ek, mk = _sub(key, b"enc:" + label), _sub(key, b"mac:" + label)
    if not hmac.compare_digest(tag, hmac.new(mk, nonce + body, hashlib.sha256).digest()):
        raise Error("wrong key")
    return bytes(a ^ b for a, b in zip(body, _stream(ek, nonce, len(body))))


def _derive(secret, salt, kdf):
    return hashlib.scrypt(str(secret).encode(), salt=salt, n=int(kdf["n"]), r=int(kdf["r"]), p=int(kdf["p"]),
                          maxmem=128 * 1024 * 1024, dklen=32)


def _b64(b):
    return base64.b64encode(b).decode()


def _unb64(t):
    return base64.b64decode(t or "")


# ---------------------------------------------------------------- the file

def _read_file():
    try:
        with open(PATH, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return None
    except OSError:
        raise Error("Couldn't open MyVault's file.")
    if text.startswith(settings.LOCKED):
        text = settings.open_secret(text)
        if not text:
            raise Error("MyVault was made on another PC or Windows account, so it can't be opened here. Bring it over with a backup file instead.")
    try:
        data = json.loads(text)
    except ValueError:
        raise Error("MyVault's file is broken.")
    if not isinstance(data, dict) or data.get("v") != 1:
        raise Error("MyVault's file is broken.")
    return data


def _write_file(data):
    text = json.dumps(data, separators=(",", ":"))
    text = settings.lock_secret(text) if IS_WINDOWS else text
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, PATH)


def exists():
    return os.path.isfile(PATH)


def _save():
    """Write the open vault (call with _lock held)."""
    key = _s["key"]
    plain = json.dumps({"items": _s["items"]}, separators=(",", ":")).encode()
    _write_file({"v": 1, "salt": _b64(_s["salt"]), "kdf": _s["kdf"], "wrap": _s["wrap"],
                 "data": _b64(seal(key, plain, b"items"))})


# ---------------------------------------------------------------- PIN, wrong tries

def _check_pin(pin):
    pin = str(pin or "")
    if not re.fullmatch(r"\d{%d}" % PIN_LEN, pin):
        raise Error(f"Your PIN is {PIN_LEN} numbers.")
    return pin


def _wait_left():
    c = settings.load()
    return max(0, int(float(c.get("mv_wait_until") or 0) - time.time()))


def _wrong_try():
    c = settings.load()
    fails = int(c.get("mv_fails") or 0) + 1
    wait = 0
    if fails >= 5:
        wait = min(3600, 60 * 2 ** (fails - 5))
    settings.save(mv_fails=fails, mv_wait_until=time.time() + wait if wait else 0)
    return fails, wait


def _right_try():
    if settings.load().get("mv_fails"):
        settings.save(mv_fails=0, mv_wait_until=0)


def setup(pin):
    pin = _check_pin(pin)
    with _lock:
        if exists():
            raise Error("MyVault is already set up.")
        _s.update(key=secrets.token_bytes(32), items=[], salt=secrets.token_bytes(16), kdf=dict(KDF), last=time.time())
        _s["wrap"] = _b64(seal(_derive(pin, _s["salt"], _s["kdf"]), _s["key"], b"wrap"))
        _save()
    _right_try()
    return state()


def unlock(pin):
    pin = _check_pin(pin)
    left = _wait_left()
    if left:
        raise Error(f"Too many wrong tries. Wait {_nice_wait(left)}.")
    with _lock:
        data = _read_file()
        if data is None:
            raise Error("MyVault isn't set up yet.")
        salt = _unb64(data["salt"])
        try:
            key = unseal(_derive(pin, salt, data["kdf"]), _unb64(data["wrap"]), b"wrap")
        except Error:
            fails, wait = _wrong_try()
            if wait:
                raise Error(f"Wrong PIN. Wait {_nice_wait(wait)} before you try again.")
            raise Error(f"Wrong PIN. {5 - fails} {'try' if 5 - fails == 1 else 'tries'} left before it makes you wait.")
        items = json.loads(unseal(key, _unb64(data["data"]), b"items")).get("items") or []
        _s.update(key=key, items=[i for i in items if isinstance(i, dict)], salt=salt, kdf=data["kdf"],
                  wrap=data["wrap"], last=time.time())
    _right_try()
    return state()


def _nice_wait(s):
    return f"{s} seconds" if s < 90 else f"{round(s / 60)} minutes"


def lock():
    with _lock:
        _s.update(key=None, items=None, last=0.0)
    _clear_clipboard_now()
    watch_dismiss_all()


def is_open():
    return _s["key"] is not None


def _need_open():
    if not is_open():
        raise Error("MyVault is locked.")
    _s["last"] = time.time()


def change_pin(old, new):
    old, new = _check_pin(old), _check_pin(new)
    with _lock:
        _need_open()
        data = _read_file()
        try:
            unseal(_derive(old, _unb64(data["salt"]), data["kdf"]), _unb64(data["wrap"]), b"wrap")
        except Error:
            _wrong_try()
            raise Error("That isn't your PIN now.")
        _s["salt"], _s["kdf"] = secrets.token_bytes(16), dict(KDF)
        _s["wrap"] = _b64(seal(_derive(new, _s["salt"], _s["kdf"]), _s["key"], b"wrap"))
        _save()
    return {"ok": True}


def reset():
    """Forgot the PIN: everything goes (there's no other way in, on purpose)."""
    with _lock:
        lock()
        try:
            os.remove(PATH)
        except FileNotFoundError:
            pass
    settings.save(mv_fails=0, mv_wait_until=0)
    return state()


def touch():
    if is_open():
        _s["last"] = time.time()


def check_timeout():
    """Locks by itself after the time picked in MyVault settings."""
    if is_open():
        minutes = prefs()["lockAfter"]
        if minutes and time.time() - _s["last"] > minutes * 60:
            lock()


# ---------------------------------------------------------------- settings

PREF_DEFAULTS = {"lockAfter": 5, "lockMinimize": True, "hideLive": True, "clearAfter": 30, "offerFill": True, "never": []}


def prefs():
    saved = settings.load().get("mv_prefs") or {}
    p = dict(PREF_DEFAULTS)
    for k in PREF_DEFAULTS:
        if k in saved:
            p[k] = saved[k]
    p["lockAfter"] = p["lockAfter"] if p["lockAfter"] in (1, 5, 15, 30, 60) else 5
    p["clearAfter"] = p["clearAfter"] if p["clearAfter"] in (0, 10, 30, 60) else 30
    p["never"] = [str(d)[:100] for d in p["never"] if isinstance(d, str)][:200]
    return p


def set_prefs(changes):
    p = prefs()
    for k, v in (changes or {}).items():
        if k in ("lockMinimize", "hideLive", "offerFill"):
            p[k] = bool(v)
        elif k in ("lockAfter", "clearAfter"):
            try:
                p[k] = int(v)
            except (TypeError, ValueError):
                pass
        elif k == "never" and isinstance(v, list):
            p[k] = v
    settings.save(mv_prefs=p)
    return prefs()


def state():
    c = settings.load()
    return {"ok": True, "exists": exists(), "open": is_open(), "wait": _wait_left(),
            "fails": int(c.get("mv_fails") or 0), "prefs": prefs(), "pinLength": PIN_LEN}


# ---------------------------------------------------------------- items

def _clean_site(site):
    s = str(site or "").strip().lower()
    if not s:
        return ""
    if "://" not in s:
        s = "https://" + s
    host = (urllib.parse.urlsplit(s).hostname or "").strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host[:120] if re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", host or "") else ""


def _text(v, n):
    return str(v or "")[:n]


def _find(item_id):
    for i in _s["items"]:
        if i.get("id") == item_id:
            return i
    raise Error("That isn't in MyVault anymore.")


def public(i):
    """An item for the list: no password, code secret or note text."""
    tags = []
    return {"id": i["id"], "kind": i.get("kind", "account"), "name": i.get("name", ""), "site": i.get("site", ""),
            "user": i.get("user", ""), "hasPass": bool(i.get("password")), "otp": bool(i.get("otp")),
            "icon": i.get("icon", ""), "count": _code_count(i), "changed": i.get("changed", 0), "tags": tags}


def _code_count(i):
    if i.get("kind") != "codes":
        return 0
    return len([ln for ln in str(i.get("text") or "").splitlines() if ln.strip()])


def items():
    with _lock:
        _need_open()
        out = [public(i) for i in _s["items"]]
        h = _health_map()
        for o in out:
            o["tags"] = h.get(o["id"], [])
        out.sort(key=lambda o: (KINDS.index(o["kind"]) if o["kind"] in KINDS else 9, o["name"].lower()))
        return out


def get(item_id):
    """The whole item, for the edit window."""
    with _lock:
        _need_open()
        i = dict(_find(item_id))
        if i.get("otp"):
            i["otp"] = dict(i["otp"])
        return i


def save(data):
    if not isinstance(data, dict):
        raise Error("Something about that wasn't right.")
    with _lock:
        _need_open()
        kind = data.get("kind") if data.get("kind") in KINDS else "account"
        name = _text(data.get("name"), 80).strip()
        site = _clean_site(data.get("site"))
        if not name:
            name = _site_name(site)
        if not name:
            raise Error("Give it a name.")
        old = None
        if data.get("id"):
            old = _find(data["id"])
        elif len(_s["items"]) >= MAX_ITEMS:
            raise Error("MyVault is full.")
        item = old if old is not None else {"id": secrets.token_hex(8), "created": int(time.time())}
        if old is not None and "password" not in data:
            data["password"] = old.get("password", "")
        if old is not None and "otp" not in data:
            data["otp"] = old.get("otp")
        new_pass = _text(data.get("password"), 500)
        if old is not None and old.get("password") and new_pass != old.get("password"):
            item.setdefault("history", []).insert(0, {"password": old["password"], "until": int(time.time())})
            item["history"] = item["history"][:5]
        item.update(kind=kind, name=name, site=site, user=_text(data.get("user"), 200).strip(),
                    password=new_pass if kind == "account" else "",
                    text=_text(data.get("text"), 20000) if kind != "account" else _text(data.get("text"), 4000),
                    changed=int(time.time()))
        otp = data.get("otp")
        if isinstance(otp, str):
            otp = parse_otp(otp) if otp.strip() else None
        if otp is not None and not isinstance(otp, dict):
            otp = None
        if otp:
            otp = _clean_otp(otp)
        item["otp"] = otp if kind == "account" else None
        if old is None:
            _s["items"].append(item)
        if old is not None and old.get("site") != site:
            item["icon"] = ""
        _save()
        result = public(item)
    if site and not item.get("icon"):
        threading.Thread(target=_fetch_icon_for, args=(item["id"], site), daemon=True).start()
    return result


def delete(item_id):
    with _lock:
        _need_open()
        _s["items"].remove(_find(item_id))
        _save()


def reveal(item_id, field="password"):
    with _lock:
        _need_open()
        i = _find(item_id)
        if field == "otp":
            return code_for(i)["code"] if i.get("otp") else ""
        if field not in ("password", "user", "text"):
            raise Error("Something about that wasn't right.")
        return i.get(field) or ""


# ---------------------------------------------------------------- 2FA codes (TOTP)

def _b32(secret):
    s = re.sub(r"[\s-]", "", str(secret or "")).upper().rstrip("=")
    if not s or not re.fullmatch(r"[A-Z2-7]+", s):
        raise Error("That setup key doesn't look right.")
    return base64.b32decode(s + "=" * (-len(s) % 8))


def _clean_otp(o):
    secret = str(o.get("secret") or "")
    _b32(secret)  # checks it
    algo = str(o.get("algo") or "SHA1").upper()
    digits = int(o.get("digits") or 6)
    period = int(o.get("period") or 30)
    return {"secret": re.sub(r"[\s-]", "", secret).upper().rstrip("="),
            "algo": algo if algo in ("SHA1", "SHA256", "SHA512") else "SHA1",
            "digits": digits if digits in (6, 7, 8) else 6, "period": period if 10 <= period <= 120 else 30}


def parse_otp(text):
    """A setup key ("JBSW Y3DP ...") or an otpauth://totp/... link (what a 2FA QR code holds)."""
    text = str(text or "").strip()
    if text.lower().startswith("otpauth://"):
        u = urllib.parse.urlsplit(text)
        if u.netloc.lower() != "totp":
            raise Error("Only time-based 2FA codes work here.")
        q = {k.lower(): v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        label = urllib.parse.unquote(u.path.lstrip("/"))
        issuer, _, account = label.rpartition(":")
        o = _clean_otp({"secret": q.get("secret"), "algo": q.get("algorithm"), "digits": q.get("digits"), "period": q.get("period")})
        o["issuer"] = (q.get("issuer") or issuer or "").strip()[:80]
        o["account"] = (account or label).strip()[:120]
        return o
    return _clean_otp({"secret": text})


def totp(o, at=None):
    at = time.time() if at is None else at
    period = int(o.get("period") or 30)
    counter = int(at // period)
    algo = {"SHA1": hashlib.sha1, "SHA256": hashlib.sha256, "SHA512": hashlib.sha512}[o.get("algo") or "SHA1"]
    mac = hmac.new(_b32(o["secret"]), struct.pack(">Q", counter), algo).digest()
    off = mac[-1] & 0xF
    n = (struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF) % (10 ** int(o.get("digits") or 6))
    return str(n).zfill(int(o.get("digits") or 6)), period - (at % period)


def code_for(i):
    code, left = totp(i["otp"])
    return {"code": code, "left": round(left, 1), "period": int(i["otp"].get("period") or 30)}


def codes():
    with _lock:
        _need_open()
        out = {}
        for i in _s["items"]:
            if i.get("otp"):
                try:
                    out[i["id"]] = code_for(i)
                except Error:
                    pass
        return out


# ---------------------------------------------------------------- Google Authenticator export

def _varint(b, p):
    n = shift = 0
    while True:
        if p >= len(b):
            raise Error("broken")
        c = b[p]
        p += 1
        n |= (c & 0x7F) << shift
        if not c & 0x80:
            return n, p
        shift += 7


def _fields(b):
    p, out = 0, []
    while p < len(b):
        tag, p = _varint(b, p)
        num, wire = tag >> 3, tag & 7
        if wire == 0:
            v, p = _varint(b, p)
        elif wire == 2:
            n, p = _varint(b, p)
            v, p = b[p:p + n], p + n
        elif wire == 1:
            v, p = b[p:p + 8], p + 8
        elif wire == 5:
            v, p = b[p:p + 4], p + 4
        else:
            raise Error("broken")
        out.append((num, v))
    return out


def parse_migration(link):
    """otpauth-migration://offline?data=... (Google Authenticator > Transfer accounts > Export) ->
    {"codes": [{issuer, account, otp}], "batch": [index, size], "skipped": n}."""
    u = urllib.parse.urlsplit(str(link or "").strip())
    if u.scheme.lower() != "otpauth-migration":
        raise Error("That QR code isn't from Google Authenticator's Export accounts.")
    data = urllib.parse.parse_qs(u.query).get("data", [""])[0]
    try:
        raw = base64.b64decode(data + "=" * (-len(data) % 4))
        fields = _fields(raw)
    except (ValueError, Error):
        raise Error("Couldn't read that QR code. Try again.")
    found, skipped, index, size = [], 0, 0, 1
    for num, v in fields:
        if num == 1 and isinstance(v, bytes):
            f = dict()
            for n2, v2 in _fields(v):
                f[n2] = v2
            if f.get(6, 2) not in (0, 2):  # 1: HOTP (a counter, not time): rare, not supported
                skipped += 1
                continue
            secret = base64.b32encode(f.get(1, b"")).decode().rstrip("=")
            if not secret:
                skipped += 1
                continue
            name = (f.get(2) or b"").decode("utf-8", "replace")
            issuer = (f.get(3) or b"").decode("utf-8", "replace")
            if not issuer and ":" in name:
                issuer, name = name.split(":", 1)
            elif issuer and name.lower().startswith(issuer.lower() + ":"):
                name = name[len(issuer) + 1:]
            algo = {2: "SHA256", 3: "SHA512"}.get(f.get(4, 1), "SHA1")
            digits = 8 if f.get(5) == 2 else 6
            found.append({"issuer": issuer.strip()[:80], "account": name.strip()[:120],
                          "otp": {"secret": secret, "algo": algo, "digits": digits, "period": 30}})
        elif num == 3:
            size = max(1, int(v))
        elif num == 4:
            index = int(v)
    return {"codes": found, "batch": [index, size], "skipped": skipped}


def _norm(t):
    return re.sub(r"[^a-z0-9]", "", str(t or "").lower())


def match_codes(found):
    """Which saved account each found code goes with (or None: it becomes a new account)."""
    with _lock:
        _need_open()
        out = []
        accounts = [i for i in _s["items"] if i.get("kind") == "account"]
        for c in found or []:
            iss, acc = _norm(c.get("issuer")), str(c.get("account") or "").strip().lower()
            best, score = None, 0
            for i in accounts:
                names = {_norm(i.get("name")), _norm((i.get("site") or "").split(".")[0])} - {""}
                s = 0
                if iss and iss in names:
                    s += 2
                elif iss and any(iss in n or n in iss for n in names if len(n) > 2):
                    s += 1
                if iss and not s:
                    continue  # another site's account, even with the same username
                if acc and acc == str(i.get("user") or "").strip().lower():
                    s += 2
                if s > score:
                    best, score = i, s
            out.append({**c, "match": best["id"] if best and score >= 2 else None,
                        "matchName": best.get("name") if best and score >= 2 else "",
                        "hasCode": bool(best and score >= 2 and best.get("otp"))})
        return out


def add_codes(chosen):
    """[{issuer, account, otp, match}] -> codes put on the matched accounts, or new accounts made."""
    added = 0
    for c in chosen or []:
        if not isinstance(c, dict) or not isinstance(c.get("otp"), dict):
            continue
        otp = _clean_otp(c["otp"])
        with _lock:
            _need_open()
            target = None
            if c.get("match"):
                try:
                    target = _find(c["match"])
                except Error:
                    target = None
            if target is not None:
                target["otp"] = otp
                target["changed"] = int(time.time())
                _save()
                added += 1
                continue
        issuer = str(c.get("issuer") or "").strip() or "2FA code"
        account = str(c.get("account") or "").strip()
        guess = _guess_site(issuer)
        save({"kind": "account", "name": issuer, "site": guess, "user": account, "password": "", "otp": otp})
        added += 1
    return added


KNOWN_SITES = {
    "google": "google.com", "gmail": "google.com", "youtube": "youtube.com", "twitch": "twitch.tv", "discord": "discord.com",
    "steam": "steampowered.com", "epic": "epicgames.com", "epicgames": "epicgames.com", "instagram": "instagram.com",
    "facebook": "facebook.com", "meta": "facebook.com", "x": "x.com", "twitter": "x.com", "tiktok": "tiktok.com",
    "microsoft": "microsoft.com", "github": "github.com", "amazon": "amazon.com", "apple": "apple.com", "reddit": "reddit.com",
    "kick": "kick.com", "paypal": "paypal.com", "dropbox": "dropbox.com", "battlenet": "battle.net", "blizzard": "battle.net",
    "riot": "riotgames.com", "riotgames": "riotgames.com", "ea": "ea.com", "ubisoft": "ubisoft.com", "spotify": "spotify.com",
    "snapchat": "snapchat.com", "streamelements": "streamelements.com", "streamlabs": "streamlabs.com", "nvidia": "nvidia.com",
    "proton": "proton.me", "protonmail": "proton.me", "coinbase": "coinbase.com", "binance": "binance.com", "vipps": "vipps.no",
}


NICE_NAMES = {"steampowered.com": "Steam", "steamcommunity.com": "Steam", "epicgames.com": "Epic Games", "battle.net": "Battle.net",
              "riotgames.com": "Riot Games", "x.com": "X", "ea.com": "EA", "github.com": "GitHub", "tiktok.com": "TikTok",
              "youtube.com": "YouTube", "paypal.com": "PayPal", "playstation.com": "PlayStation", "streamelements.com": "StreamElements"}


def _site_name(site):
    if not site:
        return ""
    for d, n in NICE_NAMES.items():
        if site == d or site.endswith("." + d):
            return n
    parts = site.split(".")
    return parts[-2].capitalize() if len(parts) >= 2 else site


def _guess_site(name):
    n = _norm(name)
    if n in KNOWN_SITES:
        return KNOWN_SITES[n]
    if re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", str(name or "").lower().strip()):
        return _clean_site(name)
    return ""


# ---------------------------------------------------------------- password health

COMMON = {"123456", "123456789", "12345678", "password", "qwerty", "123123", "111111", "abc123", "1234567", "password1",
          "12345", "1234567890", "000000", "iloveyou", "qwerty123", "1q2w3e4r", "dragon", "monkey", "letmein", "football",
          "minecraft", "fortnite", "passord", "qwertyuiop", "welcome", "admin", "login", "starwars", "master", "hello123"}


def strength(pw):
    """0 (very weak) .. 4 (strong), a simple guess like the bar when you type one."""
    pw = str(pw or "")
    if not pw:
        return 0
    if pw.lower() in COMMON or len(set(pw)) <= 2:
        return 0
    kinds = sum(bool(re.search(p, pw)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^a-zA-Z\d]"))
    pool = {1: 26, 2: 52, 3: 62, 4: 94}.get(kinds, 10)
    if pw.isdigit():
        pool = 10
    import math
    bits = len(pw) * math.log2(pool)
    if re.search(r"(.)\1\1", pw) or re.search(r"(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)", pw.lower()):
        bits -= 10
    return 0 if bits < 28 else 1 if bits < 40 else 2 if bits < 55 else 3 if bits < 75 else 4


def _health_map():
    """id -> ["weak"] / ["reused"] (call with _lock held)."""
    out, seen = {}, {}
    for i in _s["items"]:
        pw = i.get("password") or ""
        if i.get("kind") != "account" or not pw:
            continue
        if strength(pw) <= 1:
            out.setdefault(i["id"], []).append("weak")
        seen.setdefault(hashlib.sha256(pw.encode()).hexdigest(), []).append(i)
    for group in seen.values():
        if len(group) > 1:
            for i in group:
                out.setdefault(i["id"], []).append("reused")
    return out


def health():
    with _lock:
        _need_open()
        weak, reused, seen = [], [], {}
        accounts = [i for i in _s["items"] if i.get("kind") == "account" and i.get("password")]
        for i in accounts:
            seen.setdefault(hashlib.sha256(i["password"].encode()).hexdigest(), []).append(i)
        for i in accounts:
            if strength(i["password"]) <= 1:
                weak.append({**public(i), "why": "Short and easy to guess" if len(i["password"]) < 10 else "Easy to guess"})
        for group in seen.values():
            if len(group) > 1:
                for i in group:
                    others = [g.get("name") for g in group if g is not i]
                    reused.append({**public(i), "why": "Same password as " + _and(others)})
        bad = {w["id"] for w in weak} | {r["id"] for r in reused}
        return {"total": len(accounts), "good": len(accounts) - len(bad), "weak": weak, "reused": reused}


def _and(names):
    names = [n for n in names if n][:3]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1] if names else "another account"


# ---------------------------------------------------------------- site icons (kept inside the locked vault)

def _fetch(url, limit=400_000):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VaultHub"})
    with urllib.request.urlopen(req, timeout=6) as r:
        return r.read(limit), r.geturl(), r.headers.get("Content-Type", "")


def fetch_icon(site):
    """The site's own icon as a small PNG data: link, or ""."""
    try:
        from PIL import Image
    except ImportError:
        return ""
    candidates = []
    try:
        page, final, _ = _fetch(f"https://{site}/", 300_000)
        text = page.decode("utf-8", "replace")
        for m in re.finditer(r"<link\b[^>]*>", text, re.I):
            tag = m.group(0)
            rel = re.search(r'rel\s*=\s*["\']([^"\']+)', tag, re.I)
            href = re.search(r'href\s*=\s*["\']([^"\']+)', tag, re.I)
            if not rel or not href or "icon" not in rel.group(1).lower():
                continue
            sizes = re.search(r'sizes\s*=\s*["\'](\d+)', tag, re.I)
            rank = (2 if "apple-touch" in rel.group(1).lower() else 1, int(sizes.group(1)) if sizes else 0)
            candidates.append((rank, urllib.parse.urljoin(final, href.group(1))))
    except Exception:  # noqa: BLE001 (no page: try the usual spot)
        pass
    candidates.sort(reverse=True)
    urls = [u for _, u in candidates if not u.lower().endswith(".svg")][:4] + [f"https://{site}/favicon.ico"]
    for url in urls:
        if not url.startswith("https://"):
            continue
        try:
            body, _, _ = _fetch(url)
            img = Image.open(io.BytesIO(body))
            if img.format == "ICO":
                img.size = max(img.ico.sizes())
            img = img.convert("RGBA")
            if img.width < 16:
                continue
            img.thumbnail((64, 64))
            out = io.BytesIO()
            img.save(out, "PNG", optimize=True)
            return "data:image/png;base64," + _b64(out.getvalue())
        except Exception:  # noqa: BLE001
            continue
    return ""


def _fetch_icon_for(item_id, site):
    icon = fetch_icon(site)
    if not icon:
        return
    with _lock:
        if not is_open():
            return
        for i in _s["items"]:
            if i.get("id") == item_id and i.get("site") == site:
                i["icon"] = icon
                _save()


# ---------------------------------------------------------------- backup file

def backup(folder, password):
    password = str(password or "")
    if len(password) < 8:
        raise Error("Pick a backup password with at least 8 characters.")
    with _lock:
        _need_open()
        salt = secrets.token_bytes(16)
        plain = json.dumps({"items": _s["items"]}, separators=(",", ":")).encode()
        body = {"myvaultBackup": 1, "made": int(time.time()), "salt": _b64(salt), "kdf": dict(KDF),
                "data": _b64(seal(_derive(password, salt, KDF), plain, b"backup"))}
    name = time.strftime("MyVault backup %Y-%m-%d.vhvault")
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(body, f)
    return path


def restore(path, password, pin):
    """Start MyVault from a backup file (on a new PC, say). Only when there's no vault here yet."""
    pin = _check_pin(pin)
    if exists():
        raise Error("MyVault is already set up here. Reset it first.")
    try:
        with open(path, encoding="utf-8") as f:
            body = json.load(f)
        salt = _unb64(body["salt"])
        plain = unseal(_derive(str(password or ""), salt, body["kdf"]), _unb64(body["data"]), b"backup")
        got = json.loads(plain).get("items") or []
    except Error:
        raise Error("Wrong backup password.")
    except (OSError, ValueError, KeyError, TypeError):
        raise Error("That isn't a MyVault backup file.")
    setup(pin)
    with _lock:
        _s["items"] = [i for i in got if isinstance(i, dict) and i.get("id")][:MAX_ITEMS]
        _save()
    return state()


# ---------------------------------------------------------------- clipboard

def copy(item_id, field):
    value = reveal(item_id, field)
    if not value:
        raise Error("There's nothing to copy.")
    set_clipboard(value)
    after = prefs()["clearAfter"]
    t = _clip.get("timer")
    if t:
        t.cancel()
    _clip["value"] = value
    if after:
        _clip["timer"] = threading.Timer(after, _clear_clipboard_now)
        _clip["timer"].daemon = True
        _clip["timer"].start()
    return {"ok": True, "clearIn": after}


def _clear_clipboard_now():
    value, _clip["value"] = _clip.get("value"), None
    if value and IS_WINDOWS:
        try:
            from windows import clipboard_text
            if clipboard_text(len(value) + 10) == value:
                set_clipboard("")
        except Exception:  # noqa: BLE001
            pass


def set_clipboard(text):
    """Text on the clipboard, kept out of Windows' clipboard history and cloud clipboard."""
    if not IS_WINDOWS:
        return
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    user32.RegisterClipboardFormatW.restype = wintypes.UINT
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    for _ in range(10):
        if user32.OpenClipboard(None):
            break
        time.sleep(0.05)
    else:
        raise Error("Couldn't use the clipboard. Try again.")
    try:
        user32.EmptyClipboard()
        if not text:
            return

        def put(fmt, data):
            h = kernel32.GlobalAlloc(0x2, len(data))  # GMEM_MOVEABLE
            p = kernel32.GlobalLock(h)
            ctypes.memmove(p, data, len(data))
            kernel32.GlobalUnlock(h)
            user32.SetClipboardData(fmt, h)
        put(13, (text + "\0").encode("utf-16-le"))  # CF_UNICODETEXT
        for name in ("ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard"):
            fmt = user32.RegisterClipboardFormatW(name)
            if fmt:
                put(fmt, struct.pack("<I", 0))
    finally:
        user32.CloseClipboard()


# ---------------------------------------------------------------- the login pop-up

# Apps with their own login windows: program -> (name, sites it goes with, a login window's title, or None: any)
APPS = {
    "steam.exe": ("Steam", ("steampowered.com", "steamcommunity.com"), re.compile(r"sign in|logg inn|log in|login", re.I)),
    "steamwebhelper.exe": ("Steam", ("steampowered.com", "steamcommunity.com"), re.compile(r"sign in|logg inn|log in|login", re.I)),
    "epicgameslauncher.exe": ("Epic Games", ("epicgames.com",), None),
    "battle.net.exe": ("Battle.net", ("battle.net", "blizzard.com"), None),
    "riotclientux.exe": ("Riot", ("riotgames.com",), None),
    "riot client.exe": ("Riot", ("riotgames.com",), None),
    "eadesktop.exe": ("EA app", ("ea.com",), None),
    "upc.exe": ("Ubisoft Connect", ("ubisoft.com",), None),
    "ubisoftconnect.exe": ("Ubisoft Connect", ("ubisoft.com",), None),
    "discord.exe": ("Discord", ("discord.com",), re.compile(r"^discord$", re.I)),
    "obs64.exe": None,
}
BROWSERS = {"chrome.exe", "msedge.exe", "brave.exe", "firefox.exe", "opera.exe", "vivaldi.exe", "arc.exe"}
LOGIN_WORDS = re.compile(r"\b(log ?in|sign ?in|logg inn|logon|log on|signin|anmelden|connexion|iniciar sesi)", re.I)

_w = {"thread": None, "stop": False, "offer": None, "dismissed": {}, "own": set(), "busy": False, "filled": None,
      "bubble": None, "last_key": None}


def _site_match(host, site):
    host, site = (host or "").lower().strip("."), (site or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return bool(site) and (host == site or host.endswith("." + site))


def _accounts_for(sites):
    with _lock:
        if not is_open():
            return []
        out = []
        for i in _s["items"]:
            if i.get("kind") == "account" and any(_site_match(i.get("site"), s) or _site_match(s, i.get("site")) for s in sites):
                out.append({"id": i["id"], "name": i.get("name"), "user": i.get("user"), "icon": i.get("icon", ""),
                            "otp": bool(i.get("otp")), "hasPass": bool(i.get("password"))})
        return out


def watch_start(own_windows):
    _w["own"] = own_windows
    if _w["thread"] or not IS_WINDOWS:
        return
    _w["thread"] = threading.Thread(target=_watch_loop, daemon=True)
    _w["thread"].start()


def watch_dismiss_all():
    if _w.get("offer"):
        _w["offer"] = None


def offer():
    """What the bubble shows now (it asks every second)."""
    o = _w.get("offer")
    if not o:
        return {"ok": True, "show": False}
    accounts = _accounts_for(o["sites"]) if is_open() else []
    filled = _w.get("filled")
    code = None
    if filled and filled.get("key") == o["key"] and is_open():
        try:
            i = _find(filled["id"])
            if i.get("otp"):
                code = {**code_for(i), "id": i["id"], "name": i.get("name")}
        except Error:
            pass
    return {"ok": True, "show": True, "app": o["app"], "site": o.get("site", ""), "open": is_open(),
            "accounts": accounts, "browser": o["browser"], "done": bool(filled and filled.get("key") == o["key"]),
            "code": code, "wait": _wait_left()}


def offer_dismiss(never=False):
    o = _w.get("offer")
    if o:
        _w["dismissed"][o["key"]] = time.time()
        if never:
            p = prefs()
            p["never"] = list(dict.fromkeys(p["never"] + [o["neverKey"]]))
            set_prefs({"never": p["never"]})
        _w["offer"] = None
    _bubble(False)


def fill(item_id, what="login"):
    """Types into the window the bubble is for. what: login (username, Tab, password), password, user, code."""
    o = _w.get("offer")
    if not o:
        raise Error("The login window is gone.")
    with _lock:
        _need_open()
        i = _find(item_id)
        user, pw = i.get("user") or "", i.get("password") or ""
        code = code_for(i)["code"] if what == "code" and i.get("otp") else ""
    if o["browser"] and not any(_site_match(o.get("host"), s) for s in [i.get("site")]):
        raise Error("This site doesn't match the one you saved, so MyVault won't fill it in.")
    if not _activate(o["hwnd"]):
        raise Error("Couldn't get back to the login window. Click in it and try again.")
    time.sleep(0.18)
    if what == "code":
        _type(code)
    elif what == "password" or (what == "login" and _focused_is_password()):
        _type(pw)
    elif what == "user":
        _type(user)
    else:
        if user:
            _type(user)
            _key(0x0F)  # Tab
            time.sleep(0.06)
        _type(pw)
    _w["filled"] = {"key": o["key"], "id": item_id, "at": time.time()}
    touch()
    return {"ok": True}


def _watch_loop():
    while not _w["stop"]:
        try:
            check_timeout()
            _watch_once()
        except Exception:  # noqa: BLE001 (the watcher must never stop the app)
            pass
        time.sleep(0.8)


def _watch_once():
    p = prefs()
    if not p["offerFill"] or not exists():
        if _w["offer"]:
            _w["offer"] = None
            _bubble(False)
        return
    hwnd = _foreground()
    if not hwnd or hwnd in _w["own"]() or _is_bubble(hwnd):
        return  # you're in VaultHub (or the bubble itself): keep what's showing
    title = _title(hwnd)
    exe = _exe(hwnd)
    key = (hwnd, title)
    if _w["offer"] and _w["offer"]["key"] == key:
        return
    found = None
    if exe in APPS and APPS[exe]:
        name, sites, rule = APPS[exe]
        if rule is None or rule.search(title):
            found = {"app": name, "sites": list(sites), "browser": False, "neverKey": exe, "host": ""}
    elif exe in BROWSERS and LOGIN_WORDS.search(title):
        url = _browser_url(hwnd)
        host = (urllib.parse.urlsplit(url if "://" in url else "https://" + url).hostname or "") if url else ""
        if host:
            site = host[4:] if host.startswith("www.") else host
            found = {"app": site, "sites": [site], "browser": True, "neverKey": site, "host": host, "site": site}
    if not found or found["neverKey"] in p["never"]:
        if _w["offer"] and not _window_alive(_w["offer"]["hwnd"]):
            _w["offer"] = None
            _bubble(False)
        elif _w["offer"] and _w["offer"]["hwnd"] != hwnd:
            _w["offer"] = None
            _bubble(False)
        return
    if time.time() - _w["dismissed"].get(key, 0) < 600:
        return
    if is_open() and not _accounts_for(found["sites"]):
        return  # nothing saved for it
    if not is_open() and found["browser"]:
        return  # locked: the sites you saved aren't known, so no pop-up on every login page
    _w["offer"] = {**found, "hwnd": hwnd, "key": key}
    _w["filled"] = None
    _bubble(True, hwnd)


def _bubble(show, hwnd=None):
    fn = _w.get("bubble")
    if fn:
        try:
            fn(show, _window_rect(hwnd) if hwnd else None)
        except Exception:  # noqa: BLE001
            pass


def _is_bubble(hwnd):
    try:
        import appwindow
        return appwindow.is_bubble(hwnd)
    except Exception:  # noqa: BLE001
        return False


# ---- Windows bits for the pop-up

def _u32():
    from ctypes import wintypes
    u = ctypes.windll.user32
    u.GetForegroundWindow.restype = wintypes.HWND
    u.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    u.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    u.IsWindow.argtypes = [wintypes.HWND]
    u.SetForegroundWindow.argtypes = [wintypes.HWND]
    u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    u.IsIconic.argtypes = [wintypes.HWND]
    u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    return u


def _foreground():
    h = _u32().GetForegroundWindow()
    return int(h) if h else 0


def _window_alive(hwnd):
    return bool(_u32().IsWindow(hwnd))


def _title(hwnd):
    u = _u32()
    n = u.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def _exe(hwnd):
    from ctypes import wintypes
    pid = wintypes.DWORD()
    _u32().GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    k = ctypes.windll.kernel32
    k.OpenProcess.restype = wintypes.HANDLE
    h = k.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf, size = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
        if k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
        return ""
    finally:
        k.CloseHandle(h)


def _window_rect(hwnd):
    from ctypes import wintypes
    r = wintypes.RECT()
    if hwnd and _u32().GetWindowRect(hwnd, ctypes.byref(r)):
        return (r.left, r.top, r.right, r.bottom)
    return None


def _activate(hwnd):
    u = _u32()
    if not u.IsWindow(hwnd):
        return False
    if u.IsIconic(hwnd):
        u.ShowWindow(hwnd, 9)
    # Alt down/up first: Windows lets a program bring another window forward after a key press
    _key_vk(0x12, up=False)
    _key_vk(0x12, up=True)
    u.SetForegroundWindow(hwnd)
    for _ in range(10):
        if _foreground() == hwnd:
            return True
        time.sleep(0.03)
    return _foreground() == hwnd


def _type(text):
    import remote
    items = []
    for ch in text:
        for unit in struct.unpack("<%dH" % (len(ch.encode("utf-16-le")) // 2), ch.encode("utf-16-le")):
            items.append((1, {"scan": unit, "flags": 0x4}))  # KEYEVENTF_UNICODE
            items.append((1, {"scan": unit, "flags": 0x4 | 0x2}))  # ... KEYUP
    for n in range(0, len(items), 40):
        remote._send(items[n:n + 40])
        time.sleep(0.01)


def _key(scan):
    import remote
    remote._send([(1, {"scan": scan, "flags": 0x8}), (1, {"scan": scan, "flags": 0x8 | 0x2})])  # SCANCODE


def _key_vk(vk, up):
    ctypes.windll.user32.keybd_event(vk, 0, 0x2 if up else 0, 0)


# ---- UI Automation (raw COM, like appwindow): a browser's address, and "is a password box focused?"

UIA_CLSID = "ff48dba4-60ef-4201-aa87-54103eef594e"
UIA_IID = "30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"
_uia = threading.local()


class VARIANT(ctypes.Structure):
    _fields_ = [("vt", ctypes.c_ushort), ("r1", ctypes.c_ushort), ("r2", ctypes.c_ushort), ("r3", ctypes.c_ushort),
                ("val", ctypes.c_longlong), ("val2", ctypes.c_longlong)]


def _com(obj, index, *argtypes):
    vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    fn = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(vtable[index])
    return lambda *a: fn(obj, *a)


def _release(obj):
    if obj:
        _com(obj, 2)()


def _automation():
    if getattr(_uia, "obj", None):
        return _uia.obj
    import appwindow
    ctypes.windll.ole32.CoInitializeEx(None, 0)  # COINIT_MULTITHREADED (this thread is ours)
    obj = ctypes.c_void_p()
    clsid, iid = appwindow.GUID.from_buffer_copy(appwindow._guid(UIA_CLSID)), appwindow.GUID.from_buffer_copy(appwindow._guid(UIA_IID))
    ctypes.windll.ole32.CoCreateInstance(ctypes.byref(clsid), None, 1, ctypes.byref(iid), ctypes.byref(obj))  # CLSCTX_INPROC_SERVER
    if not obj.value:
        return None
    _uia.obj = obj.value
    return obj.value


def _variant_text(v):
    if v.vt == 8 and v.val:  # VT_BSTR
        s = ctypes.wstring_at(v.val)
        ctypes.windll.oleaut32.SysFreeString(ctypes.c_void_p(v.val))
        return s
    return ""


def _browser_url(hwnd):
    """The address in a browser window's address bar (Chrome, Edge, Brave, Firefox...), or ""."""
    try:
        a = _automation()
        if not a:
            return ""
        el = ctypes.c_void_p()
        if _com(a, 6, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(hwnd, ctypes.byref(el)) or not el.value:  # ElementFromHandle
            return ""
        cond = ctypes.c_void_p()
        v = VARIANT(vt=3, val=50004)  # VT_I4, UIA_EditControlTypeId
        _com(a, 23, ctypes.c_int, VARIANT, ctypes.POINTER(ctypes.c_void_p))(30003, v, ctypes.byref(cond))  # CreatePropertyCondition(ControlType)
        edit = ctypes.c_void_p()
        _com(el.value, 5, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(4, cond.value, ctypes.byref(edit))  # FindFirst(Descendants)
        url = ""
        if edit.value:
            out = VARIANT()
            _com(edit.value, 10, ctypes.c_int, ctypes.POINTER(VARIANT))(30045, ctypes.byref(out))  # GetCurrentPropertyValue(Value)
            url = _variant_text(out)
            _release(edit.value)
        _release(cond.value)
        _release(el.value)
        url = url.strip()
        return url if url and " " not in url and "." in url else ""
    except Exception:  # noqa: BLE001
        return ""


def _focused_is_password():
    try:
        a = _automation()
        if not a:
            return False
        el = ctypes.c_void_p()
        if _com(a, 8, ctypes.POINTER(ctypes.c_void_p))(ctypes.byref(el)) or not el.value:  # GetFocusedElement
            return False
        out = VARIANT()
        _com(el.value, 10, ctypes.c_int, ctypes.POINTER(VARIANT))(30019, ctypes.byref(out))  # IsPassword
        _release(el.value)
        return out.vt == 11 and (out.val & 0xFFFF) != 0  # VT_BOOL
    except Exception:  # noqa: BLE001
        return False


# ---- (3.2.3) the Windows Camera app, for when the app's own webcam view can't get the camera
_camera = {"since": 0.0}


def _camera_roll_folders():
    found = []
    if os.name == "nt":
        try:  # FOLDERID_CameraRoll: the right folder whatever the language (Bilder, Pictures...) or OneDrive
            class GUID(ctypes.Structure):
                _fields_ = [("a", ctypes.c_uint32), ("b", ctypes.c_uint16), ("c", ctypes.c_uint16), ("d", ctypes.c_ubyte * 8)]
            fid = GUID(0xAB5FB87B, 0x7CE2, 0x4F83, (ctypes.c_ubyte * 8)(0x91, 0x5D, 0x55, 0x08, 0x46, 0xC9, 0x53, 0x7B))
            out = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(fid), 0, None, ctypes.byref(out)) == 0:
                found.append(out.value)
                ctypes.windll.ole32.CoTaskMemFree(out)
        except Exception:  # noqa: BLE001
            pass
    home = os.path.expanduser("~")
    for pics in ("Pictures", "Bilder", "Billeder"):
        found += [os.path.join(home, pics, "Camera Roll"), os.path.join(home, "OneDrive", pics, "Camera Roll")]
    seen, out = set(), []
    for f in found:
        if f and os.path.isdir(f) and os.path.normcase(f) not in seen:
            seen.add(os.path.normcase(f))
            out.append(f)
    return out


def camera_open():
    """Opens the Camera app; photos taken from now on are picked up by camera_photo()."""
    if not is_open():
        raise Error("MyVault is locked.")
    _camera["since"] = time.time() - 2
    if os.name == "nt":
        try:
            os.startfile("microsoft.windows.camera:")
        except OSError:
            raise Error("Couldn't open the Camera app.")
    return {"folders": len(_camera_roll_folders())}


def camera_photo():
    """The newest photo taken since camera_open(), read and then deleted: it holds your 2FA secrets."""
    if not is_open() or not _camera["since"]:
        return {"found": False}
    best = None
    for folder in _camera_roll_folders():
        try:
            for name in os.listdir(folder):
                if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                path = os.path.join(folder, name)
                when = os.path.getmtime(path)
                if when >= _camera["since"] and (best is None or when > best[0]):
                    best = (when, path)
        except OSError:
            continue
    if not best:
        return {"found": False}
    try:
        if time.time() - best[0] < 1.0:  # still being written
            return {"found": False}
        with open(best[1], "rb") as f:
            data = f.read()
    except OSError:
        return {"found": False}
    _camera["since"] = time.time()
    try:
        os.remove(best[1])
    except OSError:
        pass
    kind = "png" if best[1].lower().endswith(".png") else "jpeg"
    return {"found": True, "image": f"data:image/{kind};base64," + base64.b64encode(data).decode()}
