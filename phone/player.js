// The Library player: the floating mini player, the full "Now playing" screen with the sound's waveform
// (tap or drag on it to skip around), next/previous, repeat and shuffle, and the lock-screen controls.
// Loaded before app.js, so it only uses app.js things (S, $, esc, rpcMe...) inside functions.
"use strict";

const PL = {
  open: false,          // the full player is showing
  queue: [],            // ids of the sounds in the list you played from, in order
  repeat: "off",        // off | all | one
  shuffle: false,
  peaks: {},            // sound id -> [72 numbers 0..1], or "busy" while it's being worked out
  drag: null,           // 0..1 while your finger is on the waveform
};
const PL_BARS = 72;     // same as the PC app, so the shared waveform fits both

const PI = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.4v14H6zM20 5v14L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M15.6 5H18v14h-2.4zM4 5v14l10.5-7z"/></svg>',
  back10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5v3.7h3.7"/><text x="12" y="15.4" text-anchor="middle" font-size="7.4" font-weight="700" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20 3.5v3.7h-3.7"/><text x="12" y="15.4" text-anchor="middle" font-size="7.4" font-weight="700" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif">10</text></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5h4v4M3.5 19.5 20.5 3.5M20.5 16.5v4h-4M14.5 14.5l6 6M3.5 4.5l5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
};

// A colour pair per genre, so each kind of sound has its own cover.
const PL_ART = {
  Action: ["#5a1f1f", "#e2483d"], Cinematic: ["#1c2f57", "#c9a24a"], Epic: ["#2b1c57", "#e07b45"], Horror: ["#160f12", "#8a1c2a"],
  Chill: ["#173f45", "#7fd1b0"], Happy: ["#5a4413", "#ffcf3f"], Sad: ["#1a2236", "#6f8fc9"], "Hip Hop": ["#2b2b2b", "#c48bff"],
  Electronic: ["#10284a", "#4da3ff"],
};
function plArt(s) {
  const c = (s && PL_ART[s.genre]) || ["#1c3557", "#e07b45"];
  return `background:linear-gradient(140deg, ${c[0]}, ${c[1]})`;
}

const plAudio = () => document.getElementById("audio");
const plSound = () => S.playing && ((S.sounds && S.sounds.find((x) => x.id === S.playing.id)) || S.playing);
function plTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- playing

function playSound(id, fromList) {
  const a = plAudio();
  if (S.playing && S.playing.id === id) return togglePlay();
  let s = S.sounds && S.sounds.find((x) => x.id === id);
  if (!s) {  // a sound sent in a chat
    const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
    if (btn && btn.dataset.url) s = { id, name: btn.dataset.name, url: btn.dataset.url };
  }
  if (!s) return;
  if (fromList) PL.queue = fromList;
  else if (!PL.queue.includes(id)) PL.queue = [id];
  S.playing = { id: s.id, name: s.name, url: s.url, path: s.path, genre: s.genre, uploader: s.uploader, mine: s.mine, category: s.category };
  a.src = s.url || publicUrl(s.path);
  a.play().catch(() => toast("Couldn't play that sound."));
  plPeaks(s);
  plMedia(s);
  if (PL.open) plDraw();
}

function togglePlay() {
  const a = plAudio();
  if (!S.playing) return;
  if (a.paused) a.play().catch(() => {}); else a.pause();
}

function plStep(dir) {
  if (!S.playing) return;
  const a = plAudio();
  // "previous" goes back to the start first, like every music app
  if (dir < 0 && a.currentTime > 3) { a.currentTime = 0; return; }
  const q = PL.queue.filter((id) => !S.sounds || S.sounds.some((s) => s.id === id));
  if (!q.length) return;
  let i = q.indexOf(S.playing.id);
  if (PL.shuffle && q.length > 1 && dir > 0) {
    let j;
    do { j = Math.floor(Math.random() * q.length); } while (j === i);
    i = j;
  } else {
    i += dir;
    if (i >= q.length) { if (PL.repeat !== "all") return false; i = 0; }
    if (i < 0) i = PL.repeat === "all" ? q.length - 1 : 0;
  }
  const id = q[i];
  if (id === S.playing.id) { a.currentTime = 0; a.play().catch(() => {}); return true; }
  S.playing = null;
  playSound(id);
  return true;
}

