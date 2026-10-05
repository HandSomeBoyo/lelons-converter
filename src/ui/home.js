// The Home page: the crew's YouTube channels, who's around, what's new, and your own stats.
// Uses $, api(), clock(), setDrag(), DRAG_HINT, linksIn() from app.js, showTab() from images.js,
// avatarEl(), sfxAgo(), sfxUser(), openLogin(), SFX_ICONS from sfx.js, openChat() from chat.js,
// openProfile() and CAT_NAMES from profile.js.

let homeData = null;
let homeTimer = null;
let homePlaying = null;
const homeAudio = new Audio();
homeAudio.addEventListener("ended", () => { homePlaying = null; drawHomeSounds(); });
registerPlayer(homeAudio, () => { homeAudio.pause(); homePlaying = null; drawHomeSounds(); });
const homeCards = new Map(); // video id -> {el, sig}
const homeEls = new Map(); // people, sounds, chat and recent files on Home -> {el, sig}
const homeNumbers = new Map(); // channel url -> the subscriber number shown, so it rolls to the new one

function homeVisible() { return !$("homeTab").hidden && !document.hidden; }

async function loadHome() {
  clearTimeout(homeTimer);
  try {
    const res = await api("/api/home", {});
    if (res.ok) {
      homeData = res;
      drawHome();
    }
  } catch (e) { /* the app is closing */ }
  // Again soon while a channel is still loading the first time, else every half a minute.
  const waiting = homeData && homeData.channels.some((c) => c.loading);
  homeTimer = setTimeout(() => { if (homeVisible()) loadHome(); }, waiting ? 2500 : 30000);
}

function openHome() { loadHome(); }
// Logged in or out (or the account changed): the crew part changes.
function homeAccountChanged(someoneElse) {
  if (someoneElse && homeVisible()) loadHome();
  else drawHome();
}
document.addEventListener("visibilitychange", () => { if (homeVisible()) loadHome(); });

// ---- numbers

