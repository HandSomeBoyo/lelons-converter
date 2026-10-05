// The Settings window: hardware acceleration, theme and color.
// Uses $, api() from app.js and applyTheme(), ACCENT_COLORS from theme.js.

const ACCENT_NAMES = { yellow: "Yellow", orange: "Orange", red: "Red", pink: "Pink", purple: "Purple", blue: "Blue",
  teal: "Teal", green: "Green" };
let appSettings = { hardware: true, theme: "dark", accent: "yellow", zoom: 1 };
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8];

function drawSettings() {
  $("setHardware").checked = appSettings.hardware;
  drawSize();
  $("setChatSound").checked = loadPref("chatSound") !== false;
  document.querySelectorAll("#themePicks button").forEach((b) => b.classList.toggle("active", b.dataset.theme === appSettings.theme));
  const light = appSettings.theme === "light";
  $("accentPicks").replaceChildren(...Object.keys(ACCENT_COLORS).map((name) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = ACCENT_NAMES[name];
    b.style.setProperty("--swatch", ACCENT_COLORS[name][light ? 1 : 0]);
    b.classList.toggle("active", name === appSettings.accent);
    b.addEventListener("click", () => changeSettings({ accent: name }));
    return b;
  }));
}

// From the app's state, every refresh. Only redraws when something changed.
let settingsSeen = "";
function syncSettings(s) {
  const sig = [s.hardware, s.theme, s.accent, s.zoom, s.nativeZoom].join(" ");
  if (sig === settingsSeen) return;
  settingsSeen = sig;
  appSettings = { hardware: s.hardware !== false, theme: s.theme, accent: s.accent, zoom: s.zoom || 1 };
  applyTheme(s.theme, s.accent);
  applyZoom(appSettings.zoom, !!s.nativeZoom);
  if (!$("settingsModal").hidden) drawSettings();
  if (typeof drawWave === "function" && !$("trimModal").hidden) drawWave();  // the waveform's colors
}

async function changeSettings(changes) {
  appSettings = { ...appSettings, ...changes };
  applyTheme(appSettings.theme, appSettings.accent);  // straight away; the app saves it
  if (!nativeZoom) applyZoom(appSettings.zoom, false);
  drawSettings();
  const s = await api("/api/settings", changes).catch(() => null);
  if (s) syncSettings(s);
}

function openSettings() {
  drawSettings();
  $("settingsModal").hidden = false;
}
function closeSettings() { $("settingsModal").hidden = true; }

$("settingsOpen").addEventListener("click", openSettings);
$("settingsClose").addEventListener("click", closeSettings);
$("settingsModal").addEventListener("click", (e) => { if (e.target === $("settingsModal")) closeSettings(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
$("setChatSound").addEventListener("change", () => {
  savePref("chatSound", $("setChatSound").checked);
  if ($("setChatSound").checked && typeof chatDing === "function") chatDing();  // what it sounds like
});
$("setHardware").addEventListener("change", () => changeSettings({ hardware: $("setHardware").checked }));
document.querySelectorAll("#themePicks button").forEach((b) => b.addEventListener("click", () => changeSettings({ theme: b.dataset.theme })));

// ---- Size: the buttons in Settings, Ctrl and scroll, Ctrl and + / - / 0

function drawSize() {
  const zoom = appSettings.zoom;
  $("sizeValue").textContent = Math.round(zoom * 100) + "%";
  $("sizeTrack").replaceChildren(...ZOOMS.map((z) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "size-dot" + (Math.abs(z - zoom) < 0.01 ? " active" : "") + (z === 1 ? " normal" : "");
    b.title = Math.round(z * 100) + "%" + (z === 1 ? " (normal)" : "");
    b.addEventListener("click", () => changeSettings({ zoom: z }));
    return b;
  }));
  $("sizeDown").disabled = zoom <= ZOOMS[0];
  $("sizeUp").disabled = zoom >= ZOOMS[ZOOMS.length - 1];
}

function stepZoom(direction) {
  const now = appSettings.zoom;
  const next = direction > 0 ? ZOOMS.find((z) => z > now + 0.01) : [...ZOOMS].reverse().find((z) => z < now - 0.01);
  if (next) changeSettings({ zoom: next });
}

$("sizeDown").addEventListener("click", () => stepZoom(-1));
$("sizeUp").addEventListener("click", () => stepZoom(1));
let wheelZoomAt = 0;
window.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (Date.now() - wheelZoomAt < 120) return; // one step per flick of the wheel
  wheelZoomAt = Date.now();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey) return;
  if (e.key === "+" || e.key === "=") { e.preventDefault(); stepZoom(1); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); stepZoom(-1); }
  else if (e.key === "0") { e.preventDefault(); changeSettings({ zoom: 1 }); }
});
