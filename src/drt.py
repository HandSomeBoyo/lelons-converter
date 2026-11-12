"""DaVinci Resolve timeline files (.drt): Resolve's own format (File > Import > Timeline).

Used for subtitles, because it's the only way (in the free Resolve 21) to bring in real
Text+ titles instead of a subtitle track: Resolve turns FCPXML titles into subtitles.

A .drt is a zip of three XML files from Resolve's project database. Most values in them are
"blobs": hex of Qt data streams (maps of named values), Google protobuf messages, and zlib or
zstd packed data. The files in resolve_template/ come from a real timeline exported from
Resolve 21.1 (a video on V1 with its sound on A1, and one Text+ above it); make() fills in your
video, adds a Text+ for each subtitle, and gives everything new ids.
"""

import os
import re
import struct
import time
import uuid
import zipfile
import zlib

import media

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resolve_template")


# ---------------------------------------------------------------- packing

def _zstd():
    try:
        from compression import zstd  # Python 3.14
        return zstd.compress, zstd.decompress
    except ImportError:
        import zstandard  # (testing on older Pythons)
        return zstandard.ZstdCompressor().compress, lambda b: zstandard.ZstdDecompressor().decompress(b, max_output_size=1 << 28)


def unpack(blob):
    """A blob with Resolve's little header (version 2, length, 0x80 plain or 0x81 zstd) -> its bytes."""
    flag = blob[8]
    return _zstd()[1](blob[9:]) if flag == 0x81 else blob[9:]


def pack(data, version=2, plain=False):
    """Resolve keeps small things plain (0x80) and packs bigger ones with zstd (0x81)."""
    if plain:
        return struct.pack(">II", version, len(data) + 1) + b"\x80" + data
    packed = _zstd()[0](data)
    return struct.pack(">II", version, len(packed) + 1) + b"\x81" + packed


def is_packed(b):
    return (len(b) > 9 and b[:4] in (b"\x00\x00\x00\x01", b"\x00\x00\x00\x02") and b[8] in (0x80, 0x81)
            and struct.unpack(">I", b[4:8])[0] == len(b) - 8)


def unpack_bare(blob):
    return _zstd()[1](blob[1:]) if blob[:1] == b"\x81" else blob[1:]


def pack_bare(data):
    return b"\x81" + _zstd()[0](data)


def unzlib(blob):
    return zlib.decompress(blob[4:])


def rezlib(data):
    return struct.pack(">I", len(data)) + zlib.compress(data)


# ---------------------------------------------------------------- Qt data streams

BOOL, INT, UINT, LONG, ULONG, DOUBLE, STRING, STRINGS, BYTES = 1, 2, 3, 4, 5, 6, 10, 11, 12


def _qstr(text):
    if text is None:
        return b"\xff\xff\xff\xff"
    raw = text.encode("utf-16-be")
    return struct.pack(">I", len(raw)) + raw


def _read_qstr(b, i):
    n = struct.unpack(">I", b[i:i + 4])[0]
    i += 4
    if n == 0xFFFFFFFF:
        return None, i
    return b[i:i + n].decode("utf-16-be"), i + n


_FIXED = {BOOL: ">?", INT: ">i", UINT: ">I", LONG: ">q", ULONG: ">Q", DOUBLE: ">d"}


def read_map(b):
    """A Qt map -> [[key, type, value]] (in the order it was written)."""
    _version, count = struct.unpack(">II", b[:8])
    i, out = 8, []
    for _ in range(count):
        key, i = _read_qstr(b, i)
        kind = struct.unpack(">I", b[i:i + 4])[0]
        i += 5  # (and the "is null" byte)
        if kind in _FIXED:
            size = struct.calcsize(_FIXED[kind])
            value = struct.unpack(_FIXED[kind], b[i:i + size])[0]
            i += size
        elif kind == STRING:
            value, i = _read_qstr(b, i)
        elif kind == BYTES:
            n = struct.unpack(">I", b[i:i + 4])[0]
            value, i = b[i + 4:i + 4 + n], i + 4 + n
        elif kind == STRINGS:
            n = struct.unpack(">I", b[i:i + 4])[0]
            i += 4
            value = []
            for _ in range(n):
                s, i = _read_qstr(b, i)
                value.append(s)
        else:
            raise ValueError(f"unknown Qt type {kind}")
        out.append([key, kind, value])
    return out


