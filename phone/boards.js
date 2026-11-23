// Boards on the phone: your team boards (the same ones as the PC app's Boards page). Swipe between
// lists, open a card to read it, tick its checklists, write on it, move it to another list, add cards.
// Saving works like the PC app: if someone saved in between, both changes are put together.
"use strict";

const B = { list: null, board: null, base: null, rev: 0, id: null, list_i: 0, card: null, saving: false, again: false, timer: 0, poll: 0 };

const B_BGS = {
  blue: "#0c66e4", orange: "#c25100", green: "#1f845a", red: "#c9372c", purple: "#6e5dc6", pink: "#ae4787", lime: "#4c6b1f", sky: "#227d9b", grey: "#626f86",
  ocean: "linear-gradient(135deg, #0c66e4 0%, #37b4c3 100%)", dusk: "linear-gradient(135deg, #6e5dc6 0%, #e774bb 100%)",
  sunset: "linear-gradient(135deg, #e2483d 0%, #f5cd47 100%)", forest: "linear-gradient(135deg, #1f845a 0%, #94c748 100%)",
  night: "linear-gradient(135deg, #172b4d 0%, #44546f 100%)", candy: "linear-gradient(135deg, #e774bb 0%, #fea362 100%)",
  aurora: "linear-gradient(135deg, #0055cc 0%, #6e5dc6 50%, #e774bb 100%)",
};
const B_HUES = {
  green: ["#baf3db", "#4bce97", "#1f845a"], yellow: ["#f8e6a0", "#f5cd47", "#946f00"], orange: ["#fedec8", "#fea362", "#c25100"],
  red: ["#ffd5d2", "#f87168", "#c9372c"], purple: ["#dfd8fd", "#9f8fef", "#6e5dc6"], blue: ["#cce0ff", "#579dff", "#0c66e4"],
  sky: ["#c6edfb", "#6cc3e0", "#227d9b"], lime: ["#d3f1a7", "#94c748", "#5b7f24"], pink: ["#fdd0ec", "#e774bb", "#ae4787"],
  black: ["#dcdfe4", "#8590a2", "#626f86"],
};
const bBg = (key) => (typeof key === "string" && /^pic:https:\/\//.test(key)) ? `#2c333a url("${key.slice(4).replace(/["\\\s]/g, "")}") center / cover` : B_BGS[key] || B_BGS.blue;
const bColor = (key) => { const hue = B_HUES[String(key).slice(0, -1)]; return hue ? hue[+String(key).slice(-1)] || hue[1] : "#8590a2"; };
const bNewId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const bCopy = (x) => JSON.parse(JSON.stringify(x));
const bSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bKeyed = (a) => Array.isArray(a) && a.every((x) => x && typeof x === "object" && "id" in x);
const bLists = () => (B.board.lists || []).filter((l) => !l.archived);
const bCards = (l) => (l.cards || []).filter((c) => !c.archived);
function bFind(id) {
  for (const l of B.board.lists || []) { const c = (l.cards || []).find((x) => x.id === id); if (c) return { list: l, card: c }; }
  return null;
}

// ---------------------------------------------------------------- the list of boards

function openBoards() {
  S.view = { kind: "boards" };
  renderBoardsView();
  loadBoards();
}

async function loadBoards() {
  try { B.list = await rpcMe("lelons_board", { what: "list" }); } catch (e) { toast(e.message); B.list = B.list || { boards: [], invites: [] }; }
  if (S.view && S.view.kind === "boards") renderBoardsView();
}

function renderBoardsView() {
  if (S.view.kind === "board") return renderBoard();
  if (S.view.kind === "card") return renderCard();
  const L = B.list;
  let body = '<div class="spin"></div>';
  if (L) {
    const boards = [...(L.boards || [])].sort((a, b) => (b.starred - a.starred) || (b.opened || 0) - (a.opened || 0));
    body = `${(L.invites || []).length ? `<div class="lbl">Invitations</div><div class="card list">${L.invites.map((x) => `<div class="row">
        <span class="b-sw" style="background:${bBg(x.bg)}"></span><div class="grow"><b class="one" style="display:block">${esc(x.title)}</b><div class="sm muted">${esc(x.from)} invited you</div></div>
        <button class="btn2" data-bact="no" data-id="${esc(x.id)}">No</button><button class="btn2 go" data-bact="join" data-id="${esc(x.id)}">Join</button></div>`).join("")}</div>` : ""}
      ${boards.length ? `<div class="b-grid">${boards.map((x) => `<button class="b-tile" data-board="${esc(x.id)}" style="background:${bBg(x.bg)}">
          <b>${esc(x.title)}</b><span>${x.cards} card${x.cards === 1 ? "" : "s"}${(x.people || []).length > 1 ? ` · ${x.people.length} people` : ""}</span>${x.starred ? '<i class="b-star">★</i>' : ""}</button>`).join("")}</div>`
        : `<div class="empty">No team boards yet. Make one on your PC and it shows up here.</div>`}
      <div class="muted sm" style="padding:14px 4px">Boards you only keep on your PC aren't here. Share a board with your team on the PC to see it on the phone.</div>`;
  }
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><b>Boards</b></div></div>
    <div class="scroll">${body}</div></div>`;
  $("#back").onclick = closeView;
  $("#app").onclick = boardsClick;
  afterRender();
}

// ---------------------------------------------------------------- a board

async function openBoard(id) {
  S.view = { kind: "board", id };
  B.board = null; B.id = id; B.list_i = store.get("bList:" + id, 0);
  renderBoard();
  try {
    const r = await rpcMe("lelons_board", { what: "open", board_id: id });
    if (!S.view || S.view.id !== id) return;
    B.board = r.board; B.base = bCopy(r.board); B.rev = r.rev; B.people = r.people || [];
  } catch (e) { toast(e.message); S.view = { kind: "boards" }; return renderBoardsView(); }
  renderBoard();
  clearTimeout(B.poll);
  B.poll = setTimeout(boardPoll, 5000);
}

// Someone else changed it: take theirs (the phone saves straight away, so there's rarely anything of ours waiting).
async function boardPoll() {
  if (!S.view || !["board", "card"].includes(S.view.kind) || !B.board) return;
  if (!document.hidden && !B.saving && !B.timer) {
    try {
      const r = await rpcMe("lelons_board", { what: "check", board_id: B.id, base_rev: B.rev });
      if (r.board && r.rev !== B.rev && !B.saving && !B.timer) {
        B.board = r.board; B.base = bCopy(r.board); B.rev = r.rev;
        const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
        if (!typing) (S.view.kind === "card" ? renderCard : renderBoard)();
      }
    } catch { /* next time */ }
  }
  B.poll = setTimeout(boardPoll, document.hidden ? 20000 : 5000);
}

function renderBoard() {
  const b = B.board;
  const lists = b ? bLists() : [];
  if (B.list_i >= lists.length) B.list_i = Math.max(0, lists.length - 1);
  $("#app").innerHTML = `<div class="screen has-top b-screen" style="--bbg:${b ? bBg(b.bg) : "#1c1c1e"}">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><b class="one">${b ? esc(b.title) : "Opening..."}</b></div>
      <div class="dhere">${(B.people || []).slice(0, 4).map((p) => avatar(p.username, publicUrl(p.avatar), { small: true })).join("")}</div></div>
    ${b ? `<div class="b-tabs">${lists.map((l, i) => `<button data-blist="${i}" class="${i === B.list_i ? "on" : ""}">${esc(l.title)} <span>${bCards(l).length}</span></button>`).join("")}</div>
      <div class="b-lists" id="blists">${lists.map((l) => `<section class="b-list">
        <div class="b-cards">${bCards(l).map(cardTile).join("") || '<div class="b-none">No cards</div>'}
          <button class="b-add" data-badd="${esc(l.id)}">${DI.plus}<span>Add a card</span></button></div></section>`).join("") || '<div class="empty">This board has no lists yet.</div>'}</div>`
      : '<div class="spin"></div>'}
  </div>`;
  $("#back").onclick = async () => { await boardSaveNow(); clearTimeout(B.poll); S.view = { kind: "boards" }; feelNav("out"); renderBoardsView(); loadBoards(); };
  $("#app").onclick = boardsClick;
  const box = $("#blists");
  if (box) {
    box.scrollLeft = B.list_i * box.clientWidth;
    let t = 0;
    box.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const i = Math.round(box.scrollLeft / box.clientWidth);
        if (i !== B.list_i) { B.list_i = i; store.set("bList:" + B.id, i); document.querySelectorAll(".b-tabs button").forEach((x, k) => x.classList.toggle("on", k === i)); const on = document.querySelector(".b-tabs .on"); if (on) on.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }
      }, 80);
    });
  }
  afterRender();
}

function cardTile(c) {
  const labels = (c.labels || []).map((id) => (B.board.labels || []).find((l) => l.id === id)).filter(Boolean);
  const items = (c.checklists || []).flatMap((x) => x.items || []);
  const done = items.filter((x) => x.done).length;
  const due = c.due ? new Date(c.due) : null;
  const late = due && !c.done && due < new Date();
  return `<button class="b-card" data-bcard="${esc(c.id)}">
    ${labels.length ? `<div class="b-labels">${labels.map((l) => `<i style="background:${bColor(l.color)}">${esc(l.name || "")}</i>`).join("")}</div>` : ""}
    <b class="${c.done ? "b-done" : ""}">${c.done ? "✓ " : ""}${esc(c.title)}</b>
    ${due || items.length || c.desc || (c.comments || []).length || (c.members || []).length ? `<div class="b-meta">
      ${due ? `<span class="${c.done ? "ok" : late ? "late" : ""}">${BI.clock}${due.toLocaleDateString([], { day: "numeric", month: "short" })}</span>` : ""}
      ${items.length ? `<span class="${done === items.length ? "ok" : ""}">${BI.check}${done}/${items.length}</span>` : ""}
      ${c.desc ? `<span>${BI.lines}</span>` : ""}
      ${(c.comments || []).length ? `<span>${BI.chat}${c.comments.length}</span>` : ""}
      ${(c.members || []).length ? `<span class="b-who">${c.members.slice(0, 3).map((m) => avatar(m, "", { small: true })).join("")}</span>` : ""}
    </div>` : ""}</button>`;
}

// ---------------------------------------------------------------- a card

function renderCard() {
  const f = B.board && bFind(S.view.card);
  if (!f) { S.view = { kind: "board", id: B.id }; return renderBoard(); }
  const { list, card: c } = f;
  const labels = (c.labels || []).map((id) => (B.board.labels || []).find((l) => l.id === id)).filter(Boolean);
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><div class="sm muted one">${esc(B.board.title)} · ${esc(list.title)}</div></div></div>
    <div class="scroll">
      <textarea class="dtitle" id="ctitle" rows="1" maxlength="300">${esc(c.title)}</textarea>
      ${labels.length ? `<div class="b-labels big">${labels.map((l) => `<i style="background:${bColor(l.color)}">${esc(l.name || "")}</i>`).join("")}</div>` : ""}
      <div class="card list">
        <button class="srow" data-bact="done"><span class="b-tick ${c.done ? "on" : ""}">${c.done ? "✓" : ""}</span><div class="grow">${c.done ? "Done" : "Mark as done"}</div></button>
        <button class="srow" data-bact="move"><span class="sico" style="background:#0a84ff">${BI.move}</span><div class="grow">Move<div class="sm muted">In ${esc(list.title)}</div></div><span class="chev">›</span></button>
        ${c.due ? `<div class="srow"><span class="sico" style="background:#ff9f0a">${BI.clock}</span><div class="grow">Due<div class="sm muted">${new Date(c.due).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div></div>` : ""}
        ${(c.members || []).length ? `<div class="srow"><span class="sico" style="background:#5e5ce6">${BI.people}</span><div class="grow">${c.members.map(esc).join(", ")}</div></div>` : ""}
      </div>
      <div class="lbl">Description</div>
      <textarea class="field b-desc" id="cdesc" placeholder="Add more details" maxlength="20000">${esc(c.desc || "")}</textarea>
      ${(c.checklists || []).map((cl) => { const n = cl.items.length, d = cl.items.filter((x) => x.done).length; return `<div class="lbl">${esc(cl.title)} <span class="muted">${d}/${n}</span></div>
        <div class="b-bar"><i style="width:${n ? Math.round(d / n * 100) : 0}%"></i></div>
        <div class="card list">${cl.items.map((it) => `<button class="srow" data-bitem="${esc(cl.id)}:${esc(it.id)}"><span class="b-tick ${it.done ? "on" : ""}">${it.done ? "✓" : ""}</span><div class="grow ${it.done ? "b-done" : ""}">${esc(it.text)}</div></button>`).join("")}</div>`; }).join("")}
      ${(c.links || []).length ? `<div class="lbl">Links</div><div class="card list">${c.links.map((l) => `<a class="srow" href="${esc(/^https?:\/\//.test(l.url || "") ? l.url : "#")}" target="_blank" rel="noopener"><div class="grow one">${esc(l.name || l.url)}</div><span class="chev">›</span></a>`).join("")}</div>` : ""}
      <div class="lbl">Comments</div>
      <div class="card list">${(c.comments || []).length ? [...c.comments].map((m) => `<div class="row" style="align-items:flex-start">${avatar(m.who || m.by || "?", "", { small: true })}<div class="grow"><b class="sm">${esc(m.who || m.by || "?")}</b> <span class="xs muted">${m.at ? timeOf(new Date(m.at).toISOString()) : ""}</span><div class="sm">${esc(m.text)}</div></div></div>`).join("")
        : '<div class="row"><div class="grow sm muted">No comments yet.</div></div>'}</div>
      <div class="g-say"><input class="field" id="csay" maxlength="2000" placeholder="Write a comment" enterkeyhint="send"><button class="send" data-bact="comment" aria-label="Send">${I.send}</button></div>
    </div></div>`;
  $("#back").onclick = () => { S.view = { kind: "board", id: B.id }; feelNav("out"); renderBoard(); };
  $("#app").onclick = boardsClick;
  const t = $("#ctitle"), d = $("#cdesc");
  const grow = (el) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  grow(t); grow(d);
  t.oninput = () => { t.value = t.value.replace(/\n/g, " "); grow(t); };
  t.onchange = () => boardChange((c2) => { if (t.value.trim()) c2.title = t.value.trim(); }, c.id);
  d.oninput = () => grow(d);
  d.onchange = () => boardChange((c2) => { c2.desc = d.value; }, c.id);
  $("#csay").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); boardComment(c.id); } };
  afterRender();
}

