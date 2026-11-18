// Voice on the phone: calls with friends, group calls and server voice channels, talking to the same
// lelons_room function as the PC app (see call.js in the PC app: same offers, answers and "call" data channel).
// The phone sends and hears sound, and can watch a shared screen. (No camera or screen sharing from the phone yet.)
"use strict";

const CALL_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const CALL_VERSION = 1;  // (2 would ask for a camera lane, which the phone doesn't have)

let call = null;          // {id, key, title, sub, phase: "incoming"|"joining"|"in", people, startedAt, big, startedBy}
const peers = new Map();  // lower(username) -> {name, pc, audio, video, dc, muted, sharing, connected, ...}
let signalAfter = 0;
let callTimer = null;
let mic = null;           // your microphone
let muted = false, deafened = false;
let ignored = new Set();  // calls you declined
let watching = "";        // whose screen is open
let audioCtx = null;
const talking = new Set();

const CALL_ERRORS = {
  yourself: "You can't call yourself.",
  slow: "Slow down a little! Wait a moment before calling again.",
  daily: "You've made a lot of calls today. Try again tomorrow.",
  in_call: "You're already in a call. Hang up first.",
  busy: "They're in another call right now.",
  gone: "That call already ended.",
  full: "That call is full (9 people at most).",
};

const CI = {
  mic: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>',
  head: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/></svg>',
  headOff: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/><path d="M3 3l18 18"/></svg>',
  end: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-5 0V16l-3 1.5z"/></svg>',
  answer: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  down: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  phone: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
};

function myName() { return S.me ? S.me.username : ""; }
function callLive() { return !!call && ["incoming", "joining", "in"].includes(call.phase); }

async function roomApi(args) {
  try {
    const r = await rpcMe("lelons_room", { after: signalAfter, room_id: null, with_user: null, to_user: null, kind: null, sdp: null, ...args });
    return r || { ok: false };
  } catch (e) {
    return { ok: false, error: e.message || "The call didn't go through. Check your internet connection." };
  }
}

// ---------------------------------------------------------------- checking (every few seconds)

function pollCalls(ms) {
  clearTimeout(callTimer);
  callTimer = setTimeout(checkCalls, ms);
}

async function checkCalls() {
  if (!S.token || !S.me) return pollCalls(5000);
  if (document.hidden && !callLive()) return pollCalls(15000);
  const res = await roomApi({ what: "check" });
  if (res.ok) cameIn(res);
  pollCalls(callLive() && call.phase !== "incoming" ? 1500 : 4000);
}

function cameIn(res) {
  const rooms = res.rooms || [];
  if (callLive() && call.id && call.phase !== "joining") {
    const r = rooms.find((x) => x.id === call.id);
    if (call.phase === "incoming") {
      if (!r || !r.live || r.my_state !== "ringing") finish(r && r.my_state === "missed" ? "Missed call." : "");
    } else if (!r || !r.live || r.my_state !== "in") {
      return finish("Call ended.");
    } else {
      peopleChanged(r.people || []);
    }
  }
  for (const s of res.signals || []) {
    signalAfter = Math.max(signalAfter, s.id);
    if (callLive() && call.phase === "in" && s.room === call.id) gotSignal(s);
  }
  if (!callLive()) {
    const ringing = rooms.find((r) => r.live && r.my_state === "ringing" && !ignored.has(r.id));
    if (ringing) incoming(ringing);
  }
}

// ---------------------------------------------------------------- starting, answering, leaving

// key: a username, or "g:<group or voice channel id>". title/sub: what the call screen shows.
async function startCall(key, title, sub) {
  if (callLive() && call.phase !== "incoming") {
    if (lower(call.key) === lower(key)) { call.big = true; return drawCall(); }
    return toast("Hang up first: you're already in a call.");
  }
  if (call && call.phase === "incoming") decline();
  call = fresh(key, null, title, sub);
  call.status = "Starting the call...";
  drawCall();
  const mine = call;
  if (!(await getMic())) return;
  if (call !== mine) return;
  const res = await roomApi({ what: "start", with_user: key });
  if (call !== mine) { if (res.ok && res.room) roomApi({ what: "leave", room_id: res.room }); return; }
  if (!res.ok) return finish(res.error === "offline" ? `${title} isn't online right now.` : CALL_ERRORS[res.error] || res.error || "The call didn't work. Try again.");
  call.id = res.room;
  entered(res);
}

