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
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></svg>',
  cameraOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h3a2.5 2.5 0 0 1 2.5 2.5v2l6-3.5v10l-2.4-1.4M15.5 15.5A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 6M3 3l18 18"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><path d="M15 15.5v4.5M18 14v6"/></svg>',
  rec: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
  big: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  small: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>',
};
const CALL_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
// Screen sharing: how sharp, and how smooth. Bits per second at 30 frames a second.
const SHARE_SIZES = [360, 480, 720, 1080, 1440];
const SHARE_RATES = [15, 30, 60];
const SHARE_BITRATE = { 360: 700000, 480: 1100000, 720: 2500000, 1080: 4500000, 1440: 8000000 };
const CALL_VERSION = 2; // 2: cameras (each connection gets a camera lane once both apps know about cameras)

// The call you're in, or that's ringing you:
// {id, key ("username" or "g:<group id>"), title, pictureUrl, group, startedBy, phase, status, people, startedAt}
// phase: "incoming" (ringing you), "joining" (getting your microphone), "in" (you're in it), "ended".
let call = null;
const callPeers = new Map(); // lowercased username -> {name, pc, dc, audioTx, videoTx, camTx, audio, video, cam, sharing, camera, muted, deafened, ...}
let callMicStream = null; // your microphone (after noise suppression)
let callSendStream = null; // what the others hear from you: your microphone with sound board sounds and PC sound mixed in (callplus.js)
let callMicParts = null; // {raw, ctx, node}: the microphone itself, and the noise suppression in between
let callCam = null; // your camera, when it's on
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
    if (res && res.ok && res.move && typeof srvMovedTo === "function") srvMovedTo(res.move.channel, res.move.by);
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
  let group = String(key || "").startsWith("g:") ? (chatGroups.find((g) => "g:" + g.id === key) || null) : null;
  const vc = typeof srvChannelOf === "function" ? srvChannelOf(key) : null; // (a server's voice channel)
  if (vc) group = { id: vc.id, name: `${vc.name} · ${srv.name}`, pictureUrl: srv.pictureUrl || "", server: srv.id };
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
  call.heard = null; // (who's in, for the join and leave sounds: set at the first count, so only newcomers ding)
  callSound("join");
  clearInterval(call.clock);
  call.clock = setInterval(drawCallStatus, 1000);
  const r = (res.rooms || []).find((x) => x.id === call.id);
  if (r && r.group) call.group = { ...(call.group || {}), ...r.group };
  for (const s of res.signals || []) callSignalAfter = Math.max(callSignalAfter, s.id);
  callPeopleChanged(r ? r.people || [] : []);
  callRedrawRoom();
  callPttRun();
  callLinesRun();
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
  if (typeof notifyAdd === "function") notifyAdd({ key: "call:" + r.id, stamp: 1, kind: "calls", now: true, quiet: true,
    title: r.group ? `${r.started_by} started a call` : `${r.started_by} is calling you`,
    text: r.group ? `In ${r.group.name}. Click to join.` : "Click to answer.", pic: call.pictureUrl, open: { chat: key } });
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
  if (call.id) callApi({ what: "leave", room: call.id }).then(() => { pollCalls(300); if (typeof srvPoll === "function") srvPoll(200); });
  callFinish(note);
}

// The call is over here: let go of the microphone, the screen and every connection.
function callFinish(note) {
  if (!call) return;
  const was = call;
  if (was.phase === "in") callSound("leave");
  if (was.id) callIgnored.add(was.id);
  callRing(null);
  clearInterval(was.clock);
  callRecStop(); // (a recording going on is saved)
  for (const name of [...callPeers.keys()]) callDropPeer(name);
  callMixStop();
  callMicClose(callMicStream, callMicParts);
  for (const key of [...callSpeaking.keys()]) callStopWatching(key);
  if (callAudioCtx && callAudioCtx.state === "running") callAudioCtx.suspend().catch(() => {});  // (resumed by the next call)
  for (const stream of [callScreen, callCam]) if (stream) stream.getTracks().forEach((t) => t.stop());
  callMicStream = callMicParts = callSendStream = callScreen = callCam = null;
  callWatching = "";
  callPttRun();
  callLinesRun();
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

// What the sound quality and Music mode choices say about themselves.
function callBitrateNote(kbps) {
  const what = kbps <= 32 ? "Like a phone call (calls used this before). Uses the least internet."
    : kbps <= 64 ? "A clear voice. Good for slow Wi-Fi."
    : kbps <= 96 ? "A clear, natural voice."
    : kbps <= 128 ? "A full, rich voice. Best for most calls."
    : kbps <= 256 ? "Very detailed. Great together with Music mode."
    : "The most detail there is. Needs good internet, and more for every person in a group call.";
  return what;
}
const AUDIO_MUSIC_NOTES = {
  off: "Your voice is cleaned up: echo cancelling, steady volume and noise suppression.",
  on: "Stereo, and no cleanup at all, for music, singing or game sound through your microphone. Use headphones so others don't hear themselves.",
};
const AUDIO_MUSIC_NOISE = "Off in Music mode, so your music comes through clean.";

// Noise suppression: "off", "standard" (the one built into Windows' browser engine), "strong" (RNNoise, an AI
// that keeps only voices), "max" (GTCRN, a newer AI for really loud places) or "deep" (DeepFilterNet 3, the
// best sounding AI, but it needs more of the computer). All run on your computer.
const NOISE_LEVELS = ["off", "standard", "strong", "max", "deep"];
const NOISE_NAMES = { off: "Off", standard: "Standard", strong: "Strong", max: "Max", deep: "DeepFilter" };
const NOISE_NOTES = {
  off: "Others hear everything your microphone picks up.",
  standard: "Takes away steady hum, like a fan.",
  strong: "AI that keeps your voice and takes away keyboard clicks, fans and background noise.",
  max: "A stronger AI, for loud places. Your voice may sound a little less natural.",
  deep: "The best sounding AI (DeepFilterNet). Takes away more noise and keeps your voice natural, but uses more of your computer. Takes a second to start.",
};
function callNoise() {
  const level = loadPref("callNoise");
  return NOISE_LEVELS.includes(level) ? level : "strong";
}

// Sound quality: how much detail your voice gets, in kilobits a second to each person (you pick it;
// 128 unless you do). Music mode sends stereo with no cleanup at all, for music, singing or a game's
// sound through your microphone.
const AUDIO_RATES = [32, 64, 96, 128, 192, 256, 320, 510];
function callBitrate() {
  const kbps = Number(loadPref("callBitrate"));
  return AUDIO_RATES.includes(kbps) ? kbps : 128;
}
function callMusicOn() { return loadPref("callMusic") === true; }
// Noise suppression is off in music mode (it would cut the music out), so that's what's really used.
function callNoiseUsed() { return callMusicOn() ? "off" : callNoise(); }

function callMicConstraints() {
  const id = loadPref("callMic");
  const device = id ? { deviceId: { ideal: id } } : {};
  if (callMusicOn()) {
    // Exactly what the microphone hears, in stereo if it can: no echo cancelling, no auto volume, no cleanup.
    return { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, ...device } };
  }
  return { audio: { echoCancellation: true, noiseSuppression: callNoise() === "standard", autoGainControl: true, sampleRate: { ideal: 48000 }, ...device } };
}

