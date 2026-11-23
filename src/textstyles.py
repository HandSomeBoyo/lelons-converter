"""Your own subtitle looks, made in DaVinci Resolve (3.0).

Make a Text+ the way you like it in Resolve (font, size, colors, a start animation), put it on a
timeline, and export that timeline with File > Export > Timeline (.drt). VaultHub reads every Text+ in
it and keeps each one as a "text style". When it makes the subtitles, every line is a copy of that
Text+ with only the words changed, so the look and the animation come along.

A Text+ in a .drt is a Fusion composition: its tools are Lua-like text, for example
    TemplateSize = BezierSpline { KeyFrames = { [0] = { 0.0553, RH = { 3, 0.0553 } }, [9] = { ... } } },
    Template = TextPlus { Inputs = { StyledText = Input { Value = "CUSTOM TITLE", }, ... } }
Keyframes are counted in frames of the timeline it was made on, so they're stretched to the frame
rate of the timeline VaultHub writes (else a 60 fps animation would play 2.5 times slower at 24).

A fade out is added by animating each shown part of the text (letters, outline, shadow) from how see-
through it was to fully see-through over the last frames of the line.
"""

import json
import os
import re
import struct
import uuid
import zipfile
import zlib

import drt
import settings

FOLDER = os.path.join(settings.DATA_DIR, "Text styles")
_ID = re.compile(r"^[a-f0-9]{12}$")


class Error(ValueError):
    pass


# ---------------------------------------------------------------- reading a .drt

def _text_pluses(data):
    """[(clip name, composition text, tools text)] for every Text+ in a .drt file's bytes."""
    import io

    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise Error("That isn't a timeline file from Resolve (.drt).")
    found = []
    for name in z.namelist():
        if not name.startswith("SeqContainer/") or not name.endswith(".xml"):
            continue
        seq = z.read(name).decode("utf-8", "replace")
        for clip in drt._elements(seq, "Sm2TiVideoClip"):
            blob = drt._get(clip, "CompositionBA")
            if not blob:
                continue
            try:
                table = drt.read_map(drt.unzlib(bytes.fromhex(blob)))
                comp_data = drt.map_get(table, "0_data")[2]
                comp, _, rest = comp_data.partition(b"\x00")
                tools = zlib.decompress(rest[4:]).decode("utf-8")
            except Exception:
                continue
            if "TextPlus {" not in tools:
                continue
            clip_name = (drt._get(clip, "Name") or "").strip()
            found.append((clip_name, comp.decode("utf-8", "replace"), tools))
    return found


def _rate_of(comp):
    m = re.search(r"FrameFormat = \{[^}]*?Rate = ([\d.]+)", comp)
    return float(m[1]) if m else 24.0


def _font_of(tools):
    font = re.search(r'Font = Input \{ Value = "((?:[^"\\]|\\.)*)"', tools)
    face = re.search(r'Style = Input \{ Value = "((?:[^"\\]|\\.)*)"', tools)
    return (font[1] if font else "Open Sans"), (face[1] if face else "Bold")


