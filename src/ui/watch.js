// Watch a YouTube video right here in the app, in a dark full-window "theater", instead of in the browser.
// openWatch(url, {title, sub, convert}) plays it full-window with our own controls (YouTube's are off). If the video isn't a YouTube video, or its
// owner turned off playing it on other sites, it offers to open it on YouTube instead.
// Uses api() and $() from app.js and appPlayers from volume.js.

const WATCH_ERRORS = {
  2: "That video link doesn't look right.",
  5: "This video can't play inside VaultHub.",
  100: "This video was removed or made private.",
  101: "The owner of this video only lets it play on YouTube.",
  150: "The owner of this video only lets it play on YouTube.",
  152: "This video can't play inside VaultHub.",
  153: "This video can't play inside VaultHub.",
};

// The 11 letter id of a YouTube video, or null.
function youtubeId(url) {
  const m = String(url || "").match(/^(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

let watchUrl = "";
let watchConvert = null;
// What the player told us last (it sends this a few times a second while we listen).
const watchState = { time: 0, at: 0, dur: 0, state: -1, rate: 1, vol: 100, muted: false, loaded: 0, cc: false, heard: false, maxH: 0 };
const WATCH_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Video quality. YouTube no longer lets apps pick it directly (setPlaybackQuality does nothing),
// but it picks the quality from how big the player is. So the player is laid out at the size of
// the picked quality and then scaled to fit the screen: big for 4K, small for 480p.
const WATCH_QUALITIES = [
  { h: 0, label: "Auto", note: "fits the window" },
  { h: 2160, label: "4K", note: "2160p" }, { h: 1440, label: "1440p" }, { h: 1080, label: "1080p", note: "HD" },
  { h: 720, label: "720p" }, { h: 480, label: "480p", note: "saves data" }, { h: 360, label: "360p" },
];
let watchQuality = 0;
// (3.0) The best quality this video really has (from YouTube, once it plays): picks above it use this.
const WATCH_LEVELS = { highres: 4320, hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720, large: 480, medium: 360, small: 240, tiny: 144 };
function watchQualityNow() {
  const top = watchState.maxH;
  if (!watchQuality || !top || watchQuality <= top) return watchQuality;
  const fit = WATCH_QUALITIES.find((q) => q.h && q.h <= top);
  return fit ? fit.h : 0;
}
try { watchQuality = Number(localStorage.getItem("watchQuality")) || 0; } catch {}
if (!WATCH_QUALITIES.some((q) => q.h === watchQuality)) watchQuality = 0;
let watchHello = 0, watchIdle = 0, watchTick = 0, watchDragAt = null;

function openWatch(url, info = {}) {
  const id = youtubeId(url);
  if (!id) return api("/api/games-open", { url }); // not YouTube: the browser it is
  watchUrl = "https://www.youtube.com/watch?v=" + id;
  watchConvert = info.convert === false ? null : (info.convert || (() => homeConvert(watchUrl, false)));
  // Stop the app's own sounds so they don't play over the video.
  for (const [audio, stop] of appPlayers) if (!audio.paused) stop();
  if (typeof playerAudio !== "undefined" && playerAudio && !playerAudio.paused) playerAudio.pause();

  $("watchTitle").textContent = $("watchTitle").title = info.title || "YouTube video";
  $("watchSub").textContent = info.sub || "";
  $("watchConvert").hidden = !watchConvert;
  $("watchError").hidden = true;
  Object.assign(watchState, { time: 0, at: 0, dur: 0, state: -1, rate: 1, loaded: 0, cc: false, heard: false, maxH: 0 });
  $("watchVideo").classList.remove("playing", "ended", "idle");
  watchCloseMenus();
  const frame = document.createElement("iframe");
  frame.id = "watchFrame";
  frame.allow = "autoplay; encrypted-media; picture-in-picture";
  frame.referrerPolicy = "strict-origin";
  frame.title = info.title || "YouTube video";
  frame.tabIndex = -1;
  // controls=0: YouTube's own buttons, title and share bar stay hidden; ours are drawn on top.
  frame.src = `https://www.youtube.com/embed/${id}?autoplay=1&controls=0&disablekb=1&fs=0&rel=0&iv_load_policy=3&modestbranding=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  // Ask the player to tell us about its time, state and errors. It only answers once it's ready,
  // so keep asking until it does.
  const hello = () => { try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "vh-watch", channel: "widget" }), "*"); } catch {} };
  frame.addEventListener("load", () => {
    hello();
    clearInterval(watchHello);
    let tries = 0;
    watchHello = setInterval(() => { if (watchState.heard || ++tries > 40) clearInterval(watchHello); else hello(); }, 250);
  });
  $("watchScreen").replaceChildren(frame);
  watchFit();
  watchDraw();
  $("watchModal").hidden = false;
  watchWake();
  cancelAnimationFrame(watchTick);
  watchTick = requestAnimationFrame(watchLoop);
  $("watchModal").focus();
}

function closeWatch() {
  if ($("watchModal").hidden) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("watchModal").hidden = true;
  clearInterval(watchHello);
  clearTimeout(watchIdle);
  cancelAnimationFrame(watchTick);
  $("watchScreen").replaceChildren(); // removing the player stops the sound
}

function watchFailed(code) {
  $("watchScreen").replaceChildren();
  $("watchErrorText").textContent = WATCH_ERRORS[code] || "This video can't play inside VaultHub.";
  $("watchError").hidden = false;
  $("watchBig").hidden = true;
}

function watchCommand(func, args = []) {
  const frame = $("watchFrame");
  try { if (frame) frame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args, id: "vh-watch", channel: "widget" }), "*"); } catch {}
}

// ---- what's on screen

function watchClock(t) {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
// Where the video is now: the last time the player told us, plus how long it's been playing since.
function watchNow() {
  if (watchDragAt !== null) return watchDragAt;
  const t = watchState.state === 1 ? watchState.time + (performance.now() - watchState.at) / 1000 * watchState.rate : watchState.time;
  return watchState.dur ? Math.min(t, watchState.dur) : t;
}
function watchDraw() {
  const v = $("watchVideo"), now = watchNow(), pct = watchState.dur ? now / watchState.dur * 100 : 0;
  $("watchPos").style.width = pct + "%";
  $("watchDot").style.left = pct + "%";
  $("watchBuf").style.width = (watchState.loaded * 100) + "%";
  $("watchTime").textContent = `${watchClock(now)} / ${watchClock(watchState.dur)}`;
  v.classList.toggle("playing", watchState.state === 1 || watchState.state === 3);
  v.classList.toggle("ended", watchState.state === 0);
  v.classList.toggle("muted", watchState.muted || watchState.vol === 0);
  $("watchVolFill").style.width = (watchState.muted ? 0 : watchState.vol) + "%";
  $("watchSpeedBtn").textContent = watchState.rate === 1 ? "1x" : watchState.rate + "x";
  $("watchQualityBtn").textContent = WATCH_QUALITIES.find((q) => q.h === watchQualityNow()).label;
  $("watchCc").classList.toggle("on", watchState.cc);
  // The big button: paused (after it started) or at the end. At the end it covers YouTube's
  // "more videos" screen.
  const big = $("watchBig");
  big.hidden = !$("watchError").hidden || !(watchState.state === 2 || watchState.state === 0);
  big.classList.toggle("again", watchState.state === 0);
}
function watchLoop() {
  if ($("watchModal").hidden) return;
  watchDraw();
  watchTick = requestAnimationFrame(watchLoop);
}

// The controls hide while the video plays and the mouse sits still.
function watchWake() {
  const v = $("watchVideo");
  v.classList.remove("idle");
  clearTimeout(watchIdle);
  watchIdle = setTimeout(() => {
    if (watchState.state === 1 && !watchMenuOpen() && watchDragAt === null) v.classList.add("idle");
  }, 2500);
}

window.addEventListener("message", (e) => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin) || $("watchModal").hidden) return;
  let data;
  try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!data || !data.event) return;
  watchState.heard = true;
  if (data.event === "onError") return watchFailed(Number(data.info));
  if (data.event === "onStateChange") { watchState.time = watchNow(); watchState.at = performance.now(); watchState.state = Number(data.info); watchWake(); return; }
  const i = data.info;
  if ((data.event === "infoDelivery" || data.event === "initialDelivery") && i) {
    if (typeof i.playerState === "number") { watchState.state = i.playerState; }
    if (typeof i.currentTime === "number") { watchState.time = i.currentTime; watchState.at = performance.now(); }
    if (typeof i.duration === "number" && i.duration > 0) watchState.dur = i.duration;
    if (typeof i.videoLoadedFraction === "number") watchState.loaded = i.videoLoadedFraction;
    if (typeof i.volume === "number") watchState.vol = i.volume;
    if (typeof i.muted === "boolean") watchState.muted = i.muted;
    if (typeof i.playbackRate === "number") watchState.rate = i.playbackRate;
    if (Array.isArray(i.availableQualityLevels) && i.availableQualityLevels.length) {
      const top = Math.max(0, ...i.availableQualityLevels.map((l) => WATCH_LEVELS[l] || 0));
      if (top && top !== watchState.maxH) { watchState.maxH = top; watchFit(); watchDraw(); }
    }
  }
});

// ---- the controls

function watchToggle() {
  if (watchState.state === 0) { watchSeekTo(0); watchCommand("playVideo"); return; }
  if (watchState.state === 1 || watchState.state === 3) { watchState.time = watchNow(); watchState.state = 2; watchCommand("pauseVideo"); }
  else { watchState.at = performance.now(); watchState.state = 1; watchCommand("playVideo"); }
  watchWake();
}
function watchSeekTo(t) {
  t = Math.max(0, watchState.dur ? Math.min(t, watchState.dur - 0.5) : t);
  watchState.time = t; watchState.at = performance.now();
  if (watchState.state === 0) watchState.state = 2;
  watchCommand("seekTo", [t, true]);
  watchWake();
}
function watchSetVolume(v) {
  watchState.vol = Math.round(Math.max(0, Math.min(100, v)));
  watchCommand("setVolume", [watchState.vol]);
  if (watchState.muted && watchState.vol > 0) { watchState.muted = false; watchCommand("unMute"); }
  watchWake();
}
function watchMute() {
  watchState.muted = !watchState.muted;
  if (!watchState.muted && watchState.vol === 0) watchSetVolume(50);
  watchCommand(watchState.muted ? "mute" : "unMute");
  watchWake();
}
function watchCaptions() {
  watchState.cc = !watchState.cc;
  if (watchState.cc) { watchCommand("loadModule", ["captions"]); watchCommand("setOption", ["captions", "reload", true]); }
  else watchCommand("unloadModule", ["captions"]);
  watchWake();
}
function watchFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $("watchVideo").requestFullscreen().catch(() => {});
}
function watchMenuOpen() { return !$("watchSpeedMenu").hidden || !$("watchQualityMenu").hidden; }
function watchCloseMenus() {
  for (const k of ["Speed", "Quality"]) { $(`watch${k}Menu`).hidden = true; $(`watch${k}Btn`).classList.remove("open"); }
}
// Opens one of the little menus above the controls: a heading, the choices, and maybe a note.
function watchMenu(kind, title, items, note) {
  const menu = $(`watch${kind}Menu`), open = menu.hidden;
  watchCloseMenus();
  if (!open) return watchWake();
  menu.hidden = false;
  $(`watch${kind}Btn`).classList.add("open");
  const h = document.createElement("h6");
  h.textContent = title;
  const rows = items.map((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = it.cur ? "cur" : "";
    const label = document.createElement("span");
    label.textContent = it.label + " ";
    if (it.note) { const n = document.createElement("small"); n.textContent = it.note; label.append(n); }
    b.append(label);
    if (it.cur) { const c = document.createElement("span"); c.textContent = "✓"; b.append(c); }
    b.onclick = () => { it.pick(); watchCloseMenus(); watchWake(); };
    return b;
  });
  menu.replaceChildren(h, ...rows);
  if (note) { const p = document.createElement("p"); p.textContent = note; menu.append(p); }
  $("watchVideo").classList.remove("idle");
}
function watchSpeedMenu() {
  watchMenu("Speed", "Speed", WATCH_SPEEDS.map((r) => ({
    label: r === 1 ? "Normal" : r + "x", cur: r === watchState.rate,
    pick: () => { watchState.time = watchNow(); watchState.at = performance.now(); watchState.rate = r; watchCommand("setPlaybackRate", [r]); },
  })));
}
function watchQualityMenu() {
  const now = watchQualityNow(), top = watchState.maxH;
  watchMenu("Quality", "Quality", WATCH_QUALITIES.filter((q) => !q.h || !top || q.h <= top).map((q) => ({
    label: q.label, note: q.note, cur: q.h === now,
    pick: () => { watchQuality = q.h; try { localStorage.setItem("watchQuality", String(q.h)); } catch {} watchFit(); watchDraw(); },
  })), "YouTube can still go lower for a moment if your internet is slow, or if the video isn't made in that quality.");
}

// Lay the player out at the picked quality's size and scale it to fill the screen (see WATCH_QUALITIES).
function watchFit() {
  const frame = $("watchFrame");
  if (!frame) return;
  const quality = watchQualityNow();
  if (!quality) {
    frame.classList.remove("sized");
    frame.style.width = frame.style.height = frame.style.transform = "";
    return;
  }
  const dpr = window.devicePixelRatio || 1, w = quality * 16 / 9 / dpr, h = quality / dpr;
  const box = $("watchScreen").getBoundingClientRect();
  if (!box.width || !box.height) return;
  const scale = Math.min(box.width / w, box.height / h);
  const x = (box.width - w * scale) / 2, y = (box.height - h * scale) / 2;
  frame.classList.add("sized");
  frame.style.width = w + "px";
  frame.style.height = h + "px";
  frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
if (window.ResizeObserver) new ResizeObserver(() => watchFit()).observe($("watchScreen"));

// Dragging on the progress bar and the volume bar.
function watchBarDrag(bar, onMove, onEnd) {
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const at = (ev) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    onMove(at(e));
    const move = (ev) => onMove(at(ev));
    const up = (ev) => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up); onEnd && onEnd(at(ev)); };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  });
}
watchBarDrag($("watchSeek"), (f) => { watchDragAt = f * watchState.dur; $("watchSeek").classList.add("drag"); watchWake(); },
  (f) => { watchDragAt = null; $("watchSeek").classList.remove("drag"); watchSeekTo(f * watchState.dur); });
watchBarDrag($("watchVol"), (f) => watchSetVolume(f * 100));
// Hovering the progress bar shows the time there.
$("watchSeek").addEventListener("pointermove", (e) => {
  const r = $("watchSeek").getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const tip = $("watchTip");
  tip.hidden = !watchState.dur;
  tip.style.left = (f * 100) + "%";
  tip.textContent = watchClock(f * watchState.dur);
});
$("watchSeek").addEventListener("pointerleave", () => { $("watchTip").hidden = true; });

$("watchHit").addEventListener("click", () => { if (watchMenuOpen()) { watchCloseMenus(); return watchWake(); } watchToggle(); });
$("watchHit").addEventListener("dblclick", watchFull);
$("watchVideo").addEventListener("pointermove", watchWake);
$("watchVideo").addEventListener("wheel", (e) => { if (e.target.closest(".watch-vol, #watchMute")) { e.preventDefault(); watchSetVolume(watchState.vol - Math.sign(e.deltaY) * 5); } }, { passive: false });
$("watchPlay").addEventListener("click", watchToggle);
$("watchBack10").addEventListener("click", () => watchSeekTo(watchNow() - 10));
$("watchFwd10").addEventListener("click", () => watchSeekTo(watchNow() + 10));
$("watchMute").addEventListener("click", watchMute);
$("watchCc").addEventListener("click", watchCaptions);
$("watchFull").addEventListener("click", watchFull);
$("watchSpeedBtn").addEventListener("click", (e) => { e.stopPropagation(); watchSpeedMenu(); });
$("watchQualityBtn").addEventListener("click", (e) => { e.stopPropagation(); watchQualityMenu(); });
document.addEventListener("pointerdown", (e) => { if (watchMenuOpen() && !e.target.closest(".watch-speed-wrap")) watchCloseMenus(); });

$("watchClose").addEventListener("click", closeWatch);
document.addEventListener("keydown", (e) => {
  if ($("watchModal").hidden) return;
  if (e.key === "Escape") {
    e.stopPropagation();
    if (watchMenuOpen()) watchCloseMenus();
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else closeWatch();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey || e.target.closest("input, textarea, [contenteditable]")) return;
  const k = e.key.toLowerCase();
  const keys = {
    " ": watchToggle, k: watchToggle, arrowleft: () => watchSeekTo(watchNow() - 10), arrowright: () => watchSeekTo(watchNow() + 10),
    j: () => watchSeekTo(watchNow() - 10), l: () => watchSeekTo(watchNow() + 10),
    arrowup: () => watchSetVolume(watchState.vol + 5), arrowdown: () => watchSetVolume(watchState.vol - 5),
    m: watchMute, f: watchFull, c: watchCaptions, q: watchQualityMenu,
  };
  if (!keys[k]) return;
  // Space and Enter on a focused button press that button instead.
  if (k === " " && e.target.closest("button")) return;
  e.preventDefault();
  e.stopPropagation();
  keys[k]();
}, true);
for (const id of ["watchOpen", "watchErrorOpen"]) {
  $(id).addEventListener("click", () => { api("/api/open-youtube", { url: watchUrl }); closeWatch(); });
}
$("watchConvert").addEventListener("click", () => { const go = watchConvert; closeWatch(); if (go) go(); });
