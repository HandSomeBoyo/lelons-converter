// Home widgets: Home is a grid of widgets you pick yourself and drag around (Customize at the top).
// (3.0) The grid has 3 columns. A widget is small (1 column), medium (2) or large (the whole row).
// Drag one anywhere: it snaps to the nearest column, and every widget slides up as far as it can,
// so there are no holes. Ready-made layouts (Classic, Right now, Two columns, You first) are a click away.
// Each widget is a <div class="hw" data-w="..."> in #homeWidgets. This file places, sizes and moves
// those, and draws the widgets that home.js doesn't (right now, calls, game sales, your channel,
// recent docs, boards due, notifications, crew this week, projects). The layout is remembered per account on this PC.
// Uses $, api() from app.js, loadPref()/savePref() from theme.js, setChildren()/keptNode() from motion.js,
// sfxUser()/avatarEl()/sfxAgo()/openLogin() from sfx.js, showTab() from images.js, shortNumber() from home.js,
// openChat()/chatGroups/chatPrivate/unreadIn() from chat.js, call/callLiveGroups/callJoin()/callIsLive() from call.js,
// gmGames/gmOnSale/gmPrice from games.js, docsLocal/docsCollab from docs.js, noteData/noteRow()/noteToggle()
// from notify.js, qkOpenDoc()/qkOpenBoard()/qkOpenGame() from quick.js, liveNow/liveWatch() from live.js,
// statsSeries() from stats.js, openPj()/pjStageName()/pjKindName()/pjEventText() from projects.js.

// size: the size it gets when added. sizes: the ones you may pick (s, m, l). login: only when logged in.
const HW_ALL = ["s", "m", "l"];
const HW_WIDGETS = [
  { id: "now", name: "Right now", desc: "Who's live, who's online, unread chats and what's due, in one row.", size: "l", sizes: ["m", "l"], login: true },
  { id: "start", name: "Start buttons", desc: "Big buttons to convert, write, plan or find a sound.", size: "l", sizes: ["m", "l"] },
  { id: "live", name: "Live now", desc: "Friends streaming right now.", size: "l", sizes: ["m", "l"], login: true },
  { id: "paste", name: "Quick convert", desc: "Paste a link to convert it right away.", size: "l", sizes: ["m", "l"] },
  { id: "channels", name: "Our channels", desc: "The crew's subscriber counters and newest uploads.", size: "l", sizes: ["m", "l"] },
  { id: "online", name: "Who's online", desc: "Friends in the app right now.", size: "s", sizes: HW_ALL, login: true },
  { id: "activity", name: "Activity", desc: "New sounds, new people and new videos.", size: "m", sizes: HW_ALL, login: true },
  { id: "chat", name: "Live chat", desc: "The newest messages in the crew chat.", size: "s", sizes: HW_ALL, login: true },
  { id: "calls", name: "Calls", desc: "Calls going on in your groups, to jump in.", size: "s", sizes: ["s", "m"], login: true },
  { id: "since", name: "Since you were last here", desc: "What's new since you last opened VaultHub. Hides when there's nothing.", size: "l", sizes: ["m", "l"], login: true },
  { id: "twitch", name: "Your Twitch", desc: "Your Twitch channel: live or not, followers and your last stream.", size: "m", sizes: HW_ALL },
  { id: "crew", name: "Crew this week", desc: "Who gained the most subscribers in the last 7 days.", size: "s", sizes: HW_ALL },
  { id: "projects", name: "Projects", desc: "The video projects you're making with friends.", size: "m", sizes: HW_ALL, login: true },
  { id: "sales", name: "Game sales", desc: "Games on the Games list that are on sale.", size: "s", sizes: HW_ALL, login: true },
  { id: "mychannel", name: "Your channel", desc: "Subscribers, views and watch time of your own channel.", size: "m", sizes: HW_ALL },
  { id: "docs", name: "Recent docs", desc: "The documents you worked on last.", size: "s", sizes: HW_ALL },
  { id: "due", name: "Due on your boards", desc: "Cards with a due date coming up.", size: "s", sizes: HW_ALL },
  { id: "notes", name: "Notifications", desc: "The newest from the bell.", size: "s", sizes: HW_ALL },
  { id: "stats", name: "Your stats", desc: "Files converted, hours and your favorite format.", size: "s", sizes: HW_ALL },
  { id: "recent", name: "Recent downloads", desc: "The last things you converted.", size: "s", sizes: HW_ALL },
];
const HW_BY_ID = Object.fromEntries(HW_WIDGETS.map((w) => [w.id, w]));
const HW_SPAN = { s: 1, m: 2, l: 3 };
const HW_GAP = 12;

// The ready-made layouts: [widget, size, column (0-2, left out: wherever it fits best)]
const HW_PRESETS = [
  { id: "clean", name: "Clean", items: [["now", "l"], ["since", "l"], ["live", "l"], ["paste", "l"], ["channels", "l"]] },
  { id: "classic", name: "Classic", items: [["start", "l"], ["live", "l"], ["paste", "l"], ["channels", "l"],
    ["activity", "m", 0], ["online", "s", 2], ["chat", "s", 2], ["crew", "s", 2], ["projects", "m", 0], ["sales", "s", 2],
    ["docs", "s", 0], ["stats", "s", 1], ["recent", "s", 2]] },
  { id: "now", name: "Right now", items: [["now", "l"], ["since", "l"], ["live", "l"], ["paste", "l"], ["channels", "l"],
    ["activity", "m", 0], ["online", "s", 2], ["chat", "s", 2], ["crew", "s", 2], ["projects", "m", 0], ["sales", "s", 2],
    ["docs", "s", 0], ["due", "s", 1], ["recent", "s", 2]] },
  { id: "columns", name: "Two columns", items: [["now", "l"], ["since", "l"], ["live", "l"], ["paste", "m", 0], ["online", "s", 2], ["twitch", "s", 2],
    ["channels", "m", 0], ["chat", "s", 2], ["notes", "s", 2], ["calls", "s", 2], ["crew", "s", 2], ["activity", "m", 0],
    ["sales", "s", 2], ["projects", "m", 0], ["docs", "s", 2], ["due", "s", 2], ["recent", "m", 0], ["stats", "s", 2]] },
  { id: "me", name: "You first", items: [["since", "l"], ["mychannel", "m", 0], ["twitch", "s", 2], ["paste", "l"], ["channels", "m", 0], ["crew", "s", 2],
    ["online", "s", 2], ["activity", "m", 0], ["chat", "s", 2], ["projects", "m", 0], ["docs", "s", 2], ["stats", "s", 2],
    ["recent", "s", 0], ["sales", "s", 1]] },
];
const hwPresetItems = (p) => p.items.map(([id, size, x]) => ({ id, size, x: x == null ? null : x }));
const HW_DEFAULT = HW_PRESETS[0]; // (3.0) Home starts clean: you add what you want
// Widgets that came with an update are added to layouts made before it only if they're here (the rest wait in the tray).
const HW_ADD_NEW = ["now", "since"];
const HW_ICONS = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

