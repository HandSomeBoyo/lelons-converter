// (2.37.0) The hidden sender: runs on the PC you control (remote-host.html, in its own hidden window).
// It waits for notes from your other PCs, checks they're really yours (keys + allowed on this PC + PIN),
// then sends this PC's screen and sound, and passes the mouse and keys on to remote.py.

const rh = { keys: null, me: null, after: 0, nonces: new Set(), sess: null, timer: 0, slow: 0, gate: Promise.resolve() };

function rhSay(text) { document.getElementById("what").textContent = text; }

async function rhTick() {
  clearTimeout(rh.timer);
  let wait = 2500;
  try {
    const info = await rdPost("/api/remote-info");
    if (info.ok) rh.me = info;
    if (!info.ok || !info.host) {
      wait = 5000;
    } else {
      if (!rh.keys) rh.keys = await rdKeys("host");
      const res = await rdPost("/api/remote-hello", {
        sender: true, hostKey: rh.keys.pub, after: rh.after,
        width: Math.round(screen.width * devicePixelRatio), height: Math.round(screen.height * devicePixelRatio),
      });
      if (!res.ok) {
        wait = res.error === "owner_only" || res.error === "login" ? 60000 : 8000;
        rhSay(res.error === "owner_only" ? "Only the owner can use Remote desktop." : "Not connected: " + res.error);
      } else {
        for (const s of res.signals || []) {
          if (s.id <= rh.after) continue;
          rh.after = Math.max(rh.after, s.id);
          rhSignal(s).catch(() => {});
        }
      }
    }
  } catch (e) {
    wait = 8000;
  }
  rh.timer = setTimeout(rhTick, wait);
}

function rhParse(text) { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }

async function rhSignal(s) {
  const body = rhParse(s.body);
  if (!body) return;
  if (s.kind === "bye") {
    if (rh.sess && rh.sess.from === s.from && body.nonce === rh.sess.nonce) rhEnd("left");
    return;
  }
  if (s.kind !== "offer") return;
  // (2.37.1) Hellos are checked one at a time, so two of them can't both start a session.
  const earlier = rh.gate;
  let release;
  rh.gate = new Promise((r) => { release = r; });
  await earlier;
  try {
    await rhOffer(s, body, release);
  } finally {
    release();
  }
}

