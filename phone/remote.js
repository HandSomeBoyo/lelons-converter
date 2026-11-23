// Remote desktop from the phone: see and use one of your PCs (the ones with "let my other PCs control this
// one" on). The phone is only ever the one controlling: nobody can control the phone.
// Same safety as the PC app: this phone has its own key pair (the private half can't be read back out,
// it's kept by the browser for this app), every hello is signed over the connection's lock, and the first
// time you press Allow on the PC after checking both show the same 6-digit code.
//
// Touch: tap = click, hold = right-click, drag = drag, two fingers = scroll, pinch = zoom in.
"use strict";

const RM = { devices: null, after: 0, keys: null, device: store.get("rmDevice", ""), error: "", timer: 0, conn: null, hosts: store.get("rmHosts", {}) };
const RM_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

const rmB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const rmUnB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const rmBytes = (text) => new TextEncoder().encode(text);
const rmCanUse = () => S.me && ["owner", "admin"].includes(S.me.role);

// ---------------------------------------------------------------- this phone's keys (kept in IndexedDB)

function rmDb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open("vaulthub-remote", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function rmKeys() {
  if (RM.keys) return RM.keys;
  const db = await rmDb();
  const get = () => new Promise((ok) => { const q = db.transaction("keys").objectStore("keys").get("ctrl"); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); });
  let kept = await get();
  if (!kept) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    kept = { priv: pair.privateKey, pub: rmB64(await crypto.subtle.exportKey("spki", pair.publicKey)) };
    await new Promise((ok, bad) => { const t = db.transaction("keys", "readwrite"); t.objectStore("keys").put(kept, "ctrl"); t.oncomplete = ok; t.onerror = () => bad(t.error); });
  }
  if (!RM.device) { RM.device = crypto.randomUUID(); store.set("rmDevice", RM.device); }
  return (RM.keys = kept);
}
async function rmSign(text) { return rmB64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, RM.keys.priv, rmBytes(text))); }
async function rmVerify(pub, text, sig) {
  try {
    const key = await crypto.subtle.importKey("spki", rmUnB64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rmUnB64(sig), rmBytes(text));
  } catch { return false; }
}
function rmFingerprint(sdp) { const m = /^a=fingerprint:sha-256 ([0-9A-F:]+)/im.exec(sdp || ""); return m ? m[1].toUpperCase() : ""; }
async function rmCode(ctrlKey, hostKey, fpOffer, fpAnswer) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", rmBytes(`vaulthub-remote|${ctrlKey}|${hostKey}|${fpOffer}|${fpAnswer}`)));
  const n = ((hash[0] << 24) >>> 0) + (hash[1] << 16) + (hash[2] << 8) + hash[3];
  return String(n % 1000000).padStart(6, "0");
}
function rmGathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((done) => {
    let soon = 0;
    const finish = () => { clearTimeout(timer); clearTimeout(soon); pc.removeEventListener("icegatheringstatechange", check); pc.removeEventListener("icecandidate", found); done(); };
    const check = () => { if (pc.iceGatheringState === "complete") finish(); };
    const found = (e) => { if (e.candidate && / typ srflx /.test(e.candidate.candidate) && !soon) soon = setTimeout(finish, 300); };
    const timer = setTimeout(finish, 2500);
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", found);
  });
}

// ---------------------------------------------------------------- the list of PCs

function openRemote() {
  S.view = { kind: "remote" };
  renderRemote();
  rmLoop();
}

async function rmHello() {
  await rmKeys();
  const r = await rpcMe("lelons_remote", { what: "hello", device: RM.device, after: RM.after,
    data: { name: phoneName(), kind: "phone", host: false, ctrlKey: RM.keys.pub } });
  if (!r || !r.ok) {
    RM.error = r && r.error === "owner_only" ? "Only the owner and admins can use Remote." : r && r.error === "too_many" ? "Your account has too many PCs on Remote. Remove one on your PC first." : "Can't reach the server right now.";
    return;
  }
  RM.error = "";
  RM.devices = r.devices || [];
  for (const s of r.signals || []) {
    RM.after = Math.max(RM.after, s.id);
    if (RM.conn) rmSignal(s);
  }
}

