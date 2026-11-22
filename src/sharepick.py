"""Our own screen share picker for calls (instead of the browser engine's "Choose what to share" window),
and hiding the engine's "... is sharing your screen" bar.

How a pick is made without the engine's window: the app's window starts with switches (see
browser_args) that make the engine pick by itself:
- a window whose title has MARKER in it. So to share a window, MARKER is added to its title for a
  moment (prepare), the page asks to share, and the title goes back (finish).
- the screen, when the page asks for a screen only.
- with the PC's sound switched on, so "Share my PC's sound" works with no extra window.
If the engine ever doesn't know these switches, its own window simply shows up like before.

Windows only (ctypes, nothing to install). On other systems the lists are empty.
"""

import base64
import ctypes
import io
import os
import secrets
import threading
import time

MARKER = "vh-share-" + secrets.token_hex(4)

_lock = threading.Lock()
_renamed = {}  # hwnd -> (title before, when)
_bar = {"on": False, "port": 0, "until": 0.0, "thread": None}


def browser_args():
    return [
        f"--auto-select-desktop-capture-source={MARKER}",
        "--auto-select-screen-capture-source",
        "--system-audio-capture-default-checked",
    ]


if os.name == "nt":
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    kernel32 = ctypes.windll.kernel32
    try:
        dwmapi = ctypes.windll.dwmapi
    except OSError:
        dwmapi = None
    ENUM_PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetClassLongPtrW.restype = ctypes.c_size_t
    user32.GetClassLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SendMessageTimeoutW.restype = ctypes.c_ssize_t
    user32.SendMessageTimeoutW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                                           wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)]
    user32.GetWindow.restype = wintypes.HWND
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    gdi32.CreateDIBSection.restype = wintypes.HBITMAP
    gdi32.CreateCompatibleDC.restype = wintypes.HDC
    gdi32.SelectObject.restype = wintypes.HGDIOBJ
    gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
    gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    gdi32.DeleteDC.argtypes = [wintypes.HDC]
    user32.GetDC.restype = wintypes.HDC
    user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    user32.DrawIconEx.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.HICON, ctypes.c_int, ctypes.c_int,
                                  wintypes.UINT, wintypes.HBRUSH, wintypes.UINT]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]


def _title(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    if n <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(n + 2)
    user32.GetWindowTextW(hwnd, buf, n + 2)
    return buf.value


def _class(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def _cloaked(hwnd):
    if not dwmapi:
        return False
    value = ctypes.c_int(0)
    try:
        dwmapi.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(value), ctypes.sizeof(value))  # DWMWA_CLOAKED
    except OSError:
        return False
    return value.value != 0


def _exe(hwnd):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    handle = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return pid.value, ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(1024)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return pid.value, buf.value
        return pid.value, ""
    finally:
        kernel32.CloseHandle(handle)


SKIP_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
                "NotifyIconOverflowWindow", "XamlExplorerHostIslandWindow"}


def _windows():
    found = []
    me = os.getpid()

    def each(hwnd, _):
        try:
            if not user32.IsWindowVisible(hwnd) or user32.GetWindow(hwnd, 4):  # GW_OWNER: dialogs and popups
                return True
            if user32.GetWindowLongPtrW(hwnd, -20) & 0x80:  # WS_EX_TOOLWINDOW
                return True
            title = _title(hwnd).strip()
            cls = _class(hwnd)
            if not title or cls in SKIP_CLASSES or _cloaked(hwnd) or "127.0.0.1:" in title:
                return True
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            if not user32.IsIconic(hwnd) and (rect.right - rect.left < 60 or rect.bottom - rect.top < 40):
                return True
            pid, exe = _exe(hwnd)
            found.append({"hwnd": hwnd, "title": title, "exe": exe, "mine": pid == me,
                          "minimized": bool(user32.IsIconic(hwnd))})
        except OSError:
            pass
        return True

    user32.EnumWindows(ENUM_PROC(each), 0)
    return found


def _bgra_image(width, height, draw):
    """Draw into a 32-bit picture with draw(dc) and give back a Pillow image (or None)."""
    from PIL import Image
    screen = user32.GetDC(None)
    dc = gdi32.CreateCompatibleDC(screen)
    info = BITMAPINFOHEADER(biSize=ctypes.sizeof(BITMAPINFOHEADER), biWidth=width, biHeight=-height, biPlanes=1,
                            biBitCount=32, biCompression=0)
    bits = ctypes.c_void_p()
    bmp = gdi32.CreateDIBSection(dc, ctypes.byref(info), 0, ctypes.byref(bits), None, 0)
    try:
        if not bmp:
            return None
        old = gdi32.SelectObject(dc, bmp)
        ok = draw(dc)
        gdi32.SelectObject(dc, old)
        if not ok:
            return None
        raw = ctypes.string_at(bits, width * height * 4)
        return Image.frombuffer("RGBA", (width, height), raw, "raw", "BGRA", 0, 1)
    finally:
        if bmp:
            gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(dc)
        user32.ReleaseDC(None, screen)


