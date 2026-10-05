const $ = (id) => document.getElementById(id);
let format = "mp3";
let shownQuality = "";
let previewUrl = "";
let previewTimer = null;
let previewSeconds = 0;

const ICONS = {
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return res.json();
}

// ---- dragging finished files out, straight into DaVinci Resolve, Premiere, a folder...

const DRAG_HINT = "Drag this into DaVinci Resolve, Premiere or any folder";

// what: the file the app should drag ({kind, id} etc.), or null when there's nothing to drag yet.
function setDrag(el, what) {
  el._drag = what;
  el.draggable = !!what;
  el.classList.toggle("can-drag", !!what);
}

// The page only notices the drag starting; Windows does the real one, like dragging out of Explorer.
document.addEventListener("dragstart", (e) => {
  const el = e.target.closest && e.target.closest(".can-drag");
  if (!el || !el._drag) return;
  e.preventDefault();
  api("/api/drag", el._drag).then((res) => { if (res && !res.ok) alert(res.error); }).catch(() => {});
});

// ---- format toggle and quality

const AUDIO_FORMATS = ["mp3", "m4a", "wav", "flac"];
const isVideoFormat = (f) => f === "mp4" || f === "gif";
let playlist = null; // the looked-up playlist, if the link is one
const picked = new Set(); // playlist videos to convert, by url

// Things under the link box that depend on the format.
function showFormatExtras() {
  $("normalizeBox").hidden = !AUDIO_FORMATS.includes(format);
  $("gifHint").hidden = !(format === "gif" && $("preview").classList.contains("show")
    && !$("preview").classList.contains("loading") && !$("preview").classList.contains("error") && !trim && !playlist);
  $("trimToggle").textContent = format === "gif" && !trim ? "Pick part" : "Trim";
  updateConvertText();
}

function updateConvertText() {
  $("convertText").textContent = playlist ? `Convert ${picked.size} video${picked.size === 1 ? "" : "s"}` : "Convert";
  $("convert").disabled = !!playlist && picked.size === 0;
}

$("normalize").addEventListener("change", async () => render(await api("/api/normalize", { on: $("normalize").checked })));

document.querySelectorAll("#toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    format = btn.dataset.format;
    document.querySelectorAll("#toggle button").forEach((b) => b.classList.toggle("active", b === btn));
    showFormatExtras();
    if (previewSeconds && $("preview").classList.contains("show")) prefetchWave(previewUrl, previewSeconds);
    refresh();
  });
});

$("quality").addEventListener("change", async () => {
  render(await api("/api/quality", { format, quality: $("quality").value }));
});

// ---- video preview: look the link up shortly after it's pasted or typed

function looksLikeLink(text) {
  return /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(text) || /^https?:\/\//i.test(text);
}

function showPreview(kind, title, meta, thumbnail) {
  const box = $("preview");
  box.className = "preview show " + kind;
  $("previewTitle").textContent = title;
  $("previewMeta").textContent = meta || "";
  $("previewThumb").style.backgroundImage = thumbnail ? `url("${thumbnail}")` : "";
  $("wholePlaylist").hidden = true;
  showFormatExtras();
}

function hidePreview() {
  clearTimeout(previewTimer);
  clearTrim();
  $("preview").className = "preview";
  previewUrl = "";
  showPlaylist(null);
}

// A YouTube link to a video that's in a playlist: "watch?v=...&list=..."
function playlistIdIn(url) {
  const match = /[?&]list=([\w-]+)/.exec(url);
  return match && /youtube\.com|youtu\.be/i.test(url) ? match[1] : null;
}

$("wholePlaylist").addEventListener("click", () => {
  const id = playlistIdIn(previewUrl);
  if (!id) return;
  $("url").value = "https://www.youtube.com/playlist?list=" + id;
  lookUp($("url").value);
});

