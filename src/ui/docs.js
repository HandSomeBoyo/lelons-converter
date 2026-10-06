// The Docs tab: documents and movie scripts.
//  - Local: saved on this computer only, nobody else can ever see them (see docs.py).
//  - Collab: shared through the accounts. Only the one who made it and the people they invited
//    (and who said yes) can open it. Everyone can write at the same time: the document is a list
//    of blocks (a paragraph, a heading, a list...), each saved on its own, and about every second
//    the app sends its changed blocks and gets everyone else's. Someone typing in a block "holds"
//    it for a few seconds, so two people never type over each other.
// Uses $, api(), whereToSave() from app.js, sfxUser()/openLogin() from sfx.js, showTab() from images.js,
// setChildren() from motion.js, loadPref()/savePref() from theme.js.

const docsText = $("docText");
let docsWhere = loadPref("docsWhere") === "collab" ? "collab" : "local";
let docsLocal = [];          // the list on the Docs home: local docs
let docsCollab = null;       // {docs, invites} or null (not logged in / couldn't load)
let docsCollabError = "";
let docsListRun = 0;
let docsListTimer = 0;
let docsInvitesSeen = new Set(JSON.parse(loadPref("docsInvitesSeen") || "[]"));

// The open document.
let doc = null;              // {where, id, kind, title, mine, people, rev}
const docPending = new Set();    // block ids changed here and not saved/sent yet
const docDeleted = new Set();    // block ids deleted here and not sent yet
const docInFlight = new Map();   // id -> html being sent right now
let docTitleDirty = false;
let docSettingsDirty = false;
let docDirty = false;        // changed since the last Save (nothing is saved until you press Save)
let docSaveWanted = false;
// Pages: a document can have more pages (and pages under pages). Their blocks have ids "<page>~<id>";
// a page's name is a block "t~<page>". Only the page you're on is on screen; the rest wait in docStore.
let docTab = "";               // the page on screen ("" = the document's first page)
const docStore = new Map();    // id -> {pos, html} for everything not on screen
const docTabsOpen = new Set(); // pages whose pages-under are folded away (it's "closed" really)
const docTabOf = (id) => id.startsWith("t~") ? null : id.includes("~") ? id.slice(0, id.indexOf("~")) : "";
const docNewId = () => (docTab ? docTab + "~" : "") + newBlockId();   // (collab) the next sync sends your changes
let docSyncTimer = 0;
let docSyncBusy = false;
let docSyncAgain = false;
let docApplying = false;     // changing the page ourselves (remote changes, undo): don't count as typing
let docLastTyped = 0;        // when you last typed (for "holding" a block)
let docTypedBlock = null;
let docHere = [];            // who else has it open: [{username, avatarUrl, block, typing}]
let docFailed = 0;
let docOpenRun = 0;

const DOC_ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  bold: '<path d="M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7zM7 12h7a4 4 0 0 1 0 8H7z"/>',
  italic: '<path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20.5h14"/>',
  strike: '<path d="M16.5 7.5c-.6-1.8-2.4-3-4.6-3-2.6 0-4.4 1.4-4.4 3.5 0 4.6 9.5 2.6 9.5 7.9 0 2.2-2 3.6-4.8 3.6-2.5 0-4.4-1.2-5-3.2M4 12h16"/>',
  color: '<path d="M6.5 18 12 4l5.5 14M8.4 13.5h7.2"/>',
  highlight: '<path d="m9 15 7.5-7.5a2.1 2.1 0 0 0-3-3L6 12l-1 4z"/><path d="m12.5 5.5 3 3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 15.5-4.5-4.5-8.5 8.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10"/>',
  left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  justify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  bullets: '<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/>',
  numbers: '<path d="M4 5h1.5v4M4 9h3M4 13.5c0-.8.7-1.5 1.5-1.5S7 12.7 7 13.5c0 1.2-3 2-3 3.5h3M9.5 7H20M9.5 12H20M9.5 17H20"/>',
  checklist: '<rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><path d="m4.8 15.8 1.4 1.4 2.6-2.8M11.5 7H20M11.5 16H20"/>',
  outdent: '<path d="M20 6H10M20 12h-8M20 18H10M7 9l-3 3 3 3"/>',
  indent: '<path d="M20 6H10M20 12h-8M20 18H10M4 9l3 3-3 3"/>',
  clear: '<path d="M6 5h11M11.5 5 8.5 19M4 20l16-16"/>',
  find: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  outline: '<path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10"/>',
  hr: '<path d="M4 12h16"/><path d="M4 7h16M4 17h16" opacity=".35"/>',
  pagebreak: '<path d="M6 3.5v5h12v-5M6 20.5v-5h12v5"/><path d="M3 12h2.5M8 12h2.5M13.5 12H16M18.5 12H21"/>',
  numbersScene: '<path d="M5 4.5 3.5 20M11 4.5 9.5 20M3 9.5h9M2.5 15h9M15 8h5M15 12h5M15 16h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.9c1.6.7 2.7 2.2 3 4.6"/>',
  doc: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.5h6M9 16h4"/>',
  script: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="m3.5 7 2.6-3.5h3.3L6.8 7M10.1 7l2.6-3.5H16L13.4 7M16.7 7l2.6-3.5"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a2 2 0 0 0 2 1.5h6a2 2 0 0 0 2-1.5L18 7M9 7V4.5h6V7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  leave: '<path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>',
  blank: '',
  save: '<path d="M5.5 4h10l3 3v11.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8.5 4v4.5h6V4M8.5 20v-6h7v6"/>',
  rename: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  page: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 7.5h7M8.5 7.5v9h7v-9" stroke-dasharray="2 2"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7 17 4M15.7 15.7 7 4"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5M9 11h6M9 15h4"/>',
  selectAll: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8.5 9.5h7M8.5 14.5h7"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.5"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M8.5 11h5M11 8.5v5"/>',
  paper: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  omega: '<path d="M5 19.5h4.5v-2.2A7 7 0 0 1 12 4.5a7 7 0 0 1 2.5 12.8v2.2H19"/>',
  emoji: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.2 4.2 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.8"/>',
  sup: '<path d="m4 8 8 10M12 8l-8 10M16 5.5a2 2 0 1 1 3.4 1.4L16 10.5h4"/>',
  sub: '<path d="m4 6 8 10M12 6 4 16M16 15.5a2 2 0 1 1 3.4 1.4L16 20.5h4"/>',
  textCase: '<path d="M3 17.5 7 6.5l4 11M4.4 14h5.2M16.5 11.5a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6M19.3 11v6.5"/>',
  spacing: '<path d="M10 6h10M10 12h10M10 18h10M5 4.5v15M3 7l2-2.5L7 7M3 17l2 2.5 2-2.5"/>',
  count: '<path d="M5 4.5h14M5 9.5h14M5 14.5h8"/><path d="M15.5 17.5l2 2 3.5-4"/>',
  spell: '<path d="M3.5 15 7 5.5l3.5 9.5M4.6 12h4.8M13 15V5.5h3a2.4 2.4 0 0 1 0 4.8h-3M13 10.3h3.5a2.4 2.4 0 0 1 0 4.7H13M4 19.5l2 1.5 3.5-3"/>',
  character: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.7 7-5.7s6.2 2.1 7 5.7"/>',
  font: '<path d="M4 19.5 9.5 5h1L16 19.5M6 14.5h8M17 10.5c1-.7 1.8-1 2.8-1 1.4 0 2.2.8 2.2 2.2v7.8M22 15.5c-3.4 0-5 .9-5 2.5 0 1 .8 1.6 1.9 1.6 1.5 0 3.1-1 3.1-3"/>',
  quote: '<path d="M5 17.5c2.5-1 4-3.4 4-6.5V7H5v4h4M14 17.5c2.5-1 4-3.4 4-6.5V7h-4v4h4"/>',
  heading: '<path d="M6 4.5v15M15 4.5v15M6 12h9M18.5 10l2-1.5v11"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M14 6h7M14 12h5M14 18h3"/>',
  comment: '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 21v-3.5H5A1.5 1.5 0 0 1 3.5 16V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8 10h8M8 13.5h5"/>',
  check: '<path d="M5.5 12.5l4 4 9-9"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  more: '<circle cx="12" cy="6" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="18" r="1.4" fill="currentColor"/>',
  open: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
};
const docIcon = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DOC_ICONS[name]}</svg>`;

// ---------------------------------------------------------------- block positions

// Positions are text that sorts: a new block between two others gets a position between theirs,
// so two people adding blocks at the same time never mix each other's order up.
const POS_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function posBetween(a, b) {
  a = a || "";
  let out = "";
  for (let i = 0; ; i++) {
    const da = i < a.length ? POS_DIGITS.indexOf(a[i]) : 0;
    const db = b != null && i < b.length ? POS_DIGITS.indexOf(b[i]) : POS_DIGITS.length;
    if (da === db) { out += POS_DIGITS[da]; continue; }
    // At the end (nothing after): just one step up, so adding line after line keeps positions short.
    const mid = b == null ? da + 1 : Math.floor((da + db) / 2);
    if (mid > da && mid < POS_DIGITS.length) return out + POS_DIGITS[mid];
    out += POS_DIGITS[da];
    b = null; // what's left only has to come after a
  }
}
const newBlockId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const blockKey = (el) => (el.dataset.pos || "") + "\u0000" + (el.dataset.id || "");

// ---------------------------------------------------------------- cleaning html

// Everything that goes into a document is cleaned first (pasted text, other people's blocks):
// only plain formatting, no scripts, no outside pictures, no styles that could hide or move things.
const DOC_TAGS = new Set("P H1 H2 H3 DIV SPAN B STRONG I EM U S STRIKE DEL SUB SUP BR UL OL LI BLOCKQUOTE PRE CODE A IMG HR TABLE THEAD TBODY TR TD TH MARK".split(" "));
const DOC_DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED LINK META TITLE NOSCRIPT TEMPLATE SVG MATH FORM INPUT BUTTON TEXTAREA SELECT OPTION VIDEO AUDIO SOURCE CANVAS HEAD BASE FRAME FRAMESET".split(" "));
const DOC_TOP = new Set("P H1 H2 H3 UL OL BLOCKQUOTE PRE HR TABLE".split(" "));
const DOC_STYLES = ["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration-line",
  "text-align", "margin-left", "line-height", "width", "vertical-align"];
const DOC_CLASS = /^(sp-(scene|action|character|paren|dialogue|transition|shot|centered|title|contact)|doc-(title|subtitle|table)|checklist|checked|page-break)$/;
const SCRIPT_KINDS = ["scene", "action", "character", "paren", "dialogue", "transition", "shot", "centered"];

function cleanStyle(from, to) {
  for (const name of DOC_STYLES) {
    let value = from.style.getPropertyValue(name);
    if (!value || /url\(|expression|javascript|[<>]|var\(/i.test(value)) continue;
    if (name === "font-size" && !/^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(value)) continue;
    if (name === "margin-left" && !/^\d+(\.\d+)?(px|pt|em)$/.test(value)) continue;
    if (name === "width" && !/^\d+(\.\d+)?(%|px)$/.test(value)) continue;
    if (name === "font-family") value = value.replace(/[^\w\s,"'-]/g, "");
    to.style.setProperty(name, value);
  }
}

function cleanInto(from, to) {
  for (const node of from.childNodes) {
    if (node.nodeType === 3) { to.append(node.data); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();
    if (DOC_DROP.has(tag)) continue;
    // Google Docs puts everything inside <b style="font-weight:normal">: that's not bold.
    const fakeBold = (tag === "B" || tag === "STRONG") && /^(normal|400)$/.test(node.style.fontWeight);
    let keepTag = tag === "H4" || tag === "H5" || tag === "H6" ? "H3" : tag === "FONT" ? "SPAN" : tag;
    if (fakeBold || !DOC_TAGS.has(keepTag)) { cleanInto(node, to); continue; }
    const el = document.createElement(keepTag);
    cleanStyle(node, el);
    if (tag === "FONT" && node.getAttribute("color") && /^#?\w+$/.test(node.getAttribute("color"))) el.style.color = node.getAttribute("color");
    for (const c of node.classList) if (DOC_CLASS.test(c)) el.classList.add(c);
    if (keepTag === "A") {
      const href = node.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href)) el.setAttribute("href", href);
    } else if (keepTag === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(src)) continue; // only pictures inside the doc
      el.setAttribute("src", src);
      if (node.getAttribute("alt")) el.setAttribute("alt", node.getAttribute("alt").slice(0, 200));
    } else if (keepTag === "TD" || keepTag === "TH") {
      for (const a of ["colspan", "rowspan"]) if (/^\d{1,2}$/.test(node.getAttribute(a) || "")) el.setAttribute(a, node.getAttribute(a));
    }
    cleanInto(node, el);
    to.append(el);
  }
  return to;
}

// html (from anywhere) -> a fragment of clean nodes, made in this page.
function docClean(html) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return cleanInto(parsed.body, document.createDocumentFragment());
}

// One saved block -> its element (a top-level paragraph, heading, list...).
function blockFromHtml(block) {
  const frag = docClean(block.html);
  let el = frag.firstElementChild;
  if (!el || frag.children.length !== 1 || !DOC_TOP.has(el.tagName)) {
    el = document.createElement("p");
    el.append(frag);
  }
  if (!el.childNodes.length && el.tagName !== "HR") el.append(document.createElement("br"));
  el.dataset.id = block.id;
  el.dataset.pos = block.pos;
  return el;
}

// The element as it's saved (without the app's own marks).
function blockHtml(el) {
  const copy = el.cloneNode(true);
  for (const a of ["data-id", "data-pos", "contenteditable", "data-who", "style"]) {
    if (a === "style" && copy.getAttribute("style")) { const keep = document.createElement("x"); cleanStyle(copy, keep); copy.setAttribute("style", keep.getAttribute("style") || ""); if (!copy.getAttribute("style")) copy.removeAttribute("style"); continue; }
    copy.removeAttribute(a);
  }
  copy.classList.remove("doc-held", "doc-other", "doc-find-hit");
  if (!copy.classList.length) copy.removeAttribute("class");
  copy.querySelectorAll("[style='']").forEach((n) => n.removeAttribute("style"));
  return copy.outerHTML;
}

// ---------------------------------------------------------------- kinds of documents

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const p = (text, cls) => `<p${cls ? ` class="${cls}"` : ""}>${text ? esc(text) : "<br>"}</p>`;

// Every new document starts empty. The kind you pick sets up the page and shows a guide on how to write it
// (doc.settings.type remembers the kind, so the guide is there again next time).
const DOC_TYPES = [
  { key: "blank", kind: "doc", icon: "doc", name: "Blank document", note: "An empty page, nothing else", title: "Untitled document" },
  { key: "script", kind: "script", icon: "script", name: "Movie script", note: "Formatted like a real screenplay", title: "Untitled script",
    hint: "Start with a scene heading, like INT. KITCHEN - NIGHT",
    guide: {
      title: "How to write a movie script",
      intro: "A script is made of blocks. You pick what kind of block you're writing and the app puts it in the right place on the page.",
      steps: [
        ["Scene heading", "Where and when. Start with INT. (inside) or EXT. (outside), then the place, then DAY or NIGHT. Like INT. KITCHEN - NIGHT."],
        ["Action", "What we see and hear, written like it's happening now. Keep it short. Write a name in CAPITALS the first time we meet someone."],
        ["Character", "The name of who's talking, above their lines. Press Tab on an empty action line to get one."],
        ["Dialogue", "What they say. Press Enter after the name and just type."],
        ["Parenthetical", "A tiny note on how they say it, like (whispering). Type ( inside dialogue."],
        ["Transition", "How we go to the next scene, like CUT TO: or FADE OUT. Only use one when it matters."],
      ],
      tip: "Enter takes you to the usual next block, Tab changes the kind of block, and Ctrl+1 to Ctrl+8 picks one straight away. One page is about one minute of film.",
    } },
  { key: "outline", kind: "doc", icon: "outline", name: "Story outline", note: "Plan your story before you write it", title: "Story outline",
    hint: "Start with your logline: the whole story in one sentence",
    guide: {
      title: "How to outline a story",
      intro: "An outline is the plan for your story. Short notes are fine, it's only for you.",
      steps: [
        ["Logline", "The whole story in one sentence: when someone wants something, they have to do something hard, or else something bad happens."],
        ["Characters", "Your main people. For each one: who they are, what they want, and what's in their way."],
        ["Act 1: the setup", "Where we are, who we follow, and the thing that kicks the story off."],
        ["Act 2: the trouble", "What gets in the way, and how it gets worse."],
        ["Act 3: the end", "The big moment, and how things are different after."],
      ],
      tip: "Make each part a heading with the text style menu in the toolbar. Headings show up on the left, so you can jump around.",
    } },
  { key: "shots", kind: "doc", icon: "table", name: "Shot list", note: "Plan every shot for the shoot day", title: "Shot list",
    hint: "Add the table from the guide, then write one shot per row",
    guide: {
      title: "How to make a shot list",
      intro: "A shot list is every shot you need to film, so nothing gets forgotten on the day.",
      steps: [
        ["Shot", "Give every shot a number: 1, 2, 3..."],
        ["Scene", "Which scene of your script it's for."],
        ["What we see", "In a few words, like \"Maya looks at the notebook\"."],
        ["Size", "How close the camera is: wide, medium, close-up or insert (a detail, like hands)."],
        ["Camera", "How you film it: tripod, handheld, drone or moving."],
        ["Done", "Tick it off on the day once it's filmed."],
      ],
      tip: "Group the shots by place, not by story order. Then you only set up at each place once.",
      tables: [["Add the shot table", ["Shot", "Scene", "What we see", "Size", "Camera", "Done"], 6]],
    } },
  { key: "youtube", kind: "doc", icon: "script", name: "Video script", note: "For YouTube: hook, parts and ending", title: "Video script",
    hint: "Start with your hook: the first thing you'll say",
    guide: {
      title: "How to write a video script",
      intro: "Write it the way you talk. People decide in the first seconds if they keep watching.",
      steps: [
        ["Hook", "The first 15 seconds. Say the most interesting thing first, or show what they'll get."],
        ["Intro", "Who you are and what this video gives them. Keep it under 30 seconds."],
        ["The parts", "One heading per part. Write what you say, and put what's on screen in a table next to it if that helps."],
        ["Ending", "Sum it up, ask them to subscribe, and point to your next video."],
      ],
      tip: "Read it out loud. If it sounds like reading, rewrite it the way you'd say it. Insert, Checklist is handy for a \"before uploading\" list.",
      tables: [["Add a say / show table", ["Part", "What I say", "On screen"], 4]],
    } },
  { key: "treatment", kind: "doc", icon: "doc", name: "Treatment", note: "The whole film told like a story", title: "Treatment",
    hint: "Start with your logline: what the film is, in one or two sentences",
    guide: {
      title: "How to write a treatment",
      intro: "A treatment tells your whole film like a short story, before there's a script. It's what you show people to get them excited.",
      steps: [
        ["Logline", "One or two sentences that sell the film."],
        ["Story", "Tell the whole story from start to end, in the present tense, like you're telling a friend. Include the ending."],
        ["Characters", "The main people: age, who they are, what they want, and what's in their way."],
        ["Look and feel", "Colors, light, camera, music. Films that feel like yours."],
        ["Why this film", "Why you want to make it, and why now."],
      ],
      tip: "No dialogue here, just the story. One to three pages is plenty for a short film.",
    } },
  { key: "storyboard", kind: "doc", icon: "image", name: "Storyboard", note: "A picture and notes for every shot", title: "Storyboard",
    hint: "Add the table from the guide, then one shot per row",
    guide: {
      title: "How to make a storyboard",
      intro: "A storyboard shows every shot as a picture, so everyone sees the film the same way before you film it.",
      steps: [
        ["Shot", "Number every shot."],
        ["Picture", "Click in the box and use Insert, Picture. A quick drawing or a phone photo is enough, stick figures are fine."],
        ["What happens", "What we see in this shot."],
        ["Sound", "Dialogue, music or sound effects."],
        ["Camera", "Does it move? Pan, zoom, follow, or stay still."],
      ],
      tip: "Do one storyboard per scene, so it doesn't get too long.",
      tables: [["Add the storyboard table", ["Shot", "Picture", "What happens", "Sound", "Camera"], 5]],
    } },
  { key: "callsheet", kind: "doc", icon: "calendar", name: "Call sheet", note: "Who, where and when for a shoot day", title: "Call sheet",
    hint: "Start with the date and where you're filming",
    guide: {
      title: "How to make a call sheet",
      intro: "A call sheet tells everyone where to be and when on a shoot day. Send it the day before.",
      steps: [
        ["The basics", "Date, the time everyone has to be there, the address, and the weather."],
        ["Schedule", "What gets filmed when, with breaks and lunch."],
        ["Cast and crew", "Everyone who's coming, what they do, when they need to be there, and their phone number."],
        ["Notes", "Parking, food, what to bring, and who to call if something goes wrong."],
      ],
      tip: "Put your own phone number at the top so people can call you if they're lost.",
      tables: [["Add the schedule table", ["Time", "Scene", "What", "Who"], 5], ["Add the cast and crew table", ["Name", "Role", "Call time", "Phone"], 4]],
    } },
];
const docTypeOf = (d) => DOC_TYPES.find((t) => t.key === (d && d.settings && d.settings.type)) || DOC_TYPES.find((t) => t.key === (d && d.kind === "script" ? "script" : "blank"));

function typeBlocks(t) {
  return [{ id: newBlockId(), pos: posBetween("", null), html: p("", t.kind === "script" ? "sp-scene" : "") }];
}

// ---------------------------------------------------------------- the Docs home (the lists)

function docsTabChanged(tab) {
  if (tab !== "docs") return; // the document stays open as it is (nothing is saved without Save)
  if (!doc) loadDocsList();
}

function docsAccountChanged() {
  const user = sfxUser();
  if (!user) {
    docsCollab = null;
    $("docsTabBadge").hidden = $("docsCollabBadge").hidden = true;
    if (doc && doc.where === "collab") closeDoc();
  }
  if (!$("docsTab").hidden && !doc) drawDocsHome();
  clearTimeout(docsListTimer);
  if (user) docsListTimer = setTimeout(loadDocsList, 1500); // for the invitations badge
}

async function loadDocsList() {
  clearTimeout(docsListTimer);
  const mine = ++docsListRun;
  const wantCollab = !!sfxUser();
  const res = await api("/api/docs-list", { collab: wantCollab }).catch(() => null);
  if (mine !== docsListRun) return;
  if (res && res.ok) {
    docsLocal = res.local;
    docsCollab = res.collab || null;
    docsCollabError = res.collabError || "";
  }
  drawInvitesBadge();
  if (!$("docsTab").hidden && !doc) drawDocsHome();
  // Invitations come in on their own: look every minute (more often while the list is open).
  if (wantCollab) docsListTimer = setTimeout(loadDocsList, !$("docsTab").hidden && !doc && !document.hidden ? 8000 : 60000);
}

const docsInvitesToasted = new Set();
function drawInvitesBadge() {
  const invites = (docsCollab && docsCollab.invites) || [];
  const fresh = invites.filter((i) => !docsInvitesSeen.has(i.id));
  const news = fresh.filter((i) => !docsInvitesToasted.has(i.id));
  news.forEach((i) => docsInvitesToasted.add(i.id));
  if (news.length && !(docsWhere === "collab" && !$("docsTab").hidden && !doc)) {
    docToast(news.length === 1 ? `${news[0].from} invited you to write "${news[0].title}" with them.` : `You're invited to ${news.length} documents.`);
    const look = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "See it" });
    look.onclick = async () => {
      $("docToast").classList.remove("show");
      showTab("docs");
      if (doc && !(await docLeave())) return;
      if (doc) closeDoc();
      docsSwitchTo("collab");
    };
    $("docToast").append(" ", look);
  }
  for (const badge of [$("docsTabBadge"), $("docsCollabBadge")]) {
    badge.hidden = !invites.length;
    badge.textContent = invites.length > 9 ? "9+" : invites.length;
  }
  $("docsTabBadge").classList.toggle("fresh", fresh.length > 0);
}

function docsSwitchTo(where) {
  docsWhere = where;
  savePref("docsWhere", where);
  drawDocsHome();
  if (where === "collab") loadDocsList();
}
$("docsSwitch").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => docsSwitchTo(b.dataset.where)));
$("docsOutLogin").addEventListener("click", (e) => { e.stopPropagation(); openLogin("login"); });
$("docsOutSignup").addEventListener("click", (e) => { e.stopPropagation(); openLogin("signup"); });
$("docsSearch").addEventListener("input", () => drawDocsHome());

