// The live chat (a panel on the right) and "3 online" at the top right.
// The chat with everyone, private chats, Library sounds and clips in messages, reactions and @mentions.
// Uses $, api(), setDrag(), DRAG_HINT, ICONS, clock() from app.js, loadPref()/savePref() from theme.js,
// and sfxUser(), avatarEl(), sfxLoggedOut(), openLogin(), closeMenu(), SFX_ICONS from sfx.js.

const REACTIONS = ["👍", "😂", "🔥", "❤️", "😮", "😢"];

let chatWith = ""; // "" = the chat with everyone, else the username of a private chat
let chatMessages = [];
let chatLastId = 0; // the newest message we have, in this conversation
let chatLoaded = false; // the first load of this conversation is done
let chatTimer = null;
let chatBusy = false;
let chatUserId = null; // who the messages were loaded for
let chatPrivate = []; // your private chats, newest first
let chatEveryoneLast = 0; // the newest message in the chat with everyone
let chatNames = []; // everyone's username, for @mentions
let chatAttached = null; // {sound: {id, name}} or {clip: key, name}: sent with the next message
let chatMention = false; // someone @mentioned you in the chat with everyone and you haven't looked yet
let chatDrawn = ""; // what the list shows, so it's only redrawn when something changed
let chatShown = { with: null, id: 0 }; // the newest message already on screen, so only newer ones slide in
const chatSure = new Set(); // messages whose delete button was clicked once
// The newest message you've seen, per conversation ("" = everyone). Kept after the app closes.
let chatSeen = loadPref("chatSeen") || {};

function chatIsOpen() { return !$("chatPanel").hidden; }
function chatSoundOn() { return loadPref("chatSound") !== false; }

// ---- "3 online"

let onlineInfo = null;
function renderOnline(online) {
  onlineInfo = online || onlineInfo;
  $("chatOpen").hidden = !online && !chatIsOpen();
  if (!online) return;
  $("onlineText").textContent = `${online.online} online`;
  $("chatOpen").title = online.online === 1 ? "Just you right now. Open the live chat" : "Open the live chat";
  if (chatIsOpen()) drawOnline();
}

function personChip(person) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "who";
  el.title = "See " + person.username + "'s profile";
  el.append(avatarEl(person.avatarUrl, person.username), document.createTextNode(person.username));
  el.addEventListener("click", () => openProfile(person.username));
  return el;
}

function drawOnline() {
  const box = $("chatOnline");
  if (!onlineInfo) return box.replaceChildren();
  const people = onlineInfo.people || [];
  const others = Math.max(0, onlineInfo.online - people.length);
  box.replaceChildren(...people.slice(0, 12).map(personChip));
  const rest = others + Math.max(0, people.length - 12);
  if (rest || !people.length) {
    box.append(document.createTextNode(people.length ? `+ ${rest} more` : `${onlineInfo.online} online`));
  }
}

// ---- unread

function unreadIn(name) {
  if (name === "") return chatEveryoneLast > (chatSeen[""] || 0);
  const p = chatPrivate.find((x) => x.username === name);
  return !!p && !p.last_mine && p.last_id > (chatSeen[name.toLowerCase()] || 0);
}

function markSeen() {
  if (!chatIsOpen() || document.hidden || !chatLoaded) return;
  const key = chatWith.toLowerCase();
  if ((chatSeen[key] || 0) >= chatLastId) return;
  chatSeen = { ...chatSeen, [key]: chatLastId };
  if (!chatWith) chatMention = false;
  savePref("chatSeen", chatSeen);
}

function drawUnread() {
  const count = (unreadIn("") ? 1 : 0) + chatPrivate.filter((p) => unreadIn(p.username)).length;
  $("chatUnread").hidden = !count;
  $("chatUnread").textContent = chatMention ? "@" : count > 9 ? "9+" : count;
  if (chatIsOpen()) drawConvos();
}

