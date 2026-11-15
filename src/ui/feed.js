// The Friends page: what everyone made and did lately, newest first, by day. Their new YouTube uploads,
// POVs they shared, games they posted, voted for, started recording or finished, sounds they put in the
// Library and changes on the team boards you're on. Click a face for their profile, a video to watch it,
// a game or board to open it, a sound to hear it. The side bar shows how many new things there are,
// and new videos or games being recorded also go to the bell.
// Uses $, api(), clock(), setDrag(), DRAG_HINT from app.js, setChildren()/keptNode() from motion.js,
// showTab() from images.js, avatarEl(), sfxAgo(), sfxUser(), openLogin(), SFX_ICONS, CAT_NAMES from
// sfx.js/profile.js, profileLink() from profile.js, openWatch() from watch.js, homeConvert() from home.js,
// openGame()/gmGames from games.js, qkOpenBoard() from quick.js, bdBg() from boards.js, notifyAdd() from notify.js.

const FD_SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const FD_KINDS = {
  video: { name: "Videos", one: "YouTube", icon: FD_SVG('<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 9.5v5l4-2.5z"/>') },
  pov: { name: "POVs", one: "POVs", icon: FD_SVG('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>') },
  game: { name: "Games", one: "Games", icon: FD_SVG('<path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.9 4.4a2.4 2.4 0 0 1-4.1 1.1L13.6 15.5h-3.2l-2.3 2.4a2.4 2.4 0 0 1-4.1-1.1l-.9-4.4A4.5 4.5 0 0 1 7.5 7z"/><path d="M8 10v3M6.5 11.5h3"/>') },
  sound: { name: "Sounds", one: "Library", icon: FD_SVG('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>') },
  board: { name: "Boards", one: "Boards", icon: FD_SVG('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M8 8v7M12 8v4M16 8v9"/>') },
  joined: { name: "New people", one: "Crew", icon: FD_SVG('<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>') },
};
const FD_FILTERS = ["all", "video", "pov", "game", "sound", "board"];
const FD_PERIODS = [[1, "Today"], [3, "Last 3 days"], [7, "This week"], [14, "Last 2 weeks"]];
const FD_GROUP_GAP = 3 * 3600; // a friend's sounds or board changes this close together go in one row

let fdData = null;       // {me, items, channels, loading}
let fdError = "";
let fdTimer = 0;
let fdTries = 0;         // looks again soon while YouTube channels are still loading
let fdFilter = "all";
let fdWho = "";          // only this person ("" for everyone)
let fdPlaying = null;
const fdEls = new Map();
const fdOpts = () => ({ days: 7, mine: false, ...(loadPref("feedOpts") || {}) });
const fdAudio = new Audio();
fdAudio.addEventListener("ended", () => { fdPlaying = null; drawFeed(); });
registerPlayer(fdAudio, () => { fdAudio.pause(); fdPlaying = null; drawFeed(); });
for (const type of ["play", "pause"]) fdAudio.addEventListener(type, () => { if (fdPlaying) drawFeed(); });

const fdLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();
const fdTabOpen = () => !$("feedTab").hidden;
function fdEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
const fdB = (t) => fdEl("b", "", t);

// ---------------------------------------------------------------- loading

let fdRun = 0;
async function loadFeed() {
  clearTimeout(fdTimer);
  if (!fdLoggedIn()) return;
  const mine = ++fdRun;
  const res = await api("/api/sfx-feed", { days: Math.max(fdOpts().days, 7) }).catch(() => ({ ok: false, error: "Couldn't load what your friends did." }));
  if (mine !== fdRun) return;
  if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return renderFeedPage();
  if (res.ok) {
    fdData = res;
    fdError = "";
    fdNotify(res);
  } else {
    fdError = res.error || "Couldn't load what your friends did.";
  }
  if (fdTabOpen()) fdMarkSeen();
  fdDrawBadge();
  if (fdTabOpen()) drawFeed();
  // Again in a moment while YouTube channels are still loading, else every minute while you're looking.
  const soon = res.ok && res.loading && fdTries++ < 12;
  if (!soon) fdTries = 0;
  if (fdTabOpen()) fdTimer = setTimeout(() => { if (fdTabOpen() && !document.hidden) loadFeed(); }, soon ? 3000 : 60000);
  else if (soon) fdTimer = setTimeout(loadFeed, 3000);
}

function renderFeedPage() {
  if (!fdTabOpen()) return;
  const inside = fdLoggedIn();
  $("fdOut").hidden = inside;
  $("fdMain").hidden = !inside;
  if (inside) drawFeed();
}

