"""The Images tab: change a picture's format, size, direction and look.

Dropped files are copied to a temporary folder while the app runs. The page
shows small previews of them and asks for one finished file at a time, which
is saved in the same folder as the downloads.
"""

import io
import os
import shutil
import tempfile
import threading
import uuid

from PIL import Image, ImageOps, ImageSequence

import names

FOLDER = os.path.join(tempfile.gettempdir(), "LelonsConverter", "images")
MAX_BYTES = 300 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 400_000_000  # big photos are fine, absurd ones aren't

# format key -> (Pillow name, file extension)
FORMATS = {
    "png": ("PNG", ".png"),
    "jpg": ("JPEG", ".jpg"),
    "webp": ("WEBP", ".webp"),
    "gif": ("GIF", ".gif"),
    "bmp": ("BMP", ".bmp"),
    "ico": ("ICO", ".ico"),
    "pdf": ("PDF", ".pdf"),
}
NO_ALPHA = {"jpg", "bmp", "pdf"}  # formats without see-through parts
ANIMATED = {"gif", "webp"}

_lock = threading.Lock()
_images = {}  # id -> {"path", "name"}
_made = set()  # finished files, which the page may ask to show in Explorer


def add(name, data):
    """Keep a dropped file. Returns what the page shows about it."""
    if len(data) > MAX_BYTES:
        raise ValueError("That file is too big.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            width, height = ImageOps.exif_transpose(im).size
            kind = im.format or ""
            frames = getattr(im, "n_frames", 1)
            thumb = _thumbnail(im)
    except (OSError, ValueError, Image.DecompressionBombError):
        raise ValueError("That isn't a picture this app can open. Try PNG, JPG, WEBP, GIF, BMP, TIFF or ICO.")
    os.makedirs(FOLDER, exist_ok=True)
    image_id = uuid.uuid4().hex[:12]
    path = os.path.join(FOLDER, image_id)
    with open(path, "wb") as f:
        f.write(data)
    with open(path + "-thumb.png", "wb") as f:
        f.write(thumb)
    with _lock:
        _images[image_id] = {"path": path, "name": name}
    return {
        "id": image_id,
        "name": name,
        "width": width,
        "height": height,
        "bytes": len(data),
        "kind": "JPG" if kind == "JPEG" else kind,
        "animated": frames > 1,
        "thumb": f"/image/{image_id}",
    }


def _thumbnail(im):
    small = ImageOps.exif_transpose(im.copy())
    small.thumbnail((320, 320))
    if small.mode not in ("RGB", "RGBA"):
        small = small.convert("RGBA")
    out = io.BytesIO()
    small.save(out, "PNG")
    return out.getvalue()


def thumbnail_path(image_id):
    with _lock:
        image = _images.get(image_id)
    return image["path"] + "-thumb.png" if image else None


def remove(image_id):
    with _lock:
        image = _images.pop(image_id, None)
    if image:
        for path in (image["path"], image["path"] + "-thumb.png"):
            try:
                os.remove(path)
            except OSError:
                pass


def _number(value, low, high):
    try:
        return min(max(int(float(value)), low), high)
    except (TypeError, ValueError):
        return None


def _change(frame, options):
    """Apply the chosen changes to one picture (or one frame of an animation)."""
    if frame.mode == "CMYK":
        frame = frame.convert("RGB")
    elif frame.mode not in ("RGB", "RGBA", "L", "LA"):
        frame = frame.convert("RGBA")
    if options.get("square"):
        side = min(frame.size)
        frame = ImageOps.fit(frame, (side, side), Image.LANCZOS)

    size = options.get("size") or "original"
    width, height = frame.size
    if size in ("75", "50", "25"):
        scale = int(size) / 100
        new = (max(1, round(width * scale)), max(1, round(height * scale)))
    elif size == "custom":
        w = _number(options.get("width"), 1, 20000)
        h = _number(options.get("height"), 1, 20000)
        if w and h:
            new = (w, h)
        elif w:
            new = (w, max(1, round(height * w / width)))
        elif h:
            new = (max(1, round(width * h / height)), h)
        else:
            new = frame.size
    else:
        new = frame.size
    if new != frame.size:
        frame = frame.resize(new, Image.LANCZOS)

    turns = (_number(options.get("rotate"), 0, 270) or 0) // 90 % 4
    frame = [frame, frame.transpose(Image.ROTATE_270), frame.transpose(Image.ROTATE_180),
             frame.transpose(Image.ROTATE_90)][turns]
    if options.get("flipH"):
        frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
    if options.get("flipV"):
        frame = frame.transpose(Image.FLIP_TOP_BOTTOM)

    if options.get("gray"):
        frame = frame.convert("LA" if "A" in frame.getbands() else "L")
    return frame


def _without_alpha(frame):
    """Put see-through parts on white, for formats that can't store them."""
    if frame.mode in ("RGBA", "LA", "PA") or (frame.mode == "P" and "transparency" in frame.info):
        frame = frame.convert("RGBA")
        background = Image.new("RGB", frame.size, "white")
        background.paste(frame, mask=frame.getchannel("A"))
        return background
    return frame.convert("L" if frame.mode in ("L", "1") else "RGB")


def convert(image_id, options, folder):
    """Make the finished file in folder. Returns {"path", "name", "bytes", "width", "height"}."""
    with _lock:
        image = _images.get(image_id)
    if not image:
        raise ValueError("That picture is gone. Drop it in again.")
    fmt = options.get("format") if options.get("format") in FORMATS else "png"
    pil_name, ext = FORMATS[fmt]
    quality = _number(options.get("quality"), 1, 100) or 90

    with Image.open(image["path"]) as im:
        icc = im.info.get("icc_profile")
        animated = fmt in ANIMATED and getattr(im, "n_frames", 1) > 1
        if animated:
            frames, durations = [], []
            for frame in ImageSequence.Iterator(im):
                durations.append(frame.info.get("duration", 100))
                frames.append(_change(ImageOps.exif_transpose(frame.convert("RGBA")), options))
        else:
            im.seek(0)
            frames = [_change(ImageOps.exif_transpose(im), options)]

    if fmt in NO_ALPHA:
        frames = [_without_alpha(f) for f in frames]
    elif frames[0].mode not in ("RGB", "RGBA", "L", "LA", "P"):
        frames = [f.convert("RGBA") for f in frames]

    first = frames[0]
    save = {}
    if fmt == "jpg":
        save = {"quality": quality, "optimize": True, "progressive": True}
    elif fmt == "webp":
        save = {"quality": quality, "method": 5}
    elif fmt == "png":
        save = {"optimize": True}
    elif fmt == "ico":
        # Icons are square: centre the picture on a see-through square.
        side = max(first.size)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(first.convert("RGBA"), ((side - first.width) // 2, (side - first.height) // 2))
        first = square
        sizes = [s for s in (16, 24, 32, 48, 64, 128, 256) if s <= side] or [side]
        save = {"sizes": [(s, s) for s in sizes]}
    elif fmt == "pdf":
        save = {"resolution": 150}
    if icc and fmt in ("jpg", "png", "webp"):
        save["icc_profile"] = icc
    if animated:
        save.update(save_all=True, append_images=frames[1:], duration=durations, loop=0)
        if fmt == "gif":
            save["disposal"] = 2

    os.makedirs(folder, exist_ok=True)
    stem = os.path.splitext(os.path.basename(image["name"]))[0] or "image"
    path = names.temp_path(folder, stem, ext)
    try:
        first.save(path, pil_name, **save)
        path = names.finish(path)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    with _lock:
        _made.add(path)
    return {
        "path": path,
        "name": os.path.basename(path),
        "bytes": os.path.getsize(path),
        "width": first.width,
        "height": first.height,
    }


def was_made(path):
    with _lock:
        return path in _made


def clean_up():
    shutil.rmtree(FOLDER, ignore_errors=True)
