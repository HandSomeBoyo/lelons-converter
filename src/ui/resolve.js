// The Resolve tab: add one video, watch it, then pick Subtitles, Cut the silence or Fix for Resolve.
// Subtitles are checked and fixed right here (on the same player) before they go into Resolve.
// Project folders sit below. Uses $, api(), clock(), openTrim(), whereToSave(), refresh() from app.js
// and showTab(), sizeText() from images.js.

let rtTool = "";
let rtView = "pick"; // pick | setup | subs | done
let rtOptions = { fix: "", style: "normal", language: "", model: "best", level: "normal", pause: "0.5", cutAs: "timeline", device: "gpu", words: "", track: "auto", perScreen: "0", textStyle: "", fadeOut: "off", fadeLen: "0.3", fadeGap: "0.5", punct: "keep", case: "as", position: "bottom", reveal: "word", swears: "keep", loud: "pop", friendColor: "blue", loudColor: "yellow" };
let rtNvidia = false; // an NVIDIA graphics card to listen on
let rtServer = []; // from the app's state
let rtId = ""; // the video on the tab
let rtLocal = null; // a dropped video still being copied in: {name, size, url, percent, xhr, error}
let rtPart = null; // only part of the video: {start, end}
let rtError = "";
let rtProjectPath = "";
let rtSeenRun = ""; // the finished job the tab already moved on from
const rtVideo = $("rtVideo");
// (3.0) With several sound tracks (OBS: game on one, your mic on another) the window would only play the
// first, so each track plays from its own sound file along with the picture, each one on or off ("Hear").
let rtTracks = []; // [{audio, on}] once they're ready
let rtMixText = "";
let rtVolume = (() => { const v = parseFloat(loadPref("rtVolume")); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; })();
let rtStripKey = "";
let rtLearned = 0; // fixes it remembers
let rtLiveTimer = 0; // asks for the lines heard so far while it listens

api("/api/rt-options", {}).then((res) => {
  if (!res.ok) return;
  rtOptions = { ...rtOptions, ...res.options, track: "auto" };
  rtNvidia = !!res.nvidia;
  rtLearned = res.learned || 0;
  drawLearned();
  $("rtWords").value = rtOptions.words || "";
  $("rtLang").value = rtOptions.language || "";
  drawResolve();
  drawLook();
  drawCaptionLook();
}).catch(() => {});

const RT_NAMES = { fix: "Fix for Resolve", subtitles: "Subtitles", silence: "Cut the silence" };
const RT_NOTES = {
  fix: (o) => o.fix === "smooth"
    ? "Makes an editing file (DNxHR) that plays smoothly even on a slow PC. Files get about 10 times bigger."
    : "A steady frame rate, sound Resolve always reads, and every sound track (game, mic, Discord) kept separate.",
  subtitles: (o) => "Listens on your PC, nothing is uploaded. "
    + `The first time it downloads the speech model (${o.model !== "best" ? "about 480 MB" : rtUsesGpu() ? "about 3 GB" : "about 1.6 GB"}`
    + (rtUsesGpu() ? ", plus NVIDIA's tools for your graphics card, about 1.3 GB)." : ")."),
  silence: (o) => o.cutAs === "video"
    ? "Makes a new video without the quiet parts."
    : "Makes a timeline without the quiet parts. Every cut is a normal cut you can still change in Resolve.",
};
const rtUsesGpu = () => rtNvidia && rtOptions.device !== "cpu";
const rtItem = () => rtServer.find((f) => f.id === rtId) || null;
const rtBusy = (f) => !!f && !!(f.status === "active" || f.status === "queued" || f.waitingFor);

// ---------------------------------------------------------------- adding the video

function rtTakesDrop(files) {
  if ($("resolveTab").hidden) return false;
  const file = [...files].find((f) => /^(video|audio)\//.test(f.type) || /\.(mkv|avi|mov|wmv|flv|webm|m4a|flac|wav|mp4)$/i.test(f.name));
  if (file) rtUse(file);
  return true;
}

// Takes the old video off the tab (unless it's still being worked on).
function rtLetGo() {
  const old = rtItem();
  if (old && !rtBusy(old)) {
    api("/api/rt-remove", { id: old.id });
    rtServer = rtServer.filter((f) => f.id !== old.id);
  }
  if (rtLocal) {
    if (rtLocal.xhr) rtLocal.xhr.abort();
    URL.revokeObjectURL(rtLocal.url);
  }
  rtLocal = null;
  rtId = "";
  rtPart = null;
  rtError = "";
  rtSeenRun = "";
  subs.cues = [];
  subs.peaks = null;
  rtVideo.removeAttribute("src");
  rtVideo.load();
  rtMixText = "";
  for (const t of rtTracks) { t.audio.pause(); t.audio.removeAttribute("src"); }
  rtTracks = [];
  rtVideo.muted = false;
  rtStripKey = "";
  $("rtStrip").innerHTML = "";
  $("rtHear").innerHTML = "";
}

// A dropped file: it plays right away from memory while it's copied into VaultHub.
function rtUse(file) {
  showTab("resolve");
  rtLetGo();
  rtView = "pick";
  rtLocal = { name: file.name, size: file.size, url: URL.createObjectURL(file), percent: 0 };
  rtPlay(rtLocal.url);
  const xhr = new XMLHttpRequest();
  rtLocal.xhr = xhr;
  const local = rtLocal;
  xhr.open("POST", "/api/rt-add");
  xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { local.percent = (e.loaded / e.total) * 100; drawResolve(); } };
  xhr.onload = () => {
    let res;
    try { res = JSON.parse(xhr.responseText); } catch (e) { res = { ok: false, error: "Couldn't open this file." }; }
    if (rtLocal !== local) {
      if (res.ok) api("/api/rt-remove", { id: res.file.id });
      return;
    }
    if (!res.ok) { local.error = res.error; drawResolve(); return; }
    local.xhr = null;
    rtServer.push(res.file);
    rtId = res.file.id;
    rtLoadWave();
    rtLoadTracks();
    if (rtVideo.dataset.broken) rtMakePreview(); // the window couldn't play it: make a copy it can
    drawResolve();
  };
  xhr.onerror = () => { if (rtLocal === local) { local.error = "Couldn't open this file."; drawResolve(); } };
  xhr.send(file);
  drawResolve();
}

// "Add a video": the Open window. The video is used where it is, so it plays at once.
let rtPicking = false;
$("rtDrop").addEventListener("click", rtPick);
$("rtChange").addEventListener("click", rtPick);
// (3.0) Close the video and go back to the start of the page.
$("rtClose").addEventListener("click", () => {
  if (rtBusy(rtItem())) return;
  if (rtUnsent() && !confirm("Close this video? The subtitles you haven't put in Resolve yet will be lost.")) return;
  saveSubsNow();
  rtLetGo();
  rtView = "pick";
  drawResolve();
});
const rtUnsent = () => { const f = rtItem(); return !!f && f.hasCues && !f.sent; };
async function rtPick(e) {
  if (e && e.target === $("rtFiles")) return;
  if (e) e.preventDefault();
  if (rtPicking) return;
  rtPicking = true;
  const res = await api("/api/rt-pick", {}).catch(() => ({ ok: false, fallback: true }));
  rtPicking = false;
  if (!res.ok) return res.fallback && $("rtFiles").click();
  const [file, ...extra] = res.files;
  for (const f of extra) api("/api/rt-remove", { id: f.id });
  if (!file) {
    if (res.errors.length) { rtError = res.errors[0]; drawResolve(); }
    return;
  }
  if (rtUnsent() && !confirm("Open the new video? The subtitles you haven't put in Resolve yet will be lost.")) {
    api("/api/rt-remove", { id: file.id });
    return;
  }
  rtLetGo();
  rtView = "pick";
  rtServer.push(file);
  rtId = file.id;
  rtPlay(`/rt-video/${file.id}`);
  rtLoadWave();
  rtLoadTracks();
  drawResolve();
}
$("rtFiles").addEventListener("change", (e) => {
  if (e.target.files[0]) rtUse(e.target.files[0]);
  e.target.value = "";
});

// ---------------------------------------------------------------- playing

function rtPlay(src) {
  delete rtVideo.dataset.broken;
  rtVideo.src = src;
  rtLoading("Opening the video...");
}

