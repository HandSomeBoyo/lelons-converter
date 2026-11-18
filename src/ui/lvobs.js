// (2.34.0) The OBS card in the Live console: OBS's live picture, scene buttons (with hotkeys that work in
// games), sound sources with meters and mute, recording and the replay buffer. So OBS can stay minimized.
// The picture comes from OBS's Virtual Camera (smooth, real time); when that's busy, from still pictures.
// Uses $, api(), loadPref/savePref from app.js and LV, lvEsc, lvKeyLabel, lvVk, lvSendHotkeys, lvToast,
// lvTone from livecon.js / liveui.js. Backend: obsctl.py.

const LVO = { s: null, timer: 0, busy: false, shape: "", stream: null, shotTimer: 0, mode: "", setKeys: false, catching: "", lastSaved: 0 };
const LVO_ICONS = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18"/></svg>',
  rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>',
};

function lvoView() { return { picture: true, ...(loadPref("lvObsView") || {}) }; }
function lvoKeys() { const k = loadPref("lvSceneKeys"); return k && typeof k === "object" ? k : {}; }
// Hotkey ids for scenes: 200, 201... in the order of the saved keys (lvSendHotkeys and the key handler share this).
function lvoKeyList() { return Object.entries(lvoKeys()).filter(([, k]) => k && k.vk).slice(0, 20); }

function lvoShown() { const box = $("lvObsCard"); return !!(box && !box.hidden && !box.classList.contains("lv-off") && $("liveTab") && !$("liveTab").hidden); }

function lvDrawObs() {
  const box = $("lvObsCard");
  if (!box) return;
  const c = LV.cfg || {};
  box.hidden = !c.obsOn;
  if (!c.obsOn) return lvStopObs();
  if (!LVO.timer && lvoShown()) lvoTick();
}

async function lvoTick() {
  clearTimeout(LVO.timer);
  LVO.timer = 0;
  if (!lvoShown()) return lvStopObs();
  const res = await api("/api/live-obs", {}).catch(() => null);
  if (res && res.ok) LVO.s = res.obs;
  lvoDraw();
  if (typeof lvDrawDuck === "function") lvDrawDuck();
  LVO.timer = setTimeout(lvoTick, 120);
}

function lvStopObs() {
  clearTimeout(LVO.timer);
  LVO.timer = 0;
  lvoStopPicture();
}

function lvoDraw() {
  const box = $("lvObsCard"), s = LVO.s;
  if (!box) return;
  if (!s || !s.connected) {
    const shape = "off:" + (s ? s.error : "");
    if (LVO.shape !== shape) {
      LVO.shape = shape;
      lvoStopPicture();
      box.innerHTML = `<h3>OBS</h3><p class="lv-muted">${lvEsc((s && s.error) || "Connecting to OBS...")}</p>`;
    }
    return;
  }
  const view = lvoView(), keys = lvoKeys(), obs = (LV.state && LV.state.obs) || {};
  const shape = JSON.stringify([s.scenes, s.scene, s.inputs.map((i) => [i.name, i.muted]), s.record, s.recordPaused, s.replay, s.vcam === null, view, keys, LVO.setKeys, LVO.catching]);
  if (LVO.shape !== shape) {
    LVO.shape = shape;
    lvoBuild(box, s, view, keys);
  }
  // The parts that change all the time.
  for (const i of s.inputs) {
    const bar = box.querySelector(`.lvo-meter[data-n="${CSS.escape(i.name)}"] i`);
    if (bar) bar.style.width = (100 - (i.muted ? 0 : lvoMeter(i.level))) + "%";  // (the bar covers what's quiet)
  }
  const t = $("lvoRecTime");
  if (t) t.textContent = s.record && obs.recording ? lvoClock(obs.recording.ms) : "";
  if (s.saved && s.saved !== LVO.lastSaved) {
    if (LVO.lastSaved) { lvToast({ emoji: "💾", title: "Replay saved", text: "OBS saved the last moments to your recordings folder." }); lvTone("pop", 0.4); }
    LVO.lastSaved = s.saved;
  }
  if (view.picture && !LVO.mode) lvoStartPicture();
}

