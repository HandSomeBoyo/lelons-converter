// Docs: a PDF that keeps its look. The pages show just like the PDF (pdf.js draws them), and what you change
// lies on top: text you click to change, new text, drawings, highlights and pictures. Download puts it all
// into a real PDF again (pdf-lib, in ui/pdflib).
//
// In the document a PDF page is kept as blocks, like everything else (so Save, Collab and copies just work):
//   "<page>~pdf-src-N"  the PDF itself, in pieces: <!--pdfsrc base64-->
//   "<page>~pdf-ed-N"   what's changed on page N of the PDF: <!--pdfed {"items": [...]}-->
//   "pdf-thumb"         (a PDF document) the little picture on the Docs home: <!--pdfthumb data:image/jpeg...-->
// (the first page of a document has no "<page>~" in front.) Places on a page are in PDF points, from the top left.
//
// An item is one of:
//   {id, type: "text", x, y (the baseline), size, text, bold, italic, font: "sans"|"serif"|"mono", color, from?, cover?}
//      from: the PDF's own text it replaces (cover: the box painted over it, in the paper's color)
//   {id, type: "ink", color, width, alpha, points: [[x, y], ...]}   (a highlight is ink you can see through)
//   {id, type: "image", x, y, w, h, src}

const PDFE_CHUNK = 450000;           // characters of the PDF in one block (Collab takes up to 600000)
const PDFE_MAX_LOCAL = 20 * 1024 * 1024;
const PDFE_MAX_COLLAB = 10 * 1024 * 1024;
const PDFE_COLORS = ["#111111", "#ffffff", "#e03131", "#f08c00", "#ffd43b", "#2f9e44", "#1c7ed6", "#7048e8"];
const PDFE_FONTS = {
  sans: { css: "Arial, 'Liberation Sans', Helvetica, sans-serif", base: 0.9465 },
  serif: { css: "'Times New Roman', Times, 'Liberation Serif', serif", base: 0.9375 },
  mono: { css: "'Courier New', Courier, 'Liberation Mono', monospace", base: 0.8665 },
};
const PDFE_TOOLS = [
  ["select", "pointer", "Change text: click any text on the page"],
  ["text", "textbox", "Add text: click where it goes"],
  ["draw", "pen", "Draw"],
  ["highlight", "marker", "Highlight"],
  ["erase", "eraser", "Eraser: rub out drawings and highlights"],
];

let pdfe = null; // the PDF page on screen