// A short "ding" for new messages (made here, so there's no sound file).
let chatAudioCtx = null;
function chatDing() {
  if (!chatSoundOn()) return;
  try {
    chatAudioCtx = chatAudioCtx || new AudioContext();
    const now = chatAudioCtx.currentTime;
    [[880, 0], [1320, 0.09]].forEach(([freq, at]) => {
      const osc = chatAudioCtx.createOscillator(), gain = chatAudioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
      osc.connect(gain).connect(chatAudioCtx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.25);
    });
  } catch (e) { /* no sound, no problem */ }
}

function mentionsMe(text) {
  const me = sfxUser();
  if (!me || !text) return false;
  return new RegExp("(^|[^\\w.-])@" + me.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w.-])", "i").test(text);
}

// ---- the panel

function openChat(withUser) {
  closeMenu();
  $("chatPanel").hidden = false;
  $("chatOpen").classList.add("open");
  if (withUser !== undefined && withUser !== chatWith) switchChat(withUser);
  drawChatUser();
  drawOnline();
  drawConvos();
  chatDrawn = "";
  if (chatLoaded) drawChat(true);
  pollChat(0);
  if (sfxUser()) $("chatInput").focus();
}

function closeChat() {
  $("chatPanel").hidden = true;
  $("chatOpen").classList.remove("open");
  $("chatOpen").hidden = !onlineInfo;
  $("chatSuggest").hidden = true;
  stopChatAudio();
}

function switchChat(name) {
  chatWith = name || "";
  chatMessages = [];
  chatLastId = 0;
  chatLoaded = false;
  chatDrawn = "";
  $("chatList").replaceChildren();
  $("chatNote").textContent = "";
  drawConvos();
  pollChat(0);
}

function drawChatUser() {
  const user = sfxUser();
  $("chatOut").hidden = !!user;
  $("chatList").hidden = !user;
  $("chatForm").hidden = !user;
  $("chatConvos").hidden = !user;
  if (!user) {
    $("chatNote").textContent = "";
    $("chatPrivateHead").hidden = true;
    $("chatAttach").hidden = true;
  } else {
    drawAttach();
  }
}

// "Everyone" and your private chats, across the top of the panel.
function drawConvos() {
  const box = $("chatConvos");
  const chip = (label, name, avatar) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "convo" + (name === chatWith ? " active" : "") + (unreadIn(name) && name !== chatWith ? " unread" : "");
    if (avatar !== undefined) b.append(avatarEl(avatar, name));
    b.append(document.createTextNode(label));
    if (name === "" && chatMention && chatWith !== "") b.append(Object.assign(document.createElement("b"), { className: "at", textContent: "@" }));
    b.addEventListener("click", () => { if (name !== chatWith) switchChat(name); $("chatInput").focus(); });
    return b;
  };
  const list = [chip("Everyone", "")];
  const names = new Set();
  for (const p of chatPrivate) {
    names.add(p.username);
    list.push(chip(p.username, p.username, p.avatarUrl));
  }
  // A private chat you just started (no messages yet).
  if (chatWith && !names.has(chatWith)) list.push(chip(chatWith, chatWith, ""));
  box.replaceChildren(...list);
  const head = $("chatPrivateHead");
  head.hidden = !chatWith;
  if (chatWith) {
    head.replaceChildren(document.createTextNode("Private chat with "));
    const who = document.createElement("button");
    who.type = "button";
    who.className = "link";
    who.textContent = chatWith;
    who.addEventListener("click", () => openProfile(chatWith));
    head.append(who, document.createTextNode(". Only you two can see it."));
  }
  $("chatInput").placeholder = chatWith ? `Message ${chatWith}...` : "Say something... (@ to mention)";
}

// Checked every few seconds while the chat is open, less often while it's closed (for the unread number).
function pollChat(delay) {
  clearTimeout(chatTimer);
  chatTimer = setTimeout(loadChat, delay);
}

