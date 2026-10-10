"""The Boards tab: Trello-like boards with lists and cards.

"Just me" boards live on this computer only (in the app's data folder), one file per board. Team
boards live in Supabase (see sfx/setup.sql): only the one who made it and the people they invited
(and who said yes) can open them. The page does all the work (moving cards, labels, checklists...)
and sends the whole board back to be saved; this keeps the files and talks to Supabase.
"""

import json
import os
import re
import threading
import time
import uuid

import settings
import sfx

FOLDER = os.path.join(settings.DATA_DIR, "Boards")
MAX_BYTES = 8 * 1024 * 1024  # one board

_lock = threading.Lock()
_ID = re.compile(r"[0-9a-f]{32}$")


class Error(Exception):
    """Shown to the user as it is."""


def _path(board_id):
    if not _ID.match(str(board_id or "")):
        raise Error("That board isn't there any more.")
    return os.path.join(FOLDER, board_id + ".json")


def _read(board_id):
    try:
        with open(_path(board_id), encoding="utf-8") as f:
            board = json.load(f)
    except (OSError, ValueError):
        raise Error("That board isn't there any more.") from None
    if not isinstance(board, dict):
        raise Error("That board isn't there any more.")
    board["id"] = board_id
    return board


def _write(board):
    os.makedirs(FOLDER, exist_ok=True)
    path = _path(board["id"])
    text = json.dumps(board, ensure_ascii=False)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise Error("This board is too big to save. Archive and delete some old cards.")
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


def _title(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:120] or "Untitled board"


def _clean(board):
    """The board as the page sent it, checked a little: it has to be a board with lists."""
    if not isinstance(board, dict) or not isinstance(board.get("lists"), list):
        raise Error("That board couldn't be saved.")
    board["title"] = _title(board.get("title"))
    return board


def _summary(board):
    cards = [c for l in board.get("lists") or [] if isinstance(l, dict) and not l.get("archived")
             for c in l.get("cards") or [] if isinstance(c, dict) and not c.get("archived")]
    return {"id": board["id"], "title": _title(board.get("title")), "bg": str(board.get("bg") or "blue")[:40],
            "starred": bool(board.get("starred")), "opened": board.get("opened", 0), "updated": board.get("updated", 0),
            "created": board.get("created", 0), "cards": len(cards)}


def list_all():
    boards = []
    try:
        files = os.listdir(FOLDER)
    except OSError:
        files = []
    for name in files:
        if name.endswith(".json") and _ID.match(name[:-5]):
            try:
                boards.append(_summary(_read(name[:-5])))
            except Error:
                pass
    boards.sort(key=lambda b: b["created"])
    return boards


def create(board):
    board = _clean(board)
    board["id"] = uuid.uuid4().hex
    board["created"] = board["updated"] = board["opened"] = time.time()
    with _lock:
        _write(board)
    return board


def get(board_id):
    return _read(board_id)


def open_(board_id):
    with _lock:
        board = _read(board_id)
        board["opened"] = time.time()
        _write(board)
    return board


def save(board_id, board):
    board = _clean(board)
    with _lock:
        old = _read(board_id)
        board["id"] = board_id
        board["created"] = old.get("created", time.time())
        board["opened"] = old.get("opened", 0)
        board["updated"] = time.time()
        _write(board)
    return board["updated"]


def delete(board_id):
    with _lock:
        try:
            os.remove(_path(board_id))
        except FileNotFoundError:
            pass


def star(board_id, starred):
    with _lock:
        board = _read(board_id)
        board["starred"] = bool(starred)
        _write(board)


# ---------------------------------------------------------------- team boards (Supabase, see sfx/setup.sql)

FRIENDLY = {
    "board_gone": "That board isn't there any more, or you're not on it any more.",
    "board_many": "You've made as many team boards as you can. Delete some old ones first.",
    "board_big": "This board is too big to save. Archive and delete some old cards.",
    "board_people": "A board can have up to 50 people.",
}
sfx.FRIENDLY.update(FRIENDLY)
TEAM_ACTIONS = ("list", "people", "create", "open", "check", "save", "star", "invite", "remove", "leave", "answer", "delete")


def _people(people):
    return [{**p, "avatarUrl": sfx.public_url(p["avatar"]) if p.get("avatar") else ""} for p in people or []]


def team(what, data):
    """One team-board action (what) with what the page sent (data). Raises sfx.LoggedOut or Error."""
    if what not in TEAM_ACTIONS:
        raise Error("That didn't work.")
    args = {"what": what}
    if what not in ("list", "people"):
        args["board_id"] = str(data.get("id") or "") or None
        if what != "create" and not args["board_id"]:
            raise Error("That board isn't there any more.")
    if what in ("create", "save"):
        board = _clean(data.get("board"))
        board.pop("id", None)
        args["data"] = board
    if what in ("save", "check"):
        args["base_rev"] = int(data.get("rev") or 0)
    if what in ("star", "answer"):
        args["data"] = bool(data.get("on"))
    if what == "invite":
        args["usernames"] = [str(u)[:40] for u in (data.get("usernames") or [])][:50]
    if what == "remove":
        args["usernames"] = [str(data.get("username") or "")[:40]]
    try:
        result = sfx._rpc("lelons_board", token=sfx.library._token(), **args)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        raise Error(str(e)) from None
    if what == "people" or what in ("invite", "remove", "leave"):
        return {"people": _people(result)}
    if what == "list":
        return {"boards": [{**b, "people": _people(b.get("people"))} for b in result.get("boards") or []],
                "invites": [{**i, "avatarUrl": sfx.public_url(i["avatar"]) if i.get("avatar") else ""} for i in result.get("invites") or []]}
    if isinstance(result, dict) and "people" in result:
        result["people"] = _people(result["people"])
    return result if isinstance(result, dict) else {}
