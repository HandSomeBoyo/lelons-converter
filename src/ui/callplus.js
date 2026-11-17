// More for calls: what you send goes through a little mixer (your microphone, sound board sounds and your
// PC's sound when you share your screen), push-to-talk, a volume for each person, signal bars and steadier
// calls on bad Wi-Fi, the sound board, and recording the call to a file.
// Uses call.js (call, callPeers, callMicStream, callSendStream, callMuted, callDeafened, callPop...),
// $, api() from app.js, loadPref()/savePref() from theme.js, sfxSounds from sfx.js, appSinkCtx from volume.js.

// ---- the mixer: everything others hear from you goes through it, so sounds can be added on top

let callMix = null; // {ctx, out, mic, micGain, board, screen, screenSrc}
function callMixStart(stream) {
  callMixStop();
  try {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const out = ctx.createMediaStreamDestination();
    out.channelCount = 2;
    const micGain = ctx.createGain(), board = ctx.createGain(), screen = ctx.createGain();
    for (const g of [micGain, board, screen]) g.connect(out);
    board.gain.value = callBoardVolume();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    callMix = { ctx, out, micGain, board, screen, mic: null, screenSrc: null };
    callMixMic(stream);
    return out.stream;
  } catch (e) {
    callMixStop();
    return stream; // (no mixer here: your microphone goes out as it is, without sound board or PC sound)
  }
}
// Your microphone (again, after you picked another one): true if the mixer took it.
function callMixMic(stream) {
  if (!callMix) return false;
  try { if (callMix.mic) callMix.mic.disconnect(); } catch (e) { /* gone */ }
  callMix.mic = callMix.ctx.createMediaStreamSource(stream);
  callMix.mic.connect(callMix.micGain);
  return true;
}
// The sound of the screen you share (or null to stop it).
function callMixScreen(track) {
  if (!callMix) return false;
  try { if (callMix.screenSrc) callMix.screenSrc.disconnect(); } catch (e) { /* gone */ }
  callMix.screenSrc = null;
  if (!track) return true;
  callMix.screenSrc = callMix.ctx.createMediaStreamSource(new MediaStream([track]));
  callMix.screenSrc.connect(callMix.screen);
  return true;
}
function callMixStop() {
  callBoardStop();
  if (!callMix) return;
  callMix.out.stream.getTracks().forEach((t) => t.stop());
  callMix.ctx.close().catch(() => {});
  callMix = null;
}

// Is your microphone on right now? (not muted, not deafened, and holding the key if push-to-talk is on)
function callMicLive() { return !callMuted && !callDeafened && (!callPtt().on || callPttDown); }
function callApplyGain() {
  const live = callMicLive();
  if (callMix) {
    if (callMicStream) callMicStream.getAudioTracks().forEach((t) => { t.enabled = true; });
    callMix.micGain.gain.setTargetAtTime(live ? 1 : 0, callMix.ctx.currentTime, 0.008);
    // Muted: the sound board and your PC's sound still go out. Deafened: nothing does.
    callMix.out.stream.getAudioTracks().forEach((t) => { t.enabled = !callDeafened; });
  } else if (callMicStream) {
    callMicStream.getAudioTracks().forEach((t) => { t.enabled = live; });
  }
}

// ---- push-to-talk: your microphone is only on while you hold a key (or a mouse side button).
// It works while you're in a game too: the app asks Windows whether the key is down.

