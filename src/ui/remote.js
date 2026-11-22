// (2.37.0) Remote: use your own PCs from anywhere (screen, sound, mouse and keyboard). Only for the owner.
// This is the side you sit at. The PC you control runs remote-host.js in a hidden window (see remote.py).

const rdIc = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const RD_ICONS = {
  pc: rdIc('<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16v4"/>'),
  laptop: rdIc('<rect x="4.5" y="5" width="15" height="10" rx="2"/><path d="M2.5 18.5h19"/>'),
  plus: rdIc('<path d="M12 5v14M5 12h14"/>'),
  play: rdIc('<path d="M8 5.5v13l10.5-6.5z"/>'),
  moon: rdIc('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  shield: rdIc('<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
  lock: rdIc('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  key: rdIc('<rect x="2.5" y="6.5" width="19" height="11" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  eye: rdIc('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  sound: rdIc('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: rdIc('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  gear: rdIc('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>'),
  full: rdIc('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  x: rdIc('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: rdIc('<path d="M15 5l-7 7 7 7"/>'),
  mons: rdIc('<rect x="2.5" y="5" width="11" height="8" rx="1.5"/><rect x="10.5" y="9" width="11" height="8" rx="1.5"/>'),
  remote: rdIc('<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16v4"/><path d="m10 8.5 4 1.5-1.7.7-.7 1.7z" fill="currentColor"/>'),
};
const rdEsc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const rd = {
  info: null, devices: [], after: 0, timer: 0, open: false, keys: null, error: "", lastHello: 0,
  conn: null, // the connection to the PC you control
  asking: null, // a PC that wants to control THIS PC (you answer here)
};

function rdIsOwner() { return typeof sfxUser === "function" && sfxUser() && sfxUser().isOwner; }

// ---- the side bar button: only the owner sees it
function rdSideButton() {
  const b = $("remoteSideBtn");
  if (b) b.hidden = !rdIsOwner();
  if (!rdIsOwner() && rd.open && typeof showTab === "function") showTab("home");
}

function remoteAccountChanged() {
  rdSideButton();
  rdLoop();
}

function remoteTabChanged(tab) {
  rd.open = tab === "remote";
  if (rd.open) { rdDraw(); rdLoop(true); }
}

// Every few seconds: what this PC allows (and whether a PC wants in), and, with the page open, your PCs.
async function rdLoop(now) {
  clearTimeout(rd.timer);
  if (!rdIsOwner()) return;
  let wait = rd.open || rd.conn ? 3000 : 2500;
  try {
    const info = await rdPost("/api/remote-info");
    if (info.ok) {
      rd.info = info;
      rdAsking(info.asking);
    }
    if ((rd.open || rd.conn) && (now || Date.now() - rd.lastHello > 2500)) await rdHello();
    if (rd.open && !rd.conn) rdDraw();
  } catch (e) { wait = 6000; }
  rd.timer = setTimeout(rdLoop, wait);
}

async function rdHello() {
  if (!rd.keys) rd.keys = await rdKeys("ctrl");
  rd.lastHello = Date.now();
  const res = await rdPost("/api/remote-hello", { ctrlKey: rd.keys.pub, after: rd.after });
  if (!res.ok) {
    rd.error = res.error === "owner_only" ? "Only the owner can use Remote." : res.error === "login" ? "Log in first." : "Can't reach the server right now.";
    return;
  }
  rd.error = "";
  rd.devices = res.devices || [];
  for (const s of res.signals || []) {
    rd.after = Math.max(rd.after, s.id);
    if (rd.conn) rdConnSignal(s);
  }
}

// ---- the Remote page

function rdDraw() {
  const page = $("remoteTab");
  if (!page || !rd.info) return;
  const me = rd.info;
  // (3.0) Only PCs you can control are shown. A PC with "let my other PCs control this one" off (like a
  // laptop you only use to control) is just named in a quiet line under them.
  const others = rd.devices.filter((d) => !d.me && d.host);
  const quiet = rd.devices.filter((d) => !d.me && !d.host);
  const card = (d) => {
    const ready = d.online && d.host;
    const status = ready ? (d.busy ? "In use right now" : "Ready") : d.online ? "Controlling is off on it" : `Last seen ${rdAgo(d.seen)}`;
    const size = d.width && d.height ? `${d.width} × ${d.height}` : "";
    return `<div class="rd-pc${ready ? "" : " off"}" data-id="${rdEsc(d.id)}">
      <div class="rd-shot${ready ? "" : " sleep"}">${ready ? `<div class="rd-shot-ic">${d.kind === "laptop" ? RD_ICONS.laptop : RD_ICONS.pc}<small>${rdEsc(size)}</small></div>` : `<div>${RD_ICONS.moon}${d.online ? "Controlling is off" : "Asleep, off or VaultHub closed"}</div>`}</div>
      <div class="rd-name"><b>${rdEsc(d.name)}</b><span class="rd-tag">${d.kind === "laptop" ? "Laptop" : "Desktop"}</span>
        <button type="button" class="icon-button rd-forget" title="Take it off this list" data-forget="${rdEsc(d.id)}" data-name="${rdEsc(d.name)}">${RD_ICONS.x}</button></div>
      <div class="rd-stat"><i class="rd-dot${ready ? (d.busy ? " warn" : "") : " off"}"></i>${rdEsc(status)}</div>
      ${ready ? `<button type="button" class="convert" data-connect="${rdEsc(d.id)}">${RD_ICONS.play}Connect</button>` : `<button type="button" class="ghost-button" disabled>${d.online ? "Turn it on there first" : "Turn it on to connect"}</button>`}
    </div>`;
  };
  const using = me.session && me.session.peer;
  const html = `<div class="rd-page">
    <h1 class="headline">Remote.<em> Your own PCs, anywhere.</em></h1>
    ${rd.error ? `<p class="rd-error">${rdEsc(rd.error)}</p>` : ""}
    ${others.length ? `<div class="rd-grid">${others.map(card).join("")}</div>`
      : `<div class="rd-pc rd-add rd-empty"><div class="plus">${RD_ICONS.plus}</div><b>No PCs to control yet</b>${RD_ADD_TEXT}</div>`}
    <div class="rd-links">${others.length ? `<button type="button" class="rd-link" id="rdAdd">${RD_ICONS.plus}Add a PC</button>` : ""}
      <button type="button" class="rd-link" id="rdSafeInfo">${RD_ICONS.shield}How it stays safe</button>
      ${quiet.length ? `<span class="rd-quiet">Not shown: ${quiet.map((d) => rdEsc(d.name)).join(", ")} (controlling is off there)</span>` : ""}</div>
    <div class="rd-this${using ? " busy" : ""}">${me.kind === "laptop" ? RD_ICONS.laptop : RD_ICONS.pc}<div class="rd-this-text"><b>This PC: ${rdEsc(me.name)}</b>${
      using ? `<span class="rd-using"><i class="rd-dot warn"></i>${rdEsc(using)} is using this PC now</span>`
      : me.host ? `On. Keep VaultHub open here (minimized is fine)${me.keepAwake ? " and it won't go to sleep" : ""}. Don't let Windows lock itself, the lock screen can't be used from far away.`
      : `Let my other PCs control this one${me.windows ? "" : " (Windows only)"}`}</div>
      ${using ? '<button type="button" class="ghost-button rd-small rd-red" id="rdStopHere">Stop</button>' : ""}
      <button type="button" class="ghost-button rd-small" id="rdManage">Safety settings</button>
      <button type="button" class="rd-sw${me.host ? " on" : ""}" id="rdHostSwitch" role="switch" aria-checked="${me.host}" title="Let my other PCs control this one"></button></div>
    </div>`;
  // (3.0) Only draw it again when something changed: it's checked every 3 seconds, and drawing it anew
  // each time could swallow a click (the button under the mouse was swapped for a new one).
  if (html === rd.drawn && page.firstElementChild) return;
  rd.drawn = html;
  page.innerHTML = html;
  page.querySelectorAll("[data-connect]").forEach((b) => b.addEventListener("click", () => rdConnect(b.dataset.connect)));
  page.querySelectorAll("[data-forget]").forEach((b) => b.addEventListener("click", () => rdForget(b.dataset.forget, b.dataset.name)));
  if ($("rdStopHere")) $("rdStopHere").addEventListener("click", async () => { await rdPost("/api/remote-stop"); rdLoop(true); });
  $("rdHostSwitch").addEventListener("click", async () => {
    const res = await rdPost("/api/remote-set", { host: !me.host });
    if (res.ok) { rd.info = res; rdDraw(); }
  });
  $("rdManage").addEventListener("click", rdManage);
  if ($("rdAdd")) $("rdAdd").addEventListener("click", () => rdInfoBox(RD_ICONS.plus, "Add a PC", `<p>${RD_ADD_TEXT}</p>`));
  $("rdSafeInfo").addEventListener("click", () => rdInfoBox(RD_ICONS.shield, "How it stays safe", `<div class="rd-safe">
      <div><b>${RD_ICONS.lock}Only your PCs</b>Only PCs logged in to your owner account. Nobody else can use Remote.</div>
      <div><b>${RD_ICONS.shield}Allowed once</b>The first time, you allow it on that PC after checking a 6-digit code.</div>
      <div><b>${RD_ICONS.eye}Straight PC to PC</b>Picture, sound and keys are locked (encrypted) from PC to PC. Nothing goes through our server.</div>
      <div><b>${RD_ICONS.key}Stop any time</b>A yellow bar shows on the PC being used. Ctrl+Alt+End cuts it off.</div></div>`));
}

const RD_ADD_TEXT = 'Install VaultHub on the other PC, log in with your account and turn on "Let my other PCs control this one" there. It shows up here by itself.';

function rdInfoBox(icon, title, body) {
  const m = rdModal(`<div class="rd-big-ic">${icon}</div><h2>${title}</h2>${body}<div class="rd-acts"><button type="button" class="convert" id="rdOk">OK</button></div>`);
  m.querySelector("#rdOk").addEventListener("click", rdModalClose);
}

// (3.0) Take a PC off your list. It also forgets the key this PC kept for it, so after a reinstall
// ("key changed") it can be added again. If it's still on, it shows up again by itself.
function rdForget(id, name) {
  const m = rdModal(`<h2>Take ${rdEsc(name)} off the list?</h2>
    <p>If VaultHub is still open on it, it shows up again in a few seconds, as if it was new. Do this if it was reinstalled or says its key changed.</p>
    <div class="rd-acts"><button type="button" class="ghost-button" id="rdNo">Cancel</button><button type="button" class="convert" id="rdYes2">Take it off</button></div>`);
  m.querySelector("#rdNo").addEventListener("click", rdModalClose);
  m.querySelector("#rdYes2").addEventListener("click", async () => {
    await rdPost("/api/remote-forget", { device: id });
    rdModalClose();
    rd.devices = rd.devices.filter((d) => d.id !== id);
    if (rd.info && rd.info.hosts) delete rd.info.hosts[id];
    rdDraw();
    rdLoop(true);
  });
}

function rdAgo(t) {
  const s = Date.now() / 1000 - (t || 0);
  if (s < 90) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " days ago";
}

function rdModal(html, cls = "") {
  rdModalClose();
  const m = document.createElement("div");
  m.className = "rd-modal"; m.id = "rdModal";
  m.innerHTML = `<div class="rd-dlg ${cls}" role="dialog">${html}</div>`;
  document.body.appendChild(m);
  return m;
}
function rdModalClose() { const m = $("rdModal"); if (m) m.remove(); }
const rdCodeHtml = (code) => `<div class="rd-code">${[...code].map((c, i) => (i === 3 ? '<i class="gap"></i>' : "") + `<i>${c}</i>`).join("")}</div>`;

// ---- Safety settings for this PC
function rdManage() {
  const me = rd.info;
  const row = (id, label, small, on) => `<div class="rd-row"><span>${label}${small ? `<small>${small}</small>` : ""}</span><button type="button" class="rd-sw${on ? " on" : ""}" data-opt="${id}" role="switch" aria-checked="${on}"></button></div>`;
  const m = rdModal(`<div class="rd-big-ic">${RD_ICONS.lock}</div><h2>Who can control ${rdEsc(me.name)}</h2>
    <p>These PCs were allowed on this PC. Take one off and it has to be allowed here again.</p>
    <div class="rd-list">${me.allowed.length ? me.allowed.map((a) => `<div class="rd-li">${RD_ICONS.pc}<div><b>${rdEsc(a.name)}</b>Allowed ${new Date(a.added * 1000).toLocaleDateString()}${a.last ? " · last used " + rdAgo(a.last) : ""}</div><button type="button" data-remove="${rdEsc(a.key)}">Remove</button></div>`).join("") : '<p class="rd-none">No PCs allowed yet.</p>'}</div>
    <div class="rd-set">
      ${row("host", "Let my other PCs control this one", "", me.host)}
      ${row("keepAwake", "Keep this PC awake while it's on", "So you can reach it when you're away", me.keepAwake)}
      ${row("lockOnEnd", "Lock this PC when they disconnect", "Careful: you can't unlock Windows from far away", me.lockOnEnd)}
      <div class="rd-row"><span>PIN<small>${me.pin ? "Asked every time someone connects" : "An extra lock, asked every time"}</small></span><input id="rdPin" class="rd-pin-in" type="password" autocomplete="off" inputmode="numeric" maxlength="12" placeholder="${me.pin ? "••••" : "Set a PIN"}"><button type="button" class="ghost-button rd-small" id="rdPinSave">${me.pin ? "Change" : "Save"}</button>${me.pin ? '<button type="button" class="ghost-button rd-small" id="rdPinOff">Remove</button>' : ""}</div>
      <div class="rd-row"><span>Stop key<small>Press it on this PC to cut someone off right away</small></span><span class="rd-keyname"><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>End</kbd></span></div>
      <div class="rd-row"><span>Name of this PC</span><input id="rdName" class="rd-pin-in" maxlength="40" value="${rdEsc(me.name)}"><button type="button" class="ghost-button rd-small" id="rdNameSave">Save</button></div>
    </div>
    <p class="rd-error" id="rdManageErr"></p>
    <div class="rd-acts">${me.allowed.length ? '<button type="button" class="ghost-button rd-red" id="rdRemoveAll">Remove all</button>' : ""}<span style="flex:1"></span><button type="button" class="convert" id="rdDone">Done</button></div>`, "wide");
  const save = async (opts) => {
    const res = await rdPost("/api/remote-set", opts);
    if (!res.ok) { $("rdManageErr").textContent = res.error; return; }
    rd.info = res; rdManage(); if (rd.open) rdDraw();
  };
  m.querySelectorAll("[data-opt]").forEach((b) => b.addEventListener("click", () => save({ [b.dataset.opt]: !me[b.dataset.opt] })));
  m.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => save({ forget: b.dataset.remove })));
  // (3.0) An empty box used to save "no PIN", so pressing Change without typing took the PIN off.
  $("rdPinSave").addEventListener("click", () => {
    const pin = $("rdPin").value.trim();
    if (!pin) { $("rdManageErr").textContent = "Type the new PIN first (4 to 12 numbers)."; $("rdPin").focus(); return; }
    save({ pin });
  });
  $("rdPin").addEventListener("keydown", (e) => { if (e.key === "Enter") $("rdPinSave").click(); });
  if ($("rdPinOff")) $("rdPinOff").addEventListener("click", () => save({ pin: "" }));
  $("rdNameSave").addEventListener("click", async () => {
    await rdPost("/api/remote-rename", { name: $("rdName").value.trim() });
    save({});
  });
  if ($("rdRemoveAll")) $("rdRemoveAll").addEventListener("click", () => save({ forgetAll: true }));
  $("rdDone").addEventListener("click", rdModalClose);
}

// ---- a PC wants to control THIS PC (the first time): you allow it here
function rdAsking(asking) {
  const was = rd.asking;
  rd.asking = asking;
  if (asking && (!was || was.id !== asking.id)) {
    const m = rdModal(`<div class="rd-big-ic">${RD_ICONS.remote}</div><h2>Let ${rdEsc(asking.name)} control this PC?</h2>
      <p>One of your PCs, logged in as <b>${rdEsc(sfxUser() ? sfxUser().username : "you")}</b>, wants to use this PC's screen, mouse, keyboard and sound.</p>
      <p style="margin-bottom:6px">Only press Allow if <b>${rdEsc(asking.name)}</b> shows this same code:</p>
      ${rdCodeHtml(asking.code)}
      <p class="rd-small-note">It will be remembered, so you only do this once. You can take it off in Remote > Safety settings.</p>
      <div class="rd-acts"><button type="button" class="ghost-button" id="rdNo">Don't allow</button><button type="button" class="convert" id="rdYes">Allow</button></div>`);
    const answer = async (yes) => { await rdPost("/api/remote-answer", { id: asking.id, yes }); rdModalClose(); };
    m.querySelector("#rdNo").addEventListener("click", () => answer(false));
    m.querySelector("#rdYes").addEventListener("click", () => answer(true));
    if (typeof appwindowFlash === "function") appwindowFlash();
  } else if (!asking && was && $("rdModal") && $("rdModal").querySelector("#rdYes")) {
    rdModalClose(); // it gave up waiting
  }
}

// ---- connecting to one of your PCs

async function rdConnect(id, screen = 0, mode = loadPref("rdMode") || "auto", switching = false) {
  const dev = rd.devices.find((d) => d.id === id);
  if (!dev || rd.conn) return;
  if (!rd.keys) rd.keys = await rdKeys("ctrl");
  const pc = new RTCPeerConnection({ iceServers: RD_ICE });
  const vt = pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  try { // the graphics card's own encoder is used most often for H.264: lower delay
    const caps = RTCRtpReceiver.getCapabilities("video").codecs;
    const order = (c) => (/h264/i.test(c.mimeType) ? 0 : /vp9/i.test(c.mimeType) ? 1 : /av1/i.test(c.mimeType) ? 2 : 3);
    vt.setCodecPreferences([...caps].sort((a, b) => order(a) - order(b)));
  } catch (e) { /* the default order */ }
  const ctl = pc.createDataChannel("ctl");
  const mv = pc.createDataChannel("mv", { ordered: false, maxRetransmits: 0 });
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const c = rd.conn = { id, dev, pc, ctl, mv, nonce, screen, mode, phase: "calling", stream: new MediaStream(), held: new Set(),
    bytes: 0, since: Date.now(), rtt: 0, fps: 0, height: 0, w: 0, h: 0, volume: loadPref("rdVolume") ?? 80, muted: false, tries: 0, switching };
  rdSession();
  rdPhase(switching ? `Switching to screen ${screen + 1}…` : "Connecting to " + dev.name + "…");
  pc.ontrack = (ev) => { c.stream.addTrack(ev.track); const v = $("rdVideo"); if (v) { v.srcObject = c.stream; v.play().catch(() => {}); } try { ev.receiver.jitterBufferTarget = 0; ev.receiver.playoutDelayHint = 0; } catch (e) { /* older */ } };
  pc.onconnectionstatechange = () => {
    if (rd.conn !== c) return;
    if (pc.connectionState === "failed") rdEnd("The connection dropped. Check the internet on both PCs and try again.");
  };
  ctl.onmessage = (m) => rdCtl(c, m.data);
  const offer = await pc.createOffer();
  // (3.1) Start fast: WebRTC normally starts at a low speed and creeps up, so the first seconds were
  // blurry and slow. On a home network it can start high (it still backs off by itself if it's too much).
  offer.sdp = rdStartFast(offer.sdp, mode === "save" ? [1500, 300] : [8000, 1000]);
  await pc.setLocalDescription(offer);
  await rdGathered(pc);
  if (rd.conn !== c) return;
  c.offerSdp = pc.localDescription.sdp;
  const ts = Math.round(Date.now() / 1000);
  const sig = await rdSign(rd.keys.priv, `offer|${id}|${rd.info.device}|${rdFingerprint(c.offerSdp)}|${nonce}|${ts}`);
  const sent = await rdPost("/api/remote-signal", { to: id, kind: "offer",
    body: JSON.stringify({ sdp: c.offerSdp, key: rd.keys.pub, name: rd.info.name, nonce, ts, sig, mode, screen }) });
  if (!sent.ok) return rdEnd(sent.error === "slow" ? "Too many tries. Wait a minute." : "Couldn't reach the server. Check your internet.");
  // Listen fast for the answer.
  c.wait = setInterval(() => { if (rd.conn === c && c.phase === "calling") rdHello(); }, 1000);
  // (2.37.1) After a screen switch the other PC's sender is starting again, which can take a little while.
  c.giveUp = setTimeout(() => { if (rd.conn === c && c.phase === "calling") rdEnd(`${dev.name} didn't answer. Is VaultHub open on it?`); }, switching ? 60000 : 25000);
}

async function rdConnSignal(s) {
  const c = rd.conn;
  if (!c || s.from !== c.id) return;
  let body;
  try { body = JSON.parse(s.body); } catch (e) { return; }
  if (!body || body.nonce !== c.nonce) return;
  if (s.kind === "bye") {
    return rdEnd(body.why === "busy" ? `Someone is already using ${c.dev.name}.` : `${c.dev.name} said no.`);
  }
  if (s.kind !== "answer" || c.phase !== "calling" || typeof body.sdp !== "string") return;
  // It must really be that PC: signed with its key, over this exact connection.
  const fp = rdFingerprint(body.sdp);
  const ok = fp && await rdVerify(body.key, `answer|${rd.info.device}|${c.id}|${fp}|${c.nonce}`, body.sig);
  if (!ok) return rdEnd("That answer wasn't signed right, so it was ignored. Try again.");
  const pinned = (rd.info.hosts || {})[c.id];
  if (pinned && pinned !== body.key) {
    return rdEnd(`${c.dev.name}'s key changed. If you reinstalled VaultHub on it, remove it with the X and add it again. If not, don't connect.`);
  }
  c.phase = "joining";
  clearInterval(c.wait); clearTimeout(c.giveUp);
  c.hostKey = body.key;
  await c.pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  if (!body.pair && !pinned) rdPost("/api/remote-remember-host", { device: c.id, key: body.key });
  if (body.pair) {
    const code = await rdCode(rd.keys.pub, body.key, rdFingerprint(c.offerSdp), fp);
    c.pairing = true;
    rdPhase("", `<div class="rd-big-ic">${RD_ICONS.shield}</div><h2>Allow it on ${rdEsc(c.dev.name)}</h2>
      <p>This is the first time this PC connects to ${rdEsc(c.dev.name)}. Go to ${rdEsc(c.dev.name)} and press <b>Allow</b>. Check that it shows the same code:</p>
      ${rdCodeHtml(code)}
      <ul class="rd-steps"><li class="done"><i>✓</i>Found ${rdEsc(c.dev.name)} on your account</li><li class="now"><i>2</i>Waiting for you to press Allow on it…</li><li><i>3</i>Connect. Next time it goes straight in</li></ul>`);
  } else {
    rdPhase("Connecting to " + c.dev.name + "…");
  }
  c.giveUp = setTimeout(() => { if (rd.conn === c && c.phase !== "on") rdEnd(c.pairing ? "Nobody pressed Allow in time." : "Couldn't connect. One of the networks may be too strict (a phone hotspot or work Wi-Fi)."); }, c.pairing ? 125000 : 25000);
}

function rdSend(c, msg) { if (c.ctl.readyState === "open") c.ctl.send(JSON.stringify(msg)); }

function rdCtl(c, data) {
  if (rd.conn !== c) return;
  let msg;
  try { msg = JSON.parse(data); } catch (e) { return; }
  if (msg.pong) { c.rttCtl = Date.now() - msg.pong; return; }
  if (msg.enc && typeof msg.enc === "object") { c.enc = msg.enc; return; }
  if (msg.waiting) return;
  if (msg.needPin || msg.pinBad) {
    if (c.pairing) { c.pairing = false; rdPost("/api/remote-remember-host", { device: c.id, key: c.hostKey }); }
    const why = msg.wait ? `Too many wrong tries. Wait ${Math.ceil(msg.wait / 60)} min.` : msg.pinBad ? `Wrong PIN.${msg.left ? ` ${msg.left} tries left.` : ""}` : "";
    rdPhase("", `<div class="rd-big-ic">${RD_ICONS.lock}</div><h2>PIN for ${rdEsc(c.dev.name)}</h2><p>${rdEsc(c.dev.name)} asks for its PIN.</p>
      <input id="rdPinIn" class="rd-pin-big" type="password" inputmode="numeric" maxlength="12" autocomplete="off">
      <p class="rd-error">${rdEsc(why)}</p>`, '<button type="button" class="convert" id="rdPinGo">Connect</button>');
    const go = () => rdSend(c, { pin: $("rdPinIn").value });
    $("rdPinGo").addEventListener("click", go);
    $("rdPinIn").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    $("rdPinIn").focus();
    return;
  }
  if (msg.ready) {
    if (c.pairing) { c.pairing = false; rdPost("/api/remote-remember-host", { device: c.id, key: c.hostKey }); }
    clearTimeout(c.giveUp);
    c.phase = "on"; c.w = msg.w; c.h = msg.h; c.screens = msg.screens || 1; c.audio = msg.audio;
    c.sound = msg.sound || (msg.audio ? "screen" : "none"); c.soundWhy = msg.soundWhy || "";
    rdPhase("");
    rdToolbar();
    rdHint(true);
    rdSendView();
    return;
  }
  if (msg.error === "screen") return rdEnd(`${c.dev.name} couldn't share its screen.`);
  if (Number.isInteger(msg.switching)) {
    const id = c.id, screen = msg.switching, mode = c.mode;
    rdEnd("", true);
    rdSession(); rdPhase(`Switching to screen ${screen + 1}…`);
    setTimeout(() => { rdSessionClose(); rdConnect(id, screen, mode, true); }, 5000);
    return;
  }
  if (msg.bye) {
    rdEnd({ stopped: "They stopped it on " + c.dev.name + ".", dropped: "The connection dropped.", declined: `${c.dev.name} said no.`, left: "" }[msg.bye] ?? "");
  }
}

// (3.1) Adds a start speed and a lowest speed to every video format in the offer (Chrome reads them).
function rdStartFast(sdp, [start, min]) {
  const extra = `x-google-start-bitrate=${start};x-google-min-bitrate=${min}`;
  const lines = sdp.split("\r\n");
  const video = new Set();
  for (const l of lines) { const m = /^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\/90000/i.exec(l); if (m) video.add(m[1]); }
  const hasFmtp = new Set();
  const out = lines.map((l) => {
    const m = /^a=fmtp:(\d+) /.exec(l);
    if (!m || !video.has(m[1])) return l;
    hasFmtp.add(m[1]);
    return `${l};${extra}`;
  });
  return out.flatMap((l) => { // (VP8 usually has no fmtp line: give it one)
    const m = /^a=rtpmap:(\d+) /.exec(l);
    return m && video.has(m[1]) && !hasFmtp.has(m[1]) ? [l, `a=fmtp:${m[1]} ${extra}`] : [l];
  }).join("\r\n");
}

// ---- the session view

function rdSession() {
  rdSessionClose();
  const s = document.createElement("div");
  s.className = "rd-session"; s.id = "rdSession";
  // (3.0) The other PC gets the whole window (the side bar is hidden behind it); Back or Disconnect returns.
  s.innerHTML = `<div class="rd-tool" id="rdTool"></div><div class="rd-screen" id="rdScreen">
    <video id="rdVideo" autoplay playsinline></video><div class="rd-input" id="rdInput" tabindex="0"></div>
    <div class="rd-phase" id="rdPhase" hidden></div><div class="rd-hint" id="rdHint" hidden></div></div>`;
  document.body.appendChild(s);
  rdToolbar();
  rdInputs();
}

function rdSessionClose() {
  const s = $("rdSession");
  if (s) s.remove();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function rdPhase(text, html, buttons = "") {
  const p = $("rdPhase");
  if (!p) return;
  p.hidden = !text && !html;
  p.innerHTML = html ? `<div class="rd-dlg">${html}<div class="rd-acts"><button type="button" class="ghost-button" id="rdCancel">Cancel</button>${buttons}</div></div>`
    : `<div class="rd-wait"><div class="rd-spin"></div>${rdEsc(text)}<div class="rd-acts" style="justify-content:center;margin-top:14px"><button type="button" class="ghost-button" id="rdCancel">Cancel</button></div></div>`;
  const cancel = $("rdCancel");
  if (cancel) cancel.addEventListener("click", () => rdEnd(""));
}

function rdHint(show) {
  const h = $("rdHint");
  if (!h) return;
  h.hidden = !show;
  h.innerHTML = `Your mouse and keyboard now control ${rdEsc(rd.conn ? rd.conn.dev.name : "it")}. Click the picture to start typing.`;
  clearTimeout(rdHint.t);
  if (show) rdHint.t = setTimeout(() => { h.hidden = true; }, 6000);
}

// (3.1) The top bar shows the whole picture delay, not just the network: what you feel is the network
// plus squeezing the picture there, waiting in the buffer here and unpacking it.
function rdDelay(c) {
  if (!c.rtt) return 0;
  const frame = c.fps ? 1000 / c.fps / 2 : 8;
  return Math.round(c.rtt / 2 + (c.enc ? c.enc.ms : 0) + (c.buf || 0) + (c.dec || 0) + frame);
}
function rdLiveHtml(c) {
  const d = rdDelay(c);
  const bars = d ? (d < 50 ? 4 : d < 90 ? 3 : d < 150 ? 2 : 1) : 0;
  return `<span class="rd-bars b${bars}"><i></i><i></i><i></i><i></i></span><b>${d ? d + " ms" : "…"}</b>${c.fps ? ` · ${Math.round(c.fps)} fps` : ""}${c.height ? ` · ${c.height}p` : ""}`;
}
function rdDelayTitle(c) {
  const r = (v) => Math.round(v || 0) + " ms";
  return `Network ${r(c.rtt / 2)} · squeezing there ${r(c.enc && c.enc.ms)} · buffer here ${r(c.buf)} · unpacking ${r(c.dec)}`;
}

function rdToolbar() {
  const t = $("rdTool"), c = rd.conn;
  if (!t || !c) return;
  t.innerHTML = `<button type="button" class="rd-tb" id="rdBack" title="Disconnect and go back">${RD_ICONS.back}</button>
    <div class="who">${c.dev.kind === "laptop" ? RD_ICONS.laptop : RD_ICONS.pc}<b>${rdEsc(c.dev.name)}</b></div>
    <div class="live" id="rdLive">${rdLiveHtml(c)}</div>
    <span class="sp"></span>
    <div class="rd-vol-wrap"><button type="button" class="rd-tb${c.muted ? "" : " on"}" id="rdMute" title="Sound">${c.muted || !c.volume ? RD_ICONS.mute : RD_ICONS.sound}</button>
      <div class="rd-vol-pop" id="rdVolPop" hidden><input type="range" id="rdVol" min="0" max="100" value="${c.volume}" title="Volume"><button type="button" class="rd-link" id="rdMuteBtn">${c.muted ? "Turn sound on" : "Mute"}</button></div></div>
    ${c.screens > 1 ? `<button type="button" class="rd-tb" id="rdScreens">${RD_ICONS.mons}Screen ${c.screen + 1}</button>` : ""}
    <button type="button" class="rd-tb" id="rdMenuBtn">${RD_ICONS.gear}Picture &amp; keys</button>
    <button type="button" class="rd-tb" id="rdFull" title="Full screen">${RD_ICONS.full}</button>
    <button type="button" class="rd-tb end" id="rdStop">${RD_ICONS.x}Disconnect</button>`;
  $("rdBack").onclick = $("rdStop").onclick = () => rdEnd("");
  $("rdFull").onclick = rdFullscreen;
  $("rdMenuBtn").onclick = () => rdMenu();
  if ($("rdScreens")) $("rdScreens").onclick = () => rdMenu();
  $("rdMute").onclick = (e) => { e.stopPropagation(); $("rdVolPop").hidden = !$("rdVolPop").hidden; };
  $("rdMuteBtn").onclick = () => { c.muted = !c.muted; rdApplyVolume(); rdToolbar(); $("rdVolPop").hidden = false; };
  $("rdVol").oninput = (e) => {
    c.volume = Number(e.target.value); c.muted = false; savePref("rdVolume", c.volume); rdApplyVolume();
    $("rdMute").innerHTML = c.volume ? RD_ICONS.sound : RD_ICONS.mute; $("rdMuteBtn").textContent = "Mute";
  };
  rdApplyVolume();
}

// (3.0) Tell the other PC how big the picture is here, so it never sends more pixels than you can see.
function rdSendView() {
  const c = rd.conn, box = $("rdScreen");
  if (!c || c.phase !== "on" || !box) return;
  const h = Math.max(720, Math.ceil((box.clientHeight * (window.devicePixelRatio || 1)) / 180) * 180);
  if (h !== c.viewH) { c.viewH = h; rdSend(c, { viewH: h }); }
}
window.addEventListener("resize", () => { clearTimeout(rdSendView.t); rdSendView.t = setTimeout(rdSendView, 400); });

function rdApplyVolume() {
  const v = $("rdVideo"), c = rd.conn;
  if (!v || !c) return;
  v.muted = c.muted;
  v.volume = Math.max(0, Math.min(1, c.volume / 100));
}

function rdFullscreen() {
  const s = $("rdSession");
  if (!s) return;
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  s.requestFullscreen().then(() => {
    // In full screen, Alt+Tab and the Windows key can go to the other PC too (when that's on).
    if (loadPref("rdSystemKeys") && navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
  }).catch(() => {});
}

function rdMenu() {
  const old = $("rdPop");
  if (old) { old.remove(); return; }
  const c = rd.conn;
  if (!c) return;
  const opt = (id, name, text) => `<button type="button" class="rd-opt${c.mode === id ? " on" : ""}" data-mode="${id}"><i class="r"></i><div><b>${name}</b>${text}</div></button>`;
  const gb = c.bytes / 1e9;
  const p = document.createElement("div");
  p.className = "rd-pop"; p.id = "rdPop";
  p.innerHTML = `<div><h4>Picture</h4>
      ${opt("auto", "Auto", "Picks the best for your internet, changes by itself.")}
      ${opt("smooth", "Smooth", "Always 60 fps, a bit softer. Best for games.")}
      ${opt("sharp", "Sharp", "Full detail for small text. Needs fast internet.")}
      ${opt("save", "Save data", "720p, 30 fps. For a phone hotspot: about 1 GB an hour.")}
      <p class="rd-used">Used ${gb < 0.1 ? Math.round(c.bytes / 1e6) + " MB" : gb.toFixed(2) + " GB"} so far</p>
      <p class="rd-used">${rdEsc(rdDelayTitle(c))}${c.enc ? `<br>Picture made by ${c.enc.gpu ? "the graphics card" : "the processor (slower)"}${c.enc.why && c.enc.why !== "none" ? `, held back by ${c.enc.why === "cpu" ? "the processor" : "the internet"}` : ""}` : ""}</p>
      <p class="rd-used">${c.sound === "none" ? `No sound from ${rdEsc(c.dev.name)}${c.soundWhy ? ` (${rdEsc(c.soundWhy)})` : ""}` : `Sound: on (${c.sound === "screen" ? "from the screen" : "from its speakers"})`}</p></div>
    ${c.screens > 1 ? `<div><h4>Screen</h4><div class="rd-mons">${Array.from({ length: c.screens }, (_, i) => `<button type="button" class="${i === c.screen ? "on" : ""}" data-screen="${i}">${i + 1}${i === 0 ? " · Main" : ""}</button>`).join("")}</div></div>` : ""}
    <div><h4>Keyboard</h4>
      <div class="rd-row"><span>Send Alt+Tab and the Windows key<small>In full screen. Off: they stay on this PC</small></span><button type="button" class="rd-sw${loadPref("rdSystemKeys") ? " on" : ""}" id="rdSysKeys"></button></div>
      <div class="rd-keys"><button type="button" data-keys="win">Windows key</button><button type="button" data-keys="alttab">Alt Tab</button><button type="button" data-keys="altf4">Alt F4</button><button type="button" data-keys="taskmgr">Task Manager</button><button type="button" data-keys="lock">Lock that PC</button></div></div>`;
  $("rdSession").appendChild(p);
  const btn = $("rdMenuBtn").getBoundingClientRect();
  p.style.top = btn.bottom + 6 + "px";
  p.style.right = Math.max(8, innerWidth - btn.right) + "px";
  p.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    c.mode = b.dataset.mode; savePref("rdMode", c.mode); rdSend(c, { mode: c.mode }); p.remove(); rdMenu();
  }));
  p.querySelectorAll("[data-screen]").forEach((b) => b.addEventListener("click", () => { p.remove(); rdSend(c, { screen: Number(b.dataset.screen) }); }));
  p.querySelectorAll("[data-keys]").forEach((b) => b.addEventListener("click", () => rdSend(c, { keys: b.dataset.keys })));
  $("rdSysKeys").addEventListener("click", () => { savePref("rdSystemKeys", !loadPref("rdSystemKeys")); p.remove(); rdMenu(); });
}

// ---- your mouse and keys go to the other PC

function rdInputs() {
  const area = $("rdInput"), video = $("rdVideo");
  if (!area) return;
  const at = (e) => {
    // Where on the other PC's screen: the picture is letterboxed inside the video box.
    const r = video.getBoundingClientRect(), vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const scale = Math.min(r.width / vw, r.height / vh), w = vw * scale, h = vh * scale;
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };
  const live = () => rd.conn && rd.conn.phase === "on";
  let pending = null;
  const flushMove = () => {
    rdInputs.frame = 0;
    const c = rd.conn;
    if (!pending || !live()) return;
    if (c.mv.readyState === "open") c.mv.send(JSON.stringify({ e: [{ t: "m", ...pending }] }));
    pending = null;
  };
  area.addEventListener("pointermove", (e) => {
    if (!live()) return;
    pending = at(e);
    if (!rdInputs.frame) rdInputs.frame = requestAnimationFrame(flushMove);
  });
  const btn = (e) => (e.button === 2 ? 2 : e.button === 1 ? 1 : 0);
  area.addEventListener("pointerdown", (e) => {
    if (!live()) return;
    e.preventDefault();
    area.focus();
    area.setPointerCapture(e.pointerId);
    $("rdPop") && $("rdPop").remove();
    $("rdVolPop") && ($("rdVolPop").hidden = true);
    rdSend(rd.conn, { e: [{ t: "m", ...at(e) }, { t: "d", b: btn(e) }] });
  });
  area.addEventListener("pointerup", (e) => { if (live()) rdSend(rd.conn, { e: [{ t: "m", ...at(e) }, { t: "u", b: btn(e) }] }); });
  area.addEventListener("contextmenu", (e) => e.preventDefault());
  area.addEventListener("wheel", (e) => {
    if (!live()) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1.2; // lines / pages / pixels -> wheel steps of 120
    rdSend(rd.conn, { e: [{ t: "w", dy: e.deltaY * k, dx: e.deltaX * k }] });
  }, { passive: false });
  const key = (down) => (e) => {
    if (!live() || document.activeElement !== area) return;
    e.preventDefault();
    if (down && e.repeat && rd.conn.held.has(e.code)) { /* held: Windows repeats it there by itself */ return; }
    rd.conn.held[down ? "add" : "delete"](e.code);
    rdSend(rd.conn, { e: [{ t: down ? "kd" : "ku", code: e.code }] });
  };
  area.addEventListener("keydown", key(true));
  area.addEventListener("keyup", key(false));
  area.addEventListener("blur", () => { // let go of anything still held (so no key gets stuck down there)
    const c = rd.conn;
    if (!c || !c.held.size) return;
    rdSend(c, { e: [...c.held].map((code) => ({ t: "ku", code })) });
    c.held.clear();
  });
}

// Every 2 seconds: how fast it is (shown at the top), and a ping so the other PC knows you're still there.
setInterval(async () => {
  const c = rd.conn;
  if (!c || c.phase === "calling") return;
  rdSend(c, { ping: Date.now() });
  try {
    const stats = await c.pc.getStats();
    let bytes = 0;
    let pair = "";
    stats.forEach((s) => { if (s.type === "transport" && s.selectedCandidatePairId) pair = s.selectedCandidatePairId; });
    let rtt = 0;
    stats.forEach((s) => {
      if (s.type === "inbound-rtp") {
        bytes += s.bytesReceived || 0;
        if (s.kind === "video") {
          c.fps = s.framesPerSecond || 0; c.height = s.frameHeight || 0;
          // (3.1) How long pictures wait here before they're shown (buffer + unpacking), since last time.
          const jbN = (s.jitterBufferEmittedCount || 0) - (c.jbN || 0), jbT = (s.jitterBufferDelay || 0) - (c.jbT || 0);
          const dN = (s.framesDecoded || 0) - (c.dN || 0), dT = (s.totalDecodeTime || 0) - (c.dT || 0);
          c.jbN = s.jitterBufferEmittedCount || 0; c.jbT = s.jitterBufferDelay || 0; c.dN = s.framesDecoded || 0; c.dT = s.totalDecodeTime || 0;
          c.buf = jbN > 0 ? (jbT / jbN) * 1000 : 0; c.dec = dN > 0 ? (dT / dN) * 1000 : 0;
          c.decName = s.decoderImplementation || "";
        }
      }
      if (s.type === "candidate-pair" && (s.id === pair || (!pair && s.nominated)) && s.currentRoundTripTime != null) rtt = s.currentRoundTripTime * 1000;
    });
    c.rtt = rtt || c.rttCtl || 0;
    c.bytes = bytes;
    const live = $("rdLive");
    if (live && c.phase === "on") {
      live.innerHTML = rdLiveHtml(c);
      live.title = rdDelayTitle(c);
    }
  } catch (e) { /* closed */ }
}, 2000);

function rdEnd(why, quiet) {
  const c = rd.conn;
  if (!c) return;
  rd.conn = null;
  clearInterval(c.wait); clearTimeout(c.giveUp);
  if (c.held.size) rdSend(c, { e: [...c.held].map((code) => ({ t: "ku", code })) });
  rdSend(c, { bye: true });
  if (c.phase === "calling" || c.phase === "joining") rdPost("/api/remote-signal", { to: c.id, kind: "bye", body: JSON.stringify({ nonce: c.nonce }) });
  setTimeout(() => { try { c.pc.close(); } catch (e) { /* gone */ } }, 200);
  if (quiet) return;
  rdSessionClose();
  if (why) rdModal(`<div class="rd-big-ic">${RD_ICONS.remote}</div><h2>Disconnected</h2><p>${rdEsc(why)}</p><div class="rd-acts"><button type="button" class="convert" id="rdOk">OK</button></div>`)
    .querySelector("#rdOk").addEventListener("click", rdModalClose);
  if (rd.open) rdDraw();
}

document.addEventListener("click", (e) => { // a click anywhere else closes the volume pop-up
  const pop = $("rdVolPop");
  if (pop && !pop.hidden && !e.target.closest(".rd-vol-wrap")) pop.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("rdVolPop") && !$("rdVolPop").hidden) $("rdVolPop").hidden = true;
  else if (e.key === "Escape" && $("rdPop")) $("rdPop").remove();
  else if (e.key === "Escape" && $("rdModal") && !$("rdModal").querySelector("#rdYes")) rdModalClose();
});
// (2.38.2) When the app opens on the Remote page, the page was picked before this file loaded, so it
// never heard about it and stayed empty until you clicked Remote again.
if ($("remoteTab") && !$("remoteTab").hidden) rd.open = true;
remoteAccountChanged();