function boardComment(cardId) {
  const box = $("#csay");
  const text = box.value.trim();
  if (!text) return;
  box.value = "";
  boardChange((c) => { c.comments = c.comments || []; c.comments.unshift({ id: bNewId(), who: (S.me || {}).username || "", text, at: Date.now() }); }, cardId);  // (newest first, like the PC)
  renderCard();
}

// A change to the board (to one card, if cardId): made on our copy, then saved.
function boardChange(fn, cardId) {
  if (cardId) { const f = bFind(cardId); if (!f) return; fn(f.card, f.list); }
  else fn();
  clearTimeout(B.timer);
  B.timer = setTimeout(boardSave, 250);
}

async function boardSave() {
  clearTimeout(B.timer); B.timer = 0;
  if (!B.board) return;
  if (B.saving) { B.again = true; return; }
  B.saving = true;
  const sent = bCopy(B.board);
  try {
    const r = await rpcMe("lelons_board", { what: "save", board_id: B.id, data: sent, base_rev: B.rev });
    if (r.conflict) {
      // Someone saved in between: theirs + our changes, then save again.
      B.board = bMerge(B.base, sent, r.board);
      B.base = bCopy(r.board); B.rev = r.rev;
      B.saving = false;
      if (S.view && S.view.kind === "board") renderBoard();
      return boardSave();
    }
    B.rev = r.rev; B.base = sent;
  } catch (e) { toast(e.message); }
  B.saving = false;
  if (B.again) { B.again = false; boardSave(); }
}
async function boardSaveNow() { if (B.timer) await boardSave(); while (B.saving) await new Promise((r) => setTimeout(r, 40)); }

