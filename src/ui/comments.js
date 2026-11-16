// The Comments tab: every comment on your channel in one list, the ones you haven't answered on
// top, with a reply box right there (see comments.py). Uses the Google sign-in from Channel stats.
// Uses $, api() from app.js, avatarEl() and sfxAgo() from sfx.js, openChSetup() from channel.js.

let cmData = null;
let cmTimer = null;
let cmRun = 0;
let cmSig = "";
let cmFilter = ["needs", "answered", "done", "held", "all"].includes(loadPref("cmFilter")) ? loadPref("cmFilter") : "needs";
let cmVideo = "";
let cmOpen = ""; // the comment whose reply box is open
let cmWaitGoogle = 0;
const cmDrafts = new Map(); // comment id -> text you started typing
const cmGone = new Set(); // answered or done just now: it slides away on the next draw

const cmTabOpen = () => !$("commentsTab").hidden;

function commentsTabChanged(tab) {
  if (tab !== "comments") { clearTimeout(cmTimer); return; }
  cmSig = "";
  loadComments();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && cmTabOpen()) loadComments(); });

async function loadComments() {
  clearTimeout(cmTimer);
  const mine = ++cmRun;
  try {
    const res = await api("/api/cm-page", {});
    if (res.ok && mine === cmRun) {
      const sig = JSON.stringify(res);
      if (sig !== cmSig) {
        cmSig = sig;
        cmData = res;
        drawComments();
      }
      if (res.google.connected && (!cmWaitGoogle || res.google.canReply)) cmWaitGoogle = 0;
    }
  } catch (e) { /* the app is closing */ }
  if (mine !== cmRun) return;
  const soon = (cmData && (cmData.loading || cmData.busy)) || Date.now() < cmWaitGoogle;
  cmTimer = setTimeout(() => { if (cmTabOpen() && !document.hidden) loadComments(); }, soon ? 2500 : 60000);
}

function cmBadge(n) {
  const b = $("commentsTabBadge");
  const was = Number(b.textContent) || 0;
  b.hidden = !n;
  b.textContent = n > 99 ? "99+" : n;
  b.title = n === 1 ? "A comment waits for your answer" : n + " comments wait for your answer";
  if (n > was) { b.classList.remove("fresh"); void b.offsetWidth; b.classList.add("fresh"); }
}

// The number on the side bar, also when the tab is closed (every 10 minutes, cheap).
async function cmCheckCount() {
  try {
    const res = cmTabOpen() && cmData && cmData.counts ? { ok: true, count: cmData.counts.needs || 0 } : await api("/api/cm-count", {});
    if (res.ok) cmBadge(res.count);
  } catch (e) { /* closing */ }
}
setTimeout(cmCheckCount, 8000);
setInterval(cmCheckCount, 10 * 60 * 1000);

// ---- drawing

function drawComments() {
  const d = cmData;
  const connected = d.google.connected;
  $("cmStart").hidden = connected;
  $("cmMain").hidden = !connected;
  if (!connected) {
    setChildren($("cmStartGoogle"), [Object.assign(document.createElement("i"), { className: "ch-g" }),
      Date.now() < cmWaitGoogle ? "Finish signing in in your browser..." : "Sign in with Google"]);
    cmBadge(0);
    return;
  }
  $("cmAllow").hidden = d.google.canReply;
  $("cmRefresh").classList.toggle("spinning", !!d.busy);
  const counts = d.counts || {};
  cmBadge(counts.needs || 0);
  if (cmFilter === "held" && !counts.held) cmFilter = "needs";
  document.querySelectorAll("#cmFilters button").forEach((b) => {
    const f = b.dataset.f;
    b.classList.toggle("active", f === cmFilter);
    if (f === "held") b.hidden = !counts.held;
    const n = b.querySelector("b");
    if (n) n.textContent = counts[f] ? counts[f] : "";
  });

  const notes = [];
  if (d.error) notes.push(d.error);
  else if (d.loading) notes.push("Getting your comments from YouTube...");
  else if (Date.now() < cmWaitGoogle) notes.push("Finish in your browser, then come back here.");
  $("cmNote").textContent = notes.join(" ");

  drawCmVideos(d);
  drawCmList(d);
}