const pdfePrefix = (tab) => (tab ? tab + "~" : "");
const pdfeIsPage = (tab) => !!doc && docStore.has(pdfePrefix(tab) + "pdf-src-0");
const pdfeEsc = (json) => json.replace(/[-<>]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const pdfeNewId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- the PDF kept in blocks

function pdfeToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function pdfeFromBase64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pdfeSrcBlocks(prefix, bytes) {
  const text = pdfeToBase64(bytes), blocks = [];
  for (let i = 0, n = 0; i < text.length; i += PDFE_CHUNK, n++) {
    blocks.push({ id: prefix + "pdf-src-" + n, pos: "1-" + String(n).padStart(5, "0"), html: "<!--pdfsrc " + text.slice(i, i + PDFE_CHUNK) + "-->" });
  }
  return blocks;
}

function pdfeReadSrc(prefix) {
  const parts = [];
  for (let n = 0; docStore.has(prefix + "pdf-src-" + n); n++) {
    const m = /^<!--pdfsrc ([A-Za-z0-9+/=]*)-->$/.exec(docStore.get(prefix + "pdf-src-" + n).html);
    if (!m) return null;
    parts.push(m[1]);
  }
  try { return parts.length ? pdfeFromBase64(parts.join("")) : null; } catch (e) { return null; }
}

function pdfeReadItems(prefix, n) {
  const b = docStore.get(prefix + "pdf-ed-" + n);
  const m = b && /^<!--pdfed (.*)-->$/s.exec(b.html);
  if (!m) return [];
  try { const items = JSON.parse(m[1]).items; return Array.isArray(items) ? items.filter((it) => it && typeof it === "object" && it.id) : []; } catch (e) { return []; }
}

// ---------------------------------------------------------------- bringing a PDF in (keeping its look)

// The PDF opened just to check it and to name it. Null when it can't be kept like this (a password, or not a PDF).
async function pdfeLook(file, where) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const max = where === "collab" ? PDFE_MAX_COLLAB : PDFE_MAX_LOCAL;
  if (bytes.length > max) {
    docToast(`This PDF is too big to keep as it is (up to ${max / 1024 / 1024} MB${where === "collab" ? " in Collab" : ""}). Turn it into a document instead.`);
    return null;
  }
  const lib = await pdfLoadLib();
  let pdf = null;
  try {
    const task = lib.getDocument({ data: bytes.slice(), cMapUrl: "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "pdfjs/standard_fonts/", isEvalSupported: false });
    task.onPassword = () => task.destroy();
    pdf = await task.promise;
    let title = "";
    try { const meta = await pdf.getMetadata(); title = String((meta.info && meta.info.Title) || "").trim(); } catch (e) { title = ""; }
    if (!title || title.length > 120 || /^(untitled|microsoft word|document\d*)\b|\.(docx?|pdf|pages)$/i.test(title)) title = file.name.replace(/\.pdf$/i, "");
    return { bytes, pages: pdf.numPages, title: title || "PDF", thumb: await pdfeThumb(pdf) };
  } catch (err) {
    docToast(err && err.name === "PasswordException" ? "This PDF has a password, so it can only come in as a document."
      : "Couldn't read that PDF. Is it really a PDF?");
    return null;
  } finally {
    if (pdf) pdf.destroy();
  }
}

// The first page, very small (it has to fit in the 2000 characters the Docs home gets of a block).
async function pdfeThumb(pdf) {
  try {
    const page = await pdf.getPage(1);
    for (const [width, quality] of [[120, 0.55], [100, 0.45], [84, 0.4], [70, 0.35]]) {
      const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length < 1900) return url;
    }
  } catch (e) { /* no picture then */ }
  return "";
}

// "Keep how it looks" or "Turn it into a document"? Gives "keep", "convert" or null.
async function pdfAskMode() {
  const answer = await docAsk("How do you want to open it?",
    "Keep how it looks: it opens just like the PDF, and you click any text to change it, or write, draw and add pictures on it. "
    + "Or turn it into a document: the text becomes normal text you can restyle freely, but the layout won't stay the same.",
    "Keep how it looks", { other: "Turn into a document" });
  return answer === true ? "keep" : answer === "other" ? "convert" : null;
}

async function pdfeImportAsDoc(file) {
  const where = docsWhere === "collab" && sfxUser() ? "collab" : "local";
  pdfShowProgress("Opening the PDF...", 0, 0);
  const r = await pdfeLook(file, where).finally(() => { $("docImportModal").hidden = true; });
  if (!r) return;
  const blocks = [...(r.thumb ? [{ id: "pdf-thumb", pos: "0", html: "<!--pdfthumb " + r.thumb + "-->" }] : []), ...pdfeSrcBlocks("", r.bytes)];
  const res = await api("/api/docs-create", { where, title: r.title, kind: "doc", blocks, settings: { type: "pdf" } }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't make the document. Try again.");
  if (docsFolderAt) { docsF().place[res.id] = docsFolderAt; saveFolders(); }
  await openDoc(where, res.id);
  docToast(`Opened ${r.pages} ${r.pages === 1 ? "page" : "pages"}. Click any text to change it, or use the tools at the top to write, draw and add pictures.`);
}

async function pdfeImportAsPage(file) {
  const d = doc;
  pdfShowProgress("Opening the PDF...", 0, 0);
  const r = await pdfeLook(file, d.where).finally(() => { $("docImportModal").hidden = true; });
  if (!r || doc !== d) return;
  const id = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  const list = docTabsList();
  const pos = posBetween(list.length ? list[list.length - 1].pos : "", null);
  docStore.set("t~" + id, { pos, html: docTabHtml({ title: r.title.slice(0, 100), parent: "", type: "pdf", settings: {} }) });
  docPending.add("t~" + id);
  for (const b of pdfeSrcBlocks(id + "~", r.bytes)) { docStore.set(b.id, { pos: b.pos, html: b.html }); docPending.add(b.id); }
  docMarkDirty();
  docShowTab(id);
  docToast(`Added ${r.pages} ${r.pages === 1 ? "page" : "pages"}. Click any text to change it.`);
}

// ---------------------------------------------------------------- showing it

// Called whenever the page on screen changes (opening a document, switching pages).
async function pdfeShow() {
  const tab = doc ? docTab : null;
  if (pdfe && pdfe.tab === tab && doc === pdfe.doc) return;
  pdfeHide();
  const on = tab !== null && pdfeIsPage(tab);
  document.body.classList.toggle("doc-pdf", on);
  $("docPage").hidden = on;
  $("pdfeView").hidden = !on;
  if (!on) return;
  const prefix = pdfePrefix(tab);
  const bytes = pdfeReadSrc(prefix);
  const me = pdfe = { doc, tab, prefix, bytes, pdf: null, pages: [], items: [], saved: [], tool: "select",
                      colors: { text: "#111111", draw: "#111111", highlight: "#ffd43b" }, sizes: { text: 12, draw: 2, highlight: 14 },
                      sel: null, undo: [], redo: [], zoom: 1 };
  $("pdfeView").replaceChildren();
  if (!bytes) { $("pdfeView").textContent = "This PDF couldn't be opened."; return; }
  try {
    const lib = await pdfLoadLib();
    me.pdf = await lib.getDocument({ data: bytes.slice(), cMapUrl: "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "pdfjs/standard_fonts/", isEvalSupported: false }).promise;
  } catch (e) {
    if (pdfe === me) $("pdfeView").textContent = "This PDF couldn't be opened.";
    return;
  }
  if (pdfe !== me) { me.pdf.destroy(); return; }
  for (let n = 1; n <= me.pdf.numPages; n++) {
    const page = await me.pdf.getPage(n);
    if (pdfe !== me) return;
    const vp = page.getViewport({ scale: 1 });
    const el = document.createElement("div");
    el.className = "pdfe-page";
    el.dataset.n = n;
    el.innerHTML = `<canvas></canvas><div class="pdfe-segs"></div><svg class="pdfe-ink"></svg><svg class="pdfe-ink hl"></svg><div class="pdfe-items"></div>`;
    me.pages.push({ n, page, vp, w: vp.width, h: vp.height, el, segs: null, drawn: 0 });
    me.items.push(pdfeReadItems(prefix, n));
    me.saved.push(JSON.stringify({ items: me.items[n - 1] }));
    $("pdfeView").append(el);
    pdfePageEvents(me.pages[n - 1]);
  }
  pdfeFit();
  for (const p of me.pages) { pdfeDrawItems(p.n); pdfeWatch.observe(p.el); }
  pdfeToolState();
  docCount();
  drawOutline();
}

function pdfeHide() {
  if (!pdfe) return;
  const was = pdfe;
  pdfeStore();
  pdfe = null;
  for (const p of was.pages) pdfeWatch.unobserve(p.el);
  if (was.pdf) was.pdf.destroy();
  $("pdfeView").replaceChildren();
  document.body.classList.remove("doc-pdf");
  $("docPage").hidden = false;
  $("pdfeView").hidden = true;
}

// Pages are drawn when they come near the screen (and again at a new zoom).
const pdfeWatch = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting || !pdfe) continue;
    const p = pdfe.pages[+e.target.dataset.n - 1];
    if (p && p.drawn !== pdfe.zoom) pdfeRender(p);
  }
}, { rootMargin: "800px 0px" });

async function pdfeRender(p) {
  const me = pdfe, zoom = me.zoom;
  p.drawn = zoom;
  const s = zoom * 96 / 72, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const vp = p.page.getViewport({ scale: s * dpr });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  try {
    if (p.task) p.task.cancel();
    p.task = p.page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
    await p.task.promise;
  } catch (e) { return; }
  p.task = null;
  if (pdfe !== me || p.drawn !== zoom) return;
  canvas.className = "pdfe-canvas";
  p.el.querySelector("canvas").replaceWith(canvas);
  if (!p.segs) await pdfeFindText(p);
}

// The PDF's own text, as pieces you can click to change: a line, or each part of a line with a big gap in it.
async function pdfeFindText(p) {
  const me = pdfe;
  let bits;
  try {
    await p.page.getOperatorList(); // (the fonts, for their names)
    bits = pdfPageBits(p.page, p.vp, await p.page.getTextContent());
  } catch (e) { return; }
  if (pdfe !== me) return;
  const all = bits.slice();
  const segs = [];
  for (const l of pdfLines(bits, p.vp.width)) {
    const parts = l.cells ? l.cells.map((c) => ({ x0: c.x0, x1: c.x1, text: c.text })) : [{ x0: l.x0, x1: l.x1, text: l.text }];
    for (const part of parts) {
      const mine = all.filter((b) => b.x >= part.x0 - 0.5 && b.x1 <= part.x1 + 0.5 && Math.abs(b.y - l.y) < l.size * 0.5 && b.str.trim());
      const most = (fn) => mine.filter(fn).length > mine.length / 2;
      segs.push({ ...part, y: mine.length ? pdfMode(mine.map((b) => [b.y, b.str.length])) : l.y, size: Math.max(...mine.map((b) => b.size), l.size), bold: most((b) => b.bold), italic: most((b) => b.italic),
                  font: most((b) => b.mono) ? "mono" : most((b) => b.serif) ? "serif" : "sans" });
    }
  }
  p.segs = segs;
  pdfeDrawSegs(p);
}