const hwSlot = (id) => id === "login" ? $("homeCrewOut") : document.querySelector(`#homeWidgets > .hw[data-w="${id}"]`);
const hwThere = (id) => !!document.querySelector(`#homeWidgets > .hw[data-w="${id}"]`); // (a widget whose part of the app isn't in this version)
const hwLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();
const hwSizes = (w) => w.sizes || HW_ALL;
let hwEditing = false;

// ---------------------------------------------------------------- the layout: {items: [{id, size, x}]}

function hwKey() { return hwLoggedIn() ? "u:" + sfxUser().username.toLowerCase() : ""; }
function hwFix(it) {
  const w = HW_BY_ID[it.id];
  const size = hwSizes(w).includes(it.size) ? it.size : w.size;
  const x = Number.isInteger(it.x) ? Math.max(0, Math.min(it.x, 3 - HW_SPAN[size])) : null;
  return { id: it.id, size, x };
}
function hwLayout() {
  const saved = (loadPref("homeWidgets") || {})[hwKey()];
  let items;
  if (saved && Array.isArray(saved.items)) items = saved.items;
  // (before 3.0) {order, wide}: the same widgets in the same order, wide ones large.
  else if (saved && Array.isArray(saved.order)) items = saved.order.map((id) => ({ id, size: saved.wide && saved.wide[id] ? "l" : null, x: null }));
  else items = hwPresetItems(HW_DEFAULT);
  items = items.filter((it, i, all) => it && HW_BY_ID[it.id] && all.findIndex((o) => o.id === it.id) === i).map(hwFix);
  // Widgets that came with an update are added once, where they'd be in a fresh layout.
  if (saved && Array.isArray(saved.known)) {
    HW_ADD_NEW.forEach((id, i) => {
      if (!saved.known.includes(id) && !items.some((it) => it.id === id)) items.splice(Math.min(i, items.length), 0, hwFix({ id, x: null }));
    });
  }
  return { items, preset: saved ? saved.preset || "" : HW_DEFAULT.id };
}
function hwSave(layout) {
  const all = { ...(loadPref("homeWidgets") || {}) };
  all[hwKey()] = { items: layout.items, preset: layout.preset || "", known: HW_WIDGETS.map((w) => w.id) };
  savePref("homeWidgets", all);
}

// The widgets that show, in order. Logged out: the ones that need an account give way to one "Log in"
// card, after Our channels (or where the first of them was).
function hwShown(layout = hwLayout()) {
  const loggedIn = !!(homeData ? homeData.loggedIn : hwLoggedIn());
  const list = layout.items.filter((it) => hwThere(it.id));
  if (!loggedIn && !hwEditing) {
    const first = list.findIndex((it) => HW_BY_ID[it.id].login);
    if (first >= 0) {
      const ch = list.findIndex((it) => it.id === "channels");
      list.splice(ch >= 0 && ch >= first ? ch + 1 : first, 0, { id: "login", size: "l", x: 0 });
    }
  }
  return list;
}

// Put the widgets in place: each goes in its column (or where it fits best), as high as it can.
function hwPack(list, cols, heightOf) {
  const tops = new Array(cols).fill(0);
  const out = new Map();
  for (const it of list) {
    const span = Math.min(cols, HW_SPAN[it.size] || 1);
    const topAt = (c) => Math.max(...tops.slice(c, c + span));
    let x = it.x;
    if (x != null && cols === 2) x = it.x > 0 ? 1 : 0;
    if (x == null || cols === 1) {
      x = 0;
      for (let c = 1; c <= cols - span; c++) if (topAt(c) < topAt(x)) x = c;
    }
    x = Math.max(0, Math.min(x, cols - span));
    const top = topAt(x), h = heightOf(it.id);
    for (let c = x; c < x + span; c++) tops[c] = top + h + HW_GAP;
    out.set(it.id, { x, span, top, h });
  }
  out.height = Math.max(0, Math.max(0, ...tops) - HW_GAP);
  return out;
}

let hwPos = new Map(), hwCols = 3, hwColW = 0, hwList = [];
function hwRender(list = hwShown()) {
  const grid = $("homeWidgets");
  const width = grid.clientWidth;
  hwList = list;
  if (!width || $("homeTab").hidden) return;
  hwCols = width >= 760 ? 3 : width >= 460 ? 2 : 1;
  hwColW = (width - HW_GAP * (hwCols - 1)) / hwCols;
  const visible = list.filter((it) => { const el = hwSlot(it.id); return el && !el.hidden && getComputedStyle(el).display !== "none"; });
  for (const it of visible) {
    const el = hwSlot(it.id), span = Math.min(hwCols, HW_SPAN[it.size]);
    el.style.width = span * hwColW + (span - 1) * HW_GAP + "px";
    el.dataset.size = it.size;
  }
  const heights = new Map(visible.map((it) => [it.id, hwSlot(it.id).offsetHeight]));
  hwPos = hwPack(visible, hwCols, (id) => heights.get(id));
  for (const it of visible) {
    const el = hwSlot(it.id), p = hwPos.get(it.id);
    el.style.left = p.x * (hwColW + HW_GAP) + "px";
    el.style.top = p.top + "px";
  }
  grid.style.height = hwPos.height + "px";
  if (!grid.classList.contains("hw-ready")) requestAnimationFrame(() => grid.classList.add("hw-ready")); // glide from now on
}
// Something got taller or shorter (new messages, a picture loaded, the window changed): place them again.
let hwRenderSoon = 0;
function hwRelayout() {
  if (hwRenderSoon) return;
  hwRenderSoon = requestAnimationFrame(() => { hwRenderSoon = 0; hwRender(hwDrag ? hwDrag.list : hwList.length ? hwList : undefined); });
}
const hwSizeWatch = new ResizeObserver(hwRelayout);
hwSizeWatch.observe($("homeWidgets"));
for (const el of $("homeWidgets").children) hwSizeWatch.observe(el);

