// The live chat (a panel on the right) and "3 online" at the top right.
// Uses $, api() from app.js and sfxUser(), avatarEl(), sfxLoggedOut(), openLogin() from sfx.js.

let chatMessages = [];
let chatLastId = 0; // the newest message we have
let chatLoaded = false; // the first load is done (older messages don't count as unread)
let chatUnread = 0;
let chatTimer = null;
let chatBusy = false;
let chatUserId = null; // who the messages were loaded for
const chatSure = new Set(); // messages whose delete button was clicked once

function chatIsOpen() { return !$("chatPanel").hidden; }

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

function drawOnline() {
  const box = $("chatOnline");
  if (!onlineInfo) return box.replaceChildren();
  const people = onlineInfo.people || [];
  const others = Math.max(0, onlineInfo.online - people.length);
  box.replaceChildren(...people.slice(0, 12).map((p) => {
    const el = document.createElement("span");
    el.className = "who";
    el.append(avatarEl(p.avatarUrl, p.username), document.createTextNode(p.username));
    return el;
  }));
  const rest = others + Math.max(0, people.length - 12);
  if (rest || !people.length) {
    box.append(document.createTextNode(people.length ? `+ ${rest} more` : `${onlineInfo.online} online`));
  }
}

// ---- the panel

function openChat() {
  closeMenu();
  $("chatPanel").hidden = false;
  $("chatOpen").classList.add("open");
  chatUnread = 0;
  drawUnread();
  drawChatUser();
  drawOnline();
  pollChat(0);
  if (sfxUser()) $("chatInput").focus();
}

function closeChat() {
  $("chatPanel").hidden = true;
  $("chatOpen").classList.remove("open");
  $("chatOpen").hidden = !onlineInfo;
}

function drawChatUser() {
  const user = sfxUser();
  $("chatOut").hidden = !!user;
  $("chatList").hidden = !user;
  $("chatForm").hidden = !user;
  if (!user) $("chatNote").textContent = "";
}

function drawUnread() {
  $("chatUnread").hidden = !chatUnread;
  $("chatUnread").textContent = chatUnread > 9 ? "9+" : chatUnread;
}

// Checked every few seconds while the chat is open, less often while it's closed (for the unread number).
function pollChat(delay) {
  clearTimeout(chatTimer);
  chatTimer = setTimeout(loadChat, delay);
}

async function loadChat() {
  const user = sfxUser();
  if (!user) {
    chatMessages = []; chatLastId = 0; chatLoaded = false; chatUserId = null;
    if (chatIsOpen()) drawChatUser();
    return pollChat(20000);
  }
  if (user.id !== chatUserId) {
    chatMessages = []; chatLastId = 0; chatLoaded = false; chatUserId = user.id;
    $("chatList").replaceChildren();
  }
  if (chatBusy) return;
  chatBusy = true;
  try {
    const res = await api("/api/sfx-chat", { after: chatLastId }).catch(() => null);
    if (res && !sfxLoggedOut(res)) addChat(res);
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
  const fresh = (res.messages || []).filter((m) => m.id > chatLastId);
  if (fresh.length) {
    chatLastId = fresh[fresh.length - 1].id;
    chatMessages = chatMessages.concat(fresh).slice(-300);
    if (chatLoaded && !chatIsOpen()) {
      chatUnread += fresh.filter((m) => !m.mine).length;
      drawUnread();
    }
  }
  if (chatIsOpen() && $("chatNote").textContent && !$("chatNote").dataset.keep) $("chatNote").textContent = "";
  if (fresh.length || !chatLoaded) drawChat();
  chatLoaded = true;
}

function chatTime(when) {
  return new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function drawChat() {
  const list = $("chatList");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const me = sfxUser();
  const canDeleteAll = me && (me.role === "owner" || me.role === "admin");
  if (!chatMessages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet. Say hi!";
    list.replaceChildren(empty);
    return;
  }
  const rows = [];
  let last = null;
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
    el.className = "chat-msg" + (follow ? " follow" : "");
    el.append(avatarEl(m.avatarUrl, m.username));
    const body = document.createElement("div");
    body.className = "body";
    if (!follow) {
      const line = document.createElement("div");
      line.className = "who-line";
      const name = document.createElement("b");
      name.className = "role-" + m.role;
      name.textContent = m.username;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = chatTime(m.created_at);
      line.append(name, when);
      body.append(line);
    }
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = m.message;
    text.title = chatTime(m.created_at);
    body.append(text);
    el.append(body);
    if (m.mine || canDeleteAll) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-button del" + (chatSure.has(m.id) ? " sure" : "");
      del.title = chatSure.has(m.id) ? "Click again to delete" : "Delete";
      del.innerHTML = ICONS.remove;
      del.addEventListener("click", () => deleteChat(m.id));
      el.append(del);
    }
    rows.push(el);
    last = m;
  }
  list.replaceChildren(...rows);
  if (atBottom || !chatLoaded) list.scrollTop = list.scrollHeight;
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
  chatMessages = chatMessages.filter((m) => m.id !== id);
  drawChat();
}

// Logged in or out (or as someone else).
function chatAccountChanged() {
  const user = sfxUser();
  if ((user && user.id) === chatUserId) return;
  if (chatIsOpen()) drawChatUser();
  pollChat(0);
}

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = $("chatInput").value.trim();
  if (!message || $("chatSend").disabled) return;
  $("chatSend").disabled = true;
  const res = await api("/api/sfx-chat-send", { message, after: chatLastId })
    .catch(() => ({ ok: false, error: "That didn't send. Check your internet connection." }));
  $("chatSend").disabled = false;
  if (sfxLoggedOut(res)) return drawChatUser();
  if (!res.ok) {
    $("chatNote").textContent = res.error;
    return;
  }
  $("chatInput").value = "";
  $("chatNote").textContent = "";
  addChat(res);
  $("chatList").scrollTop = $("chatList").scrollHeight;
  $("chatInput").focus();
});
$("chatInput").addEventListener("input", () => { $("chatNote").textContent = ""; });

$("chatOpen").addEventListener("click", (e) => { e.stopPropagation(); chatIsOpen() ? closeChat() : openChat(); });
$("chatClose").addEventListener("click", closeChat);
$("chatLogin").addEventListener("click", (e) => { e.stopPropagation(); closeChat(); openLogin("login"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && chatIsOpen()) closeChat(); });
// Back to the window: check right away.
document.addEventListener("visibilitychange", () => { if (!document.hidden && sfxUser()) pollChat(300); });

pollChat(1500);
