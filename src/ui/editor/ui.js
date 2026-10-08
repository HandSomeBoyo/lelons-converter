// The Editor tab, part 3: the Photoshop-style screen (menus, tools, options bar, panels) and the keyboard.
(() => {
  const PS = window.PS, T = PS.tools, opt = PS.opt;
  const root = document.getElementById("ps");
  if (!root) return;
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const svg = (inner, fill) => `<svg viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const doc = () => PS.doc;

  // ---------------------------------------------------------------- icons
  const I = {
    move: svg('<path d="M6 3.5l9.5 7.2-4.2.8 2.4 5-1.9.9-2.4-5L6 15.5z" fill="currentColor" stroke="none"/><path d="M17 13.5v7M13.5 17h7M17 13.5l-1.2 1.2M17 13.5l1.2 1.2M17 20.5l-1.2-1.2M17 20.5l1.2-1.2M13.5 17l1.2-1.2M13.5 17l1.2 1.2M20.5 17l-1.2-1.2M20.5 17l-1.2 1.2" stroke-width="1.2"/>'),
    marquee: svg('<rect x="4" y="5" width="16" height="14" stroke-dasharray="2.6 2"/>'),
    ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="2.6 2"/>'),
    lasso: svg('<path d="M9.5 16.5C5 15.8 3 13.5 3.5 10.8 4.2 7 9 4.8 14 5.2c4.6.4 7 2.8 6.3 5.6-.7 3-5 4.8-9.4 4.6"/><path d="M10.8 15.5c-1.6.4-2.3 1.7-1.7 3 .5 1.1 1.6 1.4 2.4 1"/>'),
    polylasso: svg('<path d="M9.5 16.5 3.5 11l4-6 11 1.5 2 6.5-9 2.7"/><path d="M10.8 15.5c-1.6.4-2.3 1.7-1.7 3 .5 1.1 1.6 1.4 2.4 1"/>'),
    objsel: svg('<rect x="3.5" y="3.5" width="13" height="11" stroke-dasharray="2.4 1.8"/><path d="M11 9l8.5 5.2-3.6.7 2 4.2-1.6.8-2-4.2L11 18.2z" fill="currentColor" stroke="none"/>'),
    wand: svg('<path d="M4 20 15 9"/><path d="M15 9l2-2"/><path d="M17.5 2.5v2.5M17.5 9.5V12M13 7h-2.5M22 7h-2.5M14.3 3.8l1.4 1.4M19.3 8.8l1.4 1.4M14.3 10.2l1.4-1.4M19.3 5.2l1.4-1.4" stroke-width="1.3"/>'),
    crop: svg('<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>'),
    eyedropper: svg('<path d="M14.5 5.5l4 4"/><path d="M16 4c1-1 2.6-1 3.5 0s1 2.5 0 3.5L17.5 9.5l-3-3z" fill="currentColor"/><path d="M15.5 8.5 7 17l-3 1 1-3 8.5-8.5"/>'),
    brush: svg('<path d="M20 3.5c-3.5 2-8 6.5-10 9.5l1.5 1.5c3-2 7.5-6.5 9.5-10z" fill="currentColor"/><path d="M9.3 13.8c-2.3-.3-4 1.3-4.2 3.5-.1 1.4-1 2.2-2.1 2.7 3 1.3 6.8.6 7.8-2.6.4-1.3-.1-2.7-1.5-3.6z" fill="currentColor" stroke="none"/>'),
    eraser: svg('<path d="M14.5 4.5l5 5-9 9h-4l-3-3z"/><path d="M9.5 9.5l5 5" /><path d="M10.5 18.5h9"/>'),
    gradient: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1"/><path d="M8 5.5v13" stroke-opacity=".9"/><path d="M12 5.5v13" stroke-opacity=".6"/><path d="M16 5.5v13" stroke-opacity=".3"/>'),
    bucket: svg('<path d="M10 3.5 3.5 10l7 7 6.5-6.5z"/><path d="M3.5 10h13.5"/><path d="M19 12.5s2 2.6 2 4a2 2 0 0 1-4 0c0-1.4 2-4 2-4z" fill="currentColor"/>'),
    type: svg('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" stroke-width="1.8"/>'),
    spotheal: svg('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M10.5 10.5l3 3M13.5 10.5l-3 3" stroke-width="1.2"/><path d="M18.5 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/>'),
    heal: svg('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><circle cx="10.6" cy="10.6" r=".7" fill="currentColor"/><circle cx="13.4" cy="13.4" r=".7" fill="currentColor"/><circle cx="13.4" cy="10.6" r=".7" fill="currentColor"/><circle cx="10.6" cy="13.4" r=".7" fill="currentColor"/>'),
    clone: svg('<path d="M9 3.5h6l-1 6h-4z" fill="currentColor" fill-opacity=".3"/><path d="M9 3.5h6l-1 6h-4zM6 12.5h12l1 4H5z"/><path d="M5 19.5h14"/>'),
    warp: svg('<path d="M4 7.5c3-3 5 3 8 0s5 3 8 0M8 7.5v10M16 7.5v10M5.5 19c2-1.5 4 1 6.5 0s4.5 1 6.5 0"/>'),
    group: svg('<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>'),
    rect: svg('<rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" fill-opacity=".25"/>'),
    ellipseShape: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="currentColor" fill-opacity=".25"/>'),
    hand: svg('<path d="M8 12.5V5.8a1.3 1.3 0 0 1 2.6 0V11V4.3a1.3 1.3 0 0 1 2.6 0V11V5.3a1.3 1.3 0 0 1 2.6 0V11.5V8a1.3 1.3 0 0 1 2.6 0v6.5c0 3.6-2.6 6-6 6-2.4 0-3.8-1-5.2-2.8L4.5 13.6c-.7-.9.4-2.2 1.4-1.6z"/>'),
    zoom: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5" stroke-width="2.2"/>'),
    eye: svg('<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>'),
    lock: svg('<rect x="5.5" y="10.5" width="13" height="10" rx="1"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>', false),
    lockSm: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V8a5 5 0 0 1 10 0v2h1v11H6V10zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>',
    newLayer: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="1"/><path d="M12 8.5v7M8.5 12h7"/>'),
    trash: svg('<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10v6.5M14 10v6.5"/>'),
    mask: svg('<rect x="4" y="5.5" width="16" height="13" rx="1"/><circle cx="12" cy="12" r="3.6" fill="currentColor"/>'),
    adjust: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor"/>'),
    folder: svg('<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    history: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.5l3 2"/>'),
    props: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2"/>'),
    cancel: svg('<circle cx="12" cy="12" r="7.5"/><path d="M6.7 17.3 17.3 6.7"/>'),
    alignL: svg('<path d="M4 4v16M7 8h12M7 12h8M7 16h10"/>'), alignC: svg('<path d="M12 4v16M6 8h12M8 12h8M7 16h10"/>'), alignR: svg('<path d="M20 4v16M5 8h12M9 12h8M7 16h10"/>'),
    alignT: svg('<path d="M4 4h16M8 7v12M12 7v8M16 7v10"/>'), alignM: svg('<path d="M4 12h16M8 6v12M12 8v8M16 7v10"/>'), alignB: svg('<path d="M4 20h16M8 5v12M12 9v8M16 7v10"/>'),
    tleft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'), tcenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'), tright: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
    selNew: svg('<rect x="5" y="5" width="14" height="14" fill="currentColor" fill-opacity=".85" stroke="none"/>'),
    selAdd: svg('<rect x="3.5" y="3.5" width="11" height="11" fill="currentColor" fill-opacity=".85" stroke="none"/><rect x="9.5" y="9.5" width="11" height="11" fill="currentColor" fill-opacity=".85" stroke="none"/>'),
    selSub: svg('<rect x="3.5" y="3.5" width="11" height="11" fill="currentColor" fill-opacity=".85" stroke="none"/><rect x="9.5" y="9.5" width="11" height="11" stroke-width="1.2"/>'),
    selInt: svg('<rect x="3.5" y="3.5" width="11" height="11" stroke-width="1.2"/><rect x="9.5" y="9.5" width="11" height="11" stroke-width="1.2"/><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" stroke="none"/>'),
    gLinear: svg('<rect x="4" y="6" width="16" height="12" fill="currentColor" fill-opacity=".2"/><path d="M4 12h16"/>'),
    gRadial: svg('<circle cx="12" cy="12" r="7" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="12" r="2.5"/>'),
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    swap: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 9.5V5a2 2 0 0 1 2-2h4.5"/><path d="M7.5 1.2 9.5 3 7.5 4.8M1.2 7.5 3 9.5l1.8-2"/></svg>',
    def: '<svg viewBox="0 0 12 12"><rect x="1" y="1" width="6" height="6" fill="#000" stroke="#ddd" stroke-width=".8"/><rect x="5" y="5" width="6" height="6" fill="#fff" stroke="#888" stroke-width=".8"/></svg>',
  };
  PS.icons = I;

  // ---------------------------------------------------------------- the screen
  root.innerHTML = `
    <div class="ps-menubar" id="psMenubar"><span class="ps-logo">Ps</span><span class="ps-ai-state" id="psAiState" title="Remove Background and Select Subject run on this PC"><i></i><span>AI</span></span></div>
    <div class="ps-options" id="psOptions"></div>
    <div class="ps-work" id="psWork">
      <div class="ps-tools" id="psTools"><div class="grip"></div></div>
      <div class="ps-docs">
        <div class="ps-doctabs" id="psDocTabs"></div>
        <div class="ps-stage" id="psStage">
          <canvas class="ps-ruler corner"></canvas><canvas class="ps-ruler" id="psRulerTop"></canvas><canvas class="ps-ruler" id="psRulerLeft"></canvas>
          <div class="ps-view" id="psView"><canvas class="main" id="psCanvas"></canvas><div class="ps-home" id="psHome"></div></div>
        </div>
        <div class="ps-status" id="psStatus"></div>
      </div>
      <div class="ps-strip" id="psStrip">
        <button data-panel="history" title="History">${I.history}</button>
        <button data-panel="props" title="Properties">${I.props}</button>
        <button data-panel="adjust" title="Adjustments">${I.adjust}</button>
      </div>
      <div class="ps-dock" id="psDock">
        <div class="ps-panel" id="psColorPanel">
          <div class="ps-ptabs"><button class="on" data-t="color">Color</button><button data-t="swatches">Swatches</button><span class="menu">≡</span></div>
          <div class="ps-pbody" id="psColorBody"></div>
        </div>
        <div class="ps-panel" id="psMidPanel" style="height:min(280px, 33%)">
          <div class="ps-ptabs"><button class="on" data-t="props">Properties</button><button data-t="adjust">Adjustments</button><button data-t="history">History</button><span class="menu">≡</span></div>
          <div class="ps-pbody" id="psMidBody" style="flex:1"></div>
        </div>
        <div class="ps-panel grow" id="psLayersPanel">
          <div class="ps-ptabs"><button class="on">Layers</button><span class="menu" id="psLayersMenu">≡</span></div>
          <div class="ps-ltop" id="psLayerTop"></div>
          <div class="ps-layers" id="psLayers"></div>
          <div class="ps-lbot" id="psLayerBot"></div>
        </div>
      </div>
    </div>`;
  const $ = (id) => document.getElementById(id);
  PS.viewEl = $("psView");
  PS.viewCanvas = $("psCanvas");
  PS.bindView(PS.viewCanvas);
  PS.root = root;

  // ---------------------------------------------------------------- little messages, busy, confirm
  let toastTimer = null;
  PS.toast = (text, action) => {
    root.querySelector(".ps-toast")?.remove();
    const t = el(`<div class="ps-toast"><span>${esc(text)}</span></div>`);
    if (action) {
      const b = el(`<button class="ps-btn">${esc(action.label)}</button>`);
      b.onclick = () => { action.run(); t.remove(); };
      t.append(b);
    }
    root.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), action ? 7000 : 3800);
  };
  PS.busy = (text) => {
    root.querySelector(".ps-busy")?.remove();
    if (!text) return;
    root.append(el(`<div class="ps-busy"><span class="spin"></span><span>${esc(text)}</span></div>`));
  };

  // ---------------------------------------------------------------- menus
  const has = () => !!doc();
  const hasSel = () => !!(doc() && doc().sel);
  const hasLayer = () => !!PS.active();
  const A = PS.actions = {};
  const ADJ_NAMES = { bc: "Brightness/Contrast", levels: "Levels", curves: "Curves", exposure: "Exposure", vib: "Vibrance", hs: "Hue/Saturation", colorbal: "Color Balance",
    bw: "Black & White", photo: "Photo Filter", invert: "Invert", posterize: "Posterize", threshold: "Threshold", gradmap: "Gradient Map" };
  const ADJ_MENU = () => (PS.ADJ_TYPES || []).map((t) => [ADJ_NAMES[t] + "...", "", () => PS.newAdjLayer(t), has]);
  const MENUS = () => [
    ["File", [
      ["New...", "Ctrl+N", () => PS.newDialog()],
      ["Open...", "Ctrl+O", () => PS.openFiles()],
      ["-"],
      ["Close", "Ctrl+W", () => PS.closeDoc(doc()), has],
      ["Close All", "Alt+Ctrl+W", () => PS.closeAll(), has],
      ["Save", "Ctrl+S", () => PS.savePsd(false), has],
      ["Save As...", "Shift+Ctrl+S", () => PS.savePsd(true), has],
      ["-"],
      ["Place Embedded...", "", () => PS.openFiles(true), has],
      ["-"],
      ["Export", [
        ["Quick Export as PNG", "Shift+Ctrl+'", () => PS.quickExport(), has],
        ["Export As...", "Alt+Shift+Ctrl+W", () => PS.exportDialog(), has],
      ]],
    ]],
    ["Edit", [
      [() => `Undo ${doc() && doc().hi > 0 ? doc().hist[doc().hi].name : ""}`, "Ctrl+Z", () => PS.undo(), () => has() && doc().hi > 0],
      [() => `Redo ${doc() && doc().hi < doc().hist.length - 1 ? doc().hist[doc().hi + 1].name : ""}`, "Shift+Ctrl+Z", () => PS.redo(), () => has() && doc().hi < doc().hist.length - 1],
      ["Step Backward", "Alt+Ctrl+Z", () => PS.undo(), () => has() && doc().hi > 0],
      ["-"],
      ["Cut", "Ctrl+X", () => PS.copy(true), hasLayer],
      ["Copy", "Ctrl+C", () => PS.copy(false), hasLayer],
      ["Copy Merged", "Shift+Ctrl+C", () => PS.copy(false, true), has],
      ["Paste", "Ctrl+V", () => PS.paste(), () => true],
      ["Clear", "Delete", () => PS.clearSel(), hasSel],
      ["-"],
      ["Fill...", "Shift+F5", () => PS.fillDialog(), hasLayer],
      ["-"],
      ["Free Transform", "Ctrl+T", () => PS.startTransform(), hasLayer],
      ["Transform", [
        ["Rotate 180°", "", () => PS.flipLayer("180"), hasLayer],
        ["Rotate 90° Clockwise", "", () => PS.flipLayer("cw"), hasLayer],
        ["Rotate 90° Counter Clockwise", "", () => PS.flipLayer("ccw"), hasLayer],
        ["-"],
        ["Flip Horizontal", "", () => PS.flipLayer("h"), hasLayer],
        ["Flip Vertical", "", () => PS.flipLayer("v"), hasLayer],
      ]],
    ]],
    ["Image", [
      ["Adjustments", [
        ["Brightness/Contrast...", "", () => PS.adjust("bc"), hasLayer],
        ["Levels...", "Ctrl+L", () => PS.adjust("levels"), hasLayer],
        ["Curves...", "Ctrl+M", () => PS.adjust("curves"), hasLayer],
        ["Exposure...", "", () => PS.adjust("exposure"), hasLayer],
        ["-"],
        ["Vibrance...", "", () => PS.adjust("vib"), hasLayer],
        ["Hue/Saturation...", "Ctrl+U", () => PS.adjust("hs"), hasLayer],
        ["Color Balance...", "Ctrl+B", () => PS.adjust("colorbal"), hasLayer],
        ["Black & White...", "Alt+Shift+Ctrl+B", () => PS.adjust("bw"), hasLayer],
        ["Photo Filter...", "", () => PS.adjust("photo"), hasLayer],
        ["-"],
        ["Invert", "Ctrl+I", () => PS.quickFilter("invert"), hasLayer],
        ["Posterize...", "", () => PS.adjust("posterize"), hasLayer],
        ["Threshold...", "", () => PS.adjust("threshold"), hasLayer],
        ["Gradient Map...", "", () => PS.adjust("gradmap"), hasLayer],
        ["-"],
        ["Desaturate", "Shift+Ctrl+U", () => PS.quickFilter("desat"), hasLayer],
      ]],
      ["-"],
      ["Image Size...", "Alt+Ctrl+I", () => PS.imageSizeDialog(), has],
      ["Canvas Size...", "Alt+Ctrl+C", () => PS.canvasSizeDialog(), has],
      ["Image Rotation", [
        ["180°", "", () => PS.rotateCanvas("180"), has],
        ["90° Clockwise", "", () => PS.rotateCanvas("cw"), has],
        ["90° Counter Clockwise", "", () => PS.rotateCanvas("ccw"), has],
        ["-"],
        ["Flip Canvas Horizontal", "", () => PS.rotateCanvas("h"), has],
        ["Flip Canvas Vertical", "", () => PS.rotateCanvas("v"), has],
      ]],
      ["Crop", "", () => PS.cropToSel(), hasSel],
      ["Trim...", "", () => PS.trim(), has],
    ]],
    ["Layer", [
      ["New", [
        ["Layer...", "Shift+Ctrl+N", () => PS.newLayer(), has],
        ["Group...", "", () => PS.newGroup(false), has],
        ["-"],
        ["Layer via Copy", "Ctrl+J", () => PS.layerVia(false), hasLayer],
        ["Layer via Cut", "Shift+Ctrl+J", () => PS.layerVia(true), hasSel],
      ]],
      ["New Adjustment Layer", ADJ_MENU()],
      ["Duplicate Layer...", "", () => PS.duplicateAny(), hasLayer],
      ["Delete Layer", "", () => PS.deleteLayer(), hasLayer],
      ["Rename Layer...", "", () => PS.renameActive(), hasLayer],
      ["-"],
      ["Layer Style", [
        ["Stroke...", "", () => PS.styleDialog("stroke"), hasLayer],
        ["Drop Shadow...", "", () => PS.styleDialog("shadow"), hasLayer],
        ["-"],
        ["Clear Layer Style", "", () => PS.clearStyle(), () => hasLayer() && !!PS.active().fx],
      ]],
      ["-"],
      ["Layer Mask", [
        ["Reveal All", "", () => PS.addMask("all"), () => hasLayer() && !PS.active().mask],
        ["Hide All", "", () => PS.addMask("none"), () => hasLayer() && !PS.active().mask],
        ["Reveal Selection", "", () => PS.addMask("sel"), () => hasSel() && !PS.active().mask],
        ["Hide Selection", "", () => PS.addMask("hidesel"), () => hasSel() && !PS.active().mask],
        ["-"],
        ["Delete", "", () => PS.maskAction("delete"), () => hasLayer() && !!PS.active().mask],
        ["Apply", "", () => PS.maskAction("apply"), () => hasLayer() && !!PS.active().mask],
        [() => (PS.active() && PS.active().mask && !PS.active().maskOn ? "Enable" : "Disable"), "", () => PS.maskAction("toggle"), () => hasLayer() && !!PS.active().mask],
      ]],
      ["Remove Background", "", () => PS.removeBackground(), hasLayer, null, true],
      ["-"],
      ["Rasterize", [["Type", "", () => { PS.rasterize(PS.active(), true); PS.commit("Rasterize Type"); }, () => PS.isText(PS.active())]]],
      ["-"],
      ["Arrange", [
        ["Bring to Front", "Shift+Ctrl+]", () => PS.arrange("front"), hasLayer],
        ["Bring Forward", "Ctrl+]", () => PS.arrange("up"), hasLayer],
        ["Send Backward", "Ctrl+[", () => PS.arrange("down"), hasLayer],
        ["Send to Back", "Shift+Ctrl+[", () => PS.arrange("back"), hasLayer],
      ]],
      ["Align Layers to", [
        ["Left Edges", "", () => PS.align("l"), hasLayer], ["Horizontal Centers", "", () => PS.align("c"), hasLayer], ["Right Edges", "", () => PS.align("r"), hasLayer],
        ["-"],
        ["Top Edges", "", () => PS.align("t"), hasLayer], ["Vertical Centers", "", () => PS.align("m"), hasLayer], ["Bottom Edges", "", () => PS.align("b"), hasLayer],
      ]],
      ["-"],
      ["Group Layers", "Ctrl+G", () => PS.newGroup(true), hasLayer],
      ["Ungroup Layers", "Shift+Ctrl+G", () => PS.ungroup(), () => PS.isGroup(PS.active())],
      ["-"],
      [() => (doc() && (doc().picked || []).length > 1 ? "Merge Layers" : PS.isGroup(PS.active()) ? "Merge Group" : "Merge Down"), "Ctrl+E", () => PS.mergeDown(), hasLayer],
      ["Merge Visible", "Shift+Ctrl+E", () => PS.mergeVisible(), has],
      ["Stamp Visible", "Alt+Shift+Ctrl+E", () => PS.stampVisible(), has],
      ["Flatten Image", "", () => PS.flatten(), has],
    ]],
    ["Type", [
      ["Warp Text...", "", () => PS.warpDialog(), () => PS.isText(PS.active())],
      ["Rasterize Type Layer", "", () => { PS.rasterize(PS.active(), true); PS.commit("Rasterize Type"); }, () => PS.isText(PS.active())],
      ["-"],
      ["Bigger", "Shift+Ctrl+.", () => PS.nudgeType(2), () => PS.isText(PS.active())],
      ["Smaller", "Shift+Ctrl+,", () => PS.nudgeType(-2), () => PS.isText(PS.active())],
    ]],
    ["Select", [
      ["All", "Ctrl+A", () => PS.selectAll(), has],
      ["Deselect", "Ctrl+D", () => PS.setSel(null, "Deselect"), hasSel],
      ["Reselect", "Shift+Ctrl+D", () => PS.reselect(), () => has() && !!doc().lastSel],
      ["Inverse", "Shift+Ctrl+I", () => PS.inverse(), hasSel],
      ["-"],
      ["Subject", "", () => PS.selectSubject("new"), has, null, true],
      ["-"],
      ["Modify", [
        ["Expand...", "", () => PS.modifySel("expand"), hasSel],
        ["Contract...", "", () => PS.modifySel("contract"), hasSel],
        ["Feather...", "Shift+F6", () => PS.modifySel("feather"), hasSel],
        ["Smooth...", "", () => PS.modifySel("smooth"), hasSel],
      ]],
    ]],
    ["Filter", [
      ["Blur", [["Gaussian Blur...", "", () => PS.adjust("blur"), hasLayer], ["Motion Blur...", "", () => PS.adjust("motion"), hasLayer]]],
      ["Noise", [["Add Noise...", "", () => PS.adjust("noise"), hasLayer]]],
      ["Pixelate", [["Mosaic...", "", () => PS.adjust("mosaic"), hasLayer]]],
      ["Sharpen", [["Sharpen", "", () => PS.quickFilter("sharpen"), hasLayer], ["Unsharp Mask...", "", () => PS.adjust("unsharp"), hasLayer]]],
    ]],
    ["View", [
      ["Zoom In", "Ctrl+=", () => PS.stepZoom(1), has],
      ["Zoom Out", "Ctrl+-", () => PS.stepZoom(-1), has],
      ["Fit on Screen", "Ctrl+0", () => PS.fit(), has],
      ["100%", "Ctrl+1", () => PS.setZoom(1), has],
      ["-"],
      ["Rulers", "Ctrl+R", () => toggleRulers(), () => true, () => rulersOn],
      ["Extras", "Ctrl+H", () => { PS.hideEdges = !PS.hideEdges; PS.draw(); }, () => true, () => !PS.hideEdges],
    ]],
    ["Window", [
      ["Color", "F6", () => showPanel("color"), () => true],
      ["Swatches", "", () => showPanel("swatches"), () => true],
      ["Properties", "", () => showPanel("props"), () => true],
      ["Adjustments", "", () => showPanel("adjust"), () => true],
      ["History", "", () => showPanel("history"), () => true],
      ["Layers", "F7", () => showPanel("layers"), () => true],
      ["-"],
      ["Show/Hide Panels", "Tab", () => togglePanels(), () => true],
    ]],
    ["Help", [
      ["Keyboard Shortcuts", "", () => PS.shortcutsDialog(), () => true],
      ["About the Editor", "", () => PS.aboutDialog(), () => true],
    ]],
  ];
  // Shortcuts: "Shift+Ctrl+Z" -> "ctrl+shift+z"
  const norm = (k) => {
    const parts = k.split("+"), key = parts.pop().toLowerCase();
    const mods = ["ctrl", "alt", "shift"].filter((m) => parts.map((p) => p.toLowerCase()).includes(m));
    return [...mods, key === "" ? "+" : key].join("+");
  };
  const shortcuts = {};
  const walk = (items) => items.forEach((it) => {
    if (Array.isArray(it[1])) return walk(it[1]);
    if (it[1] && it[2]) shortcuts[norm(it[1])] = it;
  });
  walk(MENUS().flatMap((m) => m[1]));

  const menubar = $("psMenubar");
  let openMenu = null;
  const closeMenus = () => { document.querySelectorAll(".ps-menu").forEach((m) => m.remove()); menubar.querySelectorAll("button.open").forEach((b) => b.classList.remove("open")); openMenu = null; };
  const showMenu = (items, x, y, level = 0) => {
    document.querySelectorAll(".ps-menu").forEach((m) => { if (+m.dataset.level >= level) m.remove(); });
    const m = el(`<div class="ps-menu" data-level="${level}"></div>`);
    for (const it of items) {
      if (it[0] === "-") { m.append(el('<div class="ms"></div>')); continue; }
      const label = typeof it[0] === "function" ? it[0]() : it[0];
      const sub = Array.isArray(it[1]);
      const on = sub ? true : it[3] ? it[3]() : true;
      const checked = it[4] && it[4]();
      const row = el(`<div class="mi ${sub ? "sub" : ""} ${on ? "" : "off"}">${checked ? '<span class="chk">✓</span>' : ""}<span>${esc(label)}</span>${it[5] ? '<span class="ai">AI</span>' : ""}<span class="k">${sub ? "" : esc(it[1] || "")}</span></div>`);
      if (sub) {
        row.addEventListener("mouseenter", () => {
          m.querySelectorAll(".mi.open").forEach((r) => r.classList.remove("open"));
          row.classList.add("open");
          const r = row.getBoundingClientRect();
          showMenu(it[1], r.right - 2, r.top - 4, level + 1);
        });
      } else {
        row.addEventListener("mouseenter", () => { m.querySelectorAll(".mi.open").forEach((r) => r.classList.remove("open")); document.querySelectorAll(".ps-menu").forEach((x) => { if (+x.dataset.level > level) x.remove(); }); });
        if (on) row.addEventListener("click", () => { closeMenus(); it[2](); });
      }
      m.append(row);
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 4) + "px";
    m.style.top = Math.min(y, innerHeight - r.height - 4) + "px";
    return m;
  };
  PS.contextMenu = (items, x, y) => { closeMenus(); showMenu(items, x, y); };
  MENUS().forEach(([name]) => {
    const b = el(`<button>${name}</button>`);
    const open = () => {
      closeMenus();
      b.classList.add("open");
      openMenu = name;
      const r = b.getBoundingClientRect();
      showMenu(MENUS().find((m) => m[0] === name)[1], r.left, r.bottom + 1);
    };
    b.addEventListener("mousedown", (e) => { e.stopPropagation(); if (openMenu === name) closeMenus(); else open(); });
    b.addEventListener("mouseenter", () => { if (openMenu && openMenu !== name) open(); });
    menubar.insertBefore(b, $("psAiState"));
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".ps-menu, .ps-flyout, .ps-pop")) { closeMenus(); closeFlyouts(); } });

  // ---------------------------------------------------------------- tools panel
  const GROUPS = [["move"], ["marquee", "ellipse"], ["lasso", "polylasso"], ["objsel", "wand"], ["crop"], ["eyedropper"], "|", ["spotheal", "heal"], ["brush"], ["clone"], ["eraser"], ["gradient", "bucket"], "|", ["type"], ["rect", "ellipseShape"], "|", ["hand"], ["zoom"]];
  const groupShown = {};
  const toolsEl = $("psTools");
  const closeFlyouts = () => document.querySelectorAll(".ps-flyout, .ps-pop").forEach((f) => f.remove());
  const drawTools = () => {
    toolsEl.querySelectorAll(".ps-tool, .gap, .ps-colors").forEach((n) => n.remove());
    for (const g of GROUPS) {
      if (g === "|") { toolsEl.append(el('<div class="gap"></div>')); continue; }
      const shown = g.includes(PS.tool) ? PS.tool : groupShown[g[0]] || g[0];
      const t = T[shown];
      const b = el(`<button class="ps-tool ${g.length > 1 ? "more" : ""} ${g.includes(PS.tool) ? "on" : ""}" title="${esc(t.name)} (${t.key})">${I[shown]}</button>`);
      let hold = null;
      const fly = () => {
        closeFlyouts();
        const r = b.getBoundingClientRect();
        const f = el('<div class="ps-flyout"></div>');
        for (const id of g) {
          const row = el(`<div class="mi ${id === shown ? "on" : ""}"><span class="cur"></span>${I[id]}<span>${esc(T[id].name)}</span><span class="k">${T[id].key}</span></div>`);
          row.onclick = () => { closeFlyouts(); PS.setTool(id); };
          f.append(row);
        }
        f.style.left = r.right + 4 + "px";
        f.style.top = r.top + "px";
        document.body.append(f);
      };
      b.addEventListener("pointerdown", () => { if (g.length > 1) hold = setTimeout(fly, 380); });
      b.addEventListener("pointerup", () => clearTimeout(hold));
      b.addEventListener("click", () => { if (!document.querySelector(".ps-flyout")) PS.setTool(shown); });
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); if (g.length > 1) fly(); });
      toolsEl.append(b);
    }
    const colors = el(`<div class="ps-colors"><span class="bg" title="Set background color"></span><span class="fg" title="Set foreground color"></span><button class="swap" title="Switch Foreground and Background Colors (X)">${I.swap}</button><button class="def" title="Default Foreground and Background Colors (D)">${I.def}</button></div>`);
    colors.querySelector(".fg").style.background = PS.hex(PS.fg);
    colors.querySelector(".bg").style.background = PS.hex(PS.bg);
    colors.querySelector(".fg").onclick = () => PS.colorPicker("fg");
    colors.querySelector(".bg").onclick = () => PS.colorPicker("bg");
    colors.querySelector(".swap").onclick = () => swapColors();
    colors.querySelector(".def").onclick = () => defaultColors();
    toolsEl.append(colors);
  };
  const swapColors = () => { [PS.fg, PS.bg] = [PS.bg, PS.fg]; PS.onColors(); };
  const defaultColors = () => { PS.fg = { r: 0, g: 0, b: 0 }; PS.bg = { r: 255, g: 255, b: 255 }; PS.onColors(); };
  PS.setTool = (id) => {
    if (!T[id]) return;
    if (PS.xf) PS.endTransform(true);
    if (PS.typing && id !== "type") PS.endTyping(true);
    if (PS.tool === "polylasso") T.polylasso.cancel();
    const was = T[PS.tool];
    if (was && was.deactivate && PS.tool !== id) was.deactivate();
    PS.tool = id;
    for (const g of GROUPS) if (Array.isArray(g) && g.includes(id)) groupShown[g[0]] = id;
    if (T[id].activate) T[id].activate();
    PS.cursorAt = null;
    drawTools();
    drawOptions();
    PS.setCursor();
    PS.draw();
  };
  PS.onColors = () => {
    drawTools();
    drawColorPanel();
    if (PS.tool === "gradient") drawOptions();
  };

  // ---------------------------------------------------------------- options bar
  const optEl = $("psOptions");
  const ctl = {
    num(label, o, key, min, max, unit = "", w = 56, after) {
      const n = el(`<label>${label}<input type="number" min="${min}" max="${max}" value="${o[key]}" style="width:${w}px">${unit}</label>`);
      const i = n.querySelector("input");
      i.addEventListener("change", () => { o[key] = PS.clamp(+i.value || 0, min, max); i.value = o[key]; after && after(); });
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") i.blur(); });
      return n;
    },
    check(label, o, key, after) {
      const n = el(`<label><input type="checkbox" ${o[key] ? "checked" : ""}>${label}</label>`);
      n.querySelector("input").addEventListener("change", (e) => { o[key] = e.target.checked; after && after(); });
      return n;
    },
    select(label, o, key, options, after, w) {
      const n = el(`<label>${label}<select style="${w ? `width:${w}px` : ""}">${options.map(([v, t]) => (v === "-" ? '<option disabled>──────────</option>' : `<option value="${esc(v)}" ${o[key] === v ? "selected" : ""}>${esc(t)}</option>`)).join("")}</select></label>`);
      n.querySelector("select").addEventListener("change", (e) => { o[key] = e.target.value; after && after(); });
      return n;
    },
    seg(o, key, items, after) {
      const g = el('<div class="grp"></div>');
      for (const [v, icon, title] of items) {
        const b = el(`<button class="ps-ib ${o[key] === v ? "on" : ""}" title="${esc(title)}">${icon}</button>`);
        b.onclick = () => { o[key] = v; after && after(); drawOptions(); };
        g.append(b);
      }
      return g;
    },
    btn(label, run, cls = "") { const b = el(`<button class="ps-btn ${cls}">${label}</button>`); b.onclick = run; return b; },
    ib(icon, title, run) { const b = el(`<button class="ps-ib" title="${esc(title)}">${icon}</button>`); b.onclick = run; return b; },
    sep() { return el('<span class="sep"></span>'); },
    brush(o) {
      const b = el(`<button class="ps-brushpick" title="Brush Preset picker"><span class="dot"><svg width="20" height="20"><circle cx="10" cy="10" r="8" fill="${o.hard >= 100 ? "#ddd" : "url(#)"}" /></svg></span><b>${o.size}</b><svg width="8" height="5" style="margin-left:2px"><path d="M0 0l4 5 4-5z" fill="#aaa"/></svg></button>`);
      const dot = b.querySelector(".dot");
      dot.innerHTML = `<span style="display:block;width:18px;height:18px;border-radius:50%;background:radial-gradient(circle,#e8e8e8 ${o.hard * 0.7}%,transparent 72%)"></span>`;
      b.onclick = (e) => {
        e.stopPropagation();
        closeFlyouts();
        const r = b.getBoundingClientRect();
        const p = el(`<div class="ps-pop">
          <div class="row"><span>Size:</span><input type="range" min="1" max="1000" value="${o.size}" data-k="size"><span>${o.size} px</span></div>
          <div class="row"><span>Hardness:</span><input type="range" min="0" max="100" value="${o.hard}" data-k="hard"><span>${o.hard}%</span></div></div>`);
        p.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => {
          o[i.dataset.k] = +i.value;
          i.nextElementSibling.textContent = i.value + (i.dataset.k === "size" ? " px" : "%");
          b.querySelector("b").textContent = o.size;
          PS.draw();
        }));
        p.style.left = r.left + "px";
        p.style.top = r.bottom + 4 + "px";
        document.body.append(p);
      };
      return b;
    },
  };
  const BLEND_OPTS = PS.BLENDS.map((b) => (b[0] === "-" ? ["-", ""] : b));
  const SEL_MODES = [["new", I.selNew, "New selection"], ["add", I.selAdd, "Add to selection"], ["subtract", I.selSub, "Subtract from selection"], ["intersect", I.selInt, "Intersect with selection"]];
  const FONTS = ["Arial", "Arial Black", "Bahnschrift", "Calibri", "Cambria", "Comic Sans MS", "Consolas", "Courier New", "Georgia", "Impact", "Inter", "Montserrat", "Palatino Linotype", "Segoe UI", "Segoe UI Black", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];
  PS.FONTS = FONTS;
  const typeTarget = () => (PS.isText(PS.active()) ? PS.active() : null);
  const setType = (key, value) => {
    opt.type[key] = value;
    const l = typeTarget();
    if (l) {
      l.text = { ...l.text, [key]: value };
      if (PS.typing) { PS.changed(); PS.placeTyping && PS.placeTyping(); } else PS.commit("Change Type");
    }
  };
  const drawOptions = () => {
    optEl.innerHTML = "";
    const add = (...n) => n.forEach((x) => x && optEl.append(x));
    if (PS.xf) {
      const x = PS.xf;
      const n = (label, val, set) => {
        const lab = el(`<label>${label}<input type="number" value="${Math.round(val * 10) / 10}" style="width:62px"></label>`);
        lab.querySelector("input").addEventListener("change", (e) => { set(+e.target.value || 0); PS.changed(); });
        return lab;
      };
      add(el(`<span class="tool-badge">${I.move}</span>`),
        n("X:", x.cx, (v) => (x.cx = v)), n("Y:", x.cy, (v) => (x.cy = v)), ctl.sep(),
        n("W:", (x.w / x.b.w) * 100, (v) => (x.w = (x.b.w * v) / 100)), el("<span>%</span>"),
        n("H:", (x.h / x.b.h) * 100, (v) => (x.h = (x.b.h * v) / 100)), el("<span>%</span>"), ctl.sep(),
        n("∠", (x.ang * 180) / Math.PI, (v) => (x.ang = (v * Math.PI) / 180)), el("<span>°</span>"),
        el('<span style="flex:1"></span>'),
        ctl.ib(I.cancel, "Cancel transform (Esc)", () => PS.endTransform(false)),
        ctl.ib(I.check, "Commit transform (Enter)", () => PS.endTransform(true)));
      return;
    }
    const t = T[PS.tool];
    add(el(`<span class="tool-badge" title="${esc(t.name)}">${I[PS.tool]}</span>`));
    const selectSubjectBtn = () => { const b = ctl.btn(`${I.sparkle}Select Subject`, () => PS.selectSubject(opt.sel.mode), "ai"); b.title = "Select the main subject (AI)"; return b; };
    switch (PS.tool) {
      case "move":
        add(ctl.check("Auto-Select: Layer", opt.move, "auto"), ctl.sep(),
          ctl.ib(I.alignL, "Align left edges", () => PS.align("l")), ctl.ib(I.alignC, "Align horizontal centers", () => PS.align("c")), ctl.ib(I.alignR, "Align right edges", () => PS.align("r")),
          ctl.ib(I.alignT, "Align top edges", () => PS.align("t")), ctl.ib(I.alignM, "Align vertical centers", () => PS.align("m")), ctl.ib(I.alignB, "Align bottom edges", () => PS.align("b")),
          ctl.sep(), ctl.btn("Free Transform", () => PS.startTransform()));
        break;
      case "marquee": case "ellipse": case "lasso": case "polylasso":
        add(ctl.seg(opt.sel, "mode", SEL_MODES), ctl.sep(), ctl.num("Feather:", opt.sel, "feather", 0, 250, " px", 46), ctl.sep(), selectSubjectBtn());
        break;
      case "objsel":
        add(ctl.seg(opt.sel, "mode", SEL_MODES), ctl.sep(), el('<span style="color:#999">Drag a box around an object</span>'), ctl.sep(), selectSubjectBtn());
        break;
      case "wand":
        add(ctl.seg(opt.sel, "mode", SEL_MODES), ctl.sep(), ctl.num("Tolerance:", opt.wand, "tol", 0, 255, "", 46), ctl.check("Contiguous", opt.wand, "contiguous"), ctl.check("Sample All Layers", opt.wand, "all"), ctl.sep(), selectSubjectBtn());
        break;
      case "crop": {
        const r = T.crop.rect || { w: doc() ? doc().w : 0, h: doc() ? doc().h : 0 };
        add(ctl.select("", opt.crop, "ratio", PS.CROP_RATIOS.map((k) => [k, k === "free" ? "Ratio" : k]), () => T.crop.activate(), 90),
          el(`<span id="psCropSize" style="color:#bbb">${Math.round(r.w)} × ${Math.round(r.h)} px</span>`),
          ctl.btn("Clear", () => T.crop.activate()), el('<span style="flex:1"></span>'),
          ctl.ib(I.cancel, "Cancel crop (Esc)", () => T.crop.cancel()), ctl.ib(I.check, "Commit crop (Enter)", () => T.crop.commit()));
        break;
      }
      case "eyedropper":
        add(ctl.select("Sample:", opt.eyedropper, "all", [[true, "All Layers"], [false, "Current Layer"]].map(([v, l]) => [String(v), l]), () => { opt.eyedropper.all = opt.eyedropper.all === "true" || opt.eyedropper.all === true; }));
        break;
      case "brush":
        add(ctl.brush(opt.brush), ctl.sep(), ctl.select("Mode:", opt.brush, "mode", BLEND_OPTS, null, 110), ctl.num("Opacity:", opt.brush, "opacity", 1, 100, "%", 46), ctl.num("Flow:", opt.brush, "flow", 1, 100, "%", 46));
        break;
      case "eraser":
        add(ctl.brush(opt.eraser), ctl.sep(), ctl.num("Opacity:", opt.eraser, "opacity", 1, 100, "%", 46), ctl.num("Flow:", opt.eraser, "flow", 1, 100, "%", 46));
        break;
      case "gradient": {
        const prev = el('<span class="ps-gradprev" title="Foreground to background"></span>');
        const b = opt.gradient.transparent ? `rgba(${PS.fg.r},${PS.fg.g},${PS.fg.b},0)` : PS.hex(PS.bg);
        prev.style.background = `linear-gradient(90deg, ${PS.hex(PS.fg)}, ${b}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px`;
        add(prev, ctl.seg(opt.gradient, "type", [["linear", I.gLinear, "Linear gradient"], ["radial", I.gRadial, "Radial gradient"]]), ctl.sep(),
          ctl.select("Mode:", opt.gradient, "mode", BLEND_OPTS, null, 110), ctl.num("Opacity:", opt.gradient, "opacity", 1, 100, "%", 46),
          ctl.check("Reverse", opt.gradient, "reverse"), ctl.check("To Transparent", opt.gradient, "transparent", drawOptions));
        break;
      }
      case "bucket":
        add(ctl.num("Opacity:", opt.bucket, "opacity", 1, 100, "%", 46), ctl.num("Tolerance:", opt.bucket, "tol", 0, 255, "", 46), ctl.check("Contiguous", opt.bucket, "contiguous"), ctl.check("All Layers", opt.bucket, "all"));
        break;
      case "type": {
        const l = typeTarget(), t = l ? l.text : opt.type;
        const font = ctl.select("", { v: t.font }, "v", FONTS.map((f) => [f, f]), null, 150);
        font.querySelector("select").addEventListener("change", (e) => setType("font", e.target.value));
        const style = ctl.select("", { v: (t.bold ? "b" : "") + (t.italic ? "i" : "") || "r" }, "v", [["r", "Regular"], ["b", "Bold"], ["i", "Italic"], ["bi", "Bold Italic"]], null, 96);
        style.querySelector("select").addEventListener("change", (e) => { setType("bold", e.target.value.includes("b")); setType("italic", e.target.value.includes("i")); });
        const size = el(`<label><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#aaa" stroke-width="1.5"><path d="M4 7V5h10v2M9 5v14M14 12V11h6v1M17 11v8"/></svg><input type="number" min="1" max="1500" value="${t.size}" style="width:56px">px</label>`);
        size.querySelector("input").addEventListener("change", (e) => setType("size", PS.clamp(+e.target.value || 12, 1, 1500)));
        const color = el('<button class="ps-swatch-btn" title="Set the text color"></button>');
        color.style.background = l ? t.color : PS.hex(PS.fg);
        color.onclick = () => PS.colorPicker("text");
        add(font, style, size, ctl.sep(),
          ctl.seg({ a: t.align }, "a", [["left", I.tleft, "Left align text"], ["center", I.tcenter, "Center text"], ["right", I.tright, "Right align text"]], null),
          color, ctl.ib(I.warp, "Create warped text", () => PS.warpDialog()));
        optEl.querySelectorAll(".grp .ps-ib").forEach((b, i) => { b.onclick = () => { setType("align", ["left", "center", "right"][i]); drawOptions(); }; });
        if (PS.typing) add(el('<span style="flex:1"></span>'), ctl.ib(I.cancel, "Cancel any current edits (Esc)", () => PS.endTyping(false)), ctl.ib(I.check, "Commit any current edits (Ctrl+Enter)", () => PS.endTyping(true)));
        break;
      }
      case "clone": case "heal":
        add(ctl.brush(opt[PS.tool]), ctl.sep(), ...(PS.tool === "clone" ? [ctl.num("Opacity:", opt.clone, "opacity", 1, 100, "%", 46), ctl.num("Flow:", opt.clone, "flow", 1, 100, "%", 46)] : [el('<span style="color:#bbb">Source: Sampled</span>')]),
          ctl.check("Aligned", opt[PS.tool], "aligned"), ctl.check("Sample All Layers", opt[PS.tool], "all"), ctl.sep(), el('<span style="color:#999">Alt+click to pick where to copy from</span>'));
        break;
      case "spotheal":
        add(ctl.brush(opt.spotheal), ctl.sep(), el('<span style="color:#bbb">Type: Content-Aware</span>'), ctl.check("Sample All Layers", opt.spotheal, "all"), ctl.sep(), el('<span style="color:#999">Paint over a spot to remove it</span>'));
        break;
      case "rect":
        add(el('<span style="color:#bbb">Fill: foreground color</span>'), ctl.sep(), ctl.num("Corner radius:", opt.shape, "radius", 0, 1000, " px", 50));
        break;
      case "ellipseShape":
        add(el('<span style="color:#bbb">Fill: foreground color · Shift for a circle</span>'));
        break;
      case "hand": case "zoom":
        if (PS.tool === "zoom") add(ctl.ib(I.zoom, "Zoom in", () => has() && PS.stepZoom(1)), ctl.ib('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5M8 10.5h5"/></svg>', "Zoom out", () => has() && PS.stepZoom(-1)), ctl.sep());
        add(ctl.btn("100%", () => has() && PS.setZoom(1)), ctl.btn("Fit Screen", () => has() && PS.fit()), ctl.btn("Fill Screen", () => has() && PS.fit(true)));
        break;
    }
  };
  PS.drawOptions = drawOptions;
  PS.onCrop = (r) => { const s = document.getElementById("psCropSize"); if (s) s.textContent = `${Math.round(r.w)} × ${Math.round(r.h)} px`; };
  PS.onTransform = () => drawOptions();

  // ---------------------------------------------------------------- color panel
  const colorBody = $("psColorBody");
  let colorTab = "color";
  const SWATCHES = ["#000000", "#ffffff", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#808080", "#c0c0c0", "#800000", "#808000",
    "#ed1c24", "#f26522", "#f7941d", "#fff200", "#8dc63f", "#39b54a", "#00a99d", "#00aeef", "#0072bc", "#2e3192", "#662d91", "#ec008c",
    "#f5989d", "#fdc68a", "#fff799", "#c4df9b", "#a3d39c", "#7accc8", "#6dcff6", "#8393ca", "#a187be", "#f49ac2", "#3c3c3c", "#e6e6e6"];
  let hsv = PS.rgbToHsv(PS.fg);
  const drawColorPanel = () => {
    colorBody.innerHTML = "";
    if (colorTab === "swatches") {
      const g = el('<div class="ps-swatches"></div>');
      for (const c of SWATCHES) {
        const s = el(`<i title="${c}" style="background:${c}"></i>`);
        s.onclick = (e) => { const v = PS.parseHex(c); if (e.altKey) PS.bg = v; else PS.fg = v; PS.onColors(); };
        g.append(s);
      }
      colorBody.append(g);
      return;
    }
    const cur = PS.rgbToHsv(PS.fg);
    if (cur.s > 0.001 && cur.v > 0.001) hsv = cur; else hsv = { ...hsv, s: cur.s, v: cur.v };
    const p = el('<div class="ps-colorpanel"><div class="sv"><canvas></canvas><i></i></div><div class="hue"><canvas></canvas><i></i></div></div>');
    colorBody.append(p);
    const sv = p.querySelector(".sv canvas"), hue = p.querySelector(".hue canvas");
    const paint = () => {
      sv.width = 220; sv.height = 88;
      const c = sv.getContext("2d");
      c.fillStyle = `hsl(${hsv.h},100%,50%)`; c.fillRect(0, 0, 220, 88);
      let g = c.createLinearGradient(0, 0, 220, 0); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 220, 88);
      g = c.createLinearGradient(0, 0, 0, 88); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "#000"); c.fillStyle = g; c.fillRect(0, 0, 220, 88);
      hue.width = 14; hue.height = 88;
      const h = hue.getContext("2d"), hg = h.createLinearGradient(0, 0, 0, 88);
      for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${360 - i * 60},100%,50%)`);
      h.fillStyle = hg; h.fillRect(0, 0, 14, 88);
      const dot = p.querySelector(".sv i");
      dot.style.left = hsv.s * 100 + "%"; dot.style.top = (1 - hsv.v) * 100 + "%";
      p.querySelector(".hue i").style.top = (1 - hsv.h / 360) * 100 + "%";
    };
    paint();
    const drag = (target, fn) => target.addEventListener("pointerdown", (e) => {
      target.setPointerCapture(e.pointerId);
      const move = (ev) => { const r = target.getBoundingClientRect(); fn(PS.clamp((ev.clientX - r.left) / r.width, 0, 1), PS.clamp((ev.clientY - r.top) / r.height, 0, 1)); PS.fg = PS.hsvToRgb(hsv); paint(); drawTools(); };
      move(e);
      target.onpointermove = move;
      target.onpointerup = () => { target.onpointermove = null; PS.onColors(); };
    });
    drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
    drag(hue, (x, y) => { hsv.h = (1 - y) * 360; });
  };
  $("psColorPanel").querySelectorAll(".ps-ptabs button").forEach((b) => b.addEventListener("click", () => {
    colorTab = b.dataset.t;
    $("psColorPanel").querySelectorAll(".ps-ptabs button").forEach((x) => x.classList.toggle("on", x === b));
    drawColorPanel();
  }));

  // ---------------------------------------------------------------- Properties / Adjustments / History
  const midBody = $("psMidBody");
  let midTab = "props";
  const showPanel = (name) => {
    if (root.querySelector(".ps-work").classList.contains("no-panels")) togglePanels();
    if (["props", "adjust", "history"].includes(name)) {
      midTab = name;
      $("psMidPanel").querySelectorAll(".ps-ptabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === name));
      drawMid();
    }
    if (["color", "swatches"].includes(name)) $("psColorPanel").querySelector(`[data-t="${name}"]`).click();
  };
  $("psMidPanel").querySelectorAll(".ps-ptabs button").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.t)));
  $("psStrip").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.panel)));
  const ADJ = [
    ["bc", "Brightness/Contrast", '<path d="M12 4v16M12 4a8 8 0 0 1 0 16" fill="currentColor"/><circle cx="12" cy="12" r="8"/>'],
    ["levels", "Levels", '<path d="M3 20h18M5 20l3-7 3 4 3-10 3 8 2-3v8"/>'],
    ["curves", "Curves", '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M4 20C10 19 9 6 20 4"/>'],
    ["exposure", "Exposure", '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M4 20 20 4"/><path d="M7 8h4M9 6v4M13 16h4"/>'],
    ["vib", "Vibrance", '<path d="M12 3l9 16H3z"/><path d="M12 10v5"/>'],
    ["hs", "Hue/Saturation", '<path d="M4 18c3-8 5-12 8-12s5 4 8 12"/><path d="M4 18h16"/>'],
    ["colorbal", "Color Balance", '<path d="M12 4v16M5 8h14M7 8l-3 6h6zM17 8l-3 6h6z"/>'],
    ["bw", "Black & White", '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 20 20 4v16z" fill="currentColor"/>'],
    ["photo", "Photo Filter", '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 7l1.5-2.5h5L16 7"/>'],
    ["invert", "Invert", '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16h8V4z" fill="currentColor"/>'],
    ["posterize", "Posterize", '<path d="M4 20V14h4v-4h4V6h4V4h4v16z"/>'],
    ["threshold", "Threshold", '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 14c3-1 5 2 8 0s5-4 8-3v9H4z" fill="currentColor"/>'],
    ["gradmap", "Gradient Map", '<rect x="3.5" y="6.5" width="17" height="11" rx="1"/><path d="M8 6.5v11" stroke-opacity=".8"/><path d="M12 6.5v11" stroke-opacity=".55"/><path d="M16 6.5v11" stroke-opacity=".3"/>'],
  ];
  PS.showPanel = (n) => showPanel(n);
  let skipMid = false;
  const drawMid = () => {
    midBody.innerHTML = "";
    const d = doc();
    if (midTab === "adjust") {
      const w = el('<div class="ps-props"><h4>Add an adjustment</h4><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px" class="adj"></div><div class="note" style="color:#7d7d7d">Adds an adjustment layer: it changes everything under it, and you can change or remove it any time.</div></div>');
      for (const [id, name, path] of ADJ) {
        const b = el(`<button class="ps-ib" style="width:100%;height:34px" title="${name}">${svg(path)}</button>`);
        b.onclick = () => PS.newAdjLayer(id);
        if (!d) b.disabled = true;
        w.querySelector(".adj").append(b);
      }
      midBody.append(w);
      return;
    }
    if (midTab === "history") {
      if (!d) return midBody.append(el('<div class="ps-props"><span class="empty">No document open</span></div>'));
      const box = el('<div class="ps-history"></div>');
      const snapRow = el(`<div class="snap"><canvas width="34" height="24"></canvas><span>${esc(d.name)}</span></div>`);
      box.append(snapRow);
      d.hist.forEach((h, i) => {
        const r = el(`<div class="it ${i === d.hi ? "on" : i > d.hi ? "after" : ""}">${I.history}<span>${esc(h.name)}</span></div>`);
        r.onclick = () => PS.goto(i);
        box.append(r);
      });
      midBody.append(box);
      const c = snapRow.querySelector("canvas").getContext("2d"), comp = PS.composite(d);
      const s = Math.min(34 / d.w, 24 / d.h);
      c.drawImage(comp, (34 - d.w * s) / 2, (24 - d.h * s) / 2, d.w * s, d.h * s);
      const on = box.querySelector(".it.on");
      on && on.scrollIntoView({ block: "nearest" });
      return;
    }
    // Properties
    const w = el('<div class="ps-props"></div>');
    const l = PS.active();
    if (!d) { w.append(el('<span class="empty">No properties</span>')); midBody.append(w); return; }
    const quick = () => {
      const q = el('<div><div class="sub" style="margin-bottom:8px">Quick Actions</div><div class="quick"></div></div>');
      const rb = ctl.btn(`${I.sparkle}Remove Background`, () => PS.removeBackground(), "ai");
      const ss = ctl.btn(`${I.sparkle}Select Subject`, () => PS.selectSubject("new"), "ai");
      q.querySelector(".quick").append(rb, ss);
      return q;
    };
    if (PS.isAdj(l)) {
      const f = PS.FILTERS[l.adj.type];
      w.append(el(`<h4>${svg(ADJ_ICON(l.adj.type))}${esc(f.name)}</h4>`));
      w.append(PS.adjBody(l.adj, (adj, done) => {
        l.adj = adj;
        skipMid = true; // the controls are already right; don't rebuild them mid-drag
        if (done) PS.commit(`Modify ${f.name} Layer`); else PS.changed();
      }));
      w.append(el('<div class="note" style="color:#7d7d7d">Paint black on its mask to hide the adjustment in places.</div>'));
      midBody.append(w);
      return;
    }
    if (PS.isGroup(l)) {
      const n = PS.inside(d, l).filter((x) => !PS.isGroup(x)).length;
      w.append(el(`<h4>${I.group}Group</h4>`), el(`<div class="note" style="color:#9a9a9a">${n} layer${n === 1 ? "" : "s"} inside. Move or transform it to change them all at once.</div>`));
      const g = el('<div class="quick" style="display:grid;gap:6px"></div>');
      g.append(ctl.btn("Ungroup", () => PS.ungroup()), ctl.btn("Merge Group", () => PS.mergeDown()), ctl.btn("Free Transform", () => PS.startTransform()));
      w.append(g);
      midBody.append(w);
      return;
    }
    if (d.maskEdit && l && l.mask) {
      w.append(el(`<h4>${I.mask}Masks</h4>`), el('<div class="note" style="color:#9a9a9a">Paint black to hide, white to show. Click the layer thumbnail to paint on the layer again.</div>'));
      const g = el('<div class="quick" style="display:grid;gap:6px"></div>');
      g.append(ctl.btn("Invert", () => PS.maskAction("invert")), ctl.btn(l.maskOn ? "Disable Mask" : "Enable Mask", () => PS.maskAction("toggle")), ctl.btn("Apply Mask", () => PS.maskAction("apply")), ctl.btn("Delete Mask", () => PS.maskAction("delete")));
      w.append(g);
    } else if (PS.isText(l)) {
      PS.syncText(l);
      const t = l.text;
      w.append(el(`<h4><span style="font:700 14px 'Times New Roman'">T</span>Type Layer</h4>`));
      const tr = el(`<div class="grid2"><label>X <input type="number" value="${Math.round(t.x)}"></label><label>Y <input type="number" value="${Math.round(t.y)}"></label></div>`);
      const [ix, iy] = tr.querySelectorAll("input");
      ix.onchange = () => { l.text = { ...l.text, x: +ix.value || 0 }; PS.commit("Move"); };
      iy.onchange = () => { l.text = { ...l.text, y: +iy.value || 0 }; PS.commit("Move"); };
      w.append(el('<div class="sub">Transform</div>'), tr, el('<div class="sub">Character</div>'));
      const ch = el('<div style="display:flex;flex-direction:column;gap:6px"></div>');
      const f = ctl.select("", { v: t.font }, "v", FONTS.map((x) => [x, x]), null, 170);
      f.querySelector("select").onchange = (e) => setType("font", e.target.value);
      const sz = el(`<label>Size <input type="number" value="${t.size}" style="width:60px"> px</label>`);
      sz.querySelector("input").onchange = (e) => setType("size", PS.clamp(+e.target.value || 12, 1, 1500));
      const col = el(`<label>Color <button class="ps-swatch-btn" style="background:${t.color}"></button></label>`);
      col.querySelector("button").onclick = () => PS.colorPicker("text");
      const bold = ctl.check("Bold", { v: t.bold }, "v", () => setType("bold", !t.bold));
      const ital = ctl.check("Italic", { v: t.italic }, "v", () => setType("italic", !t.italic));
      ch.append(f, sz, col, el('<div style="display:flex;gap:14px"></div>'));
      ch.lastChild.append(bold, ital);
      w.append(ch);
      const fx = ctl.btn("Layer Style (Stroke, Shadow)...", () => PS.styleDialog("stroke"));
      w.append(el('<div class="sub">Appearance</div>'), fx);
    } else if (l) {
      const s = PS.styled({ ...l, fx: null });
      w.append(el(`<h4>${l.locked ? I.lock : I.newLayer}${l.locked ? "Background" : "Pixel Layer"}</h4>`));
      const tr = el(`<div class="grid2"><label>W <input type="number" value="${l.canvas.width}" disabled></label><label>H <input type="number" value="${l.canvas.height}" disabled></label><label>X <input type="number" value="${Math.round(s.x)}"></label><label>Y <input type="number" value="${Math.round(s.y)}"></label></div>`);
      const ins = tr.querySelectorAll("input");
      ins[2].onchange = () => { if (l.locked) return; PS.moveLayer(l, (+ins[2].value || 0) - l.x, 0); PS.commit("Move"); };
      ins[3].onchange = () => { if (l.locked) return; PS.moveLayer(l, 0, (+ins[3].value || 0) - l.y); PS.commit("Move"); };
      w.append(el('<div class="sub">Transform</div>'), tr, quick());
      if (l.locked) w.append(el(`<div class="note" style="color:#7d7d7d">Canvas: ${d.w} × ${d.h} px. Double-click the Background layer to unlock it.</div>`));
    }
    midBody.append(w);
  };

  // ---------------------------------------------------------------- Layers panel
  const layerTop = $("psLayerTop"), layersEl = $("psLayers"), layerBot = $("psLayerBot");
  layerTop.innerHTML = `
    <div class="r"><select disabled style="flex:none;width:86px;opacity:.75"><option>Kind</option></select><span style="flex:1"></span></div>
    <div class="r"><select id="psBlend"></select><span class="num">Opacity: <input type="number" id="psOpacity" min="0" max="100">%</span></div>
    <div class="r"><span class="num">Lock:</span><span class="locks"><button class="ps-ib" id="psLockPos" title="Lock position">${svg('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>')}</button><button class="ps-ib" id="psLockAll" title="Lock all">${I.lockSm}</button></span><span style="flex:1"></span><span class="num">Fill: <input type="number" id="psFill" min="0" max="100">%</span></div>`;
  $("psBlend").onchange = (e) => { const l = PS.active(); if (l) { l.blend = e.target.value; PS.commit("Blending Change"); } };
  const numIn = (id, key, name) => {
    const i = $(id);
    i.onchange = () => { const l = PS.active(); if (l) { l[key] = PS.clamp(Math.round(+i.value || 0), 0, 100); PS.commit(name); } };
    i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); };
  };
  numIn("psOpacity", "opacity", "Opacity Change");
  numIn("psFill", "fill", "Fill Opacity Change");
  $("psLockPos").onclick = $("psLockAll").onclick = () => { const l = PS.active(); if (l) { l.locked = !l.locked; PS.commit(l.locked ? "Lock Layer" : "Unlock Layer"); } };
  const bot = [
    [I.link, "Link layers", null],
    ['<span class="fx">fx</span>', "Add a layer style", (e) => PS.contextMenu([["Stroke...", "", () => PS.styleDialog("stroke"), hasLayer], ["Drop Shadow...", "", () => PS.styleDialog("shadow"), hasLayer]], e.clientX, e.clientY - 70)],
    [I.mask, "Add layer mask", () => PS.addMask(doc() && doc().sel ? "sel" : "all")],
    [I.adjust, "Create new fill or adjustment layer", (e) => PS.contextMenu(ADJ_MENU(), e.clientX, e.clientY - 330)],
    [I.group, "Create a new group", () => PS.newGroup(false)],
    [I.newLayer, "Create a new layer", () => PS.newLayer(true)],
    [I.trash, "Delete layer", () => PS.deleteLayer()],
  ];
  for (const [icon, title, run] of bot) {
    if (!run) continue;
    const b = el(`<button class="ps-ib" title="${title}">${icon}</button>`);
    b.onclick = (e) => { if (doc()) run(e); };
    layerBot.append(b);
  }
  $("psLayersMenu").onclick = (e) => PS.contextMenu([
    ["New Layer...", "Shift+Ctrl+N", () => PS.newLayer(), has], ["Duplicate Layer...", "", () => PS.duplicate(PS.active()), hasLayer], ["Delete Layer", "", () => PS.deleteLayer(), hasLayer],
    ["-"], ["Merge Down", "Ctrl+E", () => PS.mergeDown(), hasLayer], ["Merge Visible", "Shift+Ctrl+E", () => PS.mergeVisible(), has], ["Flatten Image", "", () => PS.flatten(), has],
  ], e.clientX - 200, e.clientY + 8);

  const thumbs = new WeakMap(); // canvas -> small picture
  const thumb = (src, w = 36, h = 28, mask) => {
    const key = src;
    const have = thumbs.get(key);
    if (have && !mask) return PS.clone(have);
    const c = PS.canvas(w, h), ctx = c.getContext("2d");
    if (mask) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); }
    const s = Math.min(w / src.width, h / src.height);
    const dw = src.width * s, dh = src.height * s;
    if (mask) {
      const t = PS.canvas(dw, dh), tc = t.getContext("2d");
      tc.fillStyle = "#fff"; tc.fillRect(0, 0, t.width, t.height);
      tc.globalCompositeOperation = "destination-in";
      tc.drawImage(src, 0, 0, t.width, t.height);
      ctx.drawImage(t, (w - dw) / 2, (h - dh) / 2);
    } else {
      for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { ctx.fillStyle = (x + y) % 8 ? "#fff" : "#ddd"; ctx.fillRect(x, y, 4, 4); }
      ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
      thumbs.set(key, PS.clone(c));
    }
    return c;
  };
  // the thumbnail shows the layer inside the picture's frame, like Photoshop
  const layerThumb = (l) => {
    const d = doc();
    if (!l._thumbFor || l._thumbFor.canvas !== l.canvas || l._thumbFor.w !== d.w || l._thumbFor.h !== d.h || l._thumbFor.x !== l.x || l._thumbFor.y !== l.y) {
      const frame = PS.canvas(Math.min(d.w, 400), Math.min(d.h, 400) * (d.h / d.w > 1 ? 1 : d.h / d.w) || 1);
      const s = Math.min(frame.width / d.w, frame.height / d.h);
      const f = PS.canvas(Math.max(1, d.w * s), Math.max(1, d.h * s));
      f.getContext("2d").drawImage(l.canvas, l.x * s, l.y * s, l.canvas.width * s, l.canvas.height * s);
      l._thumbFor = { canvas: l.canvas, w: d.w, h: d.h, x: l.x, y: l.y, frame: f };
    }
    return thumb(l._thumbFor.frame);
  };
  const maskThumb = (l) => {
    const d = doc();
    const f = PS.canvas(Math.max(1, Math.min(d.w, 300)), Math.max(1, Math.min(d.w, 300) * d.h / d.w));
    const s = f.width / d.w, fc = f.getContext("2d");
    fc.fillStyle = "#fff";
    fc.fillRect(0, 0, f.width, f.height);
    fc.clearRect(l.x * s, l.y * s, l.mask.width * s, l.mask.height * s);
    fc.drawImage(l.mask, l.x * s, l.y * s, l.mask.width * s, l.mask.height * s);
    return thumb(f, 36, 28, true);
  };

  let dragLayer = null;
  const ADJ_ICON = (t) => (ADJ.find((x) => x[0] === t) || ADJ[0])[2];
  const pick = (d, l, e) => { // clicking a layer: Ctrl adds/removes it, Shift picks a range, otherwise just this one
    const rows = [...layersEl.querySelectorAll(".ps-layer")].map((r) => +r.dataset.id);
    let picked = d.picked && d.picked.length ? [...d.picked] : [d.active];
    if (e.ctrlKey || e.metaKey) picked = picked.includes(l.id) ? picked.filter((x) => x !== l.id) : [...picked, l.id];
    else if (e.shiftKey && d.active) {
      const i = rows.indexOf(d.active), j = rows.indexOf(l.id);
      picked = rows.slice(Math.min(i, j), Math.max(i, j) + 1);
    } else picked = [l.id];
    if (!picked.length) picked = [l.id];
    d.picked = picked;
    d.active = picked.includes(l.id) ? l.id : picked[picked.length - 1];
  };
  const drawLayers = () => {
    const d = doc(), l0 = PS.active();
    layersEl.innerHTML = "";
    $("psBlend").disabled = $("psOpacity").disabled = !l0;
    $("psFill").disabled = !l0 || !PS.isPixels(l0);
    if (!d) return;
    if (!d.picked || !d.picked.length || !d.picked.includes(d.active)) d.picked = d.active ? [d.active] : [];
    const blendOpts = (l0 && PS.isGroup(l0) ? [["pass", "Pass Through"]] : []).concat(BLEND_OPTS);
    $("psBlend").innerHTML = blendOpts.map(([v, t]) => (v === "-" ? "<option disabled>──────────</option>" : `<option value="${v}">${t}</option>`)).join("");
    if (l0) { $("psBlend").value = l0.blend; $("psOpacity").value = l0.opacity; $("psFill").value = l0.fill; }
    $("psLockPos").classList.toggle("on", !!(l0 && l0.locked));
    const hidden = (l) => { for (let p = PS.parentOf(l); p; p = PS.parentOf(p)) if (p.open === false) return true; return false; };
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i];
      if (hidden(l)) continue;
      const dep = PS.depth(l), on = d.picked.includes(l.id);
      const kind = PS.isGroup(l) ? "group" : PS.isAdj(l) ? "adj" : PS.isText(l) ? "type" : "";
      const row = el(`<div class="ps-layer ${on ? "on" : ""} ${l.locked && l.name === "Background" ? "bgl" : ""} ${kind === "group" ? "grp" : ""}" data-id="${l.id}">
        <button class="eye ${l.visible ? "" : "off"}" title="Indicates layer visibility">${I.eye}</button>
        <span class="ind" style="width:${dep * 16}px"></span>
        ${kind === "group" ? `<button class="twist ${l.open !== false ? "open" : ""}" title="Show or hide the layers in this group"></button>` : ""}
        <span class="th ${kind} ${l.id === d.active && !d.maskEdit ? "sel" : ""}" title="${kind === "adj" ? "Adjustment settings" : "Layer thumbnail"}">${kind === "type" ? "T" : kind === "group" ? I.group : kind === "adj" ? svg(ADJ_ICON(l.adj.type)) : ""}</span>
        ${l.mask ? `<span class="link">${l.maskOn ? "⛓" : "✕"}</span><span class="th mask ${l.id === d.active && d.maskEdit ? "sel" : ""}" title="Layer mask thumbnail"></span>` : ""}
        <span class="nm">${esc(l.name)}</span>
        ${l.fx && ((l.fx.stroke && l.fx.stroke.on) || (l.fx.shadow && l.fx.shadow.on)) ? '<span class="fxb" title="Layer effects">fx</span>' : ""}
        ${l.locked ? `<span class="lk">${I.lockSm}</span>` : ""}
      </div>`);
      if (!kind) row.querySelector(".th").append(layerThumb(l));
      if (l.mask) { const mt = row.querySelector(".th.mask"); mt.style.background = "#000"; mt.append(maskThumb(l)); }
      row.querySelector(".twist")?.addEventListener("click", (e) => { e.stopPropagation(); l.open = l.open === false; drawLayers(); });
      row.querySelector(".eye").addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.altKey) { // Alt+click: show only this layer
          const solo = d.layers.every((x) => x === l || !x.visible || PS.isGroup(x));
          d.layers.forEach((x) => { if (!PS.isGroup(x)) x.visible = solo ? true : x === l; });
          for (let p = PS.parentOf(l); p; p = PS.parentOf(p)) p.visible = true;
        } else l.visible = !l.visible;
        PS.commit(l.visible ? "Show Layer" : "Hide Layer");
      });
      row.querySelector(".th").addEventListener("click", (e) => {
        if (e.ctrlKey && PS.isPixels(l)) { e.stopPropagation(); PS.setSel(PS.selFromLayer(l), "Load Selection"); }
        else if (kind === "adj") { e.stopPropagation(); d.active = l.id; d.picked = [l.id]; d.maskEdit = false; showPanel("props"); PS.changed(); }
      });
      row.querySelector(".th.mask")?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.shiftKey) return PS.maskAction("toggle");
        d.active = l.id; d.picked = [l.id]; d.maskEdit = true; PS.changed();
      });
      row.addEventListener("click", (e) => {
        if (e.target.closest("input")) return;
        if (PS.typing) PS.endTyping(true);
        pick(d, l, e);
        d.maskEdit = false;
        PS.changed();
      });
      row.querySelector(".nm").addEventListener("dblclick", (e) => { e.stopPropagation(); rename(l, row.querySelector(".nm")); });
      row.querySelector(".th").addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (PS.isText(l)) { PS.setTool("type"); d.active = l.id; PS.startTyping(l, false); }
        else if (l.locked && l.name === "Background") unlockBg(l);
      });
      row.addEventListener("dblclick", (e) => {
        if (e.target.closest(".nm, .th, .eye, .twist")) return;
        if (l.locked && l.name === "Background") unlockBg(l); else if (PS.isPixels(l)) { d.active = l.id; PS.styleDialog("stroke"); }
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (!d.picked.includes(l.id)) { d.active = l.id; d.picked = [l.id]; }
        PS.changed();
        PS.contextMenu([
          ["Layer Style...", "", () => PS.styleDialog("stroke"), () => PS.isPixels(l)], ["Clear Layer Style", "", () => PS.clearStyle(), () => !!l.fx],
          ["-"], ["Duplicate Layer...", "", () => PS.duplicateAny(), () => true], ["Delete Layer", "", () => PS.deleteLayer(), () => true],
          ["Group from Layers...", "Ctrl+G", () => PS.newGroup(true), () => true], ["Ungroup Layers", "Shift+Ctrl+G", () => PS.ungroup(), () => PS.isGroup(l)],
          ["-"], ["Rasterize Type", "", () => { PS.rasterize(l, true); PS.commit("Rasterize Type"); }, () => PS.isText(l)],
          ["Warp Text...", "", () => PS.warpDialog(), () => PS.isText(l)],
          ["Remove Background", "", () => PS.removeBackground(), () => l.kind === "pixel", null, true],
          ["-"], [d.picked.length > 1 ? "Merge Layers" : PS.isGroup(l) ? "Merge Group" : "Merge Down", "Ctrl+E", () => PS.mergeDown(), () => true],
          ["Merge Visible", "Shift+Ctrl+E", () => PS.mergeVisible(), () => true], ["Flatten Image", "", () => PS.flatten(), () => true],
        ], e.clientX, e.clientY);
      });
      // drag to reorder, or onto a group to put it inside
      row.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".eye, input, .twist")) return;
        dragLayer = { l, y: e.clientY, moved: false };
      });
      layersEl.append(row);
    }
  };
  const rowUnder = (y) => [...layersEl.querySelectorAll(".ps-layer")].find((r) => { const b = r.getBoundingClientRect(); return y >= b.top && y < b.bottom; });
  const dropSpot = (r, y) => {
    const b = r.getBoundingClientRect(), t = doc().layers.find((x) => x.id === +r.dataset.id);
    if (PS.isGroup(t) && y > b.top + b.height * 0.3 && y < b.bottom - b.height * 0.3) return "into";
    return y < b.top + b.height / 2 ? "above" : "below";
  };
  window.addEventListener("pointermove", (e) => {
    if (!dragLayer) return;
    if (!dragLayer.moved && Math.abs(e.clientY - dragLayer.y) < 5) return;
    dragLayer.moved = true;
    layersEl.querySelectorAll(".drop-above, .drop-below, .drop-into").forEach((r) => r.classList.remove("drop-above", "drop-below", "drop-into"));
    const r = rowUnder(e.clientY);
    if (r) r.classList.add("drop-" + dropSpot(r, e.clientY));
  });
  window.addEventListener("pointerup", (e) => {
    if (!dragLayer) return;
    const g = dragLayer;
    dragLayer = null;
    layersEl.querySelectorAll(".drop-above, .drop-below, .drop-into").forEach((r) => r.classList.remove("drop-above", "drop-below", "drop-into"));
    if (!g.moved) return;
    const r = rowUnder(e.clientY), d = doc();
    if (!r) return;
    const target = d.layers.find((x) => x.id === +r.dataset.id);
    if (!target || target === g.l || (g.l.locked && g.l.name === "Background")) return;
    let where = dropSpot(r, e.clientY);
    // below an open group's row is the top of that group
    if (where === "below" && PS.isGroup(target) && target.open !== false) where = "into";
    PS.place(g.l, target, where);
  });
  const rename = (l, nm) => {
    nm.innerHTML = "";
    const i = el(`<input type="text" value="${esc(l.name)}">`);
    nm.append(i);
    i.focus();
    i.select();
    const done = (ok) => { if (ok && i.value.trim() && i.value !== l.name) { l.name = i.value.trim(); l.autoName = false; PS.commit("Rename Layer"); } else drawLayers(); };
    i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    i.addEventListener("blur", () => done(true));
  };
  PS.renameActive = () => { const r = layersEl.querySelector(".ps-layer.on .nm"); if (r) rename(PS.active(), r); };
  const unlockBg = (l) => { l.locked = false; l.name = "Layer 0"; PS.commit("Convert to Layer"); };

  // ---------------------------------------------------------------- documents: tabs, status bar, home screen
  const tabsEl = $("psDocTabs"), statusEl = $("psStatus"), homeEl = $("psHome");
  const zoomText = (z) => (Math.round(z * 10000) / 100).toString();
  const drawTabs = () => {
    tabsEl.innerHTML = "";
    for (const d of PS.docs) {
      const l = d.layers.find((x) => x.id === d.active);
      const t = el(`<div class="ps-doctab ${d === PS.doc ? "on" : ""}" title="${esc(d.name)}"><span>${esc(d.name)} @ ${d.view ? zoomText(d.view.zoom) : 100}% (${esc(l ? l.name : "")}, RGB/8)${d.saved ? "" : "*"}</span><button class="x" title="Close">${I.x}</button></div>`);
      t.addEventListener("mousedown", (e) => { if (!e.target.closest(".x")) PS.switchDoc(d); });
      t.querySelector(".x").addEventListener("click", () => PS.closeDoc(d));
      tabsEl.append(t);
    }
  };
  let pointerText = "";
  const drawStatus = () => {
    const d = doc();
    statusEl.innerHTML = "";
    if (!d) return;
    const z = el(`<input type="text" value="${zoomText(d.view ? d.view.zoom : 1)}%">`);
    z.addEventListener("change", () => { const v = parseFloat(z.value); if (v > 0) PS.setZoom(v / 100); });
    z.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") z.blur(); });
    statusEl.append(z, el(`<span>${d.w} px × ${d.h} px (72 ppi)</span>`), el(`<span id="psPointer">${pointerText}</span>`), el(`<span class="hint">${esc(hint())}</span>`));
  };
  const hint = () => {
    if (PS.xf) return "Drag a corner to resize (Shift: free) · Drag outside to rotate · Enter to commit";
    return {
      move: "Drag to move · Alt+drag to copy · Arrow keys nudge", marquee: "Shift adds, Alt subtracts · Shift while dragging for a square",
      ellipse: "Shift adds, Alt subtracts · Shift while dragging for a circle", lasso: "Drag around an area", polylasso: "Click points · Double-click to close",
      objsel: "Drag a box around an object, or click to select the subject", wand: "Click a color to select it", crop: "Drag the handles · Enter to crop",
      eyedropper: "Click to pick a color · Alt for background", brush: "[ and ] change the size · Shift+click draws a line · Alt picks a color",
      eraser: "[ and ] change the size", gradient: "Drag to draw the gradient · Shift for straight lines", bucket: "Click to fill similar colors",
      type: "Click to add text, or click text to edit it · Ctrl+Enter to commit", rect: "Drag to draw · Shift for a square", ellipseShape: "Drag to draw · Shift for a circle",
      hand: "Drag to move around", zoom: "Click to zoom in · Alt+click to zoom out",
      clone: "Alt+click to set the source, then paint", heal: "Alt+click to set the source, then paint over what to fix", spotheal: "Paint over a spot or blemish",
    }[PS.tool] || "";
  };
  PS.onPointer = (p) => {
    pointerText = `X: ${Math.floor(p.x)}  Y: ${Math.floor(p.y)}`;
    const s = document.getElementById("psPointer");
    if (s) s.textContent = pointerText;
  };
  PS.onZoom = () => { drawTabs(); drawStatus(); };
  const PRESETS = [
    ["YouTube Thumbnail", 1280, 720], ["Full HD", 1920, 1080], ["Shorts / TikTok", 1080, 1920], ["Instagram Post", 1080, 1080],
    ["Channel Banner", 2560, 1440], ["4K", 3840, 2160], ["Profile Picture", 800, 800], ["Twitter / X Header", 1500, 500],
  ];
  PS.PRESETS = PRESETS;
  PS.presetShape = (w, h) => { const s = 54 / Math.max(w, h); return `<i style="width:${Math.max(8, w * s)}px;height:${Math.max(8, h * s)}px"></i>`; };
  const drawHome = () => {
    homeEl.hidden = !!doc();
    if (doc()) return;
    homeEl.innerHTML = `<h1>Welcome to the Editor</h1><p>Make thumbnails, cut people out, add text. It works like Photoshop: same tools, same shortcuts.</p>
      <div class="acts"></div><h2>Start with a size</h2><div class="ps-presets"></div>
      <div class="drop">Drop pictures or .psd files here to open them, or paste one with Ctrl+V</div>`;
    const acts = homeEl.querySelector(".acts");
    acts.append(ctl.btn("New file", () => PS.newDialog(), "blue"), ctl.btn("Open", () => PS.openFiles()));
    const list = homeEl.querySelector(".ps-presets");
    for (const [name, w, h] of PRESETS) {
      const b = el(`<button class="ps-preset"><span class="shape">${PS.presetShape(w, h)}</span><b>${name}</b><span>${w} × ${h} px</span></button>`);
      b.onclick = () => PS.createDoc(name === "YouTube Thumbnail" ? "Thumbnail" : name, w, h, "#ffffff");
      list.append(b);
    }
  };
  PS.switchDoc = (d) => {
    if (PS.doc === d) return;
    if (PS.typing) PS.endTyping(true);
    if (PS.xf) PS.endTransform(true);
    PS.doc = d;
    if (T[PS.tool].activate) T[PS.tool].activate();
    PS.changed();
  };
  PS.createDoc = (name, w, h, bg) => {
    const d = PS.newDoc(name, w, h, bg);
    PS.doc = null;
    PS.switchDoc(d);
    PS.commit(bg === "transparent" ? "New" : "New");
    d.hist[0].name = "New";
    d.saved = true;
    PS.changed();
    return d;
  };
  PS.closeDoc = (d, force) => {
    if (!d) return;
    if (!d.saved && !force) return PS.askSave(d);
    if (PS.doc === d) { if (PS.typing) PS.endTyping(false); if (PS.xf) PS.endTransform(false); }
    const i = PS.docs.indexOf(d);
    PS.docs.splice(i, 1);
    if (PS.doc === d) PS.doc = PS.docs[Math.min(i, PS.docs.length - 1)] || null;
    if (PS.doc && T[PS.tool].activate) T[PS.tool].activate();
    PS.changed();
  };
  PS.closeAll = () => { for (const d of [...PS.docs]) { if (!d.saved) { PS.switchDoc(d); return PS.askSave(d, true); } PS.closeDoc(d); } };

  // ---------------------------------------------------------------- rulers and panels on/off
  let rulersOn = false;
  const toggleRulers = () => { rulersOn = !rulersOn; $("psStage").classList.toggle("rulers", rulersOn); requestAnimationFrame(() => PS.drawNow()); };
  const togglePanels = () => { $("psWork").classList.toggle("no-panels"); requestAnimationFrame(() => PS.drawNow()); };
  PS.drawRulers = () => {
    if (!rulersOn || !doc()) return;
    const v = doc().view, dpr = devicePixelRatio || 1;
    for (const [id, horiz] of [["psRulerTop", true], ["psRulerLeft", false]]) {
      const c = $(id), W = c.clientWidth, H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr;
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#2b2b2b"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#777"; ctx.fillStyle = "#9a9a9a"; ctx.font = "9px Segoe UI, sans-serif"; ctx.lineWidth = 1;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      const step = steps.find((s) => s * v.zoom >= 50) || 5000;
      const len = horiz ? W : H, off = horiz ? v.x : v.y;
      const first = Math.floor(-off / v.zoom / step) * step;
      ctx.beginPath();
      for (let u = first; u * v.zoom + off < len; u += step / 10) {
        const pos = Math.round(u * v.zoom + off) + 0.5;
        const major = Math.abs(u / step - Math.round(u / step)) < 1e-6;
        const tick = major ? 18 : (Math.abs((u / (step / 2)) - Math.round(u / (step / 2))) < 1e-6 ? 8 : 4);
        if (horiz) { ctx.moveTo(pos, 18); ctx.lineTo(pos, 18 - tick); if (major) ctx.fillText(String(Math.round(u)), pos + 3, 9); }
        else { ctx.moveTo(18, pos); ctx.lineTo(18 - tick, pos); if (major) { ctx.save(); ctx.translate(9, pos + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(u)), -ctx.measureText(String(Math.round(u))).width - 3, 0); ctx.restore(); } }
      }
      ctx.stroke();
    }
  };

  // ---------------------------------------------------------------- everything catches up after a change
  let panelsPending = false;
  PS.onChange = () => {
    if (panelsPending) return;
    panelsPending = true;
    requestAnimationFrame(() => {
      panelsPending = false;
      drawTabs(); drawStatus(); drawHome(); drawLayers();
      if (skipMid) skipMid = false; else if (!PS.typing || midTab !== "props") drawMid();
      if (PS.tool === "type" && !PS.typing) drawOptions();
    });
  };

  // ---------------------------------------------------------------- typing (the Type tool)
  PS.startTyping = (l, isNew) => {
    PS.endTyping && PS.typing && PS.endTyping(true);
    const ta = el('<textarea class="ps-type" spellcheck="false"></textarea>');
    PS.typing = { l, isNew, ta };
    ta.value = l.text.str;
    PS.viewEl.append(ta);
    PS.placeTyping();
    ta.addEventListener("input", () => {
      l.text = { ...l.text, str: ta.value };
      if (l.autoName) l.name = ta.value.split("\n")[0].slice(0, 40) || "Layer";
      PS.placeTyping();
      PS.changed();
    });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); PS.endTyping(false); }
      if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); PS.endTyping(true); }
    });
    ta.focus();
    if (!isNew) ta.select();
    setTimeout(() => { if (PS.typing && PS.typing.ta === ta && document.activeElement !== ta) ta.focus(); }, 0);
    PS.changed();
    drawOptions();
  };
  PS.placeTyping = () => {
    const g = PS.typing;
    if (!g) return;
    const { l, ta } = g, t = l.text, z = doc().view.zoom;
    PS.syncText(l);
    const m = PS.canvas(1, 1).getContext("2d");
    m.font = PS.fontCss(t);
    const mt = m.measureText("Hg");
    const fa = mt.fontBoundingBoxAscent || t.size * 0.9, fd = mt.fontBoundingBoxDescent || t.size * 0.22;
    const lh = t.size * (t.leading || 1.2);
    const base = (lh - (fa + fd)) / 2 + fa;
    const w = (l._box.w + t.size) * z;
    const a = PS.toScreen(t.x, t.y);
    const left = t.align === "center" ? a.x - w / 2 : t.align === "right" ? a.x - w + (t.size / 2) * z : a.x;
    Object.assign(ta.style, {
      left: left + "px", top: a.y - base * z + "px", width: w + "px", height: (lh * t.str.split("\n").length) * z + 4 + "px",
      font: `${t.italic ? "italic " : ""}${t.bold ? 700 : 400} ${t.size * z}px/${lh * z}px "${t.font}", sans-serif`,
      textAlign: t.align, color: "transparent", caretColor: t.color, transformOrigin: `${a.x - left}px ${base * z}px`,
      transform: t.angle ? `rotate(${t.angle}deg)` : "",
    });
  };
  PS.endTyping = (keep) => {
    const g = PS.typing;
    if (!g) return;
    PS.typing = null;
    g.ta.remove();
    const d = doc();
    if (!keep) { PS.goto(d.hi); drawOptions(); return; }
    if (!g.l.text.str.trim()) {
      d.layers = d.layers.filter((x) => x !== g.l);
      if (d.active === g.l.id) d.active = (d.layers[d.layers.length - 1] || {}).id;
      if (g.isNew) { PS.changed(); drawOptions(); return; }
      PS.commit("Delete Layer");
    } else PS.commit(g.isNew ? "Type Layer" : "Edit Type Layer");
    drawOptions();
  };
  PS.nudgeType = (dz) => { const l = PS.active(); if (PS.isText(l)) { setType("size", Math.max(1, l.text.size + dz)); drawOptions(); } };

  // ---------------------------------------------------------------- keyboard
  const keyName = (e) => {
    const c = e.code;
    if (c.startsWith("Key")) return c.slice(3).toLowerCase();
    if (c.startsWith("Digit")) return c.slice(5);
    if (c.startsWith("Numpad") && /\d$/.test(c)) return c.slice(-1);
    return { BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", NumpadAdd: "=", NumpadSubtract: "-", Period: ".", Comma: ",", Quote: "'", Semicolon: ";" }[c] || e.key.toLowerCase();
  };
  const editorVisible = () => !document.getElementById("editorTab").hidden;
  const BRUSH_STEPS = (s, dir) => {
    const inc = s < 10 ? 1 : s < 100 ? 10 : s < 200 ? 25 : s < 300 ? 50 : 100;
    return PS.clamp(dir > 0 ? s + inc : s - (s <= 10 ? 1 : s <= 100 ? 10 : s <= 200 ? 25 : s <= 300 ? 50 : 100), 1, 1000);
  };
  window.addEventListener("keydown", (e) => {
    if (!editorVisible()) return;
    if (document.querySelector(".modal:not([hidden])") && [...document.querySelectorAll(".modal:not([hidden])")].some((m) => m.getClientRects().length)) return;
    const t = e.target;
    const dlg = root.querySelector(".ps-dlg-back");
    if (dlg) { // a dialog is open: Enter is OK, Esc is Cancel
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); dlg.querySelector("[data-cancel]")?.click(); }
      else if (e.key === "Enter" && !(t && t.tagName === "TEXTAREA")) { e.preventDefault(); e.stopImmediatePropagation(); dlg.querySelector("[data-ok]")?.click(); }
      return;
    }
    if (t && t.matches && t.matches("input, textarea, select, [contenteditable]")) return;
    const k = keyName(e);
    const combo = [e.ctrlKey || e.metaKey ? "ctrl" : "", e.altKey ? "alt" : "", e.shiftKey ? "shift" : "", k].filter(Boolean).join("+");
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

    if (k === "escape") {
      closeMenus(); closeFlyouts();
      if (PS.xf) { stop(); return PS.endTransform(false); }
      if (PS.tool === "crop") { stop(); return T.crop.cancel(); }
      if (PS.tool === "polylasso" && T.polylasso.busy()) { stop(); return T.polylasso.cancel(); }
      return;
    }
    if (k === "enter") {
      if (PS.xf) { stop(); return PS.endTransform(true); }
      if (PS.tool === "crop" && doc()) { stop(); return T.crop.commit(); }
      if (PS.tool === "polylasso") { stop(); return T.polylasso.finish(); }
    }
    if (k === " " || e.code === "Space") { stop(); if (!e.repeat) PS.space(true); return; }
    if (combo === "tab") { stop(); return togglePanels(); }
    if (shortcuts[combo]) {
      stop();
      const it = shortcuts[combo];
      if (!it[3] || it[3]()) it[2]();
      return;
    }
    if (combo === "ctrl+shift+=" || combo === "ctrl+=") { stop(); return has() && PS.stepZoom(1); }
    if (combo === "ctrl+alt+0") { stop(); return has() && PS.setZoom(1); }
    if ((combo === "delete" || combo === "backspace") && doc()) { stop(); return PS.clearSel(); }
    if ((combo === "alt+backspace" || combo === "alt+delete") && doc()) { stop(); return PS.fillWith(PS.fg, "Fill"); }
    if ((combo === "ctrl+backspace" || combo === "ctrl+delete") && doc()) { stop(); return PS.fillWith(PS.bg, "Fill"); }
    if (e.ctrlKey || e.metaKey || e.altKey) { if (e.ctrlKey && ["r", "0", "=", "-"].includes(k)) stop(); return; }
    // one-key shortcuts
    if (k === "x") { stop(); return swapColors(); }
    if (k === "d") { stop(); return defaultColors(); }
    if (k === "[" || k === "]") {
      stop();
      const o = opt[PS.tool === "eraser" ? "eraser" : "brush"];
      if (e.shiftKey) o.hard = PS.clamp(o.hard + (k === "]" ? 25 : -25), 0, 100);
      else o.size = BRUSH_STEPS(o.size, k === "]" ? 1 : -1);
      drawOptions(); PS.draw();
      return;
    }
    if (/^[0-9]$/.test(k)) { // opacity, like Photoshop: 1 = 10% ... 0 = 100%
      stop();
      const v = k === "0" ? 100 : +k * 10;
      const o = opt[PS.tool];
      if (o && "opacity" in o) { o.opacity = v; drawOptions(); }
      else if (PS.active()) { PS.active().opacity = v; PS.commit("Opacity Change"); }
      return;
    }
    if (k.startsWith("arrow") && PS.tool === "move" && PS.active() && !PS.active().locked) {
      stop();
      const n = e.shiftKey ? 10 : 1;
      PS.moveLayer(PS.active(), k === "arrowleft" ? -n : k === "arrowright" ? n : 0, k === "arrowup" ? -n : k === "arrowdown" ? n : 0);
      return PS.commit("Nudge");
    }
    // tool letters (Shift+letter goes through the tools that share it)
    const ids = Object.keys(T).filter((id) => T[id].key.toLowerCase() === k);
    if (ids.length && !PS.typing) {
      stop();
      if (ids.includes(PS.tool) && e.shiftKey) PS.setTool(ids[(ids.indexOf(PS.tool) + 1) % ids.length]);
      else if (!ids.includes(PS.tool)) {
        const g = GROUPS.find((x) => Array.isArray(x) && x.includes(ids[0]));
        PS.setTool(groupShown[g[0]] || ids[0]);
      }
    }
  }, true);
  window.addEventListener("keyup", (e) => { if (e.code === "Space" && editorVisible()) PS.space(false); }, true);
  window.addEventListener("blur", () => PS.space(false));
  new ResizeObserver(() => PS.drawNow()).observe(PS.viewEl);

  // ---------------------------------------------------------------- start
  drawTools();
  drawOptions();
  drawColorPanel();
  PS.onChange();
})();
