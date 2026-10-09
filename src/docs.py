"""The Docs tab: documents and movie scripts.

Local docs are files on this computer only (in the app's data folder) and are never sent anywhere,
so nobody else can see them, not even the owner of the Library. Collab docs live in Supabase (see
sfx/setup.sql): only the person who made one and the people they invited (and who said yes) can
open it. The page does the writing; this keeps the files and talks to Supabase.

A document is a list of blocks (a paragraph, a heading, a list...): {"id", "pos", "html"}. pos is
text that sorts the blocks, so people can add blocks at the same time without mixing them up.
"""

import json
import os
import re
import threading
import time
import uuid

import names
import settings
import sfx

FOLDER = os.path.join(settings.DATA_DIR, "Docs")
KINDS = ("doc", "script")
MAX_BYTES = 30 * 1024 * 1024  # one local doc (pictures are inside it)
EXPORTS = {"txt": "text/plain", "doc": "application/msword", "fountain": "text/plain", "html": "text/html"}

_lock = threading.Lock()
_ID = re.compile(r"[0-9a-f]{32}$")


class Error(Exception):
    """Shown to the user as it is."""


def _clean_blocks(blocks):
    """The blocks as the page sent them, checked a little (the page cleans the html itself)."""
    out = []
    for block in blocks if isinstance(blocks, list) else []:
        if not isinstance(block, dict):
            continue
        block_id, pos, html = str(block.get("id") or "")[:40], str(block.get("pos") or ""), block.get("html")
        if block_id and 0 < len(pos) <= 1000 and isinstance(html, str):
            out.append({"id": block_id, "pos": pos, "html": html})
    out.sort(key=lambda b: (b["pos"], b["id"]))
    return out


def _settings(value):
    """The page settings (page size, font...) as the page sent them: a small dict of plain values."""
    if not isinstance(value, dict):
        return {}
    out = {}
    for key, v in list(value.items())[:30]:
        if isinstance(key, str) and len(key) <= 30 and (isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) <= 120)):
            out[key] = v
    return out


def _title(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:150] or "Untitled document"


# ---------------------------------------------------------------- local docs

def _path(doc_id):
    if not _ID.match(str(doc_id or "")):
        raise Error("That document isn't there any more.")
    return os.path.join(FOLDER, doc_id + ".json")


def _read(doc_id):
    try:
        with open(_path(doc_id), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        raise Error("That document isn't there any more.") from None
    return doc if isinstance(doc, dict) else {}


def _write(doc):
    os.makedirs(FOLDER, exist_ok=True)
    path = _path(doc["id"])
    text = json.dumps(doc, ensure_ascii=False)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise Error("This document is too big to save. Take out some pictures.")
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        f.write(text)
    for attempt in range(6):  # Windows: something (a virus scanner) may have the old one open for a moment
        try:
            os.replace(temp, path)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.1)


def _summary(doc):
    blocks = doc.get("blocks") or []
    return {"id": doc["id"], "title": _title(doc.get("title")), "kind": doc.get("kind", "doc"),
            "updated_at": doc.get("updated", 0), "preview": [b["html"][:2000] for b in [b for b in blocks if "~" not in b["id"]][:14]],
            "settings": doc.get("settings") or {}, "pages": 1 + sum(1 for b in blocks if b["id"].startswith("t~"))}


_summaries = {}  # id -> ((mtime, size), summary): the list is asked for often, the files can be big


def local_list():
    docs = []
    try:
        names_ = os.listdir(FOLDER)
    except OSError:
        names_ = []
    for name in names_:
        if name.endswith(".json") and _ID.match(name[:-5]):
            try:
                st = os.stat(os.path.join(FOLDER, name))
                stamp = (st.st_mtime_ns, st.st_size)
                kept = _summaries.get(name[:-5])
                if not kept or kept[0] != stamp:
                    kept = _summaries[name[:-5]] = (stamp, _summary(_read(name[:-5])))
                docs.append(kept[1])
            except (Error, OSError):
                pass
    docs.sort(key=lambda d: d["updated_at"], reverse=True)
    return docs


