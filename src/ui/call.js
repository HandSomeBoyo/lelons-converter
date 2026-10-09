// Calls in private chats, with screen sharing. The two apps ring each other through the library
// (lelons_call), then the sound and the shared screen go straight between them (WebRTC).
// Uses $, api() from app.js, sfxUser(), avatarEl(), sfxLoggedOut() from sfx.js, chatSoundOn() from chat.js.

const CALL_ICONS = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></svg>',
  hangUp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-3.3 0-6.4 1-8.9 2.9-.6.4-.8 1.2-.5 1.9l1.1 2.1c.4.7 1.2 1 1.9.7l2.6-1.1c.6-.2 1-.8.9-1.5l-.2-1.6A11.6 11.6 0 0 1 12 12a11.6 11.6 0 0 1 3.1.4l-.2 1.6c-.1.7.3 1.3.9 1.5l2.6 1.1c.7.3 1.5 0 1.9-.7l1.1-2.1c.3-.7.1-1.5-.5-1.9A14.6 14.6 0 0 0 12 9z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21M4 4l16 16"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4M12 13V7.5M9.5 10 12 7.5l2.5 2.5"/></svg>',
  screenOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4M9.5 7.8l5 5M14.5 7.8l-5 5"/></svg>',
  big: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  small: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>',
};
const CALL_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

// The call going on (or ringing): {id, username, avatarUrl, outgoing, phase, pc, dc, mic, screen, ...}.
// phase: "outgoing" (ringing them), "incoming" (they're ringing you), "connecting", "active", "ended".
let call = null;
let callTimer = null;
let callBusy = false;
const callIgnored = new Set(); // calls you declined, or that already ended here

function callIsLive() { return !!call && call.phase !== "ended"; }
function callWith(username) { return callIsLive() && call.username.toLowerCase() === String(username || "").toLowerCase(); }

// ---- checking for calls: every few seconds while logged in, every second or so in a call

function pollCalls(delay) {
  clearTimeout(callTimer);
  callTimer = setTimeout(checkCalls, delay);
}

async function checkCalls() {
  if (!sfxUser()) {
    if (callIsLive()) callFinish("You were logged out.");
    return pollCalls(5000);
  }
  if (callBusy) return pollCalls(1000);
  callBusy = true;
  try {
    const res = await api("/api/sfx-call", { what: "check" }).catch(() => null);
    if (res && !sfxLoggedOut(res) && res.ok) callsCame(res.calls || []);
  } finally {
    callBusy = false;
    pollCalls(callIsLive() ? 1500 : 3000);
  }
}

const CALL_ENDED = {
  declined: (name) => `${name} can't talk right now.`,
  cancelled: (name) => `${name} hung up.`,
  missed: () => "No answer.",
  hung_up: () => "Call ended.",
  dropped: () => "The call dropped.",
};

function callsCame(calls) {
  if (callIsLive() && call.id) {
    const c = calls.find((x) => x.id === call.id);
    if (!c || c.state === "ended") {
      const why = (c && c.why) || "hung_up";
      // (an incoming call that stopped ringing just goes away)
      return callFinish(call.phase === "incoming" ? (why === "cancelled" ? "" : "Missed call.") : (CALL_ENDED[why] || CALL_ENDED.hung_up)(call.username));
    }
    if (call.outgoing && c.state === "active" && c.answer && !call.answered) {
      call.answered = true;
      callPhase("connecting");
      call.pc.setRemoteDescription({ type: "answer", sdp: c.answer })
        .catch(() => callHangUp("The call couldn't connect. Try again."));
      callConnectWatch();
    }
    return;
  }
  if (callIsLive()) return; // (still starting: no id yet)
  const ringing = calls.find((c) => c.state === "ringing" && !c.outgoing && !callIgnored.has(c.id));
  if (ringing) callIncoming(ringing);
}

// ---- making and answering calls

