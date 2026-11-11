"""The VaultHub buttons inside DaVinci Resolve.

Resolve runs scripts it finds in its Scripts folder from the Workspace >
Scripts menu (the free version too). VaultHub puts its scripts there
(resolve_scripts/): Subtitles, Cut Silence and Import Project. They ask
VaultHub to do the work (see resolvetools.py) and put the result in Resolve.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = {  # file in resolve_scripts -> name in Resolve's Scripts menu
    "subtitles.lua": "VaultHub Subtitles.lua",
    "silence.lua": "VaultHub Cut Silence.lua",
    "project.lua": "VaultHub Import Project.lua",
}


def scripts_folder():
    """Resolve's own Scripts folder for this Windows user, or None if Resolve isn't installed."""
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    resolve = os.path.join(appdata, "Blackmagic Design", "DaVinci Resolve")
    if not os.path.isdir(resolve):
        return None
    return os.path.join(resolve, "Support", "Fusion", "Scripts", "Utility")


def installed():
    folder = scripts_folder()
    return bool(folder) and all(os.path.isfile(os.path.join(folder, name)) for name in SCRIPTS.values())


def launch_command():
    """How the scripts start VaultHub when it isn't open (the same way the Start menu does)."""
    python = sys.executable
    if python.lower().endswith("python.exe"):
        windowless = python[:-len("python.exe")] + "pythonw.exe"
        if os.path.isfile(windowless):
            python = windowless
    main = os.path.join(HERE, "main.py")
    return f'"{python}" -E -s "{main}"'


def build(name):
    """One script's text, with the shared part and this PC's way of starting VaultHub filled in."""
    folder = os.path.join(HERE, "resolve_scripts")
    with open(os.path.join(folder, "common.lua"), encoding="utf-8") as f:
        common = f.read().replace("{{LAUNCH}}", launch_command())
    with open(os.path.join(folder, "progress.ps1"), encoding="utf-8") as f:
        common = common.replace("{{PROGRESS}}", f.read())
    with open(os.path.join(folder, name), encoding="utf-8") as f:
        script = f.read().replace("{{COMMON}}", common)
    # Any mistake shows up as a message instead of only in Resolve's Console.
    return ('print("VaultHub: starting...")\n'
            "local ok, problem = pcall(function()\n" + script + "\nend)\n"
            "if not ok then\n"
            '  print("VaultHub: something went wrong: " .. tostring(problem))\n'
            '  os.execute([[powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; '
            "$top = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; "
            "[void][System.Windows.Forms.MessageBox]::Show($top, 'Something went wrong in VaultHub. Open Workspace > Console in Resolve "
            "and send a screenshot of the VaultHub lines.', 'VaultHub')\"]])\n"
            "end\n")


def install(always=False):
    """Put the buttons into Resolve (or update them). Quietly does nothing without Resolve.
    always: write them even when they're already the newest (the "Update Resolve buttons" button)."""
    folder = scripts_folder()
    if not folder:
        return False
    try:
        os.makedirs(folder, exist_ok=True)
        for source, name in SCRIPTS.items():
            script = build(source)
            target = os.path.join(folder, name)
            try:
                with open(target, encoding="utf-8") as f:
                    if f.read() == script and not always:
                        continue
            except OSError:
                pass
            with open(target, "w", encoding="utf-8") as f:
                f.write(script)
        return True
    except OSError:
        return False