async function feedTabChanged(tab) {
  if (tab !== "feed") {
    clearTimeout(fdTimer);
    if (fdPlaying) { fdAudio.pause(); fdPlaying = null; }
    return;
  }
  renderFeedPage();
  if (typeof sfxAccount !== "undefined" && (!sfxAccount || sfxFromCache)) await loadAccount();
  renderFeedPage();
  fdMarkSeen();
  fdDrawBadge();
  loadFeed();
}

let fdUserId = null;
function feedAccountChanged() {
  const id = fdLoggedIn() ? sfxUser().id : null;
  if (id === fdUserId) return renderFeedPage();
  fdUserId = id;
  fdData = null;
  fdWho = "";
  fdEls.clear();
  fdDrawBadge();
  if (!id) return renderFeedPage();
  if (fdTabOpen()) feedTabChanged("feed");
  else setTimeout(fdCheck, 8000);
}

// Opens the page, maybe for one person only (from their profile).
function openFeed(who) {
  fdWho = who || "";
  fdFilter = "all";
  if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
  showTab("feed");
  drawFeed();
}

// ---------------------------------------------------------------- what's new (side bar and bell)

const fdFriends = (items) => (items || []).filter((i) => !i.me);

function fdMarkSeen() {
  if (!fdData) return;
  const newest = Math.max(0, ...fdFriends(fdData.items).map((i) => +i.at || 0));
  if (newest > (+loadPref("feedSeen") || 0)) savePref("feedSeen", newest);
}

function fdDrawBadge() {
  const badge = $("feedTabBadge");
  const seen = +loadPref("feedSeen") || 0;
  const n = fdData && fdLoggedIn() && !fdTabOpen() ? fdFriends(fdData.items).filter((i) => i.at > seen && i.kind !== "board").length : 0;
  const text = n > 9 ? "9+" : String(n);
  if (n && badge.textContent !== text) { badge.classList.remove("fresh"); void badge.offsetWidth; badge.classList.add("fresh"); }
  badge.hidden = !n;
  badge.textContent = n ? text : "";
  badge.title = n ? `${n} new from your friends` : "";
}

// New uploads and games friends started recording (or finished) go to the bell too. The first look
// only remembers where things are, so last week's videos don't all ring at once.
function fdNotify(res) {
  if (typeof notifyAdd !== "function") return;
  const noted = +loadPref("feedNoted") || 0;
  let newest = noted;
  for (const i of fdFriends(res.items)) {
    newest = Math.max(newest, +i.at || 0);
    if (!noted || i.at <= noted) continue;
    if (i.kind === "video") {
      notifyAdd({ key: "feed:video:" + i.id, stamp: 1, kind: "friends", title: `${i.username} posted a video`, text: i.title,
        pic: i.thumbnail || "", at: i.at * 1000, open: { tab: "feed" } });
    } else if (i.kind === "game" && (i.what === "recording" || i.what === "done")) {
      notifyAdd({ key: `feed:game:${i.id}:${i.what}`, stamp: 1, kind: "friends",
        title: i.what === "done" ? `${i.username} finished recording` : `${i.username} started recording`, text: i.name,
        pic: i.header || "", at: i.at * 1000, open: { tab: "games" } });
    }
  }
  if (newest > noted) savePref("feedNoted", newest);
}

// Now and then, for the side bar and the bell (the page itself looks every minute while it's open).
function fdCheck() {
  if (!fdLoggedIn() || document.hidden || fdTabOpen()) return;
  loadFeed();
}
setTimeout(fdCheck, 25000);
setInterval(fdCheck, 240000);

// ---------------------------------------------------------------- what's shown

function fdDayStart(daysAgo = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime() / 1000;
}