async function callStart(username) {
  if (!sfxUser()) return openLogin("login");
  if (callIsLive()) return callWith(username) ? null : callSay("Hang up first: you're already in a call.");
  const online = onlineInfo && onlineInfo.people;
  if (online && !online.some((p) => p.username.toLowerCase() === username.toLowerCase())) {
    call = { id: null, username, avatarUrl: callFaceOf(username), outgoing: true, phase: "outgoing" };
    return callFinish(`${username} isn't online right now. They need the app open to get your call.`);
  }
  call ={ id: null, username, avatarUrl: callFaceOf(username), outgoing: true, phase: "outgoing", status: "Starting the call..." };
  drawCall();
  if (!(await callMic())) return;
  callPeer();
  call.audioTx = call.pc.addTransceiver(call.mic.getAudioTracks()[0], { direction: "sendrecv", streams: [call.mic] });
  call.videoTx = call.pc.addTransceiver("video", { direction: "sendrecv" });
  callChannel(call.pc.createDataChannel("call"));
  const mine = call;
  try {
    await call.pc.setLocalDescription(await call.pc.createOffer());
    await callGathered(call.pc);
  } catch (e) {
    return callFinish("The call couldn't start. Try again.");
  }
  if (call !== mine) return;
  const res = await api("/api/sfx-call", { what: "start", with: username, sdp: call.pc.localDescription.sdp })
    .catch(() => ({ ok: false, error: "The call didn't go through. Check your internet connection." }));
  if (call !== mine) { // hung up while it was being set up
    if (res.ok && res.call) api("/api/sfx-call", { what: "end", call: res.call }).catch(() => {});
    return;
  }
  if (sfxLoggedOut(res)) return callFinish("");
  if (!res.ok) return callFinish(res.error);
  call.id = res.call;
  call.status = "Ringing...";
  callRing("out");
  drawCall();
  pollCalls(1000);
}

function callIncoming(c) {
  call = { id: c.id, username: c.username, avatarUrl: c.avatarUrl, outgoing: false, phase: "incoming", offer: c.offer, status: "is calling you" };
  callRing("in");
  api("/api/sfx-call-ringing", {}).catch(() => {});
  drawCall();
}

async function callAnswer() {
  if (!call || call.phase !== "incoming") return;
  const mine = call;
  callRing(null);
  call.status = "Connecting...";
  callPhase("connecting");
  if (!(await callMic())) return api("/api/sfx-call", { what: "end", call: mine.id }).catch(() => {});
  callPeer();
  try {
    await call.pc.setRemoteDescription({ type: "offer", sdp: call.offer });
    call.pc.getTransceivers().forEach((t) => {
      const kind = t.receiver.track && t.receiver.track.kind;
      if (kind === "audio" && !call.audioTx) call.audioTx = t;
      if (kind === "video" && !call.videoTx) call.videoTx = t;
    });
    await call.audioTx.sender.replaceTrack(call.mic.getAudioTracks()[0]);
    call.audioTx.direction = "sendrecv";
    call.videoTx.direction = "sendrecv";
    await call.pc.setLocalDescription(await call.pc.createAnswer());
    await callGathered(call.pc);
  } catch (e) {
    return callHangUp("The call couldn't connect. Try again.");
  }
  if (call !== mine) return;
  const res = await api("/api/sfx-call", { what: "answer", call: call.id, sdp: call.pc.localDescription.sdp })
    .catch(() => ({ ok: false, error: "Couldn't answer. Check your internet connection." }));
  if (call !== mine) return;
  if (sfxLoggedOut(res)) return callFinish("");
  if (!res.ok) return callFinish(res.error);
  callConnectWatch();
  pollCalls(1000);
}

function callDecline() {
  if (!call || call.phase !== "incoming") return;
  api("/api/sfx-call", { what: "end", call: call.id }).catch(() => {});
  callFinish("");
}

// Hang up (or stop ringing them). note: what to show for a moment after.
function callHangUp(note = "Call ended.") {
  if (!callIsLive()) return;
  callSend({ bye: true });
  if (call.id) api("/api/sfx-call", { what: "end", call: call.id }).catch(() => {}).then(() => pollCalls(300));
  callFinish(note);
}

// The call is over here: let go of the microphone and the screen, and show note for a moment.
function callFinish(note) {
  if (!call) return;
  const was = call;
  if (was.id) callIgnored.add(was.id);
  callRing(null);
  clearInterval(was.clock);
  clearTimeout(was.connectTimer);
  clearTimeout(was.dropTimer);
  for (const stream of [was.mic, was.screen]) if (stream) stream.getTracks().forEach((t) => t.stop());
  try { if (was.dc) was.dc.close(); } catch (e) { /* already closed */ }
  try { if (was.pc) was.pc.close(); } catch (e) { /* already closed */ }
  $("callAudio").srcObject = null;
  $("callVideo").srcObject = null;
  if (!note) { call = null; drawCall(); return; }
  call = { ...was, phase: "ended", status: note, pc: null, dc: null, mic: null, screen: null, remoteSharing: false };
  drawCall();
  const ended = call;
  setTimeout(() => { if (call === ended) { call = null; drawCall(); } }, 3500);
  if (typeof drawRoom === "function") { roomDrawn = ""; drawRoom(); }
}

