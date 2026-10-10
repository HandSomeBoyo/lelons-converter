// Calls in private chats and group chats, with screen sharing. A call is a "room": the apps ring each
// other and swap how to reach each other through the library (lelons_room), then the sound and the
// shared screens go straight between them (WebRTC). In a group call everyone connects to everyone.
// Uses $, api(), clock() from app.js, sfxUser(), avatarEl(), sfxLoggedOut(), openLogin() from sfx.js,
// chatSoundOn(), chatIsOpen(), onlineInfo, chatPrivate, chatGroups, drawRoom/roomDrawn from chat.js,
// loadPref()/savePref() from theme.js and playedMedia from volume.js.

const CALL_ICONS = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>',
  hangUp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-3.3 0-6.4 1-8.9 2.9-.6.4-.8 1.2-.5 1.9l1.1 2.1c.4.7 1.2 1 1.9.7l2.6-1.1c.6-.2 1-.8.9-1.5l-.2-1.6A11.6 11.6 0 0 1 12 12a11.6 11.6 0 0 1 3.1.4l-.2 1.6c-.1.7.3 1.3.9 1.5l2.6 1.1c.7.3 1.5 0 1.9-.7l1.1-2.1c.3-.7.1-1.5-.5-1.9A14.6 14.6 0 0 0 12 9z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21M4 4l16 16"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4.5" height="6.5" rx="1.6"/><rect x="16" y="14" width="4.5" height="6.5" rx="1.6"/></svg>',
  deafened: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 13.7-5.6M20 12v3"/><rect x="3.5" y="14" width="4.5" height="6.5" rx="1.6"/><path d="M16 17.5v-2.3M20.5 19a1.6 1.6 0 0 1-1.6 1.5H17M3 3l18 18"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4M12 13V7.5M9.5 10 12 7.5l2.5 2.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
  big: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  small: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>',
};
const CALL_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
// Screen sharing: how sharp, and how smooth. Bits per second at 30 frames a second.
const SHARE_SIZES = [360, 480, 720, 1080, 1440];
const SHARE_RATES = [15, 30, 60];
const SHARE_BITRATE = { 360: 700000, 480: 1100000, 720: 2500000, 1080: 4500000, 1440: 8000000 };

// The call you're in, or that's ringing you:
// {id, key ("username" or "g:<group id>"), title, pictureUrl, group, startedBy, phase, status, people, startedAt}
// phase: "incoming" (ringing you), "joining" (getting your microphone), "in" (you're in it), "ended".
let call = null;
const callPeers = new Map(); // lowercased username -> {name, pc, dc, audioTx, videoTx, audio, video, sharing, muted, deafened, ...}
let callMicStream = null;
let callScreen = null;
let callMuted = false;
let callDeafened = false;
let callSignalAfter = 0;
let callTimer = null;
let callBusy = false;
let callWatching = ""; // whose screen is on the stage
let callStageSmall = false;
let callLiveGroups = []; // group calls going on in your groups: [{group, room, people}]
const callIgnored = new Set(); // ringing calls you declined, or that ended here
const lower = (name) => String(name || "").toLowerCase();

function callIsLive() { return !!call && call.phase !== "ended"; }
// In a call in this chat ("username" or "g:<group id>")?
function callWith(key) { return callIsLive() && call.phase !== "incoming" && lower(call.key) === lower(key); }
// A group call going on in this group (that you may join): {room, people}
function callLiveIn(key) { return String(key || "").startsWith("g:") ? callLiveGroups.find((g) => "g:" + g.group === key) || null : null; }
function callMe() { return sfxUser() ? sfxUser().username : ""; }

// ---- checking: every few seconds while logged in, more often in a call

function pollCalls(delay) {
  clearTimeout(callTimer);
  callTimer = setTimeout(checkCalls, delay);
}

async function callApi(body) {
  return api("/api/sfx-call", { after: callSignalAfter, ...body })
    .catch(() => ({ ok: false, error: "The call didn't go through. Check your internet connection." }));
}

async function checkCalls() {
  if (!sfxUser()) {
    if (callIsLive()) callFinish("You were logged out.");
    return pollCalls(5000);
  }
  if (callBusy) return pollCalls(1000);
  callBusy = true;
  try {
    const res = await callApi({ what: "check" });
    if (res && !sfxLoggedOut(res) && res.ok) callCame(res);
  } finally {
    callBusy = false;
    pollCalls(callIsLive() && call.phase !== "incoming" ? 1500 : 3000);
  }
}

const CALL_ENDED = {
  declined: (name) => `${name} can't talk right now.`,
  cancelled: () => "Call ended.",
  missed: () => "No answer.",
};