// Things only one side changed take that side's change; when both changed the same thing, ours wins (same as the PC).
function bMerge(base, mine, theirs) {
  if (bSame(mine, base)) return theirs === undefined ? undefined : bCopy(theirs);
  if (bSame(theirs, base) || bSame(mine, theirs)) return mine === undefined ? undefined : bCopy(mine);
  if (mine === undefined || theirs === undefined) return mine === undefined ? undefined : bCopy(mine);
  if (bKeyed(mine) && bKeyed(theirs) && bKeyed(base || [])) return bMergeList(base || [], mine, theirs);
  if (mine && theirs && typeof mine === "object" && typeof theirs === "object" && !Array.isArray(mine) && !Array.isArray(theirs)) {
    const b = base && typeof base === "object" && !Array.isArray(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) { const v = bMerge(b[k], mine[k], theirs[k]); if (v !== undefined) out[k] = v; }
    return out;
  }
  return bCopy(mine);
}
function bMergeList(base, mine, theirs) {
  const b = new Map(base.map((x) => [x.id, x])), m = new Map(mine.map((x) => [x.id, x])), t = new Map(theirs.map((x) => [x.id, x]));
  const order = bSame(mine.map((x) => x.id), base.map((x) => x.id)) ? theirs : mine;
  const other = order === theirs ? mine : theirs;
  const out = [];
  const pick = (id) => {
    if (b.has(id) && (!m.has(id) || !t.has(id))) return undefined;
    if (!b.has(id)) return bCopy(m.get(id) || t.get(id));
    return bMerge(b.get(id), m.get(id), t.get(id));
  };
  for (const x of order) { const v = pick(x.id); if (v !== undefined) out.push(v); }
  other.forEach((x, i) => {
    if (b.has(x.id) || out.some((y) => y.id === x.id)) return;
    const before = other.slice(0, i).reverse().find((y) => out.some((z) => z.id === y.id));
    out.splice(before ? out.findIndex((z) => z.id === before.id) + 1 : 0, 0, bCopy(x));
  });
  return out;
}

