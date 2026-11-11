"""The VaultHub Subtitles button inside DaVinci Resolve.

Resolve runs scripts it finds in its Scripts folder from the Workspace >
Scripts menu (the free version too). VaultHub puts resolve_subtitles.lua
there, so making subtitles is one click in Resolve. The script reads the
timeline, asks VaultHub to listen to it (see files.add_resolve_timeline) and
puts the subtitles back on the timeline.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT_NAME = "VaultHub Subtitles.lua"


def scripts_folder():
    """Resolve's own Scripts folder for this Windows user, or None if Resolve isn't installed."""
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    resolve = os.path.join(appdata, "Blackmagic Design", "DaVinci Resolve")
    if not os.path.isdir(resolve):
        return None
    return os.path.join(resolve, "Support", "Fusion", "Scripts", "Utility")


def launch_command():
    """How the script starts VaultHub when it isn't open (the same way the Start menu does)."""
    python = sys.executable
    if python.lower().endswith("python.exe"):
        windowless = python[:-len("python.exe")] + "pythonw.exe"
        if os.path.isfile(windowless):
            python = windowless
    main = os.path.join(HERE, "main.py")
    return f'"{python}" -E -s "{main}"'


def install():
    """Put the button into Resolve (or update it). Quietly does nothing without Resolve."""
    folder = scripts_folder()
    if not folder:
        return False
    try:
        with open(os.path.join(HERE, "resolve_subtitles.lua"), encoding="utf-8") as f:
            script = f.read().replace("{{LAUNCH}}", launch_command())
        target = os.path.join(folder, SCRIPT_NAME)
        try:
            with open(target, encoding="utf-8") as f:
                if f.read() == script:
                    return True
        except OSError:
            pass
        os.makedirs(folder, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(script)
        return True
    except OSError:
        return False