function drawCmVideos(d) {
  const sel = $("cmVideo");
  const per = new Map();
  for (const t of d.threads) per.set(t.videoId, (per.get(t.videoId) || 0) + (t.status === "needs" ? 1 : 0));
  const options = [["", "All videos"]];
  for (const [id] of per) {
    const v = d.videos[id];
    if (!v) continue;
    const n = per.get(id);
    options.push([id, (v.title.length > 48 ? v.title.slice(0, 46) + "…" : v.title) + (n ? `  (${n})` : "")]);
  }
  if (!per.has(cmVideo)) cmVideo = "";
  const sig = JSON.stringify(options);
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.replaceChildren(...options.map(([value, text]) => Object.assign(document.createElement("option"), { value, textContent: text })));
  }
  sel.value = cmVideo;
}

function cmShown(d) {
  const q = $("cmSearch").value.trim().toLowerCase();
  return d.threads.filter((t) => {
    if (cmFilter === "all" ? t.status === "held" : t.status !== cmFilter && !cmGone.has(t.id)) return false;
    if (cmVideo && t.videoId !== cmVideo) return false;
    if (q && ![t.top.text, t.top.author, ...t.replies.map((r) => r.text)].join(" ").toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => cmFilter === "needs" ? cmLatest(b) - cmLatest(a) : (b.top.when || 0) - (a.top.when || 0));
}
// Newest first, counting a "they answered you back" by when they did.
const cmLatest = (t) => t.why === "back" ? (t.replies[t.replies.length - 1].when || 0) : (t.top.when || 0);

function drawCmList(d) {
  const list = cmShown(d);
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "home-card cm-empty";
    const words = d.loading ? ["Looking at your comments...", "The first time takes a few seconds."]
      : $("cmSearch").value.trim() ? ["Nothing found", "Try other words, or pick All videos."]
      : cmFilter === "needs" ? ["You're all caught up", "Every comment has an answer. New ones show up here by themselves."]
      : cmFilter === "done" ? ["Nothing marked done", "Press Done on a comment you don't want to answer, and it moves here."]
      : ["No comments here yet", ""];
    empty.append(Object.assign(document.createElement("b"), { textContent: words[0] }));
    if (words[1]) empty.append(Object.assign(document.createElement("span"), { textContent: words[1] }));
    setChildren($("cmList"), [empty]);
    return;
  }
  setChildren($("cmList"), list.slice(0, 150).map((t) => cmCard(t, d)));
}

const cmCards = new Map(); // id -> {sig, el}: unchanged cards stay as they are (keeps typing and focus)

function cmCard(t, d) {
  const sig = JSON.stringify([t, cmOpen === t.id, cmGone.has(t.id), d.google.canReply, d.saved]);
  const known = cmCards.get(t.id);
  if (known && known.sig === sig) return known.el;
  const card = document.createElement("article");
  card.className = "home-card cm-card" + (cmGone.has(t.id) ? " gone" : "") + (t.status === "needs" ? " needs" : "");
  card.dataset.id = t.id;

  const v = d.videos[t.videoId] || {};
  const head = document.createElement("div");
  head.className = "cm-head";
  head.append(avatarEl(t.top.avatar, t.top.author.replace(/^@/, "")));
  const who = document.createElement("div");
  who.className = "cm-who";
  const name = Object.assign(document.createElement("b"), { textContent: t.top.author });
  const when = Object.assign(document.createElement("span"), { textContent: t.top.when ? sfxAgo(t.top.when * 1000) : "" });
  who.append(name, when);
  if (t.why === "back") who.append(Object.assign(document.createElement("i"), { className: "cm-tag back", textContent: "Answered you back" }));
  if (t.status === "held") who.append(Object.assign(document.createElement("i"), { className: "cm-tag held", textContent: "Held for review" }));
  if (t.status === "answered") who.append(Object.assign(document.createElement("i"), { className: "cm-tag ok", textContent: "Answered" }));
  if (t.status === "mine") who.append(Object.assign(document.createElement("i"), { className: "cm-tag", textContent: "You" }));
  head.append(who);
  if (v.id) {
    const vid = document.createElement("button");
    vid.type = "button";
    vid.className = "cm-vid";
    vid.title = "Open the video on YouTube";
    const img = Object.assign(document.createElement("img"), { src: v.thumbnail, alt: "", loading: "lazy" });
    vid.append(img, Object.assign(document.createElement("span"), { textContent: v.title }));
    vid.onclick = () => api("/api/ch-open", { url: v.url });
    head.append(vid);
  }
  card.append(head);

  card.append(Object.assign(document.createElement("p"), { className: "cm-text", textContent: t.top.text }));

  const meta = document.createElement("div");
  meta.className = "cm-meta";
  if (t.top.likes) meta.append(Object.assign(document.createElement("span"), { textContent: "♥ " + t.top.likes.toLocaleString() }));
  if (t.replyCount) meta.append(Object.assign(document.createElement("span"), { textContent: t.replyCount === 1 ? "1 answer" : t.replyCount + " answers" }));
  card.append(meta);

  if (t.replies.length) {
    const replies = document.createElement("div");
    replies.className = "cm-replies";
    const shown = t.replies.slice(-3);
    if (t.replies.length > shown.length) {
      replies.append(Object.assign(document.createElement("span"), { className: "cm-more", textContent: `${t.replies.length - shown.length} earlier answers` }));
    }
    for (const r of shown) {
      const row = document.createElement("div");
      row.className = "cm-reply" + (r.authorId === d.channelId ? " me" : "");
      row.append(avatarEl(r.avatar, r.author.replace(/^@/, "")));
      const body = document.createElement("div");
      const top = document.createElement("div");
      top.className = "cm-reply-top";
      top.append(Object.assign(document.createElement("b"), { textContent: r.authorId === d.channelId ? "You" : r.author }),
        Object.assign(document.createElement("span"), { textContent: r.when ? sfxAgo(r.when * 1000) : "" }));
      if (r.authorId === d.channelId && d.google.canReply) {
        const del = Object.assign(document.createElement("button"), { type: "button", className: "link cm-del", textContent: "Delete" });
        del.onclick = () => cmUnreply(r.id, del);
        top.append(del);
      }
      body.append(top, Object.assign(document.createElement("p"), { textContent: r.text }));
      row.append(body);
      replies.append(row);
    }
    card.append(replies);
  }

  card.append(cmOpen === t.id ? cmBox(t, d) : cmActions(t, d));
  cmCards.set(t.id, { sig, el: card });
  return card;
}

function cmButton(text, cls, onclick, title) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: cls, textContent: text });
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
}

