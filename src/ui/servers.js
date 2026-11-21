// Servers in Chat (2.37.0): a home for a crew, with its own text and voice channels, roles, invites and
// auto-posts. Each channel is a group chat underneath ("g:<channel id>"), so replies, threads, pins, polls,
// voice messages and search all work in it. A voice channel is a group call that doesn't ring anyone.

const SRV_BANNERS = {
  sunset: "linear-gradient(135deg, #7c3aed, #db2777 55%, #f59e0b)",
  ocean: "linear-gradient(135deg, #0ea5e9, #2563eb 60%, #1e3a8a)",
  forest: "linear-gradient(135deg, #22c55e, #15803d 55%, #064e3b)",
  ember: "linear-gradient(135deg, #ef4444, #f97316 60%, #facc15)",
  grape: "linear-gradient(135deg, #c084fc, #7c3aed 55%, #312e81)",
  mint: "linear-gradient(135deg, #5eead4, #0d9488 55%, #164e63)",
  gold: "linear-gradient(135deg, #fde047, #eab308 50%, #a16207)",
  night: "linear-gradient(135deg, #475569, #1e293b 60%, #020617)",
};
const SRV_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#38bdf8", "#6366f1", "#a855f7", "#f472b6", "#94a3b8"];
const SRV_PERMS = [
  ["manage", "Manage the server", "Settings, channels, roles and auto-posts"],
  ["pin", "Pin messages", "Keep important things at the top"],
  ["delete", "Delete other people's messages", "For keeping the chat clean"],
  ["invite", "Invite people", "Invite friends and make invite codes"],
  ["kick", "Kick and ban", "Remove people from the server"],
];
const SRV_AUTO = [
  ["video", "🎬", "Someone uploads a YouTube video", "Uses the YouTube channel on their profile."],
  ["live", "🔴", "Someone goes live", "YouTube or Twitch, from the channels on their profile."],
  ["milestone", "🏆", "Someone's channel hits a subscriber milestone", "Like 1,000, 2,000 or 10,000 subscribers."],
  ["pov", "🎮", "Someone shares a POV", "A game recording on the POVs page."],
  ["sound", "🎵", "Someone adds a sound to the Library", "With a play button right in the chat."],
  ["game", "🕹️", "Someone posts a game in Games", "A game the crew might record."],
  ["recording", "🎥", "A game starts recording, or is done", "When someone moves a game to Recording or Done."],
  ["join", "👋", "Someone joins the server", "A welcome for new people."],
];
const SRV_WORDS = {
  video: "🎬 {name} just uploaded {title}! Go watch 👀",
  live: "🔴 {name} is live now: {title}",
  milestone: "🏆 {name}'s channel just hit {count} subscribers! 🎉",
  pov: "🎮 {name} shared a POV: {title}",
  sound: "🎵 {name} added a new sound: {title}",
  game: "🕹️ {name} posted a game to record: {title}",
  recording: "🎥 {name} {what} recording {title}",
  join: "👋 Welcome {name}! Say hi, everyone",
};
const SRV_TOKENS = {
  video: ["name", "title"], live: ["name", "title"], milestone: ["name", "count"], pov: ["name", "title"],
  sound: ["name", "title"], game: ["name", "title"], recording: ["name", "what", "title"], join: ["name"],
};
const SRV_TEMPLATES = [
  ["youtube", "🎬", "YouTube crew", "Clips, thumbnails, recording plans", ["# rules", "# announcements", "# general", "# clips", "# thumbnails", "🔊 Lobby", "🔊 Recording room"]],
  ["gaming", "🎮", "Gaming", "Game chat, looking for group, voice rooms", ["# rules", "# general", "# looking-for-group", "# clips", "🔊 Lobby", "🔊 Squad 1", "🔊 Squad 2"]],
  ["friends", "💬", "Just friends", "General, memes and a lobby", ["# general", "# memes", "# pictures", "🔊 Lobby"]],
  ["empty", "✏️", "Empty", "Make your own channels", ["# general", "🔊 Lobby"]],
];
const SRV_I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l7 4V6l-7 4z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
  invite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 19.5a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>',
  crown: '<svg class="srv-crown" viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="15" width="4" height="6" rx="1"/><rect x="10" y="10" width="4" height="11" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/></svg>',
  hang: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.2 13.6c4.9-4.4 12.7-4.4 17.6 0 .6.5.6 1.4.1 2l-1.6 1.6c-.5.5-1.2.5-1.7.2l-2.2-1.4c-.4-.3-.6-.8-.5-1.3l.3-1.4a11 11 0 0 0-6.4 0l.3 1.4c.1.5-.1 1-.5 1.3l-2.2 1.4c-.5.3-1.2.3-1.7-.2l-1.6-1.6c-.5-.6-.5-1.5.1-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>',
  logo: '<svg viewBox="0 0 64 64"><path fill="#fff" d="M16 18h10l6 15 6-15h10L36.5 46h-9z"/></svg>',
};

let srvList = { servers: [], asks: [], watch: [] };
let srvId = ""; // the server that's open in Chat ("" = your chats and groups)
let srv = null; // that server, as lelons_server "get" gives it
let srvHomeKey = ""; // the chat you had open before going into a server
let srvLastChannel = {}; // server id -> the channel you were in
let srvShut = new Set(); // folded categories ("<server id>/<category>")
let srvTimer = null;
let srvBusy = false;
let srvTicks = 0;
let srvUserId = null;
let srvVoice = null; // the voice channel you're in: {server, serverName, channel, name}
try { srvLastChannel = loadPref("srvChannel") || {}; srvShut = new Set(loadPref("srvShut") || []); } catch { /* (fine) */ }

const srvEl = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const srvText = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };
function srvBtn(cls, html, title, fn) {
  const b = srvEl("button", cls, html);
  b.type = "button";
  if (title) b.title = title;
  if (fn) b.addEventListener("click", (e) => { e.stopPropagation(); fn(e, b); });
  return b;
}
async function srvApi(what, server, data) {
  const res = await api("/api/sfx-server", { what, server: server || null, data: data || {} })
    .catch(() => ({ ok: false, error: "That didn't go through. Check your internet connection." }));
  if (res.ok && res.list) srvList = res.list;
  if (res.ok && res.server && res.server.id === srvId && res.server.channels) srv = res.server;
  return res;
}

// ---- what's open

function srvOn() { return !!srvId; }
function srvCan(perm) { return !!srv && (srv.perms || []).includes(perm); }
function srvChannelOf(key) {
  if (!srv || !isGroupKey(key)) return null;
  return (srv.channels || []).find((c) => "g:" + c.id === key) || null;
}
function srvChannel() { return srvChannelOf(chatWith); }
function srvInVoice(key) { return typeof callWith === "function" && callWith(key); }
// The voice channel's call is on the stage in the middle of the chat (instead of a floating window).
function srvStageHere() {
  return chatIsOpen() && !!srvVoice && callIsLive() && call.phase === "in" && lower(call.key) === lower(chatWith);
}
function srvRoleOf(username) {
  if (!srv) return null;
  const m = (srv.members || []).find((x) => lower(x.username) === lower(username));
  if (!m) return null;
  if (m.owner) return { id: "", name: "Owner", color: "#f59e0b", owner: true };
  return (srv.roles || []).find((r) => r.id === m.role) || null;
}
function srvNameColor(username) {
  if (!srvChannel()) return "";
  const r = srvRoleOf(username);
  return r && !(r.is_default && r.color === "#94a3b8") ? r.color : "";
}
function srvPic(s, cls = "") {
  const el = srvEl("span", "srv-pic " + cls);
  el.style.background = SRV_BANNERS[s.banner] || SRV_BANNERS.sunset;
  if (s.pictureUrl) {
    const img = document.createElement("img");
    img.src = s.pictureUrl;
    img.alt = "";
    el.append(img);
  } else {
    const words = String(s.name || "?").trim().split(/\s+/);
    el.textContent = (words.length > 1 ? words[0][0] + words[1][0] : String(s.name || "?").slice(0, 2)).toUpperCase();
  }
  return el;
}

// ---- the page: put the server strip, the channel list and the member list into the chat

const srvRail = srvEl("nav", "srv-rail");
srvRail.id = "srvRail";
const srvSide = srvEl("nav", "srv-side");
srvSide.id = "srvSide";
const srvMembers = srvEl("aside", "srv-members");
srvMembers.id = "srvMembers";
const srvVoiceRoom = srvEl("div", "vc-room");
srvVoiceRoom.id = "vcRoom";
srvVoiceRoom.hidden = true;
(() => {
  const panel = $("chatPanel");
  panel.prepend(srvRail);
  panel.querySelector(".chat-side").after(srvSide);
  panel.querySelector(".chat-main").after(srvMembers);
  $("chatList").before(srvVoiceRoom);
  panel.classList.add("with-rail");
})();

function srvDraw() {
  const panel = $("chatPanel");
  const on = srvOn() && !!sfxUser();
  panel.classList.toggle("srv-on", on);
  // Your name and status card goes where the side bar is.
  const me = $("chatMe");
  const side = on ? srvSide : panel.querySelector(".chat-side");
  if (me && me.parentElement !== side) side.append(me);
  srvDrawRail();
  if (on) { srvDrawSide(); srvDrawMembers(); }
  srvDrawVoiceBar();
  srvDrawVoiceRoom();
}

