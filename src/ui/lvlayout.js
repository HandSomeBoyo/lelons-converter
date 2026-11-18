// (2.34.0) Customize the Live console: move cards, make them wider or narrower, take them off or add them back.
// The console is one 12-column grid (#lvGrid). Each card says how many columns it takes; their height is
// measured, so cards of different heights pack together like bricks. Remembered on this PC (pref lvLayout).
// Uses $, loadPref/savePref from app.js, LV and lvDrawConsole() from livecon.js.

const LV_CARDS = [
  { id: "info", name: "Title & game", desc: "Your Twitch title, game and tags, and a button to change them.", w: 12 },
  { id: "nums", name: "Numbers", desc: "Watching now, most this stream, chat speed, followers and subs.", w: 12 },
  { id: "preview", name: "Preview", desc: "Your stream with sound, the way viewers see it.", w: 8 },
  { id: "chat", name: "Chat", desc: "Twitch and YouTube chat, with writing and mod tools.", w: 4 },
  { id: "ads", name: "Ad timer", desc: "When your next Twitch ad comes, and run or snooze it at a good moment.", w: 4 },
  { id: "graph", name: "Watching graph", desc: "Viewers over time, with raids marked.", w: 8 },
  { id: "health", name: "Stream health", desc: "Upload speed, dropped frames, CPU, graphics card and recording.", w: 8 },
  { id: "multi", name: "Multistream", desc: "Send your stream to Twitch, YouTube, Kick and TikTok at once, with an upload check.", w: 8 },
  { id: "goals", name: "Goals", desc: "Goals for this stream, with progress bars.", w: 4 },
  { id: "events", name: "What happened", desc: "Follows, subs, raids and Super Chats as they come in.", w: 4 },
  { id: "obs", name: "OBS", desc: "OBS's live picture, scene buttons, sound meters, recording and replays.", w: 8 },
  { id: "clips", name: "Clips", desc: "Clip the last moments with one button or a hotkey, even in a game.", w: 4 },
  { id: "modes", name: "Chat modes", desc: "Slow mode, followers-only, emote-only, subs-only and Shield Mode.", w: 4 },
  { id: "newbies", name: "New chatters", desc: "People chatting for the very first time, so you can welcome them.", w: 4 },
  { id: "gamedetect", name: "Game auto-detect", desc: "Your Twitch game changes by itself to the game you're playing.", w: 4 },
  { id: "earn", name: "Earnings", desc: "A rough estimate of what this stream and this month made from subs, bits and ads.", w: 4 },
  { id: "mic", name: "Mic sound", desc: "Pro mic filters in OBS with one click: less noise, even volume, no clipping.", w: 4 },
  { id: "costream", name: "Co-stream", desc: "Streaming with friends? See their Twitch chats in your Chat card, mixed in or side by side.", w: 4 },
];
const LV_CARD = Object.fromEntries(LV_CARDS.map((c) => [c.id, c]));
const LV_WIDTHS = [3, 4, 5, 6, 7, 8, 9, 12];
const LV_CHAT_HEIGHTS = { s: "Short", m: "Medium", l: "Tall" };
const LV_ROW = 4;  // px per grid row (the bricks are measured in these)
const LV_GAP = 16;
const LVL = { editing: false, observer: null, drag: null, redraws: null, toolsSoon: 0 };
const LVL_ICONS = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  less: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h5M15 12h5M7 9l3 3-3 3M17 9l-3 3 3 3"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  height: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

function lvLayout() {
  const saved = loadPref("lvLayout") || {};
  const known = Array.isArray(saved.known) ? saved.known : null;
  let order = Array.isArray(saved.order) ? saved.order.filter((id, i, all) => LV_CARD[id] && all.indexOf(id) === i) : LV_CARDS.map((c) => c.id);
  const off = Array.isArray(saved.off) ? saved.off.filter((id) => LV_CARD[id]) : [];
  // Cards that came with an update show up once, where they'd be in a fresh layout.
  for (const c of LV_CARDS) {
    if (!order.includes(c.id) && !off.includes(c.id) && (!known || !known.includes(c.id))) order.splice(LV_CARDS.indexOf(c), 0, c.id);
  }
  order = order.filter((id) => !off.includes(id));
  return { order, off, w: saved.w || {}, chatH: LV_CHAT_HEIGHTS[saved.chatH] ? saved.chatH : "l" };
}
function lvLayoutSave(l) {
  savePref("lvLayout", { order: l.order, off: l.off, w: l.w, chatH: l.chatH, known: LV_CARDS.map((c) => c.id) });
}
function lvWidth(l, id) { const w = +l.w[id]; return LV_WIDTHS.includes(w) ? w : LV_CARD[id].w; }
const lvSlot = (id) => document.querySelector(`#lvGrid > [data-c="${id}"]`);

