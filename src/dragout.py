"""Dragging a file out of the app into another one (DaVinci Resolve, Premiere, Explorer...).

The page notices you started dragging something and asks the app to take over.
Windows then does the real drag, just like dragging the file out of File
Explorer: the shell makes the data (the same one Explorer would) and draws the
file's picture under the mouse. Talks to Windows through ctypes.
"""

import ctypes
import io
import os
import threading
from ctypes import POINTER, Structure, byref, c_long, c_void_p, c_wchar_p, wintypes

DROPEFFECT_COPY, DROPEFFECT_LINK = 1, 4
VK_LBUTTON = 0x01
BHID_DATA_OBJECT = "{B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4}"
IID_DATA_OBJECT = "{0000010E-0000-0000-C000-000000000046}"
BIND_TO_HANDLER = 3  # IShellItem
CLSID_DRAG_DROP_HELPER = "{4657278A-411B-11D2-839A-00C04FD918D0}"
IID_DRAG_SOURCE_HELPER = "{DE5BF786-477A-11D2-839D-00C04FD918D0}"
INITIALIZE_FROM_BITMAP = 3  # IDragSourceHelper
DRAGDROP_S_DROP = 0x00040100


class SHDRAGIMAGE(Structure):
    _fields_ = [("cx", c_long), ("cy", c_long), ("x", c_long), ("y", c_long),
                ("hbmpDragImage", c_void_p), ("crColorKey", wintypes.DWORD)]


class BITMAPINFOHEADER(Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", c_long), ("biHeight", c_long), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD), ("biSizeImage", wintypes.DWORD),
                ("biXPelsPerMeter", c_long), ("biYPelsPerMeter", c_long), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


def _bitmap(png):
    """A Windows bitmap (32-bit, see-through edges) from the page's PNG of the drag card."""
    from PIL import Image, ImageChops

    img = Image.open(io.BytesIO(png)).convert("RGBA")
    if img.width > 1200 or img.height > 600:
        img.thumbnail((1200, 600))
    r, g, b, a = img.split()
    # Windows wants the colors already multiplied by how see-through they are.
    r, g, b = (ImageChops.multiply(c, a) for c in (r, g, b))
    bits = Image.merge("RGBA", (b, g, r, a)).transpose(Image.FLIP_TOP_BOTTOM).tobytes()  # BGRA, bottom row first
    header = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), img.width, img.height, 1, 32, 0, len(bits))
    gdi32 = ctypes.windll.gdi32
    gdi32.CreateDIBSection.restype = c_void_p
    gdi32.CreateDIBSection.argtypes = [c_void_p, c_void_p, wintypes.UINT, POINTER(c_void_p), c_void_p, wintypes.DWORD]
    pixels = c_void_p()
    hbmp = gdi32.CreateDIBSection(None, byref(header), 0, byref(pixels), None, 0)
    if not hbmp or not pixels:
        return None, 0, 0
    ctypes.memmove(pixels, bits, len(bits))
    return hbmp, img.width, img.height


def _set_drag_image(data, png, offset):
    """Show the page's card (name and waveform) under the mouse instead of the file's icon."""
    import folder_picker

    hbmp, width, height = _bitmap(png)
    if not hbmp:
        return
    helper = c_void_p()
    ole32 = ctypes.windll.ole32
    ole32.CoCreateInstance.argtypes = [POINTER(folder_picker.GUID), c_void_p, wintypes.DWORD,
                                       POINTER(folder_picker.GUID), POINTER(c_void_p)]
    used = False
    try:
        if ole32.CoCreateInstance(byref(folder_picker.GUID(CLSID_DRAG_DROP_HELPER)), None, 1,
                                  byref(folder_picker.GUID(IID_DRAG_SOURCE_HELPER)), byref(helper)) >= 0 and helper:
            x, y = offset if offset else (width // 6, height // 2)
            image = SHDRAGIMAGE(width, height, min(max(int(x), 0), width), min(max(int(y), 0), height), hbmp, 0xFFFFFFFF)
            folder_picker.call(helper, INITIALIZE_FROM_BITMAP, byref(image), data,
                               argtypes=(POINTER(SHDRAGIMAGE), c_void_p))
            used = True  # Windows owns the bitmap now
    except OSError:
        pass
    finally:
        if helper:
            folder_picker.release(helper)
        if not used:
            ctypes.windll.gdi32.DeleteObject(c_void_p(hbmp))


def available():
    return os.name == "nt"


def mouse_down():
    """Is the left mouse button still held? (A drag can only start while it is.)"""
    return bool(ctypes.windll.user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)


def drag(path, hwnd=None, image=None, offset=None):
    """Drag path from where the mouse is. Blocks until it's dropped (or let go).

    Must run on a thread with OLE started (OleInitialize). hwnd: the app's window, if it has one.
    image: a PNG to show under the mouse (else Windows shows the file's icon); offset: where in it the
    mouse is. Returns "drop" when it was dropped somewhere, "cancel" when not, False if it never started.
    """
    import folder_picker  # its GUID and COM call helpers

    if not mouse_down():
        return False
    shell32 = ctypes.windll.shell32
    item, data = c_void_p(), c_void_p()
    shell32.SHCreateItemFromParsingName.argtypes = [c_wchar_p, c_void_p, POINTER(folder_picker.GUID), POINTER(c_void_p)]
    shell32.SHDoDragDrop.argtypes = [wintypes.HWND, c_void_p, c_void_p, wintypes.DWORD,
                                     POINTER(wintypes.DWORD)]
    if shell32.SHCreateItemFromParsingName(os.path.normpath(path), None, byref(folder_picker.GUID(folder_picker.IID_SHELL_ITEM)),
                                           byref(item)) < 0:
        return False
    try:
        if folder_picker.call(item, BIND_TO_HANDLER, None, byref(folder_picker.GUID(BHID_DATA_OBJECT)),
                              byref(folder_picker.GUID(IID_DATA_OBJECT)), byref(data),
                              argtypes=(c_void_p, POINTER(folder_picker.GUID), POINTER(folder_picker.GUID),
                                        POINTER(c_void_p))) < 0:
            return False
        if image:
            try:
                _set_drag_image(data, image, offset)
            except Exception:
                pass  # the file's own icon then
        effect = wintypes.DWORD()
        # No "move": the file stays where it is, the other app gets a copy or a link to it.
        result = shell32.SHDoDragDrop(hwnd, data, None, DROPEFFECT_COPY | DROPEFFECT_LINK, byref(effect))
        return "drop" if (result & 0xFFFFFFFF) == DRAGDROP_S_DROP and effect.value else "cancel"
    finally:
        if data:
            folder_picker.release(data)
        folder_picker.release(item)


def drag_on_new_thread(path, image=None, offset=None, done=None):
    """For when the app has no window of its own (it's in an Edge window instead)."""
    def run():
        ctypes.windll.ole32.OleInitialize(None)
        result = False
        try:
            result = drag(path, None, image, offset)
        finally:
            ctypes.windll.ole32.OleUninitialize()
            if done:
                done(result)
    threading.Thread(target=run, daemon=True).start()