function rtLoading(text) {
  $("rtLoading").hidden = !text;
  $("rtLoadingText").textContent = text || "";
}

rtVideo.addEventListener("loadeddata", () => {
  const item = rtItem();
  // Sound plays but no picture: the window can't show this kind of video.
  if (!rtVideo.videoWidth && (item ? item.video : rtLocal && /^video|\.(mkv|mov|avi|mp4)$/i.test(rtLocal.name))) return rtCantPlay();
  rtLoading("");
  rtTick();
});
rtVideo.addEventListener("error", () => { if (rtVideo.getAttribute("src")) rtCantPlay(); });

function rtCantPlay() {
  if (rtVideo.dataset.broken) return;
  rtVideo.dataset.broken = "1";
  if (rtId) rtMakePreview();
  else rtLoading("Getting the video ready...");
}

// The window can't play this one (some MKV, ProRes or 10-bit videos): VaultHub makes a copy it can.
async function rtMakePreview() {
  const id = rtId;
  while (id === rtId) {
    const res = await api("/api/rt-preview", { id }).catch(() => ({ ok: false }));
    if (id !== rtId) return;
    if (!res.ok || res.error) return rtLoading(res.error || "Couldn't show this video, but the tools still work on it.");
    if (res.ready) {
      const at = rtVideo.currentTime || 0;
      rtVideo.src = `/rt-video/${id}/copy`;
      rtVideo.currentTime = at;
      return;
    }
    rtLoading(`Getting the video ready... ${Math.floor(res.progress || 0)}%`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function rtLoadTracks() {
  const item = rtItem();
  if (!item || (item.audioTracks || 0) < 2) return;
  const id = rtId;
  while (id === rtId) {
    const res = await api("/api/rt-tracks", { id }).catch(() => ({ ok: false }));
    if (id !== rtId) return;
    if (!res.ok || res.error) { rtMixText = res.error || ""; drawResolve(); return; }
    if (res.ready) {
      rtTracks = Array.from({ length: res.count }, (_, n) => {
        const audio = new Audio(`/rt-video/${id}/t${n}`);
        audio.preload = "auto";
        audio.dataset.ownVolume = "1"; // (its own slider, not the app's)
        return { audio, on: true };
      });
      rtVideo.muted = true;
      rtMixText = "";
      rtApplyVolume();
      rtSyncSound(true);
      drawHear();
      drawResolve();
      return;
    }
    rtMixText = `Getting your other sound tracks... ${Math.floor(res.progress || 0)}%`;
    drawResolve();
    await new Promise((r) => setTimeout(r, 500));
  }
}

function rtSyncSound(force) {
  for (const t of rtTracks) {
    const a = t.audio;
    if (force || Math.abs(a.currentTime - rtVideo.currentTime) > 0.2) a.currentTime = rtVideo.currentTime;
    a.playbackRate = rtVideo.playbackRate;
    if (rtVideo.paused || !t.on) a.pause();
    else if (a.paused) a.play().catch(() => {});
  }
}

// Volume and which tracks you hear (only in VaultHub: the files and Resolve aren't changed).
function rtApplyVolume() {
  rtVideo.volume = rtVolume;
  for (const t of rtTracks) t.audio.volume = rtVolume;
  $("rtVol").value = rtVolume;
  $("rtVol").style.setProperty("--fill", rtVolume * 100 + "%");
  $("rtVolButton").classList.toggle("muted", rtVolume === 0);
}
let rtVolBefore = 1;
$("rtVol").addEventListener("input", () => { rtVolume = parseFloat($("rtVol").value); rtApplyVolume(); });
$("rtVol").addEventListener("change", () => savePref("rtVolume", rtVolume));
$("rtVolButton").addEventListener("click", () => {
  if (rtVolume > 0) { rtVolBefore = rtVolume; rtVolume = 0; } else rtVolume = rtVolBefore || 1;
  rtApplyVolume();
  savePref("rtVolume", rtVolume);
});
rtVideo.dataset.ownVolume = "1";
rtApplyVolume();

function drawHear() {
  const box = $("rtHear");
  box.innerHTML = "";
  if (rtTracks.length < 2) return;
  const label = document.createElement("span");
  label.className = "rt-hear-label";
  label.textContent = "Hear";
  box.append(label);
  rtTracks.forEach((t, n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rt-hear-chip" + (t.on ? " on" : "");
    b.textContent = `Track ${n + 1}`;
    b.title = t.on ? `Turn track ${n + 1} off while you watch` : `Turn track ${n + 1} on`;
    b.onclick = () => { t.on = !t.on; rtSyncSound(true); drawHear(); };
    box.append(b);
  });
}

// ---- the picture strip over the sound wave, like a clip in Resolve's timeline
function drawStrip() {
  const item = rtItem();
  const strip = $("rtStrip");
  const width = strip.getBoundingClientRect().width;
  const length = rtLength();
  const per = item && item.video && width && length ? Math.max(4, Math.min(24, Math.round(width / 84))) : 0;
  $("rtWave").classList.toggle("has-strip", per > 0);
  if (!per) { strip.innerHTML = ""; rtStripKey = ""; return; }
  const [from, to] = tlRange();
  // (3.0) Zoomed in: more pictures along the whole video, and only the ones in view are shown.
  const count = Math.min(4000, Math.max(per, Math.round(per * length / (to - from))));
  const first = Math.max(0, Math.floor((from / length) * count)), last = Math.min(count, Math.ceil((to / length) * count));
  const key = `${item.id}:${count}:${first}:${last}:${Math.round(width)}`;
  if (key === rtStripKey) return;
  const keep = rtStripKey.split(":").slice(0, 2).join(":") === `${item.id}:${count}`;
  rtStripKey = key;
  const old = new Map(keep ? [...strip.children].map((img) => [img.dataset.n, img]) : []);
  if (!keep) strip.innerHTML = "";
  const slice = length / count;
  for (let n = first; n < last; n++) {
    let img = old.get(String(n));
    old.delete(String(n));
    if (!img) {
      img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.dataset.n = n;
      img.onload = () => img.classList.add("in");
      img.onerror = () => { img.style.visibility = "hidden"; };
      img.src = `/rt-thumb/${item.id}/${n}/${count}`;
      strip.append(img);
    }
    img.style.left = tlX(n * slice) * 100 + "%";
    img.style.width = (slice / (to - from)) * 100 + "%";
  }
  for (const img of old.values()) img.remove();
}

for (const ev of ["play", "pause", "seeked", "ratechange", "waiting", "playing"]) rtVideo.addEventListener(ev, () => rtSyncSound(ev !== "pause"));

async function rtLoadWave() {
  const id = rtId;
  const res = await api("/api/rt-wave", { id }).catch(() => ({ ok: false }));
  if (id !== rtId || !res.ok) return;
  subs.peaks = res.peaks;
  rtZoomSpan = 0;
  drawTimeline();
}

function subsClock(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

function seekSubs(t) {
  if (rtVideo.getAttribute("src")) rtVideo.currentTime = Math.max(0, t);
  rtTick();
}
$("rtPlay").addEventListener("click", () => (rtVideo.paused ? rtVideo.play().catch(() => {}) : rtVideo.pause()));
$("rtScreen").addEventListener("click", () => $("rtPlay").click());
rtVideo.addEventListener("play", () => { $("rtPlay").classList.add("playing"); rtTick(); });
rtVideo.addEventListener("pause", () => $("rtPlay").classList.remove("playing"));
rtVideo.addEventListener("seeked", rtTick);
rtVideo.addEventListener("loadedmetadata", () => drawSubsMarks());
document.addEventListener("keydown", (e) => {
  if ($("resolveTab").hidden || $("rtWork").hidden) return;
  if (e.key === " " && !/TEXTAREA|INPUT|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $("rtPlay").click(); }
});

function rtLength() {
  const item = rtItem();
  return (item && item.seconds) || rtVideo.duration || 0;
}

function rtTick() {
  const t = rtVideo.currentTime || 0;
  $("rtTime").textContent = subsClock(t);
  const length = rtLength() || 1;
  // (3.0) Zoomed in and playing: the view turns the page when the playhead gets to its edge.
  if (rtZoomSpan && !rtVideo.paused && !rtScrubbing) {
    const [from, to] = tlRange();
    if (t > to - rtZoomSpan * 0.03 || t < from) tlShow(t - rtZoomSpan * 0.08);
  }
  const x = tlX(t);
  $("rtHead").style.left = Math.min(100, x * 100) + "%";
  $("rtHead").style.visibility = x < 0 || x > 1 ? "hidden" : "";
  drawCaption();
  rtSyncSound(false);
  if (!rtVideo.paused && !$("resolveTab").hidden) requestAnimationFrame(rtTick);
}

// ---- (3.0) the timeline: zoom in (scroll up, or the + button), move along it (scroll sideways, shift +
// scroll, or drag the bar under it), and drag on it to scrub through the video.
let rtZoomStart = 0, rtZoomSpan = 0; // what's in view; span 0: all of it
let rtScrubbing = false;
function tlRange() {
  const length = rtLength() || 1;
  return rtZoomSpan ? [rtZoomStart, rtZoomStart + rtZoomSpan] : [0, length];
}
const tlX = (t) => { const [a, b] = tlRange(); return (t - a) / (b - a); };
function tlShow(start) {
  const length = rtLength() || 1;
  rtZoomStart = Math.max(0, Math.min(length - rtZoomSpan, start));
  drawTimeline();
}
function tlZoom(factor, at) {
  const length = rtLength();
  if (!length) return;
  const [from, to] = tlRange();
  const span = Math.max(Math.min(5, length), Math.min(length, (to - from) / factor));
  if (at == null) at = rtVideo.currentTime >= from && rtVideo.currentTime <= to ? rtVideo.currentTime : (from + to) / 2;
  const where = (at - from) / (to - from);
  rtZoomSpan = span >= length - 0.01 ? 0 : span;
  rtZoomStart = 0;
  if (rtZoomSpan) tlShow(at - where * span); else drawTimeline();
}
function drawTimeline() {
  drawSubsWave();
  drawStrip();
  drawLane();
  const t = rtVideo.currentTime || 0, x = tlX(t);
  $("rtHead").style.left = Math.min(100, x * 100) + "%";
  $("rtHead").style.visibility = x < 0 || x > 1 ? "hidden" : "";
  const length = rtLength();
  $("rtZoomFit").hidden = !rtZoomSpan;
  $("rtZoomOut").disabled = !rtZoomSpan;
  $("rtZoomIn").disabled = !length || (rtZoomSpan && rtZoomSpan <= 5.01);
  const bar = $("rtScroll");
  bar.hidden = !rtZoomSpan;
  if (rtZoomSpan) {
    bar.firstElementChild.style.left = (rtZoomStart / length) * 100 + "%";
    bar.firstElementChild.style.width = Math.max(2, (rtZoomSpan / length) * 100) + "%";
  }
}
$("rtZoomIn").addEventListener("click", () => tlZoom(2));
$("rtZoomOut").addEventListener("click", () => tlZoom(0.5));
$("rtZoomFit").addEventListener("click", () => { rtZoomSpan = 0; drawTimeline(); });
const tlTimeAt = (e) => { const box = $("rtWave").getBoundingClientRect(); const [a, b] = tlRange(); return a + Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (b - a); };
$("rtWave").addEventListener("wheel", (e) => {
  if (!rtLength()) return;
  e.preventDefault();
  const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
  if (sideways) {
    if (rtZoomSpan) tlShow(rtZoomStart + (sideways / $("rtWave").clientWidth) * rtZoomSpan);
    return;
  }
  tlZoom(Math.pow(1.0018, -e.deltaY), tlTimeAt(e));
}, { passive: false });
$("rtWave").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const wave = $("rtWave");
  wave.setPointerCapture(e.pointerId);
  rtScrubbing = true;
  const wasPlaying = !rtVideo.paused;
  if (wasPlaying) rtVideo.pause();
  seekSubs(tlTimeAt(e));
  const move = (m) => seekSubs(tlTimeAt(m));
  const up = () => {
    rtScrubbing = false;
    wave.removeEventListener("pointermove", move);
    wave.removeEventListener("pointerup", up);
    wave.removeEventListener("pointercancel", up);
    if (wasPlaying) rtVideo.play().catch(() => {});
  };
  wave.addEventListener("pointermove", move);
  wave.addEventListener("pointerup", up);
  wave.addEventListener("pointercancel", up);
});
// the bar under the timeline: drag it to move along
$("rtScroll").addEventListener("pointerdown", (e) => {
  const bar = $("rtScroll");
  const length = rtLength();
  if (!rtZoomSpan || !length) return;
  bar.setPointerCapture(e.pointerId);
  const box = bar.getBoundingClientRect();
  const thumb = bar.firstElementChild.getBoundingClientRect();
  const grab = e.clientX >= thumb.left && e.clientX <= thumb.right ? e.clientX - thumb.left : thumb.width / 2;
  const go = (m) => tlShow(((m.clientX - grab - box.left) / box.width) * length);
  go(e);
  const up = () => { bar.removeEventListener("pointermove", go); bar.removeEventListener("pointerup", up); };
  bar.addEventListener("pointermove", go);
  bar.addEventListener("pointerup", up);
});
// ← and → step a second (with Shift: five)
document.addEventListener("keydown", (e) => {
  if ($("resolveTab").hidden || $("rtWork").hidden || /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  seekSubs(Math.min(rtLength(), Math.max(0, rtVideo.currentTime + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1))));
});
window.addEventListener("resize", () => { if (!$("rtWork").hidden) drawTimeline(); });

function drawSubsWave() {
  const canvas = $("rtCanvas");
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, box.width * devicePixelRatio);
  canvas.height = Math.max(1, box.height * devicePixelRatio);
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!subs.peaks || !subs.peaks.length) return;
  g.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#888";
  const n = subs.peaks.length, length = rtLength() || 1, [from, to] = tlRange();
  const a = (from / length) * n, b = (to / length) * n;
  const bars = Math.max(1, Math.min(Math.floor(canvas.width / (2 * devicePixelRatio)), Math.ceil(b - a)));
  const w = canvas.width / bars, mid = canvas.height / 2;
  for (let i = 0; i < bars; i++) {
    // the loudest value in each bar's slice
    let p = 0;
    for (let k = Math.floor(a + ((b - a) * i) / bars), end = Math.max(k + 1, Math.floor(a + ((b - a) * (i + 1)) / bars)); k < end && k < n; k++) p = Math.max(p, subs.peaks[k] || 0);
    const h = Math.max(1, p * canvas.height * 0.9);
    g.fillRect(i * w, mid - h / 2, Math.max(1, w - Math.min(1, w * 0.25)), h);
  }
}

