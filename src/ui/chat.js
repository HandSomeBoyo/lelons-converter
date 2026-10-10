// The chat (a whole page, Discord style: everyone, groups and private chats on the left) and "3 online" at the top right.
// The chat with everyone, group chats, private chats, Library sounds and clips in messages, reactions and @mentions.
// Uses $, api(), setDrag(), DRAG_HINT, ICONS, clock() from app.js, loadPref()/savePref() from theme.js,
// and sfxUser(), avatarEl(), sfxLoggedOut(), openLogin(), closeMenu(), SFX_ICONS from sfx.js.

const chatEls = new Map(); // message id (or "day ...") -> {el, sig}, see drawChat
const REACTIONS = ["👍", "😂", "🔥", "❤️", "😮", "😢"];

let chatWith = ""; // "" = the chat with everyone, "g:<id>" = a group chat, else the username of a private chat
let chatGroups = []; // your group chats, newest message first
let chatGroup = null; // the group chat that's open: {id, name, pictureUrl, owner, members}
const isGroupKey = (key) => !!key && key.startsWith("g:");
let chatMessages = [];
let chatLastId = 0; // the newest message we have, in this conversation
let chatLoaded = false; // the first load of this conversation is done
let chatListsLoaded = false; // the private chats and groups came in once (new ones after that ding)
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

let onlineDrawn = "";
function drawOnline() {
  const box = $("chatOnline");
  // Only when who's online changed: rebuilding the chips every moment swallows clicks on them.
  const sig = JSON.stringify(onlineInfo);
  if (sig === onlineDrawn) return;
  onlineDrawn = sig;
  if (!onlineInfo) return box.replaceChildren();
  const people = onlineInfo.people || [];
  const others = Math.max(0, onlineInfo.online - people.length);
  setChildren(box, people.slice(0, 12).map(personChip));
  const rest = others + Math.max(0, people.length - 12);
  if (rest || !people.length) {
    box.append(document.createTextNode(people.length ? `+ ${rest} more` : `${onlineInfo.online} online`));
  }
}

// ---- unread

function unreadIn(name) {
  if (name === "") return chatEveryoneLast > (chatSeen[""] || 0);
  if (isGroupKey(name)) {
    const g = chatGroups.find((x) => "g:" + x.id === name);
    return !!g && !!g.last_id && !g.last_mine && g.last_id > (chatSeen[name.toLowerCase()] || 0);
  }
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
  const count = (unreadIn("") ? 1 : 0) + chatPrivate.filter((p) => unreadIn(p.username)).length
    + chatGroups.filter((g) => unreadIn("g:" + g.id)).length;
  for (const badge of [$("chatUnread"), $("chatBadge")]) {
    badge.hidden = !count;
    badge.textContent = chatMention ? "@" : count > 9 ? "9+" : count;
  }
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
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.18 * volumeLevel() / 0.36), now + at + 0.015);
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
  $("chatButton").classList.add("open");
  document.body.classList.add("chat-page");
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
  $("chatButton").classList.remove("open");
  document.body.classList.remove("chat-page");
  $("chatOpen").hidden = !onlineInfo;
  $("chatSuggest").hidden = true;
  stopChatAudio();
  sendTyping(true);
}
window.addEventListener("pagehide", () => sendTyping(true));

function switchChat(name) {
  sendTyping(true); // (in the chat being left)
  chatTypingNames = [];
  chatSeenBy = [];
  drawTyping();
  chatWith = name || "";
  chatGroup = null;
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
    $("chatAttach").hidden = true;
  } else {
    drawAttach();
  }
}

// The list on the left: everyone, your groups and your private chats.
const CHAT_ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>',
  hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M16 11.5a2.8 2.8 0 1 0 0-5.6M16.5 14c2.2.3 3.6 2 4 5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

function groupPic(g, cls = "") {
  const el = avatarEl(g && g.pictureUrl, (g && g.name) || "?", "group-avatar " + cls);
  return el;
}

