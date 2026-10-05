// One volume for every sound the app plays: the Library, the chat, Home, profiles, previews and
// the trim editor. Set with the speaker button at the top, or in Settings. Loaded before app.js.

const VOLUME_ICONS = {
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  low: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
  high: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"/></svg>',
};

let appVolume = (() => {
  const saved = Number(loadPref("volume"));
  return loadPref("volume") != null && Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.6;
})();
// The slider is how loud it sounds; ears hear loudness roughly squared.
function volumeLevel() { return appVolume * appVolume; }

const playedMedia = new Set();
// The app's sound players (Library, Find, Home, chat, profiles), each with how to stop it. Starting
// any sound stops the others, so two never play at once.
const appPlayers = new Map(); // audio -> stop()
function registerPlayer(audio, stop) { appPlayers.set(audio, stop); }
const realPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function (...args) {
  this.volume = volumeLevel();
  playedMedia.add(this);
  for (const [audio, stop] of appPlayers) if (audio !== this && !audio.paused) stop();
  return realPlay.apply(this, args);
};

let volumeSaveTimer = null;
function setVolume(value) {
  appVolume = Math.min(1, Math.max(0, value));
  for (const media of playedMedia) media.volume = volumeLevel();
  drawVolume();
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => savePref("volume", Math.round(appVolume * 100) / 100), 400);
}

function drawVolume() {
  const percent = Math.round(appVolume * 100);
  for (const slider of document.querySelectorAll(".volume-slider")) {
    if (Number(slider.value) !== percent) slider.value = percent;
    slider.style.setProperty("--fill", percent + "%");
  }
  for (const label of document.querySelectorAll(".volume-value")) label.textContent = percent + "%";
  const button = document.getElementById("volumeButton");
  button.innerHTML = VOLUME_ICONS[percent === 0 ? "off" : percent < 50 ? "low" : "high"];
  button.title = `Volume: ${percent}%`;
}

for (const slider of document.querySelectorAll(".volume-slider")) {
  slider.addEventListener("input", () => setVolume(Number(slider.value) / 100));
}

// The little volume popup under the speaker button.
const volumePop = document.getElementById("volumePop");
smoothHidden(volumePop);
document.getElementById("volumeButton").addEventListener("click", (e) => {
  e.stopPropagation();
  volumePop.hidden = !volumePop.hidden;
});
document.addEventListener("click", (e) => { if (!volumePop.hidden && !volumePop.contains(e.target)) volumePop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !volumePop.hidden) volumePop.hidden = true; });
volumePop.addEventListener("wheel", (e) => { e.preventDefault(); setVolume(appVolume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
drawVolume();