// ---------------------------------------------------------------- picking a tool

$("rtTools").querySelectorAll(".rt-tool").forEach((b) => b.addEventListener("click", () => {
  rtTool = b.dataset.tool;
  rtError = "";
  const item = rtItem();
  // Subtitles already made for this video: straight back to checking them.
  rtView = rtTool === "subtitles" && item && item.hasCues && item.tool === "subtitles" && !rtBusy(item) ? "subs" : "setup";
  if (rtView === "subs") openSubs();
  drawResolve();
}));
$("rtBack").addEventListener("click", () => { rtView = "pick"; drawResolve(); });
$("rtSubsBack").addEventListener("click", () => { saveSubsNow(); rtView = "pick"; drawResolve(); });
$("rtDoneBack").addEventListener("click", () => { rtView = "pick"; drawResolve(); });
$("rtOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  rtOptions[box.dataset.key] = b.dataset.value;
  rtError = "";
  drawResolve();
})));
$("rtWords").addEventListener("input", () => { rtOptions.words = $("rtWords").value; });
$("rtLang").addEventListener("change", () => { rtOptions.language = $("rtLang").value; rtError = ""; drawResolve(); });

// (3.0) Options you rarely need (which sound track, names, graphics card) are folded away. They open
// by themselves when one of them isn't on its usual choice, so nothing set is ever hidden.
let rtMoreTouched = false;
function rtMoreOpen(open) {
  $("rtMoreBox").hidden = !open;
  $("rtMore").setAttribute("aria-expanded", String(open));
  $("rtMore").firstElementChild.textContent = open ? "Fewer options" : "More options";
}
$("rtMore").addEventListener("click", () => { rtMoreTouched = true; rtMoreOpen($("rtMoreBox").hidden); });

