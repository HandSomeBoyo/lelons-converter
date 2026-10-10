// The Boards tab: Trello-like boards. A board has lists, a list has cards, and a card can have
// labels, dates, a description, checklists, links, a cover color and comments. Drag cards between
// lists and drag lists around. Boards are saved on this computer only for now (see boards.py):
// every change is sent back as the whole board a moment later.
// Uses $, api() from app.js, showTab() from images.js, sfxUser() from sfx.js, loadPref()/savePref() from theme.js.

const BD_BGS = {
  blue: "#0c66e4", orange: "#c25100", green: "#1f845a", red: "#c9372c", purple: "#6e5dc6",
  pink: "#ae4787", lime: "#4c6b1f", sky: "#227d9b", grey: "#626f86",
  ocean: "linear-gradient(135deg, #0c66e4 0%, #37b4c3 100%)", dusk: "linear-gradient(135deg, #6e5dc6 0%, #e774bb 100%)",
  sunset: "linear-gradient(135deg, #e2483d 0%, #f5cd47 100%)", forest: "linear-gradient(135deg, #1f845a 0%, #94c748 100%)",
  night: "linear-gradient(135deg, #172b4d 0%, #44546f 100%)", candy: "linear-gradient(135deg, #e774bb 0%, #fea362 100%)",
  aurora: "linear-gradient(135deg, #0055cc 0%, #6e5dc6 50%, #e774bb 100%)",
};
const BD_BG_GRADIENTS = ["ocean", "dusk", "sunset", "forest", "night", "candy", "aurora"];
const BD_BG_COLORS = ["blue", "orange", "green", "red", "purple", "pink", "lime", "sky", "grey"];
// Label colors like Trello's: each hue in a soft, normal and strong shade.
const BD_HUES = {
  green: ["#baf3db", "#4bce97", "#1f845a"], yellow: ["#f8e6a0", "#f5cd47", "#946f00"], orange: ["#fedec8", "#fea362", "#c25100"],
  red: ["#ffd5d2", "#f87168", "#c9372c"], purple: ["#dfd8fd", "#9f8fef", "#6e5dc6"], blue: ["#cce0ff", "#579dff", "#0c66e4"],
  sky: ["#c6edfb", "#6cc3e0", "#227d9b"], lime: ["#d3f1a7", "#94c748", "#5b7f24"], pink: ["#fdd0ec", "#e774bb", "#ae4787"],
  black: ["#dcdfe4", "#8590a2", "#626f86"],
};
const BD_COLOR_LIST = Object.entries(BD_HUES).flatMap(([hue, shades]) => shades.map((c, i) => ({ key: hue + i, color: c })));
const bdColor = (key) => { const hue = BD_HUES[String(key).slice(0, -1)]; return hue ? hue[+String(key).slice(-1)] || hue[1] : "#8590a2"; };
const bdDarkText = (key) => String(key).endsWith("0") || /^(yellow|lime|sky|green|orange)1$/.test(key);
const BD_TEMPLATES = {
  empty: { name: "Empty board", lists: [] },
  todo: { name: "To do, Doing, Done", lists: ["To do", "Doing", "Done"] },
  video: { name: "YouTube video", lists: ["Ideas", "Script", "Filming", "Editing", "Ready to post", "Posted"] },
  week: { name: "Week plan", lists: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Weekend"] },
};
const BD_ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h10"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5.5h16v11H9l-4 3.5v-3.5H4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 12.3l2.7 2.7L16 9.5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.5"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 10h17"/></svg>',
  cover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 10h17" /><path d="M3.5 4h17v6h-17z" fill="currentColor" stroke="none" opacity=".45"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M14 7l5 5-5 5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="5" rx="1.5"/><path d="M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M4 12h16M4 18h12"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 15.5-4.5-4.5-8.5 8.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l-4 7 4 7M15 5l4 7-4 7"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};

let bdBoards = [];            // the boards (summaries) on the Boards home
let bd = null;                // the open board
let bdSaveTimer = 0;
let bdSaving = false;
let bdSaveAgain = false;
let bdComposer = null;        // {list, text}: the "add a card" box that's open
let bdAddingList = null;      // the text in the "add another list" box, or null when it's closed
let bdMenu = "";              // the board menu on the right: "" (closed), "main", "about", "bg", "labels", "archive", "activity"
let bdArchiveView = "cards";
let bdFilter = { text: "", labels: new Set(), due: new Set() };
let bdCardId = "";            // the card that's open
let bdDetails = true;         // show the card's history under its comments
let bdDragged = false;        // a drag just ended: the click that follows isn't a click

const bdNewId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const bdMe = () => (typeof sfxUser === "function" && sfxUser() && sfxUser().username) || "You";