let srvRailDrawn = "";
function srvDrawRail() {
  const homeUnread = typeof chatPrivate !== "undefined"
    ? chatPrivate.filter((p) => unreadIn(p.username)).length + chatGroups.filter((g) => unreadIn("g:" + g.id)).length : 0;
  const sig = JSON.stringify([srvId, homeUnread, srvList, srvVoice && srvVoice.server]);
  if (sig === srvRailDrawn) return;
  srvRailDrawn = sig;
  const items = [];
  const home = srvBtn("srv-ic srv-home" + (!srvId ? " on" : ""), SRV_I.home, "Your chats: everyone, groups and private messages", () => srvGoHome());
  if (homeUnread) home.append(srvText("span", "badge", homeUnread > 9 ? "9+" : String(homeUnread)));
  items.push(home, srvEl("div", "srv-sep"));
  for (const s of srvList.servers || []) {
    const b = srvBtn("srv-ic" + (s.id === srvId ? " on" : s.unread ? " dot" : ""), "", s.name, () => srvOpen(s.id));
    b.append(srvPic(s));
    if (s.mentions && s.id !== srvId) b.append(srvText("span", "badge", s.mentions > 9 ? "9+" : String(s.mentions)));
    else if (s.voice) b.append(srvEl("span", "srv-ic-voice", SRV_I.vol));
    items.push(b);
  }
  for (const a of srvList.asks || []) {
    const b = srvBtn("srv-ic ask", "", `${a.by || "A friend"} invited you to ${a.name}`, () => srvShowAsk(a));
    b.append(srvPic(a), srvText("span", "badge new", "NEW"));
    items.push(b);
  }
  items.push(srvBtn("srv-ic srv-add", SRV_I.plus, "Make a server", () => srvCreateDialog()));
  items.push(srvBtn("srv-ic srv-find", SRV_I.find, "Join a server with an invite code", () => srvJoinDialog()));
  srvRail.replaceChildren(...items);
}

function srvCategories() {
  const cats = [];
  for (const c of (srv && srv.channels) || []) {
    let cat = cats.find((x) => x.name === (c.category || ""));
    if (!cat) cats.push(cat = { name: c.category || "", channels: [] });
    cat.channels.push(c);
  }
  return cats;
}

let srvSideDrawn = "";
function srvDrawSide() {
  if (!srv || srv.id !== srvId) {
    srvSideDrawn = "";
    const s = (srvList.servers || []).find((x) => x.id === srvId) || { name: "", banner: "sunset" };
    const banner = srvEl("div", "srv-banner");
    banner.style.background = SRV_BANNERS[s.banner] || SRV_BANNERS.sunset;
    banner.append(srvText("div", "srv-name", s.name));
    srvSide.replaceChildren(banner, srvText("p", "srv-loading", "Loading..."), ...($("chatMe") ? [$("chatMe")] : []));
    return;
  }
  const speaking = typeof callSpeaking !== "undefined" ? [...callSpeaking.entries()].filter(([, v]) => v.on).map(([k]) => k) : [];
  const sig = JSON.stringify([srv, chatWith, [...srvShut], srvVoice, callIsLive() && call.phase, callIsLive() && call.key,
    callIsLive() ? (call.people || []).map((p) => p.username + p.state) : [],
    typeof callPeers !== "undefined" ? [...callPeers.values()].map((p) => !!p.sharing).concat(!!callScreen) : []]);
  if (sig === srvSideDrawn || srvDrag) return;
  srvSideDrawn = sig;
  const online = (srv.members || []).filter((m) => m.online).length;
  const count = (srv.members || []).length;
  const banner = srvEl("div", "srv-banner");
  banner.style.background = SRV_BANNERS[srv.banner] || SRV_BANNERS.sunset;
  const name = srvBtn("srv-name", "", "Server menu", (e, b) => srvMenu(b));
  const t = srvEl("span");
  t.append(document.createTextNode(srv.name), srvText("small", "", `${count} ${count === 1 ? "member" : "members"} · ${online} online`));
  name.append(t, srvEl("span", "chev", SRV_I.down));
  banner.append(name);
  if (srv.pictureUrl) banner.append(srvPic(srv, "srv-banner-pic"));
  const chans = srvEl("div", "srv-chans");
  const tools = srvEl("div", "srv-boost");
  if (srvCan("invite")) tools.append(srvBtn("acc", SRV_I.invite + "Invite", "Invite friends to the server", () => srvInviteDialog()));
  if (srvCan("manage")) tools.append(srvBtn("", SRV_I.gear + "Settings", "Server settings", () => srvSettings("overview")));
  if (tools.childNodes.length) chans.append(tools);
  for (const cat of srvCategories()) {
    const shutKey = srv.id + "/" + cat.name;
    const shut = srvShut.has(shutKey);
    if (cat.name) {
      const head = srvBtn("srv-cat" + (shut ? " shut" : ""), SRV_I.down, shut ? "Show these channels" : "Fold these channels", () => {
        if (srvShut.has(shutKey)) srvShut.delete(shutKey); else srvShut.add(shutKey);
        savePref("srvShut", [...srvShut]);
        srvDrawSide();
      });
      head.append(srvText("span", "", cat.name));
      head.dataset.cat = cat.name;
      if (srvCan("manage")) head.append(srvBtn("plus", SRV_I.plus, "Make a channel here", () => srvChannelDialog(null, cat.name)));
      chans.append(head);
    }
    for (const c of cat.channels) {
      const key = "g:" + c.id;
      const open = key === chatWith;
      const people = c.kind === "voice" ? srvVoicePeople(c) : [];
      if (shut && !open && !people.length) continue;
      const row = srvBtn("srv-ch" + (open ? " on" : "") + (c.unread && !open ? " unread" : "") + (c.kind === "voice" ? " voice" : ""),
        c.kind === "voice" ? SRV_I.vol : '<span class="h">#</span>', c.topic || "", () => srvPick(c));
      row.append(srvText("span", "srv-ch-name", c.name));
      if (c.mentions && !open) row.append(srvText("span", "tag", c.mentions > 9 ? "9+" : String(c.mentions)));
      else if (c.private_roles) row.append(srvEl("span", "ico", SRV_I.lock));
      else if (c.read_only) row.append(srvEl("span", "ico", SRV_I.megaphone));
      if (srvCan("manage")) row.append(srvBtn("srv-ch-edit", SRV_I.gear, "Edit channel", () => srvChannelDialog(c)));
      row.dataset.ch = c.id;
      if (srvCan("manage")) row.draggable = true;
      chans.append(row);
      if (people.length) {
        const vp = srvEl("div", "srv-voice-people");
        vp.dataset.voice = c.id;
        for (const p of people) {
          const isMe = sfxUser() && lower(p.username) === lower(sfxUser().username);
          const talking = srvInVoice(key) && speaking.includes(isMe ? "" : lower(p.username));
          const row2 = srvEl("div", "srv-vp" + (talking ? " talk" : ""));
          row2.dataset.user = isMe ? "" : lower(p.username);
          row2.dataset.channel = key;
          row2.dataset.name = p.username;
          if (isMe || srvCan("kick")) { row2.draggable = true; row2.title = isMe ? "Drag yourself to another voice channel" : "Drag to move them to another voice channel"; }
          row2.append(avatarEl(p.avatarUrl, p.username), srvText("span", "", p.username));
          const peer = srvInVoice(key) && typeof callPeers !== "undefined" ? callPeers.get(lower(p.username)) : null;
          if ((peer && peer.sharing) || (isMe && srvInVoice(key) && typeof callScreen !== "undefined" && callScreen)) row2.append(srvText("span", "live", "LIVE"));
          vp.append(row2);
        }
        chans.append(vp);
      }
    }
  }
  if (srvCan("manage")) {
    const add = srvBtn("srv-add-ch", SRV_I.plus, "", () => srvChannelDialog(null, ""));
    add.append("Make a channel");
    chans.append(add);
  }
  const keep = [banner, chans];
  const bar = $("vcBar");
  if (bar) keep.push(bar);
  if ($("chatMe")) keep.push($("chatMe"));
  srvSide.replaceChildren(...keep);
  srvDrawTalking();
}

// The members list on the right: online people by role (in its color), then everyone who's offline.
let srvMembersDrawn = "";
function srvDrawMembers() {
  if (!srv || srv.id !== srvId) { srvMembers.replaceChildren(); srvMembersDrawn = ""; return; }
  const sig = JSON.stringify([srv.members, srv.roles, srv.owner, srvCan("manage"), srvCan("kick")]);
  if (sig === srvMembersDrawn) return;
  srvMembersDrawn = sig;
  const out = [];
  const group = (title, color, people, off) => {
    if (!people.length) return;
    const h = srvText("div", "srv-role", `${title} — ${people.length}`);
    if (color) h.style.color = color;
    out.push(h);
    for (const m of people) {
      const row = srvBtn("srv-mem" + (off ? " off" : ""), "", "", (e, b) => srvMemberMenu(m, b));
      row.dataset.user = sfxUser() && lower(m.username) === lower(sfxUser().username) ? "" : lower(m.username);
      const face = srvEl("span", "srv-face");
      face.append(avatarEl(m.avatarUrl, m.username));
      if (m.online && typeof modeDot === "function") face.append(modeDot(m, "on-face"));
      const text = srvEl("span", "srv-mem-text");
      const b = srvText("b", "", m.username);
      const r = srvRoleOf(m.username);
      if (r && !off && !(r.is_default && r.color === "#94a3b8")) b.style.color = r.color;
      if (m.owner) b.insertAdjacentHTML("beforeend", SRV_I.crown);
      text.append(b);
      const sub = m.online && typeof modeText === "function" ? modeText(m) : "";
      if (sub) text.append(srvText("small", "", sub));
      row.append(face, text);
      out.push(row);
    }
  };
  const online = (srv.members || []).filter((m) => m.online);
  group("Owner", "#f59e0b", online.filter((m) => m.owner));
  for (const r of srv.roles || []) group(r.name, r.is_default && r.color === "#94a3b8" ? "" : r.color, online.filter((m) => !m.owner && m.role === r.id));
  group("Offline", "", (srv.members || []).filter((m) => !m.online), true);
  srvMembers.replaceChildren(...out);
  srvDrawTalking();
}

