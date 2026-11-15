// Stream alerts: when a friend goes live on YouTube or Twitch you get a ping in the bell (and a Windows
// notification when the app is behind other windows). The channels come from everyone's profile
// (Edit profile > YouTube / Twitch). Who's live also shows at the top of Home and on their profile.
// The app looks every 2 minutes, for free: no API keys, yt-dlp looks at the channel pages (see live.py).
// Uses $, api(), shortNumber() from app.js, sfxUser(), avatarEl(), sfxAgo() from sfx.js, profileLink()
// from profile.js, openWatch() from watch.js, notifyAdd()/notifyDrop() from notify.js.

const LIVE_EVERY = 120000;
let liveNow = [];      // [{username, avatarUrl, kind, id, title, url, thumbnail, viewers, started, channel}]
let liveTimer = 0;
let liveTries = 0;

const LIVE_SITES = {
  youtube: { name: "YouTube", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/></svg>' },
  twitch: { name: "Twitch", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.5 3 3 6.8V19h4.2v2.2h2.3l2.2-2.2h3.4L20 14.2V3zm14 10.5L16 16h-3.8l-2.2 2.2V16H6.7V4.5h11.8zM15.6 7.4h-1.5v4.5h1.5zm-4.1 0H10v4.5h1.5z"/></svg>' },
};

function liveEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function liveViewers(s) {
  return s.viewers ? `${shortNumber(s.viewers)} watching` : "Live now";
}

function liveWatch(s) {
  if (s.kind === "youtube" && typeof openWatch === "function") return openWatch(s.url, { convert: false });
  api("/api/games-open", { url: s.url });
}

// ---------------------------------------------------------------- looking

async function liveCheck() {
  clearTimeout(liveTimer);
  if (typeof sfxUser !== "function" || !sfxUser()) {
    if (liveNow.length) { liveNow = []; liveDraw(); }
    liveTimer = setTimeout(liveCheck, LIVE_EVERY);
    return;
  }
  const res = await api("/api/sfx-live", {}).catch(() => null);
  if (res && res.ok) {
    const before = new Set(liveNow.map((s) => s.kind + ":" + s.username.toLowerCase()));
    liveNow = res.live || [];
    const now = new Set(liveNow.map((s) => s.kind + ":" + s.username.toLowerCase()));
    for (const s of liveNow) liveNotify(s);
    // Streams that ended leave the bell (the stamp stays, so the same stream doesn't ping again).
    for (const key of before) if (!now.has(key)) notifyDrop("live:" + key);
    liveDraw();
  }
  // The first look at a channel takes a few seconds: ask again soon.
  const soon = res && res.ok && res.loading && liveTries++ < 10;
  if (!soon) liveTries = 0;
  liveTimer = setTimeout(liveCheck, soon ? 6000 : LIVE_EVERY);
}

function liveNotify(s) {
  const site = LIVE_SITES[s.kind] ? LIVE_SITES[s.kind].name : "stream";
  notifyAdd({
    key: "live:" + s.kind + ":" + s.username.toLowerCase(), stamp: s.id, kind: "live",
    title: `${s.username} is live on ${site}`, text: s.title || "Come watch!", pic: s.avatarUrl || s.thumbnail || "",
    open: { live: { kind: s.kind, url: s.url } },
  });
}

// ---------------------------------------------------------------- Home: "Live now"

function liveCard(s) {
  const card = liveEl("div", "live-card k-" + s.kind);
  const thumb = liveEl("button", "live-thumb");
  thumb.type = "button";
  thumb.title = "Watch";
  const img = liveEl("img");
  img.alt = "";
  img.src = s.thumbnail;
  img.onerror = () => img.remove();
  thumb.append(img, liveEl("span", "live-badge", "LIVE"), liveEl("span", "live-viewers", liveViewers(s)));
  thumb.onclick = () => liveWatch(s);

  const body = liveEl("div", "live-body");
  const who = liveEl("div", "live-who");
  const face = avatarEl(s.avatarUrl, s.username, "small");
  const name = liveEl("b", "", s.username);
  if (typeof profileLink === "function") { profileLink(face, s.username); profileLink(name, s.username); }
  const site = liveEl("span", "live-site");
  site.innerHTML = LIVE_SITES[s.kind].icon;
  site.append(LIVE_SITES[s.kind].name);
  who.append(face, name);
  const meta = liveEl("div", "live-meta");
  meta.append(site, s.started ? " · Started " + sfxAgo(s.started * 1000) : "");
  const watch = liveEl("button", "small-button live-watch", "Watch");
  watch.type = "button";
  watch.onclick = () => liveWatch(s);
  body.append(who, liveEl("div", "live-title", s.title), meta, watch);
  card.append(thumb, body);
  return card;
}

function liveDraw() {
  const box = $("homeLive");
  if (box) {
    box.hidden = !liveNow.length;
    $("homeLiveCount").textContent = liveNow.length > 1 ? `${liveNow.length} friends` : "";
    $("homeLiveList").replaceChildren(...liveNow.map(liveCard));
  }
  if (typeof profileShown !== "undefined" && profileShown && !profileShown.loading) drawProfileLive(profileShown);
}

// ---------------------------------------------------------------- on a profile

function drawProfileLive(p) {
  const box = $("profileLive");
  const streams = liveNow.filter((s) => s.username.toLowerCase() === String(p.username).toLowerCase());
  box.hidden = !streams.length;
  box.replaceChildren(...streams.map((s) => {
    const row = liveEl("button", "pf-live-row k-" + s.kind);
    row.type = "button";
    const text = liveEl("span", "pf-live-text");
    text.append(liveEl("b", "", `Live on ${LIVE_SITES[s.kind].name}`), liveEl("span", "", s.title));
    row.append(liveEl("span", "live-badge", "LIVE"), text, liveEl("small", "", liveViewers(s)));
    row.onclick = () => liveWatch(s);
    return row;
  }));
  $("profileDot").classList.toggle("live", !!streams.length);
  // Their Twitch channel (YouTube is under "Newest videos").
  const tw = $("profileTwitch");
  tw.hidden = !p.twitch;
  if (p.twitch) {
    tw.innerHTML = LIVE_SITES.twitch.icon;
    tw.append("twitch.tv/" + p.twitch);
    tw.onclick = () => api("/api/games-open", { url: "https://www.twitch.tv/" + p.twitch });
  }
}

setTimeout(liveCheck, 15000);