function bdEl(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

// box.append() that skips the empty bits (null when something isn't shown) and takes lists too.
function bdSafe(box) {
  const append = box.append.bind(box);
  box.append = (...kids) => append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return box;
}

function bdAgo(when) {
  const seconds = (Date.now() - when) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + " h ago";
  if (seconds < 86400 * 7) return Math.round(seconds / 86400) + (seconds < 86400 * 1.5 ? " day ago" : " days ago");
  return new Date(when).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------- the board's data

function bdFind(cardId) {
  for (const list of bd.lists) {
    const index = list.cards.findIndex((c) => c.id === cardId);
    if (index >= 0) return { list, card: list.cards[index], index };
  }
  return null;
}
const bdList = (id) => bd.lists.find((l) => l.id === id);
const bdOpenLists = () => bd.lists.filter((l) => !l.archived);
const bdLabel = (id) => bd.labels.find((l) => l.id === id);

function bdLog(text, card) {
  const entry = { at: Date.now(), who: bdMe(), text };
  bd.log = [entry, ...(bd.log || [])].slice(0, 300);
  if (card) card.log = [entry, ...(card.log || [])].slice(0, 100);
}

function bdNewCard(title) {
  return { id: bdNewId(), title, desc: "", labels: [], start: "", due: "", done: false, checklists: [], links: [], comments: [], cover: "", created: Date.now(), log: [] };
}

function bdNewBoard(title, bg, template) {
  const board = {
    title, bg, starred: false, desc: "", labelsWide: false, log: [],
    labels: ["green1", "yellow1", "orange1", "red1", "purple1", "blue1"].map((color) => ({ id: bdNewId(), color, name: "" })),
    lists: (BD_TEMPLATES[template] || BD_TEMPLATES.empty).lists.map((name) => ({ id: bdNewId(), title: name, cards: [], archived: false, color: "", collapsed: false })),
  };
  board.log = [{ at: Date.now(), who: bdMe(), text: "made this board" }];
  return board;
}

// Something changed: draw it again and save in a moment.
function bdChanged() {
  bdDraw();
  if (bdCardId) bdDrawCard();
  clearTimeout(bdSaveTimer);
  bdSaveTimer = setTimeout(bdSave, 400);
}

async function bdSave() {
  clearTimeout(bdSaveTimer);
  if (!bd) return;
  if (bdSaving) { bdSaveAgain = true; return; }
  bdSaving = true;
  const res = await api("/api/boards-save", { id: bd.id, board: bd }).catch(() => ({ ok: false, error: "Couldn't save the board." }));
  bdSaving = false;
  if (!res.ok) bdToast(res.error || "Couldn't save the board.");
  if (bdSaveAgain) { bdSaveAgain = false; bdSave(); }
}

function bdToast(text) {
  let t = $("bdToast");
  if (!t) document.body.append(t = bdEl("div", { id: "bdToast", class: "bd-toast" }));
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3200);
}

// ---------------------------------------------------------------- dates

const bdDate = (value) => value ? new Date(value.length <= 10 ? value + "T12:00" : value) : null;
function bdDateText(value, withTime) {
  const d = bdDate(value);
  if (!d || isNaN(d)) return "";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  let text = d.toLocaleDateString([], opts);
  if (withTime && value.length > 10) text += ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return text;
}
// "done", "overdue", "soon" (in the next 24 hours) or "" for a card's due date.
function bdDueState(card) {
  if (!card.due) return "";
  if (card.done) return "done";
  const left = bdDate(card.due) - Date.now();
  return left < 0 ? "overdue" : left < 86400000 ? "soon" : "";
}

// ---------------------------------------------------------------- the filter

const bdFiltering = () => !!(bdFilter.text.trim() || bdFilter.labels.size || bdFilter.due.size);
function bdShows(card) {
  const text = bdFilter.text.trim().toLowerCase();
  if (text) {
    const words = [card.title, card.desc, ...card.labels.map((id) => (bdLabel(id) || {}).name || "")].join(" ").toLowerCase();
    if (!text.split(/\s+/).every((w) => words.includes(w))) return false;
  }
  if (bdFilter.labels.size && ![...bdFilter.labels].some((id) => id === "none" ? !card.labels.filter(bdLabel).length : card.labels.includes(id))) return false;
  if (bdFilter.due.size) {
    const state = bdDueState(card);
    const ok = [...bdFilter.due].some((want) =>
      want === "none" ? !card.due : want === "overdue" ? state === "overdue" : want === "soon" ? state === "soon" :
      want === "done" ? !!card.due && card.done : want === "notdone" ? !!card.due && !card.done : false);
    if (!ok) return false;
  }
  return true;
}

// ---------------------------------------------------------------- the Boards home

async function bdLoadHome() {
  const res = await api("/api/boards-list", {}).catch(() => ({ ok: false }));
  if (res.ok) bdBoards = res.boards;
  bdDrawHome();
}

function bdTile(b) {
  const star = bdEl("button", { type: "button", class: "bd-tile-star" + (b.starred ? " on" : ""), title: b.starred ? "Unstar" : "Star this board",
    html: b.starred ? BD_ICONS.starOn : BD_ICONS.star,
    onclick: async (e) => {
      e.stopPropagation();
      b.starred = !b.starred;
      bdDrawHome();
      await api("/api/boards-star", { id: b.id, starred: b.starred }).catch(() => {});
    } });
  return bdEl("div", { class: "bd-tile", tabindex: "0", style: { background: BD_BGS[b.bg] || BD_BGS.blue },
    onclick: () => bdOpen(b.id), onkeydown: (e) => { if (e.key === "Enter") bdOpen(b.id); } },
  bdEl("span", { class: "bd-tile-title", text: b.title }),
  bdEl("span", { class: "bd-tile-count", text: b.cards === 1 ? "1 card" : b.cards + " cards" }), star);
}

function bdDrawHome() {
  const box = $("bdHomeLists");
  box.replaceChildren();
  const starred = bdBoards.filter((b) => b.starred);
  const recent = [...bdBoards].filter((b) => b.opened).sort((a, b) => b.opened - a.opened).slice(0, 4);
  if (starred.length) box.append(bdEl("h3", { class: "bd-home-head", html: BD_ICONS.star + "<span>Starred boards</span>" }), bdEl("div", { class: "bd-grid" }, starred.map(bdTile)));
  if (recent.length && bdBoards.length > 4) box.append(bdEl("h3", { class: "bd-home-head", html: BD_ICONS.clock + "<span>Recently viewed</span>" }), bdEl("div", { class: "bd-grid" }, recent.map(bdTile)));
  const add = bdEl("button", { type: "button", class: "bd-tile bd-tile-new", onclick: (e) => bdCreatePop(e.currentTarget) },
    bdEl("span", { text: "Create new board" }));
  box.append(bdEl("h3", { class: "bd-home-head", html: BD_ICONS.card + "<span>Your boards</span>" }), bdEl("div", { class: "bd-grid" }, bdBoards.map(bdTile), add));
  if (!bdBoards.length) box.append(bdEl("p", { class: "bd-home-empty", text: "Make a board for a video, a project or your week. Put lists on it (like To do, Doing, Done) and cards in the lists, then drag the cards along as things get done." }));
}

function bdCreatePop(anchor) {
  let bg = "blue";
  let template = "todo";
  bdPop(anchor, "Create board", (box) => {
    const preview = bdEl("div", { class: "bd-create-preview" }, bdEl("i"), bdEl("i"), bdEl("i"));
    const swatches = (keys, cls) => bdEl("div", { class: "bd-swatches " + cls }, keys.map((key) =>
      bdEl("button", { type: "button", class: "bd-swatch" + (key === bg ? " on" : ""), title: key, style: { background: BD_BGS[key] },
        onclick: (e) => { bg = key; box.querySelectorAll(".bd-swatch").forEach((s) => s.classList.toggle("on", s === e.currentTarget)); paint(); } })));
    const paint = () => { preview.style.background = BD_BGS[bg]; };
    const title = bdEl("input", { class: "bd-input", maxlength: "120", placeholder: "Like My next video", autocomplete: "off", spellcheck: "false" });
    const pick = bdEl("select", { class: "bd-input" }, Object.entries(BD_TEMPLATES).map(([key, t]) => bdEl("option", { value: key, text: t.name, selected: key === template })));
    pick.addEventListener("change", () => { template = pick.value; });
    const go = bdEl("button", { type: "button", class: "small-button bd-wide", text: "Create", disabled: true, onclick: create });
    title.addEventListener("input", () => { go.disabled = !title.value.trim(); });
    title.addEventListener("keydown", (e) => { if (e.key === "Enter" && title.value.trim()) create(); });
    async function create() {
      go.disabled = true;
      const res = await api("/api/boards-create", { board: bdNewBoard(title.value.trim(), bg, template) }).catch(() => ({ ok: false }));
      if (!res.ok) { go.disabled = false; return bdToast(res.error || "Couldn't make the board."); }
      bdPopClose();
      bdShow(res.board);
    }
    paint();
    box.append(preview, bdEl("label", { class: "bd-label-text", text: "Background" }), swatches(BD_BG_GRADIENTS, "big"), swatches(BD_BG_COLORS, ""),
      bdEl("label", { class: "bd-label-text", text: "Board title" }), title,
      bdEl("label", { class: "bd-label-text", text: "Start with" }), pick, go);
    setTimeout(() => title.focus(), 30);
  });
}

// ---------------------------------------------------------------- opening a board

async function bdOpen(id) {
  const res = await api("/api/boards-open", { id }).catch(() => ({ ok: false }));
  if (!res.ok) { savePref("boardOpen", ""); bdToast(res.error || "Couldn't open that board."); return bdLoadHome(); }
  bdShow(res.board);
}

function bdShow(board) {
  board.lists = (board.lists || []).filter((l) => l && Array.isArray(l.cards));
  board.labels = board.labels || [];
  for (const list of board.lists) for (const c of list.cards) Object.assign(c, { ...bdNewCard(""), ...c });
  bd = board;
  bdFilter = { text: "", labels: new Set(), due: new Set() };
  bdMenu = ""; bdComposer = null; bdAddingList = null; bdCardId = "";
  if (loadPref("boardOpen") !== board.id) savePref("boardOpen", board.id);
  $("bdHome").hidden = true;
  $("bdBoard").hidden = false;
  document.body.classList.add("board-open");
  bdDraw();
}

async function bdClose() {
  if (bd) await bdSave();
  bd = null;
  bdCardClose();
  bdPopClose();
  savePref("boardOpen", "");
  $("bdBoard").hidden = true;
  $("bdBoard").replaceChildren();
  $("bdHome").hidden = false;
  document.body.classList.remove("board-open");
  bdLoadHome();
}

function boardsTabChanged(tab) {
  if (tab !== "boards") {
    document.body.classList.remove("board-open");
    bdPopClose();
    if (bd) bdSave();
    return;
  }
  if (bd) { document.body.classList.add("board-open"); return bdDraw(); }
  const last = loadPref("boardOpen");
  if (last) bdOpen(last);
  else bdLoadHome();
}

// ---------------------------------------------------------------- drawing the board

function bdDraw() {
  if (!bd) return;
  const root = $("bdBoard");
  const oldCanvas = root.querySelector(".bd-canvas");
  const scrollX = oldCanvas ? oldCanvas.scrollLeft : 0;
  const scrollY = {};
  root.querySelectorAll(".bd-cards").forEach((c) => { scrollY[c.dataset.list] = c.scrollTop; });
  const menuScroll = root.querySelector(".bd-menu-body") ? root.querySelector(".bd-menu-body").scrollTop : 0;
  const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement.dataset.focus : "";

  root.style.background = BD_BGS[bd.bg] || BD_BGS.blue;
  root.classList.toggle("labels-wide", !!bd.labelsWide);
  root.replaceChildren(bdBar(), bdEl("div", { class: "bd-main" }, bdCanvas(), bdMenu ? bdMenuPanel() : null));

  const canvas = root.querySelector(".bd-canvas");
  canvas.scrollLeft = scrollX;
  root.querySelectorAll(".bd-cards").forEach((c) => { if (scrollY[c.dataset.list]) c.scrollTop = scrollY[c.dataset.list]; });
  if (root.querySelector(".bd-menu-body")) root.querySelector(".bd-menu-body").scrollTop = menuScroll;
  const again = (focused && root.querySelector(`[data-focus="${CSS.escape(focused)}"]`)) || root.querySelector(".bd-compose, .bd-add-list.open input");
  if (again && (!document.activeElement || !document.activeElement.closest(".bd-pop, .bd-quick, #bdCardModal"))) {
    again.focus();
    if (again.setSelectionRange && again.value !== undefined) again.setSelectionRange(again.value.length, again.value.length);
  }
}

function bdInlineEdit(holder, value, onDone, opts = {}) {
  const input = bdEl(opts.multi ? "textarea" : "input", { class: "bd-inline " + (opts.cls || ""), value, maxlength: opts.max || "200", spellcheck: "false" });
  if (opts.multi) input.rows = 1;
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.replace(/\s+/g, " ").trim();
    if (save && v && v !== value) onDone(v); else bdDraw();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
  const grow = () => { if (opts.multi) { input.style.height = "auto"; input.style.height = input.scrollHeight + "px"; } };
  input.addEventListener("input", grow);
  holder.replaceWith(input);
  grow();
  input.focus();
  input.select();
}

function bdBar() {
  const title = bdEl("button", { type: "button", class: "bd-title", text: bd.title, title: "Rename the board",
    onclick: (e) => bdInlineEdit(e.currentTarget, bd.title, (v) => { bdLog(`renamed this board to "${v}"`); bd.title = v; bdChanged(); }, { cls: "bd-title-edit", max: "120" }) });
  const star = bdEl("button", { type: "button", class: "bd-bar-btn bd-star" + (bd.starred ? " on" : ""), title: bd.starred ? "Unstar" : "Star this board",
    html: bd.starred ? BD_ICONS.starOn : BD_ICONS.star, onclick: () => { bd.starred = !bd.starred; bdChanged(); } });
  const count = bdFiltering() ? bd.lists.filter((l) => !l.archived).reduce((n, l) => n + l.cards.filter((c) => !c.archived && bdShows(c)).length, 0) : 0;
  const filter = bdEl("button", { type: "button", class: "bd-bar-btn bd-filter-btn" + (bdFiltering() ? " on" : ""), onclick: (e) => bdFilterPop(e.currentTarget) },
    bdEl("span", { html: BD_ICONS.filter }), bdEl("span", { text: bdFiltering() ? `${count} match${count === 1 ? "" : "es"}` : "Filter" }));
  const clear = bdFiltering() ? bdEl("button", { type: "button", class: "bd-bar-btn", text: "Clear all", onclick: () => { bdFilter = { text: "", labels: new Set(), due: new Set() }; bdDraw(); } }) : null;
  const me = bdEl("span", { class: "bd-me", title: bdMe(), text: bdMe()[0].toUpperCase() });
  const menu = bdEl("button", { type: "button", class: "bd-bar-btn" + (bdMenu ? " on" : ""), title: "Menu", html: BD_ICONS.dots,
    onclick: () => { bdMenu = bdMenu ? "" : "main"; bdDraw(); } });
  return bdEl("div", { class: "bd-bar" },
    bdEl("button", { type: "button", class: "bd-bar-btn bd-back", title: "All boards", onclick: bdClose }, bdEl("span", { html: BD_ICONS.back }), bdEl("span", { text: "Boards" })),
    title, star, bdEl("span", { class: "bd-spacer" }), filter, clear, me, menu);
}

function bdCanvas() {
  const canvas = bdEl("div", { class: "bd-canvas" });
  for (const list of bdOpenLists()) canvas.append(bdListEl(list));
  if (bdAddingList === null) {
    canvas.append(bdEl("button", { type: "button", class: "bd-add-list", onclick: () => { bdAddingList = ""; bdDraw(); } },
      bdEl("span", { html: BD_ICONS.plus }), bdEl("span", { text: bdOpenLists().length ? "Add another list" : "Add a list" })));
  } else {
    const input = bdEl("input", { class: "bd-input", placeholder: "Enter list name...", maxlength: "120", value: bdAddingList, "data-focus": "new-list", spellcheck: "false" });
    const add = () => {
      const name = input.value.trim();
      if (!name) return input.focus();
      bd.lists.push({ id: bdNewId(), title: name, cards: [], archived: false, color: "", collapsed: false });
      bdLog(`added list "${name}" to this board`);
      bdAddingList = "";
      bdChanged();
      const canvas = $("bdBoard").querySelector(".bd-canvas");
      canvas.scrollLeft = canvas.scrollWidth;
    };
    input.addEventListener("input", () => { bdAddingList = input.value; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { e.stopPropagation(); bdAddingList = null; bdDraw(); } });
    canvas.append(bdEl("div", { class: "bd-add-list open" }, input, bdEl("div", { class: "bd-row" },
      bdEl("button", { type: "button", class: "small-button", text: "Add list", onclick: add }),
      bdEl("button", { type: "button", class: "bd-x", html: BD_ICONS.close, title: "Cancel", onclick: () => { bdAddingList = null; bdDraw(); } }))));
  }
  return canvas;
}

function bdListEl(list) {
  const cards = list.cards.filter((c) => !c.archived);
  const shown = cards.filter(bdShows);
  if (list.collapsed) {
    return bdEl("div", { class: "bd-list collapsed", "data-id": list.id, style: list.color ? { "--list": bdColor(list.color) } : null, title: "Open this list",
      onclick: () => { list.collapsed = false; bdChanged(); } },
    bdEl("span", { class: "bd-collapsed-icon", html: BD_ICONS.collapse }), bdEl("span", { class: "bd-collapsed-title", text: list.title }), bdEl("span", { class: "bd-collapsed-count", text: String(cards.length) }));
  }
  const head = bdEl("div", { class: "bd-list-head" },
    bdEl("button", { type: "button", class: "bd-list-title", text: list.title,
      onclick: (e) => { if (!bdDragged) bdInlineEdit(e.currentTarget, list.title, (v) => { bdLog(`renamed list "${list.title}" to "${v}"`); list.title = v; bdChanged(); }, { multi: true, cls: "bd-list-title-edit", max: "120" }); } }),
    bdFiltering() ? bdEl("span", { class: "bd-list-count", text: `${shown.length}/${cards.length}` }) : null,
    bdEl("button", { type: "button", class: "bd-icon-btn", title: "Fold this list", html: BD_ICONS.collapse, onclick: () => { list.collapsed = true; bdChanged(); } }),
    bdEl("button", { type: "button", class: "bd-icon-btn", title: "List actions", html: BD_ICONS.dots, onclick: (e) => bdListPop(e.currentTarget, list) }));
  head.addEventListener("pointerdown", (e) => bdListDragStart(e, list));
  const box = bdEl("div", { class: "bd-cards", "data-list": list.id }, shown.map((c) => bdCardEl(c, list)));
  let foot;
  if (bdComposer && bdComposer.list === list.id) {
    const text = bdEl("textarea", { class: "bd-input bd-compose", placeholder: "Enter a title for this card...", rows: "3", "data-focus": "compose-" + list.id, maxlength: "500" });
    text.value = bdComposer.text;
    const add = () => {
      const title = text.value.replace(/\s+/g, " ").trim();
      if (!title) return text.focus();
      const card = bdNewCard(title);
      bdLog(`added "${title}" to ${list.title}`, card);
      if (bdComposer.top) list.cards.unshift(card); else list.cards.push(card);
      bdComposer.text = "";
      bdChanged();
      const cardsBox = $("bdBoard").querySelector(`.bd-cards[data-list="${list.id}"]`);
      if (cardsBox && !bdComposer.top) cardsBox.scrollTop = cardsBox.scrollHeight;
    };
    text.addEventListener("input", () => { bdComposer.text = text.value; });
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); add(); }
      if (e.key === "Escape") { e.stopPropagation(); bdComposer = null; bdDraw(); }
    });
    const form = bdEl("div", { class: "bd-composer" }, text, bdEl("div", { class: "bd-row" },
      bdEl("button", { type: "button", class: "small-button", text: "Add card", onclick: add }),
      bdEl("button", { type: "button", class: "bd-x", title: "Cancel", html: BD_ICONS.close, onclick: () => { bdComposer = null; bdDraw(); } })));
    if (bdComposer.top) box.prepend(form); else foot = form;
  }
  if (!foot) foot = bdEl("div", { class: "bd-list-foot" }, bdComposer && bdComposer.list === list.id ? null :
    bdEl("button", { type: "button", class: "bd-add-card", onclick: () => { bdComposer = { list: list.id, text: "" }; bdDraw(); } },
      bdEl("span", { html: BD_ICONS.plus }), bdEl("span", { text: "Add a card" })));
  return bdEl("div", { class: "bd-list" + (list.color ? " colored" : ""), "data-id": list.id, style: list.color ? { "--list": bdColor(list.color), "--list-ink": bdDarkText(list.color) ? "#172b4d" : "#fff" } : null },
    head, box, foot);
}

