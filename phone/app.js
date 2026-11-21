// VaultHub on the phone: a home-screen web app that talks straight to the same Supabase
// database as the PC app (the lelons_* functions in sfx/setup.sql), with the same accounts.
"use strict";

const SUPA = "https://hjuoeiouotgaapuevflp.supabase.co";
const KEY = "sb_publishable_4cNy4W_7OjXUjGaoxXKneg_-YcdccQ2";  // the public (publishable) key, same as the PC app
const BUCKET = "lelons-sounds";
const VERSION = "phone 1.5.0";

const FRIENDLY = {
  wrong: "Wrong username or password.",
  locked: "Too many wrong tries. Wait a bit and try again.",
  username: "Usernames are 3 to 20 letters or numbers.",
  password: "Passwords need at least 8 characters.",
  short: "Write something first.",
  long: "That's a bit long. Keep it under 500 letters.",
  slow: "Slow down a little! Wait a few seconds.",
  daily: "You've sent a lot today. Try again tomorrow.",
  denied: "You aren't allowed to do that here.",
  nogroup: "That chat is gone, or you're not in it any more.",
  doc_gone: "That document was deleted, or you're not in it any more.",
  doc_long: "That document is too long.",
  doc_big: "That document is too big.",
  doc_many: "You have too many documents. Delete some on your PC first.",
};

// ---------------------------------------------------------------- small helpers

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("vh_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vh_" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const publicUrl = (path) => path ? `${SUPA}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path).replace(/%2F/g, "/")}` : "";
const COLORS = ["#2f8f6b", "#8a3fb0", "#2a8b8b", "#b5523b", "#3f6fb5", "#b0873f", "#a03f6a", "#5a8a2f"];
const NAMECOLORS = ["#7fd1b0", "#c48bff", "#5fd0d0", "#ff9a7a", "#7fb0ff", "#ffcf7a", "#ff7ac4", "#a8e07a"];
const hash = (s) => [...String(s || "").toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const lower = (s) => String(s || "").toLowerCase();

function avatar(name, url, opts = {}) {
  const cls = ["av", opts.small ? "s" : "", opts.big ? "big" : "", opts.square ? "sq" : ""].join(" ");
  const style = url ? `background-image:url('${esc(url)}')` : `background:${opts.bg || COLORS[hash(name) % COLORS.length]}`;
  const letters = opts.letters || String(name || "?").slice(0, 1).toUpperCase();
  return `<div class="${cls}" style="${style}">${url ? "" : esc(letters)}${opts.dot ? `<span class="dot" style="background:${opts.dot}"></span>` : ""}</div>`;
}

function timeOf(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function toast(text) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

class LoggedOut extends Error {}

async function rpc(name, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPA}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(args),
    });
  } catch {
    throw new Error("Couldn't reach VaultHub. Check your internet connection.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const hint = data && data.hint;
    if (hint === "login") throw new LoggedOut("You were logged out. Log in again.");
    throw new Error(FRIENDLY[hint] || "That didn't work. Try again.");
  }
  return data;
}

// Calls with your login. Logs you out when the login stopped working.
async function rpcMe(name, args = {}) {
  try {
    return await rpc(name, { token: S.token, ...args });
  } catch (e) {
    if (e instanceof LoggedOut) { logOut(true); }
    throw e;
  }
}

// ---------------------------------------------------------------- icons

const CALL_ICON = '<svg class="ic" style="color:var(--text)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>';
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  lib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  back: '<svg class="ic" style="color:var(--text)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  head: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9fd67a" stroke-width="1.8" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/></svg>',
  speaker: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  pc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
};

// ---------------------------------------------------------------- state

const S = {
  token: store.get("token", ""),
  me: null,
  tab: store.get("tab", "home"),
  view: null,            // an open chat or server on top of the tabs: {kind: "chat"|"server", ...}
  index: null,           // from lelons_chat_list: private chats, groups, everyone chat's newest id
  servers: [],
  sounds: null,
  games: null,
  chatSeg: store.get("chatSeg", "messages"),
  libCat: "music", libGenre: "",
  seen: store.get("seen", null),  // chat key -> newest message id you've seen
  playing: null,
};

function seenOf(key) { return (S.seen && S.seen[key]) || 0; }
function markSeen(key, id) {
  if (!id) return;
  S.seen = S.seen || {};
  if ((S.seen[key] || 0) >= id) return;
  S.seen[key] = id;
  store.set("seen", S.seen);
}

// The first time on this phone: everything already sent counts as read.
function firstSeen() {
  if (S.seen || !S.index) return;
  S.seen = {};
  for (const p of S.index.private || []) S.seen[lower(p.username)] = p.last_id || 0;
  for (const g of S.index.groups || []) S.seen["g:" + g.id] = g.last_id || 0;
  S.seen[""] = S.index.everyone_last || 0;
  store.set("seen", S.seen);
}

function unreadChats() {
  const out = [];
  if (!S.index) return out;
  for (const p of S.index.private || []) {
    if (!p.last_mine && (p.last_id || 0) > seenOf(lower(p.username))) out.push({ key: p.username, name: p.username, avatar: p.avatar, text: p.last_message, at: p.created_at, id: p.last_id });
  }
  for (const g of S.index.groups || []) {
    if (!g.last_mine && (g.last_id || 0) > seenOf("g:" + g.id)) out.push({ key: "g:" + g.id, name: g.name, avatar: g.picture, text: g.last_message, id: g.last_id, group: true });
  }
  return out.sort((a, b) => (b.id || 0) - (a.id || 0));
}