async function rmLoop() {
  clearTimeout(RM.timer);
  const open = S.view && S.view.kind === "remote";
  if (!open && !RM.conn) return;
  try { await rmHello(); } catch (e) { RM.error = e.message; }
  if (S.view && S.view.kind === "remote" && !RM.conn) rmDrawList();
  RM.timer = setTimeout(rmLoop, RM.conn && RM.conn.phase === "calling" ? 1000 : 3000);
}

function renderRemote() {
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><b>Remote</b></div></div>
    <div class="scroll" id="rmList">${rmListHtml()}</div></div>`;
  $("#back").onclick = () => { clearTimeout(RM.timer); closeView(); };
  $("#app").onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) rmConnect(b.dataset.rm); };
  afterRender();
}

function rmListHtml() {
  if (!rmCanUse()) return '<div class="empty">Only the owner and admins can use Remote.</div>';
  if (!RM.devices) return RM.error ? `<div class="empty">${esc(RM.error)}</div>` : '<div class="spin"></div>';
  const pcs = RM.devices.filter((d) => !d.me && d.host);
  const ago = (t) => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  return `${RM.error ? `<div class="sm" style="color:var(--red);margin:6px 4px">${esc(RM.error)}</div>` : ""}
    ${pcs.length ? `<div class="card list">${pcs.map((d) => `<button class="row rm-pc ${d.online ? "" : "off"}" data-rm="${esc(d.id)}" ${d.online ? "" : "disabled"}>
        <span class="rm-ic">${d.kind === "laptop" ? RMI.laptop : RMI.pc}</span>
        <div class="grow"><b class="one" style="display:block">${esc(d.name)}</b><div class="sm muted">${d.online ? (d.busy ? "In use right now" : "Ready") : "Asleep or VaultHub closed · " + ago(d.seen)}</div></div>
        ${d.online ? '<span class="btn2 go">Connect</span>' : ""}</button>`).join("")}</div>`
      : `<div class="empty"><b style="color:var(--text)">No PCs to control yet</b><br>On the PC you want to use, open VaultHub, go to Remote and turn on "Let my other PCs control this one".</div>`}
    <div class="lbl">How to use it</div>
    <div class="card list rm-help">
      <div class="row"><span class="rm-k">Tap</span><span class="sm">Click</span></div>
      <div class="row"><span class="rm-k">Hold</span><span class="sm">Right-click</span></div>
      <div class="row"><span class="rm-k">Drag</span><span class="sm">Drag things, select text</span></div>
      <div class="row"><span class="rm-k">2 fingers</span><span class="sm">Scroll, or pinch to zoom in</span></div></div>
    <div class="sm muted" style="padding:14px 4px">The first time, ${esc(phoneName())} shows a code and you press Allow on the PC. Turn your phone sideways for a bigger picture.</div>`;
}

function rmDrawList() {
  const box = $("#rmList");
  if (box) box.innerHTML = rmListHtml();
}

// ---------------------------------------------------------------- connecting (the same notes as the PC app)

async function rmConnect(id) {
  const dev = (RM.devices || []).find((d) => d.id === id);
  if (!dev || RM.conn) return;
  try { await rmKeys(); } catch { return toast("This browser can't keep a Remote key. Open VaultHub from your Home Screen."); }
  const pc = new RTCPeerConnection({ iceServers: RM_ICE });
  const vt = pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  try { // H.264 first: iPhones unpack it with their own chip (smooth, and easy on the battery)
    const caps = RTCRtpReceiver.getCapabilities("video").codecs;
    const order = (c) => (/h264/i.test(c.mimeType) ? 0 : /vp9/i.test(c.mimeType) ? 1 : 2);
    vt.setCodecPreferences([...caps].sort((a, b) => order(a) - order(b)));
  } catch { /* the default order */ }
  const ctl = pc.createDataChannel("ctl");
  const mv = pc.createDataChannel("mv", { ordered: false, maxRetransmits: 0 });
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const c = RM.conn = { id, dev, pc, ctl, mv, nonce, phase: "calling", stream: new MediaStream(), zoom: 1, px: 0, py: 0, held: new Set() };
  rmSession();
  rmPhase(`<div class="spin"></div><b>Connecting to ${esc(dev.name)}...</b>`);
  pc.ontrack = (ev) => {
    c.stream.addTrack(ev.track);
    const v = $("#rmVideo");
    if (v) { v.srcObject = c.stream; v.play().catch(() => rmSoundButton(true)); }
    try { ev.receiver.jitterBufferTarget = 0; } catch { /* older */ }
  };
  pc.onconnectionstatechange = () => { if (RM.conn === c && pc.connectionState === "failed") rmEnd("The connection dropped. Check the internet on both and try again."); };
  ctl.onmessage = (m) => rmCtl(c, m.data);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await rmGathered(pc);
  if (RM.conn !== c) return;
  c.offerSdp = pc.localDescription.sdp;
  const ts = Math.round(Date.now() / 1000);
  const sig = await rmSign(`offer|${id}|${RM.device}|${rmFingerprint(c.offerSdp)}|${nonce}|${ts}`);
  const sent = await rpcMe("lelons_remote", { what: "signal", device: RM.device, data: { to: id, kind: "offer",
    body: JSON.stringify({ sdp: c.offerSdp, key: RM.keys.pub, name: phoneName(), nonce, ts, sig, mode: "auto", screen: 0 }) } }).catch(() => null);
  if (!sent || !sent.ok) return rmEnd(sent && sent.error === "slow" ? "Too many tries. Wait a minute." : "Couldn't reach the server. Check your internet.");
  rmLoop(); // (listens fast for the answer)
  c.giveUp = setTimeout(() => { if (RM.conn === c && c.phase === "calling") rmEnd(`${dev.name} didn't answer. Is VaultHub open on it?`); }, 25000);
}