function cmActions(t, d) {
  const row = document.createElement("div");
  row.className = "cm-actions";
  if (t.status === "held") {
    row.append(cmButton("Let it through", "small-button", () => cmModerate(t, "approve"), "Show it on YouTube"),
      cmButton("Hide it", "ghost-button", () => cmModerate(t, "hide"), "Don't show it on your channel"));
  } else {
    if (t.canReply && cmOpen !== t.id) {
      row.append(cmButton(t.status === "needs" ? "Answer" : "Answer again", t.status === "needs" ? "small-button" : "ghost-button", () => cmOpenBox(t.id)));
    }
    if (t.status === "needs") row.append(cmButton("Done", "ghost-button", () => cmDone(t, true), "Mark it done without answering"));
    if (t.status === "done") row.append(cmButton("Back to the list", "ghost-button", () => cmDone(t, false)));
  }
  row.append(Object.assign(document.createElement("span"), { className: "spacer" }));
  row.append(cmButton("Open on YouTube", "link", () => api("/api/ch-open", {
    url: `https://www.youtube.com/watch?v=${t.videoId}&lc=${t.id}` })));
  if (t.status !== "held" && t.status !== "mine" && d.google.canReply) {
    row.append(cmButton("Hide", "link cm-hide", () => cmModerate(t, "hide"), "Hide this comment from your channel"));
  }
  return row;
}