// The apps agree on how sound is sent in their offer and answer. Opus (the sound format) is told it may
// send stereo, and it may use lots of detail when it sends to them; how much it really uses is set per
// person with callAudioBitrate. Ours only says we can take stereo, so an older app doesn't send more.
function callTuneSdp(sdp, theirs) {
  const want = { stereo: "1", "sprop-stereo": "1", useinbandfec: "1", ...(theirs ? { maxaveragebitrate: "510000" } : {}) };
  for (const [, pt] of sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000/gim)) {
    const line = new RegExp(`^a=fmtp:${pt} (.*)$`, "m");
    const found = sdp.match(line);
    const params = new Map();
    for (const part of (found ? found[1] : "").split(";")) {
      const bit = part.trim();
      if (!bit) continue;
      const at = bit.indexOf("=");
      params.set(at < 0 ? bit : bit.slice(0, at), at < 0 ? "" : bit.slice(at + 1));
    }
    for (const [k, v] of Object.entries(want)) params.set(k, v);
    const fmtp = `a=fmtp:${pt} ` + [...params].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join(";");
    sdp = found ? sdp.replace(line, fmtp) : sdp.replace(new RegExp(`^(a=rtpmap:${pt} opus\\/48000.*)$`, "im"), `$1\r\n${fmtp}`);
  }
  return sdp;
}
function callSetLocal(pc, desc) { return pc.setLocalDescription({ type: desc.type, sdp: callTuneSdp(desc.sdp, false) }); }
function callSetRemote(pc, desc) { return pc.setRemoteDescription({ type: desc.type, sdp: callTuneSdp(desc.sdp, true) }); }

// How much detail your voice gets to one person (it can change in the middle of a call). Your voice also
// goes first when the internet is busy, before shared screens and cameras.
function callAudioBitrate(p) {
  // (one change at a time: two at once make the browser turn one down)
  p.audioRate = (p.audioRate || Promise.resolve()).then(() => callAudioBitrateNow(p)).catch(() => {});
}
async function callAudioBitrateNow(p, again) {
  if (!p.audioTx) return;
  const params = p.audioTx.sender.getParameters();
  if (!params.encodings || !params.encodings[0]) return;
  // (when they lose a lot of what you send, less gets through better: at most 48 kbps until it's fine again)
  params.encodings[0].maxBitrate = (p.weak ? Math.min(callBitrate(), 48) : callBitrate()) * 1000;
  params.encodings[0].priority = "high";
  params.encodings[0].networkPriority = "high";
  try {
    await p.audioTx.sender.setParameters(params);
  } catch (e) {
    if (!again) return callAudioBitrateNow(p, true);
  }
}

// Your microphone, cleaned up: {stream (to send), parts}. Throws if there's no microphone.
// (3.0) Windows gives each sound device a new id every time VaultHub starts (the ids belong to the app's
// address, which changes each start), so a saved choice was lost. Its name is saved too now, and the
// device is found again by its name.
const CALL_DEVICE_PREFS = { callMic: "audioinput", callSpeaker: "audiooutput", callCam: "videoinput" };
function callMatchDevices(list) {
  let speaker = false;
  for (const [pref, kind] of Object.entries(CALL_DEVICE_PREFS)) {
    const id = loadPref(pref);
    if (!id) continue;
    const mine = list.filter((d) => d.kind === kind);
    const same = mine.find((d) => d.deviceId === id);
    if (same) {
      if (same.label && loadPref(pref + "Name") !== same.label) savePref(pref + "Name", same.label);
      continue;
    }
    const name = loadPref(pref + "Name");
    const found = name && mine.find((d) => d.label === name && d.deviceId !== "default" && d.deviceId !== "communications");
    if (found) { savePref(pref, found.deviceId); if (pref === "callSpeaker") speaker = true; }
  }
  if (speaker && typeof appSpeakerChanged === "function") appSpeakerChanged();
  return list;
}
async function callFindDevices(unlock) {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch { return; }
  const lost = Object.entries(CALL_DEVICE_PREFS).some(([pref, kind]) => loadPref(pref) && !list.some((d) => d.kind === kind && d.deviceId === loadPref(pref)));
  if (unlock && lost && list.every((d) => !d.label)) {  // (the names only show once the microphone was used)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      list = await navigator.mediaDevices.enumerateDevices();
    } catch { /* no microphone */ }
  }
  callMatchDevices(list);
}
callFindDevices(false);
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener("devicechange", () => callFindDevices(false));

