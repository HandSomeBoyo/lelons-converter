// (2.31.0) More for the chat: replies, threads, pins, editing, voice messages, any emoji, GIFs and stickers,
// link cards (YouTube and Steam play right here), search, your status, and polls.
// Works with chat.js (chatMessages, chatWith, drawChat, addChat, pollChat, react...), and uses $, api(),
// ICONS, clock() from app.js, loadPref()/savePref() from theme.js, avatarEl(), sfxUser() from sfx.js,
// openWatch() from watch.js, gmLoadHls() from games.js and EMOJI_GROUPS from emojidata.js.

const CP_ICONS = {
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8 5 12.5 10 17"/><path d="M5.5 12.5H14a5 5 0 0 1 5 5V19"/></svg>',
  thread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 5 3.5 3.5v1.5h-11v-1.5L10 9z"/><path d="M12 14v6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2"/><path d="M9 9.8h.01M15 9.8h.01" stroke-width="2.8"/></svg>',
  smilePlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.3 11a8.5 8.5 0 1 1-7.3-7.4"/><path d="M8.5 14.2c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2"/><path d="M9 9.8h.01M15 9.8h.01" stroke-width="2.8"/><path d="M19 2.5v5M16.5 5h5"/></svg>',
  gif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10 10.2c-.4-.5-1-.7-1.6-.7-1.2 0-2 1-2 2.5s.8 2.5 2 2.5c.9 0 1.6-.6 1.6-1.6v-.6H8.6M13 9.5v5M16 14.5v-5h2.6M16 12h2"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  poll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

const QUICK_REACTIONS = ["👍", "😂", "🔥", "❤️"];
const MODES = {
  "": { label: "Online", color: "var(--green)" },
  away: { label: "Away", color: "#f5b942" },
  busy: { label: "Busy", color: "#ef5350" },
  recording: { label: "Recording", color: "#ff4d6d" },
  editing: { label: "Editing", color: "#b48cff" },
  gaming: { label: "Gaming", color: "#5aa9ff" },
  streaming: { label: "Streaming", color: "#c86bff" },
};

let chatReplyTo = null; // the message the next one answers (in the chat itself)
let chatEditing = null; // the id of the message being edited
let chatPinCount = 0;
let chatNoOlder = false; // scrolled up to the very first message
let chatOlderBusy = false;
let chatPane = null; // the panel on the right: {kind: "thread", id, parent, messages} | {kind: "search"} | {kind: "pins"}
const chatCards = new Map(); // link -> its card, null (nothing to show) or a promise while it loads
const paneEls = new Map();

const cpEl = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const cpButton = (cls, icon, title, fn) => {
  const b = cpEl("button", cls);
  b.type = "button";
  if (icon) b.innerHTML = icon;
  if (title) b.title = title;
  if (fn) b.addEventListener("click", (e) => { e.stopPropagation(); fn(e, b); });
  return b;
};
const meName = () => (sfxUser() ? sfxUser().username : "");
const chatError = (text) => { $("chatNote").textContent = text || ""; };

// A conversation was switched: forget what belonged to the old one.
function chatPlusReset() {
  chatReplyTo = null;
  chatEditing = null;
  chatPinCount = 0;
  chatNoOlder = false;
  drawReplyBar();
  if (chatPane) closePane();
  stopVoice(false);
  closePop();
}

// What a message is, in a few words (for replies, pins and search).
function chatKindText(kind) {
  return { voice: "Voice message", poll: "Poll", gif: "GIF", sticker: "Sticker", sound: "Sound", clip: "Clip", call: "Call" }[kind] || "";
}
function chatMsgKind(m) {
  return m.voice ? "voice" : m.poll ? "poll" : m.gif ? "gif" : m.sticker ? "sticker" : m.sound ? "sound" : m.file ? "clip" : m.call_seconds != null ? "call" : null;
}

// ---- the parts of a message

// The little line above an answer: who it answers and what they said. Click to see that message.
function chatReplyQuote(r) {
  const q = cpEl("button", "chat-quote");
  q.type = "button";
  if (r.gone) {
    q.append(cpEl("span", "chat-quote-gone", "The message this answers was deleted"));
    q.disabled = true;
    return q;
  }
  q.title = "Go to that message";
  q.append(avatarEl(r.avatarUrl, r.username, "tiny"), cpEl("b", "", r.username));
  q.append(cpEl("span", "chat-quote-text", r.message || chatKindText(r.kind) || "a message"));
  q.addEventListener("click", (e) => { e.stopPropagation(); chatJump(r.id, r.thread_of); });
  return q;
}

// Under a message with a thread: how many answers, who, and when the last one came.
function chatThreadLine(m) {
  const t = m.thread;
  const b = cpEl("button", "chat-thread-line");
  b.type = "button";
  const faces = cpEl("span", "faces");
  for (const f of t.faces || []) faces.append(avatarEl(f.avatarUrl, f.username, "tiny"));
  b.append(faces, cpEl("b", "", `${t.count} ${t.count === 1 ? "reply" : "replies"}`), cpEl("span", "", "Last reply " + chatAgo(t.last_at)));
  b.addEventListener("click", (e) => { e.stopPropagation(); openThread(m.id); });
  return b;
}

function chatAgo(when) {
  const s = Math.max(0, (Date.now() - new Date(when)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(when).toLocaleDateString([], { day: "numeric", month: "short" });
}

// The hover bar on a message: quick reactions, any emoji, reply, thread, pin, edit, delete.
function chatToolsEl(m, where, canDelete) {
  const tools = cpEl("div", "msg-tools");
  const pick = cpEl("div", "react-pick");
  for (const emoji of QUICK_REACTIONS) {
    const b = cpEl("button", "", emoji);
    b.type = "button";
    b.title = "React with " + emoji;
    const mine = (m.reactions || []).some((r) => r.emoji === emoji && r.mine);
    b.addEventListener("click", (e) => { e.stopPropagation(); react(m, emoji, !mine); });
    pick.append(b);
  }
  tools.append(pick);
  tools.append(cpButton("icon-button", CP_ICONS.smilePlus, "Pick any emoji", (e, b) => openEmojiPicker(b, (emoji) => {
    const mine = (m.reactions || []).some((r) => r.emoji === emoji && r.mine);
    react(m, emoji, !mine);
  })));
  if (m.call_seconds == null) {
    tools.append(cpButton("icon-button", CP_ICONS.reply, "Reply", () => chatStartReply(m, where)));
    if (where === "main") tools.append(cpButton("icon-button", CP_ICONS.thread, m.thread ? "Open the thread" : "Start a thread", () => openThread(m.id)));
  }
  if (where === "main" && chatCanPin()) {
    tools.append(cpButton("icon-button" + (m.pinned ? " on" : ""), CP_ICONS.pin, m.pinned ? "Unpin" : "Pin it to this chat", () => pinChat(m)));
  }
  if (m.mine && m.call_seconds == null) tools.append(cpButton("icon-button", CP_ICONS.edit, "Edit", () => startEdit(m)));
  if (canDelete) {
    const del = cpButton("icon-button del" + (chatSure.has(m.id) ? " sure" : ""), ICONS.remove,
      chatSure.has(m.id) ? "Click again to delete" : "Delete", () => (where === "main" ? deleteChat(m.id) : deletePaneMessage(m)));
    tools.append(del);
  }
  return tools;
}

function chatCanPin() {
  const me = sfxUser();
  if (typeof srvChannel === "function" && srvChannel()) return srvCan("pin");
  return !!me && (chatWith !== "" || me.role === "owner" || me.role === "admin");
}

// Everything in a message under the name line. Used by chatMessageEl in chat.js.
function chatMessageParts(m, body, where) {
  if (chatEditing === m.id) {
    body.append(chatEditor(m));
  } else if (m.message) {
    const text = chatText(m.message);
    text.title = chatTime(m.created_at);
    if (m.edited) text.append(cpEl("span", "chat-edited", " (edited)"));
    body.append(text);
  }
  if (m.call_seconds != null) body.append(chatCallLine(m));
  if (m.voice && m.file) body.append(chatVoiceEl(m));
  else if (m.gif) body.append(chatGifEl(m));
  else if (m.sound || m.file || m.shared_gone) body.append(chatAttachment(m));
  if (m.sticker) body.append(chatStickerEl(m.sticker));
  if (m.poll) body.append(chatPollEl(m, where));
  if (m.card && typeof srvCardEl === "function") { const card = srvCardEl(m.card); if (card) body.append(card); } // (servers) an auto-post's card
  else if (m.message && chatEditing !== m.id) chatLinkCards(m, body);
  if ((m.reactions || []).length) {
    const row = reactionRow(m);
    row.append(cpButton("reaction add", CP_ICONS.smilePlus, "Add a reaction", (e, b) => openEmojiPicker(b, (emoji) => {
      const mine = (m.reactions || []).some((r) => r.emoji === emoji && r.mine);
      react(m, emoji, !mine);
    })));
    body.append(row);
  }
  if (where === "main" && m.thread && m.thread.count) body.append(chatThreadLine(m));
}

// ---- replies

function chatStartReply(m, where) {
  if (where === "thread" || where === "parent") {
    if (!chatPane || chatPane.kind !== "thread") return;
    chatPane.reply = where === "parent" ? null : m;
    drawPane();
    const input = $("paneInput");
    if (input) input.focus();
    return;
  }
  chatReplyTo = m;
  drawReplyBar();
  $("chatInput").focus();
}

function drawReplyBar() {
  const bar = $("chatReplying");
  bar.hidden = !chatReplyTo;
  if (!chatReplyTo) return bar.replaceChildren();
  const m = chatReplyTo;
  const text = cpEl("span", "chat-replying-text");
  text.append("Replying to ", cpEl("b", "", m.mine ? "yourself" : m.username), " ", cpEl("span", "muted", m.message || chatKindText(chatMsgKind(m))));
  bar.replaceChildren(cpEl("span", "chat-replying-icon"), text,
    cpButton("icon-button", ICONS.remove, "Don't reply (Esc)", () => { chatReplyTo = null; drawReplyBar(); }));
  bar.firstChild.innerHTML = CP_ICONS.reply;
}

// Show a message: scroll to it (loading older ones first if it's far back), or open its thread.
async function chatJump(id, threadOf) {
  closePop();
  if (threadOf) return openThread(threadOf, id);
  let tries = 0;
  while (!chatMessages.some((m) => m.id === id) && !chatNoOlder && tries++ < 25) {
    if (!(await loadOlderChat())) break;
  }
  const kept = chatEls.get(id);
  if (!kept || !kept.el.isConnected) return chatError("That message is too far back to show, or it was deleted.");
  kept.el.scrollIntoView({ block: "center", behavior: "smooth" });
  kept.el.classList.remove("flash");
  void kept.el.offsetWidth;
  kept.el.classList.add("flash");
}

// Scrolled to the top: the 100 messages before the first one.
async function loadOlderChat() {
  if (chatOlderBusy || chatNoOlder || !chatMessages.length || !sfxUser()) return false;
  chatOlderBusy = true;
  const asked = chatWith;
  const list = $("chatList");
  try {
    const res = await api("/api/sfx-chat", { after: 0, with: chatWith || null, before: chatMessages[0].id }).catch(() => null);
    if (!res || !res.ok || asked !== chatWith) return false;
    const older = (res.messages || []).filter((m) => m.id < chatMessages[0].id);
    if (older.length < 100) chatNoOlder = true;
    if (!older.length) return false;
    const fromBottom = list.scrollHeight - list.scrollTop;
    chatMessages = older.concat(chatMessages);
    drawChat(true);
    list.scrollTop = list.scrollHeight - fromBottom;
    return true;
  } finally {
    chatOlderBusy = false;
  }
}
$("chatList").addEventListener("scroll", () => { if ($("chatList").scrollTop < 150) loadOlderChat(); }, { passive: true });

// ---- editing your own messages

function startEdit(m) {
  chatEditing = m.id;
  closePop();
  drawChat(true);
  drawPane();
}

function chatEditor(m) {
  const box = cpEl("div", "chat-editor");
  const input = cpEl("textarea");
  input.value = m.message || "";
  input.maxLength = 500;
  input.rows = 1;
  const fit = () => { input.style.height = "auto"; input.style.height = Math.min(200, input.scrollHeight) + "px"; };
  const done = () => { chatEditing = null; drawChat(true); drawPane(); $("chatInput").focus(); };
  const save = async () => {
    const text = input.value.trim();
    if (text === (m.message || "").trim()) return done();
    const res = await api("/api/sfx-chat-edit", { id: m.id, message: text }).catch(() => ({ ok: false, error: "Couldn't save that." }));
    if (sfxLoggedOut(res)) return drawChatUser();
    if (!res.ok) return chatError(res.error);
    m.message = text;
    m.edited = true;
    done();
    pollChat(200);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); done(); }
  });
  input.addEventListener("input", fit);
  const hint = cpEl("small", "chat-editor-hint");
  const cancel = cpEl("button", "link", "cancel");
  cancel.type = "button";
  cancel.addEventListener("click", done);
  const ok = cpEl("button", "link", "save");
  ok.type = "button";
  ok.addEventListener("click", save);
  hint.append("Esc to ", cancel, " · Enter to ", ok);
  box.append(input, hint);
  setTimeout(() => { fit(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
  return box;
}

// Arrow up in an empty box: edit your last message (like Discord).
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && !$("chatInput").value && $("chatSuggest").hidden) {
    const last = [...chatMessages].reverse().find((m) => m.mine && m.message && m.call_seconds == null);
    if (last) { e.preventDefault(); startEdit(last); }
  }
  if (e.key === "Escape" && chatReplyTo && $("chatSuggest").hidden) {
    e.stopPropagation();
    chatReplyTo = null;
    drawReplyBar();
  }
});

