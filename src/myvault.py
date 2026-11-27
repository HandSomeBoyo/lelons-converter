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

import bitwarden
import settings

IS_WINDOWS = os.name == "nt"
PATH = os.path.join(settings.DATA_DIR, "myvault.json")
KDF = {"n": 2 ** 15, "r": 8, "p": 1}
PIN_LEN = 6
MAX_ITEMS = 2000
KINDS = ("account", "codes", "note")

_lock = threading.RLock()
_s = {"key": None, "items": None, "salt": None, "kdf": None, "wrap": None, "last": 0.0, "folders": [],
      # (3.3.0) Bitwarden: the tool's session key, the items as Bitwarden has them, the quick PIN key...
      "session": None, "raw": {}, "W": None, "sealed": None, "pinfails": 0, "hidden": 0, "synced": 0.0,
      "rev": 0, "leaked": {}, "syncing": False, "offline": False}
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
    """Write the open vault (call with _lock held). With Bitwarden, only the site icons are kept here."""
    if _s.get("mode") == "bw":
        return _save_icons()
    key = _s["key"]
    plain = json.dumps({"items": _s["items"], "folders": _s["folders"]}, separators=(",", ":")).encode()
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
        _s.update(key=secrets.token_bytes(32), items=[], salt=secrets.token_bytes(16), kdf=dict(KDF), last=time.time(),
                  mode="local", folders=[], leaked={})
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
        body = json.loads(unseal(key, _unb64(data["data"]), b"items"))
        items = body.get("items") or []
        _s.update(key=key, items=[i for i in items if isinstance(i, dict)], salt=salt, kdf=data["kdf"],
                  wrap=data["wrap"], last=time.time(), mode="local", leaked={},
                  folders=[f for f in body.get("folders") or [] if isinstance(f, dict) and f.get("id")])
    _right_try()
    _leak_check_soon()
    return state()


def _nice_wait(s):
    return f"{s} seconds" if s < 90 else f"{round(s / 60)} minutes"


def lock():
    with _lock:
        was_bw = _s.get("mode") == "bw" and _s["session"]
        sealed = None
        if was_bw and _s["W"] and _pin_saved():
            sealed = seal(_s["W"], _s["session"].encode(), b"bwsession")  # quick PIN opens it again
        _s.update(key=None, items=None, last=0.0, session=None, raw={}, W=None, leaked={}, folders=[],
                  sealed=sealed if was_bw else _s["sealed"], pinfails=0 if sealed else _s["pinfails"])
    if was_bw and not sealed:
        threading.Thread(target=bitwarden.lock, daemon=True).start()
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

PREF_DEFAULTS = {"lockAfter": 5, "lockMinimize": True, "hideLive": True, "clearAfter": 30, "offerFill": True, "never": [],
                 "lockLive": True, "leakCheck": True}


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
        if k in ("lockMinimize", "hideLive", "offerFill", "lockLive", "leakCheck"):
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


def mode():
    """"bw" (Bitwarden is connected) or None (not yet: the page shows Connect)."""
    if settings.load().get("bw_email"):
        return "bw"
    return None  # (3.3.1) Bitwarden only: an old PIN vault is moved over once Bitwarden is connected


