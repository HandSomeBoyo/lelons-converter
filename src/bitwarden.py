"""(3.3.0) Bitwarden inside MyVault: VaultHub drives Bitwarden's own official command line tool (bw.exe).

- The tool comes from Bitwarden's GitHub releases (bitwarden/clients, "cli-v..."), and its SHA-256 is checked
  against the checksum file Bitwarden publishes next to it before it's used. VaultHub looks for a newer one
  once a day and swaps it in.
- The tool keeps its own (encrypted) copy of the vault in DATA_DIR/bw, away from any other Bitwarden install.
- The master password only goes to the tool, in an environment variable of that one run (never on the
  command line, never saved). The session key the tool gives back lives only in memory (myvault.py).
- New and changed items go to the tool through stdin, also never on the command line.
"""
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import threading
import time
import urllib.request
import zipfile

import settings

IS_WINDOWS = os.name == "nt"
DIR = os.path.join(settings.DATA_DIR, "bw")
EXE = os.environ.get("VH_BW_EXE") or os.path.join(DIR, "bw.exe" if IS_WINDOWS else "bw")
RELEASES = os.environ.get("VH_BW_RELEASES") or "https://api.github.com/repos/bitwarden/clients/releases?per_page=60"
SERVERS = {"us": "https://vault.bitwarden.com", "eu": "https://vault.bitwarden.eu"}
UA = "VaultHub"

_run = threading.Lock()  # one tool run at a time (they share one data file)
progress = {"got": 0, "total": 0}


class Error(Exception):
    """kind: "" | "2fa" (needs a two-step code) | "device" (new device check) | "login" (not signed in)
    | "password" (wrong master password) | "net" (no internet) | "option" (the tool doesn't know a flag)."""
    def __init__(self, text, kind="", raw=""):
        super().__init__(text)
        self.kind = kind
        self.raw = raw


def have_tool():
    return os.path.isfile(EXE)


def server_url(server, custom=""):
    if server in SERVERS:
        return SERVERS[server]
    url = str(custom or "").strip().rstrip("/")
    if not re.fullmatch(r"https://[a-z0-9.-]+(:\d+)?(/[\w./-]*)?", url, re.I):
        raise Error("Type your server's address, like https://vault.example.com.")
    return url


# ---------------------------------------------------------------- running the tool

def _nice(raw):
    t = str(raw or "").strip()
    low = t.lower()
    if re.search(r"new device|device verification|newdeviceotp", low) and "unknown option" not in low:
        return Error("Bitwarden wants to check this new PC.", "device", t)
    if "unknown option" in low:
        return Error("Bitwarden's tool doesn't know that step.", "option", t)
    if re.search(r"two-step|two factor|2fa|code is required|no provider selected|verification code", low):
        return Error("Bitwarden wants your two-step login code.", "2fa", t)
    if re.search(r"invalid master password", low):
        return Error("That isn't your master password.", "password", t)
    if re.search(r"username or password is incorrect|invalid_grant|incorrect", low):
        return Error("Wrong email or master password.", "password", t)
    if re.search(r"not logged in|you are not logged|unauthenticated", low):
        return Error("You're signed out of Bitwarden.", "login", t)
    if re.search(r"invalid.*code|code.*invalid|two-step token is invalid", low):
        return Error("That code didn't work. Try a new one.", "2fa", t)
    if re.search(r"fetch failed|enotfound|econnrefused|etimedout|getaddrinfo|network|socket hang up|eai_again", low):
        return Error("Couldn't reach Bitwarden. Check your internet.", "net", t)
    return Error("Bitwarden said: " + (t.splitlines()[0][:200] if t else "nothing. Try again."), "", t)


def run(args, session=None, stdin=None, env=None, timeout=90):
    """Runs bw with --response and gives back its "data" (or raises Error)."""
    if not have_tool():
        raise Error("Bitwarden's tool isn't downloaded yet.")
    e = {k: v for k, v in os.environ.items() if not k.startswith("BW_")}
    e.update(BITWARDENCLI_APPDATA_DIR=DIR, BW_NOINTERACTION="true")
    if session:
        e["BW_SESSION"] = session
    e.update(env or {})
    os.makedirs(DIR, exist_ok=True)
    cmd = [EXE, *args, "--response", "--nointeraction"]
    with _run:
        try:
            p = subprocess.run(cmd, input=stdin, capture_output=True, text=True, encoding="utf-8", errors="replace",
                               env=e, timeout=timeout, cwd=DIR, creationflags=0x08000000 if IS_WINDOWS else 0)
        except subprocess.TimeoutExpired:
            raise Error("Bitwarden took too long. Try again.", "net")
        except OSError:
            raise Error("Couldn't start Bitwarden's tool.")
    out = (p.stdout or "").strip()
    try:
        r = json.loads(out[out.index("{"):]) if "{" in out else None
    except ValueError:
        r = None
    if not isinstance(r, dict):
        raise _nice(p.stderr or out)
    if not r.get("success"):
        raise _nice(r.get("message") or p.stderr)
    return r.get("data")