function cmBox(t, d) {
  const box = document.createElement("div");
  box.className = "cm-box";
  if (!d.google.canReply) {
    box.append(Object.assign(document.createElement("p"), { className: "home-muted", textContent: "Press Allow answering at the top first." }));
    return box;
  }
  const text = Object.assign(document.createElement("textarea"), { rows: 2, maxLength: 10000, placeholder: `Answer ${t.top.author}...` });
  text.value = cmDrafts.get(t.id) || "";
  text.oninput = () => { cmDrafts.set(t.id, text.value); grow(); };
  const grow = () => { text.style.height = "auto"; text.style.height = Math.min(220, text.scrollHeight + 2) + "px"; };
  const note = Object.assign(document.createElement("span"), { className: "cm-box-note" });
  const send = cmButton("Send", "small-button", () => cmSend(t, text, send, note));
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); }
    if (e.key === "Escape") { e.stopPropagation(); cmOpen = ""; cmRedraw(); }
  });

  const saved = document.createElement("div");
  saved.className = "cm-saved";
  for (const s of d.saved || []) {
    const chip = document.createElement("span");
    chip.className = "cm-chip";
    const use = cmButton(s.length > 40 ? s.slice(0, 38) + "…" : s, "", () => {
      text.value = text.value.trim() ? text.value.trimEnd() + " " + s : s;
      cmDrafts.set(t.id, text.value);
      grow();
      text.focus();
    }, s);
    const x = cmButton("×", "cm-chip-x", () => cmSaveReplies((d.saved || []).filter((o) => o !== s)), "Remove this saved answer");
    chip.append(use, x);
    saved.append(chip);
  }
  const keep = cmButton("+ Save as a quick answer", "link cm-keep", () => {
    const s = text.value.trim();
    if (!s) { note.textContent = "Write the answer first, then save it."; return; }
    cmSaveReplies([...(d.saved || []), s]);
  });
  saved.append(keep);

  const foot = document.createElement("div");
  foot.className = "cm-box-foot";
  foot.append(note, Object.assign(document.createElement("span"), { className: "spacer" }),
    Object.assign(document.createElement("small"), { className: "home-muted", textContent: "Ctrl+Enter sends" }),
    cmButton("Cancel", "ghost-button", () => { cmOpen = ""; cmRedraw(); }), send);
  box.append(text, saved, foot);
  setTimeout(() => { if (text.isConnected && document.activeElement !== text) { text.focus(); grow(); } }, 30);
  return box;
}

const cmRedraw = () => { if (cmData && cmData.google.connected) drawCmList(cmData); };

function cmOpenBox(id) {
  cmOpen = id;
  cmRedraw();
}

// After answering, the next comment that needs you opens, so you can go down the list.
function cmNext(id) {
  const list = cmShown(cmData).filter((t) => t.id !== id && !cmGone.has(t.id) && t.status === "needs" && t.canReply);
  cmOpen = cmFilter === "needs" && list.length ? list[0].id : "";
}

function cmSlideAway(t) {
  cmGone.add(t.id);
  cmNext(t.id);
  cmRedraw();
  setTimeout(() => { cmGone.delete(t.id); cmRedraw(); }, 450);
}

// The comment as it is now (a card that didn't change keeps the comment from an older look).
const cmFind = (t) => (cmData && cmData.threads.find((o) => o.id === t.id)) || t;