// ---- going into a server, a channel, or back home

function srvGoHome() {
  if (!srvId) return;
  srvId = "";
  savePref("srvOpen", "");
  srv = null;
  srvDraw();
  switchChat(srvHomeKey || "");
  roomDrawn = "";
  drawRoom();
}

async function srvOpen(id, channelId) {
  if (!srvId) srvHomeKey = chatWith;
  if (srvId !== id) { srvId = id; srv = null; srvSideDrawn = srvMembersDrawn = ""; savePref("srvOpen", id); }
  srvDraw();
  const res = await srvApi("get", id);
  if (srvId !== id) return;
  if (!res.ok) { srvId = ""; srv = null; srvDraw(); return srvSay(res.error); }
  srv = res.server;
  const want = channelId || srvLastChannel[id];
  const text = (srv.channels || []).filter((c) => c.kind === "text");
  const ch = (srv.channels || []).find((c) => c.id === want) || text.find((c) => !c.read_only) || text[0];
  if (ch && chatWith !== "g:" + ch.id) switchChat("g:" + ch.id);
  srvDraw();
  roomDrawn = "";
  drawRoom();
  srvPoll(4000);
}

function srvPick(c) {
  srvLastChannel = { ...srvLastChannel, [srv.id]: c.id };
  savePref("srvChannel", srvLastChannel);
  const key = "g:" + c.id;
  if (key !== chatWith) switchChat(key);
  // A voice channel: click it and you're in (no ringing).
  if (c.kind === "voice" && !srvInVoice(key)) srvJoinVoice(c);
  srvDraw();
  if (c.kind === "text") $("chatInput").focus();
}

// Who's in a voice channel. The server's list is a few seconds behind, so your own call fills in the
// channel you're in right away: you show up when you join and go away the moment you (or a friend) leave.
function srvVoicePeople(c) {
  const me = sfxUser() ? lower(sfxUser().username) : "";
  const here = callIsLive() && call.phase !== "ended" && lower(call.key) === lower("g:" + c.id);
  let people = (c.people || []).filter((p) => lower(p.username) !== me);
  if (here) {
    const inCall = (call.people || []).filter((p) => p.state === "in" && lower(p.username) !== me);
    if (call.people && call.people.length) people = people.filter((p) => inCall.some((x) => lower(x.username) === lower(p.username)));
    for (const x of inCall) if (!people.some((p) => lower(p.username) === lower(x.username))) people.push(x);
    const u = sfxUser();
    people.unshift((c.people || []).find((p) => lower(p.username) === me) || { username: u.username, avatarUrl: u.avatarUrl || "" });
  }
  return people;
}

// ---- dragging (like Discord): channels to a new spot, and people (you, or anyone if you may move members)
// into another voice channel.
let srvDrag = null; // {kind: "ch", id} or {kind: "user", name, me, from}
function srvDropMark(el, where) {
  for (const x of srvSide.querySelectorAll(".drop-before, .drop-after, .drop-in")) x.classList.remove("drop-before", "drop-after", "drop-in");
  if (el && where) el.classList.add("drop-" + where);
}
// Where a drop would land: {el, where, ...}, or null.
function srvDropAt(target, y) {
  if (!srvDrag || !srv) return null;
  if (srvDrag.kind === "ch") {
    const row = target.closest(".srv-ch[data-ch]");
    if (row && row.dataset.ch !== srvDrag.id) {
      const r = row.getBoundingClientRect();
      return { el: row, where: y < r.top + r.height / 2 ? "before" : "after", ch: row.dataset.ch };
    }
    const head = target.closest(".srv-cat[data-cat]");
    if (head) return { el: head, where: "in", cat: head.dataset.cat };
    return null;
  }
  const vp = target.closest(".srv-voice-people[data-voice]");
  const row = vp ? null : target.closest(".srv-ch.voice[data-ch]");
  const id = vp ? vp.dataset.voice : row ? row.dataset.ch : "";
  if (!id || id === srvDrag.from) return null;
  return { el: row || vp.previousElementSibling, where: "in", voice: id };
}
srvSide.addEventListener("dragstart", (e) => {
  const vp = e.target.closest && e.target.closest(".srv-vp[draggable=true]");
  const ch = !vp && e.target.closest && e.target.closest(".srv-ch[data-ch][draggable=true]");
  if (vp) srvDrag = { kind: "user", name: vp.dataset.name, me: vp.dataset.user === "", from: lower(vp.dataset.channel).slice(2) };
  else if (ch) srvDrag = { kind: "ch", id: ch.dataset.ch };
  else return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", vp ? vp.dataset.name : ch.dataset.ch);
  (vp || ch).classList.add("dragging");
});
srvSide.addEventListener("dragover", (e) => {
  const at = srvDropAt(e.target, e.clientY);
  if (!at) return srvDropMark(null);
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  srvDropMark(at.el, at.where);
});
srvSide.addEventListener("dragleave", (e) => { if (!srvSide.contains(e.relatedTarget)) srvDropMark(null); });
srvSide.addEventListener("drop", (e) => {
  const at = srvDropAt(e.target, e.clientY);
  const drag = srvDrag;
  srvDragDone();
  if (!at || !drag) return;
  e.preventDefault();
  if (drag.kind === "ch") srvMoveChannel(drag.id, at);
  else srvMovePerson(drag, at.voice);
});
srvSide.addEventListener("dragend", () => srvDragDone());
function srvDragDone() {
  srvDrag = null;
  srvDropMark(null);
  srvSideDrawn = "";
  srvDrawSide();
}

// A channel dropped before/after another one, or onto a category (it goes to the end of it).
async function srvMoveChannel(id, at) {
  const chans = (srv.channels || []).slice();
  const moving = chans.find((c) => c.id === id);
  if (!moving) return;
  chans.splice(chans.indexOf(moving), 1);
  let category = moving.category || "";
  let i;
  if (at.ch) {
    const other = chans.find((c) => c.id === at.ch);
    category = other.category || "";
    i = chans.indexOf(other) + (at.where === "after" ? 1 : 0);
  } else {
    category = at.cat;
    const last = chans.map((c) => c.category || "").lastIndexOf(category);
    i = last + 1;
  }
  chans.splice(i, 0, { ...moving, category });
  // (channels of one category stay together, in the order their categories first show up)
  const order = [...new Set(chans.map((c) => c.category || ""))];
  chans.sort((a, b) => order.indexOf(a.category || "") - order.indexOf(b.category || ""));
  const before = srv.channels;
  srv = { ...srv, channels: chans };
  srvSideDrawn = "";
  srvDraw();
  const res = await srvApi("channel_order", srv.id, { ids: chans.map((c) => ({ id: c.id, category: c.category || "" })) });
  if (!res.ok) { srv = { ...srv, channels: before }; srvSideDrawn = ""; srvDraw(); }
}

// You (or someone else, if you may move members) dropped into another voice channel.
async function srvMovePerson(drag, channelId) {
  const c = (srv.channels || []).find((x) => x.id === channelId && x.kind === "voice");
  if (!c) return;
  if (drag.me) return srvJoinVoice(c, true);
  // (shown there right away; the next check puts the real list back)
  const from = (srv.channels || []).find((x) => x.id === drag.from);
  const person = from && (from.people || []).find((p) => lower(p.username) === lower(drag.name));
  if (person) {
    from.people = from.people.filter((p) => p !== person);
    c.people = [...(c.people || []), person];
    if (callIsLive() && call.people) for (const p of call.people) if (lower(p.username) === lower(drag.name) && lower(call.key) === lower("g:" + from.id)) p.state = "left";
    srvSideDrawn = "";
    srvDraw();
  }
  await srvApi("move", srv.id, { username: drag.name, channel: c.id });
  srvPoll(1200);
}

// Someone moved you to another voice channel (call.js sees it at its next check).
async function srvMovedTo(channelId, by) {
  if (callIsLive() && lower(call.key) === lower("g:" + channelId)) return;
  let s = srv && (srv.channels || []).some((c) => c.id === channelId) ? srv : null;
  if (!s && srvVoice) {
    const res = await api("/api/sfx-server", { what: "get", server: srvVoice.server }).catch(() => null);
    if (res && res.ok && res.server) s = res.server;
  }
  const c = s && (s.channels || []).find((x) => x.id === channelId && x.kind === "voice");
  if (!c) return;
  srvJoinVoice(c, true, s);
  const note = $("chatNote");
  if (by && note && chatIsOpen()) note.textContent = `${by} moved you to ${c.name}.`;
}

function srvJoinVoice(c, quiet = false, s = srv) {
  if (callIsLive() && call.phase !== "incoming" && !callWith("g:" + c.id)) {
    if (!quiet && !confirm("Leave the call you're in and join " + c.name + "?")) return;
    callHangUp("");
  }
  srvVoice = { server: s.id, serverName: s.name, channel: c.id, name: c.name };
  callStart("g:" + c.id);
  setTimeout(() => srvPoll(600), 800);
}

// The green ring on whoever's talking in your call (like Discord): in the voice channel list, the members
// list and on your own name card. Called by call.js many times a second, so it only flips classes.
function srvDrawTalking() {
  const live = callIsLive() && call.phase === "in";
  const on = (key) => live && !!(callSpeaking.get(key) || {}).on
    && !(key === "" ? callMuted || callDeafened : (callPeers.get(key) || {}).muted);
  const inCall = (key) => key === "" || callPeers.has(key);
  for (const el of document.querySelectorAll(".srv-vp[data-user]")) el.classList.toggle("talk", live && lower(el.dataset.channel) === lower(call.key) && on(el.dataset.user));
  for (const el of document.querySelectorAll(".srv-mem[data-user]")) el.classList.toggle("talk", inCall(el.dataset.user) && on(el.dataset.user));
  const me = $("chatMe");
  if (me) me.classList.toggle("talking", on(""));
}

