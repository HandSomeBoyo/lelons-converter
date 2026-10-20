// Docs: importing a PDF. It becomes a normal document (or a movie script), so every word can be changed.
// pdf.js (ui/pdfjs) reads the PDF here in the window; nothing is sent anywhere.
//
// A PDF only knows where each bit of text sits on the page, not what's a paragraph or a heading.
// So the lines are put back together by looking at where they are and how big they are:
// lines close together are one paragraph, bigger text is a heading, a • at the start is a list...
// Pictures are cut out of the page as it's drawn. A page that's only a picture (a scan) comes in as that picture.

let pdfLib = null;
async function pdfLoadLib() {
  if (!pdfLib) {
    pdfLib = await import("./pdfjs/pdf.min.mjs");
    pdfLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.mjs";
  }
  return pdfLib;
}

const PDF_MAX_PAGES = 400;
let pdfCancelled = false;

// ---------------------------------------------------------------- reading the pages

// [{w, h, lines: [{top, y, x0, x1, size, text, runs, bold, mono}], pics: [{top, bottom, x0, x1, url}], scan}]
async function pdfReadPages(pdf, progress) {
  const lib = pdfLib;
  const pages = [];
  const count = Math.min(pdf.numPages, PDF_MAX_PAGES);
  for (let n = 1; n <= count; n++) {
    if (pdfCancelled) throw new Error("cancelled");
    progress(n, count);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList(); // (also loads the fonts, so their names are known)
    const tc = await page.getTextContent();
    const fontName = (id) => { try { return page.commonObjs.has(id) ? page.commonObjs.get(id).name || "" : ""; } catch (e) { return ""; } };
    const fontCache = new Map();
    const fontOf = (id) => {
      if (!fontCache.has(id)) {
        const name = fontName(id), family = (tc.styles[id] && tc.styles[id].fontFamily) || "";
        fontCache.set(id, { bold: /bold|black|heavy|semibold|demi/i.test(name), italic: /italic|oblique/i.test(name),
                            mono: /courier|mono|fixed|typewriter/i.test(name) || family === "monospace" });
      }
      return fontCache.get(id);
    };
    // The bits of text, with the top of the page at 0.
    const bits = [];
    for (const it of tc.items) {
      if (typeof it.str !== "string" || !it.str) continue;
      const t = pdfLib.Util.transform(vp.transform, it.transform);
      const size = Math.hypot(t[2], t[3]);
      if (size < 1) continue;
      const f = fontOf(it.fontName);
      const x = t[4], y = t[5];
      bits.push({ x, x1: x + it.width * vp.scale, y, size, str: it.str, bold: f.bold, italic: f.italic, mono: f.mono });
    }
    const lines = pdfLines(bits, vp.width);
    const pics = pdfPictures(lib, ops, vp);
    const chars = lines.reduce((a, l) => a + l.text.length, 0);
    const big = pics.find((p) => (p.x1 - p.x0) * (p.bottom - p.top) > vp.width * vp.height * 0.5);
    const scan = chars < 30 && (!!big || !lines.length);
    let kept = pics.filter((p) => (p.x1 - p.x0) * (p.bottom - p.top) < vp.width * vp.height * 0.8); // (not a background)
    if (scan || kept.length) {
      const canvas = await pdfDraw(page, vp, scan ? 1.6 : 2);
      const k = canvas.width / vp.width;
      if (scan) kept = [{ top: 0, bottom: vp.height, x0: 0, x1: vp.width, url: pdfCanvasUrl(canvas), whole: true }];
      else for (const p of kept) p.url = pdfCanvasUrl(pdfCrop(canvas, p.x0 * k, p.top * k, (p.x1 - p.x0) * k, (p.bottom - p.top) * k));
      canvas.width = canvas.height = 0;
    }
    pages.push({ w: vp.width, h: vp.height, lines: scan ? [] : lines, pics: kept, scan });
    page.cleanup();
  }
  return pages;
}

