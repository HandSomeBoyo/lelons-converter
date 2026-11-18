// VaultHub on the phone: a home-screen web app that talks straight to the same Supabase
// database as the PC app (the lelons_* functions in sfx/setup.sql), with the same accounts.
"use strict";

const SUPA = "https://hjuoeiouotgaapuevflp.supabase.co";
const KEY = "sb_publishable_4cNy4W_7OjXUjGaoxXKneg_-YcdccQ2";  // the public (publishable) key, same as the PC app
const BUCKET = "lelons-sounds";
const VERSION = "phone 1.0.3";

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
  const cls = ["av", opts.small ? "s" : "", opts.square ? "sq" : ""].join(" ");
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
async function call(name, args = {}) {
  try {
    return await rpc(name, { token: S.token, ...args });
  } catch (e) {
    if (e instanceof LoggedOut) { logOut(true); }
    throw e;
  }
}

// ---------------------------------------------------------------- icons

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
  const r = await call("lelons_chat_list", { after: 0, with_user: null });
  S.index = r || {};
  firstSeen();
}

async function loadServers() {
  const r = await call("lelons_server", { what: "list", sid: null, data: {} });
  S.servers = (r && r.servers) || [];
}

async function refreshAll() {
  if (!S.token) return;
  await Promise.allSettled([loadIndex(), loadServers()]);
  if (!S.view) render();
  else renderTabsBadge();
}

let pingId = store.get("client", "");
if (!pingId) { pingId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); store.set("client", pingId); }
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
  if (token && !expired) rpc("lelons_logout", { token }).catch(() => {});
  renderLogin(expired ? "You were logged out. Log in again." : "");
}

async function start() {
  $("#app").innerHTML = '<div class="screen"><div class="spin" style="margin-top:45vh"></div></div>';
  try {
    S.me = await call("lelons_me");
  } catch (e) {
    if (!S.token) return;  // (logged out already shows the log in page)
    $("#app").innerHTML = `<div class="screen"><div class="empty" style="margin-top:30vh">${esc(e.message)}<br><br><button class="btn2" id="retry">Try again</button></div></div>`;
    $("#retry").onclick = start;
    return;
  }
  ping();
  await refreshAll();
  render();
}

// ---------------------------------------------------------------- the tabs

const TABS = [["home", "Home"], ["chat", "Chat"], ["lib", "Library"], ["live", "Live"], ["more", "More"]];

