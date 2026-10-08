// The Editor tab, part 2: the tools (Move, Marquee, Lasso, Brush...) and Free Transform.
(() => {
  const PS = window.PS;
  const T = (PS.tools = {});
  const opt = (PS.opt = {
    move: { auto: false },
    sel: { mode: "new", feather: 0 },
    wand: { tol: 32, contiguous: true, all: true },
    objsel: { mode: "new" },
    crop: { ratio: "free" },
    eyedropper: { all: true },
    brush: { size: 30, hard: 0, opacity: 100, flow: 100, mode: "normal" },
    eraser: { size: 50, hard: 100, opacity: 100, flow: 100 },
    clone: { size: 60, hard: 0, opacity: 100, flow: 100, aligned: true, all: false },
    heal: { size: 40, hard: 50, opacity: 100, flow: 100, aligned: true, all: false },
    spotheal: { size: 30, hard: 50, opacity: 100, flow: 100, all: false },
    gradient: { type: "linear", opacity: 100, reverse: false, transparent: false, mode: "normal" },
    bucket: { tol: 32, contiguous: true, all: false, opacity: 100 },
    type: { font: "Arial", size: 72, bold: false, italic: false, align: "left" },
    shape: { radius: 0 },
  });
  PS.tool = "move";
  const doc = () => PS.doc;
  const toast = (t) => PS.toast && PS.toast(t);

  const def = (id, o) => (T[id] = { id, cursor: "default", ...o });

  // Which way a selection tool combines: Shift adds, Alt subtracts, both intersect (else the options bar's choice)
  const selMode = (e, base) => (e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : base);

  // A text layer can't be painted on: it's turned into pixels first (Photoshop asks; here it just says so)
  PS.rasterize = (l, silent) => {
    if (!PS.isText(l)) return;
    PS.syncText(l);
    l.kind = "pixel";
    l.text = null;
    l._tk = null;
    if (!silent) toast("The type layer was rasterized so it can be painted on.");
  };
  const paintable = (what) => {
    const l = PS.active();
    if (!l) return null;
    if (!PS.shown(l)) { toast(`Could not use the ${what} because the target layer is hidden.`); return null; }
    if (PS.isGroup(l)) { toast(`Could not use the ${what} because the target layer is a group. Pick a layer inside it.`); return null; }
    if (PS.isAdj(l)) doc().maskEdit = true; // an adjustment layer is painted through its mask
    if (PS.isText(l)) PS.rasterize(l);
    return l;
  };
  // The layers a move or transform works on: the picked ones, with groups standing for everything in them
  PS.targets = () => {
    const d = doc();
    const ids = d.picked && d.picked.length ? d.picked : [d.active];
    const out = new Set();
    for (const id of ids) {
      const l = d.layers.find((x) => x.id === id);
      if (!l) continue;
      if (PS.isGroup(l)) PS.inside(d, l).filter((x) => !PS.isGroup(x)).forEach((x) => out.add(x));
      else out.add(l);
    }
    return [...out];
  };

  // ---------------------------------------------------------------- Move (V)
  let mv = null;
  def("move", {
    name: "Move Tool", key: "V",
    down(e, p) {
      const d = doc();
      if ((opt.move.auto || e.ctrlKey) && !e.altKey) {
        const hit = PS.layerAt(p.x, p.y);
        if (hit) { d.active = hit.id; d.picked = [hit.id]; PS.onChange && PS.onChange(); }
      }
      let list = PS.targets();
      if (!list.length) return;
      if (list.every((l) => l.locked)) return toast("Could not use the move tool because the layer is locked. Double-click the Background layer to unlock it.");
      list = list.filter((l) => !l.locked);
      if (e.altKey) list = list.map((l) => PS.duplicate(l, true)); // Alt+drag: move a copy
      mv = { list, x: p.x, y: p.y, dx: 0, dy: 0, float: null };
      if (d.sel && list.length === 1 && list[0].kind === "pixel") mv.float = PS.lift(list[0]);
    },
    move(e, p) {
      if (!mv) return;
      let dx = Math.round(p.x - mv.x), dy = Math.round(p.y - mv.y);
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (mv.float) { mv.float.dx = dx; mv.float.dy = dy; PS.changed(); return; }
      for (const l of mv.list) PS.moveLayer(l, dx - mv.dx, dy - mv.dy);
      mv.dx = dx; mv.dy = dy;
      PS.changed();
    },
    up() {
      if (!mv) return;
      const m = mv;
      mv = null;
      if (m.float) {
        if (!m.float.dx && !m.float.dy) { PS.live = null; PS.floatSel = null; return PS.goto(doc().hi); }
        PS.drop(m.float);
        return PS.commit("Move");
      }
      if (m.dx || m.dy) PS.commit("Move");
    },
  });

  // The topmost visible layer with a pixel at x, y
  PS.layerAt = (x, y) => {
    const d = doc();
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i];
      if (!PS.isPixels(l) || !PS.shown(l)) continue;
      const s = PS.styled(l);
      const px = Math.floor(x - s.x), py = Math.floor(y - s.y);
      if (px < 0 || py < 0 || px >= s.c.width || py >= s.c.height) continue;
      if (s.c.getContext("2d").getImageData(px, py, 1, 1).data[3] > 20) return l;
    }
    return null;
  };

  // Moving or transforming selected pixels: they're cut out of the layer into a "float" until dropped.
  PS.lift = (l) => {
    const d = doc();
    PS.editPixels(l);
    const piece = PS.clipToSel(PS.clone(l.canvas), l.x, l.y);
    const ctx = l.canvas.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(d.sel.c, -l.x, -l.y);
    ctx.restore();
    const f = { l, c: piece, x: l.x, y: l.y, dx: 0, dy: 0, sel: d.sel };
    PS.live = {
      layer: l,
      draw(c2, layer) {
        const s = PS.styled(layer);
        c2.drawImage(s.c, s.x, s.y);
        if (f.xf) PS.drawXf(c2, f.xf);
        else c2.drawImage(f.c, f.x + f.dx, f.y + f.dy);
      },
    };
    PS.floatSel = f;
    return f;
  };
  PS.drop = (f) => {
    const d = doc();
    const ctx = f.l.canvas.getContext("2d");
    if (f.xf) PS.drawXf(ctx, f.xf, -f.l.x, -f.l.y);
    else ctx.drawImage(f.c, f.dx, f.dy);
    PS.live = null;
    PS.floatSel = null;
    // the selection moves (or turns) with the pixels
    const c = PS.canvas(d.w, d.h), sc = c.getContext("2d");
    if (f.xf) PS.drawXf(sc, { ...f.xf, src: f.selSrc || f.xf.src });
    else sc.drawImage(f.sel.c, f.dx, f.dy);
    d.sel = PS.makeSel(c);
  };

  // ---------------------------------------------------------------- selection tools
  let drag = null;
  const marquee = (shape) => ({
    down(e, p) {
      const d = doc();
      const mode = selMode(e, opt.sel.mode);
      // dragging inside the selection (no keys held) moves its outline
      if (mode === "new" && d.sel && insideSel(p)) { drag = { moveSel: true, x: p.x, y: p.y, sel: d.sel, dx: 0, dy: 0 }; return; }
      drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, mode, shiftAtStart: e.shiftKey };
    },
    move(e, p) {
      if (!drag) return;
      if (drag.moveSel) { drag.dx = Math.round(p.x - drag.x); drag.dy = Math.round(p.y - drag.y); PS.draw(); return; }
      drag.x1 = p.x; drag.y1 = p.y;
      if (e.shiftKey && !drag.shiftAtStart) { // Shift while dragging: a square or circle
        const s = Math.max(Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
        drag.x1 = drag.x0 + Math.sign(drag.x1 - drag.x0 || 1) * s;
        drag.y1 = drag.y0 + Math.sign(drag.y1 - drag.y0 || 1) * s;
      }
      PS.draw();
    },
    up() {
      if (!drag) return;
      const g = drag;
      drag = null;
      const d = doc();
      if (g.moveSel) {
        if (!g.dx && !g.dy) return PS.setSel(null, "Deselect");
        const c = PS.canvas(d.w, d.h);
        c.getContext("2d").drawImage(g.sel.c, g.dx, g.dy);
        return PS.setSel(c, "Move Selection");
      }
      const x = Math.round(Math.min(g.x0, g.x1)), y = Math.round(Math.min(g.y0, g.y1));
      const w = Math.round(Math.max(g.x0, g.x1)) - x, h = Math.round(Math.max(g.y0, g.y1)) - y;
      if (w < 1 || h < 1) { if (g.mode === "new" && d.sel) PS.setSel(null, "Deselect"); else PS.draw(); return; }
      const c = PS.selShape((ctx) => (shape === "rect" ? ctx.rect(x, y, w, h) : ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)), opt.sel.feather);
      PS.applySel(c, g.mode, shape === "rect" ? "Rectangular Marquee" : "Elliptical Marquee");
    },
    overlay(ctx, v) {
      if (!drag) return;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      if (drag.moveSel) {
        ctx.translate(v.x + drag.dx * v.zoom, v.y + drag.dy * v.zoom);
        ctx.scale(v.zoom, v.zoom);
        ctx.lineWidth = 1 / v.zoom;
        ctx.setLineDash([4 / v.zoom, 4 / v.zoom]);
        ctx.strokeStyle = "#fff";
        ctx.stroke(drag.sel.path);
        return;
      }
      const a = PS.toScreen(drag.x0, drag.y0), b = PS.toScreen(drag.x1, drag.y1);
      ctx.beginPath();
      if (shape === "rect") ctx.rect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = "#000";
      ctx.stroke();
    },
    cursor: "crosshair",
  });
  const insideSel = (p) => {
    const d = doc();
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (!d.sel || x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
    return d.sel.c.getContext("2d").getImageData(x, y, 1, 1).data[3] >= 128;
  };
  def("marquee", { name: "Rectangular Marquee Tool", key: "M", ...marquee("rect") });
  def("ellipse", { name: "Elliptical Marquee Tool", key: "M", ...marquee("ellipse") });

  const lassoOverlay = (pts, extra) => (ctx, v) => {
    if (!pts || pts.length < 1) return;
    ctx.beginPath();
    pts.forEach((p, i) => { const s = PS.toScreen(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (extra) { const s = PS.toScreen(extra.x, extra.y); ctx.lineTo(s.x, s.y); }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#000";
    ctx.stroke();
  };
  const finishLasso = (pts, mode, name) => {
    if (pts.length < 3) { if (mode === "new" && doc().sel) PS.setSel(null, "Deselect"); return; }
    const c = PS.selShape((ctx) => { pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }, opt.sel.feather);
    PS.applySel(c, mode, name);
  };
  let lasso = null;
  def("lasso", {
    name: "Lasso Tool", key: "L", cursor: "crosshair",
    down(e, p) { lasso = { pts: [p], mode: selMode(e, opt.sel.mode) }; },
    move(e, p) { if (lasso) { lasso.pts.push(p); PS.draw(); } },
    up() { if (!lasso) return; const l = lasso; lasso = null; finishLasso(l.pts, l.mode, "Lasso"); },
    overlay(ctx, v) { if (lasso) lassoOverlay(lasso.pts)(ctx, v); },
  });
  let poly = null;
  def("polylasso", {
    name: "Polygonal Lasso Tool", key: "L", cursor: "crosshair",
    down(e, p) {
      if (!poly) { poly = { pts: [p], mode: selMode(e, opt.sel.mode), hover: p }; return; }
      const first = PS.toScreen(poly.pts[0].x, poly.pts[0].y), here = PS.toScreen(p.x, p.y);
      if (e.detail >= 2 || Math.hypot(first.x - here.x, first.y - here.y) < 8) return T.polylasso.finish();
      poly.pts.push(p);
      PS.draw();
    },
    hover(p) { if (poly) { poly.hover = p; PS.draw(); } },
    finish() { if (!poly) return; const l = poly; poly = null; finishLasso(l.pts, l.mode, "Polygonal Lasso"); },
    cancel() { poly = null; PS.draw(); },
    busy: () => !!poly,
    overlay(ctx, v) { if (poly) lassoOverlay(poly.pts, poly.hover)(ctx, v); },
  });

  // Magic Wand and Paint Bucket: the pixels like the one clicked
  PS.similar = (src, ox, oy, x, y, tol, contiguous) => {
    const d = doc();
    const w = src.width, h = src.height;
    x = Math.floor(x - ox); y = Math.floor(y - oy);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const data = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const i0 = (y * w + x) * 4;
    const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
    const t = tol * 1.0;
    const like = (i) => Math.abs(data[i] - r0) <= t && Math.abs(data[i + 1] - g0) <= t && Math.abs(data[i + 2] - b0) <= t && Math.abs(data[i + 3] - a0) <= t;
    const hit = new Uint8Array(w * h);
    if (contiguous) {
      const stack = [x, y];
      while (stack.length) {
        const sy = stack.pop(), sx0 = stack.pop();
        let sx = sx0;
        while (sx >= 0 && !hit[sy * w + sx] && like((sy * w + sx) * 4)) sx--;
        sx++;
        let up = false, down = false;
        for (; sx < w && !hit[sy * w + sx] && like((sy * w + sx) * 4); sx++) {
          hit[sy * w + sx] = 1;
          if (sy > 0) { const u = !hit[(sy - 1) * w + sx] && like(((sy - 1) * w + sx) * 4); if (u && !up) stack.push(sx, sy - 1); up = u; }
          if (sy < h - 1) { const dn = !hit[(sy + 1) * w + sx] && like(((sy + 1) * w + sx) * 4); if (dn && !down) stack.push(sx, sy + 1); down = dn; }
        }
      }
    } else {
      for (let i = 0; i < w * h; i++) if (like(i * 4)) hit[i] = 1;
    }
    const c = PS.canvas(d.w, d.h), part = PS.canvas(w, h), pc = part.getContext("2d");
    const out = pc.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (hit[i]) out.data[i * 4 + 3] = 255;
    pc.putImageData(out, 0, 0);
    c.getContext("2d").drawImage(part, ox, oy);
    return c;
  };
  const sampleSource = (all) => {
    const d = doc(), l = PS.active();
    if (all || !l) return { c: PS.composite(d, { fresh: true }), x: 0, y: 0 };
    const s = PS.styled(l);
    return { c: s.c, x: s.x, y: s.y };
  };
  def("wand", {
    name: "Magic Wand Tool", key: "W", cursor: "crosshair",
    down(e, p) {
      const s = sampleSource(opt.wand.all);
      const c = PS.similar(s.c, s.x, s.y, p.x, p.y, opt.wand.tol, opt.wand.contiguous);
      if (c) PS.applySel(c, selMode(e, opt.sel.mode), "Magic Wand");
    },
  });

  // Object Selection (AI): drag a box around something, or click to select the main subject
  let box = null;
  def("objsel", {
    name: "Object Selection Tool", key: "W", cursor: "crosshair", ai: true,
    down(e, p) { box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, mode: selMode(e, opt.sel.mode) }; },
    move(e, p) { if (box) { box.x1 = p.x; box.y1 = p.y; PS.draw(); } },
    up() {
      if (!box) return;
      const b = box;
      box = null;
      PS.draw();
      const d = doc();
      let x = Math.round(Math.min(b.x0, b.x1)), y = Math.round(Math.min(b.y0, b.y1));
      let w = Math.round(Math.abs(b.x1 - b.x0)), h = Math.round(Math.abs(b.y1 - b.y0));
      if (w < 6 || h < 6) return PS.selectSubject(b.mode);
      x = PS.clamp(x, 0, d.w - 1); y = PS.clamp(y, 0, d.h - 1);
      w = Math.min(w, d.w - x); h = Math.min(h, d.h - y);
      PS.selectObject({ x, y, w, h }, b.mode);
    },
    overlay(ctx) {
      if (!box) return;
      const a = PS.toScreen(box.x0, box.y0), c = PS.toScreen(box.x1, box.y1);
      ctx.fillStyle = "rgba(20,115,230,.12)";
      ctx.fillRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y));
      ctx.strokeStyle = "#378ef0";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y));
    },
  });

  // ---------------------------------------------------------------- Crop (C)
  let crop = null, cropDrag = null;
  const RATIOS = { free: 0, "1:1": 1, "4:5": 4 / 5, "5:7": 5 / 7, "2:3": 2 / 3, "16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3 };
  PS.CROP_RATIOS = Object.keys(RATIOS);
  const cropHandles = () => {
    const r = crop, out = [];
    for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      out.push({ hx, hy, x: r.x + (hx + 1) / 2 * r.w, y: r.y + (hy + 1) / 2 * r.h });
    }
    return out;
  };
  def("crop", {
    name: "Crop Tool", key: "C", cursor: "default",
    activate() { const d = doc(); if (d) { crop = { x: 0, y: 0, w: d.w, h: d.h }; PS.draw(); } },
    deactivate() { crop = null; PS.draw(); },
    down(e, p) {
      if (!crop) T.crop.activate();
      const z = doc().view.zoom;
      const h = cropHandles().find((k) => Math.abs(k.x - p.x) * z < 8 && Math.abs(k.y - p.y) * z < 8);
      if (h) cropDrag = { h, start: { ...crop } };
      else if (p.x > crop.x && p.y > crop.y && p.x < crop.x + crop.w && p.y < crop.y + crop.h) cropDrag = { move: true, px: p.x, py: p.y, start: { ...crop } };
      else cropDrag = { draw: true, x0: p.x, y0: p.y };
    },
    move(e, p) {
      if (!cropDrag) return;
      const g = cropDrag, ratio = RATIOS[opt.crop.ratio] || (e.shiftKey ? (g.start ? g.start.w / g.start.h : 1) : 0);
      if (g.move) { crop = { ...g.start, x: Math.round(g.start.x + p.x - g.px), y: Math.round(g.start.y + p.y - g.py) }; }
      else if (g.draw) {
        let w = p.x - g.x0, h = p.y - g.y0;
        if (ratio) h = Math.sign(h || 1) * Math.abs(w) / ratio;
        crop = { x: Math.round(Math.min(g.x0, g.x0 + w)), y: Math.round(Math.min(g.y0, g.y0 + h)), w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) };
      } else {
        const s = g.start, { hx, hy } = g.h;
        let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
        if (hx < 0) x0 = p.x; if (hx > 0) x1 = p.x;
        if (hy < 0) y0 = p.y; if (hy > 0) y1 = p.y;
        if (ratio) {
          const w = Math.abs(x1 - x0), h = w / ratio;
          if (hy < 0) y0 = y1 - h; else y1 = y0 + h;
        }
        crop = { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) };
      }
      PS.draw();
      PS.onCrop && PS.onCrop(crop);
    },
    up() { cropDrag = null; },
    commit() {
      const d = doc();
      if (!crop || crop.w < 1 || crop.h < 1) return;
      const c = crop;
      for (const l of d.layers) PS.moveLayer(l, -c.x, -c.y);
      d.w = c.w; d.h = c.h;
      d.sel = null;
      d.comp = null;
      crop = { x: 0, y: 0, w: d.w, h: d.h };
      PS.commit("Crop");
      PS.fit();
    },
    cancel() { T.crop.activate(); },
    busy: () => crop && (crop.x || crop.y || crop.w !== doc().w || crop.h !== doc().h),
    get rect() { return crop; },
    overlay(ctx, v) {
      if (!crop) return;
      const a = PS.toScreen(crop.x, crop.y), w = crop.w * v.zoom, h = crop.h * v.zoom;
      const W = PS.viewEl.clientWidth, H = PS.viewEl.clientHeight;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(a.x + w, a.y, -w, h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(a.x + (w * i) / 3, a.y); ctx.lineTo(a.x + (w * i) / 3, a.y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x, a.y + (h * i) / 3); ctx.lineTo(a.x + w, a.y + (h * i) / 3); ctx.stroke();
      }
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
      ctx.fillStyle = "#fff";
      for (const k of cropHandles()) {
        const s = PS.toScreen(k.x, k.y);
        if (k.hx && k.hy) { // corners: an L
          ctx.fillRect(s.x - (k.hx > 0 ? 14 : 0), s.y - (k.hy > 0 ? 3 : 0), 14, 3);
          ctx.fillRect(s.x - (k.hx > 0 ? 3 : 0), s.y - (k.hy > 0 ? 14 : 0), 3, 14);
        } else if (k.hx) ctx.fillRect(s.x - 1.5, s.y - 7, 3, 14);
        else ctx.fillRect(s.x - 7, s.y - 1.5, 14, 3);
      }
    },
  });

  // ---------------------------------------------------------------- Eyedropper (I)
  PS.pick = (p, toBg, all) => {
    const s = sampleSource(all);
    const x = Math.floor(p.x - s.x), y = Math.floor(p.y - s.y);
    if (x < 0 || y < 0 || x >= s.c.width || y >= s.c.height) return;
    const px = s.c.getContext("2d").getImageData(x, y, 1, 1).data;
    if (px[3] === 0) return;
    const c = { r: px[0], g: px[1], b: px[2] };
    if (toBg) PS.bg = c; else PS.fg = c;
    PS.onColors && PS.onColors();
  };
  let picking = false;
  def("eyedropper", {
    name: "Eyedropper Tool", key: "I", cursor: "crosshair",
    down(e, p) { picking = true; PS.pick(p, e.altKey, opt.eyedropper.all); },
    move(e, p) { if (picking) PS.pick(p, e.altKey, opt.eyedropper.all); },
    up() { picking = false; },
  });

  // ---------------------------------------------------------------- Brush (B) and Eraser (E)
  let stroke = null;
  const dabCache = {};
  const dab = (size, hard, color) => {
    const key = `${size}|${hard}|${color}`;
    if (dabCache[key]) return dabCache[key];
    const r = size / 2, c = PS.canvas(Math.ceil(size) + 2, Math.ceil(size) + 2), ctx = c.getContext("2d");
    const cx = c.width / 2, cy = c.height / 2;
    if (hard >= 100) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
    } else {
      const g = ctx.createRadialGradient(cx, cy, r * (hard / 100), cx, cy, Math.max(0.6, r));
      g.addColorStop(0, color);
      g.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ",0)"));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.6, r), 0, Math.PI * 2); ctx.fill();
    }
    if (Object.keys(dabCache).length > 40) for (const k in dabCache) delete dabCache[k];
    return (dabCache[key] = c);
  };
  const lum = (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  const paintTool = (id, name, key, eraser) => def(id, {
    name, key, cursor: "none",
    down(e, p) {
      const o = opt[id];
      if (e.altKey && !eraser) return PS.pick(p, false, true); // Alt: pick a color, like Photoshop
      const l = paintable(eraser ? "eraser" : "brush");
      if (!l) return;
      const d = doc();
      const onMask = !!(d.maskEdit && l.mask);
      PS.editPixels(l);
      const color = onMask ? { r: 0, g: 0, b: 0 } : eraser && l.locked ? PS.bg : PS.fg;
      const buf = PS.canvas(d.w, d.h);
      stroke = { l, o, onMask, eraser, buf, last: null, color, maskValue: onMask ? lum(eraser ? PS.bg : PS.fg) : 0 };
      const from = e.shiftKey && PS.lastPaint ? PS.lastPaint : null;
      if (from) { stroke.last = from; line(stroke, p); } else stamp(stroke, p);
      PS.live = { layer: l, draw: (ctx, layer) => liveDraw(ctx, layer, stroke) };
      PS.changed();
    },
    move(e, p) {
      PS.cursorAt = p;
      if (!stroke) return PS.draw();
      line(stroke, p);
      PS.changed();
    },
    hover(p) { PS.cursorAt = p; PS.draw(); },
    up() {
      if (!stroke) return;
      const s = stroke;
      stroke = null;
      PS.lastPaint = s.last;
      const l = s.l;
      const made = finished(s, l);
      if (s.onMask) l.mask = made; else l.canvas = made;
      PS.live = null;
      PS.commit(eraser ? "Eraser" : "Brush Tool");
    },
    overlay(ctx, v, size) {
      if (!PS.cursorAt) return;
      const s = PS.toScreen(PS.cursorAt.x, PS.cursorAt.y), r = Math.max(1, ((size || opt[id].size) / 2) * v.zoom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.5, r - 0.5), 0, Math.PI * 2); ctx.stroke();
      if (r < 4) { ctx.fillStyle = "#fff"; ctx.fillRect(s.x - 0.5, s.y - 5, 1, 10); ctx.fillRect(s.x - 5, s.y - 0.5, 10, 1); }
    },
  });
  const stamp = (s, p) => {
    const o = s.o, c = s.color;
    const img = dab(o.size, o.hard, `rgba(${c.r},${c.g},${c.b},${o.flow / 100})`);
    s.buf.getContext("2d").drawImage(img, p.x - img.width / 2, p.y - img.height / 2);
    s.last = p;
  };
  const line = (s, p) => {
    const a = s.last, dist = Math.hypot(p.x - a.x, p.y - a.y), step = Math.max(1, s.o.size * 0.12);
    if (dist < step) return;
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) stamp(s, { x: a.x + ((p.x - a.x) * i) / n, y: a.y + ((p.y - a.y) * i) / n });
  };
  // the layer (or its mask) with the stroke so far
  const finished = (s, l) => {
    const d = doc();
    const buf = PS.clipToSel(PS.clone(s.buf), 0, 0);
    const base = PS.clone(s.onMask ? l.mask : l.canvas), ctx = base.getContext("2d");
    ctx.globalAlpha = s.o.opacity / 100;
    if (s.onMask) {
      // black hides, white shows (and grays partly)
      const v = s.maskValue;
      if (v < 1) { ctx.globalCompositeOperation = "destination-out"; ctx.globalAlpha *= 1 - v; ctx.drawImage(buf, -l.x, -l.y); }
      if (v > 0) { ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = (s.o.opacity / 100) * v; ctx.drawImage(buf, -l.x, -l.y); }
    } else {
      ctx.globalCompositeOperation = s.eraser && !l.locked ? "destination-out" : PS.gco(s.o.mode || "normal");
      ctx.drawImage(buf, -l.x, -l.y);
    }
    void d;
    return base;
  };
  const liveDraw = (ctx, l, s) => {
    const made = finished(s, l);
    const st = PS.styled(s.onMask ? { ...l, mask: made, _st: null } : { ...l, canvas: made, _st: null });
    ctx.drawImage(st.c, st.x, st.y);
  };
  paintTool("brush", "Brush Tool", "B", false);
  paintTool("eraser", "Eraser Tool", "E", true);

  // ---------------------------------------------------------------- Clone Stamp (S), Healing Brush (J), Spot Healing Brush (J)
  // These paint "coverage" like a brush; what goes where the coverage is depends on the tool.
  let cloneFrom = null, cloneOff = null, cov = null;
  const sampled = (l, all) => { // the picture to copy from, picture-sized
    const d = doc();
    if (all) return PS.composite(d, { fresh: true });
    const c = PS.canvas(d.w, d.h), s2 = PS.styled({ ...l, fx: null, fill: 100, mask: null, _st: null });
    c.getContext("2d").drawImage(s2.c, s2.x, s2.y);
    return c;
  };
  const covResult = (c, last) => {
    const coverage = PS.clipToSel(PS.clone(c.buf), 0, 0);
    const piece = (last && c.final ? c.final : c.make)(coverage);
    const base = PS.clone(c.l.canvas), bx = base.getContext("2d");
    bx.globalAlpha = c.o.opacity / 100;
    bx.drawImage(piece, -c.l.x, -c.l.y);
    return base;
  };
  const covTool = (id, name, key, setup) => def(id, {
    name, key, cursor: "none",
    down(e, p) {
      if (e.altKey && id !== "spotheal") { cloneFrom = { x: p.x, y: p.y }; cloneOff = null; PS.draw(); return; }
      const l = paintable(name.replace(" Tool", "").toLowerCase());
      if (!l) return;
      if (PS.isAdj(l)) return toast(`Could not use the ${name.replace(" Tool", "").toLowerCase()} on an adjustment layer.`);
      const ways = setup(l, p);
      if (!ways) return;
      PS.editPixels(l);
      cov = { l, o: opt[id], buf: PS.canvas(doc().w, doc().h), last: null, color: { r: 0, g: 0, b: 0 }, ...ways };
      stamp(cov, p);
      PS.live = { layer: l, draw: (ctx, layer) => { const st = PS.styled({ ...layer, canvas: covResult(cov, false), _st: null }); ctx.drawImage(st.c, st.x, st.y); } };
      PS.changed();
    },
    move(e, p) { PS.cursorAt = p; if (!cov) return PS.draw(); line(cov, p); PS.changed(); },
    hover(p) { PS.cursorAt = p; PS.draw(); },
    up() {
      if (!cov) return;
      const c = cov;
      cov = null;
      let made;
      try { made = covResult(c, true); } catch (err) { made = null; }
      PS.live = null;
      if (!made) { PS.changed(); return toast("Couldn't heal that area. Try a smaller brush."); }
      c.l.canvas = made;
      PS.commit(name.replace(" Tool", ""));
    },
    overlay(ctx, v) {
      T.brush.overlay.call({}, ctx, v, opt[id].size);
      if (id === "spotheal" || !cloneFrom || !PS.cursorAt) return;
      const src = opt[id].aligned && cloneOff ? { x: PS.cursorAt.x + cloneOff.x, y: PS.cursorAt.y + cloneOff.y } : cov ? null : cloneFrom;
      if (!src) return;
      const sp = PS.toScreen(src.x, src.y), r = Math.max(4, (opt[id].size / 2) * v.zoom);
      ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sp.x - 6, sp.y); ctx.lineTo(sp.x + 6, sp.y); ctx.moveTo(sp.x, sp.y - 6); ctx.lineTo(sp.x, sp.y + 6); ctx.stroke();
    },
  });
  const needSource = (what) => { toast(`Could not use the ${what} because the area to clone has not been defined (Alt-click to define a source point).`); return null; };
  const shifted = (src, off, coverage) => {
    const d = doc(), piece = PS.canvas(d.w, d.h), pc = piece.getContext("2d");
    pc.drawImage(src, -off.x, -off.y);
    pc.globalCompositeOperation = "destination-in";
    pc.drawImage(coverage, 0, 0);
    return piece;
  };
  covTool("clone", "Clone Stamp Tool", "S", (l, p) => {
    if (!cloneFrom) return needSource("clone stamp");
    if (!opt.clone.aligned || !cloneOff) cloneOff = { x: cloneFrom.x - p.x, y: cloneFrom.y - p.y };
    const src = sampled(l, opt.clone.all), off = { ...cloneOff };
    return { make: (coverage) => shifted(src, off, coverage) };
  });
  covTool("heal", "Healing Brush Tool", "J", (l, p) => {
    if (!cloneFrom) return needSource("healing brush");
    if (!opt.heal.aligned || !cloneOff) cloneOff = { x: cloneFrom.x - p.x, y: cloneFrom.y - p.y };
    const src = sampled(l, opt.heal.all), off = { ...cloneOff };
    return { make: (coverage) => shifted(src, off, coverage), final: (coverage) => PS.heal(src, coverage, off, opt.heal.size) };
  });
  covTool("spotheal", "Spot Healing Brush Tool", "J", (l) => {
    const src = sampled(l, opt.spotheal.all);
    return {
      make: (coverage) => { const c = PS.clone(coverage), x = c.getContext("2d"); x.globalCompositeOperation = "source-in"; x.fillStyle = "rgba(0,0,0,.45)"; x.fillRect(0, 0, c.width, c.height); return c; },
      final: (coverage) => PS.heal(src, coverage, PS.findPatch(src, coverage, opt.spotheal.size), opt.spotheal.size),
    };
  });

  // Healing: the copied pixels keep their texture but take on the colors around the painted area.
  // (The difference between target and source is known around the edge, and spread smoothly inside.)
  const boxBlur = (a, w, h, r) => {
    r = Math.max(1, Math.round(r));
    const tmp = new Float32Array(a.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) { // rows
        let acc = 0; const o = y * w;
        for (let x = -r; x <= r; x++) acc += a[o + PS.clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) { tmp[o + x] = acc / (2 * r + 1); acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
      }
      for (let x = 0; x < w; x++) { // columns
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[PS.clamp(y, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
      }
    }
    return a;
  };
  PS.heal = (src, coverage, off, size) => {
    const d = doc();
    const bb = bounds(coverage);
    const piece = PS.canvas(d.w, d.h);
    if (!bb) return piece;
    const m = Math.ceil(size) + 6;
    const rx = Math.max(0, bb.x - m), ry = Math.max(0, bb.y - m);
    const rw = Math.min(d.w, bb.x + bb.w + m) - rx, rh = Math.min(d.h, bb.y + bb.h + m) - ry;
    const T = src.getContext("2d", { willReadFrequently: true }).getImageData(rx, ry, rw, rh).data;
    const sc = PS.canvas(rw, rh);
    sc.getContext("2d").drawImage(src, -(rx + off.x), -(ry + off.y));
    const S = sc.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, rw, rh).data;
    const M = coverage.getContext("2d", { willReadFrequently: true }).getImageData(rx, ry, rw, rh).data;
    const n = rw * rh, known = new Float32Array(n);
    for (let i = 0; i < n; i++) known[i] = M[i * 4 + 3] > 4 ? 0 : 1;
    const r1 = Math.max(3, size * 0.6), r2 = Math.max(8, size * 2);
    const den1 = boxBlur(Float32Array.from(known), rw, rh, r1), den2 = boxBlur(Float32Array.from(known), rw, rh, r2);
    const out = new ImageData(rw, rh);
    for (let ch = 0; ch < 4; ch++) {
      const num1 = new Float32Array(n);
      for (let i = 0; i < n; i++) num1[i] = known[i] * (T[i * 4 + ch] - S[i * 4 + ch]);
      const num2 = Float32Array.from(num1);
      boxBlur(num1, rw, rh, r1); boxBlur(num2, rw, rh, r2);
      for (let i = 0; i < n; i++) {
        const fix = den1[i] > 0.04 ? num1[i] / den1[i] : num2[i] / Math.max(den2[i], 1e-4);
        out.data[i * 4 + ch] = S[i * 4 + ch] + fix;
      }
    }
    for (let i = 0; i < n; i++) out.data[i * 4 + 3] = Math.round((out.data[i * 4 + 3] * M[i * 4 + 3]) / 255);
    piece.getContext("2d").putImageData(out, rx, ry);
    return piece;
  };
  // Spot Healing: looks around the painted spot for the patch whose surroundings match best
  PS.findPatch = (src, coverage, size) => {
    const d = doc();
    const bb = bounds(coverage);
    if (!bb) return { x: size, y: 0 };
    const all = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, d.w, d.h).data;
    const M = coverage.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, d.w, d.h).data;
    const m = Math.ceil(size / 2) + 4;
    const ring = [];
    const x0 = Math.max(0, bb.x - m), y0 = Math.max(0, bb.y - m), x1 = Math.min(d.w - 1, bb.x + bb.w + m), y1 = Math.min(d.h - 1, bb.y + bb.h + m);
    const step = Math.max(1, Math.round((x1 - x0) * (y1 - y0) / 6000));
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) if (M[(y * d.w + x) * 4 + 3] <= 4) ring.push(x, y);
    let best = null, bestScore = Infinity;
    const reach = Math.max(bb.w, bb.h) + m;
    for (const f of [1, 1.4, 1.9]) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, ox = Math.round(Math.cos(a) * reach * f), oy = Math.round(Math.sin(a) * reach * f);
      if (bb.x + ox - m < 0 || bb.y + oy - m < 0 || bb.x + bb.w + ox + m >= d.w || bb.y + bb.h + oy + m >= d.h) continue;
      let sc = 0;
      for (let i = 0; i < ring.length; i += 2) {
        const p = (ring[i + 1] * d.w + ring[i]) * 4, q = ((ring[i + 1] + oy) * d.w + ring[i] + ox) * 4;
        sc += Math.abs(all[p] - all[q]) + Math.abs(all[p + 1] - all[q + 1]) + Math.abs(all[p + 2] - all[q + 2]);
      }
      // the patch itself shouldn't be busy: a little extra cost for detail inside it
      let detail = 0;
      for (let y = bb.y; y < bb.y + bb.h; y += Math.max(1, step * 2)) for (let x = bb.x + 1; x < bb.x + bb.w; x += Math.max(1, step * 2)) {
        const q = ((y + oy) * d.w + x + ox) * 4;
        detail += Math.abs(all[q] - all[q - 4]) + Math.abs(all[q + 1] - all[q - 3]) + Math.abs(all[q + 2] - all[q - 2]);
      }
      const score = sc / Math.max(1, ring.length / 2) + 0.3 * detail / Math.max(1, (bb.w * bb.h) / Math.max(1, step * step * 4)) + f * 2;
      if (score < bestScore) { bestScore = score; best = { x: ox, y: oy }; }
    }
    return best || { x: reach, y: 0 };
  };

  // ---------------------------------------------------------------- Gradient (G) and Paint Bucket (G)
  let grad = null;
  const makeGradient = (g) => {
    const d = doc(), o = opt.gradient;
    const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
    let a = PS.hex(PS.fg), b = o.transparent ? `rgba(${PS.fg.r},${PS.fg.g},${PS.fg.b},0)` : PS.hex(PS.bg);
    if (o.reverse) [a, b] = [b, a];
    const gr = o.type === "radial"
      ? ctx.createRadialGradient(g.x0, g.y0, 0, g.x0, g.y0, Math.max(1, Math.hypot(g.x1 - g.x0, g.y1 - g.y0)))
      : ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    gr.addColorStop(0, a);
    gr.addColorStop(1, b);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, d.w, d.h);
    return PS.clipToSel(c, 0, 0);
  };
  def("gradient", {
    name: "Gradient Tool", key: "G", cursor: "crosshair",
    down(e, p) { const l = paintable("gradient tool"); if (l) grad = { l, x0: p.x, y0: p.y, x1: p.x, y1: p.y }; },
    move(e, p) {
      if (!grad) return;
      let x = p.x, y = p.y;
      if (e.shiftKey) { // straight, or at 45°
        const ang = Math.round(Math.atan2(y - grad.y0, x - grad.x0) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x - grad.x0, y - grad.y0);
        x = grad.x0 + Math.cos(ang) * len; y = grad.y0 + Math.sin(ang) * len;
      }
      grad.x1 = x; grad.y1 = y;
      PS.draw();
    },
    up() {
      if (!grad) return;
      const g = grad;
      grad = null;
      if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 2) return PS.draw();
      const l = g.l;
      const ctx = PS.editPixels(l);
      ctx.globalAlpha = opt.gradient.opacity / 100;
      ctx.globalCompositeOperation = PS.gco(opt.gradient.mode);
      ctx.drawImage(makeGradient(g), -l.x, -l.y);
      PS.commit("Gradient");
    },
    overlay(ctx) {
      if (!grad) return;
      const a = PS.toScreen(grad.x0, grad.y0), b = PS.toScreen(grad.x1, grad.y1);
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
      for (const [pt, col] of [[a, PS.hex(PS.fg)], [b, PS.hex(PS.bg)]]) {
        ctx.fillStyle = col; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    },
  });
  def("bucket", {
    name: "Paint Bucket Tool", key: "G", cursor: "crosshair",
    down(e, p) {
      const l = paintable("paint bucket");
      if (!l) return;
      const s = sampleSource(opt.bucket.all);
      const area = PS.similar(s.c, s.x, s.y, p.x, p.y, opt.bucket.tol, opt.bucket.contiguous);
      if (!area) return;
      const ac = area.getContext("2d");
      ac.globalCompositeOperation = "source-in";
      ac.fillStyle = PS.hex(PS.fg);
      ac.fillRect(0, 0, area.width, area.height);
      PS.clipToSel(area, 0, 0);
      const ctx = PS.editPixels(l);
      ctx.globalAlpha = opt.bucket.opacity / 100;
      ctx.drawImage(area, -l.x, -l.y);
      PS.commit("Paint Bucket");
    },
  });

  // ---------------------------------------------------------------- Type (T)
  def("type", {
    name: "Horizontal Type Tool", key: "T", cursor: "text",
    down(e, p) {
      const d = doc();
      if (PS.typing) return PS.endTyping(true);
      for (let i = d.layers.length - 1; i >= 0; i--) {
        const l = d.layers[i];
        if (!PS.isText(l) || !l.visible) continue;
        PS.syncText(l);
        if (p.x >= l.x && p.y >= l.y && p.x <= l.x + l.canvas.width && p.y <= l.y + l.canvas.height) { d.active = l.id; return PS.startTyping(l, false); }
      }
      const o = opt.type;
      const l = PS.layer({ kind: "text", name: "Layer", autoName: true,
        text: { str: "", font: o.font, size: o.size, bold: o.bold, italic: o.italic, align: o.align, color: PS.hex(PS.fg), x: Math.round(p.x), y: Math.round(p.y), angle: 0, leading: 1.2 } });
      const at = PS.active() ? PS.layerIndex(PS.active()) + 1 : d.layers.length;
      d.layers.splice(at, 0, l);
      d.active = l.id;
      PS.startTyping(l, true);
    },
  });

  // ---------------------------------------------------------------- Rectangle (U) and Ellipse (U)
  let shp = null;
  const shapeTool = (id, name, kind) => def(id, {
    name, key: "U", cursor: "crosshair",
    down(e, p) { shp = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; },
    move(e, p) {
      if (!shp) return;
      shp.x1 = p.x; shp.y1 = p.y;
      if (e.shiftKey) {
        const s = Math.max(Math.abs(shp.x1 - shp.x0), Math.abs(shp.y1 - shp.y0));
        shp.x1 = shp.x0 + Math.sign(shp.x1 - shp.x0 || 1) * s; shp.y1 = shp.y0 + Math.sign(shp.y1 - shp.y0 || 1) * s;
      }
      PS.draw();
    },
    up() {
      if (!shp) return;
      const g = shp;
      shp = null;
      const x = Math.round(Math.min(g.x0, g.x1)), y = Math.round(Math.min(g.y0, g.y1));
      const w = Math.round(Math.abs(g.x1 - g.x0)), h = Math.round(Math.abs(g.y1 - g.y0));
      if (w < 2 || h < 2) return PS.draw();
      const c = PS.canvas(w, h), ctx = c.getContext("2d");
      ctx.fillStyle = PS.hex(PS.fg);
      ctx.beginPath();
      if (kind === "rect") ctx.roundRect(0, 0, w, h, Math.min(opt.shape.radius, w / 2, h / 2));
      else ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      PS.addLayer(PS.layer({ name: PS.layerName(kind === "rect" ? "Rectangle" : "Ellipse"), canvas: c, x, y }), kind === "rect" ? "Rectangle Tool" : "Ellipse Tool");
    },
    overlay(ctx) {
      if (!shp) return;
      const a = PS.toScreen(shp.x0, shp.y0), b = PS.toScreen(shp.x1, shp.y1);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.fillStyle = PS.hex(PS.fg);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (kind === "rect") ctx.roundRect(x, y, w, h, Math.min(opt.shape.radius * doc().view.zoom, w / 2, h / 2));
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#378ef0";
      ctx.lineWidth = 1;
      ctx.stroke();
    },
  });
  shapeTool("rect", "Rectangle Tool", "rect");
  shapeTool("ellipseShape", "Ellipse Tool", "ellipse");

  // ---------------------------------------------------------------- Hand (H) and Zoom (Z)
  let pan = null;
  def("hand", {
    name: "Hand Tool", key: "H", cursor: "grab",
    down(e) { const v = doc().view; pan = { sx: e.clientX, sy: e.clientY, x: v.x, y: v.y }; PS.viewCanvas.style.cursor = "grabbing"; },
    move(e) { if (!pan) return; const v = doc().view; v.x = pan.x + e.clientX - pan.sx; v.y = pan.y + e.clientY - pan.sy; PS.draw(); },
    up() { pan = null; PS.viewCanvas.style.cursor = ""; PS.setCursor(); },
  });
  def("zoom", {
    name: "Zoom Tool", key: "Z", cursor: "zoom-in",
    down(e) { const r = PS.viewEl.getBoundingClientRect(); PS.stepZoom(e.altKey ? -1 : 1, e.clientX - r.left, e.clientY - r.top); },
  });

  // ---------------------------------------------------------------- Free Transform (Ctrl+T)
  // The box: centre cx, cy; size w, h (scaled); turned by ang (radians). src is drawn into it.
  // An item (src, at rect r in the picture) as moved by the box: the box was b, it is now centred at cx, cy, w x h, turned by ang.
  PS.drawXf = (ctx, x, ox = 0, oy = 0, item) => {
    const it = item || { src: x.src, r: x.b };
    ctx.save();
    ctx.translate(x.cx + ox, x.cy + oy);
    ctx.rotate(x.ang);
    ctx.scale(x.w / x.b.w, x.h / x.b.h);
    ctx.translate(-(x.b.x + x.b.w / 2), -(x.b.y + x.b.h / 2));
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(it.src, it.r.x, it.r.y, it.r.w, it.r.h);
    ctx.restore();
  };
  const xfPoint = (x, px, py) => {
    const sx = x.w / x.b.w, sy = x.h / x.b.h;
    const rx = (px - (x.b.x + x.b.w / 2)) * sx, ry = (py - (x.b.y + x.b.h / 2)) * sy;
    return [x.cx + rx * Math.cos(x.ang) - ry * Math.sin(x.ang), x.cy + rx * Math.sin(x.ang) + ry * Math.cos(x.ang)];
  };
  const bounds = (c) => {
    const w = c.width, h = c.height, data = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  PS.bounds = bounds;
  const crop2 = (c, b) => { const o = PS.canvas(b.w, b.h); o.getContext("2d").drawImage(c, -b.x, -b.y); return o; };

  PS.startTransform = () => {
    const d = doc(), l = PS.active();
    if (!l || PS.xf) return;
    PS.endTyping && PS.endTyping(true);
    const list = PS.targets().filter((x) => PS.isPixels(x));
    if (!list.length) return toast("Could not complete the Free Transform command because there is nothing to transform.");
    if (list.some((x) => x.locked)) return toast("Could not complete the Free Transform command because the layer is locked.");
    if (list.some((x) => !PS.shown(x))) return toast("Could not complete the Free Transform command because the layer is hidden.");
    if (d.sel && list.length === 1 && list[0].kind === "pixel") { // only the selected pixels move
      const one = list[0];
      const float = PS.lift(one);
      let b = bounds(float.c);
      if (!b) { PS.drop(float); PS.changed(); return toast("Could not transform because the selected area is empty."); }
      const src = crop2(float.c, b);
      float.selSrc = crop2(d.sel.c, { x: b.x + one.x, y: b.y + one.y, w: b.w, h: b.h });
      b = { x: b.x + one.x, y: b.y + one.y, w: b.w, h: b.h };
      PS.xf = { l: one, src, b, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, ang: 0, float, items: [] };
      float.xf = PS.xf;
    } else {
      const items = [];
      for (const x of list) {
        PS.syncText(x);
        const bb = bounds(x.canvas);
        if (!bb) continue;
        const src = crop2(x.canvas, bb);
        let shown = src, mask = null;
        if (x.mask && !PS.isText(x)) {
          mask = crop2(x.mask, bb);
          if (x.maskOn) { shown = PS.clone(src); const sc = shown.getContext("2d"); sc.globalCompositeOperation = "destination-in"; sc.drawImage(mask, 0, 0); }
        }
        items.push({ l: x, src, shown, mask, r: { x: x.x + bb.x, y: x.y + bb.y, w: bb.w, h: bb.h } });
      }
      if (!items.length) return toast("Could not transform because the layer is empty.");
      const x0 = Math.min(...items.map((i) => i.r.x)), y0 = Math.min(...items.map((i) => i.r.y));
      const x1 = Math.max(...items.map((i) => i.r.x + i.r.w)), y1 = Math.max(...items.map((i) => i.r.y + i.r.h));
      const b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      PS.xf = { l, items, b, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, ang: 0, textOnly: items.every((i) => PS.isText(i.l)) };
      PS.live = { layers: new Set(items.map((i) => i.l)), draw: (ctx, layer) => { const it = items.find((i) => i.l === layer); PS.drawXf(ctx, PS.xf, 0, 0, { src: it.shown, r: it.r }); } };
    }
    PS.changed();
    PS.onTransform && PS.onTransform();
  };
  PS.endTransform = (apply) => {
    const x = PS.xf;
    if (!x) return;
    PS.xf = null;
    const d = doc();
    const changed = Math.abs(x.w - x.b.w) > 0.01 || Math.abs(x.h - x.b.h) > 0.01 || x.ang || Math.abs(x.cx - (x.b.x + x.b.w / 2)) > 0.01 || Math.abs(x.cy - (x.b.y + x.b.h / 2)) > 0.01;
    if (x.float) {
      if (apply && changed) { PS.drop(x.float); PS.commit("Free Transform"); }
      else { PS.live = null; PS.floatSel = null; PS.goto(d.hi); } // back to how it was before
      PS.onTransform && PS.onTransform();
      return;
    }
    PS.live = null;
    if (apply && changed) {
      const sx = x.w / x.b.w, sy = x.h / x.b.h;
      for (const it of x.items) {
        const l = it.l;
        if (PS.isText(l)) {
          const t = l.text, [nx, ny] = xfPoint(x, t.x, t.y);
          l.text = { ...t, size: Math.max(1, Math.round(t.size * Math.sqrt(sx * sy) * 10) / 10), angle: ((t.angle || 0) + (x.ang * 180) / Math.PI) % 360, x: Math.round(nx), y: Math.round(ny) };
          PS.syncText(l);
          continue;
        }
        const corners = [[it.r.x, it.r.y], [it.r.x + it.r.w, it.r.y], [it.r.x, it.r.y + it.r.h], [it.r.x + it.r.w, it.r.y + it.r.h]].map(([a, b]) => xfPoint(x, a, b));
        const minX = Math.floor(Math.min(...corners.map((p) => p[0]))), minY = Math.floor(Math.min(...corners.map((p) => p[1])));
        const maxX = Math.ceil(Math.max(...corners.map((p) => p[0]))), maxY = Math.ceil(Math.max(...corners.map((p) => p[1])));
        const c = PS.canvas(maxX - minX, maxY - minY);
        PS.drawXf(c.getContext("2d"), x, -minX, -minY, it);
        if (it.mask) {
          const m = PS.canvas(c.width, c.height);
          PS.drawXf(m.getContext("2d"), x, -minX, -minY, { src: it.mask, r: it.r });
          l.mask = m;
        }
        l.canvas = c; l.x = minX; l.y = minY;
      }
      PS.commit("Free Transform");
    } else PS.changed();
    PS.onTransform && PS.onTransform();
  };
  const xfCorners = (x) => {
    const pts = [];
    for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      const px = (hx * x.w) / 2, py = (hy * x.h) / 2;
      pts.push({ hx, hy, x: x.cx + px * Math.cos(x.ang) - py * Math.sin(x.ang), y: x.cy + px * Math.sin(x.ang) + py * Math.cos(x.ang) });
    }
    return pts;
  };
  const toLocal = (x, px, py, ox, oy) => {
    const dx = px - ox, dy = py - oy;
    return { x: dx * Math.cos(-x.ang) - dy * Math.sin(-x.ang), y: dx * Math.sin(-x.ang) + dy * Math.cos(-x.ang) };
  };
  let xfDrag = null;
  PS.xfTool = {
    down(e, p) {
      const x = PS.xf, z = doc().view.zoom;
      const h = xfCorners(x).find((k) => Math.hypot(k.x - p.x, k.y - p.y) * z < 9);
      const loc = toLocal(x, p.x, p.y, x.cx, x.cy);
      const inside = Math.abs(loc.x) <= x.w / 2 && Math.abs(loc.y) <= x.h / 2;
      if (h) {
        const fx = x.cx - ((h.hx * x.w) / 2) * Math.cos(x.ang) + ((h.hy * x.h) / 2) * Math.sin(x.ang);
        const fy = x.cy - ((h.hx * x.w) / 2) * Math.sin(x.ang) - ((h.hy * x.h) / 2) * Math.cos(x.ang);
        xfDrag = { scale: true, h, fx, fy, w0: x.w, h0: x.h };
      } else if (inside) xfDrag = { move: true, px: p.x, py: p.y, cx: x.cx, cy: x.cy };
      else xfDrag = { rotate: true, a0: Math.atan2(p.y - x.cy, p.x - x.cx), ang: x.ang };
    },
    move(e, p) {
      const x = PS.xf, g = xfDrag;
      if (!g) return PS.xfTool.hover(p);
      if (g.move) { x.cx = g.cx + p.x - g.px; x.cy = g.cy + p.y - g.py; }
      else if (g.rotate) {
        let a = g.ang + Math.atan2(p.y - x.cy, p.x - x.cx) - g.a0;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        x.ang = a;
      } else {
        const { hx, hy } = g.h;
        const loc = toLocal(x, p.x, p.y, g.fx, g.fy);
        let w = hx ? Math.max(1, loc.x * hx) : g.w0, h = hy ? Math.max(1, loc.y * hy) : g.h0;
        const keep = (hx && hy) !== !!e.shiftKey; // corners keep the shape (Shift: don't), like Photoshop
        if (keep) {
          const s = hx && hy ? Math.max(w / g.w0, h / g.h0) : hx ? w / g.w0 : h / g.h0;
          w = g.w0 * s; h = g.h0 * s;
        }
        if (x.textOnly) { const s = hx ? w / g.w0 : h / g.h0; w = g.w0 * s; h = g.h0 * s; }
        x.w = w; x.h = h;
        const lx = (hx * w) / 2, ly = (hy * h) / 2; // the centre, from the fixed point opposite the handle
        x.cx = g.fx + lx * Math.cos(x.ang) - ly * Math.sin(x.ang);
        x.cy = g.fy + lx * Math.sin(x.ang) + ly * Math.cos(x.ang);
      }
      PS.changed();
      PS.onTransform && PS.onTransform();
    },
    up() { xfDrag = null; },
    hover(p) {
      const x = PS.xf, z = doc().view.zoom;
      const h = xfCorners(x).find((k) => Math.hypot(k.x - p.x, k.y - p.y) * z < 9);
      const loc = toLocal(x, p.x, p.y, x.cx, x.cy);
      let cur = "default";
      if (h) {
        const a = (((Math.atan2(h.hy, h.hx) + x.ang) * 180) / Math.PI + 360) % 180;
        cur = a < 22.5 || a >= 157.5 ? "ew-resize" : a < 67.5 ? "nwse-resize" : a < 112.5 ? "ns-resize" : "nesw-resize";
      } else if (Math.abs(loc.x) <= x.w / 2 && Math.abs(loc.y) <= x.h / 2) cur = "move";
      else cur = "alias";
      PS.viewCanvas.style.cursor = cur;
    },
    overlay(ctx) {
      const x = PS.xf;
      const pts = xfCorners(x).map((k) => ({ ...k, s: PS.toScreen(k.x, k.y) }));
      const c = (hx, hy) => pts.find((k) => k.hx === hx && k.hy === hy).s;
      ctx.strokeStyle = "#378ef0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)].forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
      ctx.closePath();
      ctx.stroke();
      for (const k of pts) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(k.s.x - 4, k.s.y - 4, 8, 8);
        ctx.strokeRect(k.s.x - 4 + 0.5, k.s.y - 4 + 0.5, 7, 7);
      }
      const m = PS.toScreen(x.cx, x.cy);
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.stroke();
    },
  };

  // Flip and turn the layer (Edit > Transform)
  PS.flipLayer = (how) => {
    const l = PS.active();
    if (!l) return;
    if (l.locked) return toast("Could not transform because the layer is locked.");
    if (PS.isText(l)) PS.rasterize(l);
    const src = l.canvas, rot = how === "cw" || how === "ccw" || how === "180";
    const c = rot && how !== "180" ? PS.canvas(src.height, src.width) : PS.canvas(src.width, src.height);
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    if (how === "h") ctx.scale(-1, 1);
    if (how === "v") ctx.scale(1, -1);
    if (how === "cw") ctx.rotate(Math.PI / 2);
    if (how === "ccw") ctx.rotate(-Math.PI / 2);
    if (how === "180") ctx.rotate(Math.PI);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    const cx = l.x + src.width / 2, cy = l.y + src.height / 2;
    if (l.mask) {
      const m = PS.canvas(c.width, c.height), mc = m.getContext("2d");
      mc.setTransform(ctx.getTransform());
      mc.drawImage(l.mask, -src.width / 2, -src.height / 2);
      l.mask = m;
    }
    l.canvas = c;
    l.x = Math.round(cx - c.width / 2);
    l.y = Math.round(cy - c.height / 2);
    PS.commit(how === "h" ? "Flip Horizontal" : how === "v" ? "Flip Vertical" : "Rotate");
  };

  // ---------------------------------------------------------------- pointer handling on the picture
  let downTool = null, spaceDown = false;
  PS.setCursor = () => {
    if (!PS.viewCanvas) return;
    const t = spaceDown ? T.hand : T[PS.tool];
    PS.viewCanvas.style.cursor = t ? t.cursor : "default";
  };
  PS.space = (on) => { spaceDown = on; PS.setCursor(); };
  PS.overlay = (ctx, v) => {
    if (PS.xf) return PS.xfTool.overlay(ctx, v);
    const t = T[PS.tool];
    if (t && t.overlay) t.overlay(ctx, v);
  };
  const point = (e) => {
    const r = PS.viewEl.getBoundingClientRect();
    return PS.toDoc(e.clientX - r.left, e.clientY - r.top);
  };
  PS.bindView = (cv) => {
    cv.addEventListener("pointerdown", (e) => {
      if (!PS.doc || e.button === 2) return;
      e.preventDefault(); // keeps the focus where it is (the Type tool's box takes it)
      if (document.activeElement && document.activeElement.matches("input, select")) document.activeElement.blur();
      cv.setPointerCapture(e.pointerId);
      const p = point(e);
      if (e.button === 1 || spaceDown) downTool = T.hand;
      else if (PS.xf) downTool = PS.xfTool;
      else downTool = T[PS.tool];
      if (downTool === T.hand && e.button === 1) cv.style.cursor = "grabbing";
      if (PS.typing && downTool !== T.type && downTool !== T.hand) PS.endTyping(true);
      downTool && downTool.down && downTool.down(e, p);
    });
    cv.addEventListener("pointermove", (e) => {
      if (!PS.doc) return;
      const p = point(e);
      PS.onPointer && PS.onPointer(p);
      if (downTool) { downTool.move && downTool.move(e, p); return; }
      if (PS.xf) return PS.xfTool.hover(p);
      const t = spaceDown ? T.hand : T[PS.tool];
      t && t.hover && t.hover(p);
    });
    const up = (e) => {
      if (!downTool) return;
      const t = downTool;
      downTool = null;
      t.up && t.up(e, point(e));
      if (t === T.hand) PS.setCursor();
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", () => { if (!downTool && PS.cursorAt) { PS.cursorAt = null; PS.draw(); } });
    cv.addEventListener("wheel", (e) => {
      if (!PS.doc) return;
      e.preventDefault();
      e.stopPropagation();
      const v = PS.doc.view, r = PS.viewEl.getBoundingClientRect();
      if (e.ctrlKey || e.altKey) { // zoom around the mouse
        const z = v.zoom * Math.pow(1.0018, -e.deltaY * (e.deltaMode ? 30 : 1));
        PS.setZoom(z, false, e.clientX - r.left, e.clientY - r.top);
      } else if (e.shiftKey) { v.x -= e.deltaY; PS.draw(); } else { v.x -= e.deltaX; v.y -= e.deltaY; PS.draw(); }
    }, { passive: false });
    cv.addEventListener("dblclick", (e) => { if (PS.tool === "polylasso") T.polylasso.finish(); e.preventDefault(); });
  };

  // ---------------------------------------------------------------- layer helpers used by tools and menus
  PS.addLayer = (l, step, below) => {
    const d = doc();
    const a = PS.active();
    const at = a ? PS.layerIndex(a) + (below ? 0 : 1) : d.layers.length;
    d.layers.splice(at, 0, l);
    d.active = l.id;
    if (step) PS.commit(step);
    return l;
  };
  PS.duplicate = (l, quiet) => {
    const copy = { ...l, id: PS.id(), name: l.name + " copy", locked: false, text: l.text && { ...l.text }, fx: l.fx && JSON.parse(JSON.stringify(l.fx)), _st: null };
    const d = doc();
    d.layers.splice(PS.layerIndex(l) + 1, 0, copy);
    d.active = copy.id;
    if (!quiet) PS.commit("Duplicate Layer");
    return copy;
  };
})();