// The bits of text put together into lines (left to right), top to bottom.
// Two columns of text side by side are read one column after the other.
function pdfLines(bits, pageW) {
  bits.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const b of bits) {
    let row = null;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 4; i--) {
      if (Math.abs(rows[i].y - b.y) < Math.max(rows[i].size, b.size) * 0.4) { row = rows[i]; break; }
    }
    if (!row) rows.push(row = { y: b.y, size: 0, bits: [] });
    row.bits.push(b);
    row.size = Math.max(row.size, b.size);
  }
  for (const row of rows) row.bits.sort((a, b) => a.x - b.x);
  const gutter = pdfGutter(rows, pageW);
  if (gutter === null) return rows.map(pdfLine).filter(Boolean);
  // Columns: the rows are cut at the gap. Text across the whole page (a title) splits the page into bands,
  // and in each band the left column comes first.
  const out = [];
  let band = [];
  const endBand = () => {
    const leftCol = band.filter((l) => l.x1 <= gutter), rightCol = band.filter((l) => l.x1 > gutter);
    for (const col of [leftCol, rightCol]) {
      const colL = Math.min(...col.map((l) => l.x0)), colR = Math.max(...col.map((l) => l.x1));
      for (const l of col) out.push(Object.assign(l, { colL, colR }));
    }
    band = [];
  };
  for (const row of rows) {
    const across = row.bits.some((b) => b.x < gutter - 2 && b.x1 > gutter + 2);
    if (across) { endBand(); const l = pdfLine(row); if (l) out.push(l); continue; }
    const parts = [row.bits.filter((b) => b.x1 <= gutter + 2), row.bits.filter((b) => b.x1 > gutter + 2)];
    for (const part of parts) if (part.length) { const l = pdfLine({ y: row.y, size: Math.max(...part.map((b) => b.size)), bits: part }); if (l) band.push(l); }
  }
  endBand();
  return out;
}

// The x where two columns are split, or null when the page is one column.
function pdfGutter(rows, pageW) {
  const textRows = rows.filter((r) => r.bits.some((b) => b.str.trim()));
  if (textRows.length < 8) return null;
  let best = null, bestGaps = 0;
  for (let x = pageW * 0.3; x <= pageW * 0.7; x += 3) {
    let gaps = 0, across = 0;
    for (const r of textRows) {
      const bs = r.bits.filter((b) => b.str.trim());
      if (!bs.length || bs[bs.length - 1].x1 < x || bs[0].x > x) continue; // all on one side
      if (bs.some((b, i) => i && bs[i - 1].x1 < x - 6 && b.x > x + 6 && b.x - bs[i - 1].x1 > b.size * 1.2)) gaps++;
      else across++;
    }
    if (gaps >= textRows.length * 0.35 && across <= textRows.length * 0.2 && gaps > bestGaps) { best = x; bestGaps = gaps; }
  }
  return best;
}

function pdfLine(row) {
  const runs = [];
  let text = "", end = null;
  for (const b of row.bits) {
    let str = b.str;
    if (end !== null && b.x - end > b.size * 0.18 && !/\s$/.test(text) && !/^\s/.test(str)) str = " " + str;
    const last = runs[runs.length - 1];
    if (last && last.bold === b.bold && last.italic === b.italic) last.text += str;
    else runs.push({ text: str, bold: b.bold, italic: b.italic });
    text += str;
    end = Math.max(end === null ? -Infinity : end, b.x1);
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const letters = row.bits.filter((b) => b.str.trim());
  const weight = (fn) => letters.filter(fn).reduce((a, b) => a + b.str.length, 0) / Math.max(1, letters.reduce((a, b) => a + b.str.length, 0));
  // Big gaps in a line: maybe a row of a table.
  const cells = [];
  let cellEnd = null;
  for (const b of letters) {
    if (cellEnd === null || b.x - cellEnd > b.size * 0.9) cells.push({ x0: b.x, text: "", bold: true });
    const c = cells[cells.length - 1];
    c.text += (c.text && cellEnd !== null && b.x - cellEnd > b.size * 0.18 ? " " : "") + b.str;
    c.bold = c.bold && b.bold;
    cellEnd = c.x1 = b.x1;
  }
  for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
  return { y: row.y, top: row.y - row.size, x0: letters.length ? letters[0].x : row.bits[0].x, x1: end, size: Math.round(row.size * 2) / 2,
           text: trimmed, runs, bold: weight((b) => b.bold) > 0.9, mono: weight((b) => b.mono) > 0.6, cells: cells.length > 1 ? cells : null };
}

// Where the pictures are on the page (following the drawing steps, like the PDF viewer does).
function pdfPictures(lib, ops, vp) {
  const O = lib.OPS, mul = lib.Util.transform;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], pics = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(ctm, args);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mul(ctm, args[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
      const m = mul(vp.transform, ctm);
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const box = { x0: Math.max(0, Math.min(...xs)), x1: Math.min(vp.width, Math.max(...xs)), top: Math.max(0, Math.min(...ys)), bottom: Math.min(vp.height, Math.max(...ys)) };
      if (box.x1 - box.x0 < 24 || box.bottom - box.top < 24) continue; // (dots, lines, little icons)
      // The same picture drawn twice, or pictures inside a bigger one: keep the bigger one.
      if (pics.some((p) => box.x0 >= p.x0 - 2 && box.x1 <= p.x1 + 2 && box.top >= p.top - 2 && box.bottom <= p.bottom + 2)) continue;
      for (let j = pics.length - 1; j >= 0; j--) {
        const p = pics[j];
        if (p.x0 >= box.x0 - 2 && p.x1 <= box.x1 + 2 && p.top >= box.top - 2 && p.bottom <= box.bottom + 2) pics.splice(j, 1);
      }
      pics.push(box);
    }
  }
  return pics;
}

