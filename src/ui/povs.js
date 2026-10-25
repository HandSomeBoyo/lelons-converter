// The POVs tab: everyone's own recording of the same game, so friends can grab each other's side.
// The list lives in the library (lelons_pov in sfx/setup.sql); the videos go straight from the PC of
// whoever recorded them to yours, over a WebRTC data channel (like the calls, see call.js). Nothing is
// uploaded, so any size works for free, but the one sharing needs VaultHub open while it's sent.
// A download that stops goes on from where it was (the app keeps a ".vaulthub-part" file, see povs.py).
// Uses $, api(), whereToSave() from app.js, sfxUser()/avatarEl()/sfxAgo()/openLogin()/loadAccount()/sfxLoggedOut()
// from sfx.js and CALL_SERVERS/callGathered() from call.js.

const PV_PIECE = 64 * 1024; // one message on the data channel
const PV_READ = 4 * 1024 * 1024; // what the sender reads from the file at once
const PV_WRITE = 4 * 1024 * 1024; // what the getter writes to the file at once
const PV_AHEAD = 48 * 1024 * 1024; // how far the sender may be ahead of what's saved on the other side
const PV_BUFFERED = 8 * 1024 * 1024; // how much may wait in the data channel
const PV_MAX_SENDS = 4; // friends one PC sends to at once
const PV_RETRY = [5, 10, 20, 30, 60]; // seconds before trying again after the connection broke
const PV_TIMER_NAMES = { 1: "1 hour", 6: "6 hours", 24: "1 day", 72: "3 days", 168: "1 week", 0: "Until I remove it" };
const pvSvg = (d, fill) => `<svg viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const PV_ICONS = {
  down: pvSvg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  up: pvSvg('<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>'),
  pause: pvSvg('<path d="M8 5v14M16 5v14"/>'),
  play: pvSvg('<path d="M8 5.5v13l11-6.5z"/>', true),
  close: pvSvg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: pvSvg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  folder: pvSvg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  clock: pvSvg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  plus: pvSvg('<path d="M12 5v14M5 12h14"/>'),
  trash: pvSvg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
  pencil: pvSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  find: pvSvg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  film: pvSvg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17M3.5 15h17M8 5v14M16 5v14"/>'),
};

let pvSessions = [], pvTimers = [1, 6, 24, 72, 168, 0], pvSharing = 0, pvLoading = false, pvSig = "", pvUserId = null;
let pvAfter = 0, pvCheckTimer = 0, pvListTimer = 0, pvTickTimer = 0, pvAwakeAt = 0, pvAddTo = null, pvAddHours = 24;
const pvGets = new Map(); // POV id -> a download: {file, pc, dc, transfer, status, have, got, size, buf, ...}
const pvSends = new Map(); // transfer id -> a friend getting one of yours: {file, name, to, pc, dc, size, pos, acked, ...}
const pvEl = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const pvButton = (cls, icon, text, onclick) => {
  const b = pvEl("button", cls);
  b.type = "button";
  if (icon) b.innerHTML = icon;
  if (text) b.append(text);
  if (onclick) b.addEventListener("click", (e) => { e.stopPropagation(); onclick(e); });
  return b;
};
const pvLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();
const pvMe = () => (pvLoggedIn() ? sfxUser().username : "");
const pvTabOpen = () => !$("povsTab").hidden;

function pvSize(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 0 : 1) + " GB";
  if (bytes >= 1024 ** 2) return Math.round(bytes / 1024 ** 2) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}
function pvLength(seconds) {
  seconds = Math.round(seconds || 0);
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function pvWait(seconds) { // "about 25 min"
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return "less than a minute";
  if (seconds < 3600) return Math.round(seconds / 60) + " min";
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
function pvLeft(expires) { // the timer on a POV
  if (!expires) return "";
  const s = expires - Date.now() / 1000;
  if (s <= 0) return "Gone soon";
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min left";
  if (s < 48 * 3600) return Math.round(s / 3600) + " h left";
  return Math.round(s / 86400) + " days left";
}
function pvQuality(f) {
  if (!f.height) return "";
  const p = Math.min(f.width, f.height) >= 2000 ? "4K" : (f.height >= 1400 ? "1440p" : f.height >= 1000 ? "1080p" : f.height >= 700 ? "720p" : f.height + "p");
  return p;
}
const pvFiles = () => pvSessions.flatMap((s) => s.files.map((f) => ({ ...f, sessionTitle: s.title })));
const pvFile = (id) => pvFiles().find((f) => f.id === id);
const pvAlive = (f) => !f.expires || f.expires > Date.now() / 1000;

// ---- loading the list

async function loadPovs(quiet) {
  if (pvLoading) return;
  pvLoading = true;
  const res = await api("/api/pov-list", {}).catch(() => ({ ok: false, error: "Couldn't load the POVs." }));
  pvLoading = false;
  if (!res.ok) {
    if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return renderPovsPage();
    if (!quiet) { $("pvStatus").textContent = res.error; $("pvStatus").hidden = false; }
    return;
  }
  $("pvStatus").hidden = true;
  pvSharing = res.sharing || 0;
  pvTimers = res.timers || pvTimers;
  const sig = JSON.stringify(res.sessions);
  if (quiet && sig === pvSig) return;
  pvSig = sig;
  pvSessions = res.sessions || [];
  renderPovsPage();
  pvCheckSoon(200);
}

function pvListPoll() {
  clearTimeout(pvListTimer);
  pvListTimer = setTimeout(async () => {
    if (!pvTabOpen() || !pvLoggedIn()) return;
    if (!document.hidden) await loadPovs(true);
    pvListPoll();
  }, 15000);
}

// ---- drawing

function renderPovsPage() {
  const inside = pvLoggedIn();
  $("pvOut").hidden = inside;
  $("pvMain").hidden = !inside;
  if (inside) renderPovs();
}

function renderPovs() {
  const box = $("pvSessions");
  const sessions = pvSessions.map((s) => ({ ...s, files: s.files.filter(pvAlive) }));
  $("pvEmpty").hidden = sessions.length > 0;
  box.replaceChildren(...sessions.map(pvSessionEl));
  pvDrawBadge();
  pvDrawSends();
}

function pvSessionEl(s) {
  const el = pvEl("section", "pv-session");
  el.dataset.id = s.id;
  const head = pvEl("div", "pv-session-head");
  const words = pvEl("div", "pv-session-words");
  const title = pvEl("h2", "", s.title);
  const sub = pvEl("p", "pv-session-sub");
  const people = [...new Set(s.files.map((f) => f.by))];
  sub.textContent = [s.game, `${people.length || "No"} POV${people.length === 1 ? "" : "s"}`, s.by ? `Started by ${s.by} ${sfxAgo(s.created * 1000)}` : ""].filter(Boolean).join("  ·  ");
  words.append(title, sub);
  const faces = pvEl("div", "pv-faces");
  for (const f of s.files.slice(0, 6)) faces.append(avatarEl(f.by_avatar, f.by));
  const tools = pvEl("div", "pv-session-tools");
  if (!s.files.some((f) => f.mine)) tools.append(pvButton("convert small-button pv-add", PV_ICONS.plus, "Add my POV", () => pvOpenAdd(s)));
  else tools.append(pvButton("small-button pv-add ghost", PV_ICONS.plus, "Add another", () => pvOpenAdd(s)));
  if (s.can_edit) {
    tools.append(pvButton("icon-button", PV_ICONS.pencil, "", () => pvEditSession(s)));
    tools.lastChild.title = "Rename";
    tools.append(pvButton("icon-button", PV_ICONS.trash, "", () => pvDeleteSession(s)));
    tools.lastChild.title = "Delete the session";
  }
  head.append(words, faces, tools);
  const grid = pvEl("div", "pv-grid");
  for (const f of s.files) grid.append(pvCardEl({ ...f, sessionTitle: s.title }));
  if (!s.files.length) grid.append(pvEl("p", "pv-none", "No POVs yet. Everyone who recorded can add theirs."));
  el.append(head, grid);
  return el;
}

function pvCardEl(f) {
  const card = pvEl("article", "pv-card" + (f.mine ? " mine" : ""));
  card.dataset.id = f.id;
  const pic = pvEl("div", "pv-pic");
  if (f.thumb) {
    const img = pvEl("img");
    img.src = f.thumb;
    img.alt = "";
    pic.append(img);
  } else {
    pic.classList.add("none");
    pic.innerHTML = PV_ICONS.film;
  }
  if (pvQuality(f)) pic.append(pvEl("span", "pv-tag", pvQuality(f)));
  if (f.seconds) pic.append(pvEl("span", "pv-length", pvLength(f.seconds)));
  const timer = pvEl("span", "pv-timer" + (f.expires && f.expires - Date.now() / 1000 < 3600 ? " soon" : ""));
  timer.innerHTML = PV_ICONS.clock;
  timer.append(f.expires ? pvLeft(f.expires) : "No timer");
  pic.append(timer);
  const body = pvEl("div", "pv-body");
  const who = pvEl("div", "pv-who");
  who.append(avatarEl(f.by_avatar, f.by), pvEl("b", "", f.mine ? "Your POV" : `${f.by}'s POV`));
  const meta = pvEl("p", "pv-meta", `${pvSize(f.size)}  ·  ${f.name}`);
  meta.title = f.name;
  body.append(who, meta);
  const act = pvEl("div", "pv-act");
  card.append(pic, body, act);
  pvDrawAct(card, f);
  return card;
}