def write_map(items):
    out = [struct.pack(">II", 1, len(items))]
    for key, kind, value in items:
        out.append(_qstr(key) + struct.pack(">IB", kind, 0))
        if kind in _FIXED:
            out.append(struct.pack(_FIXED[kind], value))
        elif kind == STRING:
            out.append(_qstr(value))
        elif kind == BYTES:
            out.append(struct.pack(">I", len(value)) + value)
        elif kind == STRINGS:
            out.append(struct.pack(">I", len(value)) + b"".join(_qstr(s) for s in value))
    return b"".join(out)


def map_get(items, key):
    return next(item for item in items if item[0] == key)


def map_set(items, key, value):
    map_get(items, key)[2] = value


# ---------------------------------------------------------------- protobuf

def _varint(n):
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _read_varint(b, i):
    result = shift = 0
    while True:
        c = b[i]
        i += 1
        result |= (c & 0x7F) << shift
        shift += 7
        if c < 0x80:
            return result, i


def read_pb(b):
    """A protobuf message -> [[field, wire, value]] (wire 0: number, 1/5: raw bytes, 2: bytes)."""
    i, out = 0, []
    while i < len(b):
        key, i = _read_varint(b, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _read_varint(b, i)
        elif wire == 1:
            value, i = b[i:i + 8], i + 8
        elif wire == 5:
            value, i = b[i:i + 4], i + 4
        elif wire == 2:
            n, i = _read_varint(b, i)
            value, i = b[i:i + n], i + n
        else:
            raise ValueError("unknown protobuf wire type")
        out.append([field, wire, value])
    return out


def write_pb(fields):
    out = []
    for field, wire, value in fields:
        out.append(_varint(field << 3 | wire))
        if wire == 0:
            out.append(_varint(value))
        elif wire == 2:
            out.append(_varint(len(value)) + value)
        else:
            out.append(value)
    return b"".join(out)


def pb_set(fields, field, value):
    for f in fields:
        if f[0] == field:
            f[2] = value
            return


def pb_get(fields, field):
    return next((f[2] for f in fields if f[0] == field), None)


def _set_clip_start(blob, start):
    """A timeline clip's own record of where it starts (field 1.1.21 of its FieldsBlob)."""
    msg = read_pb(unpack(blob))
    one = read_pb(pb_get(msg, 1))
    two = read_pb(pb_get(one, 1))
    pb_set(two, 21, start)
    pb_set(one, 1, write_pb(two))
    pb_set(msg, 1, write_pb(one))
    return pack(write_pb(msg), blob[3], plain=blob[8] == 0x80)


# ---------------------------------------------------------------- new ids for everything

_UUID = re.compile(rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_UUID16 = re.compile(rb"(?:[0-9a-f]\x00){8}-\x00(?:(?:[0-9a-f]\x00){4}-\x00){3}(?:[0-9a-f]\x00){12}")
_UUID16BE = re.compile(rb"(?:\x00[0-9a-f]){8}\x00-(?:(?:\x00[0-9a-f]){4}\x00-){3}(?:\x00[0-9a-f]){12}")


class Ids:
    """Gives every id in the template a new one (the same new one everywhere it's used), so
    the timeline can be brought into Resolve more than once."""

    def __init__(self):
        self.new = {}

    def get(self, old):
        if old not in self.new:
            self.new[old] = str(uuid.uuid4())
        return self.new[old]

    def text(self, raw):
        return _UUID.sub(lambda m: self.get(m[0].decode()).encode(), raw)

    def blob(self, raw):
        raw = _UUID.sub(lambda m: self.get(m[0].decode()).encode(), raw)
        return _UUID16BE.sub(lambda m: self.get(m[0].decode("utf-16-be")).encode("utf-16-be"), raw)

    def hex_value(self, raw):
        """One hex value in the XML: unpack it if it's packed, swap the ids, pack it again."""
        b = bytes.fromhex(raw)
        try:
            if is_packed(b):
                inner = unpack(b)
                changed = self.blob(inner)
                return raw if changed == inner else pack(changed, b[3], plain=b[8] == 0x80).hex()
            if len(b) > 6 and b[4:6] in (b"\x78\x9c", b"\x78\xda", b"\x78\x01"):
                inner = unzlib(b)
                changed = self.blob(inner)
                return raw if changed == inner else rezlib(changed).hex()
            if b[:5] == b"\x81\x28\xb5\x2f\xfd":
                inner = unpack_bare(b)
                changed = self.blob(inner)
                return raw if changed == inner else pack_bare(changed).hex()
        except Exception:
            pass
        return self.blob(b).hex()

    def xml(self, text):
        text = re.sub(r">([0-9a-f]{16,})<", lambda m: ">" + self.hex_value(m[1]) + "<", text)
        return _UUID.sub(lambda m: self.get(m[0].decode()).encode(), text.encode()).decode()


# ---------------------------------------------------------------- the XML

def _tag(xml, name, value):
    """Sets the first <name>...</name> (or <name/>) in xml."""
    new = f"<{name}>{value}</{name}>" if value != "" else f"<{name}/>"
    out, n = re.subn(rf"<{name}>[^<]*</{name}>|<{name}/>", lambda m: new, xml, count=1)
    if not n:
        raise ValueError(f"no <{name}> in the template")
    return out


def _get(xml, name):
    match = re.search(rf"<{name}>([^<]*)</{name}>", xml)
    return match[1] if match else ""


def _elements(xml, tag):
    """The <Element> blocks that hold a <tag ...> in xml."""
    return [m[0] for m in re.finditer(rf"<Element>\s*<{tag} DbId=\"[^\"]+\">.*?</{tag}>\s*</Element>", xml, re.S)]


def _escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _double_le(value):
    return struct.pack("<d", value) + b"\x00" * 8


def _timemap(*values):
    return (b"\x02" + b"".join(struct.pack(">d", v) for v in values)).hex()


# ---------------------------------------------------------------- Text+

def _lua(text):
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "") + '"'


def text_plus(text, frames, fps, width, height, style):
    """The Fusion composition of one Text+ title, as Resolve stores it."""
    last = max(0, frames - 1)
    size = style.get("size", 0.06)
    inputs = [
        f"GlobalOut = Input {{ Value = {last}, }}",
        f"Width = Input {{ Value = {width}, }}",
        f"Height = Input {{ Value = {height}, }}",
        "UseFrameFormatSettings = Input { Value = 1, }",
        f"StyledText = Input {{ Value = {_lua(text)}, }}",
        f"Font = Input {{ Value = {_lua(style.get('font', 'Open Sans'))}, }}",
        f"Style = Input {{ Value = {_lua(style.get('face', 'Bold'))}, }}",
        f"Size = Input {{ Value = {size}, }}",
        "VerticalJustificationNew = Input { Value = 3, }",
        "HorizontalJustificationNew = Input { Value = 3, }",
        f"Center = Input {{ Value = {{ 0.5, {style.get('y', 0.12)} }}, }}",
        # A black outline around the letters (shading element 2), so it reads on any picture.
        "Enabled2 = Input { Value = 1, }",
        "Red2 = Input { Value = 0, }", "Green2 = Input { Value = 0, }", "Blue2 = Input { Value = 0, }",
        f"Thickness2 = Input {{ Value = {style.get('outline', 0.08)}, }}",
    ]
    tools = ("{ Template = TextPlus { CtrlWZoom = false, Inputs = { " + ", ".join(inputs) + " }, "
             "ViewInfo = OperatorInfo { Pos = { 220, 49.5 } }, Version = 1 }, "
             'MediaOut1 = MediaOut { Inputs = { Index = Input { Value = "0", }, Input = Input { SourceOp = "Template", '
             'Source = "Output", } }, ViewInfo = OperatorInfo { Pos = { 440, 49.5 } }, } } ').encode()
    rate = round(fps, 3) if abs(fps - round(fps)) > 0.001 else int(round(fps))
    comp = (f"Composition {{ CurrentTime = 0, RenderRange = {{ 0, {last} }}, GlobalRange = {{ 0, {last} }}, CurrentID = 3, "
            "HiQ = true, PlaybackUpdateMode = 0, StereoMode = false, Version = \"DaVinci Resolve 21.1.2.0010\", "
            "SavedOutputs = 0, HeldTools = 0, DisabledTools = 0, LockedTools = 0, AudioOffset = 0, Resumable = true, "
            "OutputClips = { }, CustomData = { TEMPLATE_ID = \"Text+\" }, Frames = { }, Prefs = { Comp = { Interactive = { "
            "Proxy = { Scale = 1, }, }, Views = { View1 = { }, }, "
            f"FrameFormat = {{ Rate = {rate}, GuideRatio = {width / height:.14g}, DepthFull = 3, DepthPreview = 3, "
            f"DepthInteractive = 3, }}, Unsorted = {{ GlobalEnd = {last} }}, SpellCheck = {{ }}, }} }}, Compressed = true, }}").encode()
    data = comp + b"\x00" + struct.pack("<I", len(tools)) + zlib.compress(tools, 9)
    table = write_map([["count", INT, 1], ["0_name", STRING, "Composition 1"], ["0_mediaIdList", STRINGS, []], ["0_data", BYTES, data]])
    return rezlib(table).hex()


# ---------------------------------------------------------------- making the file

def _read(name):
    with open(os.path.join(TEMPLATE, name), encoding="utf-8", newline="") as f:
        return f.read()


def _read_bytes(name):
    with open(os.path.join(TEMPLATE, name), "rb") as f:
        return f.read()


TIMELINE_FPS = 24  # the template timeline's frame rate


def _rate(fps):
    """The timeline's frame rate: whole numbers (Resolve keeps the real timing of other rates)."""
    return max(1, int(round(fps or 30)))


def make(cues, target, name, clip=None, offset=0.0, style=None, timeline_fps=None):
    """Writes the .drt. cues [(start, end, text)] in seconds from the start of the video (or of the
    timeline with no video); offset: where they start inside the video. Returns how many went in."""
    style = style or {}
    info = media.probe(clip) if clip else {"duration": 0, "video": False, "audio": False, "width": 0, "height": 0,
                                           "fps": 0, "audioTracks": 0}
    has_video = bool(clip and info["video"])
    fps = timeline_fps or TIMELINE_FPS
    width, height = 1920, 1080  # the timeline's size (see _timeline_blobs)
    origin = 3600 * fps  # timelines start at 01:00:00:00

    def frame(seconds):
        return max(0, int(round(seconds * fps)))

    lines = []
    for start, end, text in cues:
        a, b = frame(start + offset), frame(end + offset)
        if lines and a < lines[-1][1]:
            lines[-1][1] = a
        if b - a >= 2 and text.strip():
            lines.append([a, b, text.strip()])
    lines = [line for line in lines if line[1] - line[0] >= 2]

    media_frames = int(round(info["duration"] * (info.get("fps") or fps))) if has_video else 0
    length = max(frame(info["duration"]) if has_video else 0, lines[-1][1] if lines else 0, fps)
    pool, seq, project = _read("MpFolder.xml"), _read("SeqContainer.xml"), _read("project.xml")

    # ---- the Text+ titles, on the track above the video
    track_v1, track_v2 = re.findall(r"<Element>\s*<Sm2TiTrack .*?</Sm2TiTrack>\s*</Element>", seq.split("<VideoTrackVec>")[1].split("</VideoTrackVec>")[0], re.S)
    title_el = _elements(track_v2, "Sm2TiVideoClip")[0]
    titles = []
    for a, b, text in lines:
        el = title_el
        for old in set(re.findall(r'DbId="([^"]+)"', el)):
            el = el.replace(old, str(uuid.uuid4()))
        el = _tag(el, "Start", origin + a)
        el = _tag(el, "Duration", b - a)
        el = _tag(el, "Name", "Fusion Title")
        el = _tag(el, "CompositionBA", text_plus(text, b - a, fps, width, height, style))
        el = _tag(el, "MediaFrameRate", _double_le(fps).hex())
        el = _tag(el, "MediaTimemapBA", _timemap(max(0, b - a - 1) / fps))
        fields = bytes.fromhex(_get(el, "FieldsBlob"))
        el = el.replace(fields.hex(), _set_clip_start(fields, origin + a).hex(), 1)
        titles.append(el)
    items = re.search(r"<Items>.*</Items>", track_v2, re.S)[0]
    seq = seq.replace(track_v2, track_v2.replace(items, "<Items>\n" + "\n".join(titles) + "\n    </Items>"))

    # ---- the video and its sound
    video_el = _elements(track_v1, "Sm2TiVideoClip")[0]
    audio_track = re.findall(r"<Element>\s*<Sm2TiTrack .*?</Sm2TiTrack>\s*</Element>", seq.split("<AudioTrackVec>")[1].split("</AudioTrackVec>")[0], re.S)[0]
    audio_el = _elements(audio_track, "Sm2TiAudioClip")[0]
    if has_video:
        real_fps = info.get("fps") or fps
        last_second = max(0, media_frames - 1) / real_fps
        timemap = _timemap(last_second, 0, int(last_second * fps) / fps, 0, last_second)
        stem = os.path.basename(clip)
        new = video_el
        for el_name in ("video", "audio"):
            el = video_el if el_name == "video" else audio_el
            el = _tag(el, "Name", _escape(stem))
            el = _tag(el, "Start", origin)
            el = _tag(el, "Duration", frame(info["duration"]))
            el = _tag(el, "MediaFilePath", _escape(os.path.abspath(clip)))
            el = _tag(el, "MediaFrameRate", _double_le(real_fps).hex())
            el = _tag(el, "MediaTimemapBA", timemap)
            fields = bytes.fromhex(_get(el, "FieldsBlob"))
            el = el.replace(fields.hex(), _set_clip_start(fields, origin).hex(), 1)
            if el_name == "video":
                new = el
            else:
                new_audio = el
        seq = seq.replace(video_el, new)
        seq = seq.replace(audio_el, new_audio if info["audio"] else "")
        pool = _media_pool_clip(pool, clip, info, real_fps, media_frames)
    else:
        seq = seq.replace(video_el, "").replace(audio_el, "")
        pool = re.sub(r"<Element>\s*<Sm2MpVideoClip .*?</Sm2MpVideoClip>\s*</Element>", "", pool, flags=re.S)

    # ---- the timeline itself
    seconds = length / fps
    pool = _tag(pool, "MediaExtents", (struct.pack("<dd", 3600.0, seconds)).hex())
    pool = _tag(pool, "FrameRate", _double_le(fps).hex())
    pool = re.sub(r"<Name>Timeline 1</Name>", lambda m: f"<Name>{_escape(name)}</Name>", pool)
    pool = _timeline_blobs(pool, width, height, fps, seconds, clip if has_video else None)
    project = _tag(project, "ProjectName", _escape(name))

    ids = Ids()
    seq_id = re.search(r'<Sm2SequenceContainer DbId="([^"]+)"', seq)[1]
    files = {"project.xml": ids.xml(project), "MediaPool/Master/MpFolder.xml": ids.xml(pool),
             f"SeqContainer/{ids.get(seq_id)}.xml": ids.xml(seq)}
    temp = target + ".part"
    with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as z:
        for path, text in files.items():
            z.writestr(path, text.encode("utf-8"))  # (line endings as Resolve wrote them)
    os.replace(temp, target)
    return len(lines)


def _media_pool_clip(pool, clip, info, fps, frames):
    """The video in the Media Pool: where it is, how long, how big, and its sound tracks."""
    el = _elements(pool, "Sm2MpVideoClip")[0]
    new = _tag(el, "Name", _escape(os.path.basename(clip)))
    folder, file_name = os.path.split(os.path.abspath(clip))
    try:
        changed = os.path.getmtime(clip)
    except OSError:
        changed = time.time()
    local = time.localtime(changed)
    when = time.strftime("%a %b ", local) + f"{local.tm_mday:2d}" + time.strftime(" %H:%M:%S %Y", local)  # like C's ctime()
    codec = {"h264": "avc1", "hevc": "hvc1", "prores": "apch", "av1": "av01", "vp9": "vp09"}.get(info.get("videoCodec"), info.get("videoCodec") or "avc1")

    # The video part
    video = re.search(r"<BtVideoInfo .*?</BtVideoInfo>", new, re.S)[0]
    v = video
    clip_hex = _get(v, "Clip")
    fields = read_pb(unpack(bytes.fromhex(clip_hex)))
    for field, value in ((1, folder), (2, file_name), (3, when), (5, codec), (6, file_name)):
        pb_set(fields, field, value.encode("utf-8"))
    pb_set(fields, 13, int(changed * 1_000_000))
    v = v.replace(clip_hex, pack(write_pb(fields)).hex(), 1)
    time_hex = _get(v, "Time")
    items = read_map(bytes.fromhex(time_hex))
    map_set(items, "NumFrames", int(frames))
    map_set(items, "FrameRate", _double_le(fps))
    v = v.replace(time_hex, write_map(items).hex(), 1)
    geo_hex = _get(v, "Geometry")
    items = read_map(bytes.fromhex(geo_hex))
    map_set(items, "Resolution", struct.pack(">qq", info["width"], info["height"]))
    map_set(items, "FrameSize", int(info["width"] * info["height"] * 1.5))
    v = v.replace(geo_hex, write_map(items).hex(), 1)
    new = new.replace(video, v)

    # The sound part: one entry for each sound track in the file
    audio = re.search(r"<Element>\s*<BtAudioInfo .*?</BtAudioInfo>\s*</Element>", new, re.S)[0]
    tracks = info.get("audioTracks") or 0
    if not tracks:
        new = new.replace(audio, "")
    else:
        a = audio
        clip_hex = _get(a, "Clip")
        fields = read_pb(unpack(bytes.fromhex(clip_hex)))
        for field, value in ((1, folder), (2, file_name), (3, when), (5, (info.get("audioCodec") or "aac").upper())):
            pb_set(fields, field, value.encode("utf-8"))
        pb_set(fields, 13, int(changed * 1_000_000))
        a = a.replace(clip_hex, pack(write_pb(fields)).hex(), 1)
        tracks_hex = _get(a, "TracksBA")
        old = read_map(bytes.fromhex(tracks_hex))
        sample = read_map(old[-1][2])  # track 0
        made = []
        for n in reversed(range(tracks)):  # (Qt writes maps last key first)
            t = [list(x) for x in sample]
            map_set(t, "UniqueId", str(uuid.uuid4()))
            map_set(t, "IdxTrack", n)
            rate = info.get("audioRate") or 48000
            map_set(t, "SampleRate", rate)
            map_set(t, "NumChannels", info.get("audioChannels") or 2)
            map_set(t, "CodecName", (info.get("audioCodec") or "aac").upper())
            map_set(t, "Duration", int(round(info["duration"] * rate)))
            made.append([str(n), BYTES, write_map(t)])
        a = a.replace(tracks_hex, write_map(made).hex(), 1)
        new = new.replace(audio, a)

    # The clip's own list of sound channels, pointing at the sound part
    fields_hex = re.search(r"<Sm2MpVideoClip [^>]*>\s*<FieldsBlob>(\w+)</FieldsBlob>", new)[1]
    msg = read_pb(unpack(bytes.fromhex(fields_hex)))
    one = read_pb(pb_get(msg, 1))
    two = read_pb(pb_get(one, 1))
    channels = read_map(pb_get(two, 5))
    sample = read_map(channels[-1][2])
    made = []
    for n in reversed(range(tracks)):
        t = [list(x) for x in sample]
        if any(x[0] == "CodecName" for x in t):
            map_set(t, "CodecName", (info.get("audioCodec") or "aac").upper())
        vec = read_map(map_get(t, "ChannelVecBA")[2])
        if info.get("audioChannels") == 1:
            vec = [c for c in vec if c[0] == "0"]
        for channel in vec:
            ch = read_map(channel[2])
            if n:
                if not any(x[0] == "TrackIdx" for x in ch):
                    ch.insert(0, ["TrackIdx", INT, n])
                else:
                    map_set(ch, "TrackIdx", n)
            channel[2] = write_map(ch)
        map_set(t, "ChannelVecBA", write_map(vec))
        made.append([str(n), BYTES, write_map(t)])
    pb_set(two, 5, write_map(made))
    pb_set(one, 1, write_pb(two))
    pb_set(msg, 1, write_pb(one))
    new = new.replace(fields_hex, pack(write_pb(msg)).hex(), 1)
    return pool.replace(el, new)


def _timeline_blobs(pool, width, height, fps, seconds, clip):
    """The timeline's settings (size and frame rate), its picture in the Media Pool and its length."""
    # Resolve crashes when the timeline's own size/frame rate settings are changed here, so
    # the timeline keeps the template's 1920x1080 at 24 fps (the video is fitted into it).
    seq_match = re.search(r"(<Sm2Sequence DbId=\"[^\"]+\">\s*<FieldsBlob>)(\w+)(</FieldsBlob>)", pool)
    items = read_map(bytes.fromhex(seq_match[2]))
    thumb = read_map(map_get(items, "Thumbnail")[2])
    picture = _thumbnail(clip) or _read_bytes("thumb.jpg")  # never empty: an empty one crashes it too
    map_set(thumb, "Buffer", picture)
    map_set(thumb, "ImgWidth", 208)
    map_set(thumb, "ImgHeight", 117)
    map_set(items, "Thumbnail", write_map(thumb))
    pool = pool.replace(seq_match[0], seq_match[1] + write_map(items).hex() + seq_match[3])

    # How long the timeline is, in its Media Pool entry
    clip_match = re.search(r"(<Sm2MpTimelineClip DbId=\"[^\"]+\">\s*<FieldsBlob>)(\w+)(</FieldsBlob>)", pool)
    msg = read_pb(unpack(bytes.fromhex(clip_match[2])))
    one = read_pb(pb_get(msg, 1))
    two = read_pb(pb_get(one, 1))
    tracks = read_map(pb_get(two, 5))
    for track in tracks:
        t = read_map(track[2])
        map_set(t, "MediaExtents", struct.pack("<dd", 3600.0, seconds))
        track[2] = write_map(t)
    pb_set(two, 5, write_map(tracks))
    pb_set(one, 1, write_pb(two))
    pb_set(msg, 1, write_pb(one))
    return pool.replace(clip_match[0], clip_match[1] + pack(write_pb(msg)).hex() + clip_match[3])


def _thumbnail(clip):
    """A small JPEG of the video for the timeline in the Media Pool (or none)."""
    if not clip:
        return b""
    import subprocess
    try:
        result = subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-ss", "1", "-i", clip, "-frames:v", "1",
                                 "-vf", "scale=208:117,setsar=1",
                                 "-f", "image2pipe", "-c:v", "mjpeg", "-pix_fmt", "yuvj420p", "-q:v", "4", "-"],
                                capture_output=True, timeout=60, creationflags=media.NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return b""
    return result.stdout if result.returncode == 0 and result.stdout[:2] == b"\xff\xd8" else b""