function tabsHtml() {
  const n = unreadChats().length + serverUnread();
  return `<nav class="tabs">${TABS.map(([k, name]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${I[k]}${name}${k === "chat" && n ? `<span class="badge">${n > 99 ? "99+" : n}</span>` : ""}</button>`).join("")}</nav>`;
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
  if (S.view) return S.view.kind === "chat" ? renderChat() : renderServer();
  const body = { home: homeHtml, chat: chatsHtml, lib: libHtml, live: liveHtml, more: moreHtml }[S.tab] || homeHtml;
  const scrollWas = $(".scroll") && $(".scroll").dataset.tab === S.tab ? $(".scroll").scrollTop : 0;
  $("#app").innerHTML = `<div class="screen"><div class="scroll" data-tab="${S.tab}">${body()}</div>${S.tab === "lib" ? playerHtml() : ""}</div>${tabsHtml()}`;
  $(".scroll").scrollTop = scrollWas;
  bindTabs();
  bindPage();
}

// Clicks inside a page: anything with data-open opens a chat, data-server a server, data-play a sound.
function bindPage() {
  const root = $("#app");
  root.onclick = (e) => {
    const t = e.target.closest("[data-open],[data-server],[data-play],[data-seg],[data-cat],[data-genre],[data-act]");
    if (!t) return;
    if (t.dataset.open !== undefined) return openChat(t.dataset.open, t.dataset.title, t.dataset.sub);
    if (t.dataset.server) return openServer(t.dataset.server);
    if (t.dataset.play) return playSound(t.dataset.play);
    if (t.dataset.seg) { S.chatSeg = t.dataset.seg; store.set("chatSeg", S.chatSeg); return render(); }
    if (t.dataset.cat) { S.libCat = t.dataset.cat; S.libGenre = ""; return render(); }
    if (t.dataset.genre !== undefined) { S.libGenre = t.dataset.genre; return render(); }
    if (t.dataset.act === "logout") return logOut(false);
    if (t.dataset.act === "toggle") return togglePlay();
    if (t.dataset.act === "voice") return toast("Joining voice from the phone is coming in the next step. For now, join from your PC.");
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
  const rows = [];
  for (const v of voiceNow()) {
    const p = v.channel.people;
    const first = p[0];
    rows.push(`<button class="row" data-server="${esc(v.server.id)}">${avatar(first.username, publicUrl(first.avatar), { small: true, dot: "#4da3ff" })}
      <div class="grow"><b>${esc(p.map((x) => x.username).join(", "))}</b> <span class="muted sm">in ${esc(v.channel.name)}</span><div class="sm muted">${esc(v.server.name)} voice</div></div>
      <span class="btn2 go">Open</span></button>`);
  }
  for (const u of unreadChats().slice(0, 4)) {
    rows.push(`<button class="row" data-open="${esc(u.key)}" data-title="${esc(u.name)}">${avatar(u.name, publicUrl(u.avatar), { small: true, square: u.group })}
      <div class="grow"><b>${esc(u.name)}</b><div class="sm muted one">${esc(u.text || "")}</div></div><span class="unread">new</span></button>`);
  }
  for (const s of S.servers) for (const c of s.channels || []) {
    if (c.kind === "text" && c.unread && rows.length < 7) {
      rows.push(`<button class="row" data-server="${esc(s.id)}">${avatar(s.name, publicUrl(s.picture), { small: true, square: true, letters: initials(s.name) })}
        <div class="grow"><b>${esc(s.name)}</b><div class="sm muted"># ${esc(c.name)}${c.mentions ? ` · <span style="color:var(--accent)">@ you</span>` : ""}</div></div><span class="unread">${c.unread}</span></button>`);
    }
  }
  if (!rows.length) rows.push(`<div class="muted sm" style="padding:14px 0">All caught up. Nobody is in a voice channel right now.</div>`);

  return `<div class="row between" style="margin-top:10px">
      <div class="row" style="gap:10px"><div class="av s sq" style="background:#000;border:1px solid #333;font-family:var(--head);border-radius:8px">V</div><b style="font:700 19px var(--head)">Vault<span style="font-weight:400;color:var(--muted)">Hub</span></b></div>
      ${avatar(me.username, publicUrl(me.avatar), { small: true, dot: "#b98cff" })}</div>
    <h1 style="margin-top:18px">Hey <em>${esc(me.username || "there")}</em>.</h1>
    <div class="lbl">Right now</div>
    <div class="card list">${rows.join("")}</div>
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
  return `<div class="games">${sale.slice(0, 12).map((g) => `<div class="card game">${g.info.header ? `<img src="${esc(g.info.header)}" loading="lazy" alt="">` : '<div class="ph"></div>'}
    <div><b class="sm one" style="display:block">${esc(g.info.name)}</b><div class="sm"><span class="sale">-${g.info.price.discount}%</span> <span class="muted">${esc(g.info.price.text || "")}</span></div></div></div>`).join("")}</div>`;
}

async function loadGames() {
  if (S.gamesLoading) return;
  S.gamesLoading = true;
  try {
    const r = await call("lelons_games", { what: "list" });
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
    const r = await call("lelons_server", { what: "get", sid: id, data: {} });
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
  if (!s) { $("#app").innerHTML = `<div class="screen"><div class="top"><button class="back" id="back">${I.back}</button></div><div class="spin"></div></div>`; $("#back").onclick = closeView; return; }
  const chans = s.channels || [];
  const cats = [];
  for (const c of chans) {
    const cat = c.category || (c.kind === "voice" ? "Voice" : "Chat");
    let group = cats.find((g) => g.name === cat);
    if (!group) cats.push(group = { name: cat, list: [] });
    group.list.push(c);
  }
  const online = (s.members || []).filter((m) => m.online).length;
  $("#app").innerHTML = `<div class="screen">
    <div class="top"><button class="back" id="back">${I.back}</button>${avatar(s.name, publicUrl(s.picture), { small: true, square: true, letters: initials(s.name), bg: "#1f7a4a" })}
      <div class="grow"><b class="one" style="display:block">${esc(s.name)}</b><div class="sm muted" style="margin-top:-2px">${(s.members || []).length} members · ${online} online</div></div></div>
    <div class="scroll">${cats.map((g) => `<div class="cat">${esc(g.name)}</div>${g.list.map((c) => c.kind === "voice"
      ? `<button class="chan" data-act="voice"><span class="hash">${I.speaker}</span><b>${esc(c.name)}</b></button>${(c.people || []).length ? `<div class="people">${c.people.map((p) => `<span>${avatar(p.username, publicUrl(p.avatar), { small: true })}${esc(p.username)}</span>`).join("")}</div>` : ""}`
      : `<button class="chan ${c.unread ? "new" : ""}" data-open="g:${esc(c.id)}" data-title="# ${esc(c.name)}" data-sub="${esc(s.name)}"><span class="hash">#</span><b class="grow">${esc(c.name)}</b>${c.mentions ? `<span class="unread">@</span>` : c.unread ? `<span class="unread">${c.unread}</span>` : ""}</button>`).join("")}`).join("")}
    </div></div>`;
  $("#back").onclick = closeView;
  bindPage();
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
    const r = await call("lelons_chat_list", { after: first ? 0 : v.last, with_user: v.key || null });
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
    if (first) call("lelons_chat_live", { with_user: v.key || null, seen_id: v.last || null }).catch(() => {});
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
  $("#app").innerHTML = `<div class="screen">
    <div class="top"><button class="back" id="back">${I.back}</button>
      <div class="grow"><b class="one" style="display:block">${esc(v.title)}</b>${v.sub ? `<div class="sm muted" style="margin-top:-2px">${esc(v.sub)}</div>` : ""}</div></div>
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
}

function renderMessages(error) {
  const v = S.view, el = $("#msgs");
  if (!el || !v) return;
  if (v.loading) { el.innerHTML = '<div class="spin"></div>'; return; }
  if (error) { el.innerHTML = `<div class="empty">${esc(error)}</div>`; return; }
  if (!v.messages.length) { el.innerHTML = '<div class="empty">No messages yet. Say hi!</div>'; return; }
  let prev = null;
  el.innerHTML = v.messages.map((m) => {
    const same = prev && prev.username === m.username && !m.auto && !prev.auto && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60e3;
    prev = m;
    return messageHtml(m, same);
  }).join("");
}

function messageHtml(m, same) {
  const me = S.me && lower(m.username) === lower(S.me.username);
  const pinged = S.me && !me && new RegExp(`@${escapeRe(S.me.username)}\\b`, "i").test(m.message || "");
  const name = m.auto ? "VaultHub" : m.username;
  const color = m.auto ? "var(--text)" : me ? "var(--accent)" : NAMECOLORS[hash(m.username) % NAMECOLORS.length];
  const face = m.auto ? avatar("V", "", { small: true, bg: "#000" }) : avatar(m.username, publicUrl(m.avatar), { small: true });
  const parts = [];
  if (m.reply && !m.reply.gone) parts.push(`<div class="reply">↪ ${esc(m.reply.username)}: ${esc(m.reply.message || m.reply.kind || "")}</div>`);
  if (m.message) parts.push(`<div>${formatText(m.message)}${m.edited ? ' <span class="muted sm">(edited)</span>' : ""}</div>`);
  if (m.card) parts.push(cardHtml(m.card));
  if (m.sound) parts.push(`<div class="attach snd"><button class="play" data-play="${esc(m.sound.id)}" data-url="${esc(publicUrl(m.sound.path))}" data-name="${esc(m.sound.name)}">${I.play}</button><div class="grow"><b class="sm one" style="display:block">${esc(m.sound.name)}</b><div class="sm muted">Sound from the Library</div></div></div>`);
  if (m.voice && m.file) parts.push(`<div class="attach"><audio controls preload="none" src="${esc(publicUrl(m.file))}" style="width:240px"></audio></div>`);
  else if (m.file && !m.gif) parts.push(`<div class="attach"><audio controls preload="none" src="${esc(publicUrl(m.file))}" style="width:240px"></audio><div class="sm muted">${esc(m.file_name || "Clip")}</div></div>`);
  const gif = m.gif === "@file" ? publicUrl(m.file) : m.gif && String(m.gif).startsWith("https://") ? m.gif : "";
  if (gif) parts.push(`<div class="attach"><img src="${esc(gif)}" loading="lazy" alt=""></div>`);
  if (m.sticker) parts.push(`<div class="muted sm">[sticker: ${esc(m.sticker)}]</div>`);
  if (m.poll) parts.push(`<div class="attach card" style="padding:10px 12px"><b class="sm">📊 ${esc(m.poll.q)}</b>${(m.poll.options || []).map((o, i) => { const v = (m.votes || []).find((x) => x.choice === i); return `<div class="sm row between" style="margin-top:6px"><span>${esc(o)}</span><span class="muted">${v ? v.count : 0}</span></div>`; }).join("")}<div class="sm muted" style="margin-top:6px">Vote on your PC for now</div></div>`);
  if (m.call_seconds != null) parts.push(`<div class="muted sm">📞 Call, ${Math.round(m.call_seconds / 60)} min</div>`);
  if (m.thread && m.thread.count) parts.push(`<div class="sm" style="color:var(--accent);margin-top:4px">${m.thread.count} ${m.thread.count === 1 ? "reply" : "replies"}</div>`);
  if (m.reactions && m.reactions.length) parts.push(`<div class="reacts">${m.reactions.map((r) => `<span class="${r.mine ? "mine" : ""}">${esc(r.emoji)} ${r.count}</span>`).join("")}</div>`);
  if (same && !pinged) return `<div class="msg cont"><div class="av s"></div><div class="body">${parts.join("")}</div></div>`;
  return `<div class="msg ${pinged ? "me-ping" : ""}">${face}<div class="body"><div class="n" style="color:${color}">${esc(name)}${m.auto ? '<span class="pill">AUTO</span>' : ""}<span class="t">${esc(timeOf(m.created_at))}</span></div>${parts.join("")}</div></div>`;
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
    const r = await call("lelons_chat_send", { message: text, to_user: v.key || null });
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
    S.sounds = (await call("lelons_list")) || [];
  } catch (e) { S.sounds = []; toast(e.message); }
  if (S.tab === "lib" && !S.view) render();
}