// Show the widgets you picked (and that may show now), and place them.
function hwApply() {
  const layout = hwLayout();
  const loggedIn = !!(homeData ? homeData.loggedIn : hwLoggedIn());
  const on = new Set(layout.items.map((it) => it.id));
  for (const w of HW_WIDGETS) {
    const slot = hwSlot(w.id);
    if (!slot) continue;
    slot.classList.toggle("hw-off", !on.has(w.id));
    slot.classList.toggle("hw-needs-login", on.has(w.id) && !!w.login && !loggedIn);
  }
  const list = hwShown(layout);
  $("homeCrewOut").hidden = !list.some((it) => it.id === "login");
  if (hwEditing) hwDrawEdit(layout);
  hwRender(list);
}

// (3.0) A widget with nothing to show hides (except in Customize), and comes back when it has something.
function hwMarkBlank(id, blank) {
  const slot = hwSlot(id);
  if (!slot || slot.classList.contains("hw-blank") === !!blank) return;
  slot.classList.toggle("hw-blank", !!blank);
  hwRelayout();
}
const hwBlankIf = (id, blank) => { hwMarkBlank(id, blank); return blank; };

// ---------------------------------------------------------------- Customize

function hwSetEditing(on) {
  hwEditing = on;
  $("homeWidgets").classList.toggle("hw-editing", on);
  $("hwBar").hidden = !on;
  $("hwTray").hidden = !on;
  $("homeCustomize").hidden = on;
  $("hwAddHint").hidden = on;
  if (!on) document.querySelectorAll("#homeWidgets .hw-tools").forEach((t) => t.remove());
  hwApply();
  if (on) $("hwBar").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function hwDrawEdit(layout) {
  for (const w of HW_WIDGETS) {
    const slot = hwSlot(w.id);
    if (!slot) continue;
    let tools = slot.querySelector(":scope > .hw-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "hw-tools";
      const grip = Object.assign(document.createElement("button"), { type: "button", className: "hw-grip", innerHTML: HW_ICONS.grip, title: "Drag to move" });
      grip.addEventListener("pointerdown", (e) => hwDragStart(e, slot));
      const name = Object.assign(document.createElement("span"), { className: "hw-name", textContent: w.name });
      tools.append(grip, name);
      if (hwSizes(w).length > 1) {
        const sizes = Object.assign(document.createElement("span"), { className: "hw-sizes" });
        for (const s of hwSizes(w)) {
          const b = Object.assign(document.createElement("button"), { type: "button", textContent: s.toUpperCase(),
            title: { s: "Small", m: "Medium", l: "Large" }[s] });
          b.dataset.s = s;
          b.addEventListener("click", () => hwSetSize(w.id, s));
          sizes.append(b);
        }
        tools.append(sizes);
      }
      const x = Object.assign(document.createElement("button"), { type: "button", className: "hw-x", innerHTML: HW_ICONS.x, title: "Take it off Home" });
      x.addEventListener("click", () => hwRemove(w.id));
      tools.append(x);
      slot.prepend(tools);
    }
    const item = layout.items.find((it) => it.id === w.id);
    tools.querySelectorAll(".hw-sizes button").forEach((b) => b.classList.toggle("active", !!item && b.dataset.s === item.size));
  }
  // The ready-made layouts.
  const bar = $("hwPresets");
  if (bar.children.length < 2) {
    for (const p of HW_PRESETS) {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: p.name });
      b.dataset.p = p.id;
      b.addEventListener("click", () => hwUsePreset(p.id));
      bar.append(b);
    }
  }
  bar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.p === layout.preset));
  // The tray: the widgets that aren't on Home.
  const off = HW_WIDGETS.filter((w) => hwThere(w.id) && !layout.items.some((it) => it.id === w.id));
  $("hwTrayEmpty").hidden = off.length > 0;
  setChildren($("hwTrayList"), off.map((w) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hw-pick";
    b.innerHTML = `<span class="hw-pick-plus">${HW_ICONS.plus}</span><span class="hw-pick-text"><b></b><small></small></span>`;
    b.querySelector("b").textContent = w.name;
    b.querySelector("small").textContent = w.desc + (w.login && !hwLoggedIn() ? " (when you're logged in)" : "");
    b.addEventListener("click", () => hwAdd(w.id));
    return b;
  }));
}

function hwChange(change) {
  const layout = hwLayout();
  change(layout);
  layout.items = layout.items.map(hwFix);
  layout.preset = layout.preset || "";
  hwSave(layout);
  hwApply();
  hwDrawAll();
}
function hwAdd(id) {
  hwChange((l) => { l.items = [...l.items.filter((it) => it.id !== id), { id, size: HW_BY_ID[id].size, x: null }]; l.preset = ""; });
  const slot = hwSlot(id);
  if (slot) { slot.classList.add("hw-new"); setTimeout(() => slot.classList.remove("hw-new"), 900); setTimeout(() => slot.scrollIntoView({ block: "nearest", behavior: "smooth" }), 380); }
}
function hwRemove(id) { hwChange((l) => { l.items = l.items.filter((it) => it.id !== id); l.preset = ""; }); }
function hwSetSize(id, size) {
  hwChange((l) => { const it = l.items.find((x) => x.id === id); if (it && it.size !== size) { it.size = size; l.preset = ""; } });
}
function hwUsePreset(id) {
  const p = HW_PRESETS.find((x) => x.id === id);
  hwChange((l) => { l.items = hwPresetItems(p); l.preset = p.id; });
}