def add(data, file_name):
    """Keeps every Text+ in the .drt as a style. Returns the new styles."""
    found = _text_pluses(data)
    if not found:
        raise Error("There's no Text+ in that timeline. Put your Text+ on it, then export it again.")
    os.makedirs(FOLDER, exist_ok=True)
    stem = os.path.splitext(os.path.basename(file_name or ""))[0].strip() or "My style"
    added = []
    have = {}
    for old in all_styles():
        full = get(old["id"])
        if full:
            have[full["tools"]] = old
    for i, (clip_name, comp, tools) in enumerate(found):
        if tools in have:  # the same Text+ added again: keep the one there is
            added.append(have[tools])
            continue
        name = clip_name if clip_name and clip_name not in ("Text+", "Fusion Title") else stem
        if len(found) > 1 and name == stem:
            name = f"{stem} {i + 1}"
        font, face = _font_of(tools)
        style = {"id": uuid.uuid4().hex[:12], "name": name[:40], "rate": _rate_of(comp), "tools": tools,
                 "font": font, "face": face, "animated": "KeyFrames" in tools}
        with open(os.path.join(FOLDER, style["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(style, f)
        added.append(_public(style))
    return added


def _public(style):
    return {k: style[k] for k in ("id", "name", "font", "face", "animated")}


def all_styles():
    out = []
    try:
        names = sorted(os.listdir(FOLDER), key=lambda n: os.path.getmtime(os.path.join(FOLDER, n)))
    except OSError:
        return out
    for n in names:
        if n.endswith(".json"):
            style = get(n[:-5])
            if style:
                out.append(_public(style))
    return out


def get(style_id):
    if not style_id or not _ID.match(str(style_id)):
        return None
    try:
        with open(os.path.join(FOLDER, style_id + ".json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def remove(style_id):
    if style_id and _ID.match(str(style_id)):
        try:
            os.remove(os.path.join(FOLDER, style_id + ".json"))
        except OSError:
            pass


def rename(style_id, name):
    style = get(style_id)
    name = str(name or "").strip()[:40]
    if not style or not name:
        return
    style["name"] = name
    with open(os.path.join(FOLDER, style_id + ".json"), "w", encoding="utf-8") as f:
        json.dump(style, f)


# ---------------------------------------------------------------- making one line

def _block_end(text, start):
    """The index just after the { ... } block that opens at text[start] == "{"."""
    depth, i, quoted = 0, start, False
    while i < len(text):
        c = text[i]
        if quoted:
            if c == "\\":
                i += 1
            elif c == '"':
                quoted = False
        elif c == '"':
            quoted = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def _num(x):
    return f"{x:.4f}".rstrip("0").rstrip(".") if x != int(x) else str(int(x))


def _stretch_keyframes(tools, scale):
    """Keyframe times (and their handles' times) times scale, inside every KeyFrames = { } block."""
    if abs(scale - 1) < 1e-6:
        return tools
    out, i = [], 0
    for m in re.finditer(r"KeyFrames = \{", tools):
        if m.start() < i:
            continue
        open_at = m.end() - 1
        end = _block_end(tools, open_at)
        block = tools[open_at:end]
        used = set()

        def key(k):
            # Whole frames (a 60 fps key at 9 lands on 3.6 at 24 fps: 4), never two keys on one frame.
            t = round(float(k[1]) * scale)
            while t in used:
                t += 1
            used.add(t)
            return f"[{t}] = {{"

        block = re.sub(r"\[(-?\d+(?:\.\d+)?)\] = \{", key, block)
        block = re.sub(r"\b(LH|RH) = \{ (-?[\d.]+(?:e-?\d+)?),",
                       lambda k: f"{k[1]} = {{ {_num(round(float(k[2]) * scale, 4))},", block)
        out.append(tools[i:open_at] + block)
        i = end
    out.append(tools[i:])
    return "".join(out)


def _set_input(inputs, key, value):
    """Sets Key = Input { Value = ..., } in a tool's Inputs text (adds it when it isn't there)."""
    pattern = re.compile(r"\b" + key + r' = Input \{ Value = (?:"(?:[^"\\]|\\.)*"|\{[^}]*\}|[^,}]+), \}')
    if pattern.search(inputs):
        return pattern.sub(lambda m: f"{key} = Input {{ Value = {value}, }}", inputs, count=1)
    return "{ " + f"{key} = Input {{ Value = {value}, }}, " + inputs[1:].lstrip()


POSITIONS = {"bottom": 0.14, "middle": 0.5, "top": 0.86}


def _tool_block(tools, kind):
    """(name, start, end) of the first tool of this kind, like TextPlus or MediaOut."""
    m = re.search(r"(\w+) = " + kind + r" \{", tools)
    if not m:
        return None
    return m[1], m.end() - 1, _block_end(tools, m.end() - 1)


def line_tools(style, text, frames, fps, width, height, fade_frames=0, position="", look=None):
    """The tools text of one subtitle made from a saved style. position: bottom/middle/top moves it
    there ("" keeps where it is in the style)."""
    tools = _stretch_keyframes(style["tools"], fps / (style.get("rate") or fps))
    found = _tool_block(tools, "TextPlus")
    if not found:
        raise Error("This text style is broken. Add it again from Resolve.")
    _name, body_at, body_end = found
    body = tools[body_at:body_end]
    inputs_m = re.search(r"Inputs = \{", body)
    inputs_at = inputs_m.end() - 1
    inputs_end = _block_end(body, inputs_at)
    inputs = body[inputs_at:inputs_end]
    last = max(0, frames - 1)
    inputs = _set_input(inputs, "StyledText", drt._lua(text))
    inputs = _set_input(inputs, "GlobalOut", str(last))
    inputs = _set_input(inputs, "Width", str(width))
    inputs = _set_input(inputs, "Height", str(height))
    if position in POSITIONS and not re.search(r"\bCenter = Input \{ SourceOp", inputs):
        inputs = _set_input(inputs, "VerticalJustificationNew", "3")
        inputs = _set_input(inputs, "Center", f"{{ 0.5, {POSITIONS[position]} }}")
    look = look or {}
    if look.get("color"):  # (3.0) another person talking, or a loud word
        for key, value in zip(("Red1", "Green1", "Blue1"), look["color"]):
            inputs = _set_input(inputs, key, _num(round(float(value), 4)))
    scale = float(look.get("scale") or 1)
    size_from = None
    if scale != 1:
        size = re.search(r"\bSize = Input \{ Value = (-?[\d.e-]+),", inputs)
        source = re.search(r'\bSize = Input \{ SourceOp = "(\w+)"', inputs)
        if source:
            size_from = source[1]
        else:
            inputs = _set_input(inputs, "Size", _num(round((float(size[1]) if size else 0.08) * scale, 5)))
    body = body[:inputs_at] + inputs + body[inputs_end:]
    tools = tools[:body_at] + body + tools[body_end:]
    if size_from:
        tools = _scale_spline(tools, size_from, scale)

    if fade_frames > 0 and frames > 2:
        tools = _add_fade(tools, last, min(fade_frames, max(1, frames // 2)), width, height)
    return tools


def _scale_spline(tools, name, factor):
    """Every value of an animation curve times factor (a loud word: its whole pop, bigger)."""
    at = re.search(r"\b" + name + r" = BezierSpline \{", tools)
    if not at:
        return tools
    end = _block_end(tools, at.end() - 1)
    block = tools[at.start():end]
    keys = re.search(r"KeyFrames = \{", block)
    if not keys:
        return tools
    k_end = _block_end(block, keys.end() - 1)
    frames = block[keys.end():k_end]
    frames = re.sub(r"(\[-?[\d.]+\] = \{ )(-?[\d.e-]+)", lambda m: m[1] + _num(round(float(m[2]) * factor, 6)), frames)
    frames = re.sub(r"((?:LH|RH) = \{ -?[\d.e-]+, )(-?[\d.e-]+)", lambda m: m[1] + _num(round(float(m[2]) * factor, 6)), frames)
    block = block[:keys.end()] + frames + block[k_end:]
    return tools[:at.start()] + block + tools[end:]


def _add_fade(tools, last, length, width, height):
    """A fade out of the whole title at once: whatever went into the output is laid over nothing (a
    see-through background) with a Merge whose Blend goes from 1 to 0, eased at both ends. (Fading the
    letters, outline and shadow one by one let the shadow show through the letters half way.)"""
    out = _tool_block(tools, "MediaOut")
    if not out:
        return tools
    name, at, end = out
    block = tools[at:end]
    feed = re.search(r'\bInput = Input \{ SourceOp = "(\w+)", Source = "(\w+)"', block)
    if not feed:
        return tools
    start = max(0, last - length)
    ease = max(1.0, length / 3)
    new = (
        "VaultHubClear = Background { Inputs = { "
        f"GlobalOut = Input {{ Value = {last}, }}, Width = Input {{ Value = {width}, }}, Height = Input {{ Value = {height}, }}, "
        "UseFrameFormatSettings = Input { Value = 1, }, TopLeftRed = Input { Value = 0, }, TopLeftGreen = Input { Value = 0, }, "
        "TopLeftBlue = Input { Value = 0, }, TopLeftAlpha = Input { Value = 0, }, }, ViewInfo = OperatorInfo { Pos = { 330, 115.5 } }, }, "
        "VaultHubFadeBlend = BezierSpline { SplineColor = { Red = 180, Green = 180, Blue = 180 }, CtrlWZoom = false, KeyFrames = { "
        f"[{start}] = {{ 1, RH = {{ {_num(round(start + ease, 3))}, 1 }} }}, "
        f"[{last}] = {{ 0, LH = {{ {_num(round(last - ease, 3))}, 0 }} }} }} }}, "
        "VaultHubFade = Merge { Inputs = { "
        'Blend = Input { SourceOp = "VaultHubFadeBlend", Source = "Value", }, '
        'Background = Input { SourceOp = "VaultHubClear", Source = "Output", }, '
        f'Foreground = Input {{ SourceOp = "{feed[1]}", Source = "{feed[2]}", }}, '
        "PerformDepthMerge = Input { Value = 0, }, }, ViewInfo = OperatorInfo { Pos = { 330, 49.5 } }, }, "
    )
    block = block.replace(feed[0], 'Input = Input { SourceOp = "VaultHubFade", Source = "Output"', 1)
    begin = at - len(f"{name} = MediaOut ")
    return tools[:begin] + new + tools[begin:at] + block + tools[end:]


# ---------------------------------------------------------------- the preview in VaultHub

def _splines(tools):
    """{spline name: [[frame, value, lh, rh]]} for every BezierSpline (handles as [frame, value] or None)."""
    out = {}
    for m in re.finditer(r"(\w+) = BezierSpline \{", tools):
        block = tools[m.end() - 1:_block_end(tools, m.end() - 1)]
        k = re.search(r"KeyFrames = \{", block)
        if not k:
            continue
        frames = block[k.end() - 1:_block_end(block, k.end() - 1)]
        keys = []
        for key in re.finditer(r"\[(-?[\d.]+)\] = \{ (-?[\d.e-]+)", frames):
            one = frames[key.start():_block_end(frames, key.end() - len(key[2]) - 2)]
            lh = re.search(r"LH = \{ (-?[\d.e-]+), (-?[\d.e-]+) \}", one)
            rh = re.search(r"RH = \{ (-?[\d.e-]+), (-?[\d.e-]+) \}", one)
            keys.append([float(key[1]), float(key[2]), [float(lh[1]), float(lh[2])] if lh else None,
                         [float(rh[1]), float(rh[2])] if rh else None])
        out[m[1]] = keys
    return out


def preview(style_id):
    """What the page needs to show a style over the video: font, size, colors, where it sits, and the
    animated inputs (as keyframes in seconds)."""
    style = get(style_id)
    if not style:
        return None
    tools = style["tools"]
    found = _tool_block(tools, "TextPlus")
    body = tools[found[1]:found[2]] if found else ""
    rate = style.get("rate") or 24

    def value(key, default):
        m = re.search(r"\b" + key + r" = Input \{ Value = (-?[\d.e-]+),", body)
        return float(m[1]) if m else default

    center = re.search(r"\bCenter = Input \{ Value = \{ (-?[\d.e-]+), (-?[\d.e-]+) \}", body)
    splines = _splines(tools)
    animated = {}
    for m in re.finditer(r'\b(\w+) = Input \{ SourceOp = "(\w+)", Source = "Value"', body):
        if m[2] in splines:
            animated[m[1]] = [[k[0] / rate, k[1], [k[2][0] / rate, k[2][1]] if k[2] else None,
                               [k[3][0] / rate, k[3][1]] if k[3] else None] for k in splines[m[2]]]
    enabled = lambda n: n == 1 or re.search(rf"\bEnabled{n} = Input \{{ Value = 1,", body) is not None
    return {
        "font": style.get("font"), "face": style.get("face"),
        "size": value("Size", 0.08), "center": [float(center[1]), float(center[2])] if center else [0.5, 0.5],
        "color": [value("Red1", 1), value("Green1", 1), value("Blue1", 1)],
        "outline": value("Thickness2", 0.03) if enabled(2) else 0,
        "outlineColor": [value("Red2", 0), value("Green2", 0), value("Blue2", 0)],
        "shadow": enabled(3), "tracking": value("CharacterSpacing", 1),
        "animated": animated,
    }
