// The Channel stats tab: how your own YouTube channel is doing (see channelstats.py).
// Public numbers work with just your channel link; signing in with Google adds watch time,
// real day-by-day numbers and where viewers come from.
// Uses $, api() from app.js, shortNumber() from home.js, statsBar() and niceStep() from stats.js,
// avatarEl() and sfxAgo() from sfx.js, openWatch() from watch.js.

let chDays = [7, 28, 90].includes(loadPref("chDays")) ? loadPref("chDays") : 28;
let chChart = ["views", "subs", "watch"].includes(loadPref("chChart")) ? loadPref("chChart") : "views";
let chData = null;
let chTimer = null;
let chRun = 0;
let chSig = "";
let chNoGuess = false; // you picked "Use another channel": don't fill in the one on your profile again
let chWaitGoogle = 0; // until when we look more often (you're signing in in the browser)

function channelTabChanged(tab) {
  if (tab !== "channel") { clearTimeout(chTimer); return; }
  chSig = "";
  $("channelTab").classList.remove("stats-calm");
  loadChannel();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("channelTab").hidden) loadChannel(); });

async function loadChannel() {
  clearTimeout(chTimer);
  const mine = ++chRun;
  drawChRange();
  const days = chDays;
  try {
    const res = await api("/api/ch-page", { days, noGuess: chNoGuess });
    if (res.ok && days === chDays && mine === chRun) {
      const sig = JSON.stringify(res);
      if (sig !== chSig) {
        // New numbers for the same range: no animations (they'd play again every minute).
        $("channelTab").classList.toggle("stats-calm", !!chSig && chData && chData.days === days && chData.mode === res.mode);
        chSig = sig;
        chData = res;
        drawChannel();
      }
      if (res.google.connected) chWaitGoogle = 0;
    }
  } catch (e) { /* the app is closing */ }
  if (mine !== chRun) return;
  const soon = (chData && (chData.loading || chData.busy)) || Date.now() < chWaitGoogle;
  chTimer = setTimeout(() => { if (!$("channelTab").hidden && !document.hidden) loadChannel(); }, soon ? 2500 : 60000);
}