function rtFits(item, tool) {
  return tool === "fix" ? item.video : item.audio;
}

$("rtGo").addEventListener("click", async () => {
  const item = rtItem();
  if (!item || rtBusy(item) || !rtFits(item, rtTool)) return;
  const folder = await whereToSave();
  if (!folder) return;
  rtError = "";
  Object.assign(item, { status: "queued", message: "Starting...", waitingFor: item.run + 1, tool: rtTool, progress: 0 });
  drawResolve();
  const pick = { id: item.id, ...(rtPart ? { start: rtPart.start.toFixed(2), end: rtPart.end.toFixed(2) } : {}) };
  const res = await api("/api/rt-convert", { items: [pick], folder, options: { ...rtOptions, tool: rtTool } })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) {
    delete item.waitingFor;
    item.status = "ready";
    rtError = res.error;
  }
  refresh();
});
$("rtStop").addEventListener("click", () => {
  const item = rtItem();
  if (item) api("/api/rt-cancel", { id: item.id }).then(refresh);
});

function rtTrim() {
  const item = rtItem();
  if (!item) return;
  rtVideo.pause();
  openTrim({
    key: "rt:" + item.id, request: { file: item.id },
    video: item.video, title: item.name, duration: item.seconds,
    start: rtPart ? rtPart.start : 0, end: rtPart ? rtPart.end : item.seconds, maxLength: 0,
    done: (part) => { rtPart = part || null; drawResolve(); },
  });
}

// ---------------------------------------------------------------- drawing the tab

function rtShow(view) {
  for (const [id, name] of [["rtPick", "pick"], ["rtSetup", "setup"], ["rtSubs", "subs"], ["rtDone", "done"]]) $(id).hidden = view !== name;
}

function drawResolve() {
  const item = rtItem();
  const has = !!(item || rtLocal);
  $("rtDrop").hidden = has;
  $("rtWork").hidden = !has;
  const waiting = rtServer.filter((f) => f.tool === "subtitles" && f.status === "done" && f.hasCues && !f.sent).length;
  $("resolveTabBadge").hidden = !waiting;
  $("resolveTabBadge").textContent = waiting || "";
  if (!has) {
    rtShow("");
    return;
  }

  // The video's name and what's in it
  const name = item ? item.name : rtLocal.name;
  $("rtFileName").textContent = name;
  $("rtFileName").title = name;
  let info;
  if (rtLocal && rtLocal.error) info = rtLocal.error;
  else if (!item) info = `Getting it ready for the tools... ${Math.floor(rtLocal.percent)}% (${sizeText(rtLocal.size)})`;
  else {
    const bits = [item.video ? `${item.width} × ${item.height}` : "Sound only"];
    if (item.fps) bits.push(`${Math.abs(item.fps - Math.round(item.fps)) < 0.01 ? Math.round(item.fps) : item.fps.toFixed(2)} fps`);
    if (item.audioTracks > 1) bits.push(`${item.audioTracks} sound tracks`);
    bits.push(clock(item.seconds, false), sizeText(item.bytes));
    info = bits.join(" · ") + (rtMixText ? " · " + rtMixText : "");
  }
  $("rtFileInfo").textContent = info;
  $("rtFileInfo").title = info;
  $("rtFileInfo").classList.toggle("error", !!(rtLocal && rtLocal.error));
  $("rtScreen").classList.toggle("no-video", !!item && !item.video);
  $("rtChange").disabled = rtBusy(item);
  $("rtClose").disabled = rtBusy(item);
  if (!$("rtWork").hidden) drawStrip();

  // A job finished: move on to checking the subtitles, or to the result.
  if (item && item.status === "done" && !item.waitingFor && rtSeenRun !== `${item.id}:${item.run}`) {
    rtSeenRun = `${item.id}:${item.run}`;
    rtTool = item.tool;
    if (item.tool === "subtitles" && item.hasCues) { rtView = "subs"; openSubs(); }
    else rtView = "done";
  }
  if (item && rtBusy(item)) { rtView = "setup"; rtTool = item.tool || rtTool; }
  rtShow(rtView);

  $("rtTools").querySelectorAll(".rt-tool").forEach((b) => {
    const ok = !item || rtFits(item, b.dataset.tool);
    b.disabled = !ok;
    b.title = ok ? "" : b.dataset.tool === "fix" ? "This has no video in it." : "This has no sound in it.";
  });

  if (rtView === "setup") drawSetup(item);
  if (rtView === "done") drawDone(item);
  if (rtView === "subs") $("rtSubsCount").textContent = subs.cues.length ? `${subs.cues.length} lines` : "";
  if (rtDrawnView !== rtView) {
    rtDrawnView = rtView;
    subs.current = -2;
    drawCaption();
    drawSubsMarks();
  }
}
let rtDrawnView = "";

function drawSetup(item) {
  $("rtSetupTitle").textContent = RT_NAMES[rtTool] || "";
  const rows = { rtFixRow: "fix", rtStyleRow: "subtitles", rtLangRow: "subtitles", rtModelRow: "subtitles", rtWordsRow: "subtitles", rtPerRow: "subtitles",
                 rtDeviceRow: rtNvidia ? "subtitles" : "none", rtLevelRow: "silence", rtPauseRow: "silence", rtCutAsRow: "silence",
                 rtMore: "subtitles" };
  for (const [id, tool] of Object.entries(rows)) $(id).hidden = rtTool !== tool;
  if (rtTool !== "subtitles") $("rtMoreBox").hidden = true;
  else if (!rtMoreTouched) rtMoreOpen(!!(rtOptions.words || "").trim() || (rtNvidia && rtOptions.device === "cpu"));
  else rtMoreOpen($("rtMore").getAttribute("aria-expanded") === "true");
  if ($("rtLang").value !== (rtOptions.language || "")) $("rtLang").value = rtOptions.language || "";
  // Which sound track to listen to, when there are several (OBS often puts your mic on its own).
  const tracks = item ? item.audioTracks || 0 : 0;
  $("rtTrackRow").hidden = rtTool !== "subtitles" || tracks < 2;
  const chips = $("rtTrackChips");
  if (chips.dataset.n !== String(tracks)) {
    chips.dataset.n = tracks;
    chips.innerHTML = "";
    const choices = [["auto", "Find my voice"], ["everyone", "Everyone, a color each"], ["all", tracks > 2 ? "All tracks mixed" : "Both mixed"]];
    for (let i = 0; i < tracks; i++) choices.push([String(i), `Track ${i + 1}`]);
    for (const [value, label] of choices) {
      const b = document.createElement("button");
      b.dataset.value = value;
      b.textContent = label;
      b.onclick = () => { rtOptions.track = value; drawResolve(); };
      chips.append(b);
    }
  }
  chips.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === rtOptions.track));
  $("rtOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.value === String(rtOptions[box.dataset.key] ?? ""))));

  const busy = rtBusy(item);
  // (3.0) While it works, the choices can't be changed (changing them did nothing until the next run).
  $("rtOptions").classList.toggle("locked", busy);
  $("rtOptions").inert = busy;
  const failed = item && item.status === "error" && !item.waitingFor && item.tool === rtTool && item.message !== "Stopped.";
  $("rtNote").classList.toggle("error", !!(rtError || failed));
  $("rtNote").textContent = rtError || (failed ? item.message : RT_NOTES[rtTool] ? RT_NOTES[rtTool](rtOptions) : "");
  $("rtNote").hidden = busy;

  // Only part of the video
  const part = $("rtPart");
  const key = busy || !item ? "none" : rtPart ? `${rtPart.start}-${rtPart.end}` : "all";
  if (part.dataset.key !== key) {
    part.dataset.key = key;
    part.innerHTML = "";
    if (key !== "none") {
      const edit = document.createElement("button");
      edit.className = "link";
      edit.textContent = rtPart ? `Only ${clock(rtPart.start)} to ${clock(rtPart.end)} (change)` : "Use only a part of the video";
      edit.onclick = rtTrim;
      part.append(edit);
      if (rtPart) {
        const all = document.createElement("button");
        all.className = "link";
        all.textContent = "Use all of it";
        all.onclick = () => { rtPart = null; drawResolve(); };
        part.append(all);
      }
    }
  }

  $("rtProgress").hidden = !busy;
  if (busy) {
    const bar = $("rtProgress").querySelector(".bar");
    bar.classList.toggle("indeterminate", !item.progress);
    bar.firstElementChild.style.width = item.progress ? item.progress + "%" : "";
    $("rtProgressText").textContent = item.message || "Working...";
    $("rtStop").hidden = !!item.cancel;
  }
  if (busy && item.tool === "subtitles" && item.status === "active") rtLiveStart(); else if (rtLiveTimer) rtLiveStop();
  $("rtGo").hidden = busy;
  $("rtGo").disabled = !item;
  $("rtGoText").textContent = !item ? "Getting it ready..." : { fix: "Fix it", subtitles: "Make subtitles", silence: "Cut the silence" }[rtTool] || "Start";
}