function fdDayName(at) {
  const today = fdDayStart();
  if (at >= today) return "Today";
  if (at >= today - 86400) return "Yesterday";
  const d = new Date(at * 1000);
  if (at >= today - 6 * 86400) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

// The items for the period, with friends' sounds and board changes close together put in one row.
function fdItems() {
  if (!fdData) return [];
  const o = fdOpts();
  const since = o.days === 1 ? fdDayStart() : Date.now() / 1000 - o.days * 86400;
  const rows = [];
  const groups = new Map(); // what a row is about -> the row (so later ones join it)
  for (const i of fdData.items) {
    if (i.at < since || (i.me && !o.mine)) continue;
    // a friend's sounds, a friend's changes on one board, everyone who wants to record the same game
    const key = i.kind === "sound" ? "s" + i.username : i.kind === "board" ? "b" + i.username + i.id
      : i.kind === "game" && i.what === "voted" ? "v" + i.id : "";
    const row = key && groups.get(key);
    if (row && row.many[row.many.length - 1].at - i.at < (i.kind === "game" ? 86400 : FD_GROUP_GAP)
        && fdDayName(row.at) === fdDayName(i.at)) {
      row.many.push(i);
      continue;
    }
    const fresh = { ...i, many: [i] };
    if (key) groups.set(key, fresh);
    rows.push(fresh);
  }
  return rows;
}

function drawFeed() {
  if (!fdTabOpen() || !fdLoggedIn()) return;
  const all = fdItems();
  const o = fdOpts();

  // Filters, with how many of each.
  const count = (k) => all.filter((r) => (!fdWho || r.username === fdWho) && (k === "all" || r.kind === k)).length;
  setChildren($("fdPills"), FD_FILTERS.map((k) => keptNode(fdEls, "pill" + k, [k, fdFilter === k, count(k)].join(), () => {
    const b = fdEl("button", "gm-pill" + (fdFilter === k ? " active" : ""));
    b.type = "button";
    if (k !== "all") b.innerHTML = FD_KINDS[k].icon;
    b.append(k === "all" ? "Everything" : FD_KINDS[k].name);
    const n = count(k);
    if (n) b.append(fdEl("small", "", String(n)));
    b.onclick = () => { fdFilter = k; drawFeed(); };
    return b;
  })));
  $("fdPeriod").value = String(o.days);
  $("fdMine").classList.toggle("on", o.mine);
  $("fdMine").setAttribute("aria-pressed", o.mine);

  // Who was busy: everyone with something in the period, busiest first. Click to see only them.
  const people = new Map();
  for (const r of all) {
    const p = people.get(r.username) || { username: r.username, avatarUrl: r.avatarUrl, n: 0, today: 0 };
    p.n += r.many.length;
    if (!p.avatarUrl && r.avatarUrl) p.avatarUrl = r.avatarUrl;
    people.set(r.username, p);
  }
  const busy = [...people.values()].sort((a, b) => b.n - a.n || a.username.localeCompare(b.username));
  if (fdWho && !people.has(fdWho)) busy.unshift({ username: fdWho, avatarUrl: "", n: 0 });
  $("fdPeople").hidden = !busy.length;
  setChildren($("fdPeopleList"), busy.map((p) => keptNode(fdEls, "who" + p.username, [p.username, p.avatarUrl, p.n, fdWho === p.username, !!fdWho].join(), () => {
    const b = fdEl("button", "fd-person" + (fdWho === p.username ? " on" : fdWho ? " dim" : ""));
    b.type = "button";
    b.title = fdWho === p.username ? "Show everyone again" : `Only ${p.username}`;
    const face = fdEl("span", "fd-person-face");
    face.append(avatarEl(p.avatarUrl, p.username, "big"));
    if (p.n) face.append(fdEl("i", "", p.n > 99 ? "99+" : String(p.n)));
    b.append(face, fdEl("span", "", p.username));
    b.onclick = () => { fdWho = fdWho === p.username ? "" : p.username; drawFeed(); };
    return b;
  })));
  $("fdPeopleClear").hidden = !fdWho;

  // The list, by day.
  const shown = all.filter((r) => (!fdWho || r.username === fdWho) && (fdFilter === "all" || r.kind === fdFilter));
  const nodes = [];
  let day = "";
  for (const r of shown) {
    const name = fdDayName(r.at);
    if (name !== day) {
      day = name;
      nodes.push(keptNode(fdEls, "day" + name, name, () => fdEl("h3", "fd-day", name)));
    }
    const playing = r.kind === "sound" && r.many.some((s) => s.id === fdPlaying);
    const sig = JSON.stringify([r.many.map((x) => [x.id, x.at, x.text, x.what]), r.username, r.avatarUrl, sfxAgo(r.at * 1000),
      playing && fdPlaying, playing && fdAudio.paused]);
    nodes.push(keptNode(fdEls, r.kind + (r.id || "") + r.username + r.at + (r.what || ""), sig, () => fdRow(r)));
  }
  setChildren($("fdList"), nodes);

  const loading = !fdData && !fdError;
  $("fdLoading").hidden = !loading;
  $("fdError").hidden = !fdError || !!fdData;
  $("fdError").textContent = fdError;
  const empty = !loading && !shown.length && !!fdData;
  $("fdEmpty").hidden = !empty;
  if (empty) {
    const who = fdWho || "your friends";
    const when = o.days === 1 ? "today" : FD_PERIODS.find((p) => p[0] === o.days)[1].toLowerCase();
    $("fdEmptyTitle").textContent = fdFilter === "all" ? `Nothing from ${who} ${when === "today" ? "yet today" : when}`
      : `No ${FD_KINDS[fdFilter].name.toLowerCase()} from ${who} ${when}`;
  }
  $("fdYt").hidden = !(fdData && fdData.loading);
}

// One row: a face, what they did, when, and something to click (a video, a game, a sound...).
function fdRow(r) {
  const row = fdEl("div", "fd-item k-" + r.kind);
  const face = profileLink(avatarEl(r.avatarUrl, r.username, "big"), r.username);
  const kind = fdEl("i", "fd-kind k-" + r.kind);
  kind.innerHTML = FD_KINDS[r.kind].icon;
  const faceBox = fdEl("span", "fd-face");
  faceBox.append(face, kind);
  const text = fdEl("div", "fd-text");
  const line = fdEl("p");
  const who = profileLink(fdB(r.me ? "You" : r.username), r.username);
  const meta = fdEl("small", "", FD_KINDS[r.kind].one + " · " + fdWhen(r.at));
  text.append(line, meta);
  row.append(faceBox, text);

  if (r.kind === "video") {
    line.append(who, " posted a new video");
    const title = fdEl("button", "fd-title", r.title);
    title.type = "button";
    title.onclick = () => openWatch(r.url, { title: r.title, sub: r.channel });
    text.insertBefore(title, meta);
    meta.textContent = [r.channel, r.views != null ? shortNumber(r.views) + " views" : "", fdWhen(r.at)].filter(Boolean).join(" · ");
    const get = fdEl("button", "small-button fd-get", "Download");
    get.type = "button";
    get.title = "Get it as MP3 or MP4";
    get.onclick = () => homeConvert(r.url, false);
    text.append(get);
    row.append(fdThumb(r.thumbnail, r.seconds, "Watch it", () => openWatch(r.url, { title: r.title, sub: r.channel }), true));
  } else if (r.kind === "pov") {
    line.append(who, " shared a POV");
    const title = fdEl("button", "fd-title", r.title);
    title.type = "button";
    title.onclick = () => fdGo("povs");
    text.insertBefore(title, meta);
    meta.textContent = [r.game, r.seconds ? clock(r.seconds, false) : "", fdWhen(r.at)].filter(Boolean).join(" · ");
    row.append(fdThumb(r.thumb, r.seconds, "Go to POVs", () => fdGo("povs")));
  } else if (r.kind === "game") {
    const game = fdB(r.name);
    const say = {
      posted: [" posted ", " to record"], voted: [" wants to record ", ""], recording: [" started recording ", " 🔴"],
      done: [" finished recording ", " ✅"], comment: [" said something about ", ""],
    }[r.what] || [" did something with ", ""];
    if (r.what === "voted" && r.many.length > 1) {
      const names = [...new Set(r.many.map((v) => v.username))];
      line.append(who);
      for (const [n, name] of names.slice(1, 3).entries()) {
        line.append(names.length <= 3 && n === names.length - 2 ? " and " : ", ", profileLink(fdB(name), name));
      }
      if (names.length > 3) line.append(` and ${names.length - 3} more`);
      line.append(" want to record ", game);
    } else line.append(who, say[0], game, say[1]);
    if (r.what === "comment" && r.text) text.insertBefore(fdEl("q", "fd-quote", r.text), meta);
    if (r.what === "done" && r.video) {
      const watch = fdEl("button", "small-button fd-get", "Watch the video");
      watch.type = "button";
      watch.onclick = () => openWatch(r.video, { title: r.name, sub: r.username });
      text.append(watch);
    }
    row.append(fdThumb(r.header, 0, "Open the game", () => fdOpenGame(r.id), false, "game"));
  } else if (r.kind === "sound") {
    const one = r.many.length === 1;
    line.append(who, one ? " added " : ` added ${r.many.length} sounds to the Library`);
    if (one) line.append(fdB(r.name), " to the Library");
    else meta.textContent = "Library · " + fdWhen(r.at);
    const list = fdEl("div", "fd-sounds");
    for (const s of r.many.slice(0, 6)) {
      const on = fdPlaying === s.id && !fdAudio.paused;
      const b = fdEl("button", "fd-sound" + (fdPlaying === s.id ? " playing" : ""));
      b.type = "button";
      b.title = (on ? "Pause" : "Play") + " · " + DRAG_HINT;
      const play = fdEl("span", "fd-play");
      play.innerHTML = on ? SFX_ICONS.pause : SFX_ICONS.play;
      b.append(play, fdEl("b", "", s.name), fdEl("small", "", [s.genre || CAT_NAMES[s.category] || "SFX", clock(s.seconds, false)].join(" · ")));
      b.onclick = () => fdPlay(s);
      setDrag(b, { kind: "sound", url: s.url, name: s.name });
      list.append(b);
    }
    if (r.many.length > 6) {
      const more = fdEl("button", "link fd-more", `+ ${r.many.length - 6} more in the Library`);
      more.type = "button";
      more.onclick = () => fdGo("sfx");
      list.append(more);
    }
    text.insertBefore(list, meta);
  } else if (r.kind === "board") {
    const board = fdB(r.title);
    if (r.many.length === 1) line.append(who, " " + r.text.replace(/ this board$/, "") + " on ", board);
    else line.append(who, ` made ${r.many.length} changes on `, board);
    if (r.many.length > 1) {
      const list = fdEl("ul", "fd-changes");
      for (const c of r.many.slice(0, 3)) list.append(fdEl("li", "", c.text));
      if (r.many.length > 3) list.append(fdEl("li", "fd-more-line", `and ${r.many.length - 3} more`));
      text.insertBefore(list, meta);
    }
    const swatch = fdEl("button", "fd-board");
    swatch.type = "button";
    swatch.title = "Open the board";
    swatch.style.background = typeof bdBg === "function" ? bdBg(r.bg) : "";
    swatch.append(fdEl("span", "", r.title));
    swatch.onclick = () => fdOpenBoard(r.id);
    row.append(swatch);
  } else if (r.kind === "joined") {
    line.append(who, r.me ? " joined the crew" : " joined the crew 👋");
  }
  return row;
}

function fdWhen(at) {
  const ago = sfxAgo(at * 1000);
  return at >= fdDayStart() - 86400 && /day/.test(ago) ? new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ago;
}

function fdThumb(src, seconds, title, onclick, play, cls = "") {
  const b = fdEl("button", "fd-thumb" + (cls ? " " + cls : ""));
  b.type = "button";
  b.title = title;
  if (src) {
    const img = fdEl("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = src;
    img.onerror = () => img.remove();
    b.append(img);
  }
  if (seconds) b.append(fdEl("i", "fd-len", clock(seconds, false)));
  if (play) b.append(Object.assign(fdEl("span", "fd-thumb-play"), { innerHTML: SFX_ICONS.play }));
  b.onclick = onclick;
  return b;
}

function fdPlay(s) {
  if (fdPlaying === s.id && fdAudio.src) {
    if (!fdAudio.paused) return fdAudio.pause();
  } else {
    fdAudio.src = s.url;
    fdPlaying = s.id;
  }
  fdAudio.play().catch(() => {});
  drawFeed();
}

function fdGo(tab) {
  if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
  showTab(tab);
}

// The Games tab loads its list when it opens: wait for the game to be there.
async function fdOpenGame(id) {
  fdGo("games");
  for (let i = 0; i < 40; i++) {
    if (typeof gmGames !== "undefined" && gmGames.some((g) => g.id === id)) return openGame(id);
    await new Promise((done) => setTimeout(done, 150));
  }
}

function fdOpenBoard(id) {
  if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
  if (typeof qkOpenBoard === "function") qkOpenBoard(id, true);
  else showTab("boards");
}

// ---------------------------------------------------------------- the controls

$("fdPeriod").addEventListener("change", () => {
  savePref("feedOpts", { ...fdOpts(), days: +$("fdPeriod").value });
  drawFeed();
  if (+$("fdPeriod").value > 7) loadFeed();
});
$("fdMine").addEventListener("click", () => { savePref("feedOpts", { ...fdOpts(), mine: !fdOpts().mine }); drawFeed(); });
$("fdPeopleClear").addEventListener("click", () => { fdWho = ""; drawFeed(); });
$("fdLogin").addEventListener("click", () => openLogin("login"));
document.addEventListener("visibilitychange", () => { if (fdTabOpen() && !document.hidden) loadFeed(); });
setInterval(() => { if (fdTabOpen() && !document.hidden) drawFeed(); }, 60000); // ("5 min ago")
if (fdTabOpen()) feedTabChanged("feed");
