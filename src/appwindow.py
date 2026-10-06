"""The app's own window, with the page shown inside it by WebView2.

WebView2 is the Edge engine that comes with Windows 10 and 11, made for
putting web pages inside apps. Because the window belongs to the app itself,
Task Manager and the taskbar show "VaultHub" instead of Microsoft Edge.

Talks to Windows and WebView2 through ctypes. If anything doesn't work
(no WebView2 on the PC, say), show() returns False and the app uses an Edge
app window like before.
"""

import ctypes
import os
import threading
from ctypes import wintypes

TITLE = "VaultHub"
BACKGROUND = (0x14, 0x14, 0x14)  # the page's --bg, so opening it doesn't flash white
SIZE = (960, 760)

HRESULT = ctypes.c_long
_FUNCTYPE = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)  # (CFUNCTYPE only so this loads off Windows)
S_OK = 0
E_NOINTERFACE = 0x80004002 - 0x100000000

WM_DESTROY, WM_SIZE, WM_MOVE, WM_ACTIVATE, WM_CLOSE = 0x0002, 0x0005, 0x0003, 0x0006, 0x0010
WM_SETICON, WM_APP = 0x0080, 0x8000
WM_SHOW = WM_APP + 1  # "come to the front", from another thread
WM_DRAG = WM_APP + 2  # "drag this file out of the window", from another thread
WM_ZOOM = WM_APP + 3  # "show the page at this size", from another thread

_lock = threading.Lock()
_window = None  # the open Window, if there is one
_zoom = 1.0  # how big the page is drawn (the Size setting)
_dark = True  # a dark title bar (the theme)


def available():
    return os.name == "nt" and os.path.isfile(_loader_path())


def _loader_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "WebView2Loader.dll")


def show(url, data_folder, icon, on_closed, placement=None):
    """Open the window showing url (or bring the open one to the front).

    Returns False if WebView2 can't be used. on_closed(placement) is called once
    the window is gone, with where it was ([left, top, right, bottom, maximized])
    so it can open there next time (pass that back as placement).
    """
    global _window
    if not available():
        return False
    with _lock:
        if _window and (_window.alive or not (_window.started.is_set() or _window.cancelled)):
            _window.show()  # open, or opening right now
            return True
        window = _window = Window(url, data_folder, icon, on_closed, placement)
    window.thread.start()
    if not window.started.wait(60):
        window.cancel()  # taking far too long: the app uses Edge instead, so don't show this one later
        return False
    return window.ok


def drag(path, image=None, offset=None, done=None):
    """Start dragging a file out of the window (the mouse button is held on it right now).

    image/offset: the card to show under the mouse (see dragout.drag); done(result) is called after.
    Returns False if there's no window of ours to do it from.
    """
    window = _window
    if not (window and window.alive and window.hwnd):
        return False
    window.drag_path = (path, image, offset, done)
    window.user32.PostMessageW(window.hwnd, WM_DRAG, 0, 0)
    return True


def set_zoom(factor):
    """Draw the page bigger or smaller (1.0 = normal). Returns False if there's no window of ours."""
    global _zoom
    _zoom = float(factor)
    window = _window
    if not (window and window.alive and window.hwnd):
        return False
    window.user32.PostMessageW(window.hwnd, WM_ZOOM, 0, 0)
    return True


def set_dark(dark):
    """A dark or light title bar, to match the theme."""
    global _dark
    _dark = bool(dark)
    window = _window
    if window and window.alive and window.hwnd:
        window.title_bar()


def active():
    window = _window
    return bool(window and window.alive and window.hwnd)


def close():
    """Close the window (when the app quits) and wait a moment for it to go."""
    window = _window
    if window and window.alive and window.hwnd:
        window.user32.PostMessageW(window.hwnd, WM_CLOSE, 0, 0)
        window.thread.join(3)


# ---------------------------------------------------------------- COM plumbing

class GUID(ctypes.Structure):
    _fields_ = [("data1", wintypes.DWORD), ("data2", wintypes.WORD), ("data3", wintypes.WORD),
                ("data4", ctypes.c_ubyte * 8)]