async function callOpenMic() {
  await callFindDevices(true);
  const raw = await navigator.mediaDevices.getUserMedia(callMicConstraints());
  const level = callNoiseUsed();
  if (level !== "strong" && level !== "max" && level !== "deep") return { stream: raw, parts: { raw } };
  // DeepFilter falls back to Strong (RNNoise) if it can't start here, and that falls back to the built-in one.
  const kinds = level === "deep" ? ["deepfilter", "rnnoise"] : [level === "max" ? "gtcrn" : "rnnoise"];
  for (const kind of kinds) {
    let ctx = null;
    try {
      ctx = new AudioContext({ sampleRate: 48000 }); // (all the AIs work on 48 kHz sound)
      const node = await callNoiseNode(ctx, kind);
      const out = ctx.createMediaStreamDestination();
      out.channelCount = 1;
      ctx.createMediaStreamSource(raw).connect(node).connect(out);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return { stream: out.stream, parts: { raw, ctx, node } };
    } catch (e) {
      // (let go of its sound engine and try the next one)
      if (ctx) ctx.close().catch(() => {});
    }
  }
  // No AI could start here: use the built-in one instead.
  raw.getAudioTracks().forEach((t) => t.applyConstraints({ ...callMicConstraints().audio, noiseSuppression: true }).catch(() => {}));
  return { stream: raw, parts: { raw } };
}

// One noise suppression AI in a sound engine, ready to use.
async function callNoiseNode(ctx, kind) {
  if (kind === "deepfilter") {
    const [files] = await Promise.all([callDeepFilterFiles(), ctx.audioWorklet.addModule("noise/deepfilter.js")]);
    const node = new AudioWorkletNode(ctx, "vaulthub/deepfilter", {
      processorOptions: { wasmModule: files.wasmModule, model: files.model }, channelCount: 1, channelCountMode: "explicit",
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    });
    // (it takes a second or two to get going: wait, so a computer it can't run on gets RNNoise instead)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DeepFilter took too long")), 20000);
      node.port.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data && e.data.ready) resolve(); else reject(new Error((e.data && e.data.failed) || "DeepFilter failed"));
      };
    }).catch((e) => { try { node.port.postMessage("destroy"); } catch (x) { /* gone */ } throw e; });
    return node;
  }
  const [wasmBinary] = await Promise.all([callNoiseWasm(kind), ctx.audioWorklet.addModule(`noise/${kind}.js`)]);
  return new AudioWorkletNode(ctx, "@sapphi-red/web-noise-suppressor/" + kind, {
    processorOptions: { maxChannels: 1, wasmBinary }, channelCount: 1, channelCountMode: "explicit",
  });
}

const callNoiseFiles = {};
function callNoiseWasm(kind) {
  if (!callNoiseFiles[kind]) {
    // RNNoise has a faster build for computers that can do several sums at once (SIMD); nearly all can.
    const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    const file = kind === "rnnoise" ? (simd ? "rnnoise_simd.wasm" : "rnnoise.wasm") : kind + ".wasm";
    callNoiseFiles[kind] = fetch("noise/" + file).then((r) => {
      if (!r.ok) throw new Error("no " + file);
      return r.arrayBuffer();
    });
    callNoiseFiles[kind].catch(() => { delete callNoiseFiles[kind]; });
  }
  return callNoiseFiles[kind];
}

// DeepFilterNet: the program (made ready once, it's big) and its model.
let callDeepFilter = null;
function callDeepFilterFiles() {
  if (!callDeepFilter) {
    const get = (file) => fetch("noise/" + file).then((r) => {
      if (!r.ok) throw new Error("no " + file);
      return r.arrayBuffer();
    });
    callDeepFilter = Promise.all([get("deepfilter.wasm").then((b) => WebAssembly.compile(b)), get("deepfilter_model.tar.gz")])
      .then(([wasmModule, model]) => ({ wasmModule, model }));
    callDeepFilter.catch(() => { callDeepFilter = null; });
  }
  return callDeepFilter;
}

function callMicClose(stream, parts) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (!parts) return;
  if (parts.raw) parts.raw.getTracks().forEach((t) => t.stop());
  try { if (parts.node) parts.node.port.postMessage("destroy"); } catch (e) { /* gone */ }
  if (parts.ctx) parts.ctx.close().catch(() => {});
}

async function callGetMic() {
  const mine = call;
  let mic;
  try {
    mic = await callOpenMic();
  } catch (e) {
    if (call === mine) callFinish("Couldn't use your microphone. Check it's plugged in, and that Windows lets apps use it (Settings > Privacy > Microphone).");
    return false;
  }
  if (call !== mine) { callMicClose(mic.stream, mic.parts); return false; }
  callMicStream = mic.stream;
  callMicParts = mic.parts;
  callSendStream = callMixStart(callMicStream);
  callApplyGain();
  callHearSelfApply();
  callWatchSpeaking("", callSendStream);
  callPttRun();
  callLinesRun();
  return true;
}

