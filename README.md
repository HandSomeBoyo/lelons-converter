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

1. Paste a link from YouTube, TikTok, SoundCloud, X/Twitter, Instagram or
   one of the many other sites yt-dlp knows.
2. Pick a format and a quality:
   - **MP3** or **M4A** for music, **WAV** or **FLAC** for perfect (lossless) sound
   - **MP4** for video. "Under 10 MB (Discord)", "Under 25 MB" and "Under 50 MB"
     make the video just small enough to send.
   - **GIF** for a looping clip without sound (up to 60 seconds; the first 10
     seconds unless you pick a part)
3. Click **Convert**. Files go to your Downloads folder unless you click **Change**.

**Even out volume** (for the music formats) makes quiet and loud songs about
equally loud.

Paste a **playlist** link and the app lists its videos. Untick the ones you
don't want and click **Convert**. If you paste a video that's in a playlist,
click "Get the whole playlist" to see the rest.

To save only part of a video, click **Trim** under the preview. Drag the
yellow Start and End lines on the waveform (or type the times), press play to
hear your pick, then click **Done**. For MP4s and GIFs the video plays above
the waveform, and dragging a line shows that moment of the video.

MP3s, M4As and FLACs get the video's thumbnail as cover art, plus the song
title and artist, so they look right in music apps.

The **Files** tab does the same for videos and songs already on your PC. Drop
them in (or click **choose files**), pick a format, and if you like a smaller
size, a part to keep (**Trim**), or even volume. Your original files aren't
changed.

The **Images** tab changes pictures. Drop one or more images into the box (or
click **choose files**), then pick a format (PNG, JPG, WEBP, GIF, BMP, ICO or
PDF), a size, and if you like turn, mirror, crop to a square or make it black
and white. Click **Convert** and the new files are saved next to your
downloads. Your original pictures aren't changed.

If downloads stop working, click **Check for updates**. YouTube changes
things now and then, and a newer downloader usually fixes it.

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
│   ├── updater.py       keeps the app and the downloader up to date
│   ├── waveform.py      the sound picture for the trim editor
│   ├── images.py        the Images tab's converting (uses Pillow)
│   ├── files.py         the Files tab's list of your own videos and songs
│   ├── media.py         converting with ffmpeg: formats, GIFs, smaller files, even volume
│   ├── version.py       the app's version number
│   ├── settings.py      remembers your save folder and quality choices
│   ├── folder_picker.py the Windows "Select Folder" window
│   └── ui/              how the window looks
│       ├── index.html   layout
│       ├── style.css    colors and styling
│       ├── app.js       what the buttons do
│       ├── images.js    what the Images tab's buttons do
│       ├── files.js     what the Files tab's buttons do
│       └── fonts/       the Space Grotesk and Inter fonts
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

With **Auto-update** ticked (it is unless you untick it), the app checks for
updates every time it opens. **Check for updates** checks right away.

- **The app:** it looks at the GitHub repository named in `src/version.py`
  for a newer release. If there is one, a popup offers to install it. The
  installer closes the running app, updates it and opens it again.
- **The downloader (yt-dlp):** newer versions are downloaded from PyPI into
  `%LOCALAPPDATA%\LelonsConverter\yt-dlp` and used from the next start.

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
