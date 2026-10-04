#!/usr/bin/env bash
# Builds dist/Lelons Converter Setup.exe from a Linux machine.
# Needs: curl, unzip, python3 with pip, and nsis (sudo apt install nsis)
set -euo pipefail

PYTHON_VERSION="3.14.8"
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

echo "==> Installing yt-dlp, ffmpeg and deno into it"
"$PY" -m pip install -q --disable-pip-version-check --upgrade \
  --target "$STAGE/runtime/Lib/site-packages" \
  --platform win_amd64 --python-version "${PYTHON_VERSION%.*}" --implementation cp --only-binary=:all: \
  "yt-dlp[default]" imageio-ffmpeg deno

echo "==> Moving ffmpeg to runtime\\ffmpeg\\ffmpeg.exe"
# yt-dlp looks for a program named exactly "ffmpeg" when downloading part of a video.
mkdir -p "$STAGE/runtime/ffmpeg"
mv "$STAGE"/runtime/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-*.exe "$STAGE/runtime/ffmpeg/ffmpeg.exe"

echo "==> Trimming things the app doesn't need"
R="$STAGE/runtime"
rm -rf "$R/include" "$R/libs" "$R/Lib/test" "$R/Lib/idlelib" "$R/Lib/turtledemo" "$R/Lib/tkinter" "$R/Lib/ensurepip"
find "$R" -name "__pycache__" -type d -prune -exec rm -rf {} +
# pip --target puts Linux-style launch scripts in bin/; only deno.exe is needed.
find "$R/Lib/site-packages/bin" -type f ! -name "deno.exe" -delete

echo "==> Copying the app"
cp "$ROOT"/src/*.py "$STAGE/app/"
cp -r "$ROOT/src/ui" "$STAGE/app/ui"
cp "$ROOT/assets/icon.png" "$ROOT/assets/icon.ico" "$STAGE/app/"

WINE="${WINE:-$(command -v wine64 || command -v wine || ls /usr/lib/wine/wine64 2>/dev/null || true)}"
if [ -n "$WINE" ]; then
  # Python turns code into a faster-loading form the first time it runs it,
  # which made the app's first start slow. Do that now instead, with the
  # bundled Windows Python running under Wine.
  echo "==> Precompiling Python code"
  # (Wine needs an open stdin, so feed it one.)
  { yes 2>/dev/null || true; } | WINEDEBUG=-all "$WINE" "$STAGE/runtime/python.exe" -E -s -m compileall -q -j 0 \
    --invalidation-mode unchecked-hash "$STAGE/runtime/Lib" "$STAGE/app" >/dev/null
else
  echo "==> Skipping precompile (install wine to make the first start faster)"
fi

echo "==> Making the installer"
(cd "$ROOT/installer" && makensis -V2 -DAPP_VERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$ROOT/dist/Lelons Converter Setup.exe" installer.nsi)

ls -lh "$ROOT/dist"
