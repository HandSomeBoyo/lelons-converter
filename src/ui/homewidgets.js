// Home widgets: Home is a grid of widgets you pick yourself and drag around (Customize at the top).
// Each widget is a <div class="hw" data-w="..."> in #homeWidgets. This file only shows, hides, moves
// and sizes those, and draws the widgets that home.js doesn't (calls, game sales, your channel,
// recent docs, boards due, notifications). The layout is remembered per account on this PC.
// Uses $, api() from app.js, loadPref()/savePref() from theme.js, setChildren()/keptNode() from motion.js,
// sfxUser()/avatarEl()/sfxAgo()/openLogin() from sfx.js, showTab() from images.js, shortNumber() from home.js,
// openChat()/chatGroups from chat.js, call/callLiveGroups/callJoin()/callIsLive() from call.js,
// gmGames/gmOnSale/gmPrice from games.js, docsLocal/docsCollab from docs.js, noteData/noteRow()/noteToggle()
// from notify.js, qkOpenDoc()/qkOpenBoard()/qkOpenGame() from quick.js.

// size: "full" (the whole width) or "half". sizes: what you may switch between. login: only when logged in.
const HW_WIDGETS = [
  { id: "live", name: "Live now", desc: "Friends streaming right now.", size: "full", sizes: ["full"], login: true },
  { id: "paste", name: "Quick convert", desc: "Paste a link to convert it right away.", size: "full", sizes: ["full"] },
  { id: "channels", name: "Our channels", desc: "The crew's subscriber counters and newest uploads.", size: "full", sizes: ["full"] },
  { id: "online", name: "Who's online", desc: "Friends in the app right now.", size: "half", login: true },
  { id: "activity", name: "Activity", desc: "New sounds, new people and new videos.", size: "half", login: true },
  { id: "chat", name: "Live chat", desc: "The newest messages in the crew chat.", size: "half", login: true },
  { id: "calls", name: "Calls", desc: "Calls going on in your groups, to jump in.", size: "half", login: true },
  { id: "sales", name: "Game sales", desc: "Games on the Games list that are on sale.", size: "half", login: true },
  { id: "mychannel", name: "Your channel", desc: "Subscribers, views and watch time of your own channel.", size: "half" },
  { id: "docs", name: "Recent docs", desc: "The documents you worked on last.", size: "half" },
  { id: "due", name: "Due on your boards", desc: "Cards with a due date coming up.", size: "half" },
  { id: "notes", name: "Notifications", desc: "The newest from the bell.", size: "half" },
  { id: "stats", name: "Your stats", desc: "Files converted, hours and your favorite format.", size: "half" },
  { id: "recent", name: "Recent downloads", desc: "The last things you converted.", size: "half" },
];
const HW_BY_ID = Object.fromEntries(HW_WIDGETS.map((w) => [w.id, w]));
const HW_DEFAULT = ["live", "paste", "channels", "online", "activity", "chat", "sales", "docs", "stats", "recent"];
const HW_ICONS = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  wide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  narrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h6M15 12h6M6 8l4 4-4 4M18 8l-4 4 4 4"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

const hwSlot = (id) => document.querySelector(`#homeWidgets > .hw[data-w="${id}"]`);
const hwThere = (id) => !!hwSlot(id); // (a widget whose part of the app isn't in this version)
const hwLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();
let hwEditing = false;

// ---------------------------------------------------------------- the layout: {order: [ids], wide: {id: true/false}}

function hwKey() { return hwLoggedIn() ? "u:" + sfxUser().username.toLowerCase() : ""; }
function hwLayout() {
  const saved = (loadPref("homeWidgets") || {})[hwKey()];
  const order = saved && Array.isArray(saved.order) ? saved.order.filter((id, i, all) => HW_BY_ID[id] && all.indexOf(id) === i) : HW_DEFAULT.slice();
  // Widgets that came with an update are added once, where they'd be in a fresh layout.
  if (saved && Array.isArray(saved.known)) {
    for (const id of HW_DEFAULT) {
      if (!saved.known.includes(id) && !order.includes(id)) order.splice(Math.min(HW_DEFAULT.indexOf(id), order.length), 0, id);
    }
  }
  return { order, wide: (saved && saved.wide) || {} };
}
function hwSave(layout) {
  const all = { ...(loadPref("homeWidgets") || {}) };
  all[hwKey()] = { order: layout.order, wide: layout.wide, known: HW_WIDGETS.map((w) => w.id) };
  savePref("homeWidgets", all);
}
function hwIsWide(w, layout) {
  if ((w.sizes || ["half", "full"]).length === 1) return w.size === "full";
  return w.id in layout.wide ? !!layout.wide[w.id] : w.size === "full";
}

