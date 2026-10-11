// The Games tab: Steam games friends post to maybe record for YouTube, with Steam's picture,
// price and description. Everyone logged in sees the same list (lelons_games in sfx/setup.sql).
// Uses $, api() from app.js, sfxUser()/avatarEl()/sfxAgo()/openLogin()/loadAccount() from sfx.js.

const GM_STATUS = [
  { key: "", name: "All" }, { key: "idea", name: "Ideas" }, { key: "recording", name: "Recording" }, { key: "done", name: "Done" },
];
const GM_STATUS_ONE = { idea: "Idea", recording: "Recording", done: "Done" };
const GM_CHIPS = [
  { key: "free", name: "Free", test: (g) => g.info.free },
  { key: "sale", name: "On sale", test: (g) => g.info.price && g.info.price.discount > 0 },
  { key: "coop", name: "Co-op", test: (g) => (g.info.players || []).some((p) => /co-op|multi/i.test(p)) },
  { key: "wanted", name: "I want these", test: (g) => g.voted },
];
const gmSvg = (d, fill) => `<svg viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const GM_ICONS = {
  thumb: gmSvg('<path d="M7 11v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7 11l4-7.5a2 2 0 0 1 2.6 2.2L13 10h5.6a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.3 20H7"/>'),
  thumbOn: gmSvg('<path d="M7 11v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7 11l4-7.5a2 2 0 0 1 2.6 2.2L13 10h5.6a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.3 20H7z"/>', true),
  chat: gmSvg('<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>'),
  close: gmSvg('<path d="M6 6l12 12M18 6L6 18"/>'),
  steam: gmSvg('<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  play: gmSvg('<path d="M8 5.5v13l11-6.5z"/>', true),
  trash: gmSvg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
  refresh: gmSvg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>'),
  pencil: gmSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  people: gmSvg('<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.5c2.4.2 4 1.7 4.5 4.5"/>'),
};

let gmGames = [], gmStatus = "", gmChips = new Set(), gmQuery = "", gmOpen = null, gmLoading = false, gmTimer = 0, gmUserId = null, gmShot = 0;
const gmEl = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const gmButton = (cls, html, text, onclick) => {
  const b = gmEl("button", cls);
  b.type = "button";
  if (html) b.innerHTML = html;
  if (text) b.append(text);
  if (onclick) b.addEventListener("click", onclick);
  return b;
};
const gmAgo = (secs) => sfxAgo(secs * 1000);
const gmCents = (g) => (g.info.free ? 0 : g.info.price ? g.info.price.cents : Infinity);
const gmReviewKind = (r) => (!r ? "" : r.percent >= 70 ? "good" : r.percent >= 40 ? "mixed" : "bad");
const gmLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();

// ---- loading

async function loadGames(quiet) {
  if (gmLoading) return;
  gmLoading = true;
  const res = await api("/api/games-list", {}).catch(() => ({ ok: false, error: "Couldn't load the games." }));
  gmLoading = false;
  if (!res.ok) {
    if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return renderGamesPage();
    if (!quiet) { $("gmStatus").textContent = res.error; $("gmStatus").hidden = false; }
    return;
  }
  $("gmStatus").hidden = true;
  gmGames = res.games;
  renderGamesPage();
  if (gmOpen) {
    const fresh = gmGames.find((g) => g.id === gmOpen.id);
    if (fresh) { gmOpen = fresh; drawGameSide(); } else closeGame();
  }
}

// Others post and vote too: look again every 30 seconds while the tab is open.
function gmPoll() {
  clearTimeout(gmTimer);
  gmTimer = setTimeout(async () => {
    if ($("gamesTab").hidden || !gmLoggedIn()) return;
    if (!document.hidden && document.activeElement !== $("gmLink")) await loadGames(true);
    gmPoll();
  }, 30000);
}

function renderGamesPage() {
  const loggedIn = gmLoggedIn();
  $("gmOut").hidden = loggedIn;
  $("gmMain").hidden = !loggedIn;
  if (loggedIn) renderGames();
}

// ---- the list

function renderGamePills() {
  const pill = (s) => {
    const n = s.key ? gmGames.filter((g) => g.status === s.key).length : gmGames.length;
    const b = gmButton("gm-pill" + (gmStatus === s.key ? " active" : "") + (s.key ? " " + s.key : ""), "", "", () => { gmStatus = s.key; renderGames(); });
    if (s.key) b.append(gmEl("i", "gm-dot"));
    b.append(gmEl("span", "", s.name), gmEl("small", "", String(n)));
    return b;
  };
  $("gmPills").replaceChildren(...GM_STATUS.map(pill));
  $("gmChips").replaceChildren(...GM_CHIPS.map((c) => gmButton("gm-chip" + (gmChips.has(c.key) ? " on" : ""), "", c.name, () => {
    if (gmChips.has(c.key)) gmChips.delete(c.key); else gmChips.add(c.key);
    renderGames();
  })));
}

function gmPrice(info, big) {
  const box = gmEl("div", "gm-price" + (big ? " big" : ""));
  if (info.free) { box.append(gmEl("strong", "free", "Free")); return box; }
  const p = info.price;
  if (!p) { box.append(gmEl("strong", "none", info.soon ? "Coming soon" : "No price")); return box; }
  if (p.discount) box.append(gmEl("span", "gm-off", "-" + p.discount + "%"));
  const col = gmEl("span", "gm-amounts");
  if (p.was) col.append(gmEl("s", "", p.was));
  col.append(gmEl("strong", p.discount ? "sale" : "", p.text));
  box.append(col);
  return box;
}

function gmReviews(r, short) {
  const el = gmEl("span", "gm-reviews " + gmReviewKind(r), short ? `${r.percent}% liked it` : r.text);
  el.title = `${r.percent}% of ${r.total.toLocaleString()} reviews are positive`;
  return el;
}

function gmVoteButton(game, big) {
  const b = gmButton("gm-vote" + (game.voted ? " on" : "") + (big ? " big" : ""), game.voted ? GM_ICONS.thumbOn : GM_ICONS.thumb, "", (e) => {
    e.stopPropagation();
    gmVote(game);
  });
  b.title = game.voted ? "You want to record this (click to take it back)" : "I want to record this";
  if (big) b.append(game.voted ? "You want to record this" : "I want to record this");
  b.append(gmEl("b", "", String(game.voters.length)));
  return b;
}

function gameCard(game) {
  const { info } = game;
  const card = gmEl("article", "gm-card " + game.status);
  card.tabIndex = 0;
  const pic = gmEl("div", "gm-pic");
  const img = gmEl("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = info.header;
  img.addEventListener("error", () => { img.remove(); pic.classList.add("none"); pic.textContent = info.name; });
  pic.append(img);
  if (game.status !== "idea") {
    const tag = gmEl("span", "gm-tag " + game.status);
    tag.append(gmEl("i", "gm-dot"), GM_STATUS_ONE[game.status]);
    pic.append(tag);
  }
  if (info.price && info.price.discount) pic.append(gmEl("span", "gm-sale", "-" + info.price.discount + "%"));

  const body = gmEl("div", "gm-body");
  body.append(gmEl("h3", "", info.name));
  const kinds = [...(info.genres || []).filter((x) => !/^(indie|early access|free to play)$/i.test(x)).slice(0, 2)];
  const coop = (info.players || []).find((p) => /co-op/i.test(p)) || (info.players || []).find((p) => /multi/i.test(p));
  if (coop) kinds.push(coop);
  if ((info.genres || []).some((x) => /early access/i.test(x))) kinds.push("Early Access");
  body.append(gmEl("p", "gm-kinds", kinds.join(" · ") || (info.type === "dlc" ? "DLC" : "Game")));
  body.append(gmEl("p", "gm-short", info.short));
  if (game.note) {
    const note = gmEl("div", "gm-note-line");
    note.append(avatarEl(game.byAvatar, game.by || "?"), gmEl("span", "", game.note));
    body.append(note);
  }

  const foot = gmEl("div", "gm-foot");
  foot.append(gmPrice(info));
  if (info.reviews) foot.append(gmReviews(info.reviews, true));
  foot.append(gmEl("span", "gm-grow"), gmVoteButton(game));

  const by = gmEl("p", "gm-by");
  by.append(`Posted by ${game.by || "someone"} · ${gmAgo(game.created)}`);
  if (game.comments) {
    const c = gmEl("span", "gm-count");
    c.innerHTML = GM_ICONS.chat;
    c.append(String(game.comments));
    c.title = game.comments === 1 ? "1 comment" : game.comments + " comments";
    by.append(c);
  }
  card.append(pic, body, foot, by);
  card.addEventListener("click", () => openGame(game.id));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") openGame(game.id); });
  return card;
}

function renderGames() {
  renderGamePills();
  const q = gmQuery.trim().toLowerCase(), sort = $("gmSort").value;
  let list = gmGames.filter((g) => (!gmStatus || g.status === gmStatus)
    && GM_CHIPS.every((c) => !gmChips.has(c.key) || c.test(g))
    && (!q || [g.info.name, g.info.short, g.note, g.by, ...(g.info.genres || []), ...(g.info.developers || [])].join(" ").toLowerCase().includes(q)));
  const by = {
    votes: (a, b) => b.voters.length - a.voters.length || b.created - a.created,
    cheap: (a, b) => gmCents(a) - gmCents(b) || a.info.name.localeCompare(b.info.name),
    reviews: (a, b) => ((b.info.reviews || {}).percent || 0) - ((a.info.reviews || {}).percent || 0),
    new: (a, b) => b.created - a.created,
  };
  list = list.slice().sort(by[sort] || by.new);
  $("gmGrid").replaceChildren(...list.map(gameCard));
  $("gmEmpty").hidden = list.length > 0;
  $("gmEmpty").textContent = gmGames.length ? "No games match that. Try another word or filter." : "No games yet. Paste a Steam link above to post the first one.";
}

// ---- posting games

$("gmAdd").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("gmLink").value.trim();
  if (!text) return $("gmLink").focus();
  const many = (text.match(/\/app\/\d+|steam:\/\/|s\.team\/a\//gi) || []).length > 1;
  $("gmAddGo").disabled = true;
  $("gmAddMsg").className = "gm-add-msg";
  $("gmAddMsg").textContent = many ? "Getting the games from Steam..." : "Getting the game from Steam...";
  const res = await api("/api/games-add", { text, note: $("gmNote").value }).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  $("gmAddGo").disabled = false;
  if (!res.ok) {
    if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return renderGamesPage();
    $("gmAddMsg").className = "gm-add-msg bad";
    $("gmAddMsg").textContent = res.error;
    return;
  }
  $("gmLink").value = $("gmNote").value = "";
  const parts = [];
  if (res.added.length) parts.push(res.added.length === 1 ? `Posted ${res.added[0].info.name}.` : `Posted ${res.added.length} games.`);
  if (res.already.length) parts.push(res.already.length === 1 ? `${res.already[0].info.name} was already here (posted by ${res.already[0].by || "someone"}).` : `${res.already.length} were already here.`);
  if (res.failed.length) parts.push(`${res.failed.length} didn't work: ${res.failed[0].error}`);
  $("gmAddMsg").className = "gm-add-msg good";
  $("gmAddMsg").textContent = parts.join(" ");
  gmStatus = "";
  await loadGames();
  const first = res.added[0] || res.already[0];
  const card = first && [...$("gmGrid").children].find((c) => c.querySelector("h3") && c.querySelector("h3").textContent === first.info.name);
  if (card) { card.classList.add("fresh"); card.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
});
$("gmLink").addEventListener("input", () => { $("gmAddMsg").textContent = ""; });

