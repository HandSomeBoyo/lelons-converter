// The player bar at the bottom (like Artlist): whatever sound plays, in the Library, Find sounds,
// Home, the chat or a profile, shows here with play/pause, previous/next, a waveform to jump around
// in, the time, favorite, download and the volume. Loaded after volume.js.
// Uses clock() from app.js, appPlayers from volume.js and avatarEl(), SFX_ICONS from sfx.js (only once something plays).
//
// A page starts a sound and then calls showPlayer(audio, {
//   key,              which sound it is (so the page and the bar agree)
//   title, sub,       the two lines of text
//   avatar,           {url, name} for the round picture
//   peaks,            the waveform (72 numbers from 0 to 1), or a function that returns it
//   toggle(),         play/pause, the same as the page's own play button
//   next(), prev(),   optional
//   download(),       optional
//   favorite,         optional {on: () => true/false, toggle()}
//   seek(fraction),   optional (else the bar jumps in the audio itself)
// })

const pbEl = (id) => document.getElementById(id); // (app.js, with $, loads after this)
const playerBar = pbEl("playerBar");
smoothHidden(playerBar);
let playerAudio = null;
let playerMeta = null;
let playerFrame = 0;
let playerPeaksDrawn = null;
const playerWatched = new WeakSet();

function showPlayer(audio, meta) {
  const sameSound = playerAudio === audio && playerMeta && playerMeta.key === meta.key;
  playerAudio = audio;
  playerMeta = meta;
  if (!playerWatched.has(audio)) {
    playerWatched.add(audio);
    for (const type of ["play", "pause", "ended", "loadedmetadata", "durationchange", "seeked", "emptied"]) {
      audio.addEventListener(type, () => { if (audio === playerAudio) drawPlayerState(); });
    }
  }
  if (!sameSound) {
    const cover = pbEl("pbCover");
    cover.replaceChildren(avatarEl(meta.avatar && meta.avatar.url, (meta.avatar && meta.avatar.name) || meta.title));
    pbEl("pbTitle").textContent = pbEl("pbTitle").title = meta.title || "";
    pbEl("pbSub").textContent = meta.sub || "";
    playerPeaksDrawn = null;
    playerBar.classList.remove("pb-new");
    void playerBar.offsetWidth;
    playerBar.classList.add("pb-new");
  }
  if (playerBar.hidden) {
    playerBar.hidden = false;
    document.body.classList.add("has-player");
  }
  drawPlayerState();
}

// Is this the sound in the bar, and is it actually playing (not paused)?
function playerPlaying(audio, key) {
  return playerAudio === audio && playerMeta && playerMeta.key === key && !audio.paused;
}

// For the page to call when something on the sound changed (a favorite, a waveform that arrived).
function playerRefresh() {
  if (playerMeta) drawPlayerState();
}

function playerPeaks() {
  const p = playerMeta && playerMeta.peaks;
  return typeof p === "function" ? p() : p;
}

function drawPlayerPeaks() {
  const peaks = playerPeaks() || null;
  const sig = peaks ? peaks.length + ":" + peaks.slice(0, 6).join(",") : "none";
  if (sig === playerPeaksDrawn) return;
  playerPeaksDrawn = sig;
  const count = 110;
  const heights = [];
  for (let i = 0; i < count; i++) {
    heights.push(peaks ? Math.max(10, (peaks[Math.floor(i * peaks.length / count)] || 0) * 100) : 18);
  }
  for (const id of ["pbBars", "pbDone"]) {
    const box = pbEl(id);
    box.replaceChildren(...heights.map((h) => {
      const bar = document.createElement("i");
      bar.style.height = h + "%";
      return bar;
    }));
  }
  pbEl("pbWave").classList.toggle("flat", !peaks);
}