// Put the widgets in order, show the ones you picked (and that may show now), size them.
function hwApply() {
  const grid = $("homeWidgets");
  const layout = hwLayout();
  const loggedIn = !!(homeData ? homeData.loggedIn : hwLoggedIn());
  const showing = layout.order.filter(hwThere);
  // Logged out: the widgets that need an account give way to one "Log in" card, where the first of them was.
  const firstLogin = showing.find((id) => HW_BY_ID[id].login);
  const nodes = [];
  for (const id of showing) {
    if (id === firstLogin && !loggedIn) nodes.push($("homeCrewOut"));
    nodes.push(hwSlot(id));
  }
  for (const w of HW_WIDGETS) if (hwThere(w.id) && !showing.includes(w.id)) nodes.push(hwSlot(w.id));
  nodes.push($("homeCrewOut"));
  setChildren(grid, [...new Set(nodes)]);
  for (const w of HW_WIDGETS) {
    const slot = hwSlot(w.id);
    if (!slot) continue;
    const on = showing.includes(w.id);
    slot.classList.toggle("hw-off", !on);
    slot.classList.toggle("hw-needs-login", on && !!w.login && !loggedIn);
    slot.classList.toggle("wide", hwIsWide(w, layout));
  }
  $("homeCrewOut").hidden = loggedIn || !firstLogin || hwEditing;
  $("homeCrewOut").classList.add("wide");
  if (hwEditing) hwDrawEdit(layout);
}

// ---------------------------------------------------------------- Customize

function hwSetEditing(on) {
  hwEditing = on;
  $("homeWidgets").classList.toggle("hw-editing", on);
  $("hwBar").hidden = !on;
  $("hwTray").hidden = !on;
  $("homeCustomize").hidden = on;
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
      if ((w.sizes || ["half", "full"]).length > 1) {
        const size = Object.assign(document.createElement("button"), { type: "button", className: "hw-size" });
        size.addEventListener("click", () => hwToggleWide(w.id));
        tools.append(size);
      }
      const x = Object.assign(document.createElement("button"), { type: "button", className: "hw-x", innerHTML: HW_ICONS.x, title: "Take it off Home" });
      x.addEventListener("click", () => hwRemove(w.id));
      tools.append(x);
      slot.prepend(tools);
    }
    const size = tools.querySelector(".hw-size");
    if (size) {
      const wide = hwIsWide(w, layout);
      size.innerHTML = wide ? HW_ICONS.narrow : HW_ICONS.wide;
      size.title = wide ? "Make it narrow" : "Make it wide";
    }
  }
  // The tray: the widgets that aren't on Home.
  const off = HW_WIDGETS.filter((w) => hwThere(w.id) && !layout.order.includes(w.id));
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
  hwSave(layout);
  hwFlip(() => hwApply());
  hwDrawAll();
}
function hwAdd(id) {
  hwChange((l) => { l.order = [...l.order.filter((x) => x !== id), id]; });
  const slot = hwSlot(id);
  if (slot) { slot.classList.add("hw-new"); setTimeout(() => slot.classList.remove("hw-new"), 900); slot.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}
function hwRemove(id) { hwChange((l) => { l.order = l.order.filter((x) => x !== id); }); }
function hwToggleWide(id) { hwChange((l) => { l.wide[id] = !hwIsWide(HW_BY_ID[id], l); }); }

$("homeCustomize").addEventListener("click", () => hwSetEditing(true));
$("hwDone").addEventListener("click", () => hwSetEditing(false));
$("hwReset").addEventListener("click", () => {
  const all = { ...(loadPref("homeWidgets") || {}) };
  delete all[hwKey()];
  savePref("homeWidgets", all);
  hwFlip(() => hwApply());
  hwDrawAll();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && hwEditing && !$("homeTab").hidden && !document.querySelector(".modal:not([hidden])")) hwSetEditing(false);
});