def _raw_key(data):
    """The session key from login/unlock."""
    if isinstance(data, dict):
        if data.get("raw"):
            return str(data["raw"]).strip()
        m = re.search(r'BW_SESSION="?([A-Za-z0-9+/=]{40,})', str(data.get("message") or ""))
        if m:
            return m.group(1)
    raise Error("Bitwarden didn't open. Try again.")


def _b64json(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()


# ---------------------------------------------------------------- what the tool does for MyVault

def status():
    d = run(["status"], timeout=30) or {}
    if isinstance(d, dict) and isinstance(d.get("template"), dict):
        d = d["template"]
    return d if isinstance(d, dict) else {}


def set_server(url):
    run(["config", "server", url], timeout=30)


def login(email, password, method=None, code=None, device_code=None):
    args = ["login", email, "--passwordenv", "VH_BW_PASSWORD"]
    if method is not None:
        args += ["--method", str(method)]
    if code:
        args += ["--code", str(code)]
    if device_code:
        args += ["--newdeviceotp", str(device_code)]
    return _raw_key(run(args, env={"VH_BW_PASSWORD": password}, timeout=120))


def login_apikey(client_id, client_secret):
    run(["login", "--apikey"], env={"BW_CLIENTID": client_id, "BW_CLIENTSECRET": client_secret}, timeout=120)


def unlock(password):
    return _raw_key(run(["unlock", "--passwordenv", "VH_BW_PASSWORD"], env={"VH_BW_PASSWORD": password}, timeout=120))


def sync(session):
    run(["sync"], session=session, timeout=120)


def items(session):
    d = run(["list", "items"], session=session, timeout=120)
    return [i for i in (d.get("data") if isinstance(d, dict) else d) or [] if isinstance(i, dict) and not i.get("deletedDate")]


def folders(session):
    d = run(["list", "folders"], session=session)
    return [{"id": f["id"], "name": str(f.get("name") or "")} for f in (d.get("data") if isinstance(d, dict) else d) or []
            if isinstance(f, dict) and f.get("id")]


def create_item(session, obj):
    return run(["create", "item"], session=session, stdin=_b64json(obj))


def edit_item(session, item_id, obj):
    return run(["edit", "item", item_id], session=session, stdin=_b64json(obj))


def delete_item(session, item_id):
    """Goes to Bitwarden's trash (kept there 30 days), like deleting in Bitwarden's own apps."""
    run(["delete", "item", item_id], session=session)


def create_folder(session, name):
    d = run(["create", "folder"], session=session, stdin=_b64json({"name": name}))
    return {"id": d["id"], "name": d.get("name") or name}


def edit_folder(session, folder_id, name):
    run(["edit", "folder", folder_id], session=session, stdin=_b64json({"name": name}))


def delete_folder(session, folder_id):
    run(["delete", "folder", folder_id], session=session)


def lock():
    try:
        run(["lock"], timeout=30)
    except Error:
        pass


def logout():
    try:
        run(["logout"], timeout=30)
    except Error:
        pass


# ---------------------------------------------------------------- getting the tool, and keeping it new

def _get(url, limit=200_000_000, step=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=30) as r:
        total = int(r.headers.get("Content-Length") or 0)
        buf = io.BytesIO()
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            buf.write(chunk)
            if buf.tell() > limit:
                raise Error("That download was too big.")
            if step:
                step(buf.tell(), total)
        return buf.getvalue()


def _ver(v):
    return tuple(int(x) for x in re.findall(r"\d+", str(v or ""))[:4])


GH = "https://api.github.com/repos/bitwarden/clients/releases"
DL = "https://github.com/bitwarden/clients/releases/download"
NPM = "https://registry.npmjs.org/@bitwarden/cli/latest"
PLAT = "windows" if IS_WINDOWS else "linux"


def _pick(assets, ver):
    """The tool's zip and its checksum file among a release's files (Bitwarden also ships an "oss" build)."""
    names = {a.get("name") or "": a.get("browser_download_url") for a in assets or [] if isinstance(a, dict)}
    zips = [n for n in names if n.endswith(".zip") and f"bw-{PLAT}" in n and "sha" not in n]
    sums = [n for n in names if n.endswith(".txt") and PLAT in n and "sha256" in n]
    z = next((n for n in zips if "oss" not in n), zips[0] if zips else None)
    if not z:
        return None
    s = next((n for n in sums if ("oss" in n) == ("oss" in z)), sums[0] if sums else None)
    if not s:
        return None
    return ver, names[z], names[s]


def _newest_version():
    """Bitwarden's newest CLI version, from npm (Bitwarden publishes it there too, and npm has no hourly limit)."""
    try:
        v = str(json.loads(_get(NPM, 2_000_000)).get("version") or "")
        return v if re.fullmatch(r"\d+\.\d+\.\d+", v) else ""
    except (OSError, ValueError, AttributeError):
        return ""


def latest():
    """(version, zip url, checksum url) of the newest tool on Bitwarden's GitHub."""
    errors = []
    ver = _newest_version()
    if ver:  # 1) the release for that version
        try:
            r = json.loads(_get(f"{GH}/tags/cli-v{ver}", 5_000_000))
            got = _pick(r.get("assets"), ver) if isinstance(r, dict) else None
            if got:
                return got
            errors.append("tag: " + str((r or {}).get("message") or "no matching files")[:120])
        except (OSError, ValueError) as e:
            errors.append(f"tag: {e}")
    for page in (1, 2, 3):  # 2) look through the release list
        try:
            rel = json.loads(_get(f"{RELEASES.split('?')[0]}?per_page=100&page={page}", 20_000_000))
        except (OSError, ValueError) as e:
            errors.append(f"list: {e}")
            break
        if not isinstance(rel, list):
            errors.append("list: " + str((rel or {}).get("message"))[:120])
            break
        best = None
        for r in rel:
            tag = str(r.get("tag_name") or "")
            if tag.startswith("cli-v") and not r.get("draft") and not r.get("prerelease"):
                got = _pick(r.get("assets"), tag[5:])
                if got and (best is None or _ver(got[0]) > _ver(best[0])):
                    best = got
        if best:
            return best
        if len(rel) < 100:
            break
    if ver:  # 3) GitHub's API is busy (it allows 60 asks an hour): the usual file names
        return ver, f"{DL}/cli-v{ver}/bw-{PLAT}-{ver}.zip", f"{DL}/cli-v{ver}/bw-{PLAT}-sha256-{ver}.txt"
    print("bitwarden: couldn't find the tool:", "; ".join(errors), flush=True)
    raise Error("Couldn't reach GitHub to get Bitwarden's tool. Check your internet and try again.", "net")


def install(want=None):
    """Downloads the tool, checks it against Bitwarden's checksum, and puts it in place."""
    ver, zip_url, sum_url = want or latest()
    try:
        sums = _get(sum_url, 100_000).decode("utf-8", "replace")
    except OSError as e:
        print("bitwarden: checksum file:", sum_url, e, flush=True)
        raise Error("Couldn't get Bitwarden's checksum file. Try again in a bit.", "net")
    good = {h.lower() for h in re.findall(r"\b[0-9a-fA-F]{64}\b", sums)}
    if not good:
        raise Error("Bitwarden's checksum file looked wrong, so the tool wasn't used.")
    progress.update(got=0, total=0)
    try:
        data = _get(zip_url, step=lambda got, total: progress.update(got=got, total=total))
    except OSError as e:
        print("bitwarden: download:", zip_url, e, flush=True)
        raise Error("The download stopped. Check your internet and try again.", "net")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        name = next(n for n in z.namelist() if os.path.basename(n) in ("bw.exe", "bw"))
        exe = z.read(name)
    except (zipfile.BadZipFile, StopIteration, KeyError):
        raise Error("The download was broken. Try again.")
    if hashlib.sha256(data).hexdigest() not in good and hashlib.sha256(exe).hexdigest() not in good:
        raise Error("The download didn't match Bitwarden's checksum, so it wasn't used.")
    os.makedirs(DIR, exist_ok=True)
    tmp = EXE + ".new"
    with open(tmp, "wb") as f:
        f.write(exe)
    if not IS_WINDOWS:
        os.chmod(tmp, 0o755)
    with _run:
        os.replace(tmp, EXE)
    settings.save(bw_tool_ver=ver, bw_tool_checked=time.time())
    return ver


def update_if_old():
    """Once a day: a newer tool from Bitwarden? Then swap it in (quietly; the old one keeps working if not)."""
    c = settings.load()
    if os.environ.get("VH_BW_EXE") or not have_tool() or time.time() - float(c.get("bw_tool_checked") or 0) < 86400:
        return
    settings.save(bw_tool_checked=time.time())
    try:
        want = latest()
        if _ver(want[0]) > _ver(c.get("bw_tool_ver")):
            install(want)
    except Error:
        pass


def tool_version():
    return str(settings.load().get("bw_tool_ver") or "")
