// The Editor tab, part 4: dialogs, adjustments and filters, layer commands, AI, and opening/saving files.
(() => {
  const PS = window.PS, T = PS.tools;
  const root = PS.root;
  if (!root) return;
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const doc = () => PS.doc;
  const I = PS.icons;
  const post = async (path, body) => (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();

  // ---------------------------------------------------------------- dialogs
  PS.dialog = ({ title, body, ok = "OK", cancel = "Cancel", onOk, onCancel, left, wide }) => {
    const back = el(`<div class="ps-dlg-back"><div class="ps-dlg" style="${wide ? `width:${wide}px` : ""}"><div class="hd"><span>${esc(title)}</span><button class="x" data-x>${I.x}</button></div><div class="bd"></div><div class="ft"></div></div></div>`);
    const bd = back.querySelector(".bd"), ft = back.querySelector(".ft");
    if (typeof body === "string") bd.innerHTML = body; else bd.append(body);
    if (left) ft.append(left);
    let closed = false;
    const close = () => { if (!closed) { closed = true; back.remove(); } };
    if (cancel) {
      const c = el(`<button class="ps-btn" data-cancel>${esc(cancel)}</button>`);
      c.onclick = () => { close(); onCancel && onCancel(); };
      ft.append(c);
    }
    const o = el(`<button class="ps-btn blue" data-ok>${esc(ok)}</button>`);
    o.onclick = async () => { if (onOk && (await onOk()) === false) return; close(); };
    ft.append(o);
    back.querySelector("[data-x]").onclick = () => (cancel ? back.querySelector("[data-cancel]").click() : close());
    root.append(back);
    setTimeout(() => { const f = bd.querySelector("input:not([type=checkbox]):not([type=range]), select"); f && f.focus(); f && f.select && f.select(); }, 0);
    return { back, body: bd, close };
  };
  // a row: label, a number box, and (if given a range) a slider that follows it
  const field = (label, value, min, max, unit = "", step = 1, slider = true) => {
    const r = el(`<div class="fr"><span>${label}</span><span class="in">${slider ? `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}">` : ""}<input type="number" min="${min}" max="${max}" step="${step}" value="${value}"> ${unit}</span></div>`);
    const num = r.querySelector("input[type=number]"), rng = r.querySelector("input[type=range]");
    r.get = () => PS.clamp(+num.value || 0, min, max);
    r.on = (fn) => {
      num.addEventListener("input", () => { if (rng) rng.value = num.value; fn(); });
      rng && rng.addEventListener("input", () => { num.value = rng.value; fn(); });
    };
    return r;
  };
  const selectRow = (label, options, value) => {
    const r = el(`<div class="fr"><span>${label}</span><select>${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`);
    r.get = () => r.querySelector("select").value;
    r.on = (fn) => r.querySelector("select").addEventListener("change", fn);
    return r;
  };
  const checkRow = (label, on) => {
    const r = el(`<div class="fr"><span></span><label><input type="checkbox" ${on ? "checked" : ""}>${label}</label></div>`);
    r.get = () => r.querySelector("input").checked;
    r.on = (fn) => r.querySelector("input").addEventListener("change", fn);
    return r;
  };
  const needLayer = () => {
    const l = PS.active();
    if (!l) return null;
    if (!l.visible) { PS.toast("Could not complete your request because the target layer is hidden."); return null; }
    return l;
  };

  // ---------------------------------------------------------------- adjustments and filters (with a live preview)
  const fx = (src, filter) => { const c = PS.canvas(src.width, src.height), x = c.getContext("2d"); x.filter = filter; x.drawImage(src, 0, 0); return c; };
  const pixels = (src, fn) => {
    const c = PS.clone(src), x = c.getContext("2d", { willReadFrequently: true });
    const id = x.getImageData(0, 0, c.width, c.height);
    fn(id.data, c.width, c.height);
    x.putImageData(id, 0, 0);
    return c;
  };
  // blur without the edges fading: the picture is stretched past its edges first
  const blurred = (src, r) => {
    if (r <= 0) return PS.clone(src);
    const p = Math.ceil(r * 3), W = src.width, H = src.height;
    const big = PS.canvas(W + p * 2, H + p * 2), b = big.getContext("2d");
    b.drawImage(src, p, p);
    b.drawImage(src, 0, 0, 1, H, 0, p, p, H); b.drawImage(src, W - 1, 0, 1, H, p + W, p, p, H);
    b.drawImage(big, p, p, W, 1, p, 0, W, p); b.drawImage(big, p, p + H - 1, W, 1, p, p + H, W, p);
    b.drawImage(big, p, p, 1, 1, 0, 0, p, p); b.drawImage(big, p + W - 1, p, 1, 1, p + W, 0, p, p);
    b.drawImage(big, p, p + H - 1, 1, 1, 0, p + H, p, p); b.drawImage(big, p + W - 1, p + H - 1, 1, 1, p + W, p + H, p, p);
    const out = PS.canvas(W, H), o = out.getContext("2d");
    o.filter = `blur(${r}px)`;
    o.drawImage(big, -p, -p);
    // keep see-through parts see-through
    const keep = fx(src, `blur(${r}px)`);
    o.filter = "none";
    o.globalCompositeOperation = "destination-in";
    const alpha = PS.canvas(W, H), a = alpha.getContext("2d");
    a.fillStyle = "#000"; a.fillRect(0, 0, W, H);
    a.globalCompositeOperation = "destination-in";
    a.drawImage(isOpaque(src) ? src : keep, 0, 0);
    o.drawImage(alpha, 0, 0);
    return out;
  };
  const isOpaque = (c) => {
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 255) return false;
    return true;
  };
  const FILTERS = {
    bc: { name: "Brightness/Contrast", fields: [["Brightness:", 0, -150, 150], ["Contrast:", 0, -50, 100]],
      run: (s, [b, c]) => fx(s, `brightness(${1 + b / 150}) contrast(${1 + c / 100})`) },
    levels: { name: "Levels", fields: [["Input Black:", 0, 0, 253], ["Gamma:", 1, 0.1, 9.99, "", 0.01], ["Input White:", 255, 2, 255], ["Output Black:", 0, 0, 255], ["Output White:", 255, 0, 255]],
      run: (s, [ib, g, iw, ob, ow]) => {
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) { const v = PS.clamp((i - ib) / Math.max(1, iw - ib), 0, 1); lut[i] = ob + Math.pow(v, 1 / g) * (ow - ob); }
        return pixels(s, (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; } });
      } },
    hs: { name: "Hue/Saturation", fields: [["Hue:", 0, -180, 180], ["Saturation:", 0, -100, 100], ["Lightness:", 0, -100, 100]],
      run: (s, [h, sat, l]) => {
        const c = fx(s, `hue-rotate(${h}deg) saturate(${1 + sat / 100})`);
        if (l) { const x = c.getContext("2d"); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.abs(l) / 100; x.fillStyle = l > 0 ? "#fff" : "#000"; x.fillRect(0, 0, c.width, c.height); }
        return c;
      } },
    vib: { name: "Vibrance", fields: [["Vibrance:", 0, -100, 100], ["Saturation:", 0, -100, 100]],
      run: (s, [v, sat]) => pixels(s, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), avg = (r + g + b) / 3;
          const amt = ((v / 100) * (1 - (mx - Math.min(r, g, b)) / 255) + sat / 100);
          d[i] = r + (r - avg) * amt; d[i + 1] = g + (g - avg) * amt; d[i + 2] = b + (b - avg) * amt;
        }
      }) },
    bw: { name: "Black & White", fields: [["Reds:", 40, -200, 300, "%"], ["Greens:", 40, -200, 300, "%"], ["Blues:", 20, -200, 300, "%"]],
      run: (s, [r, g, b]) => pixels(s, (d) => {
        const t = (r + g + b) / 100 || 1;
        for (let i = 0; i < d.length; i += 4) { const v = (d[i] * r + d[i + 1] * g + d[i + 2] * b) / 100 / t; d[i] = d[i + 1] = d[i + 2] = v; }
      }) },
    blur: { name: "Gaussian Blur", fields: [["Radius:", 4, 0.1, 250, "Pixels", 0.1]], run: (s, [r]) => blurred(s, r) },
    motion: { name: "Motion Blur", fields: [["Angle:", 0, -90, 90, "°"], ["Distance:", 20, 1, 500, "Pixels"]],
      run: (s, [a, dist]) => {
        const c = PS.canvas(s.width, s.height), x = c.getContext("2d"), n = Math.min(60, Math.max(4, Math.round(dist / 2)));
        const dx = Math.cos((a * Math.PI) / 180) * dist, dy = -Math.sin((a * Math.PI) / 180) * dist;
        for (let i = 0; i < n; i++) { const t = i / (n - 1) - 0.5; x.globalAlpha = 1 / (i + 1); x.drawImage(s, dx * t, dy * t); }
        return c;
      } },
    noise: { name: "Add Noise", fields: [["Amount:", 12, 0.1, 400, "%", 0.1]], checks: [["Monochromatic", true]],
      run: (s, [amt], [mono]) => pixels(s, (d) => {
        const k = amt * 2.55;
        for (let i = 0; i < d.length; i += 4) {
          if (mono) { const n = (Math.random() - 0.5) * k; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
          else { d[i] += (Math.random() - 0.5) * k; d[i + 1] += (Math.random() - 0.5) * k; d[i + 2] += (Math.random() - 0.5) * k; }
        }
      }) },
    mosaic: { name: "Mosaic", fields: [["Cell Size:", 10, 2, 200, "square"]],
      run: (s, [n]) => {
        const sm = PS.canvas(Math.ceil(s.width / n), Math.ceil(s.height / n));
        sm.getContext("2d").drawImage(s, 0, 0, sm.width, sm.height);
        const c = PS.canvas(s.width, s.height), x = c.getContext("2d");
        x.imageSmoothingEnabled = false;
        x.drawImage(sm, 0, 0, sm.width * n, sm.height * n);
        return c;
      } },
    unsharp: { name: "Unsharp Mask", fields: [["Amount:", 80, 1, 500, "%"], ["Radius:", 1.5, 0.1, 100, "Pixels", 0.1], ["Threshold:", 0, 0, 255, "levels"]],
      run: (s, [amt, r, th]) => {
        const b = blurred(s, r).getContext("2d").getImageData(0, 0, s.width, s.height).data;
        return pixels(s, (d) => {
          for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) {
            const diff = d[i + k] - b[i + k];
            if (Math.abs(diff) >= th) d[i + k] = d[i + k] + (diff * amt) / 100;
          }
        });
      } },
  };
  PS.adjust = (id) => {
    const l = needLayer();
    const f = FILTERS[id];
    if (!l || !f) return;
    if (PS.isText(l)) PS.rasterize(l);
    const orig = l.canvas;
    const rows = f.fields.map(([label, v, min, max, unit, step]) => field(label, v, min, max, unit || "", step || 1));
    const checks = (f.checks || []).map(([label, on]) => checkRow(label, on));
    const preview = el('<label><input type="checkbox" checked>Preview</label>');
    const body = el('<div style="display:flex;flex-direction:column;gap:12px;min-width:380px"></div>');
    rows.forEach((r) => body.append(r));
    checks.forEach((r) => body.append(r));
    let timer = null;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        l.canvas = orig;
        if (preview.querySelector("input").checked) PS.putWithinSel(l, f.run(orig, rows.map((r) => r.get()), checks.map((c) => c.get())));
        PS.changed();
      }, 30);
    };
    rows.forEach((r) => r.on(update));
    checks.forEach((r) => r.on(update));
    preview.querySelector("input").addEventListener("change", update);
    update();
    PS.dialog({
      title: f.name, body, left: preview,
      onOk: () => {
        clearTimeout(timer);
        l.canvas = orig;
        PS.putWithinSel(l, f.run(orig, rows.map((r) => r.get()), checks.map((c) => c.get())));
        PS.commit(f.name);
      },
      onCancel: () => { clearTimeout(timer); PS.goto(doc().hi); }, // back to how it was (a type layer stays type)
    });
  };
  PS.quickFilter = (id) => {
    const l = needLayer();
    if (!l) return;
    if (PS.isText(l)) PS.rasterize(l);
    const s = l.canvas;
    const out = id === "invert" ? fx(s, "invert(1)") : id === "desat" ? fx(s, "grayscale(1)") : FILTERS.unsharp.run(s, [60, 1, 0]);
    PS.putWithinSel(l, out);
    PS.commit({ invert: "Invert", desat: "Desaturate", sharpen: "Sharpen" }[id]);
  };

  // ---------------------------------------------------------------- colors
  PS.colorPicker = (which) => {
    const l = PS.active();
    const start = which === "text" ? PS.parseHex(l && l.text ? l.text.color : PS.hex(PS.fg)) : which === "bg" ? PS.bg : PS.fg;
    let hsv = PS.rgbToHsv(start);
    const body = el(`<div class="ps-picker">
      <div class="sv"><canvas width="256" height="256"></canvas><i></i></div>
      <div class="hue"><canvas width="20" height="256"></canvas><i></i></div>
      <div><div style="display:flex;align-items:center;gap:10px"><div class="cmp"><span data-new></span><span data-old></span></div><span class="note">new<br><br>current</span></div>
        <div class="vals">
          <span>H:</span><span><input type="number" data-k="h" min="0" max="360"> °</span>
          <span>S:</span><span><input type="number" data-k="s" min="0" max="100"> %</span>
          <span>B:</span><span><input type="number" data-k="v" min="0" max="100"> %</span>
          <span>R:</span><input type="number" data-k="r" min="0" max="255">
          <span>G:</span><input type="number" data-k="g" min="0" max="255">
          <span>B:</span><input type="number" data-k="b" min="0" max="255">
          <span>#</span><input type="text" data-k="hex" style="width:70px">
        </div></div></div>`);
    const sv = body.querySelector(".sv canvas"), hue = body.querySelector(".hue canvas");
    body.querySelector("[data-old]").style.background = PS.hex(start);
    const paint = () => {
      const c = sv.getContext("2d");
      c.fillStyle = `hsl(${hsv.h},100%,50%)`; c.fillRect(0, 0, 256, 256);
      let g = c.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 256, 256);
      g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "#000"); c.fillStyle = g; c.fillRect(0, 0, 256, 256);
      const h = hue.getContext("2d"), hg = h.createLinearGradient(0, 0, 0, 256);
      for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${360 - i * 60},100%,50%)`);
      h.fillStyle = hg; h.fillRect(0, 0, 20, 256);
      body.querySelector(".sv i").style.left = hsv.s * 100 + "%";
      body.querySelector(".sv i").style.top = (1 - hsv.v) * 100 + "%";
      body.querySelector(".hue i").style.top = (1 - hsv.h / 360) * 100 + "%";
      const rgb = PS.hsvToRgb(hsv);
      body.querySelector("[data-new]").style.background = PS.hex(rgb);
      const set = (k, v) => { const i = body.querySelector(`[data-k="${k}"]`); if (document.activeElement !== i) i.value = v; };
      set("h", Math.round(hsv.h)); set("s", Math.round(hsv.s * 100)); set("v", Math.round(hsv.v * 100));
      set("r", rgb.r); set("g", rgb.g); set("b", rgb.b); set("hex", PS.hex(rgb).slice(1));
    };
    const drag = (t, fn) => t.addEventListener("pointerdown", (e) => {
      t.setPointerCapture(e.pointerId);
      const mv = (ev) => { const r = t.getBoundingClientRect(); fn(PS.clamp((ev.clientX - r.left) / r.width, 0, 1), PS.clamp((ev.clientY - r.top) / r.height, 0, 1)); paint(); };
      mv(e); t.onpointermove = mv; t.onpointerup = () => (t.onpointermove = null);
    });
    drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
    drag(hue, (x, y) => { hsv.h = (1 - y) * 360; });
    body.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => {
      const k = i.dataset.k, v = +i.value;
      if (k === "hex") { const c = PS.parseHex(i.value); if (c) hsv = PS.rgbToHsv(c); }
      else if ("hsv".includes(k) && k.length === 1 && ["h", "s", "v"].includes(k)) hsv = { ...hsv, [k]: k === "h" ? PS.clamp(v, 0, 360) : PS.clamp(v, 0, 100) / 100 };
      else { const rgb = { ...PS.hsvToRgb(hsv), [k]: PS.clamp(v, 0, 255) }; hsv = PS.rgbToHsv(rgb); }
      paint();
    }));
    paint();
    PS.dialog({
      title: which === "bg" ? "Color Picker (Background Color)" : which === "text" ? "Color Picker (Text Color)" : "Color Picker (Foreground Color)", body,
      onOk: () => {
        const rgb = PS.hsvToRgb(hsv);
        if (which === "text") {
          PS.fg = rgb;
          if (PS.isText(l)) { l.text = { ...l.text, color: PS.hex(rgb) }; if (PS.typing) PS.changed(); else PS.commit("Change Text Color"); }
          PS.drawOptions();
        } else if (which === "bg") PS.bg = rgb; else PS.fg = rgb;
        PS.onColors();
      },
    });
  };

  // ---------------------------------------------------------------- new document
  PS.newDialog = () => {
    let pick = PS.PRESETS[0];
    const body = el(`<div class="ps-newdoc"><div class="list"></div><div class="side">
      <div style="font-weight:600;color:#eee">Preset Details</div>
      <input type="text" data-name value="Untitled-${PS.docs.length + 1}">
      <div class="fr" style="grid-template-columns:60px 1fr"><span>Width</span><span class="in"><input type="number" data-w min="1" max="12000"> Pixels</span></div>
      <div class="fr" style="grid-template-columns:60px 1fr"><span>Height</span><span class="in"><input type="number" data-h min="1" max="12000"> Pixels</span></div>
      <div class="fr" style="grid-template-columns:60px 1fr"><span>Background</span><select data-bg><option value="#ffffff">White</option><option value="#000000">Black</option><option value="bg">Background Color</option><option value="transparent">Transparent</option></select></div>
    </div></div>`);
    const list = body.querySelector(".list"), w = body.querySelector("[data-w]"), h = body.querySelector("[data-h]");
    const choose = (p) => { pick = p; w.value = p[1]; h.value = p[2]; list.querySelectorAll(".ps-preset").forEach((b) => b.classList.toggle("on", b.dataset.n === p[0])); };
    for (const p of PS.PRESETS) {
      const b = el(`<button class="ps-preset" data-n="${esc(p[0])}"><span class="shape">${PS.presetShape(p[1], p[2])}</span><b>${esc(p[0])}</b><span>${p[1]} × ${p[2]} px</span></button>`);
      b.onclick = () => choose(p);
      list.append(b);
    }
    choose(pick);
    const dl = PS.dialog({
      title: "New Document", body, ok: "Create", wide: 760,
      onOk: () => {
        const bg = body.querySelector("[data-bg]").value;
        PS.createDoc(body.querySelector("[data-name]").value.trim() || "Untitled", PS.clamp(+w.value || 1, 1, 12000), PS.clamp(+h.value || 1, 1, 12000), bg === "bg" ? PS.hex(PS.bg) : bg);
      },
    });
    dl.body.style.padding = "0";
  };

  // ---------------------------------------------------------------- layers
  PS.newLayer = (quick) => {
    const d = doc();
    if (!d) return;
    const make = (name, blend = "normal", opacity = 100) => PS.addLayer(PS.layer({ name, canvas: PS.canvas(d.w, d.h), blend, opacity }), "New Layer");
    if (quick) return make(PS.layerName("Layer"));
    const name = el(`<div class="fr"><span>Name:</span><input type="text" value="${PS.layerName("Layer")}" style="width:240px"></div>`);
    const mode = selectRow("Mode:", PS.BLENDS.filter((b) => b[0] !== "-"), "normal");
    const op = field("Opacity:", 100, 0, 100, "%", 1, false);
    const body = el("<div style='display:flex;flex-direction:column;gap:10px'></div>");
    body.append(name, mode, op);
    PS.dialog({ title: "New Layer", body, onOk: () => { make(name.querySelector("input").value.trim() || PS.layerName("Layer"), mode.get(), op.get()); } });
  };
  PS.layerVia = (cut) => {
    const d = doc(), l = PS.active();
    if (!l) return;
    if (!d.sel) { if (!cut) PS.duplicate(l); return; }
    if (PS.isText(l)) PS.rasterize(l);
    const s = PS.styled({ ...l, fx: null, fill: 100, _st: null });
    const piece = PS.clipToSel(PS.clone(s.c), s.x, s.y);
    if (cut) {
      PS.editPixels(l);
      const ctx = l.canvas.getContext("2d");
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(d.sel.c, -l.x, -l.y);
    }
    const nl = PS.layer({ name: PS.layerName("Layer"), canvas: piece, x: s.x, y: s.y });
    d.layers.splice(PS.layerIndex(l) + 1, 0, nl);
    d.active = nl.id;
    d.sel = null;
    PS.commit(cut ? "Layer Via Cut" : "Layer Via Copy");
  };
  PS.deleteLayer = () => {
    const d = doc(), l = PS.active();
    if (!l) return;
    if (d.layers.length === 1) return PS.toast("A document needs at least one layer.");
    const i = PS.layerIndex(l);
    d.layers.splice(i, 1);
    d.active = (d.layers[Math.max(0, i - 1)] || d.layers[0]).id;
    d.maskEdit = false;
    PS.commit("Delete Layer");
  };
  PS.arrange = (how) => {
    const d = doc(), l = PS.active();
    if (!l || (l.locked && l.name === "Background")) return;
    const i = PS.layerIndex(l), floor = d.layers[0].locked && d.layers[0].name === "Background" ? 1 : 0;
    const j = how === "front" ? d.layers.length - 1 : how === "back" ? floor : how === "up" ? Math.min(d.layers.length - 1, i + 1) : Math.max(floor, i - 1);
    if (i === j) return;
    d.layers.splice(i, 1);
    d.layers.splice(j, 0, l);
    PS.commit({ front: "Bring to Front", back: "Send to Back", up: "Bring Forward", down: "Send Backward" }[how]);
  };
  const contentBox = (l) => {
    const s = PS.styled({ ...l, fx: null, _st: null });
    const c = s.c, w = c.width, h = c.height, data = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: s.x + x0, y: s.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  PS.align = (edge) => {
    const d = doc(), l = PS.active();
    if (!l) return;
    if (l.locked) return PS.toast("Could not align because the layer is locked.");
    const b = contentBox(l);
    if (!b) return;
    const t = d.sel ? d.sel.box : { x: 0, y: 0, w: d.w, h: d.h };
    const dx = edge === "l" ? t.x - b.x : edge === "r" ? t.x + t.w - (b.x + b.w) : edge === "c" ? Math.round(t.x + t.w / 2 - (b.x + b.w / 2)) : 0;
    const dy = edge === "t" ? t.y - b.y : edge === "b" ? t.y + t.h - (b.y + b.h) : edge === "m" ? Math.round(t.y + t.h / 2 - (b.y + b.h / 2)) : 0;
    if (!dx && !dy) return;
    PS.moveLayer(l, dx, dy);
    PS.commit("Align");
  };
  const flat = (layers, w, h) => {
    const c = PS.canvas(w, h), ctx = c.getContext("2d");
    for (const l of layers) {
      if (!l.visible) continue;
      const s = PS.styled(l);
      ctx.globalAlpha = l.opacity / 100;
      ctx.globalCompositeOperation = PS.gco(l.blend);
      ctx.drawImage(s.c, s.x, s.y);
    }
    return c;
  };
  PS.mergeDown = () => {
    const d = doc(), l = PS.active(), i = PS.layerIndex(l);
    if (!l || i < 1) return;
    const below = d.layers[i - 1];
    const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
    const sb = PS.styled(below);
    if (below.visible) ctx.drawImage(sb.c, sb.x, sb.y);
    if (l.visible) { const s = PS.styled(l); ctx.globalAlpha = l.opacity / 100; ctx.globalCompositeOperation = PS.gco(l.blend); ctx.drawImage(s.c, s.x, s.y); }
    const merged = { ...below, kind: "pixel", text: null, _tk: null, canvas: c, x: 0, y: 0, mask: null, fx: null, fill: 100, _st: null };
    d.layers.splice(i - 1, 2, merged);
    d.active = merged.id;
    d.maskEdit = false;
    PS.commit("Merge Down");
  };
  PS.mergeVisible = () => {
    const d = doc(), vis = d.layers.filter((l) => l.visible);
    if (vis.length < 2) return;
    const c = flat(d.layers, d.w, d.h);
    const first = vis[0];
    const merged = { ...first, kind: "pixel", text: null, _tk: null, canvas: c, x: 0, y: 0, mask: null, fx: null, fill: 100, opacity: 100, blend: "normal", _st: null };
    d.layers = d.layers.filter((l) => !l.visible || l === first).map((l) => (l === first ? merged : l));
    d.active = merged.id;
    PS.commit("Merge Visible");
  };
  PS.stampVisible = () => {
    const d = doc();
    PS.addLayer(PS.layer({ name: PS.layerName("Layer") + " (merged)", canvas: flat(d.layers, d.w, d.h) }), "Stamp Visible");
  };
  PS.flatten = () => {
    const d = doc();
    const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, d.w, d.h);
    ctx.drawImage(flat(d.layers, d.w, d.h), 0, 0);
    const l = PS.layer({ name: "Background", canvas: c, locked: true });
    d.layers = [l];
    d.active = l.id;
    d.maskEdit = false;
    PS.commit("Flatten Image");
  };

  // ---------------------------------------------------------------- layer styles
  const defaultFx = () => ({
    stroke: { on: false, size: 6, color: "#000000", opacity: 100 },
    shadow: { on: false, color: "#000000", opacity: 60, angle: 120, distance: 10, size: 12 },
  });
  PS.styleDialog = (tab) => {
    const l = needLayer();
    if (!l) return;
    const before = l.fx;
    const f = JSON.parse(JSON.stringify(l.fx || defaultFx()));
    f.stroke = f.stroke || defaultFx().stroke;
    f.shadow = f.shadow || defaultFx().shadow;
    if (tab && !l.fx) f[tab].on = true;
    const body = el('<div class="ps-style"><div class="nav"></div><div class="pg"></div></div>');
    const nav = body.querySelector(".nav"), pg = body.querySelector(".pg");
    const apply = () => { l.fx = JSON.parse(JSON.stringify(f)); PS.changed(); };
    const colorBtn = (o) => {
      const b = el(`<button class="ps-swatch-btn" style="background:${o.color}"></button>`);
      const inp = el(`<input type="color" value="${o.color}" style="position:absolute;opacity:0;width:0;height:0">`);
      b.onclick = () => inp.click();
      inp.oninput = () => { o.color = inp.value; b.style.background = inp.value; apply(); };
      const w = el('<span style="position:relative;display:inline-flex"></span>');
      w.append(b, inp);
      return w;
    };
    const show = (which) => {
      tab = which;
      nav.innerHTML = "";
      for (const [k, name] of [["stroke", "Stroke"], ["shadow", "Drop Shadow"]]) {
        const it = el(`<div class="it ${k === which ? "on" : ""}"><input type="checkbox" ${f[k].on ? "checked" : ""}><span>${name}</span></div>`);
        it.querySelector("input").addEventListener("change", (e) => { f[k].on = e.target.checked; apply(); });
        it.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") show(k); });
        nav.append(it);
      }
      pg.innerHTML = "";
      const o = f[which];
      const rows = which === "stroke"
        ? [["size", field("Size:", o.size, 1, 250, "px")], ["opacity", field("Opacity:", o.opacity, 0, 100, "%")]]
        : [["opacity", field("Opacity:", o.opacity, 0, 100, "%")], ["angle", field("Angle:", o.angle, -180, 180, "°")], ["distance", field("Distance:", o.distance, 0, 300, "px")], ["size", field("Size:", o.size, 0, 250, "px")]];
      pg.append(el(`<h5>${which === "stroke" ? "Stroke · Structure" : "Drop Shadow · Structure"}</h5>`));
      const cr = el('<div class="fr"><span>Color:</span><span class="in"></span></div>');
      cr.querySelector(".in").append(colorBtn(o));
      pg.append(cr);
      for (const [k, r] of rows) { r.on(() => { o[k] = r.get(); o.on = true; nav.querySelectorAll("input")[which === "stroke" ? 0 : 1].checked = true; apply(); }); pg.append(r); }
      if (which === "stroke") pg.append(el('<div class="note">Position: Outside</div>'));
    };
    show(tab || "stroke");
    apply();
    PS.dialog({ title: "Layer Style", body, wide: 560, onOk: () => { apply(); PS.commit("Layer Style"); }, onCancel: () => { l.fx = before; PS.changed(); } });
  };
  PS.clearStyle = () => { const l = PS.active(); if (l && l.fx) { l.fx = null; PS.commit("Clear Layer Style"); } };

  // ---------------------------------------------------------------- masks
  PS.addMask = (kind) => {
    const d = doc(), l = PS.active();
    if (!l || l.mask) return;
    if (PS.isText(l)) return PS.toast("Rasterize the type layer first to give it a mask (Layer > Rasterize > Type).");
    if (l.locked && l.name === "Background") { l.locked = false; l.name = "Layer 0"; }
    PS.editPixels(l);
    const m = PS.newMask(l, kind === "all" || kind === "hidesel");
    const ctx = m.getContext("2d");
    if (kind === "sel" && d.sel) ctx.drawImage(d.sel.c, -l.x, -l.y);
    if (kind === "hidesel" && d.sel) { ctx.globalCompositeOperation = "destination-out"; ctx.drawImage(d.sel.c, -l.x, -l.y); }
    l.mask = m;
    l.maskOn = true;
    d.maskEdit = true;
    if (kind === "sel" || kind === "hidesel") d.sel = null;
    PS.commit("Add Layer Mask");
  };
  PS.maskAction = (what) => {
    const d = doc(), l = PS.active();
    if (!l || !l.mask) return;
    if (what === "toggle") { l.maskOn = !l.maskOn; return PS.commit(l.maskOn ? "Enable Layer Mask" : "Disable Layer Mask"); }
    if (what === "delete") { l.mask = null; d.maskEdit = false; return PS.commit("Delete Layer Mask"); }
    if (what === "invert") {
      const m = PS.canvas(l.mask.width, l.mask.height), ctx = m.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, m.width, m.height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(l.mask, 0, 0);
      l.mask = m;
      return PS.commit("Invert");
    }
    if (what === "apply") {
      const c = PS.clone(l.canvas), ctx = c.getContext("2d");
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(l.mask, 0, 0);
      l.canvas = c; l.mask = null; d.maskEdit = false;
      PS.commit("Apply Layer Mask");
    }
  };

  // ---------------------------------------------------------------- selections
  PS.selectAll = () => {
    const d = doc();
    PS.setSel(PS.selShape((ctx) => ctx.rect(0, 0, d.w, d.h), 0), "Select Canvas");
  };
  PS.reselect = () => { const d = doc(); if (d.lastSel) { d.sel = d.lastSel; PS.commit("Reselect"); } };
  PS.inverse = () => {
    const d = doc();
    const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, d.w, d.h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(d.sel.c, 0, 0);
    PS.setSel(c, "Select Inverse");
  };
  PS.modifySel = (kind) => {
    const d = doc();
    const names = { expand: ["Expand Selection", "Expand By:", 4], contract: ["Contract Selection", "Contract By:", 4], feather: ["Feather Selection", "Feather Radius:", 5], smooth: ["Smooth Selection", "Sample Radius:", 4] };
    const [title, label, def] = names[kind];
    const r = field(label, def, 1, 500, "pixels", 1, false);
    PS.dialog({
      title, body: r,
      onOk: () => {
        const n = r.get();
        const c = PS.canvas(d.w, d.h), ctx = c.getContext("2d");
        ctx.filter = `blur(${kind === "feather" ? n / 2 : n / 2}px)`;
        ctx.drawImage(d.sel.c, 0, 0);
        if (kind !== "feather") {
          const id = ctx.getImageData(0, 0, d.w, d.h), p = id.data, cut = kind === "expand" ? 6 : kind === "contract" ? 249 : 128;
          for (let i = 3; i < p.length; i += 4) p[i] = p[i] > cut ? 255 : 0;
          ctx.putImageData(id, 0, 0);
        }
        PS.setSel(c, title.replace(" Selection", ""));
      },
    });
  };
  PS.clearSel = () => {
    const d = doc(), l = PS.active();
    if (!l) return;
    if (!d.sel) return PS.deleteLayer();
    if (PS.isText(l)) PS.rasterize(l);
    if (l.locked) return PS.fillWith(PS.bg, "Clear");
    const ctx = PS.editPixels(l);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(d.sel.c, -l.x, -l.y);
    PS.commit("Clear");
  };
  PS.fillWith = (color, name, opacity = 100, keepAlpha = false) => {
    const d = doc(), l = PS.active();
    if (!l) return;
    if (PS.isText(l)) PS.rasterize(l);
    const ctx = PS.editPixels(l);
    const f = PS.canvas(d.w, d.h), fc = f.getContext("2d");
    fc.fillStyle = typeof color === "string" ? color : PS.hex(color);
    fc.fillRect(0, 0, d.w, d.h);
    PS.clipToSel(f, 0, 0);
    ctx.globalAlpha = opacity / 100;
    ctx.globalCompositeOperation = keepAlpha ? "source-atop" : "source-over";
    ctx.drawImage(f, -l.x, -l.y);
    PS.commit(name);
  };
  PS.fillDialog = () => {
    const what = selectRow("Contents:", [["fg", "Foreground Color"], ["bg", "Background Color"], ["#000000", "Black"], ["#808080", "50% Gray"], ["#ffffff", "White"]], "fg");
    const op = field("Opacity:", 100, 0, 100, "%", 1, false);
    const keep = checkRow("Preserve Transparency", false);
    const body = el("<div style='display:flex;flex-direction:column;gap:10px;min-width:340px'></div>");
    body.append(what, op, keep);
    PS.dialog({ title: "Fill", body, onOk: () => { const v = what.get(); PS.fillWith(v === "fg" ? PS.fg : v === "bg" ? PS.bg : v, "Fill", op.get(), keep.get()); } });
  };

  // ---------------------------------------------------------------- image size, canvas size, rotation, crop, trim
  const scaleDoc = (nw, nh) => {
    const d = doc(), sx = nw / d.w, sy = nh / d.h;
    for (const l of d.layers) {
      if (PS.isText(l)) {
        l.text = { ...l.text, x: l.text.x * sx, y: l.text.y * sy, size: Math.max(1, Math.round(l.text.size * Math.sqrt(sx * sy) * 10) / 10) };
        PS.syncText(l);
      } else {
        const w = Math.max(1, Math.round(l.canvas.width * sx)), h = Math.max(1, Math.round(l.canvas.height * sy));
        const c = PS.canvas(w, h), ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(l.canvas, 0, 0, w, h);
        if (l.mask) { const m = PS.canvas(w, h); m.getContext("2d").drawImage(l.mask, 0, 0, w, h); l.mask = m; }
        l.canvas = c; l.x = Math.round(l.x * sx); l.y = Math.round(l.y * sy);
      }
      if (l.fx) { const s = Math.sqrt(sx * sy); if (l.fx.stroke) l.fx.stroke.size = Math.max(1, Math.round(l.fx.stroke.size * s)); if (l.fx.shadow) { l.fx.shadow.size = Math.round(l.fx.shadow.size * s); l.fx.shadow.distance = Math.round(l.fx.shadow.distance * s); } }
    }
    d.w = nw; d.h = nh; d.sel = null; d.comp = null;
  };
  PS.imageSizeDialog = () => {
    const d = doc();
    const w = field("Width:", d.w, 1, 12000, "Pixels", 1, false), h = field("Height:", d.h, 1, 12000, "Pixels", 1, false);
    const link = checkRow("Constrain Proportions", true);
    const wi = w.querySelector("input"), hi = h.querySelector("input");
    wi.addEventListener("input", () => { if (link.get()) hi.value = Math.max(1, Math.round((+wi.value * d.h) / d.w)); });
    hi.addEventListener("input", () => { if (link.get()) wi.value = Math.max(1, Math.round((+hi.value * d.w) / d.h)); });
    const body = el(`<div style="display:flex;flex-direction:column;gap:10px;min-width:360px"><div class="note">Image size: ${d.w} × ${d.h} px</div></div>`);
    body.append(w, h, link, el('<div class="fr"><span>Resample:</span><select disabled><option>Automatic</option></select></div>'));
    PS.dialog({ title: "Image Size", body, onOk: () => { if (w.get() !== d.w || h.get() !== d.h) { scaleDoc(w.get(), h.get()); PS.commit("Image Size"); PS.fit(); } } });
  };
  PS.canvasSizeDialog = () => {
    const d = doc();
    const w = field("Width:", d.w, 1, 12000, "Pixels", 1, false), h = field("Height:", d.h, 1, 12000, "Pixels", 1, false);
    let anchor = [1, 1];
    const grid = el('<div class="fr"><span>Anchor:</span><span style="display:grid;grid-template-columns:repeat(3,22px);gap:2px"></span></div>');
    const drawGrid = () => {
      const g = grid.querySelector("span:last-child");
      g.innerHTML = "";
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const b = el(`<button style="width:22px;height:22px;border:1px solid #555;background:${x === anchor[0] && y === anchor[1] ? "#888" : "#2a2a2a"}"></button>`);
        b.onclick = () => { anchor = [x, y]; drawGrid(); };
        g.append(b);
      }
    };
    drawGrid();
    const body = el(`<div style="display:flex;flex-direction:column;gap:10px;min-width:360px"><div class="note">Current size: ${d.w} × ${d.h} px</div></div>`);
    body.append(w, h, grid);
    PS.dialog({
      title: "Canvas Size", body,
      onOk: () => {
        const nw = w.get(), nh = h.get();
        if (nw === d.w && nh === d.h) return;
        const dx = Math.round(((nw - d.w) * anchor[0]) / 2), dy = Math.round(((nh - d.h) * anchor[1]) / 2);
        for (const l of d.layers) {
          if (l.locked && l.name === "Background") { // the Background grows with the background color
            const c = PS.canvas(nw, nh), ctx = c.getContext("2d");
            ctx.fillStyle = PS.hex(PS.bg); ctx.fillRect(0, 0, nw, nh);
            ctx.drawImage(l.canvas, l.x + dx, l.y + dy);
            l.canvas = c; l.x = 0; l.y = 0;
          } else PS.moveLayer(l, dx, dy);
        }
        d.w = nw; d.h = nh; d.sel = null; d.comp = null;
        PS.commit("Canvas Size");
        PS.fit();
      },
    });
  };
  PS.rotateCanvas = (how) => {
    const d = doc(), W = d.w, H = d.h;
    for (const l of d.layers) {
      if (PS.isText(l) && (how === "h" || how === "v")) PS.rasterize(l, true);
      if (PS.isText(l)) {
        const t = l.text;
        const p = how === "cw" ? [H - t.y, t.x] : how === "ccw" ? [t.y, W - t.x] : [W - t.x, H - t.y];
        l.text = { ...t, x: p[0], y: p[1], angle: ((t.angle || 0) + (how === "cw" ? 90 : how === "ccw" ? -90 : 180)) % 360 };
        PS.syncText(l);
        continue;
      }
      const src = l.canvas, cw = src.width, ch = src.height, turn = how === "cw" || how === "ccw";
      const make = (s) => {
        const c = turn ? PS.canvas(ch, cw) : PS.canvas(cw, ch), ctx = c.getContext("2d");
        ctx.translate(c.width / 2, c.height / 2);
        if (how === "h") ctx.scale(-1, 1); if (how === "v") ctx.scale(1, -1);
        if (how === "cw") ctx.rotate(Math.PI / 2); if (how === "ccw") ctx.rotate(-Math.PI / 2); if (how === "180") ctx.rotate(Math.PI);
        ctx.drawImage(s, -cw / 2, -ch / 2);
        return c;
      };
      const pos = how === "cw" ? [H - (l.y + ch), l.x] : how === "ccw" ? [l.y, W - (l.x + cw)] : how === "180" ? [W - (l.x + cw), H - (l.y + ch)] : how === "h" ? [W - (l.x + cw), l.y] : [l.x, H - (l.y + ch)];
      l.canvas = make(src);
      if (l.mask) l.mask = make(l.mask);
      [l.x, l.y] = pos;
    }
    if (how === "cw" || how === "ccw") { d.w = H; d.h = W; d.comp = null; }
    d.sel = null;
    PS.commit(how === "h" ? "Flip Canvas Horizontal" : how === "v" ? "Flip Canvas Vertical" : "Rotate Canvas");
    PS.fit();
  };
  const cropTo = (b, name) => {
    const d = doc();
    for (const l of d.layers) PS.moveLayer(l, -b.x, -b.y);
    d.w = b.w; d.h = b.h; d.sel = null; d.comp = null;
    PS.commit(name);
    PS.fit();
    if (PS.tool === "crop") T.crop.activate();
  };
  PS.cropToSel = () => { const d = doc(); if (d.sel) cropTo(d.sel.box, "Crop"); };
  PS.trim = () => {
    const d = doc(), c = PS.composite(d, { fresh: true });
    const data = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, d.w, d.h).data;
    const corner = [data[0], data[1], data[2], data[3]];
    const transparent = corner[3] === 0;
    const same = (i) => (transparent ? data[i + 3] === 0 : data[i] === corner[0] && data[i + 1] === corner[1] && data[i + 2] === corner[2] && data[i + 3] === corner[3]);
    let x0 = d.w, y0 = d.h, x1 = -1, y1 = -1;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (!same((y * d.w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === d.w - 1 && y1 === d.h - 1)) return PS.toast("Nothing to trim.");
    cropTo({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, "Trim");
  };

  // ---------------------------------------------------------------- AI: Select Subject, Object Selection, Remove Background
  const aiState = document.getElementById("psAiState");
  const showAiState = (s) => {
    aiState.classList.toggle("on", !!s.ready);
    aiState.querySelector("span").textContent = s.ready ? "AI ready" : s.downloading ? `AI downloading ${Math.round(s.progress * 100)}%` : "AI";
  };
  const aiStatus = async () => { try { const s = await post("/api/editor-ai"); showAiState(s); return s; } catch (e) { return { ready: false, error: "The app isn't answering." }; } };
  aiState.addEventListener("click", async () => { const s = await aiStatus(); if (s.ready) PS.toast("The AI tools are ready. They run on this PC; pictures never leave it."); else aiReady(); });
  // Makes sure the model is here; the first time, it offers to download it (170 MB).
  const aiReady = async () => {
    let s = await aiStatus();
    if (s.ready) return true;
    return new Promise((resolve) => {
      const body = el(`<div style="max-width:420px;display:flex;flex-direction:column;gap:12px">
        <div>Remove Background, Select Subject and the Object Selection tool use an AI model that runs on this PC, so your pictures never leave it.</div>
        <div class="note">It's a one-time download of about ${s.megabytes || 170} MB.</div>
        <div class="bar"><i></i></div><div class="note" data-msg></div></div>`);
      let timer = null, done = false;
      const bar = body.querySelector(".bar i"), msg = body.querySelector("[data-msg]");
      const poll = async () => {
        s = await aiStatus();
        bar.style.width = (s.ready ? 100 : Math.round(s.progress * 100)) + "%";
        msg.textContent = s.error || (s.downloading ? `Downloading... ${Math.round(s.progress * s.megabytes)} of ${s.megabytes} MB` : "");
        if (s.ready) { clearInterval(timer); done = true; dl.close(); resolve(true); }
        else if (!s.downloading && s.error) { clearInterval(timer); dl.back.querySelector("[data-ok]").disabled = false; }
      };
      const dl = PS.dialog({
        title: "Download the AI model", body, ok: "Download",
        onOk: async () => {
          dl.back.querySelector("[data-ok]").disabled = true;
          await post("/api/editor-ai-get");
          clearInterval(timer);
          timer = setInterval(poll, 500);
          poll();
          return false;
        },
        onCancel: () => { clearInterval(timer); if (!done) resolve(false); },
      });
      if (s.downloading) dl.back.querySelector("[data-ok]").click();
    });
  };
  // Asks the model for the subject of a picture; returns a black and white mask the same size (or null)
  const askModel = async (canvas) => {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const res = await fetch("/api/editor-mask", { method: "POST", body: blob });
    if ((res.headers.get("Content-Type") || "").startsWith("image/")) return createImageBitmap(await res.blob());
    const j = await res.json().catch(() => ({}));
    PS.toast(j.error || "The AI couldn't do that. Try again.");
    return null;
  };
  let aiBusy = false;
  const withAi = async (label, fn) => {
    if (aiBusy || !doc()) return;
    if (!(await aiReady())) return;
    aiBusy = true;
    PS.busy(label);
    try { await fn(); } catch (e) { PS.toast("The AI couldn't do that. Try again."); } finally { aiBusy = false; PS.busy(null); }
  };
  PS.selectSubject = (mode = "new") => withAi("Selecting the subject...", async () => {
    const d = doc(), c = PS.composite(d, { fresh: true });
    const m = await askModel(c);
    if (m) PS.applySel(PS.selFromGray(m, 0, 0, d.w, d.h), mode, "Select Subject");
  });
  PS.selectObject = (r, mode = "new") => withAi("Finding the object...", async () => {
    const d = doc(), c = PS.composite(d, { fresh: true });
    const crop = PS.canvas(r.w, r.h);
    crop.getContext("2d").drawImage(c, -r.x, -r.y);
    const m = await askModel(crop);
    if (m) PS.applySel(PS.selFromGray(m, r.x, r.y, r.w, r.h), mode, "Object Selection");
  });
  PS.removeBackground = () => {
    const l = PS.active();
    if (!l) return;
    if (PS.isText(l)) return PS.toast("Remove Background works on pictures, not type layers.");
    withAi("Removing the background...", async () => {
      const d = doc();
      const m = await askModel(l.canvas);
      if (!m) return;
      if (l.locked && l.name === "Background") { l.locked = false; l.name = "Layer 0"; }
      const w = l.canvas.width, h = l.canvas.height;
      const sel = PS.selFromGray(m, 0, 0, w, h); // a document-sized canvas; only the top-left w x h matters
      const mask = PS.canvas(w, h), mc = mask.getContext("2d");
      mc.drawImage(sel, 0, 0);
      if (l.mask) { mc.globalCompositeOperation = "destination-in"; mc.drawImage(l.mask, 0, 0); }
      l.mask = mask;
      l.maskOn = true;
      d.maskEdit = false;
      PS.commit("Remove Background");
    });
  };
  aiStatus();

  // ---------------------------------------------------------------- copy and paste
  PS.copy = async (cut, merged) => {
    const d = doc(), l = PS.active();
    if (!d) return;
    let src;
    if (merged) src = { c: PS.composite(d, { fresh: true }), x: 0, y: 0 };
    else { if (!l) return; const s = PS.styled({ ...l, fx: null, fill: 100, _st: null }); src = { c: s.c, x: s.x, y: s.y }; }
    let c = PS.clone(src.c), x = src.x, y = src.y;
    if (d.sel) {
      PS.clipToSel(c, x, y);
      const b = d.sel.box;
      const t = PS.canvas(b.w, b.h);
      t.getContext("2d").drawImage(c, x - b.x, y - b.y);
      c = t; x = b.x; y = b.y;
    }
    PS.clip = { c, x, y, w: c.width, h: c.height };
    if (cut && l && !merged) PS.clearSel();
    try {
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      await Promise.race([navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 1500))]);
      PS.clip.sys = true;
    } catch (e) { /* only the Editor has it then */ }
  };
  const pasteCanvas = (c, x, y, name = "Layer") => {
    if (!doc()) {
      const d = PS.createDoc("Untitled-" + (PS.docs.length + 1), c.width, c.height, "transparent");
      d.layers[0] = PS.layer({ name: "Layer 1", canvas: PS.clone(c) });
      d.active = d.layers[0].id;
      d.hist = [];
      d.hi = -1;
      PS.commit("New");
      d.saved = true;
      return;
    }
    const d = doc();
    if (x === undefined) { x = Math.round((d.w - c.width) / 2); y = Math.round((d.h - c.height) / 2); }
    PS.addLayer(PS.layer({ name: PS.layerName(name), canvas: PS.clone(c), x, y }), "Paste");
  };
  const pasteImage = async (blob) => {
    const img = await createImageBitmap(blob);
    const c = PS.canvas(img.width, img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    const own = PS.clip && PS.clip.sys && PS.clip.w === c.width && PS.clip.h === c.height;
    if (own) pasteCanvas(PS.clip.c, PS.clip.x, PS.clip.y); else pasteCanvas(c);
  };
  PS.paste = async () => {
    if (PS.clip) return pasteCanvas(PS.clip.c, PS.clip.x, PS.clip.y); // copied in the Editor (Ctrl+V also takes pictures copied elsewhere)
    try {
      const items = await Promise.race([navigator.clipboard.read(), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 1500))]);
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) return pasteImage(await it.getType(type));
      }
    } catch (e) { /* no access: use the Editor's own */ }
    if (PS.clip) pasteCanvas(PS.clip.c, PS.clip.x, PS.clip.y);
  };
  document.addEventListener("paste", (e) => {
    if (document.getElementById("editorTab").hidden) return;
    if (e.target && e.target.matches && e.target.matches("input, textarea")) return;
    const file = [...(e.clipboardData ? e.clipboardData.files : [])].find((f) => f.type.startsWith("image/"));
    e.preventDefault();
    e.stopImmediatePropagation();
    if (file) pasteImage(file); else if (PS.clip) pasteCanvas(PS.clip.c, PS.clip.x, PS.clip.y);
  }, true);

  // ---------------------------------------------------------------- opening files (button, drop, PSD)
  let psdLib = null;
  const loadPsdLib = () => psdLib || (psdLib = new Promise((resolve, reject) => {
    if (window.agPsd) return resolve(window.agPsd);
    const s = document.createElement("script");
    s.src = "editor/ag-psd.js";
    s.onload = () => resolve(window.agPsd);
    s.onerror = () => { psdLib = null; reject(new Error("load")); };
    document.head.append(s);
  }));
  const stem = (name) => name.replace(/\.[^.]+$/, "");
  PS.openFile = async (file, place) => {
    try {
      if (/\.psd$/i.test(file.name)) return await openPsd(file);
      const img = await createImageBitmap(file);
      if (place && doc()) {
        const d = doc();
        const s = Math.min(1, d.w / img.width, d.h / img.height);
        const c = PS.canvas(img.width * s, img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        PS.addLayer(PS.layer({ name: stem(file.name), canvas: c, x: Math.round((d.w - c.width) / 2), y: Math.round((d.h - c.height) / 2) }), "Place Embedded");
        return;
      }
      const d = PS.openPicture(file.name, img);
      PS.doc = null;
      PS.switchDoc(d);
      PS.commit("Open");
      d.saved = true;
      PS.changed();
    } catch (e) {
      PS.toast(`Could not open "${file.name}" because it isn't a picture this editor can read.`);
    }
  };
  PS.openFiles = (place) => {
    const i = el(`<input type="file" ${place ? "" : "multiple"} accept="image/*,.psd" style="display:none">`);
    i.onchange = () => { [...i.files].forEach((f) => PS.openFile(f, place)); i.remove(); };
    document.body.append(i);
    i.click();
  };
  // Opens a picture given as a URL (e.g. from the Images tab)
  PS.openUrl = async (url, name) => {
    const blob = await (await fetch(url)).blob();
    await PS.openFile(new File([blob], name || "Picture.png", { type: blob.type }));
  };
  const tab = document.getElementById("editorTab");
  const hasFiles = (e) => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes("Files");
  for (const type of ["dragenter", "dragleave"]) tab.addEventListener(type, (e) => { if (hasFiles(e)) e.stopPropagation(); });
  tab.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; } });
  tab.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    [...e.dataTransfer.files].forEach((f, i) => PS.openFile(f, !!doc() && !/\.psd$/i.test(f.name) && i >= 0 && !!doc()));
  });

  // PSD blend mode names have spaces ("color burn"); ours have dashes
  const toPsdBlend = (b) => b.replace("-", " ");
  const fromPsdBlend = (b) => { const v = String(b || "normal").replace(" ", "-"); return PS.BLENDS.some((x) => x[0] === v) ? v : "normal"; };
  const POSTSCRIPT = { "Arial": "ArialMT", "Arial Black": "Arial-Black", "Times New Roman": "TimesNewRomanPSMT", "Courier New": "CourierNewPSMT", "Segoe UI": "SegoeUI", "Segoe UI Black": "SegoeUI-Black", "Comic Sans MS": "ComicSansMS", "Trebuchet MS": "TrebuchetMS", "Palatino Linotype": "PalatinoLinotype-Roman" };
  const fromPostscript = (n) => {
    const hit = Object.entries(POSTSCRIPT).find(([, p]) => p === n);
    if (hit) return hit[0];
    const base = String(n || "Arial").split("-")[0].replace(/MT$|PSMT$/, "");
    return PS.FONTS.find((f) => f.replace(/\s/g, "") === base) || base.replace(/([a-z])([A-Z])/g, "$1 $2");
  };
  const grayToAlpha = (c, w, h) => {
    const t = PS.canvas(w, h), tc = t.getContext("2d", { willReadFrequently: true });
    tc.drawImage(c, 0, 0);
    const id = tc.getImageData(0, 0, w, h), p = id.data;
    for (let i = 0; i < p.length; i += 4) { p[i + 3] = p[i]; p[i] = p[i + 1] = p[i + 2] = 0; }
    tc.putImageData(id, 0, 0);
    return t;
  };
  const openPsd = async (file) => {
    PS.busy("Opening " + file.name + "...");
    try {
      const lib = await loadPsdLib();
      const psd = lib.readPsd(await file.arrayBuffer(), { skipThumbnail: true });
      const d = PS.newDoc(file.name, psd.width, psd.height, "transparent");
      d.layers = [];
      const add = (list, hidden) => {
        for (const x of list || []) {
          if (x.children) { add(x.children, hidden || x.hidden); continue; }
          let l;
          if (x.text && x.text.text !== undefined) {
            try {
              const st = x.text.style || {}, tr = x.text.transform || [1, 0, 0, 1, x.left || 0, x.top || 0];
              const scale = Math.sqrt(Math.abs(tr[0] * tr[3] - tr[1] * tr[2])) || 1;
              const col = st.fillColor && "r" in st.fillColor ? st.fillColor : { r: 0, g: 0, b: 0 };
              const just = (x.text.paragraphStyle || {}).justification;
              l = PS.layer({ kind: "text", name: x.name || "Type",
                text: { str: String(x.text.text).replace(/\r/g, "\n"), font: fromPostscript(st.font && st.font.name), size: Math.round((st.fontSize || 24) * scale * 10) / 10,
                  bold: !!st.fauxBold, italic: !!st.fauxItalic, align: just === "center" || just === "right" ? just : "left",
                  color: PS.hex(col), x: tr[4], y: tr[5], angle: (Math.atan2(tr[1], tr[0]) * 180) / Math.PI, leading: 1.2 } });
            } catch (e) { l = null; }
          }
          if (!l) {
            if (!x.canvas) continue;
            l = PS.layer({ name: x.name || "Layer", canvas: x.canvas, x: x.left || 0, y: x.top || 0 });
          }
          l.visible = !(hidden || x.hidden);
          l.opacity = Math.round((x.opacity === undefined ? 1 : x.opacity) * 100);
          l.fill = Math.round((x.fillOpacity === undefined ? 1 : x.fillOpacity) * 100);
          l.blend = fromPsdBlend(x.blendMode);
          if (x.mask && x.mask.canvas && !PS.isText(l)) {
            const mw = x.mask.canvas.width, mh = x.mask.canvas.height;
            const full = PS.canvas(l.canvas.width, l.canvas.height), fc = full.getContext("2d");
            if ((x.mask.defaultColor || 0) > 127) { fc.fillStyle = "#000"; fc.fillRect(0, 0, full.width, full.height); fc.clearRect((x.mask.left || 0) - l.x, (x.mask.top || 0) - l.y, mw, mh); }
            fc.drawImage(grayToAlpha(x.mask.canvas, mw, mh), (x.mask.left || 0) - l.x, (x.mask.top || 0) - l.y);
            l.mask = full;
            l.maskOn = !x.mask.disabled;
          }
          const e = x.effects;
          if (e && !e.disabled) {
            const s = e.stroke && e.stroke[0], sh = e.dropShadow && e.dropShadow[0];
            const f = {};
            if (s && s.enabled !== false) f.stroke = { on: true, size: (s.size && s.size.value) || 3, color: s.color && "r" in s.color ? PS.hex(s.color) : "#000000", opacity: Math.round((s.opacity === undefined ? 1 : s.opacity) * 100) };
            if (sh && sh.enabled !== false) f.shadow = { on: true, size: (sh.size && sh.size.value) || 5, distance: (sh.distance && sh.distance.value) || 5, angle: sh.angle === undefined ? 120 : sh.angle, color: sh.color && "r" in sh.color ? PS.hex(sh.color) : "#000000", opacity: Math.round((sh.opacity === undefined ? 0.75 : sh.opacity) * 100) };
            if (f.stroke || f.shadow) l.fx = f;
          }
          d.layers.push(l);
        }
      };
      add(psd.children);
      if (!d.layers.length && psd.canvas) d.layers.push(PS.layer({ name: "Background", canvas: psd.canvas, locked: true }));
      if (!d.layers.length) throw new Error("empty");
      const b = d.layers[0];
      if (/^background$/i.test(b.name) && !PS.isText(b)) b.locked = true;
      d.active = d.layers[d.layers.length - 1].id;
      PS.doc = null;
      PS.switchDoc(d);
      PS.commit("Open");
      d.saved = true;
      PS.changed();
    } catch (e) {
      PS.toast(`Could not open "${file.name}". The file may be damaged or use features this editor can't read.`);
    } finally { PS.busy(null); }
  };

  // ---------------------------------------------------------------- saving and exporting
  const saveBytes = async (bytes, name, overwrite) => {
    let folder = "";
    if (!overwrite) {
      const r = await post("/api/ask-folder").catch(() => ({ ok: false }));
      if (!r.ok) return null;
      folder = r.folder;
    }
    const headers = { "X-File-Name": encodeURIComponent(name) };
    if (overwrite) headers["X-Path"] = encodeURIComponent(overwrite); else headers["X-Folder"] = encodeURIComponent(folder);
    const res = await (await fetch("/api/editor-save", { method: "POST", headers, body: bytes })).json().catch(() => ({ ok: false }));
    if (!res.ok) { PS.toast(res.error || "Couldn't save there. Try another folder."); return null; }
    return res;
  };
  const savedToast = (res) => PS.toast(`Saved ${res.name}`, { label: "Show in folder", run: () => post("/api/editor-show", { path: res.path }) });
  const makePsd = (d) => {
    const children = d.layers.map((l) => {
      PS.syncText(l);
      const x = { name: l.name, canvas: l.canvas, left: l.x, top: l.y, opacity: l.opacity / 100, fillOpacity: l.fill / 100, blendMode: toPsdBlend(l.blend), hidden: !l.visible };
      if (l.mask) {
        const g = PS.canvas(l.mask.width, l.mask.height), gc = g.getContext("2d");
        gc.fillStyle = "#000"; gc.fillRect(0, 0, g.width, g.height);
        const t = PS.canvas(g.width, g.height), tc = t.getContext("2d");
        tc.fillStyle = "#fff"; tc.fillRect(0, 0, g.width, g.height);
        tc.globalCompositeOperation = "destination-in"; tc.drawImage(l.mask, 0, 0);
        gc.drawImage(t, 0, 0);
        x.mask = { canvas: g, left: l.x, top: l.y, defaultColor: 255, disabled: !l.maskOn };
      }
      if (PS.isText(l)) {
        const t = l.text, a = ((t.angle || 0) * Math.PI) / 180;
        x.text = {
          text: t.str.replace(/\n/g, "\r"),
          transform: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), t.x, t.y],
          style: { font: { name: POSTSCRIPT[t.font] || t.font.replace(/\s/g, "") }, fontSize: t.size, fauxBold: t.bold, fauxItalic: t.italic, fillColor: PS.parseHex(t.color), autoLeading: true },
          paragraphStyle: { justification: t.align },
        };
      }
      if (l.fx) {
        const e = {};
        if (l.fx.stroke && l.fx.stroke.on) e.stroke = [{ enabled: true, present: true, showInDialog: true, size: { units: "Pixels", value: l.fx.stroke.size }, position: "outside", fillType: "color", blendMode: "normal", opacity: l.fx.stroke.opacity / 100, color: PS.parseHex(l.fx.stroke.color) }];
        if (l.fx.shadow && l.fx.shadow.on) e.dropShadow = [{ enabled: true, present: true, showInDialog: true, size: { units: "Pixels", value: l.fx.shadow.size }, distance: { units: "Pixels", value: l.fx.shadow.distance }, angle: l.fx.shadow.angle, color: PS.parseHex(l.fx.shadow.color), opacity: l.fx.shadow.opacity / 100, blendMode: "multiply", useGlobalLight: false }];
        if (e.stroke || e.dropShadow) x.effects = e;
      }
      return x;
    });
    return { width: d.w, height: d.h, children, canvas: PS.composite(d, { fresh: true }) };
  };
  PS.savePsd = async (asNew, thenClose) => {
    const d = doc();
    if (!d) return;
    if (PS.typing) PS.endTyping(true);
    if (PS.xf) PS.endTransform(true);
    PS.busy("Saving...");
    try {
      const lib = await loadPsdLib();
      const bytes = lib.writePsd(makePsd(d), { invalidateTextLayers: true, generateThumbnail: true, noBackground: !(d.layers[0].locked && d.layers[0].name === "Background") });
      const res = await saveBytes(bytes, stem(d.name) + ".psd", !asNew && d.path);
      if (!res) return false;
      d.path = res.path;
      d.name = res.name;
      d.saved = true;
      savedToast(res);
      PS.changed();
      if (thenClose) PS.closeDoc(d, true);
      return true;
    } catch (e) {
      PS.toast("Couldn't save the PSD. Try again.");
      return false;
    } finally { PS.busy(null); }
  };
  PS.askSave = (d, thenAll) => {
    const body = el(`<div style="max-width:380px">Save changes to the document "${esc(d.name)}" before closing?</div>`);
    const no = el('<button class="ps-btn">No</button>');
    const dl = PS.dialog({ title: "Editor", body, ok: "Yes", onOk: async () => { const ok = await PS.savePsd(!d.path, true); if (ok && thenAll) PS.closeAll(); } });
    no.onclick = () => { dl.close(); PS.closeDoc(d, true); if (thenAll) PS.closeAll(); };
    dl.back.querySelector(".ft").prepend(no);
  };
  const exportBlob = (d, type, quality, scale = 1) => {
    let c = PS.composite(d, { fresh: true });
    if (type === "image/jpeg") { const f = PS.canvas(c.width, c.height), x = f.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, f.width, f.height); x.drawImage(c, 0, 0); c = f; }
    if (scale !== 1) { const s = PS.canvas(c.width * scale, c.height * scale), x = s.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, s.width, s.height); c = s; }
    return new Promise((r) => c.toBlob(r, type, quality));
  };
  PS.quickExport = async () => {
    const d = doc();
    const blob = await exportBlob(d, "image/png");
    const res = await saveBytes(blob, stem(d.name) + ".png");
    if (res) savedToast(res);
  };
  PS.exportDialog = () => {
    const d = doc();
    const fmt = selectRow("Format:", [["png", "PNG"], ["jpg", "JPG"], ["webp", "WEBP"]], "png");
    const q = field("Quality:", 90, 1, 100, "%");
    const sc = field("Size:", 100, 1, 400, "%", 1, false);
    const name = el(`<div class="fr"><span>File name:</span><input type="text" value="${esc(stem(d.name))}" style="width:220px"></div>`);
    const info = el('<div class="note"></div>');
    const prev = el('<div style="display:grid;place-items:center;background:#1e1e1e;border-radius:4px;height:200px;overflow:hidden"></div>');
    const thumb = PS.canvas(1, 1);
    { const c = PS.composite(d, { fresh: true }), s = Math.min(380 / d.w, 200 / d.h, 1); thumb.width = d.w * s; thumb.height = d.h * s; const x = thumb.getContext("2d"); x.drawImage(c, 0, 0, thumb.width, thumb.height); }
    prev.append(thumb);
    const body = el("<div style='display:flex;flex-direction:column;gap:10px;width:420px'></div>");
    body.append(prev, name, fmt, q, sc, info);
    let t = null;
    const update = () => {
      q.style.display = fmt.get() === "png" ? "none" : "";
      clearTimeout(t);
      t = setTimeout(async () => {
        const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[fmt.get()];
        const b = await exportBlob(d, type, q.get() / 100, sc.get() / 100);
        info.textContent = `${Math.round((d.w * sc.get()) / 100)} × ${Math.round((d.h * sc.get()) / 100)} px · about ${b.size > 1048576 ? (b.size / 1048576).toFixed(1) + " MB" : Math.round(b.size / 1024) + " KB"}`;
      }, 150);
    };
    fmt.on(update); q.on(update); sc.on(update);
    update();
    PS.dialog({
      title: "Export As", body, ok: "Export",
      onOk: async () => {
        const f = fmt.get(), type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[f];
        const blob = await exportBlob(d, type, q.get() / 100, sc.get() / 100);
        const res = await saveBytes(blob, (name.querySelector("input").value.trim() || "Untitled") + "." + f);
        if (res) savedToast(res);
      },
    });
  };

  // ---------------------------------------------------------------- help
  PS.shortcutsDialog = () => {
    const rows = [
      ["V", "Move"], ["M", "Marquee"], ["L", "Lasso"], ["W", "Object Selection / Magic Wand"], ["C", "Crop"], ["I", "Eyedropper"], ["B", "Brush"], ["E", "Eraser"], ["G", "Gradient / Paint Bucket"], ["T", "Type"], ["U", "Rectangle / Ellipse"], ["H / Space", "Hand"], ["Z", "Zoom"],
      ["Shift + tool key", "Next tool in the group"], ["[ and ]", "Brush size (Shift: hardness)"], ["1 ... 0", "Opacity 10% ... 100%"], ["X / D", "Swap / default colors"],
      ["Ctrl+Z / Shift+Ctrl+Z", "Undo / Redo"], ["Ctrl+T", "Free Transform"], ["Ctrl+J", "Layer via Copy"], ["Ctrl+A / Ctrl+D", "Select all / Deselect"], ["Shift+Ctrl+I", "Inverse"],
      ["Alt+Backspace", "Fill with foreground"], ["Ctrl+E", "Merge Down"], ["Alt+Shift+Ctrl+E", "Stamp Visible"], ["Ctrl+0 / Ctrl+1", "Fit / 100%"], ["Ctrl+S", "Save as PSD"], ["Alt+Shift+Ctrl+W", "Export As"], ["Tab", "Hide panels"],
    ];
    PS.dialog({ title: "Keyboard Shortcuts", cancel: null, body: `<div style="display:grid;grid-template-columns:170px 1fr;gap:6px 16px;max-height:420px;overflow:auto">${rows.map(([k, v]) => `<b style="color:#eee;font-weight:600">${k}</b><span style="color:#bbb">${v}</span>`).join("")}</div>` });
  };
  PS.aboutDialog = () => PS.dialog({ title: "About the Editor", cancel: null,
    body: '<div style="max-width:420px;line-height:1.5">A picture editor built into VaultHub, made to work like Photoshop. Remove Background and Select Subject use an AI model that runs on your PC.<br><br><span class="note">Opens and saves PSD files with ag-psd (MIT license).</span></div>' });
})();