async function rmSignal(s) {
  const c = RM.conn;
  if (!c || s.from !== c.id) return;
  let body;
  try { body = JSON.parse(s.body); } catch { return; }
  if (!body || body.nonce !== c.nonce) return;
  if (s.kind === "bye") return rmEnd(body.why === "busy" ? `Someone is already using ${c.dev.name}.` : `${c.dev.name} said no.`);
  if (s.kind !== "answer" || c.phase !== "calling" || typeof body.sdp !== "string") return;
  const fp = rmFingerprint(body.sdp);
  const ok = fp && await rmVerify(body.key, `answer|${RM.device}|${c.id}|${fp}|${c.nonce}`, body.sig);
  if (!ok) return rmEnd("That answer wasn't signed right, so it was ignored. Try again.");
  const pinned = RM.hosts[c.id];
  if (pinned && pinned !== body.key) return rmEnd(`${c.dev.name}'s key changed. If you reinstalled VaultHub on it, that's why: remove this phone in Remote on the PC and try again. If not, don't connect.`);
  c.phase = "joining";
  clearTimeout(c.giveUp);
  c.hostKey = body.key;
  await c.pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  if (!body.pair && !pinned) rmRemember(c);
  if (body.pair) {
    const code = await rmCode(RM.keys.pub, body.key, rmFingerprint(c.offerSdp), fp);
    c.pairing = true;
    rmPhase(`<div class="rm-shield">${RMI.shield}</div><b>Press Allow on ${esc(c.dev.name)}</b>
      <div class="sm muted">The first time, you allow ${esc(phoneName())} on the PC. Check it shows the same code:</div>
      <div class="rm-code">${code.slice(0, 3)} ${code.slice(3)}</div>`);
  } else {
    rmPhase(`<div class="spin"></div><b>Connecting to ${esc(c.dev.name)}...</b>`);
  }
  c.giveUp = setTimeout(() => { if (RM.conn === c && c.phase !== "on") rmEnd(c.pairing ? "Nobody pressed Allow in time." : "Couldn't connect. One of the networks may be too strict (like work Wi-Fi)."); }, c.pairing ? 125000 : 25000);
}

