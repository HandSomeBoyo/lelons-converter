"""The Editor tab's AI: Select Subject, Object Selection and Remove Background.

All three ask one model which pixels belong to the main subject of a picture.
The model (IS-Net, 170 MB) is downloaded the first time it's needed and then
runs on the PC itself, so pictures never leave it.
"""

import io
import os
import threading
import urllib.request

import settings

MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
MODEL_BYTES = 178648008
MODEL_PATH = os.path.join(settings.DATA_DIR, "models", "isnet-general-use.onnx")
SIZE = 1024  # the model looks at the picture at 1024 x 1024

_lock = threading.Lock()
_session = None
_download = {"running": False, "done": 0, "error": ""}


class Error(Exception):
    pass


def status():
    """{"ready": bool, "downloading": bool, "progress": 0..1, "error": str}"""
    ready = os.path.isfile(MODEL_PATH) and os.path.getsize(MODEL_PATH) == MODEL_BYTES
    return {"ready": ready, "downloading": _download["running"], "progress": _download["done"] / MODEL_BYTES,
            "error": _download["error"], "megabytes": round(MODEL_BYTES / 1024 / 1024)}


def start_download():
    """Downloads the model in the background (status() tells how far it is)."""
    with _lock:
        if _download["running"] or status()["ready"]:
            return
        _download.update(running=True, done=0, error="")
    threading.Thread(target=_get_model, daemon=True).start()


def _get_model():
    part = MODEL_PATH + ".part"
    try:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "VaultHub"})
        with urllib.request.urlopen(request, timeout=30) as response, open(part, "wb") as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
                _download["done"] += len(chunk)
        if os.path.getsize(part) != MODEL_BYTES:
            raise OSError("incomplete")
        os.replace(part, MODEL_PATH)
    except Exception:
        _download["error"] = "Couldn't download the AI model. Check your internet and try again."
        try:
            os.remove(part)
        except OSError:
            pass
    finally:
        _download["running"] = False


def _get_session():
    global _session
    with _lock:
        if _session is None:
            if not status()["ready"]:
                raise Error("The AI model isn't downloaded yet.")
            try:
                import onnxruntime
            except ImportError:
                raise Error("The AI tools aren't installed in this version of VaultHub.")
            options = onnxruntime.SessionOptions()
            options.log_severity_level = 3
            _session = onnxruntime.InferenceSession(MODEL_PATH, options, providers=["CPUExecutionProvider"])
        return _session


def subject_mask(picture):
    """picture: PNG/JPEG bytes. Returns a grayscale PNG the same size: white = subject, black = background."""
    import numpy as np
    from PIL import Image

    try:
        image = Image.open(io.BytesIO(picture))
        image.load()
    except Exception:
        raise Error("Couldn't read that picture.")
    if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
        # See-through parts count as background: put them on gray, which the model treats as plain.
        flat = Image.new("RGB", image.size, (128, 128, 128))
        flat.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
        image = flat
    image = image.convert("RGB")
    size = image.size

    pixels = np.asarray(image.resize((SIZE, SIZE), Image.Resampling.LANCZOS), dtype=np.float32)
    pixels = pixels / max(float(pixels.max()), 1e-6) - 0.5
    batch = pixels.transpose(2, 0, 1)[np.newaxis].astype(np.float32)

    session = _get_session()
    output = session.run(["output_image"], {session.get_inputs()[0].name: batch})[0][0, 0]
    low, high = float(output.min()), float(output.max())
    output = (output - low) / max(high - low, 1e-6)

    mask = Image.fromarray((output * 255).clip(0, 255).astype(np.uint8), "L").resize(size, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    mask.save(out, "PNG")
    return out.getvalue()