function serverUnread() {
  let n = 0;
  for (const s of S.servers) for (const c of s.channels || []) if (c.kind === "text" && c.unread) n++;
  return n;
}

// ---------------------------------------------------------------- loading

async function loadIndex() {
  const r = await rpcMe("lelons_chat_list", { after: 0, with_user: null });
  S.index = r || {};
  firstSeen();
}

async function loadServers() {
  const r = await rpcMe("lelons_server", { what: "list", sid: null, data: {} });
  S.servers = (r && r.servers) || [];
}

async function refreshAll() {
  if (!S.token) return;
  await Promise.allSettled([loadIndex(), loadServers()]);
  if (!S.view && S.tab !== "live") render();  // (the Live tab has a chat box: don't wipe what you're typing)
  else renderTabsBadge();
}

// This phone's id for "who's online" (32 letters 0-9 a-f, like the PC app's).
let pingId = store.get("client", "");
if (!/^[0-9a-f]{32}$/.test(pingId)) {
  pingId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  store.set("client", pingId);
}
function ping() { if (S.token && !document.hidden) rpc("lelons_ping", { client_id: pingId, token: S.token }).catch(() => {}); }

// ---------------------------------------------------------------- log in

function renderLogin(error = "") {
  $("#app").innerHTML = `<div class="login">
    <div class="logo">V</div>
    <h1 style="margin:14px 0 2px">Log in to <em>VaultHub</em></h1>
    <div class="muted" style="margin-bottom:14px">Use the same account as on your PC.</div>
    <input class="field" id="lu" placeholder="Username" autocapitalize="none" autocorrect="off" autocomplete="username">
    <input class="field" id="lp" placeholder="Password" type="password" autocomplete="current-password">
    <div class="err" id="lerr">${esc(error)}</div>
    <button class="btn" id="lgo">Log in</button>
    <div class="muted sm" style="margin-top:10px">No account yet? Make one in the VaultHub app on a PC with an invite code.</div>
  </div>`;
  const go = async () => {
    const u = $("#lu").value.trim(), p = $("#lp").value;
    if (!u || !p) return ($("#lerr").textContent = "Type your username and password.");
    $("#lgo").disabled = true;
    try {
      const r = await rpc("lelons_login", { username: u, password: p, device: phoneName(), app_version: VERSION });
      if (!r || !r.ok) {
        let msg = FRIENDLY[r && r.error] || "That didn't work. Try again.";
        if (r && r.error === "locked" && r.minutes) msg = `Too many wrong tries. Wait ${r.minutes} minute${r.minutes == 1 ? "" : "s"} and try again.`;
        throw new Error(msg);
      }
      S.token = r.token;
      store.set("token", S.token);
      await start();
    } catch (e) {
      $("#lerr").textContent = e.message;
      $("#lgo").disabled = false;
    }
  };
  $("#lgo").onclick = go;
  $("#lp").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

function phoneName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  return "Phone";
}

function logOut(expired) {
  const token = S.token;
  S.token = ""; S.me = null; S.index = null; S.servers = []; S.view = null; S.sounds = null;
  store.set("token", "");
  stopChatPoll();
  if (typeof hangUp === "function") hangUp();
  if (token && !expired) pushOff(true, token);
  if (token && !expired) rpc("lelons_logout", { token }).catch(() => {});
  renderLogin(expired ? "You were logged out. Log in again." : "");
}

async function start() {
  $("#app").innerHTML = '<div class="screen"><div class="spin" style="margin-top:45vh"></div></div>';
  try {
    S.me = await rpcMe("lelons_me");
  } catch (e) {
    if (!S.token) return;  // (logged out already shows the log in page)
    $("#app").innerHTML = `<div class="screen"><div class="empty" style="margin-top:30vh">${esc(e.message)}<br><br><button class="btn2" id="retry">Try again</button></div></div>`;
    $("#retry").onclick = start;
    return;
  }
  ping();
  await refreshAll();
  render();
  pushRefresh();
  openLink(location.hash);
}

// ---------------------------------------------------------------- the tabs

const TABS = [["home", "Home"], ["chat", "Chat"], ["lib", "Library"], ["live", "Live"], ["more", "More"]];

