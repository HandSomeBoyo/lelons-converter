// Games on the phone: the shared list of games to record (the same one as the PC app's Games page),
// with sales, votes, moving a game along (Idea, Recording, Done) and comments.
// Adding a game needs Steam, which the phone can't ask directly: it asks your PC to do it.
"use strict";

const G = { list: null, seg: store.get("gamesSeg", "idea"), comments: null, loading: false };
const GAME_SEGS = [["idea", "Ideas"], ["recording", "Recording"], ["done", "Done"]];

function openGames() {
  S.view = { kind: "games" };
  renderGamesView();
  loadGameList();
}

async function loadGameList() {
  if (G.loading) return;
  G.loading = true;
  try { G.list = ((await rpcMe("lelons_games", { what: "list" })) || {}).games || []; S.games = G.list; }
  catch (e) { toast(e.message); G.list = G.list || []; }
  G.loading = false;
  if (S.view && (S.view.kind === "games" || S.view.kind === "game")) renderGamesView();
}

const gameSale = (g) => g.info && (g.info.free || (g.info.price && g.info.price.discount > 0));
function gamePrice(g, big) {
  const i = g.info || {};
  if (i.free) return `<span class="g-free">Free</span>`;
  if (!i.price) return i.soon ? `<span class="muted">Coming soon</span>` : "";
  return i.price.discount ? `<span class="g-off">-${i.price.discount}%</span> <b>${esc(i.price.text)}</b>${big && i.price.was ? ` <s class="muted">${esc(i.price.was)}</s>` : ""}`
    : `<span class="${big ? "" : "muted"}">${esc(i.price.text)}</span>`;
}