// Widgets glide to their new places instead of jumping (FLIP: note where they were, move, then slide).
function hwFlip(move) {
  const slots = [...$("homeWidgets").children];
  const before = new Map(slots.map((el) => [el, el.getBoundingClientRect()]));
  move();
  if (typeof reduceMotion !== "undefined" && reduceMotion.matches) return;
  for (const el of slots) {
    const a = before.get(el), b = el.getBoundingClientRect();
    if (!a.width || !b.width || el.classList.contains("hw-dragging")) continue;
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform .32s var(--ease-out)";
      el.style.transform = "";
      setTimeout(() => { el.style.transition = ""; }, 340);
    });
  }
}

// ---------------------------------------------------------------- dragging a widget by its handle

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
  hwDrag = { slot, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, last: 0 };
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
  if (Date.now() - d.last < 60) return;
  // The widget under the pointer: go before it on its left/top half, after it on the other half.
  const others = [...$("homeWidgets").querySelectorAll(":scope > .hw:not(.hw-off):not([hidden]):not(.hw-dragging)")];
  for (const el of others) {
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
    const wide = el.classList.contains("wide");
    const after = wide ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    const target = after ? el.nextElementSibling : el;
    if (target === d.slot || target === d.slot.nextElementSibling) return; // already there
    d.last = Date.now();
    hwFlip(() => $("homeWidgets").insertBefore(d.slot, target));
    return;
  }
}

function hwDragEnd() {
  const d = hwDrag;
  hwDrag = null;
  removeEventListener("pointermove", hwDragMove);
  document.documentElement.classList.remove("hw-grabbing");
  if (!d) return;
  const r = d.slot.getBoundingClientRect();
  d.ghost.classList.add("hw-ghost-drop");
  Object.assign(d.ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  setTimeout(() => { d.ghost.remove(); d.slot.classList.remove("hw-dragging"); }, 200);
  const layout = hwLayout();
  const placed = [...$("homeWidgets").querySelectorAll(":scope > .hw[data-w]:not(.hw-off)")].map((el) => el.dataset.w).filter((id) => HW_BY_ID[id]);
  // The widgets on the page take the new order; ones that aren't on the page right now keep their spot.
  const queue = placed.slice();
  layout.order = layout.order.map((id) => placed.includes(id) ? queue.shift() : id);
  hwSave(layout);
}

// ---------------------------------------------------------------- the widgets' own content

const hwOn = (id) => !$("homeTab").hidden && hwThere(id) && (hwEditing || hwLayout().order.includes(id));
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
  hwDrawCalls();
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
  setChildren($("hwCalls"), rows.length ? rows : [hwEmpty("Nobody's in a call right now. Start one from any chat.", "Open the chat", () => openChat(""))]);
}
setInterval(() => { if (!document.hidden) hwDrawCalls(); }, 4000);
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
  if (hwCh.mode === "none") return setChildren(box, [hwEmpty("Add your channel to see how it's doing.", "Add my channel", () => showTab("channel"))]);
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
  setChildren($("hwDocs"), top.length ? top.map((d) => hwRow({
    face: hwEl("span", "hw-doc-icon " + (d.where === "collab" ? "collab" : "")),
    title: d.title || "Untitled", sub: [kinds[d.kind] || "Document", d.where === "collab" ? "Shared" : "", when(d) ? sfxAgo(when(d)) : ""].filter(Boolean).join(" · "),
    onclick: () => qkOpenDoc(d.where, d.id) }))
    : [hwEmpty("No documents yet.", "Write one", () => showTab("docs"))]);
}
$("hwDocsOpen").addEventListener("click", () => showTab("docs"));

// ---- boards due

let hwDue = null, hwDueAt = 0;
async function hwDrawDue() {
  if (!hwOn("due")) return;
  if (Date.now() - hwDueAt > 60000) {
    hwDueAt = Date.now();
    const res = await api("/api/boards-due", {}).catch(() => null);
    if (res && res.ok) hwDue = res.cards;
  }
  if (!hwDue) return;
  const date = (v) => new Date(v.length <= 10 ? v + "T12:00" : v);
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
  setChildren($("hwNotes"), list.length ? list.map((n) => noteRow(n)) : [hwEmpty("Nothing new. Messages, invitations, sales and new POVs show up here.")]);
}
$("hwNotesOpen").addEventListener("click", (e) => { e.stopPropagation(); noteToggle(true); });
// The bell's list changes: the widget follows.
if (typeof noteDraw === "function") {
  const drawBell = noteDraw;
  noteDraw = function () { drawBell(); hwDrawNotes(); };
}

$("hwStatsHistory").addEventListener("click", () => showTab("history"));

// ---------------------------------------------------------------- start

hwApply();
hwDrawAll();
