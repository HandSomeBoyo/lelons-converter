// Quick search (Ctrl+K) and paste-anywhere.
//
// Quick search: one box that finds any page, your documents and boards, and things to do
// (new document, settings, log in...). Typing or pasting a link offers to convert it right there.
// Paste anywhere: pasting a link while not typing in a box pops up a card to get it as MP3 or MP4.
// Uses $, api(), linksIn(), looksLikeLink() from app.js, showTab() from images.js, homeConvert()
// from home.js, openSettings(), openChat(), openLogin(), openTour(), showWhatsNew(), openFeedback(),
// sfxUser(), and the Docs and Boards lists (docsLocal, docsCollab, bdBoards, bdTeamBoards).

const QK_ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 9.5v5l4-2.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h7"/><path d="m15 17 2 2 4-4"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.5h6M9 16h4"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M8 8v7M12 8v4M16 8v9"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h14v15H5z"/><path d="M10 9.5l4.5 2.5-4.5 2.5z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2-2.2 5.3-2.2-5.3-5.3-2.2 5.3-2.2z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
  update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/></svg>',
};

// ---------------------------------------------------------------- converting a link in one click

// Start a download of `text` (one link or several) as `fmt`, the same way the Video page does.
function quickConvert(text, fmt) {
  const btn = document.querySelector(`#toggle button[data-format="${fmt}"]`);
  if (btn && !btn.classList.contains("active")) btn.click();
  homeConvert(text, true);
}
// The link, its title and picture: looked up once per link, shared by the search and the paste card.
const qkInfo = new Map(); // url -> Promise of {title, meta, thumbnail} or null
function quickLookUp(url) {
  if (!qkInfo.has(url)) {
    qkInfo.set(url, api("/api/info", { url }).then((res) => {
      if (!res.ok) return null;
      const p = res.preview;
      return { title: p.title, thumbnail: p.thumbnail,
        meta: p.playlist ? `Playlist · ${p.entries.length} videos` : [p.channel, p.duration].filter(Boolean).join(" · ") };
    }).catch(() => null));
    if (qkInfo.size > 30) qkInfo.delete(qkInfo.keys().next().value);
  }
  return qkInfo.get(url);
}
const qkLink = (text) => {
  const links = linksIn(text || "");
  return links.length ? links : (looksLikeLink((text || "").trim()) && !/\s/.test(text.trim()) ? [text.trim()] : []);
};

// ---------------------------------------------------------------- quick search

const qk = { items: [], at: 0, run: 0, lists: false };

function qkPages() {
  return [...document.querySelectorAll("#tabs button[data-tab]")].map((b) => ({
    group: "Pages", label: b.querySelector("span").textContent.trim(), chip: b.dataset.tab, icon: b.querySelector("svg").outerHTML,
    words: { video: "youtube tiktok mp3 mp4 download song", files: "convert trim shrink compress", images: "picture photo png jpg resize crop",
      sfx: "library sounds sound effects music", docs: "script write document notes pdf", boards: "trello plan todo cards",
      fx: "film assets vfx clips explosions", games: "steam record", povs: "recordings share friends", copyright: "music check song",
      history: "downloads recent", home: "start channels" }[b.dataset.tab] || "",
    run: () => b.click(),
  }));
}

