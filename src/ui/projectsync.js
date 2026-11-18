// (2.41.0) Projects, PC to PC: the footage and cut videos go straight from one VaultHub to another (WebRTC data
// channels, like POVs and the calls), nothing is uploaded anywhere. Free, no size limit.
//  - Every few seconds: "I'm here" and the offers/answers for this PC (lelons_project check).
//  - Every 15 s: every file of your projects, who has it and who's online (sync, see projectsync.py).
//  - A file you don't have comes in 32 MB blocks, from everyone online who has it at once (each friend sends
//    other blocks). A stopped download goes on with the blocks it still needs. projectsync.py checks the whole
//    file against its fingerprint at the end: a broken one is got again.
//  - Friends get your files from you (and from each other) the same way. It slows down while you're in a call
//    or live, if you want (Sharing settings).
// Uses $, api() from app.js, CALL_SERVERS/callGathered()/call from call.js, sfxUser() from sfx.js and the
// pj* helpers from projects.js.

const PS_PIECE = 64 * 1024; // one message on the data channel
const PS_READ = 4 * 1024 * 1024; // what the sender reads from the file at once
const PS_WRITE = 4 * 1024 * 1024; // what the getter writes at once
const PS_AHEAD = 48 * 1024 * 1024; // how far the sender may be ahead of what's saved on the other side
const PS_BUFFERED = 8 * 1024 * 1024;
const PS_MAX_GETS = 4; // friends this PC gets from at once
const PS_MAX_SENDS = 6; // friends this PC sends to at once
const PS_SLOW = 1024 * 1024; // bytes a second while you're live or in a call (when "slow down" is on)
const PS_LIMITS = [0, 1, 2, 5, 10, 25, 50];

let psProjects = []; // from sync: [{id, name, folder, people, files: [{id, kind, name, size, here, sources, holders, ...}]}]
let psOptions = { auto: true, slow: true, share: true, limit: 0 };
let psAfter = 0, psCheckTimer = 0, psSyncTimer = 0, psPumpTimer = 0, psAwakeAt = 0, psStarted = false, psPaused = false;
const psSeen = new Set();
const psGets = new Map(); // file id -> {id, project, name, size, blocks, block, done: Set, inflight: Map(block -> conn), got, status, message}
const psConns = new Map(); // "project|friend" -> a connection this PC opened to get files: {key, project, peer, pc, dc, transfer, status, req, sameNet, ...}
const psSends = new Map(); // transfer -> a friend getting files from this PC: {transfer, project, to, pc, dc, status, sent, file, ...}
const psWanted = new Set(); // files asked for by hand (when "download by themselves" is off)
const psBackoff = new Map(); // friend -> time before trying them again
const psLog = []; // finished transfers for the panel: {name, to/from, at, ok, message}

const psLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();
const psMe = () => (psLoggedIn() && sfxUser().username) || "";
const psFile = (id) => { for (const p of psProjects) for (const f of p.files) if (f.id === id) return { ...f, project: p.id }; return null; };
const psLive = () => {
  const s = typeof LV !== "undefined" && LV && LV.state;
  return !!(s && ((s.obs && s.obs.streaming) || (s.twitch && s.twitch.live) || (s.youtube && s.youtube.live)));
};
const psInCall = () => typeof call !== "undefined" && !!call;
// Bytes a second this PC may use now (0: no limit), and why.
function psRate() {
  let rate = psOptions.limit ? psOptions.limit * 1024 * 1024 : 0;
  let why = "";
  if (psOptions.slow && (psLive() || psInCall())) {
    rate = rate ? Math.min(rate, PS_SLOW) : PS_SLOW;
    why = psLive() ? "live" : "call";
  }
  return { rate, why };
}

// A simple pace keeper: after n bytes, wait as long as they "cost" at the rate.
function psPace(x, n) {
  const { rate } = psRate();
  if (!rate) { x.paceAt = 0; return Promise.resolve(); }
  const now = performance.now();
  x.paceAt = Math.max(x.paceAt || now, now - 1000) + (n / rate) * 1000;
  const wait = x.paceAt - now;
  return wait > 5 ? new Promise((ok) => setTimeout(ok, wait)) : Promise.resolve();
}