function rmRemember(c) { RM.hosts[c.id] = c.hostKey; store.set("rmHosts", RM.hosts); }
function rmSend(c, msg) { if (c.ctl.readyState === "open") c.ctl.send(JSON.stringify(msg)); }

function rmCtl(c, data) {
  if (RM.conn !== c) return;
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (msg.pong || msg.enc || msg.waiting) return;
  if (msg.needPin || msg.pinBad) {
    if (c.pairing) { c.pairing = false; rmRemember(c); }
    const why = msg.wait ? `Too many wrong tries. Wait ${Math.ceil(msg.wait / 60)} min.` : msg.pinBad ? `Wrong PIN.${msg.left ? ` ${msg.left} tries left.` : ""}` : "";
    rmPhase(`<div class="rm-shield">${RMI.lock}</div><b>PIN for ${esc(c.dev.name)}</b>
      <input class="field rm-pin" id="rmPin" type="password" inputmode="numeric" maxlength="12" autocomplete="off">
      ${why ? `<div class="sm" style="color:var(--red)">${esc(why)}</div>` : ""}<button class="btn" id="rmPinGo">Connect</button>`);
    const go = () => rmSend(c, { pin: $("#rmPin").value });
    $("#rmPinGo").onclick = go;
    $("#rmPin").onkeydown = (e) => { if (e.key === "Enter") go(); };
    setTimeout(() => $("#rmPin") && $("#rmPin").focus(), 50);
    return;
  }
  if (msg.ready) {
    if (c.pairing) { c.pairing = false; rmRemember(c); }
    clearTimeout(c.giveUp);
    c.phase = "on"; c.w = msg.w; c.h = msg.h;
    rmPhase("");
    rmView(c);
    $("#rmBar").hidden = false;
    return;
  }
  if (msg.error === "screen") return rmEnd(`${c.dev.name} couldn't share its screen.`);
  if (Number.isInteger(msg.switching)) return rmEnd("The PC switched screens. Connect again.");
  if (msg.bye) rmEnd({ stopped: `They stopped it on ${c.dev.name}.`, dropped: "The connection dropped.", declined: `${c.dev.name} said no.`, left: "" }[msg.bye] ?? "");
}

// Tells the PC how big the picture is here, so it never sends more than the phone can show.
function rmView(c) {
  const v = $("#rmVideo");
  if (!v || c.phase !== "on") return;
  const h = Math.round(Math.min(innerHeight, innerWidth * 9 / 16) * (devicePixelRatio || 2) * Math.max(1, c.zoom));
  rmSend(c, { viewH: Math.max(360, Math.min(2160, h)) });
}

function rmEnd(why) {
  const c = RM.conn;
  if (!c) return;
  RM.conn = null;
  clearTimeout(c.giveUp);
  if (c.held.size) rmSend(c, { e: [...c.held].map((b) => ({ t: "u", b })) });
  rmSend(c, { bye: true });
  if (c.phase === "calling" || c.phase === "joining") rpcMe("lelons_remote", { what: "signal", device: RM.device, data: { to: c.id, kind: "bye", body: JSON.stringify({ nonce: c.nonce }) } }).catch(() => {});
  setTimeout(() => { try { c.pc.close(); } catch { /* gone */ } }, 200);
  const el = $("#rm");
  if (el) { el.classList.add("away"); setTimeout(() => el.remove(), 250); }
  if (why) toast(why);
  if (S.view && S.view.kind === "remote") { rmDrawList(); rmLoop(); }
}