// ---------------------------------------------------------------- taps

function bSheet(title, rows) {
  const el = document.createElement("div");
  el.className = "sheet-wrap";
  el.innerHTML = `<div class="sheet glass"><div class="sheet-grab"></div><b class="sheet-t">${esc(title)}</b>${rows}<button class="sheet-x" data-sx>Cancel</button></div>`;
  document.getElementById("app").appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-sx]")) el.remove(); });
  return el;
}

async function boardsClick(e) {
  const t = e.target.closest("[data-board],[data-bcard],[data-blist],[data-badd],[data-bitem],[data-bact]");
  if (!t) return;
  if (t.dataset.board) return openBoard(t.dataset.board);
  if (t.dataset.bcard) { feelNav("in"); S.view = { kind: "card", id: B.id, card: t.dataset.bcard }; return renderCard(); }
  if (t.dataset.blist) { const box = $("#blists"); B.list_i = +t.dataset.blist; store.set("bList:" + B.id, B.list_i); document.querySelectorAll(".b-tabs button").forEach((x, k) => x.classList.toggle("on", k === B.list_i)); box.scrollTo({ left: B.list_i * box.clientWidth, behavior: "smooth" }); return; }
  if (t.dataset.badd) {
    const listId = t.dataset.badd;
    const l0 = B.board.lists.find((x) => x.id === listId);
    const sheet = bSheet("New card in " + (l0 ? l0.title : "this list"), `<textarea class="field sheet-in" id="bnew" rows="2" maxlength="300" placeholder="What needs doing?" enterkeyhint="done"></textarea>
      <button class="btn" data-bnew>Add card</button>`);
    const box = sheet.querySelector("#bnew");
    const add = () => {
      const title = box.value.replace(/\s+/g, " ").trim();
      if (!title) return box.focus();
      sheet.remove();
      boardChange(() => {
        const l = B.board.lists.find((x) => x.id === listId);
        if (!l) return;
        l.cards = l.cards || [];
        l.cards.push({ id: bNewId(), title: title.slice(0, 300), desc: "", labels: [], members: [], start: "", due: "", done: false, checklists: [], links: [], comments: [], cover: "", created: Date.now(), log: [] });
      });
      renderBoard();
    };
    sheet.querySelector("[data-bnew]").onclick = add;
    box.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } };
    setTimeout(() => box.focus(), 50);
    return;
  }
  if (t.dataset.bitem) {
    const [cl, it] = t.dataset.bitem.split(":");
    boardChange((c) => { const x = (c.checklists.find((y) => y.id === cl) || { items: [] }).items.find((y) => y.id === it); if (x) x.done = !x.done; }, S.view.card);
    return renderCard();
  }
  const act = t.dataset.bact;
  if (act === "done") { boardChange((c) => { c.done = !c.done; }, S.view.card); return renderCard(); }
  if (act === "comment") return boardComment(S.view.card);
  if (act === "move") {
    const f = bFind(S.view.card);
    const sheet = bSheet("Move to", bLists().map((l) => `<button class="sheet-row ${l.id === f.list.id ? "on" : ""}" data-to="${esc(l.id)}">${esc(l.title)}${l.id === f.list.id ? " ✓" : ""}</button>`).join(""));
    sheet.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-to]");
      if (!b) return;
      sheet.remove();
      if (b.dataset.to === f.list.id) return;
      boardChange(() => {
        const from = bFind(S.view.card);
        from.list.cards = from.list.cards.filter((x) => x.id !== from.card.id);
        const to = B.board.lists.find((x) => x.id === b.dataset.to);
        to.cards = [from.card, ...(to.cards || [])];
      });
      toast("Moved to " + (B.board.lists.find((x) => x.id === b.dataset.to) || {}).title);
      renderCard();
    });
    return;
  }
  if (act === "join" || act === "no") {
    try { await rpcMe("lelons_board", { what: "answer", board_id: t.dataset.id, data: act === "join" }); } catch (err) { toast(err.message); }
    if (act === "join") return openBoard(t.dataset.id);
    return loadBoards();
  }
}

const BI = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 3 3 5-6"/></svg>',
  lines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
};