def state():
    c = settings.load()
    m = mode()
    out = {"ok": True, "mode": m, "exists": exists(), "open": is_open() and m == "bw" and _s.get("mode") == "bw",
           "wait": _wait_left(), "fails": int(c.get("mv_fails") or 0), "prefs": prefs(), "pinLength": PIN_LEN,
           "rev": _s["rev"]}
    if m == "bw":
        out["exists"] = True
        out["oldVault"] = exists()
        out["bw"] = {"email": c.get("bw_email"), "server": c.get("bw_server") or bitwarden.SERVERS["us"],
                     "quick": bool(_s["sealed"]) and _pin_saved(), "pin": _pin_saved(), "synced": _s["synced"],
                     "syncing": _s["syncing"], "offline": _s["offline"], "hidden": _s["hidden"],
                     "tool": bitwarden.tool_version()}
    return out


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
            "icon": i.get("icon", ""), "count": _code_count(i), "changed": i.get("changed", 0), "tags": tags,
            "folder": i.get("folder") or "", "fav": bool(i.get("fav"))}


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
        item = dict(old) if old is not None else {"id": secrets.token_hex(8), "created": int(time.time())}
        for k in ("password", "otp", "text", "folder", "fav"):
            if old is not None and k not in data:
                data[k] = old.get(k)
        new_pass = _text(data.get("password"), 500)
        if old is not None and old.get("password") and new_pass != old.get("password") and _s.get("mode") != "bw":
            item["history"] = ([{"password": old["password"], "until": int(time.time())}] + list(old.get("history") or []))[:5]
        folder = str(data.get("folder") or "")
        if folder and not any(f["id"] == folder for f in _s["folders"]):
            folder = ""
        item.update(kind=kind, name=name, site=site, user=_text(data.get("user"), 200).strip(),
                    password=new_pass if kind == "account" else "",
                    text=_text(data.get("text"), 20000) if kind != "account" else _text(data.get("text"), 4000),
                    changed=int(time.time()), folder=folder, fav=bool(data.get("fav")))
        otp = data.get("otp")
        if isinstance(otp, str):
            otp = parse_otp(otp) if otp.strip() else None
        if otp is not None and not isinstance(otp, dict):
            otp = None
        if otp:
            otp = _clean_otp(otp)
        item["otp"] = otp if kind == "account" else None
        if old is not None and old.get("site") != site:
            item["icon"] = _icon_cache().get(site, "") if _s.get("mode") == "bw" else ""
        item = _put(item, old)
        result = public(item)
    if site and not item.get("icon"):
        threading.Thread(target=_fetch_icon_for, args=(item["id"], site), daemon=True).start()
    if item.get("password") and (old is None or old.get("password") != item["password"]):
        _leak_check_soon([item["id"]])
    return result


def _put(item, old):
    """Keeps a new or changed item (call with _lock held). With Bitwarden it goes there first, and only
    then into the list here, so nothing changes if Bitwarden says no."""
    if _s.get("mode") == "bw":
        raw = _s["raw"].get(item["id"]) if old is not None else None
        try:
            if raw is not None:
                got = bitwarden.edit_item(_s["session"], item["id"], _to_bw(item, raw))
            else:
                got = bitwarden.create_item(_s["session"], _to_bw(item, None))
        except bitwarden.Error as e:
            raise Error(_bw_said(e))
        new = _from_bw(got) if isinstance(got, dict) else None
        if not new:
            raise Error("Bitwarden didn't save it. Try again.")
        new["icon"] = item.get("icon") or _icon_cache().get(new.get("site"), "")
        _s["raw"][new["id"]] = got
        item = new
    if old is not None:
        _s["items"][_s["items"].index(old)] = item
    else:
        _s["items"].append(item)
    _save()
    _s["rev"] += 1
    return item


def delete(item_id):
    with _lock:
        _need_open()
        i = _find(item_id)
        if _s.get("mode") == "bw" and item_id in _s["raw"]:
            try:
                bitwarden.delete_item(_s["session"], item_id)
            except bitwarden.Error as e:
                raise Error(_bw_said(e))
            _s["raw"].pop(item_id, None)
        _s["items"].remove(i)
        _save()
        _s["rev"] += 1


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
                _put({**target, "otp": otp, "changed": int(time.time())}, target)
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
    for i in _s["items"]:
        if _leaked_count(i):
            out.setdefault(i["id"], []).insert(0, "leaked")
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
        leaked = []
        for i in accounts:
            n = _leaked_count(i)
            if n:
                leaked.append({**public(i), "why": f"Showed up in data leaks {n:,} time{'' if n == 1 else 's'}".replace(",", " ")})
        bad = {w["id"] for w in weak} | {r["id"] for r in reused} | {x["id"] for x in leaked}
        checking = bool(prefs()["leakCheck"] and _leak["busy"])
        return {"total": len(accounts), "good": len(accounts) - len(bad), "weak": weak, "reused": reused,
                "leaked": leaked, "checking": checking, "leakCheck": prefs()["leakCheck"]}


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
                _s["rev"] += 1


# ---------------------------------------------------------------- backup file