async function pdfDraw(page, vp, scale) {
  scale = Math.min(scale, 4000 / Math.max(vp.width, vp.height));
  const view = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view }).promise;
  return canvas;
}

function pdfCrop(canvas, x, y, w, h) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  out.getContext("2d").drawImage(canvas, Math.round(x), Math.round(y), out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Small enough to keep in the document and share (like a picture you add yourself).
function pdfCanvasUrl(canvas) {
  for (let side = 1400, quality = 0.85; ; side = Math.round(side * 0.8), quality = Math.max(0.6, quality - 0.08)) {
    const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(canvas.width * scale));
    c.height = Math.max(1, Math.round(canvas.height * scale));
    c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png"), jpeg = c.toDataURL("image/jpeg", quality);
    const best = png.length < jpeg.length * 1.3 ? png : jpeg;
    if (best.length < 420000 || side < 300) return best;
  }
}

// ---------------------------------------------------------------- headers, footers and page numbers

// Text that's at the same spot on most pages (a header, a footer, the title on every page) isn't the story.
function pdfDropRepeats(pages) {
  const seen = new Map();
  const key = (l) => l.text.replace(/\d+/g, "#").toLowerCase() + "@" + Math.round(l.y / 6);
  for (const p of pages) for (const k of new Set(p.lines.map(key))) seen.set(k, (seen.get(k) || 0) + 1);
  const many = Math.max(2, Math.ceil(pages.length * 0.5));
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      const edge = l.y < p.h * 0.1 || l.top > p.h * 0.88;
      if (!edge) return true;
      if (pages.length > 1 && seen.get(key(l)) >= many) return false;
      return !/^(page\s*)?\d{1,4}\.?(\s*(of|\/)\s*\d{1,4})?$/i.test(l.text) && !/^-\s*\d{1,4}\s*-$/.test(l.text);
    });
  }
}

const pdfMode = (values) => {
  const n = new Map();
  for (const [v, w] of values) n.set(v, (n.get(v) || 0) + w);
  let best = null, most = -1;
  for (const [v, w] of n) if (w > most) { best = v; most = w; }
  return best;
};

// ---------------------------------------------------------------- normal documents

const pdfEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PDF_BULLET = /^([•●▪◦‣∙·■□➢►✓\-–*])\s+/;
const PDF_NUMBER = /^(\d{1,3}|[a-zA-Z])([.)])\s+/;

function pdfRunsHtml(runs, plain) {
  let html = "";
  for (const r of runs) {
    let t = pdfEsc(r.text);
    if (!plain && r.bold && r.text.trim()) t = `<b>${t}</b>`;
    if (r.italic && r.text.trim()) t = `<i>${t}</i>`;
    html += t;
  }
  return html.replace(/<\/b><b>|<\/i><i>/g, "");
}

// Takes the list marker off the front of a line's runs.
function pdfStripRuns(runs, n) {
  const out = runs.map((r) => ({ ...r }));
  while (n > 0 && out.length) {
    const take = Math.min(n, out[0].text.length);
    out[0].text = out[0].text.slice(take);
    n -= take;
    if (!out[0].text) out.shift();
  }
  if (out.length) out[0].text = out[0].text.replace(/^\s+/, "");
  return out;
}