function plSeek(to) {
  const a = plAudio();
  if (!a.duration || !isFinite(a.duration)) return;
  a.currentTime = Math.max(0, Math.min(a.duration - 0.05, to));
  plTick();
}

function plEnded() {
  const a = plAudio();
  if (PL.repeat === "one") { a.currentTime = 0; a.play().catch(() => {}); return; }
  // Music and ambience keep going with the next one; a sound effect just stops.
  const s = plSound();
  if (s && s.category !== "sfx" && plStep(1)) return;
  playingChanged();
}

function playingChanged() {
  if (S.tab === "lib" && !S.view) render();
  else document.querySelectorAll("[data-play]").forEach((b) => {
    if (b.classList.contains("play")) b.innerHTML = S.playing && b.dataset.play === S.playing.id && !plAudio().paused ? I.pause : I.play;
  });
  if (PL.open) plDraw();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = plAudio().paused ? "paused" : "playing";
}

// ---------------------------------------------------------------- the waveform

// The PC app works out each sound's waveform once and shares it (lelons.sounds.peaks).
// If a sound doesn't have one yet, the phone works it out the same way and shares it too.
async function plPeaks(s) {
  if (!s || PL.peaks[s.id]) return;
  if (Array.isArray(s.peaks) && s.peaks.length) { PL.peaks[s.id] = s.peaks; return; }
  PL.peaks[s.id] = "busy";
  try {
    const buf = await (await fetch(s.url || publicUrl(s.path))).arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audio = await new Promise((ok, bad) => { const p = ctx.decodeAudioData(buf, ok, bad); if (p && p.catch) p.catch(bad); });
    if (ctx.close) ctx.close();
    const data = audio.getChannelData(0);
    const step = data.length / PL_BARS, out = [];
    for (let i = 0; i < PL_BARS; i++) {
      let m = 0;
      const end = Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1);
      for (let j = Math.floor(i * step); j < end && j < data.length; j += 4) { const v = Math.abs(data[j]); if (v > m) m = v; }
      out.push(m);
    }
    const loudest = Math.max(...out) || 1;
    const peaks = out.map((p) => Math.round(Math.pow(p / loudest, 0.6) * 100) / 100);  // quiet parts stay visible
    PL.peaks[s.id] = peaks;
    const known = S.sounds && S.sounds.find((x) => x.id === s.id);
    if (known) known.peaks = peaks;
    if (s.path) rpcMe("lelons_set_peaks", { file: s.path, peaks }).catch(() => {});
  } catch {
    PL.peaks[s.id] = null;
  }
  if (S.playing && S.playing.id === s.id) plTick(true);
}

function plWave(canvas, id, at) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  let peaks = PL.peaks[id];
  const waiting = !Array.isArray(peaks);
  if (waiting) peaks = Array.from({ length: PL_BARS }, (_, i) => 0.18 + 0.08 * Math.sin(i * 0.9));
  const gap = canvas.dataset.small ? 1.5 : 2.5;
  const bw = (w - gap * (peaks.length - 1)) / peaks.length;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffcf3f";
  for (let i = 0; i < peaks.length; i++) {
    const x = i * (bw + gap);
    const bh = Math.max(3, peaks[i] * h);
    const done = (i + 0.5) / peaks.length <= at;
    g.fillStyle = done ? accent : waiting ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.28)";
    const r = Math.min(bw / 2, 2);
    const y = (h - bh) / 2;
    if (g.roundRect) { g.beginPath(); g.roundRect(x, y, bw, bh, r); g.fill(); } else g.fillRect(x, y, bw, bh);
  }
}

// Called many times a second while playing: moves the waveform, times and the mini player's line.
function plTick() {
  const a = plAudio();
  if (!S.playing) return;
  const at = PL.drag !== null ? PL.drag : (a.duration ? a.currentTime / a.duration : 0);
  const bar = document.getElementById("pbar");
  if (bar) bar.style.width = (at * 100) + "%";
  if (!PL.open) return;
  const np = document.getElementById("np");
  if (!np) return;
  plWave(np.querySelector("canvas.wave"), S.playing.id, at);
  const dur = a.duration && isFinite(a.duration) ? a.duration : (plSound() || {}).seconds || 0;
  const cur = at * dur;
  const t1 = np.querySelector(".np-cur"), t2 = np.querySelector(".np-left");
  if (t1) t1.textContent = plTime(cur);
  if (t2) t2.textContent = "-" + plTime(dur - cur);
}