function drawDone(item) {
  if (!item) return;
  const timeline = item.outName && item.outName.endsWith(".fcpxml");
  $("rtDoneTitle").textContent = item.status === "done" ? (item.tool === "fix" ? "Ready for Resolve" : "The quiet parts are out") : "";
  $("rtDoneText").innerHTML = "";
  const text = document.createElement("span");
  if (item.tool === "fix") text.innerHTML = "Drag the file below into Resolve's <b>Media Pool</b>.";
  else if (timeline) text.innerHTML = "In Resolve, use <b>File › Import › Timeline</b> and pick the file below. Every cut can still be changed.";
  else text.innerHTML = "Drag the new video below into Resolve.";
  const how = document.createElement("div");
  how.className = "rt-small";
  how.textContent = (item.message || "").split(" · In Resolve")[0];
  $("rtDoneText").append(text, how);
  const file = $("rtDoneFile");
  file.textContent = item.outName || "";
  setDrag(file, item.canShow && !timeline ? { kind: "rt", id: item.id } : null);
  file.title = item.canShow && !timeline ? DRAG_HINT : "";
}
$("rtDoneShow").addEventListener("click", () => { if (rtId) api("/api/rt-show", { id: rtId }); });

// Called by app.js with the app's state a few times a second.
function renderResolve(list, projectPath) {
  const known = new Map(rtServer.map((f) => [f.id, f]));
  rtServer = (list || []).map((f) => {
    const mine = known.get(f.id);
    if (mine && mine.waitingFor > f.run) return { ...f, status: "queued", message: "Starting...", waitingFor: mine.waitingFor, progress: 0 };
    return f;
  });
  if (rtId && !rtItem() && !known.has(rtId)) rtId = "";
  if (rtId && !rtItem() && known.has(rtId)) rtServer.push(known.get(rtId)); // just added: not in the app's state yet
  if ((projectPath || "") !== rtProjectPath) {
    rtProjectPath = projectPath || "";
    loadProjects();
  }
  drawResolve();
}

// ---------------------------------------------------------------- project folders

async function loadProjects() {
  const res = await api("/api/project-list", {}).catch(() => null);
  if (!res || !res.ok) return;
  const on = !!res.project;
  rtProjectForm(false);
  $("rtProjectOn").hidden = !on;
  $("rtProjectNone").hidden = on;
  $("rtProjectNoneButtons").hidden = on;
  $("rtProjectSome").hidden = !on;
  $("rtProjectSomeButtons").hidden = !on;
  $("rtProject").classList.toggle("on", on);
  $("rtFolders").innerHTML = "";
  if (on) {
    $("rtProjectTitle").textContent = res.project.split(/[\\/]/).pop();
    $("rtProjectPath").textContent = res.project;
    $("rtProjectPath").title = res.project;
    for (const name of res.folders) {
      const chip = document.createElement("span");
      chip.textContent = name;
      $("rtFolders").append(chip);
    }
  }
  const others = res.projects.filter((p) => p.path !== res.project);
  $("rtRecent").innerHTML = "";
  if (others.length) {
    const label = document.createElement("span");
    label.className = "rt-recent-label";
    label.textContent = on ? "Switch to" : "Earlier projects";
    $("rtRecent").append(label);
    for (const p of others.slice(0, 5)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rt-recent-chip";
      b.textContent = p.name;
      b.title = p.path;
      b.onclick = () => api("/api/project-use", { path: p.path }).then(refresh);
      $("rtRecent").append(b);
    }
  }
}

function projectError(text) {
  $("rtProjectError").hidden = !text;
  $("rtProjectError").textContent = text || "";
}

// (3.0) The name box only shows after "New project folder", so the page stays calm.
function rtProjectForm(open) {
  $("rtProjectForm").hidden = !open;
  $("rtProject").classList.toggle("making", open);
  if (!open) projectError("");
  else $("rtProjectName").focus();
}

$("rtProjectMake").addEventListener("click", async () => {
  projectError("");
  const name = $("rtProjectName").value.trim();
  if (!name) return projectError("Give the project a name first.");
  const res = await api("/api/project-make", { name }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (res.cancelled) return;
  if (!res.ok) return projectError(res.error);
  $("rtProjectName").value = "";
  rtProjectForm(false);
  loadProjects();
  refresh();
});
$("rtProjectName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("rtProjectMake").click();
  if (e.key === "Escape") rtProjectForm(false);
});
$("rtProjectNew").addEventListener("click", () => rtProjectForm($("rtProjectForm").hidden));
$("rtProjectAnother").addEventListener("click", () => rtProjectForm($("rtProjectForm").hidden));
$("rtProjectCancel").addEventListener("click", () => rtProjectForm(false));
$("rtProjectOpen").addEventListener("click", () => api("/api/project-open", {}));
$("rtProjectOff").addEventListener("click", () => api("/api/project-use", { path: "" }).then(refresh));
loadProjects();

// ---------------------------------------------------------------- checking the subtitles

const subs = { cues: [], offset: 0, saveTimer: 0, current: -1, peaks: null };

async function openSubs() {
  const id = rtId;
  const res = await api("/api/rt-cues", { id }).catch(() => ({ ok: false }));
  if (!res.ok || id !== rtId) return;
  rtLiveStop();
  for (const c of res.cues) c.heard = c.text;
  Object.assign(subs, { cues: res.cues, offset: res.offset || 0, current: -1, edited: false });
  if (res.perScreen != null) rtOptions.perScreen = res.perScreen;
  drawPerScreen();
  $("subsSaved").textContent = res.sent ? "" : "";
  drawSubsList();
  drawLook();
  rtVideo.pause();
  seekSubs(subs.cues.length ? cueStart(subs.cues[0]) : 0);
  drawResolve();
}

// Times in the list are times in the video (a part of a video starts later than 0).
const cueStart = (c) => c.start + subs.offset;

// (3.0) Only the lines you can see are on the page (thousands of text boxes made it lag); the rest
// are drawn as you scroll.
let subsRowHeight = 108;
function drawSubsList() {
  const list = $("subsList");
  list.innerHTML = "";
  list.classList.add("virtual");
  const space = document.createElement("div");
  space.className = "subs-space";
  space.style.height = subs.cues.length * subsRowHeight + "px";
  list.append(space);
  subs.rows = new Map();
  drawSubsWindow();
  drawSubsMarks();
  subs.current = -2;
  drawCaption();
}

function drawSubsWindow() {
  const list = $("subsList");
  if (!subs.rows) return;
  const top = list.scrollTop, height = list.clientHeight || 600;
  const first = Math.max(0, Math.floor(top / subsRowHeight) - 4);
  const last = Math.min(subs.cues.length, Math.ceil((top + height) / subsRowHeight) + 4);
  for (const [i, row] of subs.rows) {
    if ((i < first || i >= last) && !row.contains(document.activeElement)) { row.remove(); subs.rows.delete(i); }
  }
  for (let i = first; i < last; i++) {
    if (subs.rows.has(i)) continue;
    const row = makeSubsRow(subs.cues[i], i);
    row.style.top = i * subsRowHeight + "px";
    list.append(row);
    subs.rows.set(i, row);
  }
  // The real height of a row (it depends on the font size), measured once.
  const one = subs.rows.values().next().value;
  if (one && Math.abs(one.offsetHeight + 6 - subsRowHeight) > 1) {
    subsRowHeight = one.offsetHeight + 6;
    list.querySelector(".subs-space").style.height = subs.cues.length * subsRowHeight + "px";
    for (const [i, row] of subs.rows) row.style.top = i * subsRowHeight + "px";
    drawSubsWindow();
  }
}
$("subsList").addEventListener("scroll", () => requestAnimationFrame(drawSubsWindow), { passive: true });
window.addEventListener("resize", () => { if (rtView === "subs") drawSubsWindow(); });

