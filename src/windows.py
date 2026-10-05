"""Small bits of Windows the app needs, through ctypes. Each does nothing elsewhere."""

import ctypes
import os
from ctypes import wintypes

IS_WINDOWS = os.name == "nt"
_mutex = None


def single_instance():
    """True if no other copy of the app is running (this one then counts as running until it exits).

    A named lock that Windows keeps for the process, so starting the app twice
    quickly can't slip past it the way a check of a file can. Windows lets go
    of it by itself when the app ends, even if it crashes.
    """
    global _mutex
    if not IS_WINDOWS:
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    if not _mutex:
        _mutex = kernel32.CreateMutexW(None, False, "Local\\LelonsConverterRunning")
        if not _mutex:
            return True  # can't tell: don't stop the app from starting
    # 0: got it; 0x80: the app that had it crashed, so it's ours now
    return kernel32.WaitForSingleObject(wintypes.HANDLE(_mutex), 0) in (0, 0x80)


def downloads_folder():
    """The user's real Downloads folder, also when it was moved to another drive or OneDrive."""
    fallback = os.path.join(os.path.expanduser("~"), "Downloads")
    if not IS_WINDOWS:
        return fallback

    class GUID(ctypes.Structure):
        _fields_ = [("data1", wintypes.DWORD), ("data2", wintypes.WORD), ("data3", wintypes.WORD),
                    ("data4", ctypes.c_ubyte * 8)]

    folder_id = GUID()
    ctypes.windll.ole32.CLSIDFromString("{374DE290-123F-4565-9164-39C4925E467B}", ctypes.byref(folder_id))
    path = ctypes.c_wchar_p()
    try:
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(folder_id), 0, None, ctypes.byref(path)) != 0:
            return fallback
        return path.value or fallback
    except OSError:
        return fallback
    finally:
        ctypes.windll.ole32.CoTaskMemFree(path)


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


def stop_helpers(names=("ffmpeg.exe", "deno.exe")):
    """Stop ffmpeg and deno programs this app started, so none keep running after it closes.

    (Windows doesn't stop a program's helpers when the program itself ends.)
    The window, Explorer and the update installer are left alone.
    """
    if not IS_WINDOWS:
        return
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.OpenProcess.restype = wintypes.HANDLE
    snapshot = kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snapshot or snapshot == wintypes.HANDLE(-1).value:
        return
    processes = []
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            processes.append((entry.th32ProcessID, entry.th32ParentProcessID, entry.szExeFile.lower()))
            ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    # Everything started by this app, also by its helpers (yt-dlp starts ffmpeg too).
    ours, added = {os.getpid()}, True
    while added:
        added = False
        for pid, parent, _ in processes:
            if parent in ours and pid not in ours:
                ours.add(pid)
                added = True
    for pid, _, name in processes:
        if pid in ours and pid != os.getpid() and name in names:
            handle = kernel32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
            if handle:
                kernel32.TerminateProcess(handle, 1)
                kernel32.CloseHandle(handle)