function lvoMeter(level) {
  // OBS gives 0..1 (1 = loudest); show it like OBS's mixer, from -60 dB to 0 dB.
  if (!level) return 0;
  const db = 20 * Math.log10(level);
  return Math.max(0, Math.min(100, (db + 60) / 60 * 100));
}
function lvoClock(ms) {
  const t = Math.floor((ms || 0) / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}

function lvoBuild(box, s, view, keys) {
  const hadPicture = $("lvoPic");
  const keep = hadPicture && view.picture ? hadPicture : null;
  box.innerHTML = `
    <h3>OBS<span class="lvo-scene-now">${lvEsc(s.scene)}</span><span class="sp"></span>
      <button type="button" class="link" id="lvoPicToggle">${view.picture ? "Hide picture" : "Show picture"}</button></h3>
    <div id="lvoPicSlot"></div>
    <div class="lvo-sub"><b>Scenes</b><span class="sp"></span><button type="button" class="link" id="lvoKeys">${LVO.setKeys ? "Done with keys" : "Hotkeys"}</button></div>
    <div class="lvo-scenes">${s.scenes.map((n) => {
      const k = keys[n];
      return `<button type="button" class="lvo-scene ${n === s.scene ? "on" : ""} ${LVO.setKeys ? "keying" : ""}" data-scene="${lvEsc(n)}">
        <span>${lvEsc(n)}</span>${LVO.catching === n ? `<small>Press a key...</small>` : k && k.vk ? `<small>${lvEsc(lvKeyLabel(k))}</small>` : LVO.setKeys ? `<small>Click to pick a key</small>` : ""}</button>`;
    }).join("")}</div>
    <div class="lvo-sub"><b>Sound</b></div>
    <div class="lvo-mixer">${s.inputs.map((i) => `
      <div class="lvo-input ${i.muted ? "muted" : ""}">
        <button type="button" class="lvo-mute" data-input="${lvEsc(i.name)}" data-muted="${i.muted ? 1 : 0}" title="${i.muted ? "Unmute" : "Mute"}">${i.muted ? LVO_ICONS.micOff : LVO_ICONS.mic}</button>
        <span class="lvo-name">${lvEsc(i.name)}</span>
        <span class="lvo-meter" data-n="${lvEsc(i.name)}"><i></i></span>
      </div>`).join("") || `<p class="lv-muted">No sound sources in OBS.</p>`}</div>
    <div class="lvo-actions">
      <button type="button" class="lvo-btn ${s.record ? "rec" : ""}" id="lvoRec">${s.record ? LVO_ICONS.stop : LVO_ICONS.rec}${s.record ? "Stop recording" : "Start recording"} <span id="lvoRecTime"></span></button>
      ${s.record ? `<button type="button" class="lvo-btn" id="lvoPause">${LVO_ICONS.pause}${s.recordPaused ? "Resume" : "Pause"}</button>` : ""}
      ${s.replay === null ? "" : s.replay
        ? `<button type="button" class="lvo-btn" id="lvoSave">${LVO_ICONS.replay}Save replay</button>`
        : `<button type="button" class="lvo-btn dim" id="lvoReplayOn" title="Keeps the last moments in memory, so you can save them after they happen">${LVO_ICONS.replay}Turn on replay buffer</button>`}
    </div>`;
  if (view.picture) {
    $("lvoPicSlot").replaceWith(keep || lvoPictureBox());
  } else {
    lvoStopPicture();
  }
  $("lvoPicToggle").onclick = () => { savePref("lvObsView", { ...view, picture: !view.picture }); if (view.picture) lvoStopPicture(); LVO.shape = ""; lvoDraw(); };
  $("lvoKeys").onclick = () => { LVO.setKeys = !LVO.setKeys; LVO.shape = ""; lvoDraw(); };
  box.querySelectorAll("[data-scene]").forEach((b) => {
    b.onclick = () => (LVO.setKeys ? lvoCatchKey(b.dataset.scene) : lvoDo("scene", { scene: b.dataset.scene }));
  });
  box.querySelectorAll("[data-input]").forEach((b) => { b.onclick = () => lvoDo("mute", { input: b.dataset.input, muted: b.dataset.muted !== "1" }); });
  $("lvoRec").onclick = () => lvoDo("record");
  if ($("lvoPause")) $("lvoPause").onclick = () => lvoDo("pause");
  if ($("lvoSave")) $("lvoSave").onclick = () => lvoDo("replay-save");
  if ($("lvoReplayOn")) $("lvoReplayOn").onclick = () => lvoDo("replay-start");
}

async function lvoDo(what, data = {}) {
  const res = await api("/api/live-obs-do", { what, ...data }).catch(() => null);
  if (res && res.ok) { LVO.s = res.obs; lvoDraw(); }
  else lvToast({ emoji: "⚠️", title: "OBS said no", text: (res && res.error) || "Couldn't reach OBS." });
  return res;
}

function lvoCatchKey(scene) {
  LVO.catching = scene;
  lvoDraw();
  const done = () => { LVO.catching = ""; document.removeEventListener("keydown", grab, true); LVO.shape = ""; lvoDraw(); };
  const grab = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return done();
    const keys = lvoKeys();
    if (e.key === "Backspace" || e.key === "Delete") { delete keys[scene]; savePref("lvSceneKeys", keys); lvSendHotkeys(); return done(); }
    const vk = lvVk(e);
    if (!vk || ["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
    if (!mods && !(vk >= 0x70 && vk <= 0x7B) && !(vk >= 0x60 && vk <= 0x69)) {
      lvToast({ emoji: "⌨️", title: "Add Ctrl, Alt or Shift", text: "A plain key would also fire while you type. F-keys and Numpad keys work alone." });
      return;
    }
    for (const n of Object.keys(keys)) if (keys[n].vk === vk && (keys[n].mods || 0) === mods) delete keys[n];  // (one key, one scene)
    keys[scene] = { vk, mods };
    savePref("lvSceneKeys", keys);
    lvSendHotkeys();
    done();
  };
  document.addEventListener("keydown", grab, true);
}

// A scene hotkey was pressed (from anywhere, even a game).
function lvoSceneKey(id) {
  const entry = lvoKeyList()[id - 200];
  if (entry) lvoDo("scene", { scene: entry[0] }).then((res) => { if (res && res.ok && !lvoShown()) lvToast({ emoji: "🎬", title: entry[0], text: "Scene switched in OBS." }); });
}

// ---------------------------------------------------------------- the live picture

function lvoPictureBox() {
  const pic = document.createElement("div");
  pic.className = "lvo-pic";
  pic.id = "lvoPic";
  pic.innerHTML = `<video id="lvoVideo" muted playsinline autoplay></video><img id="lvoImg" alt="" hidden><span class="lvo-badge" id="lvoBadge">Starting...</span>`;
  return pic;
}

async function lvoStartPicture() {
  if (LVO.mode) return;
  LVO.mode = "starting";
  const s = LVO.s || {};
  try {
    if (s.vcam === null) throw new Error("no virtual camera");
    const res = await lvoDo("vcam", { on: true });
    if (!res || !res.ok) throw new Error("no virtual camera");
    let device = null;
    for (let tries = 0; tries < 10 && !device; tries++) {
      let list = await navigator.mediaDevices.enumerateDevices();
      if (!list.some((d) => d.label)) {  // (names only show once the page may use cameras)
        const probe = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
        if (probe) probe.getTracks().forEach((t) => t.stop());
        list = await navigator.mediaDevices.enumerateDevices();
      }
      device = list.find((d) => d.kind === "videoinput" && /obs/i.test(d.label));
      if (!device) await new Promise((r) => setTimeout(r, 500));
    }
    if (!device) throw new Error("not found");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    if (LVO.mode !== "starting" || !$("lvoVideo")) { stream.getTracks().forEach((t) => t.stop()); return; }
    LVO.stream = stream;
    $("lvoVideo").srcObject = stream;
    $("lvoVideo").hidden = false;
    $("lvoImg").hidden = true;
    $("lvoBadge").textContent = "Live from OBS";
    LVO.mode = "video";
  } catch {
    if (LVO.mode !== "starting") return;
    LVO.mode = "shots";
    if ($("lvoBadge")) $("lvoBadge").textContent = "Still pictures (Virtual Camera busy)";
    lvoShot();
  }
}

async function lvoShot() {
  clearTimeout(LVO.shotTimer);
  if (LVO.mode !== "shots" || !$("lvoImg")) return;
  const w = Math.min(1280, Math.round(($("lvoPic").clientWidth || 640) * (devicePixelRatio || 1)));
  const res = await api("/api/live-obs-shot", { width: w }).catch(() => null);
  if (LVO.mode !== "shots" || !$("lvoImg")) return;
  if (res && res.ok && res.image) {
    $("lvoImg").src = res.image;
    $("lvoImg").hidden = false;
    $("lvoVideo").hidden = true;
  }
  LVO.shotTimer = setTimeout(lvoShot, 250);
}

function lvoStopPicture() {
  const was = LVO.mode;
  LVO.mode = "";
  clearTimeout(LVO.shotTimer);
  if (LVO.stream) { LVO.stream.getTracks().forEach((t) => t.stop()); LVO.stream = null; }
  if (was === "video" || was === "starting") api("/api/live-obs-do", { what: "vcam", on: false }).catch(() => {});
}