// The bottom of a card: who can send it, and the download (or your sharing).
function pvDrawAct(card, f) {
  const act = card.querySelector(".pv-act");
  const parts = [];
  if (f.mine) {
    const line = pvEl("p", "pv-ready " + (f.here ? "on" : "bad"));
    line.append(pvEl("i"), f.here ? "Sharing from your PC" : "Can't find this file on your PC");
    parts.push(line);
    const sending = [...pvSends.values()].filter((s) => s.file === f.id && s.status !== "done");
    if (sending.length) parts.push(pvEl("p", "pv-sending", `Sending to ${sending.map((s) => s.to).join(", ")}`));
    else if (f.got.length) parts.push(pvEl("p", "pv-got", `Downloaded by ${f.got.join(", ")}`));
    const row = pvEl("div", "pv-row");
    if (!f.here) row.append(pvButton("small-button", PV_ICONS.find, "Find it", () => pvRelink(f)));
    const pick = pvEl("label", "quality pv-timer-pick");
    const select = pvEl("select");
    select.title = "How long it stays";
    for (const h of pvTimers) {
      const o = pvEl("option", "", h ? `Stays ${PV_TIMER_NAMES[h] || h + " hours"}` : "No timer");
      o.value = h;
      select.append(o);
    }
    select.value = "";
    const keep = pvEl("option", "", f.expires ? pvLeft(f.expires) : "No timer");
    keep.value = "";
    keep.hidden = true;
    select.prepend(keep);
    select.value = "";
    select.addEventListener("change", () => pvSetTimer(f, +select.value));
    pick.append(select);
    pick.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>');
    row.append(pick, pvButton("icon-button pv-remove", PV_ICONS.trash, "", () => pvRemove(f)));
    row.lastChild.title = "Stop sharing it";
    parts.push(row);
    return act.replaceChildren(...parts);
  }
  const g = pvGets.get(f.id);
  const d = f.download;
  if (g && g.status !== "done") {
    const pct = g.size ? Math.min(100, (g.got / g.size) * 100) : 0;
    const bar = pvEl("div", "pv-bar" + (g.status === "getting" ? " live" : ""));
    const fill = pvEl("span");
    fill.style.width = pct.toFixed(2) + "%";
    bar.append(fill);
    const line = pvEl("p", "pv-progress");
    if (g.status === "getting") {
      const speed = pvSpeed(g);
      line.append(pvEl("b", "", `${pvSize(g.got)} of ${pvSize(g.size)}`),
        speed ? ` · ${pvSize(speed)}/s · ${pvWait((g.size - g.got) / speed)} left` : " · Starting...");
    } else {
      line.append(pvEl("b", "", `${Math.floor(pct)}%`), " · " + (g.message || "Connecting to " + f.by + "..."));
    }
    const row = pvEl("div", "pv-row");
    if (g.status === "paused") row.append(pvButton("convert small-button", PV_ICONS.play, "Go on", () => pvDownload(f)));
    else row.append(pvButton("small-button", PV_ICONS.pause, "Pause", () => pvPause(f.id)));
    row.append(pvButton("ghost-button", "", "Cancel", () => pvCancel(f)));
    return act.replaceChildren(bar, line, row);
  }
  if ((g && g.status === "done") || (d && d.state === "done" && d.there)) {
    const line = pvEl("p", "pv-ready on");
    line.innerHTML = PV_ICONS.check;
    line.append("Downloaded");
    const row = pvEl("div", "pv-row");
    row.append(pvButton("small-button", PV_ICONS.folder, "Show in folder", () => api("/api/pov-show", { id: f.id })));
    return act.replaceChildren(line, row);
  }
  const line = pvEl("p", "pv-ready " + (f.ready ? "on" : "off"));
  line.append(pvEl("i"), f.ready ? `${f.by} is online: ready to send` : `${f.by} is offline. They need VaultHub open.`);
  const row = pvEl("div", "pv-row");
  const partly = d && d.state === "part" && d.have > 0;
  row.append(pvButton("convert small-button pv-get", PV_ICONS.down,
    partly ? `Go on (${Math.floor((d.have / f.size) * 100)}%)` : `Download ${pvSize(f.size)}`, () => pvDownload(f)));
  if (partly) row.append(pvButton("ghost-button", "", "Cancel", () => pvCancel(f)));
  act.replaceChildren(line, row);
}

