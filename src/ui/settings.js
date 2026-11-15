// The Settings window: hardware acceleration, theme and color.
// Uses $, api() from app.js and applyTheme(), ACCENT_COLORS from theme.js.

const ACCENT_NAMES = { yellow: "Yellow", orange: "Orange", red: "Red", pink: "Pink", purple: "Purple", blue: "Blue",
  teal: "Teal", green: "Green" };
let appSettings = { hardware: true, theme: "dark", accent: "yellow", zoom: 1, saveMode: "ask", folder: "", folderName: "" };
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8];

function drawSettings() {
  $("setAsk").checked = appSettings.saveMode !== "folder";
  $("setAlways").checked = appSettings.saveMode === "folder";
  $("setFolderName").textContent = appSettings.folderName;
  $("setFolderName").title = appSettings.folder;
  $("setHardware").checked = appSettings.hardware;
  drawSize();
  $("setChatSound").checked = loadPref("chatSound") !== false;
  document.querySelectorAll("#themePicks button").forEach((b) => b.classList.toggle("active", b.dataset.theme === appSettings.theme));
  const light = appSettings.theme === "light";
  setChildren($("accentPicks"), Object.keys(ACCENT_COLORS).map((name) => {
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
  const sig = [s.hardware, s.theme, s.accent, s.zoom, s.nativeZoom, s.saveMode, s.folder].join(" ");
  if (sig === settingsSeen) return;
  settingsSeen = sig;
  appSettings = { hardware: s.hardware !== false, theme: s.theme, accent: s.accent, zoom: s.zoom || 1,
    saveMode: s.saveMode || "ask", folder: s.folder, folderName: s.folderName };
  // At the top: where things go.
  const asks = appSettings.saveMode !== "folder";
  setChildren($("whereText"), (asks ? [document.createTextNode("Asks where to save")]
    : [document.createTextNode("Saving to "), Object.assign(document.createElement("strong"), { textContent: s.folderName, title: s.folder })]));
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

// The pages on the left of the Settings window.
function showSettingsPage(page) {
  if (!document.querySelector(`#setNav button[data-set="${page}"]`)) page = "general";
  document.querySelectorAll("#setNav button").forEach((b) => b.classList.toggle("active", b.dataset.set === page));
  document.querySelectorAll(".set-page").forEach((p) => { p.hidden = p.dataset.set !== page; });
  if (page === "notes") drawNoteSettings();
  if (page === "sound") listSoundDevices();
  else if (typeof stopMicTest === "function") stopMicTest();
}
document.querySelectorAll("#setNav button").forEach((b) => b.addEventListener("click", () => {
  showSettingsPage(b.dataset.set);
  savePref("settingsPage", b.dataset.set);
}));

// Settings > Notifications: what may notify you.
function drawNoteSettings() {
  if (typeof noteOn !== "function") return;
  const rows = [["windows", "Windows notifications", "A pop-up in the corner of your screen when the app is behind other windows or minimized."]]
    .concat(Object.entries(NOTE_KINDS).map(([k, v]) => [k, v.name, {
      chat: "Private messages, group chats, and when someone @mentions you.",
      invite: "When a friend invites you to a document or a team board.",
      games: "When a game on your Games list goes on sale or becomes free.",
      povs: "When a friend shares a new recording in POVs.",
      downloads: "When a download finishes while you're doing something else.",
      updates: "When a new version of VaultHub is ready.",
    }[k]]));
  const box = $("setNoteKinds");
  box.replaceChildren(...rows.slice(1).map(([k, name, help]) => {
    const row = document.createElement("label");
    row.className = "check set-row";
    row.innerHTML = `<span class="set-text"><b></b><small></small></span><input type="checkbox">`;
    row.querySelector("b").textContent = name;
    row.querySelector("small").textContent = help;
    const input = row.querySelector("input");
    input.checked = noteOn(k);
    input.addEventListener("change", () => noteSetOn(k, input.checked));
    return row;
  }));
  $("setNoteWindows").checked = noteOn("windows");
}
$("setNoteWindows").addEventListener("change", () => noteSetOn("windows", $("setNoteWindows").checked));

function openSettings(part) {
  drawSettings();
  showSettingsPage(part === "save" ? "general" : part === "notes" ? "notes" : loadPref("settingsPage") || "general");
  $("settingsModal").hidden = false;
  $("setSaveBlock").classList.toggle("glow", part === "save");
  if (part === "save") setTimeout(() => $("setSaveBlock").classList.remove("glow"), 1600);
}
function closeSettings() { $("settingsModal").hidden = true; stopMicTest(); }

$("settingsOpen").addEventListener("click", () => openSettings());
document.querySelectorAll('input[name="saveMode"]').forEach((r) => r.addEventListener("change", () => {
  if (r.checked) changeSettings({ saveMode: r.value });
}));
$("setFolderChange").addEventListener("click", async () => {
  const s = await api("/api/pick-folder", {}).catch(() => null);
  if (!s || !s.picked) return;
  await changeSettings({ saveMode: "folder" });
});
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
  setChildren($("sizeTrack"), ZOOMS.map((z) => {
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

// ---- the refresh button at the top (and F5): loads the page you're on again

async function refreshPage() {
  const button = $("refreshButton");
  button.classList.remove("spin");
  void button.offsetWidth; // so the spin plays again
  button.classList.add("spin");
  const tab = (document.querySelector("#tabs button.active") || {}).dataset?.tab;
  const work = [refresh(), loadAccount()];
  if (!$("homeTab").hidden) work.push(loadHome());
  if (!$("statsTab").hidden) work.push(loadStats());
  if (tab === "sfx" && sfxUser()) { sfxLastLoad = 0; work.push(loadSfx()); }
  if (tab === "history") work.push(loadHistory());
  if (!$("accountTab").hidden && typeof openAccount === "function") openAccount();
  if (typeof loadChat === "function") work.push(loadChat());
  await Promise.allSettled(work);
}
$("refreshButton").addEventListener("click", refreshPage);
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && !e.altKey && (e.key === "r" || e.key === "R"))) {
    e.preventDefault();  // not the whole window: that would lose what you were doing
    refreshPage();
  }
});

// The question mark at the top: the tour and What's new.
const helpPop = $("helpPop");
smoothHidden(helpPop);
$("helpButton").addEventListener("click", (e) => { e.stopPropagation(); helpPop.hidden = !helpPop.hidden; });
helpPop.addEventListener("click", () => { helpPop.hidden = true; });
document.addEventListener("click", (e) => { if (!helpPop.hidden && !helpPop.contains(e.target)) helpPop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !helpPop.hidden) helpPop.hidden = true; });

// ---- Settings > Sound: speakers, microphone and noise suppression. The same choices calls use
// (saved as callSpeaker, callMic and callNoise), so picking one here changes it in calls too.
const NOISE_NAMES = { off: "Off", standard: "Standard", strong: "Strong", max: "Max" };
const NOISE_NOTES = {
  off: "Others hear everything your microphone picks up.",
  standard: "Takes away steady hum, like a fan.",
  strong: "AI that keeps your voice and takes away keyboard clicks, fans and background noise.",
  max: "The strongest AI, for loud places. Your voice may sound a little less natural.",
};
let soundDevices = [];
let soundAsked = false;

async function listSoundDevices() {
  try { soundDevices = await navigator.mediaDevices.enumerateDevices(); } catch { soundDevices = []; }
  // Windows only tells the names once the app may use the microphone (it always may, in VaultHub's own window).
  if (!soundAsked && soundDevices.length && soundDevices.every((d) => !d.label)) {
    soundAsked = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      soundDevices = await navigator.mediaDevices.enumerateDevices();
    } catch { /* no microphone, or not allowed: the lists just say "Microphone 1" */ }
  }
  drawSoundSettings();
}

function fillDeviceSelect(sel, kind, pref, label) {
  const list = soundDevices.filter((d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications");
  const opts = [new Option("Windows default", "")];
  list.forEach((d, i) => opts.push(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
  const key = opts.map((o) => o.value + o.text).join("|");
  if (sel.dataset.key !== key) { sel.replaceChildren(...opts); sel.dataset.key = key; }
  const want = loadPref(pref) || "";
  sel.value = want;
  if (sel.value !== want) sel.value = ""; // that device is unplugged: Windows default for now
}

function drawSoundSettings() {
  if (!$("setSpeaker")) return;
  fillDeviceSelect($("setSpeaker"), "audiooutput", "callSpeaker", "Speakers");
  fillDeviceSelect($("setMic"), "audioinput", "callMic", "Microphone");
  const noise = callNoise();
  setChildren($("setNoise"), NOISE_LEVELS.map((level) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: NOISE_NAMES[level] });
    b.classList.toggle("active", level === noise);
    b.addEventListener("click", () => { callSetNoise(level); if (micTest) startMicTest(); });
    return b;
  }));
  $("setNoiseNote").textContent = NOISE_NOTES[noise];
}

$("setSpeaker").addEventListener("change", () => callUseSpeaker($("setSpeaker").value));
$("setMic").addEventListener("change", () => { callUseMic($("setMic").value); if (micTest) startMicTest(); });
navigator.mediaDevices && navigator.mediaDevices.addEventListener("devicechange", () => {
  if (!$("settingsModal").hidden) listSoundDevices();
});

// A short two-note sound from the picked speakers.
let speakerTestCtx = null;
$("setSpeakerTest").addEventListener("click", () => {
  try {
    speakerTestCtx = speakerTestCtx || appSinkCtx(new AudioContext());
    const ctx = speakerTestCtx, now = ctx.currentTime;
    [[523, 0], [659, 0.16], [784, 0.32]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * volumeLevel() / 0.36), now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.45);
    });
  } catch { /* no sound card */ }
});