// Bytes a second over the last ~8 seconds.
function psSpeed(x, n) {
  const now = Date.now();
  x.samples = (x.samples || []).filter((s) => now - s.t < 8000);
  if (!x.samples.length || now - x.samples[x.samples.length - 1].t > 400) x.samples.push({ t: now, n });
  const first = x.samples[0];
  return now - first.t > 1500 ? Math.max(0, (n - first.n) / ((now - first.t) / 1000)) : 0;
}

// ---- keeping up with the projects

async function psSync() {
  clearTimeout(psSyncTimer);
  if (!psLoggedIn()) return;
  const res = await api("/api/pj-net-sync", { me: psMe() }).catch(() => null);
  if (res && res.ok) {
    psProjects = res.projects || [];
    psOptions = res.options || psOptions;
    for (const p of psProjects) if (p.files.some((f) => !f.here && f.kind === "footage")) psToldReady.delete(p.id);
    for (const g of psGets.values()) { // (a file that's here now, or gone from the project, stops)
      const f = psFile(g.id);
      if (!f || f.here) psEndGet(g, f ? "done" : "gone");
    }
    psPump();
    psDraw();
  }
  psSyncTimer = setTimeout(psSync, document.hidden ? 30000 : 15000);
}

function psStart() {
  if (psStarted || !psLoggedIn()) return;
  psStarted = true;
  psSync();
  psCheck();
}

function psStop() {
  psStarted = false;
  clearTimeout(psSyncTimer); clearTimeout(psCheckTimer); clearTimeout(psPumpTimer);
  for (const c of psConns.values()) psDropConn(c, "");
  for (const x of psSends.values()) psEndSend(x, "");
  psGets.clear();
  psProjects = [];
  psDraw();
}

// ---- finding each other: offers and answers through the database

async function psCheck() {
  clearTimeout(psCheckTimer);
  if (!psLoggedIn() || !psStarted) return;
  const res = await api("/api/pj-net-check", { after: Math.max(0, psAfter - 50) }).catch(() => null);
  if (res && res.ok) {
    for (const s of res.signals || []) {
      psAfter = Math.max(psAfter, s.id);
      if (psSeen.has(s.id)) continue;
      psSeen.add(s.id);
      if (psSeen.size > 500) psSeen.delete(psSeen.values().next().value);
      psSignal(s);
    }
  } else if (res && res.loggedOut && typeof sfxLoggedOut === "function") sfxLoggedOut(res);
  for (const c of psConns.values()) {
    if (c.status === "connecting" && Date.now() > c.deadline) psDropConn(c, `Couldn't reach ${c.peer}.`, 30);
  }
  const connecting = [...psConns.values()].some((c) => c.status === "connecting");
  // (fast while waiting for an answer; every few seconds otherwise: that's how friends reach you)
  const anything = psProjects.length || psConns.size || psSends.size;
  psCheckTimer = setTimeout(psCheck, connecting ? 1000 : anything ? (document.hidden ? 5000 : 3000) : 20000);
}

function psSay(project, to, transfer, kind, sdp) {
  return api("/api/pj-net-signal", { project, to, transfer, kind, sdp: sdp || "" }).catch(() => ({ ok: false }));
}

function psSignal(s) {
  if (s.kind === "offer") return psOffered(s);
  const c = [...psConns.values()].find((x) => x.transfer === s.transfer);
  if (!c || c.status !== "connecting") return;
  if (s.kind === "no") return psDropConn(c, s.sdp === "busy" ? `${c.peer} is sending to others right now.` : (s.sdp || "They can't send right now."), s.sdp === "busy" ? 20 : 60);
  c.pc.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => psDropConn(c, "The connection broke.", 10));
}

// Is the connection going over the same network (home Wi-Fi), not over the internet?
async function psSameNet(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((r) => { if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.state === "succeeded") pair = r; });
    if (!pair) return false;
    const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
    return !!(local && remote && local.candidateType === "host" && remote.candidateType === "host");
  } catch (e) {
    return false;
  }
}

// ---- getting files