// What the library said: your calls, who's in them, and offers and answers for you.
function callCame(res) {
  const groupsBefore = JSON.stringify(callLiveGroups);
  callLiveGroups = res.live_groups || [];
  if (groupsBefore !== JSON.stringify(callLiveGroups)) callRedrawRoom();
  const rooms = res.rooms || [];
  if (callIsLive() && call.id && call.phase !== "joining") { // (while joining, the library may not know yet)
    const r = rooms.find((x) => x.id === call.id);
    if (call.phase === "incoming") {
      if (!r || !r.live || r.my_state !== "ringing") callFinish(call.group ? "" : r && r.my_state === "missed" ? "Missed call." : "");
    } else if (!r || !r.live || r.my_state !== "in") {
      const name = call.group ? "" : call.title;
      return callFinish(r && r.why && !call.group && !call.everTalked ? (CALL_ENDED[r.why] || CALL_ENDED.missed)(name) : "Call ended.");
    } else {
      callPeopleChanged(r.people || []);
    }
  }
  for (const s of res.signals || []) {
    callSignalAfter = Math.max(callSignalAfter, s.id);
    if (callIsLive() && call.phase === "in" && s.room === call.id) callSignal(s);
  }
  if (!callIsLive()) {
    const ringing = rooms.find((r) => r.live && r.my_state === "ringing" && !callIgnored.has(r.id));
    if (ringing) callIncoming(ringing);
  }
}

// ---- starting, answering and leaving

// Call someone, or the group ("g:<group id>"). A group call that's already going is joined.
async function callStart(key) {
  if (!sfxUser()) return openLogin("login");
  if (callIsLive() && call.phase !== "incoming") return callWith(key) ? null : callSay("Hang up first: you're already in a call.");
  const isGroup = String(key).startsWith("g:");
  const live = callLiveIn(key);
  if (live) return callJoin(live.room, key);
  if (!isGroup) {
    const online = onlineInfo && onlineInfo.people;
    if (online && !online.some((p) => lower(p.username) === lower(key))) {
      call = callFresh(key, null);
      return callFinish(`${key} isn't online right now. They need the app open to get your call.`);
    }
  }
  if (call && call.phase === "incoming") callDecline();
  call = callFresh(key, null);
  call.phase = "joining";
  call.status = "Starting the call...";
  drawCall();
  const mine = call;
  if (!(await callGetMic())) return;
  if (call !== mine) return;
  const res = await callApi({ what: "start", with: key });
  if (call !== mine) {
    if (res.ok && res.room) callApi({ what: "leave", room: res.room });
    return;
  }
  if (sfxLoggedOut(res)) return callFinish("");
  if (!res.ok) return callFinish(res.error);
  call.id = res.room;
  callEntered(res);
}

// Answer a call that's ringing you, or join a group call.
async function callJoin(roomId, key) {
  if (callIsLive() && call.phase !== "incoming" && call.id !== roomId) return callSay("Hang up first: you're already in a call.");
  callRing(null);
  if (!call || call.id !== roomId) call = callFresh(key, roomId);
  call.phase = "joining";
  call.status = "Joining...";
  drawCall();
  const mine = call;
  if (!(await callGetMic())) {
    if (call === mine) callApi({ what: "leave", room: roomId });
    return;
  }
  if (call !== mine) return;
  const res = await callApi({ what: "join", room: roomId });
  if (call !== mine) return;
  if (sfxLoggedOut(res)) return callFinish("");
  if (!res.ok) return callFinish(res.error);
  callEntered(res);
}

function callFresh(key, id) {
  const group = String(key || "").startsWith("g:") ? (chatGroups.find((g) => "g:" + g.id === key) || null) : null;
  return {
    id, key, group, title: group ? group.name : key, pictureUrl: group ? group.pictureUrl : callFaceOf(key),
    phase: "joining", status: "", people: [], startedAt: 0, everTalked: false,
  };
}

// In the room now: ring them (or wait for others), and connect to whoever is already in.
function callEntered(res) {
  call.phase = "in";
  call.status = "";
  call.startedAt = call.startedAt || Date.now();
  clearInterval(call.clock);
  call.clock = setInterval(drawCallStatus, 1000);
  const r = (res.rooms || []).find((x) => x.id === call.id);
  if (r && r.group) call.group = { ...(call.group || {}), ...r.group };
  for (const s of res.signals || []) callSignalAfter = Math.max(callSignalAfter, s.id);
  callPeopleChanged(r ? r.people || [] : []);
  callRedrawRoom();
  pollCalls(800);
}