// ---------------------------------------------------------------- the session screen

function rmSession() {
  const old = $("#rm");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "rm";
  el.innerHTML = `<div class="rm-stage" id="rmStage"><video id="rmVideo" autoplay playsinline></video></div>
    <div class="rm-phase" id="rmPhase"></div>
    <div class="rm-bar glass" id="rmBar" hidden>
      <button data-rmb="end" class="rm-x" aria-label="Disconnect">${RMI.x}</button>
      <button data-rmb="kb" aria-label="Keyboard">${RMI.kb}</button>
      <button data-rmb="keys" aria-label="Keys">${RMI.win}</button>
      <button data-rmb="fit" aria-label="Fit">${RMI.fit}</button>
      <button data-rmb="sound" id="rmSound" aria-label="Sound" hidden>${RMI.sound}</button></div>
    <div class="rm-keys glass" id="rmKeys" hidden>${[["Esc", "Escape"], ["Tab", "Tab"], ["⌫", "Backspace"], ["←", "ArrowLeft"], ["↑", "ArrowUp"], ["↓", "ArrowDown"], ["→", "ArrowRight"], ["Enter", "Enter"]]
      .map(([n, k]) => `<button data-rmkey="${k}">${n}</button>`).join("")}</div>
    <input id="rmKb" class="rm-kb" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-hidden="true">`;
  document.body.appendChild(el);
  el.querySelector("#rmPhase").addEventListener("click", (e) => { if (e.target.closest("[data-rmb=end]")) rmEnd(""); });
  el.addEventListener("click", rmBarClick);
  rmTouch(el.querySelector("#rmStage"));
  rmKeyboard(el.querySelector("#rmKb"));
}

function rmPhase(html) {
  const p = $("#rmPhase");
  if (!p) return;
  p.hidden = !html;
  p.innerHTML = html ? `<div class="rm-card">${html}<button class="btn2" data-rmb="end">Cancel</button></div>` : "";
}

function rmSoundButton(show) { const b = $("#rmSound"); if (b) b.hidden = !show; }

function rmKeysPress(...codes) {
  return [...codes.map((code) => ({ t: "kd", code })), ...codes.reverse().map((code) => ({ t: "ku", code }))];
}

function rmBarClick(e) {
  const c = RM.conn;
  const b = e.target.closest("[data-rmb],[data-rmkey],[data-rmcombo]");
  if (!b || !c) return;
  if (b.dataset.rmkey) return rmSend(c, { e: rmKeysPress(b.dataset.rmkey) });
  if (b.dataset.rmcombo) {
    $("#rmPop") && $("#rmPop").remove();
    return rmSend(c, { keys: b.dataset.rmcombo });
  }
  const a = b.dataset.rmb;
  if (a === "end") return rmEnd("");
  if (a === "kb") {
    const kb = $("#rmKb");
    if (document.activeElement === kb) { kb.blur(); return; }
    kb.value = "  "; kb.focus();
    return;
  }
  if (a === "fit") { c.zoom = 1; c.px = 0; c.py = 0; rmApplyZoom(c); return; }
  if (a === "sound") { const v = $("#rmVideo"); v.muted = false; v.play().then(() => rmSoundButton(false)).catch(() => {}); return; }
  if (a === "keys") {
    if ($("#rmPop")) return $("#rmPop").remove();
    const pop = document.createElement("div");
    pop.id = "rmPop"; pop.className = "rm-pop glass";
    pop.innerHTML = [["win", "Start menu"], ["alttab", "Switch window (Alt+Tab)"], ["taskmgr", "Task Manager"], ["altf4", "Close window (Alt+F4)"], ["lock", "Lock the PC"]]
      .map(([k, n]) => `<button data-rmcombo="${k}">${n}</button>`).join("");
    $("#rm").appendChild(pop);
  }
}