// Which files to get now, and from whom: runs after every change, and every second while something goes.
function psPump() {
  clearTimeout(psPumpTimer);
  if (!psStarted || psPaused) return psDraw();
  const want = [];
  for (const p of psProjects) {
    for (const f of p.files) {
      if (f.here || (!psOptions.auto && !psWanted.has(f.id))) continue;
      want.push({ ...f, project: p.id });
    }
  }
  // (cuts first: those get watched; then the smallest files, so clips arrive one after another)
  want.sort((a, b) => (b.kind === "render") - (a.kind === "render") || a.size - b.size);
  for (const f of want) if (!psGets.has(f.id)) psBeginGet(f);
  // Who to connect to: everyone online who has something this PC still needs.
  const peers = new Map(); // "project|friend" -> {project, peer}
  for (const f of want) {
    const g = psGets.get(f.id);
    if (!g || g.status !== "getting") continue;
    for (const peer of f.sources || []) peers.set(f.project + "|" + peer.toLowerCase(), { project: f.project, peer });
  }
  let open = [...psConns.values()].filter((c) => c.status !== "closed").length;
  for (const [key, x] of peers) {
    if (psConns.has(key) || open >= PS_MAX_GETS) continue;
    if ((psBackoff.get(x.peer.toLowerCase()) || 0) > Date.now()) continue;
    psConnect(key, x.project, x.peer);
    open++;
  }
  for (const c of psConns.values()) if (c.status === "open" && !c.req) psNextBlock(c);
  for (const g of psGets.values()) {
    if (g.status !== "getting") continue;
    const f = psFile(g.id);
    const anyone = f && (f.sources || []).length;
    g.message = anyone ? (g.inflight.size ? "" : `Connecting to ${f.sources.slice(0, 2).join(" and ")}...`) : (f && f.holders && f.holders.length ? `Waiting for ${f.holders.slice(0, 2).join(" or ")} to come online` : "Nobody has it on their PC right now");
  }
  psTick();
}

async function psBeginGet(f) {
  const g = { id: f.id, project: f.project, name: f.name, size: f.size, done: new Set(), inflight: new Map(), status: "starting", message: "" };
  psGets.set(f.id, g);
  const res = await api("/api/pj-net-start", { id: f.id }).catch(() => ({ ok: false, error: "Couldn't start." }));
  if (psGets.get(f.id) !== g) return;
  if (!res.ok) { g.status = "error"; g.message = res.error; return psDraw(); }
  if (res.here) return psEndGet(g, "done");
  g.blocks = res.blocks;
  g.block = res.block;
  g.done = new Set(res.done || []);
  g.status = "getting";
  psPump();
}

const psBlockLen = (g, b) => Math.min(g.block, g.size - b * g.block);
// How much of a file is here: the finished blocks, and what came so far of the blocks on their way.
function psGot(g) {
  let n = 0;
  if (g.block) for (const b of g.done) n += psBlockLen(g, b);
  for (const c of new Set(g.inflight.values())) {
    const r = c.req;
    if (r && r.file === g.id) n += r.saved - r.at + (r.queued || 0) + r.bufBytes;
  }
  return n;
}

function psEndGet(g, how, message) {
  for (const c of new Set(g.inflight.values())) if (c.req && c.req.file === g.id) { c.req = null; try { c.dc.send(JSON.stringify({ stop: true })); } catch (e) { /* closed */ } }
  g.inflight.clear();
  psGets.delete(g.id);
  if (how === "done") {
    psLog.unshift({ name: g.name, at: Date.now(), ok: true, message: "On your PC · checked" });
    for (const p of psProjects) for (const f of p.files) if (f.id === g.id) f.here = true;
    if (typeof pjOpen !== "undefined" && pjOpen && pjOpen.project.id === g.project) {
      const f = pjOpen.files.find((x) => x.id === g.id);
      if (f) f.here = true;
      if (typeof pjRefreshSoon === "function") pjRefreshSoon();
    }
    psNotifyReady(g.project);
  } else if (message) psLog.unshift({ name: g.name, at: Date.now(), ok: false, message });
  psLog.length = Math.min(psLog.length, 20);
  psPump();
}

