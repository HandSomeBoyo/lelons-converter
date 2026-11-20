// The channel stats page (opened from Home): subscriber growth, a crew leaderboard and the
// best uploads. The history comes from Supabase: every app that's logged in writes down each
// channel's subscribers once a day, so the charts fill in day by day.
// Uses $, api() from app.js, showTab() from images.js, avatarEl() from sfx.js,
// shortNumber() from home.js.

let statsDays = 30;
let statsData = null;
let statsTimer = null;
let statsDrawn = "";
let statsDrawnDays = 0;
const STATS_COLORS = ["var(--accent)", "#5ab8ff", "#ff7aa8", "#7ee08a", "#c69bff", "#ff9f5a"];
const DAY_MS = 24 * 3600 * 1000;

function openStats() {
  if (statsOne) closeStatsOne();
  statsDrawnDays = 0; // opening the page plays the animations again
  statsDrawn = "";
  loadStats();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("statsTab").hidden) loadStats(); });

let statsRun = 0; // only the newest load keeps the polling going
async function loadStats() {
  clearTimeout(statsTimer);
  const mine = ++statsRun;
  drawStatsRange();
  const days = statsDays;
  try {
    const res = await api("/api/stats", { days: days >= 3650 ? days : days * 2 }); // twice: to compare with the range before
    if (res.ok && days === statsDays) {
      // Nothing new: leave the page alone (redrawing would replay the animations and hide the
      // tooltip you're reading). New numbers: update without the animations, unless the range changed.
      const sig = JSON.stringify(res);
      if (sig !== statsDrawn) {
        $("statsTab").classList.toggle("stats-calm", statsDrawnDays === days);
        statsDrawn = sig;
        statsDrawnDays = days;
        statsData = res;
        drawStatsPage();
      }
    }
  } catch (e) { /* the app is closing */ }
  if (mine !== statsRun) return;
  const waiting = statsData && statsData.channels.some((c) => c.loading);
  statsTimer = setTimeout(() => { if (!$("statsTab").hidden && !document.hidden) loadStats(); }, waiting ? 2500 : 60000);
}