function drawChRange() {
  document.querySelectorAll("#chRange button").forEach((b) => b.classList.toggle("active", Number(b.dataset.days) === chDays));
  const active = $("chRange").querySelector("button.active");
  if (!active || !active.offsetWidth) return;
  $("chPill").style.width = active.offsetWidth + "px";
  $("chPill").style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

const chDay = (day) => new Date(day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const chToday = () => new Date().toISOString().slice(0, 10);
const chSigned = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + shortNumber(Math.abs(n));

function drawChannel() {
  const d = chData;
  $("chStart").hidden = d.mode !== "none";
  $("chMain").hidden = d.mode === "none";
  if (d.mode === "none") {
    $("chUrl").value = d.channelLink ? d.channelLink.replace("https://www.", "") : "";
    $("chStartGoogle").textContent = "";
    $("chStartGoogle").append(Object.assign(document.createElement("i"), { className: "ch-g" }),
      Date.now() < chWaitGoogle ? "Finish signing in in your browser..." : "Sign in with Google");
    return;
  }
  const google = d.mode === "google";
  const c = d.channel;
  setChildren($("chAvatar"), [avatarEl(c.avatar, c.name || "?")]);
  $("chName").textContent = c.name || "Your channel";
  $("chHandle").textContent = c.handle || "";
  $("chMode").textContent = google ? "Signed in with Google" : "Public numbers";
  $("chMode").className = "ch-mode" + (google ? " google" : "");
  $("chConnect").hidden = google;
  $("chChange").hidden = google;
  $("chDisconnect").hidden = !d.google.connected;
  $("chOpenStudio").hidden = !google;
  $("chUpsell").hidden = google || !!loadPref("chUpsellHidden");
  $("chRefresh").classList.toggle("spinning", !!d.busy);

  const notes = [];
  if (d.error) notes.push(d.error);
  else if (d.loading) notes.push(google ? "Getting your numbers from YouTube..." : "Reading your channel... (the first time takes about half a minute)");
  if (google && d.end && d.end < chToday()) notes.push(`YouTube's numbers come 2 or 3 days late, so this goes up to ${chDay(d.end)}.`);
  if (d.rangeError) notes.push(d.rangeError);
  $("chNote").textContent = notes.join(" ");

  drawChNumbers(d);
  drawChChart(d);
  drawChNewest(d);
  drawChTop(d);
  drawChSources(d);
  drawChCompare(); // chcompare.js
}

function chNumberCard(label, value, unit, lines, i, locked) {
  const card = document.createElement("div");
  card.className = "ch-number" + (locked ? " locked" : "");
  card.style.animationDelay = i * 70 + "ms";
  card.append(Object.assign(document.createElement("span"), { className: "ch-number-label", textContent: label }));
  const big = Object.assign(document.createElement("b"), { textContent: value == null ? "–" : shortNumber(value) });
  if (value != null) big.title = value.toLocaleString() + (unit ? " " + unit : "");
  if (unit && value != null) big.append(Object.assign(document.createElement("small"), { textContent: " " + unit }));
  card.append(big);
  for (const [text, tone] of lines) {
    if (text) card.append(Object.assign(document.createElement("span"), { className: "ch-change " + (tone || ""), textContent: text }));
  }
  if (locked) {
    const go = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Sign in with Google to see it" });
    go.onclick = startGoogle;
    card.append(go);
  }
  return card;
}

function versusLine(pct) {
  if (pct == null) return ["", ""];
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "";
  return [`${arrow} ${Math.abs(pct)}% vs the ${chDays} days before`.trim(), pct > 0 ? "up" : pct < 0 ? "down" : ""];
}

function drawChNumbers(d) {
  const t = d.totals;
  if (!t) { setChildren($("chNumbers"), []); return; }
  const google = d.mode === "google";
  // Public: the change since the first day the app wrote down in the range (none on the first day).
  const since = d.since && d.since < chToday() ? (d.since <= daysAgo(chDays) ? `in ${chDays} days` : `since ${chDay(d.since)}`) : "";
  const gainLine = (n, words) => n == null || (!google && !since) ? [words || "", ""]
    : [`${chSigned(n)} ${google ? `in ${chDays} days` : since}`, n > 0 ? "up" : n < 0 ? "down" : ""];
  const cards = [
    chNumberCard("Subscribers", t.subs.value, "", [gainLine(t.subs.change, google ? "" : "Changes show from tomorrow"), versusLine(t.subs.versus)], 0),
    chNumberCard(google ? "Views" : "Views", t.views.value, "", [gainLine(t.views.change, ""), google ? versusLine(t.views.versus) : [t.views.note || "", ""]], 1),
    t.watch ? chNumberCard(`Watch time, ${chDays} days`, t.watch.value, "hours", [versusLine(t.watch.versus)], 2)
      : chNumberCard("Watch time", null, "", [], 2, true),
  ];
  setChildren($("chNumbers"), cards);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const CH_CHARTS = {
  views: { title: "Views per day", unit: "views" },
  subs: { title: "Subscribers", unit: "subscribers" },
  watch: { title: "Watch time per day", unit: "hours" },
};

function drawChChart(d) {
  document.querySelectorAll("#chChartPick button").forEach((b) => b.classList.toggle("active", b.dataset.chart === chChart));
  $("chChartTitle").textContent = CH_CHARTS[chChart].title;
  const box = $("chChart");
  const points = ((d.series || {})[chChart] || []).map(([day, v]) => [Date.parse(day + "T00:00:00Z"), v, day]);
  if (chChart === "watch" && d.mode !== "google") {
    box.innerHTML = `<div class="stats-chart-empty ch-chart-locked"><span>Only YouTube knows your watch time.</span><button type="button" class="small-button">Sign in with Google</button></div>`;
    box.querySelector("button").onclick = startGoogle;
    return;
  }
  if (points.length < 2) {
    box.innerHTML = `<div class="stats-chart-empty">${d.loading ? "Loading..." : d.mode === "google" ? "No numbers in this time yet."
      : "The app writes your numbers down once a day, so the graph fills in from tomorrow."}</div>`;
    return;
  }
  // As wide as the card really is, so the numbers stay small text on a big window (not stretched up).
  const W = Math.max(320, Math.round(box.clientWidth) || 640), H = 220, L = 46, R = 12, T = 12, B = 26;
  const x0 = points[0][0], x1 = points[points.length - 1][0];
  let lo = Math.min(...points.map((p) => p[1])), hi = Math.max(...points.map((p) => p[1]));
  if (chChart !== "subs") lo = 0; // per day: from 0
  if (hi === lo) hi = lo + 1;
  const step = niceStep((hi - lo) / 3 || 1);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (t) => L + (t - x0) / (x1 - x0 || 1) * (W - L - R);
  const Y = (v) => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  let grid = "";
  for (let v = lo; v <= hi + step / 2; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${shortNumber(v)}</text>`;
  }
  grid += `<text x="${L}" y="${H - 6}">${chDay(points[0][2])}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${chDay(points[points.length - 1][2])}</text>`;
  const line = points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L${X(x1).toFixed(1)},${Y(lo)}L${X(x0).toFixed(1)},${Y(lo)}Z`;
  const end = points[points.length - 1];
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="stats-svg ch-svg">
    <defs><linearGradient id="chFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <g class="stats-grid-lines">${grid}</g><path class="ch-area" d="${area}" fill="url(#chFade)"/>
    <g class="stats-lines"><path d="${line}" pathLength="1" style="stroke:var(--accent)"/><circle cx="${X(end[0])}" cy="${Y(end[1])}" r="3.5" style="fill:var(--accent);animation-delay:900ms"/></g>
    <line class="stats-cursor" y1="${T}" y2="${H - B}" hidden/><circle class="ch-dot" r="4" hidden/></svg><div class="stats-tip" hidden></div>`;
  const svg = box.querySelector("svg"), cursor = box.querySelector(".stats-cursor"), dot = box.querySelector(".ch-dot"), tip = box.querySelector(".stats-tip");
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const t = x0 + ((e.clientX - rect.left) / rect.width * W - L) / (W - L - R) * (x1 - x0);
    const p = points.reduce((best, q) => Math.abs(q[0] - t) < Math.abs(best[0] - t) ? q : best, points[0]);
    cursor.setAttribute("x1", X(p[0]));
    cursor.setAttribute("x2", X(p[0]));
    dot.setAttribute("cx", X(p[0]));
    dot.setAttribute("cy", Y(p[1]));
    cursor.hidden = dot.hidden = false;
    const value = chChart === "watch" ? p[1].toLocaleString() : Math.round(p[1]).toLocaleString();
    tip.replaceChildren(Object.assign(document.createElement("b"), { textContent: chDay(p[2]) }),
      Object.assign(document.createElement("span"), { textContent: `${value} ${CH_CHARTS[chChart].unit}` }));
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(X(p[0]) / W * rect.width, 80), rect.width - 80) + "px";
  };
  svg.onmouseleave = () => { cursor.hidden = dot.hidden = tip.hidden = true; };
}

function chStat(icon, value, title) {
  const el = document.createElement("span");
  el.className = "ch-stat";
  el.title = title;
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
  el.append(value == null ? "–" : shortNumber(value));
  return el;
}

const CH_ICONS = {
  views: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  likes: '<path d="M7.5 10.5v9h-3v-9z"/><path d="M7.5 10.5l3.5-6.5a2 2 0 0 1 2 2.5l-.8 3h5.3a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.5"/>',
  comments: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
};

const CH_NEWEST_FIRST = 6;
let chNewestAll = false;

function drawChNewest(d) {
  const videos = d.newest || [];
  if (!videos.length) {
    setChildren($("chNewest"), [Object.assign(document.createElement("p"), { className: "home-muted", textContent: d.loading ? "Loading..." : "No uploads yet." })]);
    return;
  }
  const shown = chNewestAll ? videos : videos.slice(0, CH_NEWEST_FIRST);
  const rows = shown.map((v, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ch-video";
    row.style.animationDelay = i * 45 + "ms";
    row.title = "Watch it";
    row.onclick = () => openWatch(v.url, { title: v.title, sub: d.channel.name });
    const thumb = Object.assign(document.createElement("span"), { className: "ch-thumb" + (v.short ? " short" : "") });
    thumb.append(Object.assign(document.createElement("img"), { src: v.thumbnail, alt: "", loading: "lazy" }));
    if (v.short) thumb.append(Object.assign(document.createElement("i"), { textContent: "Short" }));
    const text = Object.assign(document.createElement("span"), { className: "ch-video-text" });
    text.append(Object.assign(document.createElement("b"), { textContent: v.title }),
      Object.assign(document.createElement("small"), { textContent: v.when ? sfxAgo(v.when * 1000) : "" }));
    const stats = Object.assign(document.createElement("span"), { className: "ch-video-stats" });
    stats.append(chStat(CH_ICONS.views, v.views, "Views"), chStat(CH_ICONS.likes, v.likes, "Likes"), chStat(CH_ICONS.comments, v.comments, "Comments"));
    const usual = Object.assign(document.createElement("span"), { className: "ch-usual " + (v.usual ? v.usual.tone : "none") });
    usual.textContent = v.usual ? v.usual.label : "";
    if (v.usual && v.usual.tone === "new") usual.title = "Out for less than 2 days: too soon to tell";
    row.append(thumb, text, stats, usual);
    return row;
  });
  // (3.0) The newest 6 first; the rest one click away, so the page isn't one long list.
  if (videos.length > CH_NEWEST_FIRST) {
    const more = Object.assign(document.createElement("button"), { type: "button", className: "ch-more",
      textContent: chNewestAll ? "Show fewer" : `Show ${videos.length - CH_NEWEST_FIRST} more` });
    more.onclick = () => { chNewestAll = !chNewestAll; $("channelTab").classList.add("stats-calm"); drawChNewest(chData); };
    rows.push(more);
  }
  setChildren($("chNewest"), rows);
}

function drawChTop(d) {
  const top = d.top || [];
  $("chTopNote").textContent = d.topNote || "";
  $("chTopEmpty").hidden = top.length > 0 || d.loading;
  setChildren($("chTop"), top.map((v, i) => statsBar(v.title,
    v.hours != null ? `${v.hours.toLocaleString()} hours watched` : `${v.short ? "Short" : "Video"}${v.when ? " · " + sfxAgo(v.when * 1000) : ""}`,
    v.views, top[0].views, "var(--accent)", i, () => openWatch(v.url, { title: v.title, sub: d.channel.name }))));
}

const CH_SOURCE_COLORS = ["var(--accent)", "#5ab8ff", "#ff7aa8", "#7ee08a", "#c69bff", "#ff9f5a"];

function drawChSources(d) {
  const google = d.mode === "google";
  $("chSourcesLocked").hidden = google;
  $("chSourcesNote").textContent = google ? `in ${chDays} days` : "";
  const sources = (google && d.sources) || [];
  const total = sources.reduce((n, s) => n + s.views, 0) || 1;
  const shown = sources.slice(0, 6);
  setChildren($("chSources"), shown.map((s, i) => statsBar(s.name, `${Math.round(s.views / total * 100)}% of views`,
    s.views, shown[0].views, CH_SOURCE_COLORS[i % CH_SOURCE_COLORS.length], i)));
}

// ---- signing in with Google

async function startGoogle() {
  $("chMenu").hidden = true;
  if (!chData || !chData.google.setUp) return openChSetup();
  const res = await api("/api/ch-connect", {});
  if (!res.ok) return openChSetup(res.error);
  chWaitGoogle = Date.now() + 5 * 60 * 1000;
  $("chNote").textContent = "Finish signing in in your browser. Then come back here.";
  if (chData.mode === "none") drawChannel();
  loadChannel();
}

const chSetupHelp = $("chSetupNote").innerHTML;
let chAfterSetup = null; // the Comments tab: sign in its own way once the Client ID is saved
function openChSetup(error, help) {
  $("chSetupModal").hidden = false;
  $("chSetupNote").classList.toggle("bad", !!error);
  if (error) $("chSetupNote").textContent = error;
  else $("chSetupNote").innerHTML = help || chSetupHelp;
  setTimeout(() => $("chClientId").focus(), 50);
}
const closeChSetup = () => { $("chSetupModal").hidden = true; chAfterSetup = null; };

$("chSetupGo").addEventListener("click", async () => {
  const res = await api("/api/ch-client", { clientId: $("chClientId").value, clientSecret: $("chClientSecret").value });
  if (!res.ok) {
    $("chSetupNote").textContent = res.error;
    $("chSetupNote").classList.add("bad");
    return;
  }
  const next = chAfterSetup;
  closeChSetup();
  if (chData) chData.google.setUp = true;
  if (next) {
    if (typeof cmData !== "undefined" && cmData) cmData.google.setUp = true;
    return next();
  }
  startGoogle();
});
$("chSetupCancel").addEventListener("click", closeChSetup);
$("chSetupModal").addEventListener("click", (e) => { if (e.target === $("chSetupModal")) closeChSetup(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("chSetupModal").hidden) closeChSetup(); });
document.querySelectorAll("#chSetupModal [data-open]").forEach((b) => b.addEventListener("click", () => api("/api/ch-open", { url: b.dataset.open })));

// ---- the rest of the buttons

$("chForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("chFormError").textContent = "";
  const res = await api("/api/ch-set", { url: $("chUrl").value });
  if (!res.ok) { $("chFormError").textContent = res.error; return; }
  chNoGuess = false;
  chSig = "";
  loadChannel();
});
$("chStartGoogle").addEventListener("click", startGoogle);
$("chUpsellGo").addEventListener("click", startGoogle);
$("chSourcesGo").addEventListener("click", startGoogle);
$("chConnect").addEventListener("click", startGoogle);
$("chUpsellX").addEventListener("click", () => { savePref("chUpsellHidden", 1); $("chUpsell").hidden = true; });
$("chRefresh").addEventListener("click", async () => {
  $("chRefresh").classList.add("spinning");
  await api("/api/ch-refresh", {});
  setTimeout(loadChannel, 300);
  setTimeout(() => { chCmpSig = ""; loadChCompare(); }, 300); // (a video that couldn't be read is tried again too)
});
$("chMore").addEventListener("click", (e) => { e.stopPropagation(); $("chMenu").hidden = !$("chMenu").hidden; });
document.addEventListener("click", (e) => { if (!$("chMenu").hidden && !$("chMenu").contains(e.target)) $("chMenu").hidden = true; });
$("chOpenYt").addEventListener("click", () => { $("chMenu").hidden = true; if (chData && chData.channel.url) api("/api/ch-open", { url: chData.channel.url }); });
$("chOpenStudio").addEventListener("click", () => { $("chMenu").hidden = true; api("/api/ch-open", { url: "https://studio.youtube.com/" }); });
$("chChange").addEventListener("click", async () => {
  $("chMenu").hidden = true;
  chNoGuess = true;
  await api("/api/ch-forget", {});
  chSig = "";
  loadChannel();
});
$("chDisconnect").addEventListener("click", async () => {
  $("chMenu").hidden = true;
  await api("/api/ch-disconnect", {});
  chSig = "";
  loadChannel();
});
document.querySelectorAll("#chRange button").forEach((b) => b.addEventListener("click", () => {
  const days = Number(b.dataset.days);
  if (days === chDays) return;
  chDays = days;
  savePref("chDays", days);
  chSig = "";
  loadChannel();
}));
document.querySelectorAll("#chChartPick button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.chart === chChart) return;
  chChart = b.dataset.chart;
  savePref("chChart", chChart);
  if (chData) drawChChart(chData);
}));
let chResizeTimer = null;
window.addEventListener("resize", () => {
  drawChRange();
  clearTimeout(chResizeTimer);
  chResizeTimer = setTimeout(() => { if (chData && chData.mode !== "none" && !$("channelTab").hidden) { $("channelTab").classList.add("stats-calm"); drawChChart(chData); const a = chCmpVideo(0), b = chCmpVideo(1); if (a && b) drawChCmpFirst(a, b, !a.partial && !b.partial); } }, 150);
});
if (!$("channelTab").hidden) channelTabChanged("channel"); // the app opened on this tab