// When the last file of a project arrives: "Night Shift is ready to edit".
const psToldReady = new Set();
function psNotifyReady(project) {
  const p = psProjects.find((x) => x.id === project);
  if (!p || psToldReady.has(project) || p.files.some((f) => !f.here && f.kind === "footage") || [...psGets.values()].some((g) => g.project === project && g.status === "getting")) return;
  psToldReady.add(project);
  if (typeof pjToast === "function") pjToast(`${p.name} is ready to edit`, "All the footage is on your PC and checked.");
}

function psConnect(key, project, peer) {
  const c = { key, project, peer, status: "connecting", transfer: crypto.randomUUID(), deadline: Date.now() + 30000, req: null, got: 0 };
  psConns.set(key, c);
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  const dc = pc.createDataChannel("pj", { ordered: true });
  dc.binaryType = "arraybuffer";
  c.pc = pc;
  c.dc = dc;
  dc.onopen = async () => {
    if (psConns.get(key) !== c) return;
    c.status = "open";
    psBackoff.delete(peer.toLowerCase());
    c.sameNet = await psSameNet(pc);
    psNextBlock(c);
  };
  dc.onmessage = (e) => psPiece(c, e.data);
  dc.onclose = () => { if (psConns.get(key) === c) psDropConn(c, "Lost the connection.", 10); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && psConns.get(key) === c) psDropConn(c, "Couldn't connect. A strict network can block it.", 60);
  };
  (async () => {
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await callGathered(pc);
    } catch (e) {
      return psDropConn(c, "Couldn't start the connection.", 20);
    }
    if (psConns.get(key) !== c) return;
    const res = await psSay(project, peer, c.transfer, "offer", pc.localDescription.sdp);
    if (!res.ok && psConns.get(key) === c) psDropConn(c, res.error || "Couldn't reach them.", 30);
    c.deadline = Date.now() + 30000;
    clearTimeout(psCheckTimer);
    psCheckTimer = setTimeout(psCheck, 800);
  })();
  psDraw();
}

function psDropConn(c, message, wait) {
  if (psConns.get(c.key) === c) psConns.delete(c.key);
  c.status = "closed";
  if (c.req) {
    const g = psGets.get(c.req.file);
    if (g) g.inflight.delete(c.req.block);
    c.req = null;
  }
  for (const x of [c.dc, c.pc]) { try { if (x) x.close(); } catch (e) { /* closed */ } }
  if (wait) psBackoff.set(c.peer.toLowerCase(), Date.now() + wait * 1000);
  if (psStarted) { clearTimeout(psPumpTimer); psPumpTimer = setTimeout(psPump, 500); }
}

// The connection is free: ask the friend for a block this PC still needs (of a file they have).
async function psNextBlock(c) {
  if (c.status !== "open" || c.req || psPaused) return;
  for (const g of psGets.values()) {
    if (g.status !== "getting" || g.project !== c.project) continue;
    const f = psFile(g.id);
    if (!f || !(f.sources || []).some((s) => s.toLowerCase() === c.peer.toLowerCase())) continue;
    let block = -1;
    for (let b = 0; b < g.blocks; b++) if (!g.done.has(b) && !g.inflight.has(b)) { block = b; break; }
    if (block < 0) continue;
    const at = block * g.block, end = at + psBlockLen(g, block);
    c.req = { file: g.id, block, at, end, saved: at, buf: [], bufBytes: 0, writing: Promise.resolve(true) };
    g.inflight.set(block, c);
    try {
      c.dc.send(JSON.stringify({ want: g.id, at, n: end - at }));
    } catch (e) {
      return psDropConn(c, "Lost the connection.", 10);
    }
    psTick();
    return;
  }
  // Nothing more from this friend: let the connection go after a bit (unless something comes up).
  clearTimeout(c.idle);
  c.idle = setTimeout(() => { if (!c.req && psConns.get(c.key) === c) psDropConn(c, ""); }, 20000);
}

function psPiece(c, data) {
  const r = c.req;
  if (typeof data === "string") {
    let m = {};
    try { m = JSON.parse(data); } catch (e) { return; }
    if (m.error && r) { // (they don't have it after all)
      const g = psGets.get(r.file);
      if (g) g.inflight.delete(r.block);
      c.req = null;
      psDropConn(c, m.error, 60);
    }
    return;
  }
  if (!r) return;
  r.buf.push(data);
  r.bufBytes += data.byteLength;
  c.got += data.byteLength;
  if (r.bufBytes >= PS_WRITE || r.saved + r.bufBytes + psPending(r) >= r.end) psFlush(c, r);
}
const psPending = (r) => r.queued || 0;