function callIncoming(r) {
  const key = r.group ? "g:" + r.group.id : r.started_by;
  call = callFresh(key, r.id);
  call.phase = "incoming";
  call.startedBy = r.started_by;
  if (r.group) call.group = { ...(call.group || {}), ...r.group, pictureUrl: r.group.pictureUrl || (call.group && call.group.pictureUrl) };
  call.title = r.group ? r.group.name : r.started_by;
  const starter = (r.people || []).find((p) => lower(p.username) === lower(r.started_by));
  call.pictureUrl = r.group ? call.group.pictureUrl : starter ? starter.avatarUrl : "";
  call.people = r.people || [];
  call.status = r.group ? `${r.started_by} started a call` : "is calling you";
  callRing("in");
  api("/api/sfx-call-ringing", {}).catch(() => {});
  drawCall();
}

function callDecline() {
  if (!call || call.phase !== "incoming") return;
  callApi({ what: "leave", room: call.id });
  callFinish("");
}

// Hang up. note: what to show for a moment after.
function callHangUp(note = "Call ended.") {
  if (!callIsLive()) return;
  for (const p of callPeers.values()) callSend(p, { bye: true });
  if (call.id) callApi({ what: "leave", room: call.id }).then(() => pollCalls(300));
  callFinish(note);
}

// The call is over here: let go of the microphone, the screen and every connection.
function callFinish(note) {
  if (!call) return;
  const was = call;
  if (was.id) callIgnored.add(was.id);
  callRing(null);
  clearInterval(was.clock);
  for (const name of [...callPeers.keys()]) callDropPeer(name);
  for (const stream of [callMicStream, callScreen]) if (stream) stream.getTracks().forEach((t) => t.stop());
  callMicStream = callScreen = null;
  callWatching = "";
  callPop(null);
  if (!note) { call = null; drawCall(); callRedrawRoom(); return; }
  call = { ...was, phase: "ended", status: note };
  drawCall();
  const ended = call;
  setTimeout(() => { if (call === ended) { call = null; drawCall(); } }, 3500);
  callRedrawRoom();
}

function callRedrawRoom() {
  if (typeof drawRoom === "function") { roomDrawn = ""; drawRoom(); }
}

// ---- your microphone and speakers

function callMicConstraints() {
  const id = loadPref("callMic");
  return { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { ideal: id } } : {}) } };
}

async function callGetMic() {
  const mine = call;
  try {
    callMicStream = await navigator.mediaDevices.getUserMedia(callMicConstraints());
  } catch (e) {
    if (call === mine) callFinish("Couldn't use your microphone. Check it's plugged in, and that Windows lets apps use it (Settings > Privacy > Microphone).");
    return false;
  }
  if (call !== mine) { callMicStream.getTracks().forEach((t) => t.stop()); callMicStream = null; return false; }
  callMicStream.getAudioTracks().forEach((t) => { t.enabled = !callMuted && !callDeafened; });
  callWatchSpeaking("", callMicStream);
  return true;
}

// Switch to another microphone in the middle of a call.
async function callUseMic(id) {
  savePref("callMic", id || null);
  if (!callIsLive() || !callMicStream) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(callMicConstraints());
  } catch (e) {
    return callSay("Couldn't use that microphone.");
  }
  const old = callMicStream;
  callMicStream = stream;
  stream.getAudioTracks().forEach((t) => { t.enabled = !callMuted && !callDeafened; });
  for (const p of callPeers.values()) if (p.audioTx) p.audioTx.sender.replaceTrack(stream.getAudioTracks()[0]).catch(() => {});
  old.getTracks().forEach((t) => t.stop());
  callWatchSpeaking("", stream);
}

function callUseSpeaker(id) {
  savePref("callSpeaker", id || null);
  for (const p of callPeers.values()) callSetSpeaker(p.audio);
}
function callSetSpeaker(audio) {
  const id = loadPref("callSpeaker");
  if (audio.setSinkId) audio.setSinkId(id || "").catch(() => audio.setSinkId("").catch(() => {}));
}

function callMute() {
  if (callDeafened) { callDeafen(); return; } // (undeafen turns your microphone back on too, like Discord)
  callMuted = !callMuted;
  callApplyMic();
}
// Deafen: you hear nobody, and nobody hears you.
function callDeafen() {
  callDeafened = !callDeafened;
  for (const p of callPeers.values()) p.audio.muted = callDeafened;
  callApplyMic();
}
function callApplyMic() {
  if (callMicStream) callMicStream.getAudioTracks().forEach((t) => { t.enabled = !callMuted && !callDeafened; });
  for (const p of callPeers.values()) callSend(p, { muted: callMuted || callDeafened, deafened: callDeafened });
  drawCall();
}

// ---- the connections (one per person in the call)