// ---------------------------------------------------------------- the mini player

function playerHtml() {
  if (!S.playing) return "";
  const a = plAudio();
  const s = plSound();
  const by = s.mine ? "you" : s.uploader || "";
  return `<div class="player glass" data-act="np-open">
    <div class="art" style="${plArt(s)}">${PI.note}</div>
    <div class="grow"><b class="sm one" style="display:block">${esc(s.name)}</b><div class="xs muted one">${esc([s.genre, by && "by " + by].filter(Boolean).join(" · "))}</div></div>
    <button class="pl-btn" data-act="toggle" aria-label="${a.paused ? "Play" : "Pause"}">${a.paused ? I.play : I.pause}</button>
    <button class="pl-btn" data-act="pl-next" aria-label="Next">${PI.next}</button>
    <div class="pl-line"><i id="pbar"></i></div></div>`;
}

// ---------------------------------------------------------------- the full player

function plOpen() { if (!S.playing) return; PL.open = true; plDraw(); }
function plClose() {
  const el = document.getElementById("np");
  PL.open = false;
  if (!el) return;
  el.classList.add("away");
  setTimeout(() => el.remove(), 260);
}

function plDraw() {
  if (!PL.open || !S.playing) { const el = document.getElementById("np"); if (el) el.remove(); PL.open = false; return; }
  let el = document.getElementById("np");
  const first = !el;
  if (first) {
    el = document.createElement("div");
    el.id = "np";
    document.body.appendChild(el);
    el.onclick = plClick;
    plDragSetup(el);
  }
  const a = plAudio();
  const s = plSound();
  const by = s.mine ? "you" : s.uploader || "someone";
  const cat = { music: "Music", sfx: "SFX", ambience: "Ambience" }[s.category] || "Library";
  const q = PL.queue;
  const i = q.indexOf(s.id);
  const nextS = S.sounds && i >= 0 && q[i + 1] ? S.sounds.find((x) => x.id === q[i + 1]) : null;
  el.innerHTML = `<div class="np-bg" style="${plArt(s)}"></div>
    <div class="np-in">
      <div class="np-top"><button class="np-x" data-act="np-close" aria-label="Close">${PI.down}</button>
        <div class="np-from"><div class="xs muted">Playing from</div><b class="sm">${esc(cat)}${s.genre ? " · " + esc(s.genre) : ""}</b></div><span style="width:40px"></span></div>
      <div class="np-art" style="${plArt(s)}">${PI.note}</div>
      <div class="np-title"><b class="one">${esc(s.name)}</b><div class="muted one">${esc(s.genre || cat)} · uploaded by ${esc(by)}</div></div>
      <div class="np-wave"><canvas class="wave"></canvas></div>
      <div class="np-times"><span class="np-cur">0:00</span><span class="np-left">-0:00</span></div>
      <div class="np-ctl">
        <button class="np-s" data-act="pl-back10" aria-label="Back 10 seconds">${PI.back10}</button>
        <button class="np-m" data-act="pl-prev" aria-label="Previous">${PI.prev}</button>
        <button class="np-play" data-act="toggle" aria-label="${a.paused ? "Play" : "Pause"}">${a.paused ? I.play : I.pause}</button>
        <button class="np-m" data-act="pl-next" aria-label="Next">${PI.next}</button>
        <button class="np-s" data-act="pl-fwd10" aria-label="Forward 10 seconds">${PI.fwd10}</button>
      </div>
      <div class="np-row">
        <button class="np-t ${PL.shuffle ? "on" : ""}" data-act="pl-shuffle">${PI.shuffle}<span>Shuffle</span></button>
        <button class="np-t ${PL.repeat !== "off" ? "on" : ""}" data-act="pl-repeat">${PI.repeat}<span>${{ off: "Repeat", all: "Repeat all", one: "Repeat one" }[PL.repeat]}</span></button>
      </div>
      ${nextS ? `<div class="np-next"><span class="xs muted">Up next</span><b class="sm one">${esc(nextS.name)}</b></div>` : ""}
    </div>`;
  requestAnimationFrame(() => plTick());
  plLoop();
}