// Scrolls the list so line i shows (smoothly when it's close).
function showSubsRow(i) {
  const list = $("subsList");
  const top = i * subsRowHeight, height = list.clientHeight;
  if (top >= list.scrollTop && top + subsRowHeight <= list.scrollTop + height) return;
  const to = Math.max(0, top - height / 2 + subsRowHeight / 2);
  list.scrollTo({ top: to, behavior: Math.abs(to - list.scrollTop) < height * 3 ? "smooth" : "auto" });
}

function makeSubsRow(cue, i) {
  const row = document.createElement("div");
  row.className = "subs-row";
  row.dataset.i = i;
  row.classList.toggle("now", i === subs.current);
  row.innerHTML = `
    <div class="subs-row-top">
      <button type="button" class="subs-when" title="Play from here"></button>
      <span class="subs-who" hidden></span>
      <span class="spacer"></span>
      <button type="button" class="nudge" data-d="-0.1" title="Show it 0.1 second earlier">◀</button>
      <button type="button" class="nudge" data-d="0.1" title="Show it 0.1 second later">▶</button>
      <button type="button" class="nudge here" title="Start this line where the video is now">Start here</button>
      <button type="button" class="nudge del" title="Delete this line">✕</button>
    </div>
    <textarea rows="2" spellcheck="true"></textarea>`;
  redrawRow(row, cue);
  if (cue.who) {
    const who = row.querySelector(".subs-who");
    who.hidden = false;
    who.textContent = `Track ${cue.who + 1}`;
    who.title = "Someone else talking";
    who.style.setProperty("--c", `rgb(${RT_COLORS[rtOptions.friendColor].map((v) => Math.round(v * 255)).join(",")})`);
  }
  const text = row.querySelector("textarea");
  text.value = cue.text;
  text.addEventListener("input", () => { cue.text = text.value; subsChanged(); drawCaption(); });
  text.addEventListener("focus", () => { text.dataset.before = text.value; if (rtVideo.paused) seekSubs(cueStart(cue)); });
  text.addEventListener("change", () => offerFixAll(text.dataset.before || "", text.value, cue));
  row.querySelector(".subs-when").onclick = () => { seekSubs(cueStart(cue)); rtVideo.play().catch(() => {}); };
  row.querySelectorAll(".nudge[data-d]").forEach((b) => b.onclick = () => {
    const d = parseFloat(b.dataset.d);
    cue.start = Math.max(0, cue.start + d);
    cue.end = Math.max(cue.start + 0.2, cue.end + d);
    subsChanged(); redrawRow(row, cue); drawSubsMarks();
    seekSubs(cueStart(cue));
  });
  row.querySelector(".here").onclick = () => {
    const length = cue.end - cue.start;
    cue.start = Math.max(0, rtVideo.currentTime - subs.offset);
    cue.end = cue.start + length;
    subsChanged(); redrawRow(row, cue); drawSubsMarks();
  };
  row.querySelector(".del").onclick = () => {
    subs.cues.splice(subs.cues.indexOf(cue), 1);
    subsChanged(); drawSubsList(); drawResolve();
  };
  return row;
}

// (3.0) Fixed a word? The same mistake in other lines can be fixed in one go (and it's remembered).
function offerFixAll(before, after, cue) {
  const words = (t) => t.split(/\s+/).filter(Boolean);
  const a = words(before), b = words(after);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const trim = (w) => w.join(" ").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
  const old = trim(a.slice(i, a.length - j)), now = trim(b.slice(i, b.length - j));
  const box = $("subsFixAll");
  box.hidden = true;
  if (!old || !now || old === now || old.split(" ").length > 3 || now.split(" ").length > 3) return;
  const find = new RegExp(`(?<![\\p{L}\\p{N}'])${old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}'])`, "giu");
  const others = subs.cues.filter((c) => c !== cue && find.test(c.text) && ((find.lastIndex = 0), true));
  if (!others.length) return;
  box.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = `"${old}" is in ${others.length} more line${others.length > 1 ? "s" : ""}.`;
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "small-button";
  yes.textContent = `Change ${others.length > 1 ? "them all" : "it"} to "${now}"`;
  yes.onclick = () => {
    for (const c of others) c.text = c.text.replace(find, now);
    subsChanged();
    drawSubsList();
    box.textContent = `Changed ${others.length} more. Next time it writes "${now}" by itself.`;
    setTimeout(() => { box.hidden = true; }, 4000);
    api("/api/rt-learn", { pairs: [{ heard: old, text: now }], direct: true }).then((r) => { if (r && r.ok) rtLearned = r.learned; drawLearned(); }).catch(() => {});
  };
  const no = document.createElement("button");
  no.type = "button";
  no.className = "link";
  no.textContent = "No";
  no.onclick = () => { box.hidden = true; };
  box.append(text, yes, no);
  box.hidden = false;
}

function redrawRow(row, cue) {
  row.querySelector(".subs-when").textContent = `${subsClock(cueStart(cue))} – ${subsClock(cue.end + subs.offset)}`;
}

// (3.0) Words on screen, changed while checking: grouped again from what it heard (no listening again).
document.querySelectorAll("#rtSubsPer button").forEach((b) => b.addEventListener("click", async () => {
  if (b.classList.contains("active")) return;
  if (subs.edited && !confirm("Change how many words show at once? Your typed fixes will be undone.")) return;
  await saveSubsNow();
  const res = await api("/api/rt-regroup", { id: rtId, perScreen: b.dataset.value, style: rtOptions.style })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) { $("subsSaved").textContent = res.error; return; }
  rtOptions.perScreen = b.dataset.value;
  for (const c of res.cues) c.heard = c.text;
  subs.cues = res.cues;
  subs.edited = false;
  drawSubsList();
  drawPerScreen();
  drawResolve();
}));
function drawPerScreen() {
  document.querySelectorAll("#rtSubsPer button").forEach((b) => b.classList.toggle("active", b.dataset.value === String(rtOptions.perScreen || "0")));
}

document.querySelectorAll("#rtSubs .nudge[data-all]").forEach((b) => b.addEventListener("click", () => {
  const d = parseFloat(b.dataset.all);
  for (const cue of subs.cues) {
    cue.start = Math.max(0, cue.start + d);
    cue.end = Math.max(cue.start + 0.2, cue.end + d);
  }
  subsChanged();
  drawSubsList();
}));

function subsChanged() {
  subs.edited = true;
  $("subsSaved").textContent = "Saving...";
  clearTimeout(subs.saveTimer);
  subs.saveTimer = setTimeout(saveSubsNow, 600);
}

async function saveSubsNow() {
  if (!subs.saveTimer) return;
  clearTimeout(subs.saveTimer);
  subs.saveTimer = 0;
  const res = await api("/api/rt-cues-save", { id: rtId, cues: subs.cues }).catch(() => ({ ok: false, error: "Couldn't save." }));
  $("subsSaved").textContent = res.ok ? "Saved." : res.error;
}