// Who's in changed: connect to newcomers (the one whose name sorts first starts), drop who left.
function callPeopleChanged(people) {
  call.people = people;
  const me = lower(callMe());
  const inside = new Set(people.filter((p) => p.state === "in").map((p) => lower(p.username)));
  inside.delete(me);
  if (inside.size) call.everTalked = true;
  for (const name of [...callPeers.keys()]) if (!inside.has(name)) callDropPeer(name);
  for (const name of inside) {
    const p = callPeers.get(name);
    const failed = p && (p.pc.connectionState === "failed" || (p.offeredAt && !p.answered && Date.now() - p.offeredAt > 20000));
    if (failed) callDropPeer(name);
    if ((!p || failed) && me < name) callOffer(people.find((x) => lower(x.username) === name).username);
  }
  const ringing = people.some((p) => p.state === "ringing" && lower(p.username) !== me);
  if (!call.group) callRing(!inside.size && ringing ? "out" : null);
  drawCall();
}

function callPeer(name) {
  const key = lower(name);
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  const audio = new Audio();
  audio.autoplay = true;
  audio.muted = callDeafened;
  callSetSpeaker(audio);
  const p = { name, pc, audio, video: null, dc: null, sharing: false, muted: false, deafened: false, connected: false };
  callPeers.set(key, p);
  pc.ontrack = (e) => {
    if (callPeers.get(key) !== p) return;
    const stream = new MediaStream([e.track]);
    if (e.track.kind === "audio") {
      audio.srcObject = stream;
      audio.play().catch(() => {});
      audio.volume = 1; // (calls are as loud as they come, whatever the app's volume)
      playedMedia.delete(audio);
      callWatchSpeaking(key, stream);
    } else {
      p.video = stream;
      drawCall();
    }
  };
  pc.ondatachannel = (e) => callChannel(p, e.channel);
  pc.onconnectionstatechange = () => {
    if (callPeers.get(key) !== p) return;
    p.connected = pc.connectionState === "connected";
    if (pc.connectionState === "failed" && !callPeers.size) callSay(CALL_NO_ROUTE);
    drawCall();
  };
  return p;
}
const CALL_NO_ROUTE = "The call couldn't connect. A strict network (like school or work Wi-Fi) can block calls.";

function callDropPeer(key) {
  const p = callPeers.get(key);
  if (!p) return;
  callPeers.delete(key);
  try { if (p.dc) p.dc.close(); } catch (e) { /* closed */ }
  try { p.pc.close(); } catch (e) { /* closed */ }
  p.audio.srcObject = null;
  callSpeaking.delete(key);
  if (callWatching === key) callWatching = "";
  drawCall();
}

// Your sound, and your screen if you're sharing it, for one person.
function callAddMyTracks(p, offering) {
  const micTrack = callMicStream && callMicStream.getAudioTracks()[0];
  const screenTrack = callScreen && callScreen.getVideoTracks()[0];
  if (offering) {
    p.audioTx = p.pc.addTransceiver(micTrack || "audio", { direction: "sendrecv" });
    p.videoTx = p.pc.addTransceiver(screenTrack || "video", { direction: "sendrecv" });
  } else {
    for (const t of p.pc.getTransceivers()) {
      const kind = t.receiver.track && t.receiver.track.kind;
      if (kind === "audio" && !p.audioTx) p.audioTx = t;
      if (kind === "video" && !p.videoTx) p.videoTx = t;
    }
    if (p.audioTx) { p.audioTx.direction = "sendrecv"; if (micTrack) p.audioTx.sender.replaceTrack(micTrack); }
    if (p.videoTx) { p.videoTx.direction = "sendrecv"; if (screenTrack) p.videoTx.sender.replaceTrack(screenTrack); }
  }
}

async function callOffer(name) {
  const p = callPeer(name);
  p.offeredAt = Date.now();
  callAddMyTracks(p, true);
  callChannel(p, p.pc.createDataChannel("call"));
  const mine = call;
  try {
    await p.pc.setLocalDescription(await p.pc.createOffer());
    await callGathered(p.pc);
  } catch (e) {
    return callDropPeer(lower(name));
  }
  if (call !== mine || callPeers.get(lower(name)) !== p) return;
  p.offeredAt = Date.now();
  const res = await callApi({ what: "signal", room: call.id, to: name, kind: "offer", sdp: p.pc.localDescription.sdp });
  if (!res.ok && callPeers.get(lower(name)) === p) callDropPeer(lower(name));
  if (callScreen) callShareBitrate(p);
}

