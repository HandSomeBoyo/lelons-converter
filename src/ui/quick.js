// Quick search (Ctrl+K) and keyboard shortcuts.
//
// Quick search: one box that finds any page, your documents, boards and games, and handy things to do
// (new document, settings, chat...). Typing or pasting a link offers to convert it right there.
// Shortcuts: Ctrl+1-9 jump to the pages in the side bar, Alt+Left/Right (or the mouse's side buttons)
// go back and forward, Ctrl+N makes something new on the page you're on, Ctrl+, opens Settings, and
// Ctrl+/ (or ?) shows the list of every shortcut.
// Uses $, api(), linksIn(), looksLikeLink() from app.js, showTab() from images.js, homeConvert() from home.js,
// and the Docs, Boards and Games lists (docsLocal, docsCollab, bdBoards, bdTeamBoards, gmGames).

const QK_ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const QK_ICONS = {
  music: QK_ICON('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  video: QK_ICON('<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 9.5v5l4-2.5z"/>'),
  sliders: QK_ICON('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  doc: QK_ICON('<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.5h6M9 16h4"/>'),
  script: QK_ICON('<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M10 12h4M8.5 15.5h7"/>'),
  board: QK_ICON('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M8 8v7M12 8v4M16 8v9"/>'),
  game: QK_ICON('<path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.9 4.4a2.4 2.4 0 0 1-4.1 1.1L13.6 15.5h-3.2l-2.3 2.4a2.4 2.4 0 0 1-4.1-1.1l-.9-4.4A4.5 4.5 0 0 1 7.5 7z"/><path d="M8 10v3M6.5 11.5h3"/>'),
  plus: QK_ICON('<path d="M12 5v14M5 12h14"/>'),
  gear: QK_ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  folder: QK_ICON('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  chat: QK_ICON('<path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z"/>'),
  user: QK_ICON('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  play: QK_ICON('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M10 9.5l4.5 2.5-4.5 2.5z"/>'),
  spark: QK_ICON('<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2-2.2 5.3-2.2-5.3-5.3-2.2 5.3-2.2z"/>'),
  heart: QK_ICON('<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>'),
  update: QK_ICON('<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>'),
  keys: QK_ICON('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>'),
};

const qkEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Some lists are `let` variables in other files (not on window): read them safely.
const qkList = (get) => { try { return get() || []; } catch (e) { return []; } };

// ---------------------------------------------------------------- converting a link

function quickConvert(text, fmt) {
  const btn = document.querySelector(`#toggle button[data-format="${fmt}"]`);
  if (btn && !btn.classList.contains("active")) btn.click();
  homeConvert(text, true);
}
const qkLinks = (text) => {
  const t = (text || "").trim();
  const links = linksIn(t);
  return links.length ? links : (looksLikeLink(t) && !/\s/.test(t) ? [t] : []);
};

// ---------------------------------------------------------------- what can be found

const qk = { items: [], at: 0, loaded: false };

// The pages in the side bar (new pages show up here on their own), in the order of Ctrl+1-9.
const qkTabButtons = () => [...document.querySelectorAll("#tabs button[data-tab]")];
const QK_WORDS = {
  home: "start channels", video: "youtube tiktok mp3 mp4 download song link convert", files: "convert trim shrink compress",
  images: "picture photo png jpg resize crop", resolve: "davinci subtitles silence edit", sfx: "library sounds sound effects music songs",
  docs: "script write document notes pdf", boards: "trello plan todo cards", fx: "film assets vfx clips explosions",
  comments: "comment inbox reply answer youtube viewers",
  feed: "friends activity feed today what new uploads", games: "steam record", povs: "recordings share friends", copyright: "music check song claim", titles: "title tags hashtags seo score ideas clickbait", history: "downloads recent",
};

function qkPages() {
  const tabs = qkTabButtons().map((b, n) => ({
    group: "Pages", label: b.querySelector("span").textContent.trim(), key: n < 9 ? `Ctrl+${n + 1}` : "",
    icon: b.querySelector("svg").outerHTML, words: QK_WORDS[b.dataset.tab] || "", run: () => b.click(),
  }));
  return [...tabs,
    { group: "Pages", label: "Chat", icon: QK_ICONS.chat, words: "message talk friends dm", run: () => $("chatButton").click() },
    { group: "Pages", label: "Settings", key: "Ctrl+,", icon: QK_ICONS.gear, words: "options preferences theme zoom", run: () => openSettings() },
  ];
}

function qkActions() {
  const user = typeof sfxUser === "function" && sfxUser();
  return [
    { label: "New document", icon: QK_ICONS.plus, words: "write create script docs", run: () => qkNew("docs") },
    { label: "New board", icon: QK_ICONS.plus, words: "create plan trello boards", run: () => qkNew("boards") },
    { label: "Post a game", icon: QK_ICONS.plus, words: "add steam link games new", run: () => qkNew("games") },
    { label: "Where files are saved", note: "Settings", icon: QK_ICONS.folder, words: "folder save location downloads", run: () => openSettings("save") },
    user ? { label: "My account", note: user.username, icon: QK_ICONS.user, words: "profile picture password log out", run: () => showTab("account") }
      : { label: "Log in", note: "or make an account", icon: QK_ICONS.user, words: "sign in sign up account", run: () => openLogin("login") },
    { label: "Keyboard shortcuts", key: "Ctrl+/", icon: QK_ICONS.keys, words: "keys hotkeys help", run: () => openShortcuts() },
    { label: "How to use VaultHub", icon: QK_ICONS.play, words: "tour help tutorial", run: () => openTour() },
    { label: "What's new", icon: QK_ICONS.spark, words: "changes update news", run: () => $("whatsNewOpen").click() },
    { label: "Send feedback", icon: QK_ICONS.heart, words: "idea bug report", run: () => openFeedback() },
    { label: "Check for updates", icon: QK_ICONS.update, words: "new version", run: () => $("checkNow").click() },
  ].map((a) => ({ group: "Do something", ...a }));
}

// A time from the app (seconds) or from the server (a date): seconds either way.
const qkStamp = (v) => (typeof v === "number" ? v : Date.parse(v || "") / 1000 || 0);

function qkThings() {
  const out = [];
  const docs = [...qkList(() => docsLocal).map((d) => ({ d, where: "local" })),
    ...qkList(() => docsCollab && docsCollab.docs).map((d) => ({ d, where: "collab" }))];
  docs.sort((a, b) => qkStamp(b.d.updated_at) - qkStamp(a.d.updated_at));
  for (const { d, where } of docs) {
    out.push({ group: "Documents", label: d.title || "Untitled", note: where === "collab" ? "Shared" : "On this computer",
      icon: d.kind === "script" ? QK_ICONS.script : QK_ICONS.doc, run: () => qkOpenDoc(where, d.id) });
  }
  const boards = [...qkList(() => bdBoards), ...qkList(() => bdTeamBoards)];
  for (const b of boards) {
    out.push({ group: "Boards", label: b.title || "Untitled board", note: b.team ? "Team board" : "Your board",
      icon: QK_ICONS.board, run: () => qkOpenBoard(b.id, !!b.team) });
  }
  const STATUS = { idea: "Idea", recording: "Recording", done: "Done" };
  for (const g of qkList(() => gmGames)) {
    out.push({ group: "Games", label: g.info.name, note: STATUS[g.status] || "", icon: QK_ICONS.game,
      words: [...(g.info.genres || []), ...(g.info.developers || [])].join(" ").toLowerCase(), run: () => qkOpenGame(g.id) });
  }
  return out;
}

// Documents, boards and games might not be loaded yet (their page wasn't opened): get the lists once.
async function qkLoad() {
  if (qk.loaded) return;
  qk.loaded = true;
  const user = typeof sfxUser === "function" && !!sfxUser();
  const ask = (path, body) => api(path, body).catch(() => null);
  const [d, b, t, g] = await Promise.all([
    !qkList(() => docsLocal).length ? ask("/api/docs-list", { collab: user }) : null,
    !qkList(() => bdBoards).length ? ask("/api/boards-list", {}) : null,
    user && !qkList(() => bdTeamBoards).length ? ask("/api/boards-team-list", {}) : null,
    user && !qkList(() => gmGames).length ? ask("/api/games-list", {}) : null,
  ]);
  try {
    if (d && d.ok) { docsLocal = d.local; if (d.collab) docsCollab = d.collab; }
    if (b && b.ok) bdBoards = b.boards;
    if (t && t.ok && !bdTeamBoards) bdTeamBoards = t.boards.map((x) => ({ ...x, team: true }));
    if (g && g.ok && !gmGames.length) gmGames = g.games;
  } catch (e) { /* a page that isn't there */ }
  if (!$("quickModal").hidden) qkDraw();
}

// ---------------------------------------------------------------- opening what was picked

async function qkOpenDoc(where, id) {
  if (typeof doc !== "undefined" && doc) {
    if (doc.where === where && doc.id === id) return showTab("docs");
    if (!(await docLeave())) return;
  }
  showTab("docs");
  openDoc(where, id);
}

async function qkOpenBoard(id, team) {
  const open = typeof bd !== "undefined" && bd;
  if (open && bd.id === id && !!bdTeam === team) return showTab("boards");
  if (open) await bdSaveNow();
  savePref("boardOpen", team ? "team:" + id : id);
  showTab("boards"); // (with no board open, this opens the one just picked)
  if (open) team ? bdOpenTeam(id) : bdOpen(id);
}

function qkOpenGame(id) {
  showTab("games");
  openGame(id);
}

// Ctrl+N: something new on the page you're on (or on the page asked for).
function qkNew(page) {
  const on = page || qkCurrentTab();
  if (on === "docs") {
    if (page) showTab("docs");
    if (typeof doc !== "undefined" && doc) docNewFromMenu(); else openDocTypes();
    return true;
  }
  if (on === "boards") {
    const go = () => {
      if (typeof bd !== "undefined" && bd) return bdClose().then(go);
      let tries = 0; // the Boards home draws once its list is in
      (function press() {
        const b = document.querySelector("#bdHomeLists .bd-tile-new");
        if (b && !$("boardsTab").hidden) b.click(); else if (++tries < 30) setTimeout(press, 60);
      })();
    };
    if (page) showTab("boards");
    go();
    return true;
  }
  if (on === "games") {
    if (page) showTab("games");
    setTimeout(() => { const box = $("gmLink"); if (box && box.offsetParent) { box.focus(); box.select(); } }, 60);
    return true;
  }
  if (on === "video" || on === "home") {
    const box = on === "video" ? $("url") : document.querySelector("#homeForm input");
    if (box) { box.focus(); box.select(); }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- the search box

// How well an item matches: words that start the same score best; 0 = no match.
// (Dots and apostrophes don't count: "repo" finds "R.E.P.O.", "whats new" finds "What's new".)
const qkPlain = (text) => (text || "").toLowerCase().replace(/[.'’]/g, "");
function qkScore(item, q) {
  const label = qkPlain(item.label);
  const all = `${label} ${qkPlain(item.note)} ${item.words || ""}`;
  let score = 0;
  for (const w of qkPlain(q).split(/\s+/).filter(Boolean)) {
    const start = new RegExp("(^|[^a-z0-9])" + qkEsc(w));
    if (label.startsWith(w)) score += 8;
    else if (start.test(label)) score += 5;
    else if (w.length > 3 && label.includes(w)) score += 3; // (inside a word: only for longer words, "hor" isn't "shortcuts")
    else if (start.test(all)) score += 1;
    else return 0;
  }
  return score;
}

function qkDraw() {
  const raw = $("quickInput").value;
  const q = raw.trim().toLowerCase();
  const links = qkLinks(raw);
  let items = [];
  if (links.length) {
    const many = links.length > 1;
    const all = links.join(" ");
    items = [
      { group: "Convert", label: many ? `Get ${links.length} songs as MP3` : "Get the song (MP3)", icon: QK_ICONS.music, run: () => quickConvert(all, "mp3") },
      { group: "Convert", label: many ? `Get ${links.length} videos as MP4` : "Get the video (MP4)", icon: QK_ICONS.video, run: () => quickConvert(all, "mp4") },
      { group: "Convert", label: "More options first", note: "Trim, quality, other formats", icon: QK_ICONS.sliders, run: () => homeConvert(all, false) },
    ];
  } else if (!q) {
    // Nothing typed yet: the pages, a few handy things, and your newest documents, boards and games.
    const things = qkThings();
    items = [...qkPages(), ...qkActions().slice(0, 3),
      ...["Documents", "Boards", "Games"].flatMap((g) => things.filter((i) => i.group === g).slice(0, 3))];
  } else {
    const order = ["Pages", "Documents", "Boards", "Games", "Do something"];
    items = [...qkPages(), ...qkActions(), ...qkThings()].map((i) => ({ i, s: qkScore(i, q) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || order.indexOf(a.i.group) - order.indexOf(b.i.group)).slice(0, 16).map((x) => x.i);
    // Each group stays together, the best group first.
    const groups = [...new Set(items.map((i) => i.group))];
    items = groups.flatMap((g) => items.filter((i) => i.group === g));
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
    b.innerHTML = `<i>${item.icon || ""}</i><span class="qk-text"><b></b><small></small></span>${item.key ? `<kbd>${item.key.replace("+", " ")}</kbd>` : ""}`;
    b.querySelector("b").textContent = item.label;
    b.querySelector("small").textContent = item.note || "";
    b.addEventListener("mousemove", () => { if (qk.at !== n) { qk.at = n; qkMark(); } });
    b.addEventListener("click", () => qkRun(item));
    box.append(b);
  });
  if (!items.length) {
    box.append(Object.assign(document.createElement("p"), { className: "qk-empty", textContent: `Nothing found for "${raw.trim()}".` }));
  }
}

function qkMark() {
  const rows = $("quickList").querySelectorAll(".qk-item");
  rows.forEach((r, n) => r.classList.toggle("on", n === qk.at));
  if (rows[qk.at]) rows[qk.at].scrollIntoView({ block: "nearest" });
}

function qkRun(item) {
  closeQuick();
  if (typeof chatIsOpen === "function" && chatIsOpen() && item.group !== "Do something" && item.label !== "Chat") closeChat();
  setTimeout(() => item.run(), 0);
}

function openQuick(text = "") {
  $("quickModal").hidden = false;
  $("quickInput").value = text;
  qk.at = 0;
  qk.loaded = false;
  qkDraw();
  qkLoad();
  requestAnimationFrame(() => { $("quickInput").focus(); $("quickInput").select(); });
}
function closeQuick() { $("quickModal").hidden = true; }

$("quickOpen").addEventListener("click", () => openQuick());
$("quickInput").addEventListener("input", () => { qk.at = 0; qkDraw(); });
$("quickInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || (e.key === "Tab" && qk.items.length)) {
    e.preventDefault();
    if (!qk.items.length) return;
    const down = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey);
    qk.at = (qk.at + (down ? 1 : -1) + qk.items.length) % qk.items.length;
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
smoothHidden($("quickModal"));

// ---------------------------------------------------------------- the list of shortcuts

const QK_SHEET = [
  ["Anywhere", [
    ["Ctrl+K", "Search everything"],
    ["Ctrl+1 … 9", "Go to a page in the side bar"],
    ["Alt+← / Alt+→", "Back and forward"],
    ["Ctrl+N", "Make something new on this page"],
    ["Ctrl+,", "Settings"],
    ["F5", "Refresh the page"],
    ["Ctrl++ / Ctrl+-", "Bigger or smaller"],
    ["Ctrl+0", "Normal size"],
    ["Space", "Play or pause the music bar"],
    ["Esc", "Close a popup"],
    ["Ctrl+/", "This list"],
  ]],
  ["In a document", [
    ["Ctrl+S", "Save"],
    ["Ctrl+F", "Find"],
    ["Ctrl+H", "Find and replace"],
    ["Ctrl+Z / Ctrl+Y", "Undo and redo"],
    ["Ctrl+K", "Add a link"],
    ["Ctrl+P", "Print"],
    ["Ctrl+Enter", "New page"],
    ["Ctrl+Shift+C", "Word count"],
    ["Ctrl+Alt+M", "Add a comment"],
    ["Ctrl+1 … 8", "Line type (in a movie script)"],
  ]],
  ["On a board", [
    ["F", "Filter cards"],
    ["X", "Clear the filter"],
    [";", "Show label names"],
  ]],
];

function qkKeys(text) {
  return text.split(" / ").map((combo) => combo.split(/\+(?=.)/).map((k) => `<kbd>${k}</kbd>`).join("")).join('<span class="sc-or">or</span>');
}

function openShortcuts() {
  const box = $("shortcutsList");
  if (!box.children.length) {
    for (const [title, rows] of QK_SHEET) {
      const part = Object.assign(document.createElement("section"), { className: "sc-part" });
      part.append(Object.assign(document.createElement("h3"), { textContent: title }));
      for (const [keys, what] of rows) {
        const row = Object.assign(document.createElement("div"), { className: "sc-row" });
        row.innerHTML = `<span class="sc-what"></span><span class="sc-keys">${qkKeys(keys)}</span>`;
        row.firstChild.textContent = what;
        part.append(row);
      }
      box.append(part);
    }
  }
  $("shortcutsModal").hidden = false;
}
function closeShortcuts() { $("shortcutsModal").hidden = true; }
$("shortcutsClose").addEventListener("click", closeShortcuts);
$("shortcutsModal").addEventListener("mousedown", (e) => { if (e.target === $("shortcutsModal")) closeShortcuts(); });
$("shortcutsOpen").addEventListener("click", () => { $("helpPop").hidden = true; openShortcuts(); });
smoothHidden($("shortcutsModal"));

// ---------------------------------------------------------------- back and forward between pages

const qkTrail = { list: [], at: -1, moving: false };
const qkCurrentTab = () => (document.querySelector(".tab-page:not([hidden])") || { id: "" }).id.replace(/Tab$/, "");

// showTab() (images.js) is wrapped to remember where you've been.
const qkShowTabFirst = showTab;
showTab = function (tab) { // eslint-disable-line no-global-assign
  qkShowTabFirst(tab);
  if (qkTrail.moving) return;
  if (qkTrail.list[qkTrail.at] === tab) return;
  qkTrail.list = qkTrail.list.slice(0, qkTrail.at + 1).concat(tab).slice(-50);
  qkTrail.at = qkTrail.list.length - 1;
};
qkTrail.list = [qkCurrentTab()];
qkTrail.at = 0;

function qkStep(by) {
  const to = qkTrail.at + by;
  if (to < 0 || to >= qkTrail.list.length) return;
  qkTrail.at = to;
  qkTrail.moving = true;
  try {
    if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
    showTab(qkTrail.list[to]);
  } finally {
    qkTrail.moving = false;
  }
}

// ---------------------------------------------------------------- the keys

const qkTyping = (el) => !!(el && el.closest && el.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"));
// Another popup is open (not the search or the list of shortcuts).
const qkPopupOpen = () => [...document.querySelectorAll(".modal:not([hidden]):not(.leaving)")]
  .some((m) => m.id !== "quickModal" && m.id !== "shortcutsModal" && m.getClientRects().length);

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat) return; // (a page already used this key, like Ctrl+K for a link in a document)
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // Ctrl+K: search (again: close it).
  if (ctrl && !e.shiftKey && !e.altKey && key === "k") {
    e.preventDefault();
    if ($("quickModal").hidden) { closeShortcuts(); openQuick(); } else closeQuick();
    return;
  }
  // Ctrl+/ or ?: the list of shortcuts.
  if ((ctrl && !e.altKey && (e.key === "/" || e.code === "Slash")) || (e.key === "?" && !ctrl && !e.altKey && !qkTyping(e.target))) {
    e.preventDefault();
    if ($("shortcutsModal").hidden) { closeQuick(); openShortcuts(); } else closeShortcuts();
    return;
  }
  if (e.key === "Escape" && !$("shortcutsModal").hidden) { e.stopPropagation(); closeShortcuts(); return; }
  if (!$("quickModal").hidden || !$("shortcutsModal").hidden || qkPopupOpen()) return;
  // Ctrl+1-9: the pages in the side bar, top to bottom.
  if (ctrl && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
    const b = qkTabButtons()[Number(e.code.slice(5)) - 1];
    if (!b) return;
    e.preventDefault();
    b.click();
    return;
  }
  // Alt+Left / Alt+Right: back and forward.
  if (e.altKey && !ctrl && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    if (qkTyping(e.target)) return; // (in a text box, Alt+arrows are left alone)
    e.preventDefault();
    qkStep(e.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  // Ctrl+,: Settings.
  if (ctrl && !e.shiftKey && !e.altKey && e.key === ",") {
    e.preventDefault();
    openSettings();
    return;
  }
  // Ctrl+N: something new here.
  if (ctrl && !e.shiftKey && !e.altKey && key === "n") {
    e.preventDefault(); // (never a second window)
    qkNew();
  }
});
// The mouse's side buttons go back and forward too.
document.addEventListener("mouseup", (e) => {
  if ((e.button !== 3 && e.button !== 4) || qkPopupOpen()) return;
  e.preventDefault();
  qkStep(e.button === 3 ? -1 : 1);
});

// The side bar's names show their shortcut when you hover them.
qkTabButtons().forEach((b, n) => { if (n < 9 && b.title && !/Ctrl\+/.test(b.title)) b.title += ` (Ctrl+${n + 1})`; });