// Called when the console is built: put the cards in place and keep their heights measured.
function lvLayoutInit() {
  if (LVL.observer) LVL.observer.disconnect();
  LVL.observer = new ResizeObserver((entries) => { for (const e of entries) lvFit(e.target); });
  for (const el of $("lvGrid").children) LVL.observer.observe(el);
  // (2.43.1) Cards draw themselves again with each update, which took their Customize bar (dots, sizes,
  // X) away after a second or two. Put it back whenever a card redraws while customizing.
  if (LVL.redraws) LVL.redraws.disconnect();
  LVL.redraws = new MutationObserver(() => {
    if (!LVL.editing || LVL.toolsSoon) return;
    LVL.toolsSoon = requestAnimationFrame(() => {
      LVL.toolsSoon = 0;
      const grid = $("lvGrid");
      if (LVL.editing && grid && [...grid.children].some((el) => LV_CARD[el.dataset.c] && !el.querySelector(":scope > .lv-tools"))) lvDrawLayoutTools(lvLayout());
    });
  });
  for (const el of $("lvGrid").children) LVL.redraws.observe(el, { childList: true });
  $("lvcReset").onclick = () => { savePref("lvLayout", {}); lvLayoutApply(true); };
  lvLayoutApply();
  if (LVL.editing) lvLayoutEdit(true);
}

// How many 4px rows a card needs (its own height plus the gap below it).
function lvFit(el) {
  const h = el.getBoundingClientRect().height;
  el.style.gridRowEnd = h ? `span ${Math.max(1, Math.ceil((h + LV_GAP) / LV_ROW))}` : "";
}

function lvLayoutApply(animate) {
  const grid = $("lvGrid");
  if (!grid) return;
  const l = lvLayout();
  const move = () => {
    for (const id of l.order) { const el = lvSlot(id); if (el) grid.append(el); }
    for (const c of LV_CARDS) {
      const el = lvSlot(c.id);
      if (!el) continue;
      if (!l.order.includes(c.id)) grid.append(el);
      el.classList.toggle("lv-off", !l.order.includes(c.id));
      el.style.setProperty("--w", lvWidth(l, c.id));
    }
    grid.dataset.chat = l.chatH;
  };
  if (animate) lvFlip(move); else move();
  for (const el of grid.children) lvFit(el);
  if (LVL.editing) lvDrawLayoutTools(l);
}

// ---------------------------------------------------------------- Customize mode

function lvLayoutEdit(on) {
  LVL.editing = on;
  const grid = $("lvGrid");
  if (!grid) return;
  grid.classList.toggle("lv-editing", on);
  $("lvCbar").hidden = !on;
  if (!on) {
    if (LVL.drag) lvDragEnd();
    grid.querySelectorAll(".lv-tools").forEach((t) => t.remove());
    const tray = $("lvTray");
    if (tray) tray.remove();
  }
  try { lvLayoutApply(); } catch (e) { console.error(e); }  // (a card that fails to fit must not keep you stuck in Customize)
  if (on) $("lvCbar").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function lvToolButton(icon, title, onclick, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lv-tool " + cls;
  b.innerHTML = icon;
  b.title = title;
  b.onclick = onclick;
  return b;
}

function lvDrawLayoutTools(l) {
  for (const c of LV_CARDS) {
    const el = lvSlot(c.id);
    if (!el) continue;
    let tools = el.querySelector(":scope > .lv-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "lv-tools";
      el.prepend(tools);
    }
    const w = lvWidth(l, c.id), i = LV_WIDTHS.indexOf(w);
    const grip = lvToolButton(LVL_ICONS.grip, "Drag to move", null, "grip");
    grip.addEventListener("pointerdown", (e) => lvDragStart(e, el));
    const name = document.createElement("span");
    name.className = "lv-tool-name";
    name.textContent = c.name;
    const parts = [grip, name, document.createElement("i")];
    parts[2].className = "sp";
    const less = lvToolButton(LVL_ICONS.less, "Narrower", () => lvLayoutChange((x) => { x.w[c.id] = LV_WIDTHS[Math.max(0, i - 1)]; }));
    const more = lvToolButton(LVL_ICONS.more, "Wider", () => lvLayoutChange((x) => { x.w[c.id] = LV_WIDTHS[Math.min(LV_WIDTHS.length - 1, i + 1)]; }));
    less.disabled = i <= 0;
    more.disabled = i >= LV_WIDTHS.length - 1;
    const size = document.createElement("span");
    size.className = "lv-tool-size";
    size.textContent = w === 12 ? "Full" : `${Math.round(w / 12 * 100)}%`;
    parts.push(less, size, more);
    if (c.id === "chat") {
      const keys = Object.keys(LV_CHAT_HEIGHTS);
      parts.push(lvToolButton(LVL_ICONS.height, `Height: ${LV_CHAT_HEIGHTS[l.chatH]} (click to change)`,
        () => lvLayoutChange((x) => { x.chatH = keys[(keys.indexOf(x.chatH) + 1) % keys.length]; }), "tall"));
    }
    parts.push(lvToolButton(LVL_ICONS.x, "Take it off", () => lvLayoutChange((x) => { x.order = x.order.filter((id) => id !== c.id); x.off.push(c.id); }), "x"));
    tools.replaceChildren(...parts);
  }
  // The tray: cards you took off, to add back.
  let tray = $("lvTray");
  const off = LV_CARDS.filter((c) => !l.order.includes(c.id));
  if (!tray) {
    tray = document.createElement("div");
    tray.id = "lvTray";
    tray.className = "lv-tray";
    $("lvGrid").after(tray);
  }
  tray.innerHTML = `<h3>Add a card</h3>${off.length ? "" : `<p class="lv-muted">Every card is on the console.</p>`}<div class="lv-tray-list"></div>`;
  tray.querySelector(".lv-tray-list").replaceChildren(...off.map((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hw-pick";
    b.innerHTML = `<span class="hw-pick-plus">${LVL_ICONS.plus}</span><span class="hw-pick-text"><b></b><small></small></span>`;
    b.querySelector("b").textContent = c.name;
    b.querySelector("small").textContent = c.desc;
    b.onclick = () => lvLayoutChange((x) => { x.off = x.off.filter((id) => id !== c.id); x.order.push(c.id); });
    return b;
  }));
}

function lvLayoutChange(change) {
  const l = lvLayout();
  change(l);
  lvLayoutSave(l);
  lvLayoutApply(true);
}

// (2.43.1) Done works even if the console was drawn again since Customize opened.
document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#lvcDone")) lvLayoutEdit(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && LVL.editing && $("liveTab") && !$("liveTab").hidden && !document.querySelector(".modal:not([hidden])")) lvLayoutEdit(false);
});