def backup(folder, password):
    password = str(password or "")
    if len(password) < 8:
        raise Error("Pick a backup password with at least 8 characters.")
    with _lock:
        _need_open()
        salt = secrets.token_bytes(16)
        plain = json.dumps({"items": _s["items"], "folders": _s["folders"]}, separators=(",", ":")).encode()
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
        whole = json.loads(plain)
        got = whole.get("items") or []
        got_folders = [f for f in whole.get("folders") or [] if isinstance(f, dict) and f.get("id")]
    except Error:
        raise Error("Wrong backup password.")
    except (OSError, ValueError, KeyError, TypeError):
        raise Error("That isn't a MyVault backup file.")
    setup(pin)
    with _lock:
        _s["items"] = [i for i in got if isinstance(i, dict) and i.get("id")][:MAX_ITEMS]
        _s["folders"] = got_folders
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
            "code": code, "wait": _wait_left(), "mode": mode(), "quick": bool(_s["sealed"]) and _pin_saved()}


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
    time.sleep(0.25)  # let the window put the keyboard back in its text box
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
    u.BringWindowToTop.argtypes = [wintypes.HWND]
    u.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
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
    if _foreground() == hwnd:
        return True  # (3.2.5) already there: touch nothing
    # Windows lets a program bring another window forward right after it sent a key press. (3.2.5) Not Alt
    # any more: a lone Alt in Chrome or Edge moves the keyboard to the browser's menu button, so the
    # login went there instead of into the page. 0xE8 is a key nothing uses.
    _key_vk(0xE8, up=False)
    _key_vk(0xE8, up=True)
    k32 = ctypes.windll.kernel32
    me = k32.GetCurrentThreadId()
    there = u.GetWindowThreadProcessId(_foreground(), None)
    attached = bool(there and there != me and u.AttachThreadInput(me, there, True))
    try:
        u.BringWindowToTop(hwnd)
        u.SetForegroundWindow(hwnd)
    finally:
        if attached:
            u.AttachThreadInput(me, there, False)
    for _ in range(15):
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


# ---------------------------------------------------------------- (3.3.0) folders

def folders():
    with _lock:
        _need_open()
        count = {}
        for i in _s["items"]:
            count[i.get("folder") or ""] = count.get(i.get("folder") or "", 0) + 1
        return sorted(({"id": f["id"], "name": f["name"], "count": count.get(f["id"], 0)} for f in _s["folders"]),
                      key=lambda f: f["name"].lower())


def folder_save(folder_id, name):
    name = _text(name, 60).strip().strip("/")
    if not name:
        raise Error("Give the folder a name.")
    with _lock:
        _need_open()
        if any(f["name"].lower() == name.lower() and f["id"] != folder_id for f in _s["folders"]):
            raise Error("You already have a folder with that name.")
        f = next((f for f in _s["folders"] if f["id"] == folder_id), None) if folder_id else None
        if folder_id and f is None:
            raise Error("That folder isn't there anymore.")
        if f is None and len(_s["folders"]) >= 100:
            raise Error("That's a lot of folders. Remove one first.")
        try:
            if _s.get("mode") == "bw":
                if f is None:
                    f = bitwarden.create_folder(_s["session"], name)
                    _s["folders"].append(f)
                else:
                    bitwarden.edit_folder(_s["session"], f["id"], name)
            elif f is None:
                f = {"id": secrets.token_hex(6), "name": name}
                _s["folders"].append(f)
        except bitwarden.Error as e:
            raise Error(_bw_said(e))
        f["name"] = name
        _save()
        _s["rev"] += 1
        return dict(f)


def folder_delete(folder_id):
    """The folder goes; what was in it stays, just without a folder."""
    with _lock:
        _need_open()
        f = next((f for f in _s["folders"] if f["id"] == folder_id), None)
        if f is None:
            return
        if _s.get("mode") == "bw":
            try:
                bitwarden.delete_folder(_s["session"], folder_id)
            except bitwarden.Error as e:
                raise Error(_bw_said(e))
            for raw in _s["raw"].values():
                if raw.get("folderId") == folder_id:
                    raw["folderId"] = None
        _s["folders"].remove(f)
        for i in _s["items"]:
            if i.get("folder") == folder_id:
                i["folder"] = ""
        _save()
        _s["rev"] += 1


def set_fav(item_id, on):
    with _lock:
        _need_open()
        old = _find(item_id)
        return public(_put({**old, "fav": bool(on)}, old))


def set_folder(item_id, folder_id):
    with _lock:
        _need_open()
        old = _find(item_id)
        if folder_id and not any(f["id"] == folder_id for f in _s["folders"]):
            raise Error("That folder isn't there anymore.")
        return public(_put({**old, "folder": folder_id or ""}, old))


