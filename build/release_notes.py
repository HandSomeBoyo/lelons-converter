"""Prints the "What's new" notes of one version (from src/ui/whatsnew.js), for the GitHub release."""

import json
import os
import re
import sys

version = sys.argv[1].lstrip("v")
here = os.path.dirname(os.path.abspath(__file__))
text = open(os.path.join(here, "..", "src", "ui", "whatsnew.js"), encoding="utf-8").read()
block = re.search(r'\{ version: "' + re.escape(version) + r'", items: \[(.*?)\] \}', text, re.S)
items = re.findall(r'^\s*("(?:[^"\\]|\\.)*"),\s*$', block[1], re.M) if block else []
print("\n".join("- " + json.loads(item) for item in items) or f"Version {version}")
print("\nDownload **Ultimate Recording Setup.exe** below and run it. The app also updates itself.")