// Switch to another microphone (or noise suppression) in the middle of a call.
async function callUseMic(id) {
  savePref("callMic", id || null);
  callFindDevices(false);  // (saves its name)
  if (typeof drawSoundSettings === "function") drawSoundSettings();
  await callReopenMic("Couldn't use that microphone.");
}
async function callSetNoise(level) {
  savePref("callNoise", level);
  drawCallPop();
  if (typeof drawSoundSettings === "function") drawSoundSettings();
  await callReopenMic("Couldn't restart your microphone.");
}
// A new sound quality: right away, for everyone in the call.
function callSetBitrate(kbps) {
  savePref("callBitrate", kbps);
  drawCallPop();
  if (typeof drawSoundSettings === "function") drawSoundSettings();
  for (const p of callPeers.values()) callAudioBitrate(p);
}
// Music mode on or off: the microphone opens again without (or with) the cleanup.
async function callSetMusic(on) {
  savePref("callMusic", !!on);
  drawCallPop();
  if (typeof drawSoundSettings === "function") drawSoundSettings();
  await callReopenMic("Couldn't restart your microphone.");
}
async function callReopenMic(problem) {
  if (!callIsLive() || !callMicStream) return;
  const mine = call;
  let mic;
  try {
    mic = await callOpenMic();
  } catch (e) {
    return callSay(problem);
  }
  if (call !== mine || !callMicStream) return callMicClose(mic.stream, mic.parts);
  const [oldStream, oldParts] = [callMicStream, callMicParts];
  callMicStream = mic.stream;
  callMicParts = mic.parts;
  if (!callMixMic(callMicStream)) {
    callSendStream = callMicStream;
    for (const p of callPeers.values()) if (p.audioTx) p.audioTx.sender.replaceTrack(callSendStream.getAudioTracks()[0]).then(() => callAudioBitrate(p), () => {});
    callWatchSpeaking("", callSendStream);
    callRecAdd("", callSendStream);
  }
  callApplyGain();
  callMicClose(oldStream, oldParts);
}

function callUseSpeaker(id) {
  savePref("callSpeaker", id || null);
  callFindDevices(false);
  for (const p of callPeers.values()) callSetSpeaker(p.audio);
  appSpeakerChanged(); // the rest of the app's sounds follow too
  if (typeof drawSoundSettings === "function") drawSoundSettings();
}
function callSetSpeaker(audio) {
  const id = loadPref("callSpeaker");
  if (audio.setSinkId) audio.setSinkId(id || "").catch(() => audio.setSinkId("").catch(() => {}));
}

function callMute() {
  if (callDeafened) { callDeafen(); return; } // (undeafen turns your microphone back on too, like Discord)
  callMuted = !callMuted;
  callSound(callMuted ? "mute" : "unmute");
  callApplyMic();
}
// Deafen: you hear nobody, and nobody hears you.
function callDeafen() {
  callDeafened = !callDeafened;
  callSound(callDeafened ? "deafen" : "undeafen");
  for (const p of callPeers.values()) callApplyVolume(p);
  for (const s of callBoardPlaying.values()) if (s.localGain) s.localGain.gain.value = callDeafened ? 0 : callBoardVolume();
  callHearSelfApply();
  callApplyMic();
}
function callApplyMic() {
  callApplyGain();
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
  if (call.heard) {
    if ([...inside].some((n) => !call.heard.has(n))) callSound("join");
    else if ([...call.heard].some((n) => !inside.has(n))) callSound("leave");
  }
  call.heard = new Set(inside);
  for (const name of [...callPeers.keys()]) if (!inside.has(name)) callDropPeer(name);
  for (const name of inside) {
    const p = callPeers.get(name);
    // (a connection that's been lost for 6 seconds starts over, instead of waiting half a minute for "failed")
    const failed = p && (p.pc.connectionState === "failed" || (p.lostSince && Date.now() - p.lostSince > 6000) || (p.offeredAt && !p.answered && Date.now() - p.offeredAt > 20000));
    if (failed) callDropPeer(name);
    if ((!p || failed) && me < name) callOffer(people.find((x) => lower(x.username) === name).username);
  }
  const ringing = people.some((p) => p.state === "ringing" && lower(p.username) !== me);
  if (!call.group) callRing(!inside.size && ringing ? "out" : null);
  if (callCam) for (const p of callPeers.values()) callCamBitrate(p);
  drawCall();
}

