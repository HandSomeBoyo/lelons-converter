const $ = (id) => document.getElementById(id);
let format = "mp3";
let shownQuality = "";
let previewUrl = "";
let previewTimer = null;
let previewSeconds = 0;

const ICONS = {
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return res.json();
}

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
const waves = new Map(); // url -> waveform from the app, so it only loads once
const editor = { url: "", duration: 0, peaks: null, start: 0, end: 0, dragging: null, raf: 0 };
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
  $("trimModal").hidden = false;
  $("trimSub").textContent = source.title + (source.maxLength ? ` · GIFs can be up to ${source.maxLength} seconds` : "");
  $("trimPlay").disabled = true;
  layOut();
  let wave = waves.get(key);
  if (!wave) {
    waveMessage("loading", video ? "Loading the video..." : "Loading the sound...");
    wave = await api("/api/waveform", { ...source.request, video })
      .catch(() => ({ ok: false, error: video ? "Couldn't load the video." : "Couldn't load the sound." }));
    if (wave.ok) waves.set(key, wave);
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
  $("trimPlay").disabled = false;
  layOut();
  showFrame(editor.start);
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
  });
}

// Show the video at a moment, e.g. where a line was dragged to.
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
  $("trimModal").hidden = true;
  editor.url = "";
}

function waveMessage(kind, text) {
  $("waveMessage").className = "wave-message " + kind;
  $("waveMessage").textContent = text;
}

// Draw the waveform and put the lines, shading and times where they belong.
function layOut() {
  const d = editor.duration || 1;
  const startPct = (editor.start / d) * 100, endPct = (editor.end / d) * 100;
  $("handleStart").style.left = startPct + "%";
  $("handleEnd").style.left = endPct + "%";
  $("shadeLeft").style.cssText = `left:0;width:${startPct}%`;
  $("shadeRight").style.cssText = `left:${endPct}%;right:0`;
  $("rulerEnd").textContent = editor.duration ? clock(editor.duration, false) : "";
  if (document.activeElement !== $("trimStart")) $("trimStart").value = clock(editor.start);
  if (document.activeElement !== $("trimEnd")) $("trimEnd").value = clock(editor.end);
  $("trimLength").textContent = editor.duration
    ? `Keeping ${clock(editor.end - editor.start)} of ${clock(editor.duration, false)}` : "";
  drawWave();
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

function setLine(which, seconds) {
  const d = editor.duration;
  if (which === "start") editor.start = Math.min(Math.max(0, seconds), editor.end - MIN_LENGTH);
  else editor.end = Math.max(Math.min(d, seconds), editor.start + MIN_LENGTH);
  layOut();
}

function timeAt(clientX) {
  const box = $("wave").getBoundingClientRect();
  return Math.min(Math.max(0, (clientX - box.left) / box.width), 1) * editor.duration;
}

// Click or drag anywhere on the waveform: the nearest line moves there.
$("wave").addEventListener("pointerdown", (e) => {
  if (!editor.duration) return;
  const t = timeAt(e.clientX);
  editor.dragging = Math.abs(t - editor.start) <= Math.abs(t - editor.end) ? "start" : "end";
  if (editor.start === editor.end) editor.dragging = t < editor.start ? "start" : "end";
  $("wave").setPointerCapture(e.pointerId);
  setLine(editor.dragging, t);
  showFrame(editor[editor.dragging]);
});
$("wave").addEventListener("pointermove", (e) => {
  if (!editor.dragging) return;
  setLine(editor.dragging, timeAt(e.clientX));
  showFrame(editor[editor.dragging]);
});
$("wave").addEventListener("pointerup", () => {
  if (!editor.dragging) return;
  // While playing, jump to the line that was moved so you hear the new spot.
  if (!player.paused) player.currentTime = editor.dragging === "start" ? editor.start : Math.max(editor.start, editor.end - 2);
  editor.dragging = null;
});

["trimStart", "trimEnd"].forEach((id) => {
  const input = $(id), which = id === "trimStart" ? "start" : "end";
  input.addEventListener("input", () => input.classList.remove("bad"));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  input.addEventListener("change", () => {
    const t = parseTime(input.value.trim());
    const ok = t !== null && t <= editor.duration
      && (which === "start" ? t <= editor.end - MIN_LENGTH : t >= editor.start + MIN_LENGTH);
    input.classList.toggle("bad", !ok);
    if (ok) {
      setLine(which, t);
      showFrame(editor[which]);
    }
  });
  input.addEventListener("blur", () => { if (!input.classList.contains("bad")) layOut(); });
});

function stopPlaying() {
  player.pause();
  cancelAnimationFrame(editor.raf);
  $("trimPlay").classList.remove("playing");
  $("playhead").hidden = true;
}

function followPlayhead() {
  if (player.currentTime >= editor.end) {
    stopPlaying();
    return;
  }
  $("playhead").hidden = false;
  $("playhead").style.left = (player.currentTime / editor.duration) * 100 + "%";
  editor.raf = requestAnimationFrame(followPlayhead);
}

$("trimPlay").addEventListener("click", () => {
  if (!player.paused) return stopPlaying();
  if (player.currentTime < editor.start || player.currentTime >= editor.end - 0.05) player.currentTime = editor.start;
  player.play().then(() => {
    $("trimPlay").classList.add("playing");
    followPlayhead();
  }).catch(() => { $("trimLength").textContent = "Couldn't play the sound, but trimming still works."; });
});
$("trimAudio").addEventListener("ended", stopPlaying);
$("trimVideo").addEventListener("ended", stopPlaying);
$("trimVideo").addEventListener("click", () => { if (!$("trimPlay").disabled) $("trimPlay").click(); });

$("trimReset").addEventListener("click", () => {
  editor.start = 0;
  editor.end = editor.duration;
  layOut();
});
$("trimCancel").addEventListener("click", closeTrim);
$("trimDone").addEventListener("click", () => {
  const max = trimSource && trimSource.maxLength;
  if (max && editor.end - editor.start > max + 0.05) {
    $("trimLength").textContent = `That's ${clock(editor.end - editor.start)}. GIFs can be up to ${max} seconds, so move the lines closer together.`;
    return;
  }
  const whole = editor.start <= 0.05 && editor.end >= editor.duration - 0.05;
  const part = whole || !editor.duration ? null : { start: editor.start, end: editor.end };
  const source = trimSource;
  closeTrim();
  if (source) source.done(part);
});
$("trimToggle").addEventListener("click", openVideoTrim);
$("trimEdit").addEventListener("click", openVideoTrim);
$("trimClear").addEventListener("click", clearTrim);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("trimModal").hidden) closeTrim();
  if (e.key === " " && !$("trimModal").hidden && e.target.tagName !== "INPUT") {
    e.preventDefault();
    $("trimPlay").click();
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
  const wanted = { queued: ["remove"], active: [], done: ["folder", "remove"], error: ["retry", "remove"] }[job.status];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    const titles = { remove: "Remove from list", retry: "Try again", folder: "Show in folder" };
    const routes = { remove: "/api/remove", retry: "/api/retry", folder: "/api/show-file" };
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
window.addEventListener("pagehide", () => navigator.sendBeacon("/api/bye"));