function shortNumber(n) {
  if (n == null) return "–";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

// A number whose digits roll to their new value, like a counter. New digits roll up from 0.
function rollNumber(el, value) {
  const text = value == null ? "–" : value.toLocaleString();
  if (el.dataset.value === text) return;
  el.dataset.value = text;
  el.setAttribute("aria-label", text);
  const chars = [...text];
  const old = [...el.children];
  setChildren(el, chars.map((c, i) => {
    if (!/\d/.test(c)) return Object.assign(document.createElement("span"), { className: "roll-sep", textContent: c });
    let cell = old[old.length - (chars.length - i)]; // the same place, counted from the right
    const fresh = !cell || cell.className !== "roll-digit";
    if (fresh) {
      cell = document.createElement("span");
      cell.className = "roll-digit";
      cell.innerHTML = "<span>" + [..."0123456789"].map((d) => `<i>${d}</i>`).join("") + "</span>";
    }
    const strip = cell.firstChild;
    const go = () => { strip.style.transform = `translateY(-${Number(c) * 10}%)`; };
    if (fresh) requestAnimationFrame(() => requestAnimationFrame(go));
    else go();
    return cell;
  }));
}

// ---- drawing

function drawHome() {
  const d = homeData;
  if (!d) return;
  if (homeEls.size > 200) homeEls.clear();
  const user = sfxUser();
  $("homeHello").textContent = user ? `Hey ${user.username}.` : "Hey there.";
  drawChannels();
  drawUploads();
  drawCrew();
  drawHomeSounds();
  drawHomeChat();
  drawStats();
  drawRecent();
}

function drawChannels() {
  const d = homeData;
  const known = d.channels.filter((c) => c.info && c.info.subscribers != null);
  const total = known.reduce((sum, c) => sum + c.info.subscribers, 0);
  rollNumber($("homeTotal"), known.length ? total : null);
  $("homeTotalNote").textContent = !d.channels.length ? "No channels picked yet."
    : d.channels.every((c) => c.loading) ? "Looking at the channels..."
    : `subscribers across ${d.channels.length === 1 ? "1 channel" : d.channels.length + " channels"}`;
  $("homeEditChannels").hidden = !d.canEditChannels;

  const list = $("homeChannels");
  const shown = new Set();
  d.channels.forEach((c, i) => {
    shown.add(c.url);
    let card = list.querySelector(`[data-url="${CSS.escape(c.url)}"]`);
    if (!card) {
      card = document.createElement("button");
      card.type = "button";
      card.className = "channel-card";
      card.dataset.url = c.url;
      card.innerHTML = `<span class="channel-face"></span><span class="channel-name"><b></b><small></small></span>
        <span class="channel-subs"><span class="roll"></span><small>subscribers</small></span>`;
      card.addEventListener("click", () => api("/api/open-youtube", { url: c.url }));
      card.style.animationDelay = i * 60 + "ms";
    }
    list.append(card); // keeps the order
    const info = c.info || {};
    const handle = (c.url.match(/\/(@[^/]+)$/) || [])[1] || "";
    card.title = "Open the channel on YouTube";
    card.classList.toggle("loading", !!c.loading);
    card.classList.toggle("failed", !c.info && !!c.error && !c.loading);
    const face = card.querySelector(".channel-face");
    if (face.dataset.src !== (info.avatar || "") || !face.firstChild) {
      face.dataset.src = info.avatar || "";
      face.replaceChildren(avatarEl(info.avatar || "", (info.name || handle.slice(1) || "?"), "big"));
    }
    card.querySelector(".channel-name b").textContent = info.name || handle || c.url;
    card.querySelector(".channel-name small").textContent = c.loading ? "Loading..."
      : !c.info && c.error ? "Couldn't load it right now" : (info.handle || handle);
    rollNumber(card.querySelector(".roll"), info.subscribers == null ? null : info.subscribers);
  });
  [...list.children].forEach((card) => { if (!shown.has(card.dataset.url)) card.remove(); });
}

function drawUploads() {
  const d = homeData;
  const all = [];
  for (const c of d.channels) {
    for (const [i, u] of ((c.info && c.info.uploads) || []).entries()) {
      all.push({ ...u, channel: c.info.name, avatar: c.info.avatar, newest: i === 0 });
    }
  }
  // Newest first. Dates on the older uploads are rough, so each channel's newest wins a tie.
  all.sort((a, b) => (b.when || 0) - (a.when || 0) || b.newest - a.newest);
  const top = all.slice(0, 3);
  $("homeUploadsHead").hidden = !top.length;
  const box = $("homeUploads");
  // Cards that didn't change are kept, so they don't fade in again every half a minute.
  setChildren(box, top.map((u, i) => keptNode(homeCards, u.id, JSON.stringify([u, i === 0]), () => {
    const el = document.createElement("div");
    el.className = "upload-card" + (i === 0 ? " hero" : "");
    el.innerHTML = `<div class="upload-thumb"><img alt="" loading="lazy"><span class="upload-length"></span></div>
      <div class="upload-body"><b class="upload-title"></b><span class="upload-meta"></span>
      <div class="upload-actions"><button type="button" class="small-button upload-watch">Watch</button>
      <button type="button" class="outline-button upload-convert">Convert</button></div></div>`;
    el.querySelector("img").src = u.thumbnail;
    el.querySelector(".upload-length").textContent = u.seconds ? clock(u.seconds, false) : "";
    el.querySelector(".upload-length").hidden = !u.seconds;
    el.querySelector(".upload-title").textContent = el.querySelector(".upload-title").title = u.title;
    const views = u.views == null ? "" : `${u.views.toLocaleString()} ${u.views === 1 ? "view" : "views"}`;
    const likes = u.likes ? `${shortNumber(u.likes)} likes` : "";
    el.querySelector(".upload-meta").textContent = [u.channel, views, likes, u.when ? sfxAgo(u.when * 1000) : ""].filter(Boolean).join(" · ");
    el.querySelector(".upload-watch").onclick = () => api("/api/open-youtube", { url: u.url });
    el.querySelector(".upload-convert").onclick = () => homeConvert(u.url, false);
    return el;
  })));
  forgetNodes(homeCards, top.map((u) => u.id));
}

function drawCrew() {
  const d = homeData;
  const out = !d.loggedIn;
  $("homeCrewOut").hidden = !out;
  $("homeCrewGrid").hidden = out;
  if (out) return;
  const online = d.online || { online: 0, people: [] };
  const people = online.people || [];
  const others = Math.max(0, (online.online || 0) - people.length);
  $("homeOnlineCount").textContent = online.online ? `${online.online} online` : "Nobody online";
  setChildren($("homeOnline"), people.map((p) => keptNode(homeEls, "p" + p.username, JSON.stringify(p), () => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "home-person";
    b.title = "See " + p.username + "'s profile";
    b.append(avatarEl(p.avatarUrl, p.username, "big"), Object.assign(document.createElement("span"), { textContent: p.username }));
    b.onclick = () => openProfile(p.username);
    return b;
  })));
  $("homeOnlineMore").hidden = !others;
  $("homeOnlineMore").textContent = others === 1 ? "+ 1 person not logged in" : `+ ${others} people not logged in`;
}