def local_create(title, kind, blocks, settings_=None):
    doc = {"id": uuid.uuid4().hex, "title": _title(title), "kind": kind if kind in KINDS else "doc", "settings": _settings(settings_),
           "created": time.time(), "updated": time.time(), "blocks": _clean_blocks(blocks)}
    with _lock:
        _write(doc)
    return doc


def local_open(doc_id):
    return _read(doc_id)


def local_save(doc_id, title, blocks, settings_=None):
    with _lock:
        doc = _read(doc_id)
        if title is not None:
            doc["title"] = _title(title)
        if settings_ is not None:
            doc["settings"] = _settings(settings_)
        if blocks is not None:
            doc["blocks"] = _clean_blocks(blocks)
        doc["updated"] = time.time()
        _write(doc)
    return doc["updated"]


def local_delete(doc_id):
    with _lock:
        try:
            os.remove(_path(doc_id))
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------- folders (only on this computer)

FOLDERS_FILE = os.path.join(FOLDER, "folders.json")
_FOLDER_ID = re.compile(r"[0-9a-z]{4,16}$")


def _clean_folders(value):
    """{"local": {...}, "collab": {...}}, each {"folders": [{id, name, parent}], "place": {doc id: folder id}}."""
    out = {}
    for where in ("local", "collab"):
        part = value.get(where) if isinstance(value, dict) else None
        part = part if isinstance(part, dict) else {}
        folders, ids = [], set()
        for f in part.get("folders") if isinstance(part.get("folders"), list) else []:
            if isinstance(f, dict) and _FOLDER_ID.match(str(f.get("id") or "")) and f["id"] not in ids and len(folders) < 500:
                name = re.sub(r"\s+", " ", str(f.get("name") or "")).strip()[:80] or "New folder"
                folders.append({"id": f["id"], "name": name, "parent": str(f.get("parent") or "")})
                ids.add(f["id"])
        for f in folders:
            if f["parent"] not in ids or f["parent"] == f["id"]:
                f["parent"] = ""
        place = part.get("place") if isinstance(part.get("place"), dict) else {}
        place = {str(k)[:40]: v for k, v in list(place.items())[:5000] if v in ids}
        out[where] = {"folders": folders, "place": place}
    return out


def folders_get():
    try:
        with open(FOLDERS_FILE, encoding="utf-8") as f:
            return _clean_folders(json.load(f))
    except (OSError, ValueError):
        return _clean_folders({})


def folders_set(value):
    clean = _clean_folders(value)
    os.makedirs(FOLDER, exist_ok=True)
    with _lock:
        temp = FOLDERS_FILE + ".tmp"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False)
        for attempt in range(6):
            try:
                os.replace(temp, FOLDERS_FILE)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(0.1)
    return clean


# ---------------------------------------------------------------- collab docs (Supabase)

FRIENDLY = {
    "doc_gone": "That document isn't there any more, or you're not in it any more.",
    "doc_many": "You've made as many shared documents as you can. Delete some old ones first.",
    "doc_long": "This document is as long as it can get. Start a new one for the next part.",
    "doc_big": "This document is too big. Take out some pictures.",
    "doc_people": "A document can have up to 50 people.",
    "comment_gone": "That comment isn't there any more.",
    "comment_many": "This document has as many comments as it can. Delete some old ones first.",
}
sfx.FRIENDLY.update(FRIENDLY)  # so Supabase's answers come out in these words


def _rpc(name, **args):
    try:
        return sfx._rpc(name, token=sfx.library._token(), **args)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        raise Error(str(e)) from None


def _with_avatars(people):
    return [{**p, "avatarUrl": sfx.public_url(p["avatar"]) if p.get("avatar") else ""} for p in people or []]


def collab_list():
    result = _rpc("lelons_docs") or {}
    return {"docs": [{**d, "people": _with_avatars(d.get("people"))} for d in result.get("docs") or []],
            "invites": [{**i, "avatarUrl": sfx.public_url(i["avatar"]) if i.get("avatar") else ""}
                        for i in result.get("invites") or []]}