// The microphone test: a bar that moves with your voice (after noise suppression, like in a call).
let micTest = null; // {mic, ctx, frame}
async function startMicTest() {
  stopMicTest();
  const mine = micTest = { frame: 0 };
  $("setMicTest").textContent = "Stop";
  $("setMicMeter").hidden = false;
  $("setMicNote").hidden = false;
  $("setMicNote").textContent = "Say something. The bar moves when the microphone hears you.";
  try {
    const mic = await callOpenMic();
    if (micTest !== mine) return callMicClose(mic.stream, mic.parts);
    mine.mic = mic;
    mine.ctx = new AudioContext();
    const analyser = mine.ctx.createAnalyser();
    analyser.fftSize = 512;
    mine.ctx.createMediaStreamSource(mic.stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      $("setMicLevel").style.width = Math.min(100, peak / 128 * 160) + "%";
      mine.frame = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    if (micTest !== mine) return;
    stopMicTest();
    $("setMicNote").hidden = false;
    $("setMicNote").textContent = "Couldn't use that microphone. Is it plugged in?";
  }
}
function stopMicTest() {
  if (!micTest) return;
  cancelAnimationFrame(micTest.frame);
  if (micTest.mic) callMicClose(micTest.mic.stream, micTest.mic.parts);
  if (micTest.ctx) micTest.ctx.close().catch(() => {});
  micTest = null;
  $("setMicTest").textContent = "Test it";
  $("setMicMeter").hidden = true;
  $("setMicNote").hidden = true;
  $("setMicLevel").style.width = "0";
}
$("setMicTest").addEventListener("click", () => (micTest ? stopMicTest() : startMicTest()));
