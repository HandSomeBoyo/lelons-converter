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
   Up to 3 videos download at the same time. A file never replaces one with the
   same name; it's saved as "name (2)" instead. The square button next to a
   download stops it.

**Even out volume** (for the music formats) makes quiet and loud songs about
equally loud.

Paste a **playlist** link and the app lists its videos. Untick the ones you
don't want and click **Convert**. If you paste a video that's in a playlist,
click "Get the whole playlist" to see the rest.

To save only part of a video, click **Trim** under the preview. Play it (or
click the waveform to jump around) and press **Set start here** and **Set end
here** at the right moments. You can also drag the yellow lines, type the
times, or nudge them with -1s and +1s. **Play my part** plays just your pick.
Then click **Done**. For MP4s and GIFs the video plays above
the waveform, and dragging a line shows that moment of the video.

The **Library** tab is a sound library you share with your friends. Everyone
makes an account with just a username and password (the round account button
at the top right), then plays, searches and downloads the sounds by category
(SFX, Music, Memes, Ambience, Other). Each sound shows its waveform (click it
to play from that spot) and who uploaded it. Click it and pick **Manage account**
to open your Account page: change your profile picture, username or password,
log out, or delete your account.

Accounts have roles. The **Owner** (the username set in `sfx/setup.sql`) also gets
People and roles on the Account page, to see every account, change roles and
remove people. **Admins**
can upload sounds (any sound or video file, trimmed if you like, up to 10 MB)
and delete them. **Viewers** can listen and download. New accounts start as
viewers. The sounds are kept in a free Supabase project; `sfx/setup.sql` sets
it up.

**Clips from the trim editor:** after picking your part, click **Make a clip
to drag** and drag the clip straight into your editor. Moving the lines makes
the clip again by itself. Clips are kept in `%LOCALAPPDATA%\LelonsConverter\Clips`.

In the Library, click the star on a sound to add it to your **Favorites**. The
panel on the left picks what you see: all sounds, your favorites, a category,
or one person's uploads. **Sort** lists them favorites first, newest, oldest,
by name, by length or by uploader.

**Live chat:** the "online" button at the top right shows how many people have
the app open right now. Click it to chat with everyone who has an account. Your
own messages (and, for the Owner and Admins, anyone's) can be deleted.

In the chat you can send Library sounds (the chat button on a sound) and clips
from the trim editor (**Send to chat**), react with emojis, and @mention people.
Click a name or picture to see their **profile** (role, last online, newest
sounds) or to send them a **private message**.

Paste **many links at once** (one per line, or with spaces) and the app looks
them all up and lists them like a playlist, so you can convert them together.

**Home** (the first tab) shows the crew's YouTube channels with live subscriber
counters and their newest uploads, who's online, the newest Library sounds, the
latest chat messages, your own stats and your recent downloads. Paste a link there
to convert it right away. The Owner can change the channels with "Change channels".
"See stats" opens charts of each channel's subscriber growth (7 days, 30 days or all
time), a leaderboard, the most watched recent videos and uploads per channel. Logged-in
apps write each channel's subscribers to Supabase once a day (lelons.channel_stats),
so the history fills in over time.

**Chat:** shows "... is typing" and small faces under the last message each person has
read (lelons.chat_typing / lelons.chat_seen, via lelons_chat_typing and lelons_chat_live,
only while the chat is open). **Activity** on Home lists new sounds, new people, new videos
and channels passing a round number (lelons.activity() inside lelons_home).

**Instant start:** the app keeps what the page last showed (account, Home, Library list) in
page-cache.json and puts it into the page, so it draws at once and updates in the background.

**Find sounds** (in the Library) searches free sound effects (Openverse: Freesound and
others, Creative Commons) and meme sounds (Myinstants). Listen, download as MP3, or
"Add to Library", which opens the upload window with the sound ready.

**How to use** (in the question mark menu at the top) plays a short animated tour of the app. It opens
by itself the first time. The Voice button reads it out loud with Windows' own voice.

**Where to save:** the app asks with a folder picker every time you convert or
download. In Settings, "Always save to" picks one folder instead. The round
arrow at the top (or F5) refreshes the page you're on. Uploaders, admins and the owner can change a
sound's name or category with the pencil button.