def _data_url(img, kind="JPEG", quality=72):
    out = io.BytesIO()
    if kind == "JPEG":
        img.convert("RGB").save(out, "JPEG", quality=quality)
    else:
        img.save(out, "PNG")
    return f"data:image/{kind.lower()};base64," + base64.b64encode(out.getvalue()).decode()


def _window_thumb(hwnd, width=360):
    if user32.IsIconic(hwnd) or user32.IsHungAppWindow(hwnd):
        return ""
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w, h = rect.right - rect.left, rect.bottom - rect.top
    if w <= 0 or h <= 0 or w * h > 8000 * 5000:
        return ""
    img = _bgra_image(w, h, lambda dc: user32.PrintWindow(hwnd, dc, 2))  # PW_RENDERFULLCONTENT
    if img is None:
        return ""
    img = img.convert("RGB")
    if img.getbbox() is None:  # all black (some games): just the icon then
        return ""
    img.thumbnail((width, width))
    return _data_url(img)


def _icon(hwnd):
    handle = ctypes.c_size_t(0)
    for kind in (1, 2, 0):  # ICON_BIG, ICON_SMALL2, ICON_SMALL
        user32.SendMessageTimeoutW(hwnd, 0x7F, kind, 0, 0x2, 120, ctypes.byref(handle))  # WM_GETICON, SMTO_ABORTIFHUNG
        if handle.value:
            break
    if not handle.value:
        handle.value = user32.GetClassLongPtrW(hwnd, -14) or user32.GetClassLongPtrW(hwnd, -34)  # GCLP_HICON(SM)
    if not handle.value:
        return ""
    size = 32
    # Drawn on black and on white: the difference tells how see-through each pixel is (old icons have no alpha).
    from PIL import Image, ImageChops

    def on(color):
        def draw(dc):
            brush = gdi32.CreateSolidBrush(color)
            rect = wintypes.RECT(0, 0, size, size)
            user32.FillRect(dc, ctypes.byref(rect), brush)
            gdi32.DeleteObject(brush)
            return user32.DrawIconEx(dc, 0, 0, handle.value, size, size, 0, None, 3)  # DI_NORMAL
        return _bgra_image(size, size, draw)

    black, white = on(0x000000), on(0xFFFFFF)
    if black is None or white is None:
        return ""
    black, white = black.convert("RGB"), white.convert("RGB")
    alpha = ImageChops.invert(ImageChops.subtract(white, black).convert("L"))
    img = black.copy()
    img.putalpha(alpha)
    # (un-premultiply: what was drawn on black is darker where it's see-through)
    px, al = img.load(), alpha.load()
    for y in range(size):
        for x in range(size):
            a = al[x, y]
            if 0 < a < 255:
                r, g, b, _ = px[x, y]
                px[x, y] = (min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a), a)
    return _data_url(img, "PNG")


def _app_name(exe):
    name = os.path.splitext(os.path.basename(exe or ""))[0]
    return name[:1].upper() + name[1:] if name else ""


def sources(thumbs=True):
    """{"screens": [...], "windows": [...]} for the picker, with small pictures of each."""
    if os.name != "nt":
        return {"screens": [], "windows": []}
    import remote
    screens = []
    from PIL import ImageGrab
    for i, (l, t, r, b) in enumerate(remote.monitors()):
        item = {"id": f"screen:{i}", "name": f"Screen {i + 1}", "main": i == 0, "w": r - l, "h": b - t, "thumb": ""}
        if thumbs:
            try:
                img = ImageGrab.grab(bbox=(l, t, r, b), all_screens=True)
                img.thumbnail((480, 480))
                item["thumb"] = _data_url(img)
            except Exception:
                pass
        screens.append(item)
    windows = []
    for w in _windows()[:40]:
        item = {"id": f"win:{w['hwnd']}", "name": w["title"][:120], "app": _app_name(w["exe"]), "mine": w["mine"],
                "minimized": w["minimized"], "thumb": "", "icon": ""}
        if thumbs:
            try:
                item["thumb"] = _window_thumb(w["hwnd"])
            except Exception:
                pass
            try:
                item["icon"] = _icon(w["hwnd"])
            except Exception:
                pass
        windows.append(item)
    windows.sort(key=lambda w: w["mine"])  # (VaultHub itself last)
    return {"screens": screens, "windows": windows}


def _set_title(hwnd, text):
    buf = ctypes.create_unicode_buffer(text)
    result = ctypes.c_size_t(0)
    user32.SendMessageTimeoutW(hwnd, 0x000C, 0, ctypes.cast(buf, ctypes.c_void_p).value or 0, 0x2, 500,
                               ctypes.byref(result))  # WM_SETTEXT, SMTO_ABORTIFHUNG


