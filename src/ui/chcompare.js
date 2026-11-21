// Channel stats > Compare two videos: pick two uploads (or paste any video link) and see their
// numbers side by side, with the better one lit up. Signed in with Google, it also compares
// watch time, how long people watched, and how both did in their first 30 days.
// Uses $, api() from app.js, shortNumber() from home.js, niceStep() from stats.js, sfxAgo() from sfx.js,
// openWatch() from watch.js, chData/startGoogle() from channel.js.

let chCmp = (() => {
  const saved = loadPref("chCmp");
  return Array.isArray(saved) && saved.length === 2 ? saved.map((x) => (typeof x === "string" ? x : null)) : [null, null];
})();
let chCmpItems = [null, null];
let chCmpTimer = null;
let chCmpRun = 0;
let chCmpSig = "";
let chCmpMode = ""; // mode and channel the numbers are for
let chUploads = null; // the picker's list
let chPickSide = 0;
let chPickKind = "all";
const CH_CMP_COLORS = ["var(--accent)", "#5ab8ff"];

// Called by channel.js whenever the tab draws.
function drawChCompare() {
  if (!chData || chData.mode === "none") return;
  const which = chData.mode + " " + chData.channel.url;
  if (chCmpMode !== which) { // signed in or out, or another channel: different numbers
    chCmpMode = which;
    chUploads = null;
    loadChCompare();
  } else if (!chUploads) loadChUploads();
}

async function loadChUploads() {
  try {
    const res = await api("/api/ch-uploads", {});
    if (res.ok) { chUploads = res.videos; drawChCmpQuick(); }
  } catch (e) { /* the app is closing */ }
}

function saveChCmp() {
  savePref("chCmp", chCmp);
  chCmpSig = "";
  loadChCompare();
}

async function loadChCompare() {
  clearTimeout(chCmpTimer);
  const mine = ++chCmpRun;
  if (!chUploads) loadChUploads();
  let res = null;
  if (chCmp.some(Boolean)) {
    try { res = await api("/api/ch-compare", { ids: chCmp.map((x) => x || "") }); } catch (e) { return; }
    if (mine !== chCmpRun || !res.ok) return;
    chCmpItems = res.items;
  } else chCmpItems = [null, null];
  const sig = JSON.stringify(chCmpItems);
  if (sig !== chCmpSig) { chCmpSig = sig; drawChCmp(); }
  if (chCmpItems.some((x) => x && x.loading)) {
    chCmpTimer = setTimeout(() => { if (!$("channelTab").hidden) loadChCompare(); }, 1500);
  }
}

const chCmpVideo = (i) => (chCmpItems[i] && chCmpItems[i].video) || null;
const chLength = (s) => !s ? "–" : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
  : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const chAgeDays = (v) => v && v.when ? Math.max(1, (Date.now() / 1000 - v.when) / 86400) : null;

function drawChCmp() {
  [0, 1].forEach((i) => drawChCmpSlot(i));
  $("chCmpSwap").hidden = !(chCmp[0] && chCmp[1]);
  drawChCmpQuick();
  const a = chCmpVideo(0), b = chCmpVideo(1);
  const ready = a && b && !a.partial && !b.partial;
  $("chCmpResult").hidden = !(a && b);
  if (!a || !b) return;
  const failed = chCmpItems.some((x) => x && x.error && !x.loading);
  $("chCmpVerdict").textContent = ready ? chCmpVerdict(a, b)
    : failed ? "Couldn't get all the numbers. Press the refresh button at the top to try again." : "Getting both videos' numbers...";
  drawChCmpRows(a, b, ready);
  drawChCmpFirst(a, b, ready);
}

function drawChCmpQuick() {
  const can = chUploads && chUploads.length >= 2;
  $("chCmpQuick").hidden = !can || (chCmp[0] && chCmp[1]);
}