// ---- pins

async function pinChat(m) {
  const on = !m.pinned;
  const res = await api("/api/sfx-chat-pin", { id: m.id, on }).catch(() => ({ ok: false, error: "Couldn't pin that." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) return chatError(res.error);
  m.pinned = on;
  chatPinCount = Math.max(0, chatPinCount + (on ? 1 : -1));
  roomDrawn = "";
  drawRoom();
  drawChat(true);
  if (chatPane && chatPane.kind === "pins") loadPins();
  pollChat(200);
}

// The search and pin buttons at the top of every chat (drawRoom in chat.js puts them in).
function chatRoomButtons() {
  const search = cpButton("icon-button" + (chatPane && chatPane.kind === "search" ? " on" : ""), CP_ICONS.search, "Search this chat (Ctrl+F)", () => togglePane("search"));
  const pins = cpButton("icon-button chat-pins-btn" + (chatPane && chatPane.kind === "pins" ? " on" : ""), CP_ICONS.pin, "Pinned messages", () => togglePane("pins"));
  if (chatPinCount) pins.append(cpEl("i", "", String(chatPinCount)));
  return [search, pins];
}

// ---- the panel on the right: a thread, search results or the pinned messages

function togglePane(kind) {
  if (chatPane && chatPane.kind === kind) return closePane();
  if (kind === "search") openSearch();
  else if (kind === "pins") { chatPane = { kind: "pins", messages: null }; showPane(); loadPins(); }
}

function showPane() {
  $("chatPane").hidden = false;
  $("chatPanel").classList.add("has-pane");
  paneEls.clear();
  drawPane(true);
  roomDrawn = "";
  drawRoom();
}

function closePane() {
  clearTimeout(paneTimer);
  chatPane = null;
  $("chatPane").hidden = true;
  $("chatPane").replaceChildren();
  $("chatPanel").classList.remove("has-pane");
  paneEls.clear();
  roomDrawn = "";
  drawRoom();
}

let paneTimer = null;
let paneDrawn = "";
function drawPane(force) {
  if (!chatPane) return;
  const box = $("chatPane");
  const p = chatPane;
  const sig = JSON.stringify([p.kind, p.id, p.parent, p.messages, p.q, p.busy, p.reply && p.reply.id, p.error, chatEditing,
    chatPlaying, chatAudio.paused, [...chatSure]]);
  if (!force && sig === paneDrawn) return;
  paneDrawn = sig;
  if (!box.querySelector(".pane-head") || force) {
    const head = cpEl("div", "pane-head");
    head.append(cpEl("h3", "", p.kind === "thread" ? "Thread" : p.kind === "search" ? "Search" : "Pinned messages"));
    head.append(cpButton("icon-button", ICONS.remove, "Close (Esc)", closePane));
    const list = cpEl("div", "pane-list");
    list.id = "paneList";
    box.replaceChildren(head);
    if (p.kind === "search") box.append(searchBox());
    box.append(list);
    if (p.kind === "thread") box.append(threadForm());
  }
  const list = $("paneList");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const rows = [];
  const keys = [];
  const me = sfxUser();
  const canDeleteAll = me && chatWith === "" && (me.role === "owner" || me.role === "admin");
  if (p.kind === "thread") {
    if (p.error) rows.push(cpEl("p", "pane-empty", p.error));
    if (p.parent) {
      keys.push("parent");
      rows.push(keptNode(paneEls, "parent", JSON.stringify([p.parent, chatEditing === p.parent.id, chatPlaying === p.parent.id, chatAudio.paused]),
        () => paneMessageEl(p.parent, "parent", false, p.parent.mine || canDeleteAll)));
      const n = (p.messages || []).length;
      keys.push("sep");
      rows.push(keptNode(paneEls, "sep", String(n), () => cpEl("div", "pane-sep", n ? `${n} ${n === 1 ? "reply" : "replies"}` : "No replies yet. Start the thread!")));
    }
    let last = null;
    for (const m of p.messages || []) {
      const follow = last && last.username === m.username && new Date(m.created_at) - new Date(last.created_at) < 300000 && !m.reply;
      keys.push(m.id);
      rows.push(keptNode(paneEls, m.id, JSON.stringify([m, follow, chatEditing === m.id, chatPlaying === m.id, chatAudio.paused, chatSure.has(m.id)]),
        () => paneMessageEl(m, "thread", follow, m.mine || canDeleteAll)));
      last = m;
    }
    drawThreadReply();
  } else {
    const found = p.messages;
    if (p.busy && !found) rows.push(cpEl("p", "pane-empty", "Looking..."));
    else if (p.kind === "search" && !(p.q || "").trim()) rows.push(cpEl("p", "pane-empty", "Type what you're looking for. You can also look for @name to see what someone wrote."));
    else if (found && !found.length) rows.push(cpEl("p", "pane-empty", p.kind === "pins" ? (chatCanPin() ? "Nothing is pinned here yet. Point at a message and click the pin to keep it up here." : "Nothing is pinned here yet.") : "Nothing found."));
    for (const m of found || []) {
      keys.push(m.id);
      rows.push(keptNode(paneEls, m.id, JSON.stringify([m, p.q, chatPlaying === m.id, chatAudio.paused]), () => foundMessageEl(m, p.kind)));
    }
  }
  forgetNodes(paneEls, keys);
  setChildren(list, rows);
  if (p.kind === "thread" && (atBottom || p.scrollDown)) { list.scrollTop = list.scrollHeight; p.scrollDown = false; }
}

// A message in a thread (or the message the thread is under).
function paneMessageEl(m, where, follow, canDelete) {
  const el = cpEl("div", "chat-msg" + (follow ? " follow" : "") + (where === "parent" ? " pane-parent" : "")
    + (chatPane && chatPane.flash === m.id ? " flash" : ""));
  el.dataset.id = m.id;
  const face = avatarEl(m.avatarUrl, m.username);
  face.addEventListener("click", () => openProfile(m.username));
  el.append(face);
  const body = cpEl("div", "body");
  if (m.reply && where === "thread") body.append(chatReplyQuote(m.reply));
  if (!follow) {
    const line = cpEl("div", "who-line");
    const name = cpEl("button", "name role-" + m.role, m.username);
    name.type = "button";
    name.addEventListener("click", () => openProfile(m.username));
    line.append(name, cpEl("span", "when", chatTime(m.created_at)));
    body.append(line);
  }
  chatMessageParts(m, body, where);
  el.append(body, chatToolsEl(m, where, canDelete));
  if (chatSure.has(m.id)) el.classList.add("sure");
  return el;
}

// A search result or a pinned message: click to go to it.
function foundMessageEl(m, kind) {
  const el = cpEl("div", "chat-found");
  const top = cpEl("div", "chat-found-top");
  top.append(avatarEl(m.avatarUrl, m.username, "tiny"), cpEl("b", "", m.username),
    cpEl("span", "when", new Date(m.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })));
  if (m.thread_of) top.append(cpEl("span", "chat-found-tag", "in a thread"));
  el.append(top);
  const text = cpEl("div", "chat-found-text");
  const words = m.message || (m.poll ? "" : chatKindText(chatMsgKind(m))) || "";
  const q = kind === "search" && chatPane ? (chatPane.q || "").trim() : "";
  if (q && !q.startsWith("@")) {
    let at = 0;
    const low = words.toLowerCase(), ql = q.toLowerCase();
    for (let i = low.indexOf(ql); i >= 0; i = low.indexOf(ql, at)) {
      text.append(words.slice(at, i), cpEl("mark", "", words.slice(i, i + q.length)));
      at = i + q.length;
    }
    text.append(words.slice(at));
  } else text.append(words);
  el.append(text);
  if (m.gifUrl) { const img = cpEl("img", "chat-found-gif"); img.src = m.gifUrl; img.alt = "GIF"; el.append(img); }
  if (m.poll) el.append(cpEl("div", "chat-found-text muted", "Poll: " + m.poll.q));
  if (!words) text.remove();
  const actions = cpEl("div", "chat-found-actions");
  const go = cpEl("button", "link", "Jump to it");
  go.type = "button";
  go.addEventListener("click", (e) => { e.stopPropagation(); chatJump(m.id, m.thread_of); });
  actions.append(go);
  if (kind === "pins") {
    if (m.pinned_by) el.append(cpEl("small", "chat-found-by", `Pinned by ${m.pinned_by}`));
    if (chatCanPin()) {
      const un = cpEl("button", "link", "Unpin");
      un.type = "button";
      un.addEventListener("click", (e) => { e.stopPropagation(); pinChat({ ...m, pinned: true }).then(() => {
        const kept = chatMessages.find((x) => x.id === m.id);
        if (kept) { kept.pinned = false; drawChat(true); }
      }); });
      actions.append(un);
    }
  }
  el.append(actions);
  el.addEventListener("click", () => chatJump(m.id, m.thread_of));
  return el;
}

async function loadPins() {
  if (!chatPane || chatPane.kind !== "pins") return;
  const asked = chatWith;
  chatPane.busy = true;
  const res = await api("/api/sfx-chat-pins", { with: chatWith || null }).catch(() => ({ ok: false, error: "Couldn't load the pins." }));
  if (!chatPane || chatPane.kind !== "pins" || asked !== chatWith) return;
  chatPane.busy = false;
  if (!res.ok) return chatError(res.error);
  chatPane.messages = res.messages || [];
  chatPinCount = chatPane.messages.length;
  roomDrawn = "";
  drawRoom();
  drawPane();
}

// ---- search

function openSearch() {
  chatPane = { kind: "search", q: "", messages: null };
  showPane();
  setTimeout(() => $("paneSearch") && $("paneSearch").focus(), 0);
}

function searchBox() {
  const wrap = cpEl("label", "pane-search");
  wrap.innerHTML = CP_ICONS.search;
  const input = cpEl("input");
  input.id = "paneSearch";
  input.placeholder = "Search " + (isGroupKey(chatWith) ? (chatGroup ? chatGroup.name : "this group") : chatWith || "everyone");
  input.maxLength = 100;
  input.spellcheck = false;
  input.value = (chatPane && chatPane.q) || "";
  let timer = null;
  input.addEventListener("input", () => {
    chatPane.q = input.value;
    clearTimeout(timer);
    timer = setTimeout(runSearch, 280);
    drawPane();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePane(); } });
  wrap.append(input);
  return wrap;
}

