"""The Boards tab: Trello-like boards with lists and cards.

For now boards live on this computer only (in the app's data folder), one file per board. The page
does all the work (moving cards, labels, checklists...) and sends the whole board back to be saved;
this just keeps the files.
"""

import json
import os
import re
import threading
import time
import uuid

import settings

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