def _method(obj, index, *argtypes):
    """A COM object's method number index, ready to call (the object is passed for you)."""
    vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    function = _FUNCTYPE(HRESULT, ctypes.c_void_p, *argtypes)(vtable[index])
    return lambda *args: function(obj, *args)


INVOKE = _FUNCTYPE(HRESULT, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
INVOKE_RESULT = _FUNCTYPE(HRESULT, ctypes.c_void_p, HRESULT, ctypes.c_void_p)
QUERY = _FUNCTYPE(HRESULT, ctypes.c_void_p, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))
REFCOUNT = _FUNCTYPE(wintypes.ULONG, ctypes.c_void_p)


def _guid(text):
    guid = GUID()
    ctypes.windll.ole32.CLSIDFromString("{%s}" % text, ctypes.byref(guid))
    return bytes(guid)


IUNKNOWN = "00000000-0000-0000-c000-000000000046"
ENVIRONMENT_DONE = "4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d"
CONTROLLER_DONE = "6c4819f3-c9b7-4260-8127-c9f5bde7f68c"
CLOSE_REQUESTED = "5c19e9e0-092f-486b-affa-ca8231913039"
NEW_WINDOW_REQUESTED = "d4c185fe-c81c-4989-97af-2d3fa7ab5651"
CONTROLLER2 = "c979903e-d4ca-4228-92eb-47ee3fa96eab"


class Handler:
    """A small COM object WebView2 calls back: IUnknown plus Invoke.

    kind: which handler it is (its interface id). with_result: Invoke(HRESULT,
    object) (the "completed" handlers), else Invoke(sender, args).
    """

    def __init__(self, kind, invoke, with_result):
        known = {_guid(IUNKNOWN), _guid(kind)}

        def query(this, iid, out):
            if bytes(iid.contents) in known:
                out[0] = this
                return S_OK
            out[0] = None
            return E_NOINTERFACE

        self._functions = [QUERY(query), REFCOUNT(lambda this: 1), REFCOUNT(lambda this: 1),
                           (INVOKE_RESULT if with_result else INVOKE)(invoke)]
        self._vtable = (ctypes.c_void_p * 4)(*[ctypes.cast(f, ctypes.c_void_p) for f in self._functions])
        self._object = ctypes.c_void_p(ctypes.addressof(self._vtable))
        self.pointer = ctypes.addressof(self._object)


class Token(ctypes.Structure):
    _fields_ = [("value", ctypes.c_int64)]


class Color(ctypes.Structure):
    _fields_ = [("A", ctypes.c_ubyte), ("R", ctypes.c_ubyte), ("G", ctypes.c_ubyte), ("B", ctypes.c_ubyte)]


# ---------------------------------------------------------------- Windows

WNDPROC = _FUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE),
                ("hIcon", wintypes.HANDLE), ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HANDLE),
                ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", wintypes.HANDLE)]


class WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [("length", wintypes.UINT), ("flags", wintypes.UINT), ("showCmd", wintypes.UINT),
                ("ptMinPosition", wintypes.POINT), ("ptMaxPosition", wintypes.POINT),
                ("rcNormalPosition", wintypes.RECT)]


_windows = {}  # hwnd -> Window, for the one window procedure all windows share
# Every COM callback object ever handed to WebView2. Never freed: WebView2 may
# still hold one after its window is gone, and they're tiny.
_handlers = []


@WNDPROC
def _window_procedure(hwnd, message, wparam, lparam):
    window = _windows.get(hwnd)
    if window:
        return window._message(hwnd, message, wparam, lparam)
    default = ctypes.windll.user32.DefWindowProcW
    default.restype = ctypes.c_ssize_t
    default.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    return default(hwnd, message, wparam, lparam)