function plClick(e) {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const a = plAudio();
  const act = t.dataset.act;
  if (act === "np-close") return plClose();
  if (act === "toggle") return togglePlay();
  if (act === "pl-next") return plStep(1);
  if (act === "pl-prev") return plStep(-1);
  if (act === "pl-back10") return plSeek(a.currentTime - 10);
  if (act === "pl-fwd10") return plSeek(a.currentTime + 10);
  if (act === "pl-shuffle") { PL.shuffle = !PL.shuffle; store.set("plShuffle", PL.shuffle); return plDraw(); }
  if (act === "pl-repeat") { PL.repeat = { off: "all", all: "one", one: "off" }[PL.repeat]; store.set("plRepeat", PL.repeat); return plDraw(); }
}

// Finger on the waveform: the playhead follows it, and the sound jumps there when you let go.
// Swiping down on the top part closes the player, like Apple Music.
function plDragSetup(el) {
  let down = null;
  const at = (x) => {
    const c = el.querySelector(".np-wave").getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - c.left) / c.width));
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".np-wave")) {
      down = "wave";
      PL.drag = at(e.clientX);
      el.querySelector(".np-wave").classList.add("drag");
      plTick();
    } else if (!e.target.closest("button")) {
      down = { y: e.clientY };
    }
  });
  el.addEventListener("pointermove", (e) => {
    if (down === "wave") { PL.drag = at(e.clientX); plTick(); e.preventDefault(); }
    else if (down && down.y !== undefined) {
      const dy = Math.max(0, e.clientY - down.y);
      el.querySelector(".np-in").style.transform = `translateY(${dy}px)`;
    }
  });
  const up = (e) => {
    if (down === "wave") {
      const a = plAudio();
      const to = PL.drag;
      PL.drag = null;
      el.querySelector(".np-wave").classList.remove("drag");
      if (a.duration && isFinite(a.duration)) plSeek(to * a.duration);
    } else if (down && down.y !== undefined) {
      const dy = (e.clientY || down.y) - down.y;
      const inner = el.querySelector(".np-in");
      if (dy > 120) plClose(); else if (inner) inner.style.transform = "";
    }
    down = null;
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

// ---------------------------------------------------------------- lock screen and Control Center

function plMedia(s) {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({ title: s.name, artist: s.uploader || "VaultHub", album: s.genre || "VaultHub Library",
      artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }] });
  } catch { /* old iOS */ }
  const a = plAudio();
  const on = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* not supported */ } };
  on("play", () => a.play());
  on("pause", () => a.pause());
  on("previoustrack", () => plStep(-1));
  on("nexttrack", () => plStep(1));
  on("seekbackward", (d) => plSeek(a.currentTime - ((d && d.seekOffset) || 10)));
  on("seekforward", (d) => plSeek(a.currentTime + ((d && d.seekOffset) || 10)));
  on("seekto", (d) => plSeek(d.seekTime));
}

function plPosition() {
  const a = plAudio();
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !a.duration || !isFinite(a.duration)) return;
  try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate || 1 }); } catch { /* fine */ }
}

// Smooth movement while the big player is open (timeupdate only fires about 4 times a second).
let plRaf = false;
function plLoop() {
  if (plRaf) return;
  plRaf = true;
  const step = () => { if (PL.open && !plAudio().paused) { plTick(); requestAnimationFrame(step); } else plRaf = false; };
  requestAnimationFrame(step);
}

// app.js calls this once at start.
function playerSetup() {
  PL.repeat = store.get("plRepeat", "off");
  PL.shuffle = store.get("plShuffle", false);
  const a = plAudio();
  a.addEventListener("play", playingChanged);
  a.addEventListener("pause", playingChanged);
  a.addEventListener("ended", plEnded);
  a.addEventListener("timeupdate", () => { plTick(); plPosition(); });
  a.addEventListener("loadedmetadata", () => { plTick(); plPosition(); });
  a.addEventListener("play", plLoop);
  window.addEventListener("resize", () => plTick());
}