function showPlaylist(list) {
  playlist = list;
  picked.clear();
  $("playlist").hidden = !list;
  $("preview").classList.toggle("is-playlist", !!list);
  if (list) {
    list.entries.forEach((e) => picked.add(e.url));
    $("playlistMeta").textContent = [`${list.entries.length} videos`, list.channel].filter(Boolean).join(" · ");
    const rows = $("playlistList");
    rows.innerHTML = "";
    list.entries.forEach((entry, i) => {
      const row = document.createElement("label");
      row.className = "playlist-row";
      row.innerHTML = `<input type="checkbox" checked><span class="number"></span><span class="thumb"></span>
        <span class="info"><span class="title"></span><span class="meta"></span></span>`;
      row.querySelector(".number").textContent = i + 1;
      row.querySelector(".thumb").style.backgroundImage = entry.thumbnail ? `url("${entry.thumbnail}")` : "";
      row.querySelector(".title").textContent = entry.title;
      row.querySelector(".meta").textContent = [entry.channel, entry.duration].filter(Boolean).join(" · ");
      row.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) picked.add(entry.url); else picked.delete(entry.url);
        updatePlaylistBits();
      });
      rows.append(row);
    });
  }
  updatePlaylistBits();
  showFormatExtras();
}

function updatePlaylistBits() {
  if (playlist) {
    $("playlistAll").textContent = picked.size === playlist.entries.length ? "Select none" : "Select all";
    $("playlistTitle").textContent = `${picked.size} of ${playlist.entries.length} videos picked`;
  }
  updateConvertText();
}

$("playlistAll").addEventListener("click", () => {
  const all = picked.size !== playlist.entries.length;
  $("playlistList").querySelectorAll("input").forEach((box, i) => {
    box.checked = all;
    if (all) picked.add(playlist.entries[i].url); else picked.delete(playlist.entries[i].url);
  });
  updatePlaylistBits();
});

async function lookUp(url) {
  previewUrl = url;
  clearTrim();
  previewSeconds = 0;
  showPreview("loading", "Looking up video...", "", "");
  const res = await api("/api/info", { url }).catch(() => ({ ok: false, error: "Couldn't look up that link." }));
  if (previewUrl !== url) return; // the link changed while we were waiting
  if (res.ok && res.preview.playlist) {
    const p = res.preview;
    showPreview("", p.title, ["Playlist", `${p.entries.length} videos`, p.channel].filter(Boolean).join(" · "), p.thumbnail);
    showPlaylist(p);
  } else if (res.ok) {
    const p = res.preview;
    showPlaylist(null);
    showPreview("", p.title, [p.channel, p.duration].filter(Boolean).join(" · "), p.thumbnail);
    previewSeconds = p.seconds || 0;
    $("wholePlaylist").hidden = !playlistIdIn(url);
    prefetchWave(url, previewSeconds);
  } else {
    showPlaylist(null);
    showPreview("error", res.error, "Check the link and try again.", "");
  }
}

$("url").addEventListener("input", () => {
  clearTimeout(previewTimer);
  const url = $("url").value.trim();
  if (!url || !looksLikeLink(url)) return hidePreview();
  if (url === previewUrl) return;
  previewTimer = setTimeout(() => lookUp(url), 400);
});

// ---- trim editor: a waveform with a start line and an end line

let trim = null; // the part to keep, {start, end} in seconds, or null for all of it
const waves = new Map(); // url -> waveform from the app (or the request still loading), so it only loads once

function loadWave(key, request, video, prefetch = false) {
  if (!waves.has(key)) {
    const loading = api("/api/waveform", { ...request, video, prefetch })
      .catch(() => ({ ok: false, error: video ? "Couldn't load the video." : "Couldn't load the sound." }));
    loading.prefetch = prefetch;
    waves.set(key, loading);
    loading.then((wave) => {
      if (waves.get(key) !== loading) return;
      if (wave.ok) waves.set(key, wave);
      else waves.delete(key); // try again next time
    });
  }
  return waves.get(key);
}