async function loadChat() {
  const user = sfxUser();
  if (!user) {
    chatMessages = []; chatLastId = 0; chatLoaded = false; chatUserId = null; chatPrivate = [];
    if (chatIsOpen()) drawChatUser();
    return pollChat(20000);
  }
  if (user.id !== chatUserId) {
    chatUserId = user.id;
    chatWith = "";
    chatPrivate = [];
    chatMessages = []; chatLastId = 0; chatLoaded = false; chatDrawn = "";
    $("chatList").replaceChildren();
    if (chatIsOpen()) { drawChatUser(); drawConvos(); }
  }
  if (chatBusy) return;
  chatBusy = true;
  const asked = chatWith;
  try {
    const res = await api("/api/sfx-chat", { after: chatLastId, with: chatWith || null }).catch(() => null);
    if (res && asked === chatWith && !sfxLoggedOut(res)) addChat(res);
  } finally {
    chatBusy = false;
    pollChat(chatIsOpen() && !document.hidden ? 2500 : document.hidden ? 60000 : 20000);
  }
}

function addChat(res) {
  if (!res.ok) {
    if (chatIsOpen()) $("chatNote").textContent = res.error;
    return;
  }
  if (res.online) renderOnline(res.online);
  let ding = false;
  // Private chats: a newer message from someone else means a ding.
  const before = new Map(chatPrivate.map((p) => [p.username, p.last_id]));
  chatPrivate = res.private || [];
  if (chatLoaded || chatUserId) {
    for (const p of chatPrivate) {
      if (!p.last_mine && before.size && p.last_id > (before.get(p.username) || 0)
          && (p.username !== chatWith || !chatIsOpen() || document.hidden)) ding = true;
    }
  }
  chatEveryoneLast = res.everyoneLast || 0;
  if (res.names) chatNames = res.names;

  const fresh = (res.messages || []).filter((m) => m.id > chatLastId);
  if (fresh.length) {
    chatLastId = fresh[fresh.length - 1].id;
    chatMessages = chatMessages.concat(fresh).slice(-300);
    if (chatLoaded) {
      const theirs = fresh.filter((m) => !m.mine);
      if (!chatWith && theirs.some((m) => mentionsMe(m.message))) {
        if (!chatIsOpen() || document.hidden) chatMention = true;
        ding = true;
      }
      if (theirs.length && (!chatIsOpen() || document.hidden)) ding = ding || !!chatWith || !chatIsOpen();
    }
  }
  if (!chatWith && !chatLoaded) {
    // The newest mention you haven't seen yet, from before the app opened.
    const seen = chatSeen[""] || 0;
    if (fresh.some((m) => m.id > seen && !m.mine && mentionsMe(m.message))) chatMention = true;
  }
  // Reactions and deleted messages, for the newest ones.
  const recent = res.recent || [];
  if (recent.length) {
    const ids = new Map(recent.map((r) => [r.id, r.reactions || []]));
    const oldest = Math.min(...recent.map((r) => r.id));
    chatMessages = chatMessages.filter((m) => m.id < oldest || ids.has(m.id));
    for (const m of chatMessages) if (ids.has(m.id)) m.reactions = ids.get(m.id);
  } else if (chatLoaded && res.messages) {
    chatMessages = []; // everything was deleted
  }
  if (ding && chatLoaded) chatDing();
  chatLoaded = true;
  if (chatIsOpen()) drawChat();
  markSeen();
  drawUnread();
}