function moveDocsPill() {
  const active = $("docsSwitch").querySelector("button.active");
  const pill = $("docsSwitch").querySelector(".docs-switch-pill");
  if (!active) return;
  pill.style.width = active.offsetWidth + "px";
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
}
window.addEventListener("resize", moveDocsPill);

function timeAgo(when) {
  const seconds = Math.max(0, Date.now() / 1000 - when);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " h ago";
  const days = Math.floor(seconds / 86400);
  if (days < 7) return days === 1 ? "yesterday" : days + " days ago";
  return new Date(when * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}
const whenOf = (d) => typeof d.updated_at === "number" ? d.updated_at : Date.parse(d.updated_at) / 1000;

function docAvatar(person, size = "") {
  const el = document.createElement("span");
  el.className = "doc-avatar " + size;
  el.title = person.username;
  el.style.setProperty("--who", docColor(person.username));
  if (person.avatarUrl) {
    const img = document.createElement("img");
    img.src = person.avatarUrl;
    img.alt = "";
    el.append(img);
  } else {
    el.textContent = (person.username || "?")[0].toUpperCase();
  }
  return el;
}

// Each person gets their own color (the same one everywhere).
const DOC_COLORS = ["#ff9f0a", "#30d158", "#64d2ff", "#bf5af2", "#ff375f", "#ffd60a", "#5e5ce6", "#66d4cf", "#ff6961", "#ac8e68"];
function docColor(name) {
  let h = 0;
  for (const c of String(name || "").toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DOC_COLORS[h % DOC_COLORS.length];
}

function drawDocsHome() {
  $("docsSwitch").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.where === docsWhere));
  requestAnimationFrame(moveDocsPill);
  const collab = docsWhere === "collab";
  const user = sfxUser();
  $("docsWhere").innerHTML = "";
  $("docsWhere").append(...(collab
    ? [Object.assign(document.createElement("span"), { innerHTML: docIcon("people") }), "Write together. Only you and the people you invite can see these."]
    : [Object.assign(document.createElement("span"), { innerHTML: docIcon("lock") }), "Only you can see these. They're saved on this computer and never leave it."]));
  $("docsLoggedOut").hidden = !collab || !!user;
  $("docsMain").hidden = collab && !user;
  drawInvites();
  if (collab && !user) return;
  // The "New document" button (it asks what kind)
  if (!$("docsTemplates").children.length) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "doc-template";
    b.innerHTML = `<span class="doc-thumb"><span class="doc-thumb-page"><span class="doc-plus">${docIcon("plus")}</span></span></span><b class="doc-name-line">New document</b><small class="doc-note-line">Choose what to write</small>`;
    b.addEventListener("click", () => openDocTypes());
    $("docsTemplates").append(b);
  }
  // The documents
  const search = $("docsSearch").value.trim().toLowerCase();
  let list = collab ? (docsCollab ? docsCollab.docs : []) : docsLocal;
  if (search) list = list.filter((d) => d.title.toLowerCase().includes(search));
  const sort = loadPref("docsSort") || "new";
  list = [...list].sort(sort === "name" ? (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })
    : sort === "old" ? (a, b) => whenOf(a) - whenOf(b) : (a, b) => whenOf(b) - whenOf(a));
  $("docsSort").querySelector("span").textContent = DOCS_SORTS[sort];
  $("docsListTitle").textContent = collab ? "Shared with you" : "On this computer";
  setChildren($("docsGrid"), list.map(docCard));
  $("docsEmpty").hidden = list.length > 0;
  $("docsEmpty").textContent = search ? "Nothing with that name."
    : collab && docsCollabError ? docsCollabError
    : collab && !docsCollab ? "Loading..."
    : collab ? "No shared documents yet. Start one above, then invite people with the Invite button."
    : "No documents yet. Start one above.";
}

const docCards = new Map();
function docCard(d) {
  const collab = docsWhere === "collab";
  const sig = JSON.stringify([d.title, d.updated_at, d.preview, d.people && d.people.map((x) => x.username), d.updated_by, d.settings]);
  return keptNode(docCards, docsWhere + d.id, sig, () => {
    const card = document.createElement("div");
    card.className = "doc-card";
    card.tabIndex = 0;
    card.innerHTML = `<span class="doc-thumb ${d.kind === "script" ? "is-script" : ""}"><span class="doc-thumb-page"></span></span>
      <div class="doc-card-info"><span class="doc-card-icon"></span><div><b></b><small></small></div>
      <button type="button" class="icon-button doc-card-more" title="More"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg></button></div>`;
    drawThumb(card.querySelector(".doc-thumb-page"), d.preview || [], d.kind, d.settings);
    card.querySelector(".doc-card-icon").innerHTML = docIcon(d.kind === "script" ? "script" : "doc");
    card.querySelector(".doc-card-info b").textContent = d.title;
    const when = timeAgo(whenOf(d));
    card.querySelector(".doc-card-info small").textContent = collab && d.updated_by ? `${d.updated_by}, ${when}` : when;
    if (collab && d.people && d.people.length > 1) {
      const faces = document.createElement("span");
      faces.className = "doc-faces";
      faces.append(...d.people.filter((x) => x.joined).slice(0, 4).map((x) => docAvatar(x, "tiny")));
      card.querySelector(".doc-card-info > div").append(faces);
    }
    const more = card.querySelector(".doc-card-more");
    more.addEventListener("click", (e) => { e.stopPropagation(); docCardMenu(d, collab, more); });
    const open = () => openDoc(collab ? "collab" : "local", d.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    return card;
  });
}

async function docCardRemove(d, collab) {
  const leave = collab && !d.mine;
  const yes = await docAsk(leave ? "Leave this document?" : "Delete this document?",
    leave ? `You won't see "${d.title}" any more, unless you're invited again.`
      : collab ? `"${d.title}" is deleted for everyone in it. This can't be undone.` : `"${d.title}" is deleted from this computer. This can't be undone.`,
    leave ? "Leave" : "Delete");
  if (!yes) return;
  const res = leave
    ? await api("/api/docs-remove", { id: d.id, username: sfxUser().username }).catch(() => null)
    : await api("/api/docs-delete", { id: d.id, where: collab ? "collab" : "local" }).catch(() => null);
  if (!res || !res.ok) docToast((res && res.error) || "That didn't work. Try again.");
  loadDocsList();
  return !!(res && res.ok);
}

// The little page picture: the first blocks, drawn small.
function drawThumb(page, htmls, kind, settings) {
  const s = { ...docDefaults(kind), ...docCleanSettings(settings) };
  page.dataset.paper = s.paper;
  page.style.setProperty("--doc-font", docFontCss(s.font));
  page.style.setProperty("--doc-line", s.line);
  const text = document.createElement("div");
  text.className = "doc-text thumb" + (kind === "script" ? " script" : "");
  for (const html of htmls) {
    const el = blockFromHtml({ id: "t", pos: "t", html });
    el.querySelectorAll("img").forEach((img) => img.replaceWith(Object.assign(document.createElement("span"), { className: "thumb-img" })));
    text.append(el);
  }
  page.replaceChildren(text);
  docThumbSizer.observe(page);
}
// The little page is the real page made small, so it has to know how wide it is.
const docThumbSizer = new ResizeObserver((entries) => {
  for (const e of entries) e.target.style.setProperty("--thumb-scale", (e.contentRect.width / 816).toFixed(4));
});

function drawInvites() {
  const invites = (docsWhere === "collab" && sfxUser() && docsCollab && docsCollab.invites) || [];
  $("docsInvites").hidden = !invites.length;
  if (!invites.length) return;
  const rows = invites.map((inv) => {
    const row = document.createElement("div");
    row.className = "doc-invite";
    row.append(docAvatar({ username: inv.from, avatarUrl: inv.avatarUrl }));
    const text = document.createElement("div");
    text.innerHTML = "<b></b><small></small>";
    text.querySelector("b").textContent = inv.title;
    text.querySelector("small").textContent = `${inv.from} invited you to ${inv.kind === "script" ? "a script" : "a document"}`;
    const no = Object.assign(document.createElement("button"), { type: "button", className: "outline-button", textContent: "No thanks" });
    const yes = Object.assign(document.createElement("button"), { type: "button", className: "small-button", textContent: "Join" });
    no.onclick = () => answerInvite(inv, false, row);
    yes.onclick = () => answerInvite(inv, true, row);
    row.append(text, no, yes);
    return row;
  });
  const head = Object.assign(document.createElement("h3"), { className: "docs-label", textContent: invites.length === 1 ? "You're invited" : `You're invited (${invites.length})` });
  $("docsInvites").replaceChildren(head, ...rows);
  for (const inv of invites) docsInvitesSeen.add(inv.id);
  savePref("docsInvitesSeen", JSON.stringify([...docsInvitesSeen].slice(-200)));
  drawInvitesBadge();
}

async function answerInvite(inv, join, row) {
  row.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const res = await api("/api/docs-answer", { id: inv.id, join }).catch(() => null);
  if (!res || !res.ok) {
    docToast((res && res.error) || "That didn't work. Try again.");
    row.querySelectorAll("button").forEach((b) => (b.disabled = false));
    return;
  }
  if (join) {
    await loadDocsList();
    openDoc("collab", inv.id);
  } else {
    row.classList.add("leaving");
    loadDocsList();
  }
}

// "What do you want to write?"
function openDocTypes() {
  const grid = $("docTypes");
  if (!grid.children.length) {
    for (const t of DOC_TYPES) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "doc-type" });
      b.innerHTML = `<span class="doc-type-icon">${docIcon(t.icon)}</span><span class="doc-type-text"><b></b><small></small></span>`;
      b.querySelector("b").textContent = t.name;
      b.querySelector("small").textContent = t.note;
      b.addEventListener("click", () => { $("docTypeModal").hidden = true; newDoc(t); });
      grid.append(b);
    }
  }
  $("docTypeWhere").textContent = docsWhere === "collab" && sfxUser() ? "It's a Collab document: you can invite people to write it with you." : "It's saved on this computer, only you can see it.";
  $("docTypeModal").hidden = false;
  grid.firstElementChild.focus();
}
$("docTypeCancel").addEventListener("click", () => { $("docTypeModal").hidden = true; });
$("docTypeModal").addEventListener("mousedown", (e) => { if (e.target === $("docTypeModal")) $("docTypeModal").hidden = true; });

async function newDoc(t) {
  const where = docsWhere === "collab" && sfxUser() ? "collab" : "local";
  const settings = t.key === "blank" ? {} : { type: t.key };
  const res = await api("/api/docs-create", { where, title: t.title, kind: t.kind, blocks: typeBlocks(t), settings }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't make the document. Try again.");
  await openDoc(where, res.id, { fresh: true });
}

// ---------------------------------------------------------------- opening and closing

async function openDoc(where, id, opts = {}) {
  const mine = ++docOpenRun;
  if (doc) await closeDoc(true);
  const res = await api("/api/docs-open", { where, id }).catch(() => null);
  if (mine !== docOpenRun) return;
  if (!res || !res.ok) {
    docToast((res && res.error) || "Couldn't open the document.");
    $("docEditor").hidden = true;
    $("docsHome").hidden = false;
    document.body.classList.remove("doc-open");
    drawDocsHome();
    loadDocsList();
    return;
  }
  const d = res.doc;
  doc = { where, id, kind: d.kind === "script" ? "script" : "doc", title: d.title, mine: where === "local" || d.mine,
          people: d.people || [], rev: d.rev || 0, settings: docCleanSettings(d.settings), fresh: !!opts.fresh };
  docPending.clear(); docDeleted.clear(); docInFlight.clear();
  docTitleDirty = false; docSettingsDirty = false; docDirty = false; docSaveWanted = false; docHere = []; docFailed = 0;
  document.execCommand("defaultParagraphSeparator", false, "p");
  docApplying = true;
  docTab = ""; docStore.clear(); docTabsOpen.clear();
  const here = [];
  for (const b of d.blocks || []) {
    if (docTabOf(b.id) === "") here.push(b); else docStore.set(b.id, { pos: b.pos, html: b.html });
  }
  docsText.replaceChildren(...here.map(blockFromHtml));
  docsText.classList.toggle("script", doc.kind === "script");
  docsText.classList.toggle("numbers", doc.kind === "script" && loadPref("docSceneNumbers") === "1");
  docsText.spellcheck = loadPref("docSpelling") !== "0";
  docNormalize();
  docObserver.takeRecords();
  docApplying = false;
  docUndoReset();
  $("docTitle").value = d.title;
  $("docKind").innerHTML = docIcon(doc.kind === "script" ? "script" : "doc");
  $("docKind").title = doc.kind === "script" ? "Movie script" : "Document";
  $("docsHome").hidden = true;
  $("docEditor").hidden = false;
  document.body.classList.add("doc-open");
  buildToolbar();
  docApplySettings();
  drawShare();
  drawHere();
  drawMenubar();
  docSaveState();
  $("docOutline").hidden = loadPref(doc.kind === "script" ? "docOutlineScript" : "docOutlineDoc") === "0";
  drawGuide();
  drawTabs();
  docNotesOpenDoc();
  docFit();
  docCount();
  drawOutline();
  window.scrollTo(0, 0);
  if (opts.fresh) {
    $("docTitle").focus();
    $("docTitle").select();
  } else {
    docsText.focus();
    const first = docsText.querySelector(doc.kind === "script" ? ".sp-scene, .sp-action" : "p, h1, h2, h3, li");
    if (first) docPutCaret(first, 0);
  }
  if (where === "collab") docSyncSoon(50);
}

// ---------------------------------------------------------------- comments (collab docs)
// A comment sits on a few words (quote) in one block. They're saved right away (they don't change the text),
// everyone in the document sees them, and they show as a yellow mark on the words.

let docNotes = [];          // from Supabase: {id, parent, block, quote, body, username, at, resolved, mine, canDelete}
let docNotesSig = "";
let docNotesTimer = 0;
let docNotesRun = 0;
let docNotesDraft = null;   // the new comment being written: {block, quote}
let docNotesShowResolved = false;
let docNotesActive = null;  // the comment that's selected
const docNotesRanges = new Map(); // comment id -> Range on the page

function docNotesOpenDoc() {
  const collab = doc.where === "collab";
  $("docNotesButton").hidden = !collab;
  docNotes = []; docNotesSig = ""; docNotesDraft = null; docNotesActive = null; docNotesShowResolved = false;
  $("docNotes").hidden = true;
  docNotesMark();
  drawNotesButton();
  if (collab) docNotesLoad();
}

function docNotesCloseDoc() {
  clearTimeout(docNotesTimer);
  docNotesRun++;
  docNotes = []; docNotesRanges.clear();
  $("docNotes").hidden = true;
  $("docAddNote").hidden = true;
  if (window.CSS && CSS.highlights) { CSS.highlights.delete("doc-note"); CSS.highlights.delete("doc-note-now"); }
}

async function docNotesLoad() {
  clearTimeout(docNotesTimer);
  const d = doc;
  if (!d || d.where !== "collab") return;
  const mine = ++docNotesRun;
  const res = await api("/api/docs-comments", { id: d.id, where: "collab" }).catch(() => null);
  if (doc !== d || mine !== docNotesRun) return;
  if (res && res.ok) docNotesSet(res.comments);
  docNotesTimer = setTimeout(docNotesLoad, document.hidden ? 15000 : $("docNotes").hidden ? 5000 : 2500);
}

function docNotesSet(list) {
  const sig = JSON.stringify(list || []);
  if (sig === docNotesSig) return;
  docNotesSig = sig;
  docNotes = list || [];
  if (docNotesActive && !docNotes.some((c) => c.id === docNotesActive)) docNotesActive = null;
  drawNotesButton();
  docNotesMark();
  if (!$("docNotes").hidden) drawNotes();
}

async function docNotesSend(what, data = {}) {
  const d = doc;
  if (!d) return false;
  const res = await api("/api/docs-comment", { id: d.id, where: "collab", what, ...data }).catch(() => null);
  if (doc !== d) return false;
  if (!res || !res.ok) { docToast((res && res.error) || "That didn't work. Check your internet and try again."); return false; }
  docNotesRun++; // an older load on its way would bring back the old list
  docNotesSet(res.comments);
  docNotesTimer = setTimeout(docNotesLoad, 2500);
  return true;
}

const docNotesOpen = () => docNotes.filter((c) => !c.parent && !c.resolved);
function drawNotesButton() {
  const n = docNotesOpen().length;
  const b = $("docNotesButton");
  b.innerHTML = docIcon("comment") + (n ? `<b>${n}</b>` : "");
  b.title = n ? `${n} open ${n === 1 ? "comment" : "comments"}` : "Comments";
  b.classList.toggle("on", !$("docNotes").hidden);
}

// The yellow marks on the page.
function docNotesMark() {
  docNotesRanges.clear();
  if (!window.CSS || !CSS.highlights) return;
  if (!doc || doc.where !== "collab") { CSS.highlights.delete("doc-note"); CSS.highlights.delete("doc-note-now"); return; }
  for (const c of docNotesOpen()) {
    if (!c.block || !c.quote) continue;
    const el = docsText.querySelector(`:scope > [data-id="${CSS.escape(c.block)}"]`);
    const r = el && docQuoteRange(el, c.quote);
    if (r) docNotesRanges.set(c.id, r);
  }
  CSS.highlights.set("doc-note", new Highlight(...docNotesRanges.values()));
  let now = docNotesActive && docNotesRanges.get(docNotesActive);
  if (docNotesDraft && docNotesDraft.block && docNotesDraft.quote && !$("docNotes").hidden) { // the words you're writing about
    const el = docsText.querySelector(`:scope > [data-id="${CSS.escape(docNotesDraft.block)}"]`);
    now = (el && docQuoteRange(el, docNotesDraft.quote)) || now;
  }
  if (now) CSS.highlights.set("doc-note-now", new Highlight(now));
  else CSS.highlights.delete("doc-note-now");
}

// Where the words are inside a block (spaces don't have to match exactly), as a Range.
function docQuoteRange(el, quote) {
  const nodes = [], starts = [];
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { starts.push(text.length); nodes.push(walker.currentNode); text += walker.currentNode.data; }
  const norm = (t) => t.replace(/\s+/g, " ");
  const at = norm(text).toLowerCase().indexOf(norm(quote).toLowerCase());
  if (at < 0 || !nodes.length) return null;
  // norm() only shortens runs of spaces; map the found place back onto the real text.
  const map = [];
  for (let i = 0, j = 0; i < text.length; i++) { if (!(/\s/.test(text[i]) && i > 0 && /\s/.test(text[i - 1]))) map[j++] = i; }
  const from = map[at], to = map[at + norm(quote).length - 1] + 1;
  if (from === undefined || isNaN(to)) return null;
  const place = (pos) => {
    let k = nodes.length - 1;
    while (k > 0 && starts[k] > pos) k--;
    return [nodes[k], Math.min(pos - starts[k], nodes[k].data.length)];
  };
  const r = new Range();
  r.setStart(...place(from));
  r.setEnd(...place(to));
  return r;
}

function docShowNotes(on) {
  if (!doc || doc.where !== "collab") return;
  $("docNotes").hidden = !on;
  if (on) { $("docGuide").hidden = true; drawNotes(); docNotesLoad(); }
  else { docNotesDraft = null; docNotesActive = null; docNotesMark(); drawGuide(); }
  drawNotesButton();
  docFit();
}
$("docNotesClose").addEventListener("click", () => docShowNotes(false));

// "Comment": on the words you selected (or the line you're on).
let docNotesSel = null;
function docNotesNew() {
  if (!doc || doc.where !== "collab") return;
  const sel = getSelection();
  let block = null, quote = "";
  const r = docNotesSel || (sel.rangeCount && docsText.contains(sel.anchorNode) ? sel.getRangeAt(0) : null);
  docNotesSel = null;
  if (r && docsText.contains(r.startContainer)) {
    block = docBlockOf(r.startContainer);
    quote = r.toString().replace(/\s+/g, " ").trim();
    if (block && docBlockOf(r.endContainer) !== block) quote = (block.textContent.replace(/\s+/g, " ").trim()); // across lines: the first line
    if (!quote && block) quote = block.textContent.replace(/\s+/g, " ").trim();
  }
  if (quote.length > 300) quote = quote.slice(0, 300);
  docNotesDraft = { block: block ? block.dataset.id : null, quote };
  docNotesActive = null;
  $("docAddNote").hidden = true;
  docShowNotes(true);
  docNotesMark();
  const box = $("docNotesList").querySelector(".doc-note-new textarea");
  if (box) box.focus();
}
$("docNotesButton").addEventListener("mousedown", (e) => e.preventDefault()); // keeps the selection in the text
$("docNotesButton").addEventListener("click", () => {
  if (!$("docNotes").hidden) return docShowNotes(false);
  const sel = getSelection();
  if (sel.rangeCount && !sel.isCollapsed && docsText.contains(sel.anchorNode)) docNotesNew();
  else docShowNotes(true);
});

// The little "Comment" button next to selected text (on the body: "fixed" inside the tab would be off).
document.body.append($("docAddNote"));
function docAddNoteSpot() {
  const b = $("docAddNote");
  const sel = getSelection();
  if (!doc || doc.where !== "collab" || !sel.rangeCount || sel.isCollapsed || !docsText.contains(sel.anchorNode)) { b.hidden = true; return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect(), page = $("docPage").getBoundingClientRect();
  if (!rect.height) { b.hidden = true; return; }
  b.hidden = false;
  b.style.top = Math.round(rect.top - 4) + "px";
  b.style.left = Math.round(Math.min(page.right - b.offsetWidth / 2, innerWidth - b.offsetWidth - 8)) + "px";
}
document.addEventListener("selectionchange", () => { if (doc) docAddNoteSpot(); });
window.addEventListener("scroll", () => { if (doc && !$("docAddNote").hidden) docAddNoteSpot(); }, { passive: true });
$("docAddNote").addEventListener("mousedown", (e) => {
  e.preventDefault();
  const sel = getSelection();
  docNotesSel = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
});
$("docAddNote").addEventListener("click", () => docNotesNew());
document.addEventListener("keydown", (e) => {
  if (doc && e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); docNotesNew(); }
});

// Clicking marked words opens their comment.
docsText.addEventListener("click", () => {
  if (!doc || doc.where !== "collab" || !docNotesRanges.size) return;
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  for (const [id, r] of docNotesRanges) {
    if (r.isPointInRange(sel.anchorNode, sel.anchorOffset)) { docNotesPick(id, true); return; }
  }
});

function docNotesPick(id, scroll) {
  docNotesActive = id;
  if ($("docNotes").hidden) docShowNotes(true); else drawNotes();
  docNotesMark();
  const card = $("docNotesList").querySelector(`[data-note="${id}"]`);
  if (card && scroll) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function noteWhen(at) { return timeAgo(Date.parse(at) / 1000); }

function drawNotes() {
  const list = $("docNotesList");
  const keep = document.activeElement && list.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA"
    ? { key: document.activeElement.dataset.key, value: document.activeElement.value, at: document.activeElement.selectionStart } : null;
  const items = [];
  if (docNotesDraft) {
    const box = document.createElement("div");
    box.className = "doc-note doc-note-new";
    box.innerHTML = `<div class="doc-note-quote" hidden></div><textarea rows="3" maxlength="2000" data-key="new" placeholder="Write a comment..."></textarea>
      <div class="doc-note-actions"><button type="button" class="link">Cancel</button><span class="spacer"></span><button type="button" class="small-button">Comment</button></div>`;
    const q = box.querySelector(".doc-note-quote");
    if (docNotesDraft.quote) { q.hidden = false; q.textContent = docNotesDraft.quote; }
    const ta = box.querySelector("textarea");
    const send = async () => {
      const body = ta.value.trim();
      if (!body) return ta.focus();
      box.querySelector(".small-button").disabled = true;
      const draft = docNotesDraft;
      if (await docNotesSend("add", { block: draft.block, quote: draft.quote, body })) {
        docNotesDraft = null;
        const mine = [...docNotes].reverse().find((c) => c.mine && !c.parent);
        if (mine) docNotesActive = mine.id;
        drawNotes(); docNotesMark();
      } else box.querySelector(".small-button").disabled = false;
    };
    box.querySelector(".small-button").addEventListener("click", send);
    box.querySelector(".link").addEventListener("click", () => { docNotesDraft = null; drawNotes(); docNotesMark(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } if (e.key === "Escape") { e.stopPropagation(); docNotesDraft = null; drawNotes(); } });
    items.push(box);
  }
  const roots = docNotes.filter((c) => !c.parent);
  const open = roots.filter((c) => !c.resolved), done = roots.filter((c) => c.resolved);
  // Open ones in the order they are on the page, then the ones whose words aren't there any more.
  const order = new Map([...docsText.children].map((el, i) => [el.dataset.id, i]));
  const where = (c) => (order.has(c.block) ? order.get(c.block) : 1e9);
  open.sort((a, b) => where(a) - where(b) || a.id - b.id);
  for (const c of open) items.push(noteCard(c));
  if (!open.length && !docNotesDraft && done.length) {
    const p = document.createElement("p");
    p.className = "doc-notes-empty";
    p.innerHTML = "<b>All done!</b> Every comment is resolved.";
    items.push(p);
  } else if (!open.length && !docNotesDraft) {
    const p = document.createElement("p");
    p.className = "doc-notes-empty";
    p.innerHTML = `<b>No comments yet.</b> Select some words in the document and press ${docIcon("comment")} to leave a note. Everyone in this document can see comments, and they don't change the text.`;
    items.push(p);
  }
  if (done.length) {
    const t = Object.assign(document.createElement("button"), { type: "button", className: "doc-notes-done" });
    t.innerHTML = `${docIcon("check")}<span>${docNotesShowResolved ? "Hide" : "Show"} resolved (${done.length})</span>`;
    t.addEventListener("click", () => { docNotesShowResolved = !docNotesShowResolved; drawNotes(); });
    items.push(t);
    if (docNotesShowResolved) for (const c of done.reverse()) items.push(noteCard(c));
  }
  list.replaceChildren(...items);
  if (keep) {
    const ta = list.querySelector(`textarea[data-key="${keep.key}"]`);
    if (ta) { ta.value = keep.value; ta.focus(); ta.setSelectionRange(keep.at, keep.at); }
  }
}

function noteCard(c) {
  const card = document.createElement("div");
  card.className = "doc-note" + (c.resolved ? " resolved" : "") + (c.id === docNotesActive ? " active" : "");
  card.dataset.note = c.id;
  const replies = docNotes.filter((x) => x.parent === c.id);
  const page = c.block ? docTabOf(c.block) : null;
  const elsewhere = page !== null && page !== docTab && docStore.has(c.block); // on another page of this document
  const gone = c.block && c.quote && !docNotesRanges.has(c.id) && !c.resolved && !elsewhere;
  card.innerHTML = `<div class="doc-note-quote" hidden></div><div class="doc-note-msgs"></div>
    <div class="doc-note-reply" hidden><textarea rows="2" maxlength="2000" data-key="reply-${c.id}" placeholder="Reply..."></textarea>
      <div class="doc-note-actions"><span class="spacer"></span><button type="button" class="small-button">Reply</button></div></div>`;
  const q = card.querySelector(".doc-note-quote");
  if (c.quote) { q.hidden = false; q.textContent = c.quote; q.classList.toggle("gone", !!gone); if (gone) q.title = "These words aren't in the document any more"; }
  if (elsewhere) {
    const t = docTabsList().find((x) => x.id === page);
    q.classList.add("elsewhere");
    q.title = "Go to the page";
    q.dataset.page = "On " + (page === "" ? $("docTitle").value.trim() || "the first page" : t ? t.title : "another page");
    q.addEventListener("click", () => { docShowTab(page); docNotesPick(c.id, true); });
  }
  card.querySelector(".doc-note-msgs").append(...[c, ...replies].map((m, i) => noteMsg(m, i === 0 ? c : null)));
  if (!c.resolved) {
    const rep = card.querySelector(".doc-note-reply");
    rep.hidden = false;
    const ta = rep.querySelector("textarea");
    const send = async () => {
      const body = ta.value.trim();
      if (!body) return;
      rep.querySelector("button").disabled = true;
      if (await docNotesSend("reply", { comment: c.id, body })) { ta.value = ""; drawNotes(); }
      else rep.querySelector("button").disabled = false;
    };
    rep.querySelector("button").addEventListener("click", send);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    ta.addEventListener("focus", () => { if (docNotesActive !== c.id) { docNotesActive = c.id; card.classList.add("active"); docNotesMark(); } });
  } else if (c.resolvedBy) {
    const by = document.createElement("p");
    by.className = "doc-note-by";
    by.textContent = `Resolved by ${c.resolvedBy}`;
    card.append(by);
  }
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, textarea")) return;
    docNotesActive = c.id;
    $("docNotesList").querySelectorAll(".doc-note.active").forEach((x) => x.classList.remove("active"));
    card.classList.add("active");
    docNotesMark();
    const r = docNotesRanges.get(c.id);
    if (r) {
      const rect = r.getBoundingClientRect();
      if (rect.top < 150 || rect.bottom > innerHeight - 60) window.scrollBy({ top: rect.top - innerHeight / 2, behavior: "smooth" });
    }
  });
  return card;
}