let convosDrawn = "";
function drawConvos() {
  const box = $("chatConvos");
  const sig = JSON.stringify([chatWith, chatMention, chatPrivate.map((p) => [p.username, p.avatarUrl, unreadIn(p.username)]),
    chatGroups.map((g) => [g.id, g.name, g.pictureUrl, g.people, unreadIn("g:" + g.id)]), unreadIn("")]);
  if (sig !== convosDrawn) {
    convosDrawn = sig;
    const row = (key, label, pic, sub) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chat-row" + (key === chatWith ? " active" : "") + (unreadIn(key) && key !== chatWith ? " unread" : "");
      b.append(pic);
      const text = document.createElement("span");
      text.className = "chat-row-text";
      text.append(Object.assign(document.createElement("b"), { textContent: label }));
      if (sub) text.append(Object.assign(document.createElement("small"), { textContent: sub }));
      b.append(text);
      if (key === "" && chatMention && chatWith !== "") b.append(Object.assign(document.createElement("i"), { className: "at", textContent: "@" }));
      b.addEventListener("click", () => { if (key !== chatWith) switchChat(key); $("chatInput").focus(); });
      return b;
    };
    const section = (title, addTitle, onAdd) => {
      const h = document.createElement("div");
      h.className = "chat-sec";
      h.append(Object.assign(document.createElement("span"), { textContent: title }));
      if (onAdd) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "chat-sec-add";
        add.title = addTitle;
        add.innerHTML = CHAT_ICONS.plus;
        add.addEventListener("click", onAdd);
        h.append(add);
      }
      return h;
    };
    const hash = Object.assign(document.createElement("span"), { className: "avatar chat-hash", innerHTML: CHAT_ICONS.hash });
    const list = [section("Channels"), row("", "everyone", hash)];
    list.push(section("Groups", "Make a group", () => openGroupModal("create")));
    for (const g of chatGroups) list.push(row("g:" + g.id, g.name, groupPic(g), `${g.people} ${g.people === 1 ? "person" : "people"}`));
    if (isGroupKey(chatWith) && !chatGroups.some((g) => "g:" + g.id === chatWith) && chatGroup) list.push(row(chatWith, chatGroup.name, groupPic(chatGroup)));
    if (!chatGroups.length) list.push(Object.assign(document.createElement("p"), { className: "chat-sec-empty", textContent: "Make a group with just the people you pick." }));
    list.push(section("Private messages", "New private message", () => openGroupModal("dm")));
    const names = new Set();
    for (const p of chatPrivate) {
      names.add(p.username);
      list.push(row(p.username, p.username, avatarEl(p.avatarUrl, p.username)));
    }
    // A private chat you just started (no messages yet).
    if (chatWith && !isGroupKey(chatWith) && !names.has(chatWith)) list.push(row(chatWith, chatWith, avatarEl("", chatWith)));
    else if (!chatPrivate.length) list.push(Object.assign(document.createElement("p"), { className: "chat-sec-empty", textContent: "Talk to one person, just you two." }));
    setChildren(box, list);
  }
  drawRoom();
  $("chatPrivateHead").hidden = true;
  $("chatInput").placeholder = isGroupKey(chatWith) ? `Message ${chatGroup ? chatGroup.name : "the group"}...`
    : chatWith ? `Message ${chatWith}...` : "Message everyone... (@ to mention)";
}