// Save what came so far (one write at a time, in order), then tell the friend how far it is.
function psFlush(c, r) {
  if (!r.bufBytes) return;
  const pieces = r.buf, bytes = r.bufBytes;
  r.buf = [];
  r.bufBytes = 0;
  r.queued = (r.queued || 0) + bytes;
  r.writing = r.writing.then(async (fine) => {
    if (!fine || c.req !== r) return false;
    const res = await fetch("/api/pj-write", { method: "POST", headers: { "X-File": r.file, "X-At": String(r.saved) }, body: new Blob(pieces) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't save it." }));
    r.queued -= bytes;
    if (c.req !== r) return false;
    const g = psGets.get(r.file);
    if (!res.ok) {
      if (g) { g.status = "error"; g.message = res.error; }
      psDropConn(c, "", 0);
      return false;
    }
    if (res.at !== r.saved + bytes && !res.blockDone) { // (something got lost: ask for the block again)
      c.req = null;
      if (g) g.inflight.delete(r.block);
      try { c.dc.send(JSON.stringify({ stop: true })); } catch (e) { /* closed */ }
      setTimeout(() => psNextBlock(c), 300);
      return false;
    }
    r.saved = res.at;
    try { c.dc.send(JSON.stringify({ ack: r.saved - r.at })); } catch (e) { /* closed */ }
    if (res.blockDone) {
      c.req = null;
      if (g) { g.inflight.delete(r.block); g.done.add(r.block); }
      if (res.bad && g) { // the whole file came broken: start over
        g.done.clear();
        psLog.unshift({ name: g.name, at: Date.now(), ok: false, message: "It came broken, getting it again" });
      }
      if (res.done && g) psEndGet(g, "done");
      await psPace(c, r.end - r.at); // (while you're live: the next block waits a bit)
      psNextBlock(c);
    }
    return true;
  });
}

// ---- sending your files to a friend

async function psOffered(s) {
  if (s.age > 40 || [...psSends.values()].some((x) => x.transfer === s.transfer)) return;
  if (!psOptions.share) return psSay(s.project, s.from, s.transfer, "no", "They turned sharing off.");
  if ([...psSends.values()].filter((x) => x.status === "open" || x.status === "connecting").length >= PS_MAX_SENDS) {
    return psSay(s.project, s.from, s.transfer, "no", "busy");
  }
  // (an older connection from the same friend for the same project is replaced: theirs broke)
  for (const [k, old] of psSends) if (old.project === s.project && old.to === s.from) { psEndSend(old, ""); psSends.delete(k); }
  const x = { transfer: s.transfer, project: s.project, to: s.from, status: "connecting", sent: 0, acked: 0, req: null };
  psSends.set(s.transfer, x);
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  x.pc = pc;
  pc.ondatachannel = (e) => psSendChannel(x, e.channel);
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") psEndSend(x, "The connection broke."); };
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await callGathered(pc);
  } catch (e) {
    return psEndSend(x, "Couldn't connect.");
  }
  await psSay(s.project, s.from, s.transfer, "answer", pc.localDescription.sdp);
  x.giveUp = setTimeout(() => { if (!x.dc) psEndSend(x, "They didn't connect."); }, 45000);
  psTick();
}

function psSendChannel(x, dc) {
  x.dc = dc;
  clearTimeout(x.giveUp);
  x.status = "open";
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = PS_BUFFERED / 4;
  psSameNet(x.pc).then((same) => { x.sameNet = same; });
  dc.onmessage = async (e) => {
    let m = {};
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.want) {
      if (x.req) x.req.stopped = true;
      const can = await api("/api/pj-net-can-send", { project: x.project, id: m.want }).catch(() => ({ ok: false, error: "Their app couldn't open the file." }));
      if (!can.ok) { try { dc.send(JSON.stringify({ error: can.error })); } catch (err) { /* closed */ } return; }
      const f = psFile(m.want);
      const at = Math.max(0, Math.min(+m.at || 0, can.size)), end = Math.min(can.size, at + Math.max(0, +m.n || 0));
      x.req = { file: m.want, name: f ? f.name : "a file", at, pos: at, end, acked: 0 };
      x.file = x.req.name;
      psSendLoop(x, x.req);
    } else if (m.ack != null && x.req) {
      x.req.acked = Math.max(x.req.acked, +m.ack);
      if (x.onAck) x.onAck();
    } else if (m.stop && x.req) {
      x.req.stopped = true;
    }
  };
  dc.onclose = () => psEndSend(x, "");
  psTick();
}