const html0 = (l) => pdfRunsHtml(l.runs, false);

function pdfToDoc(pages) {
  const all = pages.flatMap((p) => p.lines);
  const body = pdfMode(all.map((l) => [l.size, l.text.length])) || 11;
  // Where the text starts and ends on most pages.
  const bodyLines = all.filter((l) => Math.abs(l.size - body) < 1);
  const left = pdfMode(bodyLines.map((l) => [Math.round(l.x0 / 4) * 4, l.text.length])) || 72;
  const right = bodyLines.length ? bodyLines.map((l) => l.x1).sort((a, b) => a - b)[Math.floor(bodyLines.length * 0.9)] : 540;
  const width = Math.max(100, right - left);
  // (a line in a column has that column's edges)
  const mL = (l) => l.colL ?? left, mR = (l) => l.colR ?? right, mW = (l) => Math.max(60, mR(l) - mL(l));
  const pitch = (() => { // the usual gap between two lines of a paragraph
    const gaps = [];
    for (const p of pages) for (let i = 1; i < p.lines.length; i++) {
      const a = p.lines[i - 1], b = p.lines[i];
      if (Math.abs(a.size - body) < 1 && Math.abs(b.size - body) < 1) gaps.push(b.y - a.y);
    }
    return pdfMode(gaps.filter((g) => g > 0).map((g) => [Math.round(g * 2) / 2, 1])) || body * 1.25;
  })();

  const blocks = [];
  let cur = null, list = null;
  const flush = () => {
    if (cur) {
      const tag = cur.kind === "li" ? "li" : cur.kind;
      const html = cur.parts.map((part, i) => (i && !cur.joinNoSpace[i] ? " " : "") + part).join("");
      const style = cur.align && cur.kind !== "li" ? ` style="text-align: ${cur.align}"` : "";
      if (cur.kind === "li") {
        if (!list || list.type !== cur.list) { if (list) blocks.push(`<${list.type}>${list.items.join("")}</${list.type}>`); list = { type: cur.list, items: [] }; }
        list.items.push(`<li>${html}</li>`);
      } else {
        if (list) { blocks.push(`<${list.type}>${list.items.join("")}</${list.type}>`); list = null; }
        blocks.push(`<${tag}${style}>${html}</${tag}>`);
      }
    }
    cur = null;
  };
  const endList = () => { flush(); if (list) { blocks.push(`<${list.type}>${list.items.join("")}</${list.type}>`); list = null; } };

  // Lists whose dots are drawn instead of typed (no • in the text): lines pushed in a little, all at the same spot.
  // A new item starts with a capital on a line that was broken early. One item alone stays a paragraph.
  for (const page of pages) {
    const ls = page.lines;
    for (let i = 0; i < ls.length;) {
      const a = ls[i];
      const indent = a.x0 - mL(a);
      if (!(indent > a.size * 0.9 && indent < a.size * 5) || PDF_BULLET.test(a.text) || PDF_NUMBER.test(a.text)) { i++; continue; }
      let j = i + 1;
      while (j < ls.length && Math.abs(ls[j].x0 - a.x0) < 2 && Math.abs(ls[j].size - a.size) < 1 && ls[j].y - ls[j - 1].y < pitch * 1.6) j++;
      const starts = [];
      // (a line that was broken early on purpose: its first word would still have fitted on the line before)
      const fits = (k) => ls[k - 1].x1 + (ls[k].text.split(" ")[0].length + 1) * ls[k].size * 0.5 < mR(ls[k]);
      for (let k = i; k < j; k++) starts.push(k === i || (/^[A-Z0-9"“(]/.test(ls[k].text) && fits(k)));
      if (starts.filter(Boolean).length >= 2) for (let k = i; k < j; k++) ls[k].item = starts[k - i] ? "start" : "more";
      i = j;
    }
  }

  // Tables: lines in a row, each split into the same number of cells that line up.
  for (const page of pages) {
    const ls = page.lines;
    for (let i = 0; i < ls.length;) {
      const a = ls[i];
      if (!a.cells) { i++; continue; }
      const near = (b, c) => b && b.cells && b.cells.length === a.cells.length && b.y - c.y < Math.max(pitch, a.size) * 2.6;
      const lined = (r, s) => r.cells.every((c, k) => Math.abs(c.x0 - s.cells[k].x0) < 10);
      // A header row is often centred, so the middle of each cell only has to fall in the right column.
      const over = (r, s) => r.cells.every((c, k) => {
        const mid = (c.x0 + c.x1) / 2, next = s.cells[k + 1];
        return mid > (k ? s.cells[k - 1].x1 : -Infinity) && mid >= s.cells[k].x0 - 30 && (!next || mid < next.x0);
      });
      let ref = a, j = i + 1;
      if (near(ls[j], a) && !lined(ls[j], a) && over(a, ls[j])) { ref = ls[j]; j++; }
      while (near(ls[j], ls[j - 1]) && lined(ls[j], ref)) j++;
      if (j - i >= 2) {
        const rows = ls.slice(i, j).map((l) => l.cells);
        const head = rows[0].every((c) => c.bold) && !rows[1].every((c) => c.bold);
        const html = rows.map((cells, r) => "<tr>" + cells.map((c) => r === 0 && head ? `<th>${pdfEsc(c.text)}</th>` : `<td>${pdfEsc(c.text)}</td>`).join("") + "</tr>").join("");
        ls[i].table = `<table class="doc-table"><tbody>${html}</tbody></table>`;
        for (let k = i + 1; k < j; k++) ls[k].table = "-";
      }
      i = j;
    }
  }

  for (const page of pages) {
    // The lines are in reading order already; a picture goes before the first line under it (in its column).
    const things = page.lines.map((l) => ({ line: l }));
    for (const pic of [...page.pics].sort((a, b) => a.top - b.top)) {
      const i = things.findIndex((t) => t.line && t.line.top >= pic.top - 2 && (t.line.colL === undefined || (t.line.x0 < pic.x1 && t.line.x1 > pic.x0)));
      things.splice(i < 0 ? things.length : i, 0, { pic });
    }
    let prev = null;
    for (const t of things) {
      if (t.pic) {
        endList();
        const w = t.pic.whole ? 100 : Math.max(10, Math.min(100, Math.round((t.pic.x1 - t.pic.x0) / width * 100)));
        const mid = (t.pic.x0 + t.pic.x1) / 2;
        const align = !t.pic.whole && w < 90 && Math.abs(mid - (left + right) / 2) < width * 0.08 ? ' style="text-align: center"' : "";
        blocks.push(`<p${align}><img src="${t.pic.url}" alt="" style="width: ${w}%"></p>`);
        prev = null;
        continue;
      }
      const l = t.line;
      if (l.table) {
        if (l.table !== "-") { endList(); blocks.push(l.table); }
        prev = null;
        continue;
      }
      const r = l.size / body;
      const short = l.text.length < 90;
      let kind = r >= 1.6 ? "h1" : r >= 1.25 ? "h2" : (r >= 1.1 && short) || (l.bold && short && l.text.length > 1 && !/[.,;:]$/.test(l.text) && !PDF_BULLET.test(l.text)) ? "h3" : "p";
      let runs = l.runs, marker = null;
      const bullet = kind === "p" && PDF_BULLET.exec(l.text), number = kind === "p" && !bullet && PDF_NUMBER.exec(l.text);
      if (kind === "p" && l.item) {
        if (l.item === "start") { kind = "li"; marker = "ul"; }
        else if (cur && cur.kind === "li" && prev) {
          cur.parts.push(html0(l));
          cur.joinNoSpace.push(false);
          prev = l;
          continue;
        }
      } else if (bullet || number) {
        marker = bullet ? "ul" : "ol";
        runs = pdfStripRuns(l.runs, (l.runs.map((x) => x.text).join("").match(/^\s*/)[0].length) + (bullet || number)[0].length);
        kind = "li";
      }
      const lineMid = (l.x0 + l.x1) / 2;
      const L = mL(l), R = mR(l), W = mW(l);
      const align = l.x0 > L + W * 0.08 && Math.abs(lineMid - (L + R) / 2) < W * 0.05 ? "center"
        : l.x0 > L + W * 0.45 && l.x1 > R - W * 0.04 ? "right" : "";
      const gap = prev ? l.y - prev.y : Infinity;
      const html = pdfRunsHtml(runs, kind !== "p" && kind !== "li");
      // Does this line carry on the one before it?
      const sameBox = cur && prev && gap > 0 && gap < Math.max(pitch, l.size * 1.15) * 1.45 && Math.abs(l.size - cur.size) < 1;
      let carry = false;
      if (sameBox && kind === cur.kind && kind !== "li" && cur.kind !== "li") {
        const prevEnded = /[.!?:"”)]$/.test(prev.text) && prev.x1 < R - W * 0.15;
        carry = (kind !== "p" || (!prevEnded && Math.abs(l.x0 - cur.x0) < l.size * 2.2)) && cur.align === align;
        if (kind === "p" && align) carry = carry && cur.align === align;
      } else if (sameBox && cur.kind === "li" && kind === "p" && l.x0 > cur.x0 + l.size * 0.5) {
        carry = true; // the next line of a list item
      }
      if (carry) {
        const last = cur.parts.length - 1;
        const hyphen = /[a-zà-ÿ]-$/.test(prev.text) && /^[a-zà-ÿ]/.test(l.text);
        if (hyphen) cur.parts[last] = cur.parts[last].replace(/-(<\/[bi]>)*$/, "$1");
        cur.parts.push(html);
        cur.joinNoSpace.push(hyphen);
      } else {
        if (kind !== "li") endList(); else flush();
        cur = { kind, list: marker, parts: [html], joinNoSpace: [false], size: l.size, x0: l.x0, align: kind === "li" ? "" : align };
      }
      prev = l;
    }
    flush(); // (a paragraph can go on to the next page, but most don't: keep it simple)
  }
  endList();
  return blocks.length ? blocks : ["<p><br></p>"];
}

// ---------------------------------------------------------------- movie scripts

const PDF_SCENE = /^(\d+[A-Z]?\.?\s+)?(INT\.?\/EXT|EXT\.?\/INT|I\/E|INT|EXT|EST)[.\s]/;

function pdfIsScript(pages) {
  const all = pages.flatMap((p) => p.lines);
  const chars = all.reduce((a, l) => a + l.text.length, 0);
  const mono = all.filter((l) => l.mono).reduce((a, l) => a + l.text.length, 0);
  const scenes = all.filter((l) => PDF_SCENE.test(l.text)).length;
  return scenes >= 1 && (mono > chars * 0.6 || scenes >= 3);
}

function pdfToScript(pages) {
  const all = pages.flatMap((p) => p.lines).filter((l) => !/^\(?(MORE|CONTINUED)\)?:?$|^CONTINUED:\s*\(?\d*\)?$/i.test(l.text));
  const keep = new Set(all);
  const size = pdfMode(all.map((l) => [l.size, l.text.length])) || 12;
  const inch = 72;
  // The action margin: where most lines start (scene headings and action).
  const left = pdfMode(all.filter((l) => PDF_SCENE.test(l.text) || l.text.length > 45).map((l) => [Math.round(l.x0 / 3) * 3, 1]))
    ?? Math.min(...all.map((l) => l.x0));
  const firstScene = pages.findIndex((p) => p.lines.some((l) => PDF_SCENE.test(l.text)));
  const blocks = [];
  let cur = null, prev = null;
  const flush = () => {
    if (!cur) return;
    let html = cur.parts.join(" ");
    if (cur.kind === "paren") html = html.replace(/^\(\s*/, "").replace(/\s*\)$/, ""); // the editor draws the brackets itself
    blocks.push(`<p class="sp-${cur.kind}">${html}</p>`);
    cur = null;
  };
  pages.forEach((page, pi) => {
    // A title page before the first scene.
    if (pi < firstScene) {
      for (const l of page.lines) {
        const mid = (l.x0 + l.x1) / 2;
        const kind = Math.abs(mid - page.w / 2) < page.w * 0.12 && !blocks.some((b) => b.includes("sp-title")) ? "title"
          : Math.abs(mid - page.w / 2) < page.w * 0.12 ? "centered" : "contact";
        const last = blocks[blocks.length - 1];
        // contact lines stay together in one block (each block would start low on the page)
        if (kind === "contact" && last && last.startsWith('<p class="sp-contact">')) blocks[blocks.length - 1] = last.replace(/<\/p>$/, `<br>${pdfEsc(l.text)}</p>`);
        else blocks.push(`<p class="sp-${kind}">${pdfEsc(l.text)}</p>`);
      }
      if (page.lines.length) blocks.push('<hr class="page-break">');
      return;
    }
    for (const pic of page.pics) blocks.push(`<p class="sp-action"><img src="${pic.url}" alt="" style="width: ${pic.whole ? 100 : 60}%"></p>`);
    prev = null;
    for (const l of page.lines) {
      if (!keep.has(l)) continue;
      const dx = (l.x0 - left) / inch;
      let text = l.text;
      let kind;
      if (PDF_SCENE.test(text)) { kind = "scene"; text = text.replace(/^\d+[A-Z]?\.?\s+/, "").replace(/\s+\d+[A-Z]?\.?$/, ""); }
      else if (/^\d+[A-Z]?\.?$/.test(text) && (dx < -0.3 || dx > 4.5)) continue; // a scene number on its own
      else if (/^\(.*\)?$/.test(text) && dx > 0.9 && dx < 2.6) kind = "paren";
      else if (/(TO:|OUT\.|IN:|OUT:)$/.test(text) && text === text.toUpperCase() && (dx > 3 || /^(CUT|FADE|DISSOLVE|SMASH|MATCH)/.test(text))) kind = "transition";
      else if (dx >= 1.6 && dx < 3.4 && text === text.toUpperCase() && /[A-Z]/.test(text) && text.length < 45) kind = "character";
      else if (dx >= 0.6 && dx < 2.4) kind = "dialogue";
      else if (dx >= 3.4) kind = "transition";
      else kind = "action";
      if (kind === "dialogue" && cur && cur.kind === "paren" && !/\)$/.test(cur.parts.join(" "))) kind = "paren"; // a note that goes on
      const gap = prev ? l.y - prev.y : Infinity;
      const goesOn = cur && cur.kind === kind && (kind === "action" || kind === "dialogue" || kind === "paren") && gap < size * 1.6;
      if (goesOn) cur.parts.push(pdfEsc(text));
      else { flush(); cur = { kind, parts: [pdfEsc(text)] }; }
      if (kind === "scene" || kind === "character" || kind === "transition") flush();
      prev = l;
    }
    // (lines carry on onto the next page: a page break in a PDF isn't a new paragraph)
  });
  flush();
  return blocks.length ? blocks : ['<p class="sp-scene"><br></p>'];
}

// ---------------------------------------------------------------- doing the import

function pdfShowProgress(text, done, total) {
  $("docImportModal").hidden = false;
  $("docImportText").textContent = text;
  $("docImportBar").style.width = total ? Math.round(done / total * 100) + "%" : "4%";
}
$("docImportCancel").addEventListener("click", () => { pdfCancelled = true; $("docImportModal").hidden = true; });

// Reads the PDF. Says {title, kind, blocks (html), pages, scans} or null (cancelled or couldn't be read; it said why).
async function pdfImport(file) {
  pdfCancelled = false;
  pdfShowProgress("Opening the PDF...", 0, 0);
  let pdf = null;
  try {
    const lib = await pdfLoadLib();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = lib.getDocument({ data, cMapUrl: "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "pdfjs/standard_fonts/", isEvalSupported: false });
    task.onPassword = async (give, reason) => {
      $("docImportModal").hidden = true;
      const asked = docAskText(reason === 2 ? "That's not the password" : "This PDF has a password", "Type the password to open it.", "");
      const input = document.querySelector("#docAskModal .doc-ask-input input");
      if (input) input.type = "password";
      const pw = await asked;
      if (pw === null) { pdfCancelled = true; task.destroy(); return; }
      pdfShowProgress("Opening the PDF...", 0, 0);
      give(pw);
    };
    pdf = await task.promise;
    const pages = await pdfReadPages(pdf, (n, count) => pdfShowProgress(`Reading page ${n} of ${count}...`, n - 1, count));
    pdfDropRepeats(pages);
    const script = pdfIsScript(pages);
    let title = "";
    try { const meta = await pdf.getMetadata(); title = String((meta.info && meta.info.Title) || "").trim(); } catch (e) { title = ""; }
    if (!title || title.length > 120 || /^(untitled|microsoft word|document\d*)\b|\.(docx?|pdf|pages)$/i.test(title)) title = file.name.replace(/\.pdf$/i, "");
    return { title: title || "Imported PDF", kind: script ? "script" : "doc", blocks: script ? pdfToScript(pages) : pdfToDoc(pages),
             pages: pdf.numPages, scans: pages.filter((p) => p.scan).length, cut: pdf.numPages > PDF_MAX_PAGES };
  } catch (err) {
    if (!pdfCancelled) docToast(err && err.name === "PasswordException" ? "Couldn't open it: the password wasn't right." : "Couldn't read that PDF. Is it really a PDF?");
    return null;
  } finally {
    $("docImportModal").hidden = true;
    if (pdf) pdf.destroy();
  }
}

function pdfBlocks(html, prefix = "") {
  let pos = "";
  return html.map((h) => { pos = posBetween(pos, null); return { id: prefix + newBlockId(), pos, html: h }; });
}

function pdfDoneToast(r) {
  const parts = [`Imported ${r.pages} ${r.pages === 1 ? "page" : "pages"}${r.kind === "script" ? " as a movie script" : ""}. It's all yours to change now.`];
  if (r.scans) parts.push(`${r.scans === r.pages ? "It's" : r.scans + " " + (r.scans === 1 ? "page is" : "pages are")} only a picture (like a scan), so ${r.scans === 1 && r.scans === r.pages ? "it came" : "they came"} in as ${r.scans === 1 ? "a picture" : "pictures"}.`);
  if (r.cut) parts.push(`Only the first ${PDF_MAX_PAGES} pages fit.`);
  docToast(parts.join(" "));
}

// From the Docs home: the PDF becomes a new document.
async function importPdfAsDoc(file) {
  if (!file) return;
  const r = await pdfImport(file);
  if (!r) return;
  const where = docsWhere === "collab" && sfxUser() ? "collab" : "local";
  const settings = r.kind === "script" ? { type: "script" } : {};
  const res = await api("/api/docs-create", { where, title: r.title, kind: r.kind, blocks: pdfBlocks(r.blocks), settings }).catch(() => null);
  if (!res || !res.ok) return docToast((res && res.error) || "Couldn't make the document. Try again.");
  if (docsFolderAt) { docsF().place[res.id] = docsFolderAt; saveFolders(); }
  await openDoc(where, res.id);
  pdfDoneToast(r);
}

// In a document: the PDF becomes a new page of it (with its own tab).
async function importPdfAsPage(file) {
  if (!file || !doc) return;
  const d = doc;
  const r = await pdfImport(file);
  if (!r || doc !== d) return;
  const id = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  const list = docTabsList();
  const pos = posBetween(list.length ? list[list.length - 1].pos : "", null);
  docStore.set("t~" + id, { pos, html: docTabHtml({ title: r.title.slice(0, 100), parent: "", type: r.kind === "script" ? "script" : "blank", settings: {} }) });
  docPending.add("t~" + id);
  for (const b of pdfBlocks(r.blocks, id + "~")) { docStore.set(b.id, { pos: b.pos, html: b.html }); docPending.add(b.id); }
  docMarkDirty();
  docShowTab(id);
  pdfDoneToast(r);
}

function pickPdf(then) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/pdf,.pdf" });
  input.addEventListener("change", () => then(input.files[0]));
  input.click();
}

// Dropping a PDF on the Docs home imports it.
const isPdfDrag = (e) => [...(e.dataTransfer && e.dataTransfer.items || [])].some((i) => i.kind === "file" && (i.type === "application/pdf" || i.type === ""));
$("docsHome").addEventListener("dragover", (e) => {
  if (!isPdfDrag(e) || docsDrag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  $("docsHome").classList.add("pdf-over");
});
$("docsHome").addEventListener("dragleave", (e) => { if (!$("docsHome").contains(e.relatedTarget)) $("docsHome").classList.remove("pdf-over"); });
$("docsHome").addEventListener("drop", (e) => {
  $("docsHome").classList.remove("pdf-over");
  const file = [...(e.dataTransfer.files || [])].find((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!file || docsDrag) return;
  e.preventDefault();
  if (docsWhere === "collab" && !sfxUser()) return docToast("Log in first to share documents.");
  importPdfAsDoc(file);
});