function tabsHtml() {
  const n = unreadChats().length + serverUnread();
  return `<nav class="tabs glass">${TABS.map(([k, name]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${I[k]}${name}${k === "chat" && n ? `<span class="badge">${n > 99 ? "99+" : n}</span>` : ""}</button>`).join("")}</nav>`;
}

function renderTabsBadge() {
  const nav = $(".tabs");
  if (nav) nav.outerHTML = tabsHtml();
  bindTabs();
}

function bindTabs() {
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
    S.tab = b.dataset.tab; store.set("tab", S.tab); render();
    if (S.tab === "lib" && !S.sounds) loadSounds();
  });
}

function render() {
  if (!S.token) return renderLogin();
  if (S.view) return S.view.kind === "chat" ? renderChat() : S.view.kind === "server" ? renderServer() : renderDocsView();
  const body = { home: homeHtml, chat: chatsHtml, lib: libHtml, live: liveHtml, more: moreHtml }[S.tab] || homeHtml;
  const scrollWas = $(".scroll") && $(".scroll").dataset.tab === S.tab ? $(".scroll").scrollTop : 0;
  $("#app").innerHTML = `<div class="screen ${S.tab === "lib" && S.playing ? "has-player" : ""}"><div class="scroll" data-tab="${S.tab}">${body()}</div>${S.tab === "lib" ? playerHtml() : ""}</div>${tabsHtml()}`;
  $(".scroll").scrollTop = scrollWas;
  bindTabs();
  bindPage();
  afterRender();
}
function afterRender() {
  if (typeof callAfterRender === "function") callAfterRender();
  if (typeof liveAfterRender === "function") liveAfterRender();
}

// Clicks inside a page: anything with data-open opens a chat, data-server a server, data-play a sound.
function bindPage() {
  const root = $("#app");
  root.onclick = (e) => {
    const t = e.target.closest("[data-open],[data-server],[data-voice],[data-callkey],[data-play],[data-seg],[data-cat],[data-genre],[data-act],[data-tab-go]");
    if (!t) return;
    if (t.dataset.tabGo) { S.tab = t.dataset.tabGo; store.set("tab", S.tab); return render(); }
    if (t.dataset.open !== undefined) return openChat(t.dataset.open, t.dataset.title, t.dataset.sub);
    if (t.dataset.server) return openServer(t.dataset.server);
    if (t.dataset.voice) return startCall("g:" + t.dataset.voice, t.dataset.title, t.dataset.sub);
    if (t.dataset.callkey) return startCall(t.dataset.callkey, t.dataset.title, t.dataset.sub);
    if (t.dataset.play) return playSound(t.dataset.play, t.classList.contains("track") ? S.libList : null);
    if (t.dataset.seg) { S.chatSeg = t.dataset.seg; store.set("chatSeg", S.chatSeg); return render(); }
    if (t.dataset.cat) { S.libCat = t.dataset.cat; S.libGenre = ""; return render(); }
    if (t.dataset.genre !== undefined) { S.libGenre = t.dataset.genre; return render(); }
    if (t.dataset.act === "logout") return logOut(false);
    if (t.dataset.act === "push-on") return pushOn();
    if (t.dataset.act === "push-off") return pushOff();
    if (t.dataset.act === "toggle") return togglePlay();
    if (t.dataset.act === "pl-next") return plStep(1);
    if (t.dataset.act === "np-open") return plOpen();
    if (t.dataset.act === "docs") return openDocs();
  };
}

// ---------------------------------------------------------------- Home

function voiceNow() {
  const out = [];
  for (const s of S.servers) for (const c of s.channels || []) {
    if (c.kind === "voice" && c.people && c.people.length) out.push({ server: s, channel: c });
  }
  return out;
}

function homeHtml() {
  const me = S.me || {};
  const h = new Date().getHours();
  const hello = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  // Who's online (not you)
  const online = ((S.index && S.index.online && S.index.online.people) || []).filter((p) => lower(p.username) !== lower(me.username));
  const friends = online.length ? `<div class="lbl">Online now</div><div class="friends">${online.map((p) => `<button data-open="${esc(p.username)}" data-title="${esc(p.username)}">
      ${avatar(p.username, publicUrl(p.avatar), { big: true, dot: "#34c759" })}<span class="one">${esc(p.username)}</span></button>`).join("")}</div>` : "";

  // Voice channels with people in them: big green cards
  const voice = voiceNow().map((v) => {
    const p = v.channel.people;
    return `<button class="voice-card" data-voice="${esc(v.channel.id)}" data-title="${esc(v.channel.name)}" data-sub="${esc(v.server.name)}">
      <div class="faces">${p.slice(0, 4).map((x) => avatar(x.username, publicUrl(x.avatar), { small: true })).join("")}</div>
      <div class="grow"><b class="one">${esc(p.map((x) => x.username).join(", "))}</b><div class="sm one">${esc(v.channel.name)} · ${esc(v.server.name)}</div></div>
      <span class="join">Join</span></button>`;
  }).join("");

  // New messages
  const rows = [];
  for (const u of unreadChats().slice(0, 4)) {
    rows.push(`<button class="row" data-open="${esc(u.key)}" data-title="${esc(u.name)}">${avatar(u.name, publicUrl(u.avatar), { square: u.group, letters: u.group ? initials(u.name) : "" })}
      <div class="grow"><div class="row between"><b class="one">${esc(u.name)}</b><span class="sm" style="color:var(--accent);flex:none">${esc(timeOf(u.at))}</span></div><div class="sm one">${esc(u.text || "")}</div></div><span class="dotn"></span></button>`);
  }
  for (const s of S.servers) for (const c of s.channels || []) {
    if (c.kind === "text" && c.unread && rows.length < 6) {
      rows.push(`<button class="row" data-server="${esc(s.id)}">${avatar(s.name, publicUrl(s.picture), { square: true, letters: initials(s.name), bg: "#1f7a4a" })}
        <div class="grow"><b class="one">${esc(s.name)}</b><div class="sm muted"># ${esc(c.name)}${c.mentions ? ` · <span style="color:var(--accent)">mentioned you</span>` : ""}</div></div><span class="unread">${c.mentions ? "@" : c.unread}</span></button>`);
    }
  }
  const news = rows.length ? `<div class="lbl">New messages</div><div class="card list">${rows.join("")}</div>`
    : `<div class="caught"><span>✓</span><div><b>All caught up</b><div class="sm muted">No new messages${voice ? "" : " and nobody is in voice"}.</div></div></div>`;

  // Shortcuts
  const unread = unreadChats().length + S.servers.reduce((n, s) => n + (s.channels || []).filter((c) => c.kind === "text" && c.unread).length, 0);
  const np = S.playing;
  const tiles = `<div class="bento">
    <button class="tile t-chat" data-tab-go="chat"><span class="ti">${I.chat}</span><b>Chat</b><span class="sm">${unread ? `${unread} new` : "Messages and servers"}</span></button>
    <button class="tile t-lib" data-tab-go="lib"><span class="ti">${I.lib}</span><b>${np ? esc(np.name) : "Library"}</b><span class="sm">${np ? (plAudio().paused ? "Paused" : "Playing now") : "Music and sounds"}</span></button>
    <button class="tile t-docs" data-act="docs"><span class="ti">${DI.doc}</span><b>Docs</b><span class="sm">Shared documents</span></button>
    <button class="tile t-live" data-tab-go="live"><span class="ti">${I.live}</span><b>Live</b><span class="sm">Your Twitch stream</span></button></div>`;

  return `<div class="hello">${avatar(me.username, publicUrl(me.avatar), { dot: "#34c759" })}
      <div class="grow"><div class="sm muted">${hello}</div><b>${esc(me.username || "there")}</b></div>
      <div class="brand">Vault<span>Hub</span></div></div>
    ${voice ? `<div class="lbl">In voice now</div>${voice}` : ""}
    ${news}
    ${friends}
    <div class="lbl">Shortcuts</div>${tiles}
    <div class="lbl">Games on sale</div>
    ${gamesHtml()}`;
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}