const PTT_DEFAULT = { on: false, vk: 86, name: "V" };
function callPtt() {
  const p = loadPref("callPtt");
  return p && typeof p === "object" && p.vk ? { ...PTT_DEFAULT, ...p } : PTT_DEFAULT;
}
let callPttDown = false;
let callPttLocal = false; // held down in the app's own window
let callPttTimer = 0;
let callPttLetGo = 0;
let callPttAsking = false;
let callPttWindows = true; // false once the app says it can't ask Windows (then only the app's window counts)
function callPttSet(change) {
  savePref("callPtt", { ...callPtt(), ...change });
  callPttRun();
  callApplyGain();
  drawCallPop();
  if (typeof drawSoundSettings === "function") drawSoundSettings();
  if (typeof drawCall === "function" && call) { callDrawn = ""; drawCall(); }
}
// Only checks the key while you're in a call with push-to-talk on.
function callPttRun() {
  const want = callIsLive() && call.phase === "in" && callPtt().on;
  if (want && !callPttTimer) callPttTimer = setInterval(callPttTick, 30);
  if (!want && callPttTimer) { clearInterval(callPttTimer); callPttTimer = 0; callPttHeld(false, true); }
}
async function callPttTick() {
  if (!callIsLive() || call.phase !== "in" || !callPtt().on) return callPttRun();
  let down = callPttLocal;
  if (!down && callPttWindows && !callPttAsking) {
    callPttAsking = true;
    const res = await api("/api/call-key", { vk: callPtt().vk }).catch(() => null);
    callPttAsking = false;
    if (res && res.ok) down = !!res.down;
    else if (res && res.ok === false) callPttWindows = false;
  } else if (callPttAsking) return;
  callPttHeld(down);
}
// A short tail after you let go, so the end of a word isn't cut off.
function callPttHeld(down, now) {
  if (down) {
    clearTimeout(callPttLetGo);
    callPttLetGo = 0;
    if (!callPttDown) { callPttDown = true; callApplyGain(); drawCallPeople(); }
  } else if (callPttDown && (now || !callPttLetGo)) {
    const done = () => { callPttLetGo = 0; callPttDown = false; callApplyGain(); drawCallPeople(); };
    if (now) { clearTimeout(callPttLetGo); done(); } else callPttLetGo = setTimeout(done, 220);
  }
}
function callPttMatches(e) {
  const vk = callPtt().vk;
  if (e.type.startsWith("mouse")) return { 1: 4, 3: 5, 4: 6 }[e.button] === vk;
  return e.keyCode === vk;
}
let callPttPicking = null; // a function to call with the key you pressed
function callPttPick(done) {
  callPttPicking = done;
  drawCallPop();
  if (typeof drawSoundSettings === "function") drawSoundSettings();
}
function callPttKeyName(e) {
  if (e.type.startsWith("mouse")) return { 1: "Middle mouse", 3: "Mouse back", 4: "Mouse forward" }[e.button];
  if (e.code === "Space") return "Space";
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return { CapsLock: "Caps Lock", Backquote: "§ / `", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl", AltLeft: "Left Alt",
    AltRight: "Right Alt", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", Tab: "Tab" }[e.code] || e.key.toUpperCase();
}
function callPttInput(e) {
  if (callPttPicking) {
    if (e.type === "keydown" || e.type === "mousedown") {
      if (e.type === "mousedown" && ![1, 3, 4].includes(e.button)) return; // (left and right click pick nothing)
      e.preventDefault();
      e.stopPropagation();
      const done = callPttPicking;
      callPttPicking = null;
      if (e.key === "Escape") { drawCallPop(); if (typeof drawSoundSettings === "function") drawSoundSettings(); return; }
      done({ vk: e.type === "mousedown" ? { 1: 4, 3: 5, 4: 6 }[e.button] : e.keyCode, name: callPttKeyName(e) });
    }
    return;
  }
  if (!callPttTimer || !callPttMatches(e)) return;
  const down = e.type === "keydown" || e.type === "mousedown";
  if (down && /^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || "") && e.type === "keydown") return; // typing in the chat
  callPttLocal = down;
  callPttHeld(down);
}
for (const kind of ["keydown", "keyup", "mousedown", "mouseup"]) window.addEventListener(kind, callPttInput, true);
window.addEventListener("blur", () => { callPttLocal = false; });