async function callSignal(s) {
  const key = lower(s.from);
  if (s.kind === "answer") {
    const p = callPeers.get(key);
    if (!p || p.answered) return;
    p.answered = true;
    p.pc.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => callDropPeer(key));
    return;
  }
  // An offer: a new connection (or a fresh one, if theirs broke).
  callDropPeer(key);
  const p = callPeer(s.from);
  p.answered = true;
  const mine = call;
  try {
    await p.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
    callAddMyTracks(p, false);
    await p.pc.setLocalDescription(await p.pc.createAnswer());
    await callGathered(p.pc);
  } catch (e) {
    return callDropPeer(key);
  }
  if (call !== mine || callPeers.get(key) !== p) return;
  callApi({ what: "signal", room: call.id, to: s.from, kind: "answer", sdp: p.pc.localDescription.sdp });
  if (callScreen) callShareBitrate(p);
}

// Wait until the app knows all the ways it can be reached (at most 4 seconds), so one offer or answer is enough.
function callGathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((done) => {
    const check = () => { if (pc.iceGatheringState === "complete") finish(); };
    const finish = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); done(); };
    const timer = setTimeout(finish, 4000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

// Small messages straight to one person: muted, deafened, sharing their screen, bye.
function callChannel(p, dc) {
  p.dc = dc;
  dc.onopen = () => callSend(p, { muted: callMuted || callDeafened, deafened: callDeafened, sharing: !!callScreen });
  dc.onmessage = (e) => {
    if (callPeers.get(lower(p.name)) !== p) return;
    let msg = {};
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.bye) return callDropPeer(lower(p.name));
    if ("muted" in msg) p.muted = !!msg.muted;
    if ("deafened" in msg) p.deafened = !!msg.deafened;
    if ("sharing" in msg) {
      const started = !p.sharing && msg.sharing;
      p.sharing = !!msg.sharing;
      if (started && (!callWatching || !callPeers.has(callWatching))) { callWatching = lower(p.name); callStageSmall = false; }
      if (!p.sharing && callWatching === lower(p.name)) callWatching = "";
    }
    drawCall();
  };
}

function callSend(p, msg) {
  try { if (p.dc && p.dc.readyState === "open") p.dc.send(JSON.stringify(msg)); } catch (e) { /* closed */ }
}

// ---- who's talking (a ring around their picture)

let callAudioCtx = null;
const callSpeaking = new Map(); // "" (you) or lowercased username -> {analyser, data, on}
function callWatchSpeaking(key, stream) {
  try {
    callAudioCtx = callAudioCtx || new AudioContext();
    if (callAudioCtx.state === "suspended") callAudioCtx.resume().catch(() => {});
    const analyser = callAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    callAudioCtx.createMediaStreamSource(stream).connect(analyser);
    callSpeaking.set(key, { analyser, data: new Uint8Array(analyser.fftSize), on: false, quietSince: 0 });
  } catch (e) { /* no rings, no problem */ }
}
setInterval(() => {
  if (!callIsLive() || call.phase !== "in") return;
  let changed = false;
  for (const [key, s] of callSpeaking) {
    s.analyser.getByteTimeDomainData(s.data);
    let sum = 0;
    for (const v of s.data) sum += (v - 128) * (v - 128);
    const loud = Math.sqrt(sum / s.data.length) > 6 && !(key === "" ? callMuted || callDeafened : (callPeers.get(key) || {}).muted);
    const now = Date.now();
    if (loud) s.quietSince = 0; else if (!s.quietSince) s.quietSince = now;
    const on = loud || (s.on && now - s.quietSince < 350);
    if (on !== s.on) { s.on = on; changed = true; }
  }
  if (changed) drawCallPeople();
}, 120);

// ---- sharing your screen

function callQuality() {
  const q = loadPref("callQuality") || {};
  return { size: SHARE_SIZES.includes(q.size) ? q.size : 720, fps: SHARE_RATES.includes(q.fps) ? q.fps : 30 };
}

async function callShare() {
  if (!callIsLive() || call.phase !== "in") return;
  const q = callQuality();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { height: { ideal: q.size, max: q.size }, frameRate: { ideal: q.fps, max: q.fps } }, audio: false,
    });
  } catch (e) {
    return; // (picked nothing)
  }
  if (!callIsLive() || call.phase !== "in") return stream.getTracks().forEach((t) => t.stop());
  const track = stream.getVideoTracks()[0];
  track.contentHint = q.fps >= 60 ? "motion" : "detail";
  const old = callScreen;
  callScreen = stream;
  track.addEventListener("ended", () => { if (callScreen === stream) callStopShare(); });
  for (const p of callPeers.values()) {
    if (p.videoTx) p.videoTx.sender.replaceTrack(track).catch(() => {});
    callShareBitrate(p);
    if (!old) callSend(p, { sharing: true });
  }
  if (old) old.getTracks().forEach((t) => t.stop());
  callPop(null);
  drawCall();
}