function chatTime(when) {
  return new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// The message text, with @names picked out (yours in the accent color).
function chatText(text) {
  const el = document.createElement("div");
  el.className = "text";
  const me = sfxUser() && sfxUser().username.toLowerCase();
  let last = 0;
  for (const match of text.matchAll(/(^|[^\w.-])@([A-Za-z0-9_.-]{3,20})/g)) {
    const at = match.index + match[1].length;
    el.append(text.slice(last, at));
    const name = match[2].replace(/[.-]+$/, "");
    const tag = document.createElement("span");
    tag.className = "mention" + (name.toLowerCase() === me ? " me" : "");
    tag.textContent = "@" + name;
    tag.addEventListener("click", () => openProfile(name));
    el.append(tag);
    last = at + 1 + name.length;
  }
  el.append(text.slice(last));
  return el;
}

// A Library sound or a clip in a message: play it, or drag it out like any sound.
let chatPlaying = null; // the message id playing
const chatAudio = new Audio();
chatAudio.addEventListener("ended", () => { chatPlaying = null; drawChat(true); });
function stopChatAudio() {
  chatAudio.pause();
  if (chatPlaying !== null) { chatPlaying = null; drawChat(true); }
}

function chatAttachment(m) {
  const sound = m.sound;
  const url = sound ? sound.url : m.fileUrl;
  const box = document.createElement("div");
  if (!url) {
    box.className = "chat-sound gone";
    box.textContent = `${m.file_name || "A sound"} was deleted.`;
    return box;
  }
  const name = sound ? sound.name : m.file_name || "Clip";
  const seconds = sound ? sound.seconds : m.file_seconds;
  box.className = "chat-sound" + (chatPlaying === m.id ? " playing" : "");
  setDrag(box, { kind: "sound", url, name });
  box.title = DRAG_HINT;
  const play = document.createElement("button");
  play.type = "button";
  play.className = "play";
  play.title = chatPlaying === m.id ? "Stop" : "Play";
  play.innerHTML = chatPlaying === m.id ? SFX_ICONS.pause : SFX_ICONS.play;
  play.addEventListener("click", () => {
    if (chatPlaying === m.id) return stopChatAudio();
    chatAudio.src = url;
    chatAudio.play().catch(() => {});
    chatPlaying = m.id;
    drawChat(true);
  });
  const info = document.createElement("div");
  info.className = "info";
  const title = document.createElement("b");
  title.textContent = name;
  const sub = document.createElement("span");
  sub.textContent = (sound ? "Library sound" : "Clip") + (seconds ? " · " + clock(seconds, false) : "");
  info.append(title, sub);
  box.append(play, info);
  return box;
}

function reactionRow(m) {
  const row = document.createElement("div");
  row.className = "reactions";
  for (const r of m.reactions || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "reaction" + (r.mine ? " mine" : "");
    b.title = r.who;
    b.textContent = `${r.emoji} ${r.count}`;
    b.addEventListener("click", () => react(m, r.emoji, !r.mine));
    row.append(b);
  }
  return row;
}

function drawChat(force) {
  const list = $("chatList");
  const sig = JSON.stringify([chatWith, chatPlaying, [...chatSure], chatMessages.map((m) => [m.id, m.reactions])]);
  if (!force && sig === chatDrawn) return;
  chatDrawn = sig;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const me = sfxUser();
  const canDeleteAll = me && !chatWith && (me.role === "owner" || me.role === "admin");
  if (!chatMessages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = chatLoaded ? (chatWith ? `No messages with ${chatWith} yet. Say hi!` : "No messages yet. Say hi!") : "Loading...";
    list.replaceChildren(empty);
    return;
  }
  const rows = [];
  let last = null;
  const firstDraw = chatShown.with !== chatWith;
  const shownUpTo = firstDraw ? Infinity : chatShown.id;
  chatShown = { with: chatWith, id: Math.max(...chatMessages.map((m) => m.id)) };
  for (const m of chatMessages) {
    const day = new Date(m.created_at).toDateString();
    if (!last || new Date(last.created_at).toDateString() !== day) {
      const d = document.createElement("div");
      d.className = "chat-day";
      d.textContent = day === new Date().toDateString() ? "Today"
        : new Date(m.created_at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
      rows.push(d);
    }
    // A message right after one from the same person (within 5 minutes) doesn't repeat the name.
    const follow = last && last.username === m.username && new Date(m.created_at) - new Date(last.created_at) < 300000
      && new Date(last.created_at).toDateString() === day;
    const el = document.createElement("div");
    el.className = "chat-msg" + (follow ? " follow" : "") + (!m.mine && mentionsMe(m.message) ? " mentions-me" : "")
      + (m.id > shownUpTo ? " new" : "");
    const face = avatarEl(m.avatarUrl, m.username);
    face.title = "See " + m.username + "'s profile";
    face.addEventListener("click", () => openProfile(m.username));
    el.append(face);
    const body = document.createElement("div");
    body.className = "body";
    if (!follow) {
      const line = document.createElement("div");
      line.className = "who-line";
      const name = document.createElement("button");
      name.type = "button";
      name.className = "name role-" + m.role;
      name.textContent = m.username;
      name.title = "See " + m.username + "'s profile";
      name.addEventListener("click", () => openProfile(m.username));
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = chatTime(m.created_at);
      line.append(name, when);
      body.append(line);
    }
    if (m.message) {
      const text = chatText(m.message);
      text.title = chatTime(m.created_at);
      body.append(text);
    }
    if (m.sound || m.file || m.shared_gone) body.append(chatAttachment(m));
    if ((m.reactions || []).length) body.append(reactionRow(m));
    el.append(body);

    // On hover: react, and delete (yours, or anyone's for the owner and admins).
    const tools = document.createElement("div");
    tools.className = "msg-tools";
    const pick = document.createElement("div");
    pick.className = "react-pick";
    for (const emoji of REACTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = emoji;
      b.title = "React with " + emoji;
      const mine = (m.reactions || []).some((r) => r.emoji === emoji && r.mine);
      b.addEventListener("click", () => react(m, emoji, !mine));
      pick.append(b);
    }
    tools.append(pick);
    if (m.mine || canDeleteAll) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-button del" + (chatSure.has(m.id) ? " sure" : "");
      del.title = chatSure.has(m.id) ? "Click again to delete" : "Delete";
      del.innerHTML = ICONS.remove;
      del.addEventListener("click", () => deleteChat(m.id));
      tools.append(del);
      if (chatSure.has(m.id)) el.classList.add("sure");
    }
    el.append(tools);
    rows.push(el);
    last = m;
  }
  list.replaceChildren(...rows);
  if (atBottom || force === "bottom") list.scrollTop = list.scrollHeight;
}

async function react(m, emoji, on) {
  // Show it right away; the next check brings the real numbers.
  const list = (m.reactions || []).map((r) => ({ ...r }));
  const found = list.find((r) => r.emoji === emoji);
  if (on && !found) list.push({ emoji, count: 1, mine: true, who: sfxUser().username });
  else if (on && found && !found.mine) Object.assign(found, { count: found.count + 1, mine: true });
  else if (!on && found && found.mine) Object.assign(found, { count: found.count - 1, mine: false });
  m.reactions = list.filter((r) => r.count > 0);
  drawChat();
  const res = await api("/api/sfx-chat-react", { id: m.id, emoji, on }).catch(() => ({ ok: false, error: "Couldn't save that." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) $("chatNote").textContent = res.error;
  pollChat(200);
}

async function deleteChat(id) {
  if (!chatSure.has(id)) {
    chatSure.add(id);
    drawChat();
    setTimeout(() => { if (chatSure.delete(id)) drawChat(); }, 3000);
    return;
  }
  chatSure.delete(id);
  const res = await api("/api/sfx-chat-delete", { id }).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) return void ($("chatNote").textContent = res.error);
  if (chatPlaying === id) stopChatAudio();
  chatMessages = chatMessages.filter((m) => m.id !== id);
  drawChat();
}

// ---- sending sounds and clips

// From a Library sound's "Send to chat" button or the trim editor's clip.
function shareToChat(what) {
  chatAttached = what;
  openChat();
  drawAttach();
  $("chatInput").focus();
}

function drawAttach() {
  const box = $("chatAttach");
  box.hidden = !chatAttached;
  if (!chatAttached) return;
  box.replaceChildren();
  const label = document.createElement("span");
  label.innerHTML = SFX_ICONS.play;
  label.className = "attach-icon";
  const text = document.createElement("span");
  text.className = "attach-name";
  text.textContent = (chatAttached.sound ? chatAttached.sound.name : chatAttached.name) + (chatAttached.clip ? " (clip)" : "");
  const x = document.createElement("button");
  x.type = "button";
  x.className = "icon-button";
  x.title = "Don't send it";
  x.innerHTML = ICONS.remove;
  x.addEventListener("click", () => { chatAttached = null; drawAttach(); });
  box.append(label, text, x);
}

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = $("chatInput").value.trim();
  if ((!message && !chatAttached) || $("chatSend").disabled) return;
  $("chatSend").disabled = true;
  $("chatSuggest").hidden = true;
  const attached = chatAttached;
  if (attached && attached.clip) $("chatNote").textContent = "Sending the clip...";
  const asked = chatWith;
  const res = await api("/api/sfx-chat-send", {
    message, after: chatLastId, with: chatWith || null,
    sound: attached && attached.sound ? attached.sound.id : null, clip: attached && attached.clip ? attached.clip : null,
  }).catch(() => ({ ok: false, error: "That didn't send. Check your internet connection." }));
  $("chatSend").disabled = false;
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) {
    $("chatNote").textContent = res.error;
    return;
  }
  $("chatInput").value = "";
  $("chatNote").textContent = "";
  if (chatAttached === attached) { chatAttached = null; drawAttach(); }
  if (asked === chatWith) addChat(res);
  drawChat("bottom");
  $("chatInput").focus();
});