// Called by chat.js when another chat opens.
function srvChatSwitched() {
  srvDraw();
  if (typeof drawCall === "function") drawCall();
}

// ---- the top of a channel, and the box you write in

let srvRoomDrawn = "";
function srvRoomHead() {
  const c = srvChannel();
  if (!c) { srvRoomDrawn = ""; return false; }
  const inVoice = srvInVoice(chatWith);
  const sig = JSON.stringify([c.id, c.name, c.topic, c.kind, c.read_only, srvVoicePeople(c).length, inVoice, chatPinCount, chatPane && chatPane.kind]);
  if (sig === srvRoomDrawn) return true;
  srvRoomDrawn = sig;
  roomDrawn = "srv";
  const head = srvEl("div", "srv-room");
  head.append(srvEl("span", "hash" + (c.kind === "voice" ? " vc" : ""), c.kind === "voice" ? SRV_I.vol : "#"));
  const t = srvEl("span", "srv-room-text");
  t.append(srvText("b", "", c.name));
  const n = c.kind === "voice" ? srvVoicePeople(c).length : 0;
  const sub = c.kind === "voice" ? (n ? `${n} in here` : "Nobody's here yet. Click Join to hang out.") : c.topic;
  if (sub) t.append(srvText("small", "", sub));
  head.append(t);
  $("chatRoom").replaceChildren(head);
  const tools = [];
  if (c.kind === "text") tools.push(...chatRoomButtons());
  if (c.kind === "voice") {
    const b = srvBtn("call-start" + (inVoice ? " leave" : ""), inVoice ? SRV_I.hang : CALL_ICONS.phone, inVoice ? "Leave the voice channel" : "Join the voice channel",
      () => (inVoice ? callHangUp("") : srvJoinVoice(c)));
    b.append(document.createTextNode(inVoice ? "Leave" : "Join voice"));
    tools.push(b);
  }
  $("chatRoomTools").replaceChildren(...tools);
  return true;
}

// Who can write here: read-only channels are for people who can manage the server; voice channels have no box.
function srvDrawForm() {
  const c = srvChannel();
  const main = $("chatPanel").querySelector(".chat-main");
  main.classList.toggle("vc-view", !!c && c.kind === "voice");
  if (!c) { $("chatForm").classList.remove("srv-locked"); $("chatInput").disabled = false; return; }
  const locked = c.kind === "text" && c.read_only && !srvCan("manage");
  $("chatForm").classList.toggle("srv-locked", locked);
  $("chatInput").disabled = locked;
  $("chatInput").placeholder = locked ? `Only the people who run ${srv.name} post in #${c.name}.` : `Message #${c.name}`;
}

// ---- voice: the bar above your name while you're in a voice channel, and the room in the middle

function srvDrawVoiceBar() {
  let bar = $("vcBar");
  const live = srvVoice && callIsLive() && call.phase !== "ended" && lower(call.key) === lower("g:" + srvVoice.channel);
  if (!live) { if (bar) bar.remove(); if (srvVoice && (!callIsLive() || lower(call.key) !== lower("g:" + srvVoice.channel))) srvVoice = null; return; }
  if (!bar) {
    bar = srvEl("div", "vc-bar");
    bar.id = "vcBar";
  }
  const sig = JSON.stringify([srvVoice, call.phase]);
  if (bar.dataset.sig !== sig) {
    bar.dataset.sig = sig;
    const text = srvBtn("vc-text", "", "Go to the voice channel", () => {
      if (srvId !== srvVoice.server) srvOpen(srvVoice.server, srvVoice.channel);
      else if (chatWith !== "g:" + srvVoice.channel) switchChat("g:" + srvVoice.channel);
    });
    text.append(srvText("b", "", call.phase === "in" ? "Voice connected" : "Connecting..."), srvText("small", "", `${srvVoice.name} / ${srvVoice.serverName}`));
    bar.replaceChildren(srvEl("span", "vc-sig", SRV_I.bars), text, srvBtn("vc-hang", SRV_I.hang, "Leave the voice channel", () => callHangUp("")));
  }
  const me = $("chatMe");
  const side = srvOn() ? srvSide : $("chatPanel").querySelector(".chat-side");
  if (me && me.parentElement === side) { if (me.previousElementSibling !== bar) me.before(bar); } else if (bar.parentElement !== side) side.append(bar);
}

// A voice channel you aren't in: who's there and a big Join button. (When you're in, call.js puts the call here.)
let srvVoiceDrawn = "";
function srvDrawVoiceRoom() {
  const c = srvChannel();
  const show = !!c && c.kind === "voice";
  srvVoiceRoom.hidden = !show;
  if (!show) { srvVoiceDrawn = ""; return; }
  const here = srvStageHere();
  srvVoiceRoom.classList.toggle("live", here);
  const sig = JSON.stringify([c.id, c.name, srvVoicePeople(c), here, callIsLive() && call.phase]);
  if (sig === srvVoiceDrawn) return;
  srvVoiceDrawn = sig;
  const stage = $("callStage");
  if (here) {
    // (call.js moves the stage in here; keep it)
    [...srvVoiceRoom.children].forEach((x) => { if (x !== stage) x.remove(); });
    return;
  }
  const box = srvEl("div", "vc-join");
  box.append(srvEl("span", "vc-join-ico", SRV_I.vol), srvText("h3", "", c.name));
  const people = srvVoicePeople(c);
  if (people.length) {
    const faces = srvEl("div", "vc-join-faces");
    for (const p of people.slice(0, 8)) faces.append(avatarEl(p.avatarUrl, p.username));
    box.append(faces, srvText("p", "", people.map((p) => p.username).join(", ") + (people.length === 1 ? " is here." : " are here.")));
  } else {
    box.append(srvText("p", "", "Nobody's here yet. Jump in and friends can join you any time."));
  }
  const joining = callIsLive() && lower(call.key) === lower(chatWith) && call.phase !== "in";
  const join = srvBtn("small-button", "", "", () => srvJoinVoice(c));
  join.textContent = joining ? "Joining..." : "Join voice";
  join.disabled = joining;
  box.append(join);
  [...srvVoiceRoom.children].forEach((x) => { if (x !== stage) x.remove(); });
  srvVoiceRoom.append(box);
}

// ---- auto-posts in the chat: from "VaultHub", with a card

function srvBotFace() {
  return srvEl("span", "avatar ap-bot", SRV_I.logo);
}
function srvCardEl(card) {
  if (!card || typeof card !== "object") return null;
  if ((card.kind === "video" || card.kind === "live") && card.url) {
    const yt = /youtube\.com|youtu\.be/.test(card.url);
    const id = yt ? (card.url.match(/[?&]v=([\w-]{11})/) || [])[1] : "";
    return linkCardEl({
      kind: yt ? "youtube" : "link", id, url: card.url, thumb: card.thumb, title: card.title || card.url,
      author: card.channel || "", site: yt ? "YouTube" : /twitch\.tv/.test(card.url) ? "Twitch" : "", text: card.kind === "live" ? "Live now" : "",
    });
  }
  if (card.kind === "pov" || card.kind === "game") {
    const box = srvEl("div", "chat-card ap-card k-" + card.kind);
    const text = srvEl("div", "chat-card-text");
    text.append(srvText("small", "chat-card-site", card.kind === "pov" ? "POV" : "Games"), srvText("b", "", card.title || card.name || ""));
    if (card.kind === "pov" && (card.game || card.seconds)) {
      const mins = card.seconds ? Math.max(1, Math.round(card.seconds / 60)) + " min" : "";
      text.append(srvText("span", "", [card.game, mins].filter(Boolean).join(" · ")));
    }
    const go = srvBtn("link", "", "", () => { closeChat(); showTab(card.kind === "pov" ? "povs" : "games"); });
    go.textContent = card.kind === "pov" ? "Open in POVs" : "Open in Games";
    text.append(go);
    box.append(text);
    if (card.header) {
      const img = document.createElement("img");
      img.className = "chat-card-thumb";
      img.src = card.header;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.remove());
      box.append(img);
    }
    return box;
  }
  return null;
}

// ---- dialogs

const srvModal = srvEl("div", "modal srv-modal");
srvModal.id = "srvModal";
srvModal.hidden = true;
document.body.append(srvModal);
srvModal.addEventListener("mousedown", (e) => { if (e.target === srvModal) srvClose(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !srvModal.hidden) { e.stopPropagation(); srvClose(); } }, true);
function srvShowModal(dialog, wide) {
  srvModal.classList.toggle("srv-set", !!wide);
  srvModal.replaceChildren(dialog);
  srvModal.hidden = false;
}
function srvClose() { srvModal.hidden = true; srvModal.replaceChildren(); srvSettingsTab = null; }
function srvSay(text) {
  if (!text) return;
  if (chatIsOpen()) $("chatNote").textContent = text;
}
function srvDialog(title, cls = "") {
  const d = srvEl("div", "dialog srv-dialog " + cls);
  d.setAttribute("role", "dialog");
  if (title) d.append(srvText("h2", "", title));
  return d;
}
function srvInput(value, placeholder, max) {
  const label = srvEl("label", "input");
  const input = document.createElement("input");
  input.value = value || "";
  input.placeholder = placeholder || "";
  input.maxLength = max || 50;
  input.autocomplete = "off";
  label.append(input);
  return [label, input];
}
function srvActions(...buttons) {
  const row = srvEl("div", "dialog-actions");
  row.append(srvEl("span", "spacer"), ...buttons);
  return row;
}
function srvButton(cls, text, fn) {
  const b = srvBtn(cls, "", "", fn);
  b.textContent = text;
  return b;
}
function srvSwitch(on, fn) {
  const b = srvBtn("srv-sw" + (on ? " on" : ""), "", "", () => { b.classList.toggle("on"); fn(b.classList.contains("on")); });
  b.setAttribute("role", "switch");
  return b;
}