// The crew's activity: new sounds (with a play button), new people, new videos and channels
// passing a round number. Newest first.
let homeActivityAll = false;
function activityItems() {
  const d = homeData;
  const items = (d.activity || []).map((a) => ({ ...a, when: Date.parse(a.at) }));
  const weekAgo = Date.now() - 7 * 86400000;
  for (const c of d.channels) {
    const info = c.info;
    for (const v of ((info && info.videos) || info && info.uploads || []).slice(0, 3)) {
      if (v.when && v.when * 1000 > weekAgo) {
        items.push({ kind: "video", when: v.when * 1000, id: v.id, title: v.title, url: v.url, thumbnail: v.thumbnail,
          channel: info.name, avatarUrl: info.avatar });
      }
    }
  }
  const channelOf = (url) => (d.channels.find((c) => c.url === url) || {}).info || {};
  for (const item of items) {
    if (item.kind === "milestone") {
      const info = channelOf(item.channel);
      item.name = info.name || item.channel.split("/").pop();
      item.avatarUrl = info.avatar || "";
    }
  }
  return items.sort((a, b) => b.when - a.when);
}

function activityRow(item) {
  const row = document.createElement("div");
  row.className = "activity " + item.kind;
  const text = document.createElement("div");
  text.className = "activity-text";
  const line = document.createElement("p");
  const b = (t) => Object.assign(document.createElement("b"), { textContent: t });
  const meta = document.createElement("small");
  let face;
  if (item.kind === "upload") {
    face = avatarEl(item.avatarUrl, item.username);
    line.append(b(item.username || "Someone"), " uploaded ", b(item.name));
    meta.textContent = `${CAT_NAMES[item.category] || "Other"} · ${clock(item.seconds, false)} · ${sfxAgo(item.at)}`;
    setDrag(row, { kind: "sound", url: item.url, name: item.name });
    row.title = DRAG_HINT;
  } else if (item.kind === "joined") {
    face = avatarEl(item.avatarUrl, item.username);
    line.append(b(item.username), " joined the crew 👋");
    meta.textContent = sfxAgo(item.at);
  } else if (item.kind === "milestone") {
    face = avatarEl(item.avatarUrl, item.name);
    line.append(b(item.name), " passed ", b(Number(item.subs).toLocaleString()), " subscribers 🎉");
    meta.textContent = sfxAgo(item.at);
  } else {
    face = avatarEl(item.avatarUrl, item.channel);
    line.append(b(item.channel), " posted ", b(item.title));
    meta.textContent = sfxAgo(item.when);
  }
  if (item.kind === "joined" || item.kind === "upload") {
    face.classList.add("clickable");
    face.title = "See " + item.username + "'s profile";
    face.onclick = () => openProfile(item.username);
  }
  text.append(line, meta);
  row.append(face, text);
  if (item.kind === "upload") {
    const play = document.createElement("button");
    play.type = "button";
    play.className = "play";
    play.innerHTML = homePlaying === item.id ? SFX_ICONS.pause : SFX_ICONS.play;
    play.title = homePlaying === item.id ? "Stop" : "Play";
    play.onclick = () => {
      if (homePlaying === item.id) {
        homeAudio.pause();
        homePlaying = null;
      } else {
        homeAudio.src = item.url;
        homeAudio.play().catch(() => {});
        homePlaying = item.id;
      }
      drawHomeSounds();
    };
    row.classList.toggle("playing", homePlaying === item.id);
    row.append(play);
  } else if (item.kind === "video") {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "activity-thumb";
    thumb.title = "Watch on YouTube";
    thumb.append(Object.assign(document.createElement("img"), { src: item.thumbnail, alt: "", loading: "lazy" }));
    thumb.onclick = () => api("/api/open-youtube", { url: item.url });
    row.append(thumb);
  }
  return row;
}