// The push-to-talk rows, for the call's settings and for Settings > Sound.
function callPttRows(cls) {
  const ptt = callPtt();
  const row = document.createElement("div");
  row.className = cls;
  const chip = (text, on, fn) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
    b.classList.toggle(cls === "call-chips" ? "on" : "active", on);
    b.addEventListener("click", fn);
    return b;
  };
  row.append(chip("Off", !ptt.on, () => callPttSet({ on: false })), chip("On", ptt.on, () => callPttSet({ on: true })));
  const key = chip(callPttPicking ? "Press a key..." : "Key: " + ptt.name, !!callPttPicking, (e) => {
    e.stopPropagation();
    callPttPick((k) => callPttSet({ ...k, on: true }));
  });
  key.classList.add("ptt-key");
  row.append(key);
  return row;
}
const PTT_NOTE = "Your microphone is only on while you hold the key. It works while you're in a game too. Mouse side buttons work as well.";

// ---- a volume for each person (0 to 200%), saved for next time

function callVolumes() { const v = loadPref("callVolumes"); return v && typeof v === "object" ? v : {}; }
function callVolumeOf(key) { const v = Number(callVolumes()[key]); return Number.isFinite(v) ? Math.max(0, Math.min(200, v)) : 100; }
let callVolumeSave = 0;
function callSetVolume(key, pct) {
  const all = { ...callVolumes(), [key]: Math.round(pct) };
  if (all[key] === 100) delete all[key];
  pageSaved.callVolumes = all; // (saved for real a moment after the slider stops)
  clearTimeout(callVolumeSave);
  callVolumeSave = setTimeout(() => savePref("callVolumes", callVolumes()), 500);
  const p = callPeers.get(key);
  if (p) callApplyVolume(p);
}
// Up to 100% is the sound's own volume; louder than that goes through a booster.
function callApplyVolume(p) {
  const pct = callVolumeOf(lower(p.name));
  if (pct <= 100 || !p.audioStream) {
    callVolumeDrop(p);
    p.audio.muted = callDeafened;
    p.audio.volume = pct / 100;
    return;
  }
  try {
    callAudioCtx = callAudioCtx || appSinkCtx(new AudioContext());
    if (callAudioCtx.state === "suspended") callAudioCtx.resume().catch(() => {});
    if (!p.boost || p.boost.stream !== p.audioStream) {
      callVolumeDrop(p);
      const src = callAudioCtx.createMediaStreamSource(p.audioStream), gain = callAudioCtx.createGain();
      src.connect(gain).connect(callAudioCtx.destination);
      p.boost = { src, gain, stream: p.audioStream };
    }
    p.boost.gain.gain.value = callDeafened ? 0 : pct / 100;
    p.audio.muted = true; // (the booster plays it instead; the element keeps the sound coming)
  } catch (e) {
    callVolumeDrop(p);
    p.audio.muted = callDeafened;
    p.audio.volume = 1;
  }
}
function callVolumeDrop(p) {
  if (!p.boost) return;
  try { p.boost.src.disconnect(); p.boost.gain.disconnect(); } catch (e) { /* gone */ }
  p.boost = null;
}

// ---- signal bars, and steadier calls on bad Wi-Fi