function rmApplyZoom(c) {
  const v = $("#rmVideo");
  if (!v) return;
  const max = (k) => (k - 1) / 2;
  c.px = Math.max(-max(c.zoom) * v.clientWidth, Math.min(max(c.zoom) * v.clientWidth, c.px));
  c.py = Math.max(-max(c.zoom) * v.clientHeight, Math.min(max(c.zoom) * v.clientHeight, c.py));
  v.style.transform = c.zoom > 1 ? `translate(${c.px}px, ${c.py}px) scale(${c.zoom})` : "";
}

// Where a finger is on the PC's screen (0..1). The picture is letterboxed and maybe zoomed.
function rmAt(x, y) {
  const v = $("#rmVideo");
  const r = v.getBoundingClientRect(), vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  const scale = Math.min(r.width / vw, r.height / vh), w = vw * scale, h = vh * scale;
  return { x: Math.max(0, Math.min(1, (x - r.left - (r.width - w) / 2) / w)), y: Math.max(0, Math.min(1, (y - r.top - (r.height - h) / 2) / h)) };
}

function rmTouch(stage) {
  let t0 = null, hold = 0, mode = "", two = null, frame = 0, moveTo = null, wheel = 0;
  const live = () => RM.conn && RM.conn.phase === "on";
  const send = (e) => rmSend(RM.conn, { e });
  const flush = () => { frame = 0; const c = RM.conn; if (!live() || !moveTo) return; if (c.mv.readyState === "open") c.mv.send(JSON.stringify({ e: [{ t: "m", ...moveTo }] })); moveTo = null; };
  const mid = (ts) => ({ x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2, d: Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) });
  stage.addEventListener("touchstart", (e) => {
    if (!live()) return;
    e.preventDefault();
    $("#rmPop") && $("#rmPop").remove();
    if (e.touches.length === 2) {
      clearTimeout(hold);
      if (mode === "drag") send([{ t: "m", ...rmAt(t0.x, t0.y) }, { t: "u", b: 0 }]), RM.conn.held.delete(0);
      const m = mid(e.touches);
      two = { start: m, last: m, zoom: RM.conn.zoom, px: RM.conn.px, py: RM.conn.py, kind: "" };
      mode = "two";
      return;
    }
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    t0 = { x: p.clientX, y: p.clientY, at: Date.now() };
    mode = "wait";
    hold = setTimeout(() => { // held still: right-click
      if (mode !== "wait") return;
      mode = "done";
      send([{ t: "m", ...rmAt(t0.x, t0.y) }, { t: "d", b: 2 }, { t: "u", b: 2 }]);
      rmRipple(t0.x, t0.y, true);
    }, 520);
  }, { passive: false });
  stage.addEventListener("touchmove", (e) => {
    if (!live()) return;
    e.preventDefault();
    const c = RM.conn;
    if (mode === "two" && e.touches.length === 2) {
      const m = mid(e.touches);
      if (!two.kind) { // pinch (zoom) or slide (scroll)?
        const dd = Math.abs(m.d - two.start.d), dm = Math.hypot(m.x - two.start.x, m.y - two.start.y);
        if (dd > 18 || (c.zoom > 1 && dm > 10)) two.kind = "zoom";
        else if (dm > 10) two.kind = "scroll";
      }
      if (two.kind === "zoom") {
        c.zoom = Math.max(1, Math.min(4, two.zoom * (m.d / two.start.d)));
        c.px = two.px + (m.x - two.start.x); c.py = two.py + (m.y - two.start.y);
        rmApplyZoom(c);
      } else if (two.kind === "scroll") {
        wheel += (two.last.y - m.y) * 3;
        if (Math.abs(wheel) >= 40) { send([{ t: "w", dy: wheel, dx: 0 }]); wheel = 0; }
      }
      two.last = m;
      return;
    }
    if (e.touches.length !== 1 || !t0) return;
    const p = e.touches[0];
    if (mode === "wait" && Math.hypot(p.clientX - t0.x, p.clientY - t0.y) > 10) { // a drag: press where it started
      clearTimeout(hold);
      mode = "drag";
      c.held.add(0);
      send([{ t: "m", ...rmAt(t0.x, t0.y) }, { t: "d", b: 0 }]);
    }
    if (mode === "drag") { moveTo = rmAt(p.clientX, p.clientY); if (!frame) frame = requestAnimationFrame(flush); }
  }, { passive: false });
  const end = (e) => {
    if (!live()) return;
    e.preventDefault();
    clearTimeout(hold);
    if (mode === "two") { if (e.touches.length === 0) { mode = ""; if (two && two.kind === "zoom") rmView(RM.conn); two = null; } return; }
    const p = e.changedTouches[0];
    if (mode === "wait") { // a tap: click there
      send([{ t: "m", ...rmAt(t0.x, t0.y) }, { t: "d", b: 0 }, { t: "u", b: 0 }]);
      rmRipple(t0.x, t0.y);
    } else if (mode === "drag") {
      send([{ t: "m", ...rmAt(p.clientX, p.clientY) }, { t: "u", b: 0 }]);
      RM.conn.held.delete(0);
    }
    mode = ""; t0 = null;
  };
  stage.addEventListener("touchend", end, { passive: false });
  stage.addEventListener("touchcancel", end, { passive: false });
  // (a mouse, for trying it on a computer)
  stage.addEventListener("mousedown", (e) => { if (!live()) return; send([{ t: "m", ...rmAt(e.clientX, e.clientY) }, { t: "d", b: e.button === 2 ? 2 : 0 }]); });
  stage.addEventListener("mouseup", (e) => { if (!live()) return; send([{ t: "m", ...rmAt(e.clientX, e.clientY) }, { t: "u", b: e.button === 2 ? 2 : 0 }]); });
  stage.addEventListener("contextmenu", (e) => e.preventDefault());
}