function drawStatsRange() {
  document.querySelectorAll("#statsRange button").forEach((b) => b.classList.toggle("active", Number(b.dataset.days) === statsDays));
  const active = $("statsRange").querySelector("button.active");
  if (!active || !active.offsetWidth) return;
  $("statsPill").style.width = active.offsetWidth + "px";
  $("statsPill").style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

// Each channel's subscribers by day, with today's live number added at the end.
function statsSeries(c) {
  const points = c.history.map(([day, subs]) => [Date.parse(day + "T00:00:00Z"), subs]).filter((p) => !isNaN(p[0]));
  if (c.subscribers != null) {
    const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const last = points[points.length - 1];
    if (last && last[0] === today) last[1] = c.subscribers;
    else if (!last || last[0] < today) points.push([today, c.subscribers]);
  }
  return points;
}

// (3.0) The page asks for twice the range, so this range can be compared with the one before it.
const statsDay0 = () => Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
function statsAt(points, t) { // the number on day t (the first one written down on or after it)
  const p = points.find((q) => q[0] >= t);
  return p ? p[1] : null;
}
function statsCut(c) {
  const all = statsSeries(c);
  if (statsDays >= 3650) return { points: all, gained: all.length >= 2 ? all[all.length - 1][1] - all[0][1] : null, before: null };
  const from = statsDay0() - statsDays * DAY_MS;
  const points = all.filter((p) => p[0] >= from);
  const gained = points.length >= 2 ? points[points.length - 1][1] - points[0][1] : null;
  // The range before: only when the history really goes back that far (a day of slack).
  let before = null;
  if (all.length && all[0][0] <= from - (statsDays - 1) * DAY_MS) {
    const a = statsAt(all, from - statsDays * DAY_MS), b = statsAt(all, from);
    if (a != null && b != null) before = b - a;
  }
  return { points, gained, before };
}
function compareText(now, before, short) {
  if (now == null || before == null) return "";
  if (before <= 0) return now > 0 ? "up from " + (before === 0 ? "none" : gainedText(before)) : "";
  const pct = Math.round((now - before) / before * 100);
  if (!pct) return "same as before";
  if (short) return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% vs before`;
  return pct > 0 ? `${pct}% more than before` : `${-pct}% less than before`;
}

function drawStatsPage() {
  const d = statsData;
  const series = d.channels.map((c, i) => ({ ...c, color: STATS_COLORS[i % STATS_COLORS.length], ...statsCut(c) }));
  const longest = Math.max(0, ...series.map((s) => s.points.length));
  $("statsNote").textContent = d.error ? d.error
    : !d.loggedIn ? "Log in to see how the channels grew. The live numbers still show."
    : longest < 2 ? "The app writes down the subscribers once a day, so the charts fill in from today."
    : longest < Math.min(statsDays, 7) ? "The charts fill in a bit more every day." : "";
  const ordered = drawStatsBoard(series);
  drawStatsSummary(series);
  statsLineChart($("statsChart"), $("statsLegend"), ordered, false);
  drawStatsGoals(ordered);
  drawStatsTop(series);
  drawStatsUploads(ordered);
  if (statsOne) drawStatsOne();
}

function gainedText(n) {
  if (n == null) return "";
  return (n > 0 ? "+" : n < 0 ? "−" : "") + shortNumber(Math.abs(n));
}
const rangeText = () => statsDays >= 3650 ? "all time" : `the last ${statsDays} days`;

// The crew together, in one line at the top.
function drawStatsSummary(series) {
  const known = series.filter((s) => s.gained != null);
  const box = $("statsSummary");
  box.hidden = !known.length;
  if (!known.length) return;
  const total = known.reduce((n, s) => n + s.gained, 0);
  const before = known.every((s) => s.before != null) ? known.reduce((n, s) => n + s.before, 0) : null;
  const cmp = compareText(total, before);
  box.replaceChildren("The crew gained ", Object.assign(document.createElement("b"), { textContent: gainedText(total) || "0" }),
    ` subscribers in ${rangeText()}`, cmp ? ", " : ".", ...(cmp ? [Object.assign(document.createElement("span"), {
      className: total >= before ? "up" : "down", textContent: cmp }), "."] : []));
}

function sparkline(points, color) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 90 28");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("stats-spark");
  if (points.length < 2) return svg;
  const lo = Math.min(...points.map((p) => p[1])), hi = Math.max(...points.map((p) => p[1]));
  const x0 = points[0][0], x1 = points[points.length - 1][0];
  const path = points.map((p, i) => `${i ? "L" : "M"}${((p[0] - x0) / (x1 - x0 || 1) * 88 + 1).toFixed(1)},${(hi === lo ? 14 : 26 - (p[1] - lo) / (hi - lo) * 24).toFixed(1)}`).join("");
  svg.innerHTML = `<path d="${path}" pathLength="1" style="stroke:${color}"/>`;
  return svg;
}

// The leaderboard. Returns the channels in its order, so the chart's key and the other cards match it.
function drawStatsBoard(series) {
  const rows = series.slice();
  const byGain = rows.some((r) => r.gained != null);
  rows.sort((a, b) => byGain ? (b.gained ?? -Infinity) - (a.gained ?? -Infinity) || (b.subscribers || 0) - (a.subscribers || 0)
    : (b.subscribers || 0) - (a.subscribers || 0));
  $("statsBoardNote").textContent = byGain ? (statsDays >= 3650 ? "most subscribers gained" : `most gained in ${statsDays} days`) : "most subscribers";
  setChildren($("statsBoard"), rows.map((r, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "stats-row" + (r.loading ? " loading" : "");
    row.title = "See more about " + r.name;
    row.style.animationDelay = i * 60 + "ms";
    row.onclick = () => openStatsOne(r.url);
    const rank = Object.assign(document.createElement("span"), { className: "stats-rank" + (i === 0 ? " first" : ""), textContent: i + 1 });
    const name = document.createElement("span");
    name.className = "stats-name";
    name.append(Object.assign(document.createElement("b"), { textContent: r.name }),
      Object.assign(document.createElement("small"), { textContent: r.loading ? "Loading..." : r.subscribers == null ? "–" : r.subscribers.toLocaleString() + " subscribers" }));
    const gain = document.createElement("span");
    gain.className = "stats-gain" + (r.gained > 0 ? " up" : r.gained < 0 ? " down" : "");
    gain.append(Object.assign(document.createElement("b"), { textContent: r.gained == null ? "" : gainedText(r.gained) || "0" }));
    const cmp = compareText(r.gained, r.before, true);
    if (cmp) gain.append(Object.assign(document.createElement("small"), { textContent: cmp, title: compareText(r.gained, r.before), className: r.gained >= r.before ? "up" : "down" }));
    row.append(rank, avatarEl(r.avatar, r.name), name, sparkline(r.points, r.color), gain);
    return row;
  }));
  return rows;
}

// A line chart: subscribers gained (each line starts at 0), or the subscriber number itself (total).
function statsLineChart(box, legend, series, total) {
  const lines = series.filter((s) => s.points.length);
  const all = lines.flatMap((s) => s.points);
  if (legend) setChildren(legend, lines.map((s) => {
    const item = document.createElement("span");
    item.innerHTML = `<i style="background:${s.color}"></i>`;
    item.append(s.name);
    return item;
  }));
  if (!lines.some((s) => s.points.length >= 2)) {
    box.innerHTML = `<div class="stats-chart-empty">${statsData.loggedIn ? "Come back tomorrow to see the first line." : "Log in to see the chart."}</div>`;
    return;
  }
  const W = 640, H = 220, L = 46, R = 12, T = 12, B = 26;
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  const values = lines.map((s) => s.points.map((p) => [p[0], total ? p[1] : p[1] - s.points[0][1]]));
  const flat = values.flat().map((p) => p[1]);
  let lo = total ? Math.min(...flat) : Math.min(0, ...flat), hi = total ? Math.max(...flat) : Math.max(1, ...flat);
  if (total && hi - lo < 4) { lo -= 2; hi += 2; }
  const step = niceStep((hi - lo) / 3);
  // A dip of a few below 0 doesn't get a whole row of its own (it just touches the bottom line).
  if (!total && lo < 0 && -lo < step * 0.25) lo = 0;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (t) => L + (t - x0) / (x1 - x0 || 1) * (W - L - R);
  const Y = (v) => Math.min(H - B, T + (hi - v) / (hi - lo || 1) * (H - T - B));
  const label = (v) => total ? shortNumber(v) : gainedText(v) || "0";
  let grid = "";
  for (let v = lo; v <= hi + step / 2; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 && !total ? "zero" : ""}"/>`
      + `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${label(v)}</text>`;
  }
  const dayText = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  grid += `<text x="${L}" y="${H - 6}">${dayText(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${dayText(x1)}</text>`;
  const paths = values.map((g, i) => {
    const d = g.map((p, j) => `${j ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const end = g[g.length - 1];
    return `<path d="${d}" pathLength="1" style="stroke:${lines[i].color};animation-delay:${i * 120}ms"/>`
      + `<circle cx="${X(end[0])}" cy="${Y(end[1])}" r="3.5" style="fill:${lines[i].color};animation-delay:${900 + i * 120}ms"/>`;
  }).join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="stats-svg"><g class="stats-grid-lines">${grid}</g><g class="stats-lines">${paths}</g>
    <line class="stats-cursor" y1="${T}" y2="${H - B}" hidden/></svg><div class="stats-tip" hidden></div>`;

  // Hover: the day under the mouse and each channel's number then.
  const svg = box.querySelector("svg"), cursor = box.querySelector(".stats-cursor"), tip = box.querySelector(".stats-tip");
  const days = [...new Set(values.flat().map((p) => p[0]))].sort((a, b) => a - b);
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const t = x0 + ((e.clientX - rect.left) / rect.width * W - L) / (W - L - R) * (x1 - x0);
    const day = days.reduce((best, d) => Math.abs(d - t) < Math.abs(best - t) ? d : best, days[0]);
    cursor.setAttribute("x1", X(day));
    cursor.setAttribute("x2", X(day));
    cursor.hidden = false;
    tip.replaceChildren(Object.assign(document.createElement("b"), { textContent: dayText(day) }), ...values.map((g, i) => {
      const p = g.filter((q) => q[0] <= day).pop();
      const line = document.createElement("span");
      line.innerHTML = `<i style="background:${lines[i].color}"></i>`;
      line.append(lines[i].name + " ", Object.assign(document.createElement("em"), { textContent: p ? (total ? p[1].toLocaleString() : gainedText(p[1]) || "0") : "–" }));
      return line;
    }));
    tip.hidden = false;
    const left = X(day) / W * rect.width;
    tip.style.left = Math.min(Math.max(left, 80), rect.width - 80) + "px";
  };
  svg.onmouseleave = () => { cursor.hidden = true; tip.hidden = true; };
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function statsBar(label, sub, value, max, color, i, onClick) {
  const row = document.createElement(onClick ? "button" : "div");
  if (onClick) { row.type = "button"; row.onclick = onClick; }
  row.className = "stats-bar";
  row.style.animationDelay = i * 60 + "ms";
  row.innerHTML = `<span class="stats-bar-text"><b></b><small></small></span><span class="stats-bar-value"></span>
    <span class="stats-bar-track"><span class="stats-bar-fill"></span></span>`;
  row.querySelector("b").textContent = row.querySelector("b").title = label;
  row.querySelector("small").textContent = sub;
  row.querySelector(".stats-bar-value").textContent = typeof value === "number" ? shortNumber(value) : value;
  const fill = row.querySelector(".stats-bar-fill");
  fill.style.background = color;
  fill.style.animationDelay = 150 + i * 80 + "ms";
  fill.style.width = Math.max(2, (Number(value) || 0) / (max || 1) * 100) + "%";
  return row;
}

// ---- next milestones: when each channel passes its next round number, at the speed of this range

const STATS_MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 75000, 100000, 250000, 500000, 1e6, 2e6, 5e6, 1e7];
function milestoneOf(subs) {
  const next = STATS_MILESTONES.find((m) => m > subs) || Math.ceil((subs + 1) / 1e7) * 1e7;
  const prev = [...STATS_MILESTONES].reverse().find((m) => m <= subs) || 0;
  return { next, prev };
}
function whenText(days) {
  if (days < 1.5) return "about a day";
  if (days < 13) return `about ${Math.round(days)} days`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks`;
  if (days < 540) return `about ${Math.round(days / 30)} months`;
  return `about ${Math.round(days / 365)} years`;
}
function drawStatsGoals(series) {
  const rows = series.filter((s) => s.subscribers != null).map((s) => {
    const { next, prev } = milestoneOf(s.subscribers);
    const span = s.points.length >= 2 ? (s.points[s.points.length - 1][0] - s.points[0][0]) / DAY_MS : 0;
    const perDay = span >= 1 && s.gained > 0 ? s.gained / span : 0;
    const left = next - s.subscribers;
    const days = perDay ? left / perDay : null;
    return { ...s, next, prev, left, days };
  });
  rows.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  setChildren($("statsGoals"), rows.length ? rows.map((r, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "stats-goal";
    row.style.animationDelay = i * 60 + "ms";
    row.onclick = () => openStatsOne(r.url);
    const text = document.createElement("span");
    text.className = "stats-bar-text";
    text.append(Object.assign(document.createElement("b"), { textContent: `${r.name} → ${shortNumber(r.next)}` }),
      Object.assign(document.createElement("small"), { textContent: r.days == null ? `${r.left.toLocaleString()} to go`
        : r.days > 3650 ? `${r.left.toLocaleString()} to go, a long way off` : `${r.left.toLocaleString()} to go, in ${whenText(r.days)}` }));
    const track = document.createElement("span");
    track.className = "stats-bar-track";
    const fill = Object.assign(document.createElement("span"), { className: "stats-bar-fill" });
    fill.style.background = r.color;
    fill.style.width = Math.max(3, (r.subscribers - r.prev) / (r.next - r.prev) * 100) + "%";
    fill.style.animationDelay = 150 + i * 80 + "ms";
    track.append(fill);
    row.append(avatarEl(r.avatar, r.name), text, track);
    return row;
  }) : [Object.assign(document.createElement("p"), { className: "home-muted", textContent: "No numbers yet." })]);
}

// ---- videos with their picture, Watch and Convert

function statsVideo(v, i, max) {
  const row = document.createElement("div");
  row.className = "stats-video";
  row.style.animationDelay = i * 50 + "ms";
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "stats-video-thumb";
  thumb.title = "Watch it";
  thumb.append(Object.assign(document.createElement("img"), { src: v.thumbnail || "", alt: "", loading: "lazy" }));
  if (v.seconds) thumb.append(Object.assign(document.createElement("span"), { className: "upload-length", textContent: clock(v.seconds, false) }));
  const watch = () => openWatch(v.url, { title: v.title, sub: v.channel });
  thumb.onclick = watch;
  const text = document.createElement("div");
  text.className = "stats-video-text";
  const meta = [v.channel, v.views == null ? "" : `${v.views.toLocaleString()} ${v.views === 1 ? "view" : "views"}`,
    v.when ? sfxAgo(v.when * 1000) : ""].filter(Boolean).join(" · ");
  text.append(Object.assign(document.createElement("b"), { textContent: v.title, title: v.title }),
    Object.assign(document.createElement("small"), { textContent: meta }));
  if (max && v.views != null) {
    const track = Object.assign(document.createElement("span"), { className: "stats-bar-track" });
    const fill = Object.assign(document.createElement("span"), { className: "stats-bar-fill" });
    fill.style.background = v.color;
    fill.style.width = Math.max(2, v.views / max * 100) + "%";
    fill.style.animationDelay = 150 + i * 80 + "ms";
    track.append(fill);
    text.append(track);
  }
  const buttons = document.createElement("div");
  buttons.className = "upload-actions stats-video-buttons";
  const w = Object.assign(document.createElement("button"), { type: "button", className: "small-button", textContent: "Watch" });
  w.onclick = watch;
  const c = Object.assign(document.createElement("button"), { type: "button", className: "outline-button", textContent: "Convert" });
  c.onclick = () => homeConvert(v.url, false);
  buttons.append(w, c);
  row.append(thumb, text, buttons);
  return row;
}

function drawStatsTop(series) {
  const videos = series.flatMap((s) => (s.videos || []).filter((v) => v.views != null).map((v) => ({ ...v, channel: s.name, color: s.color })));
  videos.sort((a, b) => b.views - a.views);
  const top = videos.slice(0, 5);
  $("statsTopEmpty").hidden = top.length > 0;
  setChildren($("statsTop"), top.map((v, i) => statsVideo(v, i, top[0].views)));
}

// Uploads in the last 30 days, and when each channel uploaded last.
function drawStatsUploads(series) {
  const since = Date.now() / 1000 - 30 * 24 * 3600;
  const counts = series.map((s) => {
    const dated = (s.videos || []).filter((v) => v.when);
    return { ...s, count: dated.filter((v) => v.when >= since).length, last: Math.max(0, ...dated.map((v) => v.when)) };
  });
  counts.sort((a, b) => b.count - a.count || b.last - a.last);
  const max = Math.max(1, ...counts.map((c) => c.count));
  setChildren($("statsUploads"), counts.map((c, i) => statsBar(c.name,
    c.loading ? "Loading..." : c.last ? "Last upload " + sfxAgo(c.last * 1000) : "No uploads found",
    c.count, max, c.color, i, () => openStatsOne(c.url))));
}

// ---- one channel (3.0): click a channel to see more about it

let statsOne = "";
function openStatsOne(url) {
  statsOne = url;
  $("statsAll").hidden = true;
  $("statsOne").hidden = false;
  $("statsBackText").textContent = "All channels";
  drawStatsOne();
  ($("statsTab").closest("main") || document.scrollingElement).scrollTop = 0;
}
function closeStatsOne() {
  statsOne = "";
  $("statsAll").hidden = false;
  $("statsOne").hidden = true;
  $("statsBackText").textContent = "Home";
  $("statsHead").innerHTML = "Crew stats.<br><em>How we're growing.</em>";
}
function drawStatsOne() {
  const i = statsData ? statsData.channels.findIndex((c) => c.url === statsOne) : -1;
  if (i < 0) return closeStatsOne();
  const c = { ...statsData.channels[i], color: STATS_COLORS[i % STATS_COLORS.length] };
  const cut = statsCut(c);
  $("statsHead").replaceChildren(document.createTextNode(c.name + "."), document.createElement("br"),
    Object.assign(document.createElement("em"), { textContent: c.subscribers == null ? "Loading..." : `${c.subscribers.toLocaleString()} subscribers.` }));
  const head = document.createElement("div");
  head.className = "stats-one-top";
  const yt = Object.assign(document.createElement("button"), { type: "button", className: "outline-button", textContent: "Open on YouTube" });
  yt.onclick = () => api("/api/open-youtube", { url: c.url });
  const name = document.createElement("span");
  name.className = "stats-name";
  const handle = (c.url.match(/\/(@[^/]+)$/) || [])[1] || "";
  name.append(Object.assign(document.createElement("b"), { textContent: handle || c.name }),
    Object.assign(document.createElement("small"), { textContent: c.loading ? "Loading..." : "Their newest " + (c.videos || []).length + " videos are below" }));
  head.append(avatarEl(c.avatar, c.name, "big"), name, yt);
  setChildren($("statsOneHead"), [head]);

  const videos = (c.videos || []).map((v) => ({ ...v, channel: c.name, color: c.color }));
  const viewed = videos.filter((v) => v.views != null);
  const avg = viewed.length ? Math.round(viewed.reduce((n, v) => n + v.views, 0) / viewed.length) : null;
  const since = Date.now() / 1000 - 30 * 24 * 3600;
  const last = Math.max(0, ...videos.filter((v) => v.when).map((v) => v.when));
  const { next } = c.subscribers != null ? milestoneOf(c.subscribers) : { next: null };
  const box = (value, label, sub, kind) => {
    const el = document.createElement("div");
    el.className = "home-card stats-one-num";
    el.append(Object.assign(document.createElement("b"), { textContent: value }), Object.assign(document.createElement("span"), { textContent: label }));
    if (sub) el.append(Object.assign(document.createElement("small"), { textContent: sub, className: kind || "" }));
    return el;
  };
  const cmp = compareText(cut.gained, cut.before);
  setChildren($("statsOneNums"), [
    box(cut.gained == null ? "–" : gainedText(cut.gained) || "0", `subscribers, ${rangeText()}`, cmp, cut.gained >= (cut.before || 0) ? "up" : "down"),
    box(avg == null ? "–" : shortNumber(avg), "average views", viewed.length ? `of the newest ${viewed.length} videos` : ""),
    box(String(videos.filter((v) => v.when && v.when >= since).length), "uploads in 30 days", last ? "last one " + sfxAgo(last * 1000) : ""),
    box(next ? shortNumber(next) : "–", "next milestone", next ? `${(next - c.subscribers).toLocaleString()} to go` : ""),
  ]);
  statsLineChart($("statsOneChart"), null, [{ ...c, points: cut.points }], true);
  const best = viewed.slice().sort((a, b) => b.views - a.views).slice(0, 5);
  setChildren($("statsOneTop"), best.length ? best.map((v, j) => statsVideo(v, j, best[0].views))
    : [Object.assign(document.createElement("p"), { className: "home-muted", textContent: "No videos found yet." })]);
  const newest = videos.filter((v) => v.when).sort((a, b) => b.when - a.when).slice(0, 5);
  setChildren($("statsOneNew"), newest.length ? newest.map((v, j) => statsVideo(v, j, 0))
    : [Object.assign(document.createElement("p"), { className: "home-muted", textContent: "No videos found yet." })]);
}

$("homeSeeStats").addEventListener("click", () => showTab("stats"));
$("statsBack").addEventListener("click", () => statsOne ? closeStatsOne() : showTab("home"));
document.querySelectorAll("#statsRange button").forEach((b) => b.addEventListener("click", () => {
  const days = Number(b.dataset.days);
  if (days === statsDays) return;
  statsDays = days;
  loadStats();
}));
window.addEventListener("resize", drawStatsRange);