function gamesHtml() {
  if (!S.games) { loadGames(); return '<div class="spin" style="margin:20px auto"></div>'; }
  const sale = S.games.filter((g) => g.info && g.info.price && (g.info.price.discount > 0)).sort((a, b) => b.info.price.discount - a.info.price.discount);
  if (!sale.length) return '<div class="muted sm" style="padding:6px 2px">No games from your list are on sale right now.</div>';
  return `<div class="games">${sale.slice(0, 12).map((g) => `<div class="game">${g.info.header ? `<img src="${esc(g.info.header)}" loading="lazy" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:${esc(JSON.stringify(initials(g.info.name)))}}))">` : `<div class="ph">${esc(initials(g.info.name))}</div>`}
    <span class="sale">-${g.info.price.discount}%</span>
    <div class="gi"><b class="one">${esc(g.info.name)}</b><div class="sm muted">${esc(g.info.price.text || "")}</div></div></div>`).join("")}</div>`;
}

async function loadGames() {
  if (S.gamesLoading) return;
  S.gamesLoading = true;
  try {
    const r = await rpcMe("lelons_games", { what: "list" });
    S.games = (r && r.games) || [];
  } catch { S.games = []; }
  S.gamesLoading = false;
  if (S.tab === "home" && !S.view) render();
}

// ---------------------------------------------------------------- Chat list

function chatsHtml() {
  const seg = `<div class="seg"><button data-seg="messages" class="${S.chatSeg === "messages" ? "on" : ""}">Messages</button><button data-seg="servers" class="${S.chatSeg === "servers" ? "on" : ""}">Servers</button></div>`;
  const head = `<div class="row between"><h1>Chat</h1></div>${seg}`;
  if (!S.index) return head + '<div class="spin"></div>';
  if (S.chatSeg === "servers") return head + serversHtml();

  const items = [];
  for (const p of S.index.private || []) items.push({ key: p.username, name: p.username, avatar: p.avatar, text: (p.last_mine ? "You: " : "") + (p.last_message || ""), at: p.created_at, id: p.last_id || 0, unread: !p.last_mine && (p.last_id || 0) > seenOf(lower(p.username)), online: isOnline(p.username) });
  for (const g of S.index.groups || []) items.push({ key: "g:" + g.id, name: g.name, avatar: g.picture, text: g.last_message || `${g.people} people`, id: g.last_id || 0, unread: !g.last_mine && (g.last_id || 0) > seenOf("g:" + g.id), group: true, sub: `${g.people} people` });
  items.sort((a, b) => b.id - a.id);
  const everyoneUnread = (S.index.everyone_last || 0) > seenOf("");
  const everyone = `<button class="row" data-open="" data-title="Everyone">${avatar("Everyone", "", { bg: "#ffcf3f", letters: "#" })}
      <div class="grow"><div class="row between"><b>Everyone</b></div><div class="sm muted">The chat with all of VaultHub</div></div>${everyoneUnread ? '<span class="unread">new</span>' : ""}</button>`;
  return head + `<div class="list">${everyone}${items.map((c) => `<button class="row" data-open="${esc(c.key)}" data-title="${esc(c.name)}" data-sub="${esc(c.sub || "")}">
      ${avatar(c.name, publicUrl(c.avatar), { square: c.group, dot: c.online ? "#9fd67a" : "", letters: c.group ? initials(c.name) : "" })}
      <div class="grow"><div class="row between"><b class="one">${esc(c.name)}</b><span class="sm" style="color:${c.unread ? "var(--accent)" : "var(--muted)"};flex:none">${esc(timeOf(c.at))}</span></div>
      <div class="sm one ${c.unread ? "" : "muted"}">${esc(c.text)}</div></div>${c.unread ? '<span class="unread">new</span>' : ""}</button>`).join("")}</div>
    ${items.length ? "" : '<div class="empty">No private chats yet.</div>'}`;
}

function isOnline(name) {
  const people = S.index && S.index.online && S.index.online.people;
  return !!(people && people.some((p) => lower(p.username) === lower(name)));
}