async function rhOffer(s, body, release) {
  // A fresh, signed hello from one of your PCs.
  const now = Date.now() / 1000;
  if (typeof body.sdp !== "string" || typeof body.key !== "string" || typeof body.sig !== "string") return;
  if (typeof body.nonce !== "string" || body.nonce.length < 16 || rh.nonces.has(body.nonce)) return;
  if (!(Math.abs(now - Number(body.ts)) < 120)) return;
  const fpOffer = rdFingerprint(body.sdp);
  if (!fpOffer) return;
  const ok = await rdVerify(body.key, `offer|${rh.me.device}|${s.from}|${fpOffer}|${body.nonce}|${body.ts}`, body.sig);
  if (!ok) return;
  rh.nonces.add(body.nonce);
  // (2.37.1) The app remembers used hellos too: after a screen switch this page starts fresh, and it
  // mustn't answer the hello from before the switch again (that blocked the new one as "busy").
  if ((await rdPost("/api/remote-nonce", { nonce: body.nonce })).fresh !== true) return;
  if (rh.sess) {
    await rdPost("/api/remote-signal", { to: s.from, kind: "bye", body: JSON.stringify({ nonce: body.nonce, why: "busy" }) });
    return;
  }
  const known = (await rdPost("/api/remote-allowed", { key: body.key })).allowed === true;

  const pc = new RTCPeerConnection({ iceServers: RD_ICE });
  const sess = rh.sess = {
    pc, from: s.from, key: body.key, name: String(body.name || "PC").slice(0, 40), nonce: body.nonce,
    approved: known, pinOk: !rh.me.pin, started: false, last: Date.now(), ctl: null, queue: [], sending: false,
    mode: RD_MODES[body.mode] ? body.mode : "auto", screen: Number(body.screen) || 0, stream: null,
  };
  release(); // the next hello may be looked at now (it gets "busy")
  pc.ondatachannel = (ev) => {
    const ch = ev.channel;
    if (ch.label === "ctl") { sess.ctl = ch; ch.onopen = () => rhReady(sess); if (ch.readyState === "open") rhReady(sess); }
    ch.onmessage = (m) => rhMessage(sess, m.data);
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState) && rh.sess === sess) rhEnd("dropped");
  };
  await pc.setRemoteDescription({ type: "offer", sdp: body.sdp });
  for (const t of pc.getTransceivers()) t.direction = "sendonly";
  const answer = await pc.createAnswer();
  await pc.setLocalDescription({ type: "answer", sdp: rdTuneOpus(answer.sdp) });
  await rdGathered(pc);
  const sdp = pc.localDescription.sdp;
  const fpAnswer = rdFingerprint(sdp);
  const sig = await rdSign(rh.keys.priv, `answer|${s.from}|${rh.me.device}|${fpAnswer}|${body.nonce}`);
  await rdPost("/api/remote-signal", {
    to: s.from, kind: "answer",
    body: JSON.stringify({ sdp, key: rh.keys.pub, pair: !known, pin: !!rh.me.pin, nonce: body.nonce, sig }),
  });
  sess.timer = setInterval(() => rhWatch(sess), 700);
  if (!known) {
    // First time: you have to allow it here, on this PC, after checking the code matches.
    const code = await rdCode(body.key, rh.keys.pub, fpOffer, fpAnswer);
    rhSay("Asking you to allow " + sess.name);
    const ask = await rdPost("/api/remote-ask", { name: sess.name, device: s.from, key: body.key, code });
    if (!ask.ok) return rhEnd("declined");
    const until = Date.now() + 120000;
    while (rh.sess === sess && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      const a = await rdPost("/api/remote-answered", { id: ask.id });
      if (a.answer === true) { sess.approved = true; break; }
      if (a.answer === false) return rhEnd("declined");
    }
    if (!sess.approved) return rhEnd("declined");
    rhReady(sess);
  }
}

function rhSend(sess, msg) {
  if (sess.ctl && sess.ctl.readyState === "open") sess.ctl.send(JSON.stringify(msg));
}

function rhReady(sess) {
  if (rh.sess !== sess || !sess.ctl || sess.ctl.readyState !== "open") return;
  if (!sess.approved) { rhSend(sess, { waiting: true }); return; }
  if (!sess.pinOk) { rhSend(sess, { needPin: true }); return; }
  rhGo(sess);
}

async function rhGo(sess) {
  if (sess.started) return;
  sess.started = true;
  const start = await rdPost("/api/remote-start", { key: sess.key, name: sess.name, screen: sess.screen });
  if (!start.ok) return rhEnd("declined");
  const m = RD_MODES[sess.mode];
  let stream;
  try {
    // The hidden window starts with a switch that picks the whole screen by itself (no picker).
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: m.fps, max: 60 }, height: { max: m.height }, cursor: "always" },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "exclude",
    });
  } catch (e) {
    rhSend(sess, { error: "screen" });
    return rhEnd("screen");
  }
  if (rh.sess !== sess) return stream.getTracks().forEach((t) => t.stop());
  sess.stream = stream;
  const video = stream.getVideoTracks()[0], audio = stream.getAudioTracks()[0] || null;
  for (const t of sess.pc.getTransceivers()) {
    const kind = t.receiver.track && t.receiver.track.kind;
    if (kind === "video") await t.sender.replaceTrack(video).catch(() => {});
    if (kind === "audio" && audio) await t.sender.replaceTrack(audio).catch(() => {});
  }
  await rhMode(sess, sess.mode);
  const set = video.getSettings();
  rhSend(sess, { ready: true, w: set.width, h: set.height, audio: !!audio, screens: rh.me.screens, screen: sess.screen });
  rhSay("Sending to " + sess.name);
}