async function runSearch() {
  if (!chatPane || chatPane.kind !== "search") return;
  const q = (chatPane.q || "").trim();
  if (q.length < 2) { chatPane.messages = null; return drawPane(); }
  chatPane.busy = true;
  const asked = [chatWith, q];
  const res = await api("/api/sfx-chat-search", { with: chatWith || null, q }).catch(() => ({ ok: false, error: "Couldn't search." }));
  if (!chatPane || chatPane.kind !== "search" || asked[0] !== chatWith || asked[1] !== (chatPane.q || "").trim()) return;
  chatPane.busy = false;
  if (!res.ok) return chatError(res.error);
  chatPane.messages = res.messages || [];
  drawPane();
}

document.addEventListener("keydown", (e) => {
  if (!chatIsOpen()) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f" && sfxUser()) {
    e.preventDefault();
    if (!chatPane || chatPane.kind !== "search") openSearch();
    else $("paneSearch").focus();
  }
  if (e.key === "Escape" && !$("chatPop").hidden) { e.stopPropagation(); closePop(); return; }
  if (e.key === "Escape" && chatPane && $("profileModal").hidden && $("pollModal").hidden) { e.stopPropagation(); closePane(); }
}, true);

// ---- threads

async function openThread(id, flash) {
  closePop();
  if (!chatPane || chatPane.kind !== "thread" || chatPane.id !== id) {
    const m = chatMessages.find((x) => x.id === id);
    chatPane = { kind: "thread", id, parent: m || null, messages: null, scrollDown: true, flash };
    showPane();
  } else if (flash) chatPane.flash = flash;
  await loadThread();
  if (flash) {
    const el = $("paneList") && $("paneList").querySelector(`[data-id="${flash}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  } else {
    const input = $("paneInput");
    if (input) input.focus();
  }
}

let threadBusy = false;
async function loadThread() {
  clearTimeout(paneTimer);
  if (!chatPane || chatPane.kind !== "thread" || threadBusy) return;
  const id = chatPane.id;
  threadBusy = true;
  const res = await api("/api/sfx-chat-thread", { id }).catch(() => null);
  threadBusy = false;
  if (!chatPane || chatPane.kind !== "thread" || chatPane.id !== id) return;
  if (res && res.ok) {
    chatPane.parent = res.parent;
    chatPane.messages = res.messages || [];
    chatPane.error = "";
  } else if (res && !res.ok && !sfxLoggedOut(res)) {
    chatPane.error = res.error;
  }
  drawPane();
  paneTimer = setTimeout(loadThread, chatIsOpen() && !document.hidden ? 3000 : 20000);
}

function threadForm() {
  const form = cpEl("form", "chat-form pane-form");
  form.autocomplete = "off";
  const reply = cpEl("div", "chat-replying");
  reply.id = "paneReplying";
  reply.hidden = true;
  const box = cpEl("div", "chat-box");
  const input = cpEl("input");
  input.id = "paneInput";
  input.maxLength = 500;
  input.placeholder = "Reply in the thread...";
  box.append(input, cpButton("chat-tool", CP_ICONS.smile, "Emoji", (e, b) => openEmojiPicker(b, (emoji) => insertText(input, emoji), true)),
    cpButton("chat-tool", CP_ICONS.mic, "Record a voice message", () => startVoice("thread")));
  const send = cpEl("button", "small-button");
  send.type = "submit";
  send.title = "Send";
  send.innerHTML = CP_ICONS.send;
  form.append(box, send);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled || !chatPane) return;
    send.disabled = true;
    const res = await api("/api/sfx-chat-send", { message: text, with: chatWith || null, thread: chatPane.id,
      reply: chatPane.reply ? chatPane.reply.id : null }).catch(() => ({ ok: false, error: "That didn't send." }));
    send.disabled = false;
    if (sfxLoggedOut(res)) return drawChatUser();
    if (!res.ok) return chatError(res.error);
    input.value = "";
    if (chatPane) { chatPane.reply = null; chatPane.scrollDown = true; }
    await loadThread();
    pollChat(0);
    input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chatPane && chatPane.reply) { e.stopPropagation(); chatPane.reply = null; drawThreadReply(); }
  });
  const wrap = cpEl("div", "pane-bottom");
  wrap.append(reply, form);
  return wrap;
}

function drawThreadReply() {
  const bar = $("paneReplying");
  if (!bar || !chatPane) return;
  const m = chatPane.reply;
  bar.hidden = !m;
  if (!m) return bar.replaceChildren();
  const text = cpEl("span", "chat-replying-text");
  text.append("Replying to ", cpEl("b", "", m.username), " ", cpEl("span", "muted", m.message || chatKindText(chatMsgKind(m))));
  bar.replaceChildren(text, cpButton("icon-button", ICONS.remove, "Don't reply", () => { chatPane.reply = null; drawThreadReply(); }));
}

async function deletePaneMessage(m) {
  if (!chatSure.has(m.id)) {
    chatSure.add(m.id);
    drawPane();
    setTimeout(() => { if (chatSure.delete(m.id)) drawPane(); }, 3000);
    return;
  }
  chatSure.delete(m.id);
  const res = await api("/api/sfx-chat-delete", { id: m.id }).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) return chatError(res.error);
  if (chatPane && chatPane.parent && chatPane.parent.id === m.id) { closePane(); chatMessages = chatMessages.filter((x) => x.id !== m.id); drawChat(); return; }
  if (chatPane && chatPane.messages) chatPane.messages = chatPane.messages.filter((x) => x.id !== m.id);
  drawPane();
  pollChat(200);
}

// ---- reactions with any emoji (also for typing emoji into a message)

let emojiRecent = loadPref("emojiRecent") || ["👍", "😂", "🔥", "❤️", "😮", "😢", "🎉", "💀", "👀", "🙏"];
let emojiParsed = null;
function emojiList() {
  if (!emojiParsed) {
    emojiParsed = EMOJI_GROUPS.map((g) => ({ name: g.name, icon: g.icon, items: g.list.split("|").map((x) => {
      const at = x.indexOf(" ");
      return { e: x.slice(0, at), n: x.slice(at + 1) };
    }) }));
  }
  return emojiParsed;
}

function openEmojiPicker(anchor, onPick, keepOpen = false) {
  const pop = openPop(anchor, "emoji-pop");
  const search = cpEl("input", "emoji-search");
  search.placeholder = "Find an emoji (like: fire, laugh, cat)";
  search.spellcheck = false;
  const tabs = cpEl("div", "emoji-tabs");
  const grid = cpEl("div", "emoji-grid");
  const foot = cpEl("div", "emoji-foot");
  const pick = (e) => {
    emojiRecent = [e, ...emojiRecent.filter((x) => x !== e)].slice(0, 24);
    savePref("emojiRecent", emojiRecent);
    onPick(e);
    if (!keepOpen) closePop();
  };
  const cell = (item) => {
    const b = cpEl("button", "", item.e);
    b.type = "button";
    b.title = item.n;
    b.addEventListener("click", (ev) => { ev.stopPropagation(); pick(item.e); });
    b.addEventListener("mouseenter", () => { foot.textContent = `${item.e}  ${item.n}`; });
    return b;
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const parts = [];
    if (q) {
      const words = q.split(/\s+/);
      const found = [];
      for (const g of emojiList()) for (const it of g.items) if (words.every((w) => it.n.includes(w))) found.push(it);
      if (!found.length) parts.push(cpEl("p", "emoji-none", "No emoji with that name."));
      const box = cpEl("div", "emoji-cells");
      found.slice(0, 160).forEach((it) => box.append(cell(it)));
      parts.push(box);
    } else {
      const names = new Map();
      for (const g of emojiList()) for (const it of g.items) names.set(it.e, it.n);
      parts.push(cpEl("h5", "", "Used lately"));
      const recent = cpEl("div", "emoji-cells");
      emojiRecent.forEach((e) => recent.append(cell({ e, n: names.get(e) || e })));
      parts.push(recent);
      for (const g of emojiList()) {
        const h = cpEl("h5", "", g.name);
        h.dataset.group = g.name;
        const box = cpEl("div", "emoji-cells");
        g.items.forEach((it) => box.append(cell(it)));
        parts.push(h, box);
      }
    }
    grid.replaceChildren(...parts);
  };
  for (const g of emojiList()) {
    const t = cpEl("button", "", g.icon);
    t.type = "button";
    t.title = g.name;
    t.addEventListener("click", (ev) => {
      ev.stopPropagation();
      search.value = "";
      draw();
      const h = grid.querySelector(`h5[data-group="${g.name}"]`);
      if (h) grid.scrollTop = h.offsetTop - grid.offsetTop;
    });
    tabs.append(t);
  }
  search.addEventListener("input", () => { tabs.hidden = !!search.value.trim(); draw(); });
  search.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closePop();
    if (e.key === "Enter") { const first = grid.querySelector(".emoji-cells button"); if (first) first.click(); }
  });
  foot.textContent = "Point at an emoji to see its name";
  pop.append(search, tabs, grid, foot);
  draw();
  setTimeout(() => search.focus(), 0);
}

function insertText(input, text) {
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  input.value = (input.value.slice(0, a) + text + input.value.slice(b)).slice(0, 500);
  input.setSelectionRange(a + text.length, a + text.length);
  input.dispatchEvent(new Event("input"));
  input.focus();
}

// ---- the little popups (emoji, GIFs, the + menu, your status)

let popAnchor = null;
function openPop(anchor, cls) {
  const pop = $("chatPop");
  if (!pop.hidden && popAnchor === anchor) { closePop(); return cpEl("div"); } // (a second click closes it)
  pop.className = "chat-pop " + cls;
  pop.replaceChildren();
  pop.hidden = false;
  popAnchor = anchor;
  requestAnimationFrame(() => placePop(anchor));
  return pop;
}

function placePop(anchor) {
  const pop = $("chatPop");
  if (pop.hidden || !anchor.isConnected) return;
  const panel = $("chatPanel").getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(panel.width - w - 10, Math.max(10, r.right - panel.left - w));
  let top = r.top - panel.top - h - 8;
  if (top < 10) top = Math.min(panel.height - h - 10, r.bottom - panel.top + 8);
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

function closePop() {
  const pop = $("chatPop");
  if (pop.hidden) return;
  pop.hidden = true;
  pop.replaceChildren();
  popAnchor = null;
}
document.addEventListener("mousedown", (e) => {
  const pop = $("chatPop");
  if (!pop.hidden && !pop.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closePop();
});

$("chatEmojiBtn").innerHTML = CP_ICONS.smile;
$("chatEmojiBtn").addEventListener("click", (e) => { e.stopPropagation(); openEmojiPicker($("chatEmojiBtn"), (emoji) => insertText($("chatInput"), emoji), true); });
$("chatPlus").innerHTML = CP_ICONS.plus;
$("chatPlus").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = openPop($("chatPlus"), "menu-pop");
  const item = (icon, label, sub, fn) => {
    const b = cpEl("button", "pop-item");
    b.type = "button";
    const i = cpEl("span", "pop-icon");
    i.innerHTML = icon;
    const t = cpEl("span", "pop-text");
    t.append(cpEl("b", "", label), cpEl("small", "", sub));
    b.append(i, t);
    b.addEventListener("click", (ev) => { ev.stopPropagation(); closePop(); fn(); });
    return b;
  };
  pop.append(item(CP_ICONS.poll, "Make a poll", "Ask a question, everyone votes", openPollModal),
    item(CP_ICONS.file, "Send a GIF from your PC", "Up to 10 MB", () => $("chatGifFile").click()),
    item(CP_ICONS.mic, "Record a voice message", "Up to 10 minutes", () => startVoice("main")));
});

// ---- sending things other than words (GIFs, stickers, polls), in the chat itself

async function sendExtra(data, note) {
  if (!sfxUser()) return openLogin("login");
  if (note) chatError("");
  const asked = chatWith;
  const res = await api("/api/sfx-chat-send", { message: "", after: chatLastId, with: chatWith || null,
    reply: chatReplyTo ? chatReplyTo.id : null, ...data }).catch(() => ({ ok: false, error: "That didn't send. Check your internet connection." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) { chatError(res.error); return false; }
  chatReplyTo = null;
  drawReplyBar();
  if (asked === chatWith) addChat(res);
  drawChat("bottom");
  return true;
}

// A GIF or a voice message from the page: the app uploads it and sends it.
async function sendUpload(path, body, headers, where) {
  const thread = where === "thread" && chatPane && chatPane.kind === "thread" ? chatPane : null;
  const reply = thread ? thread.reply : chatReplyTo;
  const res = await fetch(path, { method: "POST", body, headers: { ...headers,
    "X-With": encodeURIComponent(chatWith || ""), "X-Reply": reply ? String(reply.id) : "", "X-Thread": thread ? String(thread.id) : "" } })
    .then((r) => r.json()).catch(() => ({ ok: false, error: "That didn't send. Check your internet connection." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) { chatError(res.error); return false; }
  if (thread) { thread.reply = null; thread.scrollDown = true; loadThread(); }
  else { chatReplyTo = null; drawReplyBar(); }
  pollChat(0);
  return true;
}

// ---- GIFs and stickers

const STICKERS = [
  { id: "gg", text: "GG", bg: "#ffd43b", fg: "#1b1b1b", rot: -6 },
  { id: "w", text: "W", bg: "#40c057", fg: "#fff", rot: 4 },
  { id: "l", text: "L", bg: "#fa5252", fg: "#fff", rot: -4 },
  { id: "lol", text: "LOL", bg: "#ff922b", fg: "#fff", rot: 5 },
  { id: "no-way", text: "NO WAY", bg: "#7950f2", fg: "#fff", rot: -5 },
  { id: "lets-go", text: "LET'S GO!", bg: "#12b886", fg: "#fff", rot: 3 },
  { id: "clip-it", text: "CLIP IT!", bg: "#e64980", fg: "#fff", rot: -3 },
  { id: "brb", text: "BRB", bg: "#339af0", fg: "#fff", rot: 4 },
  { id: "rip", text: "RIP", bg: "#495057", fg: "#fff", rot: -6 },
  { id: "sus", text: "SUS", bg: "#f03e3e", fg: "#fff", rot: 6 },
  { id: "hype", text: "HYPE", bg: "#f59f00", fg: "#1b1b1b", rot: -4 },
  { id: "oof", text: "OOF", bg: "#868e96", fg: "#fff", rot: 5 },
  { id: "nice", text: "NICE", bg: "#20c997", fg: "#fff", rot: -3 },
  { id: "ty", text: "TY!", bg: "#f783ac", fg: "#fff", rot: 4 },
  { id: "huh", text: "?!", bg: "#fab005", fg: "#1b1b1b", rot: -7 },
  { id: "on-air", text: "ON AIR", bg: "#e03131", fg: "#fff", rot: 0, dot: true },
  { id: "fire", emoji: "🔥" }, { id: "skull", emoji: "💀" }, { id: "eyes", emoji: "👀" }, { id: "crying", emoji: "😭" },
  { id: "party", emoji: "🥳" }, { id: "clap", emoji: "👏" }, { id: "film", emoji: "🎬" }, { id: "game", emoji: "🎮" },
];

function chatStickerEl(id, small = false) {
  const s = STICKERS.find((x) => x.id === id);
  const box = cpEl("div", "chat-sticker" + (small ? " small" : ""));
  if (!s) { box.textContent = "🏷️"; return box; }
  if (s.emoji) {
    box.classList.add("emoji");
    box.textContent = s.emoji;
    return box;
  }
  const len = s.text.length;
  const size = len <= 2 ? 46 : len <= 4 ? 34 : len <= 6 ? 26 : 21;
  box.innerHTML = `<svg viewBox="0 0 160 110" style="transform: rotate(${s.rot}deg)" aria-label="${s.text}">
    <rect x="8" y="12" width="144" height="86" rx="26" fill="rgba(0,0,0,.28)" transform="translate(3 5)"/>
    <rect x="8" y="12" width="144" height="86" rx="26" fill="#fff"/>
    <rect x="15" y="19" width="130" height="72" rx="20" fill="${s.bg}"/>
    ${s.dot ? '<circle cx="36" cy="55" r="7" fill="#fff"/>' : ""}
    <text x="${s.dot ? 88 : 80}" y="56" text-anchor="middle" dominant-baseline="central" fill="${s.fg}"
      font-family="Arial Black, Segoe UI Black, Impact, sans-serif" font-weight="900" font-size="${size}">${s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
  </svg>`;
  return box;
}

function chatGifEl(m) {
  const box = cpEl("div", "chat-gif");
  if (!m.gifUrl) { box.classList.add("gone"); box.textContent = "This GIF is gone."; return box; }
  const img = cpEl("img");
  img.src = m.gifUrl;
  img.alt = m.file_name || "GIF";
  img.loading = "lazy";
  img.addEventListener("load", () => { const list = $("chatList"); if (list.scrollHeight - list.scrollTop - list.clientHeight < img.height + 120) list.scrollTop = list.scrollHeight; }, { once: true });
  const saved = savedGifs().includes(gifKey(m));
  box.append(img, cpButton("chat-gif-star" + (saved ? " on" : ""), CP_ICONS.star, saved ? "Remove from your GIFs" : "Save to your GIFs", (e, b) => {
    toggleSavedGif(gifKey(m), m.gifUrl);
    b.classList.toggle("on");
  }));
  return box;
}

// Your GIFs (the ones you sent or starred), so you can send them again in one click.
const gifKey = (m) => m.gif === "@file" ? m.gifUrl : m.gif;
function savedGifs() { return (loadPref("chatGifs") || []).map((g) => g.url); }
function toggleSavedGif(url, show) {
  const list = loadPref("chatGifs") || [];
  const has = list.some((g) => g.url === url);
  savePref("chatGifs", has ? list.filter((g) => g.url !== url) : [{ url, show: show || url }, ...list].slice(0, 60));
}
function rememberGif(url) {
  if (!url) return;
  const list = (loadPref("chatGifs") || []).filter((g) => g.url !== url);
  savePref("chatGifs", [{ url, show: url }, ...list].slice(0, 60));
}

$("chatGifBtn").innerHTML = CP_ICONS.gif;
$("chatGifBtn").addEventListener("click", (e) => { e.stopPropagation(); openGifPicker("gifs"); });

function openGifPicker(tab) {
  const pop = openPop($("chatGifBtn"), "gif-pop");
  if (pop.hidden !== false && !pop.isConnected) return;
  const tabs = cpEl("div", "gif-tabs");
  const body = cpEl("div", "gif-body");
  const draw = (which) => {
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === which));
    body.replaceChildren();
    if (which === "stickers") {
      const grid = cpEl("div", "sticker-grid");
      for (const s of STICKERS) {
        const b = cpEl("button", "sticker-pick");
        b.type = "button";
        b.title = s.text || s.emoji;
        b.append(chatStickerEl(s.id, true));
        b.addEventListener("click", async (ev) => { ev.stopPropagation(); closePop(); await sendExtra({ sticker: s.id }); });
        grid.append(b);
      }
      body.append(grid);
      return;
    }
    const row = cpEl("form", "gif-link");
    const input = cpEl("input");
    input.placeholder = "Paste a GIPHY or Tenor link";
    input.spellcheck = false;
    const go = cpEl("button", "small-button", "Send");
    go.type = "submit";
    row.append(input, go);
    row.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const url = input.value.trim();
      if (!url) return input.focus();
      go.disabled = true;
      const ok = await sendExtra({ gif: url });
      go.disabled = false;
      if (ok) { rememberGif(url); closePop(); }
    });
    input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape") closePop(); });
    const pc = cpButton("outline-button gif-pc", CP_ICONS.file, null, () => { closePop(); $("chatGifFile").click(); });
    pc.append(document.createTextNode("Pick a GIF from your PC"));
    body.append(row, pc);
    const list = loadPref("chatGifs") || [];
    body.append(cpEl("h5", "", list.length ? "Your GIFs" : "Your GIFs show up here"));
    if (!list.length) body.append(cpEl("p", "gif-empty", "GIFs you send, and ones you star in the chat, are kept here so you can send them again."));
    const grid = cpEl("div", "gif-grid");
    for (const g of list) {
      const b = cpEl("button", "gif-cell");
      b.type = "button";
      const img = cpEl("img");
      img.src = g.show;
      img.loading = "lazy";
      img.alt = "GIF";
      b.append(img);
      b.title = "Send it";
      b.addEventListener("click", async (ev) => { ev.stopPropagation(); closePop(); if (await sendExtra({ gif: g.url })) rememberGif(g.url); });
      b.addEventListener("contextmenu", (ev) => { ev.preventDefault(); toggleSavedGif(g.url); draw("gifs"); });
      grid.append(b);
    }
    body.append(grid);
    if (list.length) body.append(cpEl("p", "gif-empty", "Right-click a GIF to take it out."));
    setTimeout(() => input.focus(), 0);
  };
  for (const [key, label] of [["gifs", "GIFs"], ["stickers", "Stickers"]]) {
    const b = cpEl("button", "", label);
    b.type = "button";
    b.dataset.tab = key;
    b.addEventListener("click", (ev) => { ev.stopPropagation(); draw(key); placePop($("chatGifBtn")); });
    tabs.append(b);
  }
  pop.append(tabs, body);
  draw(tab);
}

async function sendGifFile(file, where = "main") {
  if (!file) return;
  if (!/gif$/i.test(file.type) && !/\.gif$/i.test(file.name)) return chatError("That isn't a GIF.");
  if (file.size > 10 * 1024 * 1024) return chatError("That GIF is too big. GIFs can be up to 10 MB.");
  chatError("");
  $("chatNote").textContent = "Sending the GIF...";
  $("chatNote").classList.add("busy");
  const ok = await sendUpload("/api/chat-gif", file, { "X-File-Name": encodeURIComponent(file.name) }, where);
  $("chatNote").classList.remove("busy");
  if (ok) chatError("");
}
$("chatGifFile").addEventListener("change", () => {
  const file = $("chatGifFile").files[0];
  $("chatGifFile").value = "";
  sendGifFile(file);
});
// Drop a GIF on the chat to send it.
$("chatList").addEventListener("dragover", (e) => { if ([...(e.dataTransfer.items || [])].some((i) => i.type === "image/gif")) e.preventDefault(); });
$("chatList").addEventListener("drop", (e) => {
  const file = [...(e.dataTransfer.files || [])].find((f) => f.type === "image/gif");
  if (!file) return;
  e.preventDefault();
  sendGifFile(file);
});

// ---- voice messages

let voice = null; // the recording: {where, stream, rec, chunks, peaks, started, timer, ctx, analyser}
const VOICE_MAX = 600;

async function startVoice(where) {
  if (voice) return;
  if (!sfxUser()) return openLogin("login");
  closePop();
  let stream;
  try {
    const mic = loadPref("callMic");
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(mic ? { deviceId: { ideal: mic } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    return chatError("Couldn't use your microphone. Check it in Settings > Sound devices.");
  }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : {});
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  voice = { where, stream, rec, chunks: [], levels: [], started: Date.now(), ctx, analyser, send: false };
  rec.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) voice && voice.chunks.push(e.data); });
  rec.addEventListener("stop", finishVoice);
  rec.start(500);
  const buf = new Float32Array(analyser.fftSize);
  voice.timer = setInterval(() => {
    if (!voice) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    voice.levels.push(Math.sqrt(sum / buf.length));
    drawVoiceBar();
    if ((Date.now() - voice.started) / 1000 >= VOICE_MAX) stopVoice(true);
  }, 80);
  drawVoiceBar(true);
}

// Stop recording: send = true sends it, false throws it away.
function stopVoice(send) {
  if (!voice) return;
  voice.send = send;
  clearInterval(voice.timer);
  if (voice.rec.state !== "inactive") voice.rec.stop();
  else finishVoice();
}

async function finishVoice() {
  const v = voice;
  if (!v || v.finished) return;
  v.finished = true;
  v.stream.getTracks().forEach((t) => t.stop());
  v.ctx.close().catch(() => {});
  voice = null;
  drawVoiceBar(true);
  const seconds = (Date.now() - v.started) / 1000;
  if (!v.send) return;
  if (seconds < 0.8) return chatError("That was too short. Click the microphone, talk, then click send.");
  // 48 bars for the little waveform, loudest = 100.
  const n = 48, levels = v.levels.length ? v.levels : [0];
  const bars = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * levels.length / n), b = Math.max(a + 1, Math.floor((i + 1) * levels.length / n));
    bars.push(Math.max(...levels.slice(a, b)));
  }
  const top = Math.max(...bars, 0.0001);
  const peaks = bars.map((x) => Math.round(Math.pow(x / top, 0.7) * 100));
  chatError("");
  $("chatNote").textContent = "Sending the voice message...";
  $("chatNote").classList.add("busy");
  const blob = new Blob(v.chunks, { type: v.rec.mimeType || "audio/webm" });
  const ok = await sendUpload("/api/chat-voice", blob, { "X-Seconds": seconds.toFixed(2), "X-Peaks": encodeURIComponent(JSON.stringify(peaks)) }, v.where);
  $("chatNote").classList.remove("busy");
  if (ok) chatError("");
}

function drawVoiceBar(force) {
  const box = $("chatRec");
  const on = !!voice && voice.where === "main";
  $("chatForm").classList.toggle("recording", on);
  box.hidden = !on;
  const paneForm = document.querySelector(".pane-form");
  if (paneForm) paneForm.classList.toggle("recording", !!voice && voice.where === "thread");
  let target = on ? box : null;
  if (voice && voice.where === "thread" && paneForm) {
    target = paneForm.querySelector(".chat-rec");
    if (!target) { target = cpEl("div", "chat-rec"); paneForm.querySelector(".chat-box").append(target); }
  }
  if (!voice) { document.querySelectorAll(".pane-form .chat-rec").forEach((x) => x.remove()); return box.replaceChildren(); }
  if (!target) return;
  if (force || !target.firstChild) {
    const bars = cpEl("div", "rec-bars");
    for (let i = 0; i < 40; i++) bars.append(cpEl("i"));
    target.replaceChildren(cpButton("icon-button rec-cancel", CP_ICONS.trash, "Throw it away", () => stopVoice(false)),
      cpEl("span", "rec-dot"), cpEl("span", "rec-time", "0:00"), bars,
      cpButton("small-button rec-send", CP_ICONS.send, "Send the voice message", () => stopVoice(true)));
  }
  const secs = Math.floor((Date.now() - voice.started) / 1000);
  target.querySelector(".rec-time").textContent = clock(secs, false);
  const levels = voice.levels.slice(-40);
  const top = 0.25;
  target.querySelectorAll(".rec-bars i").forEach((el, i) => {
    const v = levels[i - (40 - levels.length)];
    el.style.height = v == null ? "3px" : Math.max(3, Math.min(26, Math.pow(Math.min(1, v / top), 0.6) * 26)) + "px";
  });
}
$("chatMic").innerHTML = CP_ICONS.mic;
$("chatMic").addEventListener("click", () => startVoice("main"));

// A voice message: play it, see where you are, click the waveform to jump, change the speed.
let voiceSpeed = loadPref("chatVoiceSpeed") || 1;
function chatVoiceEl(m) {
  const playing = chatPlaying === m.id && !chatAudio.paused;
  const box = cpEl("div", "chat-voice" + (chatPlaying === m.id ? " playing" : ""));
  box.dataset.voice = m.id;
  const play = cpButton("play", playing ? SFX_ICONS.pause : SFX_ICONS.play, playing ? "Pause" : "Play", () => {
    playChatSound(m, m.fileUrl, "Voice message");
    chatAudio.playbackRate = voiceSpeed;
  });
  const bars = cpEl("div", "voice-bars");
  const peaks = m.peaks && m.peaks.length ? m.peaks : Array.from({ length: 48 }, (_, i) => 30 + 25 * Math.sin(i * 1.7) * Math.sin(i * 0.4));
  peaks.forEach((p) => { const i = cpEl("i"); i.style.height = Math.max(12, p) + "%"; bars.append(i); });
  bars.title = "Click to jump";
  bars.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = bars.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (chatPlaying !== m.id) { playChatSound(m, m.fileUrl, "Voice message"); chatAudio.playbackRate = voiceSpeed; }
    const go = () => { if (chatAudio.duration) chatAudio.currentTime = at * chatAudio.duration; };
    chatAudio.readyState >= 1 ? go() : chatAudio.addEventListener("loadedmetadata", go, { once: true });
  });
  const time = cpEl("span", "voice-time", clock(m.file_seconds || 0, false));
  const speed = cpButton("voice-speed", null, "Play faster", () => {
    voiceSpeed = voiceSpeed === 1 ? 1.5 : voiceSpeed === 1.5 ? 2 : 1;
    savePref("chatVoiceSpeed", voiceSpeed);
    if (chatPlaying !== null) chatAudio.playbackRate = voiceSpeed;
    document.querySelectorAll(".voice-speed").forEach((b) => { b.textContent = voiceSpeed + "×"; });
  });
  speed.textContent = voiceSpeed + "×";
  box.append(play, bars, time, speed);
  setDrag(box, { kind: "sound", url: m.fileUrl, name: `Voice message from ${m.username}` });
  if (chatPlaying === m.id) requestAnimationFrame(voiceProgress);
  return box;
}

function voiceProgress() {
  if (chatPlaying === null) return;
  const d = chatAudio.duration || 0;
  const at = d ? chatAudio.currentTime / d : 0;
  document.querySelectorAll(`.chat-voice[data-voice="${chatPlaying}"]`).forEach((box) => {
    const bars = box.querySelectorAll(".voice-bars i");
    const on = Math.round(at * bars.length);
    bars.forEach((b, i) => b.classList.toggle("on", i < on));
    box.querySelector(".voice-time").textContent = clock(chatAudio.currentTime || 0, false);
  });
}
chatAudio.addEventListener("timeupdate", voiceProgress);
chatAudio.addEventListener("play", () => {
  const m = chatMessages.find((x) => x.id === chatPlaying) || (chatPane && [chatPane.parent, ...(chatPane.messages || [])].find((x) => x && x.id === chatPlaying));
  chatAudio.playbackRate = m && m.voice ? voiceSpeed : 1;
  if (chatPane) drawPane();
});
chatAudio.addEventListener("pause", () => { if (chatPane) drawPane(); });

// ---- polls

function chatPollEl(m, where) {
  const poll = m.poll;
  const box = cpEl("div", "chat-poll" + (poll.closed ? " closed" : ""));
  const head = cpEl("div", "poll-head");
  head.innerHTML = CP_ICONS.poll;
  head.append(cpEl("b", "", poll.q));
  box.append(head);
  const votes = new Map((m.votes || []).map((v) => [v.choice, v]));
  const total = (m.votes || []).reduce((a, v) => a + v.count, 0);
  const voted = (m.votes || []).some((v) => v.mine);
  const top = Math.max(0, ...(m.votes || []).map((v) => v.count));
  poll.options.forEach((text, i) => {
    const v = votes.get(i);
    const count = v ? v.count : 0;
    const pct = total ? Math.round(100 * count / total) : 0;
    const b = cpEl("button", "poll-option" + (v && v.mine ? " mine" : "") + (poll.closed && count && count === top ? " won" : ""));
    b.type = "button";
    b.disabled = !!poll.closed;
    b.title = v ? v.who : poll.closed ? "No votes" : "Vote for this";
    const fill = cpEl("span", "poll-fill");
    fill.style.width = (voted || poll.closed ? pct : 0) + "%";
    const mark = cpEl("span", "poll-mark" + (poll.multi ? " multi" : ""));
    b.append(fill, mark, cpEl("span", "poll-text", text));
    if (voted || poll.closed) b.append(cpEl("span", "poll-count", `${pct}%`));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const mine = (m.votes || []).filter((x) => x.mine).map((x) => x.choice);
      let choices = poll.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : (mine.includes(i) ? [] : [i]);
      votePoll(m, choices, where);
    });
    box.append(b);
  });
  const foot = cpEl("div", "poll-foot");
  const people = m.voters || 0;
  foot.append(cpEl("span", "", `${people} ${people === 1 ? "vote" : "votes"}` + (poll.multi ? " · pick as many as you like" : "") + (poll.closed ? " · Poll ended" : "")));
  if (m.mine && !poll.closed) {
    const end = cpEl("button", "link", "End the poll");
    end.type = "button";
    end.addEventListener("click", async (e) => {
      e.stopPropagation();
      const res = await api("/api/sfx-chat-poll", { id: m.id, what: "end" }).catch(() => ({ ok: false, error: "Couldn't end the poll." }));
      if (!res.ok) return chatError(res.error);
      m.poll = { ...poll, closed: true };
      drawChat(true);
      drawPane(true);
      pollChat(200);
    });
    foot.append(end);
  }
  box.append(foot);
  return box;
}

async function votePoll(m, choices, where) {
  // Show it right away; the next check brings everyone's votes.
  const me = meName();
  const list = (m.votes || []).map((v) => ({ ...v }));
  for (const v of list) if (v.mine && !choices.includes(v.choice)) Object.assign(v, { count: v.count - 1, mine: false });
  for (const c of choices) {
    const v = list.find((x) => x.choice === c);
    if (!v) list.push({ choice: c, count: 1, mine: true, who: me });
    else if (!v.mine) Object.assign(v, { count: v.count + 1, mine: true });
  }
  const hadVote = (m.votes || []).some((v) => v.mine);
  m.votes = list.filter((v) => v.count > 0);
  m.voters = Math.max(0, (m.voters || 0) + (choices.length && !hadVote ? 1 : !choices.length && hadVote ? -1 : 0));
  drawChat(true);
  drawPane(true);
  const res = await api("/api/sfx-chat-poll", { id: m.id, what: "vote", choices }).catch(() => ({ ok: false, error: "Couldn't vote." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) chatError(res.error);
  pollChat(200);
  if (where !== "main") loadThread();
}

function openPollModal() {
  if (!sfxUser()) return openLogin("login");
  $("pollQuestion").value = "";
  $("pollMulti").checked = false;
  $("pollNote").textContent = "";
  drawPollOptions(["", ""]);
  $("pollModal").hidden = false;
  $("pollQuestion").focus();
}
function drawPollOptions(values) {
  const box = $("pollOptions");
  box.replaceChildren(...values.map((v, i) => {
    const row = cpEl("div", "poll-edit-row");
    const wrap = cpEl("label", "input");
    const input = cpEl("input");
    input.maxLength = 80;
    input.placeholder = `Answer ${i + 1}`;
    input.value = v;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const inputs = [...box.querySelectorAll("input")];
        const next = inputs[i + 1];
        if (next) next.focus();
        else if (inputs.length < 10) { drawPollOptions([...pollValues(), ""]); box.querySelectorAll("input")[i + 1].focus(); }
      }
    });
    wrap.append(input);
    row.append(wrap);
    if (values.length > 2) row.append(cpButton("icon-button", ICONS.remove, "Take this answer out", () => {
      const vals = pollValues();
      vals.splice(i, 1);
      drawPollOptions(vals);
    }));
    return row;
  }));
  $("pollAdd").hidden = values.length >= 10;
}
const pollValues = () => [...$("pollOptions").querySelectorAll("input")].map((x) => x.value);
$("pollAdd").addEventListener("click", () => { drawPollOptions([...pollValues(), ""]); const all = $("pollOptions").querySelectorAll("input"); all[all.length - 1].focus(); });
$("pollCancel").addEventListener("click", () => { $("pollModal").hidden = true; });
$("pollModal").addEventListener("click", (e) => { if (e.target === $("pollModal")) $("pollModal").hidden = true; });
$("pollModal").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); $("pollModal").hidden = true; } });
$("pollSend").addEventListener("click", async () => {
  const q = $("pollQuestion").value.trim();
  const options = pollValues().map((x) => x.trim()).filter(Boolean);
  if (!q) { $("pollNote").textContent = "Write the question first."; return $("pollQuestion").focus(); }
  if (options.length < 2) { $("pollNote").textContent = "Give it at least 2 answers."; return; }
  $("pollSend").disabled = true;
  const ok = await sendExtra({ poll: { q, options, multi: $("pollMulti").checked } });
  $("pollSend").disabled = false;
  if (ok) $("pollModal").hidden = true;
  else $("pollNote").textContent = $("chatNote").textContent;
});

// ---- link cards: YouTube and Steam play right here, other pages show their title and picture

const LINK_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

function chatLinks(text) { return [...new Set((text || "").match(LINK_RE) || [])].slice(0, 2); }

function chatLinkCards(m, body) {
  for (const url of chatLinks(m.message)) {
    const holder = cpEl("div", "chat-card-slot");
    body.append(holder);
    const card = chatCards.get(url);
    if (card && !(card instanceof Promise)) { holder.replaceWith(linkCardEl(card)); continue; }
    if (card === null) { holder.remove(); continue; }
    let p = card;
    if (!p) {
      p = api("/api/sfx-chat-link", { url }).then((res) => { const c = res && res.ok ? res.card || null : null; chatCards.set(url, c); return c; })
        .catch(() => { chatCards.set(url, null); return null; });
      chatCards.set(url, p);
    }
    p.then((c) => {
      if (!holder.isConnected) return;
      const list = holder.closest(".chat-list, .pane-list");
      const atBottom = list && list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (c) holder.replaceWith(linkCardEl(c)); else holder.remove();
      if (list && atBottom) list.scrollTop = list.scrollHeight;
    });
  }
}

function linkCardEl(c) {
  if (c.kind === "gif" || c.kind === "image") {
    const box = cpEl("div", "chat-gif");
    const img = cpEl("img");
    img.src = c.gif || c.thumb || c.url;
    img.alt = "";
    img.loading = "lazy";
    box.append(img);
    if (c.kind === "image") { box.classList.add("link"); box.addEventListener("click", () => api("/api/games-open", { url: c.url })); }
    return box;
  }
  const card = cpEl("div", "chat-card k-" + c.kind);
  if (c.kind === "youtube") {
    const shot = cpEl("button", "chat-card-shot");
    shot.type = "button";
    shot.title = "Play it here";
    const img = cpEl("img");
    img.src = c.thumb;
    img.alt = "";
    img.loading = "lazy";
    const play = cpEl("span", "chat-card-play");
    play.innerHTML = CP_ICONS.play;
    shot.append(img, play);
    shot.addEventListener("click", (e) => { e.stopPropagation(); openWatch(c.url, { title: c.title, sub: c.author }); });
    const text = cpEl("div", "chat-card-text");
    text.append(cpEl("small", "chat-card-site yt", "YouTube"), cpEl("b", "", c.title));
    if (c.author) text.append(cpEl("span", "", c.author));
    card.append(text, shot);
    return card;
  }
  if (c.kind === "steam") {
    const shot = cpEl("div", "chat-card-shot");
    const img = cpEl("img");
    img.src = c.thumb;
    img.alt = "";
    img.loading = "lazy";
    shot.append(img);
    if (c.movie) {
      const play = cpButton("chat-card-play", CP_ICONS.play, "Play the trailer here", () => playCardTrailer(shot, c.movie));
      shot.append(play);
    }
    const text = cpEl("div", "chat-card-text");
    text.append(cpEl("small", "chat-card-site steam", "Steam"), cpEl("b", "", c.title));
    const price = cpEl("div", "chat-card-price");
    if (c.discount) price.append(cpEl("span", "off", `-${c.discount}%`), cpEl("s", "", c.was));
    if (c.price) price.append(cpEl("span", "", c.price));
    else if (c.soon) price.append(cpEl("span", "", c.release ? "Coming " + c.release : "Coming soon"));
    if (c.reviews) price.append(cpEl("small", "", c.reviews));
    if (price.childNodes.length) text.append(price);
    if (c.text) text.append(cpEl("p", "", c.text));
    const go = cpButton("link", null, null, () => api("/api/games-open", { url: c.url }));
    go.textContent = "Open in Steam";
    text.append(go);
    card.append(text, shot);
    return card;
  }
  // any other page
  card.classList.add("link");
  const text = cpEl("div", "chat-card-text");
  if (c.site) text.append(cpEl("small", "chat-card-site", c.site));
  text.append(cpEl("b", "", c.title));
  if (c.text) text.append(cpEl("p", "", c.text));
  card.append(text);
  if (c.thumb) {
    const img = cpEl("img", "chat-card-thumb");
    img.src = c.thumb;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove());
    card.append(img);
  }
  card.title = c.url;
  card.addEventListener("click", () => api("/api/games-open", { url: c.url }));
  return card;
}

async function playCardTrailer(shot, movie) {
  const video = cpEl("video");
  Object.assign(video, { controls: true, autoplay: true, playsInline: true, poster: movie.thumb });
  shot.replaceChildren(video);
  shot.classList.add("playing");
  for (const [audio, stop] of appPlayers) if (!audio.paused) stop();
  const file = movie.webm || movie.mp4;
  if (file) video.src = file;
  else {
    try {
      const Hls = await gmLoadHls();
      const hls = new Hls();
      hls.loadSource(movie.hls);
      hls.attachMedia(video);
      video._hls = hls;
    } catch (e) {
      shot.replaceChildren(cpEl("p", "chat-card-bad", "Couldn't play the trailer here. Open it in Steam instead."));
      return;
    }
  }
  video.play().catch(() => {});
}

// ---- your status (Online, Away, Recording...) at the bottom left

function modeDot(person, cls = "") {
  const mode = MODES[(person && person.mode) || ""] || MODES[""];
  const dot = cpEl("i", "mode-dot " + cls + " m-" + ((person && person.mode) || "online"));
  dot.style.background = mode.color;
  dot.title = mode.label + (person && person.status ? " · " + person.status : "");
  return dot;
}

function modeText(person) {
  if (!person) return "";
  const label = person.mode ? MODES[person.mode].label : "";
  return [label, person.status].filter(Boolean).join(" · ");
}

function myPresence() {
  const me = sfxUser();
  if (!me) return null;
  const online = ((onlineInfo && onlineInfo.people) || []).find((p) => p.username === me.username);
  return { ...me, ...(online || {}), ...(myModeWanted || {}) };
}
let myModeWanted = null; // what you just picked (until the next check shows it)

let meDrawn = "";
function drawMe() {
  const btn = $("chatMe");
  const me = myPresence();
  btn.hidden = !me;
  if (!me) return;
  const sig = JSON.stringify([me.username, me.avatarUrl, me.mode, me.status]);
  if (sig === meDrawn) return;
  meDrawn = sig;
  const face = cpEl("span", "chat-me-face");
  face.append(avatarEl(me.avatarUrl || "", me.username), modeDot(me, "on-face"));
  const text = cpEl("span", "chat-me-text");
  text.append(cpEl("b", "", me.username), cpEl("small", "", modeText(me) || "Online · set a status"));
  btn.replaceChildren(face, text);
}

$("chatMe").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = openPop($("chatMe"), "mode-pop");
  if (!pop.isConnected) return;
  const me = myPresence();
  pop.append(cpEl("h5", "", "Your status"));
  for (const [key, m] of Object.entries(MODES)) {
    const b = cpEl("button", "pop-item" + ((me.mode || "") === key ? " on" : ""));
    b.type = "button";
    const dot = cpEl("i", "mode-dot");
    dot.style.background = m.color;
    b.append(dot, cpEl("b", "", m.label));
    b.addEventListener("click", (ev) => { ev.stopPropagation(); setMode(key, input.value); });
    pop.append(b);
  }
  const line = cpEl("form", "mode-line");
  const wrap = cpEl("label", "input");
  const input = cpEl("input");
  input.maxLength = 60;
  input.placeholder = "What are you up to? (like: Editing ep 4)";
  input.value = me.status || "";
  wrap.append(input);
  const save = cpEl("button", "small-button", "Save");
  save.type = "submit";
  line.append(wrap, save);
  line.addEventListener("submit", (ev) => { ev.preventDefault(); setMode(me.mode || "", input.value); });
  input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape") closePop(); });
  const clear = cpEl("button", "link", "Clear");
  clear.type = "button";
  clear.addEventListener("click", (ev) => { ev.stopPropagation(); setMode("", ""); });
  pop.append(line, clear);
  requestAnimationFrame(() => placePop($("chatMe")));
});

async function setMode(mode, status) {
  closePop();
  myModeWanted = { mode, status: (status || "").trim() };
  meDrawn = "";
  drawMe();
  const res = await api("/api/sfx-chat-mode", { mode, status: (status || "").trim() }).catch(() => ({ ok: false, error: "Couldn't change your status." }));
  if (!res.ok) { myModeWanted = null; meDrawn = ""; drawMe(); return chatError(res.error); }
  pollChat(0);
  setTimeout(() => { myModeWanted = null; }, 8000);
}

setInterval(() => { if (chatIsOpen()) drawMe(); }, 1500);