$("homeCustomize").addEventListener("click", () => hwSetEditing(true));
$("hwAddHint").addEventListener("click", () => { hwSetEditing(true); setTimeout(() => $("hwTray").scrollIntoView({ block: "center", behavior: "smooth" }), 120); });
$("hwDone").addEventListener("click", () => hwSetEditing(false));
$("hwReset").addEventListener("click", () => hwUsePreset(HW_DEFAULT.id));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && hwEditing && !$("homeTab").hidden && !document.querySelector(".modal:not([hidden])")) hwSetEditing(false);
});

// ---------------------------------------------------------------- dragging a widget by its handle

// While you drag, the widget's spot (a dashed box) moves to where it would go, and the others slide out
// of the way. Where it goes: the column under the widget you're holding, before the first widget there
// whose middle is below the pointer.
let hwDrag = null;
function hwDragStart(e, slot) {
  if (e.button !== 0) return;
  e.preventDefault();
  const r = slot.getBoundingClientRect();
  const ghost = slot.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.className = slot.className + " hw-ghost";
  Object.assign(ghost.style, { width: r.width + "px", height: r.height + "px", left: r.left + "px", top: r.top + "px" });
  document.body.append(ghost);
  slot.classList.add("hw-dragging");
  const id = slot.dataset.w;
  const list = hwShown();
  const others = list.filter((it) => it.id !== id);
  const heights = new Map(others.map((it) => [it.id, (hwPos.get(it.id) || {}).h || 0]));
  hwDrag = { slot, ghost, id, list, item: list.find((it) => it.id === id), others,
    spots: hwPack(others.filter((it) => heights.get(it.id)), hwCols, (x) => heights.get(x)), dx: e.clientX - r.left, dy: e.clientY - r.top, key: "" };
  document.documentElement.classList.add("hw-grabbing");
  addEventListener("pointermove", hwDragMove);
  addEventListener("pointerup", hwDragEnd, { once: true });
  addEventListener("pointercancel", hwDragEnd, { once: true });
}

function hwDragMove(e) {
  const d = hwDrag;
  if (!d) return;
  d.ghost.style.left = e.clientX - d.dx + "px";
  d.ghost.style.top = e.clientY - d.dy + "px";
  // Scroll the page when near the top or bottom.
  const page = $("homeTab").closest("main") || document.scrollingElement;
  const edge = 60;
  if (e.clientY < edge) page.scrollTop -= 14; else if (e.clientY > innerHeight - edge) page.scrollTop += 14;
  const grid = $("homeWidgets").getBoundingClientRect();
  const span = Math.min(hwCols, HW_SPAN[d.item.size]);
  const left = e.clientX - d.dx - grid.left;
  let x = Math.max(0, Math.min(hwCols - span, Math.round(left / (hwColW + HW_GAP))));
  const y = e.clientY - grid.top;
  let at = d.others.length;
  for (let i = 0; i < d.others.length; i++) {
    const p = d.spots.get(d.others[i].id);
    if (!p || p.x >= x + span || p.x + p.span <= x) continue; // not in these columns
    if (p.top + p.h / 2 > y) { at = i; break; }
  }
  const key = x + ":" + at;
  if (key === d.key) return;
  d.key = key;
  // In a narrow window the columns are fewer: only the order changes.
  const col = hwCols === 3 ? (span === 3 ? 0 : x) : d.item.x;
  d.list = [...d.others.slice(0, at), { ...d.item, x: col }, ...d.others.slice(at)];
  hwRender(d.list);
}

function hwDragEnd() {
  const d = hwDrag;
  hwDrag = null;
  removeEventListener("pointermove", hwDragMove);
  document.documentElement.classList.remove("hw-grabbing");
  if (!d) return;
  const r = d.slot.getBoundingClientRect();
  d.ghost.classList.add("hw-ghost-drop");
  const grid = $("homeWidgets").getBoundingClientRect(), p = hwPos.get(d.id);
  const to = p ? { left: grid.left + p.x * (hwColW + HW_GAP), top: grid.top + p.top } : r;
  Object.assign(d.ghost.style, { left: to.left + "px", top: to.top + "px", width: r.width + "px", height: r.height + "px" });
  setTimeout(() => { d.ghost.remove(); d.slot.classList.remove("hw-dragging"); }, 220);
  if (!d.key) return;
  // The new order (and column); widgets that aren't on the page right now keep their place at the end.
  const layout = hwLayout();
  const placed = d.list.filter((it) => it.id !== "login");
  layout.items = [...placed, ...layout.items.filter((it) => !placed.some((p2) => p2.id === it.id))];
  layout.preset = "";
  hwSave(layout);
  hwApply();
}

// ---------------------------------------------------------------- the widgets' own content

const hwOn = (id) => !$("homeTab").hidden && hwThere(id) && (hwEditing || hwLayout().items.some((it) => it.id === id));
const hwEl = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const hwEmpty = (text, button, onclick) => {
  const box = hwEl("div", "hw-empty");
  box.append(hwEl("p", "home-muted", text));
  if (button) { const b = hwEl("button", "small-button", button); b.type = "button"; b.onclick = onclick; box.append(b); }
  return box;
};
// A row: a picture (or avatar), a title and a line under it, and maybe a button on the right.
function hwRow({ face, pic, title, sub, tag, tagKind, button, onclick, onbutton }) {
  const row = hwEl(onclick ? "button" : "div", "hw-row");
  if (onclick) { row.type = "button"; row.onclick = onclick; }
  if (face) row.append(face);
  else if (pic !== undefined) { const p = hwEl("span", "hw-pic"); if (pic) p.style.backgroundImage = `url("${pic}")`; row.append(p); }
  const text = hwEl("span", "hw-row-text");
  text.append(hwEl("b", "", title), hwEl("small", "", sub || ""));
  row.append(text);
  if (tag) row.append(hwEl("span", "hw-tag " + (tagKind || ""), tag));
  if (button) {
    const b = hwEl("span", "small-button hw-row-button", button);
    b.setAttribute("role", "button");
    b.onclick = (e) => { e.stopPropagation(); onbutton(); };
    row.append(b);
  }
  return row;
}