function pvRedrawCard(id) {
  const card = document.querySelector(`.pv-card[data-id="${CSS.escape(id)}"]`);
  const f = pvFile(id);
  if (card && f) pvDrawAct(card, f);
}

// Getting or sending: a little number on the tab, so you know it's going.
function pvDrawBadge() {
  const n = [...pvGets.values()].filter((g) => g.status !== "done").length + [...pvSends.values()].filter((s) => s.status === "sending").length;
  const badge = $("povsTabBadge");
  badge.hidden = !n;
  badge.textContent = n;
}

// What you're sending, at the bottom right of the tab.
function pvDrawSends() {
  const box = $("pvSends");
  const all = [...pvSends.values()];
  box.hidden = !all.length || !pvTabOpen(); // (sending goes on from any tab; the tab's number says so)
  if (!all.length) return box.replaceChildren();
  const head = pvEl("div", "pv-sends-head");
  head.append(pvEl("b", "", "Sending from your PC"), pvEl("small", "", "Keep VaultHub open"));
  const rows = all.map((s) => {
    const row = pvEl("div", "pv-send " + s.status);
    const icon = pvEl("span", "pv-send-icon");
    icon.innerHTML = s.status === "done" ? PV_ICONS.check : s.status === "error" ? PV_ICONS.close : PV_ICONS.up;
    const text = pvEl("div", "pv-send-text");
    const speed = s.status === "sending" ? pvSpeed(s) : 0;
    const pct = s.size ? Math.floor((s.acked / s.size) * 100) : 0;
    text.append(pvEl("b", "", `To ${s.to}: ${s.name}`),
      pvEl("small", "", s.status === "done" ? "Sent!" : s.status === "error" ? s.message
        : `${pct}%  ·  ${pvSize(s.acked)} of ${pvSize(s.size)}${speed ? "  ·  " + pvSize(speed) + "/s" : ""}`));
    const bar = pvEl("div", "pv-bar small");
    const fill = pvEl("span");
    fill.style.width = pct + "%";
    bar.append(fill);
    text.append(bar);
    row.append(icon, text);
    return row;
  });
  box.replaceChildren(head, ...rows);
}