async function psSendLoop(x, r) {
  const dc = x.dc;
  while (!r.stopped && x.status === "open" && r.pos < r.end) {
    if (r.pos - (r.at + r.acked) > PS_AHEAD) { // (wait until the friend's app saved some)
      await new Promise((ok) => { x.onAck = ok; setTimeout(ok, 5000); });
      x.onAck = null;
      continue;
    }
    const n = Math.min(PS_READ, r.end - r.pos);
    let piece;
    try {
      const res = await fetch(`/pj-read/${encodeURIComponent(r.file)}?at=${r.pos}&n=${n}`);
      if (!res.ok) throw new Error("gone");
      piece = await res.arrayBuffer();
    } catch (e) {
      try { dc.send(JSON.stringify({ error: "The file isn't on their PC any more." })); } catch (err) { /* closed */ }
      r.stopped = true;
      return;
    }
    if (!piece.byteLength) return;
    for (let at = 0; at < piece.byteLength; at += PS_PIECE) {
      if (r.stopped || x.status !== "open" || dc.readyState !== "open") return;
      if (dc.bufferedAmount > PS_BUFFERED) {
        await new Promise((ok) => { dc.onbufferedamountlow = ok; setTimeout(ok, 2000); });
        dc.onbufferedamountlow = null;
        if (r.stopped || x.status !== "open" || dc.readyState !== "open") return;
      }
      const part = piece.slice(at, at + PS_PIECE);
      await psPace(x, part.byteLength);
      try {
        dc.send(part);
      } catch (e) {
        return psEndSend(x, "The connection broke.");
      }
      x.sent += part.byteLength;
    }
    r.pos += piece.byteLength;
  }
}

function psEndSend(x, message) {
  if (x.status === "closed") return;
  x.status = "closed";
  clearTimeout(x.giveUp);
  if (x.req) x.req.stopped = true;
  for (const y of [x.dc, x.pc]) { try { if (y) y.close(); } catch (e) { /* closed */ } }
  if (psSends.get(x.transfer) === x) psSends.delete(x.transfer);
  if (x.sent) psLog.unshift({ name: x.file || "Files", to: x.to, at: Date.now(), ok: !message, message: message || `Sent ${pjSize(x.sent)} to ${x.to}` });
  psLog.length = Math.min(psLog.length, 20);
  psTick();
}

// ---- what the page shows

// Twice a second while something goes: the progress on the page and the panel. Also keeps Windows awake.
let psTickTimer = 0;
function psTick() {
  clearTimeout(psTickTimer);
  const busy = [...psConns.values()].some((c) => c.req) || [...psSends.values()].some((x) => x.req && !x.req.stopped && x.req.pos < x.req.end);
  psDraw();
  if (busy && Date.now() - psAwakeAt > 20000) {
    psAwakeAt = Date.now();
    api("/api/pov-awake", { on: true }).catch(() => {});
  } else if (!busy && psAwakeAt) {
    psAwakeAt = 0;
    api("/api/pov-awake", { on: false }).catch(() => {});
  }
  if (busy || [...psGets.values()].some((g) => g.status === "getting")) psTickTimer = setTimeout(psTick, busy ? 500 : 1500);
}