function callShareBitrate(p) {
  if (!p.videoTx) return;
  const q = callQuality();
  const params = p.videoTx.sender.getParameters();
  if (!params.encodings || !params.encodings[0]) return;
  params.encodings[0].maxBitrate = Math.round(SHARE_BITRATE[q.size] * (q.fps >= 60 ? 1.5 : q.fps <= 15 ? 0.6 : 1));
  params.encodings[0].maxFramerate = q.fps;
  p.videoTx.sender.setParameters(params).catch(() => {});
}

// A new quality: saved for next time, and used right away if you're sharing.
function callSetQuality(change) {
  const q = { ...callQuality(), ...change };
  savePref("callQuality", q);
  if (callScreen) {
    const track = callScreen.getVideoTracks()[0];
    track.applyConstraints({ height: { ideal: q.size, max: q.size }, frameRate: { ideal: q.fps, max: q.fps } }).catch(() => {});
    track.contentHint = q.fps >= 60 ? "motion" : "detail";
    for (const p of callPeers.values()) callShareBitrate(p);
  }
  drawCallPop();
}

function callStopShare() {
  if (!callScreen) return;
  callScreen.getTracks().forEach((t) => t.stop());
  callScreen = null;
  for (const p of callPeers.values()) {
    if (p.videoTx) p.videoTx.sender.replaceTrack(null).catch(() => {});
    callSend(p, { sharing: false });
  }
  callPop(null);
  drawCall();
}

// ---- ringing (made here, so there are no sound files)

