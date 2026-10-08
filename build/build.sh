#!/usr/bin/env bash
# Builds dist/VaultHub Setup.exe from a Linux machine.
# Needs: curl, unzip, python3 with pip, and nsis (sudo apt install nsis)
set -euo pipefail

PYTHON_VERSION="3.14.8"
WEBVIEW2_VERSION="1.0.4258.31"  # Microsoft's WebView2 SDK, for the app's window
RCEDIT_VERSION="2.0.0"          # sets the name and icon of "VaultHub.exe"
PY="${PY:-python3}"  # any Python that has pip
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/work"
STAGE="$WORK/stage"
VERSION="$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$ROOT/src/version.py")"

rm -rf "$STAGE"
mkdir -p "$WORK" "$STAGE/app" "$ROOT/dist"

echo "==> Getting Python $PYTHON_VERSION for Windows"
NUPKG="$WORK/python-$PYTHON_VERSION.nupkg"
[ -f "$NUPKG" ] || curl -sSL -o "$NUPKG" "https://api.nuget.org/v3-flatcontainer/python/$PYTHON_VERSION/python.$PYTHON_VERSION.nupkg"
rm -rf "$WORK/python"
unzip -q "$NUPKG" "tools/*" -d "$WORK/python"
mv "$WORK/python/tools" "$STAGE/runtime"

echo "==> Installing yt-dlp, ffmpeg, deno, Pillow and the Editor's AI (onnxruntime) into it"
"$PY" -m pip install -q --disable-pip-version-check --upgrade \
  --target "$STAGE/runtime/Lib/site-packages" \
  --platform win_amd64 --python-version "${PYTHON_VERSION%.*}" --implementation cp --only-binary=:all: \
  "yt-dlp[default]" imageio-ffmpeg deno pillow onnxruntime numpy

echo "==> Adding msvcp140.dll (onnxruntime needs it; not every PC has the Visual C++ runtime)"
"$PY" -m pip download -q --disable-pip-version-check --no-deps -d "$WORK/msvc" \
  --platform win_amd64 --python-version "${PYTHON_VERSION%.*}" --implementation cp --only-binary=:all: msvc-runtime
unzip -q -o -j "$WORK"/msvc/msvc_runtime-*.whl "*/data/msvcp140.dll" "*/data/msvcp140_1.dll" -d "$STAGE/runtime"

echo "==> Moving ffmpeg to runtime\\ffmpeg\\ffmpeg.exe"
# yt-dlp looks for a program named exactly "ffmpeg" when downloading part of a video.
mkdir -p "$STAGE/runtime/ffmpeg"
mv "$STAGE"/runtime/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-*.exe "$STAGE/runtime/ffmpeg/ffmpeg.exe"

echo "==> Trimming things the app doesn't need"
R="$STAGE/runtime"
rm -rf "$R/include" "$R/libs" "$R/Lib/test" "$R/Lib/idlelib" "$R/Lib/turtledemo" "$R/Lib/tkinter" "$R/Lib/ensurepip" \
  "$R/Lib/venv" "$R/Lib/pydoc_data" "$R/Lib/site-packages/share"
# pip isn't used: the app downloads yt-dlp updates itself.
rm -rf "$R"/Lib/site-packages/pip "$R"/Lib/site-packages/pip-*.dist-info
find "$R" -name "__pycache__" -type d -prune -exec rm -rf {} +
# pip --target puts Linux-style launch scripts in bin/; only deno.exe is needed.
find "$R/Lib/site-packages/bin" -type f ! -name "deno.exe" -delete

echo "==> Copying the app"
cp "$ROOT"/src/*.py "$STAGE/app/"
cp -r "$ROOT/src/ui" "$STAGE/app/ui"
cp "$ROOT/assets/icon.png" "$ROOT/assets/icon.ico" "$STAGE/app/"

echo "==> Getting WebView2Loader.dll"
WV="$WORK/webview2-$WEBVIEW2_VERSION.nupkg"
[ -f "$WV" ] || curl -sSL -o "$WV" "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WEBVIEW2_VERSION/microsoft.web.webview2.$WEBVIEW2_VERSION.nupkg"
unzip -q -o -j "$WV" "build/native/x64/WebView2Loader.dll" -d "$STAGE/app"

echo "==> Getting fpcalc.exe (audio fingerprints for the Copyright tab)"
CHROMAPRINT_VERSION="1.5.1"
FP="$WORK/chromaprint-fpcalc-$CHROMAPRINT_VERSION-windows-x86_64.zip"
[ -f "$FP" ] || curl -sSL -o "$FP" "https://github.com/acoustid/chromaprint/releases/download/v$CHROMAPRINT_VERSION/chromaprint-fpcalc-$CHROMAPRINT_VERSION-windows-x86_64.zip"
unzip -q -o -j "$FP" "*/fpcalc.exe" -d "$STAGE/app"

WINE="${WINE:-$(command -v wine64 || command -v wine || ls /usr/lib/wine/wine64 2>/dev/null || true)}"
[ -n "$WINE" ] || { echo "Wine is needed to name VaultHub.exe"; exit 1; }

echo "==> Making VaultHub.exe"
# Python's own pythonw.exe under the app's name, with the app's icon and
# details, so Windows (Task Manager, the taskbar) shows it as VaultHub.
# Changing the file breaks Python's signature on it, so that is taken off.
RC="$WORK/rcedit-$RCEDIT_VERSION.exe"
[ -f "$RC" ] || curl -sSL -o "$RC" "https://github.com/electron/rcedit/releases/download/v$RCEDIT_VERSION/rcedit-x64.exe"
EXE="$STAGE/runtime/VaultHub.exe"
"$PY" "$ROOT/build/unsign.py" "$STAGE/runtime/pythonw.exe" "$EXE"
{ yes 2>/dev/null || true; } | WINEDEBUG=-all "$WINE" "$RC" "$EXE" \
  --set-icon "$ROOT/assets/icon.ico" \
  --set-file-version "$VERSION" --set-product-version "$VERSION" \
  --set-version-string FileDescription "VaultHub" \
  --set-version-string ProductName "VaultHub" \
  --set-version-string CompanyName "Lelon" \
  --set-version-string LegalCopyright "Lelon. Built on Python, by the Python Software Foundation." \
  --set-version-string InternalName "VaultHub" \
  --set-version-string OriginalFilename "VaultHub.exe" | cat

# (Python code is turned into its faster-loading form by the installer, on
# the PC itself, which keeps the download smaller. See installer.nsi.)

echo "==> Making the installer"
(cd "$ROOT/installer" && makensis -V2 -DAPP_VERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$ROOT/dist/VaultHub Setup.exe" installer.nsi)

ls -lh "$ROOT/dist"