let hwWho = null;
function hwDrawAll() {
  if (hwWho !== hwKey()) { // logged in, out, or someone else: their own layout and their own lists
    hwWho = hwKey();
    hwDocsAt = hwGamesAt = hwDueAt = hwChAt = 0;
    hwApply();
  }
  hwDrawNow();
  hwDrawSince();
  hwDrawTwitch();
  hwDrawCalls();
  hwDrawCrew();
  hwDrawProjects();
  hwDrawSales();
  hwDrawChannel();
  hwDrawDocs();
  hwDrawDue();
  hwDrawNotes();
}

// ---- calls

function hwDrawCalls() {
  if (!hwOn("calls") || !hwLoggedIn()) return;
  const rows = [];
  const live = typeof callIsLive === "function" && callIsLive() && call.phase !== "incoming" ? call : null;
  if (live) {
    rows.push(hwRow({ face: avatarEl(live.pictureUrl, live.title || "?"), title: live.title || "A call",
      sub: live.phase === "joining" ? "Joining..." : "You're in this call", tag: "Live", tagKind: "live",
      onclick: () => openChat(live.key) }));
  }
  for (const g of (typeof callLiveGroups !== "undefined" ? callLiveGroups : [])) {
    if (live && live.id === g.room) continue;
    const group = (typeof chatGroups !== "undefined" ? chatGroups : []).find((x) => x.id === g.group) || {};
    rows.push(hwRow({ face: avatarEl(group.pictureUrl, group.name || "?", "group-avatar"), title: group.name || "A group call",
      sub: g.people === 1 ? "1 person in the call" : `${g.people} people in the call`,
      button: "Join", onbutton: () => callJoin(g.room, "g:" + g.group), onclick: () => openChat("g:" + g.group) }));
  }
  hwMarkBlank("calls", !rows.length);
  setChildren($("hwCalls"), rows.length ? rows : [hwEmpty("Nobody's in a call right now. Start one from any chat.", "Open the chat", () => openChat(""))]);
}
setInterval(() => { if (!document.hidden) { hwDrawCalls(); hwDrawNow(); } }, 4000);
$("hwCallsOpen").addEventListener("click", () => openChat(""));

// ---- game sales

let hwGamesAt = 0;
async function hwDrawSales() {
  if (!hwOn("sales") || !hwLoggedIn()) return;
  const games = typeof gmGames !== "undefined" ? gmGames : [];
  if (!games.length && Date.now() - hwGamesAt > 10 * 60000) {
    hwGamesAt = Date.now();
    const res = await api("/api/games-list", {}).catch(() => null);
    if (res && res.ok && !gmGames.length) { gmGames = res.games; return hwDrawSales(); }
  }
  const sale = games.filter((g) => g.info && gmOnSale(g))
    .sort((a, b) => !!b.info.free - !!a.info.free || ((b.info.price || {}).discount || 0) - ((a.info.price || {}).discount || 0)).slice(0, 4);
  hwMarkBlank("sales", !sale.length);
  setChildren($("hwSales"), sale.length ? sale.map((g) => hwRow({
    pic: g.info.header || "", title: g.info.name,
    sub: g.info.free ? "Free right now" : [g.info.price.text ? "Now " + g.info.price.text : "", g.info.price.was ? "was " + g.info.price.was : ""].filter(Boolean).join(", "),
    tag: g.info.free ? "Free" : `-${g.info.price.discount}%`, tagKind: "sale", onclick: () => qkOpenGame(g.id) }))
    : [hwEmpty(games.length ? "Nothing on the Games list is on sale right now." : "No games on the list yet.", "Open Games", () => showTab("games"))]);
}
$("hwSalesOpen").addEventListener("click", () => showTab("games"));

// ---- your channel

let hwCh = null, hwChAt = 0;
async function hwDrawChannel() {
  if (!hwOn("mychannel")) return;
  if (Date.now() - hwChAt > (hwCh && hwCh.loading ? 5000 : 5 * 60000)) {
    hwChAt = Date.now();
    const res = await api("/api/ch-page", { days: 28 }).catch(() => null);
    if (res && res.ok) hwCh = res;
  }
  const box = $("hwChannel");
  if (!hwCh) return setChildren(box, [hwEmpty("Loading...")]);
  if (hwBlankIf("mychannel", hwCh.mode === "none")) return setChildren(box, [hwEmpty("Add your channel to see how it's doing.", "Add my channel", () => showTab("channel"))]);
  const c = hwCh.channel || {}, t = hwCh.totals || {};
  const head = hwEl("div", "hw-ch-head");
  head.append(avatarEl(c.avatar, c.name || "?"), hwEl("span", "hw-row-text"));
  head.lastChild.append(hwEl("b", "", c.name || "Your channel"), hwEl("small", "", hwCh.loading ? "Reading your channel..." : c.handle || ""));
  const nums = hwEl("div", "hw-ch-nums");
  const num = (label, n, change) => {
    const el = hwEl("div");
    el.append(hwEl("b", "", n == null ? "–" : shortNumber(n)), hwEl("span", "", label));
    if (change) el.append(hwEl("small", change > 0 ? "up" : "down", (change > 0 ? "+" : "−") + shortNumber(Math.abs(change))));
    return el;
  };
  nums.append(num("subscribers", t.subs && t.subs.value, t.subs && t.subs.change),
    num("views", t.views && t.views.value, t.views && t.views.change),
    ...(t.watch ? [num("hours watched, 28 days", t.watch.value)] : [])); // (watch time needs Google sign-in)
  setChildren(box, [head, nums]);
}
$("hwChOpen").addEventListener("click", () => showTab("channel"));

// ---- recent docs

