"""The Trash bin: deleted things wait here for 30 days, so they can be put back.

Two kinds of Trash, shown together on one page:
- On this computer: your own ("just me") documents and boards. Their file is moved into the app's
  data folder's Trash folder instead of being deleted, and moved back when you put it back.
- Online (Supabase, see sfx/setup.sql, lelons_trash): shared documents and team boards you made, and
  (for the owner and admins) Library sounds. They're hidden from everyone while in the Trash.
After 30 days both go for good on their own.
"""

import json
import os
import re
import threading
import time

import settings
import sfx

FOLDER = os.path.join(settings.DATA_DIR, "Trash")
INDEX = os.path.join(FOLDER, "trash.json")
DAYS = 30
KINDS = ("doc", "board")  # what can be in the local Trash
_ID = re.compile(r"[0-9a-f]{32}$")
_lock = threading.Lock()


class Error(sfx.Error):
    """Shown to the user as it is."""


def _back_to(kind, item_id):
    """Where a local thing lives when it's not in the Trash."""
    if kind == "doc":
        import docs
        return os.path.join(docs.FOLDER, item_id + ".json")
    import boards
    return os.path.join(boards.FOLDER, item_id + ".json")


def _file(kind, item_id):
    return os.path.join(FOLDER, f"{kind}-{item_id}.json")


def _read_index():
    try:
        with open(INDEX, encoding="utf-8") as f:
            items = json.load(f)
    except (OSError, ValueError):
        return []
    return [i for i in items if isinstance(i, dict) and i.get("kind") in KINDS and _ID.match(str(i.get("id") or ""))] \
        if isinstance(items, list) else []


def _write_index(items):
    os.makedirs(FOLDER, exist_ok=True)
    temp = INDEX + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)
    for attempt in range(6):
        try:
            os.replace(temp, INDEX)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.1)


def _move(source, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    for attempt in range(6):  # Windows: a virus scanner may hold the file for a moment
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.1)


def _forget(item):
    try:
        os.remove(_file(item["kind"], item["id"]))
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------- on this computer

def put_local(kind, item_id, title, extra=None):
    """Move one of your own documents or boards into the Trash (instead of deleting it)."""
    if kind not in KINDS or not _ID.match(str(item_id or "")):
        raise Error("That isn't there any more.")
    source = _back_to(kind, item_id)
    with _lock:
        if not os.path.exists(source):
            return
        _move(source, _file(kind, item_id))
        items = [i for i in _read_index() if not (i["kind"] == kind and i["id"] == item_id)]
        items.append({"kind": kind, "id": item_id, "title": str(title or "")[:150], "deleted": time.time(),
                      **({"extra": extra} if isinstance(extra, dict) else {})})
        _write_index(items)


def tidy():
    """Things that have been in the local Trash for 30 days go for good."""
    with _lock:
        items = _read_index()
        cut = time.time() - DAYS * 86400
        keep = [i for i in items if (i.get("deleted") or 0) > cut and os.path.exists(_file(i["kind"], i["id"]))]
        for i in items:
            if i not in keep:
                _forget(i)
        if len(keep) != len(items):
            _write_index(keep)
        return keep


def _local_restore(kind, item_id):
    with _lock:
        items = _read_index()
        found = next((i for i in items if i["kind"] == kind and i["id"] == item_id), None)
        if not found:
            raise Error("That isn't in the Trash any more.")
        target = _back_to(kind, item_id)
        if os.path.exists(target):
            raise Error("There's already one with the same id. That shouldn't happen; try again.")
        _move(_file(kind, item_id), target)
        _write_index([i for i in items if i is not found])
        return found


def _local_purge(kind=None, item_id=None):
    with _lock:
        items = _read_index()
        gone = [i for i in items if kind is None or (i["kind"] == kind and i["id"] == item_id)]
        for i in gone:
            _forget(i)
        _write_index([i for i in items if i not in gone])


# ---------------------------------------------------------------- online (shared docs, team boards, sounds)

FRIENDLY = {"trash_gone": "That isn't in the Trash any more."}
sfx.FRIENDLY.update(FRIENDLY)


def _rpc(what, kind=None, item_id=None):
    try:
        result = sfx._rpc("lelons_trash", token=sfx.library._token(), what=what, kind=kind, item_id=item_id)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        raise Error(str(e)) from None
    result = result if isinstance(result, dict) else {}
    for path in result.get("files") or []:  # sounds that are gone for good: their files go too
        sfx.library._remove_file(path)
    return result.get("items") or []


def put_shared(kind, item_id):
    """Move a shared document, team board or Library sound into the Trash online."""
    _rpc("put", kind, str(item_id or ""))


# ---------------------------------------------------------------- the Trash page

def _item(i, where):
    left = max(0, DAYS - int((time.time() - float(i.get("deleted") or 0)) // 86400))
    return {"kind": i["kind"], "id": str(i["id"]), "title": str(i.get("title") or "")[:150], "where": where,
            "deleted": float(i.get("deleted") or 0), "daysLeft": left, "sort": str(i.get("sort") or "")[:400],
            "who": str(i.get("who") or ""), "bytes": int(i.get("bytes") or 0)}


def list_all():
    """Everything in the Trash, newest first. "note" says why the online part is missing, if it is."""
    items = [_item(i, "local") for i in tidy()]
    note = ""
    try:
        items += [_item(i, "online") for i in _rpc("list")]
    except sfx.LoggedOut:
        note = "Log in to see shared documents, team boards and sounds in the Trash."
    except Error as e:
        note = str(e)
    items.sort(key=lambda i: i["deleted"], reverse=True)
    return {"items": items, "note": note, "days": DAYS}


def restore(kind, item_id, where):
    if where == "local":
        found = _local_restore(kind, str(item_id or ""))
        if kind == "doc" and (found.get("extra") or {}).get("folder"):  # back into the folder it was in
            import docs
            folders = docs.folders_get()
            folders["local"]["place"][found["id"]] = found["extra"]["folder"]
            docs.folders_set(folders)
    else:
        _rpc("restore", kind, str(item_id or ""))


def purge(kind, item_id, where):
    if where == "local":
        _local_purge(kind, str(item_id or ""))
    else:
        _rpc("purge", kind, str(item_id or ""))


def empty():
    _local_purge()
    try:
        _rpc("empty")
    except sfx.LoggedOut:
        pass