function callPeer(name) {
  const key = lower(name);
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  const audio = new Audio();
  audio.dataset.call = "1"; // (see volume.js: a call's sound doesn't stop the Library)
  audio.autoplay = true;
  audio.muted = callDeafened;
  callSetSpeaker(audio);
  const p = { name, pc, audio, video: null, cam: null, dc: null, sharing: false, camera: false, muted: false, deafened: false, connected: false };
  callPeers.set(key, p);
  pc.ontrack = (e) => {
    if (callPeers.get(key) !== p) return;
    const stream = new MediaStream([e.track]);
    if (e.track.kind === "audio") {
      audio.srcObject = stream;
      audio.play().catch(() => {});
      p.audioStream = stream;
      callApplyVolume(p); // (calls are as loud as they come, whatever the app's volume, unless you turn a person down)
      callRecAdd(key, stream);
      playedMedia.delete(audio);
      callWatchSpeaking(key, stream);
    } else if (callVideoLanes(pc).indexOf(e.transceiver) === 1) {
      p.cam = stream; // (the second video lane is their camera, the first their screen)
      drawCall();
    } else {
      p.video = stream;
      drawCall();
    }
  };
  pc.ondatachannel = (e) => callChannel(p, e.channel);
  pc.onconnectionstatechange = () => {
    if (callPeers.get(key) !== p) return;
    p.connected = pc.connectionState === "connected";
    if (p.connected) callAudioBitrate(p);
    if (p.connected) p.lostSince = 0;
    else if (pc.connectionState === "disconnected" && !p.lostSince) p.lostSince = Date.now();
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
  callVolumeDrop(p);
  callRecRemove(key);
  p.audio.srcObject = null;
  callStopWatching(key);
  if (callWatching === key) callWatching = "";
  drawCall();
}

// Your sound, and your screen if you're sharing it, for one person.
function callAddMyTracks(p, offering) {
  const micTrack = callSendStream && callSendStream.getAudioTracks()[0];
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
    await callSetLocal(p.pc, await p.pc.createOffer());
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
    callSetRemote(p.pc, { type: "answer", sdp: s.sdp }).then(() => callAudioBitrate(p), () => callDropPeer(key));
    return;
  }
  // An offer: a new connection (or a fresh one, if theirs broke).
  callDropPeer(key);
  const p = callPeer(s.from);
  p.answered = true;
  const mine = call;
  try {
    await callSetRemote(p.pc, { type: "offer", sdp: s.sdp });
    callAddMyTracks(p, false);
    await callSetLocal(p.pc, await p.pc.createAnswer());
    callAudioBitrate(p);
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

function callVideoLanes(pc) {
  return pc.getTransceivers().filter((t) => t.receiver.track && t.receiver.track.kind === "video");
}

// Cameras came in a later version, so the camera lane is added once both apps say they know about it (in
// "hello"), and the new offer and answer go straight between the two apps. The one who made the first offer does it.
async function callAddCameraLane(p) {
  if (p.camTx) return;
  const track = callCam && callCam.getVideoTracks()[0];
  p.camTx = p.pc.addTransceiver(track || "video", { direction: "sendrecv" });
  try {
    await callSetLocal(p.pc, await p.pc.createOffer());
    callSend(p, { sdp: { type: "offer", sdp: p.pc.localDescription.sdp } });
  } catch (e) { /* no camera with this person; sound and screens still work */ }
}

async function callLaneSignal(p, desc) {
  if (!desc || (desc.type !== "offer" && desc.type !== "answer") || typeof desc.sdp !== "string") return;
  try {
    await callSetRemote(p.pc, desc);
    if (desc.type === "offer") {
      p.camTx = callVideoLanes(p.pc)[1] || null;
      if (p.camTx) {
        p.camTx.direction = "sendrecv";
        const track = callCam && callCam.getVideoTracks()[0];
        if (track) await p.camTx.sender.replaceTrack(track);
      }
      await callSetLocal(p.pc, await p.pc.createAnswer());
      callSend(p, { sdp: { type: "answer", sdp: p.pc.localDescription.sdp } });
    }
    callCamBitrate(p);
    callAudioBitrate(p);
  } catch (e) { /* no camera with this person; sound and screens still work */ }
}

// Small messages straight to one person: muted, deafened, sharing their screen, camera on, bye.
function callChannel(p, dc) {
  p.dc = dc;
  dc.onopen = () => callSend(p, { hello: CALL_VERSION, muted: callMuted || callDeafened, deafened: callDeafened, sharing: !!callScreen, camera: !!callCam, recording: !!callRec });
  dc.onmessage = (e) => {
    if (callPeers.get(lower(p.name)) !== p) return;
    let msg = {};
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.bye) {
      // They left: off the call card and the voice channel list right away (not at the next check).
      const who = (call && call.people || []).find((x) => lower(x.username) === lower(p.name));
      if (who) who.state = "left";
      if (call && call.heard && call.heard.delete(lower(p.name))) callSound("leave");
      return callDropPeer(lower(p.name));
    }
    if (msg.hello >= 2 && lower(callMe()) < lower(p.name)) callAddCameraLane(p);
    if (msg.sdp) callLaneSignal(p, msg.sdp);
    if ("camera" in msg) p.camera = !!msg.camera;
    if ("muted" in msg) p.muted = !!msg.muted;
    if ("deafened" in msg) p.deafened = !!msg.deafened;
    if ("recording" in msg) { p.recording = !!msg.recording; callDrawn = ""; }
    if ("sharing" in msg) {
      const started = !p.sharing && msg.sharing;
      p.sharing = !!msg.sharing;
      if (started) callSound("shareThem");
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
    callAudioCtx = callAudioCtx || appSinkCtx(new AudioContext());
    if (callAudioCtx.state === "suspended") callAudioCtx.resume().catch(() => {});
    const analyser = callAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    const source = callAudioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    callStopWatching(key);
    callSpeaking.set(key, { source, analyser, data: new Uint8Array(analyser.fftSize), on: false, quietSince: 0 });
    callMeterOn();
  } catch (e) { /* no rings, no problem */ }
}
// Stop listening for someone's voice (they left, or your microphone changed): unplug it, or it keeps working.
function callStopWatching(key) {
  const s = callSpeaking.get(key);
  if (!s) return;
  callSpeaking.delete(key);
  try { s.source.disconnect(); } catch (e) { /* already */ }
}
// (only runs while someone's voice is being listened to: it used to wake the page 8 times a second all day)
let callMeter = 0;
function callMeterOn() { if (!callMeter) callMeter = setInterval(callMeterTick, 120); }
function callMeterTick() {
  if (!callSpeaking.size) { clearInterval(callMeter); callMeter = 0; return; }
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
  if (changed) { drawCallPeople(); drawCallTalking(); }
}

// ---- sharing your screen

function callQuality() {
  const q = loadPref("callQuality") || {};
  return { size: SHARE_SIZES.includes(q.size) ? q.size : 720, fps: SHARE_RATES.includes(q.fps) ? q.fps : 30 };
}

async function callShare() {
  if (!callIsLive() || call.phase !== "in") return;
  callPop(null);
  // (3.0.1) Our own picker (callshare.js) instead of the engine's "Choose what to share" window.
  const pick = await callSharePick();
  if (!pick || !callIsLive() || call.phase !== "in") return;
  const q = callQuality();
  const stream = await callShareStart(pick);
  if (!stream) return; // (picked nothing, or it didn't work)
  if (!callIsLive() || call.phase !== "in") return stream.getTracks().forEach((t) => t.stop());
  const track = stream.getVideoTracks()[0];
  track.contentHint = q.fps >= 60 ? "motion" : "detail";
  const old = callScreen;
  callScreen = stream;
  track.addEventListener("ended", () => { if (callScreen === stream) callStopShare(); });
  callMixScreen(stream.getAudioTracks()[0] || null); // your PC's sound goes out with your voice
  for (const p of callPeers.values()) {
    if (p.videoTx) p.videoTx.sender.replaceTrack(track).catch(() => {});
    callShareBitrate(p);
    if (!old) callSend(p, { sharing: true });
  }
  callShareSwapped(stream);
  if (old) old.getTracks().forEach((t) => t.stop());
  else callSound("shareOn");
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
    if (callShareRelayPc) api("/api/share-relay", { what: "quality", size: q.size, fps: q.fps }).catch(() => {});
  }
  drawCallPop();
}

function callStopShare() {
  if (!callScreen) return;
  callScreen.getTracks().forEach((t) => t.stop());
  callScreen = null;
  callSound("shareOff");
  api("/api/share-bar", { on: false }).catch(() => {});
  callShareOtherStop();
  callMixScreen(null);
  for (const p of callPeers.values()) {
    if (p.videoTx) p.videoTx.sender.replaceTrack(null).catch(() => {});
    callSend(p, { sharing: false });
  }
  callPop(null);
  drawCall();
}

// ---- your camera

function callCamConstraints() {
  const id = loadPref("callCam");
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, ...(id ? { deviceId: { ideal: id } } : {}) };
}

