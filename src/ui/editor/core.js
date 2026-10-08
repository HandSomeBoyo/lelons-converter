// The Editor tab, part 1: documents, layers, history, selections and drawing them.
// Everything lives on window.PS so the other editor files (tools.js, ui.js) can use it.
(() => {
  const PS = (window.PS = window.PS || {});
  let nextId = 1;
  PS.id = () => nextId++;

  // ---- canvases
  PS.canvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  PS.clone = (src) => {
    const c = PS.canvas(src.width, src.height);
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  };
  PS.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  PS.BLENDS = [
    ["normal", "Normal"], ["dissolve", null], ["-"], ["darken", "Darken"], ["multiply", "Multiply"], ["color-burn", "Color Burn"], ["-"],
    ["lighten", "Lighten"], ["screen", "Screen"], ["color-dodge", "Color Dodge"], ["-"],
    ["overlay", "Overlay"], ["soft-light", "Soft Light"], ["hard-light", "Hard Light"], ["-"],
    ["difference", "Difference"], ["exclusion", "Exclusion"], ["-"], ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"], ["luminosity", "Luminosity"],
  ].filter((b) => b[0] === "-" || b[1]);
  PS.gco = (blend) => (blend === "normal" ? "source-over" : blend);

  // ---- colors
  PS.hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  PS.parseHex = (s) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
  };
  PS.rgbToHsv = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max };
  };
  PS.hsvToRgb = ({ h, s, v }) => {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
  };
  PS.fg = { r: 0, g: 0, b: 0 };
  PS.bg = { r: 255, g: 255, b: 255 };

  // ---- layers
  PS.layer = (props) => ({
    id: PS.id(), name: "Layer", kind: "pixel", canvas: null, x: 0, y: 0, visible: true, opacity: 100, fill: 100,
    blend: "normal", locked: false, mask: null, maskOn: true, text: null, fx: null, ...props,
  });
  PS.isText = (l) => l && l.kind === "text";

  PS.isGroup = (l) => l && l.kind === "group";
  PS.isAdj = (l) => l && l.kind === "adjust";
  PS.isPixels = (l) => l && (l.kind === "pixel" || l.kind === "text"); // layers with a picture of their own

  // A text layer's picture is made from its words (then warped, then turned); this keeps it up to date.
  PS.syncText = (l) => {
    if (!PS.isText(l)) return;
    const t = l.text, key = JSON.stringify(t);
    if (l._tk === key && l.canvas) return;
    l._tk = key;
    const font = PS.fontCss(t);
    const meas = PS.canvas(1, 1).getContext("2d");
    meas.font = font;
    const lines = String(t.str).split("\n");
    const lh = t.size * (t.leading || 1.2);
    const widths = lines.map((s) => meas.measureText(s || " ").width);
    const w = Math.max(1, ...widths), asc = t.size * 0.92, desc = t.size * 0.28;
    const h = lh * (lines.length - 1) + asc + desc;
    const left = t.align === "center" ? -w / 2 : t.align === "right" ? -w : 0; // box relative to the anchor
    const top = -asc;
    const pad = Math.ceil(t.size * 0.15) + 2;
    // 1. the words, straight; the anchor is at (ax, ay)
    let c = PS.canvas(w + pad * 2, h + pad * 2);
    let ax = pad - left, ay = pad - top;
    const ctx = c.getContext("2d");
    ctx.font = font;
    ctx.fillStyle = t.color;
    ctx.textBaseline = "alphabetic";
    lines.forEach((s, i) => {
      const lw = widths[i];
      ctx.fillText(s, ax + (t.align === "center" ? -lw / 2 : t.align === "right" ? -lw : 0), ay + i * lh);
    });
    // 2. Warp Text
    if (t.warp && t.warp.style && t.warp.style !== "none") ({ c, ax, ay } = PS.warp(c, ax, ay, { x: ax + left, y: ay + top, w, h }, t.warp));
    // 3. turned around the anchor
    const ang = ((t.angle || 0) * Math.PI) / 180;
    if (ang) {
      const W = c.width, H = c.height;
      const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [x - ax, y - ay])
        .map(([x, y]) => [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)]);
      const minX = Math.floor(Math.min(...corners.map((p) => p[0]))), maxX = Math.ceil(Math.max(...corners.map((p) => p[0])));
      const minY = Math.floor(Math.min(...corners.map((p) => p[1]))), maxY = Math.ceil(Math.max(...corners.map((p) => p[1])));
      const r = PS.canvas(maxX - minX, maxY - minY), rc = r.getContext("2d");
      rc.translate(-minX, -minY);
      rc.rotate(ang);
      rc.drawImage(c, -ax, -ay);
      c = r; ax = -minX; ay = -minY;
    }
    l.canvas = c;
    l.x = Math.round(t.x - ax);
    l.y = Math.round(t.y - ay);
    l._box = { left, top, w, h }; // where the words are, around the anchor (before warping and turning)
  };

  // Warp Text: each column of the words is moved and stretched up or down (then each row sideways, for
  // vertical distortion). Styles and numbers like Photoshop's: bend and distortions are -100..100.
  PS.WARPS = [["none", "None"], ["arc", "Arc"], ["arcLower", "Arc Lower"], ["arcUpper", "Arc Upper"], ["arch", "Arch"], ["bulge", "Bulge"],
    ["shellLower", "Shell Lower"], ["shellUpper", "Shell Upper"], ["flag", "Flag"], ["wave", "Wave"], ["fish", "Fish"], ["rise", "Rise"],
    ["fisheye", "Fisheye"], ["inflate", "Inflate"], ["squeeze", "Squeeze"], ["twist", "Twist"]];
  PS.warp = (src, ax, ay, box, wp) => {
    const k = (wp.bend || 0) / 100, hd = (wp.h || 0) / 100, vd = (wp.v || 0) / 100;
    const H = box.h, Wd = box.w;
    const curve = (u) => 1 - (2 * u - 1) ** 2; // 0 at the ends, 1 in the middle
    const S = Math.sin, P = Math.PI;
    const shapes = {
      arc: (u) => [-0.55 * curve(u), -0.55 * curve(u)],
      arcLower: (u) => [0, 0.55 * curve(u)],
      arcUpper: (u) => [-0.55 * curve(u), 0],
      arch: (u) => [-0.7 * Math.sqrt(curve(u)), -0.7 * Math.sqrt(curve(u)) * 0.6],
      bulge: (u) => [-0.4 * curve(u), 0.4 * curve(u)],
      shellLower: (u) => [0, 0.55 * (1 - curve(u))],
      shellUpper: (u) => [-0.55 * (1 - curve(u)), 0],
      flag: (u) => [-0.3 * S(2 * P * u), -0.3 * S(2 * P * u)],
      wave: (u) => [-0.3 * S(2 * P * u), -0.3 * S(2 * P * u + P / 2)],
      fish: (u) => [-0.4 * S(P * u) * (1 - u), 0.4 * S(P * u) * (1 - u)],
      rise: (u) => [-(u - 0.5), -(u - 0.5)],
      fisheye: (u) => [-0.45 * curve(u) ** 2, 0.45 * curve(u) ** 2],
      inflate: (u) => [-0.35 * Math.sqrt(curve(u)), 0.35 * Math.sqrt(curve(u))],
      squeeze: (u) => [0.3 * curve(u), -0.3 * curve(u)],
      twist: (u) => [-0.35 * (2 * u - 1), 0.35 * (2 * u - 1)],
    };
    const f = shapes[wp.style] || (() => [0, 0]);
    // the extra room the words can move into
    let up = 0, down = 0;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, [a, b] = f(u);
      const ta = k * a * H - hd * (u - 0.5) * H * 0.5, tb = k * b * H + hd * (u - 0.5) * H * 0.5;
      up = Math.max(up, -ta, -tb); down = Math.max(down, ta, tb);
    }
    const padY = Math.ceil(Math.max(up, down)) + 2, padX = Math.ceil(Math.abs(vd) * Wd * 0.5) + 2;
    const out = PS.canvas(src.width + padX * 2, src.height + padY * 2), o = out.getContext("2d");
    for (let x = 0; x < src.width; x++) {
      const u = PS.clamp((x - box.x) / Wd, 0, 1);
      const [a, b] = f(u);
      const top = k * a * H - hd * (u - 0.5) * H * 0.5, bot = k * b * H + hd * (u - 0.5) * H * 0.5;
      const scale = Math.max(0.05, (H + bot - top) / H);
      // the box's top goes to box.y + top, its bottom to box.y + H + bot
      o.drawImage(src, x, 0, 1, src.height, x + padX, padY + box.y + top - box.y * scale, 1, src.height * scale);
    }
    if (!vd) return { c: out, ax: ax + padX, ay: ay + padY };
    const out2 = PS.canvas(out.width, out.height), o2 = out2.getContext("2d");
    const cx = box.x + padX + Wd / 2, by = box.y + padY;
    for (let y = 0; y < out.height; y++) {
      const v = PS.clamp((y - by) / H, 0, 1), sc = Math.max(0.05, 1 + vd * (v - 0.5));
      o2.drawImage(out, 0, y, out.width, 1, cx - cx * sc, y, out.width * sc, 1);
    }
    return { c: out2, ax: ax + padX, ay: ay + padY };
  };
  PS.fontCss = (t) => `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.size}px "${t.font}", sans-serif`;

  PS.moveLayer = (l, dx, dy) => {
    if (PS.isText(l)) { l.text = { ...l.text, x: l.text.x + dx, y: l.text.y + dy }; PS.syncText(l); }
    else { l.x += dx; l.y += dy; }
  };

  // Painting on a layer: its canvas is copied first (so History keeps the old one), and grown to cover the picture.
  PS.editPixels = (l) => {
    const d = PS.doc;
    const x0 = Math.min(l.x, 0), y0 = Math.min(l.y, 0);
    const x1 = Math.max(l.x + l.canvas.width, d.w), y1 = Math.max(l.y + l.canvas.height, d.h);
    const c = PS.canvas(x1 - x0, y1 - y0);
    c.getContext("2d").drawImage(l.canvas, l.x - x0, l.y - y0);
    if (l.mask) {
      const m = PS.canvas(c.width, c.height), mc = m.getContext("2d");
      mc.fillStyle = "#fff";
      mc.fillRect(0, 0, m.width, m.height);
      mc.clearRect(l.x - x0, l.y - y0, l.canvas.width, l.canvas.height);
      mc.drawImage(l.mask, l.x - x0, l.y - y0);
      l.mask = m;
    }
    l.canvas = c;
    l.x = x0;
    l.y = y0;
    return c.getContext("2d");
  };
  PS.editMask = (l) => {
    if (!l.mask) return null;
    PS.editPixels(l); // lines the mask up with a fresh, picture-sized canvas
    return l.mask.getContext("2d");
  };
  PS.newMask = (l, fill) => {
    const m = PS.canvas(l.canvas.width, l.canvas.height), ctx = m.getContext("2d");
    if (fill) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, m.width, m.height); }
    return m;
  };

  // A layer's look with its mask, Fill and layer style (Stroke, Drop Shadow), kept until something changes.
  const EMPTY = { c: null, x: 0, y: 0 };
  PS.styled = (l) => {
    if (!PS.isPixels(l)) { if (!EMPTY.c) EMPTY.c = PS.canvas(1, 1); return EMPTY; }
    PS.syncText(l);
    const fx = l.fx || {};
    const stroke = fx.stroke && fx.stroke.on ? fx.stroke : null;
    const shadow = fx.shadow && fx.shadow.on ? fx.shadow : null;
    const useMask = l.mask && l.maskOn;
    if (!stroke && !shadow && l.fill >= 100 && !useMask) return { c: l.canvas, x: l.x, y: l.y };
    const key = JSON.stringify([stroke, shadow, l.fill, useMask]);
    const st = l._st;
    if (st && st.canvas === l.canvas && st.mask === l.mask && st.key === key) return st.out;

    let content = l.canvas;
    if (useMask) {
      content = PS.clone(l.canvas);
      const ctx = content.getContext("2d");
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(l.mask, 0, 0);
    }
    let pad = 0;
    if (stroke) pad = Math.max(pad, stroke.size + 2);
    if (shadow) pad = Math.max(pad, shadow.distance + shadow.size * 2 + (stroke ? stroke.size : 0) + 2);
    pad = Math.ceil(pad);
    const W = content.width + pad * 2, H = content.height + pad * 2;
    const out = PS.canvas(W, H), o = out.getContext("2d");

    let shape = null; // the outline (stroke), under the content
    if (stroke) {
      shape = PS.canvas(W, H);
      const sc = shape.getContext("2d");
      const sil = PS.canvas(content.width, content.height), sl = sil.getContext("2d");
      sl.drawImage(content, 0, 0);
      sl.globalCompositeOperation = "source-in";
      sl.fillStyle = stroke.color;
      sl.fillRect(0, 0, sil.width, sil.height);
      const r = stroke.size;
      const rings = r <= 3 ? [r] : [r, r * 0.66, r * 0.33];
      for (const rr of rings) {
        const n = Math.max(12, Math.ceil(rr * 2.4));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          sc.drawImage(sil, pad + Math.cos(a) * rr, pad + Math.sin(a) * rr);
        }
      }
      sc.drawImage(sil, pad, pad);
      if (stroke.opacity < 100) {
        const t = PS.canvas(W, H), tc = t.getContext("2d");
        tc.globalAlpha = stroke.opacity / 100;
        tc.drawImage(shape, 0, 0);
        shape = t;
      }
    }
    if (shadow) {
      const a = (shadow.angle * Math.PI) / 180;
      const dx = -Math.cos(a) * shadow.distance, dy = Math.sin(a) * shadow.distance;
      const c = PS.parseHex(shadow.color) || { r: 0, g: 0, b: 0 };
      o.save();
      o.shadowColor = `rgba(${c.r},${c.g},${c.b},${shadow.opacity / 100})`;
      o.shadowBlur = shadow.size;
      o.shadowOffsetX = dx + 20000;
      o.shadowOffsetY = dy;
      if (shape) o.drawImage(shape, -20000, 0);
      o.drawImage(content, pad - 20000, pad);
      o.restore();
    }
    if (shape) o.drawImage(shape, 0, 0);
    o.globalAlpha = l.fill / 100;
    o.drawImage(content, pad, pad);
    const res = { c: out, x: l.x - pad, y: l.y - pad };
    l._st = { canvas: l.canvas, mask: l.mask, key, out: res };
    return res;
  };

  // ---- documents
  PS.docs = [];
  PS.doc = null;

  PS.newDoc = (name, w, h, background) => {
    const d = {
      id: PS.id(), name, w: Math.round(w), h: Math.round(h), layers: [], active: null, sel: null, lastSel: null,
      hist: [], hi: -1, view: null, comp: null, compDirty: true, saved: true,
    };
    if (background !== "transparent") {
      const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
      ctx.fillStyle = background || "#ffffff";
      ctx.fillRect(0, 0, d.w, d.h);
      const l = PS.layer({ name: "Background", canvas: c, locked: true });
      d.layers.push(l);
      d.active = l.id;
    } else {
      const l = PS.layer({ name: "Layer 1", canvas: PS.canvas(d.w, d.h) });
      d.layers.push(l);
      d.active = l.id;
    }
    PS.docs.push(d);
    return d;
  };
  PS.openPicture = (name, img) => {
    const d = PS.newDoc(name, img.width, img.height, "transparent");
    const c = PS.canvas(img.width, img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    d.layers[0] = PS.layer({ name: "Background", canvas: c, locked: true });
    d.active = d.layers[0].id;
    return d;
  };

  PS.active = () => PS.doc && PS.doc.layers.find((l) => l.id === PS.doc.active);
  PS.layerIndex = (l) => PS.doc.layers.indexOf(l);
  PS.layerName = (base) => {
    const used = new Set(PS.doc.layers.map((l) => l.name));
    let n = 1;
    while (used.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };

  // ---- history (each step keeps the layers as they were; canvases are never changed after a step, only replaced)
  const copyLayer = (l) => ({ ...l, text: l.text && { ...l.text }, fx: l.fx && JSON.parse(JSON.stringify(l.fx)), adj: l.adj && JSON.parse(JSON.stringify(l.adj)) });
  PS.copyLayer = copyLayer;
  const snap = (d) => ({
    w: d.w, h: d.h, active: d.active, sel: d.sel,
    layers: d.layers.map(copyLayer),
  });
  PS.commit = (name) => {
    const d = PS.doc;
    if (!d) return;
    d.hist.splice(d.hi + 1);
    d.hist.push({ name, s: snap(d) });
    if (d.hist.length > 60) d.hist.splice(1, 1); // the first step (Open / New) stays
    d.hi = d.hist.length - 1;
    d.saved = false;
    PS.changed();
  };
  PS.goto = (i) => {
    const d = PS.doc;
    if (!d || i < 0 || i >= d.hist.length) return;
    PS.cancelLive && PS.cancelLive();
    const s = d.hist[i].s;
    d.hi = i;
    d.w = s.w;
    d.h = s.h;
    d.active = s.active;
    d.sel = s.sel;
    d.layers = s.layers.map(copyLayer);
    d.picked = (d.picked || []).filter((id) => d.layers.some((l) => l.id === id));
    if (d.w !== d.comp?.width || d.h !== d.comp?.height) d.comp = null;
    PS.changed();
  };
  PS.undo = () => PS.doc && PS.goto(PS.doc.hi - 1);
  PS.redo = () => PS.doc && PS.goto(PS.doc.hi + 1);

  // Something changed: draw again, and let the panels catch up.
  PS.changed = () => {
    if (PS.doc) PS.doc.compDirty = true;
    PS.draw();
    PS.onChange && PS.onChange();
  };

  // ---- groups: a group's layers sit right under it in d.layers (bottom to top), each with parent = the group's id
  PS.parentOf = (l) => (l && l.parent ? PS.doc.layers.find((g) => g.id === l.parent) || null : null);
  PS.kids = (d, pid) => d.layers.filter((l) => (l.parent || null) === (pid || null));
  PS.inside = (d, g) => { // everything in a group, at any depth
    const out = [];
    const walk = (id) => PS.kids(d, id).forEach((l) => { out.push(l); if (PS.isGroup(l)) walk(l.id); });
    walk(g.id);
    return out;
  };
  PS.depth = (l) => { let n = 0, p = PS.parentOf(l); while (p) { n++; p = PS.parentOf(p); } return n; };
  PS.shown = (l) => { for (let x = l; x; x = PS.parentOf(x)) if (!x.visible) return false; return true; };
  // Puts d.layers back in order after parents changed: each group right above its own layers.
  PS.normalize = (d = PS.doc) => {
    const ids = new Set(d.layers.map((l) => l.id));
    d.layers.forEach((l) => { if (l.parent && !ids.has(l.parent)) l.parent = null; });
    const out = [];
    const walk = (pid) => PS.kids(d, pid).forEach((l) => { if (PS.isGroup(l)) walk(l.id); out.push(l); });
    walk(null);
    d.layers = out;
  };

  // ---- the picture with all its layers (groups and adjustment layers included)
  const live = (l) => PS.live && (PS.live.layer === l || (PS.live.layers && PS.live.layers.has(l)));
  PS.renderItems = (ctx, d, items, opts = {}) => {
    for (const l of items) {
      if (!l.visible || (PS.hideLayer && PS.hideLayer === l && !opts.fresh)) continue;
      if (PS.isGroup(l)) {
        const kids = PS.kids(d, l.id);
        const plain = (l.blend === "pass" || l.blend === "normal") && l.opacity >= 100 && !(l.mask && l.maskOn);
        if (l.blend === "pass" && plain) { PS.renderItems(ctx, d, kids, opts); continue; }
        const t = PS.canvas(d.w, d.h), tc = t.getContext("2d");
        PS.renderItems(tc, d, kids, opts);
        if (l.mask && l.maskOn) { tc.globalCompositeOperation = "destination-in"; tc.drawImage(maskAt(l, d), 0, 0); }
        ctx.globalAlpha = l.opacity / 100;
        ctx.globalCompositeOperation = PS.gco(l.blend === "pass" ? "normal" : l.blend);
        ctx.drawImage(t, 0, 0);
      } else if (PS.isAdj(l)) {
        if (!PS.runAdj) continue;
        const below = ctx.canvas;
        const changed = PS.runAdj(l.adj, below);
        const cc = changed.getContext("2d");
        if (l.mask && l.maskOn) { cc.globalCompositeOperation = "destination-in"; cc.drawImage(l.mask, l.x, l.y); }
        ctx.globalAlpha = l.opacity / 100;
        ctx.globalCompositeOperation = l.blend === "normal" ? "source-atop" : PS.gco(l.blend);
        ctx.drawImage(changed, 0, 0);
      } else {
        ctx.globalAlpha = l.opacity / 100;
        ctx.globalCompositeOperation = PS.gco(l.blend);
        if (!opts.fresh && live(l)) PS.live.draw(ctx, l);
        else { const s = PS.styled(l); ctx.drawImage(s.c, s.x, s.y); }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  };
  // a group's (or adjustment layer's) mask as a picture-sized canvas; outside the mask's own area counts as shown
  const maskAt = (l, d) => {
    const m = PS.canvas(d.w, d.h), mc = m.getContext("2d");
    mc.fillStyle = "#fff"; mc.fillRect(0, 0, d.w, d.h);
    mc.clearRect(l.x, l.y, l.mask.width, l.mask.height);
    mc.drawImage(l.mask, l.x, l.y);
    return m;
  };
  PS.composite = (d = PS.doc, opts = {}) => {
    if (!d.comp || d.comp.width !== d.w || d.comp.height !== d.h) { d.comp = PS.canvas(d.w, d.h); d.compDirty = true; }
    if (!d.compDirty && !opts.fresh) return d.comp;
    const out = opts.fresh ? PS.canvas(d.w, d.h) : d.comp;
    const ctx = out.getContext("2d");
    ctx.clearRect(0, 0, d.w, d.h);
    PS.renderItems(ctx, d, PS.kids(d, null), opts);
    if (!opts.fresh) d.compDirty = false;
    return out;
  };
  // Some layers (with whatever is inside groups among them) drawn together, as one picture-sized canvas
  PS.renderSome = (d, layers) => {
    const c = PS.canvas(d.w, d.h);
    const set = new Set(layers);
    const pick = (pid) => PS.kids(d, pid).filter((l) => set.has(l) || (PS.isGroup(l) && PS.inside(d, l).some((x) => set.has(x))));
    const ctx = c.getContext("2d");
    const walk = (items) => {
      for (const l of items) {
        if (PS.isGroup(l) && !set.has(l)) { if (l.visible) walk(pick(l.id)); }
        else PS.renderItems(ctx, d, [l], { fresh: true });
      }
    };
    walk(pick(null));
    return c;
  };

  // ---- selections: a picture-sized canvas whose see-through-ness is the selection
  PS.makeSel = (canvas) => {
    if (!canvas) return null;
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const inside = new Uint8Array(w * h);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (data[i * 4 + 3] >= 128) {
        inside[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    // the "marching ants": the edges between selected and unselected pixels, joined into runs
    const path = new Path2D();
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? inside[y * w + x] : 0);
    for (let y = minY; y <= maxY + 1; y++) {
      let run = -1;
      for (let x = minX; x <= maxX + 1; x++) {
        const edge = at(x, y) !== at(x, y - 1);
        if (edge && run < 0) run = x;
        if (!edge && run >= 0) { path.moveTo(run, y); path.lineTo(x, y); run = -1; }
      }
    }
    for (let x = minX; x <= maxX + 1; x++) {
      let run = -1;
      for (let y = minY; y <= maxY + 1; y++) {
        const edge = at(x, y) !== at(x - 1, y);
        if (edge && run < 0) run = y;
        if (!edge && run >= 0) { path.moveTo(x, run); path.lineTo(x, y); run = -1; }
      }
    }
    return { c: canvas, path, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
  };

  // Combine a new selection shape with the one there is: new, add (Shift), subtract (Alt), intersect (both)
  PS.applySel = (shape, mode, name) => {
    const d = PS.doc;
    let c;
    if (mode === "new" || !d.sel) {
      if (mode === "subtract" || mode === "intersect") c = null;
      else c = shape;
    } else {
      c = PS.clone(d.sel.c);
      const ctx = c.getContext("2d");
      ctx.globalCompositeOperation = mode === "add" ? "source-over" : mode === "subtract" ? "destination-out" : "destination-in";
      ctx.drawImage(shape, 0, 0);
    }
    PS.setSel(c, name);
  };
  PS.setSel = (canvas, name) => {
    const d = PS.doc;
    if (d.sel) d.lastSel = d.sel;
    d.sel = PS.makeSel(canvas);
    if (name) PS.commit(name);
    else PS.changed();
  };
  PS.selShape = (draw, feather) => {
    const d = PS.doc;
    const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
    if (feather > 0) ctx.filter = `blur(${feather / 2}px)`;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    draw(ctx);
    ctx.fill();
    return c;
  };
  // A black and white picture (white = selected) at x, y in the document, as a selection shape.
  PS.selFromGray = (img, x, y, w, h) => {
    const d = PS.doc;
    const t = PS.canvas(w, h), tc = t.getContext("2d", { willReadFrequently: true });
    tc.drawImage(img, 0, 0, w, h);
    const id = tc.getImageData(0, 0, w, h), p = id.data;
    for (let i = 0; i < p.length; i += 4) { p[i + 3] = p[i]; p[i] = p[i + 1] = p[i + 2] = 0; }
    tc.putImageData(id, 0, 0);
    const c = PS.canvas(d.w, d.h);
    c.getContext("2d").drawImage(t, x, y);
    return c;
  };
  // A layer's see-through-ness as a selection shape (Ctrl+click on its thumbnail)
  PS.selFromLayer = (l) => {
    const d = PS.doc;
    const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
    const s = PS.styled({ ...l, fx: null, fill: 100 });
    ctx.drawImage(s.c, s.x, s.y);
    return c;
  };
  // Keep only the selected part of something drawn in layer coordinates
  PS.clipToSel = (canvas, ox, oy) => {
    const d = PS.doc;
    if (!d.sel) return canvas;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(d.sel.c, -ox, -oy);
    ctx.restore();
    return canvas;
  };
  // Put a changed version of a layer's pixels back, only where the selection is (everywhere when there's none)
  PS.putWithinSel = (l, changed) => {
    const d = PS.doc;
    if (!d.sel) { l.canvas = changed; return; }
    const out = PS.clone(l.canvas), o = out.getContext("2d");
    o.globalCompositeOperation = "destination-out";
    o.drawImage(d.sel.c, -l.x, -l.y);
    const part = PS.clipToSel(PS.clone(changed), l.x, l.y);
    o.globalCompositeOperation = "source-over";
    o.drawImage(part, 0, 0);
    l.canvas = out;
  };

  // ---- the view: where the document sits on screen
  PS.ZOOMS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 32];
  PS.toDoc = (sx, sy) => {
    const v = PS.doc.view;
    return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom };
  };
  PS.toScreen = (x, y) => {
    const v = PS.doc.view;
    return { x: x * v.zoom + v.x, y: y * v.zoom + v.y };
  };
  PS.fit = (fill) => {
    const d = PS.doc, el = PS.viewEl;
    if (!d || !el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const z = fill ? Math.max(W / d.w, H / d.h) : Math.min((W - 40) / d.w, (H - 40) / d.h);
    PS.setZoom(z, true);
  };
  PS.setZoom = (z, center, sx, sy) => {
    const d = PS.doc, el = PS.viewEl;
    if (!d || !el) return;
    z = PS.clamp(z, 0.01, 32);
    const v = d.view || (d.view = { zoom: 1, x: 0, y: 0 });
    if (center) {
      v.zoom = z;
      v.x = Math.round((el.clientWidth - d.w * z) / 2);
      v.y = Math.round((el.clientHeight - d.h * z) / 2);
    } else {
      if (sx === undefined) { sx = el.clientWidth / 2; sy = el.clientHeight / 2; }
      const p = PS.toDoc(sx, sy);
      v.zoom = z;
      v.x = sx - p.x * z;
      v.y = sy - p.y * z;
    }
    PS.draw();
    PS.onZoom && PS.onZoom();
  };
  PS.stepZoom = (dir, sx, sy) => {
    const z = PS.doc.view.zoom;
    const next = dir > 0 ? PS.ZOOMS.find((s) => s > z + 1e-6) : [...PS.ZOOMS].reverse().find((s) => s < z - 1e-6);
    if (next) PS.setZoom(next, false, sx, sy);
  };

  // ---- drawing the screen
  let pending = false;
  PS.draw = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; PS.drawNow(); });
  };
  let checker = null;
  PS.drawNow = () => {
    const cv = PS.viewCanvas, el = PS.viewEl;
    if (!cv || !el || !el.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = el.clientWidth, H = el.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, W, H);
    const d = PS.doc;
    if (!d) return;
    if (!d.view) PS.setZoom(Math.min(1, (W - 40) / d.w, (H - 40) / d.h), true);
    const v = d.view;
    const comp = PS.composite(d);
    const x = v.x, y = v.y, w = d.w * v.zoom, h = d.h * v.zoom;
    // the see-through checkerboard
    if (!checker) {
      const t = PS.canvas(16, 16), tc = t.getContext("2d");
      tc.fillStyle = "#fff"; tc.fillRect(0, 0, 16, 16);
      tc.fillStyle = "#cccccc"; tc.fillRect(0, 0, 8, 8); tc.fillRect(8, 8, 8, 8);
      checker = ctx.createPattern(t, "repeat");
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = checker;
    ctx.translate(x, y);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(comp, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
    // the tool's own drawing (transform box, crop, brush outline...), then the selection's edges
    ctx.save();
    PS.overlay && PS.overlay(ctx, v);
    ctx.restore();
    if (d.sel && !PS.hideEdges) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(v.zoom, v.zoom);
      ctx.lineWidth = 1 / v.zoom;
      ctx.strokeStyle = "#fff";
      ctx.stroke(d.sel.path);
      ctx.setLineDash([4 / v.zoom, 4 / v.zoom]);
      ctx.lineDashOffset = -(PS.ants || 0) / v.zoom;
      ctx.strokeStyle = "#000";
      ctx.stroke(d.sel.path);
      ctx.restore();
    }
    PS.drawRulers && PS.drawRulers();
  };
  // the marching ants march
  setInterval(() => {
    if (PS.doc && PS.doc.sel && PS.viewEl && PS.viewEl.offsetParent) { PS.ants = ((PS.ants || 0) + 1) % 8; PS.draw(); }
  }, 120);
})();
