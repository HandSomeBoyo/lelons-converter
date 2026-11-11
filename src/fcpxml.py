"""Timeline files DaVinci Resolve can bring in (File > Import > Timeline), even the free version.

Resolve turns the titles in it into Text+ titles, so nothing has to be set up in
Resolve first. With a video, the timeline has the video with the subtitles on the
track above it. Without one, it has only the subtitles, at the times they're spoken.
"""

import os
import pathlib
from fractions import Fraction
from xml.sax.saxutils import escape, quoteattr

import media

# Frame rates that are really a little under the number (29.97 and so on).
SLOWED = {23.976: 24, 29.97: 30, 47.952: 48, 59.94: 60, 119.88: 120}


def _frame(fps):
    """How long one frame is, in seconds, as an exact fraction."""
    for slow, whole in SLOWED.items():
        if abs(fps - slow) < 0.01:
            return Fraction(1001, whole * 1000)
    return Fraction(1, max(1, round(fps)))


def _time(frames, frame):
    value = frames * frame
    return f"{value.numerator}/{value.denominator}s" if value.denominator != 1 else f"{value.numerator}s"


def _uri(path):
    if len(path) > 2 and path[1] == ":":
        return pathlib.PureWindowsPath(path).as_uri()
    return pathlib.PurePosixPath(os.path.abspath(path)).as_uri()


def make(cues, target, name, clip=None, fps=0, offset=0.0):
    """Writes the file. cues [(start, end, text)] in seconds (from the start of the clip, or of the
    timeline when there's no clip). offset: where the subtitles start inside the clip. Returns
    how many subtitles went in."""
    info = media.probe(clip) if clip else {"duration": 0, "video": False, "width": 0, "height": 0, "fps": 0}
    if clip:
        _, fps = media.resolve_rate(info.get("fps") or fps)
    fps = float(fps or 30)
    frame = _frame(fps)
    per_second = 1 / frame
    width, height = (info["width"], info["height"]) if info.get("video") else (1920, 1080)
    width, height = width or 1920, height or 1080

    def frames(seconds):
        return max(0, round(Fraction(seconds).limit_denominator(100000) * per_second))

    # Each subtitle from its first to its last frame, never on top of the next one.
    lines = []
    for start, end, text in cues:
        a, b = frames(start + offset), frames(end + offset)
        if lines and a < lines[-1][1]:
            lines[-1][1] = a
        if b - a >= 2 and text.strip():
            lines.append([a, b, text.strip()])
    lines = [line for line in lines if line[1] - line[0] >= 2]

    length = frames(info["duration"]) if clip else 0
    length = max(length, lines[-1][1] if lines else 0, round(per_second))
    size = round(64 * height / 1080)

    def title(n, at, until, text, lane=""):
        return (f'<title ref="r3" name={quoteattr("Subtitle " + str(n))}{lane} offset="{_time(at, frame)}" '
                f'duration="{_time(until - at, frame)}" start="0s">'
                f'<adjust-transform position="0 -38"/>'
                f'<text><text-style ref="ts{n}">{escape(text)}</text-style></text>'
                f'<text-style-def id="ts{n}"><text-style font="Arial" fontSize="{size}" fontFace="Bold" '
                f'fontColor="1 1 1 1" strokeColor="0 0 0 1" strokeWidth="-4" alignment="center"/></text-style-def>'
                f'</title>')

    if clip:
        sound = ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' if info.get("audio") else ""
        asset = (f'<asset id="r2" name={quoteattr(os.path.basename(clip))} src={quoteattr(_uri(clip))} start="0s" '
                 f'duration="{_time(length, frame)}" hasVideo="{int(bool(info.get("video")))}" format="r1"{sound}/>')
        inside = "".join(title(n, a, b, t, ' lane="1"') for n, (a, b, t) in enumerate(lines, 1))
        spine = (f'<asset-clip ref="r2" name={quoteattr(os.path.basename(clip))} offset="0s" start="0s" '
                 f'duration="{_time(length, frame)}" format="r1" tcFormat="NDF">{inside}</asset-clip>')
    else:
        asset = ""
        parts, at = [], 0
        for n, (a, b, t) in enumerate(lines, 1):
            if a > at:
                parts.append(f'<gap name="Gap" offset="{_time(at, frame)}" duration="{_time(a - at, frame)}" start="0s"/>')
            parts.append(title(n, a, b, t))
            at = b
        spine = "".join(parts)
        length = max(at, 1)

    text = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.8">\n'
        f'<resources><format id="r1" name="VaultHub" frameDuration="{_time(1, frame)}" width="{width}" height="{height}"/>'
        f'{asset}<effect id="r3" name="Basic Title" '
        'uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/></resources>\n'
        f'<library><event name="VaultHub"><project name={quoteattr(name)}>'
        f'<sequence format="r1" duration="{_time(length, frame)}" tcStart="0s" tcFormat="NDF" '
        f'audioLayout="stereo" audioRate="48k"><spine>{spine}</spine></sequence></project></event></library>\n'
        '</fcpxml>\n')
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return len(lines)


def make_cuts(source, keep, target, name):
    """A timeline with only the parts in keep [(start, end)] of the video, one after the other.
    Each part is its own clip, so any cut can still be moved in Resolve."""
    info = media.probe(source)
    _, fps = media.resolve_rate(info.get("fps"))
    frame = _frame(fps)
    per_second = 1 / frame
    width, height = (info["width"] or 1920, info["height"] or 1080) if info.get("video") else (1920, 1080)

    def frames(seconds):
        return max(0, round(Fraction(seconds).limit_denominator(100000) * per_second))

    length = frames(info["duration"])
    sound = ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' if info.get("audio") else ""
    title = os.path.basename(source)
    clips, at = [], 0
    for start, end in keep:
        a, b = frames(start), min(frames(end), length or frames(end))
        if b - a < 2:
            continue
        clips.append(f'<asset-clip ref="r2" name={quoteattr(title)} offset="{_time(at, frame)}" start="{_time(a, frame)}" '
                     f'duration="{_time(b - a, frame)}" format="r1" tcFormat="NDF"/>')
        at += b - a
    if not clips:
        raise ValueError("This is all quiet, so there's nothing left to keep.")
    text = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.8">\n'
        f'<resources><format id="r1" name="VaultHub" frameDuration="{_time(1, frame)}" width="{width}" height="{height}"/>'
        f'<asset id="r2" name={quoteattr(title)} src={quoteattr(_uri(source))} start="0s" duration="{_time(length, frame)}" '
        f'hasVideo="{int(bool(info.get("video")))}" format="r1"{sound}/></resources>\n'
        f'<library><event name="VaultHub"><project name={quoteattr(name)}>'
        f'<sequence format="r1" duration="{_time(at, frame)}" tcStart="0s" tcFormat="NDF" '
        f'audioLayout="stereo" audioRate="48k"><spine>{"".join(clips)}</spine></sequence></project></event></library>\n'
        '</fcpxml>\n')
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return len(clips)