let callRingCtx = null;
let callRingTimer = null;
let callRinging = null;
function callRing(kind) {
  if (kind === callRinging) return;
  callRinging = kind;
  clearInterval(callRingTimer);
  callRingTimer = null;
  if (!kind) return;
  const beep = (notes) => {
    try {
      callRingCtx = callRingCtx || new AudioContext();
      if (callRingCtx.state === "suspended") callRingCtx.resume().catch(() => {});
      const now = callRingCtx.currentTime;
      for (const [freq, at, length] of notes) {
        const osc = callRingCtx.createOscillator(), gain = callRingCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(kind === "in" ? 0.16 : 0.06, now + at + 0.02);
        gain.gain.setValueAtTime(kind === "in" ? 0.16 : 0.06, now + at + length - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
        osc.connect(gain).connect(callRingCtx.destination);
        osc.start(now + at);
        osc.stop(now + at + length + 0.02);
      }
    } catch (e) { /* no sound, no problem */ }
  };
  // Incoming: a bright two-note ring. Outgoing: a soft, low "ringing" tone.
  const pattern = kind === "in"
    ? [[988, 0, 0.16], [1319, 0.18, 0.16], [988, 0.42, 0.16], [1319, 0.6, 0.22]]
    : [[425, 0, 1.0]];
  if (kind === "in" && !chatSoundOn()) return;
  beep(pattern);
  callRingTimer = setInterval(() => beep(pattern), kind === "in" ? 2400 : 3200);
}

// ---- drawing

function callFaceOf(username) {
  const known = [...((onlineInfo && onlineInfo.people) || []), ...chatPrivate].find((p) => lower(p.username) === lower(username));
  return known ? known.avatarUrl || "" : "";
}

function callSay(text) {
  const note = $("chatNote");
  if (note && chatIsOpen()) note.textContent = text;
  else alert(text);
}

function callOthersIn() {
  if (!call) return [];
  const me = lower(callMe());
  return (call.people || []).filter((p) => p.state === "in" && lower(p.username) !== me);
}

function drawCallStatus() {
  if (!call) return;
  let status = call.status;
  if (call.phase === "in" && !status) {
    const others = callOthersIn();
    const ringing = (call.people || []).some((p) => p.state === "ringing" && lower(p.username) !== lower(callMe()));
    if (!others.length) status = call.group ? (ringing ? "Ringing the group..." : "Waiting for others to join...") : "Ringing...";
    else if (!call.group && !callPeers.size) status = "Connecting...";
    else if (![...callPeers.values()].some((p) => p.connected)) status = "Connecting...";
    else status = clock(Math.floor((Date.now() - call.startedAt) / 1000), false)
      + (call.group ? ` · ${others.length + 1} in the call` : "");
  }
  $("callStatus").textContent = status;
}

// The faces of the people in the call: a ring when they talk, a small icon when they're muted or deafened.
let callPeopleDrawn = "";
function drawCallPeople() {
  const box = $("callPeople");
  if (!call || call.phase !== "in") { box.replaceChildren(); callPeopleDrawn = ""; return; }
  const me = callMe();
  const people = [{ username: me, avatarUrl: (sfxUser() || {}).avatarUrl || "", me: true }, ...callOthersIn()];
  const rows = people.map((person) => {
    const key = person.me ? "" : lower(person.username);
    const p = person.me ? null : callPeers.get(key);
    const muted = person.me ? callMuted || callDeafened : p && p.muted;
    const deafened = person.me ? callDeafened : p && p.deafened;
    const speaking = (callSpeaking.get(key) || {}).on && !muted;
    const waiting = !person.me && !(p && p.connected);
    return { person, muted, deafened, speaking, waiting, sharing: person.me ? !!callScreen : p && p.sharing };
  });
  const sig = JSON.stringify(rows.map((r) => [r.person.username, r.person.avatarUrl, r.muted, r.deafened, r.speaking, r.waiting, r.sharing]));
  if (sig === callPeopleDrawn) return;
  callPeopleDrawn = sig;
  box.replaceChildren(...rows.map((r) => {
    const el = document.createElement("span");
    el.className = "call-person" + (r.speaking ? " speaking" : "") + (r.waiting ? " waiting" : "");
    el.title = (r.person.me ? "You" : r.person.username) + (r.deafened ? " (deafened)" : r.muted ? " (muted)" : "")
      + (r.sharing ? ", sharing their screen" : "") + (r.waiting ? ", connecting..." : "");
    el.append(avatarEl(r.person.avatarUrl, r.person.username));
    if (r.muted || r.deafened) el.append(Object.assign(document.createElement("i"), { className: "call-person-icon", innerHTML: r.deafened ? CALL_ICONS.deafened : CALL_ICONS.micOff }));
    else if (r.sharing) el.append(Object.assign(document.createElement("i"), { className: "call-person-icon live", innerHTML: CALL_ICONS.screen }));
    return el;
  }));
}

let callDrawn = "";
function drawCall() {
  const box = $("callBox");
  box.hidden = !call;
  document.body.classList.toggle("in-call", !!call);
  if (!call) { callDrawn = ""; $("callStage").hidden = true; callPop(null); return; }
  drawCallStatus();
  drawCallPeople();
  drawCallStage();
  const sig = JSON.stringify([call.phase, call.title, call.pictureUrl, callMuted, callDeafened, !!callScreen, call.status, !!call.group, callPopOpen]);
  if (sig === callDrawn) return;
  callDrawn = sig;
  box.className = "call call-" + call.phase + (call.group ? " call-group" : "");
  $("callFace").replaceChildren(avatarEl(call.pictureUrl, call.title, call.group ? "group-avatar" : ""));
  $("callName").textContent = call.title;
  const button = (cls, icon, label, fn, text) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "call-btn " + cls;
    b.title = label;
    b.innerHTML = icon;
    if (text) b.append(Object.assign(document.createElement("span"), { textContent: text }));
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(e); });
    return b;
  };
  const buttons = [];
  if (call.phase === "incoming") {
    buttons.push(button("red", CALL_ICONS.hangUp, "Decline", callDecline, "Decline"));
    buttons.push(button("green", CALL_ICONS.phone, call.group ? "Join the call" : "Answer", () => callJoin(call.id, call.key), call.group ? "Join" : "Answer"));
  } else if (call.phase !== "ended") {
    if (call.phase === "in") {
      buttons.push(button(callMuted || callDeafened ? "off" : "", callMuted || callDeafened ? CALL_ICONS.micOff : CALL_ICONS.mic,
        callMuted || callDeafened ? "Unmute" : "Mute", callMute));
      buttons.push(button(callDeafened ? "off" : "", callDeafened ? CALL_ICONS.deafened : CALL_ICONS.headphones,
        callDeafened ? "Undeafen" : "Deafen (hear nobody, and nobody hears you)", callDeafen));
      buttons.push(button((callScreen ? "on" : "") + (callPopOpen === "share" ? " open" : ""), CALL_ICONS.screen,
        callScreen ? "Your screen: quality, change it, or stop sharing" : "Share your screen", () => callPop("share")));
      buttons.push(button(callPopOpen === "settings" ? "open" : "", CALL_ICONS.gear, "Microphone and speakers", () => callPop("settings")));
    }
    buttons.push(button("red", CALL_ICONS.hangUp, call.phase === "in" && !callOthersIn().length && !call.group ? "Cancel" : "Hang up", () => callHangUp()));
  }
  $("callButtons").replaceChildren(...buttons);
  $("callSharing").hidden = !callScreen;
}