function bdBadges(card) {
  const badges = [];
  const state = bdDueState(card);
  if (card.due || card.start) {
    const text = card.start && card.due ? `${bdDateText(card.start)} - ${bdDateText(card.due)}` : card.due ? bdDateText(card.due) : "Started: " + bdDateText(card.start);
    const badge = bdEl("button", { type: "button", class: "bd-badge bd-due " + state, title: card.due ? (card.done ? "This card is complete" : "Mark complete") : "",
      html: (state === "done" ? BD_ICONS.check : BD_ICONS.clock) + `<span></span>` });
    badge.querySelector("span").textContent = text;
    if (card.due) badge.addEventListener("click", (e) => { e.stopPropagation(); if (bdDragged) return; card.done = !card.done; bdLog(card.done ? `marked the due date on "${card.title}" complete` : `marked the due date on "${card.title}" not complete`, card); bdChanged(); });
    badges.push(badge);
  }
  if (card.desc.trim()) badges.push(bdEl("span", { class: "bd-badge", title: "This card has a description", html: BD_ICONS.text }));
  if (card.comments.length) badges.push(bdEl("span", { class: "bd-badge", title: "Comments", html: BD_ICONS.comment + `<span>${card.comments.length}</span>` }));
  if (card.links.length) badges.push(bdEl("span", { class: "bd-badge", title: "Links", html: BD_ICONS.link + `<span>${card.links.length}</span>` }));
  const items = card.checklists.flatMap((c) => c.items);
  if (items.length) {
    const done = items.filter((i) => i.done).length;
    badges.push(bdEl("span", { class: "bd-badge" + (done === items.length ? " all-done" : ""), title: "Checklist items", html: BD_ICONS.check + `<span>${done}/${items.length}</span>` }));
  }
  return badges;
}

function bdCardLabels(card) {
  const labels = card.labels.map(bdLabel).filter(Boolean);
  if (!labels.length) return null;
  return bdEl("div", { class: "bd-card-labels" }, labels.map((l) =>
    bdEl("button", { type: "button", class: "bd-lbl" + (bdDarkText(l.color) ? " dark" : ""), style: { background: bdColor(l.color) }, title: l.name || "Label",
      text: bd.labelsWide ? l.name : "", onclick: (e) => { e.stopPropagation(); if (!bdDragged) { bd.labelsWide = !bd.labelsWide; bdChanged(); } } })));
}

function bdCardEl(card, list) {
  const el = bdEl("div", { class: "bd-card" + (card.cover ? " has-cover" : ""), "data-id": card.id, tabindex: "0",
    onclick: () => { if (!bdDragged) bdCardOpen(card.id); }, onkeydown: (e) => { if (e.key === "Enter") bdCardOpen(card.id); } },
  card.cover ? bdEl("div", { class: "bd-cover", style: { background: bdColor(card.cover) } }) : null,
  bdEl("div", { class: "bd-card-body" },
    bdCardLabels(card),
    bdEl("div", { class: "bd-card-title", text: card.title }),
    (() => { const b = bdBadges(card); return b.length ? bdEl("div", { class: "bd-badges" }, b) : null; })()),
  bdEl("button", { type: "button", class: "bd-card-edit", title: "Quick edit", html: BD_ICONS.pencil, onclick: (e) => { e.stopPropagation(); bdQuickEdit(el, card, list); } }));
  el.addEventListener("pointerdown", (e) => bdCardDragStart(e, card, el));
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); bdQuickEdit(el, card, list); });
  return el;
}

// ---------------------------------------------------------------- dragging cards and lists

function bdAutoScroll(drag, x, y) {
  const canvas = $("bdBoard").querySelector(".bd-canvas");
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  drag.vx = x < r.left + 70 ? -14 : x > r.right - 70 ? 14 : 0;
  drag.vy = 0;
  const box = drag.cardsBox;
  if (box) {
    const b = box.getBoundingClientRect();
    drag.vy = y < b.top + 40 && y > b.top - 30 ? -10 : y > b.bottom - 40 && y < b.bottom + 30 ? 10 : 0;
  }
  if ((drag.vx || drag.vy) && !drag.raf) {
    const step = () => {
      if (!drag.on || (!drag.vx && !drag.vy)) { drag.raf = 0; return; }
      canvas.scrollLeft += drag.vx;
      if (drag.cardsBox) drag.cardsBox.scrollTop += drag.vy;
      drag.place(drag.x, drag.y, drag);
      drag.raf = requestAnimationFrame(step);
    };
    drag.raf = requestAnimationFrame(step);
  }
}

function bdDragBase(e, el, onStart, place, onDrop) {
  if (e.button !== 0 || e.target.closest("input, textarea, .bd-card-edit, .bd-icon-btn")) return;
  const drag = { on: false, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, place };
  const move = (ev) => {
    drag.x = ev.clientX; drag.y = ev.clientY;
    if (!drag.on) {
      if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 5) return;
      drag.on = true;
      const r = el.getBoundingClientRect();
      drag.dx = drag.sx - r.left; drag.dy = drag.sy - r.top;
      drag.ghost = el.cloneNode(true);
      drag.ghost.classList.add("bd-ghost");
      Object.assign(drag.ghost.style, { width: r.width + "px", height: r.height + "px" });
      document.body.append(drag.ghost);
      onStart(drag, r);
      document.body.classList.add("bd-dragging");
    }
    drag.ghost.style.transform = `translate(${ev.clientX - drag.dx}px, ${ev.clientY - drag.dy}px) rotate(3.5deg)`;
    place(ev.clientX, ev.clientY, drag);
    bdAutoScroll(drag, ev.clientX, ev.clientY);
  };
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    if (!drag.on) return;
    drag.on = false;
    drag.ghost.remove();
    document.body.classList.remove("bd-dragging");
    bdDragged = true;
    setTimeout(() => { bdDragged = false; }, 0);
    onDrop(drag);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

function bdCardDragStart(e, card, el) {
  bdDragBase(e, el, (drag, r) => {
    drag.ph = bdEl("div", { class: "bd-card-ph", style: { height: r.height + "px" } });
    el.replaceWith(drag.ph);
    drag.cardsBox = drag.ph.parentElement;
  }, (x, y, drag) => {
    const under = document.elementFromPoint(x, y);
    const listEl = under && under.closest(".bd-list:not(.collapsed)");
    const box = listEl && listEl.querySelector(".bd-cards");
    if (!box) return;
    drag.cardsBox = box;
    const others = [...box.querySelectorAll(".bd-card")];
    const before = others.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (before) { if (before.previousElementSibling !== drag.ph) box.insertBefore(drag.ph, before); }
    else if (box.lastElementChild !== drag.ph) box.append(drag.ph);
  }, (drag) => {
    const box = drag.ph.parentElement;
    const from = bdFind(card.id);
    const to = box && bdList(box.dataset.list);
    if (!from || !to) return bdDraw();
    const next = drag.ph.nextElementSibling && drag.ph.nextElementSibling.closest(".bd-card");
    from.list.cards.splice(from.index, 1);
    const at = next ? to.cards.findIndex((c) => c.id === next.dataset.id) : -1;
    to.cards.splice(at < 0 ? to.cards.length : at, 0, card);
    if (from.list !== to) bdLog(`moved "${card.title}" from ${from.list.title} to ${to.title}`, card);
    bdChanged();
  });
}

function bdListDragStart(e, list) {
  const el = e.currentTarget.closest(".bd-list");
  bdDragBase(e, el, (drag, r) => {
    drag.ph = bdEl("div", { class: "bd-list-ph", style: { height: r.height + "px" } });
    el.replaceWith(drag.ph);
  }, (x, y, drag) => {
    const canvas = drag.ph.parentElement;
    const others = [...canvas.querySelectorAll(":scope > .bd-list")];
    const before = others.find((l) => { const r = l.getBoundingClientRect(); return x < r.left + r.width / 2; });
    if (before) { if (before.previousElementSibling !== drag.ph) canvas.insertBefore(drag.ph, before); }
    else { const add = canvas.querySelector(".bd-add-list"); if (drag.ph.nextElementSibling !== add) canvas.insertBefore(drag.ph, add); }
  }, (drag) => {
    const next = drag.ph.nextElementSibling;
    bd.lists.splice(bd.lists.indexOf(list), 1);
    const at = next && next.classList.contains("bd-list") ? bd.lists.findIndex((l) => l.id === next.dataset.id) : -1;
    bd.lists.splice(at < 0 ? bd.lists.length : at, 0, list);
    bdChanged();
  });
}

// ---------------------------------------------------------------- small pop-up windows

let bdPopStack = [];   // [{title, build}] so "back" can go to the one before