**Settings** (the gear at the top): **Hardware acceleration** (on by default) uses
your graphics card to make videos faster and draw the window. Turn it off if
videos come out broken or the app looks glitchy. Pick a theme (Dark, Black or
Light) and an accent color too. **Size** makes the whole app bigger or smaller
(or hold Ctrl and scroll, or press Ctrl and + or -; Ctrl and 0 resets it).
**Updates** (turn automatic updates on or off, or check now) are in Settings too.

**The player bar** shows at the bottom as soon as any sound plays (Library, Find
sounds, Home, the chat or a profile), like on Artlist: play/pause (it carries on
where you paused), previous and next, a waveform to click or drag through, the
time, the star, download, the volume for every sound in the app (the speaker
mutes), and X to stop. Space pauses and plays when you're not typing.

**Send feedback** (the speech bubble at the top, or in the account menu) lets anyone
with an account report a bug or ask for something new. The Owner reads them in
**Feedback inbox** in the account menu and can mark them done or delete them.

Clips and Library sounds you never dragged anywhere are deleted when the app
closes; the ones you dragged into an editor are kept.

**Drag and drop into other apps:** grab any finished download, converted file,
picture, history item or Library sound and drop it straight into DaVinci
Resolve, Premiere, a Discord chat or a folder, just like dragging a file out of
File Explorer. Library sounds you drag are kept in
`%LOCALAPPDATA%\LelonsConverter\Library sounds` so your editor can always find them.

The **History** tab lists everything you've downloaded, newest first. Search
it, open the folder a file is in, or click **Download again** to get the same
thing again (handy if you deleted it or want it in another folder).

MP3s, M4As and FLACs get the video's thumbnail as cover art, plus the song
title and artist, so they look right in music apps.

The **Files** tab does the same for videos and songs already on your PC. Drop
them in (or click **choose files**, which is quicker for big videos because
nothing has to be copied), pick a format, and if you like a smaller size, a
part to keep (**Trim**), or even volume. Your original files aren't changed.

Making MP4s uses your graphics card (NVIDIA, AMD or Intel) when it can, which
is several times faster. If it can't, the processor does it.

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
│   ├── jobs.py          the download queue (3 videos at a time)
│   ├── updater.py       keeps the app and the downloader up to date
│   ├── waveform.py      the sound picture for the trim editor
│   ├── images.py        the Images tab's converting (uses Pillow)
│   ├── files.py         the Files tab's list of your own videos and songs
│   ├── media.py         converting with ffmpeg: formats, GIFs, smaller files, even volume
│   ├── version.py       the app's version number
│   ├── settings.py      remembers your save folder and quality choices
│   ├── folder_picker.py the Windows "Select Folder" and "Open" windows
│   ├── names.py         saves files as "name (2)" instead of replacing them
│   ├── windows.py       small Windows bits (one copy at a time, Downloads folder)
│   ├── appwindow.py     the app's own window (WebView2, the Edge engine built into Windows)
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

The window is the app's own window with a WebView2 page inside (WebView2 is
part of Windows, the same thing Edge uses), so Task Manager shows "Lelons
Converter". It opens where you left it last time. If WebView2 is missing, an
Edge app window is used instead. `main.py` runs a small server on your own computer that only the window can
talk to. When you click Convert, it uses yt-dlp to download the video and
ffmpeg to turn it into MP3 or MP4.

When installed, the app lives in `%LOCALAPPDATA%\Programs\Lelons Converter`
with its own copy of Python in `runtime\` and the app's code in `app\`. Your settings are in
`%LOCALAPPDATA%\LelonsConverter` (the download history is `history.json` there).

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

`build/build.sh` runs on Linux (it needs `nsis` and `wine`). It downloads
Python for Windows, adds yt-dlp, ffmpeg, deno and Microsoft's WebView2Loader.dll,
and packs everything into `dist/Lelons Converter Setup.exe`.

The app's shortcut starts `runtime\Lelons Converter.exe` with `app\main.py`.
That's Python's own `pythonw.exe`, renamed and given the app's icon and details
with rcedit (`build/unsign.py` takes off Python's signature first, since the
change would break it). So Windows shows the app as Lelons Converter, without a
homemade launcher program, which virus scanners are most suspicious of.