function libHtml() {
  const head = `<div class="row between"><h1>Library</h1></div>
    <div class="seg">${CATS.map(([k, n]) => `<button data-cat="${k}" class="${S.libCat === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="chips"><button data-genre="" class="${!S.libGenre ? "on" : ""}">All</button>${GENRES[S.libCat].map((g) => `<button data-genre="${esc(g)}" class="${S.libGenre === g ? "on" : ""}">${esc(g)}</button>`).join("")}</div>`;
  if (!S.sounds) { loadSounds(); return head + '<div class="spin"></div>'; }
  const list = S.sounds.filter((s) => s.category === S.libCat && (!S.libGenre || s.genre === S.libGenre));
  if (!list.length) return head + '<div class="empty">Nothing here yet.</div>';
  return head + `<div class="list">${list.map((s) => {
    const on = S.playing && S.playing.id === s.id;
    const by = s.mine ? "you" : s.uploader || "someone";
    return `<button class="row track ${on ? "on" : ""}" data-play="${esc(s.id)}"><div class="tile">${on && !$("#audio").paused ? I.pause : I.play}</div>
      <div class="grow"><b class="one" style="display:block">${esc(s.name)}</b><div class="sm muted">${esc(s.genre || CATS.find((c) => c[0] === s.category)[1])} · uploaded by ${esc(by)}</div></div>
      <span class="sm muted">${duration(s.seconds)}</span></button>`;
  }).join("")}</div>`;
}