function bdPop(anchor, title, build, keep) {
  const pop = $("bdPop");
  if (!keep) bdPopStack = [];
  bdPopStack.push({ title, build });
  pop._anchor = anchor || pop._anchor;
  const back = bdPopStack.length > 1 ? bdEl("button", { type: "button", class: "bd-x", title: "Back", html: BD_ICONS.back, onclick: () => { bdPopStack.pop(); const last = bdPopStack.pop(); bdPop(null, last.title, last.build, true); } }) : bdEl("span", { class: "bd-x-space" });
  const body = bdSafe(bdEl("div", { class: "bd-pop-body" }));
  pop.replaceChildren(bdEl("div", { class: "bd-pop-head" }, back, bdEl("h4", { text: title }), bdEl("button", { type: "button", class: "bd-x", title: "Close", html: BD_ICONS.close, onclick: bdPopClose })), body);
  build(body);
  pop.hidden = false;
  bdPopPlace();
}
function bdPopPlace() {
  const pop = $("bdPop");
  if (pop.hidden || !pop._anchor) return;
  const r = pop._anchor.isConnected ? pop._anchor.getBoundingClientRect() : pop._rect || { left: innerWidth / 2 - 150, bottom: 120, top: 120 };
  pop._rect = { left: r.left, bottom: r.bottom, top: r.top };
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, Math.min(r.top - h - 6, innerHeight - h - 8));
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}
function bdPopClose() {
  const pop = $("bdPop");
  if (pop.hidden) return;
  pop.hidden = true;
  pop.replaceChildren();
  bdPopStack = [];
}
const bdPopAgain = () => { const last = bdPopStack.pop(); if (last) bdPop(null, last.title, last.build, true); };
document.addEventListener("pointerdown", (e) => {
  const pop = $("bdPop");
  if (!pop.hidden && !pop.contains(e.target) && !(pop._anchor && pop._anchor.contains && pop._anchor.contains(e.target))) bdPopClose();
}, true);
addEventListener("resize", bdPopPlace);

const bdMenuItem = (icon, text, onclick, cls = "") => bdEl("button", { type: "button", class: "bd-menu-item " + cls, onclick }, bdEl("span", { html: BD_ICONS[icon] || "" }), bdEl("span", { text }));

// Pick a board, a list on it and a place in that list (for moving and copying). done(board, list, index).
function bdWhereFields(box, startList, startIndex, done, opts = {}) {
  const boardPick = bdEl("select", { class: "bd-input" }, bdBoards.map((b) => bdEl("option", { value: b.id, text: b.title + (b.id === bd.id ? " (this board)" : ""), selected: b.id === bd.id })));
  if (!bdBoards.some((b) => b.id === bd.id)) boardPick.prepend(bdEl("option", { value: bd.id, text: bd.title + " (this board)", selected: true }));
  const listPick = bdEl("select", { class: "bd-input" });
  const posPick = bdEl("select", { class: "bd-input" });
  let target = bd;
  const fillPos = () => {
    const list = target.lists.find((l) => l.id === listPick.value);
    posPick.replaceChildren();
    if (opts.listsOnly) {
      const open = target.lists.filter((l) => !l.archived);
      for (let i = 0; i <= open.length; i++) posPick.append(bdEl("option", { value: i, text: String(i + 1) }));
      posPick.value = target === bd && startIndex >= 0 ? startIndex : open.length;
      return;
    }
    if (!list) return;
    const n = list.cards.filter((c) => !c.archived).length + (list.id === startList && target === bd ? 0 : 1);
    for (let i = 0; i < Math.max(1, n); i++) posPick.append(bdEl("option", { value: i, text: String(i + 1) }));
    posPick.value = list.id === startList && target === bd ? startIndex : n - 1;
  };
  const fillLists = () => {
    listPick.replaceChildren(...target.lists.filter((l) => !l.archived).map((l) => bdEl("option", { value: l.id, text: l.title, selected: l.id === startList })));
    fillPos();
  };
  boardPick.addEventListener("change", async () => {
    if (boardPick.value === bd.id) target = bd;
    else {
      const res = await api("/api/boards-get", { id: boardPick.value }).catch(() => ({ ok: false }));
      if (!res.ok) return bdToast(res.error || "Couldn't open that board.");
      target = res.board;
    }
    fillLists();
  });
  listPick.addEventListener("change", fillPos);
  fillLists();
  box.append(bdEl("label", { class: "bd-label-text", text: "Board" }), boardPick);
  if (!opts.listsOnly) box.append(bdEl("div", { class: "bd-two" },
    bdEl("div", {}, bdEl("label", { class: "bd-label-text", text: "List" }), listPick),
    bdEl("div", { class: "bd-small-col" }, bdEl("label", { class: "bd-label-text", text: "Position" }), posPick)));
  else box.append(bdEl("label", { class: "bd-label-text", text: "Position" }), posPick);
  return () => done(target, target.lists.find((l) => l.id === listPick.value), +posPick.value);
}

// Put a card at the n-th open spot of a list.
function bdInsertAt(list, card, n) {
  const open = list.cards.filter((c) => !c.archived);
  const before = open[n];
  const at = before ? list.cards.indexOf(before) : list.cards.length;
  list.cards.splice(at, 0, card);
}

async function bdSaveOther(board) {
  const res = await api("/api/boards-save", { id: board.id, board }).catch(() => ({ ok: false }));
  if (!res.ok) bdToast(res.error || "Couldn't save the other board.");
  return res.ok;
}

async function bdEnsureBoards() {
  if (!bdBoards.length || !bdBoards.some((b) => b.id === bd.id)) {
    const res = await api("/api/boards-list", {}).catch(() => ({ ok: false }));
    if (res.ok) bdBoards = res.boards;
  }
}

async function bdMovePop(anchor, card, keep) {
  await bdEnsureBoards();
  bdPop(anchor, "Move card", (box) => {
    const where = bdFind(card.id);
    const go = bdWhereFields(box, where.list.id, where.list.cards.filter((c) => !c.archived).indexOf(card), async (board, list, n) => {
      if (!list) return;
      const from = bdFind(card.id);
      if (board === bd) {
        from.list.cards.splice(from.index, 1);
        bdInsertAt(list, card, n);
        if (from.list !== list) bdLog(`moved "${card.title}" from ${from.list.title} to ${list.title}`, card);
      } else {
        bdLog(`moved "${card.title}" to the board ${board.title}`, card);
        bdInsertAt(list, card, n);
        if (!(await bdSaveOther(board))) return;
        from.list.cards.splice(from.index, 1);
        bdCardClose();
      }
      bdPopClose();
      bdChanged();
    });
    box.append(bdEl("button", { type: "button", class: "small-button bd-wide", text: "Move", onclick: go }));
  }, keep);
}

async function bdCopyPop(anchor, card) {
  await bdEnsureBoards();
  bdPop(anchor, "Copy card", (box) => {
    const where = bdFind(card.id);
    const title = bdEl("textarea", { class: "bd-input", rows: "2", maxlength: "500" });
    title.value = card.title;
    const keeps = [["checklists", "Checklists"], ["labels", "Labels"], ["links", "Links"], ["comments", "Comments"]].filter(([k]) => card[k].length);
    const boxes = keeps.map(([k, text]) => bdEl("label", { class: "bd-check" }, bdEl("input", { type: "checkbox", checked: true, "data-k": k }), bdEl("span", { text: `${text} (${card[k].length})` })));
    box.append(bdEl("label", { class: "bd-label-text", text: "Title" }), title);
    if (boxes.length) box.append(bdEl("label", { class: "bd-label-text", text: "Keep..." }), ...boxes);
    box.append(bdEl("label", { class: "bd-label-text bd-gap", text: "Copy to..." }));
    const go = bdWhereFields(box, where.list.id, where.list.cards.filter((c) => !c.archived).indexOf(card) + 1, async (board, list, n) => {
      if (!list) return;
      const copy = JSON.parse(JSON.stringify(card));
      Object.assign(copy, { id: bdNewId(), title: title.value.replace(/\s+/g, " ").trim() || card.title, created: Date.now(), log: [], archived: false });
      for (const b of boxes) { const input = b.querySelector("input"); if (!input.checked) copy[input.dataset.k] = []; }
      for (const cl of copy.checklists) { cl.id = bdNewId(); for (const i of cl.items) i.id = bdNewId(); }
      if (board !== bd) copy.labels = [];
      bdInsertAt(list, copy, n);
      bdLog(`copied "${card.title}" to ${list.title}`, copy);
      if (board !== bd && !(await bdSaveOther(board))) return;
      bdPopClose();
      bdChanged();
    });
    box.append(bdEl("button", { type: "button", class: "small-button bd-wide", text: "Create card", onclick: go }));
  });
}

function bdArchiveCard(card) {
  card.archived = true;
  bdLog(`archived "${card.title}"`, card);
  bdChanged();
}

// ---------------------------------------------------------------- quick edit (the pencil on a card)

function bdQuickEdit(el, card, list) {
  bdPopClose();
  const r = el.getBoundingClientRect();
  const layer = bdEl("div", { class: "bd-quick" });
  const text = bdEl("textarea", { class: "bd-quick-text", maxlength: "500" });
  text.value = card.title;
  const close = (save) => {
    if (save) {
      const v = text.value.replace(/\s+/g, " ").trim();
      if (v && v !== card.title) { bdLog(`renamed "${card.title}" to "${v}"`, card); card.title = v; }
    }
    layer.remove();
    document.removeEventListener("keydown", key, true);
    bdChanged();
  };
  const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(false); } };
  document.addEventListener("keydown", key, true);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); close(true); } });
  const side = bdEl("div", { class: "bd-quick-side" },
    bdMenuItem("card", "Open card", () => { close(true); bdCardOpen(card.id); }),
    bdMenuItem("tag", "Edit labels", (e) => bdLabelsPop(e.currentTarget, card)),
    bdMenuItem("clock", "Edit dates", (e) => bdDatesPop(e.currentTarget, card)),
    bdMenuItem("cover", "Change cover", (e) => bdCoverPop(e.currentTarget, card)),
    bdMenuItem("move", "Move", (e) => bdMovePop(e.currentTarget, card)),
    bdMenuItem("copy", "Copy", (e) => bdCopyPop(e.currentTarget, card)),
    bdMenuItem("archive", "Archive", () => { layer.remove(); document.removeEventListener("keydown", key, true); bdArchiveCard(card); }));
  const holder = bdEl("div", { class: "bd-quick-card", style: { left: r.left + "px", top: r.top + "px", width: r.width + "px" } },
    bdEl("div", { class: "bd-quick-edit" }, card.cover ? bdEl("div", { class: "bd-cover", style: { background: bdColor(card.cover) } }) : null, text),
    bdEl("button", { type: "button", class: "small-button", text: "Save", onclick: () => close(true) }));
  layer.append(holder, side);
  layer.addEventListener("pointerdown", (e) => { if (e.target === layer) close(true); });
  document.body.append(layer);
  const sr = side.getBoundingClientRect();
  const left = r.right + 8 + sr.width > innerWidth ? r.left - sr.width - 8 : r.right + 8;
  Object.assign(side.style, { left: left + "px", top: Math.min(r.top, innerHeight - sr.height - 10) + "px" });
  text.style.height = Math.max(r.height + 30, 90) + "px";
  text.focus();
  text.select();
  void list;
}

// ---------------------------------------------------------------- list actions