function renderGamesView() {
  if (S.view.kind === "game") return renderGame();
  const L = G.list;
  let body = '<div class="spin"></div>';
  if (L) {
    const list = L.filter((g) => g.status === G.seg);
    const sale = L.filter((g) => g.status !== "done" && gameSale(g));
    body = `<div class="seg">${GAME_SEGS.map(([k, n]) => `<button data-gseg="${k}" class="${G.seg === k ? "on" : ""}">${n} <span class="segn">${L.filter((g) => g.status === k).length}</span></button>`).join("")}</div>
      ${G.seg === "idea" && sale.length ? `<div class="lbl">On sale now</div><div class="games">${sale.map((g) => gameCard(g)).join("")}</div>` : ""}
      <div class="lbl">${G.seg === "idea" ? "Most votes first" : G.seg === "recording" ? "Being recorded" : "Finished videos"}</div>
      ${list.length ? `<div class="card list">${list.sort((a, b) => b.voters.length - a.voters.length || b.created - a.created).map(gameRow).join("")}</div>`
        : `<div class="empty">${G.seg === "idea" ? "No game ideas yet." : G.seg === "recording" ? "Nothing being recorded right now." : "No finished games yet."}</div>`}
      <button class="wide-btn" data-gact="add">${DI.plus}<span>Add a game from Steam</span></button>`;
  }
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><b>Games</b></div></div>
    <div class="scroll">${body}</div></div>`;
  $("#back").onclick = closeView;
  $("#app").onclick = gamesClick;
  afterRender();
}

function gameCard(g) {
  return `<button class="game" data-game="${esc(g.id)}">${g.info.header ? `<img src="${esc(g.info.header)}" loading="lazy" alt="">` : `<div class="ph">${esc(initials(g.info.name))}</div>`}
    ${g.info.price && g.info.price.discount ? `<span class="sale">-${g.info.price.discount}%</span>` : g.info.free ? `<span class="sale">Free</span>` : ""}
    <div class="gi"><b class="one">${esc(g.info.name)}</b><div class="sm muted">${g.info.price ? esc(g.info.price.text) : ""}</div></div></button>`;
}

function gameRow(g) {
  const voters = g.voters || [];
  return `<button class="row grow-row" data-game="${esc(g.id)}">
    <div class="g-pic">${g.info.header ? `<img src="${esc(g.info.header)}" loading="lazy" alt="">` : esc(initials(g.info.name))}</div>
    <div class="grow"><b class="one" style="display:block">${esc(g.info.name)}</b>
      <div class="sm one">${gamePrice(g)}${(g.info.players || []).length ? ` <span class="muted">· ${esc(g.info.players[0])}</span>` : ""}</div>
      <div class="xs muted one">${g.by ? "Added by " + esc(g.by) : ""}${g.comments ? ` · ${g.comments} comment${g.comments === 1 ? "" : "s"}` : ""}</div></div>
    <span class="vote ${g.voted ? "on" : ""}" data-gvote="${esc(g.id)}">${GI.up}<b>${voters.length}</b></span></button>`;
}

function renderGame() {
  const g = (G.list || []).find((x) => x.id === S.view.id);
  if (!g) { S.view = { kind: "games" }; return renderGamesView(); }
  const i = g.info || {};
  const C = G.comments;
  $("#app").innerHTML = `<div class="screen has-top">
    <div class="top"><button class="back" id="back">${I.back}</button><div class="grow"><b class="one">${esc(i.name)}</b></div></div>
    <div class="scroll">
      <div class="g-hero">${i.header ? `<img src="${esc(i.header)}" alt="">` : `<div class="ph">${esc(initials(i.name))}</div>`}</div>
      <h2 class="g-name">${esc(i.name)}</h2>
      <div class="g-meta">${gamePrice(g, true)}${i.reviews ? ` <span class="muted">· ${esc(i.reviews.text)}</span>` : ""}</div>
      ${(i.genres || []).length || (i.players || []).length ? `<div class="chips g-chips">${[...(i.players || []), ...(i.genres || [])].slice(0, 6).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
      <div class="card list" style="margin-top:14px">
        <div class="row"><div class="grow"><b>Votes</b><div class="sm muted one">${(g.voters || []).map((v) => esc(v.username)).join(", ") || "Nobody yet"}</div></div>
          <button class="btn2 ${g.voted ? "" : "go"}" data-gvote="${esc(g.id)}">${g.voted ? "Voted" : "Vote"}</button></div>
        <div class="row"><div class="grow"><b>Status</b></div>
          <div class="seg mini">${GAME_SEGS.map(([k, n]) => `<button data-gstatus="${k}" class="${g.status === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
        ${g.note ? `<div class="row"><div class="grow"><b>Note</b><div class="sm">${esc(g.note)}</div></div></div>` : ""}
      </div>
      ${i.short ? `<p class="g-about">${esc(i.short)}</p>` : ""}
      ${(i.screens || []).length ? `<div class="g-shots">${i.screens.map((s) => `<img src="${esc(s.thumb)}" loading="lazy" alt="">`).join("")}</div>` : ""}
      <div class="lbl">Comments</div>
      <div class="card list">${C === null ? '<div class="spin"></div>' : C.length ? C.map((c) => `<div class="row" style="align-items:flex-start">${avatar(c.by, publicUrl(c.avatar), { small: true })}
        <div class="grow"><b class="sm">${esc(c.by || "?")}</b> <span class="xs muted">${timeOf(new Date(c.created * 1000).toISOString())}</span><div class="sm">${esc(c.text)}</div></div></div>`).join("")
        : '<div class="row"><div class="grow sm muted">No comments yet.</div></div>'}</div>
      <div class="g-say"><input class="field" id="gsay" maxlength="500" placeholder="Write a comment" enterkeyhint="send"><button class="send" data-gact="comment" aria-label="Send">${I.send}</button></div>
      <a class="wide-btn" href="https://store.steampowered.com/app/${Number(g.app_id)}" target="_blank" rel="noopener">Open in Steam</a>
    </div></div>`;
  $("#back").onclick = () => { S.view = { kind: "games" }; feelNav("out"); renderGamesView(); };
  $("#app").onclick = gamesClick;
  const say = $("#gsay");
  say.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); gameComment(g); } };
  if (C === null) loadGameComments(g.id);
  afterRender();
}

async function loadGameComments(id) {
  try { G.comments = ((await rpcMe("lelons_games", { what: "comments", game_id: id })) || {}).comments || []; }
  catch { G.comments = []; }
  if (S.view && S.view.kind === "game" && S.view.id === id) renderGame();
}

async function gameComment(g) {
  const box = $("#gsay");
  const text = box.value.trim();
  if (!text) return;
  box.value = "";
  try {
    await rpcMe("lelons_games", { what: "comment", game_id: g.id, data: { text } });
    g.comments = (g.comments || 0) + 1;
    loadGameComments(g.id);
  } catch (e) { box.value = text; toast(e.message); }
}

function gameUpdate(fresh) {
  if (!fresh || !fresh.id) return;
  const i = G.list.findIndex((x) => x.id === fresh.id);
  if (i >= 0) G.list[i] = fresh;
}

async function gamesClick(e) {
  const t = e.target.closest("[data-gvote],[data-game],[data-gseg],[data-gstatus],[data-gact]");
  if (!t) return;
  if (t.dataset.gvote) {
    e.stopPropagation();
    const g = G.list.find((x) => x.id === t.dataset.gvote);
    if (!g) return;
    try { gameUpdate(await rpcMe("lelons_games", { what: "vote", game_id: g.id, data: { on: !g.voted } })); } catch (err) { toast(err.message); }
    return renderGamesView();
  }
  if (t.dataset.game) { feelNav("in"); S.view = { kind: "game", id: t.dataset.game }; G.comments = null; return renderGame(); }
  if (t.dataset.gseg) { G.seg = t.dataset.gseg; store.set("gamesSeg", G.seg); return renderGamesView(); }
  if (t.dataset.gstatus) {
    const g = G.list.find((x) => x.id === S.view.id);
    if (!g || g.status === t.dataset.gstatus) return;
    try { gameUpdate(await rpcMe("lelons_games", { what: "status", game_id: g.id, data: { status: t.dataset.gstatus } })); } catch (err) { toast(err.message); }
    return renderGame();
  }
  if (t.dataset.gact === "comment") return gameComment(G.list.find((x) => x.id === S.view.id));
  if (t.dataset.gact === "add") return sendToPcSheet({ kind: "game" });
}

const GI = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
};