function noteMsg(m, root) {
  const el = document.createElement("div");
  el.className = "doc-note-msg";
  el.append(docAvatar({ username: m.username, avatarUrl: m.avatarUrl }, "small"));
  const body = document.createElement("div");
  body.className = "doc-note-body";
  body.innerHTML = `<div class="doc-note-head"><b></b><small></small><span class="spacer"></span></div><p></p>`;
  body.querySelector("b").textContent = m.username;
  body.querySelector("small").textContent = noteWhen(m.at) + (m.edited ? " · edited" : "");
  body.querySelector("p").textContent = m.body;
  const head = body.querySelector(".doc-note-head");
  const tool = (icon, title, fn, cls = "") => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "doc-note-tool " + cls, title });
    b.innerHTML = docIcon(icon);
    b.addEventListener("click", fn);
    head.append(b);
  };
  if (root && !root.resolved) tool("check", "Resolve: it's done (hides it, anyone can open it again)", () => docNotesSend("resolve", { comment: root.id }), "resolve");
  if (root && root.resolved) tool("undo", "Open it again", () => docNotesSend("reopen", { comment: root.id }));
  if (m.canDelete) tool("trash", root ? "Delete this comment and its replies" : "Delete this reply", async () => {
    const yes = await docAsk(root ? "Delete this comment?" : "Delete this reply?", root && docNotes.some((x) => x.parent === m.id) ? "Its replies are deleted too. This can't be undone." : "This can't be undone.", "Delete");
    if (yes) docNotesSend("delete", { comment: m.id });
  });
  el.append(body);
  return el;
}

// ---------------------------------------------------------------- pages (and pages under pages)

function docTabMeta(html) {
  const m = /^<!--tab (.*)-->$/s.exec(html || "");
  try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; }
}
const docTabHtml = (t) => "<!--tab " + JSON.stringify({ title: t.title, parent: t.parent || "" }).replace(/[-<>]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "-->";

// [{id, title, parent, pos}] in order. parent "" = at the top, "0" = under the first page.
function docTabsList() {
  const list = [];
  for (const [id, b] of docStore) {
    if (!id.startsWith("t~")) continue;
    const meta = docTabMeta(b.html);
    if (meta) list.push({ id: id.slice(2), title: String(meta.title || "Untitled page").slice(0, 100), parent: String(meta.parent || ""), pos: b.pos });
  }
  const ids = new Set(list.map((t) => t.id));
  for (const t of list) if (t.parent && t.parent !== "0" && !ids.has(t.parent)) t.parent = ""; // its page is gone
  return list.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1));
}

function drawTabs() {
  if (!doc) return;
  if ($("docTabsList").querySelector(".doc-tab-input")) return; // (not while you're naming a page; it draws again after)
  const list = docTabsList();
  const box = $("docTabsList");
  const rows = [];
  const kids = (parent) => list.filter((t) => t.parent === parent);
  const row = (t, depth) => {
    const under = kids(t.id === "" ? "0" : t.id);
    const r = document.createElement("div");
    r.className = "doc-tab-row" + (t.id === docTab ? " on" : "");
    r.style.setProperty("--depth", depth);
    r.dataset.tab = t.id;
    r.innerHTML = `<button type="button" class="doc-tab-fold" ${under.length ? "" : "hidden"}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 9.5h8l-4 5z"/></svg></button>
      <button type="button" class="doc-tab-name">${docIcon("doc")}<span></span></button>
      <button type="button" class="doc-tab-more" title="More">${docIcon("more")}</button>`;
    r.querySelector(".doc-tab-name span").textContent = t.title;
    r.querySelector(".doc-tab-name").title = t.title;
    const closed = docTabsOpen.has(t.id || "0");
    r.classList.toggle("closed", closed);
    r.querySelector(".doc-tab-fold").addEventListener("click", () => { docTabsOpen.has(t.id || "0") ? docTabsOpen.delete(t.id || "0") : docTabsOpen.add(t.id || "0"); drawTabs(); });
    r.querySelector(".doc-tab-name").addEventListener("click", () => docShowTab(t.id));
    r.querySelector(".doc-tab-name").addEventListener("dblclick", () => docRenameTab(t.id));
    r.querySelector(".doc-tab-more").addEventListener("click", (e) => { e.stopPropagation(); docTabMenu(t, r.querySelector(".doc-tab-more")); });
    if (t.id !== "") {
      r.draggable = true;
      r.addEventListener("dragstart", (e) => { docTabDrag = t.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-doc-page", t.id); r.classList.add("dragging"); });
      r.addEventListener("dragend", () => { docTabDrag = null; drawTabs(); });
    }
    r.addEventListener("dragover", (e) => {
      const where = docTabDropWhere(t, r, e);
      for (const x of box.children) x.classList.remove("drop-in", "drop-before", "drop-after");
      if (!where) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      r.classList.add("drop-" + where);
    });
    r.addEventListener("dragleave", (e) => { if (!r.contains(e.relatedTarget)) r.classList.remove("drop-in", "drop-before", "drop-after"); });
    r.addEventListener("drop", (e) => {
      const where = docTabDropWhere(t, r, e);
      e.preventDefault();
      if (where) docMoveTab(docTabDrag, t.id, where);
    });
    rows.push(r);
    if (!closed) for (const k of under) row(k, depth + 1);
  };
  row({ id: "", title: $("docTitle").value.trim() || "Untitled document" }, 0);
  for (const t of kids("")) row(t, 0);
  box.replaceChildren(...rows);
  $("docTabsHint").hidden = list.length > 0;
}
$("docTitle").addEventListener("input", () => { const r = $("docTabsList").querySelector('[data-tab=""] .doc-tab-name span'); if (r) r.textContent = $("docTitle").value.trim() || "Untitled document"; });

// Dragging a page onto another page puts it under that page; near the top or bottom edge puts it before or after.
let docTabDrag = null;
function docTabDropWhere(t, row, e) {
  const from = docTabDrag;
  if (from === null || from === t.id) return null;
  // (not into its own pages)
  const list = docTabsList();
  for (let at = t.id; at && at !== "0";) { if (at === from) return null; const p = list.find((x) => x.id === at); at = p ? p.parent : ""; }
  if (t.id === "") return "in";
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  return y < 0.28 ? "before" : y > 0.72 ? "after" : "in";
}

function docMoveTab(id, target, where) {
  const list = docTabsList();
  const me = list.find((x) => x.id === id), t = list.find((x) => x.id === target);
  const b = docStore.get("t~" + id);
  if (!me || !b) return;
  let parent, pos;
  if (where === "in") {
    parent = target === "" ? "0" : target;
    pos = posBetween(list[list.length - 1].pos, null); // last under it
    docTabsOpen.delete(parent);
  } else {
    if (!t) return;
    parent = t.parent;
    const others = list.filter((x) => x.id !== id);
    const i = others.findIndex((x) => x.id === target);
    pos = where === "before" ? posBetween(i > 0 ? others[i - 1].pos : "", t.pos) : posBetween(t.pos, i + 1 < others.length ? others[i + 1].pos : null);
  }
  if (parent === me.parent && pos === b.pos) return;
  docStore.set("t~" + id, { pos, html: docTabHtml({ ...docTabMeta(b.html), parent }) });
  docPending.add("t~" + id);
  docMarkDirty();
  drawTabs();
}

// Shows another page (the one on screen goes back into the store, changes and all).
function docShowTab(id) {
  if (!doc || id === docTab) return;
  docUndoCommit();
  docApplying = true;
  for (const el of docsText.children) docStore.set(el.dataset.id, { pos: el.dataset.pos, html: blockHtml(el) });
  docsText.replaceChildren();
  docTab = id;
  const mine = [];
  for (const [bid, b] of docStore) if (docTabOf(bid) === id) mine.push({ id: bid, ...b });
  mine.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1));
  for (const b of mine) docStore.delete(b.id);
  docsText.replaceChildren(...mine.map(blockFromHtml));
  docNormalize();
  docObserver.takeRecords();
  docApplying = false;
  docUndoReset();
  docHidePops();
  drawTabs();
  drawOutline();
  docCount();
  drawHereMarks();
  if (doc.where === "collab") { docNotesMark(); if (!$("docNotes").hidden) drawNotes(); }
  window.scrollTo(0, 0);
  docsText.focus({ preventScroll: true });
  if (docsText.firstElementChild) docPutCaret(docsText.firstElementChild, 0);
}

function docAddTab(parent) {
  if (!doc) return;
  const list = docTabsList();
  const id = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  const last = list.length ? list[list.length - 1].pos : "";
  const pos = posBetween(last, null);
  docStore.set("t~" + id, { pos, html: docTabHtml({ title: "Untitled page", parent }) });
  docPending.add("t~" + id);
  if (parent) docTabsOpen.delete(parent);
  docMarkDirty();
  docShowTab(id);
  docRenameTab(id);
}
$("docTabAdd").addEventListener("click", () => docAddTab(""));

function docRenameTab(id) {
  if (id === "") { $("docTitle").focus(); $("docTitle").select(); return; }
  const r = $("docTabsList").querySelector(`[data-tab="${CSS.escape(id)}"]`);
  const b = docStore.get("t~" + id);
  if (!r || !b) return;
  const meta = docTabMeta(b.html) || {};
  const name = r.querySelector(".doc-tab-name span");
  const input = Object.assign(document.createElement("input"), { className: "doc-tab-input", value: meta.title || "", maxLength: 100 });
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    input.remove();
    const now = docStore.get("t~" + id);
    if (keep && title && now && title !== meta.title) {
      docStore.set("t~" + id, { pos: now.pos, html: docTabHtml({ ...docTabMeta(now.html), title }) });
      docPending.add("t~" + id);
      docMarkDirty();
    }
    drawTabs();
    docsText.focus({ preventScroll: true });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

async function docDeleteTab(id) {
  const list = docTabsList();
  const gone = new Set([id]);
  for (let more = true; more;) { more = false; for (const t of list) if (!gone.has(t.id) && gone.has(t.parent)) { gone.add(t.id); more = true; } }
  const t = list.find((x) => x.id === id);
  const yes = await docAsk(`Delete "${t ? t.title : "this page"}"?`,
    gone.size > 1 ? `The ${gone.size - 1 === 1 ? "page" : gone.size - 1 + " pages"} under it ${gone.size - 1 === 1 ? "is" : "are"} deleted too.` + (doc.where === "collab" ? " For everyone in this document." : "")
      : doc.where === "collab" ? "It's deleted for everyone in this document." : "Everything on it is deleted.", "Delete");
  if (!yes || !doc) return;
  if (gone.has(docTab)) docShowTab("");
  for (const bid of [...docStore.keys()]) {
    const page = bid.startsWith("t~") ? bid.slice(2) : docTabOf(bid);
    if (gone.has(page)) { docStore.delete(bid); docPending.delete(bid); docDeleted.add(bid); }
  }
  docMarkDirty();
  drawTabs();
}

const docTabMenuEl = Object.assign(document.createElement("div"), { className: "lib-menu docs-card-menu doc-tab-menu", hidden: true });
document.body.append(docTabMenuEl);
document.addEventListener("mousedown", (e) => { if (!docTabMenuEl.hidden && !docTabMenuEl.contains(e.target) && !e.target.closest(".doc-tab-more")) docTabMenuEl.hidden = true; });
function docTabMenu(t, button) {
  const menu = docTabMenuEl;
  if (!menu.hidden && menu.dataset.id === "tab:" + t.id) { menu.hidden = true; return; }
  const item = (icon, label, fn, cls = "") => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "lib-menu-item " + cls });
    b.innerHTML = docIcon(icon) + "<span></span>";
    b.querySelector("span").textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = true; fn(); });
    return b;
  };
  const items = [item("plus", "Add a page under this", () => docAddTab(t.id === "" ? "0" : t.id)), item("rename", "Rename", () => docRenameTab(t.id))];
  if (t.id !== "") items.push(item("trash", "Delete", () => docDeleteTab(t.id), "danger"));
  menu.dataset.id = "tab:" + t.id;
  menu.replaceChildren(...items);
  menu.hidden = false;
  const r = button.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + "px";
}

// ---------------------------------------------------------------- dark page (just for you, the document keeps its paper)

const docDark = () => loadPref("docDarkPage") === "1";
function docSetDark(on) {
  savePref("docDarkPage", on ? "1" : "0");
  $("docPage").dataset.dark = on ? "1" : "";
  drawDarkButton();
  docDarkInk();
}

// Black or very dark text colours (often pasted from Google Docs) turn light on the dark page.
// Done with a style sheet, so the document itself doesn't change.
const docInkStyle = document.head.appendChild(document.createElement("style"));
const docInkCanvas = document.createElement("canvas").getContext("2d");
let docInkSig = "";
function docInkDark(value) {
  docInkCanvas.fillStyle = "#010203";
  docInkCanvas.fillStyle = value;
  const f = docInkCanvas.fillStyle; // "#rrggbb", or "rgba(r, g, b, a)" when see-through
  if (f === "#010203" && !/^#?010203$/i.test(value)) return false; // (not a colour)
  const [r, g, b] = f[0] === "#" ? [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16)) : f.match(/[\d.]+/g).map(Number);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  return hi < 70 || (0.2126 * r + 0.7152 * g + 0.0722 * b < 110 && hi - lo < 40); // black and dark greys (real colours stay)
}
function docDarkInk() {
  const colors = new Set(), fonts = new Set();
  if (doc && docDark()) {
    for (const el of docsText.querySelectorAll('[style*="color"]')) if (el.style.color) colors.add(el.style.color);
    for (const el of docsText.querySelectorAll("font[color]")) fonts.add(el.getAttribute("color"));
  }
  const dark = [...colors].filter(docInkDark), darkFonts = [...fonts].filter(docInkDark);
  const sig = dark.join("|") + "#" + darkFonts.join("|");
  if (sig === docInkSig) return;
  docInkSig = sig;
  const q = (v) => JSON.stringify(v);
  const sel = [
    ...dark.flatMap((c) => [`[style^=${q("color: " + c)}]`, `[style*=${q(" color: " + c)}]`]),
    ...darkFonts.map((c) => `font[color=${q(c)}]`),
  ].map((x) => `.doc-page[data-dark="1"] .doc-text ${x}`);
  docInkStyle.textContent = sel.length ? sel.join(",\n") + " { color: var(--ink) !important; }" : "";
}
function drawDarkButton() {
  const on = docDark(), b = $("docDarkButton");
  b.innerHTML = docIcon(on ? "sun" : "moon");
  b.title = on ? "Light page (white)" : "Dark page (black)";
  b.classList.toggle("on", on);
}
$("docDarkButton").addEventListener("mousedown", (e) => e.preventDefault());
$("docDarkButton").addEventListener("click", () => docSetDark(!docDark()));
drawDarkButton();

// ---------------------------------------------------------------- the writing guide (next to the page)

function drawGuide() {
  const t = docTypeOf(doc), g = t.guide;
  docsText.dataset.hint = t.hint || "";
  docsText.style.setProperty("--hint", JSON.stringify(t.hint || ""));
  docEmptyCheck();
  $("docGuide").hidden = !g || loadPref("docGuideOff:" + t.key) === "1" || !$("docNotes").hidden;
  if (!g) return;
  $("docGuideTitle").textContent = g.title;
  $("docGuideIntro").textContent = g.intro;
  $("docGuideSteps").replaceChildren(...g.steps.map(([name, text], i) => {
    const li = document.createElement("li");
    li.innerHTML = `<i>${i + 1}</i><span><b></b><small></small></span>`;
    li.querySelector("b").textContent = name;
    li.querySelector("small").textContent = text;
    return li;
  }));
  $("docGuideTip").textContent = g.tip || "";
  $("docGuideTip").hidden = !g.tip;
  $("docGuideTables").replaceChildren(...(g.tables || []).map(([label, cols, rows]) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "outline-button" });
    b.innerHTML = docIcon("table") + "<span></span>";
    b.querySelector("span").textContent = label;
    b.addEventListener("click", () => docGuideTable(cols, rows));
    return b;
  }));
}

function docShowGuide(on) {
  if (!doc) return;
  if (on && !$("docNotes").hidden) { $("docNotes").hidden = true; docNotesDraft = null; drawNotesButton(); }
  savePref("docGuideOff:" + docTypeOf(doc).key, on ? "0" : "1");
  drawGuide();
  docFit();
}
$("docGuideClose").addEventListener("click", () => docShowGuide(false));

// An empty table with just the column names (the rest is up to you).
function docGuideTable(cols, rows) {
  if (!doc || docBlockHeld()) return;
  if (!docsText.contains(document.getSelection().anchorNode)) docPutCaret(docsText.lastElementChild, "end");
  const head = "<tr>" + cols.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr>";
  const row = "<tr>" + "<td><br></td>".repeat(cols.length) + "</tr>";
  const block = docCaretBlock();
  const empty = block && block.tagName === "P" && !block.textContent.trim() && !block.querySelector("img");
  docInsertBlockAfter(`<table class="doc-table"><tbody>${head}${row.repeat(rows)}</tbody></table>`);
  if (empty) { block.remove(); docUndoCommit(); } // the table takes the empty line's place
  const table = docCaretBlock() && docCaretBlock().previousElementSibling;
  if (table && table.tagName === "TABLE") docPutCaret(table.querySelector("td"), 0);
  docEmptyCheck();
}

// A faint "how to start" line on an empty page (it's not text, it's never saved).
function docEmptyCheck() {
  const first = docsText.firstElementChild;
  const empty = !!doc && docsText.children.length === 1 && first.tagName === "P" && !first.textContent && !first.querySelector("img");
  docsText.classList.toggle("is-empty", empty && !!docsText.dataset.hint);
}

// Closes the document as it is: what wasn't saved is gone (ask first with docLeave()).
async function closeDoc(quiet) {
  if (!doc) return;
  const was = doc;
  clearTimeout(docSyncTimer);
  docPending.clear(); docDeleted.clear(); docTitleDirty = false; docSettingsDirty = false; docDirty = false;
  document.body.classList.remove("doc-focus");
  if (was.where === "collab") api("/api/docs-close", { id: was.id }).catch(() => null);
  doc = null;
  docNotesCloseDoc();
  docHidePops();
  $("docFind").hidden = true;
  docClearFind();
  document.body.classList.remove("doc-open");
  docsText.replaceChildren();
  if (quiet) return;
  $("docEditor").hidden = true;
  $("docsHome").hidden = false;
  docsWhere = was.where;
  drawDocsHome();
  loadDocsList();
}
$("docBack").addEventListener("click", async () => { if (await docLeave()) closeDoc(); });

// Before leaving the document: changes that weren't saved? Ask. Says if it's OK to go.
async function docLeave() {
  if (!doc) return true;
  const d = doc;
  if (docSaving) await docSaving;
  while (docSyncBusy && doc === d) await docSyncRunning;
  if (doc !== d) return true;
  if (d.where === "collab" && docDirty) return docSave(); // live: whatever is left goes out, nothing to ask
  if (!docDirty) {
    if (d.fresh) await docForgetFresh(d);
    return true;
  }
  const answer = await docAsk(`Save "${$("docTitle").value || "Untitled document"}"?`,
    d.fresh ? "You haven't saved this new document yet. If you don't save it, it's gone."
      : "You have changes that aren't saved. If you don't save them, they're gone.",
    "Save", { other: "Don't save" });
  if (doc !== d) return true;
  if (!answer) return false;
  if (answer === "other") {
    if (d.fresh) await docForgetFresh(d);
    return true;
  }
  return docSave();
}

// A new document that was never saved isn't kept.
async function docForgetFresh(d) {
  await api("/api/docs-delete", { id: d.id, where: d.where }).catch(() => null);
}

// ---------------------------------------------------------------- keeping the blocks in order