const pdfeSegKey = (seg) => Math.round(seg.x0 * 10) + ":" + Math.round(seg.y * 10);

function pdfeDrawSegs(p) {
  if (!pdfe || !p.segs) return;
  const s = pdfe.zoom * 96 / 72;
  const taken = new Set(pdfe.items[p.n - 1].filter((it) => it.from).map((it) => it.from));
  const box = p.el.querySelector(".pdfe-segs");
  box.replaceChildren(...p.segs.filter((seg) => !taken.has(pdfeSegKey(seg))).map((seg) => {
    const el = document.createElement("div");
    el.className = "pdfe-seg";
    Object.assign(el.style, { left: (seg.x0 - 1) * s + "px", top: (seg.y - seg.size * 0.98) * s + "px", width: (seg.x1 - seg.x0 + 2) * s + "px", height: seg.size * 1.28 * s + "px" });
    el.addEventListener("click", (e) => { if (pdfe && pdfe.tool === "select") pdfeEditSeg(p, seg, e); });
    return el;
  }));
}

function pdfeFit() {
  if (!pdfe || !pdfe.pages.length) return;
  const widest = Math.max(...pdfe.pages.map((p) => p.w)) * 96 / 72;
  const room = $("docCanvas").clientWidth - 24;
  const fit = Math.min(1.6, Math.max(0.3, room / widest));
  const want = loadPref("docZoom") || "fit";
  const zoom = want === "fit" ? fit : Math.max(0.25, Math.min(3, +want / 100 || 1));
  $("docZoom").textContent = Math.round(zoom * 100) + "%";
  $("docZoom").title = want === "fit" ? "Zoom (fits the window)" : "Zoom";
  if (Math.abs(zoom - pdfe.zoom) < 0.001 && pdfe.pages[0].el.style.width) return;
  pdfe.zoom = zoom;
  const s = zoom * 96 / 72;
  for (const p of pdfe.pages) {
    p.el.style.width = p.w * s + "px";
    p.el.style.height = p.h * s + "px";
    p.el.style.setProperty("--s", s);
    for (const svg of p.el.querySelectorAll(".pdfe-ink")) svg.setAttribute("viewBox", `0 0 ${p.w} ${p.h}`);
    pdfeDrawItems(p.n);
    pdfeDrawSegs(p);
    const r = p.el.getBoundingClientRect();
    if (r.bottom > -800 && r.top < innerHeight + 800) pdfeRender(p);
  }
}

// ---------------------------------------------------------------- drawing the changes

function pdfeDrawItems(n) {
  if (!pdfe) return;
  const p = pdfe.pages[n - 1], items = pdfe.items[n - 1];
  const s = pdfe.zoom * 96 / 72;
  const layer = p.el.querySelector(".pdfe-items");
  const editing = layer.querySelector(".pdfe-text:focus");
  const els = [];
  for (const it of items) {
    if (it.type === "text") {
      if (it.cover) {
        const c = document.createElement("div");
        c.className = "pdfe-cover";
        Object.assign(c.style, { left: it.cover.x0 * s + "px", top: it.cover.top * s + "px", width: (it.cover.x1 - it.cover.x0) * s + "px",
                                 height: (it.cover.bottom - it.cover.top) * s + "px", background: it.cover.color || "#fff" });
        els.push(c);
      }
      let t = editing && editing.dataset.id === it.id ? editing : null;
      if (!t) {
        t = document.createElement("div");
        t.className = "pdfe-text";
        t.dataset.id = it.id;
        t.contentEditable = "plaintext-only";
        t.spellcheck = false;
        t.textContent = it.text;
        pdfeTextEvents(t, n);
      }
      const f = PDFE_FONTS[it.font] || PDFE_FONTS.sans;
      Object.assign(t.style, { left: it.x * s + "px", top: (it.y - it.size * f.base) * s + "px", fontSize: it.size * s + "px", fontFamily: f.css,
                               fontWeight: it.bold ? "700" : "400", fontStyle: it.italic ? "italic" : "normal", color: it.color || "#111" });
      t.classList.toggle("sel", !!pdfe.sel && pdfe.sel.id === it.id);
      els.push(t);
    } else if (it.type === "image") {
      const img = document.createElement("div");
      img.className = "pdfe-image" + (pdfe.sel && pdfe.sel.id === it.id ? " sel" : "");
      img.dataset.id = it.id;
      Object.assign(img.style, { left: it.x * s + "px", top: it.y * s + "px", width: it.w * s + "px", height: it.h * s + "px" });
      img.innerHTML = `<img alt="" draggable="false"><i class="pdfe-resize"></i>`;
      img.querySelector("img").src = it.src;
      pdfeImageEvents(img, n);
      els.push(img);
    }
  }
  // The little bar over what's picked: move it, take it away.
  const it = pdfe.sel && pdfe.sel.n === n && items.find((x) => x.id === pdfe.sel.id);
  if (it && it.type !== "ink") {
    const bar = document.createElement("div");
    bar.className = "pdfe-bar";
    const x = it.type === "text" ? it.x : it.x, y = it.type === "text" ? it.y - it.size * (PDFE_FONTS[it.font] || PDFE_FONTS.sans).base : it.y;
    Object.assign(bar.style, { left: x * s + "px", top: y * s + "px" });
    bar.innerHTML = `<button type="button" class="pdfe-move" title="Drag to move">${docIcon("move")}</button>`
      + `<button type="button" class="pdfe-del" title="${it.from ? "Put the PDF's own text back" : "Delete"}">${docIcon(it.from ? "undo" : "trash")}</button>`;
    bar.addEventListener("mousedown", (e) => e.preventDefault()); // (the text keeps the focus)
    bar.querySelector(".pdfe-move").addEventListener("pointerdown", (e) => pdfeDrag(e, n, it.id, "move"));
    bar.querySelector(".pdfe-del").addEventListener("click", () => pdfeRemove(n, it.id));
    els.push(bar);
  }
  layer.replaceChildren(...els);
  if (editing && !editing.isConnected) editing.blur();
  // Drawings: one picture for the pen, one for the highlights (those mix with the page like a real marker).
  const path = (it) => `<path d="${pdfePath(it.points)}" stroke="${it.color}" stroke-width="${it.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" data-id="${it.id}"/>`;
  const [ink, hl] = p.el.querySelectorAll(".pdfe-ink");
  ink.innerHTML = items.filter((it) => it.type === "ink" && !(it.alpha < 1)).map(path).join("");
  hl.innerHTML = items.filter((it) => it.type === "ink" && it.alpha < 1).map((it) => path(it).replace("<path ", `<path stroke-opacity="${it.alpha}" `)).join("");
}