// ---- the connection

async function callMic() {
  const mine = call;
  try {
    call.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    if (call === mine) callFinish("Couldn't use your microphone. Check it's plugged in, and that Windows lets apps use it (Settings > Privacy > Microphone).");
    return false;
  }
  if (call !== mine) { mine.mic.getTracks().forEach((t) => t.stop()); return false; }
  return true;
}

function callPeer() {
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  call.pc = pc;
  const mine = call;
  pc.ontrack = (e) => {
    if (call !== mine) return;
    const stream = new MediaStream([e.track]);
    if (e.track.kind === "audio") {
      const audio = $("callAudio");
      audio.srcObject = stream;
      audio.play().catch(() => {});
      audio.volume = 1; // (calls are as loud as they come, whatever the app's volume)
      playedMedia.delete(audio);
    } else {
      $("callVideo").srcObject = stream;
    }
  };
  pc.ondatachannel = (e) => callChannel(e.channel);
  pc.onconnectionstatechange = () => {
    if (call !== mine) return;
    const state = pc.connectionState;
    if (state === "connected") {
      clearTimeout(call.dropTimer);
      clearTimeout(call.connectTimer);
      if (call.phase !== "active") {
        call.startedAt = Date.now();
        call.clock = setInterval(drawCallStatus, 1000);
        callPhase("active");
      } else {
        call.status = "";
        drawCall();
      }
    } else if (state === "disconnected" && call.phase === "active") {
      call.status = "Reconnecting...";
      drawCall();
      clearTimeout(call.dropTimer);
      call.dropTimer = setTimeout(() => { if (call === mine) callHangUp("The call dropped."); }, 12000);
    } else if (state === "failed") {
      callHangUp(call.phase === "active" ? "The call dropped." : CALL_NO_ROUTE);
    }
  };
}
const CALL_NO_ROUTE = "The call couldn't connect. A strict network (like school or work Wi-Fi) can block calls.";

// No connection 25 seconds after answering: give up.
function callConnectWatch() {
  const mine = call;
  clearTimeout(call.connectTimer);
  call.connectTimer = setTimeout(() => { if (call === mine && call.phase !== "active") callHangUp(CALL_NO_ROUTE); }, 25000);
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

// Small messages straight to the other app: muted, sharing the screen, bye.
function callChannel(dc) {
  call.dc = dc;
  const mine = call;
  dc.onopen = () => { if (call === mine) callSend({ muted: !!call.muted, sharing: !!call.screen }); };
  dc.onmessage = (e) => {
    if (call !== mine) return;
    let msg = {};
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.bye) return callFinish("Call ended.");
    if ("muted" in msg) call.theyMuted = !!msg.muted;
    if ("sharing" in msg) {
      call.remoteSharing = !!msg.sharing;
      if (call.remoteSharing) call.stageSmall = false;
    }
    drawCall();
  };
}

function callSend(msg) {
  try { if (call && call.dc && call.dc.readyState === "open") call.dc.send(JSON.stringify(msg)); } catch (e) { /* closed */ }
}

function callPhase(phase) {
  call.phase = phase;
  if (phase === "active") call.status = "";
  drawCall();
  if (typeof drawRoom === "function") { roomDrawn = ""; drawRoom(); }
}

// ---- in the call: mute and share your screen

function callMute() {
  if (!call || !call.mic) return;
  call.muted = !call.muted;
  call.mic.getAudioTracks().forEach((t) => { t.enabled = !call.muted; });
  callSend({ muted: call.muted });
  drawCall();
}

async function callShare() {
  if (!call || call.phase !== "active") return;
  if (call.screen) return callStopShare();
  const mine = call;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
  } catch (e) {
    return; // (picked nothing)
  }
  if (call !== mine || call.phase !== "active") return stream.getTracks().forEach((t) => t.stop());
  const track = stream.getVideoTracks()[0];
  track.contentHint = "detail"; // sharp text over smooth motion
  try {
    await call.videoTx.sender.replaceTrack(track);
    const params = call.videoTx.sender.getParameters();
    if (params.encodings && params.encodings[0]) {
      params.encodings[0].maxBitrate = 2500000;
      await call.videoTx.sender.setParameters(params).catch(() => {});
    }
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    return callSay("Couldn't share your screen. Try again.");
  }
  call.screen = stream;
  track.addEventListener("ended", () => { if (call === mine && call.screen === stream) callStopShare(); });
  callSend({ sharing: true });
  drawCall();
}