function qkActions() {
  const user = typeof sfxUser === "function" && sfxUser();
  const list = [
    { label: "New document", note: "Docs", icon: QK_ICONS.plus, chip: "docs", words: "write script create",
      run: () => { showTab("docs"); setTimeout(() => typeof openDocTypes === "function" && openDocTypes(), 60); } },
    { label: "New board", note: "Boards", icon: QK_ICONS.plus, chip: "boards", words: "create plan trello",
      run: () => {
        showTab("boards");
        let tries = 0; // the Boards home draws once its list is in
        (function press() { const b = document.querySelector("#boardsTab .bd-tile-new"); if (b) b.click(); else if (++tries < 20) setTimeout(press, 60); })();
      } },
    { label: "Open the chat", icon: QK_ICONS.chat, words: "message talk friends", run: () => openChat("") },
    { label: "Settings", icon: QK_ICONS.gear, words: "options preferences size", run: () => openSettings() },
    { label: "Where files are saved", note: "Settings", icon: QK_ICONS.folder, words: "folder save location", run: () => openSettings("save") },
    user ? { label: "My account", note: user.username, icon: QK_ICONS.user, words: "profile log out", run: () => showTab("account") }
      : { label: "Log in", note: "or create an account", icon: QK_ICONS.user, words: "sign in sign up account", run: () => openLogin("login") },
    { label: "How to use VaultHub", icon: QK_ICONS.play, words: "tour help tutorial", run: () => openTour() },
    { label: "What's new", icon: QK_ICONS.spark, words: "changes update news", run: () => showWhatsNew(CHANGES.slice(0, 3), "") },
    { label: "Send feedback", icon: QK_ICONS.heart, words: "idea bug report", run: () => openFeedback() },
    { label: "Check for updates", icon: QK_ICONS.update, words: "new version", run: () => $("checkNow").click() },
  ];
  return list.map((a) => ({ group: "Do something", ...a }));
}

// A time from the app (seconds) or the server (a date): seconds either way.
const qkStamp = (v) => typeof v === "number" ? v : (Date.parse(v || "") / 1000 || 0);

function qkFiles() {
  const out = [];
  const docs = [...(typeof docsLocal !== "undefined" ? docsLocal.map((d) => ({ d, where: "local" })) : []),
    ...(typeof docsCollab !== "undefined" && docsCollab ? docsCollab.docs.map((d) => ({ d, where: "collab" })) : [])];
  docs.sort((a, b) => qkStamp(b.d.updated_at) - qkStamp(a.d.updated_at));
  for (const { d, where } of docs) {
    out.push({ group: "Documents", label: d.title || "Untitled document", note: where === "collab" ? "Collab" : "On this computer",
      icon: QK_ICONS.doc, chip: "docs", recent: d.updated_at,
      run: () => { showTab("docs"); openDoc(where, d.id); } });
  }
  const boards = [...(typeof bdBoards !== "undefined" ? bdBoards : []), ...(typeof bdTeamBoards !== "undefined" && bdTeamBoards ? bdTeamBoards : [])];
  for (const b of boards) {
    out.push({ group: "Boards", label: b.title || "Untitled board", note: b.team ? "Team board" : "Your board",
      icon: QK_ICONS.board, chip: "boards",
      run: () => { showTab("boards"); b.team ? bdOpenTeam(b.id) : bdOpen(b.id); } });
  }
  return out;
}

// Documents and boards might not be loaded yet (their page wasn't opened): fetch the lists once.
async function qkLoadLists() {
  if (qk.lists) return;
  qk.lists = true;
  const [d, b] = await Promise.all([
    typeof docsLocal !== "undefined" && !docsLocal.length ? api("/api/docs-list", { collab: !!(typeof sfxUser === "function" && sfxUser()) }).catch(() => null) : null,
    typeof bdBoards !== "undefined" && !bdBoards.length ? api("/api/boards-list", {}).catch(() => null) : null,
  ]);
  if (d && d.ok) { docsLocal = d.local; if (d.collab) docsCollab = d.collab; }
  if (b && b.ok) bdBoards = b.boards;
  if (!$("quickModal").hidden) qkDraw();
}

