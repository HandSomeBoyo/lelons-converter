"""(3.0) The PC's own sound ("what you hear"), for Remote desktop.

The hidden sender page asks the screen picker for the sound too, but when the screen is picked by
itself (no picker, see remote.engine_args) Windows' browser engine leaves the sound out. So the sound
is taken here instead, straight from Windows (WASAPI loopback on the default speakers), and handed to
the sender page, which sends it to your other PC with the picture.

Talks to Windows directly through ctypes, like folder_picker.py: nothing extra to install.
"""

import ctypes
import os
import time
from ctypes import POINTER, byref, c_uint32, c_uint64, c_void_p

CLSID_MM_DEVICE_ENUMERATOR = "{BCDE0395-E52F-467C-8E3D-C4579291692E}"
IID_MM_DEVICE_ENUMERATOR = "{A95664D2-9614-4F35-A746-DE8DB63617E6}"
IID_AUDIO_CLIENT = "{1CB9AD4C-DBFA-4C32-B178-C2F568A703B2}"
IID_AUDIO_CAPTURE_CLIENT = "{C8ADBD64-E71E-48A0-A4DE-185C395CD317}"
CLSCTX_ALL = 23
E_RENDER, E_CONSOLE = 0, 0
SHAREMODE_SHARED = 0
STREAMFLAGS_LOOPBACK = 0x00020000
BUFFERFLAGS_SILENT = 0x2
WAVE_FORMAT_IEEE_FLOAT = 3
WAVE_FORMAT_EXTENSIBLE = 0xFFFE

# Positions of the methods in the COM method tables.
GET_DEFAULT_AUDIO_ENDPOINT = 4  # IMMDeviceEnumerator
ACTIVATE = 3  # IMMDevice
INITIALIZE, GET_MIX_FORMAT, START, STOP, GET_SERVICE = 3, 8, 10, 11, 14  # IAudioClient
GET_BUFFER, RELEASE_BUFFER, GET_NEXT_PACKET_SIZE = 3, 4, 5  # IAudioCaptureClient


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [("wFormatTag", ctypes.c_ushort), ("nChannels", ctypes.c_ushort), ("nSamplesPerSec", c_uint32),
                ("nAvgBytesPerSec", c_uint32), ("nBlockAlign", ctypes.c_ushort), ("wBitsPerSample", ctypes.c_ushort),
                ("cbSize", ctypes.c_ushort)]


class WAVEFORMATEXTENSIBLE(ctypes.Structure):
    _fields_ = [("Format", WAVEFORMATEX), ("wValidBitsPerSample", ctypes.c_ushort), ("dwChannelMask", c_uint32),
                ("SubFormat", ctypes.c_ubyte * 16)]


class Error(Exception):
    pass


def _check(hr, what):
    if hr < 0:
        raise Error(f"{what} failed (0x{hr & 0xFFFFFFFF:08X})")


def capture(keep_going, chunk_ms=20):
    """Yields (format, bytes): first a format dict {"rate", "channels", "kind": "f32"|"s16"}, then raw
    sound in that format, about every `chunk_ms`, while keep_going() is true. Silence comes as zeros.
    Windows only (raises Error elsewhere or when there are no speakers)."""
    if os.name != "nt":
        raise Error("Windows only")
    from folder_picker import GUID, call, release
    ole32 = ctypes.windll.ole32
    ole32.CoInitializeEx(None, 0)  # COINIT_MULTITHREADED
    enum = c_void_p()
    device = c_void_p()
    client = c_void_p()
    cap = c_void_p()
    fmt_ptr = POINTER(WAVEFORMATEX)()
    try:
        _check(ole32.CoCreateInstance(byref(GUID(CLSID_MM_DEVICE_ENUMERATOR)), None, CLSCTX_ALL,
                                      byref(GUID(IID_MM_DEVICE_ENUMERATOR)), byref(enum)), "devices")
        _check(call(enum, GET_DEFAULT_AUDIO_ENDPOINT, E_RENDER, E_CONSOLE, byref(device),
                    argtypes=(ctypes.c_int, ctypes.c_int, POINTER(c_void_p))), "speakers")
        _check(call(device, ACTIVATE, byref(GUID(IID_AUDIO_CLIENT)), CLSCTX_ALL, None, byref(client),
                    argtypes=(POINTER(GUID), ctypes.c_uint32, c_void_p, POINTER(c_void_p))), "activate")
        _check(call(client, GET_MIX_FORMAT, byref(fmt_ptr), argtypes=(POINTER(POINTER(WAVEFORMATEX)),)), "format")
        fmt = fmt_ptr.contents
        tag = fmt.wFormatTag
        if tag == WAVE_FORMAT_EXTENSIBLE:
            sub = ctypes.cast(fmt_ptr, POINTER(WAVEFORMATEXTENSIBLE)).contents.SubFormat
            tag = sub[0] | (sub[1] << 8)  # the first two bytes of the sub-format GUID are the format tag
        if tag == WAVE_FORMAT_IEEE_FLOAT and fmt.wBitsPerSample == 32:
            kind = "f32"
        elif fmt.wBitsPerSample == 16:
            kind = "s16"
        else:
            raise Error(f"sound format {tag}/{fmt.wBitsPerSample} bits")
        block = fmt.nBlockAlign
        info = {"rate": int(fmt.nSamplesPerSec), "channels": int(fmt.nChannels), "kind": kind}
        _check(call(client, INITIALIZE, SHAREMODE_SHARED, STREAMFLAGS_LOOPBACK, c_uint64(2_000_000), c_uint64(0),
                    fmt_ptr, None,
                    argtypes=(ctypes.c_int, c_uint32, c_uint64, c_uint64, POINTER(WAVEFORMATEX), c_void_p)), "start")
        _check(call(client, GET_SERVICE, byref(GUID(IID_AUDIO_CAPTURE_CLIENT)), byref(cap),
                    argtypes=(POINTER(GUID), POINTER(c_void_p))), "capture")
        _check(call(client, START), "start")
        yield info, b""
        data = c_void_p()
        frames = c_uint32()
        flags = c_uint32()
        size = c_uint32()
        while keep_going():
            time.sleep(chunk_ms / 1000)
            out = bytearray()
            while True:
                _check(call(cap, GET_NEXT_PACKET_SIZE, byref(size), argtypes=(POINTER(c_uint32),)), "read")
                if not size.value:
                    break
                _check(call(cap, GET_BUFFER, byref(data), byref(frames), byref(flags), None, None,
                            argtypes=(POINTER(c_void_p), POINTER(c_uint32), POINTER(c_uint32), c_void_p, c_void_p)),
                       "read")
                n = frames.value * block
                if flags.value & BUFFERFLAGS_SILENT or not data.value:
                    out += bytes(n)
                else:
                    out += ctypes.string_at(data.value, n)
                call(cap, RELEASE_BUFFER, frames, argtypes=(c_uint32,))
            if out:
                yield info, bytes(out)
    finally:
        if client:
            try:
                call(client, STOP)
            except OSError:
                pass
        if fmt_ptr:
            ole32.CoTaskMemFree(fmt_ptr)
        for obj in (cap, client, device, enum):
            if obj:
                release(obj)
        ole32.CoUninitialize()