// After every change: every top-level element is a block with its own id and position, loose text
// goes into a paragraph, and no two blocks share an id (the browser copies them when you press Enter).
function docNormalize() {
  const seen = new Set();
  let prev = null;
  let node = docsText.firstChild;
  while (node) {
    let next = node.nextSibling;
    if (node.nodeType === 3 && !node.data.trim()) { node.remove(); node = next; continue; }
    if (node.nodeType !== 1 || !DOC_TOP.has(node.tagName)) {
      if (node.nodeType === 1 && node.tagName === "DIV") {
        // A div from the browser: make it a paragraph (keeping what's in it).
        const para = document.createElement("p");
        para.className = node.className;
        para.setAttribute("style", node.getAttribute("style") || "");
        if (!para.getAttribute("style")) para.removeAttribute("style");
        para.append(...node.childNodes);
        if (node.dataset.id) { para.dataset.id = node.dataset.id; para.dataset.pos = node.dataset.pos; }
        node.replaceWith(para);
        node = para;
      } else if (node.nodeType === 1 && /^(H4|H5|H6)$/.test(node.tagName)) {
        const h = document.createElement("h3");
        h.append(...node.childNodes);
        node.replaceWith(h);
        node = h;
      } else {
        // Loose text or a lone bold word: wrap it, with whatever loose bits follow it.
        const para = document.createElement("p");
        node.before(para);
        while (node && (node.nodeType !== 1 || (!DOC_TOP.has(node.tagName) && node.tagName !== "DIV"))) {
          next = node.nextSibling;
          para.append(node);
          node = next;
        }
        node = para;
        next = para.nextSibling;
      }
    }
    const el = node;
    if (!el.dataset.id || seen.has(el.dataset.id)) {
      el.dataset.id = docNewId();
      delete el.dataset.pos;
    }
    seen.add(el.dataset.id);
    // Its position has to come after the one before it (and before the one after it, if it can).
    if (!el.dataset.pos || (prev && blockKey(el) <= blockKey(prev))) {
      let after = el.nextElementSibling;
      while (after && !after.dataset.pos) after = after.nextElementSibling;
      const low = prev ? prev.dataset.pos : "";
      const high = after && after.dataset.pos > low ? after.dataset.pos : null;
      el.dataset.pos = posBetween(low, high);
      docMarkChanged(el.dataset.id);
    }
    if (doc && doc.kind === "script" && el.tagName === "P" && !SCRIPT_KINDS.some((k) => el.classList.contains("sp-" + k))
        && !["sp-title", "sp-contact"].some((k) => el.classList.contains(k))) {
      el.classList.add("sp-action");
      docMarkChanged(el.dataset.id);
    }
    prev = el;
    node = next;
  }
  // Many lines added in one spot make positions long: then number them all again.
  if ([...docsText.children].some((el) => el.dataset.pos.length > 300)) {
    let pos = "";
    for (const el of docsText.children) {
      pos = posBetween(pos, null);
      el.dataset.pos = pos;
      docMarkChanged(el.dataset.id);
    }
  }
  if (!docsText.firstElementChild) {
    const para = document.createElement("p");
    if (doc && doc.kind === "script") para.className = "sp-action";
    para.append(document.createElement("br"));
    para.dataset.id = docNewId();
    para.dataset.pos = posBetween("", null);
    docsText.append(para);
    docMarkChanged(para.dataset.id);
  }
}

function docMarkChanged(id) {
  docPending.add(id);
  docDeleted.delete(id);
  docUndoDirty.add(id);
}

// The top-level block a node is in.
function docBlockOf(node) {
  while (node && node.parentNode !== docsText) node = node.parentNode;
  return node && node.nodeType === 1 ? node : null;
}

const docObserver = new MutationObserver((records) => {
  if (!doc || docApplying) return;
  const gone = [];
  // (the editing box's own look changing isn't a change to the document)
  if (records.every((r) => r.target === docsText && r.type === "attributes")) return;
  for (const r of records) {
    if (r.target === docsText) {
      for (const n of r.removedNodes) if (n.nodeType === 1 && n.dataset && n.dataset.id) gone.push(n.dataset.id);
      for (const n of r.addedNodes) if (n.nodeType === 1 && n.dataset && n.dataset.id) docMarkChanged(n.dataset.id);
      continue;
    }
    const block = docBlockOf(r.target);
    if (block && block.dataset.id) docMarkChanged(block.dataset.id);
  }
  docNormalize();
  docObserver.takeRecords(); // (what docNormalize just did)
  for (const id of gone) {
    if (!docsText.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`)) {
      docPending.delete(id);
      docDeleted.add(id);
      docUndoDirty.add(id);
    }
  }
  docChanged();
});
docObserver.observe(docsText, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "href", "src", "colspan", "rowspan"] });

function docChanged() {
  docUndoSoon();
  docCountSoon();
  docMarkDirty();
  if (doc.where === "collab") docSyncSoon(300); // Collab docs are live: what you write goes to the others right away
}

function docMarkDirty() {
  if (!doc) return;
  if (!docDirty) { docDirty = true; docSaveState(); }
  if (doc.where === "collab") docSyncSoon(300); // (the title and page setup are live too)
}

// ---------------------------------------------------------------- saving (only when you press Save)

let docSaving = null; // the local save on its way
async function docSave() {
  if (!doc) return false;
  const d = doc;
  docUndoCommit();
  let ok;
  if (d.where === "local") {
    if (docSaving) await docSaving;
    if (doc !== d) return false;
    docSaving = docSaveLocalOnce();
    try { ok = await docSaving; } finally { docSaving = null; }
  } else {
    while (docSyncBusy && doc === d) await docSyncRunning;
    if (doc !== d) return false;
    clearTimeout(docSyncTimer);
    docSaveWanted = true;
    docSyncRunning = docSyncOnce();
    ok = await docSyncRunning;
  }
  if (ok && doc === d) {
    d.fresh = false;
    const b = $("docSave");
    b.classList.remove("saved-pop"); void b.offsetWidth; b.classList.add("saved-pop");
  }
  return !!ok && doc === d;
}

async function docSaveLocalOnce() {
  const d = doc;
  const blocks = [...docsText.children].map((el) => ({ id: el.dataset.id, pos: el.dataset.pos, html: blockHtml(el) }));
  for (const [id, b] of docStore) blocks.push({ id, pos: b.pos, html: b.html }); // the other pages
  const title = $("docTitle").value;
  docPending.clear(); docDeleted.clear(); docTitleDirty = false; docSettingsDirty = false; docDirty = false;
  docSaveState("Saving...");
  const res = await api("/api/docs-save", { id: d.id, title, blocks, settings: d.settings }).catch(() => null);
  if (doc !== d) return false;
  if (res && res.ok) { d.title = title; docSaveState(); return true; }
  docDirty = true; docTitleDirty = true; docSettingsDirty = true;
  docSaveState((res && res.error) || "Couldn't save. Try again.", true);
  return false;
}

// The app is closing: nothing is saved (only Save saves), but the others should see you left.
window.addEventListener("pagehide", () => {
  if (!doc) return;
  const send = (path, data) => navigator.sendBeacon(path, new Blob([JSON.stringify(data)], { type: "application/json" }));
  if (doc.where === "collab") send("/api/docs-close", { id: doc.id });
  if (doc.fresh) send("/api/docs-delete", { id: doc.id, where: doc.where }); // a new document that was never saved
});

// The little line under the title, and the Save button.
function docSaveState(text, bad) {
  if (!doc) return;
  const b = $("docSave");
  b.classList.toggle("dirty", docDirty);
  b.hidden = doc.where === "collab"; // Collab docs save as you write (everyone sees it live)
  b.title = docDirty ? "Save your changes (Ctrl+S)" : "Everything is saved";
  b.querySelector("span").textContent = docDirty ? "Save" : "Saved";
  $("docSaved").textContent = text || (doc.where === "collab" ? (docDirty ? "Saving..." : "Live: everyone sees changes right away")
    : docDirty ? (doc.fresh ? "Not saved yet" : "Unsaved changes") : "Saved on this computer");
  $("docSaved").classList.toggle("bad", !!bad);
  $("docSaved").classList.toggle("dirty", docDirty && !bad && doc.where !== "collab");
}
function docSetSaved(text, bad) { docSaveState(text, bad); }
$("docSave").addEventListener("click", () => docSave());

// ---------------------------------------------------------------- live together (collab)

let docSyncAt = 0;
function docSyncSoon(ms) {
  if (!doc || doc.where !== "collab") return;
  // Keep a sooner one (typing non-stop mustn't keep pushing the sending back).
  if (docSyncTimer && docSyncAt > Date.now() && docSyncAt <= Date.now() + ms) return;
  clearTimeout(docSyncTimer);
  docSyncAt = Date.now() + ms;
  docSyncTimer = setTimeout(() => { docSyncTimer = 0; docSync(); }, ms);
}

function docCaretBlock() {
  const sel = getSelection();
  if (!sel.rangeCount || !docsText.contains(sel.anchorNode)) return null;
  return docBlockOf(sel.anchorNode);
}

let docSyncRunning = null; // the sync on its way (a promise)
function docSync() {
  clearTimeout(docSyncTimer);
  if (!doc || doc.where !== "collab") return Promise.resolve();
  if (docSyncBusy) { docSyncAgain = true; return docSyncRunning; }
  docSyncRunning = docSyncOnce();
  return docSyncRunning;
}

// A document that's gone (deleted, you were taken out, or logged out): what wasn't sent can't be any more.
function docGone(text) {
  docToast(text);
  closeDoc();
}

async function docSyncOnce() {
  docSyncBusy = true;
  const d = doc;
  const asked = docSaveWanted; // Save (Ctrl+S) or leaving; otherwise changes go out on their own
  docSaveWanted = false;
  const send = asked || docPending.size > 0 || docDeleted.size > 0 || docTitleDirty || docSettingsDirty;
  const changes = [];
  if (send) for (const id of docPending) {
    const el = docsText.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`);
    const kept = el ? null : docStore.get(id); // (on another page)
    if (!el && !kept) continue;
    const html = el ? blockHtml(el) : kept.html;
    changes.push({ id, pos: el ? el.dataset.pos : kept.pos, html });
    docInFlight.set(id, html);
  }
  if (send) for (const id of docDeleted) changes.push({ id, pos: "0", html: "", deleted: true });
  const sentPending = send ? new Set(docPending) : new Set(), sentDeleted = send ? new Set(docDeleted) : new Set();
  const title = send && docTitleDirty ? $("docTitle").value : null;
  const settings = send && docSettingsDirty ? d.settings : null;
  if (send) {
    docPending.clear(); docDeleted.clear(); docTitleDirty = false; docSettingsDirty = false; docDirty = false;
    if (asked) docSaveState("Saving...");
  }
  const caret = docCaretBlock();
  const typing = Date.now() - docLastTyped < 3000 && docTypedBlock && caret && caret.dataset.id === docTypedBlock;
  const res = await api("/api/docs-sync", { id: d.id, since: d.rev, changes, title, block: caret ? caret.dataset.id : null, typing, settings })
    .catch(() => null);
  docSyncBusy = false;
  docInFlight.clear();
  if (doc !== d) return;
  if (!res || !res.ok) {
    if (res && res.loggedOut) return docGone(res.error);
    if (res && res.error && /isn't there any more|not in it/.test(res.error)) return docGone(res.error);
    docFailed++;
    docSyncSoon(Math.min(10000, 1000 * 2 ** Math.min(docFailed, 3)));
    if (!send) { if (!docDirty) docSaveState("Offline. Trying again...", true); return false; }
    // Not saved: keep the changes for the next Save.
    for (const id of sentPending) if (!docDeleted.has(id)) docPending.add(id);
    for (const id of sentDeleted) if (!docPending.has(id)) docDeleted.add(id);
    if (title !== null) docTitleDirty = true;
    if (settings !== null) docSettingsDirty = true;
    docDirty = true;
    docSaveState(res && res.error ? res.error : "Couldn't save: you seem to be offline. Try again in a moment.", true);
    return false;
  }
  docFailed = 0;
  if (send && changes.length) d.fresh = false; // something was written: it's a real document now
  docApplyRemote(res.blocks || []);
  d.rev = Math.max(d.rev, res.rev || 0);
  if (send && title !== null) d.title = title;
  if (res.title && res.title !== d.title) {
    d.title = res.title;
    if (document.activeElement !== $("docTitle") && !docTitleDirty) $("docTitle").value = res.title;
  }
  if (res.settings && !docSettingsDirty && JSON.stringify(docCleanSettings(res.settings)) !== JSON.stringify(d.settings)) {
    d.settings = docCleanSettings(res.settings);
    docApplySettings();
  }
  if (res.people) {
    const before = JSON.stringify(d.people.map((x) => [x.username, x.joined]));
    d.people = res.people;
    if (JSON.stringify(d.people.map((x) => [x.username, x.joined])) !== before) { drawShare(); if (!$("docInviteModal").hidden) drawInvitePeople(); }
  }
  docHere = res.here || [];
  drawHere();
  if (send || $("docSaved").classList.contains("bad")) docSaveState();
  if (docSyncAgain) {
    docSyncAgain = false;
    docSyncSoon(150);
  } else {
    // About every second while someone else is in it, a bit slower when you're alone.
    docSyncSoon(document.hidden ? 8000 : $("docsTab").hidden ? 5000 : docHere.some((h) => h.typing) ? 500 : docHere.length ? 800 : 2000);
  }
  return true;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && doc) docSyncSoon(50); });

// Other people's changes. Blocks you changed and haven't sent yet stay yours.
function docApplyRemote(blocks) {
  if (!blocks.length) return;
  const caret = docSaveCaret();
  docApplying = true;
  let touched = false, pages = false;
  for (const b of blocks) {
    if (docPending.has(b.id) || docDeleted.has(b.id)) continue;
    if (docTabOf(b.id) !== docTab) { // a page's name, or what's on another page
      if (b.deleted) docStore.delete(b.id); else docStore.set(b.id, { pos: b.pos, html: b.html });
      if (docTabOf(b.id) === null) pages = true;
      continue;
    }
    const el = docsText.querySelector(`:scope > [data-id="${CSS.escape(b.id)}"]`);
    if (b.deleted) {
      if (el) { el.remove(); touched = true; }
      docUndoRemote(b.id, null);
      continue;
    }
    if (el && el.dataset.pos === b.pos && blockHtml(el) === blockHtml(blockFromHtml(b))) continue; // the same (often your own change coming back)
    const fresh = blockFromHtml(b);
    if (el) el.remove();
    docPlace(fresh);
    docUndoRemote(b.id, { pos: b.pos, html: blockHtml(fresh) });
    touched = true;
  }
  if (touched) {
    docNormalize();
    docObserver.takeRecords();
    docRestoreCaret(caret);
    drawHereMarks();
    docCountSoon();
  }
  docObserver.takeRecords();
  docApplying = false;
  if (pages) {
    if (docTab && !docStore.has("t~" + docTab)) docShowTab(""); // the page you were on was deleted
    drawTabs();
  }
}

// Puts a block where its position says.
function docPlace(el) {
  const key = blockKey(el);
  for (const child of docsText.children) {
    if (blockKey(child) > key) { child.before(el); return; }
  }
  docsText.append(el);
}

// The caret as (block id, characters from the block's start), so it survives the page changing.
function docSaveCaret() {
  const sel = getSelection();
  if (!sel.rangeCount || !docsText.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const at = (node, offset) => {
    const block = docBlockOf(node);
    if (!block) return null;
    const r = document.createRange();
    r.setStart(block, 0);
    try { r.setEnd(node, offset); } catch (e) { return null; }
    return { id: block.dataset.id, n: r.toString().length };
  };
  return { start: at(range.startContainer, range.startOffset), end: at(range.endContainer, range.endOffset) };
}

function docPointAt(id, n) {
  const block = docsText.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`);
  if (!block) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let left = n, last = null;
  while (walker.nextNode()) {
    last = walker.currentNode;
    if (left <= last.data.length) return [last, left];
    left -= last.data.length;
  }
  return last ? [last, last.data.length] : [block, 0];
}

function docRestoreCaret(saved) {
  if (!saved || !saved.start) return;
  const a = docPointAt(saved.start.id, saved.start.n);
  const b = saved.end ? docPointAt(saved.end.id, saved.end.n) : a;
  if (!a) return;
  const range = document.createRange();
  range.setStart(a[0], a[1]);
  if (b) range.setEnd(b[0], b[1]);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function docPutCaret(el, offset) {
  const range = document.createRange();
  if (offset === "end") { range.selectNodeContents(el); range.collapse(false); }
  else {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (first) range.setStart(first, Math.min(offset, first.data.length)); else range.setStart(el, 0);
    range.collapse(true);
  }
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Who else is in the document: faces at the top, and a colored edge on the block they're in.
function drawHere() {
  if (!doc) return;
  const box = $("docHere");
  const faces = docHere.map((h) => {
    const face = docAvatar(h);
    face.classList.add("here");
    face.title = h.username + (h.typing ? " is writing" : " is here");
    return face;
  });
  setChildren(box, faces);
  box.hidden = !faces.length;
  drawHereMarks();
}

function drawHereMarks() {
  docApplying = true;
  for (const el of docsText.querySelectorAll(":scope > .doc-other")) {
    el.classList.remove("doc-other", "doc-held");
    el.removeAttribute("data-who");
    el.style.removeProperty("--who");
    if (el.getAttribute("contenteditable") === "false") el.removeAttribute("contenteditable");
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  }
  const mine = docCaretBlock();
  for (const h of docHere) {
    if (!h.block) continue;
    const el = docsText.querySelector(`:scope > [data-id="${CSS.escape(h.block)}"]`);
    if (!el) continue;
    el.classList.add("doc-other");
    el.dataset.who = el.dataset.who ? el.dataset.who + ", " + h.username : h.username;
    el.style.setProperty("--who", docColor(h.username));
    // Someone's writing here right now: it's theirs for a moment. Never the line your cursor is on
    // (that would throw your cursor somewhere else; their words still come in live).
    if (h.typing && mine !== el) {
      el.classList.add("doc-held");
      el.setAttribute("contenteditable", "false");
    }
  }
  docObserver.takeRecords();
  docApplying = false;
}

// ---------------------------------------------------------------- undo and redo

// The app keeps its own undo list (the browser's gets confused when other people's changes come in):
// after each pause in typing, a picture of every block. Other people's changes are put into every
// picture, so undo only takes back your own.
let docUndo = [];       // [{blocks: Map(id -> {pos, html}), caret}]
let docUndoAt = 0;
const docUndoDirty = new Set();
let docUndoTimer = 0;

function docState() {
  const blocks = new Map();
  for (const el of docsText.children) blocks.set(el.dataset.id, { pos: el.dataset.pos, html: blockHtml(el) });
  return blocks;
}

function docUndoReset() {
  clearTimeout(docUndoTimer);
  docUndoDirty.clear();
  docUndo = [{ blocks: docState(), caret: null }];
  docUndoAt = 0;
  docUndoButtons();
}

function docUndoSoon() {
  clearTimeout(docUndoTimer);
  docUndoTimer = setTimeout(docUndoCommit, 650);
}

function docUndoCommit() {
  clearTimeout(docUndoTimer);
  if (!doc || !docUndoDirty.size) return;
  const before = docUndo[docUndoAt].blocks;
  const blocks = new Map(before);
  let changed = false;
  for (const id of docUndoDirty) {
    const el = docsText.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`);
    if (el) {
      const now = { pos: el.dataset.pos, html: blockHtml(el) };
      const was = before.get(id);
      if (!was || was.pos !== now.pos || was.html !== now.html) { blocks.set(id, now); changed = true; }
    } else if (blocks.has(id)) {
      blocks.delete(id);
      changed = true;
    }
  }
  docUndoDirty.clear();
  if (!changed) return;
  docUndo = docUndo.slice(0, docUndoAt + 1);
  docUndo.push({ blocks, caret: docSaveCaret() });
  if (docUndo.length > 300) docUndo.shift();
  docUndoAt = docUndo.length - 1;
  docUndoButtons();
}

function docUndoRemote(id, block) {
  for (const step of docUndo) {
    if (block) step.blocks.set(id, block); else step.blocks.delete(id);
  }
}

function docUndoGo(step) {
  if (!doc) return;
  docUndoCommit();
  const to = docUndoAt + step;
  if (to < 0 || to >= docUndo.length) return;
  const target = docUndo[to].blocks;
  const caret = step < 0 ? docUndo[docUndoAt].caret : docUndo[to].caret;
  docUndoAt = to;
  docApplying = true;
  const now = new Map([...docsText.children].map((el) => [el.dataset.id, el]));
  for (const [id, el] of now) {
    if (!target.has(id)) { el.remove(); docPending.delete(id); docDeleted.add(id); }
  }
  for (const [id, b] of target) {
    const el = now.get(id);
    if (el && el.dataset.pos === b.pos && blockHtml(el) === b.html) continue;
    if (el) el.remove();
    docPlace(blockFromHtml({ id, pos: b.pos, html: b.html }));
    docPending.add(id);
    docDeleted.delete(id);
  }
  docNormalize();
  docObserver.takeRecords();
  docApplying = false;
  docUndoDirty.clear();
  if (caret) docRestoreCaret(caret);
  else docsText.focus();
  docUndoButtons();
  drawHereMarks();
  docChanged();
  clearTimeout(docUndoTimer);
}

function docUndoButtons() {
  const undo = $("docToolbar").querySelector('[data-cmd="undo"]'), redo = $("docToolbar").querySelector('[data-cmd="redo"]');
  if (undo) undo.disabled = docUndoAt <= 0 && !docUndoDirty.size;
  if (redo) redo.disabled = docUndoAt >= docUndo.length - 1;
}

// ---------------------------------------------------------------- the toolbar

const DOC_STYLES_LIST = [
  ["p", "Normal text"], ["title", "Title"], ["subtitle", "Subtitle"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["blockquote", "Quote"],
];
const SCRIPT_NAMES = {
  scene: "Scene heading", action: "Action", character: "Character", paren: "Parenthetical", dialogue: "Dialogue",
  transition: "Transition", shot: "Shot", centered: "Centered",
};
const SCRIPT_KEYS = { scene: "1", action: "2", character: "3", paren: "4", dialogue: "5", transition: "6", shot: "7", centered: "8" };
const DOC_PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#cccccc", "#ffffff",
  "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa",
  "#ffcdd2", "#ffe0b2", "#fff9c4", "#c8e6c9", "#bbdefb", "#e1bee7",
  "#b71c1c", "#e65100", "#f9a825", "#1b5e20", "#0d47a1", "#4a148c",
];

function tb(cmd, icon, title, extra = "") {
  return `<button type="button" class="doc-tool" data-cmd="${cmd}" title="${esc(title)}" ${extra}>${docIcon(icon)}</button>`;
}

function buildToolbar() {
  const script = doc.kind === "script";
  const sep = '<span class="doc-sep"></span>';
  const parts = [tb("undo", "undo", "Undo (Ctrl+Z)"), tb("redo", "redo", "Redo (Ctrl+Y)"), tb("print", "print", "Print or save as PDF (Ctrl+P)"), sep];
  if (script) {
    parts.push(`<button type="button" class="doc-select doc-element" data-pop="element" title="What this line is (Tab changes it)"><span>Action</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 10l5 5 5-5"/></svg></button>`,
      `<button type="button" class="doc-select doc-font" data-pop="font" title="Font"><span>Courier Prime</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 10l5 5 5-5"/></svg></button>`, sep,
      tb("bold", "bold", "Bold (Ctrl+B)"), tb("italic", "italic", "Italic (Ctrl+I)"), tb("underline", "underline", "Underline (Ctrl+U)"), sep,
      tb("pagebreak", "pagebreak", "Page break (Ctrl+Enter)"), tb("numbers-scene", "numbersScene", "Scene numbers"), sep,
      tb("find", "find", "Find and replace (Ctrl+F)"), tb("outline", "outline", "Scenes"));
  } else {
    parts.push(`<button type="button" class="doc-select doc-style" data-pop="style" title="Text style"><span>Normal text</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 10l5 5 5-5"/></svg></button>`,
      `<button type="button" class="doc-select doc-font" data-pop="font" title="Font"><span>Inter</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 10l5 5 5-5"/></svg></button>`, sep,
      tb("smaller", "minus", "Smaller text"), `<input class="doc-size" id="docSize" value="11" title="Text size" inputmode="numeric" maxlength="3">`, tb("bigger", "plus", "Bigger text"), sep,
      tb("bold", "bold", "Bold (Ctrl+B)"), tb("italic", "italic", "Italic (Ctrl+I)"), tb("underline", "underline", "Underline (Ctrl+U)"), tb("strikeThrough", "strike", "Strikethrough"),
      `<button type="button" class="doc-tool doc-color" data-pop="color" title="Text color">${docIcon("color")}<i></i></button>`,
      `<button type="button" class="doc-tool doc-color hl" data-pop="highlight" title="Highlight">${docIcon("highlight")}<i></i></button>`, sep,
      tb("link", "link", "Link (Ctrl+K)"), tb("image", "image", "Picture"), `<button type="button" class="doc-tool" data-pop="table" title="Table">${docIcon("table")}</button>`, sep,
      `<button type="button" class="doc-tool doc-align" data-pop="align" title="Line up the text">${docIcon("left")}</button>`,
      `<button type="button" class="doc-tool" data-pop="spacing" title="Line spacing">${docIcon("spacing")}</button>`, sep,
      tb("checklist", "checklist", "Checklist"), tb("insertUnorderedList", "bullets", "Bullets"), tb("insertOrderedList", "numbers", "Numbered list"),
      tb("outdent", "outdent", "Less indent"), tb("indent", "indent", "More indent"), sep,
      tb("removeFormat", "clear", "Clear formatting (Ctrl+\\)"), tb("pagebreak", "pagebreak", "Page break (Ctrl+Enter)"), tb("find", "find", "Find and replace (Ctrl+F)"), tb("outline", "outline", "Outline"));
  }
  $("docToolbar").innerHTML = parts.join("");
  $("docToolbar").querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault())); // keep the selection
  $("docToolbar").querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => docCommand(b.dataset.cmd)));
  $("docToolbar").querySelectorAll("[data-pop]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); docOpenPop(b.dataset.pop, b); }));
  const size = $("docSize");
  if (size) {
    size.addEventListener("mousedown", () => { docKeepRange = docRange(); });
    size.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); docSetSize(parseFloat(size.value)); docsText.focus(); }
      if (e.key === "Escape") docsText.focus();
    });
  }
  docUndoButtons();
  docToolState();
}