const pdfePath = (pts) => pts.length ? "M" + pts.map((q) => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L") + (pts.length === 1 ? "l0.01 0" : "") : "";

// ---------------------------------------------------------------- changing things

// Before every change: what it was, for Undo.
function pdfeSnap() {
  if (!pdfe) return;
  pdfe.undo.push(JSON.stringify(pdfe.items));
  if (pdfe.undo.length > 80) pdfe.undo.shift();
  pdfe.redo = [];
  pdfeUndoButtons();
}
function pdfeUndoGo(dir) {
  if (!pdfe) return;
  const from = dir < 0 ? pdfe.undo : pdfe.redo, to = dir < 0 ? pdfe.redo : pdfe.undo;
  if (!from.length) return;
  if (document.activeElement && document.activeElement.classList.contains("pdfe-text")) document.activeElement.blur();
  to.push(JSON.stringify(pdfe.items));
  pdfe.items = JSON.parse(from.pop());
  pdfe.sel = null;
  for (const p of pdfe.pages) { pdfeDrawItems(p.n); pdfeDrawSegs(p); }
  pdfeChanged();
  pdfeUndoButtons();
}
function pdfeUndoButtons() {
  const u = $("docToolbar").querySelector('[data-pdfe="undo"]'), r = $("docToolbar").querySelector('[data-pdfe="redo"]');
  if (u) u.disabled = !pdfe || !pdfe.undo.length;
  if (r) r.disabled = !pdfe || !pdfe.redo.length;
}

// The changes go into the document's blocks (so Save keeps them; in Collab they go to the others).
let pdfeStoreTimer = 0;
function pdfeChanged(now) {
  clearTimeout(pdfeStoreTimer);
  if (now) pdfeStore(); else pdfeStoreTimer = setTimeout(pdfeStore, 250);
  docMarkDirty();
}
function pdfeStore() {
  clearTimeout(pdfeStoreTimer);
  if (!pdfe || doc !== pdfe.doc) return;
  let changed = false;
  pdfe.items.forEach((items, i) => {
    const json = JSON.stringify({ items });
    if (json === pdfe.saved[i]) return;
    pdfe.saved[i] = json;
    const id = pdfe.prefix + "pdf-ed-" + (i + 1);
    if (!items.length) {
      if (docStore.has(id)) { docStore.delete(id); docPending.delete(id); docDeleted.add(id); changed = true; }
      return;
    }
    docStore.set(id, { pos: "2-" + String(i + 1).padStart(5, "0"), html: "<!--pdfed " + pdfeEsc(json) + "-->" });
    docDeleted.delete(id);
    docPending.add(id);
    changed = true;
  });
  if (changed) docMarkDirty();
}

// Someone else's changes (Collab) came in.
function pdfeRemote() {
  if (!pdfe) return;
  pdfe.items.forEach((items, i) => {
    const fresh = pdfeReadItems(pdfe.prefix, i + 1);
    const json = JSON.stringify({ items: fresh });
    if (json === pdfe.saved[i]) return;
    if (pdfe.pages[i].el.querySelector(".pdfe-text:focus")) return; // (you're writing there: after)
    pdfe.items[i] = fresh;
    pdfe.saved[i] = json;
    pdfeDrawItems(i + 1);
    pdfeDrawSegs(pdfe.pages[i]);
  });
}

function pdfeFind(n, id) { return pdfe && pdfe.items[n - 1].find((it) => it.id === id); }

function pdfeSelect(n, id) {
  const was = pdfe.sel;
  pdfe.sel = id ? { n, id } : null;
  if (was && was.n !== n) pdfeDrawItems(was.n);
  pdfeDrawItems(n);
  pdfeToolState();
}

function pdfeRemove(n, id) {
  const items = pdfe.items[n - 1];
  if (!items.some((it) => it.id === id)) return;
  pdfeSnap();
  pdfe.items[n - 1] = items.filter((it) => it.id !== id);
  if (pdfe.sel && pdfe.sel.id === id) pdfe.sel = null;
  pdfeDrawItems(n);
  pdfeDrawSegs(pdfe.pages[n - 1]);
  pdfeChanged(true);
  pdfeToolState();
}

// The colors right there on the page: the paper behind the words, and the words' own color.
function pdfeColors(p, seg) {
  const canvas = p.el.querySelector("canvas.pdfe-canvas");
  if (!canvas) return { bg: "#ffffff", ink: "#111111" };
  const k = canvas.width / p.w;
  const x0 = Math.max(0, Math.floor((seg.x0 - 2) * k)), x1 = Math.min(canvas.width, Math.ceil((seg.x1 + 2) * k));
  const y0 = Math.max(0, Math.floor((seg.y - seg.size * 1.05) * k)), y1 = Math.min(canvas.height, Math.ceil((seg.y + seg.size * 0.35) * k));
  if (x1 <= x0 || y1 <= y0) return { bg: "#ffffff", ink: "#111111" };
  let data;
  try { data = canvas.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data; } catch (e) { return { bg: "#ffffff", ink: "#111111" }; }
  const w = x1 - x0, h = y1 - y0;
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  // the paper: the most common color around the edge of the box
  const count = new Map();
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(at(x, 0), at(x, h - 1));
  for (let y = 0; y < h; y++) edge.push(at(0, y), at(w - 1, y));
  for (const c of edge) { const key = c.map((v) => v >> 3).join(","); count.set(key, (count.get(key) || 0) + 1); }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map((v) => +v);
  const bg = edge.filter((c) => c.every((v, i) => v >> 3 === top[i]))
    .reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2], a[3] + 1], [0, 0, 0, 0]);
  const paper = [bg[0] / bg[3], bg[1] / bg[3], bg[2] / bg[3]].map(Math.round);
  // the words: the pixel furthest from the paper
  let ink = [17, 17, 17], far = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y), d = (c[0] - paper[0]) ** 2 + (c[1] - paper[1]) ** 2 + (c[2] - paper[2]) ** 2;
    if (d > far) { far = d; ink = c; }
  }
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  return { bg: hex(paper), ink: far < 900 ? "#111111" : hex(ink) };
}