// Someone's shared screen: big in the middle, or small in the corner. With more than one, pick whose.
function drawCallStage() {
  const stage = $("callStage");
  const sharing = [...callPeers.values()].filter((p) => p.sharing && p.video);
  if (call && call.phase === "in" && sharing.length && !sharing.some((p) => lower(p.name) === callWatching)) callWatching = lower(sharing[0].name);
  const watched = sharing.find((p) => lower(p.name) === callWatching);
  stage.hidden = !(call && call.phase === "in" && watched);
  if (stage.hidden) { if ($("callVideo").srcObject) $("callVideo").srcObject = null; return; }
  if ($("callVideo").srcObject !== watched.video) { $("callVideo").srcObject = watched.video; $("callVideo").play().catch(() => {}); }
  stage.classList.toggle("small", callStageSmall);
  $("callStageLabel").textContent = `${watched.name}'s screen`;
  $("callStageSize").innerHTML = callStageSmall ? CALL_ICONS.big : CALL_ICONS.small;
  $("callStageSize").title = callStageSmall ? "Make it big" : "Make it smaller";
  const tabs = $("callStageTabs");
  const sig = JSON.stringify([sharing.map((p) => p.name), callWatching]);
  if (tabs.dataset.sig !== sig) {
    tabs.dataset.sig = sig;
    tabs.replaceChildren(...(sharing.length > 1 ? sharing.map((p) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: lower(p.name) === callWatching ? "on" : "", textContent: p.name });
      b.addEventListener("click", () => { callWatching = lower(p.name); drawCall(); });
      return b;
    }) : []));
  }
}

// ---- the little windows under the call card: screen sharing, and microphone and speakers

let callPopOpen = null; // "share", "settings" or null
function callPop(which) {
  callPopOpen = which && callPopOpen !== which ? which : null;
  $("callPop").hidden = !callPopOpen;
  callDrawn = "";
  if (callPopOpen) drawCallPop();
  if (call) drawCall();
}

async function drawCallPop() {
  const box = $("callPop");
  if (!callPopOpen) return;
  const which = callPopOpen;
  const title = (text) => Object.assign(document.createElement("h4"), { textContent: text });
  const chips = (values, current, label, pick) => {
    const row = document.createElement("div");
    row.className = "call-chips";
    for (const v of values) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: v === current ? "on" : "", textContent: label(v) });
      b.addEventListener("click", () => pick(v));
      row.append(b);
    }
    return row;
  };
  const els = [];
  if (which === "share") {
    const q = callQuality();
    els.push(title("Screen quality"));
    els.push(chips(SHARE_SIZES, q.size, (v) => v + "p", (v) => callSetQuality({ size: v })));
    els.push(title("Smoothness"));
    els.push(chips(SHARE_RATES, q.fps, (v) => v + " fps", (v) => callSetQuality({ fps: v })));
    els.push(Object.assign(document.createElement("p"), {
      className: "call-pop-note",
      textContent: q.size >= 1080 || q.fps >= 60 ? "Sharper and smoother needs a faster internet connection" + (callOthersIn().length > 1 ? ", and more for every person watching." : ".")
        : "Lower is easier on slow internet.",
    }));
    const actions = document.createElement("div");
    actions.className = "call-pop-actions";
    if (callScreen) {
      const change = Object.assign(document.createElement("button"), { type: "button", className: "small-button", textContent: "Change screen" });
      change.addEventListener("click", () => callShare());
      const stop = Object.assign(document.createElement("button"), { type: "button", className: "outline-button call-stop", textContent: "Stop sharing" });
      stop.addEventListener("click", callStopShare);
      actions.append(change, stop);
    } else {
      const go = Object.assign(document.createElement("button"), { type: "button", className: "small-button", textContent: "Share your screen" });
      go.addEventListener("click", () => callShare());
      actions.append(go);
    }
    els.push(actions);
  } else {
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) { /* none listed */ }
    if (callPopOpen !== which) return;
    const select = (kind, pref, label, use) => {
      const sel = document.createElement("select");
      sel.className = "call-select";
      const list = devices.filter((d) => d.kind === kind && d.deviceId !== "communications");
      sel.append(new Option("Windows default", ""));
      list.filter((d) => d.deviceId !== "default").forEach((d, i) => sel.append(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
      sel.value = loadPref(pref) || "";
      if (sel.value !== (loadPref(pref) || "")) sel.value = "";
      sel.addEventListener("change", () => use(sel.value));
      return sel;
    };
    els.push(title("Microphone"), select("audioinput", "callMic", "Microphone", callUseMic));
    els.push(title("Speakers or headphones"), select("audiooutput", "callSpeaker", "Speakers", callUseSpeaker));
  }
  box.replaceChildren(...els);
}

$("callStageSize").addEventListener("click", () => { callStageSmall = !callStageSmall; drawCall(); });
$("callStageFull").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $("callStage").requestFullscreen().catch(() => {});
});
$("callVideo").addEventListener("dblclick", () => $("callStageFull").click());
$("callStopShare").addEventListener("click", callStopShare);
$("callPop").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => { if (callPopOpen) callPop(null); });
window.addEventListener("pagehide", () => { if (callIsLive()) callHangUp(); });

pollCalls(2500);