let docKeepRange = null; // the selection while a menu or the size box has the focus
function docRange() {
  const sel = getSelection();
  return sel.rangeCount && docsText.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
}
function docBackToRange() {
  if (docKeepRange) {
    docsText.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(docKeepRange);
  }
  docKeepRange = null;
}

function docExec(cmd, value = null) {
  docUndoCommit();
  document.execCommand("styleWithCSS", false, true);
  document.execCommand(cmd, false, value);
  docUndoCommit();
  docToolState();
}

function docCommand(cmd) {
  if (!doc) return;
  if (cmd === "undo") return docUndoGo(-1);
  if (cmd === "redo") return docUndoGo(1);
  if (cmd === "print") return docPrint();
  if (cmd === "find") return docOpenFind();
  if (cmd === "outline") {
    $("docOutline").hidden = !$("docOutline").hidden;
    savePref(doc.kind === "script" ? "docOutlineScript" : "docOutlineDoc", $("docOutline").hidden ? "0" : "1");
    docFit();
    return drawOutline();
  }
  if (cmd === "numbers-scene") {
    const on = !docsText.classList.contains("numbers");
    docsText.classList.toggle("numbers", on);
    savePref("docSceneNumbers", on ? "1" : "0");
    return docToolState();
  }
  if (!docsText.contains(getSelection().anchorNode)) docsText.focus();
  if (docBlockHeld()) return;
  if (cmd === "link") return docLink();
  if (cmd === "image") return $("docImageFile").click();
  if (cmd === "pagebreak") return docInsertBlockAfter('<hr class="page-break">');
  if (cmd === "checklist") return docChecklist();
  if (cmd === "smaller" || cmd === "bigger") return docSetSize(docNextSize(cmd === "bigger"));
  if (cmd === "removeFormat") { docExec("removeFormat"); return docExec("unlink"); }
  docExec(cmd);
}

// You can't change a block someone else is writing in right now (key: the key about to be pressed,
// to also catch Backspace at the start of the block after theirs, and Delete at the end of the one before).
function docBlockHeld(key) {
  const sel = getSelection();
  if (!sel.rangeCount || !docsText.contains(sel.anchorNode)) return false;
  const range = sel.getRangeAt(0);
  let held = [...docsText.querySelectorAll(":scope > .doc-held")].find((el) => range.intersectsNode(el));
  if (!held && range.collapsed && (key === "Backspace" || key === "Delete")) {
    const block = docBlockOf(range.startContainer);
    const r = document.createRange();
    r.selectNodeContents(block);
    if (key === "Backspace") r.setEnd(range.startContainer, range.startOffset); else r.setStart(range.startContainer, range.startOffset);
    const neighbor = key === "Backspace" ? block.previousElementSibling : block.nextElementSibling;
    if (!r.toString() && neighbor && neighbor.classList.contains("doc-held")) held = neighbor;
  }
  if (held) {
    docToast(`${held.dataset.who} is writing there right now.`);
    return true;
  }
  return false;
}

// Which buttons are "on" for where the caret is.
function docToolState() {
  if (!doc) return;
  const sel = getSelection();
  const inside = sel.rangeCount && docsText.contains(sel.anchorNode);
  const q = (cmd) => { try { return inside && document.queryCommandState(cmd); } catch (e) { return false; } };
  const align = $("docToolbar").querySelector(".doc-align");
  if (align) {
    const now = [["justifyCenter", "center"], ["justifyRight", "right"], ["justifyFull", "justify"]].find(([c]) => q(c));
    const icon = now ? now[1] : "left";
    if (align.dataset.icon !== icon) { align.dataset.icon = icon; align.innerHTML = docIcon(icon); }
  }
  for (const cmd of ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"]) {
    const b = $("docToolbar").querySelector(`[data-cmd="${cmd}"]`);
    if (b) b.classList.toggle("on", !!q(cmd));
  }
  const block = inside ? docBlockOf(sel.anchorNode) : null;
  const check = $("docToolbar").querySelector('[data-cmd="checklist"]');
  if (check) check.classList.toggle("on", !!(block && block.classList.contains("checklist")));
  const listBtn = $("docToolbar").querySelector('[data-cmd="insertUnorderedList"]');
  if (listBtn && block && block.classList.contains("checklist")) listBtn.classList.remove("on");
  const outline = $("docToolbar").querySelector('[data-cmd="outline"]');
  if (outline) outline.classList.toggle("on", !$("docOutline").hidden);
  const numbers = $("docToolbar").querySelector('[data-cmd="numbers-scene"]');
  if (numbers) numbers.classList.toggle("on", docsText.classList.contains("numbers"));
  const font = $("docToolbar").querySelector(".doc-font span");
  if (font) {
    const node = inside ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode) : docsText;
    const fam = getComputedStyle(node).fontFamily.split(",")[0].replace(/["']/g, "").trim();
    font.textContent = fam === "InterVar" ? "Inter" : fam;
    font.style.fontFamily = docFontCss(font.textContent);
  }
  if (doc.kind === "script") {
    const kind = block ? docScriptKind(block) : "action";
    $("docToolbar").querySelector(".doc-element span").textContent = SCRIPT_NAMES[kind] || "Title page";
    docHint(kind);
  } else {
    const style = $("docToolbar").querySelector(".doc-style span");
    if (style) {
      const tag = block ? block.tagName.toLowerCase() : "p";
      const key = block && block.classList.contains("doc-title") ? "title" : block && block.classList.contains("doc-subtitle") ? "subtitle" : tag;
      style.textContent = (DOC_STYLES_LIST.find((s) => s[0] === key) || [0, block && block.tagName === "TABLE" ? "Table" : block && /^(UL|OL)$/.test(block.tagName) ? "List" : "Normal text"])[1];
    }
    const node = inside ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode) : null;
    if (node) {
      const cs = getComputedStyle(node);
      if (document.activeElement !== $("docSize")) $("docSize").value = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
      $("docToolbar").querySelector(".doc-color i").style.background = cs.color;
    }
  }
}
document.addEventListener("selectionchange", () => {
  if (!doc) return;
  docToolState();
  docFloatTools();
  if (doc.kind === "script") docSuggestUpdate();
  docOutlineActive();
});

const DOC_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
function docNextSize(up) {
  const now = parseFloat($("docSize").value) || 11;
  return up ? DOC_SIZES.find((s) => s > now) || now + 12 : [...DOC_SIZES].reverse().find((s) => s < now) || Math.max(1, now - 1);
}

function docSetSize(pt) {
  if (!pt || pt < 1 || pt > 400) return;
  docBackToRange();
  docUndoCommit();
  document.execCommand("styleWithCSS", false, true);
  document.execCommand("fontSize", false, "7");
  for (const el of docsText.querySelectorAll('span[style*="xxx-large"], font[size="7"]')) {
    if (el.tagName === "FONT") {
      const span = document.createElement("span");
      span.append(...el.childNodes);
      el.replaceWith(span);
      span.style.fontSize = pt + "pt";
    } else {
      el.style.fontSize = pt + "pt";
    }
  }
  $("docSize").value = pt;
  docUndoCommit();
}

// ---------------------------------------------------------------- menus under the toolbar buttons

function docOpenPop(kind, button) {
  const pop = $("docPop");
  if (!pop.hidden && pop.dataset.kind === kind) return docHidePops();
  docKeepRange = docRange();
  pop.dataset.kind = kind;
  pop.className = "doc-pop pop-" + kind;
  pop.replaceChildren();
  const item = (label, fn, opts = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "doc-pop-item" + (opts.on ? " on" : "");
    if (opts.style) b.setAttribute("style", opts.style);
    if (opts.cls) b.classList.add(opts.cls);
    b.innerHTML = `<span></span>${opts.key ? `<kbd>${opts.key}</kbd>` : ""}${opts.more ? '<i class="doc-pop-more"></i>' : ""}`;
    b.querySelector("span").textContent = label;
    if (opts.icon) { b.insertAdjacentHTML("afterbegin", docIcon(opts.icon)); b.classList.add("with-icon"); }
    if (opts.disabled) b.disabled = true;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      docHidePops(); docBackToRange();
      if (opts.more) setTimeout(() => docOpenPop(opts.more, button)); else fn();
    });
    (opts.into || pop).append(b);
    return b;
  };
  const line = () => pop.append(Object.assign(document.createElement("div"), { className: "lib-menu-line" }));
  const head = (text) => pop.append(Object.assign(document.createElement("p"), { className: "doc-pop-head", textContent: text }));
  if (kind.startsWith("menu-")) {
    button.classList.add("open");
    for (const entry of docMenuItems(kind.slice(5))) {
      if (!entry) continue;
      if (entry === "-") { if (pop.lastChild && !pop.lastChild.classList.contains("lib-menu-line")) line(); continue; }
      item(entry.label, entry.fn, { icon: entry.icon || "blank", key: entry.key, on: entry.on, more: entry.more, cls: entry.danger ? "danger" : "", disabled: entry.disabled });
    }
    if (pop.lastChild && pop.lastChild.classList.contains("lib-menu-line")) pop.lastChild.remove();
  } else if (kind === "spacing") {
    head("Line spacing");
    const now = docSettings().line;
    for (const [v, label] of DOC_LINES) item(label, () => docSetSetting("line", v), { on: v === now });
  } else if (kind === "zoom") {
    const now = loadPref("docZoom") || "fit";
    item("Fit to window", () => docSetZoom("fit"), { on: now === "fit" });
    for (const z of DOC_ZOOMS) item(z + "%", () => docSetZoom(String(z)), { on: now === String(z) });
  } else if (kind === "paper") {
    head("Paper color");
    const now = docSettings().paper;
    for (const [key, label] of Object.entries(DOC_PAPERS)) {
      const b = item(label, () => docSetSetting("paper", key), { on: key === now });
      b.insertAdjacentHTML("afterbegin", `<i class="doc-paper-dot" data-paper="${key}"></i>`);
      b.classList.add("with-icon");
    }
  } else if (kind === "case") {
    item("UPPERCASE", () => docChangeCase("upper"));
    item("lowercase", () => docChangeCase("lower"));
    item("Title Case", () => docChangeCase("title"));
    item("Sentence case", () => docChangeCase("sentence"));
  } else if (kind === "special" || kind === "emoji") {
    const grid = document.createElement("div");
    grid.className = "doc-chars" + (kind === "emoji" ? " emoji" : "");
    for (const ch of kind === "emoji" ? DOC_EMOJI : DOC_SPECIAL) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = ch;
      b.title = ch;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => { docHidePops(); docBackToRange(); docInsertText(ch); });
      grid.append(b);
    }
    head(kind === "emoji" ? "Emoji" : "Special characters");
    pop.append(grid);
  } else if (kind === "style") {
    for (const [key, label] of DOC_STYLES_LIST) item(label, () => docSetStyle(key), { cls: "st-" + key });
  } else if (kind === "align") {
    const now = ["justifyLeft", "justifyCenter", "justifyRight", "justifyFull"].find((c) => { try { return document.queryCommandState(c); } catch (e) { return false; } });
    for (const [cmd, icon, label] of [["justifyLeft", "left", "Left"], ["justifyCenter", "center", "Center"], ["justifyRight", "right", "Right"], ["justifyFull", "justify", "Justify"]]) {
      const b = item(label, () => docExec(cmd), { on: cmd === now });
      b.insertAdjacentHTML("afterbegin", docIcon(icon));
      b.classList.add("with-icon");
    }
  } else if (kind === "font") {
    docFontPop(pop, item, head);
  } else if (kind === "element") {
    const block = docCaretBlock();
    const now = block ? docScriptKind(block) : "";
    for (const [key, label] of Object.entries(SCRIPT_NAMES)) item(label, () => docSetScriptKind(key), { on: key === now, key: "Ctrl+" + SCRIPT_KEYS[key] });
  } else if (kind === "color" || kind === "highlight") {
    const grid = document.createElement("div");
    grid.className = "doc-swatches";
    for (const c of DOC_PALETTE) {
      const s = document.createElement("button");
      s.type = "button";
      s.style.background = c;
      s.title = c;
      s.addEventListener("mousedown", (e) => e.preventDefault());
      s.addEventListener("click", () => {
        docHidePops(); docBackToRange();
        docExec(kind === "color" ? "foreColor" : "hiliteColor", c);
        $("docToolbar").querySelector(kind === "color" ? ".doc-color i" : ".doc-color.hl i").style.background = c;
      });
      grid.append(s);
    }
    pop.append(grid);
    item(kind === "color" ? "Automatic" : "No highlight", () => kind === "color" ? docExec("foreColor", "inherit") : docExec("hiliteColor", "transparent"));
  } else if (kind === "table") {
    const grid = document.createElement("div");
    grid.className = "doc-table-pick";
    const label = document.createElement("p");
    label.textContent = "Pick a size";
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener("mouseenter", () => {
        grid.querySelectorAll("button").forEach((x) => x.classList.toggle("on", +x.dataset.r <= r && +x.dataset.c <= c));
        label.textContent = `${c} × ${r}`;
      });
      cell.addEventListener("mousedown", (e) => e.preventDefault());
      cell.addEventListener("click", () => { docHidePops(); docBackToRange(); docInsertTable(r, c); });
      grid.append(cell);
    }
    pop.append(grid, label);
  }
  pop.hidden = false;
  const r = button.getBoundingClientRect(), box = $("docEditor").getBoundingClientRect();
  pop.style.left = Math.max(0, Math.min(r.left - box.left, box.width - pop.offsetWidth - 4)) + "px";
  const below = r.bottom - box.top + 6;
  // (from the zoom box at the bottom: open upwards)
  pop.style.top = (r.bottom + pop.offsetHeight + 10 > innerHeight && r.top > pop.offsetHeight + 20 ? r.top - box.top - pop.offsetHeight - 6 : below) + "px";
  const search = pop.querySelector("input");
  if (search) search.focus();
}

function docHidePops() {
  $("docPop").hidden = true;
  $("docSuggest").hidden = true;
  $("docsCardMenu").hidden = true;
  docTabMenuEl.hidden = true;
  for (const b of $("docMenubar").children) b.classList.remove("open");
}
document.addEventListener("mousedown", (e) => {
  if (!doc) return;
  if (!$("docPop").contains(e.target) && !$("docMenubar").contains(e.target) && !docTabMenuEl.contains(e.target)) docHidePops();
  if (!$("docSuggest").contains(e.target)) $("docSuggest").hidden = true;
});

function docSetStyle(key) {
  if (docBlockHeld()) return;
  docUndoCommit();
  const tag = key === "title" ? "h1" : key === "subtitle" ? "p" : key;
  document.execCommand("formatBlock", false, tag);
  const block = docCaretBlock();
  if (block) {
    block.classList.remove("doc-title", "doc-subtitle");
    if (key === "title") block.classList.add("doc-title");
    if (key === "subtitle") block.classList.add("doc-subtitle");
  }
  docUndoCommit();
  docToolState();
}

function docInsertBlockAfter(html) {
  const block = docCaretBlock() || docsText.lastElementChild;
  if (!block) return;
  docUndoCommit();
  const frag = docClean(html);
  const els = [...frag.children];
  const next = document.createElement("p");
  if (doc.kind === "script") next.className = "sp-action";
  next.append(document.createElement("br"));
  block.after(...els, next);
  docPutCaret(next, 0);
  docUndoCommit();
}

function docInsertTable(rows, cols) {
  const head = "<tr>" + "<th><br></th>".repeat(cols) + "</tr>";
  const row = "<tr>" + "<td><br></td>".repeat(cols) + "</tr>";
  docInsertBlockAfter(`<table class="doc-table"><tbody>${head}${row.repeat(Math.max(0, rows - 1))}</tbody></table>`);
  const table = docCaretBlock() && docCaretBlock().previousElementSibling;
  if (table && table.tagName === "TABLE") docPutCaret(table.querySelector("th, td"), 0);
}

function docChecklist() {
  docUndoCommit();
  let block = docCaretBlock();
  if (block && block.classList.contains("checklist")) {
    document.execCommand("insertUnorderedList"); // back to plain paragraphs
  } else {
    if (!block || block.tagName !== "UL") document.execCommand("insertUnorderedList");
    block = docCaretBlock();
    if (block && block.tagName === "OL") { document.execCommand("insertUnorderedList"); block = docCaretBlock(); }
    if (block && block.tagName === "UL") block.classList.add("checklist");
  }
  docUndoCommit();
  docToolState();
}

// Click the box in front of a checklist line to tick it.
docsText.addEventListener("click", (e) => {
  const li = e.target.closest && e.target.closest("ul.checklist > li");
  if (li && e.offsetX < 26 && e.target === li) {
    if (docBlockOf(li).classList.contains("doc-held")) return;
    docUndoCommit();
    li.classList.toggle("checked");
    docUndoCommit();
  }
});
// Links never open inside the app; a click opens them in the browser (not when you're selecting text).
docsText.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a");
  if (!a) return;
  e.preventDefault();
  const sel = document.getSelection();
  if (e.button !== 0 || e.shiftKey || (sel && !sel.isCollapsed && sel.toString().trim())) return;
  if (a.getAttribute("href")) api("/api/docs-open-link", { url: a.getAttribute("href") }).catch(() => null);
}, true);
docsText.addEventListener("auxclick", (e) => { if (e.target.closest && e.target.closest("a")) e.preventDefault(); }, true);

// ---- links

async function docLink() {
  const range = docRange();
  const current = range && (range.startContainer.parentElement || {}).closest ? range.startContainer.parentElement.closest("a") : null;
  const url = await docAskText("Add a link", "Paste the web address", current ? current.getAttribute("href") : "https://");
  if (url === null) return;
  docsText.focus();
  if (range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  if (!url.trim() || url.trim() === "https://") return docExec("unlink");
  const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : "https://" + url.trim();
  if (range && range.collapsed && !current) {
    docUndoCommit();
    document.execCommand("insertHTML", false, `<a href="${esc(href)}">${esc(href)}</a>&nbsp;`);
    docUndoCommit();
  } else {
    docExec("createLink", href);
  }
}

// ---- pictures (made smaller and kept inside the document)

$("docImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) await docAddImage(file);
});

async function docAddImage(file, range) {
  if (!file || !/^image\//.test(file.type)) return;
  let url;
  try {
    url = await docShrinkImage(file);
  } catch (err) {
    return docToast("Couldn't open that picture.");
  }
  docsText.focus();
  if (range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  docUndoCommit();
  document.execCommand("insertImage", false, url);
  docUndoCommit();
}

function docShrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(src);
      // Small enough to share quickly (a block can hold about 600 KB).
      for (let side = 1400, quality = 0.85; ; side = Math.round(side * 0.8), quality = Math.max(0.6, quality - 0.08)) {
        const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const png = file.type === "image/png" || file.type === "image/gif" ? canvas.toDataURL("image/png") : "";
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL("image/jpeg", quality);
        const best = png && png.length < jpeg.length * 1.3 ? png : jpeg;
        if (best.length < 420000 || side < 300) return resolve(best);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("bad image")); };
    img.src = src;
  });
}

// ---- pasting and dropping: cleaned, and pictures go in like the Picture button

docsText.addEventListener("paste", (e) => {
  if (!doc) return;
  e.preventDefault();
  if (docBlockHeld()) return;
  const data = e.clipboardData;
  const image = [...data.files].find((f) => /^image\//.test(f.type));
  if (image && !data.getData("text/html")) return docAddImage(image);
  const html = data.getData("text/html");
  docUndoCommit();
  if (html && doc.kind !== "script") {
    const holder = document.createElement("div");
    holder.append(docClean(html.replace(/<!--StartFragment-->|<!--EndFragment-->/g, "")));
    holder.querySelectorAll("img").forEach((img) => { if (!img.getAttribute("src")) img.remove(); });
    document.execCommand("insertHTML", false, holder.innerHTML);
  } else {
    const text = data.getData("text/plain");
    if (doc.kind === "script" && text.includes("\n")) docPasteScript(text);
    else document.execCommand("insertText", false, text);
  }
  docUndoCommit();
});

let docDragInside = false; // moving text around inside the document (that's already clean)
docsText.addEventListener("dragstart", () => { docDragInside = true; });
document.addEventListener("dragend", () => { docDragInside = false; });
docsText.addEventListener("drop", (e) => {
  if (!doc) return;
  const image = [...(e.dataTransfer.files || [])].find((f) => /^image\//.test(f.type));
  if (!image && !docDragInside) {
    // Text from somewhere else: in like a paste (cleaned), where it was dropped.
    e.preventDefault();
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (!range || docBlockOf(range.startContainer) && docBlockOf(range.startContainer).classList.contains("doc-held")) return;
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const html = e.dataTransfer.getData("text/html"), text = e.dataTransfer.getData("text/plain");
    docUndoCommit();
    if (html && doc.kind !== "script") {
      const holder = document.createElement("div");
      holder.append(docClean(html));
      document.execCommand("insertHTML", false, holder.innerHTML);
    } else if (text) document.execCommand("insertText", false, text);
    docUndoCommit();
    return;
  }
  docDragInside = false;
  if (!image) return;
  e.preventDefault();
  e.stopPropagation();
  const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  docAddImage(image, range);
});

// ---- the little bar over a picture or a table

function docFloatTools() {
  const float = $("docFloat");
  const sel = getSelection();
  const node = sel.rangeCount && docsText.contains(sel.anchorNode) ? sel.anchorNode : null;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const cell = el && el.closest("td, th");
  if (docFloatImage && !docsText.contains(docFloatImage)) docFloatImage = null;
  if (docFloatImage || cell) {
    float.replaceChildren();
    const btn = (label, fn) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => { docUndoCommit(); fn(); docUndoCommit(); docFloatTools(); });
      float.append(b);
    };
    let target;
    if (docFloatImage) {
      target = docFloatImage;
      for (const [label, w] of [["Small", "25%"], ["Medium", "50%"], ["Large", "75%"], ["Full", "100%"]]) {
        btn(label, () => { target.style.width = w; });
      }
      btn("Delete", () => { target.remove(); docFloatImage = null; });
    } else {
      const row = cell.parentElement, table = cell.closest("table");
      target = table;
      const col = [...row.children].indexOf(cell);
      btn("+ Row", () => { const r = row.cloneNode(true); r.querySelectorAll("th, td").forEach((c) => { const n = document.createElement("td"); n.append(document.createElement("br")); c.replaceWith(n); }); row.after(r); });
      btn("+ Column", () => { for (const r of table.rows) { const c = r.children[col]; const n = document.createElement(c && c.tagName === "TH" ? "th" : "td"); n.append(document.createElement("br")); (c ? c.after(n) : r.append(n)); } });
      btn("- Row", () => { if (table.rows.length > 1) row.remove(); else table.remove(); });
      btn("- Column", () => { if (row.children.length > 1) for (const r of table.rows) r.children[col] && r.children[col].remove(); else table.remove(); });
      btn("Delete table", () => table.remove());
    }
    float.hidden = false;
    const r = target.getBoundingClientRect(), box = $("docEditor").getBoundingClientRect();
    float.style.left = Math.max(0, r.left - box.left + r.width / 2 - float.offsetWidth / 2) + "px";
    float.style.top = Math.max(0, r.top - box.top - float.offsetHeight - 8) + "px";
  } else {
    float.hidden = true;
  }
}
let docFloatImage = null;
docsText.addEventListener("mousedown", (e) => {
  docFloatImage = e.target.tagName === "IMG" ? e.target : null;
  if (docFloatImage) {
    setTimeout(() => {
      const r = document.createRange();
      r.selectNode(docFloatImage);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      docFloatTools();
    });
  }
});
window.addEventListener("scroll", () => { if (doc && !$("docFloat").hidden) docFloatTools(); }, { passive: true });