let callCamStarting = false;
async function callCamera() {
  if (!callIsLive() || call.phase !== "in" || callCamStarting) return;
  if (callCam) return callCamSet(null);
  callCamStarting = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: callCamConstraints() });
  } catch (e) {
    return callSay("Couldn't use your camera. Check it's plugged in, not open in another app, and that Windows lets apps use it (Settings > Privacy > Camera).");
  } finally {
    callCamStarting = false;
  }
  if (!callIsLive() || call.phase !== "in" || callCam) return stream.getTracks().forEach((t) => t.stop());
  callCamSet(stream);
}

// Send this camera (or none) to everyone.
function callCamSet(stream) {
  const old = callCam;
  callCam = stream;
  const track = stream ? stream.getVideoTracks()[0] : null;
  if (track) {
    track.contentHint = "motion";
    track.addEventListener("ended", () => { if (callCam === stream) callCamSet(null); });
  }
  for (const p of callPeers.values()) {
    if (p.camTx) p.camTx.sender.replaceTrack(track).catch(() => {});
    callCamBitrate(p);
    if (!old !== !stream) callSend(p, { camera: !!stream });
  }
  if (old && old !== stream) old.getTracks().forEach((t) => t.stop());
  drawCall();
}

async function callUseCam(id) {
  savePref("callCam", id || null);
  callFindDevices(false);
  if (!callCam) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: callCamConstraints() });
  } catch (e) {
    return callSay("Couldn't use that camera.");
  }
  if (!callCam) return stream.getTracks().forEach((t) => t.stop());
  callCamSet(stream);
}

// Cameras get less of your internet the more people there are (everyone gets their own copy).
function callCamBitrate(p) {
  if (!p.camTx) return;
  const params = p.camTx.sender.getParameters();
  if (!params.encodings || !params.encodings[0]) return;
  const others = callPeers.size;
  params.encodings[0].maxBitrate = others >= 4 ? 500000 : others >= 2 ? 900000 : 1500000;
  params.encodings[0].maxFramerate = 30;
  p.camTx.sender.setParameters(params).catch(() => {});
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
  if (!kind) {
    if (typeof notifyUnpop === "function") notifyUnpop((k) => k.startsWith("call:")); // (3.0) "calling you" goes once it stops ringing
    return;
  }
  const beep = (notes) => {
    try {
      callRingCtx = callRingCtx || appSinkCtx(new AudioContext());
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
    const bars = person.me ? 0 : p && p.connected ? p.bars || 3 : 0;
    const quiet = !person.me && callVolumeOf(key) === 0;
    return { person, key, muted, deafened, speaking, waiting, bars, quiet, rec: person.me ? !!callRec : p && p.recording, sharing: person.me ? !!callScreen : p && p.sharing };
  });
  const sig = JSON.stringify(rows.map((r) => [r.person.username, r.person.avatarUrl, r.muted, r.deafened, r.speaking, r.waiting, r.sharing, r.bars, r.quiet, r.rec]));
  if (sig === callPeopleDrawn) return;
  callPeopleDrawn = sig;
  box.replaceChildren(...rows.map((r) => {
    const el = document.createElement("span");
    el.className = "call-person" + (r.speaking ? " speaking" : "") + (r.waiting ? " waiting" : "");
    el.title = (r.person.me ? "You" : r.person.username) + (r.deafened ? " (deafened)" : r.muted ? " (muted)" : "")
      + (r.sharing ? ", sharing their screen" : "") + (r.waiting ? ", connecting..." : "");
    el.append(avatarEl(r.person.avatarUrl, r.person.username));
    if (!r.person.me) {
      // Click a friend: their volume, their connection, their profile.
      el.classList.add("pick");
      el.tabIndex = 0;
      el.title += " · click for volume";
      el.addEventListener("click", (e) => { e.stopPropagation(); callPop("person:" + r.key); });
      if (r.bars) el.append(callBarsEl(r.bars));
    }
    if (r.muted || r.deafened || r.quiet) el.append(Object.assign(document.createElement("i"), { className: "call-person-icon", innerHTML: r.deafened || r.quiet ? CALL_ICONS.deafened : CALL_ICONS.micOff }));
    else if (r.sharing) el.append(Object.assign(document.createElement("i"), { className: "call-person-icon live", innerHTML: CALL_ICONS.screen }));
    return el;
  }));
}

// The page moves down by the call card's height, so the card never covers what's under it.
let callCardSeen = null;
function callWatchCardHeight() {
  const card = document.querySelector("#callBox .call-card");
  if (!card || callCardSeen === card || typeof ResizeObserver === "undefined") return;
  callCardSeen = card;
  new ResizeObserver(() => {
    if (card.offsetHeight) document.documentElement.style.setProperty("--call-h", card.offsetHeight + "px");
  }).observe(card);
}