class Window:
    def __init__(self, url, data_folder, icon, on_closed, placement=None):
        self.url, self.data_folder, self.icon, self.on_closed = url, data_folder, icon, on_closed
        self.placement = placement
        self.cancelled = False
        self.webview = None
        self.hwnd = None
        self.drag_path = None
        self.controller = None
        self.environment = None
        self.ok = False
        self.alive = False
        self.started = threading.Event()  # set once it's showing the page, or failed
        self.handlers = _handlers  # kept so Python doesn't free them while WebView2 uses them
        self.thread = threading.Thread(target=self._run, daemon=True)

    # ---- from other threads

    def show(self):
        if self.hwnd:
            self.user32.PostMessageW(self.hwnd, WM_SHOW, 0, 0)

    def cancel(self):
        self.cancelled = True
        if self.hwnd:
            self.user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    # ---- the window's own thread

    def _run(self):
        try:
            self._setup()
        except Exception:
            self._fail()
            return
        message = wintypes.MSG()
        while self.user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            self.user32.TranslateMessage(ctypes.byref(message))
            self.user32.DispatchMessageW(ctypes.byref(message))
        self.alive = False
        if self.ok:
            self.on_closed(self.closed_at)

    def _guarded(self, callback):
        """A WebView2 callback that, if anything in it goes wrong, gives up on the window
        (so the app opens Edge instead of waiting with a window that never shows)."""
        def run(*args):
            try:
                return callback(*args)
            except Exception:
                self._fail()
                self.user32.PostQuitMessage(0)
                return S_OK
        return run

    def _fail(self):
        self.ok = False
        if self.hwnd:
            hwnd, self.hwnd = self.hwnd, None
            self.user32.DestroyWindow(hwnd)
        self.started.set()

    def _setup(self):
        user32 = self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                           ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND,
                                           wintypes.HANDLE, wintypes.HINSTANCE, ctypes.c_void_p]
        user32.DefWindowProcW.restype = ctypes.c_ssize_t
        user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.LoadImageW.restype = wintypes.HANDLE
        user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int,
                                      ctypes.c_int, wintypes.UINT]
        user32.LoadCursorW.restype = wintypes.HANDLE
        user32.LoadCursorW.argtypes = [wintypes.HINSTANCE, ctypes.c_void_p]
        user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.IsIconic.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.DestroyWindow.argtypes = [wintypes.HWND]
        kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        gdi32 = ctypes.WinDLL("gdi32")
        gdi32.CreateSolidBrush.restype = wintypes.HANDLE

        ctypes.windll.ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED: WebView2 needs it
        ctypes.windll.ole32.OleInitialize(None)  # for dragging files out of the window
        try:  # sharp text on high-resolution screens
            user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # per monitor v2
        except (AttributeError, OSError):
            pass
        try:
            scale = user32.GetDpiForSystem() / 96
        except (AttributeError, OSError):
            scale = 1

        instance = kernel32.GetModuleHandleW(None)
        big = user32.LoadImageW(None, self.icon, 1, 0, 0, 0x10 | 0x40)  # IMAGE_ICON, LR_LOADFROMFILE | LR_DEFAULTSIZE
        small = user32.LoadImageW(None, self.icon, 1, 16, 16, 0x10)
        r, g, b = BACKGROUND
        cls = WNDCLASSEXW(cbSize=ctypes.sizeof(WNDCLASSEXW), lpfnWndProc=_window_procedure, hInstance=instance,
                          hIcon=big, hIconSm=small, hCursor=user32.LoadCursorW(None, ctypes.c_void_p(32512)),
                          hbrBackground=gdi32.CreateSolidBrush(r | g << 8 | b << 16), lpszClassName="LelonsConverterWindow")
        user32.RegisterClassExW(ctypes.byref(cls))  # fails harmlessly when already registered

        width, height = (int(n * scale) for n in SIZE)
        self.closed_at = None
        self.hwnd = user32.CreateWindowExW(0, "LelonsConverterWindow", TITLE, 0x00CF0000 | 0x02000000,
                                           # WS_OVERLAPPEDWINDOW, and WS_CLIPCHILDREN so the window
                                           # doesn't paint its background over the page
                                           -0x80000000, -0x80000000, width, height,  # CW_USEDEFAULT: Windows picks the spot
                                           None, None, instance, None)
        if not self.hwnd:
            raise OSError("no window")
        _windows[self.hwnd] = self
        self._restore_placement()
        for kind, handle in ((1, big), (0, small)):  # ICON_BIG, ICON_SMALL
            if handle:
                user32.SendMessageW(self.hwnd, WM_SETICON, kind, handle)
        self.title_bar()

        loader = ctypes.WinDLL(_loader_path())
        create = loader.CreateCoreWebView2EnvironmentWithOptions
        create.restype = HRESULT
        create.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p]
        handler = Handler(ENVIRONMENT_DONE, self._guarded(self._environment_ready), with_result=True)
        self.handlers.append(handler)
        os.makedirs(self.data_folder, exist_ok=True)
        if create(None, self.data_folder, None, handler.pointer) != S_OK:
            raise OSError("WebView2 isn't installed")

    def _environment_ready(self, this, error, environment):
        if error != S_OK or not environment:
            self._fail()
            self.user32.PostQuitMessage(0)
            return S_OK
        _method(environment, 1)()  # AddRef: keep it while the window is open
        self.environment = environment
        handler = Handler(CONTROLLER_DONE, self._guarded(self._controller_ready), with_result=True)
        self.handlers.append(handler)
        result = _method(environment, 3, wintypes.HWND, ctypes.c_void_p)(self.hwnd, handler.pointer)
        if result != S_OK:
            self._fail()
            self.user32.PostQuitMessage(0)
        return S_OK

    def _controller_ready(self, this, error, controller):
        if error != S_OK or not controller or self.cancelled:
            self._fail()
            self.user32.PostQuitMessage(0)
            return S_OK
        _method(controller, 1)()  # AddRef: keep it after this call
        self.controller = controller
        webview = ctypes.c_void_p()
        _method(controller, 25, ctypes.POINTER(ctypes.c_void_p))(ctypes.byref(webview))  # get_CoreWebView2
        self.webview = webview.value

        # The page's own background colour while it loads (ICoreWebView2Controller2).
        iid = GUID.from_buffer_copy(_guid(CONTROLLER2))
        controller2 = ctypes.c_void_p()
        if _method(controller, 0, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))(
                ctypes.byref(iid), ctypes.byref(controller2)) == S_OK and controller2.value:
            r, g, b = BACKGROUND
            _method(controller2.value, 27, Color)(Color(255, r, g, b))
            _method(controller2.value, 2)()

        settings = ctypes.c_void_p()
        _method(self.webview, 3, ctypes.POINTER(ctypes.c_void_p))(ctypes.byref(settings))
        if settings.value:
            _method(settings.value, 10, wintypes.BOOL)(False)  # no status bar at the bottom
            _method(settings.value, 12, wintypes.BOOL)(False)  # no developer tools
            _method(settings.value, 18, wintypes.BOOL)(False)  # the page does Ctrl+scroll itself (the Size setting)
            _method(settings.value, 2)()

        # The page closes itself after starting an update: close the window too.
        token = Token()
        close = Handler(CLOSE_REQUESTED, self._close_requested, with_result=False)
        self.handlers.append(close)
        _method(self.webview, 59, ctypes.c_void_p, ctypes.POINTER(Token))(close.pointer, ctypes.byref(token))
        # Links that would open a new window open in the normal browser instead.
        popup = Handler(NEW_WINDOW_REQUESTED, self._new_window, with_result=False)
        self.handlers.append(popup)
        _method(self.webview, 44, ctypes.c_void_p, ctypes.POINTER(Token))(popup.pointer, ctypes.byref(token))

        self._fit()
        self._zoom()
        _method(self.webview, 5, wintypes.LPCWSTR)(self.url)  # Navigate
        self.user32.ShowWindow(self.hwnd, 3 if self.maximized else 1)  # SW_SHOWMAXIMIZED / SW_SHOWNORMAL
        self.user32.SetForegroundWindow(self.hwnd)
        _method(controller, 4, wintypes.BOOL)(True)  # put_IsVisible
        _method(controller, 12, ctypes.c_int)(0)  # MoveFocus: typing goes to the page
        self.ok = self.alive = True
        self.started.set()
        return S_OK

    def title_bar(self):
        try:  # a dark (or light) title bar, to match the theme
            dark = ctypes.c_int(1 if _dark else 0)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(wintypes.HWND(self.hwnd), 20, ctypes.byref(dark), 4)
        except (AttributeError, OSError):
            pass

    def _zoom(self):
        if self.controller:
            _method(self.controller, 8, ctypes.c_double)(max(0.5, min(2.0, _zoom)))  # put_ZoomFactor

    def _restore_placement(self):
        """Put the window where it was last time, if that's still on a screen."""
        self.maximized = False
        try:
            left, top, right, bottom, maximized = (int(n) for n in self.placement)
        except (TypeError, ValueError):
            return
        rect = wintypes.RECT(left, top, right, bottom)
        if right - left < 400 or bottom - top < 300:
            return
        monitor = ctypes.windll.user32.MonitorFromRect
        monitor.restype = wintypes.HANDLE
        monitor.argtypes = [ctypes.POINTER(wintypes.RECT), wintypes.DWORD]
        if not monitor(ctypes.byref(rect), 0):  # MONITOR_DEFAULTTONULL: not on any screen now
            return
        place = WINDOWPLACEMENT(length=ctypes.sizeof(WINDOWPLACEMENT), showCmd=0, rcNormalPosition=rect)  # SW_HIDE
        ctypes.windll.user32.SetWindowPlacement(wintypes.HWND(self.hwnd), ctypes.byref(place))
        self.maximized = bool(maximized)

    def _remember_placement(self, hwnd):
        place = WINDOWPLACEMENT(length=ctypes.sizeof(WINDOWPLACEMENT))
        if ctypes.windll.user32.GetWindowPlacement(wintypes.HWND(hwnd), ctypes.byref(place)):
            r = place.rcNormalPosition
            # 3: maximized now. 2 (WPF_RESTORETOMAXIMIZED): minimized from maximized.
            maximized = place.showCmd == 3 or (place.showCmd == 2 and place.flags & 2)
            self.closed_at = [r.left, r.top, r.right, r.bottom, int(bool(maximized))]

    def _close_requested(self, this, sender, args):
        self.user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
        return S_OK

    def _new_window(self, this, sender, args):
        uri = ctypes.c_wchar_p()
        _method(args, 3, ctypes.POINTER(ctypes.c_wchar_p))(ctypes.byref(uri))  # get_Uri
        _method(args, 6, wintypes.BOOL)(True)  # put_Handled: no WebView2 popup
        link = uri.value or ""
        ctypes.windll.ole32.CoTaskMemFree(uri)
        if link.startswith(("https://", "http://")):
            os.startfile(link)
        return S_OK

    def _fit(self):
        if self.controller:
            rect = wintypes.RECT()
            self.user32.GetClientRect(self.hwnd, ctypes.byref(rect))
            _method(self.controller, 6, wintypes.RECT)(rect)  # put_Bounds

    def _message(self, hwnd, message, wparam, lparam):
        if message == WM_SIZE:
            self._fit()
        elif message == WM_MOVE and self.controller:
            _method(self.controller, 23)()  # NotifyParentWindowPositionChanged
        elif message == WM_ACTIVATE and self.controller and wparam & 0xFFFF:
            _method(self.controller, 12, ctypes.c_int)(0)
        elif message == WM_DRAG:
            wanted, self.drag_path = self.drag_path, None
            if wanted:
                path, image, offset, done = wanted
                result = False
                try:
                    import dragout
                    result = dragout.drag(path, hwnd, image, offset)  # Windows runs the drag here until it's dropped
                except Exception:
                    pass
                if done:
                    done(result)
            return 0
        elif message == WM_ZOOM:
            self._zoom()
            return 0
        elif message == WM_SHOW:
            if self.user32.IsIconic(hwnd):
                self.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            self.user32.SetForegroundWindow(hwnd)
            return 0
        elif message == WM_DESTROY:
            if self.ok:
                self._remember_placement(hwnd)
            if self.controller:
                controller, self.controller = self.controller, None
                _method(controller, 24)()  # Close
                if self.webview:
                    _method(self.webview, 2)()  # Release (get_CoreWebView2 gave us a reference)
                    self.webview = None
                _method(controller, 2)()  # Release
            if self.environment:
                _method(self.environment, 2)()
                self.environment = None
            _windows.pop(hwnd, None)
            self.hwnd = None
            self.user32.PostQuitMessage(0)
            return 0
        return self.user32.DefWindowProcW(hwnd, message, wparam, lparam)