// Load the trim editor's sound (or video) right after a lookup, so Trim opens
// straight away. Only for shorter videos: long ones would download a lot for nothing.
const PREFETCH_SECONDS = 20 * 60;
function prefetchWave(url, seconds) {
  if (!seconds || seconds > PREFETCH_SECONDS) return;
  const video = isVideoFormat(format);
  if (video && seconds > PREFETCH_SECONDS / 2) return;
  loadWave((video ? "video:" : "audio:") + url, { url }, video, true);
}
// pos: where the white playhead is. stopAt: where playing stops ("Play my part" stops at the end line).
const editor = { url: "", duration: 0, peaks: null, start: 0, end: 0, pos: 0, dragging: null, raf: 0, stopAt: null };
// What plays in the editor: the video for MP4s (so you can see where you are), else just the sound.
let player = $("trimAudio");

// "1:20", "1:02:03", "80" or "1:20.5" -> seconds, or null if it isn't a time
function parseTime(text) {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return null;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

// 80.46 -> "1:20.5"
function clock(seconds, tenths = true) {
  const t = Math.max(0, tenths ? Math.round(seconds * 10) / 10 : Math.floor(seconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  let sec = tenths ? s.toFixed(1) : String(Math.floor(s));
  if (s < 10) sec = "0" + sec;
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function showTrimChip() {
  $("trimChip").hidden = !trim;
  $("trimToggle").classList.toggle("hidden", !!trim);
  if (trim) $("trimEdit").textContent = `Keeping ${clock(trim.start)} to ${clock(trim.end)}`;
  showFormatExtras();
}

function clearTrim() {
  trim = null;
  showTrimChip();
}

// Opens the trim editor. source: {key, request, video, title, duration, start, end, maxLength, done(part or null)}
let trimSource = null;
async function openTrim(source) {
  trimSource = source;
  const video = source.video;
  const key = (video ? "video:" : "audio:") + source.key;
  Object.assign(editor, { url: key, duration: source.duration, peaks: null });
  stopPlaying();
  player = video ? $("trimVideo") : $("trimAudio");
  $("videoBox").hidden = !video;
  document.querySelector(".trim-dialog").classList.toggle("video-mode", video);
  editor.start = source.start ?? 0;
  editor.end = source.end ?? source.duration;
  editor.pos = editor.start;
  warn("");
  $("trimModal").hidden = false;
  if (typeof clipOpened === "function") clipOpened(source);
  $("trimSub").textContent = source.title + (source.maxLength ? ` · GIFs can be up to ${source.maxLength} seconds` : "");
  setPlayable(false);
  layOut();
  let wave = waves.get(key);
  if (!wave || wave instanceof Promise) {
    waveMessage("loading", video ? "Loading the video..." : "Loading the sound...");
    const wasPrefetch = wave && wave.prefetch;
    wave = await loadWave(key, source.request, video);
    // Loading it ahead of time didn't work: try once more now that it's needed.
    if (!wave.ok && wasPrefetch && editor.url === key) wave = await loadWave(key, source.request, video);
  }
  if (editor.url !== key || $("trimModal").hidden) return; // closed or changed meanwhile
  if (!wave.ok) {
    waveMessage("error", wave.error + " You can still type the times below.");
    return;
  }
  waveMessage("", "");
  const wasWhole = editor.end >= editor.duration - 0.05;
  editor.peaks = wave.peaks;
  editor.duration = wave.duration;
  if (wasWhole || editor.end > editor.duration) editor.end = editor.duration;
  // A GIF of a video whose length wasn't known yet: start with the first 10 seconds.
  if (source.maxLength && editor.end - editor.start > source.maxLength) editor.end = Math.min(editor.duration, editor.start + 10);
  if (player.getAttribute("src") !== wave.media) player.src = wave.media;
  setPlayable(true);
  seek(editor.start);
}

// Playing needs the sound (or video) to have loaded.
function setPlayable(on) {
  for (const id of ["trimPlay", "trimPreview", "setStart", "setEnd"]) $(id).disabled = !on;
}

// The trim editor for the link in the Video tab.
function openVideoTrim() {
  const gif = format === "gif";
  openTrim({
    key: previewUrl, request: { url: previewUrl }, video: isVideoFormat(format),
    title: $("previewTitle").textContent, duration: previewSeconds,
    start: trim ? trim.start : 0,
    end: trim ? trim.end : gif ? Math.min(10, previewSeconds) : previewSeconds,
    maxLength: gif ? 60 : 0,
    done: (part) => { trim = part; showTrimChip(); },
    clip: () => ({ source: { url: previewUrl }, title: $("previewTitle").textContent, format, quality: $("quality").value,
                   normalize: AUDIO_FORMATS.includes(format) && $("normalize").checked }),
  });
}

// Show the video at a moment, e.g. where a line is being dragged to (without moving the playhead).
function showFrame(seconds) {
  if (player !== $("trimVideo") || !player.paused || !player.getAttribute("src")) return;
  player.currentTime = Math.min(seconds, Math.max(0, editor.duration - 0.05));
}

function showVideoTime() {
  $("videoTime").textContent = clock(player.currentTime);
}
$("trimVideo").addEventListener("timeupdate", showVideoTime);
$("trimVideo").addEventListener("seeked", showVideoTime);

function closeTrim() {
  stopPlaying();
  if (typeof clipClosed === "function") clipClosed();
  $("trimModal").hidden = true;
  editor.url = "";
}

function waveMessage(kind, text) {
  $("waveMessage").className = "wave-message " + kind;
  $("waveMessage").textContent = text;
}

// A short red note under the times, like "The start has to be before the end."
function warn(text) {
  $("trimLength").classList.toggle("warn", !!text);
  if (text) $("trimLength").textContent = text;
}

const pct = (seconds) => (seconds / (editor.duration || 1)) * 100;

// Draw the waveform and put the lines, shading and times where they belong.
function layOut() {
  const startPct = pct(editor.start), endPct = pct(editor.end);
  $("handleStart").style.left = startPct + "%";
  $("handleEnd").style.left = endPct + "%";
  $("shadeLeft").style.cssText = `left:0;width:${startPct}%`;
  $("shadeRight").style.cssText = `left:${endPct}%;right:0`;
  $("keepBox").style.cssText = `left:${startPct}%;width:${endPct - startPct}%`;
  $("rulerEnd").textContent = editor.duration ? clock(editor.duration, false) : "";
  if (document.activeElement !== $("trimStart")) $("trimStart").value = clock(editor.start);
  if (document.activeElement !== $("trimEnd")) $("trimEnd").value = clock(editor.end);
  if (!$("trimLength").classList.contains("warn")) {
    $("trimLength").textContent = editor.duration
      ? `Keeping ${clock(editor.end - editor.start)} of ${clock(editor.duration, false)}` : "";
  }
  showPlayhead();
  drawWave();
  if (typeof clipChanged === "function") clipChanged();
}

function showPlayhead() {
  const ready = !!editor.peaks;
  $("playhead").hidden = !ready;
  $("playhead").style.left = pct(editor.pos) + "%";
  $("trimNow").textContent = ready ? clock(editor.pos) : "";
}

function drawWave() {
  const canvas = $("waveCanvas");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  if (!editor.peaks) return;
  const bar = 3, gap = 1, count = Math.floor(width / (bar + gap));
  const middle = height / 2, peaks = editor.peaks;
  ctx.fillStyle = "#d9d5cc";
  for (let i = 0; i < count; i++) {
    // the loudest moment in the stretch of sound this bar covers
    const from = Math.floor((i / count) * peaks.length), to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
    let peak = 0;
    for (let j = from; j < to; j++) peak = Math.max(peak, peaks[j]);
    const h = Math.max(2, peak * (height - 16));
    ctx.fillRect(i * (bar + gap), middle - h / 2, bar, h);
  }
}

const MIN_LENGTH = 0.5;

// Move one line. It never pushes the other line: it stops just before it instead.
function setLine(which, seconds) {
  const d = editor.duration;
  if (which === "start") editor.start = Math.min(Math.max(0, seconds), editor.end - MIN_LENGTH);
  else editor.end = Math.max(Math.min(d, seconds), editor.start + MIN_LENGTH);
  warn("");
  layOut();
}

// Move the playhead (and the video picture) to a moment.
function seek(seconds) {
  editor.pos = Math.min(Math.max(0, seconds), editor.duration);
  if (player.getAttribute("src")) player.currentTime = Math.min(editor.pos, Math.max(0, editor.duration - 0.05));
  layOut();
}

function timeAt(clientX) {
  const box = $("wave").getBoundingClientRect();
  return Math.min(Math.max(0, (clientX - box.left) / box.width), 1) * editor.duration;
}

// Dragging a yellow line moves only that line.
for (const [id, which] of [["handleStart", "start"], ["handleEnd", "end"]]) {
  const handle = $(id);
  handle.addEventListener("pointerdown", (e) => {
    if (!editor.duration) return;
    e.stopPropagation();
    e.preventDefault();
    editor.dragging = which;
    handle.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (editor.dragging !== which) return;
    setLine(which, timeAt(e.clientX));
    showFrame(editor[which]);
  });
  const drop = () => {
    if (editor.dragging !== which) return;
    editor.dragging = null;
    handle.classList.remove("dragging");
    // The playhead goes to the line, so pressing play plays from there.
    seek(which === "start" ? editor.start : Math.max(editor.start, editor.end - 2));
  };
  handle.addEventListener("pointerup", drop);
  handle.addEventListener("pointercancel", drop);
}

// Clicking (or dragging) anywhere else on the waveform only moves the playhead.
$("wave").addEventListener("pointerdown", (e) => {
  if (!editor.duration) return;
  editor.dragging = "playhead";
  $("wave").setPointerCapture(e.pointerId);
  seek(timeAt(e.clientX));
});
$("wave").addEventListener("pointermove", (e) => {
  // A thin line and the time under the mouse, so you can see where a click goes.
  const hover = $("hoverLine");
  if (editor.duration && editor.peaks && !editor.dragging) {
    const box = $("wave").getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - box.left), box.width);
    hover.hidden = false;
    hover.style.left = x + "px";
    hover.classList.toggle("flip", x > box.width - 60);
    $("hoverTime").textContent = clock(timeAt(e.clientX));
  } else {
    hover.hidden = true;
  }
  if (editor.dragging === "playhead") seek(timeAt(e.clientX));
});
$("wave").addEventListener("pointerleave", () => { $("hoverLine").hidden = true; });
const endScrub = () => { if (editor.dragging === "playhead") editor.dragging = null; };
$("wave").addEventListener("pointerup", endScrub);
$("wave").addEventListener("pointercancel", endScrub);

// "Set start here" / "Set end here": the line jumps to the playhead.
function setHere(which) {
  const t = editor.pos;
  if (which === "start" && t > editor.end - MIN_LENGTH) {
    return warn(`The start has to be before the end (${clock(editor.end)}). Move the end first, or pick an earlier moment.`);
  }
  if (which === "end" && t < editor.start + MIN_LENGTH) {
    return warn(`The end has to be after the start (${clock(editor.start)}). Move the start first, or pick a later moment.`);
  }
  setLine(which, t);
}
$("setStart").addEventListener("click", () => setHere("start"));
$("setEnd").addEventListener("click", () => setHere("end"));

// -1s / +1s next to the times (with Shift: a tenth of a second).
document.querySelectorAll(".nudge").forEach((button) => button.addEventListener("click", (e) => {
  if (!editor.duration) return;
  const which = button.dataset.which;
  const step = Number(button.dataset.step) * (e.shiftKey ? 0.1 : 1);
  const before = editor[which];
  setLine(which, before + step);
  if (editor[which] === before) {
    warn(which === "start" && step > 0 ? "The start can't go past the end." : which === "end" && step < 0
      ? "The end can't go before the start." : "That's as far as it goes.");
  }
  seek(which === "start" ? editor.start : Math.max(editor.start, editor.end - 2));
}));

["trimStart", "trimEnd"].forEach((id) => {
  const input = $(id), which = id === "trimStart" ? "start" : "end";
  input.addEventListener("input", () => input.classList.remove("bad"));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  input.addEventListener("change", () => {
    const t = parseTime(input.value.trim());
    if (t === null || t > editor.duration) {
      input.classList.add("bad");
      return warn(`Type a time like 1:20${editor.duration ? `, up to ${clock(editor.duration, false)}` : ""}.`);
    }
    if (which === "start" ? t > editor.end - MIN_LENGTH : t < editor.start + MIN_LENGTH) {
      input.classList.add("bad");
      return warn(which === "start" ? `The start has to be before the end (${clock(editor.end)}).`
        : `The end has to be after the start (${clock(editor.start)}).`);
    }
    input.classList.remove("bad");
    setLine(which, t);
    seek(which === "start" ? editor.start : Math.max(editor.start, editor.end - 2));
  });
  input.addEventListener("blur", () => { if (!input.classList.contains("bad")) layOut(); });
});

function stopPlaying() {
  player.pause();
  cancelAnimationFrame(editor.raf);
  editor.stopAt = null;
  $("trimPlay").classList.remove("playing");
  $("trimPreview").textContent = "Play my part";
}

function followPlayhead() {
  editor.pos = player.currentTime;
  if (editor.stopAt !== null && editor.pos >= editor.stopAt) {
    editor.pos = editor.stopAt;
    stopPlaying();
    return showPlayhead();
  }
  showPlayhead();
  editor.raf = requestAnimationFrame(followPlayhead);
}

function play(from, stopAt) {
  stopPlaying();
  player.currentTime = from;
  editor.pos = from;
  player.play().then(() => {
    editor.stopAt = stopAt;
    $("trimPlay").classList.add("playing");
    if (stopAt !== null) $("trimPreview").textContent = "Stop";
    followPlayhead();
  }).catch(() => warn("Couldn't play the sound, but trimming still works."));
}

// Play / pause from the playhead.
$("trimPlay").addEventListener("click", () => {
  if (!player.paused) return stopPlaying();
  play(editor.pos >= editor.duration - 0.05 ? 0 : editor.pos, null);
});
// Play just the part between the lines.
$("trimPreview").addEventListener("click", () => {
  if (!player.paused) return stopPlaying();
  play(editor.start, editor.end);
});
const ended = () => { stopPlaying(); editor.pos = editor.duration; showPlayhead(); };
$("trimAudio").addEventListener("ended", ended);
$("trimVideo").addEventListener("ended", ended);
$("trimVideo").addEventListener("click", () => { if (!$("trimPlay").disabled) $("trimPlay").click(); });

$("trimReset").addEventListener("click", () => {
  editor.start = 0;
  editor.end = editor.duration;
  warn("");
  layOut();
});
$("trimCancel").addEventListener("click", closeTrim);
$("trimDone").addEventListener("click", () => {
  const max = trimSource && trimSource.maxLength;
  if (max && editor.end - editor.start > max + 0.05) {
    return warn(`That's ${clock(editor.end - editor.start)}. GIFs can be up to ${max} seconds, so move the lines closer together.`);
  }
  // (A GIF without a part picked would be the first 10 seconds, so a GIF of all of it keeps the part.)
  const whole = editor.start <= 0.05 && editor.end >= editor.duration - 0.05 && !(trimSource && trimSource.maxLength);
  const part = whole || !editor.duration ? null : { start: editor.start, end: editor.end };
  const source = trimSource;
  closeTrim();
  if (source) source.done(part);
});
$("trimToggle").addEventListener("click", openVideoTrim);
$("trimEdit").addEventListener("click", openVideoTrim);
$("trimClear").addEventListener("click", clearTrim);
document.addEventListener("keydown", (e) => {
  if ($("trimModal").hidden) return;
  if (e.key === "Escape") return closeTrim();
  if (e.target.tagName === "INPUT") return;
  if (e.key === " ") {
    e.preventDefault();
    $("trimPlay").click();
  } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && editor.peaks) {
    // Arrow keys move the playhead 1 second (with Shift: a tenth).
    e.preventDefault();
    const step = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 1);
    const playing = !player.paused, stopAt = editor.stopAt;
    seek(editor.pos + step);
    if (playing) play(editor.pos, stopAt);
  }
});
window.addEventListener("resize", () => { if (!$("trimModal").hidden) drawWave(); });