// A file's state for the Footage tab: {state: here|getting|waiting|missing|off, pct, from, message}
function psStateOf(fileId) {
  const g = psGets.get(fileId);
  const f = psFile(fileId);
  if (f && f.here) return { state: "here" };
  if (g && g.status === "getting") {
    const from = [...new Set([...g.inflight.values()].map((c) => c.peer))];
    const pct = g.size ? Math.min(99, Math.floor((psGot(g) / g.size) * 100)) : 0;
    if (from.length) return { state: "getting", pct, from };
    return { state: "waiting", pct, message: g.message || "Waiting" };
  }
  if (g && g.status === "error") return { state: "missing", message: g.message };
  if (!f) return { state: "missing", message: "" };
  if (!psOptions.auto && !psWanted.has(fileId)) return { state: "off", message: "Not on your PC" };
  return { state: "waiting", pct: 0, message: (f.sources || []).length ? "Starting" : f.holders.length ? `Waiting for ${f.holders.slice(0, 2).join(" or ")}` : "Nobody has it right now" };
}

// The project's side box: how far along, how fast, and who's online.
function psProjectState(projectId) {
  const p = psProjects.find((x) => x.id === projectId);
  if (!p) return null;
  const footage = p.files.filter((f) => f.kind === "footage");
  let speed = 0;
  for (const c of psConns.values()) if (c.project === projectId) speed += psSpeed(c, c.got);
  const left = footage.filter((f) => !f.here).reduce((a, f) => a + f.size - (psGets.has(f.id) ? psGot(psGets.get(f.id)) : 0), 0);
  const people = p.people.map((x) => {
    const conn = psConns.get(projectId + "|" + x.username.toLowerCase());
    const send = [...psSends.values()].find((s) => s.project === projectId && s.to.toLowerCase() === x.username.toLowerCase());
    const same = (conn && conn.sameNet) || (send && send.sameNet);
    return { ...x, same, busy: !!((conn && conn.req) || (send && send.req && !send.req.stopped)) };
  });
  return { here: footage.filter((f) => f.here).length, total: footage.length, speed, left, people, ...psRate() };
}

function psDraw() {
  if (typeof pjSyncChanged === "function") pjSyncChanged();
  psDrawPanel();
}

// The Transfers panel (bottom right).
let psPanelOpen = false;
function psDrawPanel() {
  const box = $("psPanel");
  if (!box) return;
  const gets = [...psGets.values()].filter((g) => g.status === "getting" || g.status === "error");
  const sends = [...psSends.values()].filter((x) => x.req && !x.req.stopped && x.req.pos < x.req.end);
  const active = gets.some((g) => g.inflight.size) || sends.length;
  const pill = $("psPill");
  const n = gets.length + sends.length;
  pill.hidden = !n && !psLog.length;
  pill.classList.toggle("on", !!active);
  pill.querySelector("b").textContent = n ? `${n} transfer${n === 1 ? "" : "s"}` : "Transfers";
  box.hidden = !psPanelOpen;
  if (!psPanelOpen) return;
  const { rate, why } = psRate();
  const head = pjEl("div", "ps-head");
  head.append(pjEl("b", "", "Transfers"));
  if (psPaused) head.append(pjEl("span", "ps-pill y", "Paused"));
  else if (why) head.append(pjEl("span", "ps-pill y", why === "live" ? "Slowed down, you're live" : "Slowed down, you're in a call"));
  else if (rate) head.append(pjEl("span", "ps-pill", `Up to ${psOptions.limit} MB/s`));
  head.append(pjEl("span", "spacer"), pjButton("Hide", "link pj-small", () => { psPanelOpen = false; psDrawPanel(); }));
  const rows = [head];
  if (why && !psPaused) rows.push(pjEl("div", "ps-note", `You're ${why === "live" ? "live" : "in a call"}, so VaultHub only uses a little of your internet. Full speed comes back when you're done.`));
  const row = (arrow, name, size, pct, left, right, ok) => {
    const r = pjEl("div", "ps-row");
    const t = pjEl("div", "ps-t");
    t.append(pjEl("span", "ps-arrow", arrow), pjEl("b", "", name), pjEl("span", "spacer"), pjEl("span", "pj-muted pj-small", size));
    const bar = pjEl("div", "pj-bar-line" + (ok ? " done" : ""));
    const fill = pjEl("i");
    fill.style.width = pct + "%";
    bar.append(fill);
    const s = pjEl("div", "ps-s");
    s.append(pjEl("span", "", left), pjEl("span", "spacer"), pjEl("span", ok ? "ok" : "", right));
    r.append(t);
    if (pct != null) r.append(bar);
    r.append(s);
    return r;
  };
  for (const g of gets) {
    const st = psStateOf(g.id);
    const pct = g.size ? Math.min(100, Math.floor((psGot(g) / g.size) * 100)) : 0;
    let speed = 0;
    for (const c of new Set(g.inflight.values())) speed += psSpeed(c, c.got);
    const left = st.state === "getting" ? `From ${st.from.join(" and ")}${speed ? " · " + pjSize(speed) + "/s" : ""}` : (g.message || st.message || "Waiting");
    rows.push(row("↓", g.name, pjSize(g.size), pct, left, pct + "%"));
  }
  for (const x of sends) {
    const r = x.req;
    rows.push(row("↑", r.name, "", null, `Sending to ${x.to}${x.sameNet ? " · same Wi-Fi" : ""}`, pjSize(psSpeed(x, x.sent)) + "/s"));
  }
  for (const l of psLog.slice(0, 4)) rows.push(row(l.ok ? "✓" : "!", l.name, "", null, l.message, pjAgo(l.at / 1000), l.ok));
  if (rows.length === 1 + (why && !psPaused ? 1 : 0)) rows.push(pjEl("p", "pj-help", "Nothing going right now. Footage comes to your PC by itself while you and your friends have VaultHub open."));
  const foot = pjEl("div", "ps-foot");
  foot.append(pjButton(psPaused ? "Go on" : "Pause all", "ghost-button", () => { psPaused = !psPaused; if (psPaused) for (const c of [...psConns.values()]) psDropConn(c, ""); psPump(); }),
    pjEl("span", "spacer"), pjButton("Sharing settings", "link pj-small", psSettings));
  rows.push(foot);
  box.replaceChildren(...rows);
}