function drawPlayerTime() {
  const a = playerAudio;
  if (!a) return;
  const total = Number.isFinite(a.duration) ? a.duration : 0;
  const done = total ? Math.min(1, a.currentTime / total) : 0;
  pbEl("pbDone").style.clipPath = `inset(0 ${(100 - done * 100).toFixed(2)}% 0 0)`;
  pbEl("pbNow").textContent = clock(a.currentTime || 0, false);
  pbEl("pbTotal").textContent = clock(total, false);
}

function playerTick() {
  drawPlayerTime();
  playerFrame = playerAudio && !playerAudio.paused ? requestAnimationFrame(playerTick) : 0;
}

function drawPlayerState() {
  const a = playerAudio;
  const m = playerMeta;
  if (!a || !m) return;
  const playing = !a.paused;
  const play = pbEl("pbPlay");
  play.innerHTML = playing ? SFX_ICONS.pause : SFX_ICONS.play;
  play.title = playing ? "Pause" : "Play";
  playerBar.classList.toggle("playing", playing);
  pbEl("pbPrev").disabled = !m.prev;
  pbEl("pbNext").disabled = !m.next;
  pbEl("pbDownload").hidden = !m.download;
  pbEl("pbDownload").innerHTML = SFX_ICONS.download;
  const star = pbEl("pbStar");
  star.hidden = !m.favorite;
  if (m.favorite) {
    const on = !!m.favorite.on();
    star.innerHTML = on ? SFX_ICONS.starOn : SFX_ICONS.star;
    star.classList.toggle("on", on);
    star.title = on ? "Remove from your favorites" : "Add to your favorites";
  }
  drawPlayerPeaks();
  drawPlayerTime();
  if (playing && !playerFrame) playerFrame = requestAnimationFrame(playerTick);
}

function closePlayer() {
  const a = playerAudio;
  playerAudio = null;
  playerMeta = null;
  if (a) {
    const stop = appPlayers.get(a);
    if (stop) stop(); else a.pause();
  }
  playerBar.hidden = true;
  document.body.classList.remove("has-player");
}

pbEl("pbPlay").addEventListener("click", () => playerMeta && playerMeta.toggle());
pbEl("pbNext").addEventListener("click", () => playerMeta && playerMeta.next && playerMeta.next());
pbEl("pbPrev").addEventListener("click", () => {
  if (!playerMeta) return;
  // Like any music player: a few seconds in, "previous" goes back to the start first.
  if (playerAudio.currentTime > 3 && !playerAudio.paused) { playerAudio.currentTime = 0; return; }
  if (playerMeta.prev) playerMeta.prev();
});
pbEl("pbDownload").addEventListener("click", () => playerMeta && playerMeta.download && playerMeta.download());
pbEl("pbStar").addEventListener("click", () => { if (playerMeta && playerMeta.favorite) { playerMeta.favorite.toggle(); drawPlayerState(); } });
pbEl("pbClose").addEventListener("click", closePlayer);

// Click or drag on the waveform to jump.
const pbWave = pbEl("pbWave");
function playerSeekAt(e) {
  const box = pbWave.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
  if (!playerMeta) return;
  if (playerMeta.seek) playerMeta.seek(fraction);
  else if (Number.isFinite(playerAudio.duration)) playerAudio.currentTime = fraction * playerAudio.duration;
  drawPlayerTime();
}
pbWave.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pbWave.setPointerCapture(e.pointerId);
  pbWave.classList.add("dragging");
  playerSeekAt(e);
});
pbWave.addEventListener("pointermove", (e) => { if (pbWave.hasPointerCapture(e.pointerId)) playerSeekAt(e); });
pbWave.addEventListener("pointerup", (e) => { pbWave.releasePointerCapture(e.pointerId); pbWave.classList.remove("dragging"); });
pbWave.addEventListener("pointercancel", () => pbWave.classList.remove("dragging"));

// Space plays/pauses the bar's sound when you're not typing somewhere.
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || !playerMeta || playerBar.hidden || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.closest("input, textarea, select, button, [contenteditable], .modal:not([hidden])"))) return;
  if (document.querySelector(".modal:not([hidden])")) return;
  e.preventDefault();
  playerMeta.toggle();
});