function bdListPop(anchor, list) {
  const menu = (box) => box.append(
    bdMenuItem("plus", "Add card", () => { bdPopClose(); bdComposer = { list: list.id, text: "", top: true }; bdDraw(); }),
    bdMenuItem("copy", "Copy list", () => bdPop(null, "Copy list", (b) => {
      const name = bdEl("textarea", { class: "bd-input", rows: "2", maxlength: "120" });
      name.value = list.title;
      b.append(bdEl("label", { class: "bd-label-text", text: "Name" }), name, bdEl("button", { type: "button", class: "small-button bd-wide", text: "Create list", onclick: () => {
        const copy = JSON.parse(JSON.stringify(list));
        Object.assign(copy, { id: bdNewId(), title: name.value.replace(/\s+/g, " ").trim() || list.title });
        for (const c of copy.cards) { c.id = bdNewId(); c.log = []; for (const cl of c.checklists) { cl.id = bdNewId(); for (const i of cl.items) i.id = bdNewId(); } }
        bd.lists.splice(bd.lists.indexOf(list) + 1, 0, copy);
        bdLog(`copied list "${list.title}"`);
        bdPopClose();
        bdChanged();
      } }));
      setTimeout(() => name.select(), 20);
    }, true)),
    bdMenuItem("move", "Move list", async () => {
      await bdEnsureBoards();
      bdPop(null, "Move list", (b) => {
        const go = bdWhereFields(b, "", bdOpenLists().indexOf(list), async (board, _l, n) => {
          const open = board.lists.filter((l) => !l.archived && l !== list);
          const before = open[n];
          if (board === bd) {
            bd.lists.splice(bd.lists.indexOf(list), 1);
            bd.lists.splice(before ? bd.lists.indexOf(before) : bd.lists.length, 0, list);
          } else {
            const at = before ? board.lists.indexOf(before) : board.lists.length;
            board.lists.splice(at, 0, list);
            for (const c of list.cards) c.labels = [];
            if (!(await bdSaveOther(board))) return;
            bd.lists.splice(bd.lists.indexOf(list), 1);
            bdLog(`moved list "${list.title}" to the board ${board.title}`);
          }
          bdPopClose();
          bdChanged();
        }, { listsOnly: true });
        b.append(bdEl("button", { type: "button", class: "small-button bd-wide", text: "Move", onclick: go }));
      }, true);
    }),
    bdMenuItem("move", "Move all cards in this list", () => bdPop(null, "Move all cards", (b) => {
      for (const other of bdOpenLists()) b.append(bdMenuItem("", other.title + (other === list ? " (this list)" : ""), () => {
        if (other === list) return;
        const moving = list.cards.filter((c) => !c.archived);
        list.cards = list.cards.filter((c) => c.archived);
        other.cards.push(...moving);
        bdLog(`moved ${moving.length} cards from ${list.title} to ${other.title}`);
        bdPopClose();
        bdChanged();
      }, other === list ? "off" : ""));
    }, true)),
    bdMenuItem("filter", "Sort by...", () => bdPop(null, "Sort list", (b) => {
      const sort = (fn, what) => () => {
        const archived = list.cards.filter((c) => c.archived);
        list.cards = list.cards.filter((c) => !c.archived).sort(fn).concat(archived);
        bdLog(`sorted ${list.title} by ${what}`);
        bdPopClose();
        bdChanged();
      };
      const due = (c) => c.due ? bdDate(c.due).getTime() : Infinity;
      b.append(bdMenuItem("", "Date created (newest first)", sort((a, c) => c.created - a.created, "newest first")),
        bdMenuItem("", "Date created (oldest first)", sort((a, c) => a.created - c.created, "oldest first")),
        bdMenuItem("", "Card name (A to Z)", sort((a, c) => a.title.localeCompare(c.title), "name")),
        bdMenuItem("", "Due date", sort((a, c) => due(a) - due(c), "due date")));
    }, true)),
    bdEl("div", { class: "bd-pop-sep" }),
    bdEl("label", { class: "bd-label-text", text: "List color" }),
    bdEl("div", { class: "bd-swatches small" }, Object.keys(BD_HUES).map((hue) => hue + "1").map((key) =>
      bdEl("button", { type: "button", class: "bd-swatch" + (list.color === key ? " on" : ""), style: { background: bdColor(key) }, title: key.slice(0, -1),
        onclick: () => { list.color = list.color === key ? "" : key; bdChanged(); bdPopAgain(); } }))),
    list.color ? bdEl("button", { type: "button", class: "bd-plain-btn", text: "Remove color", onclick: () => { list.color = ""; bdChanged(); bdPopAgain(); } }) : null,
    bdEl("div", { class: "bd-pop-sep" }),
    bdMenuItem("collapse", "Fold list", () => { list.collapsed = true; bdPopClose(); bdChanged(); }),
    bdMenuItem("archive", "Archive this list", () => { list.archived = true; bdLog(`archived list "${list.title}"`); bdPopClose(); bdChanged(); }),
    bdMenuItem("archive", "Archive all cards in this list", () => bdPop(null, "Archive all cards?", (b) => {
      b.append(bdEl("p", { class: "bd-pop-note", text: "This takes every card in this list off the board. You can find them in Menu > Archived items and put them back." }),
        bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Archive all", onclick: () => {
          const n = list.cards.filter((c) => !c.archived).length;
          for (const c of list.cards) c.archived = true;
          bdLog(`archived all ${n} cards in ${list.title}`);
          bdPopClose();
          bdChanged();
        } }));
    }, true)));
  bdPop(anchor, "List actions", menu);
}

// ---------------------------------------------------------------- the filter

function bdFilterPop(anchor) {
  bdPop(anchor, "Filter", (box) => {
    const text = bdEl("input", { class: "bd-input", placeholder: "Enter a word...", value: bdFilter.text, spellcheck: "false" });
    text.addEventListener("input", () => { bdFilter.text = text.value; bdDraw(); });
    const check = (set, key, label) => {
      const input = bdEl("input", { type: "checkbox", checked: set.has(key) });
      input.addEventListener("change", () => { input.checked ? set.add(key) : set.delete(key); bdDraw(); });
      return bdEl("label", { class: "bd-check" }, input, label);
    };
    box.append(bdEl("label", { class: "bd-label-text", text: "Keyword" }), text,
      bdEl("p", { class: "bd-pop-note", text: "Search cards by title, description or label." }),
      bdEl("label", { class: "bd-label-text", text: "Due date" }),
      check(bdFilter.due, "none", bdEl("span", { text: "No dates" })),
      check(bdFilter.due, "overdue", bdEl("span", { class: "bd-filter-due overdue", html: BD_ICONS.clock + "<span>Overdue</span>" })),
      check(bdFilter.due, "soon", bdEl("span", { class: "bd-filter-due soon", html: BD_ICONS.clock + "<span>Due in the next day</span>" })),
      check(bdFilter.due, "done", bdEl("span", { text: "Marked as complete" })),
      check(bdFilter.due, "notdone", bdEl("span", { text: "Not marked as complete" })),
      bdEl("label", { class: "bd-label-text", text: "Labels" }),
      check(bdFilter.labels, "none", bdEl("span", { class: "bd-filter-nolabel", html: BD_ICONS.tag + "<span>No labels</span>" })),
      ...bd.labels.map((l) => check(bdFilter.labels, l.id, bdEl("span", { class: "bd-lbl-wide" + (bdDarkText(l.color) ? " dark" : ""), style: { background: bdColor(l.color) }, text: l.name }))));
    setTimeout(() => text.focus(), 30);
  });
}

// ---------------------------------------------------------------- labels

function bdLabelsPop(anchor, card, keep) {
  bdPop(anchor, "Labels", (box) => {
    const search = bdEl("input", { class: "bd-input", placeholder: "Search labels...", spellcheck: "false" });
    const rows = bdEl("div", { class: "bd-label-rows" });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      rows.replaceChildren(...bd.labels.filter((l) => !q || l.name.toLowerCase().includes(q) || l.color.includes(q)).map((l) => {
        const on = card && card.labels.includes(l.id);
        const row = bdEl("div", { class: "bd-label-row" },
          card ? bdEl("input", { type: "checkbox", checked: on, onchange: () => {
            card.labels = on ? card.labels.filter((id) => id !== l.id) : [...card.labels, l.id];
            bdChanged(); draw();
          } }) : null,
          bdEl("button", { type: "button", class: "bd-lbl-wide" + (bdDarkText(l.color) ? " dark" : ""), style: { background: bdColor(l.color) }, text: l.name,
            onclick: () => { if (card) { card.labels = on ? card.labels.filter((id) => id !== l.id) : [...card.labels, l.id]; bdChanged(); draw(); } else bdLabelEdit(l, card); } }),
          bdEl("button", { type: "button", class: "bd-icon-btn", title: "Change label", html: BD_ICONS.pencil, onclick: () => bdLabelEdit(l, card) }));
        return row;
      }));
    };
    search.addEventListener("input", draw);
    draw();
    box.append(search, bdEl("label", { class: "bd-label-text", text: "Labels" }), rows,
      bdEl("button", { type: "button", class: "bd-plain-btn bd-wide", text: "Create a new label", onclick: () => bdLabelEdit(null, card) }),
      bdEl("div", { class: "bd-pop-sep" }),
      bdEl("button", { type: "button", class: "bd-plain-btn bd-wide", text: bd.labelsWide ? "Hide label names on cards" : "Show label names on cards", onclick: () => { bd.labelsWide = !bd.labelsWide; bdChanged(); bdPopAgain(); } }));
  }, keep);
}