function psSettings() {
  const body = pjEl("div", "pj-modal-body");
  const opts = { ...psOptions };
  const toggle = (key, title, about) => {
    const row = pjEl("label", "ps-opt");
    const text = pjEl("div");
    text.append(pjEl("b", "", title), pjEl("span", "pj-muted pj-small", about));
    const box = pjEl("input");
    box.type = "checkbox";
    box.className = "ps-switch";
    box.checked = !!opts[key];
    box.addEventListener("change", () => { opts[key] = box.checked; });
    row.append(text, box);
    return row;
  };
  const limit = pjEl("select");
  for (const n of PS_LIMITS) { const o = pjEl("option", "", n ? `${n} MB/s` : "No limit"); o.value = n; limit.append(o); }
  limit.value = opts.limit || 0;
  limit.addEventListener("change", () => { opts.limit = +limit.value; });
  const speed = pjEl("div", "ps-opt");
  const st = pjEl("div");
  st.append(pjEl("b", "", "Speed limit"), pjEl("span", "pj-muted pj-small", "The most VaultHub uses at once, for sending and getting."));
  speed.append(st, limit);
  body.append(
    toggle("auto", "Download new clips by themselves", "When a friend adds footage, it comes to your PC in the background."),
    toggle("slow", "Slow down while I'm live or in a call", "Keeps your stream and calls smooth."),
    toggle("share", "Share my clips with the project", "Friends can get files from you too, so they arrive faster and don't wait on one person."),
    speed,
    pjEl("p", "pj-help", "A file can only come from someone who has it and has VaultHub open. Leave VaultHub running (it can sit in the background) when friends need your footage."));
  pjDialog({ title: "Sharing settings", sub: "Footage goes straight from PC to PC. Nothing is stored online, so there's no size limit and it's free.", body, go: "Save",
    onGo: async () => {
      const res = await api("/api/pj-net-options", { options: opts }).catch(() => ({ ok: false, error: "That didn't work." }));
      if (!res.ok) { pjDialogNote(res.error); return false; }
      psOptions = res.options;
      psPump();
      return true;
    } });
}

// Get one file now (when "download by themselves" is off), or everything in a project.
function psGetNow(ids) {
  for (const id of ids) psWanted.add(id);
  psPump();
}

function psAccountChanged() {
  if (psLoggedIn()) psStart();
  else psStop();
}

$("psPill").addEventListener("click", () => { psPanelOpen = !psPanelOpen; psDrawPanel(); });
setTimeout(psAccountChanged, 1500);