// The top of the chat: what you're in, and the group's buttons.
let roomDrawn = "";
function drawRoom() {
  const g = isGroupKey(chatWith) ? chatGroup || chatGroups.find((x) => "g:" + x.id === chatWith) : null;
  const sig = JSON.stringify([chatWith, g && [g.name, g.pictureUrl, (g.members || []).map((m) => m.username), g.people]]);
  const calls = typeof callWith === "function"; // (call.js loads after this file)
  const sig2 = sig + (calls ? JSON.stringify([callWith(chatWith), callLiveIn(chatWith)]) : "");
  if (sig2 === roomDrawn) return;
  roomDrawn = sig2;
  const room = $("chatRoom");
  const title = document.createElement("div");
  title.className = "chat-room-text";
  const h = document.createElement("h3");
  const sub = document.createElement("small");
  let pic;
  if (isGroupKey(chatWith)) {
    pic = groupPic(g || { name: "?" });
    h.textContent = g ? g.name : "Group";
    const members = (g && g.members) || [];
    sub.textContent = members.length ? `${members.length} ${members.length === 1 ? "person" : "people"}: ${members.map((m) => m.username).join(", ")}`
      : g ? `${g.people} people` : "";
  } else if (chatWith) {
    const p = chatPrivate.find((x) => x.username === chatWith);
    pic = avatarEl(p ? p.avatarUrl : "", chatWith);
    const who = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: chatWith, title: "See their profile" });
    who.addEventListener("click", () => openProfile(chatWith));
    h.append(who);
    sub.textContent = "Private chat. Only you two can see it.";
  } else {
    pic = Object.assign(document.createElement("span"), { className: "avatar chat-hash", innerHTML: CHAT_ICONS.hash });
    h.textContent = "everyone";
    sub.textContent = "Everyone with an account can read and write here.";
  }
  title.append(h, sub);
  room.replaceChildren(pic, title);
  const tools = [];
  if (isGroupKey(chatWith)) {
    const tool = (icon, label, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-button";
      b.title = label;
      b.innerHTML = icon;
      b.addEventListener("click", fn);
      return b;
    };
    tools.push(tool(CHAT_ICONS.people, "Add people", () => openGroupModal("edit", true)));
    tools.push(tool(CHAT_ICONS.gear, "Group settings: name, picture and people", () => openGroupModal("edit")));
  }
  if (chatWith && calls) {
    // Call them, or the whole group (or join the group's call that's going on).
    const inCall = callWith(chatWith);
    const live = !inCall && callLiveIn(chatWith);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "call-start" + (inCall ? " live" : live ? " join" : "");
    b.title = inCall ? "You're in this call" : live ? `Join the call (${live.people} in it)`
      : isGroupKey(chatWith) ? "Call everyone in the group. You can share your screen in the call."
      : `Call ${chatWith}. You can share your screen in the call.`;
    b.innerHTML = CALL_ICONS.phone;
    b.append(document.createTextNode(inCall ? "In call" : live ? `Join call · ${live.people}` : "Call"));
    b.disabled = inCall;
    b.addEventListener("click", () => callStart(chatWith));
    tools.push(b);
  }
  $("chatRoomTools").replaceChildren(...tools);
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
    chatPrivate = []; chatGroups = []; chatListsLoaded = false;
    chatMessages = []; chatLastId = 0; chatLoaded = false; chatDrawn = "";
    $("chatList").replaceChildren();
    if (chatIsOpen()) { drawChatUser(); drawConvos(); }
  }
  if (chatBusy) return;
  chatBusy = true;
  const asked = chatWith;
  const askedFor = chatUserId;
  let stale = false, more = false;
  try {
    const res = await api("/api/sfx-chat", { after: chatLastId, with: chatWith || null }).catch(() => null);
    // Switched to another chat (or account) while waiting: this answer is for the old one.
    stale = asked !== chatWith || askedFor !== chatUserId;
    if (res && !stale && !sfxLoggedOut(res)) addChat(res);
    more = !!(res && res.ok && chatLastId && (res.messages || []).length >= 100); // (more waiting: get them right away)
  } finally {
    chatBusy = false;
    pollChat(stale || more ? 0 : chatIsOpen() && !document.hidden ? 2500 : document.hidden ? 60000 : 20000);
  }
}

// ---- "typing..." and who has seen what (only while the chat is open)

let chatTypingNames = [];
let chatSeenBy = []; // [{username, avatarUrl, last_id}]
let chatLiveBusy = false;
async function loadChatLive() {
  if (chatLiveBusy || !sfxUser() || !chatIsOpen() || document.hidden) return;
  chatLiveBusy = true;
  const asked = chatWith;
  const newest = chatMessages.length ? chatMessages[chatMessages.length - 1].id : null;
  const res = await api("/api/sfx-chat-live", { with: chatWith || null, seen: newest }).catch(() => null);
  chatLiveBusy = false;
  if (!res || !res.ok || asked !== chatWith) return;
  chatTypingNames = res.typing || [];
  chatSeenBy = res.seen || [];
  drawTyping();
  drawSeen();
}

function drawTyping() {
  const names = chatTypingNames;
  $("chatTyping").hidden = !names.length;
  $("chatTypingText").textContent = !names.length ? ""
    : names.length === 1 ? `${names[0]} is typing`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
    : `${names[0]} and ${names.length - 1} others are typing`;
}