let callDrawn = "";
function drawCall() {
  const box = $("callBox");
  box.hidden = !call;
  document.body.classList.toggle("in-call", !!call);
  callWatchCardHeight();
  if (typeof srvDraw === "function") srvDraw(); // (servers: the "Voice connected" bar and who's in each voice channel)
  if (!call) { callDrawn = ""; $("callStage").hidden = true; drawCallTiles([], false); callPop(null); callStagePlace(false); return; }
  drawCallStatus();
  drawCallPeople();
  drawCallStage();
  const sig = JSON.stringify([call.phase, call.title, call.pictureUrl, callMuted, callDeafened, !!callScreen, !!callCam, call.status, !!call.group, callPopOpen, callRecClock(), callPtt().on]);
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
      buttons.push(button(callCam ? "on" : "", callCam ? CALL_ICONS.camera : CALL_ICONS.cameraOff,
        callCam ? "Turn your camera off" : "Turn your camera on", callCamera));
      buttons.push(button((callScreen ? "on" : "") + (callPopOpen === "share" ? " open" : ""), CALL_ICONS.screen,
        callScreen ? "Your screen: quality, change it, or stop sharing" : "Share your screen", () => (callScreen ? callPop("share") : callShare())));
      buttons.push(button(callPopOpen === "board" ? "open" : "", CALL_ICONS.board, "Sound board: play Library sounds in the call", () => callPop("board")));
      buttons.push(button(callRec ? "rec" : "", CALL_ICONS.rec, callRec ? "Stop recording and save it" : "Record the call (saved as an MP3)", callRecToggle, callRec ? callRecClock() : ""));
      buttons.push(button(callPopOpen === "settings" ? "open" : "", CALL_ICONS.gear, "Microphone, sound quality, push-to-talk, speakers and camera", () => callPop("settings")));
    }
    buttons.push(button("red", CALL_ICONS.hangUp, call.phase === "in" && !callOthersIn().length && !call.group ? "Cancel" : "Hang up", () => callHangUp()));
  }
  $("callButtons").replaceChildren(...buttons);
  $("callSharing").hidden = !callScreen;
  // Someone is recording: everyone sees it.
  const recorders = [...callPeers.values()].filter((p) => p.recording).map((p) => p.name);
  $("callRecNote").hidden = !recorders.length;
  $("callRecNote").querySelector("span").textContent = recorders.length ? `${recorders.join(", ")} ${recorders.length > 1 ? "are" : "is"} recording this call` : "";
}

// The stage: someone's shared screen, and the cameras. A screen is big with the cameras in a row under it;
// cameras alone fill the stage, with everyone in the call as a tile. Big in the middle, or small in the corner.
function drawCallStage() {
  const stage = $("callStage");
  const live = !!call && call.phase === "in";
  const sharing = live ? [...callPeers.values()].filter((p) => p.sharing && p.video) : [];
  // Your own screen too, so you can see what everyone's watching (friends' screens come first).
  if (live && callScreen) sharing.push({ name: callMe(), video: callScreen, me: true });
  if (sharing.length && !sharing.some((p) => lower(p.name) === callWatching)) callWatching = lower(sharing[0].name);
  const watched = sharing.find((p) => lower(p.name) === callWatching);
  const tiles = live ? callTiles() : [];
  const cameras = tiles.some((t) => t.stream);
  // (servers) In a voice channel you're looking at, the call fills the middle of the chat, with everyone as a tile.
  const inRoom = live && typeof srvStageHere === "function" && srvStageHere();
  callStagePlace(inRoom);
  stage.hidden = !(watched || cameras || inRoom);
  if (stage.hidden) {
    if ($("callVideo").srcObject) $("callVideo").srcObject = null;
    drawCallTiles([], false);
    return;
  }
  if (!watched && $("callVideo").srcObject) $("callVideo").srcObject = null;
  if (watched && $("callVideo").srcObject !== watched.video) { $("callVideo").srcObject = watched.video; $("callVideo").play().catch(() => {}); }
  $("callVideo").hidden = !watched;
  if (typeof callZoomWatch === "function") callZoomWatch(watched ? callWatching : "");
  stage.classList.toggle("small", callStageSmall && !inRoom);
  stage.classList.toggle("cameras", !watched);
  $("callStageLabel").textContent = watched ? (watched.me ? "Your screen (what friends see)" : `${watched.name}'s screen`) : "";
  $("callStageSize").innerHTML = callStageSmall ? CALL_ICONS.big : CALL_ICONS.small;
  $("callStageSize").title = callStageSmall ? "Make it big" : "Make it smaller";
  // Under a screen: only the cameras that are on (and none when it's small).
  drawCallTiles(watched ? (inRoom ? tiles : callStageSmall ? [] : tiles.filter((t) => t.stream)) : tiles, !!watched);
  const tabs = $("callStageTabs");
  const sig = JSON.stringify([sharing.map((p) => p.name), callWatching]);
  if (tabs.dataset.sig !== sig) {
    tabs.dataset.sig = sig;
    tabs.replaceChildren(...(sharing.length > 1 ? sharing.map((p) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: lower(p.name) === callWatching ? "on" : "", textContent: p.me ? "Your screen" : p.name });
      b.addEventListener("click", () => { callWatching = lower(p.name); drawCall(); });
      return b;
    }) : []));
  }
}

// The stage floats over the page, or sits in a voice channel's room in the chat.
function callStagePlace(inRoom) {
  const stage = $("callStage");
  const room = $("vcRoom");
  stage.classList.toggle("in-room", !!inRoom);
  document.body.classList.toggle("vc-here", !!inRoom);
  const moved = (inRoom && room && stage.parentElement !== room) || (!inRoom && stage.parentElement !== document.body);
  if (inRoom && room && stage.parentElement !== room) room.append(stage);
  else if (!inRoom && stage.parentElement !== document.body) $("callBox").after(stage);
  if (moved) stage.querySelectorAll("video").forEach((v) => { if (v.srcObject) v.play().catch(() => {}); });
}

