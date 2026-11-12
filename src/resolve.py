"""Cleans up the VaultHub buttons that test versions put into DaVinci Resolve's Scripts menu.

The free Resolve 21 turns off what those scripts needed (reading files, running
programs, talking to other apps), so VaultHub now makes timeline files instead
(fcpxml.py) that Resolve brings in with File > Import > Timeline.
"""

import os

OLD_SCRIPTS = ("VaultHub Subtitles.lua", "VaultHub Cut Silence.lua", "VaultHub Import Project.lua")


def uninstall():
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return
    folder = os.path.join(appdata, "Blackmagic Design", "DaVinci Resolve", "Support", "Fusion", "Scripts", "Utility")
    for name in OLD_SCRIPTS:
        try:
            os.remove(os.path.join(folder, name))
        except OSError:
            pass