async function gmVote(game) {
  const on = !game.voted;
  const res = await api("/api/games-vote", { game: game.id, on }).catch(() => ({ ok: false, error: "Couldn't save that." }));
  if (!res.ok) return alert(res.error);
  gmReplace(res.game);
}

function gmReplace(game) {
  gmGames = gmGames.map((g) => (g.id === game.id ? game : g));
  renderGames();
  if (gmOpen && gmOpen.id === game.id) { gmOpen = game; drawGameSide(); }
}

// ---- one game

async function openGame(id) {
  const game = gmGames.find((g) => g.id === id);
  if (!game) return;
  gmOpen = game;
  gmShot = 0;
  drawGame();
  $("gmModal").hidden = false;
  $("gmDialog").scrollTop = 0;
  loadGameComments();
}

function closeGame() {
  gmOpen = null;
  $("gmModal").hidden = true;
}

function drawGame() {
  const game = gmOpen, { info } = game;
  const box = $("gmDialog");
  const hero = gmEl("div", "gm-hero");
  const pics = info.screens && info.screens.length ? info.screens : [{ thumb: info.header, full: info.header }];
  const big = gmEl("img", "gm-hero-img");
  big.alt = "";
  big.src = pics[Math.min(gmShot, pics.length - 1)].full;
  big.id = "gmHeroImg";
  hero.append(big, gmButton("gm-close", GM_ICONS.close, "", closeGame));

  const shots = gmEl("div", "gm-shots");
  pics.forEach((s, i) => {
    const b = gmButton("gm-shot" + (i === gmShot ? " on" : ""), "", "", () => {
      gmShot = i;
      $("gmHeroImg").src = s.full;
      shots.querySelectorAll(".gm-shot").forEach((x, j) => x.classList.toggle("on", j === i));
    });
    const img = gmEl("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = s.thumb;
    b.append(img);
    shots.append(b);
  });

  const main = gmEl("div", "gm-detail-main");
  main.append(gmEl("h2", "", info.name));
  const sub = [(info.developers || []).join(", "), info.release ? (info.soon ? "Comes out " : "Released ") + info.release : ""].filter(Boolean).join(" · ");
  if (sub) main.append(gmEl("p", "gm-sub", sub));
  main.append(gmEl("p", "gm-about", info.short));
  const tags = gmEl("div", "gm-tags");
  for (const t of [...(info.genres || []), ...(info.players || [])]) tags.append(gmEl("span", "", t));
  main.append(tags);
  if (pics.length > 1) main.append(shots);
  main.append(gmEl("div", "gm-note-box"), gmEl("div", "gm-talk"));

  const side = gmEl("div", "gm-detail-side");
  side.id = "gmSide";
  const cols = gmEl("div", "gm-detail");
  cols.append(main, side);
  box.replaceChildren(hero, cols);
  drawGameSide();
}

// The parts that change when someone votes or moves the game along.
function drawGameSide() {
  const game = gmOpen, { info } = game, side = $("gmSide");
  if (!side) return;
  const buy = gmEl("div", "gm-buy");
  buy.append(gmPrice(info, true));
  buy.append(gmButton("convert small-button gm-steam", GM_ICONS.steam, "Open in Steam", () => api("/api/games-open", { app: game.app_id })));
  if (info.reviews) {
    const r = gmEl("p", "gm-review-line");
    r.append(gmReviews(info.reviews), ` ${info.reviews.percent}% of ${info.reviews.total.toLocaleString()} reviews`);
    buy.append(r);
  }

  const vote = gmEl("div", "gm-side-box");
  vote.append(gmVoteButton(game, true));
  if (game.voters.length) {
    const who = gmEl("div", "gm-voters");
    for (const v of game.voters) { const p = gmEl("span"); p.append(avatarEl(v.avatarUrl, v.username), v.username); who.append(p); }
    vote.append(who);
  }

  const st = gmEl("div", "gm-side-box");
  st.append(gmEl("small", "gm-label", "Where is it at?"));
  const seg = gmEl("div", "gm-seg");
  for (const key of ["idea", "recording", "done"]) {
    const b = gmButton(key + (game.status === key ? " on" : ""), "", "", () => gmSetStatus(key));
    b.append(gmEl("i", "gm-dot"), GM_STATUS_ONE[key]);
    seg.append(b);
  }
  st.append(seg);
  if (game.status === "done") {
    if (game.video) st.append(gmButton("ghost-button gm-watch", GM_ICONS.play, "Watch the video", () => api("/api/games-open", { url: game.video })));
    const row = gmEl("form", "gm-video-row");
    const input = gmEl("input");
    Object.assign(input, { placeholder: "Paste the YouTube link", value: game.video || "", maxLength: 300, spellcheck: false });
    row.append(input, gmButton("small-button", "", "Save"));
    row.querySelector("button").type = "submit";
    row.addEventListener("submit", (e) => { e.preventDefault(); gmSetStatus("done", input.value); });
    st.append(row);
  }

  const facts = gmEl("div", "fx-facts gm-facts");
  const fact = (k, v) => { if (!v) return; const f = gmEl("div"); f.append(gmEl("small", "", k), gmEl("strong", "", v)); facts.append(f); };
  fact("Released", info.release);
  fact("Made by", (info.developers || []).join(", "));
  fact("Posted by", `${game.by || "someone"}, ${gmAgo(game.created)}`);
  fact("Price checked", gmAgo(game.refreshed));

  const tools = gmEl("div", "gm-tools-row");
  tools.append(gmButton("link gm-refresh", GM_ICONS.refresh, "Check the price again", async (e) => {
    e.currentTarget.disabled = true;
    const res = await api("/api/games-refresh", { game: game.id }).catch(() => ({ ok: false, error: "Couldn't reach Steam." }));
    if (!res.ok) return alert(res.error);
    gmReplace(res.game);
    drawGame();
    loadGameComments();
  }));
  if (game.can_edit) {
    tools.append(gmButton("link gm-danger", GM_ICONS.trash, "Delete", async () => {
      if (!confirm(`Take ${info.name} off the list?`)) return;
      const res = await api("/api/games-delete", { game: game.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
      if (!res.ok) return alert(res.error);
      closeGame();
      loadGames();
    }));
  }
  side.replaceChildren(buy, vote, st, facts, tools);
  drawGameNote();
}

function drawGameNote() {
  const game = gmOpen, box = $("gmDialog").querySelector(".gm-note-box");
  if (!box) return;
  box.replaceChildren();
  if (!game.note && !game.can_edit) return;
  const head = gmEl("div", "gm-note-head");
  head.append(gmEl("small", "gm-label", game.note ? `Why ${game.by || "they"} posted it` : "Why you posted it"));
  if (game.can_edit) head.append(gmButton("link", GM_ICONS.pencil, game.note ? "Change" : "Add a note", () => {
    const text = prompt("Why this game? (optional)", game.note || "");
    if (text === null) return;
    api("/api/games-note", { game: game.id, note: text }).then((res) => (res.ok ? gmReplace(res.game) : alert(res.error)));
  }));
  box.append(head);
  if (game.note) {
    const q = gmEl("div", "gm-note-line big");
    q.append(avatarEl(game.byAvatar, game.by || "?"), gmEl("span", "", game.note));
    box.append(q);
  }
}

async function gmSetStatus(status, video) {
  const body = { game: gmOpen.id, status };
  if (video !== undefined) body.video = video;
  const res = await api("/api/games-status", body).catch(() => ({ ok: false, error: "Couldn't save that." }));
  if (!res.ok) return alert(res.error);
  gmReplace(res.game);
}

// ---- talking about it

async function loadGameComments() {
  const game = gmOpen;
  const res = await api("/api/games-comments", { game: game.id }).catch(() => null);
  if (res && res.ok && gmOpen === game) drawGameTalk(res.comments);
}

function drawGameTalk(comments) {
  const box = $("gmDialog").querySelector(".gm-talk");
  if (!box) return;
  const head = gmEl("small", "gm-label", comments.length ? `Talk about it (${comments.length})` : "Talk about it");
  const list = gmEl("div", "gm-comments");
  for (const c of comments) {
    const row = gmEl("div", "gm-comment");
    const text = gmEl("div");
    const who = gmEl("p", "gm-who");
    who.append(gmEl("b", "", c.by || "someone"), gmEl("span", "", gmAgo(c.created)));
    text.append(who, gmEl("p", "", c.text));
    row.append(avatarEl(c.avatarUrl, c.by || "?"), text);
    if (c.mine) row.append(gmButton("gm-x", GM_ICONS.close, "", async () => {
      const res = await api("/api/games-delete-comment", { game: gmOpen.id, comment: c.id }).catch(() => null);
      if (res && res.ok) { drawGameTalk(res.comments); gmCountComments(res.comments.length); }
    }));
    list.append(row);
  }
  const form = gmEl("form", "gm-say");
  const input = gmEl("input");
  Object.assign(input, { placeholder: "Write something...", maxLength: 500 });
  form.append(input, gmButton("small-button", "", "Send"));
  form.querySelector("button").type = "submit";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const res = await api("/api/games-comment", { game: gmOpen.id, text: input.value }).catch(() => ({ ok: false, error: "Couldn't send it." }));
    if (!res.ok) return alert(res.error);
    drawGameTalk(res.comments);
    gmCountComments(res.comments.length);
    const again = $("gmDialog").querySelector(".gm-say input");
    if (again) again.focus();
  });
  box.replaceChildren(head, list, form);
}

function gmCountComments(n) {
  const game = gmGames.find((g) => g.id === (gmOpen && gmOpen.id));
  if (game) { game.comments = n; renderGames(); }
}

$("gmModal").addEventListener("click", (e) => { if (e.target === $("gmModal")) closeGame(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("gmModal").hidden) closeGame(); });
$("gmLogin").addEventListener("click", () => openLogin("login"));
$("gmSearch").addEventListener("input", (e) => { gmQuery = e.target.value; renderGames(); });
$("gmSort").addEventListener("change", renderGames);

// ---- opening the tab

function gamesAccountChanged() {
  const id = gmLoggedIn() ? sfxUser().id : null;
  if (id === gmUserId) return;
  gmUserId = id;
  gmGames = [];
  if (gmOpen) closeGame();
  if (!$("gamesTab").hidden) gamesTabChanged("games");
}

async function gamesTabChanged(tab) {
  if (tab !== "games") { clearTimeout(gmTimer); return; }
  renderGamesPage();
  if (typeof sfxAccount !== "undefined" && (!sfxAccount || sfxFromCache)) await loadAccount();
  renderGamesPage();
  if (gmLoggedIn()) {
    await loadGames();
    gmPoll();
  }
}
if (!$("gamesTab").hidden) gamesTabChanged("games");