let callLineTimer = 0;
function callLinesRun() {
  const want = callIsLive() && call.phase === "in";
  if (want && !callLineTimer) callLineTimer = setInterval(callCheckLines, 2000);
  if (!want && callLineTimer) { clearInterval(callLineTimer); callLineTimer = 0; }
}
async function callCheckLines() {
  if (!callIsLive() || call.phase !== "in") return callLinesRun();
  let changed = false;
  for (const p of [...callPeers.values()]) {
    if (!p.connected) continue;
    let stats;
    try { stats = await p.pc.getStats(); } catch (e) { continue; }
    let rtt = null, lost = 0, got = 0, jitter = 0, theyLose = null;
    stats.forEach((r) => {
      if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
      if (r.type === "inbound-rtp" && r.kind === "audio") { lost = r.packetsLost || 0; got = r.packetsReceived || 0; jitter = (r.jitter || 0) * 1000; }
      if (r.type === "remote-inbound-rtp" && r.kind === "audio" && r.fractionLost != null) theyLose = r.fractionLost;
    });
    const dLost = Math.max(0, lost - (p.lastLost || 0)), dGot = Math.max(0, got - (p.lastGot || 0));
    p.lastLost = lost; p.lastGot = got;
    const loss = dLost + dGot ? dLost / (dLost + dGot) : 0;
    p.line = { rtt, loss, jitter };
    const bars = rtt == null ? 3 : rtt > 400 || loss > 0.1 ? 1 : rtt > 200 || loss > 0.03 || jitter > 40 ? 2 : 3;
    if (bars !== p.bars) { p.bars = bars; changed = true; }
    // Their sound comes in unevenly: wait a little longer for it, so it plays smoothly instead of choppy.
    try {
      const rx = p.audioTx && p.audioTx.receiver;
      if (rx && "jitterBufferTarget" in rx) rx.jitterBufferTarget = loss > 0.03 || jitter > 30 ? 150 : null;
    } catch (e) { /* not here */ }
    // They lose a lot of what you send: send less (it gets through better), and go back up once it's fine.
    const weak = theyLose != null && theyLose > 0.06 ? Date.now() : p.weakAt || 0;
    const nowWeak = Date.now() - weak < 20000;
    if (nowWeak !== !!p.weak) { p.weak = nowWeak; callAudioBitrate(p); }
    p.weakAt = weak;
  }
  if (changed) { callPeopleDrawn = ""; drawCallPeople(); }
  if (callPopOpen && callPopOpen.startsWith("person:")) drawCallPop();
}
function callLineText(p) {
  if (!p || !p.connected) return p && p.lostSince ? "Reconnecting..." : "Connecting...";
  const l = p.line || {};
  const what = { 3: "Good connection", 2: "OK connection", 1: "Weak connection" }[p.bars || 3];
  const bits = [what];
  if (l.rtt != null) bits.push(Math.round(l.rtt) + " ms");
  if (l.loss > 0.005) bits.push(Math.round(l.loss * 100) + "% lost");
  return bits.join(" · ");
}
function callBarsEl(bars) {
  const el = document.createElement("i");
  el.className = "call-bars b" + (bars || 3);
  el.innerHTML = "<b></b><b></b><b></b>";
  return el;
}

// ---- the sound board: play Library sounds into the call (you hear them too)