# ---------------------------------------------------------------- (3.3.0) leaked password check

# Have I Been Pwned's "range" check: only the first 5 letters of the password's SHA-1 go out, and the
# answer is every leaked password starting with them (padded, so even the answer's size says nothing).
# Your password, or even its whole SHA-1, never leaves the PC.
LEAK_URL = os.environ.get("VH_LEAK_URL") or "https://api.pwnedpasswords.com/range/"
_leak = {"busy": False, "cache": {}, "want": set()}


def _sha1(pw):
    return hashlib.sha1(pw.encode("utf-8")).hexdigest().upper()


def _leaked_count(i):
    pw = i.get("password") or ""
    hit = _s["leaked"].get(i.get("id"))
    return hit[1] if pw and hit and hit[0] == _sha1(pw) else 0


def _range(prefix):
    if prefix in _leak["cache"]:
        return _leak["cache"][prefix]
    req = urllib.request.Request(LEAK_URL + prefix, headers={"User-Agent": "VaultHub", "Add-Padding": "true"})
    with urllib.request.urlopen(req, timeout=10) as r:
        text = r.read(2_000_000).decode("ascii", "replace")
    found = {}
    for ln in text.splitlines():
        suffix, _, n = ln.strip().partition(":")
        if n.strip().isdigit() and int(n) > 0:
            found[suffix.upper()] = int(n)
    _leak["cache"][prefix] = found
    return found


def _leak_check_soon(ids=None):
    if not prefs()["leakCheck"]:
        return
    with _lock:
        if not is_open():
            return
        _leak["want"].update(ids or [i["id"] for i in _s["items"] if i.get("password")])
        if _leak["busy"]:
            return
        _leak["busy"] = True
    threading.Thread(target=_leak_loop, daemon=True).start()


def _leak_loop():
    try:
        while True:
            with _lock:
                if not is_open() or not _leak["want"]:
                    _leak["want"].clear()
                    return
                item_id = _leak["want"].pop()
                i = next((x for x in _s["items"] if x.get("id") == item_id), None)
                pw = (i or {}).get("password") or ""
            if not pw:
                continue
            h = _sha1(pw)
            try:
                n = _range(h[:5]).get(h[5:], 0)
            except (OSError, ValueError):
                continue  # offline: try again next time it opens
            with _lock:
                if not is_open():
                    return
                before = _s["leaked"].get(item_id)
                if n:
                    _s["leaked"][item_id] = (h, n)
                else:
                    _s["leaked"].pop(item_id, None)
                if before != _s["leaked"].get(item_id):
                    _s["rev"] += 1
    finally:
        _leak["busy"] = False


# ---------------------------------------------------------------- (3.3.0) Bitwarden

BW_KIND = "VaultHub"  # a hidden field that says "backup codes" on a Bitwarden note
_bwjob = {"step": "", "done": True, "error": "", "need": "", "method": None, "pending": None, "at": 0.0}
ICONS = os.path.join(settings.DATA_DIR, "myvault-icons.json")


def _bw_said(e):
    if getattr(e, "kind", "") == "login":
        return "You're signed out of Bitwarden. Lock MyVault and sign in again."
    return str(e)


def _icon_cache():
    if "_icons" not in _s:
        try:
            with open(ICONS, encoding="utf-8") as f:
                text = f.read()
            if text.startswith(settings.LOCKED):
                text = settings.open_secret(text) or "{}"
            _s["_icons"] = {k: v for k, v in json.loads(text).items() if isinstance(v, str)}
        except (OSError, ValueError, AttributeError):
            _s["_icons"] = {}
    return _s["_icons"]