function callStopShare() {
  if (!call || !call.screen) return;
  call.screen.getTracks().forEach((t) => t.stop());
  call.screen = null;
  if (call.videoTx) call.videoTx.sender.replaceTrack(null).catch(() => {});
  callSend({ sharing: false });
  drawCall();
}

// ---- ringing (made here, so there are no sound files)

let callRingCtx = null;
let callRingTimer = null;
function callRing(kind) {
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
  const known = [...((onlineInfo && onlineInfo.people) || []), ...chatPrivate].find((p) => p.username.toLowerCase() === username.toLowerCase());
  return known ? known.avatarUrl || "" : "";
}

function callSay(text) {
  const note = $("chatNote");
  if (note && chatIsOpen()) note.textContent = text;
  else alert(text);
}

function callSeconds() { return call && call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0; }

function drawCallStatus() {
  if (!call) return;
  const status = call.phase === "active" && !call.status
    ? clock(callSeconds(), false) + (call.theyMuted ? ` · ${call.username} is muted` : "")
    : call.status;
  $("callStatus").textContent = status;
}

let callDrawn = "";
function drawCall() {
  const box = $("callBox");
  box.hidden = !call;
  document.body.classList.toggle("in-call", !!call);
  if (!call) { callDrawn = ""; $("callStage").hidden = true; return; }
  const sig = JSON.stringify([call.phase, call.username, call.avatarUrl, call.muted, !!call.screen, call.remoteSharing, call.stageSmall, call.status, call.theyMuted]);
  drawCallStatus();
  if (sig === callDrawn) return;
  callDrawn = sig;
  box.className = "call call-" + call.phase;
  $("callFace").replaceChildren(avatarEl(call.avatarUrl, call.username));
  $("callName").textContent = call.username;
  const button = (cls, icon, label, fn, text) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "call-btn " + cls;
    b.title = label;
    b.innerHTML = icon;
    if (text) b.append(Object.assign(document.createElement("span"), { textContent: text }));
    b.addEventListener("click", fn);
    return b;
  };
  const buttons = [];
  if (call.phase === "incoming") {
    buttons.push(button("red", CALL_ICONS.hangUp, "Decline", callDecline, "Decline"));
    buttons.push(button("green", CALL_ICONS.phone, "Answer", callAnswer, "Answer"));
  } else if (call.phase !== "ended") {
    if (call.phase === "active" || call.phase === "connecting") {
      buttons.push(button(call.muted ? "on" : "", call.muted ? CALL_ICONS.micOff : CALL_ICONS.mic, call.muted ? "Unmute" : "Mute", callMute));
      buttons.push(button(call.screen ? "on" : "", call.screen ? CALL_ICONS.screenOff : CALL_ICONS.screen,
        call.screen ? "Stop sharing your screen" : "Share your screen", callShare));
    }
    buttons.push(button("red", CALL_ICONS.hangUp, call.phase === "outgoing" ? "Cancel" : "Hang up", () => callHangUp()));
  }
  $("callButtons").replaceChildren(...buttons);
  $("callSharing").hidden = !call.screen;
  // Their screen: big in the middle, or small in the corner.
  const stage = $("callStage");
  stage.hidden = !(call.remoteSharing && call.phase === "active");
  stage.classList.toggle("small", !!call.stageSmall);
  $("callStageLabel").textContent = `${call.username}'s screen`;
  $("callStageSize").innerHTML = call.stageSmall ? CALL_ICONS.big : CALL_ICONS.small;
  $("callStageSize").title = call.stageSmall ? "Make it big" : "Make it smaller";
  if (!stage.hidden) $("callVideo").play().catch(() => {});
}

$("callStageSize").addEventListener("click", () => { if (call) { call.stageSmall = !call.stageSmall; drawCall(); } });
$("callStageFull").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $("callStage").requestFullscreen().catch(() => {});
});
$("callVideo").addEventListener("dblclick", () => $("callStageFull").click());
$("callStopShare").addEventListener("click", callStopShare);
window.addEventListener("pagehide", () => { if (callIsLive()) callHangUp(); });

pollCalls(2500);
