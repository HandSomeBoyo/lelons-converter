// The Settings window: hardware acceleration, theme and color.
// Uses $, api() from app.js and applyTheme(), ACCENT_COLORS from theme.js.

const ACCENT_NAMES = { yellow: "Yellow", orange: "Orange", red: "Red", pink: "Pink", purple: "Purple", blue: "Blue",
  teal: "Teal", green: "Green" };
let appSettings = { hardware: true, theme: "dark", accent: "yellow" };

function drawSettings() {
  $("setHardware").checked = appSettings.hardware;
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
  const sig = [s.hardware, s.theme, s.accent].join(" ");
  if (sig === settingsSeen) return;
  settingsSeen = sig;
  appSettings = { hardware: s.hardware !== false, theme: s.theme, accent: s.accent };
  applyTheme(s.theme, s.accent);
  if (!$("settingsModal").hidden) drawSettings();
  if (typeof drawWave === "function" && !$("trimModal").hidden) drawWave();  // the waveform's colors
}

async function changeSettings(changes) {
  appSettings = { ...appSettings, ...changes };
  applyTheme(appSettings.theme, appSettings.accent);  // straight away; the app saves it
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
$("setHardware").addEventListener("change", () => changeSettings({ hardware: $("setHardware").checked }));
document.querySelectorAll("#themePicks button").forEach((b) => b.addEventListener("click", () => changeSettings({ theme: b.dataset.theme })));