// Bytes a second over the last ~8 seconds.
function pvSpeed(x) {
  const now = Date.now();
  const n = x.got != null && !x.to ? x.got : x.acked;
  x.samples = (x.samples || []).filter((s) => now - s.t < 8000);
  if (!x.samples.length || now - x.samples[x.samples.length - 1].t > 400) x.samples.push({ t: now, n });
  const first = x.samples[0];
  return now - first.t > 1500 ? Math.max(0, (n - first.n) / ((now - first.t) / 1000)) : 0;
}

// While something is going: the cards' progress and the panel, twice a second.
function pvTick() {
  clearTimeout(pvTickTimer);
  const busy = [...pvGets.values()].some((g) => g.status !== "done") || [...pvSends.values()].some((s) => s.status === "sending");
  if (pvTabOpen()) {
    for (const id of pvGets.keys()) pvRedrawCard(id);
    pvDrawSends();
  }
  pvDrawBadge();
  if (busy && Date.now() - pvAwakeAt > 20000) { // (Windows shouldn't sleep in the middle of it)
    pvAwakeAt = Date.now();
    api("/api/pov-awake", { on: true }).catch(() => {});
  } else if (!busy && pvAwakeAt) {
    pvAwakeAt = 0;
    api("/api/pov-awake", { on: false }).catch(() => {});
  }
  if (busy) pvTickTimer = setTimeout(pvTick, 500);
}

// ---- finding each other: offers and answers through the library

function pvCheckSoon(delay) {
  clearTimeout(pvCheckTimer);
  pvCheckTimer = setTimeout(pvCheck, delay);
}

async function pvCheck() {
  if (!pvLoggedIn()) return;
  const connecting = [...pvGets.values()].some((g) => g.status === "connecting");
  const busy = connecting || [...pvGets.values()].some((g) => g.status === "getting");
  const res = await api("/api/pov-check", { after: pvAfter, busy }).catch(() => null);
  if (res && res.ok) {
    pvSharing = res.sharing || 0;
    for (const s of res.signals || []) {
      pvAfter = Math.max(pvAfter, s.id);
      pvSignal(s);
    }
  } else if (res && typeof sfxLoggedOut === "function") sfxLoggedOut(res);
  for (const g of pvGets.values()) { // nobody answered: they're probably not there
    if (g.status === "connecting" && Date.now() > g.deadline) pvLost(g, `Couldn't reach ${g.file.by}. They need VaultHub open.`, 30);
  }
  // Fast while waiting for an answer; every few seconds while you share something (that's how friends reach you).
  if (connecting) pvCheckSoon(1000);
  else if (pvSharing || busy || pvSends.size) pvCheckSoon(3000);
  else pvCheckSoon(30000); // (then the app only looks on this PC, not in the library)
}