async function answer() {
  if (!call || call.phase !== "incoming") return;
  const mine = call;
  call.phase = "joining";
  call.status = "Joining...";
  drawCall();
  if (!(await getMic())) { roomApi({ what: "leave", room_id: mine.id }); return; }
  if (call !== mine) return;
  const res = await roomApi({ what: "join", room_id: call.id });
  if (call !== mine) return;
  if (!res.ok) return finish(CALL_ERRORS[res.error] || "The call didn't work. Try again.");
  entered(res);
}

function decline() {
  if (!call || call.phase !== "incoming") return;
  ignored.add(call.id);
  roomApi({ what: "leave", room_id: call.id });
  finish("");
}

function hangUp() {
  if (!callLive()) return;
  if (call.phase === "incoming") return decline();
  for (const p of peers.values()) send(p, { bye: true });
  if (call.id) roomApi({ what: "leave", room_id: call.id }).then(() => pollCalls(300));
  finish("Call ended.");
}

function fresh(key, id, title, sub) {
  return { id, key, title: title || key, sub: sub || "", phase: "joining", status: "", people: [], startedAt: 0, big: true };
}

function entered(res) {
  call.phase = "in";
  call.status = "";
  call.startedAt = call.startedAt || Date.now();
  const r = (res.rooms || []).find((x) => x.id === call.id);
  for (const s of res.signals || []) signalAfter = Math.max(signalAfter, s.id);
  peopleChanged(r ? r.people || [] : []);
  drawCall();
  pollCalls(800);
}

function incoming(r) {
  const key = r.group ? "g:" + r.group.id : r.started_by;
  const title = r.group ? (r.group.server_name ? r.group.name : r.group.name) : r.started_by;
  call = fresh(key, r.id, title, r.group ? `${r.started_by} started a call` : "is calling you");
  call.phase = "incoming";
  call.startedBy = r.started_by;
  call.people = r.people || [];
  call.big = true;
  if (navigator.vibrate) navigator.vibrate([300, 200, 300]);
  drawCall();
}

function finish(note) {
  const was = call;
  for (const key of [...peers.keys()]) dropPeer(key);
  if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
  talking.clear();
  watching = "";
  call = null;
  if (was && was.big && note) toast(note);
  drawCall();
}

async function getMic() {
  if (mic) return true;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    applyMic();
    watchTalking(lower(myName()), mic);
    return true;
  } catch {
    finish("");
    toast("VaultHub needs your microphone for calls. Allow it in Settings > Safari (or Settings > VaultHub) and try again.");
    return false;
  }
}

function applyMic() {
  if (mic) mic.getAudioTracks().forEach((t) => { t.enabled = !(muted || deafened); });
  for (const p of peers.values()) { p.audio.muted = deafened; send(p, { muted: muted || deafened, deafened }); }
}

function toggleMute() {
  if (deafened) { deafened = false; muted = false; } else muted = !muted;
  applyMic(); drawCall();
}
function toggleDeafen() {
  deafened = !deafened;
  applyMic(); drawCall();
}

// ---------------------------------------------------------------- the connections (one per person)

// Who's in changed: connect to newcomers (the one whose name sorts first makes the offer), drop who left.
function peopleChanged(people) {
  call.people = people;
  const me = lower(myName());
  const inside = new Set(people.filter((p) => p.state === "in").map((p) => lower(p.username)));
  inside.delete(me);
  for (const name of [...peers.keys()]) if (!inside.has(name)) dropPeer(name);
  for (const name of inside) {
    const p = peers.get(name);
    const failed = p && (p.pc.connectionState === "failed" || (p.lostSince && Date.now() - p.lostSince > 6000) || (p.offeredAt && !p.answered && Date.now() - p.offeredAt > 20000));
    if (failed) dropPeer(name);
    if ((!p || failed) && me < name) offer(people.find((x) => lower(x.username) === name).username);
  }
  drawCall();
}