// How well `text` matches the query: words that start the same score best; 0 = no match.
function qkScore(item, q) {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  const all = `${label} ${(item.note || "").toLowerCase()} ${item.words || ""} ${item.group.toLowerCase()}`;
  let score = 0;
  for (const w of q.split(/\s+/)) {
    if (label.startsWith(w)) score += 8;
    else if (new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(label)) score += 5;
    else if (label.includes(w)) score += 3;
    else if (all.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

function qkDraw() {
  const raw = $("quickInput").value;
  const q = raw.trim().toLowerCase();
  const links = qkLink(raw);
  let items = [];
  if (links.length) {
    const many = links.length > 1;
    items.push(
      { group: "Convert", label: many ? `Get ${links.length} songs as MP3` : "Get the song (MP3)", icon: QK_ICONS.music, chip: "video", link: links[0], run: () => quickConvert(links.join(" "), "mp3") },
      { group: "Convert", label: many ? `Get ${links.length} videos as MP4` : "Get the video (MP4)", icon: QK_ICONS.video, chip: "files", run: () => quickConvert(links.join(" "), "mp4") },
      { group: "Convert", label: "More options first", note: "Trim, quality, other formats", icon: QK_ICONS.check, run: () => homeConvert(links.join(" "), false) });
  } else {
    const pool = [...qkPages(), ...qkActions(), ...qkFiles()];
    if (!q) {
      // Nothing typed: the pages, a few handy things, and your newest documents and boards.
      items = [...qkPages(), ...qkActions().slice(0, 4), ...qkFiles().filter((i) => i.group === "Documents").slice(0, 3),
        ...qkFiles().filter((i) => i.group === "Boards").slice(0, 3)];
    } else {
      const order = ["Pages", "Do something", "Documents", "Boards"];
      items = pool.map((i) => ({ i, s: qkScore(i, q) })).filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || order.indexOf(a.i.group) - order.indexOf(b.i.group)).slice(0, 14).map((x) => x.i);
      // Keep each group together, best group first.
      const groups = [...new Set(items.map((i) => i.group))];
      items = groups.flatMap((g) => items.filter((i) => i.group === g));
    }
  }
  qk.items = items;
  qk.at = Math.min(qk.at, Math.max(0, items.length - 1));
  const box = $("quickList");
  box.replaceChildren();
  let group = "";
  items.forEach((item, n) => {
    if (item.group !== group) {
      group = item.group;
      box.append(Object.assign(document.createElement("div"), { className: "qk-group", textContent: group }));
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "qk-item" + (n === qk.at ? " on" : "");
    if (item.chip) b.dataset.chip = item.chip;
    b.innerHTML = `<i>${item.icon || ""}</i><span class="qk-text"><b></b><small></small></span><kbd>Enter</kbd>`;
    b.querySelector("b").textContent = item.label;
    b.querySelector("small").textContent = item.note || "";
    b.addEventListener("mousemove", () => { if (qk.at !== n) { qk.at = n; qkMark(); } });
    b.addEventListener("click", () => qkRun(item));
    box.append(b);
  });
  if (!items.length) box.append(Object.assign(document.createElement("p"), { className: "qk-empty", textContent: `Nothing found for "${raw.trim()}".` }));
  // A link: show which video it is.
  const card = $("quickLink");
  card.hidden = !links.length || links.length > 1;
  if (!card.hidden) {
    const url = links[0];
    card.dataset.url = url;
    qkFillLink(card, null);
    quickLookUp(url).then((info) => { if (card.dataset.url === url) qkFillLink(card, info, true); });
  }
}

// Fill a link card (in the search, or the paste card) with the video's picture and title.
function qkFillLink(card, info, done) {
  card.classList.toggle("loading", !done);
  card.querySelector(".ql-thumb").style.backgroundImage = info && info.thumbnail ? `url("${info.thumbnail}")` : "";
  card.querySelector(".ql-title").textContent = info ? info.title : done ? "Ready to convert" : "Looking up the link...";
  card.querySelector(".ql-meta").textContent = info ? info.meta : done ? "Couldn't see the title, but you can still try." : "";
}

function qkMark() {
  const rows = $("quickList").querySelectorAll(".qk-item");
  rows.forEach((r, n) => r.classList.toggle("on", n === qk.at));
  rows[qk.at]?.scrollIntoView({ block: "nearest" });
}

function qkRun(item) {
  closeQuick();
  if (typeof chatIsOpen === "function" && chatIsOpen() && item.group !== "Do something") closeChat();
  setTimeout(() => item.run(), 0);
}

function openQuick(text = "") {
  $("quickModal").hidden = false;
  $("quickInput").value = text;
  qk.at = 0;
  qk.lists = false;
  qkDraw();
  qkLoadLists();
  requestAnimationFrame(() => { $("quickInput").focus(); $("quickInput").select(); });
}
function closeQuick() { $("quickModal").hidden = true; }

$("quickOpen").addEventListener("click", () => openQuick());
$("quickInput").addEventListener("input", () => { qk.at = 0; qkDraw(); });
$("quickInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!qk.items.length) return;
    qk.at = (qk.at + (e.key === "ArrowDown" ? 1 : -1) + qk.items.length) % qk.items.length;
    qkMark();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (qk.items[qk.at]) qkRun(qk.items[qk.at]);
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeQuick();
  }
});
$("quickModal").addEventListener("mousedown", (e) => { if (e.target === $("quickModal")) closeQuick(); });

// Ctrl+K anywhere (in a document's text it's still "add a link").
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "k") return;
  if (e.target.closest && e.target.closest("[contenteditable=true], [contenteditable='']")) return;
  e.preventDefault();
  if ($("quickModal").hidden) openQuick(); else closeQuick();
});

