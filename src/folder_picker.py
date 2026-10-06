"""The normal Windows "Select Folder" and "Open" windows (the ones File Explorer uses).

Talks to Windows directly through ctypes, so it opens instantly and needs
nothing extra installed.
"""

import ctypes
import os
from ctypes import POINTER, byref, c_void_p, c_wchar_p, oledll, windll
from ctypes.wintypes import DWORD, HWND

COINIT_APARTMENTTHREADED = 0x2
CLSCTX_INPROC_SERVER = 0x1
FOS_PICKFOLDERS = 0x20
FOS_FORCEFILESYSTEM = 0x40
FOS_ALLOWMULTISELECT = 0x200
FOS_PATHMUSTEXIST = 0x800
FOS_FILEMUSTEXIST = 0x1000
SIGDN_FILESYSPATH = 0x80058000
ERROR_CANCELLED = 0x800704C7


class GUID(ctypes.Structure):
    _fields_ = [("data1", DWORD), ("data2", ctypes.c_ushort), ("data3", ctypes.c_ushort),
                ("data4", ctypes.c_ubyte * 8)]

    def __init__(self, text):
        super().__init__()
        windll.ole32.CLSIDFromString(c_wchar_p(text), byref(self))


CLSID_FILE_OPEN_DIALOG = "{DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}"
IID_FILE_OPEN_DIALOG = "{D57C7288-D4AD-4768-BE02-9D969532D960}"
IID_SHELL_ITEM = "{43826D1E-E718-42EE-BC55-A1E261C37BFE}"

# Positions of the methods we use in the COM interfaces' method tables.
RELEASE = 2
SHOW = 3
SET_FILE_TYPES = 4
SET_OPTIONS = 9
GET_OPTIONS = 10
SET_FOLDER = 12
SET_TITLE = 17
GET_RESULT = 20
GET_RESULTS = 27  # IFileOpenDialog
GET_DISPLAY_NAME = 5
ARRAY_GET_COUNT = 7  # IShellItemArray
ARRAY_GET_ITEM_AT = 8


class FILTERSPEC(ctypes.Structure):
    _fields_ = [("name", c_wchar_p), ("spec", c_wchar_p)]


def call(obj, index, *args, argtypes=()):
    """Call method number `index` on a COM object pointer."""
    vtable = ctypes.cast(obj, POINTER(POINTER(c_void_p))).contents
    prototype = ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, *argtypes)
    return prototype(vtable[index])(obj, *args)


def release(obj):
    vtable = ctypes.cast(obj, POINTER(POINTER(c_void_p))).contents
    ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p)(vtable[RELEASE])(obj)


def find_app_window():
    """The app's own window, so the picker opens on top of it."""
    return windll.user32.FindWindowW(None, "Ultimate Recording") or None


def pick_folder(current, title="Where should files be saved?"):
    """Show the picker; returns the chosen folder, or '' if cancelled."""
    windll.ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
    dialog = c_void_p()
    try:
        oledll.ole32.CoCreateInstance(byref(GUID(CLSID_FILE_OPEN_DIALOG)), None, CLSCTX_INPROC_SERVER,
                                      byref(GUID(IID_FILE_OPEN_DIALOG)), byref(dialog))
        options = DWORD()
        call(dialog, GET_OPTIONS, byref(options), argtypes=(POINTER(DWORD),))
        call(dialog, SET_OPTIONS, options.value | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST,
             argtypes=(DWORD,))
        call(dialog, SET_TITLE, title, argtypes=(c_wchar_p,))

        if os.path.isdir(current):
            start = c_void_p()
            try:
                oledll.shell32.SHCreateItemFromParsingName(c_wchar_p(current), None,
                                                           byref(GUID(IID_SHELL_ITEM)), byref(start))
                call(dialog, SET_FOLDER, start, argtypes=(c_void_p,))
            except OSError:
                pass
            finally:
                if start:
                    release(start)

        try:
            call(dialog, SHOW, find_app_window(), argtypes=(HWND,))
        except OSError as e:
            if (e.winerror or 0) & 0xFFFFFFFF == ERROR_CANCELLED:
                return ""
            raise

        item = c_void_p()
        call(dialog, GET_RESULT, byref(item), argtypes=(POINTER(c_void_p),))
        try:
            path = c_wchar_p()
            call(item, GET_DISPLAY_NAME, SIGDN_FILESYSPATH, byref(path), argtypes=(DWORD, POINTER(c_wchar_p)))
            folder = path.value or ""
            windll.ole32.CoTaskMemFree(path)
            return folder
        finally:
            release(item)
    finally:
        if dialog:
            release(dialog)
        windll.ole32.CoUninitialize()


def _path_of(item):
    path = c_wchar_p()
    call(item, GET_DISPLAY_NAME, SIGDN_FILESYSPATH, byref(path), argtypes=(DWORD, POINTER(c_wchar_p)))
    try:
        return path.value or ""
    finally:
        windll.ole32.CoTaskMemFree(path)


def pick_files(title, kinds):
    """Show the Open window to pick one or more files; returns their paths ([] if cancelled).

    kinds: [("Videos and songs", "*.mp4;*.mp3"), ...]
    """
    windll.ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
    dialog = c_void_p()
    try:
        oledll.ole32.CoCreateInstance(byref(GUID(CLSID_FILE_OPEN_DIALOG)), None, CLSCTX_INPROC_SERVER,
                                      byref(GUID(IID_FILE_OPEN_DIALOG)), byref(dialog))
        options = DWORD()
        call(dialog, GET_OPTIONS, byref(options), argtypes=(POINTER(DWORD),))
        call(dialog, SET_OPTIONS, options.value | FOS_ALLOWMULTISELECT | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST,
             argtypes=(DWORD,))
        call(dialog, SET_TITLE, title, argtypes=(c_wchar_p,))
        specs = (FILTERSPEC * len(kinds))(*[FILTERSPEC(name, spec) for name, spec in kinds])
        call(dialog, SET_FILE_TYPES, len(kinds), specs, argtypes=(ctypes.c_uint, POINTER(FILTERSPEC)))

        try:
            call(dialog, SHOW, find_app_window(), argtypes=(HWND,))
        except OSError as e:
            if (e.winerror or 0) & 0xFFFFFFFF == ERROR_CANCELLED:
                return []
            raise

        items = c_void_p()
        call(dialog, GET_RESULTS, byref(items), argtypes=(POINTER(c_void_p),))
        try:
            count = DWORD()
            call(items, ARRAY_GET_COUNT, byref(count), argtypes=(POINTER(DWORD),))
            paths = []
            for i in range(count.value):
                item = c_void_p()
                call(items, ARRAY_GET_ITEM_AT, i, byref(item), argtypes=(DWORD, POINTER(c_void_p)))
                try:
                    paths.append(_path_of(item))
                finally:
                    release(item)
            return [p for p in paths if p]
        finally:
            release(items)
    finally:
        if dialog:
            release(dialog)
        windll.ole32.CoUninitialize()