function makePeer(name) {
  const key = lower(name);
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  audio.muted = deafened;
  const p = { name, pc, audio, video: null, dc: null, muted: false, deafened: false, sharing: false, connected: false };
  peers.set(key, p);
  pc.ontrack = (e) => {
    if (peers.get(key) !== p) return;
    const stream = new MediaStream([e.track]);
    if (e.track.kind === "audio") {
      audio.srcObject = stream;
      audio.play().catch(() => {});
      watchTalking(key, stream);
    } else if (!p.video) {
      p.video = stream;  // (the first video lane is their screen)
      drawCall();
    }
  };
  pc.ondatachannel = (e) => channel(p, e.channel);
  pc.onconnectionstatechange = () => {
    if (peers.get(key) !== p) return;
    p.connected = pc.connectionState === "connected";
    if (p.connected) p.lostSince = 0;
    else if (pc.connectionState === "disconnected" && !p.lostSince) p.lostSince = Date.now();
    drawCall();
  };
  return p;
}

function dropPeer(key) {
  const p = peers.get(key);
  if (!p) return;
  peers.delete(key);
  try { if (p.dc) p.dc.close(); } catch { /* closed */ }
  try { p.pc.close(); } catch { /* closed */ }
  p.audio.srcObject = null;
  talking.delete(key);
  if (watching === key) watching = "";
  drawCall();
}

function addMyTracks(p, offering) {
  const track = mic && mic.getAudioTracks()[0];
  if (offering) {
    p.audioTx = p.pc.addTransceiver(track || "audio", { direction: "sendrecv" });
    p.videoTx = p.pc.addTransceiver("video", { direction: "sendrecv" });  // (their screen comes in here)
  } else {
    for (const t of p.pc.getTransceivers()) {
      const kind = t.receiver.track && t.receiver.track.kind;
      if (kind === "audio" && !p.audioTx) p.audioTx = t;
    }
    if (p.audioTx) { p.audioTx.direction = "sendrecv"; if (track) p.audioTx.sender.replaceTrack(track); }
  }
}

async function offer(name) {
  const p = makePeer(name);
  p.offeredAt = Date.now();
  addMyTracks(p, true);
  channel(p, p.pc.createDataChannel("call"));
  const mine = call;
  try {
    await p.pc.setLocalDescription(await p.pc.createOffer());
    await gathered(p.pc);
  } catch { return dropPeer(lower(name)); }
  if (call !== mine || peers.get(lower(name)) !== p) return;
  p.offeredAt = Date.now();
  const res = await roomApi({ what: "signal", room_id: call.id, to_user: name, kind: "offer", sdp: p.pc.localDescription.sdp });
  if (!res.ok && peers.get(lower(name)) === p) dropPeer(lower(name));
}

async function gotSignal(s) {
  const key = lower(s.from);
  if (s.kind === "answer") {
    const p = peers.get(key);
    if (!p || p.answered) return;
    p.answered = true;
    p.pc.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => dropPeer(key));
    return;
  }
  dropPeer(key);
  const p = makePeer(s.from);
  p.answered = true;
  const mine = call;
  try {
    await p.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
    addMyTracks(p, false);
    await p.pc.setLocalDescription(await p.pc.createAnswer());
    await gathered(p.pc);
  } catch { return dropPeer(key); }
  if (call !== mine || peers.get(key) !== p) return;
  roomApi({ what: "signal", room_id: call.id, to_user: s.from, kind: "answer", sdp: p.pc.localDescription.sdp });
}

// Wait until all the ways to reach this phone are known (at most 4 seconds), so one offer or answer is enough.
function gathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((done) => {
    const check = () => { if (pc.iceGatheringState === "complete") end(); };
    const end = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); done(); };
    const timer = setTimeout(end, 4000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

// Small messages straight to one person: muted, deafened, sharing their screen, bye.
function channel(p, dc) {
  p.dc = dc;
  dc.onopen = () => send(p, { hello: CALL_VERSION, muted: muted || deafened, deafened, sharing: false, camera: false, recording: false });
  dc.onmessage = (e) => {
    if (peers.get(lower(p.name)) !== p) return;
    let msg = {};
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.bye) {
      const who = (call && call.people || []).find((x) => lower(x.username) === lower(p.name));
      if (who) who.state = "left";
      return dropPeer(lower(p.name));
    }
    if (msg.sdp) laneSignal(p, msg.sdp);
    if ("muted" in msg) p.muted = !!msg.muted;
    if ("deafened" in msg) p.deafened = !!msg.deafened;
    if ("sharing" in msg) { p.sharing = !!msg.sharing; if (!p.sharing && watching === lower(p.name)) watching = ""; }
    drawCall();
  };
}