async function rtSend(old) {
  await saveSubsNow();
  const look = { textStyle: rtOptions.textStyle, fadeOut: rtOptions.fadeOut, fadeLen: rtOptions.fadeLen, fadeGap: rtOptions.fadeGap,
    punct: rtOptions.punct, case: rtOptions.case, position: rtOptions.position, reveal: rtOptions.reveal,
    swears: rtOptions.swears, loud: rtOptions.loud, friendColor: rtOptions.friendColor, loudColor: rtOptions.loudColor,
    words: subs.cues.map((c) => [Math.round(c.start * 1000) / 1000, wordTimes(c)]) };
  const res = await api("/api/rt-send", { id: rtId, old, ...look }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  const note = $("subsSaved");
  if (!res.ok) { note.textContent = res.error; return; }
  // (3.0) What you fixed is remembered for next time.
  const pairs = subs.cues.filter((c) => c.heard != null && c.heard !== c.text).map((c) => ({ heard: c.heard, text: c.text }));
  if (pairs.length) {
    api("/api/rt-learn", { pairs }).then((r) => { if (r && r.ok) { rtLearned = r.learned; drawLearned(); } }).catch(() => {});
    for (const c of subs.cues) c.heard = c.text;
  }
  note.innerHTML = "";
  const text = document.createElement("span");
  text.innerHTML = "Done! In Resolve: <b>File › Import › Timeline</b>, and pick ";
  const name = document.createElement("b");
  name.textContent = `"${res.name}"`;
  const show = document.createElement("button");
  show.className = "link";
  show.textContent = "Show it";
  show.onclick = () => api("/api/rt-show", { id: rtId, timeline: true });
  note.append(text, name, ". ", show);
  if (old) {
    const tip = document.createElement("div");
    tip.innerHTML = "To get Text+ from it: right-click the subtitle track's name (ST1) › <b>Convert Subtitles to Text+</b>.";
    note.append(tip);
  }
  refresh();
}
$("subsSend").addEventListener("click", () => rtSend(false));
$("subsOld").addEventListener("click", () => rtSend(true));

function drawCaption() {
  const t = rtVideo.currentTime - subs.offset;
  const on = rtView === "subs" || subs.live;
  const i = on ? subs.cues.findIndex((c) => t >= c.start && t < c.end) : -1;
  drawCaptionAt(i >= 0 ? subs.cues[i] : null, i >= 0 ? subs.cues[i + 1] : null, t);
  if (i !== subs.current) {
    rtLane.current = i;
    drawLane();
    subs.current = i;
    $("subsList").querySelectorAll(".subs-row").forEach((r) => r.classList.toggle("now", +r.dataset.i === i));
    if (i >= 0 && rtView === "subs" && !rtVideo.paused) showSubsRow(i);
  }
}

// (3.0) The lines on the timeline: one slim lane under the sound, drawn on a canvas (thousands of
// lines used to cover the whole timeline). The line playing now is lit.
const rtLane = { current: -1 };
function drawSubsMarks() { drawLane(); }
function drawLane() {
  const box = $("rtMarks");
  const length = rtLength();
  const on = !!length && (rtView === "subs" || subs.live) && subs.cues.length > 0;
  $("rtWave").classList.toggle("has-lane", on);
  let canvas = box.querySelector("canvas");
  if (!on) { if (canvas) canvas.remove(); return; }
  if (!canvas) { canvas = document.createElement("canvas"); box.append(canvas); }
  const dpr = window.devicePixelRatio || 1;
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue("--text").trim() || "#fff";
  const accent = css.getPropertyValue("--accent").trim() || "#ffd23c";
  const top = 2, height = h - 4;
  const [from, to] = tlRange();
  const scale = w / (to - from);
  const bar = (cue, color) => {
    const x = (cueStart(cue) - from) * scale;
    const width = Math.max(1, (cue.end - cue.start) * scale - ((cue.end - cue.start) * scale > 3 ? 1 : 0));
    if (x > w || x + width < 0) return;
    g.fillStyle = color;
    g.beginPath();
    if (g.roundRect && width > 4) g.roundRect(x, top, width, height, 2); else g.rect(x, top, width, height);
    g.fill();
  };
  g.globalAlpha = 0.28;
  for (const cue of subs.cues) bar(cue, text);
  g.globalAlpha = 1;
  const now = subs.cues[rtLane.current];
  if (now) bar(now, accent);
}
window.addEventListener("resize", () => drawLane());

drawResolve();

// Leaving the Resolve page stops the preview (it kept playing out of sight).
function resolveTabChanged(tab) {
  if (tab === "resolve") return;
  if (!rtVideo.paused) rtVideo.pause();
  for (const t of rtTracks) t.audio.pause();
}

// ---------------------------------------------------------------- (3.0) how the subtitles look in Resolve
// Your own Text+ (made and animated in Resolve, exported as a .drt) as a text style, and a fade out.

let rtStyles = [];
async function loadStyles() {
  const res = await api("/api/rt-styles", {}).catch(() => null);
  if (res && res.ok) { rtStyles = res.styles; drawLook(); }
}

function drawLook() {
  if (rtOptions.textStyle && !rtStyles.some((s) => s.id === rtOptions.textStyle)) rtOptions.textStyle = "";
  const box = $("rtStyles");
  box.innerHTML = "";
  const chip = (id, name, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.title = title || "";
    b.classList.toggle("active", rtOptions.textStyle === id);
    b.onclick = () => { rtOptions.textStyle = id; drawLook(); drawCaptionLook(); };
    return b;
  };
  box.append(chip("", "VaultHub", "White letters with a black outline, low on the screen"));
  for (const s of rtStyles) {
    const b = chip(s.id, s.name, `${s.font} ${s.face}${s.animated ? ", with its animation" : ""}. Right-click to remove it.`);
    if (s.animated) b.insertAdjacentHTML("beforeend", ' <span class="rt-anim" aria-label="animated">✦</span>');
    b.oncontextmenu = async (e) => {
      e.preventDefault();
      if (!confirm(`Remove the text style "${s.name}"?`)) return;
      const res = await api("/api/rt-style-remove", { id: s.id }).catch(() => null);
      if (res && res.ok) { rtStyles = res.styles; drawLook(); drawCaptionLook(); }
    };
    box.append(b);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "rt-style-add";
  add.textContent = "+ Add from Resolve";
  add.onclick = () => { $("rtStyleHelp").hidden = false; $("rtStyleFile").click(); };
  box.append(add);
  document.querySelectorAll("#rtLook .chips[data-look] button").forEach((b) =>
    b.classList.toggle("active", b.dataset.value === String(rtOptions[b.parentElement.dataset.look])));
  $("rtFadeLenRow").hidden = rtOptions.fadeOut === "off";
  $("rtLoudColors").hidden = rtOptions.loud !== "pop";
  $("rtFriendRow").hidden = !subs.cues.some((c) => c.who);
  $("rtFadeGapRow").hidden = rtOptions.fadeOut !== "pause";
}

document.querySelectorAll("#rtLook .chips[data-look] button").forEach((b) => b.addEventListener("click", () => {
  rtOptions[b.parentElement.dataset.look] = b.dataset.value;
  drawLook();
  drawCaptionLook();
}));

$("rtStyleFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const res = await fetch("/api/rt-style-add", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file })
    .then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) { $("subsSaved").textContent = res.error; return; }
  rtStyles = res.styles;
  if (res.added.length) rtOptions.textStyle = res.added[0].id;
  $("rtStyleHelp").hidden = true;
  $("subsSaved").textContent = res.added.length > 1 ? `Added ${res.added.length} text styles.` : `Added "${res.added[0].name}".`;
  drawLook();
  drawCaptionLook();
});

// (3.0) The preview over the video looks like it will in Resolve: your text style's font, size, outline,
// place and animation, the fade out, and the letters as they'll be written.
const RT_DEFAULT_LOOK = { font: "Open Sans", face: "Bold", size: 0.06, center: [0.5, 0.12], color: [1, 1, 1], outline: 0.08,
  outlineColor: [0, 0, 0], shadow: false, tracking: 1, animated: {} };
const RT_PLACES = { bottom: 0.14, middle: 0.5, top: 0.86 };
let rtLookData = RT_DEFAULT_LOOK;
let rtLookFor = null;

async function drawCaptionLook() {
  const id = rtOptions.textStyle || "";
  const s = rtStyles.find((x) => x.id === id);
  if (rtLookFor !== id) {
    rtLookFor = id;
    rtLookData = RT_DEFAULT_LOOK;
    if (s) {
      const res = await api("/api/rt-style-preview", { id }).catch(() => null);
      if (rtLookFor !== id) return;
      if (res && res.ok && res.look) rtLookData = res.look;
    }
  }
  const look = rtLookData;
  const cap = $("rtCaption");
  cap.classList.add("own");
  cap.style.fontFamily = `"${look.font}", "Open Sans", var(--head)`;
  const weights = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900, heavy: 900 };
  cap.style.fontWeight = weights[(look.face || "").toLowerCase().replace(/[\s-]/g, "")] || 700;
  const rgb = (c) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")})`;
  cap.style.color = rgb(look.color || [1, 1, 1]);
  cap.style.setProperty("--cap-outline", rgb(look.outlineColor || [0, 0, 0]));
  cap.style.textShadow = look.shadow ? "0 0.06em 0.12em rgba(0,0,0,.65)" : "none";
  cap.style.letterSpacing = look.tracking && look.tracking !== 1 ? `${(look.tracking - 1) * 0.5}em` : "";
  drawPlaceChips();
  drawCaption();
}