function duration(sec) {
  sec = Math.round(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function playerHtml() {
  if (!S.playing) return "";
  const a = $("#audio");
  return `<div class="player"><div class="art"></div><div class="grow"><b class="sm one" style="display:block">${esc(S.playing.name)}</b><div class="bar"><i id="pbar"></i></div></div>
    <button class="send" data-act="toggle">${a.paused ? I.play : I.pause}</button></div>`;
}

function playSound(id) {
  const a = $("#audio");
  if (S.playing && S.playing.id === id) return togglePlay();
  let s = S.sounds && S.sounds.find((x) => x.id === id);
  if (!s) {
    const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
    if (btn && btn.dataset.url) s = { id, name: btn.dataset.name, url: btn.dataset.url };
  }
  if (!s) return;
  S.playing = { id: s.id, name: s.name };
  a.src = s.url || publicUrl(s.path);
  a.play().catch(() => toast("Couldn't play that sound."));
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: s.name, artist: s.uploader || "VaultHub" });
}

function togglePlay() {
  const a = $("#audio");
  if (a.paused) a.play().catch(() => {}); else a.pause();
}

function playingChanged() {
  if (S.tab === "lib" && !S.view) render();
  else document.querySelectorAll("[data-play]").forEach((b) => {
    if (b.classList.contains("play")) b.innerHTML = S.playing && b.dataset.play === S.playing.id && !$("#audio").paused ? I.pause : I.play;
  });
}