function drawHomeSounds() {
  const d = homeData;
  if (!d || !d.loggedIn) return;
  const items = activityItems();
  const shown = homeActivityAll ? items.slice(0, 25) : items.slice(0, 6);
  $("homeSoundsEmpty").hidden = items.length > 0;
  $("homeActivityMore").hidden = items.length <= 6;
  $("homeActivityMore").textContent = homeActivityAll ? "Show less" : "Show more";
  setChildren($("homeSounds"), shown.map((item) => {
    const key = "a" + item.kind + (item.id || item.username || item.channel) + (item.subs || "");
    return keptNode(homeEls, key, JSON.stringify([item, item.kind === "upload" && homePlaying === item.id, sfxAgo(item.when)]),
      () => activityRow(item));
  }));
}
$("homeActivityMore").addEventListener("click", () => { homeActivityAll = !homeActivityAll; drawHomeSounds(); });

function drawHomeChat() {
  const d = homeData;
  if (!d || !d.loggedIn) return;
  $("homeChatEmpty").hidden = d.chat.length > 0;
  setChildren($("homeChat"), d.chat.map((m) => keptNode(homeEls, "m" + m.id, JSON.stringify(m), () => {
    const row = document.createElement("div");
    row.className = "home-chat-msg";
    const text = document.createElement("div");
    const who = Object.assign(document.createElement("b"), { textContent: m.username });
    const what = m.message || (m.sound_name ? "shared " + m.sound_name : m.file_name ? "shared a clip" : "");
    text.append(who, Object.assign(document.createElement("span"), { textContent: what }));
    row.append(avatarEl(m.avatarUrl, m.username, "tiny"), text,
      Object.assign(document.createElement("small"), { textContent: sfxAgo(m.created_at) }));
    return row;
  })));
}

let homeStatsDrawn = "";
function drawStats() {
  const s = homeData.stats;
  if (JSON.stringify(s) === homeStatsDrawn) return;
  homeStatsDrawn = JSON.stringify(s);
  const minutes = Math.round(s.seconds / 60);
  const boxes = [
    [s.files.toLocaleString(), s.files === 1 ? "file converted" : "files converted"],
    [minutes >= 600 ? Math.round(minutes / 60).toLocaleString() + " h" : minutes.toLocaleString() + " min", "of sound and video"],
    [s.top ? s.top.toUpperCase() : "–", s.top ? `your favorite (${s.topCount}×)` : "your favorite format"],
  ];
  setChildren($("homeStats"), boxes.map(([value, label]) => {
    const box = document.createElement("div");
    box.append(Object.assign(document.createElement("b"), { textContent: value }),
      Object.assign(document.createElement("span"), { textContent: label }));
    return box;
  }));
}