// Cards glide to their new places (note where they were, move, then slide from there).
function lvFlip(move) {
  const grid = $("lvGrid");
  const cards = [...grid.children];
  const before = new Map(cards.map((el) => [el, el.getBoundingClientRect()]));
  move();
  for (const el of cards) lvFit(el);
  if (typeof reduceMotion !== "undefined" && reduceMotion.matches) return;
  for (const el of cards) {
    const a = before.get(el), b = el.getBoundingClientRect();
    if (!a.width || !b.width || el.classList.contains("lv-dragging")) continue;
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform .3s var(--ease-out)";
      el.style.transform = "";
      setTimeout(() => { el.style.transition = ""; }, 320);
    });
  }
}

// ---------------------------------------------------------------- dragging a card by its dots

function lvDragStart(e, el) {
  if (e.button !== 0) return;
  e.preventDefault();
  el.classList.add("lv-dragging");
  LVL.drag = { el, last: 0 };
  document.documentElement.classList.add("hw-grabbing");
  addEventListener("pointermove", lvDragMove);
  addEventListener("pointerup", lvDragEnd, { once: true });
  addEventListener("pointercancel", lvDragEnd, { once: true });
}

function lvDragMove(e) {
  const d = LVL.drag;
  if (!d) return;
  const page = $("liveTab").closest("main") || document.scrollingElement;
  if (e.clientY < 60) page.scrollTop -= 14; else if (e.clientY > innerHeight - 60) page.scrollTop += 14;
  if (Date.now() - d.last < 80) return;
  const grid = $("lvGrid");
  for (const el of grid.querySelectorAll(":scope > [data-c]:not(.lv-off):not([hidden]):not(.lv-dragging)")) {
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
    const after = r.width > grid.clientWidth * 0.8 ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    const target = after ? el.nextElementSibling : el;
    if (target === d.el || target === d.el.nextElementSibling) return;
    d.last = Date.now();
    lvFlip(() => grid.insertBefore(d.el, target));
    return;
  }
}

function lvDragEnd() {
  const d = LVL.drag;
  LVL.drag = null;
  removeEventListener("pointermove", lvDragMove);
  document.documentElement.classList.remove("hw-grabbing");
  if (!d) return;
  d.el.classList.remove("lv-dragging");
  const l = lvLayout();
  l.order = [...$("lvGrid").querySelectorAll(":scope > [data-c]:not(.lv-off)")].map((el) => el.dataset.c).filter((id) => LV_CARD[id]);
  lvLayoutSave(l);
}

// (a safety net, called with every redraw: measure every card again)
function lvRefit() {
  const grid = $("lvGrid");
  if (grid && !$("liveTab").hidden) for (const el of grid.children) lvFit(el);
}
