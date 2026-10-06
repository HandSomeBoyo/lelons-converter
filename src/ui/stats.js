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
    const res = await api("/api/stats", { days });
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

function drawStatsPage() {
  const d = statsData;
  const series = d.channels.map((c, i) => ({ ...c, color: STATS_COLORS[i % STATS_COLORS.length], points: statsSeries(c) }));
  const longest = Math.max(0, ...series.map((s) => s.points.length));
  $("statsNote").textContent = d.error ? d.error
    : !d.loggedIn ? "Log in to see how the channels grew. The live numbers still show."
    : longest < 2 ? "The app writes down the subscribers once a day, so the charts fill in from today."
    : longest < Math.min(d.days, 7) ? "The charts fill in a bit more every day." : "";
  drawStatsBoard(series);
  drawStatsChart(series);
  drawStatsTop(series);
  drawStatsUploads(series);
}

function gainedText(n) {
  if (n == null) return "";
  return (n > 0 ? "+" : n < 0 ? "−" : "") + shortNumber(Math.abs(n));
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

function drawStatsBoard(series) {
  const rows = series.map((s) => {
    const first = s.points[0], last = s.points[s.points.length - 1];
    return { ...s, gained: s.points.length >= 2 ? last[1] - first[1] : null };
  });
  // Most subscribers gained wins; with no history yet, the most subscribers.
  const byGain = rows.some((r) => r.gained != null);
  rows.sort((a, b) => byGain ? (b.gained ?? -Infinity) - (a.gained ?? -Infinity) || (b.subscribers || 0) - (a.subscribers || 0)
    : (b.subscribers || 0) - (a.subscribers || 0));
  $("statsBoardNote").textContent = byGain ? (statsDays >= 3650 ? "most subscribers gained" : `most gained in ${statsDays} days`) : "most subscribers";
  setChildren($("statsBoard"), rows.map((r, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "stats-row" + (r.loading ? " loading" : "");
    row.title = "Open the channel on YouTube";
    row.style.animationDelay = i * 60 + "ms";
    row.onclick = () => api("/api/open-youtube", { url: r.url });
    const rank = Object.assign(document.createElement("span"), { className: "stats-rank" + (i === 0 ? " first" : ""), textContent: i + 1 });
    const name = document.createElement("span");
    name.className = "stats-name";
    name.append(Object.assign(document.createElement("b"), { textContent: r.name }),
      Object.assign(document.createElement("small"), { textContent: r.loading ? "Loading..." : r.subscribers == null ? "–" : r.subscribers.toLocaleString() + " subscribers" }));
    const gain = Object.assign(document.createElement("span"), {
      className: "stats-gain" + (r.gained > 0 ? " up" : r.gained < 0 ? " down" : ""),
      textContent: r.gained == null ? "" : gainedText(r.gained),
    });
    row.append(rank, avatarEl(r.avatar, r.name), name, sparkline(r.points, r.color), gain);
    return row;
  }));
}

function drawStatsChart(series) {
  const box = $("statsChart");
  const lines = series.filter((s) => s.points.length);
  const all = lines.flatMap((s) => s.points);
  setChildren($("statsLegend"), lines.map((s) => {
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
  const gains = lines.map((s) => s.points.map((p) => [p[0], p[1] - s.points[0][1]]));
  let lo = Math.min(0, ...gains.flat().map((p) => p[1])), hi = Math.max(1, ...gains.flat().map((p) => p[1]));
  const step = niceStep((hi - lo) / 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (t) => L + (t - x0) / (x1 - x0 || 1) * (W - L - R);
  const Y = (v) => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  let grid = "";
  for (let v = lo; v <= hi + step / 2; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? "zero" : ""}"/>`
      + `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${gainedText(v) || "0"}</text>`;
  }
  const dayText = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  grid += `<text x="${L}" y="${H - 6}">${dayText(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${dayText(x1)}</text>`;
  const paths = gains.map((g, i) => {
    const d = g.map((p, j) => `${j ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const end = g[g.length - 1];
    return `<path d="${d}" pathLength="1" style="stroke:${lines[i].color};animation-delay:${i * 120}ms"/>`
      + `<circle cx="${X(end[0])}" cy="${Y(end[1])}" r="3.5" style="fill:${lines[i].color};animation-delay:${900 + i * 120}ms"/>`;
  }).join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="stats-svg"><g class="stats-grid-lines">${grid}</g><g class="stats-lines">${paths}</g>
    <line class="stats-cursor" y1="${T}" y2="${H - B}" hidden/></svg><div class="stats-tip" hidden></div>`;

  // Hover: the day under the mouse and what each channel had gained by then.
  const svg = box.querySelector("svg"), cursor = box.querySelector(".stats-cursor"), tip = box.querySelector(".stats-tip");
  const days = [...new Set(gains.flat().map((p) => p[0]))].sort((a, b) => a - b);
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const t = x0 + ((e.clientX - rect.left) / rect.width * W - L) / (W - L - R) * (x1 - x0);
    const day = days.reduce((best, d) => Math.abs(d - t) < Math.abs(best - t) ? d : best, days[0]);
    cursor.setAttribute("x1", X(day));
    cursor.setAttribute("x2", X(day));
    cursor.hidden = false;
    tip.replaceChildren(Object.assign(document.createElement("b"), { textContent: dayText(day) }), ...gains.map((g, i) => {
      const p = g.filter((q) => q[0] <= day).pop();
      const line = document.createElement("span");
      line.innerHTML = `<i style="background:${lines[i].color}"></i>`;
      line.append(lines[i].name + " ", Object.assign(document.createElement("em"), { textContent: p ? gainedText(p[1]) || "0" : "–" }));
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
  row.querySelector(".stats-bar-value").textContent = shortNumber(value);
  const fill = row.querySelector(".stats-bar-fill");
  fill.style.background = color;
  fill.style.animationDelay = 150 + i * 80 + "ms";
  fill.style.width = Math.max(2, (Number(value) || 0) / (max || 1) * 100) + "%";
  return row;
}

function drawStatsTop(series) {
  const videos = series.flatMap((s) => (s.videos || []).filter((v) => v.views != null).map((v) => ({ ...v, channel: s.name, color: s.color })));
  videos.sort((a, b) => b.views - a.views);
  const top = videos.slice(0, 5);
  $("statsTopEmpty").hidden = top.length > 0;
  setChildren($("statsTop"), top.map((v, i) => statsBar(v.title, v.channel, v.views, top[0].views, v.color, i,
    () => api("/api/open-youtube", { url: v.url }))));
}

function drawStatsUploads(series) {
  const since = Date.now() / 1000 - 30 * 24 * 3600;
  const counts = series.map((s) => ({ ...s, count: (s.videos || []).filter((v) => v.when && v.when >= since).length }));
  counts.sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...counts.map((c) => c.count));
  setChildren($("statsUploads"), counts.map((c, i) => statsBar(c.name, c.loading ? "Loading..." : c.count === 1 ? "video" : "videos",
    c.count, max, c.color, i)));
}

$("homeSeeStats").addEventListener("click", () => showTab("stats"));
$("statsBack").addEventListener("click", () => showTab("home"));
document.querySelectorAll("#statsRange button").forEach((b) => b.addEventListener("click", () => {
  const days = Number(b.dataset.days);
  if (days === statsDays) return;
  statsDays = days;
  loadStats();
}));
window.addEventListener("resize", drawStatsRange);