function drawRecent() {
  const items = homeData.recent;
  $("homeRecentEmpty").hidden = items.length > 0;
  setChildren($("homeRecent"), items.map((item) => keptNode(homeEls, "r" + item.id, JSON.stringify(item), () => {
    const row = document.createElement("div");
    row.className = "home-file";
    setDrag(row, { kind: "history", id: item.id });
    row.title = DRAG_HINT;
    const thumb = document.createElement("div");
    thumb.className = "home-file-thumb";
    if (item.thumbnail) thumb.style.backgroundImage = `url("${item.thumbnail}")`;
    const info = document.createElement("div");
    info.className = "info";
    info.append(Object.assign(document.createElement("b"), { textContent: item.title || item.url }),
      Object.assign(document.createElement("span"), {
        textContent: [(item.format || "").toUpperCase(), item.trimLabel, whenText(item.date)].filter(Boolean).join(" · "),
      }));
    const folder = document.createElement("button");
    folder.type = "button";
    folder.className = "icon-button";
    folder.title = "Show in folder";
    folder.innerHTML = ICONS.folder;
    folder.onclick = () => api("/api/history-show", { id: item.id });
    row.append(thumb, info, folder);
    return row;
  })));
}

// ---- the quick paste box: one link converts right away, several open in the Video tab to pick from

function homeConvert(text, fromBox = true) {
  text = text.trim();
  if (!text) return;
  showTab("video");
  const box = $("url");
  box.value = text;
  if (linksIn(text).length > 1 || !fromBox) {
    box.dispatchEvent(new Event("input"));  // shows the preview (or the list) to check first
    box.focus();
  } else {
    $("form").requestSubmit();
  }
  if (fromBox) $("homeUrl").value = "";
}

$("homeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  homeConvert($("homeUrl").value);
});
$("homeUrl").addEventListener("paste", (e) => {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (linksIn(text).length < 2) return;
  e.preventDefault();
  $("homeUrl").value = text.trim().split(/\s+/).join(" ");
});

$("homeLogin").addEventListener("click", () => openLogin("login"));
$("homeSignup").addEventListener("click", () => openLogin("signup"));
$("homeOpenChat").addEventListener("click", () => openChat(""));
$("homeAllSounds").addEventListener("click", () => showTab("sfx"));
$("homeAllHistory").addEventListener("click", () => showTab("history"));

// ---- the owner picks the channels

$("homeEditChannels").addEventListener("click", () => {
  $("channelsText").value = (homeData ? homeData.channelLinks : []).join("\n");
  $("channelsNote").textContent = "";
  $("channelsModal").hidden = false;
  $("channelsText").focus();
});
function closeChannels() { $("channelsModal").hidden = true; }
$("channelsCancel").addEventListener("click", closeChannels);
$("channelsModal").addEventListener("click", (e) => { if (e.target === $("channelsModal")) closeChannels(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("channelsModal").hidden) closeChannels(); });
$("channelsSave").addEventListener("click", async () => {
  const channels = $("channelsText").value.split(/[\s,]+/).filter(Boolean);
  $("channelsSave").disabled = true;
  const res = await api("/api/home-channels", { channels }).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  $("channelsSave").disabled = false;
  if (!res.ok) return void ($("channelsNote").textContent = res.error);
  homeData = res;
  drawHome();
  closeChannels();
  loadHome();
});
// Instant start: Home as it was last time, until the fresh numbers come in.
if (pageCache.home && pageCache.home.channels && (!pageCache.home.loggedIn || sfxUser())) {
  homeData = pageCache.home;
  drawHome();
}
if (!$("homeTab").hidden) loadHome();