def collab_create(title, kind, blocks, settings_=None):
    return _rpc("lelons_doc_create", title=_title(title), kind=kind if kind in KINDS else "doc",
                blocks=_clean_blocks(blocks), doc_settings=_settings(settings_))


def collab_open(doc_id):
    doc = _rpc("lelons_doc_open", doc_id=str(doc_id))
    return {**doc, "people": _with_avatars(doc.get("people"))}


def collab_sync(doc_id, since, changes, title, block, typing, settings_=None):
    clean = []
    for change in changes if isinstance(changes, list) else []:
        if isinstance(change, dict) and change.get("id") and change.get("pos") and len(str(change["pos"])) <= 1000:
            clean.append({"id": str(change["id"])[:40], "pos": str(change["pos"]),
                          "html": str(change.get("html") or ""), "deleted": bool(change.get("deleted"))})
    try:
        since = max(0, int(since or 0))
    except (TypeError, ValueError):
        since = 0
    result = _rpc("lelons_doc_sync", doc_id=str(doc_id), since_rev=since, changes=clean,
                  new_title=_title(title) if title is not None else None,
                  at_block=str(block)[:40] if block else None, typing=bool(typing),
                  new_settings=_settings(settings_) if settings_ is not None else None)
    return {**result, "here": _with_avatars(result.get("here")), "people": _with_avatars(result.get("people"))}


def collab_close(doc_id):
    _rpc("lelons_doc_close", doc_id=str(doc_id))


def collab_people():
    return _with_avatars(_rpc("lelons_doc_people"))


def collab_invite(doc_id, usernames):
    people = [str(u) for u in usernames if isinstance(u, str) and u.strip()][:50] if isinstance(usernames, list) else []
    return _with_avatars(_rpc("lelons_doc_invite", doc_id=str(doc_id), usernames=people))


def collab_answer(doc_id, join):
    _rpc("lelons_doc_answer", doc_id=str(doc_id), join_it=bool(join))


def collab_remove(doc_id, username):
    return _with_avatars(_rpc("lelons_doc_remove", doc_id=str(doc_id), username=str(username or "")))


def collab_delete(doc_id):
    _rpc("lelons_doc_delete", doc_id=str(doc_id))


def _comments(found):
    return [{**c, "avatarUrl": sfx.public_url(c["avatar"]) if c.get("avatar") else ""} for c in found or []]


def collab_comments(doc_id):
    return _comments(_rpc("lelons_doc_comments", doc_id=str(doc_id)))


COMMENT_ACTIONS = ("add", "reply", "edit", "resolve", "reopen", "delete")


def collab_comment(doc_id, what, comment_id=None, block=None, quote=None, body=None):
    if what not in COMMENT_ACTIONS:
        raise Error("Something about that wasn't right. Try again.")
    try:
        comment_id = int(comment_id) if comment_id is not None else None
    except (TypeError, ValueError):
        comment_id = None
    return _comments(_rpc("lelons_doc_comment", doc_id=str(doc_id), what=what, comment_id=comment_id,
                          block=str(block)[:40] if block else None,
                          quote=re.sub(r"\s+", " ", str(quote)).strip()[:300] if quote else None,
                          body=str(body or "").strip()[:2000] or None))


# ---------------------------------------------------------------- saving a copy as a file

def export(folder, title, ext, text):
    """Writes what the page made (Word, text or Fountain) into the folder. Returns the path."""
    if ext not in EXPORTS or not isinstance(text, str):
        raise Error("Can't save it like that.")
    if not folder or not os.path.isdir(folder):
        raise Error("That folder isn't there any more. Pick another one.")
    with names._lock:
        path = names.free_path(folder, names.safe_stem(title, "Document"), "." + ext)
        data = text.encode("utf-8")
        if ext in ("txt", "fountain"):
            data = text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8-sig")
        with open(path, "wb") as f:
            f.write(data)
    return path
