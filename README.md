# Lelons Converter

Convert YouTube videos to MP3 or MP4, without sketchy converter websites.

## Installing

Run **Lelons Converter Setup.exe**. It installs the app for your Windows
account (no admin needed) and adds it to the Desktop and Start menu. Nothing
else needs installing: Python, yt-dlp and ffmpeg all come inside the app.

Windows may say "Windows protected your PC" the first time, because the app
isn't from a big company. Click **More info**, then **Run anyway**.

To remove it: Settings > Apps > Installed apps > Lelons Converter > Uninstall.

## Using it

1. Paste a YouTube link.
2. Pick MP3 or MP4 and a quality.
3. Click **Convert**. Files go to your Downloads folder unless you click **Change**.

If downloads stop working, click **Update downloader** and reopen the app.
YouTube changes things now and then, and the update usually fixes it.

Only download videos you're allowed to save (your own, Creative Commons, or
where the creator allows it).

## What's in this folder

```
Lelons Converter/
├── README.md            this file
├── src/                 the app itself
│   ├── main.py          starts the app, opens the window, handles button clicks
│   ├── downloader.py    the downloading and converting (uses yt-dlp)
│   ├── jobs.py          the download queue (one video at a time)
│   ├── updater.py       checks for a new version of the app
│   ├── version.py       the app's version number
│   ├── settings.py      remembers your save folder and quality choices
│   ├── folder_picker.py the Windows "Select Folder" window
│   └── ui/              how the window looks
│       ├── index.html   layout
│       ├── style.css    colors and styling
│       ├── app.js       what the buttons do
│       └── fonts/       the Montserrat and Inter fonts
├── assets/              app icon (icon.ico for Windows, icon.png for the window)
├── installer/           recipe for the Setup.exe installer
├── build/build.sh       builds the Setup.exe from all of the above
└── dist/                where the finished Setup.exe goes (keep a copy here to share)
```

## How it works

The window is a Microsoft Edge app window, which every Windows PC already has.
`main.py` runs a small server on your own computer that only the window can
talk to. When you click Convert, it uses yt-dlp to download the video and
ffmpeg to turn it into MP3 or MP4.

When installed, the app lives in `%LOCALAPPDATA%\Programs\Lelons Converter`
with its own copy of Python in `runtime\` and the app's code in `app\`. Your settings are in
`%LOCALAPPDATA%\LelonsConverter`.

## Updates

When the app opens, it checks the GitHub repository named in `src/version.py`
for a newer release. If it finds one, it shows an "Update now" button that
downloads the new installer and opens it.

To publish a new version: raise `VERSION` in `src/version.py`, build the
installer, then create a GitHub Release tagged like `v1.3.0` with
`Lelons Converter Setup.exe` attached.

## Building the installer

`build/build.sh` runs on Linux (it needs `nsis`). It downloads Python for
Windows, adds yt-dlp, ffmpeg and deno, and packs everything into
`dist/Lelons Converter Setup.exe`.

The app's shortcut starts Python's own `pythonw.exe` (signed by the Python
Software Foundation) with `app\main.py`, instead of a homemade .exe. Unsigned
homemade programs are what virus scanners are most suspicious of.