// ---- @mentions: names to pick from while typing

function knownNames() {
  const names = new Map();
  const add = (n) => { if (n && !names.has(n.toLowerCase())) names.set(n.toLowerCase(), n); };
  ((onlineInfo && onlineInfo.people) || []).forEach((p) => add(p.username));
  chatPrivate.forEach((p) => add(p.username));
  [...chatMessages].reverse().forEach((m) => add(m.username));
  chatNames.forEach(add);
  if (sfxUser()) names.delete(sfxUser().username.toLowerCase());
  return [...names.values()];
}

let suggestPick = 0;
function suggestNames() {
  const input = $("chatInput");
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/(^|\s)@([A-Za-z0-9_.-]{0,20})$/);
  const box = $("chatSuggest");
  if (!match) return void (box.hidden = true);
  const typed = match[2].toLowerCase();
  const found = knownNames().filter((n) => n.toLowerCase().startsWith(typed)).slice(0, 6);
  if (!found.length) return void (box.hidden = true);
  suggestPick = Math.min(suggestPick, found.length - 1);
  box.replaceChildren(...found.map((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = i === suggestPick ? "active" : "";
    b.textContent = "@" + name;
    b.addEventListener("mousedown", (e) => { e.preventDefault(); useName(name); });
    return b;
  }));
  box.hidden = false;
}