// Little faces under the last message each person has read.
function drawSeen() {
  const list = $("chatList");
  const at = new Map(); // message id -> people
  const ids = chatMessages.map((m) => m.id);
  for (const p of chatSeenBy) {
    let id = null;
    for (const mid of ids) if (mid <= p.last_id) id = mid;
    if (id === null) continue;
    if (!at.has(id)) at.set(id, []);
    at.get(id).push(p);
  }
  const sig = JSON.stringify([...at].map(([id, people]) => [id, people.map((p) => p.username + p.avatarUrl)]));
  if (list.dataset.seen === sig && list.querySelectorAll(".seen-by").length === at.size) return;
  list.dataset.seen = sig;
  list.querySelectorAll(".seen-by").forEach((el) => el.remove());
  for (const [id, people] of at) {
    const kept = chatEls.get(id);
    if (!kept || !kept.el.isConnected) continue;
    const box = document.createElement("div");
    box.className = "seen-by";
    box.title = "Seen by " + people.map((p) => p.username).join(", ");
    for (const p of people.slice(0, 8)) box.append(avatarEl(p.avatarUrl, p.username, "tiny"));
    if (people.length > 8) box.append(Object.assign(document.createElement("span"), { textContent: "+" + (people.length - 8) }));
    kept.el.querySelector(".body").append(box);
  }
}

// Tell the others you're typing (at most every 3 seconds), and that you stopped.
let chatTypingSent = 0;
function sendTyping(stop = false) {
  if (!sfxUser()) return;
  const now = Date.now();
  if (stop) {
    if (!chatTypingSent) return;
    chatTypingSent = 0;
  } else {
    if (now - chatTypingSent < 3000) return;
    chatTypingSent = now;
  }
  api("/api/sfx-chat-typing", { with: chatWith || null, stop }).catch(() => {});
}