// ---------------------------------------------------------------- typing

docsText.addEventListener("keydown", (e) => {
  if (!doc) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === "z" && !e.shiftKey) { e.preventDefault(); return docUndoGo(-1); }
  if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); return docUndoGo(1); }
  if (ctrl && key === "f") { e.preventDefault(); return docOpenFind(); }
  if (ctrl && key === "h") { e.preventDefault(); return docOpenFind(true); }
  if (ctrl && key === "p") { e.preventDefault(); return docPrint(); }
  if (ctrl && key === "k" && doc.kind !== "script") { e.preventDefault(); return docLink(); }
  if (ctrl && key === "\\") { e.preventDefault(); return docCommand("removeFormat"); }
  if (ctrl && e.key === "Enter") { e.preventDefault(); return docCommand("pagebreak"); }
  if (ctrl && key === "s") { e.preventDefault(); return docSave(); }
  if (ctrl && e.shiftKey && key === "c") { e.preventDefault(); return docWordCount(); }
  if (ctrl && (e.key === "." || e.key === ",") && doc.kind !== "script") { e.preventDefault(); return docCommand(e.key === "." ? "superscript" : "subscript"); }
  if (!ctrl && !/^(Arrow|Page|Home|End|Escape|Tab|Shift|Control|Alt|Meta|CapsLock|F\d)/.test(e.key) && docsText.querySelector(":scope > .doc-held") && docBlockHeld(e.key)) { e.preventDefault(); return; }
  if (ctrl && (key === "x" || key === "v") && docsText.querySelector(":scope > .doc-held") && docBlockHeld()) { e.preventDefault(); return; }
  if (doc.kind === "script" && docScriptKey(e)) return;
  if (e.key === "Tab" && doc.kind !== "script") {
    const cell = getSelection().anchorNode && (getSelection().anchorNode.parentElement || {}).closest
      ? (getSelection().anchorNode.nodeType === 1 ? getSelection().anchorNode : getSelection().anchorNode.parentElement).closest("td, th") : null;
    e.preventDefault();
    if (cell) return docTableTab(cell, e.shiftKey);
    const block = docCaretBlock();
    if (block && /^(UL|OL)$/.test(block.tagName)) return docExec(e.shiftKey ? "outdent" : "indent");
    if (!e.shiftKey) document.execCommand("insertText", false, " ");
    return;
  }
  if (!ctrl && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter")) {
    docLastTyped = Date.now();
    const block = docCaretBlock();
    docTypedBlock = block ? block.dataset.id : null;
  }
  // A new paragraph after a heading is plain text again (and not a copy of the title style).
  if (e.key === "Enter" && !e.shiftKey && doc.kind !== "script") setTimeout(() => {
    const block = docCaretBlock();
    if (block && block.tagName === "P" && !block.textContent && (block.classList.contains("doc-title") || block.classList.contains("doc-subtitle"))) {
      block.classList.remove("doc-title", "doc-subtitle");
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (!doc || $("docEditor").hidden || !(e.ctrlKey || e.metaKey) || docsText.contains(e.target)) return;
  if ([...document.querySelectorAll(".modal:not([hidden])")].some((m) => m.getClientRects().length)) return;
  const key = e.key.toLowerCase();
  if (key === "f" || key === "h") { e.preventDefault(); docOpenFind(); }
  if (key === "p") { e.preventDefault(); docPrint(); }
  if (key === "s") { e.preventDefault(); docSave(); }
  if ((key === "z" || key === "y") && e.target === document.body) { e.preventDefault(); docUndoGo(key === "y" || e.shiftKey ? 1 : -1); }
});

docsText.addEventListener("beforeinput", (e) => {
  if (e.inputType === "historyUndo") { e.preventDefault(); docUndoGo(-1); }
  if (e.inputType === "historyRedo") { e.preventDefault(); docUndoGo(1); }
});

function docTableTab(cell, back) {
  const table = cell.closest("table");
  const cells = [...table.querySelectorAll("th, td")];
  let i = cells.indexOf(cell) + (back ? -1 : 1);
  if (i >= cells.length) {
    docUndoCommit();
    const row = table.rows[table.rows.length - 1].cloneNode(true);
    row.querySelectorAll("th, td").forEach((c) => { const n = document.createElement("td"); n.append(document.createElement("br")); c.replaceWith(n); });
    table.tBodies[0] ? table.tBodies[0].append(row) : table.append(row);
    docPutCaret(row.cells[0], 0);
    return;
  }
  if (i < 0) return;
  const r = document.createRange();
  r.selectNodeContents(cells[i]);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}

// ---------------------------------------------------------------- the movie script

function docScriptKind(block) {
  for (const k of SCRIPT_KINDS) if (block.classList.contains("sp-" + k)) return k;
  if (block.classList.contains("sp-title") || block.classList.contains("sp-contact")) return "";
  return "action";
}

const SCRIPT_NEXT = { scene: "action", action: "action", character: "dialogue", paren: "dialogue", dialogue: "action", transition: "scene", shot: "action", centered: "action" };
const SCRIPT_TAB = ["action", "character", "paren", "dialogue", "transition", "scene", "shot"];
const SCRIPT_HINTS = {
  scene: "Scene heading: where and when, like INT. KITCHEN - NIGHT.  Enter: action",
  action: "Action: what we see.  Tab: character  ·  Enter: more action  ·  Type INT. or EXT. for a new scene",
  character: "Character: who's talking.  Enter: dialogue  ·  Tab: parenthetical",
  paren: "Parenthetical: how they say it.  Enter: dialogue",
  dialogue: "Dialogue: what they say.  Enter: action  ·  Tab: parenthetical  ·  Type ( for a parenthetical",
  transition: "Transition: like CUT TO: or FADE OUT.  Enter: scene heading",
  shot: "Shot: like CLOSE ON or ANGLE ON.  Enter: action",
  centered: "Centered text, like THE END.",
  "": "Title page.",
};
function docHint(kind) { $("docHint").textContent = SCRIPT_HINTS[kind] || ""; }

function docSetScriptKind(kind, block = docCaretBlock()) {
  if (!block || block.tagName !== "P" || docBlockHeld()) return;
  docUndoCommit();
  const caret = docSaveCaret();
  for (const k of [...SCRIPT_KINDS, "title", "contact"]) block.classList.remove("sp-" + k);
  block.classList.add("sp-" + kind);
  if (kind === "paren") {
    // The brackets are drawn around it, so typed ones go.
    const t = block.textContent;
    if (/^\(.*\)$/.test(t.trim())) block.textContent = t.trim().slice(1, -1);
  }
  docRestoreCaret(caret);
  docUndoCommit();
  docToolState();
  drawOutline();
}

// Splits the block at the caret (what's after it goes into a new block of the next kind).
function docScriptEnter(block, kind) {
  const sel = getSelection();
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(block, block.childNodes.length);
  const rest = tail.extractContents();
  const next = document.createElement("p");
  next.className = "sp-" + kind;
  const restText = rest.textContent;
  if (restText) next.append(rest); else next.append(document.createElement("br"));
  if (!block.textContent && !block.querySelector("br")) block.append(document.createElement("br"));
  block.after(next);
  docPutCaret(next, 0);
}

function docScriptKey(e) {
  const block = docCaretBlock();
  if (!block || block.tagName !== "P") return false;
  const kind = docScriptKind(block);
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && /^[1-8]$/.test(e.key)) {
    e.preventDefault();
    const pick = Object.keys(SCRIPT_KEYS).find((k) => SCRIPT_KEYS[k] === e.key);
    docSetScriptKind(pick, block);
    return true;
  }
  if (!$("docSuggest").hidden && docSuggestKey(e)) return true;
  if (e.key === "Tab") {
    e.preventDefault();
    if (kind === "") return true;
    const i = SCRIPT_TAB.indexOf(kind);
    const empty = !block.textContent.trim();
    let to;
    if (!e.shiftKey && kind === "dialogue" && !empty) {
      // Tab in dialogue: a parenthetical on the next line.
      docUndoCommit();
      const sel = getSelection();
      sel.collapse(block, block.childNodes.length);
      docScriptEnter(block, "paren");
      docUndoCommit();
      return true;
    }
    to = SCRIPT_TAB[(Math.max(0, i) + (e.shiftKey ? SCRIPT_TAB.length - 1 : 1)) % SCRIPT_TAB.length];
    docSetScriptKind(to, block);
    return true;
  }
  if (e.key === "Enter" && !e.shiftKey && !ctrl) {
    e.preventDefault();
    docLastTyped = Date.now();
    docUndoCommit();
    const text = block.textContent.trim();
    if (!text && kind !== "action" && kind !== "") {
      docSetScriptKind("action", block); // an empty line: back to action
      return true;
    }
    let next = SCRIPT_NEXT[kind] || "action";
    // "CUT TO:" typed as action is a transition.
    if (kind === "action" && /^[A-Z0-9 .'\-]+ TO:$/.test(text)) { docSetScriptKind("transition", block); next = "scene"; }
    if (kind === "paren") { const t = block.textContent; if (/\)\s*$/.test(t)) block.textContent = t.replace(/\)\s*$/, ""); }
    docScriptEnter(block, next);
    docUndoCommit();
    docToolState();
    drawOutline();
    return true;
  }
  if (e.key === "(" && kind === "dialogue" && !block.textContent.trim()) {
    e.preventDefault();
    docSetScriptKind("paren", block);
    return true;
  }
  if (e.key === ")" && kind === "paren") {
    // The bracket is drawn already: go on to the dialogue.
    const sel = getSelection();
    const r = document.createRange();
    r.selectNodeContents(block);
    r.setStart(sel.anchorNode, sel.anchorOffset);
    if (!r.toString().trim()) {
      e.preventDefault();
      docUndoCommit();
      sel.collapse(block, block.childNodes.length);
      docScriptEnter(block, "dialogue");
      docUndoCommit();
      docToolState();
      return true;
    }
  }
  if (e.key === " " && kind === "action") {
    // "int." or "ext." at the start of a line: that's a scene heading.
    const t = block.textContent.toLowerCase();
    if (/^(int|ext|int\.\/ext|i\/e|est)\.?$/.test(t.trim())) {
      setTimeout(() => docSetScriptKind("scene", block));
    }
  }
  return false;
}

// Turns pasted plain text into script lines (it guesses which is which).
function docPasteScript(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let html = "", after = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { after = ""; continue; }
    let kind = "action";
    if (/^(INT|EXT|INT\.\/EXT|I\/E|EST)[. ]/i.test(line)) kind = "scene";
    else if (/^[A-Z0-9 .'\-]+ TO:$/.test(line) || /^FADE (IN|OUT)/.test(line)) kind = "transition";
    else if (/^\(.*\)$/.test(line) && (after === "character" || after === "dialogue")) kind = "paren";
    else if (after === "character" || after === "paren") kind = "dialogue";
    else if (/^[A-Z][A-Z0-9 .'\-]*( \((V\.O\.|O\.S\.|O\.C\.|CONT'D)\))?$/.test(line) && line.length < 40) kind = "character";
    html += p(kind === "paren" ? line.slice(1, -1) : line, "sp-" + kind);
    after = kind;
  }
  document.execCommand("insertHTML", false, html);
}

// ---- suggestions while typing a character's name or a scene heading

let docSuggestions = [];
let docSuggestAt = 0;