function bdLabelEdit(label, card) {
  const editing = { name: label ? label.name : "", color: label ? label.color : "green1" };
  bdPop(null, label ? "Edit label" : "Create label", (box) => {
    const preview = bdEl("div", { class: "bd-label-preview" });
    const paint = () => {
      preview.replaceChildren(bdEl("span", { class: "bd-lbl-wide" + (bdDarkText(editing.color) ? " dark" : ""), style: { background: bdColor(editing.color) }, text: editing.name }));
      box.querySelectorAll(".bd-swatch").forEach((s) => s.classList.toggle("on", s.dataset.key === editing.color));
    };
    const name = bdEl("input", { class: "bd-input", value: editing.name, maxlength: "60", spellcheck: "false" });
    name.addEventListener("input", () => { editing.name = name.value; paint(); });
    const grid = bdEl("div", { class: "bd-color-grid" }, [0, 1, 2].flatMap((shade) => Object.keys(BD_HUES).map((hue) => {
      const key = hue + shade;
      return bdEl("button", { type: "button", class: "bd-swatch", "data-key": key, title: hue, style: { background: bdColor(key) }, onclick: () => { editing.color = key; paint(); } });
    })));
    const save = () => {
      if (label) Object.assign(label, { name: editing.name.trim(), color: editing.color });
      else {
        const made = { id: bdNewId(), name: editing.name.trim(), color: editing.color };
        bd.labels.push(made);
        if (card) card.labels.push(made.id);
      }
      bdChanged();
      bdPopStack.pop();
      bdPopAgain();
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    box.append(preview, bdEl("label", { class: "bd-label-text", text: "Title" }), name, bdEl("label", { class: "bd-label-text", text: "Select a color" }), grid,
      bdEl("div", { class: "bd-row bd-spread" },
        bdEl("button", { type: "button", class: "small-button", text: label ? "Save" : "Create", onclick: save }),
        label ? bdEl("button", { type: "button", class: "small-button bd-danger", text: "Delete", onclick: () => {
          bd.labels = bd.labels.filter((l) => l !== label);
          for (const l of bd.lists) for (const c of l.cards) c.labels = c.labels.filter((id) => id !== label.id);
          bdFilter.labels.delete(label.id);
          bdChanged();
          bdPopStack.pop();
          bdPopAgain();
        } }) : null));
    paint();
    setTimeout(() => name.focus(), 30);
  }, true);
}

// ---------------------------------------------------------------- dates, cover, checklist, link

function bdDatesPop(anchor, card) {
  bdPop(anchor, "Dates", (box) => {
    const split = (v) => v ? [v.slice(0, 10), v.length > 10 ? v.slice(11, 16) : ""] : ["", ""];
    const [sd] = split(card.start);
    const [dd, dt] = split(card.due);
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startOn = bdEl("input", { type: "checkbox", checked: !!card.start });
    const startDate = bdEl("input", { type: "date", class: "bd-input", value: sd || iso(today), disabled: !card.start });
    const dueOn = bdEl("input", { type: "checkbox", checked: !!card.due || !card.start });
    const tomorrow = new Date(Date.now() + 86400000);
    const dueDate = bdEl("input", { type: "date", class: "bd-input", value: dd || iso(tomorrow), disabled: !dueOn.checked });
    const dueTime = bdEl("input", { type: "time", class: "bd-input", value: card.due ? dt : "12:00", disabled: !dueOn.checked });
    startOn.addEventListener("change", () => { startDate.disabled = !startOn.checked; });
    dueOn.addEventListener("change", () => { dueDate.disabled = dueTime.disabled = !dueOn.checked; });
    box.append(
      bdEl("label", { class: "bd-label-text", text: "Start date" }),
      bdEl("div", { class: "bd-date-row" }, startOn, startDate),
      bdEl("label", { class: "bd-label-text", text: "Due date" }),
      bdEl("div", { class: "bd-date-row" }, dueOn, dueDate, dueTime),
      bdEl("button", { type: "button", class: "small-button bd-wide", text: "Save", onclick: () => {
        const start = startOn.checked && startDate.value ? startDate.value : "";
        const due = dueOn.checked && dueDate.value ? dueDate.value + (dueTime.value ? "T" + dueTime.value : "") : "";
        if (due !== card.due) { bdLog(due ? `set "${card.title}" to be due ${bdDateText(due, true)}` : `took the due date off "${card.title}"`, card); card.done = false; }
        card.start = start;
        card.due = due;
        bdPopClose();
        bdChanged();
      } }),
      bdEl("button", { type: "button", class: "bd-plain-btn bd-wide", text: "Remove", onclick: () => {
        if (card.due) bdLog(`took the due date off "${card.title}"`, card);
        card.start = card.due = ""; card.done = false;
        bdPopClose();
        bdChanged();
      } }));
  });
}

function bdCoverPop(anchor, card) {
  bdPop(anchor, "Cover", (box) => {
    box.append(bdEl("label", { class: "bd-label-text", text: "Colors" }),
      bdEl("div", { class: "bd-color-grid cover" }, Object.keys(BD_HUES).map((hue) => hue + "1").map((key) =>
        bdEl("button", { type: "button", class: "bd-swatch" + (card.cover === key ? " on" : ""), style: { background: bdColor(key) }, title: key.slice(0, -1),
          onclick: () => { card.cover = key; bdChanged(); bdPopAgain(); } }))),
      card.cover ? bdEl("button", { type: "button", class: "bd-plain-btn bd-wide", text: "Remove cover", onclick: () => { card.cover = ""; bdChanged(); bdPopAgain(); } }) : null);
  });
}

function bdChecklistPop(anchor, card) {
  bdPop(anchor, "Add checklist", (box) => {
    const title = bdEl("input", { class: "bd-input", value: "Checklist", maxlength: "120", spellcheck: "false" });
    const add = () => {
      const cl = { id: bdNewId(), title: title.value.trim() || "Checklist", items: [], hideDone: false };
      card.checklists.push(cl);
      bdLog(`added a checklist to "${card.title}"`, card);
      bdPopClose();
      bdItemAdding = cl.id;
      bdChanged();
    };
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    box.append(bdEl("label", { class: "bd-label-text", text: "Title" }), title, bdEl("button", { type: "button", class: "small-button bd-wide", text: "Add", onclick: add }));
    setTimeout(() => title.select(), 30);
  });
}

function bdLinkPop(anchor, card) {
  bdPop(anchor, "Attach a link", (box) => {
    const url = bdEl("input", { class: "bd-input", placeholder: "Paste any link here...", spellcheck: "false" });
    const name = bdEl("input", { class: "bd-input", placeholder: "Text to show (you can leave this empty)", maxlength: "120", spellcheck: "false" });
    const add = () => {
      let u = url.value.trim();
      if (!u) return url.focus();
      if (!/^(https?:|mailto:)/i.test(u)) u = "https://" + u;
      card.links.push({ id: bdNewId(), url: u, name: name.value.trim(), at: Date.now() });
      bdLog(`attached a link to "${card.title}"`, card);
      bdPopClose();
      bdChanged();
    };
    for (const i of [url, name]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    box.append(bdEl("label", { class: "bd-label-text", text: "Link" }), url, bdEl("label", { class: "bd-label-text", text: "Display text" }), name,
      bdEl("button", { type: "button", class: "small-button bd-wide", text: "Attach", onclick: add }));
    setTimeout(() => url.focus(), 30);
  });
}

const bdOpenLink = (url) => api("/api/docs-open-link", { url }).catch(() => {});

// ---------------------------------------------------------------- the open card

let bdDescEditing = false;
let bdDescDraft = "";
let bdItemAdding = "";      // the checklist that has its "add an item" box open
let bdCommentDraft = "";
let bdCommentEditing = "";

function bdCardOpen(id) {
  bdPopClose();
  bdCardId = id;
  bdDescEditing = false; bdItemAdding = ""; bdCommentDraft = ""; bdCommentEditing = "";
  $("bdCardModal").hidden = false;
  bdDrawCard();
  $("bdCardDialog").scrollTop = 0;
}

function bdCardClose() {
  if (!bdCardId) return;
  bdCardId = "";
  $("bdCardModal").hidden = true;
  $("bdCardDialog").replaceChildren();
}

function bdSection(icon, title, extra, ...body) {
  return bdEl("section", { class: "bd-cd-section" },
    bdEl("div", { class: "bd-cd-head" }, bdEl("span", { class: "bd-cd-icon", html: BD_ICONS[icon] }), bdEl("h3", { text: title }), bdEl("span", { class: "bd-spacer" }), extra), ...body);
}

function bdAutoGrow(t) {
  const grow = () => { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };
  t.addEventListener("input", grow);
  setTimeout(grow, 0);
  return t;
}

function bdDrawCard() {
  const found = bdCardId && bd && bdFind(bdCardId);
  if (!found) return bdCardClose();
  const { card, list } = found;
  const dialog = $("bdCardDialog");
  const scroll = dialog.scrollTop;
  const focused = document.activeElement && dialog.contains(document.activeElement) ? document.activeElement.dataset.focus : "";

  // the top: cover, title, which list
  const cover = card.cover ? bdEl("div", { class: "bd-cd-cover", style: { background: bdColor(card.cover) } },
    bdEl("button", { type: "button", class: "bd-plain-btn bd-on-cover", html: BD_ICONS.cover + "<span>Cover</span>", onclick: (e) => bdCoverPop(e.currentTarget, card) })) : null;
  const title = bdAutoGrow(bdEl("textarea", { class: "bd-cd-title", rows: "1", maxlength: "500", spellcheck: "false", "data-focus": "title" }));
  title.value = card.title;
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  title.addEventListener("blur", () => {
    const v = title.value.replace(/\s+/g, " ").trim();
    if (v && v !== card.title) { bdLog(`renamed "${card.title}" to "${v}"`, card); card.title = v; bdChanged(); } else title.value = card.title;
  });
  const inList = bdEl("p", { class: "bd-cd-where" }, "in list ", bdEl("button", { type: "button", class: "bd-link", text: list.title, onclick: (e) => bdMovePop(e.currentTarget, card) }));
  const archivedNote = card.archived ? bdEl("div", { class: "bd-cd-archived", html: BD_ICONS.archive + "<span>This card is archived.</span>" }) : null;

  // labels and dates
  const meta = bdEl("div", { class: "bd-cd-meta" });
  const labels = card.labels.map(bdLabel).filter(Boolean);
  if (labels.length) meta.append(bdEl("div", { class: "bd-cd-meta-box" }, bdEl("h4", { text: "Labels" }), bdEl("div", { class: "bd-cd-labels" },
    labels.map((l) => bdEl("button", { type: "button", class: "bd-lbl-wide" + (bdDarkText(l.color) ? " dark" : ""), style: { background: bdColor(l.color) }, text: l.name, onclick: (e) => bdLabelsPop(e.currentTarget, card) })),
    bdEl("button", { type: "button", class: "bd-square", title: "Add a label", html: BD_ICONS.plus, onclick: (e) => bdLabelsPop(e.currentTarget, card) }))));
  if (card.due || card.start) {
    const state = bdDueState(card);
    const text = card.start && card.due ? `${bdDateText(card.start)} - ${bdDateText(card.due, true)}` : card.due ? bdDateText(card.due, true) : bdDateText(card.start);
    const done = bdEl("input", { type: "checkbox", checked: card.done, title: "Mark complete", onchange: () => { card.done = !card.done; bdLog(card.done ? `marked the due date on "${card.title}" complete` : `marked the due date on "${card.title}" not complete`, card); bdChanged(); } });
    meta.append(bdEl("div", { class: "bd-cd-meta-box" }, bdEl("h4", { text: card.due ? (card.start ? "Dates" : "Due date") : "Start date" }), bdEl("div", { class: "bd-row" },
      card.due ? done : null,
      bdEl("button", { type: "button", class: "bd-date-btn", onclick: (e) => bdDatesPop(e.currentTarget, card) }, bdEl("span", { text }),
        state ? bdEl("span", { class: "bd-state " + state, text: { done: "Complete", overdue: "Overdue", soon: "Due soon" }[state] }) : null))));
  }

  // description
  let desc;
  if (bdDescEditing) {
    const t = bdAutoGrow(bdEl("textarea", { class: "bd-input bd-desc-edit", placeholder: "Add a more detailed description...", "data-focus": "desc", maxlength: "20000" }));
    t.value = bdDescDraft;
    t.addEventListener("input", () => { bdDescDraft = t.value; });
    const save = () => { if (bdDescDraft !== card.desc) bdLog(`changed the description of "${card.title}"`, card); card.desc = bdDescDraft.trim(); bdDescEditing = false; bdChanged(); };
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) save(); if (e.key === "Escape") { e.stopPropagation(); bdDescEditing = false; bdDrawCard(); } });
    desc = [t, bdEl("div", { class: "bd-row" }, bdEl("button", { type: "button", class: "small-button", text: "Save", onclick: save }),
      bdEl("button", { type: "button", class: "bd-plain-btn", text: "Cancel", onclick: () => { bdDescEditing = false; bdDrawCard(); } }))];
  } else {
    const startEdit = () => { bdDescEditing = true; bdDescDraft = card.desc; bdDrawCard(); };
    desc = card.desc ? bdEl("div", { class: "bd-desc", text: card.desc, onclick: (e) => { if (!e.target.closest("a")) startEdit(); } })
      : bdEl("button", { type: "button", class: "bd-desc-empty", text: "Add a more detailed description...", onclick: startEdit });
  }
  const descSection = bdSection("text", "Description", card.desc && !bdDescEditing ? bdEl("button", { type: "button", class: "bd-plain-btn", text: "Edit", onclick: () => { bdDescEditing = true; bdDescDraft = card.desc; bdDrawCard(); } }) : null, desc);

  // links
  const linkSection = card.links.length ? bdSection("link", "Links", bdEl("button", { type: "button", class: "bd-plain-btn", text: "Add", onclick: (e) => bdLinkPop(e.currentTarget, card) }),
    bdEl("div", { class: "bd-links" }, card.links.map((l) => bdEl("div", { class: "bd-link-row" },
      bdEl("span", { class: "bd-link-icon", html: BD_ICONS.link }),
      bdEl("div", { class: "bd-link-text" }, bdEl("button", { type: "button", class: "bd-link", text: l.name || l.url, title: l.url, onclick: () => bdOpenLink(l.url) }),
        bdEl("small", { text: (l.name ? l.url + " · " : "") + "Added " + bdAgo(l.at || Date.now()) })),
      bdEl("button", { type: "button", class: "bd-icon-btn", title: "Remove", html: BD_ICONS.trash, onclick: () => { card.links = card.links.filter((x) => x !== l); bdChanged(); } }))))) : null;

  // checklists
  const checklists = card.checklists.map((cl) => {
    const done = cl.items.filter((i) => i.done).length;
    const pct = cl.items.length ? Math.round(done / cl.items.length * 100) : 0;
    const shown = cl.hideDone ? cl.items.filter((i) => !i.done) : cl.items;
    const head = bdEl("h3", { class: "bd-cl-title", text: cl.title, title: "Rename", onclick: (e) => bdInlineEdit(e.currentTarget, cl.title, (v) => { cl.title = v; bdChanged(); }, { cls: "bd-cl-title-edit", max: "120" }) });
    const items = shown.map((item) => {
      const box = bdEl("input", { type: "checkbox", checked: item.done, onchange: () => {
        item.done = !item.done;
        if (item.done) bdLog(`finished "${item.text}" on "${card.title}"`, card);
        bdChanged();
      } });
      const text = bdEl("button", { type: "button", class: "bd-item-text" + (item.done ? " done" : ""), text: item.text,
        onclick: (e) => bdInlineEdit(e.currentTarget, item.text, (v) => { item.text = v; bdChanged(); }, { multi: true, cls: "bd-item-edit", max: "500" }) });
      return bdEl("div", { class: "bd-item" }, box, text,
        bdEl("button", { type: "button", class: "bd-icon-btn bd-item-del", title: "Delete", html: BD_ICONS.trash, onclick: () => { cl.items = cl.items.filter((x) => x !== item); bdChanged(); } }));
    });
    let adder;
    if (bdItemAdding === cl.id) {
      const t = bdAutoGrow(bdEl("textarea", { class: "bd-input", rows: "1", placeholder: "Add an item", "data-focus": "item-" + cl.id, maxlength: "500" }));
      const add = () => {
        const v = t.value.replace(/\s+/g, " ").trim();
        if (!v) return t.focus();
        cl.items.push({ id: bdNewId(), text: v, done: false });
        bdChanged();
      };
      t.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { e.stopPropagation(); bdItemAdding = ""; bdDrawCard(); } });
      adder = bdEl("div", { class: "bd-item-add" }, t, bdEl("div", { class: "bd-row" },
        bdEl("button", { type: "button", class: "small-button", text: "Add", onclick: add }),
        bdEl("button", { type: "button", class: "bd-plain-btn", text: "Cancel", onclick: () => { bdItemAdding = ""; bdDrawCard(); } })));
    } else {
      adder = bdEl("button", { type: "button", class: "bd-plain-btn bd-cl-add", text: "Add an item", onclick: () => { bdItemAdding = cl.id; bdDrawCard(); } });
    }
    return bdEl("section", { class: "bd-cd-section" },
      bdEl("div", { class: "bd-cd-head" }, bdEl("span", { class: "bd-cd-icon", html: BD_ICONS.check }), head, bdEl("span", { class: "bd-spacer" }),
        done ? bdEl("button", { type: "button", class: "bd-plain-btn", text: cl.hideDone ? `Show checked items (${done})` : "Hide checked items", onclick: () => { cl.hideDone = !cl.hideDone; bdChanged(); } }) : null,
        bdEl("button", { type: "button", class: "bd-plain-btn", text: "Delete", onclick: (e) => bdPop(e.currentTarget, `Delete ${cl.title}?`, (b) => {
          b.append(bdEl("p", { class: "bd-pop-note", text: "Deleting a checklist is permanent and there is no way to get it back." }),
            bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Delete checklist", onclick: () => { card.checklists = card.checklists.filter((x) => x !== cl); bdPopClose(); bdChanged(); } }));
        }) })),
      bdEl("div", { class: "bd-progress" }, bdEl("span", { text: pct + "%" }), bdEl("div", { class: "bd-bar-track" }, bdEl("i", { class: pct === 100 ? "full" : "", style: { width: pct + "%" } }))),
      cl.hideDone && done === cl.items.length && cl.items.length ? bdEl("p", { class: "bd-muted", text: "Everything in this checklist is done!" }) : null,
      bdEl("div", { class: "bd-items" }, items), adder);
  });

  // comments and history
  const commentBox = bdAutoGrow(bdEl("textarea", { class: "bd-input bd-comment-new", rows: "1", placeholder: "Write a comment...", "data-focus": "comment", maxlength: "5000" }));
  commentBox.value = bdCommentDraft;
  const postComment = () => {
    const v = commentBox.value.trim();
    if (!v) return;
    card.comments.unshift({ id: bdNewId(), at: Date.now(), who: bdMe(), text: v });
    bdCommentDraft = "";
    bdChanged();
  };
  commentBox.addEventListener("input", () => { bdCommentDraft = commentBox.value; sendBtn.disabled = !commentBox.value.trim(); });
  commentBox.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) postComment(); });
  const sendBtn = bdEl("button", { type: "button", class: "small-button", text: "Save", disabled: !bdCommentDraft.trim(), onclick: postComment });
  const feed = [
    ...card.comments.map((c) => ({ at: c.at, comment: c })),
    ...(bdDetails ? (card.log || []).map((l) => ({ at: l.at, log: l })) : []),
  ].sort((a, b) => b.at - a.at);
  const feedEls = feed.map((f) => {
    if (f.log) return bdEl("div", { class: "bd-feed bd-feed-log" }, bdEl("span", { class: "bd-avatar", text: (f.log.who || "Y")[0].toUpperCase() }),
      bdEl("div", {}, bdEl("p", {}, bdEl("b", { text: f.log.who || "You" }), " " + f.log.text), bdEl("small", { text: bdAgo(f.at) })));
    const c = f.comment;
    let body;
    if (bdCommentEditing === c.id) {
      const t = bdAutoGrow(bdEl("textarea", { class: "bd-input", "data-focus": "edit-" + c.id, maxlength: "5000" }));
      t.value = c.text;
      body = [t, bdEl("div", { class: "bd-row" }, bdEl("button", { type: "button", class: "small-button", text: "Save", onclick: () => { if (t.value.trim()) { c.text = t.value.trim(); c.edited = true; } bdCommentEditing = ""; bdChanged(); } }),
        bdEl("button", { type: "button", class: "bd-plain-btn", text: "Cancel", onclick: () => { bdCommentEditing = ""; bdDrawCard(); } }))];
    } else {
      body = [bdEl("div", { class: "bd-comment", text: c.text }), bdEl("div", { class: "bd-comment-tools" },
        bdEl("button", { type: "button", class: "bd-link", text: "Edit", onclick: () => { bdCommentEditing = c.id; bdDrawCard(); } }), " · ",
        bdEl("button", { type: "button", class: "bd-link", text: "Delete", onclick: (e) => bdPop(e.currentTarget, "Delete comment?", (b) => {
          b.append(bdEl("p", { class: "bd-pop-note", text: "Deleting a comment is forever. There is no undo." }),
            bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Delete comment", onclick: () => { card.comments = card.comments.filter((x) => x !== c); bdPopClose(); bdChanged(); } }));
        }) }))];
    }
    return bdEl("div", { class: "bd-feed" }, bdEl("span", { class: "bd-avatar", text: (c.who || "Y")[0].toUpperCase() }),
      bdEl("div", { class: "bd-feed-main" }, bdEl("p", {}, bdEl("b", { text: c.who || "You" }), " ", bdEl("small", { text: bdAgo(c.at) + (c.edited ? " (edited)" : "") })), body));
  });
  const activity = bdSection("activity", "Activity", bdEl("button", { type: "button", class: "bd-plain-btn", text: bdDetails ? "Hide details" : "Show details", onclick: () => { bdDetails = !bdDetails; bdDrawCard(); } }),
    bdEl("div", { class: "bd-feed bd-feed-new" }, bdEl("span", { class: "bd-avatar", text: bdMe()[0].toUpperCase() }), bdEl("div", { class: "bd-feed-main" }, commentBox,
      bdCommentDraft ? bdEl("div", { class: "bd-row" }, sendBtn) : null)), feedEls);
  commentBox.addEventListener("focus", () => { if (!bdCommentDraft && !commentBox.parentElement.querySelector(".bd-row")) commentBox.after(bdEl("div", { class: "bd-row" }, sendBtn)); });

  // the side: add things, actions
  const side = bdEl("aside", { class: "bd-cd-side" },
    bdEl("h4", { text: "Add to card" }),
    bdMenuItem("tag", "Labels", (e) => bdLabelsPop(e.currentTarget, card), "side"),
    bdMenuItem("check", "Checklist", (e) => bdChecklistPop(e.currentTarget, card), "side"),
    bdMenuItem("clock", "Dates", (e) => bdDatesPop(e.currentTarget, card), "side"),
    bdMenuItem("link", "Link", (e) => bdLinkPop(e.currentTarget, card), "side"),
    card.cover ? null : bdMenuItem("cover", "Cover", (e) => bdCoverPop(e.currentTarget, card), "side"),
    bdEl("h4", { text: "Actions" }),
    bdMenuItem("move", "Move", (e) => bdMovePop(e.currentTarget, card), "side"),
    bdMenuItem("copy", "Copy", (e) => bdCopyPop(e.currentTarget, card), "side"),
    card.archived ? bdMenuItem("undo", "Send to board", () => { card.archived = false; bdLog(`sent "${card.title}" back to the board`, card); bdChanged(); }, "side") :
      bdMenuItem("archive", "Archive", () => bdArchiveCard(card), "side"),
    card.archived ? bdMenuItem("trash", "Delete", (e) => bdPop(e.currentTarget, "Delete card?", (b) => {
      b.append(bdEl("p", { class: "bd-pop-note", text: "All actions will be removed from the activity feed and you won't be able to open the card again. There is no undo." }),
        bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Delete", onclick: () => {
          const f = bdFind(card.id);
          f.list.cards.splice(f.index, 1);
          bdLog(`deleted "${card.title}"`);
          bdPopClose();
          bdCardClose();
          bdChanged();
        } }));
    }), "side bd-danger") : null);

  dialog.replaceChildren(...[
    bdEl("button", { type: "button", class: "bd-x bd-cd-close", title: "Close", html: BD_ICONS.close, onclick: bdCardClose }),
    cover, archivedNote,
    bdEl("div", { class: "bd-cd-top" }, bdEl("span", { class: "bd-cd-icon", html: BD_ICONS.card }), bdEl("div", { class: "bd-cd-titlebox" }, title, inList)),
    bdEl("div", { class: "bd-cd-body" },
      bdEl("div", { class: "bd-cd-mainc" }, meta.children.length ? meta : null, descSection, linkSection, checklists, activity),
      side)].filter(Boolean));
  dialog.scrollTop = scroll;
  const again = (focused && dialog.querySelector(`[data-focus="${CSS.escape(focused)}"]`)) ||
    (!document.activeElement || !document.activeElement.closest(".bd-pop") ? dialog.querySelector('.bd-desc-edit, .bd-item-add textarea, [data-focus^="edit-"]') : null);
  if (again) { again.focus(); if (again.setSelectionRange) again.setSelectionRange(again.value.length, again.value.length); }
}

