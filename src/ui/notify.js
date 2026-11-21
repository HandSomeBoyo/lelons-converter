// The bell at the top: everything new in one place (messages, invitations, games on sale, new POVs,
// finished downloads, updates). Each tab tells it what's new with notifyAdd(); the bell keeps a list,
// shows a little card in the corner, and a Windows notification when the app isn't in front.
// Uses $, api() from app.js, loadPref/savePref from theme.js, smoothHidden() from motion.js.

const NOTE_KINDS = {
  chat: { name: "Messages", icon: '<path d="M4 5.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/><path d="M16 9h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v2.5L16 17h-4a1 1 0 0 1-1-1v-.5"/>' },
  calls: { name: "Calls", icon: '<path d="M5 4.5h3.2l1.6 4-2 1.3a10 10 0 0 0 4.4 4.4l1.3-2 4 1.6V17a2 2 0 0 1-2 2A14.5 14.5 0 0 1 3 6.5a2 2 0 0 1 2-2z"/>' },
  invite: { name: "Invitations", icon: '<path d="M4 7.5h16v11H4z"/><path d="m4 8 8 6 8-6"/>' },
  boards: { name: "Board cards due", icon: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M8 8v7M12 8v4M16 8v9"/>' },
  comments: { name: "Comments on your channel", icon: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8.5 9.5h7M8.5 12.5h4"/>' },
  games: { name: "Games on sale", icon: '<path d="M20.5 13.5 13.5 20.5a1.8 1.8 0 0 1-2.5 0L3.5 13V3.5H13l7.5 7.5a1.8 1.8 0 0 1 0 2.5z"/><circle cx="8" cy="8" r="1.4"/>' },
  live: { name: "Friends going live", icon: '<circle cx="12" cy="12" r="2.2"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 18.6a9.4 9.4 0 0 1 0-13.2M18.6 5.4a9.4 9.4 0 0 1 0 13.2"/>' },
  povs: { name: "New POVs", icon: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>' },
  downloads: { name: "Finished downloads", icon: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 19.5h14"/>' },
  updates: { name: "App updates", icon: '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M12 12.5 20 8M12 12.5 4 8M12 12.5v8"/>' },
};
const NOTE_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>';
const NOTE_MAX = 40;
const noteStarted = Date.now();

// {list: [{key, stamp, kind, title, text, pic, open, at, read}], stamps: {key: stamp}}
// (stamps remember what was already shown, so a cleared one doesn't come back)
let noteData = (() => {
  const saved = loadPref("notes");
  return saved && Array.isArray(saved.list) ? { list: saved.list.filter((n) => n && NOTE_KINDS[n.kind]), stamps: saved.stamps || {} } : { list: [], stamps: {} };  // (kinds that were taken out are dropped)
})();

// What may notify you (Settings > Notifications). Missing means on.
function noteOn(what) {
  const on = loadPref("notesOn") || {};
  return on[what] !== false;
}
// A Windows notification for this kind? (the main switch, and the one for the kind)
// (Settings has just one switch for now: desktop notifications on or off. Everything goes in the bell.)
function noteDesk() { return noteOn("windows"); }
function noteSetOn(what, value) {
  savePref("notesOn", { ...(loadPref("notesOn") || {}), [what]: value });
}

let noteSaveTimer = null;
function noteSave() {
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    // keep the stamps of what's in the list, plus the newest few hundred others
    const keys = Object.keys(noteData.stamps);
    if (keys.length > 300) {
      const keep = new Set(noteData.list.map((n) => n.key));
      for (const k of keys.slice(0, keys.length - 300)) if (!keep.has(k)) delete noteData.stamps[k];
    }
    savePref("notes", noteData);
  }, 400);
}

// Something new. key: what it's about (one card per chat, per invitation...). stamp: changes when
// there's something newer about it (a newer message). Calling again with the same stamp does nothing.
// open: where clicking it goes (see noteOpen). quiet: no Windows sound (the chat plays its own ding).
function notifyAdd(n) {
  if (!n || !n.key || !NOTE_KINDS[n.kind]) return;
  const stamp = String(n.stamp ?? "");
  if (noteData.stamps[n.key] === stamp) return;
  noteData.stamps[n.key] = stamp;
  const note = { key: n.key, stamp, kind: n.kind, title: String(n.title || "").slice(0, 80), text: String(n.text || "").slice(0, 160),
    pic: n.pic || "", open: n.open || null, at: n.at || Date.now(), read: false };
  noteData.list = [note, ...noteData.list.filter((x) => x.key !== n.key)].slice(0, NOTE_MAX);
  noteSave();
  noteDraw();
  // Just opened: what was waiting goes in the list without popping up.
  // While you're live or recording, nothing pops up (it could show on stream or ding in the recording).
  if ((Date.now() - noteStarted > 12000 || n.now) && !noteDnd()) {
    api("/api/notify", { title: note.title, text: note.text, quiet: !!n.quiet, key: note.key, desktop: noteDesk(),
      quietBusy: true })
      .then((res) => { if (!(res && res.busy)) notePop(note); })
      .catch(() => notePop(note));
  }
}

// Seen it somewhere else (opened the chat, the Games tab...): no longer new.
function notifyRead(test) {
  let changed = false;
  for (const n of noteData.list) {
    if (!n.read && (typeof test === "function" ? test(n) : n.key === test)) { n.read = true; changed = true; }
  }
  if (changed) { noteSave(); noteDraw(); }
}

// (3.0) Take a pop-up away early (a call you already answered or declined).
function notifyUnpop(test) {
  for (const card of $("notePop").children) if (test(card.dataset.key || "")) card.remove();
}

// Gone (an invitation you answered, a game that isn't on sale anymore).
function notifyDrop(test) {
  const before = noteData.list.length;
  noteData.list = noteData.list.filter((n) => !(typeof test === "function" ? test(n) : n.key === test));
  if (noteData.list.length !== before) { noteSave(); noteDraw(); }
}

// "Do not disturb" for a while: no cards and no Windows notifications (the list still fills up).
function noteDnd() { return (+loadPref("notesOn")?.dndUntil || 0) > Date.now(); }

// ---- going where it's about

async function noteOpen(n) {
  noteClose();
  const o = n.open || {};
  if (o.chat !== undefined && typeof openChat === "function") return openChat(o.chat);
  if (o.live && typeof liveWatch === "function") return liveWatch(o.live);
  if (o.board && typeof qkOpenBoard === "function") return qkOpenBoard(o.board, false);
  if (o.tab) showTab(o.tab);
  if (o.tab === "docs" && typeof docsSwitchTo === "function") {
    if (typeof doc !== "undefined" && doc && !(await docLeave())) return;
    if (typeof doc !== "undefined" && doc) closeDoc();
    docsSwitchTo("collab");
  }
  if (o.tab === "boards" && typeof bd !== "undefined" && bd && typeof bdClose === "function") bdClose();
  if (o.update) { dismissedUpdate = null; refresh(); }
}

// ---- the bell and its list

function noteAgo(at) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : d + " days ago";
}

function noteIcon(kind) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NOTE_KINDS[kind].icon}</svg>`;
}

function noteRow(n, inPop) {
  const row = document.createElement(inPop ? "div" : "button");
  if (!inPop) row.type = "button";
  row.className = (inPop ? "note-pop-card" : "note-row") + (n.read ? "" : " unread");
  const face = document.createElement("span");
  face.className = "note-face k-" + n.kind;
  if (n.pic) face.style.backgroundImage = `url("${n.pic}")`;
  else face.innerHTML = noteIcon(n.kind);
  if (n.pic) face.append(Object.assign(document.createElement("i"), { innerHTML: noteIcon(n.kind) }));
  const body = document.createElement("span");
  body.className = "note-body";
  body.append(Object.assign(document.createElement("b"), { textContent: n.title }),
    Object.assign(document.createElement("span"), { className: "note-text", textContent: n.text }),
    Object.assign(document.createElement("small"), { textContent: NOTE_KINDS[n.kind].name + " · " + noteAgo(n.at) }));
  row.append(face, body);
  if (!inPop) {
    row.addEventListener("click", () => { n.read = true; noteSave(); noteDraw(); noteOpen(n); });
    const x = document.createElement("span");
    x.className = "note-x";
    x.title = "Remove";
    x.innerHTML = ICONS.remove;
    x.addEventListener("click", (e) => { e.stopPropagation(); notifyDrop((m) => m === n); });
    row.append(x);
  }
  return row;
}

let noteFilter = "all";
function noteDraw() {
  const unread = noteData.list.filter((n) => !n.read).length;
  const badge = $("noteBadge");
  badge.hidden = !unread;
  badge.textContent = unread > 9 ? "9+" : unread;
  $("noteBell").title = unread ? `Notifications (${unread} new)` : "Notifications";
  $("noteBell").classList.toggle("has-new", unread > 0);
  if ($("notePanel").hidden) return;
  const shown = noteData.list.filter((n) => noteFilter === "all" || !n.read);
  $("noteReadAll").disabled = !unread;
  $("noteClear").hidden = !noteData.list.length;
  document.querySelectorAll("#noteTabs button").forEach((b) => b.classList.toggle("active", b.dataset.f === noteFilter));
  $("noteDnd").classList.toggle("on", noteDnd());
  $("noteDnd").title = noteDnd() ? "Do not disturb is on. Click to turn it off." : "Do not disturb for 1 hour";
  const list = $("noteList");
  if (!shown.length) {
    list.innerHTML = `<div class="note-empty">${NOTE_BELL}
      <b>${noteFilter === "all" ? "Nothing here yet" : "You're all caught up"}</b><span>New messages, invitations, games on sale, POVs, and friends going live show up here.</span></div>`;
    return;
  }
  list.replaceChildren(...shown.map((n) => noteRow(n)));
}

function noteToggle(open) {
  const panel = $("notePanel");
  if (open === undefined) open = panel.hidden;
  panel.hidden = !open;
  $("noteBell").classList.toggle("open", open);
  if (open) { noteFilter = "all"; noteDraw(); }
}
function noteClose() { if (!$("notePanel").hidden) noteToggle(false); }

smoothHidden($("notePanel"));
$("noteBell").addEventListener("click", (e) => { e.stopPropagation(); noteToggle(); });
$("notePanel").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => noteClose());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") noteClose(); });
$("noteReadAll").addEventListener("click", () => notifyRead(() => true));
$("noteFeed")?.addEventListener("click", () => { noteClose(); if (typeof openFeed === "function") openFeed(); });
$("noteClear").addEventListener("click", () => { noteData.list = []; noteSave(); noteDraw(); });
$("noteSettings").addEventListener("click", () => { noteClose(); if (typeof openSettings === "function") openSettings("notes"); });
$("noteDnd").addEventListener("click", () => {
  savePref("notesOn", { ...(loadPref("notesOn") || {}), dndUntil: noteDnd() ? 0 : Date.now() + 3600 * 1000 });
  noteDraw();
});
document.querySelectorAll("#noteTabs button").forEach((b) => b.addEventListener("click", () => { noteFilter = b.dataset.f; noteDraw(); }));
setInterval(() => { if (!$("notePanel").hidden) noteDraw(); }, 60000); // ("2 min ago")

// ---- the little card in the corner

let notePopTimer = null;
function notePop(n) {
  const box = $("notePop");
  const card = noteRow(n, true);
  card.dataset.key = n.key;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "note-pop-x";
  close.title = "Close";
  close.innerHTML = ICONS.remove;
  close.addEventListener("click", (e) => { e.stopPropagation(); card.remove(); });
  card.append(close);
  card.addEventListener("click", () => { card.remove(); n.read = true; noteSave(); noteDraw(); noteOpen(n); });
  box.prepend(card);
  while (box.children.length > 3) box.lastElementChild.remove();
  setTimeout(() => { card.classList.add("leaving"); setTimeout(() => card.remove(), 300); }, 6500);
}

// Clicked a Windows notification: the app comes to the front, then opens the one you clicked.
window.addEventListener("focus", async () => {
  const res = await api("/api/notify-clicked", {}).catch(() => null);
  if (res && res.clicked) {
    const n = noteData.list.find((x) => x.key === res.clicked) || noteData.list.find((x) => !x.read) || noteData.list[0];
    if (n) { n.read = true; noteSave(); noteDraw(); noteOpen(n); }
  }
});

// ---- things this file watches itself

// Downloads that finish while you're not looking at the app.
const noteJobsDone = new Set();
let noteJobsSeen = false;
function notifyJobs(jobs) {
  for (const j of jobs || []) {
    if (j.status !== "done" || noteJobsDone.has(j.id)) continue;
    noteJobsDone.add(j.id);
    if (noteJobsSeen && (document.hidden || !document.hasFocus())) {
      notifyAdd({ key: "job:" + j.id, stamp: 1, kind: "downloads", title: "Download finished", text: j.title, pic: j.thumbnail || "",
        open: { tab: "video" } });
    }
  }
  noteJobsSeen = true;
}

// A new version of the app.
function notifyUpdate(s) {
  if (s.appUpdate && s.appUpdate.version)
    notifyAdd({ key: "update", stamp: s.appUpdate.version, kind: "updates", title: "Update available",
      text: `Version ${s.appUpdate.version} of VaultHub is ready to install.`, open: { update: true } });
}

// New POVs from friends, checked now and then (the POVs tab checks more often while it's open).
async function notifyCheckPovs() {
  if (typeof sfxUser !== "function" || !sfxUser() || document.hidden) return;
  if (typeof pvTabOpen === "function" && pvTabOpen()) return;
  const res = await api("/api/pov-list", {}).catch(() => null);
  if (res && res.ok) notifyPovs(res.sessions || []);
}
function notifyPovs(sessions, looking) {
  const me = (sfxUser() || {}).username || "";
  const seen = +loadPref("povsSeen") || 0;
  let newest = seen;
  for (const s of sessions) for (const f of s.files || []) {
    const at = +f.created || 0;
    newest = Math.max(newest, at);
    if (looking || !seen || at <= seen || !f.by || f.by.toLowerCase() === me.toLowerCase()) continue;
    notifyAdd({ key: "pov:" + f.id, stamp: 1, kind: "povs", title: `${f.by} shared a POV`, text: s.title || "A new recording", open: { tab: "povs" } });
  }
  if (newest > seen) savePref("povsSeen", newest);
}
setTimeout(notifyCheckPovs, 20000);
setInterval(notifyCheckPovs, 180000);

// Cards on your boards that are due within a day (or overdue), looked at every 15 minutes.
async function notifyCheckDue() {
  if (document.hidden) return;
  const res = await api("/api/boards-due", {}).catch(() => null);
  if (!res || !res.ok) return;
  const date = (s) => new Date(s.length > 10 ? s : s + "T23:59");
  for (const c of res.cards || []) {
    const left = date(c.due) - Date.now();
    if (left > 86400000 || left < -3 * 86400000) continue;
    notifyAdd({ key: `due:${c.board}:${c.card}`, stamp: c.due + (left < 0 ? ":late" : ""), kind: "boards",
      title: left < 0 ? `"${c.title || "A card"}" is overdue` : `"${c.title || "A card"}" is due soon`,
      text: `${c.boardTitle} · ${c.list}`, open: { board: c.board } });
  }
}
setTimeout(notifyCheckDue, 30000);
setInterval(notifyCheckDue, 15 * 60 * 1000);

// New comments on your channel (the Comments tab tells the bell when its number goes up).
let noteCmCount = null;
function notifyComments(count) {
  const before = noteCmCount;
  noteCmCount = count;
  if (before === null || count <= before) return;
  const n = count - before;
  notifyAdd({ key: "comments", stamp: Date.now(), kind: "comments", title: n === 1 ? "A new comment on your channel" : `${n} new comments on your channel`,
    text: count === 1 ? "It's waiting for your answer." : `${count} comments are waiting for your answer.`, open: { tab: "comments" } });
}

noteDraw();