// Clicking the PDF's own text: it's covered over and the same words come back, now yours to change.
function pdfeEditSeg(p, seg, e) {
  const n = p.n, { bg, ink } = pdfeColors(p, seg);
  pdfeSnap();
  const it = { id: pdfeNewId(), type: "text", from: pdfeSegKey(seg), x: seg.x0, y: seg.y, size: Math.round(seg.size * 10) / 10, text: seg.text,
               bold: seg.bold, italic: seg.italic, font: seg.font, color: ink,
               cover: { x0: seg.x0 - 1, top: seg.y - seg.size * 0.98, x1: seg.x1 + 1, bottom: seg.y + seg.size * 0.3, color: bg } };
  pdfe.items[n - 1].push(it);
  pdfe.sel = { n, id: it.id };
  pdfeDrawItems(n);
  pdfeDrawSegs(p);
  pdfeChanged();
  pdfeToolState();
  const el = p.el.querySelector(`.pdfe-text[data-id="${it.id}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  el._snapped = true; // (Undo already knows)
  // the text cursor goes where you clicked
  const range = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
  const sel = getSelection();
  if (range && el.contains(range.startContainer)) { sel.removeAllRanges(); sel.addRange(range); }
  else { sel.selectAllChildren(el); sel.collapseToEnd(); }
}

function pdfeAddText(p, x, y) {
  const n = p.n;
  pdfeSnap();
  const size = pdfe.sizes.text;
  const it = { id: pdfeNewId(), type: "text", x, y: y + size * 0.35, size, text: "", bold: false, italic: false, font: "sans", color: pdfe.colors.text };
  pdfe.items[n - 1].push(it);
  pdfe.sel = { n, id: it.id };
  pdfeDrawItems(n);
  const el = p.el.querySelector(`.pdfe-text[data-id="${it.id}"]`);
  if (el) { el._snapped = true; el._fresh = true; el.focus({ preventScroll: true }); }
  pdfeToolState();
}

function pdfeTextEvents(t, n) {
  t.addEventListener("focus", () => {
    if (!pdfe) return;
    if (!pdfe.sel || pdfe.sel.id !== t.dataset.id) { pdfe.sel = { n, id: t.dataset.id }; pdfeDrawItems(n); pdfeToolState(); }
  });
  t.addEventListener("beforeinput", () => { if (!t._snapped) { pdfeSnap(); t._snapped = true; } });
  t.addEventListener("input", () => {
    const it = pdfeFind(n, t.dataset.id);
    if (!it) return;
    it.text = t.innerText.replace(/\n$/, "");
    pdfeChanged();
  });
  t.addEventListener("blur", () => {
    t._snapped = false;
    const it = pdfeFind(n, t.dataset.id);
    // New text that stayed empty isn't kept (the PDF's own text emptied is: that's how words are taken out).
    if (it && !it.from && !it.text.trim()) {
      pdfe.items[n - 1] = pdfe.items[n - 1].filter((x) => x !== it);
      if (!t._fresh) pdfeSnap();
      if (pdfe.undo.length && t._fresh) pdfe.undo.pop(); // (adding it and taking it away: nothing happened)
      pdfeUndoButtons();
      pdfeChanged(true);
    }
    t._fresh = false;
    setTimeout(() => {
      if (!pdfe || !pdfe.sel || pdfe.sel.id !== t.dataset.id) return;
      const active = document.activeElement;
      if (active && (active.closest(".pdfe-bar") || active.closest("#docToolbar") || active.closest("#docPop"))) return;
      pdfeSelect(n, null);
    }, 0);
  });
  t.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); t.blur(); }
  });
  t.addEventListener("pointerdown", (e) => {
    if (pdfe && pdfe.tool !== "select" && pdfe.tool !== "text") e.preventDefault();
  });
}

function pdfeImageEvents(box, n) {
  box.addEventListener("pointerdown", (e) => {
    if (!pdfe || (pdfe.tool !== "select" && pdfe.tool !== "text")) return;
    e.preventDefault();
    e.stopPropagation();
    if (document.activeElement && document.activeElement.classList.contains("pdfe-text")) document.activeElement.blur();
    if (!pdfe.sel || pdfe.sel.id !== box.dataset.id) pdfeSelect(n, box.dataset.id);
    pdfeDrag(e, n, box.dataset.id, e.target.classList.contains("pdfe-resize") ? "size" : "move");
  });
}

// Moving (or sizing) something with the mouse.
function pdfeDrag(e, n, id, how) {
  const it = pdfeFind(n, id);
  if (!it) return;
  e.preventDefault();
  e.stopPropagation();
  const s = pdfe.zoom * 96 / 72, start = { x: e.clientX, y: e.clientY, ix: it.x, iy: it.y, w: it.w, h: it.h };
  let moved = false;
  const move = (ev) => {
    const dx = (ev.clientX - start.x) / s, dy = (ev.clientY - start.y) / s;
    if (!moved && Math.hypot(dx, dy) * s < 3) return;
    if (!moved) { pdfeSnap(); moved = true; }
    if (how === "size") {
      const w = Math.max(12, start.w + dx);
      it.w = w; it.h = w * start.h / start.w;
    } else {
      it.x = start.ix + dx; it.y = start.iy + dy;
    }
    pdfeDrawItems(n);
  };
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    if (moved) pdfeChanged();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

function pdfePageEvents(p) {
  const at = (e) => { const r = p.el.getBoundingClientRect(), s = pdfe.zoom * 96 / 72; return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; };
  p.el.addEventListener("pointerdown", (e) => {
    if (!pdfe || e.button !== 0) return;
    const tool = pdfe.tool;
    if (e.target.closest(".pdfe-text, .pdfe-bar, .pdfe-image")) return;
    if (tool === "select") {
      if (!e.target.closest(".pdfe-seg") && pdfe.sel) { if (document.activeElement && document.activeElement.classList.contains("pdfe-text")) document.activeElement.blur(); pdfeSelect(p.n, null); }
      return;
    }
    if (tool === "text") {
      e.preventDefault();
      if (document.activeElement && document.activeElement.classList.contains("pdfe-text")) { document.activeElement.blur(); return; } // (first click just ends the text you were writing)
      const [x, y] = at(e);
      pdfeAddText(p, x, y);
      return;
    }
    e.preventDefault();
    if (document.activeElement && document.activeElement.classList.contains("pdfe-text")) document.activeElement.blur();
    p.el.setPointerCapture(e.pointerId);
    if (tool === "erase") {
      let snapped = false;
      const rub = (ev) => {
        const [x, y] = at(ev), r = 4 / (pdfe.zoom * 96 / 72);
        const items = pdfe.items[p.n - 1];
        const hit = items.filter((it) => it.type === "ink" && it.points.some((q, i) => {
          const a = it.points[Math.max(0, i - 1)];
          return pdfeNear(x, y, a, q) < it.width / 2 + r;
        }));
        if (!hit.length) return;
        if (!snapped) { pdfeSnap(); snapped = true; }
        pdfe.items[p.n - 1] = items.filter((it) => !hit.includes(it));
        pdfeDrawItems(p.n);
      };
      rub(e);
      const up = () => { p.el.removeEventListener("pointermove", rub); p.el.removeEventListener("pointerup", up); if (snapped) pdfeChanged(); };
      p.el.addEventListener("pointermove", rub);
      p.el.addEventListener("pointerup", up);
      return;
    }
    // draw or highlight
    pdfeSnap();
    const hl = tool === "highlight";
    const it = { id: pdfeNewId(), type: "ink", color: pdfe.colors[tool], width: pdfe.sizes[tool], alpha: hl ? 0.4 : 1, points: [at(e).map((v) => Math.round(v * 10) / 10)] };
    pdfe.items[p.n - 1].push(it);
    pdfeDrawItems(p.n);
    const path = p.el.querySelector(`.pdfe-ink path[data-id="${it.id}"]`);
    const move = (ev) => {
      const q = at(ev).map((v) => Math.round(v * 10) / 10), last = it.points[it.points.length - 1];
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.8) return;
      // A highlight goes straight along the line (like a real marker) when Shift is held.
      if (hl && ev.shiftKey) q[1] = it.points[0][1];
      it.points.push(q);
      if (path) path.setAttribute("d", pdfePath(it.points));
    };
    const up = () => {
      p.el.removeEventListener("pointermove", move);
      p.el.removeEventListener("pointerup", up);
      pdfeDrawItems(p.n);
      pdfeChanged();
    };
    p.el.addEventListener("pointermove", move);
    p.el.addEventListener("pointerup", up);
  });
}

// How far the point is from the line a-b.
function pdfeNear(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

// A picture goes in the middle of the page you're looking at.
function pdfeAddImage() {
  if (!pdfe) return;
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file || !pdfe) return;
    const src = await pdfeShrinkImage(file).catch(() => null);
    if (!src || !pdfe) return docToast("Couldn't open that picture.");
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    if (!img || !pdfe) return;
    const mid = innerHeight / 2;
    const p = pdfe.pages.find((q) => { const r = q.el.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || pdfe.pages[0];
    const r = p.el.getBoundingClientRect(), s = pdfe.zoom * 96 / 72;
    const w = Math.min(p.w * 0.5, img.naturalWidth * 0.75), h = w * img.naturalHeight / img.naturalWidth;
    const cy = Math.max(h / 2, Math.min(p.h - h / 2, (mid - r.top) / s));
    pdfeSnap();
    const it = { id: pdfeNewId(), type: "image", x: (p.w - w) / 2, y: cy - h / 2, w, h, src };
    pdfe.items[p.n - 1].push(it);
    pdfe.sel = { n: p.n, id: it.id };
    pdfeDrawItems(p.n);
    pdfeChanged(true);
    pdfeToolState();
  });
  input.click();
}

// Pictures are made small enough to keep (a block can only be so big).
async function pdfeShrinkImage(file) {
  const url = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
  const png = /^data:image\/png/.test(url);
  for (const max of [1600, 1200, 900, 640]) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
    if (out.length < 380000) return out;
    if (png) { const jpg = canvas.toDataURL("image/jpeg", 0.85); if (jpg.length < 380000) return jpg; }
  }
  throw new Error("too big");
}

// ---------------------------------------------------------------- the toolbar

function pdfeToolbar() {
  const sep = '<span class="doc-sep"></span>';
  const b = (key, icon, title) => `<button type="button" class="doc-tool" data-pdfe="${key}" title="${esc(title)}">${docIcon(icon)}</button>`;
  $("docToolbar").innerHTML = [
    b("undo", "undo", "Undo (Ctrl+Z)"), b("redo", "redo", "Redo (Ctrl+Y)"), b("print", "print", "Print (Ctrl+P)"), sep,
    ...PDFE_TOOLS.map(([key, icon, title]) => `<button type="button" class="doc-tool pdfe-tool" data-tool="${key}" title="${esc(title)}">${docIcon(icon)}<span>${esc(title.split(":")[0])}</span></button>`),
    b("image", "image", "Add a picture"), sep,
    `<button type="button" class="doc-tool doc-color pdfe-color" data-pdfe="color" title="Color">${docIcon("color")}<i></i></button>`,
    b("smaller", "minus", "Smaller"), `<span class="pdfe-size" id="pdfeSize"></span>`, b("bigger", "plus", "Bigger"),
    b("bold", "bold", "Bold"), sep,
    `<button type="button" class="doc-tool pdfe-download" data-pdfe="download" title="Download the PDF with your changes">${docIcon("download")}<span>Download PDF</span></button>`,
  ].join("");
  const bar = $("docToolbar");
  bar.querySelectorAll("button").forEach((x) => x.addEventListener("mousedown", (e) => e.preventDefault())); // (the text you're writing keeps the focus)
  bar.querySelectorAll("[data-tool]").forEach((x) => x.addEventListener("click", () => pdfeSetTool(x.dataset.tool)));
  bar.querySelectorAll("[data-pdfe]").forEach((x) => x.addEventListener("click", (e) => { e.stopPropagation(); pdfeCommand(x.dataset.pdfe, x); }));
  pdfeToolState();
}

function pdfeSetTool(tool) {
  if (!pdfe) return;
  pdfe.tool = tool;
  if (document.activeElement && document.activeElement.classList.contains("pdfe-text")) document.activeElement.blur();
  if (pdfe.sel) pdfeSelect(pdfe.sel.n, null);
  pdfeToolState();
}

// What the color and size buttons work on: the text that's picked, or the tool.
function pdfeTarget() {
  const it = pdfe && pdfe.sel && pdfeFind(pdfe.sel.n, pdfe.sel.id);
  if (it && it.type === "text") return { it, kind: "text" };
  const kind = pdfe && (pdfe.tool === "draw" || pdfe.tool === "highlight") ? pdfe.tool : "text";
  return { it: null, kind };
}

function pdfeToolState() {
  if (!pdfe) return;
  const bar = $("docToolbar");
  bar.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("on", x.dataset.tool === pdfe.tool));
  $("pdfeView").dataset.tool = pdfe.tool;
  const { it, kind } = pdfeTarget();
  const color = it ? it.color : pdfe.colors[kind];
  const i = bar.querySelector(".pdfe-color i");
  if (i) i.style.background = color;
  const size = $("pdfeSize");
  if (size) size.textContent = Math.round(it ? it.size : pdfe.sizes[kind]);
  const bold = bar.querySelector('[data-pdfe="bold"]');
  if (bold) { bold.classList.toggle("on", !!(it && it.bold)); bold.disabled = kind !== "text"; }
  pdfeUndoButtons();
}

function pdfeCommand(cmd, button) {
  if (!pdfe) return;
  const { it, kind } = pdfeTarget();
  const edit = (fn) => {
    if (it) { pdfeSnap(); fn(it); pdfeDrawItems(pdfe.sel.n); pdfeChanged(); }
    pdfeToolState();
  };
  if (cmd === "undo") pdfeUndoGo(-1);
  if (cmd === "redo") pdfeUndoGo(1);
  if (cmd === "print") pdfePrint();
  if (cmd === "image") pdfeAddImage();
  if (cmd === "download") pdfeDownload();
  if (cmd === "bold") edit((x) => { x.bold = !x.bold; });
  if (cmd === "smaller" || cmd === "bigger") {
    const steps = kind === "text" ? [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72] : kind === "draw" ? [1, 2, 3, 4, 6, 8, 12] : [6, 8, 10, 12, 14, 18, 24, 32];
    const now = it ? it.size : pdfe.sizes[kind];
    const next = cmd === "bigger" ? steps.find((v) => v > now + 0.05) : [...steps].reverse().find((v) => v < now - 0.05);
    if (next === undefined) return;
    if (it) edit((x) => { x.size = next; }); else { pdfe.sizes[kind] = next; pdfeToolState(); }
  }
  if (cmd === "color") pdfeColorPop(button, kind, it);
}

function pdfeColorPop(button, kind, it) {
  let pop = $("pdfePop");
  if (pop) { pop.remove(); return; }
  pop = Object.assign(document.createElement("div"), { id: "pdfePop", className: "pdfe-pop" });
  for (const c of PDFE_COLORS) {
    const sw = Object.assign(document.createElement("button"), { type: "button", className: "pdfe-swatch", title: c });
    sw.style.background = c;
    sw.addEventListener("mousedown", (e) => e.preventDefault());
    sw.addEventListener("click", () => {
      if (it) { pdfeSnap(); it.color = c; pdfeDrawItems(pdfe.sel.n); pdfeChanged(); } else pdfe.colors[kind] = c;
      pop.remove();
      pdfeToolState();
    });
    pop.append(sw);
  }
  document.body.append(pop);
  const r = button.getBoundingClientRect();
  Object.assign(pop.style, { left: r.left + "px", top: r.bottom + 6 + "px" });
  setTimeout(() => addEventListener("mousedown", function gone(e) { if (!pop.contains(e.target)) { pop.remove(); removeEventListener("mousedown", gone); } }), 0);
}

document.addEventListener("keydown", (e) => {
  if (!pdfe || !doc || $("docEditor").hidden) return;
  if ([...document.querySelectorAll(".modal:not([hidden])")].some((m) => m.getClientRects().length)) return;
  const inText = e.target.classList && e.target.classList.contains("pdfe-text");
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
    if (e.target.tagName === "INPUT") return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (inText) e.target.blur();
    pdfeUndoGo(key === "y" || e.shiftKey ? 1 : -1);
  } else if ((e.ctrlKey || e.metaKey) && key === "p") {
    e.preventDefault(); e.stopImmediatePropagation(); pdfePrint();
  } else if ((e.ctrlKey || e.metaKey) && (key === "f" || key === "h")) {
    e.preventDefault(); e.stopImmediatePropagation();
  } else if ((key === "delete" || key === "backspace") && !inText && e.target === document.body && pdfe.sel) {
    e.preventDefault(); pdfeRemove(pdfe.sel.n, pdfe.sel.id);
  } else if (key === "escape" && pdfe.sel && !inText && $("docPop").hidden) {
    pdfeSelect(pdfe.sel.n, null);
  }
}, true);

// ---------------------------------------------------------------- a real PDF again (download, print)

let pdfeLibLoading = null;
function pdfeLoadWriter() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfeLibLoading) pdfeLibLoading = new Promise((ok, bad) => {
    const s = Object.assign(document.createElement("script"), { src: "pdflib/pdf-lib.min.js" });
    s.onload = () => ok(window.PDFLib);
    s.onerror = () => { pdfeLibLoading = null; bad(new Error("pdf-lib")); };
    document.head.append(s);
  });
  return pdfeLibLoading;
}

// The PDF with everything that was changed drawn into it.
async function pdfeBuild() {
  pdfeStore();
  const L = await pdfeLoadWriter();
  const out = await L.PDFDocument.load(pdfe.bytes, { ignoreEncryption: true });
  const fonts = new Map();
  const fontFor = async (it) => {
    const name = { sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
                   serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
                   mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"] }[it.font in PDFE_FONTS ? it.font : "sans"][(it.bold ? 1 : 0) + (it.italic ? 2 : 0)];
    if (!fonts.has(name)) fonts.set(name, await out.embedFont(L.StandardFonts[name]));
    return fonts.get(name);
  };
  const rgb = (hex) => { const v = parseInt(String(hex || "#111111").slice(1), 16) || 0; return L.rgb((v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255); };
  // (the standard PDF fonts only know the usual Western letters: others become ?)
  const safe = (font, text) => [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch (e) { return "?"; } }).join("");
  const pages = out.getPages();
  for (let i = 0; i < pdfe.pages.length && i < pages.length; i++) {
    const items = pdfe.items[i];
    if (!items.length) continue;
    const page = pages[i], vp = pdfe.pages[i].vp;
    const P = (x, y) => vp.convertToPdfPoint(x, y);
    for (const it of items) {
      if (it.type === "text") {
        if (it.cover) {
          const a = P(it.cover.x0, it.cover.top), b = P(it.cover.x1, it.cover.bottom);
          page.drawRectangle({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), color: rgb(it.cover.color) });
        }
        const font = await fontFor(it);
        it.text.split("\n").forEach((line, k) => {
          if (!line) return;
          const [x, y] = P(it.x, it.y + k * it.size * 1.2);
          page.drawText(safe(font, line), { x, y, size: it.size, font, color: rgb(it.color) });
        });
      } else if (it.type === "ink" && it.points.length) {
        const d = it.points.map((q, k) => { const [x, y] = P(q[0], q[1]); return (k ? "L" : "M") + x.toFixed(2) + " " + (-y).toFixed(2); }).join("") + (it.points.length === 1 ? "l0.01 0" : "");
        page.drawSvgPath(d, { x: 0, y: 0, borderColor: rgb(it.color), borderWidth: it.width, borderOpacity: it.alpha < 1 ? it.alpha : 1,
                              borderLineCap: L.LineCapStyle.Round, ...(it.alpha < 1 ? { blendMode: L.BlendMode.Multiply } : {}) });
      } else if (it.type === "image") {
        const bytes = pdfeFromBase64(it.src.slice(it.src.indexOf(",") + 1));
        const img = /^data:image\/png/.test(it.src) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const a = P(it.x, it.y + it.h), b = P(it.x + it.w, it.y);
        page.drawImage(img, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) });
      }
    }
  }
  return out.save();
}

async function pdfeDownload() {
  if (!pdfe) return;
  const folder = await whereToSave();
  if (folder === null || !pdfe) return;
  docToast("Making the PDF...");
  let bytes;
  try { bytes = await pdfeBuild(); } catch (e) { return docToast("Couldn't make the PDF. Try again."); }
  const title = pdfe.tab ? (docTabsList().find((t) => t.id === pdfe.tab) || {}).title || $("docTitle").value : $("docTitle").value;
  const res = await api("/api/docs-export", { title, ext: "pdf", text: pdfeToBase64(bytes), folder }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't save the file.");
  docToast(`Saved as ${res.fileName}`);
  const t = $("docToast");
  const show = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Show in folder" });
  show.onclick = () => api("/api/docs-show", { path: res.path }).catch(() => null);
  t.append(" ", show);
}

// Printing: the changed PDF, drawn page by page.
async function pdfePrint() {
  if (!pdfe) return;
  docToast("Getting it ready to print...");
  let pdf = null;
  try {
    const bytes = await pdfeBuild();
    const lib = await pdfLoadLib();
    pdf = await lib.getDocument({ data: bytes, cMapUrl: "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "pdfjs/standard_fonts/", isEvalSupported: false }).promise;
    const box = Object.assign(document.createElement("div"), { id: "pdfePrintBox" });
    let size = "";
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 2.4 });
      if (n === 1) { const one = page.getViewport({ scale: 1 }); size = `${one.width}pt ${one.height}pt`; }
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const img = new Image();
      img.src = canvas.toDataURL("image/jpeg", 0.92);
      box.append(img);
    }
    document.body.append(box);
    document.body.classList.add("pdfe-printing");
    const style = Object.assign(document.createElement("style"), { textContent: `@media print { @page { size: ${size}; margin: 0; } }` });
    document.head.append(style);
    document.title = $("docTitle").value;
    const done = () => { document.body.classList.remove("pdfe-printing"); box.remove(); style.remove(); document.title = "VaultHub"; removeEventListener("afterprint", done); };
    addEventListener("afterprint", done);
    $("docToast") && $("docToast").classList.remove("show");
    await Promise.all([...box.querySelectorAll("img")].map((img) => img.decode().catch(() => null)));
    setTimeout(() => { window.print(); setTimeout(done, 500); }, 50);
  } catch (e) {
    docToast("Couldn't get it ready to print.");
  } finally {
    if (pdf) pdf.destroy();
  }
}

// "Turn into a document": the same PDF, made into a normal page next to it.
function pdfeConvert() {
  if (!pdfe) return;
  const title = pdfe.tab ? (docTabsList().find((t) => t.id === pdfe.tab) || {}).title || "PDF" : $("docTitle").value;
  importPdfAsPage(new File([pdfe.bytes], title + ".pdf", { type: "application/pdf" }), "convert");
}

// ---------------------------------------------------------------- the menus, the side and the bottom bar

function pdfeMenuItems(name) {
  if (name === "file") return [
    { label: "New document", icon: "plus", fn: docNewFromMenu },
    { label: "Make a copy", icon: "copy", fn: () => docCopyTo(doc.where) },
    doc.where === "local" ? (sfxUser() ? { label: "Share a copy in Collab", icon: "people", fn: () => docCopyTo("collab") } : null)
      : { label: "Save a copy in Local", icon: "lock", fn: () => docCopyTo("local") },
    "-",
    { label: "Save", icon: "save", key: "Ctrl+S", fn: docSave },
    { label: "Rename", icon: "rename", fn: () => { $("docTitle").focus(); $("docTitle").select(); } },
    "-",
    { label: "Download the PDF", icon: "download", fn: pdfeDownload },
    { label: "Print", icon: "print", key: "Ctrl+P", fn: pdfePrint },
    { label: "Import a PDF as a page", icon: "pdf", fn: () => pickPdf(importPdfAsPage) },
    { label: "Turn it into a normal document", icon: "doc", fn: pdfeConvert },
    "-",
    doc.where === "collab" && !doc.mine
      ? { label: "Leave this document", icon: "leave", danger: true, fn: () => docCardRemove({ id: doc.id, title: doc.title, mine: false }, true).then((gone) => gone && closeDoc()) }
      : { label: "Delete", icon: "trash", danger: true, fn: docDeleteOpen },
  ];
  if (name === "edit") return [
    { label: "Undo", icon: "undo", key: "Ctrl+Z", fn: () => pdfeUndoGo(-1), disabled: !pdfe.undo.length },
    { label: "Redo", icon: "redo", key: "Ctrl+Y", fn: () => pdfeUndoGo(1), disabled: !pdfe.redo.length },
    "-",
    { label: "Delete what's picked", icon: "trash", key: "Del", fn: () => pdfe.sel && pdfeRemove(pdfe.sel.n, pdfe.sel.id), disabled: !pdfe.sel },
  ];
  if (name === "view") return [
    { label: "Pages on the side", icon: "outline", on: !$("docOutline").hidden, fn: () => docCommand("outline") },
    { label: "Zoom", icon: "zoom", more: "zoom" },
  ];
  if (name === "insert") return [
    { label: "Text", icon: "textbox", fn: () => pdfeSetTool("text") },
    { label: "Picture", icon: "image", fn: pdfeAddImage },
    { label: "Drawing", icon: "pen", fn: () => pdfeSetTool("draw") },
    { label: "Highlight", icon: "marker", fn: () => pdfeSetTool("highlight") },
  ];
  if (name === "format") {
    const { it } = pdfeTarget();
    return [
      { label: "Bold", icon: "bold", on: !!(it && it.bold), fn: () => pdfeCommand("bold"), disabled: !it },
      { label: "Bigger", icon: "plus", fn: () => pdfeCommand("bigger") },
      { label: "Smaller", icon: "minus", fn: () => pdfeCommand("smaller") },
    ];
  }
  if (name === "tools") return [{ label: "Turn it into a normal document", icon: "doc", fn: pdfeConvert }];
  return [];
}

function pdfeOutline() {
  $("docOutlineTitle").textContent = "In this PDF";
  const items = (pdfe ? pdfe.pages : []).map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "doc-outline-item lvl-1";
    b.innerHTML = "<span></span>";
    b.querySelector("span").textContent = "Page " + p.n;
    b.addEventListener("click", () => p.el.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" }));
    return b;
  });
  $("docOutlineList").replaceChildren(...items);
}

function pdfeCount() {
  const n = pdfe ? pdfe.pages.length : 0;
  $("docCount").textContent = n ? `${n} ${n === 1 ? "page" : "pages"} · PDF` : "PDF";
}