function addChat(res) {
  if (!res.ok) {
    // (a group you're no longer in, or a person who renamed or deleted their account)
    if (chatWith && (/group is gone/.test(res.error || "") || /no account with that name/.test(res.error || ""))) {
      switchChat("");
      if (chatIsOpen()) $("chatNote").textContent = res.error;
      return;
    }
    if (chatIsOpen()) $("chatNote").textContent = res.error;
    return;
  }
  if (res.online) renderOnline(res.online);
  let ding = false;
  // Private chats: a newer message from someone else means a ding.
  const before = new Map(chatPrivate.map((p) => [p.username, p.last_id]));
  chatPrivate = res.private || [];
  if (chatListsLoaded) {
    for (const p of chatPrivate) {
      if (!p.last_mine && p.last_id > (before.get(p.username) || 0)
          && (p.username !== chatWith || !chatIsOpen() || document.hidden)) ding = true;
    }
  }
  const groupsBefore = new Map(chatGroups.map((g) => [g.id, g.last_id]));
  chatGroups = res.groups || [];
  if (chatListsLoaded) {
    for (const g of chatGroups) {
      if (!g.last_mine && g.last_id > (groupsBefore.get(g.id) || 0)
          && ("g:" + g.id !== chatWith || !chatIsOpen() || document.hidden)) ding = true;
    }
  }
  chatListsLoaded = true;
  if (isGroupKey(chatWith) && res.group) chatGroup = res.group;
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
  loadChatLive();
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
registerPlayer(chatAudio, stopChatAudio);
for (const type of ["play", "pause"]) chatAudio.addEventListener(type, () => { if (chatPlaying !== null) drawChat(true); });

// Play a sound or clip from a message (click again to pause).
function playChatSound(m, url, name) {
  if (chatPlaying === m.id && chatAudio.src) {
    if (!chatAudio.paused) return chatAudio.pause();
  } else {
    chatAudio.src = url;
    chatPlaying = m.id;
  }
  chatAudio.play().catch(() => {});
  drawChat(true);
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
  const playing = chatPlaying === m.id && !chatAudio.paused;
  play.title = playing ? "Pause" : "Play";
  play.innerHTML = playing ? SFX_ICONS.pause : SFX_ICONS.play;
  play.addEventListener("click", () => playChatSound(m, url, name));
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

// A call in a private chat: how long it was, or that nobody answered. Click to call back.
function chatCallLine(m) {
  const box = document.createElement("div");
  const missed = m.call_seconds <= 0, declined = m.call_seconds < 0, group = isGroupKey(chatWith);
  box.className = "chat-call" + (missed && !m.mine ? " missed" : "");
  const icon = Object.assign(document.createElement("span"), { className: "chat-call-icon", innerHTML: CALL_ICONS.phone });
  const text = document.createElement("div");
  text.className = "info";
  text.append(Object.assign(document.createElement("b"), {
    textContent: group ? (missed ? (m.mine ? "Nobody joined your call" : `Missed a call from ${m.username}`)
                                 : `${m.mine ? "You" : m.username} started a call`)
      : declined ? (m.mine ? "Call declined" : "You declined a call")
      : missed ? (m.mine ? "No answer" : "Missed call") : m.mine ? "You called" : `${m.username} called`,
  }));
  text.append(Object.assign(document.createElement("span"), { textContent: missed ? chatTime(m.created_at) : clock(m.call_seconds, false) }));
  box.append(icon, text);
  if (chatWith) {
    const again = Object.assign(document.createElement("button"), { type: "button", className: "link",
      textContent: group ? "Call" : m.mine ? "Call again" : "Call back" });
    again.addEventListener("click", () => callStart(chatWith));
    box.append(again);
  }
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
  const sig = JSON.stringify([chatWith, chatPlaying, chatAudio.paused, [...chatSure], chatMessages.map((m) => [m.id, m.reactions])]);
  if (!force && sig === chatDrawn) return;
  chatDrawn = sig;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const me = sfxUser();
  const canDeleteAll = me && chatWith === "" && (me.role === "owner" || me.role === "admin");
  if (!chatMessages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = !chatLoaded ? "Loading..."
      : isGroupKey(chatWith) ? `No messages in ${chatGroup ? chatGroup.name : "this group"} yet. Say hi!`
      : chatWith ? `No messages with ${chatWith} yet. Say hi!` : "No messages yet. Say hi!";
    list.replaceChildren(empty);
    return;
  }
  const rows = [];
  let last = null;
  const firstDraw = chatShown.with !== chatWith;
  const shownUpTo = firstDraw ? Infinity : chatShown.id;
  chatShown = { with: chatWith, id: Math.max(...chatMessages.map((m) => m.id)) };
  const keys = [];
  for (const m of chatMessages) {
    const day = new Date(m.created_at).toDateString();
    if (!last || new Date(last.created_at).toDateString() !== day) {
      const dayText = day === new Date().toDateString() ? "Today"
        : new Date(m.created_at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
      keys.push("day " + day);
      rows.push(keptNode(chatEls, "day " + day, dayText, () =>
        Object.assign(document.createElement("div"), { className: "chat-day", textContent: dayText })));
    }
    // A message right after one from the same person (within 5 minutes) doesn't repeat the name.
    const follow = last && last.username === m.username && new Date(m.created_at) - new Date(last.created_at) < 300000
      && new Date(last.created_at).toDateString() === day;
    // Messages that didn't change keep their element (so a click or a text selection on one survives).
    const sig = JSON.stringify([m, follow, chatPlaying === m.id, chatPlaying === m.id && chatAudio.paused, chatSure.has(m.id), canDeleteAll, me && me.username]);
    keys.push(m.id);
    rows.push(keptNode(chatEls, m.id, sig, () => chatMessageEl(m, follow, shownUpTo, canDeleteAll)));
    last = m;
  }
  forgetNodes(chatEls, keys);
  setChildren(list, rows);
  drawSeen();
  if (atBottom || force === "bottom") list.scrollTop = list.scrollHeight;
}

function chatMessageEl(m, follow, shownUpTo, canDeleteAll) {
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
  if (m.call_seconds != null) body.append(chatCallLine(m));
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
  return el;
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
  if (asked === chatWith) $("chatInput").value = ""; // (not text typed in another chat while a clip was sending)
  sendTyping(true);
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
  ((chatGroup && chatGroup.members) || []).forEach((p) => add(p.username));
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
  setChildren(box, found.map((name, i) => {
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

$("chatInput").addEventListener("input", () => {
  $("chatNote").textContent = "";
  suggestPick = 0;
  suggestNames();
  sendTyping(!$("chatInput").value.trim());
});
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
$("chatButton").addEventListener("click", (e) => { e.stopPropagation(); chatIsOpen() ? closeChat() : openChat(); });
$("chatClose").addEventListener("click", closeChat);
$("chatLogin").addEventListener("click", (e) => { e.stopPropagation(); closeChat(); openLogin("login"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && chatIsOpen() && $("profileModal").hidden && $("groupModal").hidden) closeChat();
});
// Back to the window: check right away.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && sfxUser()) { markSeen(); pollChat(300); }
});

// ---- group chats: make one, change its name, picture and people, or leave it.
// Also "New private message" (mode "dm"): pick one person.

let groupMode = "create";
const groupPicked = new Set();

function openGroupModal(mode, focusAdd = false) {
  if (!sfxUser()) return openLogin("login");
  groupMode = mode;
  groupPicked.clear();
  const g = mode === "edit" ? chatGroup : null;
  if (mode === "edit" && !g) return;
  $("groupTitle").textContent = mode === "create" ? "New group" : mode === "dm" ? "New private message" : "Group settings";
  $("groupTop").hidden = mode === "dm";
  $("groupName").value = g ? g.name : "";
  $("groupPicTools").hidden = mode !== "edit";
  $("groupMembersLabel").hidden = $("groupMembers").hidden = mode !== "edit";
  $("groupPickLabel").textContent = mode === "dm" ? "Who do you want to message?" : mode === "create" ? "Who's in it?" : "Add people";
  $("groupLeave").hidden = mode !== "edit";
  $("groupSave").hidden = mode === "dm";
  $("groupSave").textContent = mode === "create" ? "Create group" : "Save";
  $("groupSearch").value = "";
  $("groupNote").textContent = mode === "create" ? "You can add a picture once the group is made." : "";
  drawGroupModal();
  $("groupModal").hidden = false;
  (mode === "create" ? $("groupName") : $("groupSearch")).focus();
  if (focusAdd) $("groupSearch").focus();
}

function closeGroupModal() { $("groupModal").hidden = true; }

function drawGroupModal() {
  const g = groupMode === "edit" ? chatGroup : null;
  $("groupPic").replaceChildren(groupPic(g || { name: $("groupName").value.trim() || "?" }, "big"));
  $("groupPic").disabled = groupMode !== "edit";
  $("groupPicRemove").hidden = !(g && g.pictureUrl);
  const me = sfxUser();
  const isOwner = g && me && g.owner === me.username;
  if (g) {
    setChildren($("groupMembers"), (g.members || []).map((m) => {
      const row = document.createElement("div");
      row.className = "group-member";
      row.append(avatarEl(m.avatarUrl, m.username), Object.assign(document.createElement("span"), { textContent: m.username }));
      if (m.username === g.owner) row.append(Object.assign(document.createElement("small"), { textContent: "Made the group" }));
      if (isOwner && m.username !== me.username) {
        const x = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Remove" });
        x.addEventListener("click", () => groupAction({ what: "remove", usernames: [m.username] }));
        row.append(x);
      }
      return row;
    }));
  }
  const inIt = new Set(((g && g.members) || []).map((m) => m.username.toLowerCase()));
  const typed = $("groupSearch").value.trim().toLowerCase();
  const names = chatNames.filter((n) => (!me || n.toLowerCase() !== me.username.toLowerCase()) && !inIt.has(n.toLowerCase())
    && (!typed || n.toLowerCase().includes(typed)));
  const known = new Map();
  for (const p of [...((onlineInfo && onlineInfo.people) || []), ...chatPrivate]) known.set(p.username.toLowerCase(), p.avatarUrl);
  const rows = names.slice(0, 60).map((n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "group-person" + (groupPicked.has(n) ? " on" : "");
    b.append(avatarEl(known.get(n.toLowerCase()) || "", n), Object.assign(document.createElement("span"), { textContent: n }));
    if (groupMode !== "dm") b.append(Object.assign(document.createElement("i"), { className: "group-check" }));
    b.addEventListener("click", () => {
      if (groupMode === "dm") { closeGroupModal(); openChat(n); return; }
      if (!groupPicked.has(n) && groupPicked.size >= 49) return void ($("groupNote").textContent = "A group can have up to 50 people.");
      groupPicked.has(n) ? groupPicked.delete(n) : groupPicked.add(n);
      drawGroupModal();
    });
    return b;
  });
  if (!rows.length) rows.push(Object.assign(document.createElement("p"), { className: "group-empty", textContent: typed ? "Nobody with that name." : "Everyone is already in it." }));
  setChildren($("groupPick"), rows);
  if (groupMode === "create") $("groupSave").textContent = groupPicked.size ? `Create group (${groupPicked.size + 1} people)` : "Create group";
  if (groupMode === "edit") $("groupSave").textContent = groupPicked.size ? `Save and add ${groupPicked.size}` : "Save";
}

async function groupAction(data) {
  const res = await api("/api/sfx-chat-group", { group: chatGroup ? chatGroup.id : null, ...data })
    .catch(() => ({ ok: false, error: "That didn't work. Check your internet connection." }));
  if (sfxLoggedOut(res)) { closeGroupModal(); return null; }
  if (!res.ok) { $("groupNote").textContent = res.error; return null; }
  if (res.group && chatGroup && res.group.id === chatGroup.id) {
    chatGroup = { ...chatGroup, ...res.group, members: (res.group.members || []).map((m) => ({ ...m, avatarUrl: m.avatarUrl || "" })) };
  }
  pollChat(0);
  drawGroupModal();
  return res;
}

$("groupSave").addEventListener("click", async () => {
  const name = $("groupName").value.trim();
  if (!name) { $("groupNote").textContent = "Give the group a name."; return $("groupName").focus(); }
  $("groupSave").disabled = true;
  try {
    if (groupMode === "create") {
      const res = await groupAction({ what: "create", name, usernames: [...groupPicked], group: null });
      if (!res) return;
      closeGroupModal();
      switchChat("g:" + res.id);
      openChat();
      return;
    }
    if (name !== chatGroup.name && !(await groupAction({ what: "rename", name }))) return;
    if (groupPicked.size && !(await groupAction({ what: "add", usernames: [...groupPicked] }))) return;
    closeGroupModal();
  } finally {
    $("groupSave").disabled = false;
  }
});

async function groupSetPicture(promise) {
  $("groupNote").textContent = "Saving the picture...";
  const res = await promise.catch(() => ({ ok: false, error: "Couldn't save the picture." }));
  if (sfxLoggedOut(res)) return closeGroupModal();
  if (!res.ok) { $("groupNote").textContent = res.error; return; }
  $("groupNote").textContent = "";
  if (res.group && chatGroup) chatGroup = { ...chatGroup, ...res.group };
  roomDrawn = convosDrawn = "";
  drawGroupModal();
  pollChat(0);
}
const groupPickPicture = async () => {
  if (groupMode !== "edit" || !chatGroup) return;
  const res = await api("/api/sfx-group-picture-pick", { group: chatGroup.id }).catch(() => ({ ok: false, fallback: true }));
  if (res.fallback) return $("groupPicInput").click(); // not on Windows: the browser's own picker
  if (res.ok && !res.group) return; // picked nothing
  groupSetPicture(Promise.resolve(res));
};
$("groupPic").addEventListener("click", groupPickPicture);
$("groupPicChange").addEventListener("click", groupPickPicture);
$("groupPicInput").addEventListener("change", () => {
  const file = $("groupPicInput").files[0];
  $("groupPicInput").value = "";
  if (file && chatGroup) groupSetPicture(fetch("/api/sfx-group-picture-upload",
    { method: "POST", body: file, headers: { "X-Group": chatGroup.id } }).then((r) => r.json()));
});
$("groupPicRemove").addEventListener("click", () => groupSetPicture(api("/api/sfx-group-picture-remove", { group: chatGroup.id })));
$("groupLeave").addEventListener("click", async () => {
  if (!chatGroup || !confirm(`Leave "${chatGroup.name}"? You won't see its messages any more.`)) return;
  const res = await groupAction({ what: "leave" });
  if (!res) return;
  closeGroupModal();
  switchChat("");
});
$("groupSearch").addEventListener("input", drawGroupModal);
$("groupSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = $("groupPick").querySelector(".group-person");
  if (first) { e.preventDefault(); first.click(); }
});
$("groupName").addEventListener("input", () => { if (groupMode === "create") drawGroupModal(); });
$("groupName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("groupSave").click(); } });
$("groupCancel").addEventListener("click", closeGroupModal);
$("groupModal").addEventListener("click", (e) => { if (e.target === $("groupModal")) closeGroupModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("groupModal").hidden) { e.stopPropagation(); closeGroupModal(); } });

pollChat(1500);