let callBoardPlaying = new Map(); // sound id -> {src, local}
const callBoardBuffers = new Map(); // url -> Promise<AudioBuffer>
let callBoardSearch = "";
let callBoardLocal = null; // an AudioContext for hearing the sounds yourself
function callBoardVolume() { const v = loadPref("callBoardVolume"); return typeof v === "number" && v >= 0 && v <= 1 ? v : 0.6; }
function callBoardSetVolume(v) {
  pageSaved.callBoardVolume = v;
  clearTimeout(callBoardSetVolume.t);
  callBoardSetVolume.t = setTimeout(() => savePref("callBoardVolume", v), 400);
  if (callMix) callMix.board.gain.value = v;
  for (const s of callBoardPlaying.values()) if (s.localGain) s.localGain.gain.value = v;
}
function callBoardSounds() {
  const all = (typeof sfxSounds !== "undefined" ? sfxSounds : []).filter((s) => s.url);
  const q = callBoardSearch.trim().toLowerCase();
  const hits = q ? all.filter((s) => (s.name || "").toLowerCase().includes(q)) : all;
  return [...hits].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)).slice(0, 60);
}
function callBoardBuffer(ctx, url) {
  if (!callBoardBuffers.has(url)) {
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error("no"); return r.arrayBuffer(); }).then((b) => ctx.decodeAudioData(b));
    p.catch(() => callBoardBuffers.delete(url));
    callBoardBuffers.set(url, p);
  }
  return callBoardBuffers.get(url);
}
async function callBoardPlay(sound) {
  if (!callMix) return callToast("The sound board can't start here.");
  if (callBoardPlaying.has(sound.id)) return callBoardStop(sound.id);
  callBoardPlaying.set(sound.id, { loading: true });
  drawCallPop();
  let buffer;
  try {
    buffer = await callBoardBuffer(callMix.ctx, sound.url);
  } catch (e) {
    callBoardPlaying.delete(sound.id);
    drawCallPop();
    return callToast("Couldn't load that sound. Check your internet connection.");
  }
  if (!callMix || !callBoardPlaying.has(sound.id)) return;
  const src = callMix.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(callMix.board);
  // You hear it too, from your speakers.
  let local = null, localGain = null;
  try {
    callBoardLocal = callBoardLocal || appSinkCtx(new AudioContext({ sampleRate: 48000 }));
    if (callBoardLocal.state === "suspended") callBoardLocal.resume().catch(() => {});
    local = callBoardLocal.createBufferSource();
    local.buffer = buffer;
    localGain = callBoardLocal.createGain();
    localGain.gain.value = callDeafened ? 0 : callBoardVolume();
    local.connect(localGain).connect(callBoardLocal.destination);
    local.start();
  } catch (e) { local = null; }
  const entry = { src, local, localGain };
  callBoardPlaying.set(sound.id, entry);
  src.onended = () => { if (callBoardPlaying.get(sound.id) === entry) { callBoardPlaying.delete(sound.id); drawCallPop(); } };
  src.start();
  drawCallPop();
}
function callBoardStop(id) {
  for (const [key, s] of [...callBoardPlaying]) {
    if (id !== undefined && key !== id) continue;
    callBoardPlaying.delete(key);
    try { if (s.src) s.src.stop(); } catch (e) { /* done */ }
    try { if (s.local) s.local.stop(); } catch (e) { /* done */ }
  }
  if (typeof drawCallPop === "function" && callPopOpen === "board") drawCallPop();
}
async function drawCallBoard(els, title) {
  if (typeof sfxSounds !== "undefined" && !sfxSounds.length && !drawCallBoard.asked && typeof loadSfx === "function") {
    drawCallBoard.asked = true;
    loadSfx().then(() => { if (callPopOpen === "board") drawCallPop(); }).catch(() => {});
  }
  els.push(title("Sound board"));
  const search = Object.assign(document.createElement("input"), { type: "search", className: "call-board-search", placeholder: "Find a sound", value: callBoardSearch });
  search.addEventListener("input", () => {
    callBoardSearch = search.value;
    const list = box.querySelector(".call-board");
    if (list) list.replaceWith(boardList());
  });
  const box = $("callPop");
  const boardList = () => {
    const list = document.createElement("div");
    list.className = "call-board";
    const sounds = callBoardSounds();
    if (!sounds.length) {
      list.append(Object.assign(document.createElement("p"), { className: "call-pop-note",
        textContent: typeof sfxUser === "function" && !sfxUser() ? "Log in to use the Library's sounds." : callBoardSearch ? "No sounds with that name." : "Loading the Library's sounds..." }));
    }
    for (const s of sounds) {
      const on = callBoardPlaying.get(s.id);
      const b = Object.assign(document.createElement("button"), { type: "button", className: "call-board-sound" + (on ? " on" : ""), title: on ? "Stop it" : "Play it in the call" });
      b.append(Object.assign(document.createElement("span"), { textContent: (s.favorite ? "★ " : "") + s.name }));
      if (on) b.append(Object.assign(document.createElement("i"), { textContent: on.loading ? "..." : "Stop" }));
      b.addEventListener("click", () => callBoardPlay(s));
      list.append(b);
    }
    return list;
  };
  els.push(search, boardList());
  const row = document.createElement("div");
  row.className = "call-board-volume";
  const slider = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 100, value: Math.round(callBoardVolume() * 100), className: "call-slider", ariaLabel: "Sound board volume" });
  slider.addEventListener("input", () => callBoardSetVolume(slider.value / 100));
  row.append(Object.assign(document.createElement("span"), { textContent: "Volume" }), slider);
  els.push(row);
  els.push(Object.assign(document.createElement("p"), { className: "call-pop-note", textContent: "Everyone in the call hears it, and so do you. Your favorite sounds come first." }));
  if (callBoardPlaying.size) {
    const stop = Object.assign(document.createElement("button"), { type: "button", className: "outline-button call-stop", textContent: "Stop all sounds" });
    stop.addEventListener("click", () => callBoardStop());
    const actions = document.createElement("div");
    actions.className = "call-pop-actions";
    actions.append(stop);
    els.push(actions);
  }
}