$("bdCardModal").addEventListener("pointerdown", (e) => { if (e.target === $("bdCardModal")) $("bdCardModal")._down = true; });
$("bdCardModal").addEventListener("click", (e) => {
  if (e.target === $("bdCardModal") && $("bdCardModal")._down) bdCardClose();
  $("bdCardModal")._down = false;
});

// ---------------------------------------------------------------- the board menu (right side)

function bdMenuPanel() {
  const back = bdMenu !== "main" ? bdEl("button", { type: "button", class: "bd-x", title: "Back", html: BD_ICONS.back, onclick: () => { bdMenu = "main"; bdDraw(); } }) : bdEl("span", { class: "bd-x-space" });
  const titles = { main: "Menu", about: "About this board", bg: "Change background", labels: "Labels", archive: "Archived items", activity: "Activity" };
  const body = bdSafe(bdEl("div", { class: "bd-menu-body" }));
  if (bdMenu === "main") {
    body.append(
      bdMenuItem("info", "About this board", () => { bdMenu = "about"; bdDraw(); }),
      bdMenuItem("activity", "Activity", () => { bdMenu = "activity"; bdDraw(); }),
      bdMenuItem("archive", "Archived items", () => { bdMenu = "archive"; bdDraw(); }),
      bdEl("div", { class: "bd-pop-sep" }),
      bdEl("button", { type: "button", class: "bd-menu-item", onclick: () => { bdMenu = "bg"; bdDraw(); } }, bdEl("span", { class: "bd-menu-swatch", style: { background: BD_BGS[bd.bg] } }), bdEl("span", { text: "Change background" })),
      bdMenuItem("tag", "Labels", () => { bdMenu = "labels"; bdDraw(); }),
      bdMenuItem("eye", bd.labelsWide ? "Hide label names on cards" : "Show label names on cards", () => { bd.labelsWide = !bd.labelsWide; bdChanged(); }),
      bdEl("div", { class: "bd-pop-sep" }),
      bdMenuItem("copy", "Copy board", async (e) => {
        const anchor = e.currentTarget;
        bdPop(anchor, "Copy board", (b) => {
          const name = bdEl("input", { class: "bd-input", value: bd.title + " (copy)", maxlength: "120", spellcheck: "false" });
          const keep = bdEl("input", { type: "checkbox", checked: true });
          b.append(bdEl("label", { class: "bd-label-text", text: "Title" }), name, bdEl("label", { class: "bd-check" }, keep, bdEl("span", { text: "Keep cards" })),
            bdEl("button", { type: "button", class: "small-button bd-wide", text: "Create", onclick: async () => {
              const copy = JSON.parse(JSON.stringify(bd));
              delete copy.id;
              Object.assign(copy, { title: name.value.trim() || bd.title, starred: false, log: [{ at: Date.now(), who: bdMe(), text: `copied this board from ${bd.title}` }] });
              copy.lists = copy.lists.filter((l) => !l.archived);
              for (const l of copy.lists) { l.cards = keep.checked ? l.cards.filter((c) => !c.archived) : []; for (const c of l.cards) c.log = []; }
              await bdSave();
              const res = await api("/api/boards-create", { board: copy }).catch(() => ({ ok: false }));
              if (!res.ok) return bdToast(res.error || "Couldn't copy the board.");
              bdPopClose();
              bdShow(res.board);
            } }));
          setTimeout(() => name.select(), 30);
        });
      }),
      bdMenuItem("trash", "Delete board", (e) => bdPop(e.currentTarget, "Delete board?", (b) => {
        b.append(bdEl("p", { class: "bd-pop-note", text: `"${bd.title}" and all its lists and cards will be gone for good. There is no undo.` }),
          bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Delete board", onclick: async () => {
            const id = bd.id;
            clearTimeout(bdSaveTimer);
            bd = null;
            await api("/api/boards-delete", { id }).catch(() => {});
            bdPopClose();
            bdClose();
          } }));
      }), "bd-danger"));
  } else if (bdMenu === "about") {
    const t = bdAutoGrow(bdEl("textarea", { class: "bd-input", placeholder: "Add a description to let people know what this board is for.", "data-focus": "board-desc", maxlength: "5000" }));
    t.value = bd.desc || "";
    t.addEventListener("change", () => { bd.desc = t.value.trim(); bdChanged(); });
    const lists = bdOpenLists();
    const cards = lists.flatMap((l) => l.cards.filter((c) => !c.archived));
    body.append(bdEl("h4", { text: "Description" }), t,
      bdEl("h4", { text: "On this board" }),
      bdEl("p", { class: "bd-muted", text: `${lists.length} list${lists.length === 1 ? "" : "s"}, ${cards.length} card${cards.length === 1 ? "" : "s"}, ${cards.filter((c) => c.done).length} done.` }),
      bdEl("p", { class: "bd-muted", text: "Saved on this computer only. Nobody else can see it." }));
  } else if (bdMenu === "bg") {
    const pick = (keys, cls) => bdEl("div", { class: "bd-bg-grid " + cls }, keys.map((key) => bdEl("button", { type: "button", class: "bd-bg-pick" + (bd.bg === key ? " on" : ""), style: { background: BD_BGS[key] }, title: key, onclick: () => { bd.bg = key; bdChanged(); } })));
    body.append(bdEl("h4", { text: "Gradients" }), pick(BD_BG_GRADIENTS, ""), bdEl("h4", { text: "Colors" }), pick(BD_BG_COLORS, ""));
  } else if (bdMenu === "labels") {
    body.append(bdEl("p", { class: "bd-muted", text: "Labels help you sort cards. Give them names like Short, Long video or Waiting." }),
      ...bd.labels.map((l) => bdEl("div", { class: "bd-label-row" },
        bdEl("button", { type: "button", class: "bd-lbl-wide" + (bdDarkText(l.color) ? " dark" : ""), style: { background: bdColor(l.color) }, text: l.name, onclick: (e) => { bdPop(e.currentTarget, "Labels", () => {}); bdLabelEdit(l, null); } }),
        bdEl("button", { type: "button", class: "bd-icon-btn", title: "Change label", html: BD_ICONS.pencil, onclick: (e) => { bdPop(e.currentTarget, "Labels", () => {}); bdLabelEdit(l, null); } }))),
      bdEl("button", { type: "button", class: "bd-plain-btn bd-wide", text: "Create a new label", onclick: (e) => { bdPop(e.currentTarget, "Labels", () => {}); bdLabelEdit(null, null); } }));
  } else if (bdMenu === "archive") {
    const switcher = bdEl("div", { class: "bd-seg" }, [["cards", "Cards"], ["lists", "Lists"]].map(([k, t]) =>
      bdEl("button", { type: "button", class: bdArchiveView === k ? "on" : "", text: t, onclick: () => { bdArchiveView = k; bdDraw(); } })));
    body.append(switcher);
    if (bdArchiveView === "cards") {
      const cards = bd.lists.flatMap((l) => l.cards.filter((c) => c.archived || l.archived).map((c) => ({ c, l })));
      if (!cards.length) body.append(bdEl("p", { class: "bd-muted bd-center", text: "No archived cards." }));
      for (const { c, l } of cards) {
        const mini = bdEl("div", { class: "bd-card bd-mini", onclick: () => bdCardOpen(c.id) }, bdEl("div", { class: "bd-card-body" }, bdCardLabels(c), bdEl("div", { class: "bd-card-title", text: c.title })));
        body.append(mini, bdEl("div", { class: "bd-archive-tools" },
          l.archived ? bdEl("span", { class: "bd-muted", text: `in archived list ${l.title}` }) : bdEl("button", { type: "button", class: "bd-link", text: "Send to board", onclick: () => { c.archived = false; bdLog(`sent "${c.title}" back to the board`, c); bdChanged(); } }),
          " · ",
          bdEl("button", { type: "button", class: "bd-link bd-danger", text: "Delete", onclick: (e) => bdPop(e.currentTarget, "Delete card?", (b) => {
            b.append(bdEl("p", { class: "bd-pop-note", text: "The card will be gone for good. There is no undo." }),
              bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Delete", onclick: () => { l.cards = l.cards.filter((x) => x !== c); bdLog(`deleted "${c.title}"`); bdPopClose(); bdChanged(); } }));
          }) })));
      }
    } else {
      const lists = bd.lists.filter((l) => l.archived);
      if (!lists.length) body.append(bdEl("p", { class: "bd-muted bd-center", text: "No archived lists." }));
      for (const l of lists) body.append(bdEl("div", { class: "bd-archived-list" }, bdEl("span", { text: l.title }),
        bdEl("button", { type: "button", class: "small-button", text: "Send to board", onclick: () => { l.archived = false; bdLog(`sent list "${l.title}" back to the board`); bdChanged(); } }),
        bdEl("button", { type: "button", class: "bd-icon-btn", title: "Delete list", html: BD_ICONS.trash, onclick: (e) => bdPop(e.currentTarget, "Delete list?", (b) => {
          b.append(bdEl("p", { class: "bd-pop-note", text: `The list "${l.title}" and its ${l.cards.length} cards will be gone for good.` }),
            bdEl("button", { type: "button", class: "small-button bd-wide bd-danger", text: "Delete", onclick: () => { bd.lists = bd.lists.filter((x) => x !== l); bdLog(`deleted list "${l.title}"`); bdPopClose(); bdChanged(); } }));
        }) })));
    }
  } else if (bdMenu === "activity") {
    const log = bd.log || [];
    if (!log.length) body.append(bdEl("p", { class: "bd-muted bd-center", text: "Nothing yet." }));
    body.append(...log.slice(0, 120).map((l) => bdEl("div", { class: "bd-feed bd-feed-log" }, bdEl("span", { class: "bd-avatar", text: (l.who || "Y")[0].toUpperCase() }),
      bdEl("div", {}, bdEl("p", {}, bdEl("b", { text: l.who || "You" }), " " + l.text), bdEl("small", { text: bdAgo(l.at) })))));
  }
  return bdEl("aside", { class: "bd-menu" }, bdEl("div", { class: "bd-menu-head" }, back, bdEl("h4", { text: titles[bdMenu] }),
    bdEl("button", { type: "button", class: "bd-x", title: "Close", html: BD_ICONS.close, onclick: () => { bdMenu = ""; bdDraw(); } })), body);
}

