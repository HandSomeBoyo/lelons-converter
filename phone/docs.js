// Docs on the phone: your shared documents (the same ones as in the PC app's Docs), invitations,
// and a simple editor that writes together with everyone else live (lelons_doc_* in sfx/setup.sql).
// Documents that only live on a PC (not shared) can't be seen here.
"use strict";

const D = {
  list: null,           // {docs, invites} from lelons_docs
  doc: null,            // the open document {id, title, kind, rev, mine, people, settings}
  store: new Map(),     // block id -> {pos, html} (every page)
  page: "",             // the page on screen ("" = the first one)
  pending: new Set(),   // blocks changed here, not sent yet
  deleted: new Set(),   // blocks deleted here, not sent yet
  titleDirty: false,
  here: [],             // who else has it open
  timer: 0, busy: false, again: false, failed: 0,
  observer: null,
  applying: false,
};

const DOC_POS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Same as the PC app: text that sorts, so a block between two others gets a position between theirs.
function dPosBetween(a, b) {
  a = a || "";
  let out = "";
  for (let i = 0; ; i++) {
    const da = i < a.length ? DOC_POS.indexOf(a[i]) : 0;
    const db = b != null && i < b.length ? DOC_POS.indexOf(b[i]) : DOC_POS.length;
    if (da === db) { out += DOC_POS[da]; continue; }
    const mid = b == null ? da + 1 : Math.floor((da + db) / 2);
    if (mid > da && mid < DOC_POS.length) return out + DOC_POS[mid];
    out += DOC_POS[da];
    b = null;
  }
}
const dNewId = () => (D.page ? D.page + "~" : "") + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const dPageOf = (id) => id.startsWith("t~") ? null : id.includes("~") ? id.slice(0, id.indexOf("~")) : "";
const dKey = (pos, id) => (pos || "") + "\u0000" + (id || "");
function dPageMeta(html) {
  const m = /^<!--tab (.*)-->$/s.exec(html || "");
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

// ---------------------------------------------------------------- cleaning (same rules as the PC app)

const D_TAGS = new Set("P H1 H2 H3 DIV SPAN B STRONG I EM U S STRIKE DEL SUB SUP BR UL OL LI BLOCKQUOTE PRE CODE A IMG HR TABLE THEAD TBODY TR TD TH MARK".split(" "));
const D_DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED LINK META TITLE NOSCRIPT TEMPLATE SVG MATH FORM INPUT BUTTON TEXTAREA SELECT OPTION VIDEO AUDIO SOURCE CANVAS HEAD BASE FRAME FRAMESET".split(" "));
const D_TOP = new Set("P H1 H2 H3 UL OL BLOCKQUOTE PRE HR TABLE".split(" "));
const D_STYLES = ["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration-line",
  "text-align", "margin-left", "line-height", "width", "vertical-align"];
const D_CLASS = /^(sp-(scene|action|character|paren|dialogue|transition|shot|centered|title|contact)|doc-(title|subtitle|table)|checklist|checked|page-break)$/;
const D_BLOCKS = new Set("P H1 H2 H3 DIV LI BLOCKQUOTE PRE TD TH".split(" "));
const D_BLOCK_STYLES = new Set(["text-align", "margin-left", "line-height"]);

function dStyle(from, to) {
  for (const name of D_STYLES) {
    let value = from.style.getPropertyValue(name);
    if (!value || /url\(|expression|javascript|[<>]|var\(/i.test(value)) continue;
    if (D_BLOCK_STYLES.has(name) && !D_BLOCKS.has(to.tagName)) continue;
    if (name === "font-size" && !/^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(value)) continue;
    if (name === "margin-left" && !/^\d+(\.\d+)?(px|pt|em)$/.test(value)) continue;
    if (name === "width" && !/^\d+(\.\d+)?(%|px)$/.test(value)) continue;
    if (name === "font-family") value = value.replace(/[^\w\s,"'-]/g, "");
    to.style.setProperty(name, value);
  }
}
function dCleanInto(from, to) {
  for (const node of from.childNodes) {
    if (node.nodeType === 3) { to.append(node.data); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();
    if (D_DROP.has(tag)) continue;
    const fakeBold = (tag === "B" || tag === "STRONG") && /^(normal|400)$/.test(node.style.fontWeight);
    const keep = /^H[4-6]$/.test(tag) ? "H3" : tag === "FONT" ? "SPAN" : tag;
    if (fakeBold || !D_TAGS.has(keep)) { dCleanInto(node, to); continue; }
    const el = document.createElement(keep);
    dStyle(node, el);
    for (const c of node.classList) if (D_CLASS.test(c)) el.classList.add(c);
    if (keep === "A") {
      const href = node.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href)) { el.setAttribute("href", href); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    } else if (keep === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(src)) continue;
      el.setAttribute("src", src);
    } else if (keep === "TD" || keep === "TH") {
      for (const a of ["colspan", "rowspan"]) if (/^\d{1,2}$/.test(node.getAttribute(a) || "")) el.setAttribute(a, node.getAttribute(a));
    }
    dCleanInto(node, el);
    to.append(el);
  }
  return to;
}
function dBlockEl(id, b) {
  const parsed = new DOMParser().parseFromString(`<body>${b.html}</body>`, "text/html");
  const frag = dCleanInto(parsed.body, document.createDocumentFragment());
  let el = frag.firstElementChild;
  if (!el || frag.children.length !== 1 || !D_TOP.has(el.tagName)) { el = document.createElement("p"); el.append(frag); }
  if (!el.childNodes.length && el.tagName !== "HR") el.append(document.createElement("br"));
  el.dataset.id = id;
  el.dataset.pos = b.pos;
  return el;
}
// The block as it's saved (without the phone's own marks).
function dBlockHtml(el) {
  const copy = el.cloneNode(true);
  copy.removeAttribute("data-id"); copy.removeAttribute("data-pos");
  copy.querySelectorAll("a").forEach((a) => { a.removeAttribute("target"); a.removeAttribute("rel"); });
  if (copy.getAttribute("style")) {
    const keep = document.createElement(copy.tagName);
    dStyle(copy, keep);
    if (keep.getAttribute("style")) copy.setAttribute("style", keep.getAttribute("style")); else copy.removeAttribute("style");
  }
  copy.querySelectorAll("[style='']").forEach((n) => n.removeAttribute("style"));
  return copy.outerHTML;
}

// ---------------------------------------------------------------- the list

function openDocs() {
  S.view = { kind: "docs" };
  renderDocsView();
  loadDocs();
}

async function loadDocs() {
  try { D.list = await rpcMe("lelons_docs"); } catch (e) { toast(e.message); D.list = D.list || { docs: [], invites: [] }; }
  if (S.view && S.view.kind === "docs") renderDocsView();
}

function renderDocsView() {
  if (S.view.kind === "doc") return renderDoc();
  const L = D.list;
  let body = '<div class="spin"></div>';
  if (L) {
    const inv = (L.invites || []).map((d) => `<div class="row">${avatar(d.from, publicUrl(d.avatar), { small: true })}
      <div class="grow"><b class="one" style="display:block">${esc(d.title)}</b><div class="sm muted">${esc(d.from)} invited you</div></div>
      <button class="btn2" data-dact="no" data-id="${esc(d.id)}" style="height:32px;padding:0 12px">No</button>
      <button class="btn2 go" data-dact="join" data-id="${esc(d.id)}" style="height:32px;padding:0 14px">Join</button></div>`).join("");
    const docs = (L.docs || []).map((d) => {
      const people = (d.people || []).filter((p) => p.joined);
      const prev = (d.preview || []).slice(0, 3).map((h) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
      return `<button class="row doc-row" data-doc="${esc(d.id)}"><div class="doc-ic ${d.kind === "script" ? "script" : ""}">${d.kind === "script" ? DI.script : DI.doc}</div>
        <div class="grow"><b class="one" style="display:block">${esc(d.title)}</b><div class="sm muted one">${esc(prev || "Empty")}</div>
        <div class="xs muted" style="margin-top:2px">${timeOf(d.updated_at)}${d.updated_by ? " · " + esc(d.updated_by) : ""}${people.length > 1 ? ` · ${people.length} people` : ""}</div></div></button>`;
    }).join("");
    body = `${inv ? `<div class="lbl">Invitations</div><div class="card list">${inv}</div>` : ""}
      <div class="lbl">Shared documents</div>
      ${docs ? `<div class="card list">${docs}</div>` : `<div class="card muted sm" style="padding:18px 16px">No shared documents yet. Tap + to start one.</div>`}
      <div class="muted sm" style="padding:12px 4px">Documents you only keep on your PC aren't here. Share one in the PC app to see it on your phone.</div>`;
  }
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><b>Docs</b></div>
      <button class="back" data-dact="new" aria-label="New document">${DI.plus}</button></div>
    <div class="scroll">${body}</div></div>`;
  $("#back").onclick = closeView;
  $("#app").onclick = docsClick;
  afterRender();
}

async function docsClick(e) {
  const t = e.target.closest("[data-doc],[data-dact]");
  if (!t) return;
  if (t.dataset.doc) return openDoc(t.dataset.doc);
  const act = t.dataset.dact;
  if (act === "new") {
    try {
      const id = await rpcMe("lelons_doc_create", { title: "Untitled document", kind: "doc", blocks: [{ id: dNewId(), pos: dPosBetween("", null), html: "<p><br></p>" }] });
      openDoc(id, true);
    } catch (err) { toast(err.message); }
  }
  if (act === "join" || act === "no") {
    t.disabled = true;
    try { await rpcMe("lelons_doc_answer", { doc_id: t.dataset.id, join_it: act === "join" }); } catch (err) { toast(err.message); }
    if (act === "join") return openDoc(t.dataset.id);
    loadDocs();
  }
}

// ---------------------------------------------------------------- a document

async function openDoc(id, fresh) {
  S.view = { kind: "doc", id, from: { kind: "docs" }, fresh };
  D.doc = null; D.store.clear(); D.pending.clear(); D.deleted.clear(); D.page = ""; D.here = []; D.titleDirty = false; D.failed = 0;
  renderDoc();
  try {
    const d = await rpcMe("lelons_doc_open", { doc_id: id });
    if (!S.view || S.view.id !== id) return;
    D.doc = d;
    for (const b of d.blocks || []) D.store.set(b.id, { pos: b.pos, html: b.html });
  } catch (e) {
    toast(e.message);
    S.view = { kind: "docs" }; renderDocsView(); return;
  }
  renderDoc();
  dSyncSoon(1200);
}

function dPages() {
  const list = [];
  for (const [id, b] of D.store) {
    if (!id.startsWith("t~")) continue;
    const m = dPageMeta(b.html);
    if (m) list.push({ id: id.slice(2), title: m.title || "Untitled page", parent: m.parent || "", pos: b.pos });
  }
  list.sort((a, b) => dKey(a.pos, a.id) < dKey(b.pos, b.id) ? -1 : 1);
  return list;
}

function renderDoc() {
  const d = D.doc;
  const others = D.here.filter((h) => h.username);
  $("#app").innerHTML = `<div class="screen has-top doc-screen">
    <div class="top"><button class="back" id="back">${I.back}</button>
      <div class="grow dhead"><div class="sm muted" id="dstate">${d ? "Saved" : "Opening..."}</div></div>
      <div class="dhere">${others.map((h) => avatar(h.username, publicUrl(h.avatar), { small: true, dot: h.typing ? "#ffcf3f" : "#9fd67a" })).join("")}</div></div>
    <div class="scroll" id="dscroll">${d ? `
      ${dPages().length ? `<div class="chips dpages"><button data-page="" class="${!D.page ? "on" : ""}">Main page</button>${dPages().map((p) => `<button data-page="${esc(p.id)}" class="${D.page === p.id ? "on" : ""}">${esc(p.title)}</button>`).join("")}</div>` : ""}
      <textarea class="dtitle" id="dtitle" rows="1" maxlength="150" placeholder="Untitled document" enterkeyhint="next">${esc(d.title)}</textarea>
      <div class="doc-text ${d.kind === "script" ? "script" : ""}" id="dtext" contenteditable="true" spellcheck="true" autocapitalize="sentences"></div>` : '<div class="spin"></div>'}
    </div>
    ${d ? `<div class="dtools glass" id="dtools">
      <button data-cmd="bold" aria-label="Bold"><b>B</b></button><button data-cmd="italic" aria-label="Italic"><i style="font-family:Georgia,serif">I</i></button>
      <button data-cmd="underline" aria-label="Underline"><u>U</u></button><span class="dsep"></span>
      <button data-cmd="h2" aria-label="Heading">H</button><button data-cmd="bullets" aria-label="Bullets">${DI.bullets}</button>
      <button data-cmd="checklist" aria-label="Checklist">${DI.check}</button><span class="dsep"></span>
      <button data-cmd="done" aria-label="Done typing">${DI.kb}</button></div>` : ""}
  </div>`;
  $("#back").onclick = closeDoc;
  if (!d) return;
  dFillPage();
  const box = $("#dtext");
  if (D.observer) D.observer.disconnect();
  D.observer = new MutationObserver(dMutations);
  D.observer.observe(box, { childList: true, subtree: true, characterData: true, attributes: true });
  box.addEventListener("click", dCheckTap);
  box.addEventListener("paste", dPaste);
  box.addEventListener("focus", dKeyboard);
  const title = $("#dtitle");
  const grow = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
  grow();
  title.oninput = () => { title.value = title.value.replace(/\n/g, " "); grow(); D.titleDirty = true; dState("Saving..."); dSyncSoon(800); };
  title.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); box.focus(); } };
  $("#app").onclick = (e) => {
    const p = e.target.closest("[data-page]");
    if (p) { D.page = p.dataset.page; renderDoc(); }
  };
  const tools = $("#dtools");
  tools.addEventListener("pointerdown", (e) => e.preventDefault());  // keep the keyboard open
  tools.onclick = (e) => { const b = e.target.closest("[data-cmd]"); if (b) dCommand(b.dataset.cmd); };
  dKeyboard();
  if (S.view.fresh) { S.view.fresh = false; title.select(); title.focus(); }
  afterRender();
}

// Put the blocks of the page on screen, in order.
function dFillPage() {
  const box = $("#dtext");
  D.applying = true;
  box.innerHTML = "";
  const list = [...D.store].filter(([id]) => dPageOf(id) === D.page).sort((a, b) => dKey(a[1].pos, a[0]) < dKey(b[1].pos, b[0]) ? -1 : 1);
  for (const [id, b] of list) box.append(dBlockEl(id, b));
  D.applying = false;
  dNormalize();
}

// After every edit: every top-level thing must be a block with an id and a position in order.
function dNormalize() {
  const box = $("#dtext");
  if (!box) return;
  D.applying = true;
  let prev = null;
  const seen = new Set();
  let node = box.firstChild;
  while (node) {
    let next = node.nextSibling;
    if (node.nodeType === 3 && !node.data.trim() && !node.data.length) { node.remove(); node = next; continue; }
    if (node.nodeType !== 1 || !D_TOP.has(node.tagName)) {
      const para = document.createElement("p");
      if (node.nodeType === 1 && node.tagName === "DIV") {
        para.append(...node.childNodes);
        if (node.dataset.id) { para.dataset.id = node.dataset.id; para.dataset.pos = node.dataset.pos; }
        node.replaceWith(para);
      } else {
        node.before(para);
        while (node && (node.nodeType !== 1 || (!D_TOP.has(node.tagName) && node.tagName !== "DIV"))) { next = node.nextSibling; para.append(node); node = next; }
        next = para.nextSibling;
      }
      node = para;
    }
    const el = node;
    if (!el.dataset.id || seen.has(el.dataset.id)) { el.dataset.id = dNewId(); delete el.dataset.pos; }
    seen.add(el.dataset.id);
    if (!el.dataset.pos || (prev && dKey(el.dataset.pos, el.dataset.id) <= dKey(prev.dataset.pos, prev.dataset.id))) {
      let after = el.nextElementSibling;
      while (after && !after.dataset.pos) after = after.nextElementSibling;
      const low = prev ? prev.dataset.pos : "";
      const high = after && after.dataset.pos > low ? after.dataset.pos : null;
      el.dataset.pos = dPosBetween(low, high);
      dChanged(el.dataset.id);
    }
    if (D.doc && D.doc.kind === "script" && el.tagName === "P" && ![...el.classList].some((c) => c.startsWith("sp-"))) {
      el.classList.add("sp-action");
      dChanged(el.dataset.id);
    }
    prev = el;
    node = next;
  }
  if (!box.firstElementChild) {
    const para = document.createElement("p");
    if (D.doc && D.doc.kind === "script") para.className = "sp-action";
    para.append(document.createElement("br"));
    para.dataset.id = dNewId();
    para.dataset.pos = dPosBetween("", null);
    box.append(para);
    dChanged(para.dataset.id);
  }
  D.applying = false;
  if (D.observer) D.observer.takeRecords();
}

function dChanged(id) { D.pending.add(id); D.deleted.delete(id); }

function dBlockOf(node) {
  const box = $("#dtext");
  while (node && node.parentNode !== box) node = node.parentNode;
  return node && node.nodeType === 1 ? node : null;
}

function dMutations(records) {
  if (D.applying) return;
  const box = $("#dtext");
  if (records.every((r) => r.target === box && r.type === "attributes")) return;  // (the box's own look, not the document)
  const gone = [];
  for (const r of records) {
    if (r.target === box) {
      for (const n of r.removedNodes) if (n.nodeType === 1 && n.dataset && n.dataset.id) gone.push(n.dataset.id);
      for (const n of r.addedNodes) if (n.nodeType === 1 && n.dataset && n.dataset.id) dChanged(n.dataset.id);
      continue;
    }
    const b = dBlockOf(r.target);
    if (b && b.dataset.id) dChanged(b.dataset.id);
  }
  dNormalize();
  for (const id of gone) {
    if (!box.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`)) { D.pending.delete(id); D.deleted.add(id); }
  }
  if (!D.pending.size && !D.deleted.size) return;
  dState("Saving...");
  dSyncSoon(700);
}

function dState(text) { const s = $("#dstate"); if (s) s.textContent = text; }

// Pasting: only plain formatting comes along.
function dPaste(e) {
  const html = e.clipboardData && e.clipboardData.getData("text/html");
  if (!html) return;
  e.preventDefault();
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const div = document.createElement("div");
  div.append(dCleanInto(parsed.body, document.createDocumentFragment()));
  document.execCommand("insertHTML", false, div.innerHTML);
}

// Tapping a checklist box ticks it.
function dCheckTap(e) {
  const li = e.target.closest("ul.checklist > li");
  if (!li) return;
  const r = li.getBoundingClientRect();
  if (e.clientX - r.left > 26) return;
  li.classList.toggle("checked");
}

function dCommand(cmd) {
  const box = $("#dtext");
  if (cmd === "done") { if (document.activeElement) document.activeElement.blur(); return; }
  if (document.activeElement !== box) box.focus();
  if (cmd === "bold" || cmd === "italic" || cmd === "underline") document.execCommand(cmd);
  if (cmd === "h2") {
    const sel = getSelection();
    const b = sel.rangeCount && dBlockOf(sel.anchorNode);
    document.execCommand("formatBlock", false, b && b.tagName === "H2" ? "p" : "h2");
  }
  if (cmd === "bullets" || cmd === "checklist") {
    const sel = getSelection();
    const b = sel.rangeCount && dBlockOf(sel.anchorNode);
    const isList = b && b.tagName === "UL";
    const isCheck = isList && b.classList.contains("checklist");
    if (isList && (cmd === "bullets") === !isCheck) { document.execCommand("insertUnorderedList"); }  // same kind: take the list away
    else if (isList) { b.classList.toggle("checklist"); }
    else {
      document.execCommand("insertUnorderedList");
      if (cmd === "checklist") { const nb = dBlockOf(getSelection().anchorNode); if (nb && nb.tagName === "UL") nb.classList.add("checklist"); }
    }
  }
}

// The tool bar sits right on top of the keyboard.
function dKeyboard() {
  const vv = window.visualViewport;
  const tools = $("#dtools");
  if (!tools || !vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  tools.style.transform = kb > 60 ? `translateY(${-kb + Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom")) || 0)}px)` : "";
  tools.classList.toggle("kb", kb > 60);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", dKeyboard);
  window.visualViewport.addEventListener("scroll", dKeyboard);
}

// ---------------------------------------------------------------- saving and getting others' changes

function dSyncSoon(ms) {
  clearTimeout(D.timer);
  D.timer = setTimeout(dSync, ms);
}

async function dSync() {
  if (!S.view || S.view.kind !== "doc" || !D.doc) return;
  if (D.busy) { D.again = true; return; }
  D.busy = true;
  const box = $("#dtext");
  const changes = [];
  const sentHtml = new Map();
  for (const id of D.pending) {
    const el = box && box.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    const html = dBlockHtml(el);
    changes.push({ id, pos: el.dataset.pos, html });
    sentHtml.set(id, html);
  }
  for (const id of D.deleted) changes.push({ id, pos: (D.store.get(id) || {}).pos || "0", html: "", deleted: true });
  const sentDeleted = new Set(D.deleted);
  D.pending.clear(); D.deleted.clear();
  const title = D.titleDirty && $("#dtitle") ? $("#dtitle").value : null;
  D.titleDirty = false;
  const sel = getSelection();
  const at = sel && sel.rangeCount ? dBlockOf(sel.anchorNode) : null;
  try {
    const r = await rpcMe("lelons_doc_sync", { doc_id: D.doc.id, since_rev: D.doc.rev, changes, new_title: title,
      at_block: at ? at.dataset.id : null, typing: changes.length > 0 });
    D.failed = 0;
    for (const [id, html] of sentHtml) { const el = box.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`); D.store.set(id, { pos: el ? el.dataset.pos : "0", html }); }
    for (const id of sentDeleted) D.store.delete(id);
    if (r && S.view && S.view.kind === "doc" && S.view.id === D.doc.id) dApply(r);
    dState(D.pending.size || D.deleted.size ? "Saving..." : "Saved");
  } catch (e) {
    // put them back, to try again
    for (const id of sentHtml.keys()) D.pending.add(id);
    for (const id of sentDeleted) if (!D.pending.has(id)) D.deleted.add(id);
    if (title !== null) D.titleDirty = true;
    D.failed++;
    dState(D.failed > 2 ? "Not saved, no connection" : "Saving...");
    if (/no such document|gone/i.test(e.message)) { toast("That document was deleted or you were removed from it."); D.busy = false; return closeDoc(); }
  }
  D.busy = false;
  if (!S.view || S.view.kind !== "doc") return;
  if (D.again) { D.again = false; return dSync(); }
  dSyncSoon(document.hidden ? 8000 : D.pending.size || D.deleted.size ? 600 : Math.min(1500 * (D.failed + 1), 10000));
}

// Changes from everyone else.
function dApply(r) {
  const box = $("#dtext");
  D.doc.rev = r.rev;
  if (r.title && r.title !== D.doc.title) {
    D.doc.title = r.title;
    const t = $("#dtitle"); if (t && document.activeElement !== t) { t.value = r.title; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  }
  if (r.people) D.doc.people = r.people;
  const hereKey = JSON.stringify(r.here || []);
  if (hereKey !== JSON.stringify(D.here)) {
    D.here = r.here || [];
    const h = $(".dhere");
    if (h) h.innerHTML = D.here.map((x) => avatar(x.username, publicUrl(x.avatar), { small: true, dot: x.typing ? "#ffcf3f" : "#9fd67a" })).join("");
  }
  const sel = getSelection();
  const mine = sel && sel.rangeCount ? dBlockOf(sel.anchorNode) : null;
  let pagesChanged = false;
  D.applying = true;
  for (const b of r.blocks || []) {
    if (D.pending.has(b.id) || D.deleted.has(b.id)) continue;   // yours is newer, it goes next time
    const known = D.store.get(b.id);
    if (!b.deleted && known && known.html === b.html && known.pos === b.pos) continue;  // (your own change coming back)
    if (b.id.startsWith("t~")) pagesChanged = true;
    if (b.deleted) D.store.delete(b.id); else D.store.set(b.id, { pos: b.pos, html: b.html });
    if (dPageOf(b.id) !== D.page || !box) continue;
    const el = box.querySelector(`:scope > [data-id="${CSS.escape(b.id)}"]`);
    if (el && el === mine && document.activeElement === box) continue;  // don't pull the line out from under your finger
    if (el) el.remove();
    if (b.deleted) continue;
    const fresh = dBlockEl(b.id, b);
    let before = null;
    for (const c of box.children) if (dKey(c.dataset.pos, c.dataset.id) > dKey(b.pos, b.id)) { before = c; break; }
    box.insertBefore(fresh, before);
  }
  D.applying = false;
  if (D.observer) D.observer.takeRecords();
  if (pagesChanged && document.activeElement !== box) renderDoc();
}

async function closeDoc() {
  clearTimeout(D.timer);
  if (D.doc && (D.pending.size || D.deleted.size || D.titleDirty)) { D.busy = false; await dSync(); }
  if (D.doc) rpcMe("lelons_doc_close", { doc_id: D.doc.id }).catch(() => {});
  if (D.observer) D.observer.disconnect();
  D.doc = null;
  S.view = { kind: "docs" };
  renderDocsView();
  loadDocs();
}

const DI = {
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>',
  script: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9h16v11H4z"/><path d="M4 9l2-5 14 0-2 5M9 4l-2 5M14 4l-2 5"/></svg>',
  plus: '<svg class="ic" style="color:var(--text)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  bullets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><path d="m4.8 15.8 1.4 1.4 2.6-2.8M11.5 7H20M11.5 16H20"/></svg>',
  kb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="11" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M7 11.5h10M9 19l3 2.5 3-2.5"/></svg>',
};