// ---- someone in the call: their volume, their connection, and their profile

function drawCallPerson(els, title, key) {
  const p = callPeers.get(key);
  const person = callOthersIn().find((x) => lower(x.username) === key);
  if (!person) { callPop(null); return; }
  const head = document.createElement("div");
  head.className = "call-person-head";
  head.append(avatarEl(person.avatarUrl || callFaceOf(person.username), person.username));
  const text = document.createElement("div");
  text.append(Object.assign(document.createElement("b"), { textContent: person.username }));
  const line = Object.assign(document.createElement("small"), { textContent: callLineText(p) });
  if (p && p.connected) line.prepend(callBarsEl(p.bars));
  text.append(line);
  head.append(text);
  els.push(head);
  els.push(title("Volume"));
  const row = document.createElement("div");
  row.className = "call-board-volume";
  const pct = callVolumeOf(key);
  const value = Object.assign(document.createElement("span"), { className: "call-volume-value", textContent: pct + "%" });
  const slider = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 200, step: 5, value: pct, className: "call-slider", ariaLabel: person.username + "'s volume" });
  const paint = () => slider.style.setProperty("--fill", (slider.value / 2) + "%");
  paint();
  slider.addEventListener("input", () => { value.textContent = slider.value + "%"; paint(); callSetVolume(key, +slider.value); });
  row.append(slider, value);
  els.push(row);
  els.push(Object.assign(document.createElement("p"), { className: "call-pop-note", textContent: "Only changes how loud they are for you. Over 100% makes a quiet friend louder." }));
  if (p && p.recording) els.push(Object.assign(document.createElement("p"), { className: "call-pop-note rec", textContent: person.username + " is recording the call." }));
  const actions = document.createElement("div");
  actions.className = "call-pop-actions";
  if (pct !== 100) {
    const reset = Object.assign(document.createElement("button"), { type: "button", className: "ghost-button", textContent: "Back to 100%" });
    reset.addEventListener("click", () => { callSetVolume(key, 100); drawCallPop(); });
    actions.append(reset);
  }
  const profile = Object.assign(document.createElement("button"), { type: "button", className: "small-button", textContent: "See profile" });
  profile.addEventListener("click", () => { callPop(null); if (typeof openProfile === "function") openProfile(person.username); });
  actions.append(profile);
  els.push(actions);
}

// ---- recording the call: everyone's voices and yours, saved as an MP3 in your save folder