function pvSay(file, to, transfer, kind, sdp) {
  return api("/api/pov-signal", { id: file, to, transfer, kind, sdp: sdp || "" }).catch(() => ({ ok: false }));
}

function pvSignal(s) {
  if (s.kind === "offer") return pvOffered(s);
  const g = [...pvGets.values()].find((x) => x.transfer === s.transfer);
  if (!g || g.status !== "connecting") return;
  if (s.kind === "no") {
    if (s.sdp === "busy") return pvLost(g, `${g.file.by} is sending to others right now.`, 30);
    return pvLost(g, s.sdp || "They can't send it right now.", 0, true);
  }
  g.pc.setRemoteDescription({ type: "answer", sdp: s.sdp }).catch(() => pvLost(g, "The connection broke.", 10));
}

// ---- getting a friend's POV

async function pvDownload(f) {
  if (!pvLoggedIn()) return openLogin("login");
  let g = pvGets.get(f.id);
  if (g && (g.status === "connecting" || g.status === "getting")) return;
  let folder = "";
  const d = f.download;
  if (!g && !(d && d.state === "part")) {
    folder = await whereToSave();
    if (!folder) return;
  }
  const res = await api("/api/pov-start", { id: f.id, folder, name: f.name, size: f.size, session: f.sessionTitle, by: f.by })
    .catch(() => ({ ok: false, error: "Couldn't start the download." }));
  if (!res.ok) return alert(res.error);
  if (!g) {
    g = { file: f, size: f.size, have: 0, got: 0, tries: 0 };
    pvGets.set(f.id, g);
  }
  g.have = g.got = res.at;
  if (res.done) return pvDone(g);
  pvConnect(g);
}

async function pvConnect(g) {
  pvClose(g);
  clearTimeout(g.retry);
  g.status = "connecting";
  g.message = `Connecting to ${g.file.by}...`;
  g.transfer = crypto.randomUUID();
  g.buf = [];
  g.bufBytes = 0;
  g.writing = null;
  g.deadline = Date.now() + 40000;
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  const dc = pc.createDataChannel("pov", { ordered: true });
  dc.binaryType = "arraybuffer";
  g.pc = pc;
  g.dc = dc;
  const mine = g.transfer;
  dc.onopen = () => {
    if (g.transfer !== mine) return;
    g.status = "getting";
    g.message = "";
    g.tries = 0;
    g.samples = [];
    dc.send(JSON.stringify({ want: g.file.id, at: g.have }));
    pvTick();
  };
  dc.onmessage = (e) => { if (g.transfer === mine) pvPiece(g, e.data); };
  dc.onclose = () => { if (g.transfer === mine && g.status === "getting") pvLost(g, "Lost the connection.", 0); };
  pc.onconnectionstatechange = () => {
    if (g.transfer === mine && pc.connectionState === "failed")
      pvLost(g, "Couldn't connect. A strict network (like school or work Wi-Fi) can block it.", 30);
  };
  pvTick();
  pvRedrawCard(g.file.id);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await callGathered(pc);
  } catch (e) {
    return pvLost(g, "Couldn't start the connection.", 10);
  }
  if (g.transfer !== mine) return;
  const res = await pvSay(g.file.id, g.file.by, mine, "offer", pc.localDescription.sdp);
  if (g.transfer !== mine) return;
  if (!res.ok) return pvLost(g, res.error || "Couldn't reach the library.", res.error && /isn't shared/.test(res.error) ? 0 : 20, !!(res.error && /isn't shared/.test(res.error)));
  g.deadline = Date.now() + 30000;
  pvCheckSoon(800);
}

function pvPiece(g, data) {
  if (typeof data === "string") {
    let m = {};
    try { m = JSON.parse(data); } catch (e) { /* not for us */ }
    if (m.error) pvLost(g, m.error, 0, true);
    return;
  }
  g.buf.push(data);
  g.bufBytes += data.byteLength;
  g.got += data.byteLength;
  if (g.bufBytes >= PV_WRITE || g.got >= g.size) pvFlush(g);
}