// ---- adding to the queue

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  // A trim or playlist from a link that was changed since doesn't count.
  const same = url === previewUrl;
  const part = trim && same ? { start: trim.start.toFixed(1), end: trim.end.toFixed(1) } : {};
  const items = playlist && same ? playlist.entries.filter((entry) => picked.has(entry.url)) : null;
  if (items && !items.length) return;
  $("url").value = "";
  hidePreview();
  $("url").focus();
  const res = items ? await api("/api/convert-many", { format, items }) : await api("/api/convert", { url, format, ...part });
  $("notice").className = res.ok ? "notice" : "notice error";
  $("notice").textContent = res.ok ? "" : res.error;
  refresh();
});

$("change").addEventListener("click", async () => render(await api("/api/pick-folder", {})));
$("checkNow").addEventListener("click", () => {
  dismissedUpdate = null;
  api("/api/check-updates", {}).then(refresh);
});
$("autoUpdate").addEventListener("change", async () => render(await api("/api/auto-update", { on: $("autoUpdate").checked })));
$("clear").addEventListener("click", () => api("/api/clear", {}).then(refresh));
$("updateInstall").addEventListener("click", async () => {
  $("updateInstall").disabled = true;
  const res = await api("/api/install-app-update", {}).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  $("updateInstall").disabled = false;
  if (!res.ok) $("updateText").textContent = res.error;
  else refresh();
});
$("updateLater").addEventListener("click", () => {
  dismissedUpdate = $("updateModal").dataset.version;
  $("updateModal").hidden = true;
});