function useName(name) {
  const input = $("chatInput");
  const at = input.selectionStart;
  const before = input.value.slice(0, at).replace(/@([A-Za-z0-9_.-]{0,20})$/, "@" + name + " ");
  input.value = before + input.value.slice(at);
  input.setSelectionRange(before.length, before.length);
  $("chatSuggest").hidden = true;
  input.focus();
}

$("chatInput").addEventListener("input", () => { $("chatNote").textContent = ""; suggestPick = 0; suggestNames(); });
$("chatInput").addEventListener("keydown", (e) => {
  const box = $("chatSuggest");
  if (box.hidden) return;
  const buttons = [...box.querySelectorAll("button")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggestPick = (suggestPick + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
    suggestNames();
  } else if (e.key === "Tab" || (e.key === "Enter" && buttons.length)) {
    e.preventDefault();
    useName(buttons[suggestPick].textContent.slice(1));
  } else if (e.key === "Escape") {
    e.stopPropagation();
    box.hidden = true;
  }
});
$("chatInput").addEventListener("blur", () => setTimeout(() => { $("chatSuggest").hidden = true; }, 150));

// Logged in or out (or as someone else).
function chatAccountChanged() {
  const user = sfxUser();
  if ((user && user.id) === chatUserId) return;
  if (chatIsOpen()) drawChatUser();
  pollChat(0);
}

$("chatOpen").addEventListener("click", (e) => { e.stopPropagation(); chatIsOpen() ? closeChat() : openChat(); });
$("chatClose").addEventListener("click", closeChat);
$("chatLogin").addEventListener("click", (e) => { e.stopPropagation(); closeChat(); openLogin("login"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && chatIsOpen() && $("profileModal").hidden) closeChat();
});
// Back to the window: check right away.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && sfxUser()) { markSeen(); pollChat(300); }
});

pollChat(1500);