// A Fusion keyframe curve at time t (seconds): [[t, value, leftHandle, rightHandle]].
function splineAt(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let k = 0;
  while (k < keys.length - 2 && t > keys[k + 1][0]) k++;
  const [t0, v0, , r0] = keys[k], [t1, v1, l1] = keys[k + 1];
  const p1 = r0 || [t0 + (t1 - t0) / 3, v0], p2 = l1 || [t1 - (t1 - t0) / 3, v1];
  const at = (u, a, b, c, d) => { const m = 1 - u; return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d; };
  let lo = 0, hi = 1;
  for (let n = 0; n < 24; n++) { const mid = (lo + hi) / 2; if (at(mid, t0, p1[0], p2[0], t1) < t) lo = mid; else hi = mid; }
  return at((lo + hi) / 2, v0, p1[1], p2[1], v1);
}

// Same rules as the app uses for Resolve (subtitles.dress).
const RT_COLORS = { white: [1, 1, 1], yellow: [1, 0.84, 0.1], blue: [0.45, 0.8, 1], green: [0.45, 0.95, 0.45], pink: [1, 0.5, 0.82],
  orange: [1, 0.56, 0.15], red: [1, 0.32, 0.3] };
const RT_LOUD_SIZE = 1.45;
// Swear words written as F*** (same list as the app: subtitles.SWEARS)
const RT_SWEARS = /\b(?:(?:mother)?fuck\w*|f+u+c+k+\w*|shit\w*|bullshit\w*|bitch\w*|cunt\w*|dick(?:head)?s?|cock(?:s|sucker\w*)?|pussy|pussies|bastards?|asshole\w*|whore\w*|slut\w*|wank\w*|twats?|nigg\w*|fag\w*|retard\w*)\b/gi;
function dressText(text) {
  text = text.replace(/\*/g, "");
  if (rtOptions.swears === "bleep") text = text.replace(RT_SWEARS, (w) => w[0] + "\u2217".repeat(Math.min(3, w.length - 1)));
  if (rtOptions.punct === "remove") {
    text = text.replace(/(\d)[.,](?=\d)/g, "$1․").replace(/(\w)['’](?=\w)/g, "$1ʼ")
      .replace(/[^\p{L}\p{N}_\s․ʼ]/gu, " ").replace(/․/g, ".").replace(/ʼ/g, "'")
      .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  }
  if (rtOptions.case === "upper") text = text.toUpperCase();
  else if (rtOptions.case === "lower") text = text.toLowerCase();
  return text.replace(/\u2217/g, "*");
}

// (3.0) When each word of a line is said (seconds from the line's start), for lines that build up
// word by word. Same rules as the app uses for Resolve (subtitles.word_offsets).
function wordTimes(cue) {
  const words = cue.text.replace(/\*/g, "").split(/\s+/).filter(Boolean);
  if (Array.isArray(cue.words) && cue.words.length === words.length) return cue.words;
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  const span = Math.max(0, cue.end - cue.start - 0.3);
  let before = 0;
  return words.map((w) => { const at = Math.round((span * before / total) * 1000) / 1000; before += w.length + 1; return at; });
}

function drawCaptionAt(cue, next, t) {
  const cap = $("rtCaption");
  let since = cue ? t - cue.start : 0;
  const plain = cue ? cue.text.replace(/\*/g, "") : "";
  let shown = plain;
  if (cue && rtOptions.reveal === "word") {
    // only the words said so far; the animation starts again with each new word
    const times = wordTimes(cue);
    const ends = [...plain.matchAll(/\S+/g)].map((m) => m.index + m[0].length);
    let k = 0;
    while (k + 1 < times.length && times[k + 1] <= since) k++;
    const began = times[k];
    while (k + 1 < times.length && times[k + 1] - times[k] < 0.09) k++;
    shown = plain.slice(0, ends[k]);
    since -= began;
  }
  const text = cue ? dressText(shown) : "";
  if (cap.textContent !== text) cap.textContent = text;
  if (!cue) return;
  const look = rtLookData;
  const width = $("rtScreen").clientWidth || 640;
  const size = splineAt(look.animated && look.animated.Size, since) ?? look.size;
  // (3.0) a loud word pops bigger, in its color; others talking have their own color
  const loud = rtOptions.loud === "pop" && cue.text.startsWith("*");
  const px = Math.max(1, size * width * 0.7 * (loud ? RT_LOUD_SIZE : 1));
  const color = loud ? RT_COLORS[rtOptions.loudColor] : cue.who ? RT_COLORS[rtOptions.friendColor] : look.color;
  cap.style.color = `rgb(${(color || [1, 1, 1]).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")})`;
  cap.style.fontSize = px.toFixed(2) + "px";
  cap.style.setProperty("--cap-stroke", ((look.outline || 0) * px * 0.7).toFixed(2) + "px");
  const own = !!rtOptions.textStyle;
  const y = rtOptions.position === "style" && own ? look.center[1] : RT_PLACES[rtOptions.position] ?? (own ? RT_PLACES.bottom : look.center[1]);
  cap.style.top = ((1 - y) * 100).toFixed(2) + "%";
  // the fade out, eased at both ends like the one in Resolve
  let alpha = 1;
  const fades = rtOptions.fadeOut === "all" || (rtOptions.fadeOut === "pause" && (!next || next.start - cue.end >= +rtOptions.fadeGap));
  if (fades) {
    const length = Math.min(+rtOptions.fadeLen, (cue.end - cue.start) / 2);
    const left = cue.end - t;
    if (left < length) { const x = 1 - left / length; alpha = 1 - x * x * (3 - 2 * x); }
  }
  cap.style.opacity = alpha.toFixed(3);
}

function drawPlaceChips() {
  const own = !!rtOptions.textStyle;
  const chip = document.querySelector('#rtLook .chips[data-look="position"] button[data-value="style"]');
  if (chip) chip.hidden = !own;
  if (!own && rtOptions.position === "style") rtOptions.position = "bottom";
  document.querySelectorAll('#rtLook .chips[data-look="position"] button').forEach((b) =>
    b.classList.toggle("active", b.dataset.value === rtOptions.position));
}
loadStyles().then(drawCaptionLook);

// ---------------------------------------------------------------- (3.0) lines while it listens
// The lines it has heard so far show on the video and the timeline, so you can start watching
// before it's done. (The final lines, timed to your voice, replace them at the end.)
function rtLiveStart() {
  if (rtLiveTimer) return;
  rtLiveTimer = setInterval(rtLivePoll, 2000);
  rtLivePoll();
}
function rtLiveStop() {
  clearInterval(rtLiveTimer);
  rtLiveTimer = 0;
  $("rtLiveNote").hidden = true;
  if (!subs.live) return;
  subs.live = false;
  if (rtView !== "subs") subs.cues = [];
  drawLane();
  drawCaption();
}
async function rtLivePoll() {
  const id = rtId;
  const res = await api("/api/rt-sofar", { id }).catch(() => null);
  if (!rtLiveTimer || id !== rtId || !res || !res.ok || rtView === "subs") return;
  if (!res.cues.length) return;
  subs.live = true;
  subs.cues = res.cues;
  subs.offset = res.offset || 0;
  $("rtLiveNote").textContent = `${res.cues.length} line${res.cues.length > 1 ? "s" : ""} so far. Press play to watch them while it works.`;
  $("rtLiveNote").hidden = false;
  drawLane();
  drawCaption();
}

// ---------------------------------------------------------------- (3.0) remembered fixes
function drawLearned() {
  const row = $("rtLearnedRow");
  if (!row) return;
  row.hidden = !rtLearned;
  $("rtLearnedText").textContent = `It remembers ${rtLearned} word${rtLearned === 1 ? "" : "s"} you fixed, and writes ${rtLearned === 1 ? "it" : "them"} your way.`;
}
$("rtForget").addEventListener("click", async () => {
  if (!confirm("Forget the words you fixed? It will write them the way it hears them again.")) return;
  const res = await api("/api/rt-forget", {}).catch(() => null);
  if (res && res.ok) { rtLearned = 0; drawLearned(); }
});