// Save what came so far (in order: one write at a time), then tell the sender how far it is.
function pvFlush(g) {
  if (!g.bufBytes) return;
  const pieces = g.buf, bytes = g.bufBytes, transfer = g.transfer;
  g.buf = [];
  g.bufBytes = 0;
  const before = g.writing || Promise.resolve(true);
  g.writing = before.then(async (fine) => {
    if (!fine || g.transfer !== transfer) return false;
    const res = await fetch("/api/pov-write", {
      method: "POST", headers: { "X-Pov": g.file.id, "X-At": String(g.have) }, body: new Blob(pieces),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't save the download." }));
    if (g.transfer !== transfer) return false;
    if (!res.ok) { pvLost(g, res.error, 0, true); return false; }
    if (res.at !== g.have + bytes) { // (something got lost on the way: ask again from what's saved)
      g.have = g.got = res.at;
      pvConnect(g);
      return false;
    }
    g.have = res.at;
    try { g.dc.send(JSON.stringify({ ack: g.have })); } catch (e) { /* closed */ }
    if (res.done) pvDone(g, res.path);
    return true;
  });
}

function pvDone(g) {
  pvClose(g);
  g.status = "done";
  g.got = g.have = g.size;
  const f = pvFile(g.file.id);
  if (f) f.download = { state: "done", there: true };
  pvRedrawCard(g.file.id);
  pvTick();
  if (pvTabOpen()) loadPovs(true);
}

// The connection stopped. Try again after a bit (unless it can't work).
function pvLost(g, message, wait, stop) {
  pvClose(g);
  if (g.status === "done" || g.status === "paused") return;
  if (g.bufBytes) { g.got -= g.bufBytes; g.buf = []; g.bufBytes = 0; }
  g.got = g.have;
  g.message = message;
  if (stop) {
    g.status = "paused";
  } else {
    g.status = "waiting";
    const seconds = wait || PV_RETRY[Math.min(g.tries, PV_RETRY.length - 1)];
    g.tries++;
    g.message = `${message} Trying again in ${seconds} s...`;
    g.retry = setTimeout(() => { if (g.status === "waiting") pvConnect(g); }, seconds * 1000);
  }
  pvRedrawCard(g.file.id);
  pvTick();
}

function pvClose(g) {
  const old = g.transfer;
  g.transfer = null;
  for (const x of [g.dc, g.pc]) { try { if (x) x.close(); } catch (e) { /* closed */ } }
  g.dc = g.pc = null;
  return old;
}

function pvPause(id) {
  const g = pvGets.get(id);
  if (!g) return;
  pvClose(g);
  clearTimeout(g.retry);
  g.got = g.have;
  g.buf = [];
  g.bufBytes = 0;
  g.status = "paused";
  g.message = "Paused";
  pvRedrawCard(id);
  pvTick();
}

async function pvCancel(f) {
  if (!confirm(`Stop downloading ${f.by}'s POV? What came so far is deleted.`)) return;
  const g = pvGets.get(f.id);
  if (g) { pvClose(g); clearTimeout(g.retry); pvGets.delete(f.id); }
  await api("/api/pov-cancel", { id: f.id, delete: true }).catch(() => {});
  f.download = null;
  const real = pvFile(f.id);
  if (real) real.download = null;
  pvRedrawCard(f.id);
  pvTick();
  loadPovs(true);
}

// ---- sending one of yours to a friend

async function pvOffered(s) {
  if (s.age > 40 || [...pvSends.values()].some((x) => x.transfer === s.transfer)) return;
  const busy = [...pvSends.values()].filter((x) => x.status === "sending").length >= PV_MAX_SENDS;
  if (busy) return pvSay(s.file, s.from, s.transfer, "no", "busy");
  const can = await api("/api/pov-can-send", { id: s.file }).catch(() => ({ ok: false, error: "Their app couldn't open the file." }));
  if (!can.ok) return pvSay(s.file, s.from, s.transfer, "no", can.error);
  const f = pvFile(s.file);
  const x = { transfer: s.transfer, file: s.file, name: f ? f.sessionTitle : "your POV", to: s.from, size: can.size, pos: 0, acked: 0, status: "sending" };
  // (an older connection to the same friend for the same POV is replaced: theirs broke)
  for (const [k, old] of pvSends) if (old.file === s.file && old.to === s.from) { pvStopSend(old); pvSends.delete(k); }
  pvSends.set(s.transfer, x);
  const pc = new RTCPeerConnection({ iceServers: CALL_SERVERS });
  x.pc = pc;
  pc.ondatachannel = (e) => pvSendChannel(x, e.channel);
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pvSendEnded(x, "The connection broke."); };
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await callGathered(pc);
  } catch (e) {
    return pvSendEnded(x, "Couldn't connect.");
  }
  await pvSay(s.file, s.from, s.transfer, "answer", pc.localDescription.sdp);
  x.giveUp = setTimeout(() => { if (!x.dc) pvSendEnded(x, "They didn't connect."); }, 45000);
  pvDrawSends();
  pvRedrawCard(s.file);
  pvTick();
}