let callRec = null; // {ctx, out, rec, chunks, sources: Map, startedAt, title, timer}
function callRecToggle() { return callRec ? callRecStop() : callRecStart(); }
function callRecStart() {
  if (!callIsLive() || call.phase !== "in" || callRec || typeof MediaRecorder === "undefined") return;
  try {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const out = ctx.createMediaStreamDestination();
    out.channelCount = 2;
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    const rec = new MediaRecorder(out.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 256000 });
    callRec = { ctx, out, rec, chunks: [], sources: new Map(), startedAt: Date.now(), title: call.title, timer: 0 };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) mineRec.chunks.push(e.data); };
    const mineRec = callRec;
    if (callSendStream) callRecAdd("", callSendStream);
    for (const [key, p] of callPeers) if (p.audioStream) callRecAdd(key, p.audioStream);
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    rec.start(1000);
    callRec.timer = setInterval(() => { callDrawn = ""; drawCall(); }, 1000);
  } catch (e) {
    callRec = null;
    return callToast("Couldn't start recording.");
  }
  for (const p of callPeers.values()) callSend(p, { recording: true });
  callDrawn = "";
  drawCall();
}
function callRecAdd(key, stream) {
  if (!callRec) return;
  callRecRemove(key);
  try {
    const src = callRec.ctx.createMediaStreamSource(stream);
    src.connect(callRec.out);
    callRec.sources.set(key, src);
  } catch (e) { /* this one isn't in the recording */ }
}
function callRecRemove(key) {
  const src = callRec && callRec.sources.get(key);
  if (!src) return;
  try { src.disconnect(); } catch (e) { /* gone */ }
  callRec.sources.delete(key);
}
function callRecStop() {
  const r = callRec;
  if (!r) return;
  callRec = null;
  clearInterval(r.timer);
  for (const p of callPeers.values()) callSend(p, { recording: false });
  r.rec.onstop = async () => {
    for (const src of r.sources.values()) try { src.disconnect(); } catch (e) { /* gone */ }
    r.ctx.close().catch(() => {});
    const blob = new Blob(r.chunks, { type: r.rec.mimeType || "audio/webm" });
    if (!blob.size) return callToast("The recording was empty.");
    const when = new Date(r.startedAt);
    const pad = (n) => String(n).padStart(2, "0");
    const name = `Call with ${r.title} ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}.${pad(when.getMinutes())}`;
    callToast("Saving the recording...");
    const res = await fetch("/api/call-record", { method: "POST", headers: { "X-File-Name": encodeURIComponent(name) }, body: blob })
      .then((x) => x.json()).catch(() => ({ ok: false }));
    if (!res.ok) return callToast(res.error || "Couldn't save the recording.");
    callToast(`Saved "${res.name}"`, "Show in folder", () => api("/api/call-record-show", { path: res.path }).catch(() => {}));
  };
  try { r.rec.stop(); } catch (e) { r.rec.onstop(); }
  if (call) { callDrawn = ""; drawCall(); }
}
function callRecClock() {
  return callRec ? clock(Math.floor((Date.now() - callRec.startedAt) / 1000), false) : "";
}

// ---- a short note under the call card (instead of a popup that would stop everything)

let callToastTimer = 0;
function callToast(text, action, fn) {
  let el = $("callToast");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "callToast", className: "call-toast" });
    document.body.append(el);
  }
  el.replaceChildren(Object.assign(document.createElement("span"), { textContent: text }));
  if (action) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: action });
    b.addEventListener("click", () => { fn(); el.hidden = true; });
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(callToastTimer);
  callToastTimer = setTimeout(() => { el.hidden = true; }, action ? 12000 : 5000);
}

// ---- sharing your PC's sound along with your screen

// PC sound is picked once, in the Windows share window (its "Share system audio" switch).
function callShareSound() { return true; }
// Leaves out VaultHub's own sound (the call), so friends don't hear themselves back, where Windows' browser engine can.
function callShareSoundSafe() {
  try { return !!navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio; } catch (e) { return false; }
}
function callShareAudioOptions() {
  if (!callShareSound() || !callMix) return false;
  return { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false,
    ...(callShareSoundSafe() ? { restrictOwnAudio: true } : {}) };
}

// ---- zoom in and out on a shared screen (2.37.0): the mouse wheel or the + and - buttons, then drag to look around