function serversHtml() {
  if (!S.servers.length) return '<div class="empty">You\'re not in any servers yet. Join one from your PC.</div>';
  return `<div class="list">${S.servers.map((s) => {
    const unread = (s.channels || []).reduce((n, c) => n + (c.kind === "text" ? c.unread || 0 : 0), 0);
    const inVoice = (s.channels || []).reduce((n, c) => n + (c.kind === "voice" ? (c.people || []).length : 0), 0);
    const online = (s.members || []).filter((m) => m.online).length;
    return `<button class="row" data-server="${esc(s.id)}">${avatar(s.name, publicUrl(s.picture), { square: true, letters: initials(s.name), bg: "#1f7a4a" })}
      <div class="grow"><b>${esc(s.name)}</b><div class="sm">${inVoice ? `<span style="color:var(--green)">● ${inVoice} in voice</span> · ` : ""}<span class="muted">${online} online</span></div></div>
      ${unread ? `<span class="unread">${unread}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

// ---------------------------------------------------------------- a server

async function openServer(id) {
  S.view = { kind: "server", id };
  renderServer();
  try {
    const r = await rpcMe("lelons_server", { what: "get", sid: id, data: {} });
    const s = r && (r.server || r);
    if (s && s.id) {
      const i = S.servers.findIndex((x) => x.id === s.id);
      if (i >= 0) S.servers[i] = { ...S.servers[i], ...s }; else S.servers.push(s);
    }
  } catch (e) { toast(e.message); }
  if (S.view && S.view.kind === "server" && S.view.id === id) renderServer();
}

function renderServer() {
  const s = S.servers.find((x) => x.id === S.view.id);
  if (!s) { $("#app").innerHTML = `<div class="screen has-top"><div class="top"><button class="back" id="back">${I.back}</button></div><div class="spin"></div></div>`; $("#back").onclick = closeView; return; }
  const chans = s.channels || [];
  const cats = [];
  for (const c of chans) {
    const cat = c.category || (c.kind === "voice" ? "Voice" : "Chat");
    let group = cats.find((g) => g.name === cat);
    if (!group) cats.push(group = { name: cat, list: [] });
    group.list.push(c);
  }
  const online = (s.members || []).filter((m) => m.online).length;
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button>${avatar(s.name, publicUrl(s.picture), { small: true, square: true, letters: initials(s.name), bg: "#1f7a4a" })}
      <div class="grow"><b class="one" style="display:block">${esc(s.name)}</b><div class="sm muted" style="margin-top:-2px">${(s.members || []).length} members · ${online} online</div></div></div>
    <div class="scroll">${cats.map((g) => `<div class="cat">${esc(g.name)}</div>${g.list.map((c) => c.kind === "voice"
      ? `<button class="chan" data-voice="${esc(c.id)}" data-title="${esc(c.name)}" data-sub="${esc(s.name)}"><span class="hash">${I.speaker}</span><b class="grow">${esc(c.name)}</b><span class="btn2 go" style="height:28px;font-size:13px">Join</span></button>${(c.people || []).length ? `<div class="people">${c.people.map((p) => `<span>${avatar(p.username, publicUrl(p.avatar), { small: true })}${esc(p.username)}</span>`).join("")}</div>` : ""}`
      : `<button class="chan ${c.unread ? "new" : ""}" data-open="g:${esc(c.id)}" data-title="# ${esc(c.name)}" data-sub="${esc(s.name)}"><span class="hash">#</span><b class="grow">${esc(c.name)}</b>${c.mentions ? `<span class="unread">@</span>` : c.unread ? `<span class="unread">${c.unread}</span>` : ""}</button>`).join("")}`).join("")}
    </div></div>`;
  $("#back").onclick = closeView;
  bindPage();
  afterRender();
}

function closeView() {
  stopChatPoll();
  const back = S.view && S.view.from;
  S.view = back || null;
  render();
  refreshAll();
}

// ---------------------------------------------------------------- a conversation

let pollTimer = null;
function stopChatPoll() { clearTimeout(pollTimer); pollTimer = null; }

function openChat(key, title, sub) {
  stopChatPoll();
  const from = S.view && S.view.kind === "server" ? S.view : null;
  S.view = { kind: "chat", key: key || "", title: title || key || "Everyone", sub: sub || "", messages: [], last: 0, loading: true, from };
  renderChat();
  loadChat(true);
}

function chatKey(key) { return key && !key.startsWith("g:") ? lower(key) : key; }

async function loadChat(first) {
  const v = S.view;
  if (!v || v.kind !== "chat") return;
  try {
    const r = await rpcMe("lelons_chat_list", { after: first ? 0 : v.last, with_user: v.key || null });
    if (S.view !== v) return;
    v.loading = false;
    const wasNearBottom = nearBottom();
    let changed = first;
    for (const m of r.messages || []) {
      if (v.messages.some((x) => x.id === m.id)) continue;
      v.messages.push(m);
      changed = true;
    }
    v.messages.sort((a, b) => a.id - b.id);
    // Reactions, edits and deletes in the newest messages.
    if (Array.isArray(r.recent) && r.recent.length) {
      const byId = new Map(r.recent.map((x) => [x.id, x]));
      const oldest = Math.min(...r.recent.map((x) => x.id));
      const before = v.messages.length;
      v.messages = v.messages.filter((m) => m.id < oldest || byId.has(m.id));
      if (v.messages.length !== before) changed = true;
      for (const m of v.messages) {
        const n = byId.get(m.id);
        if (n && (JSON.stringify(n.reactions) !== JSON.stringify(m.reactions) || n.message !== m.message)) {
          Object.assign(m, { reactions: n.reactions, message: n.message, edited: n.edited });
          changed = true;
        }
      }
    }
    if (r.group && !v.sub) v.sub = r.group.members && r.group.members.length ? `${r.group.members.length} people` : "";
    if (v.messages.length) v.last = v.messages[v.messages.length - 1].id;
    markSeen(chatKey(v.key), v.last);
    if (changed) {
      renderMessages();
      if (first || wasNearBottom) scrollDown();
    }
    if (first) rpcMe("lelons_chat_live", { with_user: v.key || null, seen_id: v.last || null }).catch(() => {});
  } catch (e) {
    if (S.view === v && first) { v.loading = false; renderMessages(e.message); }
  }
  if (S.view === v) pollTimer = setTimeout(() => loadChat(false), document.hidden ? 15000 : 3000);
}

function nearBottom() {
  const sc = $("#msgs");
  return !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
}
function scrollDown() { const sc = $("#msgs"); if (sc) sc.scrollTop = sc.scrollHeight; }

function renderChat() {
  const v = S.view;
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button>
      <div class="grow"><b class="one" style="display:block">${esc(v.title)}</b>${v.sub ? `<div class="sm muted" style="margin-top:-2px">${esc(v.sub)}</div>` : ""}</div>
      ${v.key && !v.from ? `<button class="back" data-callkey="${esc(v.key)}" data-title="${esc(v.title)}" data-sub="${esc(v.sub || "")}" aria-label="Call">${CALL_ICON}</button>` : ""}</div>
    <div class="scroll msgs" id="msgs"></div>
    <div class="compose"><textarea id="box" rows="1" placeholder="Message ${esc(v.title.startsWith("#") ? v.title : v.title)}" enterkeyhint="send"></textarea>
      <button class="send" id="sendBtn" aria-label="Send">${I.send}</button></div></div>`;
  $("#back").onclick = closeView;
  const box = $("#box");
  box.oninput = () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 120) + "px"; };
  box.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } };
  $("#sendBtn").onclick = sendMessage;
  renderMessages();
  bindPage();
  afterRender();
}

function renderMessages(error) {
  const v = S.view, el = $("#msgs");
  if (!el || !v) return;
  if (v.loading) { el.innerHTML = '<div class="spin"></div>'; return; }
  if (error) { el.innerHTML = `<div class="empty">${esc(error)}</div>`; return; }
  if (!v.messages.length) { el.innerHTML = `<div class="empty chat-empty">${avatar(v.title.replace(/^# /, ""), "", { big: true })}<b>${esc(v.title)}</b><div class="muted sm">No messages yet. Say hi!</div></div>`; return; }
  // Bubbles in groups: the same person within 5 minutes. A day line between days.
  const dm = !!v.key && !v.key.startsWith("g:");
  const list = v.messages;
  const out = [];
  let day = "";
  for (let i = 0; i < list.length; i++) {
    const m = list[i], prev = list[i - 1], next = list[i + 1];
    const d = new Date(m.created_at).toDateString();
    if (d !== day) { day = d; out.push(`<div class="day"><span>${esc(dayName(m.created_at))}</span></div>`); }
    const joins = (a, b) => a && b && !a.auto && !b.auto && lower(a.username) === lower(b.username)
      && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 5 * 60e3 && new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString();
    const gap = !next || new Date(next.created_at) - new Date(m.created_at) > 10 * 60e3;
    out.push(messageHtml(m, { first: !joins(prev, m), last: !joins(m, next), dm, time: gap && !joins(m, next) }));
  }
  el.innerHTML = out.join("");
}

function dayName(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

function messageHtml(m, o) {
  const me = S.me && lower(m.username) === lower(S.me.username);
  const pinged = S.me && !me && new RegExp(`@${escapeRe(S.me.username)}\\b`, "i").test(m.message || "");
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // VaultHub's own posts ("Kim joined", "Zed posted a game") are a quiet line in the middle.
  if (m.auto) {
    return `<div class="sys"><span>${formatText(m.message || "")}</span>${m.card ? cardHtml(m.card) : ""}<i>${esc(time)}</i></div>`;
  }
  const parts = [];
  let media = "";
  if (m.reply && !m.reply.gone) parts.push(`<div class="reply"><b>${esc(m.reply.username)}</b> ${esc(m.reply.message || m.reply.kind || "")}</div>`);
  if (m.message) parts.push(`<div class="tx">${formatText(m.message)}${m.edited ? ' <span class="ed">edited</span>' : ""}</div>`);
  if (m.card) parts.push(cardHtml(m.card));
  if (m.sound) parts.push(`<div class="snd-b"><button class="play" data-play="${esc(m.sound.id)}" data-url="${esc(publicUrl(m.sound.path))}" data-name="${esc(m.sound.name)}">${S.playing && S.playing.id === m.sound.id && !$("#audio").paused ? I.pause : I.play}</button><div class="grow"><b class="one">${esc(m.sound.name)}</b><div class="sm">${m.sound.seconds ? duration(m.sound.seconds) + " · " : ""}Library</div></div></div>`);
  if (m.file && (m.voice || !m.gif)) parts.push(`<div class="clip"><audio controls preload="none" src="${esc(publicUrl(m.file))}"></audio>${m.voice ? "" : `<div class="sm">${esc(m.file_name || "Clip")}</div>`}</div>`);
  const gif = m.gif === "@file" ? publicUrl(m.file) : m.gif && String(m.gif).startsWith("https://") ? m.gif : "";
  if (gif) media = `<img class="media" src="${esc(gif)}" loading="lazy" alt="">`;
  if (m.sticker) parts.push(`<div class="sm">[sticker: ${esc(m.sticker)}]</div>`);
  if (m.poll) parts.push(`<div class="poll"><b>📊 ${esc(m.poll.q)}</b>${(m.poll.options || []).map((opt, i) => { const v = (m.votes || []).find((x) => x.choice === i); const n = v ? v.count : 0; const all = (m.votes || []).reduce((t, x) => t + x.count, 0) || 1; return `<div class="opt"><i style="width:${Math.round(n / all * 100)}%"></i><span>${esc(opt)}</span><span>${n}</span></div>`; }).join("")}</div>`);
  if (m.call_seconds != null) parts.push(`<div class="tx">📞 Call · ${Math.max(1, Math.round(m.call_seconds / 60))} min</div>`);
  if (m.thread && m.thread.count) parts.push(`<div class="sm thr">${m.thread.count} ${m.thread.count === 1 ? "reply" : "replies"}</div>`);
  const onlyMedia = media && !parts.length;
  const reacts = m.reactions && m.reactions.length ? `<div class="reacts">${m.reactions.map((r) => `<button class="${r.mine ? "mine" : ""}" data-react="${esc(r.emoji)}" data-mid="${m.id}" data-on="${r.mine ? 0 : 1}">${esc(r.emoji)}${r.count > 1 ? ` <b>${r.count}</b>` : ""}</button>`).join("")}</div>` : "";
  const name = o.first && !me && !o.dm ? `<div class="who" style="color:${NAMECOLORS[hash(m.username) % NAMECOLORS.length]}">${esc(m.username)}</div>` : "";
  const face = !me ? (o.last ? avatar(m.username, publicUrl(m.avatar), { small: true }) : '<div class="av s ghost"></div>') : "";
  const cls = ["brow", me ? "me" : "them", o.first ? "first" : "", o.last ? "last" : "", pinged ? "ping" : ""].join(" ");
  return `<div class="${cls}" data-mid="${m.id}">${face}<div class="bcol">${name}
    <div class="bub ${onlyMedia ? "only-media" : ""}">${media}${parts.join("")}</div>${reacts}
    ${o.time ? `<div class="bt">${esc(time)}</div>` : ""}</div></div>`;
}

function escapeRe(s) { return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function formatText(text) {
  let html = esc(text);
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
  html = html.replace(/(^|\s)@([A-Za-z0-9._-]{3,20})/g, '$1<span class="mention">@$2</span>');
  return html;
}

function cardHtml(card) {
  if (!card || typeof card !== "object") return "";
  const title = card.title || card.name || "";
  const img = card.image || card.thumb || card.header || "";
  const kind = card.kind || card.type || "";
  if (!title && !img) return "";
  return `<div class="gamecard">${img && /^https:\/\//.test(img) ? `<img src="${esc(img)}" loading="lazy" alt="">` : ""}<div>${kind ? `<div class="sm muted">${esc(String(kind).toUpperCase())}</div>` : ""}<b>${esc(title)}</b></div></div>`;
}

async function sendMessage() {
  const v = S.view, box = $("#box");
  const text = box.value.trim();
  if (!text || !v) return;
  box.value = ""; box.style.height = "auto";
  try {
    const r = await rpcMe("lelons_chat_send", { message: text, to_user: v.key || null });
    if (r && r.ok === false) throw new Error({ short: "Write something first.", long: "That's a bit long. Keep it under 500 letters.", slow: "Slow down a little! Wait a few seconds.", daily: "You've sent a lot today. Try again tomorrow.", denied: "You can't write in this channel." }[r.error] || "That didn't send. Try again.");
    stopChatPoll();
    await loadChat(false);
    scrollDown();
  } catch (e) {
    if (!box.value) box.value = text;
    toast(e.message);
  }
}

// ---------------------------------------------------------------- Library

const CATS = [["music", "Music"], ["sfx", "SFX"], ["ambience", "Ambience"]];
const GENRES = {
  music: ["Action", "Cinematic", "Epic", "Horror", "Chill", "Happy", "Sad", "Hip Hop", "Electronic"],
  sfx: ["Whooshes", "Hits & Impacts", "Explosions", "Clicks & UI", "Footsteps", "Horror", "Funny", "Memes"],
  ambience: ["Nature", "Rain & Weather", "City", "Indoor", "Creepy", "Sci-fi"],
};

async function loadSounds() {
  try {
    S.sounds = (await rpcMe("lelons_list")) || [];
  } catch (e) { S.sounds = []; toast(e.message); }
  if (S.tab === "lib" && !S.view) render();
}

function libHtml() {
  const head = `<div class="row between"><h1>Library</h1></div>
    <div class="seg">${CATS.map(([k, n]) => `<button data-cat="${k}" class="${S.libCat === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="chips"><button data-genre="" class="${!S.libGenre ? "on" : ""}">All</button>${GENRES[S.libCat].map((g) => `<button data-genre="${esc(g)}" class="${S.libGenre === g ? "on" : ""}">${esc(g)}</button>`).join("")}</div>`;
  if (!S.sounds) { loadSounds(); return head + '<div class="spin"></div>'; }
  const list = S.sounds.filter((s) => s.category === S.libCat && (!S.libGenre || s.genre === S.libGenre));
  S.libList = list.map((s) => s.id);
  if (!list.length) return head + '<div class="empty">Nothing here yet.</div>';
  return head + `<div class="list">${list.map((s) => {
    const on = S.playing && S.playing.id === s.id;
    const by = s.mine ? "you" : s.uploader || "someone";
    return `<button class="row track ${on ? "on" : ""}" data-play="${esc(s.id)}"><div class="tile" style="${plArt(s)}">${on && !$("#audio").paused ? I.pause : I.play}</div>
      <div class="grow"><b class="one" style="display:block">${esc(s.name)}</b><div class="sm muted">${esc(s.genre || CATS.find((c) => c[0] === s.category)[1])} · uploaded by ${esc(by)}</div></div>
      <span class="sm muted">${duration(s.seconds)}</span></button>`;
  }).join("")}</div>`;
}

function duration(sec) {
  sec = Math.round(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- Live and More

function moreHtml() {
  const me = S.me || {};
  const ic = (bg, svg) => `<span class="sico" style="background:${bg}">${svg}</span>`;
  const bell = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  const pc = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  const soon = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  const out = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg>';
  return `<h1>More</h1>
    <div class="profile">${avatar(me.username, publicUrl(me.avatar), { big: true, dot: "#34c759" })}
      <div class="grow"><b>${esc(me.username)}</b><div class="sm muted">${esc({ owner: "Owner", admin: "Admin" }[me.role] || "Member")} · this iPhone</div></div></div>
    <div class="card list set">
      <div class="srow">${ic("#ff3b30", bell)}${pushRowHtml()}</div></div>
    <div class="card list set" style="margin-top:14px">
      <button class="srow" data-act="docs">${ic("#0a84ff", `<span style="color:#fff;display:grid">${DI.doc}</span>`)}<div class="grow">Docs</div><span class="chev">›</span></button>
      <div class="srow">${ic("#8e8e93", soon)}<div class="grow">Games, Boards, Film assets<div class="sm muted">Coming to the phone later</div></div></div>
      <div class="srow">${ic("#5e5ce6", pc)}<div class="grow">On your PC<div class="sm muted">Converting, Files, Images, Copyright, Resolve, Remote</div></div></div></div>
    <div class="card list set" style="margin-top:14px">
      <button class="srow" data-act="logout">${ic("#3a3a3c", out)}<div class="grow" style="color:#ff453a">Log out</div></button></div>
    <div class="muted sm" style="text-align:center;margin-top:22px">VaultHub for phone ${esc(VERSION.replace("phone ", ""))}</div>
    <div class="muted" style="text-align:center;margin-top:4px;font-size:11px;opacity:.6">${screenInfo()}</div>`;
}

// Screen sizes, shown small on the More page (helps fix layout problems from a screenshot).
function screenInfo() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom);visibility:hidden";
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  const app = $("#app").getBoundingClientRect();
  return `screen ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight} · app ${Math.round(app.height)} · safe ${Math.round(r.top)}/${Math.round(innerHeight - r.bottom)}${navigator.standalone ? " · home" : ""}`;
}

// ---------------------------------------------------------------- notifications

const isStandalone = () => navigator.standalone || matchMedia("(display-mode: standalone)").matches;
let pushStatus = store.get("push", "off");  // "on" or "off" on this phone

function pushRowHtml() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return `<div class="grow">Notifications<div class="sm muted">${/iPhone|iPad/.test(navigator.userAgent) && !isStandalone()
      ? "Open VaultHub from your Home Screen to turn them on." : "This browser can't show notifications."}</div></div>`;
  }
  if (Notification.permission === "denied") {
    return `<div class="grow">Notifications<div class="sm muted">Blocked. Turn them on in Settings > Notifications > VaultHub.</div></div>`;
  }
  const on = pushStatus === "on" && Notification.permission === "granted";
  return `<div class="grow">Notifications<div class="sm muted">New messages and calls</div></div>
    <button class="switch ${on ? "on" : ""}" data-act="${on ? "push-off" : "push-on"}" aria-label="Notifications ${on ? "on" : "off"}"><i></i></button>`;
}

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pushOn() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { render(); return toast("Notifications weren't allowed."); }
    const key = await rpcMe("lelons_push_sub", { what: "key" });
    if (!key || !key.ok || !key.key) return toast("Notifications aren't set up on VaultHub's server yet.");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.key) });
    const r = await rpcMe("lelons_push_sub", { what: "on", sub: sub.toJSON() });
    if (!r || !r.ok) throw new Error("Couldn't turn on notifications. Try again.");
    pushStatus = "on"; store.set("push", "on");
    toast("Notifications are on. You'll get new messages and calls here.");
  } catch (e) {
    toast(e.message || "Couldn't turn on notifications.");
  }
  render();
}