// ---------------------------------------------------------------- keys

document.addEventListener("keydown", (e) => {
  if ($("boardsTab").hidden) return;
  const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (e.key === "Escape") {
    if (typing && !typing.closest(".bd-pop") && typing.matches(".bd-inline, .bd-compose, .bd-add-list input, .bd-desc-edit, .bd-item-add textarea, .bd-cd-section textarea:not(.bd-comment-new), .bd-quick-text")) return; // (they close themselves)
    if (!$("bdPop").hidden) { e.stopPropagation(); return bdPopClose(); }
    if (bdCardId) { e.stopPropagation(); return bdCardClose(); }
    if (bdMenu) { bdMenu = ""; return bdDraw(); }
    return;
  }
  if (typing || e.ctrlKey || e.altKey || e.metaKey || !bd || bdCardId) return;
  if (e.key === "f") { e.preventDefault(); bdFilterPop($("bdBoard").querySelector(".bd-filter-btn")); }
  if (e.key === "x" && bdFiltering()) { bdFilter = { text: "", labels: new Set(), due: new Set() }; bdDraw(); }
  if (e.key === ";") { bd.labelsWide = !bd.labelsWide; bdChanged(); }
}, true);

addEventListener("beforeunload", () => { if (bd) navigator.sendBeacon && bdSave(); });

if (!$("boardsTab").hidden) boardsTabChanged("boards");