let hwDocsAt = 0;
async function hwDrawDocs() {
  if (!hwOn("docs")) return;
  const noShared = hwLoggedIn() && (typeof docsCollab === "undefined" || !docsCollab);
  if (Date.now() - hwDocsAt > (noShared ? 15000 : 2 * 60000)) {
    hwDocsAt = Date.now();
    const res = await api("/api/docs-list", { collab: hwLoggedIn() }).catch(() => null);
    if (res && res.ok) { docsLocal = res.local; if (res.collab) docsCollab = res.collab; }
  }
  const all = [
    ...(typeof docsLocal !== "undefined" ? docsLocal || [] : []).map((d) => ({ ...d, where: "local" })),
    ...((typeof docsCollab !== "undefined" && docsCollab && docsCollab.docs) || []).map((d) => ({ ...d, where: "collab" })),
  ];
  const when = (d) => typeof d.updated_at === "number" ? d.updated_at * 1000 : Date.parse(d.updated_at) || 0;
  const top = all.sort((a, b) => when(b) - when(a)).slice(0, 5);
  const kinds = { script: "Movie script", doc: "Document", pdf: "PDF" };
  hwMarkBlank("docs", !top.length);
  setChildren($("hwDocs"), top.length ? top.map((d) => hwRow({
    face: hwEl("span", "hw-doc-icon " + (d.where === "collab" ? "collab" : "")),
    title: d.title || "Untitled", sub: [kinds[d.kind] || "Document", d.where === "collab" ? "Shared" : "", when(d) ? sfxAgo(when(d)) : ""].filter(Boolean).join(" · "),
    onclick: () => qkOpenDoc(d.where, d.id) }))
    : [hwEmpty("No documents yet.", "Write one", () => showTab("docs"))]);
}
$("hwDocsOpen").addEventListener("click", () => showTab("docs"));

// ---- boards due

let hwDue = null, hwDueAt = 0;
let hwDueLoading = null;
function hwLoadDue() {
  if (Date.now() - hwDueAt < 60000) return hwDueLoading || Promise.resolve();
  hwDueAt = Date.now();
  hwDueLoading = api("/api/boards-due", {}).then((res) => { if (res && res.ok) hwDue = res.cards; }).catch(() => {});
  return hwDueLoading;
}
async function hwDrawDue() {
  if (!hwOn("due")) return;
  await hwLoadDue();
  if (!hwDue) return;
  const date = (v) => new Date(v.length <= 10 ? v + "T12:00" : v);
  hwMarkBlank("due", !hwDue.length);
  setChildren($("hwDue"), hwDue.length ? hwDue.slice(0, 5).map((c) => {
    const d = date(c.due), left = d - Date.now();
    const state = left < 0 ? "overdue" : left < 86400000 ? "soon" : "";
    const opts = { month: "short", day: "numeric" };
    let text = d.toLocaleDateString([], opts);
    if (c.due.length > 10) text += ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return hwRow({ face: hwEl("span", "hw-due-dot " + state), title: c.title || "A card", sub: `${c.boardTitle} · ${c.list}`,
      tag: state === "overdue" ? "Overdue" : state === "soon" ? "Soon" : text, tagKind: state, onclick: () => qkOpenBoard(c.board, false) });
  }) : [hwEmpty("Nothing due. Give a card a due date and it shows up here.", "Open Boards", () => showTab("boards"))]);
}
$("hwDueOpen").addEventListener("click", () => showTab("boards"));

// ---- notifications

function hwDrawNotes() {
  if (!hwOn("notes") || typeof noteData === "undefined") return;
  const list = noteData.list.slice(0, 4);
  hwMarkBlank("notes", !list.length);
  setChildren($("hwNotes"), list.length ? list.map((n) => noteRow(n)) : [hwEmpty("Nothing new. Messages, invitations, sales and new POVs show up here.")]);
}
$("hwNotesOpen").addEventListener("click", (e) => { e.stopPropagation(); noteToggle(true); });
// The bell's list changes: the widget follows.
if (typeof noteDraw === "function") {
  const drawBell = noteDraw;
  noteDraw = function () { drawBell(); hwDrawNotes(); };
}

$("hwStatsHistory").addEventListener("click", () => showTab("history"));

// ---- right now: one row of what's going on

const hwNowIcons = {
  online: '<i class="online-dot"></i>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/></svg>',
  call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z"/></svg>',
  due: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
};
let hwNowSig = "";
async function hwDrawNow() {
  if (!hwOn("now") || !hwLoggedIn()) return;
  hwLoadDue().then(() => { if (hwDue && hwNowSig) hwDrawNowChips(); });
  hwDrawNowChips();
}
function hwDrawNowChips() {
  const chips = [];
  const chip = (kind, html, text, onclick, hot) => chips.push({ kind, html, text, onclick, hot });
  const live = typeof liveNow !== "undefined" ? liveNow : [];
  if (live.length) {
    chip("live", '<i class="live-dot"></i>', live.length === 1 ? `${live[0].username} is live` : `${live.length} friends live`,
      () => live.length === 1 && typeof liveWatch === "function" ? liveWatch(live[0]) : $("homeLive") && $("homeLive").scrollIntoView({ block: "center", behavior: "smooth" }), true);
  }
  const online = (homeData && homeData.online) || { online: 0, people: [] };
  chip("online", hwNowIcons.online, online.online ? `${online.online} online` : "Nobody online", () => openChat(""));
  if (typeof unreadIn === "function" && typeof chatPrivate !== "undefined") {
    const unread = (unreadIn("") ? 1 : 0) + chatPrivate.filter((p) => unreadIn(p.username)).length + chatGroups.filter((g) => unreadIn("g:" + g.id)).length;
    if (unread) chip("chat", hwNowIcons.chat, unread === 1 ? "1 unread chat" : `${unread} unread chats`, () => openChat(""), true);
  }
  const calls = typeof callLiveGroups !== "undefined" ? callLiveGroups.length : 0;
  if (calls) chip("call", hwNowIcons.call, calls === 1 ? "A call is going on" : `${calls} calls going on`, () => openChat(""), true);
  if (hwDue) {
    const soon = hwDue.filter((c) => new Date(c.due.length <= 10 ? c.due + "T23:59" : c.due) - Date.now() < 86400000).length;
    if (soon) chip("due", hwNowIcons.due, soon === 1 ? "1 card due today" : `${soon} cards due today`, () => showTab("boards"), true);
  }
  const bell = typeof noteData !== "undefined" ? noteData.list.filter((n) => !n.read).length : 0;
  if (bell) chip("bell", hwNowIcons.bell, bell === 1 ? "1 new notification" : `${bell} new notifications`, () => noteToggle(true));
  const sig = JSON.stringify(chips.map((c) => [c.kind, c.text, c.hot])) + JSON.stringify((online.people || []).slice(0, 3));
  if (sig === hwNowSig) return;
  hwNowSig = sig;
  const box = $("hwNow");
  const nodes = [hwEl("span", "hw-now-title", "Right now")];
  for (const c of chips) {
    const b = hwEl("button", "hw-chip " + c.kind + (c.hot ? " hot" : ""));
    b.type = "button";
    b.innerHTML = c.html;
    if (c.kind === "online" && online.people && online.people.length) {
      const faces = hwEl("span", "hw-chip-faces");
      faces.append(...online.people.slice(0, 3).map((p) => avatarEl(p.avatarUrl, p.username, "tiny")));
      b.append(faces);
    }
    b.append(hwEl("span", "", c.text));
    b.addEventListener("click", (e) => { e.stopPropagation(); c.onclick(); });
    nodes.push(b);
  }
  if (chips.length === 1) nodes.push(hwEl("span", "home-muted hw-now-quiet", "All quiet. Nothing new right now."));
  setChildren(box, nodes);
}
// Live friends and unread chats change outside Home: the row follows.
if (typeof liveDraw === "function") { const was = liveDraw; liveDraw = function () { was(); hwDrawNow(); }; }
if (typeof drawUnread === "function") { const was = drawUnread; drawUnread = function () { was(); hwDrawNow(); }; }