function docSuggestUpdate() {
  const box = $("docSuggest");
  const sel = getSelection();
  const block = docCaretBlock();
  if (!block || !sel.isCollapsed || document.activeElement !== docsText) { box.hidden = true; return; }
  const kind = docScriptKind(block);
  const typed = block.textContent.replace(/ /g, " ");
  const caretAtEnd = (() => {
    const r = document.createRange();
    r.selectNodeContents(block);
    r.setStart(sel.anchorNode, sel.anchorOffset);
    return !r.toString().trim();
  })();
  let list = [];
  const up = typed.toUpperCase();
  if (caretAtEnd && kind === "character") {
    const names = new Set();
    for (const el of docsText.querySelectorAll(":scope > .sp-character")) {
      if (el === block) continue;
      const n = el.textContent.replace(/\s*\((CONT'D|V\.O\.|O\.S\.|O\.C\.)\)\s*$/i, "").trim().toUpperCase();
      if (n) names.add(n);
    }
    list = [...names].filter((n) => n.startsWith(up.trim()) && n !== up.trim());
    // "SAM (" : how they're heard
    const ext = up.match(/^(.+?)\s*\(([A-Z.']*)$/);
    if (ext) list = ["V.O.", "O.S.", "CONT'D"].filter((x) => x.startsWith(ext[2])).map((x) => `${ext[1]} (${x})`);
  } else if (caretAtEnd && kind === "scene") {
    if (!up.trim()) list = ["INT. ", "EXT. ", "INT./EXT. "];
    else if (/ - $| -$/.test(up)) list = ["DAY", "NIGHT", "MORNING", "EVENING", "LATER", "CONTINUOUS", "MOMENTS LATER"].map((t) => up.replace(/ -$/, " - ") + t);
    else {
      const places = new Set();
      for (const el of docsText.querySelectorAll(":scope > .sp-scene")) {
        if (el === block) continue;
        const place = el.textContent.toUpperCase().replace(/\s+-\s+[^-]*$/, "").trim();
        if (place) places.add(place);
      }
      list = [...places].filter((x) => x.startsWith(up.trim()) && x !== up.trim()).map((x) => x + " - ");
    }
  }
  docSuggestions = list.slice(0, 6);
  if (!docSuggestions.length) { box.hidden = true; return; }
  docSuggestAt = 0;
  box.replaceChildren(...docSuggestions.map((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.trim();
    b.classList.toggle("on", i === 0);
    b.addEventListener("mousedown", (e) => { e.preventDefault(); docSuggestPick(i); });
    return b;
  }));
  box.hidden = false;
  const r = block.getBoundingClientRect(), edit = $("docEditor").getBoundingClientRect();
  const left = kind === "character" ? r.left + parseFloat(getComputedStyle(block).paddingLeft || 0) : r.left;
  box.style.left = Math.max(0, left - edit.left) + "px";
  box.style.top = r.bottom - edit.top + 4 + "px";
}

function docSuggestKey(e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    docSuggestAt = (docSuggestAt + (e.key === "ArrowDown" ? 1 : docSuggestions.length - 1)) % docSuggestions.length;
    [...$("docSuggest").children].forEach((b, i) => b.classList.toggle("on", i === docSuggestAt));
    return true;
  }
  if (e.key === "Tab" || (e.key === "Enter" && docSuggestions[docSuggestAt] && !docSuggestions[docSuggestAt].endsWith(" "))) {
    // (Enter on "INT. " would only add a space: let Enter do its normal thing there.)
    e.preventDefault();
    docSuggestPick(docSuggestAt);
    return e.key === "Tab" || !docSuggestions.length;
  }
  if (e.key === "Escape") { $("docSuggest").hidden = true; return true; }
  return false;
}

function docSuggestPick(i) {
  const block = docCaretBlock();
  const text = docSuggestions[i];
  if (!block || text == null) return;
  docUndoCommit();
  const r = document.createRange();
  r.selectNodeContents(block);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand("insertText", false, text);
  $("docSuggest").hidden = true;
  docUndoCommit();
  setTimeout(docSuggestUpdate);
}

// ---------------------------------------------------------------- the outline / scene list

let docOutlineTimer = 0;
function drawOutline() {
  if (!doc || $("docOutline").hidden) return;
  const script = doc.kind === "script";
  $("docOutlineTitle").textContent = script ? "Scenes" : "Outline";
  $("docOutline").classList.toggle("script", script);
  const items = [];
  let n = 0;
  for (const el of docsText.querySelectorAll(script ? ":scope > .sp-scene" : ":scope > h1, :scope > h2, :scope > h3")) {
    const text = el.textContent.trim();
    if (!text) continue;
    n++;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "doc-outline-item lvl-" + (script ? 1 : el.tagName === "H1" ? (el.classList.contains("doc-title") ? 0 : 1) : el.tagName === "H2" ? 2 : 3);
    b.dataset.id = el.dataset.id;
    b.innerHTML = script ? "<i></i><span></span>" : "<span></span>";
    if (script) b.querySelector("i").textContent = n;
    b.querySelector("span").textContent = text;
    b.addEventListener("click", () => {
      el.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
      docsText.focus({ preventScroll: true });
      docPutCaret(el, "end");
    });
    items.push(b);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = script ? "Your scenes show up here." : "Headings show up here.";
    items.push(empty);
  }
  $("docOutlineList").replaceChildren(...items);
  docOutlineActive();
}

function docOutlineActive() {
  if (!doc || $("docOutline").hidden) return;
  const block = docCaretBlock();
  let at = block;
  const script = doc.kind === "script";
  while (at && !(script ? at.classList.contains("sp-scene") : /^H[123]$/.test(at.tagName))) at = at.previousElementSibling;
  for (const b of $("docOutlineList").children) b.classList.toggle("on", !!at && b.dataset.id === at.dataset.id);
}

// ---------------------------------------------------------------- words and pages

let docCountTimer = 0;
function docCountSoon() {
  clearTimeout(docCountTimer);
  docCountTimer = setTimeout(() => { docCount(); clearTimeout(docOutlineTimer); docOutlineTimer = setTimeout(drawOutline, 200); }, 400);
}

function docCount() {
  if (!doc) return;
  docEmptyCheck();
  docDarkInk();
  docNotesMark();
  const text = docsText.innerText;
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  let more = "";
  if (doc.kind === "script") {
    // A script page is about 55 lines; one page is about one minute of film.
    let lines = 0;
    for (const el of docsText.children) {
      if (el.classList.contains("page-break")) { lines = Math.ceil(lines / 55) * 55; continue; }
      const k = docScriptKind(el);
      const width = k === "dialogue" ? 35 : k === "paren" ? 25 : 60;
      lines += Math.max(1, Math.ceil(el.textContent.length / width)) + (k === "dialogue" || k === "paren" ? 0 : 1);
    }
    const pages = Math.max(1, Math.round(lines / 55));
    const scenes = docsText.querySelectorAll(":scope > .sp-scene").length;
    more = ` · about ${pages} ${pages === 1 ? "page" : "pages"} (${pages} min) · ${scenes} ${scenes === 1 ? "scene" : "scenes"}`;
  } else {
    const minutes = Math.max(1, Math.round(words / 230));
    more = words ? ` · ${minutes} min to read` : "";
  }
  $("docCount").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}${more}`;
  if (doc.kind !== "script") $("docHint").textContent = docsText.querySelector("a[href]") ? "Click a link to open it" : "";
}

// The page fits the window: smaller windows get a smaller page (like zooming out).
function docFit() {
  if (!doc) return;
  const width = (DOC_PAGES[docSettings().page] || DOC_PAGES.letter).w;
  const room = $("docCanvas").clientWidth - 24;
  const fit = Math.min(1, Math.max(0.45, room / width));
  const want = loadPref("docZoom") || "fit";
  const zoom = want === "fit" ? fit : Math.max(0.25, Math.min(3, +want / 100 || 1));
  $("docPage").style.zoom = Math.abs(zoom - 1) > 0.001 ? zoom : "";
  $("docZoom").textContent = Math.round(zoom * 100) + "%";
  $("docZoom").title = want === "fit" ? "Zoom (fits the window)" : "Zoom";
}
window.addEventListener("resize", () => { if (doc) docFit(); });

// ---------------------------------------------------------------- find and replace

let docFindHits = [];
let docFindAt = -1;

function docOpenFind(replace) {
  $("docFind").hidden = false;
  const r = docRange();
  if (r && !r.collapsed && r.toString().length < 80) $("docFindText").value = r.toString();
  $("docFindText").focus();
  $("docFindText").select();
  docFindRun();
}

function docClearFind() {
  if (window.CSS && CSS.highlights) { CSS.highlights.delete("doc-find"); CSS.highlights.delete("doc-find-now"); }
  docFindHits = [];
  docFindAt = -1;
}

function docFindRun(keepAt) {
  if (!window.CSS || !CSS.highlights) return;
  const q = $("docFindText").value;
  docFindHits = [];
  if (q) {
    const lower = q.toLowerCase();
    const walker = document.createTreeWalker(docsText, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, t = node.data.toLowerCase();
      for (let i = t.indexOf(lower); i >= 0; i = t.indexOf(lower, i + lower.length)) {
        const r = new Range();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        docFindHits.push(r);
      }
    }
  }
  CSS.highlights.set("doc-find", new Highlight(...docFindHits));
  if (!keepAt) docFindAt = docFindHits.length ? 0 : -1;
  else docFindAt = Math.min(docFindAt, docFindHits.length - 1);
  docFindShow();
}

function docFindShow() {
  $("docFindCount").textContent = !$("docFindText").value ? "" : docFindHits.length ? `${docFindAt + 1} of ${docFindHits.length}` : "Not found";
  if (docFindAt >= 0 && docFindHits[docFindAt]) {
    CSS.highlights.set("doc-find-now", new Highlight(docFindHits[docFindAt]));
    const rect = docFindHits[docFindAt].getBoundingClientRect();
    if (rect.top < 150 || rect.bottom > innerHeight - 60) window.scrollBy({ top: rect.top - innerHeight / 2 });
  } else {
    CSS.highlights.delete("doc-find-now");
  }
}

function docFindStep(n) {
  if (!docFindHits.length) return;
  docFindAt = (docFindAt + n + docFindHits.length) % docFindHits.length;
  docFindShow();
}

function docReplace(all) {
  if (!docFindHits.length) return;
  const by = $("docReplaceText").value;
  docUndoCommit();
  const hits = all ? [...docFindHits].reverse() : [docFindHits[docFindAt]];
  let skipped = 0;
  for (const r of hits) {
    const block = docBlockOf(r.startContainer);
    if (block && block.classList.contains("doc-held")) { skipped++; continue; }
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand("insertText", false, by);
  }
  docUndoCommit();
  docFindRun(true);
  if (skipped) docToast("Some weren't replaced: someone is writing there right now.");
  $("docFindText").focus();
}

$("docFindText").addEventListener("input", () => docFindRun());
$("docFindText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); docFindStep(e.shiftKey ? -1 : 1); }
  if (e.key === "Escape") docCloseFind();
});
$("docReplaceText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); docReplace(false); }
  if (e.key === "Escape") docCloseFind();
});
$("docFindNext").addEventListener("click", () => docFindStep(1));
$("docFindPrev").addEventListener("click", () => docFindStep(-1));
$("docReplaceOne").addEventListener("click", () => docReplace(false));
$("docReplaceAll").addEventListener("click", () => docReplace(true));
$("docFindClose").addEventListener("click", () => docCloseFind());
function docCloseFind() {
  $("docFind").hidden = true;
  docClearFind();
  if (docFindAt >= 0) { /* keep the caret where it was */ }
  docsText.focus();
}

// ---------------------------------------------------------------- title, sharing and the menu

$("docTitle").addEventListener("input", () => {
  if (!doc) return;
  docTitleDirty = true;
  docMarkDirty();
});
$("docTitle").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); docsText.focus(); }
});
$("docTitle").addEventListener("blur", () => {
  if (doc && !$("docTitle").value.trim()) { $("docTitle").value = "Untitled document"; docTitleDirty = true; docMarkDirty(); }
});

function drawShare() {
  const b = $("docShare");
  if (doc.where === "local") {
    b.innerHTML = docIcon("lock") + "<span>Only you</span>";
    b.title = "This document is only on this computer. Share a copy from the menu (…)";
    b.classList.add("quiet");
  } else {
    const joined = doc.people.filter((x) => x.joined).length;
    b.innerHTML = docIcon("people") + `<span>${doc.mine ? "Invite" : "People"}</span>` + (joined > 1 ? `<b>${joined}</b>` : "");
    b.title = doc.mine ? "Invite people to write with you" : "Who's in this document";
    b.classList.remove("quiet");
  }
}
$("docShare").addEventListener("click", () => {
  if (!doc) return;
  if (doc.where === "local") return docOpenPop("menu-file", $("docMenubar").firstElementChild);
  openInvite();
});

async function docCopyTo(where) {
  if (where === "collab" && !sfxUser()) return docToast("Log in first to share documents.");
  // The copy is made of what's on the page now (saved or not), then the original asks about its changes.
  if (docTab) docShowTab("");
  let pos = "";
  const blocks = [...docsText.children].map((el) => { pos = posBetween(pos, null); return { id: newBlockId(), pos, html: blockHtml(el) }; });
  for (const [id, b] of docStore) blocks.push({ id, pos: b.pos, html: b.html }); // the other pages, as they are
  const title = where === doc.where ? `Copy of ${$("docTitle").value}` : $("docTitle").value;
  const kind = doc.kind, settings = doc.settings;
  if (!(await docLeave())) return;
  const res = await api("/api/docs-create", { where, title, kind, blocks, settings }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't make the copy.");
  await openDoc(where, res.id);
  docToast(where === "collab" ? "Copied to Collab. Now invite people with the Invite button." : where === "local" ? "Saved a copy on this computer." : "Made a copy.");
}

// ---- inviting people

let docInvitePicked = new Set();
let docInviteAll = [];

async function openInvite() {
  docInvitePicked = new Set();
  $("docInviteNote").textContent = "";
  $("docInviteSearch").value = "";
  $("docInviteAdd").hidden = !doc.mine;
  $("docInviteSend").hidden = !doc.mine;
  $("docInviteTitle").textContent = doc.mine ? "Invite people" : "People";
  $("docInviteSub").textContent = doc.mine
    ? "They get an invitation in their app. Only the people in here can open this document."
    : "Only the people in here can open this document. The one who made it can invite more.";
  drawInvitePeople();
  $("docInviteModal").hidden = false;
  if (doc.mine) {
    $("docInvitePick").innerHTML = '<p class="docs-empty">Loading...</p>';
    const res = await api("/api/docs-people", {}).catch(() => null);
    docInviteAll = res && res.ok ? res.people : [];
    if (!res || !res.ok) $("docInviteNote").textContent = (res && res.error) || "Couldn't load the people.";
    drawInvitePick();
    $("docInviteSearch").focus();
  }
}

function drawInvitePeople() {
  if (!doc) return;
  const rows = doc.people.map((person) => {
    const row = document.createElement("div");
    row.className = "doc-person";
    row.append(docAvatar(person));
    const name = document.createElement("span");
    name.innerHTML = "<b></b><small></small>";
    name.querySelector("b").textContent = person.username;
    name.querySelector("small").textContent = person.owner ? "Made it" : person.joined ? "Can write" : "Invited, hasn't joined yet";
    row.append(name);
    if (doc.mine && !person.owner) {
      const x = Object.assign(document.createElement("button"), { type: "button", className: "link danger", textContent: "Remove" });
      x.onclick = async () => {
        const res = await api("/api/docs-remove", { id: doc.id, username: person.username }).catch(() => null);
        if (!res || !res.ok) return ($("docInviteNote").textContent = (res && res.error) || "That didn't work.");
        doc.people = res.people;
        drawInvitePeople(); drawInvitePick(); drawShare();
      };
      row.append(x);
    }
    return row;
  });
  $("docPeople").replaceChildren(...rows);
}

function drawInvitePick() {
  if (!doc) return;
  const q = $("docInviteSearch").value.trim().toLowerCase();
  const inDoc = new Set(doc.people.map((x) => x.username.toLowerCase()));
  const list = docInviteAll.filter((x) => !inDoc.has(x.username.toLowerCase()) && (!q || x.username.toLowerCase().includes(q)));
  const rows = list.slice(0, 60).map((person) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "doc-person pick" + (docInvitePicked.has(person.username) ? " on" : "");
    row.append(docAvatar(person));
    row.append(Object.assign(document.createElement("b"), { textContent: person.username }));
    row.append(Object.assign(document.createElement("span"), { className: "doc-tick" }));
    row.onclick = () => {
      if (docInvitePicked.has(person.username)) docInvitePicked.delete(person.username); else docInvitePicked.add(person.username);
      row.classList.toggle("on");
      docInviteButton();
    };
    return row;
  });
  if (!rows.length) rows.push(Object.assign(document.createElement("p"), { className: "docs-empty", textContent: q ? "Nobody with that name." : "Everyone's in already." }));
  $("docInvitePick").replaceChildren(...rows);
  docInviteButton();
}
function docInviteButton() {
  const n = docInvitePicked.size;
  $("docInviteSend").disabled = !n;
  $("docInviteSend").textContent = n > 1 ? `Invite ${n} people` : "Invite";
}
$("docInviteSearch").addEventListener("input", drawInvitePick);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("docInviteModal").hidden) $("docInviteModal").hidden = true;
  else if (!$("docAskModal").hidden) docAskClose(false);
  else if (!$("docSetupModal").hidden) $("docSetupModal").hidden = true;
  else if (!$("docInfoModal").hidden) $("docInfoModal").hidden = true;
  else if (!$("docTypeModal").hidden) $("docTypeModal").hidden = true;
  else if (!$("docsCardMenu").hidden) $("docsCardMenu").hidden = true;
  else if (doc && !$("docPop").hidden) docHidePops();
  else if (doc && document.body.classList.contains("doc-focus")) docFocus(false);
});
$("docInviteCancel").addEventListener("click", () => ($("docInviteModal").hidden = true));
$("docInviteModal").addEventListener("mousedown", (e) => { if (e.target === $("docInviteModal")) $("docInviteModal").hidden = true; });
$("docInviteSend").addEventListener("click", async () => {
  if (!doc || !docInvitePicked.size) return;
  $("docInviteSend").disabled = true;
  const res = await api("/api/docs-invite", { id: doc.id, usernames: [...docInvitePicked] }).catch(() => null);
  if (!res || !res.ok) {
    $("docInviteNote").textContent = (res && res.error) || "Couldn't send the invitations.";
    $("docInviteSend").disabled = false;
    return;
  }
  const n = docInvitePicked.size;
  doc.people = res.people;
  docInvitePicked = new Set();
  drawInvitePeople(); drawInvitePick(); drawShare();
  $("docInviteNote").textContent = n === 1 ? "Invitation sent." : `${n} invitations sent.`;
});

// ---- small questions

let docAskDone = null;
function docAsk(title, text, yes, opts = {}) {
  $("docAskTitle").textContent = title;
  $("docAskText").textContent = text;
  $("docAskYes").textContent = yes;
  $("docAskOther").hidden = !opts.other;
  $("docAskOther").textContent = opts.other || "";
  $("docAskYes").classList.toggle("danger", /Delete|Leave/.test(yes));
  $("docAskModal").querySelector(".doc-ask-input") && $("docAskModal").querySelector(".doc-ask-input").remove();
  $("docAskModal").hidden = false;
  $("docAskYes").focus();
  return new Promise((resolve) => { docAskDone = resolve; });
}
function docAskText(title, text, value) {
  const done = docAsk(title, text, "OK");
  const label = document.createElement("label");
  label.className = "input doc-ask-input";
  const input = Object.assign(document.createElement("input"), { value, spellcheck: false });
  label.append(input);
  $("docAskText").after(label);
  input.focus();
  input.select();
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); docAskClose(true); } });
  return done.then((ok) => (ok ? input.value : null));
}
function docAskClose(answer) {
  $("docAskModal").hidden = true;
  if (docAskDone) { const done = docAskDone; docAskDone = null; done(answer); }
}
$("docAskYes").addEventListener("click", () => docAskClose(true));
$("docAskNo").addEventListener("click", () => docAskClose(false));
$("docAskOther").addEventListener("click", () => docAskClose("other"));

function docToast(text) {
  let t = $("docToast");
  if (!t) {
    t = Object.assign(document.createElement("div"), { id: "docToast", className: "doc-toast" });
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 4200);
}

// ---------------------------------------------------------------- printing and downloading

function docPrint() {
  if (!doc) return;
  docHidePops();
  document.body.classList.add("doc-printing");
  document.title = $("docTitle").value; // the PDF's file name
  // The paper size and margins of this document.
  const s = docSettings();
  const margin = doc.kind === "script" ? "1in" : DOC_MARGINS[s.margins].px / 96 + "in";
  const style = Object.assign(document.createElement("style"), { id: "docPrintPage", textContent: `@media print { @page { size: ${(DOC_PAGES[s.page] || DOC_PAGES.letter).css}; margin: ${margin}; } }` });
  document.head.append(style);
  const done = () => { document.body.classList.remove("doc-printing"); document.title = "VaultHub"; style.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  const caret = docSaveCaret();
  docsText.blur(); // (no blinking caret on the paper)
  setTimeout(() => { window.print(); setTimeout(done, 500); docsText.focus({ preventScroll: true }); docRestoreCaret(caret); }, 50);
}

// What the text of a block is, line breaks kept.
function blockText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  copy.querySelectorAll("li").forEach((li) => li.append("\n"));
  copy.querySelectorAll("tr").forEach((tr) => tr.append("\n"));
  copy.querySelectorAll("td, th").forEach((c) => c.append("\t"));
  return copy.textContent.replace(/ /g, " ").replace(/\n+$/, "");
}

function docAsText(fountain) {
  const out = [];
  const script = doc.kind === "script";
  const blocks = [...docsText.children];
  if (fountain) {
    const title = blocks.filter((el) => el.classList.contains("sp-title")).map(blockText).join(" ");
    if (title) {
      out.push("Title: " + title);
      const by = blocks.filter((el) => el.classList.contains("sp-centered")).slice(0, 2).map(blockText);
      if (by.length) out.push("Credit: " + by[0], ...(by[1] ? ["Author: " + by[1]] : []));
      const contact = blocks.filter((el) => el.classList.contains("sp-contact")).map(blockText).join(" ");
      if (contact) out.push("Contact: " + contact);
      out.push("");
    }
  }
  let titlePage = fountain && blocks.some((el) => el.classList.contains("sp-title"));
  for (const el of blocks) {
    if (el.tagName === "HR") {
      if (titlePage) { titlePage = false; continue; }
      out.push(fountain ? "===" : el.classList.contains("page-break") ? "\f" : "-----", "");
      continue;
    }
    if (titlePage) continue;
    const text = blockText(el);
    if (!script) {
      if (el.tagName === "UL" || el.tagName === "OL") {
        let n = 0;
        for (const li of el.querySelectorAll(":scope > li")) {
          n++;
          const mark = el.classList.contains("checklist") ? (li.classList.contains("checked") ? "[x] " : "[ ] ") : el.tagName === "OL" ? n + ". " : "- ";
          out.push(mark + blockText(li));
        }
        out.push("");
      } else {
        out.push(/^H[123]$/.test(el.tagName) && !fountain ? text.toUpperCase() : text, "");
      }
      continue;
    }
    const kind = docScriptKind(el);
    const up = text.toUpperCase();
    if (fountain) {
      if (kind === "scene") out.push((/^(INT|EXT|EST|INT\.\/EXT|I\/E)[. ]/i.test(text) ? up : "." + up), "");
      else if (kind === "character") out.push(/[a-z]/.test(text) ? "@" + up : up);
      else if (kind === "paren") out.push("(" + text + ")");
      else if (kind === "dialogue") { out.push(text); if (!el.nextElementSibling || !/sp-(paren|dialogue)/.test(el.nextElementSibling.className)) out.push(""); }
      else if (kind === "transition") out.push((/TO:$/.test(up) ? up : "> " + up), "");
      else if (kind === "centered") out.push("> " + text + " <", "");
      else if (kind === "shot") out.push(up, "");
      else if (kind === "action") out.push(/^[A-Z0-9 ]+$/.test(text) ? "!" + text : text, "");
      else out.push(text, "");
    } else {
      // A plain text copy laid out like the page (in characters).
      const pad = (n, t) => t.split("\n").map((l) => " ".repeat(n) + l).join("\n");
      const center = (t) => t.split("\n").map((l) => " ".repeat(Math.max(0, Math.floor((60 - l.length) / 2))) + l).join("\n");
      if (kind === "character") out.push(pad(22, up));
      else if (kind === "paren") out.push(pad(16, "(" + text + ")"));
      else if (kind === "dialogue") { out.push(pad(10, docWrap(text, 35))); if (!el.nextElementSibling || !/sp-(paren|dialogue)/.test(el.nextElementSibling.className)) out.push(""); }
      else if (kind === "transition") out.push(" ".repeat(Math.max(0, 60 - up.length)) + up, "");
      else if (kind === "centered" || el.classList.contains("sp-title")) out.push(center(el.classList.contains("sp-title") ? up : text), "");
      else if (kind === "scene" || kind === "shot") out.push(up, "");
      else out.push(docWrap(text, 60), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trimEnd() + "\n";
}

function docWrap(text, width) {
  return text.split("\n").map((line) => {
    const words = line.split(" ");
    const lines = [];
    let now = "";
    for (const w of words) {
      if (now && (now + " " + w).length > width) { lines.push(now); now = w; } else now = now ? now + " " + w : w;
    }
    lines.push(now);
    return lines.join("\n");
  }).join("\n");
}

// Word opens a web page saved as .doc, with its formatting (and Google Docs can open it too).
function docAsWord() {
  const script = doc.kind === "script";
  const body = [...docsText.children].map((el) => {
    const copy = blockFromHtml({ id: "x", pos: "x", html: blockHtml(el) });
    copy.removeAttribute("data-id"); copy.removeAttribute("data-pos");
    if (copy.tagName === "HR" && copy.classList.contains("page-break")) return '<br clear="all" style="page-break-before:always">';
    if (script && copy.classList.contains("sp-paren")) copy.textContent = "(" + copy.textContent + ")";
    if (copy.tagName === "UL" && copy.classList.contains("checklist")) copy.querySelectorAll("li").forEach((li) => li.prepend(li.classList.contains("checked") ? "☑ " : "☐ "));
    return copy.outerHTML;
  }).join("\n");
  const s = docSettings();
  const size = s.page === "a4" ? "21cm 29.7cm" : "8.5in 11in";
  const margin = DOC_MARGINS[s.margins].px / 96 + "in";
  const font = docFontCss(s.font).replace(/^InterVar, /, "");
  const css = script ? `
    @page { size: ${size}; margin: 1in 1in 1in 1.5in; }
    body { font-family: ${font}; font-size: ${s.size}pt; }
    p { margin: 0; line-height: ${s.line}; }
    .sp-scene, .sp-action, .sp-shot, .sp-transition, .sp-character, .sp-centered { margin-top: 12pt; }
    .sp-scene, .sp-shot, .sp-character, .sp-transition, .sp-title { text-transform: uppercase; }
    .sp-scene { font-weight: bold; }
    .sp-character { margin-left: 2.2in; }
    .sp-paren { margin-left: 1.6in; margin-right: 2in; }
    .sp-dialogue { margin-left: 1in; margin-right: 1.5in; }
    .sp-transition { text-align: right; }
    .sp-centered, .sp-title { text-align: center; }
    .sp-title { margin-top: 3in; font-weight: bold; }
    .sp-contact { margin-top: 3in; }` : `
    @page { size: ${size}; margin: ${margin}; }
    body { font-family: ${s.font === "Inter" ? "Calibri, Arial, sans-serif" : font}; font-size: ${s.size}pt; line-height: ${s.line}; }
    h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; }
    .doc-title { font-size: 26pt; } .doc-subtitle { font-size: 15pt; color: #666; }
    table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 4pt 6pt; } th { background: #eee; }
    img { max-width: 6.5in; }`;
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc($("docTitle").value)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

async function docExport(ext) {
  if (!doc) return;
  const folder = await whereToSave();
  if (folder === null) return;
  const text = ext === "doc" ? docAsWord() : docAsText(ext === "fountain");
  const res = await api("/api/docs-export", { title: $("docTitle").value, ext, text, folder }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't save the file.");
  docToast(`Saved as ${res.fileName}`);
  const t = $("docToast");
  const show = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Show in folder" });
  show.onclick = () => api("/api/docs-show", { path: res.path }).catch(() => null);
  t.append(" ", show);
}

// ---------------------------------------------------------------- page settings (size, margins, paper, font)

const DOC_PAGES = {
  letter: { name: "Letter", note: "8.5 × 11 in", w: 816, h: 1056, css: "letter" },
  a4: { name: "A4", note: "21 × 29.7 cm", w: 794, h: 1123, css: "A4" },
};
const DOC_MARGINS = { narrow: { name: "Narrow", note: "0.5 in", px: 48 }, normal: { name: "Normal", note: "1 in", px: 96 }, wide: { name: "Wide", note: "1.5 in", px: 144 } };
const DOC_PAPERS = { white: "White", cream: "Cream", grey: "Soft grey", night: "Night" };
const DOC_LINES = [["1", "Single"], ["1.15", "1.15"], ["1.5", "1.5"], ["2", "Double"]];
const DOC_ZOOMS = [50, 75, 90, 100, 125, 150, 200];

// [name, kind, comes with the app]
const DOC_FONT_LIST = [
  ["Inter", "sans", 1], ["Roboto", "sans", 1], ["Open Sans", "sans", 1], ["Lato", "sans", 1], ["Montserrat", "sans", 1],
  ["Poppins", "sans", 1], ["Nunito", "sans", 1], ["Lora", "serif", 1], ["Merriweather", "serif", 1], ["Playfair Display", "serif", 1],
  ["Source Serif 4", "serif", 1], ["EB Garamond", "serif", 1], ["Courier Prime", "mono", 1], ["Caveat", "hand", 1],
  ["Arial", "sans"], ["Calibri", "sans"], ["Segoe UI", "sans"], ["Verdana", "sans"], ["Tahoma", "sans"], ["Trebuchet MS", "sans"],
  ["Century Gothic", "sans"], ["Franklin Gothic Medium", "sans"], ["Candara", "sans"], ["Corbel", "sans"], ["Bahnschrift", "sans"], ["Impact", "sans"],
  ["Times New Roman", "serif"], ["Georgia", "serif"], ["Cambria", "serif"], ["Constantia", "serif"], ["Garamond", "serif"],
  ["Palatino Linotype", "serif"], ["Book Antiqua", "serif"], ["Sitka Text", "serif"],
  ["Courier New", "mono"], ["Consolas", "mono"], ["Lucida Console", "mono"],
  ["Comic Sans MS", "hand"], ["Segoe Print", "hand"], ["Segoe Script", "hand"], ["Ink Free", "hand"],
];
const DOC_FALLBACK = { sans: "Arial, sans-serif", serif: "Georgia, serif", mono: "'Courier New', monospace", hand: "cursive" };

function docDefaults(kind) {
  return kind === "script"
    ? { font: "Courier Prime", size: 12, line: "1", margins: "normal", page: "letter", paper: "white" }
    : { font: "Inter", size: 11, line: "1.5", margins: "normal", page: "letter", paper: "white" };
}
// Only what's known and makes sense (the settings come from the file or from other people).
function docCleanSettings(s) {
  const out = {};
  if (!s || typeof s !== "object") return out;
  if (typeof s.font === "string" && s.font.trim() && s.font.length <= 60) out.font = s.font.replace(/[^\w\s-]/g, "").trim();
  if (+s.size >= 6 && +s.size <= 40) out.size = Math.round(+s.size * 2) / 2;
  if (DOC_LINES.some(([v]) => v === String(s.line))) out.line = String(s.line);
  if (Object.hasOwn(DOC_MARGINS, s.margins)) out.margins = s.margins;
  if (Object.hasOwn(DOC_PAGES, s.page)) out.page = s.page;
  if (Object.hasOwn(DOC_PAPERS, s.paper)) out.paper = s.paper;
  if (DOC_TYPES.some((t) => t.key === s.type && t.key !== "blank")) out.type = s.type;
  return out;
}
function docSettings() { return doc ? { ...docDefaults(doc.kind), ...doc.settings } : docDefaults("doc"); }

function docFontCss(name) {
  if (name === "Inter") return "InterVar, Inter, Arial, sans-serif";
  const f = DOC_FONT_LIST.find((x) => x[0] === name);
  return `"${name}", ${DOC_FALLBACK[f ? f[1] : "sans"]}`;
}

// Is a Windows font on this computer? (Text in it is a different width than in the fallback.)
const docFontsThere = new Map();
function docFontThere(name) {
  const f = DOC_FONT_LIST.find((x) => x[0] === name);
  if (f && f[2]) return true;
  if (docFontsThere.has(name)) return docFontsThere.get(name);
  const ctx = (docFontThere.canvas ||= document.createElement("canvas")).getContext("2d");
  const sample = "mmmmmmmmmmlli WWW 0123456789";
  let there = false;
  for (const base of ["monospace", "serif", "sans-serif"]) {
    ctx.font = `40px ${base}`;
    const plain = ctx.measureText(sample).width;
    ctx.font = `40px "${name}", ${base}`;
    if (ctx.measureText(sample).width !== plain) { there = true; break; }
  }
  docFontsThere.set(name, there);
  return there;
}

function docApplySettings() {
  if (!doc) return;
  const s = docSettings(), page = $("docPage");
  const size = DOC_PAGES[s.page] || DOC_PAGES.letter;
  const margin = doc.kind === "script" ? 96 : DOC_MARGINS[s.margins].px;
  page.dataset.paper = s.paper;
  page.dataset.dark = docDark() ? "1" : "";
  page.style.setProperty("--page-w", size.w + "px");
  page.style.setProperty("--page-h", size.h + "px");
  page.style.setProperty("--pad-x", margin + "px");
  page.style.setProperty("--pad-y", margin + "px");
  page.style.setProperty("--doc-font", docFontCss(s.font));
  page.style.setProperty("--doc-size", s.size + "pt");
  page.style.setProperty("--doc-line", s.line);
  docFit();
  docToolState();
  if (!$("docSetupModal").hidden) drawPageSetup();
}

function docSetSetting(key, value) {
  if (!doc) return;
  const next = { ...doc.settings, [key]: value };
  if (docDefaults(doc.kind)[key] === value) delete next[key];
  doc.settings = docCleanSettings(next);
  docSettingsDirty = true;
  docMarkDirty();
  docApplySettings();
}

// ---- the font menu: for the selected text, or the whole document

let docFontWhole = false;
function docFontPop(pop, item, head) {
  const range = docKeepRange && !docKeepRange.collapsed ? docKeepRange : null;
  const whole = !range || docFontWhole;
  const now = docSettings().font;
  const top = document.createElement("div");
  top.className = "doc-font-top";
  if (range) {
    top.innerHTML = '<div class="doc-seg"><button type="button" data-w="0">Selected text</button><button type="button" data-w="1">Whole document</button></div>';
    top.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", (b.dataset.w === "1") === whole);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => { docFontWhole = b.dataset.w === "1"; const btn = $("docToolbar").querySelector(".doc-font"); docHidePops(); docBackToRange(); docOpenPop("font", btn || $("docMenubar").children[4]); });
    });
  } else {
    top.innerHTML = '<p class="doc-pop-note">For the whole document. Select text first to change just that part.</p>';
  }
  const search = Object.assign(document.createElement("input"), { placeholder: "Search fonts", spellcheck: false, autocomplete: "off" });
  const label = document.createElement("label");
  label.className = "input doc-font-search";
  label.append(search);
  top.append(label);
  pop.append(top);
  const list = document.createElement("div");
  list.className = "doc-font-list";
  pop.append(list);
  const pick = (name) => {
    const recent = [name, ...docRecentFonts().filter((f) => f !== name)].slice(0, 4);
    savePref("docRecentFonts", JSON.stringify(recent));
    if (whole) {
      docSetSetting("font", name);
      docToast(`The whole document is now in ${name}.`);
    } else {
      docExec("fontName", docFontCss(name));
    }
  };
  const add = (title, names) => {
    if (!names.length) return;
    const h = Object.assign(document.createElement("p"), { className: "doc-pop-head", textContent: title });
    list.append(h);
    for (const name of names) {
      const b = item(name, () => pick(name), { style: `font-family: ${docFontCss(name)}`, on: whole && name === now, into: list });
      b.dataset.font = name.toLowerCase();
    }
  };
  const recent = docRecentFonts().filter(docFontThere);
  add("Recent", recent);
  add("Comes with the app", DOC_FONT_LIST.filter((f) => f[2]).map((f) => f[0]));
  add("On this computer", DOC_FONT_LIST.filter((f) => !f[2] && docFontThere(f[0])).map((f) => f[0]));
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const seen = new Set();
    for (const el of list.children) {
      if (el.tagName === "P") { el.hidden = !!q; continue; }
      const show = !q || el.dataset.font.includes(q);
      el.hidden = !show || (q && seen.has(el.dataset.font));
      if (show) seen.add(el.dataset.font);
    }
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const first = [...list.children].find((el) => el.tagName === "BUTTON" && !el.hidden); if (first) first.click(); }
    if (e.key === "Escape") { docHidePops(); docBackToRange(); }
  });
}
function docRecentFonts() {
  try { return JSON.parse(loadPref("docRecentFonts") || "[]").filter((f) => typeof f === "string"); } catch (e) { return []; }
}

// ---------------------------------------------------------------- the menu bar (File, Edit, View...)

const DOC_MENUS = [["file", "File"], ["edit", "Edit"], ["view", "View"], ["insert", "Insert"], ["format", "Format"], ["tools", "Tools"]];
function drawMenubar() {
  const bar = $("docMenubar");
  if (bar.children.length) return;
  for (const [key, label] of DOC_MENUS) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "doc-menubar-item", textContent: label });
    b.dataset.menu = key;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("click", () => docOpenPop("menu-" + key, b));
    // Like real menus: once one is open, moving over the others opens them.
    b.addEventListener("mouseenter", () => {
      const pop = $("docPop");
      if (!pop.hidden && pop.dataset.kind.startsWith("menu-") && pop.dataset.kind !== "menu-" + key) { docHidePops(); docOpenPop("menu-" + key, b); }
    });
    bar.append(b);
  }
}

function docMenuItems(name) {
  const script = doc.kind === "script";
  const range = docKeepRange && !docKeepRange.collapsed;
  const isOn = (cmd) => { try { return document.queryCommandState(cmd); } catch (e) { return false; } };
  if (name === "file") return [
    { label: script ? "New script" : "New document", icon: "plus", fn: docNewFromMenu },
    { label: "Make a copy", icon: "copy", fn: () => docCopyTo(doc.where) },
    doc.where === "local" ? (sfxUser() ? { label: "Share a copy in Collab", icon: "people", fn: () => docCopyTo("collab") } : null)
      : { label: "Save a copy in Local", icon: "lock", fn: () => docCopyTo("local") },
    "-",
    { label: "Save", icon: "save", key: "Ctrl+S", fn: docSave },
    { label: "Rename", icon: "rename", fn: () => { $("docTitle").focus(); $("docTitle").select(); } },
    "-",
    { label: "Page setup", icon: "page", fn: openPageSetup },
    { label: "Print or save as PDF", icon: "print", key: "Ctrl+P", fn: docPrint },
    { label: "Download for Word (.doc)", icon: "download", fn: () => docExport("doc") },
    script ? { label: "Download as Fountain (.fountain)", icon: "download", fn: () => docExport("fountain") } : null,
    { label: "Download as text (.txt)", icon: "download", fn: () => docExport("txt") },
    "-",
    doc.where === "collab" && !doc.mine
      ? { label: "Leave this document", icon: "leave", danger: true, fn: () => docCardRemove({ id: doc.id, title: doc.title, mine: false }, true).then((gone) => gone && closeDoc()) }
      : { label: "Delete", icon: "trash", danger: true, fn: docDeleteOpen },
  ];
  if (name === "edit") return [
    { label: "Undo", icon: "undo", key: "Ctrl+Z", fn: () => docUndoGo(-1), disabled: docUndoAt <= 0 && !docUndoDirty.size },
    { label: "Redo", icon: "redo", key: "Ctrl+Y", fn: () => docUndoGo(1), disabled: docUndoAt >= docUndo.length - 1 },
    "-",
    { label: "Cut", icon: "cut", key: "Ctrl+X", fn: () => { if (!docBlockHeld()) document.execCommand("cut"); }, disabled: !range },
    { label: "Copy", icon: "copy", key: "Ctrl+C", fn: () => document.execCommand("copy"), disabled: !range },
    { label: "Paste", icon: "paste", key: "Ctrl+V", fn: docPasteFromMenu },
    { label: "Select all", icon: "selectAll", key: "Ctrl+A", fn: () => { docsText.focus(); document.execCommand("selectAll"); } },
    "-",
    { label: "Find and replace", icon: "find", key: "Ctrl+H", fn: () => docOpenFind(true) },
  ];
  if (name === "view") return [
    { label: script ? "Pages and scenes on the side" : "Pages and outline on the side", icon: "outline", on: !$("docOutline").hidden, fn: () => docCommand("outline") },
    script ? { label: "Scene numbers", icon: "numbersScene", on: docsText.classList.contains("numbers"), fn: () => docCommand("numbers-scene") } : null,
    docTypeOf(doc).guide ? { label: "Writing guide", icon: "quote", on: !$("docGuide").hidden, fn: () => docShowGuide($("docGuide").hidden) } : null,
    { label: "Focus mode", icon: "focus", fn: () => docFocus(true) },
    "-",
    { label: "Zoom", icon: "zoom", more: "zoom" },
    { label: "Paper color", icon: "paper", more: "paper" },
    { label: "Dark page", icon: "moon", on: docDark(), fn: () => docSetDark(!docDark()) },
  ];
  if (name === "insert") return script ? [
    doc.where === "collab" ? { label: "Comment", icon: "comment", key: "Ctrl+Alt+M", fn: () => docNotesNew() } : null,
    { label: "Page break", icon: "pagebreak", key: "Ctrl+Enter", fn: () => docCommand("pagebreak") },
    { label: "Today's date", icon: "calendar", fn: docInsertDate },
    { label: "Special character", icon: "omega", more: "special" },
    { label: "Emoji", icon: "emoji", more: "emoji" },
  ] : [
    doc.where === "collab" ? { label: "Comment", icon: "comment", key: "Ctrl+Alt+M", fn: () => docNotesNew() } : null,
    { label: "Picture", icon: "image", fn: () => docCommand("image") },
    { label: "Table", icon: "table", more: "table" },
    { label: "Link", icon: "link", key: "Ctrl+K", fn: () => docCommand("link") },
    "-",
    { label: "Checklist", icon: "checklist", fn: () => docCommand("checklist") },
    { label: "Line", icon: "hr", fn: () => { if (!docBlockHeld()) docInsertBlockAfter("<hr>"); } },
    { label: "Page break", icon: "pagebreak", key: "Ctrl+Enter", fn: () => docCommand("pagebreak") },
    "-",
    { label: "Today's date", icon: "calendar", fn: docInsertDate },
    { label: "Special character", icon: "omega", more: "special" },
    { label: "Emoji", icon: "emoji", more: "emoji" },
  ];
  if (name === "format") return [
    { label: "Bold", icon: "bold", key: "Ctrl+B", on: isOn("bold"), fn: () => docCommand("bold") },
    { label: "Italic", icon: "italic", key: "Ctrl+I", on: isOn("italic"), fn: () => docCommand("italic") },
    { label: "Underline", icon: "underline", key: "Ctrl+U", on: isOn("underline"), fn: () => docCommand("underline") },
    script ? null : { label: "Strikethrough", icon: "strike", on: isOn("strikeThrough"), fn: () => docCommand("strikeThrough") },
    script ? null : { label: "Superscript", icon: "sup", key: "Ctrl+.", on: isOn("superscript"), fn: () => docCommand("superscript") },
    script ? null : { label: "Subscript", icon: "sub", key: "Ctrl+,", on: isOn("subscript"), fn: () => docCommand("subscript") },
    { label: "Text case", icon: "textCase", more: "case" },
    "-",
    script ? { label: "Line type", icon: "script", more: "element" } : { label: "Text style", icon: "heading", more: "style" },
    { label: "Font", icon: "font", more: "font" },
    script ? null : { label: "Text color", icon: "color", more: "color" },
    script ? null : { label: "Align", icon: "left", more: "align" },
    script ? null : { label: "Line spacing", icon: "spacing", more: "spacing" },
    "-",
    { label: "Page setup", icon: "page", fn: openPageSetup },
    { label: "Clear formatting", icon: "clear", key: "Ctrl+\\", fn: () => docCommand("removeFormat") },
  ];
  if (name === "tools") return [
    { label: "Word count", icon: "count", key: "Ctrl+Shift+C", fn: docWordCount },
    script ? { label: "Characters in this script", icon: "character", fn: docCharacters } : null,
    { label: "Check spelling", icon: "spell", on: docsText.spellcheck, fn: docToggleSpelling },
  ];
  return [];
}

async function docNewFromMenu() {
  const where = doc.where;
  if (!(await docLeave())) return;
  closeDoc();
  docsWhere = where;
  drawDocsHome();
  openDocTypes();
}

async function docDeleteOpen() {
  const d = doc;
  const yes = await docAsk("Delete this document?", d.where === "collab" ? `"${$("docTitle").value}" is deleted for everyone in it. This can't be undone.` : `"${$("docTitle").value}" is deleted from this computer. This can't be undone.`, "Delete");
  if (!yes || doc !== d) return;
  const res = await api("/api/docs-delete", { id: d.id, where: d.where }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "That didn't work. Try again.");
  closeDoc();
}

async function docPasteFromMenu() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    if (docBlockHeld()) return;
    if (doc.kind === "script") docPasteScript(text); else document.execCommand("insertText", false, text);
  } catch (e) {
    docToast("Press Ctrl+V to paste.");
  }
}

function docInsertText(text) {
  if (!doc || docBlockHeld()) return;
  if (!docsText.contains(getSelection().anchorNode)) { docsText.focus(); docPutCaret(docsText.lastElementChild, "end"); }
  document.execCommand("insertText", false, text);
}
function docInsertDate() {
  docInsertText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }));
}

const DOC_SPECIAL = "— – … • · © ® ™ ° ± × ÷ ≈ ≠ ≤ ≥ → ← ↑ ↓ ⇒ ★ ☆ ♥ ♪ ✓ ✗ € £ ¥ ¢ § ¶ † « » “ ” ‘ ’ ½ ⅓ ¼ ¾ ² ³ µ".split(" ");
const DOC_EMOJI = "😀 😂 🥹 😍 😎 🤔 😮 😢 😡 🙏 👍 👎 👏 🙌 💪 👀 🔥 ✨ 🎉 ❤️ 💔 ⭐ ✅ ❌ ⚠️ ❓ 💡 📌 📝 📅 ⏰ 🎬 🎥 📷 🎞️ 🎤 🎧 🎵 🎭 💬 📍 🚗 🏠 🌙 ☀️ 🌧️ 🌊 🌲".split(" ");

// UPPERCASE, lowercase... of the selected text.
function docChangeCase(mode) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !docsText.contains(sel.anchorNode)) return docToast("Select some text first.");
  if (docBlockHeld()) return;
  const range = sel.getRangeAt(0);
  const saved = docSaveCaret();
  docUndoCommit();
  const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
  let capNext = true;
  for (const n of nodes) {
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.data.length;
    const part = n.data.slice(start, end);
    let out = "";
    if (mode === "upper") out = part.toUpperCase();
    else if (mode === "lower") out = part.toLowerCase();
    else {
      for (const ch of part) {
        if (/\p{L}/u.test(ch)) { out += capNext ? ch.toUpperCase() : ch.toLowerCase(); capNext = false; }
        else {
          out += ch;
          if (mode === "title" ? /[\s([{"“‘\/-]/.test(ch) : /[.!?]/.test(ch)) capNext = true;
        }
      }
    }
    if (out !== part) n.data = n.data.slice(0, start) + out + n.data.slice(end);
  }
  docRestoreCaret(saved);
  docUndoCommit();
}

function docToggleSpelling() {
  docsText.spellcheck = !docsText.spellcheck;
  savePref("docSpelling", docsText.spellcheck ? "1" : "0");
  // (the browser only redraws the red lines when the text is touched)
  const caret = docSaveCaret();
  docsText.blur();
  docsText.focus();
  docRestoreCaret(caret);
}

// ---- zoom and focus mode

function docSetZoom(z) {
  savePref("docZoom", z);
  docFit();
}
function docZoomStep(up) {
  const now = Math.round(parseFloat($("docZoom").textContent) || 100);
  const next = up ? DOC_ZOOMS.find((z) => z > now) : [...DOC_ZOOMS].reverse().find((z) => z < now);
  if (next) docSetZoom(String(next));
}
$("docZoomIn").addEventListener("click", () => docZoomStep(true));
$("docZoomOut").addEventListener("click", () => docZoomStep(false));
$("docZoom").addEventListener("mousedown", (e) => e.preventDefault());
$("docZoom").addEventListener("click", (e) => { e.stopPropagation(); docOpenPop("zoom", $("docZoom")); });
$("docCount").addEventListener("click", () => docWordCount());

function docFocus(on) {
  document.body.classList.toggle("doc-focus", on);
  if (on) docToast("Focus mode. Press Esc to come back.");
  docHidePops();
  requestAnimationFrame(docFit);
  docsText.focus({ preventScroll: true });
}
$("docFocusExit").addEventListener("click", () => docFocus(false));

// ---- page setup

function openPageSetup() {
  drawPageSetup();
  $("docSetupModal").hidden = false;
}
function drawPageSetup() {
  if (!doc) return;
  const s = docSettings(), box = $("docSetup");
  const seg = (key, options, now) => {
    const el = document.createElement("div");
    el.className = "doc-seg wide";
    for (const [value, label, note] of options) {
      const b = Object.assign(document.createElement("button"), { type: "button" });
      b.innerHTML = `<b></b>${note ? "<small></small>" : ""}`;
      b.querySelector("b").textContent = label;
      if (note) b.querySelector("small").textContent = note;
      b.classList.toggle("on", String(value) === String(now));
      b.addEventListener("click", () => docSetSetting(key, value));
      el.append(b);
    }
    return el;
  };
  const row = (label, ...content) => {
    const r = document.createElement("div");
    r.className = "doc-setup-row";
    r.append(Object.assign(document.createElement("span"), { className: "doc-setup-label", textContent: label }), ...content);
    return r;
  };
  const rows = [row("Page size", seg("page", Object.entries(DOC_PAGES).map(([k, p]) => [k, p.name, p.note]), s.page))];
  if (doc.kind !== "script") rows.push(row("Margins", seg("margins", Object.entries(DOC_MARGINS).map(([k, m]) => [k, m.name, m.note]), s.margins)));
  const papers = document.createElement("div");
  papers.className = "doc-papers";
  for (const [key, label] of Object.entries(DOC_PAPERS)) {
    const b = Object.assign(document.createElement("button"), { type: "button", title: label });
    b.innerHTML = `<i class="doc-paper-dot" data-paper="${key}"></i><span></span>`;
    b.querySelector("span").textContent = label;
    b.classList.toggle("on", key === s.paper);
    b.addEventListener("click", () => docSetSetting("paper", key));
    papers.append(b);
  }
  rows.push(row("Paper", papers));
  const font = document.createElement("select");
  font.className = "doc-setup-font";
  for (const name of DOC_FONT_LIST.map((f) => f[0]).filter(docFontThere)) {
    const o = Object.assign(document.createElement("option"), { value: name, textContent: name });
    o.style.fontFamily = docFontCss(name);
    font.append(o);
  }
  if (![...font.options].some((o) => o.value === s.font)) font.prepend(Object.assign(document.createElement("option"), { value: s.font, textContent: s.font }));
  font.value = s.font;
  font.style.fontFamily = docFontCss(s.font);
  font.addEventListener("change", () => docSetSetting("font", font.value));
  const size = document.createElement("div");
  size.className = "doc-stepper";
  size.innerHTML = '<button type="button" title="Smaller">−</button><span></span><button type="button" title="Bigger">+</button>';
  size.querySelector("span").textContent = s.size + " pt";
  const [down, up] = size.querySelectorAll("button");
  down.addEventListener("click", () => docSetSetting("size", Math.max(6, s.size - (s.size > 12 ? 2 : 1))));
  up.addEventListener("click", () => docSetSetting("size", Math.min(40, s.size + (s.size >= 12 ? 2 : 1))));
  rows.push(row("Font", font, size));
  rows.push(row("Line spacing", seg("line", DOC_LINES, s.line)));
  if (doc.kind === "script") rows.push(Object.assign(document.createElement("p"), { className: "doc-setup-note", textContent: "Scripts keep the standard screenplay margins, so they look right to everyone who reads them." }));
  box.replaceChildren(...rows);
}
$("docSetupDone").addEventListener("click", () => { $("docSetupModal").hidden = true; docsText.focus({ preventScroll: true }); });
$("docSetupReset").addEventListener("click", () => {
  if (!doc || !Object.keys(doc.settings).some((k) => k !== "type")) return;
  doc.settings = doc.settings.type ? { type: doc.settings.type } : {};
  docSettingsDirty = true;
  docMarkDirty();
  docApplySettings();
});
$("docSetupModal").addEventListener("mousedown", (e) => { if (e.target === $("docSetupModal")) $("docSetupModal").hidden = true; });

// ---- word count and the characters of a script

function docShowInfo(title, rows, extra) {
  $("docInfoTitle").textContent = title;
  const box = $("docInfo");
  box.replaceChildren();
  for (const [label, value] of rows) {
    const r = document.createElement("div");
    r.className = "doc-info-row";
    r.append(Object.assign(document.createElement("span"), { textContent: label }), Object.assign(document.createElement("b"), { textContent: value }));
    box.append(r);
  }
  if (extra) box.append(extra);
  $("docInfoModal").hidden = false;
}
$("docInfoDone").addEventListener("click", () => { $("docInfoModal").hidden = true; docsText.focus({ preventScroll: true }); });
$("docInfoModal").addEventListener("mousedown", (e) => { if (e.target === $("docInfoModal")) $("docInfoModal").hidden = true; });

function docTextStats(text) {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  return { words, chars: [...text.replace(/\n/g, "")].length, noSpaces: [...text.replace(/\s/g, "")].length };
}

function docWordCount() {
  if (!doc) return;
  const all = docTextStats(docsText.innerText);
  const sel = docRange();
  const picked = sel && !sel.collapsed ? docTextStats(sel.toString()) : null;
  const n = (x) => x.toLocaleString();
  const rows = [];
  if (picked) rows.push(["Selected words", n(picked.words)]);
  rows.push(["Words", n(all.words)], ["Characters", n(all.chars)], ["Characters without spaces", n(all.noSpaces)]);
  if (doc.kind === "script") {
    const pages = Math.max(1, Math.round(docScriptLines() / 55));
    const scenes = docsText.querySelectorAll(":scope > .sp-scene").length;
    rows.push(["Pages (about)", n(pages)], ["Screen time (about)", `${pages} min`], ["Scenes", n(scenes)], ["Speaking characters", n(docCharacterList().length)]);
  } else {
    const s = docSettings(), size = DOC_PAGES[s.page] || DOC_PAGES.letter, margin = DOC_MARGINS[s.margins].px;
    const pages = Math.max(1, Math.ceil(docsText.scrollHeight / (size.h - 2 * margin)) + docsText.querySelectorAll(":scope > hr.page-break").length);
    const paragraphs = [...docsText.children].filter((el) => el.textContent.trim() && el.tagName !== "HR").length;
    rows.push(["Paragraphs", n(paragraphs)], ["Pages (about)", n(pages)], ["Reading time", `${Math.max(1, Math.round(all.words / 230))} min`],
      ["Speaking time", `${Math.max(1, Math.round(all.words / 150))} min`]);
  }
  docShowInfo("Word count", rows);
}

// How many lines the script has (a page is about 55 lines; one page is about one minute of film).
function docScriptLines() {
  let lines = 0;
  for (const el of docsText.children) {
    if (el.classList.contains("page-break")) { lines = Math.ceil(lines / 55) * 55; continue; }
    const k = docScriptKind(el);
    const width = k === "dialogue" ? 35 : k === "paren" ? 25 : 60;
    lines += Math.max(1, Math.ceil(el.textContent.length / width)) + (k === "dialogue" || k === "paren" ? 0 : 1);
  }
  return lines;
}

// Who speaks in the script, and how much.
function docCharacterList() {
  const people = new Map();
  for (const el of docsText.querySelectorAll(":scope > .sp-character")) {
    const name = el.textContent.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!name) continue;
    const p = people.get(name) || { name, lines: 0, words: 0, first: el };
    p.lines++;
    for (let next = el.nextElementSibling; next && /sp-(dialogue|paren)/.test(next.className); next = next.nextElementSibling) {
      if (next.classList.contains("sp-dialogue")) p.words += docTextStats(next.textContent).words;
    }
    people.set(name, p);
  }
  return [...people.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
}

function docCharacters() {
  const list = docCharacterList();
  const box = document.createElement("div");
  box.className = "doc-cast";
  if (!list.length) box.append(Object.assign(document.createElement("p"), { className: "docs-empty", textContent: "Nobody speaks yet. Write a character name (Tab twice on an empty line) and their lines." }));
  const most = list.length ? list[0].lines : 1;
  for (const p of list) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "doc-cast-row" });
    b.innerHTML = `<span class="doc-avatar tiny"></span><b></b><i><em></em></i><small></small>`;
    b.querySelector(".doc-avatar").textContent = p.name[0];
    b.querySelector(".doc-avatar").style.setProperty("--who", docColor(p.name));
    b.querySelector("b").textContent = p.name;
    b.querySelector("em").style.width = Math.max(4, (p.lines / most) * 100) + "%";
    b.querySelector("small").textContent = `${p.lines} ${p.lines === 1 ? "time" : "times"} · ${p.words.toLocaleString()} words`;
    b.title = "Go to the first time they speak";
    b.addEventListener("click", () => {
      $("docInfoModal").hidden = true;
      p.first.scrollIntoView({ block: "center", behavior: "smooth" });
      docsText.focus({ preventScroll: true });
      docPutCaret(p.first, "end");
    });
    box.append(b);
  }
  docShowInfo("Characters", [], box);
}

// ---------------------------------------------------------------- the "..." on a document on the Docs home

const DOCS_SORTS = { new: "Newest first", old: "Oldest first", name: "Name A to Z" };
$("docsSort").addEventListener("click", () => {
  const keys = Object.keys(DOCS_SORTS);
  savePref("docsSort", keys[(keys.indexOf(loadPref("docsSort") || "new") + 1) % keys.length]);
  drawDocsHome();
});

function docCardMenu(d, collab, button) {
  const menu = $("docsCardMenu");
  if (!menu.hidden && menu.dataset.id === d.id) { menu.hidden = true; return; }
  menu.dataset.id = d.id;
  menu.replaceChildren();
  const item = (icon, label, fn, cls = "") => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "lib-menu-item " + cls });
    b.innerHTML = docIcon(icon) + "<span></span>";
    b.querySelector("span").textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = true; fn(); });
    menu.append(b);
  };
  const line = () => menu.append(Object.assign(document.createElement("div"), { className: "lib-menu-line" }));
  item("open", "Open", () => openDoc(collab ? "collab" : "local", d.id));
  item("rename", "Rename", () => docCardRename(d, collab));
  item("copy", "Make a copy", () => docCardCopy(d, collab, collab ? "collab" : "local"));
  if (!collab && sfxUser()) item("people", "Share a copy in Collab", () => docCardCopy(d, collab, "collab"));
  if (collab) item("lock", "Save a copy in Local", () => docCardCopy(d, collab, "local"));
  line();
  if (collab && !d.mine) item("leave", "Leave this document", () => docCardRemove(d, collab), "danger");
  else item("trash", "Delete", () => docCardRemove(d, collab), "danger");
  menu.hidden = false;
  const r = button.getBoundingClientRect(), box = $("docsTab").getBoundingClientRect();
  menu.style.left = Math.max(0, Math.min(r.right - box.left - menu.offsetWidth, box.width - menu.offsetWidth)) + "px";
  menu.style.top = r.bottom - box.top + 6 + "px";
}
document.addEventListener("mousedown", (e) => {
  const menu = $("docsCardMenu");
  if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".doc-card-more")) menu.hidden = true;
});

async function docCardRename(d, collab) {
  const title = await docAskText("Rename", "What should this document be called?", d.title);
  if (title === null || !title.trim() || title.trim() === d.title) return;
  const res = collab
    ? await api("/api/docs-sync", { id: d.id, since: Number.MAX_SAFE_INTEGER, changes: [], title: title.trim() }).catch(() => null)
    : await api("/api/docs-save", { id: d.id, title: title.trim() }).catch(() => null);
  if (collab) api("/api/docs-close", { id: d.id }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't rename it. Try again.");
  d.title = title.trim();
  loadDocsList();
}

async function docCardCopy(d, collab, where) {
  if (where === "collab" && !sfxUser()) return docToast("Log in first to share documents.");
  const res = await api("/api/docs-open", { where: collab ? "collab" : "local", id: d.id }).catch(() => null);
  if (collab) api("/api/docs-close", { id: d.id }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't make the copy.");
  let pos = "";
  const blocks = [...(res.doc.blocks || [])].sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0))
    .map((b) => { pos = posBetween(pos, null); return { id: newBlockId(), pos, html: b.html }; });
  const same = where === (collab ? "collab" : "local");
  const made = await api("/api/docs-create", { where, title: same ? `Copy of ${d.title}` : d.title, kind: res.doc.kind, blocks, settings: res.doc.settings || {} }).catch(() => null);
  if (!made || !made.ok) return docToast((made && made.error) || "Couldn't make the copy.");
  docToast(where === "collab" && !same ? "Copied to Collab. Open it and invite people with the Invite button." : where === "local" && !same ? "Saved a copy on this computer." : "Made a copy.");
  if (!same) docsSwitchTo(where); else loadDocsList();
}

// The tab may already be open (the app opens on the tab used last).
if (!$("docsTab").hidden) docsTabChanged("docs");