// ---------------------------------------------------------------- Live and More

function liveHtml() {
  return `<div class="row between"><h1>Live</h1><div class="row sm" style="gap:6px;background:#2a1d3d;color:#c9a8ff;padding:5px 10px;border-radius:14px;font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:#9146ff"></span>Twitch</div></div>
    <div class="card soon"><div style="color:#c9a8ff">${I.live.replace("<svg", '<svg width="44" height="44"')}</div>
      <div class="big">Coming next</div>
      <div class="muted">Your Twitch stream time, viewers and chat, edit title, run ads, clips and OBS scenes will show up here in the next step.</div></div>`;
}

function moreHtml() {
  const me = S.me || {};
  return `<h1>More</h1>
    <div class="card row">${avatar(me.username, publicUrl(me.avatar), { dot: "#9fd67a" })}<div class="grow"><b>${esc(me.username)}</b><div class="sm muted">${esc({ owner: "Owner", admin: "Admin" }[me.role] || "Member")}</div></div></div>
    <div class="lbl">Coming soon on the phone</div>
    <div class="card list">${["Games", "Docs", "Boards", "Film assets", "Notifications"].map((n) => `<div class="row"><div class="grow">${n}</div><span class="sm muted">Soon</span></div>`).join("")}</div>
    <div class="lbl">On your PC only</div>
    <div class="muted sm" style="padding:0 2px">Converting, Files, Images, Copyright, Resolve and Remote need your PC.</div>
    <div style="margin-top:28px"><button class="btn2" data-act="logout" style="width:100%;height:44px;color:var(--red)">Log out</button></div>
    <div class="muted sm" style="text-align:center;margin-top:18px">VaultHub for phone 1.0.3</div>
    <div class="muted" style="text-align:center;margin-top:4px;font-size:11px">${screenInfo()}</div>`;
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

// ---------------------------------------------------------------- start

(function boot() {
  const a = $("#audio");
  a.addEventListener("play", playingChanged);
  a.addEventListener("pause", playingChanged);
  a.addEventListener("ended", playingChanged);
  a.addEventListener("timeupdate", () => { const b = $("#pbar"); if (b && a.duration) b.style.width = (a.currentTime / a.duration * 100) + "%"; });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.token && S.me) { ping(); refreshAll(); } });
  setInterval(ping, 60000);
  setInterval(() => { if (!document.hidden && S.me) refreshAll(); }, 20000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (S.token) start(); else renderLogin();
})();