const callZoom = { z: 1, x: 0, y: 0, who: "", drag: null };
const callZoomBox = Object.assign(document.createElement("div"), { className: "call-zoom" });
$("callVideo").before(callZoomBox);
callZoomBox.append($("callVideo"));
const callZoomBar = Object.assign(document.createElement("div"), { className: "call-zoom-bar" });
const callZoomBtn = (html, title, fn) => {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "icon-button", title, innerHTML: html });
  b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
  return b;
};
const callZoomLevel = Object.assign(document.createElement("button"), { type: "button", className: "call-zoom-level", title: "Back to the whole screen (0)" });
callZoomLevel.addEventListener("click", (e) => { e.stopPropagation(); callZoomTo(1); });
callZoomBar.append(
  callZoomBtn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>', "Zoom out (-)", () => callZoomTo(callZoom.z / 1.4)),
  callZoomLevel,
  callZoomBtn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>', "Zoom in (+). Or use the mouse wheel.", () => callZoomTo(callZoom.z * 1.4)));
$("callStageSize").before(callZoomBar);

function callZoomApply() {
  const v = $("callVideo");
  const zoomed = callZoom.z > 1.001;
  v.style.transform = zoomed ? `translate(${callZoom.x}px, ${callZoom.y}px) scale(${callZoom.z})` : "";
  callZoomBox.classList.toggle("zoomed", zoomed);
  callZoomBox.classList.toggle("dragging", !!callZoom.drag);
  callZoomBar.classList.toggle("zoomed", zoomed);
  callZoomLevel.textContent = Math.round(callZoom.z * 100) + "%";
}
function callZoomClamp() {
  const w = callZoomBox.clientWidth, h = callZoomBox.clientHeight, z = callZoom.z;
  callZoom.x = Math.min(0, Math.max(w - w * z, callZoom.x));
  callZoom.y = Math.min(0, Math.max(h - h * z, callZoom.y));
}
// Zoom to z, keeping the point (cx, cy) in the box where it is (the middle when it isn't given).
function callZoomTo(z, cx, cy) {
  const w = callZoomBox.clientWidth, h = callZoomBox.clientHeight;
  if (cx == null) { cx = w / 2; cy = h / 2; }
  z = Math.min(8, Math.max(1, z));
  const old = callZoom.z;
  callZoom.x = cx - (cx - callZoom.x) * (z / old);
  callZoom.y = cy - (cy - callZoom.y) * (z / old);
  callZoom.z = z;
  if (z <= 1.001) { callZoom.z = 1; callZoom.x = callZoom.y = 0; }
  callZoomClamp();
  callZoomApply();
}
// A different screen on the stage starts at the whole screen again (called by drawCallStage).
function callZoomWatch(who) {
  if (callZoom.who === who) return;
  callZoom.who = who;
  callZoom.z = 1; callZoom.x = callZoom.y = 0;
  callZoomApply();
}
callZoomBox.addEventListener("wheel", (e) => {
  if ($("callVideo").hidden) return;
  e.preventDefault();
  const r = callZoomBox.getBoundingClientRect();
  callZoomTo(callZoom.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
callZoomBox.addEventListener("pointerdown", (e) => {
  if (callZoom.z <= 1 || e.button !== 0) return;
  callZoom.drag = { px: e.clientX, py: e.clientY, x: callZoom.x, y: callZoom.y };
  callZoomBox.setPointerCapture(e.pointerId);
  callZoomApply();
});
callZoomBox.addEventListener("pointermove", (e) => {
  if (!callZoom.drag) return;
  callZoom.x = callZoom.drag.x + e.clientX - callZoom.drag.px;
  callZoom.y = callZoom.drag.y + e.clientY - callZoom.drag.py;
  callZoomClamp();
  callZoomApply();
});
const callZoomDrop = () => { if (callZoom.drag) { callZoom.drag = null; callZoomApply(); } };
callZoomBox.addEventListener("pointerup", callZoomDrop);
callZoomBox.addEventListener("pointercancel", callZoomDrop);
window.addEventListener("resize", () => { callZoomClamp(); callZoomApply(); });
document.addEventListener("keydown", (e) => {
  if ($("callStage").hidden || $("callVideo").hidden || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.key === "+" || e.key === "=") callZoomTo(callZoom.z * 1.4);
  else if (e.key === "-") callZoomTo(callZoom.z / 1.4);
  else if (e.key === "0" && callZoom.z > 1) callZoomTo(1);
  else return;
  e.preventDefault();
});
callZoomApply();