function pvSendChannel(x, dc) {
  x.dc = dc;
  clearTimeout(x.giveUp);
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = PV_BUFFERED / 4;
  dc.onmessage = (e) => {
    let m = {};
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.want === x.file && x.started == null) {
      x.started = x.pos = x.acked = Math.max(0, Math.min(+m.at || 0, x.size));
      x.samples = [];
      pvSendLoop(x);
    } else if (m.ack != null) {
      x.acked = Math.max(x.acked, +m.ack);
      if (x.onAck) x.onAck();
      if (x.acked >= x.size) pvSendEnded(x, "", true);
    }
  };
  dc.onclose = () => { if (x.status === "sending") pvSendEnded(x, "They stopped (it goes on later from where it was)."); };
}

async function pvSendLoop(x) {
  const dc = x.dc;
  while (x.status === "sending" && x.pos < x.size) {
    if (x.pos - x.acked > PV_AHEAD) { // (wait until the friend's app saved some)
      await new Promise((ok) => { x.onAck = ok; setTimeout(ok, 5000); });
      x.onAck = null;
      continue;
    }
    const n = Math.min(PV_READ, x.size - x.pos);
    let piece;
    try {
      const r = await fetch(`/pov-read/${encodeURIComponent(x.file)}?at=${x.pos}&n=${n}`);
      if (!r.ok) throw new Error("gone");
      piece = await r.arrayBuffer();
    } catch (e) {
      try { dc.send(JSON.stringify({ error: "The file isn't on their PC any more." })); } catch (err) { /* closed */ }
      return pvSendEnded(x, "Couldn't read the file.");
    }
    if (!piece.byteLength) return pvSendEnded(x, "Couldn't read the file.");
    for (let at = 0; at < piece.byteLength; at += PV_PIECE) {
      if (x.status !== "sending" || dc.readyState !== "open") return;
      if (dc.bufferedAmount > PV_BUFFERED) {
        await new Promise((ok) => { dc.onbufferedamountlow = ok; setTimeout(ok, 2000); });
        dc.onbufferedamountlow = null;
        if (x.status !== "sending" || dc.readyState !== "open") return;
      }
      try {
        dc.send(piece.slice(at, at + PV_PIECE));
      } catch (e) {
        return pvSendEnded(x, "The connection broke.");
      }
    }
    x.pos += piece.byteLength;
  }
}

function pvStopSend(x) {
  clearTimeout(x.giveUp);
  for (const y of [x.dc, x.pc]) { try { if (y) y.close(); } catch (e) { /* closed */ } }
}

function pvSendEnded(x, message, done) {
  if (x.status !== "sending") return;
  x.status = done ? "done" : "error";
  x.message = message;
  if (done) setTimeout(() => pvStopSend(x), 3000); // (let the last "saved it" message through)
  else pvStopSend(x);
  // Finished and broken ones leave the panel after a bit.
  setTimeout(() => { if (pvSends.get(x.transfer) === x) { pvSends.delete(x.transfer); pvDrawSends(); pvDrawBadge(); } }, done ? 20000 : 8000);
  pvDrawSends();
  pvRedrawCard(x.file);
  pvTick();
  if (done && pvTabOpen()) setTimeout(() => loadPovs(true), 1500);
}

// ---- sessions and your POVs

async function pvNewSession(e) {
  e.preventDefault();
  const title = $("pvSessionTitle").value.trim();
  if (!title) return $("pvSessionTitle").focus();
  const editing = $("pvSessionModal").dataset.id;
  $("pvSessionSave").disabled = true;
  const res = editing
    ? await api("/api/pov-edit-session", { id: editing, title, game: $("pvSessionGame").value.trim() })
    : await api("/api/pov-new-session", { title, game: $("pvSessionGame").value.trim() });
  $("pvSessionSave").disabled = false;
  if (!res.ok) { $("pvSessionNote").textContent = res.error; return; }
  $("pvSessionModal").hidden = true;
  await loadPovs();
  if (!editing && res.session) {
    const s = pvSessions.find((x) => x.id === res.session);
    if (s) pvOpenAdd(s);
  }
}

function pvOpenSession(s) {
  $("pvSessionModal").dataset.id = s ? s.id : "";
  $("pvSessionHeading").textContent = s ? "Rename the session" : "New recording session";
  $("pvSessionSave").textContent = s ? "Save" : "Make it";
  $("pvSessionTitle").value = s ? s.title : "";
  $("pvSessionGame").value = s ? s.game : "";
  $("pvSessionNote").textContent = "";
  $("pvSessionModal").hidden = false;
  $("pvSessionTitle").focus();
}
const pvEditSession = (s) => pvOpenSession(s);