async function rhMode(sess, mode) {
  const m = RD_MODES[mode] || RD_MODES.auto;
  sess.mode = mode;
  const video = sess.stream && sess.stream.getVideoTracks()[0];
  if (!video) return;
  video.contentHint = m.hint;
  await video.applyConstraints({ frameRate: { ideal: m.fps, max: 60 }, height: { max: m.height } }).catch(() => {});
  for (const t of sess.pc.getTransceivers()) {
    if (t.sender.track !== video) continue;
    const p = t.sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = m.bitrate;
    p.encodings[0].maxFramerate = m.fps;
    p.degradationPreference = m.keep;
    await t.sender.setParameters(p).catch(() => {});
  }
}

async function rhMessage(sess, data) {
  if (rh.sess !== sess) return;
  sess.last = Date.now();
  const msg = rhParse(data);
  if (!msg) return;
  if (msg.ping) return rhSend(sess, { pong: msg.ping });
  if (msg.bye) return rhEnd("left");
  if (!sess.approved) return;
  if (!sess.pinOk) {
    if (typeof msg.pin !== "string") return;
    const r = await rdPost("/api/remote-pin", { pin: msg.pin });
    if (r.ok) { sess.pinOk = true; rhReady(sess); } else rhSend(sess, { pinBad: true, left: r.left, wait: r.wait });
    return;
  }
  if (!sess.started) return;
  if (Array.isArray(msg.e)) { sess.queue.push(...msg.e.slice(0, 100)); rhFlush(sess); }
  if (msg.mode && RD_MODES[msg.mode]) rhMode(sess, msg.mode);
  if (Number.isInteger(msg.screen) && msg.screen !== sess.screen) {
    rhSend(sess, { switching: msg.screen });
    rhEnd("screen", false);
    rdPost("/api/remote-screen", { screen: msg.screen }); // the hidden window starts again on that screen
  }
  if (msg.keys) rhKeys(sess, msg.keys);
}

// The mouse and keys go to remote.py one batch at a time (the next batch waits for the last one).
async function rhFlush(sess) {
  if (sess.sending || !sess.queue.length) return;
  sess.sending = true;
  // Moves in between don't matter: only the newest one is kept, the clicks and keys all go.
  const list = [];
  for (const e of sess.queue.splice(0)) {
    if (e && e.t === "m" && list.length && list[list.length - 1].t === "m") list[list.length - 1] = e;
    else list.push(e);
  }
  const r = await rdPost("/api/remote-input", { e: list });
  sess.sending = false;
  if (r && r.stop) return rhEnd("stopped");
  if (sess.queue.length) rhFlush(sess);
}

function rhKeys(sess, what) {
  const press = (...codes) => [...codes.map((c) => ({ t: "kd", code: c })), ...codes.reverse().map((c) => ({ t: "ku", code: c }))];
  const list = { win: press("MetaLeft"), alttab: press("AltLeft", "Tab"), altf4: press("AltLeft", "F4"),
    taskmgr: press("ControlLeft", "ShiftLeft", "Escape"), lock: [{ t: "cad" }] }[what];
  if (list) { sess.queue.push(...list); rhFlush(sess); }
}

async function rhWatch(sess) {
  if (rh.sess !== sess) return clearInterval(sess.timer);
  if (Date.now() - sess.last > 15000) return rhEnd("dropped"); // nothing from the other PC for a while
  if (!sess.started) return;
  const st = await rdPost("/api/remote-host-state");
  if (st.ok && st.stop) rhEnd("stopped");
}

function rhEnd(why, tell = true) {
  const sess = rh.sess;
  if (!sess) return;
  rh.sess = null;
  clearInterval(sess.timer);
  if (tell) rhSend(sess, { bye: why });
  setTimeout(() => {
    try { sess.pc.close(); } catch (e) { /* gone */ }
  }, 300);
  if (sess.stream) sess.stream.getTracks().forEach((t) => t.stop());
  if (why !== "screen") rdPost("/api/remote-end", { reason: why });
  rhSay("Waiting for your other PCs.");
}

rhTick();