// ---------------------------------------------------------------- paste anywhere

let pasteTimer = 0;
function typingIn(el) {
  return el && el.closest && !!el.closest("input, textarea, select, [contenteditable=true], [contenteditable='']");
}
document.addEventListener("paste", (e) => {
  if (typingIn(e.target) || typingIn(document.activeElement) || !$("quickModal").hidden) return;
  if (document.querySelector(".modal:not([hidden]):not(.leaving)")) return;
  const text = (e.clipboardData || window.clipboardData).getData("text") || "";
  const links = qkLink(text);
  if (!links.length) return;
  e.preventDefault();
  showPasteCard(links);
});

function showPasteCard(links) {
  const card = $("pasteCard");
  const many = links.length > 1;
  card.dataset.links = links.join(" ");
  card.querySelector(".pc-head").textContent = many ? `${links.length} links pasted` : "Link pasted";
  $("pasteMp3").lastElementChild.textContent = many ? "All as MP3" : "MP3";
  $("pasteMp4").lastElementChild.textContent = many ? "All as MP4" : "MP4";
  const link = card.querySelector(".quick-link");
  link.dataset.url = links[0];
  qkFillLink(link, null);
  if (many) qkFillLink(link, { title: `${links.length} videos`, meta: "They go one after another." }, true);
  else quickLookUp(links[0]).then((info) => { if (link.dataset.url === links[0]) qkFillLink(link, info, true); });
  card.hidden = false;
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(hidePasteCard, 15000);
}
function hidePasteCard() { clearTimeout(pasteTimer); $("pasteCard").hidden = true; }
$("pasteCard").addEventListener("mouseenter", () => clearTimeout(pasteTimer));
$("pasteCard").addEventListener("mouseleave", () => { pasteTimer = setTimeout(hidePasteCard, 6000); });
$("pasteMp3").addEventListener("click", () => { hidePasteCard(); quickConvert($("pasteCard").dataset.links, "mp3"); });
$("pasteMp4").addEventListener("click", () => { hidePasteCard(); quickConvert($("pasteCard").dataset.links, "mp4"); });
$("pasteMore").addEventListener("click", () => { hidePasteCard(); homeConvert($("pasteCard").dataset.links, false); });
$("pasteClose").addEventListener("click", hidePasteCard);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("pasteCard").hidden) hidePasteCard(); });
smoothHidden($("pasteCard"));

// The "Create a free account" buttons on pages that need an account.
document.querySelectorAll(".wl-signup").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openLogin("signup"); }));
