"""Dragging a file out of the app into another one (DaVinci Resolve, Premiere, Explorer...).

The page notices you started dragging something and asks the app to take over.
Windows then does the real drag, just like dragging the file out of File
Explorer: the shell makes the data (the same one Explorer would) and draws the
file's picture under the mouse. Talks to Windows through ctypes.
"""

import ctypes
import os
import threading
from ctypes import POINTER, byref, c_void_p, c_wchar_p, wintypes

DROPEFFECT_COPY, DROPEFFECT_LINK = 1, 4
VK_LBUTTON = 0x01
BHID_DATA_OBJECT = "{B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4}"
IID_DATA_OBJECT = "{0000010E-0000-0000-C000-000000000046}"
BIND_TO_HANDLER = 3  # IShellItem


def available():
    return os.name == "nt"


def mouse_down():
    """Is the left mouse button still held? (A drag can only start while it is.)"""
    return bool(ctypes.windll.user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)


def drag(path, hwnd=None):
    """Drag path from where the mouse is. Blocks until it's dropped (or let go).

    Must run on a thread with OLE started (OleInitialize). hwnd: the app's window, if it has one.
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
        effect = wintypes.DWORD()
        # No "move": the file stays where it is, the other app gets a copy or a link to it.
        shell32.SHDoDragDrop(hwnd, data, None, DROPEFFECT_COPY | DROPEFFECT_LINK, byref(effect))
        return True
    finally:
        if data:
            folder_picker.release(data)
        folder_picker.release(item)


def drag_on_new_thread(path):
    """For when the app has no window of its own (it's in an Edge window instead)."""
    def run():
        ctypes.windll.ole32.OleInitialize(None)
        try:
            drag(path)
        finally:
            ctypes.windll.ole32.OleUninitialize()
    threading.Thread(target=run, daemon=True).start()