// ---- drawing the window from the app's state

function renderJob(el, job) {
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = `
      <div class="thumb"></div>
      <div class="body">
        <div class="title"></div>
        <div class="line"><span class="badge"></span><span class="msg"></span></div>
        <div class="bar"><div></div></div>
      </div>
      <div class="pct"></div>
      <div class="actions"></div>`;
    el.dataset.id = job.id;
  }
  el.className = "job " + job.status;
  setDrag(el, job.status === "done" ? { kind: "job", id: job.id } : null);
  el.title = job.status === "done" ? DRAG_HINT : "";
  el.querySelector(".thumb").style.backgroundImage = job.thumbnail ? `url("${job.thumbnail}")` : "";
  el.querySelector(".title").textContent = job.title;
  el.querySelector(".title").title = job.title;
  el.querySelector(".badge").textContent = [job.format.toUpperCase(), job.qualityLabel.replace(/ \(.*\)/, ""), job.trimLabel]
    .filter(Boolean).join(" · ");
  el.querySelector(".msg").textContent = job.message;

  const bar = el.querySelector(".bar");
  bar.hidden = job.status !== "active";
  bar.classList.toggle("indeterminate", !job.progress || job.progress >= 100);
  bar.firstElementChild.style.width = job.progress && job.progress < 100 ? job.progress + "%" : "";
  el.querySelector(".pct").textContent =
    job.status === "active" && job.progress && job.progress < 100 ? Math.floor(job.progress) + "%" : "";

  const actions = el.querySelector(".actions");
  const wanted = { queued: ["remove"], active: job.cancel ? [] : ["stop"], done: ["folder", "remove"], error: ["retry", "remove"] }[job.status];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    const titles = { remove: "Remove from list", retry: "Try again", folder: "Show in folder", stop: "Stop this download" };
    const routes = { remove: "/api/remove", retry: "/api/retry", folder: "/api/show-file", stop: "/api/cancel" };
    for (const kind of wanted) {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = titles[kind];
      b.innerHTML = ICONS[kind];
      b.onclick = () => api(routes[kind], { id: job.id }).then(refresh);
      actions.append(b);
    }
  }
  return el;
}