async function pushOff(quiet, token) {
  pushStatus = "off"; store.set("push", "off");
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      rpc("lelons_push_sub", { token: token || S.token, what: "off", sub: sub.toJSON() }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* off anyway */ }
  if (!quiet) render();
}

// On every start: tell the library this phone's push address again (it can change, or the account can).
async function pushRefresh() {
  if (pushStatus !== "on" || !("PushManager" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await rpcMe("lelons_push_sub", { what: "on", sub: sub.toJSON() });
  } catch { /* next time */ }
}

// A notification was tapped: open what it's about ("#chat=<key>", "#server=<id>" or "#call").
function openLink(link) {
  link = String(link || "");
  if (!link.startsWith("#") || link.includes("access_token=")) return;
  history.replaceState(null, "", location.pathname);
  if (link.startsWith("#chat=")) {
    const key = decodeURIComponent(link.slice(6));
    const g = key.startsWith("g:") && S.index && (S.index.groups || []).find((x) => "g:" + x.id === key);
    S.tab = "chat";
    openChat(key, g ? g.name : key || "Everyone", g ? `${g.people} people` : "");
  } else if (link.startsWith("#server=")) {
    S.tab = "chat";
    openServer(decodeURIComponent(link.slice(8)));
  } else if (link === "#call" && typeof pollCalls === "function") {
    pollCalls(100);
  }
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.open !== undefined && S.me) openLink(e.data.open); });

// ---------------------------------------------------------------- start

(function boot() {
  playerSetup();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.token && S.me) { ping(); refreshAll(); } });
  setInterval(ping, 60000);
  setInterval(() => { if (!document.hidden && S.me) refreshAll(); }, 20000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (S.token) start(); else renderLogin();
})();