async function pvDeleteSession(s) {
  if (!confirm(`Delete "${s.title}"? Everyone's POVs in it leave the list (the videos stay on their PCs).`)) return;
  const res = await api("/api/pov-delete-session", { id: s.id });
  if (!res.ok) return alert(res.error);
  loadPovs();
}

function pvOpenAdd(s) {
  pvAddTo = s;
  $("pvAddSession").textContent = s.title;
  $("pvAddNote").textContent = "";
  $("pvAddNote").className = "acct-note";
  $("pvAddGo").disabled = false;
  pvDrawTimerPills();
  $("pvAddModal").hidden = false;
}

function pvDrawTimerPills() {
  $("pvAddTimers").replaceChildren(...pvTimers.map((h) => {
    const b = pvButton("gm-chip" + (h === pvAddHours ? " on" : ""), "", PV_TIMER_NAMES[h] || h + " hours", () => { pvAddHours = h; pvDrawTimerPills(); });
    return b;
  }));
}

async function pvAdd(path) {
  if (!pvAddTo) return;
  $("pvAddGo").disabled = true;
  $("pvAddNote").textContent = "Pick your recording. The app reads how long it is and takes a picture from it...";
  const res = await api("/api/pov-add", { id: pvAddTo.id, hours: pvAddHours, path })
    .catch(() => ({ ok: false, error: "Couldn't add it." }));
  $("pvAddGo").disabled = false;
  if (res.cancelled) { $("pvAddNote").textContent = ""; return; }
  if (!res.ok) { $("pvAddNote").textContent = res.error; $("pvAddNote").className = "acct-note bad"; return; }
  $("pvAddModal").hidden = true;
  await loadPovs();
  pvCheckSoon(100);
}

async function pvRelink(f) {
  const res = await api("/api/pov-relink", { id: f.id });
  if (res.cancelled) return;
  if (!res.ok) return alert(res.error);
  loadPovs();
}

async function pvSetTimer(f, hours) {
  const res = await api("/api/pov-timer", { id: f.id, hours });
  if (!res.ok) return alert(res.error);
  loadPovs();
}

async function pvRemove(f) {
  if (!confirm("Stop sharing this POV? It leaves the list. The video stays on your PC.")) return;
  const res = await api("/api/pov-remove", { id: f.id });
  if (!res.ok) return alert(res.error);
  for (const x of pvSends.values()) if (x.file === f.id) pvSendEnded(x, "You stopped sharing it.");
  loadPovs();
}

$("pvLogin").addEventListener("click", () => openLogin("login"));
$("pvNew").addEventListener("click", () => pvOpenSession(null));
$("pvSessionForm").addEventListener("submit", pvNewSession);
$("pvSessionCancel").addEventListener("click", () => { $("pvSessionModal").hidden = true; });
$("pvSessionModal").addEventListener("click", (e) => { if (e.target === $("pvSessionModal")) $("pvSessionModal").hidden = true; });
$("pvAddGo").addEventListener("click", () => pvAdd());
$("pvAddCancel").addEventListener("click", () => { $("pvAddModal").hidden = true; });
$("pvAddModal").addEventListener("click", (e) => { if (e.target === $("pvAddModal")) $("pvAddModal").hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  $("pvSessionModal").hidden = true;
  $("pvAddModal").hidden = true;
});

// ---- opening the tab, and logging in or out

function povsAccountChanged() {
  const id = pvLoggedIn() ? sfxUser().id : null;
  if (id === pvUserId) return;
  pvUserId = id;
  pvSessions = [];
  pvSig = "";
  for (const g of pvGets.values()) pvClose(g);
  pvGets.clear();
  for (const x of pvSends.values()) pvStopSend(x);
  pvSends.clear();
  pvAfter = 0;
  pvDrawBadge();
  if (pvTabOpen()) povsTabChanged("povs");
  if (id) pvCheckSoon(1500); // (friends can get your POVs while you're on any tab)
}

async function povsTabChanged(tab) {
  if (tab !== "povs") {
    clearTimeout(pvListTimer);
    return pvDrawSends();
  }
  renderPovsPage();
  if (typeof sfxAccount !== "undefined" && (!sfxAccount || sfxFromCache)) await loadAccount();
  renderPovsPage();
  if (pvLoggedIn()) {
    await loadPovs();
    pvListPoll();
  }
}
if (pvTabOpen()) povsTabChanged("povs");
// Your POVs are sent from any tab: start looking for friends who want them once the app knows who you are.
setTimeout(() => { if (pvLoggedIn() && !pvUserId) povsAccountChanged(); }, 4000);