function rmRipple(x, y, right) {
  const r = document.createElement("i");
  r.className = "rm-tap" + (right ? " right" : "");
  r.style.left = x + "px"; r.style.top = y + "px";
  $("#rm").appendChild(r);
  setTimeout(() => r.remove(), 450);
}

// The phone's keyboard: letters go as typed text (so æ, ø, å and emoji work too), the rest as keys.
function rmKeyboard(kb) {
  const reset = () => { kb.value = "  "; try { kb.setSelectionRange(2, 2); } catch { /* fine */ } };
  kb.addEventListener("focus", () => { $("#rmKeys").hidden = false; reset(); });
  kb.addEventListener("blur", () => { $("#rmKeys").hidden = true; });
  kb.addEventListener("beforeinput", (e) => {
    const c = RM.conn;
    if (!c || c.phase !== "on") return;
    e.preventDefault();
    if (e.inputType === "insertText" || e.inputType === "insertReplacementText") { if (e.data) rmSend(c, { e: [{ t: "txt", s: e.data }] }); }
    else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") rmSend(c, { e: rmKeysPress("Enter") });
    else if (e.inputType.startsWith("deleteContentBackward") || e.inputType === "deleteWordBackward") rmSend(c, { e: rmKeysPress("Backspace") });
    reset();
  });
  kb.addEventListener("input", reset); // (a browser that ignored preventDefault)
  kb.addEventListener("keydown", (e) => {
    const c = RM.conn;
    if (!c || c.phase !== "on") return;
    if (e.key === "Enter") { e.preventDefault(); rmSend(c, { e: rmKeysPress("Enter") }); }
  });
}

// Every 2 seconds a ping, so the PC knows the phone is still there.
setInterval(() => { const c = RM.conn; if (c && c.phase !== "calling") rmSend(c, { ping: Date.now() }); }, 2000);
addEventListener("resize", () => { if (RM.conn) { rmApplyZoom(RM.conn); rmView(RM.conn); } });

const RMI = {
  pc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  kb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14.5h8"/></svg>',
  win: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
};