function drawChCmpSlot(i) {
  const box = i ? $("chCmpB") : $("chCmpA");
  const item = chCmpItems[i], v = item && item.video;
  box.className = "ch-cmp-slot " + (i ? "b" : "a") + (chCmp[i] ? " filled" : "");
  box.style.setProperty("--side", CH_CMP_COLORS[i]);
  if (!chCmp[i]) {
    const pick = Object.assign(document.createElement("button"), { type: "button", className: "ch-cmp-empty" });
    pick.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Pick a video</span>`;
    pick.onclick = () => openChPick(i);
    box.replaceChildren(pick);
    return;
  }
  const thumb = Object.assign(document.createElement("button"), { type: "button", className: "ch-cmp-thumb", title: "Watch it" });
  const img = Object.assign(document.createElement("img"), { alt: "", src: (v && v.thumbnail) || `https://i.ytimg.com/vi/${chCmp[i]}/mqdefault.jpg` });
  thumb.append(img);
  if (v && v.short) thumb.append(Object.assign(document.createElement("i"), { textContent: "Short" }));
  if (v && v.seconds) thumb.append(Object.assign(document.createElement("em"), { textContent: chLength(v.seconds) }));
  thumb.onclick = () => v && openWatch(v.url, { title: v.title, sub: v.channel || (chData && chData.channel.name) || "" });
  const title = Object.assign(document.createElement("b"), { textContent: v ? v.title : item && item.error ? "Couldn't read this video" : "Loading..." });
  title.title = title.textContent;
  const bits = [];
  if (v && v.when) bits.push(sfxAgo(v.when * 1000));
  const yours = chData && chData.channel && chData.channel.name;
  if (v && v.channel && yours && v.channel !== yours) bits.push(v.channel);
  const sub = Object.assign(document.createElement("small"), { textContent: item && item.error ? item.error : item && item.loading ? (bits.length ? bits.join(" · ") + " · " : "") + "getting the numbers..." : bits.join(" · ") });
  if (item && item.error) sub.className = "bad";
  const actions = Object.assign(document.createElement("span"), { className: "ch-cmp-actions" });
  const change = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Change" });
  change.onclick = () => openChPick(i);
  const remove = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Remove" });
  remove.onclick = () => { chCmp[i] = null; saveChCmp(); };
  actions.append(change, remove);
  box.replaceChildren(thumb, title, sub, actions);
}

// What to compare. better: "high" (more is better) or "" (just different, like length).
function chCmpRowList(a, b) {
  const rate = (v, key, per) => v[key] != null && v.views ? v[key] / v.views * per : null;
  const rows = [
    { label: "Views", get: (v) => v.views, show: shortNumber, exact: true, better: "high" },
    { label: "Views a day", hint: "Views since it came out, per day", get: (v) => v.views != null && chAgeDays(v) ? v.views / chAgeDays(v) : null,
      show: (n) => n >= 100 ? shortNumber(Math.round(n)) : n.toFixed(n >= 10 ? 0 : 1), better: "high" },
    { label: "Likes", get: (v) => v.likes, show: shortNumber, exact: true, better: "high" },
    { label: "Likes per 100 views", get: (v) => rate(v, "likes", 100), show: (n) => n.toFixed(1), better: "high" },
    { label: "Comments", get: (v) => v.comments, show: shortNumber, exact: true, better: "high" },
    { label: "Comments per 1,000 views", get: (v) => rate(v, "comments", 1000), show: (n) => n.toFixed(1), better: "high" },
  ];
  if (a.hours != null || b.hours != null) {
    rows.push(
      { label: "Watch time", get: (v) => v.hours, show: (n) => `${n >= 100 ? shortNumber(Math.round(n)) : n.toLocaleString()} h`, better: "high" },
      { label: "Average watched", hint: "How long a viewer watched, on average", get: (v) => v.avgSeconds,
        show: (n, v) => chLength(Math.round(n)) + (v.avgPercent != null ? ` (${Math.round(v.avgPercent)}%)` : ""), better: "high",
        score: (v) => v.avgPercent },
      { label: "Subscribers from it", get: (v) => v.subs, show: (n) => (n > 0 ? "+" : "") + shortNumber(n), better: "high" },
    );
  }
  const week = (v) => v.firstDays && v.firstDays.length >= 7 ? v.firstDays.slice(0, 7).reduce((x, y) => x + y, 0) : null;
  if (week(a) != null || week(b) != null) rows.push({ label: "Views in the first 7 days", hint: "The fairest test: both get the same time", get: week, show: shortNumber, exact: true, better: "high" });
  rows.push({ label: "Length", get: (v) => v.seconds || null, show: (n) => chLength(n), better: "" });
  return rows;
}

function drawChCmpRows(a, b, ready) {
  const rows = chCmpRowList(a, b).map((r, n) => {
    const vals = [a, b].map((v) => (ready || r.label === "Views" || r.label === "Length" ? r.get(v) : null));
    // "Average watched" is won by the higher share watched, not the longer time (a longer video always wins that).
    const scores = [a, b].map((v, i) => (r.score ? r.score(v) : vals[i]));
    const max = Math.max(...scores.map((x) => Math.abs(x || 0)), 0) || 1;
    let win = -1;
    if (r.better && scores[0] != null && scores[1] != null && scores[0] !== scores[1]) {
      const lo = Math.min(scores[0], scores[1]), hi = Math.max(scores[0], scores[1]);
      if (hi - lo > Math.max(Math.abs(hi), 1) * 0.03) win = scores[0] > scores[1] ? 0 : 1; // within 3% is a tie
    }
    const row = Object.assign(document.createElement("div"), { className: "ch-cmp-row" + (r.better ? "" : " plain") });
    row.style.animationDelay = n * 40 + "ms";
    const side = (i) => {
      const cell = Object.assign(document.createElement("span"), { className: "ch-cmp-cell " + (i ? "b" : "a") + (win === i ? " win" : win >= 0 ? " lose" : "") });
      cell.style.setProperty("--side", CH_CMP_COLORS[i]);
      const value = Object.assign(document.createElement("b"), { textContent: vals[i] == null ? "–" : r.show(vals[i], i ? b : a) });
      if (r.exact && vals[i] != null) value.title = vals[i].toLocaleString();
      const bar = Object.assign(document.createElement("span"), { className: "ch-cmp-bar" });
      const fill = Object.assign(document.createElement("i"), {});
      fill.style.width = (scores[i] == null || !r.better ? 0 : Math.max(3, Math.abs(scores[i]) / max * 100)) + "%";
      fill.style.animationDelay = 120 + n * 50 + "ms";
      bar.append(fill);
      cell.append(value, bar);
      return cell;
    };
    const label = Object.assign(document.createElement("span"), { className: "ch-cmp-label", textContent: r.label });
    if (r.hint) label.title = r.hint;
    row.append(side(0), label, side(1));
    return row;
  });
  setChildren($("chCmpRows"), rows);
}

function chCmpVerdict(a, b) {
  const name = (v) => `"${v.title.length > 42 ? v.title.slice(0, 40).trim() + "..." : v.title}"`;
  const perDay = [a, b].map((v) => (v.views != null && chAgeDays(v) ? v.views / chAgeDays(v) : null));
  const words = [];
  let ageNote = "";
  if (a.short !== b.short) words.push("One is a Short and one is a video, so their views work differently.");
  if (perDay[0] != null && perDay[1] != null && perDay[0] + perDay[1] > 0) {
    const w = perDay[0] >= perDay[1] ? 0 : 1, lo = perDay[1 - w], hi = perDay[w];
    const ratio = lo ? hi / lo : Infinity;
    const winner = [a, b][w];
    if (ratio >= 1.15) words.push(`${name(winner)} gets ${ratio === Infinity || ratio >= 100 ? "far" : ratio.toFixed(1) + "×"} more views a day.`);
    else words.push("Both get about the same views a day.");
    // A brand-new video gets most of its views in the first days, so its "a day" drops later.
    const ages = [a, b].map(chAgeDays);
    const young = ages[0] <= ages[1] ? 0 : 1;
    if (ages[young] < 7 && ages[1 - young] > ages[young] * 2) {
      const n = Math.max(1, Math.floor(ages[young]));
      const said = words.length && words[words.length - 1].startsWith(name([a, b][young])); // just named: "It"
      ageNote = `${said ? "It" : name([a, b][young])} is only ${n} day${n === 1 ? "" : "s"} old, so its views a day will drop.`;
    }
    const likes = [a, b].map((v) => (v.likes != null && v.views ? v.likes / v.views : null));
    if (likes[0] != null && likes[1] != null && Math.min(...likes) > 0) {
      const lw = likes[0] >= likes[1] ? 0 : 1;
      if (likes[lw] / likes[1 - lw] >= 1.25) {
        words.push(ratio >= 1.15 && lw !== w ? `But viewers liked ${name([a, b][lw])} more.` : ratio >= 1.15 ? "Viewers liked it more too." : `Viewers liked ${name([a, b][lw])} more.`);
      }
    }
    if (a.avgPercent != null && b.avgPercent != null && Math.abs(a.avgPercent - b.avgPercent) >= 8) {
      const kw = a.avgPercent > b.avgPercent ? 0 : 1;
      words.push(`People watched more of ${name([a, b][kw])} (${Math.round([a, b][kw].avgPercent)}% vs ${Math.round([a, b][1 - kw].avgPercent)}%).`);
    }
  }
  if (ageNote) words.push(ageNote);
  return words.join(" ");
}

// How both did in their first 30 days, added up day by day (only YouTube knows this).
function drawChCmpFirst(a, b, ready) {
  const box = $("chCmpFirst");
  if (!ready) { box.replaceChildren(); return; }
  if (chData.mode !== "google") {
    box.innerHTML = `<div class="ch-cmp-locked"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>
      <p>Sign in with Google to also compare watch time, how long people watched, and how both did in their first 30 days.</p><button type="button" class="small-button">Sign in with Google</button></div>`;
    box.querySelector("button").onclick = startGoogle;
    return;
  }
  const lines = [a, b].map((v) => {
    let sum = 0;
    return (v.firstDays || []).slice(0, 30).map((n) => (sum += n));
  });
  if (!lines[0].length && !lines[1].length) {
    box.innerHTML = `<p class="home-muted ch-cmp-none">YouTube only shows the first days of your own videos.</p>`;
    return;
  }
  const days = Math.max(lines[0].length, lines[1].length, 2);
  const W = Math.max(320, Math.round($("chCmpResult").clientWidth) || 640), H = 200, L = 46, R = 12, T = 12, B = 26;
  let hi = Math.max(1, ...lines.flat());
  const step = niceStep(hi / 3 || 1);
  hi = Math.ceil(hi / step) * step;
  const X = (d) => L + d / (days - 1) * (W - L - R);
  const Y = (v) => T + (hi - v) / hi * (H - T - B);
  let grid = "";
  for (let v = 0; v <= hi + step / 2; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${shortNumber(v)}</text>`;
  }
  grid += `<text x="${L}" y="${H - 6}">Day 1</text><text x="${W - R}" y="${H - 6}" text-anchor="end">Day ${days}</text>`;
  const paths = lines.map((pts, i) => pts.length < 2 ? "" : `<path d="${pts.map((v, d) => `${d ? "L" : "M"}${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" pathLength="1" style="stroke:${CH_CMP_COLORS[i]};animation-delay:${i * 200}ms"/>`).join("");
  box.innerHTML = `<div class="ch-cmp-first-head"><b>Views in the first ${days} days</b>
    ${lines.map((pts, i) => `<span class="ch-cmp-key"><i style="background:${CH_CMP_COLORS[i]}"></i>${i ? "Right" : "Left"}${pts.length ? "" : ": no days yet"}</span>`).join("")}</div>
    <div class="stats-chart ch-cmp-chart"><svg viewBox="0 0 ${W} ${H}" class="stats-svg"><g class="stats-grid-lines">${grid}</g><g class="stats-lines">${paths}</g>
    <line class="stats-cursor" y1="${T}" y2="${H - B}" hidden/></svg><div class="stats-tip" hidden></div></div>`;
  const svg = box.querySelector("svg"), cursor = box.querySelector(".stats-cursor"), tip = box.querySelector(".stats-tip");
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const d = Math.round(Math.min(Math.max(((e.clientX - rect.left) / rect.width * W - L) / (W - L - R), 0), 1) * (days - 1));
    cursor.setAttribute("x1", X(d));
    cursor.setAttribute("x2", X(d));
    cursor.hidden = false;
    const parts = [Object.assign(document.createElement("b"), { textContent: `Day ${d + 1}` })];
    lines.forEach((pts, i) => {
      if (d < pts.length) {
        const s = Object.assign(document.createElement("span"), { textContent: `${pts[d].toLocaleString()} views` });
        s.style.color = CH_CMP_COLORS[i];
        parts.push(s);
      }
    });
    tip.replaceChildren(...parts);
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(X(d) / W * rect.width, 80), rect.width - 80) + "px";
  };
  svg.onmouseleave = () => { cursor.hidden = tip.hidden = true; };
}

// ---- the picker

async function openChPick(side) {
  chPickSide = side;
  $("chPickHeading").textContent = side ? "Pick the right video" : "Pick the left video";
  $("chPickSearch").value = "";
  $("chPickUrl").value = "";
  $("chPickError").textContent = "";
  $("chPickModal").hidden = false;
  drawChPick();
  setTimeout(() => $("chPickSearch").focus(), 50);
  if (!chUploads) { await loadChUploads(); drawChPick(); }
}
const closeChPick = () => { $("chPickModal").hidden = true; };

function drawChPick() {
  document.querySelectorAll("#chPickKind button").forEach((b) => b.classList.toggle("active", b.dataset.kind === chPickKind));
  if (!chUploads) {
    setChildren($("chPickList"), [Object.assign(document.createElement("p"), { className: "home-muted ch-pick-none", textContent: "Loading your uploads..." })]);
    return;
  }
  const words = $("chPickSearch").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const other = chCmp[1 - chPickSide];
  const list = chUploads.filter((v) => (chPickKind === "all" || (chPickKind === "short") === !!v.short)
    && words.every((w) => v.title.toLowerCase().includes(w)));
  if (!list.length) {
    setChildren($("chPickList"), [Object.assign(document.createElement("p"), { className: "home-muted ch-pick-none",
      textContent: chUploads.length ? "Nothing matches that." : "No uploads found yet. You can paste a link below." })]);
    return;
  }
  setChildren($("chPickList"), list.slice(0, 120).map((v) => {
    const row = Object.assign(document.createElement("button"), { type: "button", className: "ch-pick-row" });
    if (v.id === other) { row.disabled = true; row.title = "Already on the other side"; }
    if (v.id === chCmp[chPickSide]) row.classList.add("current");
    const thumb = Object.assign(document.createElement("span"), { className: "ch-thumb" + (v.short ? " short" : "") });
    thumb.append(Object.assign(document.createElement("img"), { src: v.thumbnail, alt: "", loading: "lazy" }));
    if (v.short) thumb.append(Object.assign(document.createElement("i"), { textContent: "Short" }));
    const text = Object.assign(document.createElement("span"), { className: "ch-video-text" });
    const meta = [v.when ? sfxAgo(v.when * 1000) : "", v.views != null ? shortNumber(v.views) + " views" : ""].filter(Boolean).join(" · ");
    text.append(Object.assign(document.createElement("b"), { textContent: v.title }), Object.assign(document.createElement("small"), { textContent: v.id === other ? "On the other side" : meta }));
    row.append(thumb, text);
    row.onclick = () => pickChVideo(v.id);
    return row;
  }));
}

function pickChVideo(id) {
  chCmp[chPickSide] = id;
  closeChPick();
  saveChCmp();
}

$("chPickSearch").addEventListener("input", drawChPick);
document.querySelectorAll("#chPickKind button").forEach((b) => b.addEventListener("click", () => { chPickKind = b.dataset.kind; drawChPick(); }));
$("chPickLink").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/ch-video-id", { url: $("chPickUrl").value });
  if (!res.ok) { $("chPickError").textContent = res.error; return; }
  if (res.id === chCmp[1 - chPickSide]) { $("chPickError").textContent = "That one is already on the other side."; return; }
  pickChVideo(res.id);
});
$("chPickCancel").addEventListener("click", closeChPick);
$("chPickModal").addEventListener("click", (e) => { if (e.target === $("chPickModal")) closeChPick(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("chPickModal").hidden) closeChPick(); });

$("chCmpSwap").addEventListener("click", () => {
  chCmp = [chCmp[1], chCmp[0]];
  chCmpItems = [chCmpItems[1], chCmpItems[0]];
  savePref("chCmp", chCmp);
  chCmpSig = JSON.stringify(chCmpItems);
  drawChCmp();
});
document.querySelectorAll("#chCmpQuick button").forEach((b) => b.addEventListener("click", () => {
  if (!chUploads || chUploads.length < 2) return;
  const newest = chUploads[0];
  const same = chUploads.filter((v) => v.short === newest.short && v.id !== newest.id);
  const pool = same.length ? same : chUploads.slice(1);
  const other = b.dataset.quick === "best"
    ? pool.reduce((best, v) => ((v.views || 0) > (best.views || 0) ? v : best), pool[0]) : pool[0];
  chCmp = [newest.id, other.id];
  saveChCmp();
}));