// ---- since you were last here (3.0): what's new since VaultHub was open last time

// When you were here last: kept per account, the time of the last look while the app was open.
const hwSinceKey = () => "seen:" + hwKey();
let hwSinceFrom = null; // (this time) what counts as new: since this
let hwSinceGone = false; // "Got it"
function hwSinceStart() {
  if (hwSinceFrom != null || !hwLoggedIn()) return;
  const all = loadPref("homeSince") || {};
  hwSinceFrom = all[hwSinceKey()] || 0; // 0: the first time, nothing to compare with
  hwSinceTick();
}
function hwSinceTick() {
  if (!hwLoggedIn()) return;
  const all = { ...(loadPref("homeSince") || {}) };
  all[hwSinceKey()] = Date.now();
  savePref("homeSince", all);
}
setInterval(() => { if (!document.hidden && hwSinceFrom != null) hwSinceTick(); }, 5 * 60000);
addEventListener("pagehide", hwSinceTick);

function hwDrawSince() {
  if (!hwOn("since") || !hwLoggedIn()) return;
  hwSinceStart();
  const from = hwSinceFrom;
  const items = [];
  if (from && !hwSinceGone && homeData) {
    const newer = (homeData.activity || []).filter((a) => Date.parse(a.at) > from);
    const count = (kind) => newer.filter((a) => a.kind === kind).length;
    const sounds = count("upload"), people = count("joined"), milestones = count("milestone");
    let videos = 0;
    for (const c of homeData.channels || []) for (const v of ((c.info && c.info.uploads) || [])) if (v.when && v.when * 1000 > from) videos++;
    const unread = typeof unreadIn === "function" && typeof chatPrivate !== "undefined"
      ? (unreadIn("") ? 1 : 0) + chatPrivate.filter((p) => unreadIn(p.username)).length + chatGroups.filter((g) => unreadIn("g:" + g.id)).length : 0;
    const add = (n, one, many, go, icon) => { if (n) items.push({ text: n === 1 ? one : many.replace("#", n), go, icon }); };
    add(videos, "1 new video", "# new videos", () => $("homeChannels").scrollIntoView({ block: "center", behavior: "smooth" }), "▶");
    add(sounds, "1 new sound", "# new sounds", () => showTab("sfx"), "♪");
    add(unread, "1 chat with new messages", "# chats with new messages", () => openChat(""), "💬");
    add(people, "1 new member", "# new members", () => openChat(""), "👋");
    add(milestones, "1 channel passed a milestone", "# channels passed a milestone", () => showTab("stats"), "🎉");
  }
  $("hwSinceHead").textContent = from ? `Since you were here ${sfxAgo(from).replace(/^just now$/, "a moment ago")}` : "Since you were last here";
  hwMarkBlank("since", !items.length);
  setChildren($("hwSince"), items.length ? items.map((it) => {
    const b = hwEl("button", "hw-since-item");
    b.type = "button";
    b.append(hwEl("span", "hw-since-icon", it.icon), hwEl("span", "", it.text));
    b.onclick = it.go;
    return b;
  }) : [hwEmpty(from ? "Nothing new since last time." : "Next time you open VaultHub, what's new since now shows up here.")]);
}
$("hwSinceDone").addEventListener("click", () => { hwSinceGone = true; hwDrawSince(); });

// ---- your Twitch (3.0): the channel from the Live page's setup

let hwTw = null, hwTwAt = 0;
async function hwDrawTwitch() {
  if (!hwOn("twitch")) return;
  if (Date.now() - hwTwAt > (hwTw && hwTw.channel && hwTw.twitch && hwTw.twitch.followers == null ? 8000 : 60000)) {
    hwTwAt = Date.now();
    const res = await api("/api/live-home", {}).catch(() => null);
    if (res && res.ok) hwTw = res;
  }
  const box = $("hwTwitch");
  if (!hwTw) return setChildren(box, [hwEmpty("Loading...")]);
  if (hwBlankIf("twitch", !hwTw.channel)) return setChildren(box, [hwEmpty("Add your Twitch channel on the Live page to see it here.", "Set up Live", () => showTab("live"))]);
  const t = hwTw.twitch || {}, last = hwTw.last;
  const head = hwEl("button", "hw-tw-head");
  head.type = "button";
  head.title = "Open your channel on Twitch";
  head.onclick = () => api("/api/games-open", { url: "https://www.twitch.tv/" + hwTw.channel }).catch(() => {});
  const text = hwEl("span", "hw-row-text");
  text.append(hwEl("b", "", hwTw.channel), hwEl("small", "", t.live ? (t.title || "Live now") : "Offline"));
  head.append(hwEl("span", "hw-tw-face", hwTw.channel.slice(0, 1).toUpperCase()), text,
    hwEl("span", "hw-tag " + (t.live ? "live" : ""), t.live ? (t.viewers != null ? `Live · ${shortNumber(t.viewers)}` : "Live") : "Offline"));
  const nums = hwEl("div", "hw-ch-nums");
  const num = (label, n, sub) => {
    const el = hwEl("div");
    el.append(hwEl("b", "", n == null ? "–" : typeof n === "number" ? shortNumber(n) : n), hwEl("span", "", label));
    if (sub) el.append(hwEl("small", "up", sub));
    return el;
  };
  nums.append(num("followers", t.followers, last && last.followers ? `+${shortNumber(last.followers)} last stream` : ""));
  if (last) {
    nums.append(num("peak viewers, last stream", last.peak), num("average viewers", last.average));
  }
  const out = [head, nums];
  if (last) {
    const mins = last.minutes || 0;
    out.push(hwEl("p", "home-muted hw-note", `Last stream: ${last.title || "Stream"} · ${mins >= 60 ? Math.floor(mins / 60) + " h " + (mins % 60) + " min" : mins + " min"} · ${sfxAgo(last.start * 1000)}`));
  } else {
    out.push(hwEl("p", "home-muted hw-note", "Stream with the Live page open and your stream's numbers show up here."));
  }
  if (t.followers == null && !t.signedIn) out.push(hwEl("p", "home-muted hw-note", "Sign in with Twitch on the Live page to see your followers."));
  setChildren(box, out);
}
$("hwTwOpen").addEventListener("click", () => showTab("live"));