def prepare(source_id):
    """Get ready to share source_id ("screen:N" or "win:HWND"). Returns what the page should ask for."""
    source_id = str(source_id or "")
    if source_id.startswith("screen:"):
        try:
            index = int(source_id[7:])
        except ValueError:
            return {"ok": False}
        return {"ok": True, "kind": "screen", "index": index}
    if not source_id.startswith("win:") or os.name != "nt":
        return {"ok": False}
    try:
        hwnd = int(source_id[4:])
    except ValueError:
        return {"ok": False}
    if not user32.IsWindow(hwnd):
        return {"ok": False, "error": "That window was closed."}
    finish()
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE: a minimized window can't be shared, so it comes back
        time.sleep(0.25)
    before = _title(hwnd)
    _set_title(hwnd, f"{before} {MARKER}")
    marked = MARKER in _title(hwnd)
    with _lock:
        _renamed[hwnd] = (before, time.time())
    threading.Timer(12, finish).start()  # (back for sure, even if the page never says it's done)
    return {"ok": True, "kind": "window", "marked": marked}


def finish():
    """Give the windows their own titles back."""
    with _lock:
        items = list(_renamed.items())
        _renamed.clear()
    for hwnd, (before, _) in items:
        try:
            if user32.IsWindow(hwnd) and MARKER in _title(hwnd):
                _set_title(hwnd, before)
        except OSError:
            pass


# ---- the "127.0.0.1:... is sharing your screen" bar

def _scale(hwnd):
    try:
        return max(1.0, user32.GetDpiForWindow(hwnd) / 96)
    except (AttributeError, OSError):
        return 1.0


def _hide_bars(port):
    host = f"127.0.0.1:{port}"
    hidden = []

    def each(hwnd, _):
        try:
            if user32.IsWindowVisible(hwnd) and host in _title(hwnd):
                rect = wintypes.RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                # (only the thin bar: the engine's own share window has the same address in its title)
                if rect.bottom - rect.top <= 120 * _scale(hwnd):
                    user32.ShowWindow(hwnd, 0)  # SW_HIDE
                    hidden.append(hwnd)
        except OSError:
            pass
        return True

    user32.EnumWindows(ENUM_PROC(each), 0)
    return hidden


def _bar_loop():
    while True:
        with _lock:
            if not _bar["on"]:
                _bar["thread"] = None
                return
            port = _bar["port"]
            fast = time.time() < _bar["until"]
        try:
            _hide_bars(port)
        except Exception:
            pass
        time.sleep(0.05 if fast else 1.0)


def bar(on, port):
    """While sharing: keep the engine's bar hidden (it shows up right after the share starts, and again if
    you switch desktops)."""
    if os.name != "nt":
        return
    with _lock:
        _bar["on"] = bool(on)
        _bar["port"] = int(port)
        if on:
            _bar["until"] = time.time() + 8
            if not _bar["thread"]:
                _bar["thread"] = threading.Thread(target=_bar_loop, daemon=True)
                _bar["thread"].start()


# ---- a screen other than the main one (3.0.1)
#
# The app's own engine can only pick the main screen by itself. Another screen is taken by a hidden helper
# window (ui/share-host.html) whose engine is started to pick exactly that screen, and it hands the picture
# to the app's window straight away, here on this PC.

_relay = {"job": None, "answer": None, "error": ""}


def relay(data, start_engine):
    """The app's window and the helper swap what they need through here."""
    what = data.get("what")
    with _lock:
        if what == "start":
            screen = max(0, int(data.get("screen") or 0))
            job = {"id": secrets.token_hex(6), "screen": screen, "offer": str(data.get("sdp") or ""),
                   "size": int(data.get("size") or 1080), "fps": int(data.get("fps") or 30)}
            _relay.update(job=job, answer=None, error="")
        elif what == "quality" and _relay["job"]:
            _relay["job"].update(size=int(data.get("size") or 1080), fps=int(data.get("fps") or 30))
            return {"ok": True}
        elif what == "job":  # (the helper asks)
            return {"ok": True, "job": _relay["job"]}
        elif what == "answer":
            job = _relay["job"]
            if job and data.get("id") == job["id"]:
                if data.get("sdp"):
                    _relay["answer"] = str(data["sdp"])
                else:
                    _relay["error"] = str(data.get("error") or "screen")
            return {"ok": True}
        elif what == "wait":  # (the app's window waits for the helper's answer)
            job = _relay["job"]
            if not job or data.get("id") != job["id"]:
                return {"ok": False}
            return {"ok": True, "answer": _relay["answer"], "error": _relay["error"]}
        elif what == "stop":
            _relay.update(job=None, answer=None, error="")
            screen = None
        else:
            return {"ok": False}
    if what == "stop":
        threading.Thread(target=start_engine, args=(None,), daemon=True).start()
        return {"ok": True}
    threading.Thread(target=start_engine, args=(screen,), daemon=True).start()
    return {"ok": True, "id": job["id"]}


def helper_args(screen):
    return " ".join([
        "--lang=en-US",  # (the switch below matches the screen's English name)
        f'"--auto-select-desktop-capture-source=Screen {int(screen) + 1}"',
        "--disable-background-timer-throttling",
        "--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion",
        "--disable-renderer-backgrounding",
    ])