// (The PC app can send a new offer over the data channel for its camera lane. Answer it so the call keeps working.)
async function laneSignal(p, desc) {
  if (!desc || (desc.type !== "offer" && desc.type !== "answer") || typeof desc.sdp !== "string") return;
  try {
    await p.pc.setRemoteDescription(desc);
    if (desc.type === "offer") {
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      send(p, { sdp: { type: "answer", sdp: p.pc.localDescription.sdp } });
    }
  } catch { /* sound keeps working */ }
}

function send(p, msg) {
  try { if (p.dc && p.dc.readyState === "open") p.dc.send(JSON.stringify(msg)); } catch { /* closed */ }
}

// Who's talking: a green ring around their picture.
function watchTalking(key, stream) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!callLive()) return;
      if (key !== lower(myName()) && !peers.has(key)) return;
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += (v - 128) * (v - 128);
      const loud = Math.sqrt(sum / data.length) > 6 && !(key === lower(myName()) && (muted || deafened));
      if (loud !== talking.has(key)) {
        if (loud) talking.add(key); else talking.delete(key);
        const el = document.querySelector(`[data-face="${CSS.escape(key)}"]`);
        if (el) el.classList.toggle("talking", loud);
      }
      setTimeout(tick, 150);
    };
    tick();
  } catch { /* no green rings, sound still works */ }
}

// ---------------------------------------------------------------- the call screen

function drawCall() {
  let el = document.getElementById("call");
  if (!callLive()) {
    if (el) el.remove();
    document.body.classList.remove("in-call");
    callBar();
    return;
  }
  document.body.classList.toggle("in-call", call.phase !== "incoming");
  if (!call.big) { if (el) el.remove(); callBar(); return; }
  callBar();
  if (!el) {
    el = document.createElement("div");
    el.id = "call";
    document.body.appendChild(el);
    el.onclick = onCallClick;
  }
  const me = lower(myName());
  if (call.phase === "incoming") {
    el.innerHTML = `<div class="call-in">
      <div class="call-title"><div class="sm muted">${esc(call.sub)}</div><b>${esc(call.title)}</b></div>
      <div class="call-face">${avatar(call.startedBy || call.title, faceOf(call.startedBy), { big: true })}</div>
      <div class="call-btns"><button class="cb red" data-c="decline">${CI.end}</button><button class="cb green" data-c="answer">${CI.answer}</button></div>
      <div class="call-labels"><span>Decline</span><span>${call.key.startsWith("g:") ? "Join" : "Answer"}</span></div></div>`;
    return;
  }
  const inside = (call.people || []).filter((p) => p.state === "in");
  if (!inside.some((p) => lower(p.username) === me) && call.phase === "in") inside.unshift({ username: myName(), avatar: S.me && S.me.avatar });
  const ringing = (call.people || []).filter((p) => p.state === "ringing" && lower(p.username) !== me);
  const sharer = [...peers.values()].find((p) => p.sharing && p.video);
  const watch = watching && peers.get(watching);
  const clock = call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0;
  el.innerHTML = `<div class="call-in">
    <div class="call-top"><button data-c="small" aria-label="Make small">${CI.down}</button></div>
    <div class="call-title"><div class="sm muted">${esc(call.sub)}</div><b>${esc(call.title)}</b>
      <div class="sm" style="color:var(--green);margin-top:2px">${call.phase === "joining" ? esc(call.status || "Joining...") : `● <span id="callClock">${fmtClock(clock)}</span>`}</div></div>
    ${watch && watch.video ? `<div class="call-screen"><video id="shareVideo" autoplay playsinline muted></video><button class="btn2" data-c="unwatch">Stop watching</button></div>` : `
    <div class="call-grid ${inside.length > 4 ? "many" : ""}">${inside.map((p) => {
      const key = lower(p.username), peer = peers.get(key);
      const isMe = key === me;
      const state = isMe ? (deafened ? "🔇 deafened" : muted ? "🔇 muted" : "") : peer ? (peer.deafened ? "🔇 deafened" : peer.muted ? "🔇 muted" : peer.connected ? "" : "connecting...") : "connecting...";
      return `<div class="call-card"><div class="face ${talking.has(key) ? "talking" : ""}" data-face="${esc(key)}">${avatar(p.username, publicUrl(p.avatar), { big: true })}</div>
        <div class="nm">${isMe ? "You" : esc(p.username)}</div><div class="sm muted">${esc(state) || "&nbsp;"}</div></div>`;
    }).join("")}</div>
    ${ringing.length && !inside.some((p) => lower(p.username) !== me) ? `<div class="sm muted" style="text-align:center">Ringing ${esc(ringing.map((p) => p.username).join(", "))}...</div>` : ""}
    ${sharer ? `<button class="card row call-share" data-c="watch" data-who="${esc(lower(sharer.name))}"><div class="thumb"></div><div class="grow" style="text-align:left"><b class="sm">${esc(sharer.name)} is sharing a screen</b><div class="sm muted">Tap to watch</div></div></button>` : ""}`}
    <div style="flex:1"></div>
    <div class="call-btns">
      <button class="cb ${muted || deafened ? "on" : ""}" data-c="mute" aria-label="Mute">${muted || deafened ? CI.micOff : CI.mic}</button>
      <button class="cb ${deafened ? "on" : ""}" data-c="deafen" aria-label="Deafen">${deafened ? CI.headOff : CI.head}</button>
      <button class="cb red" data-c="hangup" aria-label="Hang up">${CI.end}</button>
    </div></div>`;
  const v = document.getElementById("shareVideo");
  if (v && watch && watch.video) { v.srcObject = watch.video; v.play().catch(() => {}); }
}