async function cmSend(t, text, send, note) {
  t = cmFind(t);
  const words = text.value.trim();
  if (!words) { text.focus(); return; }
  send.disabled = true;
  note.textContent = "Sending...";
  note.classList.remove("bad");
  const res = await api("/api/cm-reply", { id: t.id, text: words });
  send.disabled = false;
  if (!res.ok) { note.textContent = res.error; note.classList.add("bad"); return; }
  cmDrafts.delete(t.id);
  t.replies.push({ ...res.reply, authorId: cmData.channelId });
  t.replyCount += 1;
  const wasNeeds = t.status === "needs";
  t.status = "answered";
  t.why = "";
  if (cmData.counts && wasNeeds) { cmData.counts.needs = Math.max(0, (cmData.counts.needs || 0) - 1); cmData.counts.answered = (cmData.counts.answered || 0) + 1; }
  cmSig = "";
  drawComments();
  if (wasNeeds && cmFilter === "needs") cmSlideAway(t);
  else { cmOpen = ""; cmRedraw(); }
}

async function cmDone(t, done) {
  t = cmFind(t);
  await api("/api/cm-done", { id: t.id, done });
  const from = t.status;
  t.status = done ? "done" : "needs";
  if (cmData.counts) { cmData.counts[from] = Math.max(0, (cmData.counts[from] || 0) - 1); cmData.counts[t.status] = (cmData.counts[t.status] || 0) + 1; }
  cmSig = "";
  drawComments();
  cmSlideAway(t);
  setTimeout(loadComments, 600);
}

async function cmModerate(t, how) {
  if (how === "hide" && !confirm("Hide this comment from your channel? You can find it again in YouTube Studio under Comments > Removed.")) return;
  const res = await api("/api/cm-" + how, { id: t.id });
  if (!res.ok) { $("cmNote").textContent = res.error; return; }
  cmSig = "";
  loadComments();
}

async function cmUnreply(id, button) {
  if (!confirm("Delete your answer on YouTube?")) return;
  button.disabled = true;
  const res = await api("/api/cm-unreply", { id });
  if (!res.ok) { $("cmNote").textContent = res.error; button.disabled = false; return; }
  cmSig = "";
  loadComments();
}

async function cmSaveReplies(list) {
  const res = await api("/api/cm-saved", { saved: list });
  if (res.ok && cmData) { cmData.saved = res.saved; cmRedraw(); }
}

// ---- signing in (the same Google sign-in as Channel stats, plus permission to answer)

async function cmConnect() {
  if (!cmData || !cmData.google.setUp) {
    chAfterSetup = cmConnect; // channel.js calls this once the Client ID is saved
    return openChSetup("", "When you sign in, Google says the app isn't checked by Google. That's normal for an app you made yourself: click <b>Advanced</b>, then <b>Go to VaultHub</b>, and tick every box so VaultHub can post your answers.");
  }
  const res = await api("/api/ch-connect", { replies: true });
  if (!res.ok) return openChSetup(res.error);
  cmWaitGoogle = Date.now() + 5 * 60 * 1000;
  cmSig = "";
  if (cmData) drawComments();
  loadComments();
}

// ---- the buttons

$("cmStartGoogle").addEventListener("click", cmConnect);
$("cmAllowGo").addEventListener("click", cmConnect);
$("cmRefresh").addEventListener("click", async () => {
  $("cmRefresh").classList.add("spinning");
  await api("/api/cm-refresh", {});
  setTimeout(loadComments, 300);
});
document.querySelectorAll("#cmFilters button").forEach((b) => b.addEventListener("click", () => {
  cmFilter = b.dataset.f;
  savePref("cmFilter", cmFilter);
  cmOpen = "";
  if (cmData) drawComments();
}));
$("cmVideo").addEventListener("change", () => { cmVideo = $("cmVideo").value; cmRedraw(); });
$("cmSearch").addEventListener("input", cmRedraw);
if (cmTabOpen()) commentsTabChanged("comments"); // the app opened on this tab