// ---- crew this week: the crew's channels by subscribers gained in 7 days

let hwCrew = null, hwCrewAt = 0;
async function hwDrawCrew() {
  if (!hwOn("crew")) return;
  if (Date.now() - hwCrewAt > (hwCrew && hwCrew.channels.some((c) => c.loading) ? 5000 : 10 * 60000)) {
    hwCrewAt = Date.now();
    const res = await api("/api/stats", { days: 7 }).catch(() => null);
    if (res && res.ok) hwCrew = res;
  }
  if (!hwCrew) return setChildren($("hwCrew"), [hwEmpty("Loading...")]);
  const rows = hwCrew.channels.map((c) => {
    const pts = typeof statsSeries === "function" ? statsSeries(c) : [];
    return { ...c, gained: pts.length >= 2 ? pts[pts.length - 1][1] - pts[0][1] : null };
  });
  const byGain = rows.some((r) => r.gained != null);
  rows.sort((a, b) => byGain ? (b.gained ?? -Infinity) - (a.gained ?? -Infinity) || (b.subscribers || 0) - (a.subscribers || 0)
    : (b.subscribers || 0) - (a.subscribers || 0));
  const list = rows.slice(0, 5).map((r, i) => {
    const face = hwEl("span", "hw-rank" + (i === 0 ? " first" : ""), String(i + 1));
    const row = hwRow({ face, title: r.name, sub: r.loading ? "Loading..." : r.subscribers == null ? "–" : shortNumber(r.subscribers) + " subscribers",
      tag: r.gained == null ? "" : (r.gained > 0 ? "+" : r.gained < 0 ? "−" : "") + shortNumber(Math.abs(r.gained)),
      tagKind: r.gained > 0 ? "up" : r.gained < 0 ? "down" : "", onclick: () => api("/api/open-youtube", { url: r.url }) });
    row.insertBefore(avatarEl(r.avatar, r.name), row.children[1]);
    return row;
  });
  hwMarkBlank("crew", !list.length);
  const out = list.length ? list : [hwEmpty("No channels picked yet.")];
  if (list.length && !byGain) out.push(hwEl("p", "home-muted hw-note", hwCrew.loggedIn ? "The gains fill in over the week." : "Log in to see who gained the most."));
  setChildren($("hwCrew"), out);
}
$("hwCrewOpen").addEventListener("click", () => showTab("stats"));

// ---- projects: the video projects you're in

let hwPj = null, hwPjAt = 0;
async function hwDrawProjects() {
  if (!hwOn("projects") || !hwLoggedIn()) return;
  if (Date.now() - hwPjAt > 2 * 60000) {
    hwPjAt = Date.now();
    const res = await api("/api/pj-list", {}).catch(() => null);
    if (res && res.ok) hwPj = res;
  }
  const d = hwPj || (typeof pjData !== "undefined" ? pjData : null);
  if (!d) return setChildren($("hwProjects"), [hwEmpty("Loading...")]);
  if (hwBlankIf("projects", !d.ready || (!(d.projects || []).length && !(d.invites || []).length))) {
    if (!d.ready) return setChildren($("hwProjects"), [hwEmpty("Projects isn't set up yet.", "Open Projects", () => showTab("projects"))]);
  }
  if (!d.ready) return setChildren($("hwProjects"), [hwEmpty("Projects isn't set up yet.", "Open Projects", () => showTab("projects"))]);
  const stage = (p) => typeof pjStageName === "function" ? pjStageName(p.stage) : p.stage;
  const list = [...(d.projects || [])].slice(0, 4).map((p) => {
    const joined = (p.people || []).filter((x) => x.joined);
    const faces = hwEl("span", "hw-pj-faces");
    faces.append(...joined.slice(0, 3).map((x) => avatarEl(x.avatarUrl || "", x.username || "?", "tiny")));
    const who = joined.length === 1 ? "Just you" : `${joined.length} people`;
    const last = p.editor ? `${p.editor} is editing now` : p.last && typeof pjEventText === "function" ? pjEventText(p.last) : "";
    const row = hwRow({ face: faces, title: p.name, sub: [who, last].filter(Boolean).join(" · "), tag: stage(p),
      tagKind: p.stage === "done" ? "up" : p.stage === "footage" ? "" : "soon",
      onclick: () => { showTab("projects"); if (typeof openPj === "function") openPj(p.id); } });
    return row;
  });
  const invites = (d.invites || []).length;
  const out = list.length ? list : [hwEmpty("No projects yet. Make a video together with friends.", "Start one", () => showTab("projects"))];
  if (invites) out.unshift(hwRow({ face: hwEl("span", "hw-due-dot soon"), title: invites === 1 ? "1 invitation" : `${invites} invitations`,
    sub: "Someone wants you in a project", onclick: () => showTab("projects") }));
  setChildren($("hwProjects"), out);
}
$("hwPjOpen").addEventListener("click", () => showTab("projects"));

// ---------------------------------------------------------------- start

hwApply();
hwDrawAll();