function fmtClock(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function faceOf(name) {
  const p = (call && call.people || []).find((x) => lower(x.username) === lower(name));
  return p ? publicUrl(p.avatar) : "";
}

function onCallClick(e) {
  const b = e.target.closest("[data-c]");
  if (!b) return;
  const c = b.dataset.c;
  if (c === "answer") answer();
  else if (c === "decline") decline();
  else if (c === "hangup") hangUp();
  else if (c === "mute") toggleMute();
  else if (c === "deafen") toggleDeafen();
  else if (c === "small") { call.big = false; drawCall(); }
  else if (c === "watch") { watching = b.dataset.who; drawCall(); }
  else if (c === "unwatch") { watching = ""; drawCall(); }
}

// The green bar at the top of every page while you're in a call (tap it to open the call).
function callBar() {
  document.querySelectorAll(".callbar").forEach((b) => b.remove());
  if (!callLive() || call.big || call.phase === "incoming") return;
  const screen = document.querySelector("#app .screen");
  if (!screen) return;
  const bar = document.createElement("button");
  bar.className = "callbar";
  bar.innerHTML = `<span class="dotg"></span><b class="grow one">${esc(call.title)}</b><span>${muted || deafened ? "Muted · " : ""}Tap to open</span>`;
  bar.onclick = () => { call.big = true; drawCall(); };
  screen.insertBefore(bar, screen.firstChild);
}

// Called by app.js after it draws a page.
function callAfterRender() { callBar(); }

setInterval(() => {
  const c = document.getElementById("callClock");
  if (c && call && call.startedAt) c.textContent = fmtClock(Math.floor((Date.now() - call.startedAt) / 1000));
}, 1000);

// Closing the app (or it going away): out of the call right away.
window.addEventListener("pagehide", () => {
  if (!callLive() || !call.id || !S.token) return;
  try {
    fetch(`${SUPA}/rest/v1/rpc/lelons_room`, {
      method: "POST", keepalive: true, headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ token: S.token, what: call.phase === "incoming" ? "leave" : "leave", room_id: call.id }),
    });
  } catch { /* gone anyway */ }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollCalls(200); });

pollCalls(1500);