// Make a server: a name, a picture color and what it starts with.
function srvCreateDialog() {
  if (!sfxUser()) return openLogin("login");
  const d = srvDialog("Make a server");
  d.append(srvText("p", "srv-hint top", "A server is a home for your crew, with its own channels, voice rooms and roles. Only people you invite can find it."));
  let pick = "youtube";
  let banner = Object.keys(SRV_BANNERS)[Math.floor(Math.random() * 6)];
  const top = srvEl("div", "srv-top");
  const pic = srvEl("span", "srv-pic big");
  const [label, input] = srvInput(sfxUser() ? `${sfxUser().username}'s crew` : "", "Server name", 50);
  top.append(pic, label);
  const colors = srvEl("div", "srv-banners");
  const drawColors = () => colors.replaceChildren(...Object.entries(SRV_BANNERS).map(([k, bg]) => {
    const b = srvBtn("srv-banner-dot" + (k === banner ? " on" : ""), "", "Pick this color", () => { banner = k; drawColors(); redraw(); });
    b.style.background = bg;
    return b;
  }));
  const temps = srvEl("div", "srv-temps");
  const preview = srvEl("div", "srv-preview");
  const redraw = () => {
    const now = top.firstChild;
    now.replaceWith(srvPic({ name: input.value || "?", banner }, "big"));
    temps.replaceChildren(...SRV_TEMPLATES.map(([key, e, name, sub]) => {
      const b = srvBtn("srv-temp" + (key === pick ? " on" : ""), "", "", () => { pick = key; redraw(); });
      b.append(srvText("span", "e", e));
      const t = srvEl("span");
      t.append(srvText("b", "", name), srvText("small", "", sub));
      b.append(t);
      return b;
    }));
    const chosen = SRV_TEMPLATES.find((t) => t[0] === pick);
    preview.replaceChildren(document.createTextNode("You get: "));
    chosen[4].forEach((c, i) => { if (i) preview.append(" · "); preview.append(srvText("b", "", c)); });
  };
  input.addEventListener("input", redraw);
  const note = srvEl("p", "group-note");
  const make = srvButton("small-button", "Make server", async () => {
    make.disabled = true;
    note.textContent = "";
    const res = await srvApi("create", null, { name: input.value, template: pick, banner });
    make.disabled = false;
    if (!res.ok) { note.textContent = res.error; return; }
    srvClose();
    await srvOpen(res.id);
    srvInviteDialog(true);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") make.click(); });
  d.append(top, colors, srvText("h4", "group-label", "Start from"), temps, preview,
    srvText("p", "srv-hint", "You can change everything later. Next you'll get an invite to send your friends."), note,
    srvActions(srvButton("ghost-button", "Cancel", srvClose), make));
  drawColors();
  redraw();
  srvShowModal(d);
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

// Join with a code: look first (name, how many people), then join.
function srvJoinDialog(code0) {
  if (!sfxUser()) return openLogin("login");
  const d = srvDialog("Join a server");
  d.append(srvText("p", "srv-hint top", "Paste the invite code a friend sent you. It looks like LELON-CREW-8K2Q."));
  const [label, input] = srvInput(code0 || "", "Invite code", 40);
  input.classList.add("mono");
  const found = srvEl("div", "srv-found");
  const note = srvEl("p", "group-note");
  let seen = null;
  const join = srvButton("small-button", "Look it up", async () => {
    note.textContent = "";
    const code = input.value.trim();
    if (!code) return input.focus();
    join.disabled = true;
    if (!seen) {
      const res = await srvApi("preview", null, { code });
      join.disabled = false;
      if (!res.ok) { note.textContent = res.error; return; }
      seen = res.server;
      if (seen.joined) { srvClose(); return srvOpen(seen.id); }
      found.replaceChildren(srvPic(seen, "big"));
      const t = srvEl("div");
      t.append(srvText("b", "", seen.name), srvText("small", "", `${seen.members} ${seen.members === 1 ? "member" : "members"} · ${seen.online} online`));
      if (seen.about) t.append(srvText("p", "", seen.about));
      found.append(t);
      join.textContent = "Join server";
      return;
    }
    const res = await srvApi("join", seen.id, { code });
    join.disabled = false;
    if (!res.ok) { note.textContent = res.error; return; }
    srvClose();
    srvOpen(res.id || seen.id);
  });
  input.addEventListener("input", () => { seen = null; found.replaceChildren(); join.textContent = "Look it up"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") join.click(); });
  d.append(label, found, note, srvActions(srvButton("ghost-button", "Cancel", srvClose), join));
  srvShowModal(d);
  setTimeout(() => input.focus(), 30);
  if (code0) join.click();
}

// A friend invited you by name.
function srvShowAsk(a) {
  const d = srvDialog("");
  const found = srvEl("div", "srv-found");
  found.append(srvPic(a, "big"));
  const t = srvEl("div");
  t.append(srvText("b", "", a.name), srvText("small", "", `${a.by || "A friend"} invited you · ${a.members} ${a.members === 1 ? "member" : "members"}`));
  found.append(t);
  const note = srvEl("p", "group-note");
  const join = srvButton("small-button", "Join server", async () => {
    const res = await srvApi("join", a.id, {});
    if (!res.ok) { note.textContent = res.error; return; }
    srvClose();
    srvOpen(a.id);
  });
  const no = srvButton("ghost-button", "No thanks", async () => {
    await srvApi("decline", a.id, {});
    srvClose();
    srvDraw();
  });
  d.append(srvText("h2", "", "You're invited"), found, note, srvActions(no, join));
  srvShowModal(d);
}

// Invite friends: by name (it shows up in their app), or with a code anyone can paste.
async function srvInviteDialog(fresh) {
  if (!srv || !srvCan("invite")) return;
  const d = srvDialog(`Invite friends to ${srv.name}`);
  if (fresh) d.append(srvText("p", "srv-hint top", "Your server is ready! Invite the crew."));
  const [label, search] = srvInput("", "Search names", 40);
  const list = srvEl("div", "srv-friends");
  const asked = new Set(((srv.asked || [])).map(lower));
  const members = new Set((srv.members || []).map((m) => lower(m.username)));
  const known = () => {
    const names = new Map();
    for (const p of (typeof chatPrivate !== "undefined" ? chatPrivate : [])) names.set(lower(p.username), p);
    for (const p of ((onlineInfo && onlineInfo.people) || [])) if (!names.has(lower(p.username))) names.set(lower(p.username), p);
    const q = lower(search.value.trim());
    if (q) for (const n of chatNames || []) if (lower(n).includes(q) && !names.has(lower(n))) names.set(lower(n), { username: n });
    return [...names.values()].filter((p) => !members.has(lower(p.username)) && (!q || lower(p.username).includes(q))).slice(0, 30);
  };
  const draw = () => {
    const people = known();
    if (!people.length) list.replaceChildren(srvText("p", "srv-hint", search.value ? "Nobody by that name (or they're in already)." : "Search for a friend's name."));
    else list.replaceChildren(...people.map((p) => {
      const row = srvEl("div", "srv-friend");
      const sent = asked.has(lower(p.username));
      const b = srvButton(sent ? "ghost-button" : "small-button", sent ? "Invited ✓" : "Invite", async () => {
        if (asked.has(lower(p.username))) return;
        b.disabled = true;
        const res = await srvApi("invite_friend", srv.id, { username: p.username });
        b.disabled = false;
        if (!res.ok) { note.textContent = res.error; return; }
        asked.add(lower(p.username));
        draw();
      });
      row.append(avatarEl(p.avatarUrl || "", p.username), srvText("b", "", p.username), b);
      return row;
    }));
  };
  search.addEventListener("input", draw);
  const note = srvEl("p", "group-note");
  const codeBox = srvEl("div", "srv-code");
  const codeText = srvText("span", "", "Making a code...");
  const copy = srvButton("small-button", "Copy", async () => {
    try { await navigator.clipboard.writeText(codeText.textContent); copy.textContent = "Copied ✓"; setTimeout(() => { copy.textContent = "Copy"; }, 1600); } catch { /* (fine) */ }
  });
  codeBox.append(codeText, copy);
  let days = 7, uses = 10;
  const opts = srvEl("div", "srv-opts");
  const makeCode = async () => {
    copy.disabled = true;
    const res = await srvApi("invite_code", srv.id, { days, uses });
    copy.disabled = false;
    if (!res.ok) { codeText.textContent = "—"; note.textContent = res.error; return; }
    codeText.textContent = res.code;
  };
  const chip = (values, now, label, set) => {
    const sel = document.createElement("select");
    sel.className = "chip";
    for (const [v, t] of values) sel.append(new Option(t, v, false, v === now));
    sel.title = label;
    sel.addEventListener("change", () => { set(+sel.value); makeCode(); });
    return sel;
  };
  opts.append("Works for ", chip([[1, "1 day"], [7, "7 days"], [30, "30 days"], [0, "ever"]], days, "How long it works", (v) => { days = v; }),
    " · up to ", chip([[1, "1 person"], [5, "5 people"], [10, "10 people"], [50, "50 people"], [0, "anyone"]], uses, "How many people can use it", (v) => { uses = v; }));
  d.append(srvText("h4", "group-label", "Your VaultHub friends"), label, list,
    srvText("h4", "group-label", "Or send an invite code"), codeBox, opts,
    srvText("p", "srv-hint", "Friends paste the code with the compass button on the left. Nobody else can find your server."), note,
    srvActions(srvButton("small-button", "Done", srvClose)));
  draw();
  srvShowModal(d);
  makeCode();
}

// The server menu (click its name): invite, settings, a channel, leave or delete.
function srvMenu(anchor) {
  const items = [];
  if (srvCan("invite")) items.push(["Invite people", () => srvInviteDialog()]);
  if (srvCan("manage")) items.push(["Server settings", () => srvSettings("overview")], ["Make a channel", () => srvChannelDialog(null, "")], ["Auto-posts", () => srvSettings("auto")]);
  if (srv.perms.includes("owner")) items.push(["Delete server", () => srvSettings("delete"), "red"]);
  else items.push(["Leave server", srvLeave, "red"]);
  srvPopMenu(anchor, items);
}
function srvMemberMenu(m, anchor) {
  const items = [["See profile", () => openProfile(m.username)]];
  const me = sfxUser();
  const isMe = me && lower(me.username) === lower(m.username);
  if (!isMe && !m.owner && srvCan("manage")) {
    for (const r of srv.roles || []) {
      items.push([(m.role === r.id ? "✓ " : "") + "Role: " + r.name, async () => {
        const res = await srvApi("member_role", srv.id, { username: m.username, role: r.id });
        if (!res.ok) srvSay(res.error);
        srvDraw();
      }]);
    }
  }
  if (!isMe && !m.owner && srvCan("kick")) {
    items.push([`Kick ${m.username}`, () => srvKick(m.username, false), "red"], [`Ban ${m.username}`, () => srvKick(m.username, true), "red"]);
  }
  if (items.length === 1) return openProfile(m.username);
  srvPopMenu(anchor, items);
}
async function srvKick(username, ban) {
  if (!confirm(ban ? `Ban ${username}? They're removed and can't join again until you unban them.` : `Kick ${username} out of ${srv.name}? They can come back with an invite.`)) return;
  const res = await srvApi(ban ? "ban" : "kick", srv.id, { username });
  if (!res.ok) return srvSay(res.error);
  srvDraw();
  if (srvSettingsTab) srvSettings(srvSettingsTab);
}
async function srvLeave() {
  if (!confirm(`Leave ${srv.name}? You can come back with an invite.`)) return;
  if (srvVoice && srvVoice.server === srv.id) callHangUp("");
  const res = await srvApi("leave", srv.id, {});
  if (!res.ok) return srvSay(res.error);
  srvGoHome();
  srvLoadList();
}
let srvMenuEl = null;
function srvPopMenu(anchor, items) {
  srvCloseMenu();
  const menu = srvEl("div", "srv-menu");
  for (const [label, fn, cls] of items) menu.append(srvButton(cls || "", label, () => { srvCloseMenu(); fn(); }));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = Math.max(220, menu.offsetWidth);
  menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
  const top = r.bottom + 6;
  menu.style.top = (top + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 6) : top) + "px";
  srvMenuEl = menu;
  setTimeout(() => document.addEventListener("mousedown", srvMenuAway, true), 0);
}
function srvMenuAway(e) { if (srvMenuEl && !srvMenuEl.contains(e.target)) srvCloseMenu(); }
function srvCloseMenu() {
  document.removeEventListener("mousedown", srvMenuAway, true);
  if (srvMenuEl) srvMenuEl.remove();
  srvMenuEl = null;
}

// Make or change a channel.
function srvChannelDialog(c, category) {
  if (!srvCan("manage")) return;
  const d = srvDialog(c ? `#${c.name}` : "Make a channel");
  let kind = c ? c.kind : "text";
  const kinds = srvEl("div", "srv-kinds");
  const drawKinds = () => kinds.replaceChildren(...[["text", "#", "Text", "Messages, pictures, clips and polls"], ["voice", SRV_I.vol, "Voice", "Hang out and talk, share your screen"]].map(([k, ico, name, sub]) => {
    const b = srvBtn("srv-temp" + (k === kind ? " on" : ""), "", "", () => { if (!c) { kind = k; drawKinds(); onlyText(); } });
    b.append(srvEl("span", "e", ico));
    const t = srvEl("span");
    t.append(srvText("b", "", name), srvText("small", "", sub));
    b.append(t);
    b.disabled = !!c && k !== kind;
    return b;
  }));
  const [nameL, name] = srvInput(c ? c.name : "", "new-channel", 50);
  const [topicL, topic] = srvInput(c ? c.topic : "", "What it's for (shows at the top)", 120);
  const cats = [...new Set((srv.channels || []).map((x) => x.category || ""))].filter(Boolean);
  const [catL, cat] = srvInput(c ? c.category : category || "", "Category, like Chat or Voice", 30);
  const dl = document.createElement("datalist");
  dl.id = "srvCats";
  for (const x of cats) dl.append(new Option(x));
  cat.setAttribute("list", "srvCats");
  let readOnly = c ? !!c.read_only : false;
  let priv = new Set((c && c.private_roles) || []);
  const ro = srvEl("div", "srv-perm");
  const roText = srvEl("span");
  roText.append(srvText("b", "", "Only admins post"), srvText("small", "", "Everyone reads it. Good for rules and announcements."));
  ro.append(roText, srvSwitch(readOnly, (on) => { readOnly = on; }));
  const pr = srvEl("div", "srv-perm");
  const prText = srvEl("span");
  prText.append(srvText("b", "", "Private channel"), srvText("small", "", "Only the roles you pick (and admins) can see it."));
  const roles = srvEl("div", "srv-chips");
  const drawRoles = () => roles.replaceChildren(...(srv.roles || []).map((r) => {
    const b = srvBtn("srv-chip" + (priv.has(r.id) ? " on" : ""), "", "", () => { if (priv.has(r.id)) priv.delete(r.id); else priv.add(r.id); drawRoles(); });
    b.append(Object.assign(srvEl("i"), { style: `background:${r.color}` }), r.name);
    return b;
  }));
  let isPriv = !!(c && c.private_roles);
  pr.append(prText, srvSwitch(isPriv, (on) => { isPriv = on; roles.hidden = !on; }));
  roles.hidden = !isPriv;
  const onlyText = () => { ro.hidden = kind !== "text"; topicL.hidden = kind !== "text"; };
  const note = srvEl("p", "group-note");
  const save = srvButton("small-button", c ? "Save" : "Make channel", async () => {
    const data = { name: name.value, category: cat.value.trim(), topic: topic.value, read_only: kind === "text" && readOnly,
      private_roles: isPriv ? [...priv] : null };
    const res = c ? await srvApi("channel_edit", srv.id, { ...data, id: c.id }) : await srvApi("channel_add", srv.id, { ...data, kind });
    if (!res.ok) { note.textContent = res.error; return; }
    srvClose();
    srvDraw();
    if (!c && res.id) { const ch = (srv.channels || []).find((x) => x.id === res.id); if (ch && ch.kind === "text") srvPick(ch); }
    roomDrawn = srvRoomDrawn = "";
    drawRoom();
  });
  const buttons = [srvButton("ghost-button", "Cancel", srvClose), save];
  if (c) {
    const del = srvButton("outline-button srv-del", "Delete channel", async () => {
      if (!confirm(`Delete #${c.name} and everything in it? This can't be undone.`)) return;
      const res = await srvApi("channel_delete", srv.id, { id: c.id });
      if (!res.ok) { note.textContent = res.error; return; }
      srvClose();
      if (chatWith === "g:" + c.id) { const first = (srv.channels || []).find((x) => x.kind === "text"); if (first) srvPick(first); }
      srvDraw();
    });
    buttons.unshift(del);
  }
  if (!c) d.append(srvText("h4", "group-label", "Kind"), kinds);
  d.append(srvText("h4", "group-label", "Name"), nameL, topicL, srvText("h4", "group-label", "Category"), catL, dl, ro, pr, roles, note);
  const actions = srvActions(...buttons.slice(c ? 1 : 0));
  if (c) actions.prepend(buttons[0]);
  d.append(actions);
  drawKinds();
  onlyText();
  srvShowModal(d);
  setTimeout(() => name.focus(), 30);
}

// ---- server settings: overview, channels, roles, auto-posts, members, invites, bans (and delete)

let srvSettingsTab = null;
let srvRolePick = null;
let srvAutoOpen = null;
function srvSettings(tab) {
  if (!srv) return;
  srvSettingsTab = tab;
  const d = srvEl("div", "dialog srv-set-dialog");
  const nav = srvEl("nav", "srv-set-nav");
  nav.append(srvText("h5", "", srv.name));
  const tabs = [];
  if (srvCan("manage")) tabs.push(["overview", "Overview"], ["channels", "Channels"], ["roles", "Roles"], ["auto", "Auto-posts"]);
  tabs.push(["members", "Members"]);
  if (srvCan("invite")) tabs.push(["invites", "Invites"]);
  if (srvCan("kick")) tabs.push(["bans", "Bans"]);
  for (const [k, label] of tabs) nav.append(srvButton(k === tab ? "on" : "", label, () => srvSettings(k)));
  if (srv.perms.includes("owner")) nav.append(srvButton("red" + (tab === "delete" ? " on" : ""), "Delete server", () => srvSettings("delete")));
  const body = srvEl("div", "srv-set-body");
  const close = srvBtn("icon-button srv-set-x", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>', "Close (Esc)", srvClose);
  d.append(nav, body, close);
  const drawers = { overview: srvSetOverview, channels: srvSetChannels, roles: srvSetRoles, auto: srvSetAuto, members: srvSetMembers, invites: srvSetInvites, bans: srvSetBans, delete: srvSetDelete };
  (drawers[tab] || srvSetMembers)(body);
  const keepScroll = srvModal.querySelector(".srv-set-body");
  const top = keepScroll ? keepScroll.scrollTop : 0;
  srvShowModal(d, true);
  if (keepScroll && srvModal.dataset.tab === tab) body.scrollTop = top;
  srvModal.dataset.tab = tab;
}
async function srvSetDo(what, data, again = true) {
  const res = await srvApi(what, srv.id, data);
  if (!res.ok) { const n = srvModal.querySelector(".srv-set-note"); if (n) n.textContent = res.error; return null; }
  srvDraw();
  if (again && srvSettingsTab) srvSettings(srvSettingsTab);
  return res;
}

function srvSetOverview(body) {
  body.append(srvText("h2", "", "Overview"));
  const top = srvEl("div", "srv-top");
  const pic = srvPic(srv, "big");
  const picBtn = srvBtn("srv-pic-btn", "", "Change the picture", srvPickPicture);
  picBtn.append(pic, srvEl("span", "srv-pic-edit", SRV_I.img));
  const [nameL, name] = srvInput(srv.name, "Server name", 50);
  const nameBox = srvEl("div", "srv-grow");
  nameBox.append(srvText("h4", "group-label", "Name"), nameL);
  if (srv.picture) nameBox.append(srvButton("link", "Remove picture", () => srvSetDo("edit", { picture: null })));
  top.append(picBtn, nameBox);
  const about = document.createElement("textarea");
  about.className = "srv-about";
  about.maxLength = 300;
  about.value = srv.about || "";
  about.placeholder = "What's this server about? People see it before they join.";
  let banner = srv.banner;
  const colors = srvEl("div", "srv-banners");
  const drawColors = () => colors.replaceChildren(...Object.entries(SRV_BANNERS).map(([k, bg]) => {
    const b = srvBtn("srv-banner-dot wide" + (k === banner ? " on" : ""), "", k, () => { banner = k; drawColors(); });
    b.style.background = bg;
    return b;
  }));
  drawColors();
  const note = srvEl("p", "group-note srv-set-note");
  const save = srvButton("small-button", "Save changes", async () => {
    const res = await srvSetDo("edit", { name: name.value, about: about.value, banner });
    if (res) { note.textContent = "Saved ✓"; }
  });
  body.append(top, srvText("h4", "group-label", "About"), about, srvText("h4", "group-label", "Banner color"), colors, note, srvActions(save));
}
const srvPicInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
document.body.append(srvPicInput);
srvPicInput.addEventListener("change", () => {
  const file = srvPicInput.files[0];
  srvPicInput.value = "";
  if (file && srv) srvSavePicture(fetch("/api/sfx-server-picture-upload", { method: "POST", body: file, headers: { "X-Server": srv.id } }).then((r) => r.json()));
});
async function srvPickPicture() {
  const res = await api("/api/sfx-server-picture-pick", { server: srv.id }).catch(() => ({ ok: false, fallback: true }));
  if (res.fallback) return srvPicInput.click();
  if (res.ok && !res.server) return;
  srvSavePicture(Promise.resolve(res));
}
async function srvSavePicture(promise) {
  const res = await promise.catch(() => ({ ok: false, error: "Couldn't save the picture." }));
  if (!res.ok) { const n = srvModal.querySelector(".srv-set-note"); if (n) n.textContent = res.error; return; }
  if (res.server) srv = res.server;
  srvLoadList();
  srvDraw();
  if (srvSettingsTab) srvSettings(srvSettingsTab);
}

function srvSetChannels(body) {
  body.append(srvText("h2", "", "Channels"), srvText("p", "srv-hint top", "Move channels up and down, or click one to rename it, change its category or make it private."));
  const list = srvEl("div", "srv-chlist");
  const chans = (srv.channels || []).slice();
  const move = async (i, by) => {
    const j = i + by;
    if (j < 0 || j >= chans.length) return;
    const a = chans[i], b = chans[j];
    // Moving past a channel of another category takes that category.
    chans[i] = b; chans[j] = a;
    const ids = chans.map((c) => ({ id: c.id, category: c === a ? b.category : c.category }));
    await srvSetDo("channel_order", { ids });
  };
  let lastCat = null;
  chans.forEach((c, i) => {
    if ((c.category || "") !== lastCat) { lastCat = c.category || ""; list.append(srvText("div", "srv-cat static", lastCat || "No category")); }
    const row = srvEl("div", "srv-chrow");
    const open = srvBtn("srv-ch", c.kind === "voice" ? SRV_I.vol : '<span class="h">#</span>', "Edit", () => srvChannelDialog(c));
    open.append(srvText("span", "srv-ch-name", c.name));
    if (c.private_roles) open.append(srvEl("span", "ico", SRV_I.lock));
    if (c.read_only) open.append(srvEl("span", "ico", SRV_I.megaphone));
    row.append(open, srvBtn("icon-button", SRV_I.up, "Move up", () => move(i, -1)),
      srvBtn("icon-button flip", SRV_I.up, "Move down", () => move(i, 1)));
    list.append(row);
  });
  const add = srvBtn("srv-add-ch", SRV_I.plus, "", () => srvChannelDialog(null, ""));
  add.append("Make a channel");
  body.append(list, add, srvEl("p", "group-note srv-set-note"));
}

function srvSetRoles(body) {
  body.append(srvText("h2", "", "Roles"), srvText("p", "srv-hint top", "Roles give people a color and what they're allowed to do. Everyone who joins gets Member."));
  const roles = srv.roles || [];
  if (!roles.some((r) => r.id === srvRolePick)) srvRolePick = (roles.find((r) => !r.is_default) || roles[0] || {}).id;
  const wrap = srvEl("div", "srv-roles");
  const left = srvEl("div", "srv-rl");
  const owner = srvEl("div", "static");
  owner.append(Object.assign(srvEl("i"), { style: "background:#f59e0b" }), "Owner", srvText("small", "", "1"));
  left.append(owner);
  for (const r of roles) {
    const b = srvBtn(r.id === srvRolePick ? "on" : "", "", "", () => { srvRolePick = r.id; srvSettings("roles"); });
    b.append(Object.assign(srvEl("i"), { style: `background:${r.color}` }), r.name, srvText("small", "", String(r.count)));
    left.append(b);
  }
  left.append(srvButton("add", "+ New role", () => srvSetDo("role_add", { name: "New role", color: SRV_COLORS[roles.length % SRV_COLORS.length], perms: [] })
    .then((res) => { if (res) { srvRolePick = (srv.roles || []).filter((r) => !r.is_default).slice(-1)[0].id; srvSettings("roles"); } })));
  const r = roles.find((x) => x.id === srvRolePick);
  const right = srvEl("div");
  if (r) {
    const [nameL, name] = srvInput(r.name, "Role name", 30);
    name.addEventListener("change", () => srvSetDo("role_edit", { id: r.id, name: name.value }));
    const colors = srvEl("div", "srv-colors");
    for (const col of SRV_COLORS) {
      const b = srvBtn(col === r.color ? "on" : "", "", col, () => srvSetDo("role_edit", { id: r.id, color: col }));
      b.style.background = col;
      colors.append(b);
    }
    right.append(nameL, colors);
    for (const [perm, title, sub] of SRV_PERMS) {
      const row = srvEl("div", "srv-perm");
      const t = srvEl("span");
      t.append(srvText("b", "", title), srvText("small", "", sub));
      row.append(t, srvSwitch((r.perms || []).includes(perm), (on) => {
        const perms = new Set(r.perms || []);
        if (on) perms.add(perm); else perms.delete(perm);
        srvSetDo("role_edit", { id: r.id, perms: [...perms] });
      }));
      right.append(row);
    }
    const priv = (srv.channels || []).filter((c) => (c.private_roles || []).includes(r.id));
    if (priv.length) right.append(srvText("p", "srv-hint", "Sees the private channels " + priv.map((c) => (c.kind === "voice" ? "" : "#") + c.name).join(", ") + "."));
    if (!r.is_default) {
      right.append(srvButton("outline-button srv-del", "Delete role", async () => {
        if (!confirm(`Delete the ${r.name} role? People with it become Members.`)) return;
        await srvSetDo("role_delete", { id: r.id });
      }));
    }
  }
  wrap.append(left, right);
  body.append(wrap, srvEl("p", "group-note srv-set-note"));
}

// Auto-posts: what VaultHub posts by itself, and where.
function srvSetAuto(body) {
  body.classList.add("ap");
  body.append(srvText("h2", "", "Auto-posts"), srvText("p", "srv-hint top", "VaultHub posts in your channels by itself when something happens. Pick what goes where, and click one to change its message."));
  const texts = (srv.channels || []).filter((c) => c.kind === "text");
  const have = new Map((srv.autoposts || []).map((a) => [a.kind, a]));
  for (const [kind, e, when, hint] of SRV_AUTO) {
    const a = have.get(kind) || { kind, channel: null, enabled: false, template: "", ping: false };
    const open = srvAutoOpen === kind;
    const row = srvEl("div", "ap-row" + (a.enabled && a.channel ? "" : " off") + (open ? " open" : ""));
    const head = srvBtn("ap-head", "", open ? "Close" : "Change the message", () => { srvAutoOpen = open ? null : kind; srvSettings("auto"); });
    head.append(srvText("span", "ap-e", e));
    const t = srvEl("span", "ap-when");
    t.append(srvText("b", "", when), srvText("small", "", hint));
    head.append(t);
    const sel = document.createElement("select");
    sel.className = "ap-ch";
    sel.append(new Option("Pick a channel", ""));
    for (const c of texts) sel.append(new Option("# " + c.name, c.id, false, c.id === a.channel));
    sel.addEventListener("click", (ev) => ev.stopPropagation());
    sel.addEventListener("change", () => srvSetDo("autopost", { kind, channel: sel.value || null, enabled: !!sel.value || a.enabled }));
    row.append(head, srvText("span", "ap-arrow", "→"), sel, srvSwitch(a.enabled && !!a.channel, (on) => {
      if (on && !sel.value && texts[0]) sel.value = texts[0].id;
      srvSetDo("autopost", { kind, enabled: on, channel: sel.value || null });
    }));
    if (open) {
      const more = srvEl("div", "ap-more");
      const msg = document.createElement("textarea");
      msg.className = "ap-msg";
      msg.maxLength = 300;
      msg.value = a.template || SRV_WORDS[kind];
      msg.rows = 2;
      const tokens = srvEl("div", "ap-tokens");
      tokens.append("Add: ");
      for (const tok of SRV_TOKENS[kind]) {
        tokens.append(srvButton("tok", tok, () => {
          const at = msg.selectionStart ?? msg.value.length;
          msg.value = msg.value.slice(0, at) + `{${tok}}` + msg.value.slice(msg.selectionEnd ?? at);
          msg.focus();
          msg.selectionStart = msg.selectionEnd = at + tok.length + 2;
          drawPrev();
        }));
      }
      const prev = srvEl("div", "ap-preview");
      const sample = { name: sfxUser() ? sfxUser().username : "lelon", title: kind === "milestone" ? "" : kind === "sound" ? "Big boom" : "Ep 5: Night Drive chaos", count: "1,000", what: "started" };
      const drawPrev = () => {
        const words = (msg.value.trim() || SRV_WORDS[kind]).replace(/\{(name|title|count|what)\}/g, (_, k) => sample[k]);
        prev.replaceChildren(srvBotFace(), srvText("span", "", (ping ? "@everyone " : "") + words));
      };
      let ping = !!a.ping;
      msg.addEventListener("input", drawPrev);
      const pingRow = srvEl("label", "ap-ping");
      const pingBox = Object.assign(document.createElement("input"), { type: "checkbox", checked: ping });
      pingBox.addEventListener("change", () => { ping = pingBox.checked; drawPrev(); });
      pingRow.append(pingBox, " Ping @everyone");
      const save = srvButton("small-button", "Save message", () => srvSetDo("autopost", { kind, template: msg.value.trim() === SRV_WORDS[kind] ? "" : msg.value.trim(), ping }));
      const reset = srvButton("link", "Use the normal message", () => { msg.value = SRV_WORDS[kind]; drawPrev(); });
      const foot = srvEl("div", "ap-foot");
      foot.append(pingRow, srvEl("span", "spacer"), reset, save);
      more.append(srvText("small", "ap-label", "Message"), msg, tokens, srvText("small", "ap-label", "Looks like"), prev, foot);
      row.append(more);
      drawPrev();
    }
    body.append(row);
  }
  body.append(srvText("p", "srv-hint", "Videos, streams and milestones come from the YouTube and Twitch channels on each person's profile, and are posted by their own app while it's open."),
    srvEl("p", "group-note srv-set-note"));
}

function srvSetMembers(body) {
  const members = srv.members || [];
  body.append(srvText("h2", "", `Members — ${members.length}`));
  const list = srvEl("div", "srv-mlist");
  const me = sfxUser();
  for (const m of members) {
    const row = srvEl("div", "srv-friend");
    const b = srvText("b", "", m.username);
    const r = srvRoleOf(m.username);
    if (r) b.style.color = r.color;
    if (m.owner) b.insertAdjacentHTML("beforeend", SRV_I.crown);
    row.append(avatarEl(m.avatarUrl, m.username), b);
    const isMe = me && lower(me.username) === lower(m.username);
    if (!m.owner && srvCan("manage") && !isMe) {
      const sel = document.createElement("select");
      sel.className = "chip";
      for (const x of srv.roles || []) sel.append(new Option(x.name, x.id, false, x.id === m.role));
      sel.addEventListener("change", () => srvSetDo("member_role", { username: m.username, role: sel.value }));
      row.append(sel);
    } else {
      row.append(srvText("span", "srv-role-name", m.owner ? "Owner" : r ? r.name : ""));
    }
    if (!m.owner && srvCan("kick") && !isMe) {
      row.append(srvBtn("icon-button", SRV_I.dots, "Kick or ban", (e, btn) => srvPopMenu(btn, [[`Kick ${m.username}`, () => srvKick(m.username, false), "red"], [`Ban ${m.username}`, () => srvKick(m.username, true), "red"]])));
    }
    list.append(row);
  }
  body.append(list, srvEl("p", "group-note srv-set-note"));
}

function srvSetInvites(body) {
  body.append(srvText("h2", "", "Invites"), srvText("p", "srv-hint top", "Invite codes that still work. Delete one and it stops working right away."));
  const list = srvEl("div", "srv-mlist");
  for (const i of srv.invites || []) {
    const row = srvEl("div", "srv-friend");
    const left = i.max_uses ? `${i.uses} of ${i.max_uses} used` : `${i.uses} used`;
    const ends = i.expires_at ? "until " + new Date(i.expires_at).toLocaleDateString() : "never runs out";
    const t = srvEl("span", "srv-grow");
    t.append(srvText("b", "mono", i.code), srvText("small", "", `${left} · ${ends} · by ${i.by || "someone"}`));
    row.append(t, srvBtn("icon-button", SRV_I.trash, "Delete this invite", () => srvSetDo("invite_delete", { code: i.code })));
    list.append(row);
  }
  if (!(srv.invites || []).length) list.append(srvText("p", "srv-hint", "No invite codes right now."));
  if ((srv.asked || []).length) list.append(srvText("p", "srv-hint", "Invited by name, not joined yet: " + srv.asked.join(", ")));
  body.append(list, srvEl("p", "group-note srv-set-note"), srvActions(srvButton("small-button", "Invite people", () => srvInviteDialog())));
}

function srvSetBans(body) {
  body.append(srvText("h2", "", "Bans"), srvText("p", "srv-hint top", "People who can't join again until you unban them."));
  const list = srvEl("div", "srv-mlist");
  for (const b of srv.bans || []) {
    const row = srvEl("div", "srv-friend");
    row.append(avatarEl(b.avatarUrl, b.username), srvText("b", "", b.username),
      srvButton("ghost-button", "Unban", () => srvSetDo("unban", { username: b.username })));
    list.append(row);
  }
  if (!(srv.bans || []).length) list.append(srvText("p", "srv-hint", "Nobody is banned."));
  body.append(list, srvEl("p", "group-note srv-set-note"));
}

function srvSetDelete(body) {
  body.append(srvText("h2", "", "Delete server"), srvText("p", "srv-hint top", `This deletes ${srv.name}, every channel in it and every message. It can't be undone.`));
  const [label, input] = srvInput("", `Type ${srv.name} to be sure`, 50);
  const note = srvEl("p", "group-note srv-set-note");
  const del = srvButton("outline-button srv-del", "Delete forever", async () => {
    if (input.value.trim() !== srv.name) { note.textContent = `Type ${srv.name} first.`; return; }
    if (srvVoice && srvVoice.server === srv.id) callHangUp("");
    const res = await srvApi("delete", srv.id, {});
    if (!res.ok) { note.textContent = res.error; return; }
    srvClose();
    srvGoHome();
    srvLoadList();
  });
  body.append(label, note, srvActions(del));
}

// ---- checking for news

async function srvLoadList() {
  const res = await api("/api/sfx-server", { what: "list" }).catch(() => null);
  if (res && res.ok && res.list) srvList = res.list;
  if (srvId && !(srvList.servers || []).some((s) => s.id === srvId)) { srvGoHome(); }
  srvDraw();
}
function srvPoll(delay) {
  clearTimeout(srvTimer);
  srvTimer = setTimeout(srvCheck, delay);
}
async function srvCheck() {
  const user = sfxUser();
  if (!user) { srvList = { servers: [], asks: [], watch: [] }; srvId = ""; srv = null; srvUserId = null; srvDraw(); return srvPoll(15000); }
  let reopen = "";
  if (user.id !== srvUserId) {
    reopen = srvUserId === null ? loadPref("srvOpen") || "" : ""; // (the server that was open last time)
    srvUserId = user.id; srvId = ""; srv = null; srvVoice = null; srvRailDrawn = "";
  }
  if (srvBusy) return srvPoll(1000);
  srvBusy = true;
  try {
    const open = chatIsOpen() && !document.hidden;
    if (reopen || srvTicks++ % (open ? 4 : 1) === 0) await srvLoadList();
    if (reopen && (srvList.servers || []).some((s) => s.id === reopen)) await srvOpen(reopen);
    if (open && srvId) {
      const id = srvId;
      const res = await api("/api/sfx-server", { what: "get", server: id }).catch(() => null);
      if (res && res.ok && res.server && srvId === id) {
        srv = res.server;
        // (a channel that was deleted, or that you can't see any more)
        if (srvChannelOf(chatWith) === null && isGroupKey(chatWith) && chatGroup && chatGroup.server === id) {
          const first = (srv.channels || []).find((c) => c.kind === "text");
          if (first) switchChat("g:" + first.id);
        }
        srvDraw();
        srvRoomHead();
        srvDrawForm();
      } else if (res && !res.ok && srvId === id) {
        srvGoHome();
        srvLoadList();
      }
    }
  } finally {
    srvBusy = false;
    srvPoll(chatIsOpen() && !document.hidden ? (srvId ? 2500 : 4000) : 45000);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && chatIsOpen()) srvPoll(300); });
srvPoll(2500);