def _save_icons():
    cache = _icon_cache()
    for i in _s["items"] or []:
        if i.get("site") and i.get("icon"):
            cache[i["site"]] = i["icon"]
    text = json.dumps(cache, separators=(",", ":"))
    text = settings.lock_secret(text) if IS_WINDOWS else text
    try:
        os.makedirs(os.path.dirname(ICONS), exist_ok=True)
        with open(ICONS + ".tmp", "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(ICONS + ".tmp", ICONS)
    except OSError:
        pass


def _when(t):
    try:
        import datetime
        return int(datetime.datetime.fromisoformat(str(t).replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return 0


def _otp_safe(text):
    try:
        return parse_otp(text) if text else None
    except Error:
        return None


def _otp_text(o):
    if not o:
        return None
    if (o.get("algo") or "SHA1") == "SHA1" and int(o.get("digits") or 6) == 6 and int(o.get("period") or 30) == 30 \
            and not o.get("issuer"):
        return o["secret"]
    label = urllib.parse.quote(((o.get("issuer") + ":") if o.get("issuer") else "") + (o.get("account") or ""))
    q = {"secret": o["secret"], "algorithm": o.get("algo") or "SHA1", "digits": o.get("digits") or 6, "period": o.get("period") or 30}
    if o.get("issuer"):
        q["issuer"] = o["issuer"]
    return f"otpauth://totp/{label}?{urllib.parse.urlencode(q)}"


def _from_bw(r):
    """A Bitwarden item as MyVault keeps it, or None for kinds MyVault doesn't show (cards, identities...)."""
    t = r.get("type")
    fields = r.get("fields") or []
    marked = any(isinstance(f, dict) and f.get("name") == BW_KIND and f.get("value") == "backup-codes" for f in fields)
    base = {"id": r.get("id"), "name": str(r.get("name") or "")[:200], "folder": r.get("folderId") or "",
            "fav": bool(r.get("favorite")), "changed": _when(r.get("revisionDate")), "created": _when(r.get("creationDate")),
            "text": str(r.get("notes") or ""), "user": "", "password": "", "otp": None, "site": "", "icon": ""}
    if not base["id"]:
        return None
    if t == 1:
        lg = r.get("login") or {}
        for u in lg.get("uris") or []:
            site = _clean_site((u or {}).get("uri"))
            if site:
                base["site"] = site
                break
        base.update(kind="account", user=str(lg.get("username") or ""), password=str(lg.get("password") or ""),
                    otp=_otp_safe(lg.get("totp")))
    elif t == 2:
        base["kind"] = "codes" if marked else "note"
    else:
        return None
    base["icon"] = _icon_cache().get(base["site"], "") if base["site"] else ""
    return base


def _to_bw(item, raw):
    """MyVault's item as Bitwarden's, keeping everything MyVault doesn't show (other links, fields, notes...)."""
    r = json.loads(json.dumps(raw)) if raw else {
        "organizationId": None, "collectionIds": None, "folderId": None, "type": 1, "name": "", "notes": None,
        "favorite": False, "fields": [], "login": None, "secureNote": None, "card": None, "identity": None, "reprompt": 0}
    r["name"] = item["name"]
    r["folderId"] = item.get("folder") or None
    r["favorite"] = bool(item.get("fav"))
    if item["kind"] == "account":
        r["type"] = 1
        lg = r.get("login") or {"uris": [], "username": None, "password": None, "totp": None}
        lg["username"] = item.get("user") or None
        lg["password"] = item.get("password") or None
        if item.get("otp") != _otp_safe(lg.get("totp")):  # only when it changed (keeps e.g. Steam's own kind)
            lg["totp"] = _otp_text(item.get("otp"))
        uris = [u for u in lg.get("uris") or [] if isinstance(u, dict)]
        site = item.get("site") or ""
        if site and not any(_clean_site(u.get("uri")) == site for u in uris):
            uris.insert(0, {"match": None, "uri": "https://" + site})
        elif not site and uris and not raw:
            uris = []
        lg["uris"] = uris
        r["login"] = lg
        if not raw:
            r["notes"] = item.get("text") or None
    else:
        r["type"] = 2
        r["secureNote"] = r.get("secureNote") or {"type": 0}
        r["notes"] = item.get("text") or None
        fields = [f for f in r.get("fields") or [] if not (isinstance(f, dict) and f.get("name") == BW_KIND)]
        if item["kind"] == "codes":
            fields.append({"name": BW_KIND, "value": "backup-codes", "type": 0, "linkedId": None})
        r["fields"] = fields
    return r


def _load_bw(session, do_sync):
    """Reads everything from the tool into memory (the tool's copy; do_sync first asks Bitwarden for news)."""
    offline = False
    if do_sync:
        try:
            bitwarden.sync(session)
        except bitwarden.Error as e:
            if e.kind == "login":
                raise
            offline = True
    raws = bitwarden.items(session)
    fl = bitwarden.folders(session)
    got, raw, hidden = [], {}, 0
    for r in raws:
        i = _from_bw(r)
        if i:
            got.append(i)
            raw[i["id"]] = r
        else:
            hidden += 1
    return got, raw, fl, hidden, offline


def _open_bw(session, W):
    got, raw, fl, hidden, offline = _load_bw(session, False)
    with _lock:
        _s.update(key=b"bw", mode="bw", session=session, items=got, raw=raw, folders=fl, hidden=hidden,
                  W=W, sealed=None, pinfails=0, last=time.time(), leaked={}, offline=offline)
        _s["rev"] += 1
    threading.Thread(target=_sync_now, daemon=True).start()
    threading.Thread(target=bitwarden.update_if_old, daemon=True).start()
    _leak_check_soon()


def _sync_now():
    with _lock:
        if _s.get("mode") != "bw" or not _s["session"] or _s["syncing"]:
            return
        _s["syncing"] = True
        session = _s["session"]
    try:
        got, raw, fl, hidden, offline = _load_bw(session, True)
    except bitwarden.Error:
        with _lock:
            _s.update(syncing=False, offline=True)
        return
    with _lock:
        _s["syncing"] = False
        if _s["session"] != session:
            return
        before = {i["id"]: i.get("password") for i in _s["items"]}
        _s.update(items=got, raw=raw, folders=fl, hidden=hidden, offline=offline)
        if not offline:
            _s["synced"] = time.time()
        _s["rev"] += 1
    changed = [i["id"] for i in got if i.get("password") and before.get(i["id"]) != i["password"]]
    if changed:
        _leak_check_soon(changed)


def sync():
    with _lock:
        _need_open()
        if _s.get("mode") != "bw":
            raise Error("Only with Bitwarden.")
    threading.Thread(target=_sync_now, daemon=True).start()
    return {"ok": True}


def sync_if_old():
    """Every 10 minutes while it's open, Bitwarden is asked what changed (on your phone, say)."""
    if _s.get("mode") == "bw" and _s["session"] and not _s["syncing"] and time.time() - _s["synced"] > 600:
        threading.Thread(target=_sync_now, daemon=True).start()


# -- the quick PIN: while VaultHub stays open, a PIN opens it again instead of the master password.
# The PIN unlocks a key W (made from the master password), and W unlocks the session key, which is only
# ever kept in memory. After a restart there's no session key anymore, so it's the master password again.

def _pin_saved():
    p = settings.load().get("bw_pin")
    return isinstance(p, dict) and bool(p.get("wrap"))


def _master_key(password):
    c = settings.load()
    salt = c.get("bw_msalt")
    if not salt:
        salt = _b64(secrets.token_bytes(16))
        settings.save(bw_msalt=salt)
    return _derive(password, _unb64(salt), KDF)


def pin_set(pin):
    pin = _check_pin(pin)
    with _lock:
        _need_open()
        if _s.get("mode") != "bw" or not _s["W"]:
            raise Error("Lock MyVault and open it with your master password first.")
        salt = secrets.token_bytes(16)
        W = _s["W"]
    wrap = seal(_derive(pin, salt, KDF), W, b"bwpin")
    settings.save(bw_pin={"salt": _b64(salt), "kdf": dict(KDF), "wrap": _b64(wrap),
                          "check": hmac.new(W, b"vaulthub-quick-pin", hashlib.sha256).hexdigest()})
    return state()


def pin_off():
    settings.save(bw_pin=None)
    _s["sealed"] = None
    return state()


def unlock_pin(pin):
    pin = _check_pin(pin)
    p = settings.load().get("bw_pin") or {}
    sealed = _s["sealed"]
    if not sealed or not p.get("wrap"):
        raise Error("Type your master password.")
    try:
        W = unseal(_derive(pin, _unb64(p["salt"]), p["kdf"]), _unb64(p["wrap"]), b"bwpin")
        session = unseal(W, sealed, b"bwsession").decode()
    except Error:
        _s["pinfails"] += 1
        left = 5 - _s["pinfails"]
        if left <= 0:
            _s["sealed"] = None
            threading.Thread(target=bitwarden.lock, daemon=True).start()
            raise Error("Wrong PIN 5 times. Type your master password now.")
        raise Error(f"Wrong PIN. {left} {'try' if left == 1 else 'tries'} left.")
    try:
        _open_bw(session, W)
    except bitwarden.Error as e:
        _s["sealed"] = None
        raise Error(_bw_said(e))
    return state()


def unlock_master(password):
    password = str(password or "")
    if not password:
        raise Error("Type your master password.")
    try:
        session = bitwarden.unlock(password)
    except bitwarden.Error as e:
        if e.kind == "login":
            settings.save(bw_email=None)
            raise Error("You're signed out of Bitwarden. Sign in again.")
        raise Error(str(e))
    W = _master_key(password)
    p = settings.load().get("bw_pin") or {}
    if p.get("check") and p["check"] != hmac.new(W, b"vaulthub-quick-pin", hashlib.sha256).hexdigest():
        settings.save(bw_pin=None)  # the master password changed: set the quick PIN up again
    try:
        _open_bw(session, W)
    except bitwarden.Error as e:
        raise Error(_bw_said(e))
    return state()


# -- connecting (a job in the background: the first time it downloads Bitwarden's tool)

def connect(email, password, server="us", custom=""):
    email = str(email or "").strip().lower()
    password = str(password or "")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise Error("Type the email of your Bitwarden account.")
    if not password:
        raise Error("Type your master password.")
    url = bitwarden.server_url(server, custom)
    if not _bwjob["done"]:
        raise Error("Hang on, it's still connecting.")
    _bwjob.update(step="start", done=False, error="", need="", method=None, at=time.time(),
                  pending={"email": email, "password": password, "url": url})
    threading.Thread(target=_connect_job, daemon=True).start()
    return job()


def connect_more(what, code="", method=None, client_id="", client_secret=""):
    """The next step after Bitwarden asked for something: a two-step code, an email code, or an API key."""
    p = _bwjob.get("pending")
    if not p or time.time() - _bwjob["at"] > 900:
        _bwjob["pending"] = None
        raise Error("That took a while, so start again.")
    if not _bwjob["done"]:
        raise Error("Hang on, it's still connecting.")
    code = re.sub(r"\s", "", str(code or ""))
    kw = {}
    if what == "code":
        if not code:
            raise Error("Type the code.")
        kw = {"method": 1 if method == "email" else 3 if method == "key" else 0, "code": code}
    elif what == "send-email":
        kw = {"method": 1}
    elif what == "device":
        if not code:
            raise Error("Type the code from the email.")
        kw = {"device_code": code}
    elif what == "apikey":
        client_id, client_secret = str(client_id or "").strip(), str(client_secret or "").strip()
        if not client_id.startswith("user.") or len(client_secret) < 10:
            raise Error("Paste both: client_id (starts with user.) and client_secret.")
        kw = {"apikey": (client_id, client_secret)}
    else:
        raise Error("Something about that wasn't right.")
    _bwjob.update(step="login", done=False, error="", need="", at=time.time())
    threading.Thread(target=_connect_job, kwargs=kw, daemon=True).start()
    return job()


def connect_cancel():
    _bwjob.update(pending=None, need="", error="", step="")
    return state()


def job():
    j = _bwjob
    out = {"step": j["step"], "done": j["done"], "error": j["error"], "need": j["need"], "method": j["method"]}
    if j["step"] == "download":
        out.update(got=bitwarden.progress["got"], total=bitwarden.progress["total"])
    if j["done"] and not j["error"] and not j["need"]:
        out["state"] = state()
    return out


def _connect_job(method=None, code=None, device_code=None, apikey=None):
    p = _bwjob["pending"]
    try:
        if not bitwarden.have_tool():
            _bwjob["step"] = "download"
            bitwarden.install()
        _bwjob["step"] = "login"
        st = bitwarden.status()
        if st.get("status") in ("locked", "unlocked") and (str(st.get("userEmail") or "").lower() != p["email"]
                                                          or str(st.get("serverUrl") or bitwarden.SERVERS["us"]).rstrip("/") != p["url"]):
            bitwarden.logout()
            st = {"status": "unauthenticated"}
        if st.get("status") in (None, "", "unauthenticated"):
            bitwarden.set_server(p["url"])
            if apikey:
                bitwarden.login_apikey(*apikey)
                session = bitwarden.unlock(p["password"])
            else:
                session = bitwarden.login(p["email"], p["password"], method=method, code=code, device_code=device_code)
        else:
            session = bitwarden.unlock(p["password"])
        _bwjob["step"] = "open"
        W = _master_key(p["password"])
        settings.save(bw_email=p["email"], bw_server=p["url"], bw_pin=None)
        with _lock:
            if _s.get("mode") == "local" and is_open():
                _s.update(key=None, items=None)
        _open_bw(session, W)
        _bwjob.update(pending=None, step="done")
    except bitwarden.Error as e:
        if e.kind == "2fa":
            _bwjob.update(need="code", method="email" if method == 1 else _bwjob["method"])
            if code:
                _bwjob["error"] = "That code didn't work. Try again."
        elif e.kind == "device":
            _bwjob["need"] = "device"
            if device_code:
                _bwjob["error"] = "That code didn't work. Try again."
        elif e.kind == "option" and device_code:
            _bwjob["need"] = "apikey"
        else:
            _bwjob.update(error=str(e), pending=None)
    except Error as e:
        _bwjob.update(error=str(e), pending=None)
    except OSError:
        _bwjob.update(error="Couldn't save Bitwarden's tool on this PC.", pending=None)
    finally:
        _bwjob["done"] = True


def sign_out():
    with _lock:
        lock()
        _s["sealed"] = None
    bitwarden.logout()
    settings.save(bw_email=None, bw_pin=None)
    return state()


# -- moving the old MyVault (PIN, only on this PC) into Bitwarden

def _read_local(pin):
    pin = _check_pin(pin)
    left = _wait_left()
    if left:
        raise Error(f"Too many wrong tries. Wait {_nice_wait(left)}.")
    data = _read_file()
    if data is None:
        raise Error("There's no old MyVault on this PC.")
    try:
        key = unseal(_derive(pin, _unb64(data["salt"]), data["kdf"]), _unb64(data["wrap"]), b"wrap")
    except Error:
        _wrong_try()
        raise Error("That isn't your old MyVault PIN.")
    _right_try()
    body = json.loads(unseal(key, _unb64(data["data"]), b"items"))
    return ([i for i in body.get("items") or [] if isinstance(i, dict) and i.get("id")],
            [f for f in body.get("folders") or [] if isinstance(f, dict) and f.get("id")])


def old_delete():
    """Forgot the old MyVault's PIN: it can only be deleted (there's no other way in, on purpose)."""
    with _lock:
        _need_open()
        if _s.get("mode") != "bw":
            raise Error("Connect Bitwarden first.")
    try:
        os.remove(PATH)
    except FileNotFoundError:
        pass
    settings.save(mv_fails=0, mv_wait_until=0)
    return state()


def move_preview(pin):
    with _lock:
        _need_open()
    got, fl = _read_local(pin)
    return {"items": [public(i) for i in got], "folders": len(fl)}


def move_to_bw(pin):
    """Everything in the old MyVault goes into Bitwarden; then the old file is deleted."""
    with _lock:
        _need_open()
        if _s.get("mode") != "bw":
            raise Error("Connect Bitwarden first.")
    got, fl = _read_local(pin)
    moved, failed = 0, []
    with _lock:
        _need_open()
        ids = {}
        for f in fl:
            same = next((x for x in _s["folders"] if x["name"].lower() == str(f.get("name") or "").lower()), None)
            if same:
                ids[f["id"]] = same["id"]
                continue
            try:
                new = bitwarden.create_folder(_s["session"], str(f.get("name") or "Folder")[:60])
                _s["folders"].append(new)
                ids[f["id"]] = new["id"]
            except bitwarden.Error:
                pass
        for i in got:
            i = {**i, "folder": ids.get(i.get("folder") or "", ""), "id": "new-" + secrets.token_hex(6)}
            try:
                _put(i, None)
                moved += 1
            except Error:
                failed.append(i.get("name") or "?")
    if not failed:
        try:
            os.remove(PATH)
        except OSError:
            pass
    _leak_check_soon()
    return {"moved": moved, "failed": failed, "state": state()}


def at_exit():
    """VaultHub is closing: Bitwarden's tool is locked again too (the session key is gone with us anyway)."""
    if _s.get("mode") == "bw" and (_s["session"] or _s["sealed"]):
        _s.update(session=None, sealed=None)
        bitwarden.lock()