function renderQueue(jobs) {
  $("queue").classList.toggle("show", jobs.length > 0);
  $("clear").hidden = !jobs.some((j) => j.status === "done" || j.status === "error");
  $("dragTip").hidden = !jobs.some((j) => j.status === "done");
  const list = $("jobs");
  const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
  const ordered = [...jobs].reverse(); // newest on top
  ordered.forEach((job, i) => {
    const el = renderJob(existing.get(String(job.id)), job);
    existing.delete(String(job.id));
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  existing.forEach((el) => el.remove());
}

// The popup that offers a new version of the app.
let dismissedUpdate = null;
let closing = false;

function renderUpdatePopup(s) {
  const update = s.appUpdate;
  const modal = $("updateModal");
  const installing = s.appUpdateProgress !== null;
  modal.hidden = !update || (!installing && dismissedUpdate === update.version);
  if (modal.hidden) return;
  modal.dataset.version = update.version;
  if (installing) modal.dataset.shown = "";
  $("updateActions").hidden = installing;
  $("updateBar").hidden = !installing;
  $("updateBar").firstElementChild.style.width = installing ? s.appUpdateProgress + "%" : "";
  if (!installing) {
    $("updateHeading").textContent = "Update available";
    if (!$("updateInstall").disabled && modal.dataset.shown !== update.version) {
      modal.dataset.shown = update.version;
      $("updateText").textContent = `Version ${update.version} of Lelons Converter is ready to install. You have ${s.version}.`;
    }
  } else if (s.appUpdateProgress < 100) {
    $("updateHeading").textContent = "Updating...";
    $("updateText").textContent = "Downloading the new version.";
  } else {
    $("updateHeading").textContent = "Almost done";
    $("updateText").textContent = "The installer is opening. Click Install, and the app opens again when it's finished.";
    if (!closing) {
      closing = true;
      setTimeout(() => window.close(), 2500);
    }
  }
}

function render(s) {
  $("folder").textContent = s.folderName;
  $("folder").title = s.folder;
  $("version").textContent = "Version " + s.version;
  if (typeof checkWhatsNew === "function") checkWhatsNew(s);
  const key = format + ":" + s.quality[format];
  if (key !== shownQuality) {
    $("quality").innerHTML = "";
    for (const [value, label] of s.qualities[format]) $("quality").add(new Option(label, value));
    $("quality").value = s.quality[format];
    shownQuality = key;
  }
  $("checkNow").disabled = s.checking;
  $("autoUpdate").checked = s.autoUpdate;
  $("normalize").checked = s.normalize;
  if (s.notice) {
    $("notice").className = "notice " + s.notice.kind;
    $("notice").textContent = s.notice.text;
  } else if (!$("notice").classList.contains("error")) {
    $("notice").textContent = "";
  }
  renderQueue(s.jobs);
  if (typeof renderFiles === "function") renderFiles(s.files);
  if (typeof renderHistoryVersion === "function") renderHistoryVersion(s.historyVersion);
  if (typeof renderSfxUploads === "function") renderSfxUploads(s.sfxUploads);
  renderUpdatePopup(s);
}

let failedChecks = 0;
async function refresh() {
  try {
    render(await api("/api/state"));
    failedChecks = 0;
  } catch (e) {
    // The app isn't answering: it was closed (or is updating).
    if (++failedChecks === 6 && !closing) {
      $("notice").className = "notice error";
      $("notice").textContent = "Lelons Converter was closed. Close this window and open the app again.";
    }
  }
}
showFormatExtras();
refresh();
setInterval(refresh, 500);
// (The token from the address: a goodbye message can't carry the window's cookie when it closes.)
window.addEventListener("pagehide", () => navigator.sendBeacon("/api/bye?t=" + encodeURIComponent(new URLSearchParams(location.search).get("t") || "")));