// Everyone in the call, with their camera when it's on: [{key, name, avatarUrl, stream, me, muted}]
function callTiles() {
  const me = sfxUser() || {};
  const tiles = [{ key: "", name: me.username || "You", avatarUrl: me.avatarUrl || "", stream: callCam, me: true, muted: callMuted || callDeafened }];
  for (const person of callOthersIn()) {
    const p = callPeers.get(lower(person.username));
    tiles.push({
      key: lower(person.username), name: person.username, avatarUrl: person.avatarUrl || "",
      stream: p && p.camera && p.cam ? p.cam : null, me: false, muted: !!(p && p.muted),
    });
  }
  return tiles;
}

// The tiles are kept between draws (so the videos don't blink); only what changed is touched.
const callTileEls = new Map();
function drawCallTiles(tiles, strip) {
  const box = $("callTiles");
  box.classList.toggle("strip", strip);
  box.hidden = !tiles.length;
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  box.style.setProperty("--cols", strip ? tiles.length : cols);
  const keep = new Set(tiles.map((t) => t.key));
  for (const [key, el] of callTileEls) if (!keep.has(key)) { el.querySelector("video").srcObject = null; el.remove(); callTileEls.delete(key); }
  tiles.forEach((t, i) => {
    let el = callTileEls.get(t.key);
    if (!el) {
      el = document.createElement("div");
      el.className = "call-tile";
      const video = Object.assign(document.createElement("video"), { autoplay: true, muted: true, playsInline: true });
      video.dataset.call = "1";
      el.append(video, Object.assign(document.createElement("span"), { className: "call-tile-face" }),
        Object.assign(document.createElement("b"), { className: "call-tile-name" }));
      callTileEls.set(t.key, el);
    }
    const video = el.querySelector("video");
    if (video.srcObject !== t.stream) { video.srcObject = t.stream; if (t.stream) video.play().catch(() => {}); }
    el.classList.toggle("on", !!t.stream);
    el.classList.toggle("me", t.me);
    const sig = JSON.stringify([t.name, t.avatarUrl, t.muted]);
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.querySelector(".call-tile-face").replaceChildren(avatarEl(t.avatarUrl, t.name));
      const name = el.querySelector(".call-tile-name");
      name.textContent = t.me ? "You" : t.name;
      if (t.muted) name.prepend(Object.assign(document.createElement("i"), { innerHTML: CALL_ICONS.micOff }));
    }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  drawCallTalking();
}

// The green outline on whoever's talking (called often, so it only flips classes).
function drawCallTalking() {
  if (typeof srvDrawTalking === "function") srvDrawTalking(); // (servers.js: voice channel list, members, your name card)
  for (const [key, el] of callTileEls) {
    const muted = key === "" ? callMuted || callDeafened : (callPeers.get(key) || {}).muted;
    el.classList.toggle("speaking", !!(callSpeaking.get(key) || {}).on && !muted);
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
  if (which === "board") {
    await drawCallBoard(els, title);
  } else if (which.startsWith("person:")) {
    drawCallPerson(els, title, which.slice(7));
  } else if (which === "share") {
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
    const live = callScreen && callScreen.getAudioTracks().length;
    els.push(Object.assign(document.createElement("p"), {
      className: "call-pop-note",
      textContent: (live ? "Your PC's sound is going out with your screen. " : "Want friends to hear your game or music? Turn on \u201cShare system audio\u201d in the next window. ")
        + (callShareSoundSafe() ? "Friends' voices are left out, so nobody hears themselves." : "Use headphones, or friends may hear themselves back."),
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
      sel.append(new Option(kind === "videoinput" ? "Default camera" : "Windows default", ""));
      list.filter((d) => d.deviceId !== "default").forEach((d, i) => sel.append(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
      sel.value = loadPref(pref) || "";
      if (sel.value !== (loadPref(pref) || "")) sel.value = "";
      sel.addEventListener("change", () => use(sel.value));
      return sel;
    };
    els.push(title("Microphone"), select("audioinput", "callMic", "Microphone", callUseMic));
    els.push(title("Hear yourself"));
    els.push(chips(["off", "on"], callHearSelfOn() ? "on" : "off", (v) => (v === "on" ? "On" : "Off"), (v) => callSetHearSelf(v === "on")));
    const kbps = callBitrate(), music = callMusicOn();
    els.push(title("Sound quality (kbps)"));
    els.push(chips(AUDIO_RATES, kbps, String, callSetBitrate));
    els.push(Object.assign(document.createElement("p"), { className: "call-pop-note", textContent: callBitrateNote(kbps) }));
    els.push(title("Music mode"));
    els.push(chips(["off", "on"], music ? "on" : "off", (v) => (v === "on" ? "On" : "Off"), (v) => callSetMusic(v === "on")));
    els.push(Object.assign(document.createElement("p"), { className: "call-pop-note", textContent: AUDIO_MUSIC_NOTES[music ? "on" : "off"] }));
    const noise = callNoise();
    els.push(title("Noise suppression"));
    const noiseChips = chips(NOISE_LEVELS, music ? "off" : noise, (v) => NOISE_NAMES[v], callSetNoise);
    if (music) noiseChips.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    els.push(noiseChips);
    els.push(Object.assign(document.createElement("p"), {
      className: "call-pop-note",
      textContent: music ? AUDIO_MUSIC_NOISE : NOISE_NOTES[noise],
    }));
    els.push(title("Push to talk"), callPttRows("call-chips"));
    els.push(Object.assign(document.createElement("p"), { className: "call-pop-note", textContent: PTT_NOTE }));
    els.push(title("Speakers or headphones"), select("audiooutput", "callSpeaker", "Speakers", callUseSpeaker));
    els.push(title("Camera"), select("videoinput", "callCam", "Camera", callUseCam));
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
