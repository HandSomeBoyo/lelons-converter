// The Live place: a console for while you stream (Twitch + YouTube chat, viewers, OBS health,
// goals, what happened), a soundboard with keys that work in games, chat alerts, and stats after
// each stream. Uses $, api() from app.js, loadPref/savePref from theme.js, lv* from liveui.js.

const LV = {
  cfg: null, state: null, seq: 0, chat: [], removed: [], polling: 0, first: true, busy: false,
  filter: loadPref("lvFilter") || "both", sendTo: loadPref("lvSendTo") || "both",
  stick: true, newBelow: 0, editGoals: false, statsId: "", statsList: null, statsData: null,
};
const LV_GOAL_NAMES = { followers: "New followers", subs: "New subs", members: "New members", chat: "Chat messages", peak: "Most watching", chatters: "People chatting" };
const LV_ALERT_RULES = [
  ["follow", "💜", "Someone follows", "tw", "Twitch (sign in to Twitch for this one)"],
  ["sub", "⭐", "Someone subscribes or gifts subs", "tw", "Twitch"],
  ["raid", "🚀", "Someone raids you", "tw", "Twitch · shows how many people came"],
  ["bits", "💎", "Someone cheers bits", "tw", "Twitch"],
  ["superchat", "💸", "Super Chat or Super Sticker", "yt", "YouTube"],
  ["member", "🎖️", "Someone becomes a member", "yt", "YouTube"],
  ["keyword", "🔔", "A word shows up in chat", "", "Both · any of the words below"],
  ["first", "👋", "Someone chats for the first time", "tw", "Twitch"],
];
const LV_TONES = { ding: "Soft ding", chime: "Chime", pop: "Pop", fanfare: "Fanfare", none: "No sound" };
const LV_ALERT_DEFAULT = { follow: { on: true, sound: "chime" }, sub: { on: true, sound: "fanfare" }, raid: { on: true, sound: "fanfare" },
  bits: { on: true, sound: "chime" }, superchat: { on: true, sound: "fanfare" }, member: { on: true, sound: "chime" },
  keyword: { on: true, sound: "ding" }, first: { on: false, sound: "pop" } };

function lvEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function lvNum(n) { return n == null ? "–" : Number(n).toLocaleString("en-US"); }
function lvOnPage() { const t = loadPref("tab"); return ["live", "lvboard", "lvalerts", "lvstats"].includes(t) && !$(t + "Tab").hidden; }
function lvAlerts() {
  const saved = loadPref("lvAlerts") || {};
  const out = {};
  for (const k of Object.keys(LV_ALERT_DEFAULT)) out[k] = { ...LV_ALERT_DEFAULT[k], ...(saved[k] || {}) };
  out.words = Array.isArray(saved.words) ? saved.words : [];
  out.volume = typeof saved.volume === "number" ? saved.volume : 0.7;
  out.onStream = !!saved.onStream;
  return out;
}
function lvSaveAlerts(a) { savePref("lvAlerts", a); }
function lvMyWords() {
  const a = lvAlerts();
  const words = [...a.words];
  const c = LV.cfg || {};
  if (c.twitch) words.push(c.twitch);
  if (c.twitchLogin && c.twitchLogin !== c.twitch) words.push(c.twitchLogin);
  return words;
}

// ---------------------------------------------------------------- talking to the app

async function lvLoadConfig() {
  const res = await api("/api/live-config", {}).catch(() => null);
  if (res && res.ok) LV.cfg = res.config;
  return LV.cfg;
}

async function lvPoll() {
  clearTimeout(LV.polling);
  if (LV.busy) return;
  const wanted = lvOnPage() || (LV.cfg && LV.cfg.set) || LV.popped;
  if (!wanted) return;
  LV.busy = true;
  const res = await api("/api/live-state", { since: LV.seq }).catch(() => null);
  LV.busy = false;
  if (res && res.ok) lvTake(res);
  const fast = lvOnPage() || LV.popped || (res && res.session);
  LV.polling = setTimeout(lvPoll, fast ? 2000 : 6000);
}

function lvTake(res) {
  const fresh = res.chat || [];
  LV.cfg = res.config;
  LV.state = res;
  if (res.seq < LV.seq) LV.chat = []; // the app restarted
  LV.seq = res.seq;
  LV.chat = lvRemoved(LV.chat.concat(fresh), res.removed).slice(-400);
  LV.removed = res.removed || [];
  if (!LV.first) lvAlertFor(fresh.filter((i) => !i.old && !i.own && !i.guest));
  LV.first = false;
  if (typeof lvRecapCheck === "function") lvRecapCheck(res);
  const live = !!res.session;
  $("lvOnAir").hidden = !live;
  if (!$("liveTab").hidden) lvDrawConsole(fresh);
}

// ---------------------------------------------------------------- the console

function lvDrawConsole(fresh) {
  const s = LV.state, c = LV.cfg;
  if (!c) return;
  if (!c.set) return lvDrawWelcome();
  if (!$("lvGrid")) lvBuildConsole();
  lvDrawTopBar();
  lvDrawNumbers();
  lvDrawGraph();
  lvDrawHealth();
  lvDrawGoals();
  lvDrawEvents();
  lvAppendChat(fresh || []);
  lvDrawSendState();
  if (typeof lvDrawPreview === "function") lvDrawPreview();
  if (typeof lvDrawInfo === "function") lvDrawInfo();
  if (typeof lvDrawTwitchCards === "function") lvDrawTwitchCards();
  if (typeof lvDrawObs === "function") lvDrawObs();
  if (typeof lvDrawMulti === "function") lvDrawMulti();
  if (typeof lvDrawAds === "function") lvDrawAds();
  if (typeof lvDrawCo === "function") lvDrawCo();
  if (typeof lvDrawExtras === "function") lvDrawExtras();
  if (typeof lvRefit === "function") lvRefit();
  if (s && s.obs) $("lvRecBox").innerHTML = lvRecordingHtml(s.obs);
}

function lvDrawWelcome() {
  $("lvTop").innerHTML = "";
  $("lvTop").dataset.html = "";
  $("lvBody").innerHTML = `
    <h1 class="headline">Live console.<br><em>Everything about your stream in one place.</em></h1>
    <div class="lv-welcome">
      <div class="lv-card">
        <h3>While you stream, see</h3>
        <ul class="lv-list">
          <li>Twitch and YouTube chat together, and a small chat window that stays on top of your game</li>
          <li>How many people watch, on a graph, with raids marked</li>
          <li>How OBS is doing: upload speed, dropped frames, CPU and graphics card, with a warning when something goes wrong</li>
          <li>Followers, subs, raids, Super Chats and members as they happen, and goals for the stream</li>
          <li>If OBS is recording, and how much disk space is left</li>
        </ul>
        <button type="button" class="small-button" id="lvStartSetup">Set it up</button>
        <p class="lv-muted" style="margin-top:12px">It's free. Type your Twitch name and YouTube channel, and turn on OBS's WebSocket server. That's it.</p>
      </div>
    </div>`;
  $("lvStartSetup").addEventListener("click", lvOpenSetup);
}

function lvBuildConsole() {
  // Every card is its own piece of one grid, so you can move and size it (Customize, lvlayout.js).
  $("lvBody").innerHTML = `
    <div class="lv-cbar" id="lvCbar" hidden>
      <p><b>Make it yours.</b> Drag a card by its dots, make it wider or narrower, or take it off.</p>
      <span class="sp"></span><button type="button" class="link" id="lvcReset">Start over</button>
      <button type="button" class="small-button" id="lvcDone">Done</button>
    </div>
    <div class="lv-board" id="lvGrid">
      <div class="lv-card lv-info" id="lvInfo" data-c="info" hidden></div>
      <div class="lv-nums" id="lvNums" data-c="nums"></div>
      <div class="lv-card lv-prev" id="lvPrevCard" data-c="preview"></div>
      <div class="lv-card lv-chatbox" data-c="chat">
        <div class="lv-chat-head">
          <h3>Chat</h3><span class="lv-speed" id="lvSpeed"></span><span class="sp"></span>
          <span class="lv-seg" id="lvFilter"><button data-f="both">Both</button><button data-f="tw">${LV_ICONS.tw}Twitch</button><button data-f="yt">${LV_ICONS.yt}YouTube</button></span>
        </div>
        <div class="lv-msgcols" id="lvMsgCols"><div class="lv-msgs" id="lvMsgs"></div></div>
        <button type="button" class="lv-more" id="lvMore" hidden>New messages</button>
        <form class="lv-send" id="lvSend" autocomplete="off">
          <label class="input"><input id="lvSendText" maxlength="500" placeholder="Say something to chat..."></label>
          <select id="lvSendTo" title="Where it goes"><option value="both">Both</option><option value="tw">Twitch</option><option value="yt">YouTube</option></select>
        </form>
        <p class="lv-send-note" id="lvSendNote"></p>
      </div>
      <div class="lv-card" data-c="graph">
        <h3>Watching<span class="sp"></span><span class="lv-legend"><span><i class="tw"></i>Twitch</span><span><i class="yt"></i>YouTube</span></span></h3>
        <div class="lv-chart" id="lvGraph"></div>
      </div>
      <div class="lv-card" id="lvHealthCard" data-c="health">
        <h3>Stream health<span class="sp"></span><span class="lv-health-pill" id="lvHealthPill"></span></h3>
        <div id="lvHealth"></div>
        <div class="lv-rec" id="lvRecBox"></div>
      </div>
      <div class="lv-card" data-c="goals"><h3>Goals<span class="sp"></span><button type="button" class="link" id="lvGoalsEdit">Edit</button></h3><div id="lvGoals"></div></div>
      <div class="lv-card" data-c="events"><h3>What happened</h3><div class="lv-events" id="lvEvents"></div></div>
      <div class="lv-card lvo" data-c="obs" id="lvObsCard"></div>
      <div class="lv-card" data-c="clips" id="lvClips"></div>
      <div class="lv-card" data-c="modes" id="lvModes"></div>
      <div class="lv-card" data-c="newbies" id="lvNewbies"></div>
      <div class="lv-card lvco" data-c="costream" id="lvCo" hidden></div>
      <div class="lv-card lvx" data-c="gamedetect" id="lvGd" hidden></div>
      <div class="lv-card lvx" data-c="earn" id="lvEarn" hidden></div>
      <div class="lv-card lvx" data-c="mic" id="lvMic" hidden></div>
      <div class="lv-card ms-card" data-c="multi" id="lvMulti"></div>
      <div class="lv-card ad-card" data-c="ads" id="lvAds" hidden></div>
    </div>`;
  if (typeof lvLayoutInit === "function") lvLayoutInit();
  LV.drawn = new Set();
  $("lvFilter").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    LV.filter = b.dataset.f;
    savePref("lvFilter", LV.filter);
    lvRedrawChat();
  });
  $("lvMsgs").addEventListener("scroll", () => {
    const m = $("lvMsgs");
    LV.stick = m.scrollHeight - m.scrollTop - m.clientHeight < 40;
    if (LV.stick) { LV.newBelow = 0; $("lvMore").hidden = true; }
  });
  $("lvMore").addEventListener("click", () => { const m = $("lvMsgs"); m.scrollTop = m.scrollHeight; });
  lvSendOptions();
  $("lvSendTo").addEventListener("change", () => { LV.sendTo = $("lvSendTo").value; savePref("lvSendTo", LV.sendTo); lvDrawSendState(); });
  $("lvSend").addEventListener("submit", lvSendNow);
  $("lvGoalsEdit").addEventListener("click", () => { LV.editGoals = !LV.editGoals; lvDrawGoals(true); });
  lvRedrawChat();
}

function lvDrawTopBar() {
  const s = LV.state || {}, tw = s.twitch || {}, yt = s.youtube || {}, obs = s.obs || {}, c = LV.cfg || {};
  const live = s.session;
  const since = live ? Date.now() / 1000 - live.start : 0;
  const chip = (p, on, n, off) => `<span class="lv-pill ${on ? "" : "dim"}"><span class="lv-tiny ${p}">${LV_ICONS[p]}</span>${on ? `<b>${lvNum(n)}</b> watching` : off}</span>`;
  const html = `
    ${live ? `<span class="lv-live-pill">LIVE <b id="lvClock"></b></span>` : `<span class="lv-pill dim"><i class="lv-off-dot"></i>Not live</span>`}
    ${c.twitch ? chip("tw", tw.live, tw.viewers, tw.chat === "on" ? "Offline · chat on" : "Offline") : ""}
    ${c.youtube ? chip("yt", yt.live, yt.viewers, "Offline") : ""}
    ${typeof lvMsPills === "function" ? lvMsPills() : ""}
    ${c.obsOn ? `<span class="lv-pill ${obs.connected ? "" : "dim"}" title="${lvEsc(obs.error || "")}"><i class="lv-obs-dot ${obs.connected ? (obs.streaming ? "on" : "ok") : ""}"></i>OBS ${obs.connected ? (obs.streaming ? "streaming" : "connected") : "not connected"}</span>` : ""}
    <span class="sp"></span>
    <button type="button" class="lv-ghost" id="lvCustomize" title="Move, size and pick the cards"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4" rx="1.5"/><rect x="13.5" y="10.5" width="7" height="10" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/></svg>Customize</button>
    <button type="button" class="lv-ghost" id="lvPop" title="Pop out chat (a small chat window that stays on top of your game)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5h5.5V10M19.5 4.5 12 12"/><path d="M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/></svg>Pop out</button>
    <button type="button" class="icon-button" id="lvSetupOpen" title="Set up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>`;
  // (3.0) Only redrawn when something in it changed: redrawing it every 2 seconds could swallow a click on its buttons.
  if ($("lvTop").dataset.html !== html) {
    $("lvTop").innerHTML = html;
    $("lvTop").dataset.html = html;
    $("lvPop").addEventListener("click", lvPopOut);
    $("lvCustomize").addEventListener("click", () => lvLayoutEdit(true));
    $("lvSetupOpen").addEventListener("click", lvOpenSetup);
  }
  if ($("lvClock")) $("lvClock").textContent = lvClock(since);
}

function lvDrawNumbers() {
  const s = LV.state || {}, tw = s.twitch || {}, yt = s.youtube || {};
  const t = (s.session && s.session.totals) || {};
  const now = (tw.viewers || 0) + (yt.viewers || 0);
  const box = (label, value, sub) => `<div class="lv-num"><small>${label}</small><b>${value}</b>${sub ? `<i>${sub}</i>` : ""}</div>`;
  $("lvNums").innerHTML = [
    box("Watching now", s.session || tw.live || yt.live ? lvNum(now) : "–", tw.live && yt.live ? `${lvNum(tw.viewers)} Twitch · ${lvNum(yt.viewers)} YouTube` : ""),
    box("Most this stream", s.session ? lvNum(t.peak) : "–", ""),
    box("Chat per minute", lvNum(s.speed || 0), s.session ? `${lvNum(t.chatters)} people chatted` : ""),
    box("New followers", s.session ? lvNum(t.followers) : "–", tw.followers != null ? `${lvNum(tw.followers)} in total` : ""),
    box("Subs & members", s.session ? lvNum((t.subs || 0) + (t.members || 0)) : "–", t.money ? lvEsc(t.money) + " in Super Chats" : t.bits ? `${lvNum(t.bits)} bits` : ""),
  ].join("");
  $("lvSpeed").textContent = (s.speed || 0) + " / min";
  $("lvSpeed").className = "lv-speed" + ((s.speed || 0) >= 40 ? " hot" : "");
}

// The viewer graph: Twitch under YouTube, raids marked. series: [{t (seconds in), tw, yt, chat}]
function lvGraphSvg(series, events, start, opts = {}) {
  const W = 700, H = opts.h || 190;
  if (!series || series.length < 2) {
    return `<div class="lv-graph-empty">${opts.empty || "The graph starts when you go live."}</div>`;
  }
  // (3.0) The graph starts at the first point: VaultHub opened an hour into the stream drew one block at the far right.
  const t0 = series[0].t || 0, end = Math.max(t0 + 1, series[series.length - 1].t || 1);
  const hasYt = series.some((p) => p.yt > 0);  // (no YouTube: no red line over the Twitch one)
  const top = Math.max(10, ...series.map((p) => (p.tw || 0) + (p.yt || 0)));
  const nice = (n) => { const step = Math.pow(10, Math.floor(Math.log10(n))); return Math.ceil(n / step * 1.1) * step; };
  const max = nice(top);
  const x = (t) => ((t - t0) / (end - t0) * W).toFixed(1), y = (v) => (H - v / max * H).toFixed(1);
  const line = (f) => series.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(f(p))}`).join("");
  const area = (f, g) => line(f) + series.slice().reverse().map((p) => `L${x(p.t)},${y(g(p))}`).join("") + "Z";
  const tw = (p) => p.tw || 0, both = (p) => (p.tw || 0) + (p.yt || 0);
  const grid = [0, 0.5, 1].map((f) => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="g"/><text x="${W + 8}" y="${+y(max * f) + 4}" class="l">${Math.round(max * f)}</text>`).join("");
  const span = end - t0;
  const steps = span > 4 * 3600 ? 3600 : span > 2 * 3600 ? 1800 : span > 3600 ? 900 : span > 1200 ? 600 : span > 600 ? 300 : 60;
  let ticks = "";
  const hm = (t) => Math.floor(t / 3600) + ":" + String(Math.floor(t / 60) % 60).padStart(2, "0");
  for (let t = Math.ceil(t0 / steps) * steps; t <= end - steps * 0.4; t += steps) ticks += `<text x="${x(t)}" y="${H + 16}" class="l" text-anchor="${t > t0 ? "middle" : "start"}">${hm(t)}</text>`;
  const peak = series.reduce((a, p) => (both(p) > both(a) ? p : a), series[0]);
  let marks = "";
  for (const e of (events || []).filter((e) => e.kind === "raid")) {
    const t = e.at - start;
    if (t < t0 || t > end) continue;
    const near = series.reduce((a, p) => (Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a), series[0]);
    marks += `<g class="raid"><line x1="${x(t)}" x2="${x(t)}" y1="${y(both(near))}" y2="${H}"/><circle cx="${x(t)}" cy="${y(both(near))}" r="4.5"/><title>Raid from ${lvEsc(e.user)} (+${e.amount || 0})</title></g>`;
  }
  const px = +x(peak.t), label = `Most: ${both(peak)} at ${hm(peak.t)}`;
  const flip = px > W - 150;
  return `<svg viewBox="-2 -12 ${W + 44} ${H + 30}" class="lv-svg">${grid}
    <path d="${area(tw, () => 0)}" class="a tw"/><path d="${line(tw)}" class="s tw"/>
    ${hasYt ? `<path d="${area(both, tw)}" class="a yt"/><path d="${line(both)}" class="s yt"/>` : ""}
    ${marks}
    ${both(peak) ? `<circle cx="${px}" cy="${y(both(peak))}" r="4.5" class="peak"/><g transform="translate(${flip ? px - 12 : px + 12},${+y(both(peak)) - 4})"><rect x="${flip ? -(label.length * 6.4 + 12) : 0}" width="${label.length * 6.4 + 12}" height="22" rx="6" class="tip"/><text x="${flip ? -(label.length * 6.4 + 6) : 6}" y="15" class="tipt">${label}</text></g>` : ""}
    ${ticks}</svg>`;
}

function lvChatBars(series) {
  if (!series || series.length < 2) return "";
  const W = 700, H = 50, n = series.length;
  const max = Math.max(5, ...series.map((p) => p.chat || 0));
  const avg = series.reduce((a, p) => a + (p.chat || 0), 0) / n;
  return `<svg viewBox="-2 0 ${W + 44} ${H}" class="lv-svg">${series.map((p, i) => {
    const h = Math.max(1, (p.chat || 0) / max * H);
    return `<rect x="${(i / n * W).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, W / n - 1).toFixed(2)}" height="${h.toFixed(1)}" rx="1" class="${p.chat >= Math.max(10, avg * 2) ? "hot" : ""}"/>`;
  }).join("")}</svg>`;
}

function lvDrawGraph() {
  const s = LV.state && LV.state.session;
  $("lvGraph").innerHTML = s ? lvGraphSvg(s.series, s.events, s.start, { empty: "You're live. The graph fills in from here, one point a minute." })
    : lvGraphSvg([], [], 0, { empty: "The graph starts when you go live. Stream with VaultHub open and it fills in by itself." });
  const yt = $("lvGraph").closest(".lv-card").querySelector(".lv-legend .yt");
  if (yt) yt.parentElement.hidden = !(LV.cfg && LV.cfg.youtube);
}

function lvDrawHealth() {
  const obs = (LV.state && LV.state.obs) || {}, c = LV.cfg || {};
  const pill = $("lvHealthPill");
  if (!c.obsOn) {
    pill.textContent = "";
    $("lvHealth").innerHTML = `<p class="lv-muted">Connect OBS in Set up to see upload speed, dropped frames, CPU and recording.</p>`;
    return;
  }
  if (!obs.connected) {
    pill.className = "lv-health-pill off";
    pill.textContent = "Not connected";
    $("lvHealth").innerHTML = `<p class="lv-muted">${lvEsc(obs.error || "Looking for OBS...")}</p>`;
    return;
  }
  const bad = (obs.warnings || []).some((w) => w.level === "bad"), warn = (obs.warnings || []).some((w) => w.level === "warn");
  pill.className = "lv-health-pill " + (!obs.streaming ? "idle" : bad ? "bad" : warn ? "warn" : "good");
  pill.textContent = !obs.streaming ? "Not streaming" : bad ? "Problem" : warn ? "Watch out" : "All good";
  const b = (obs.bitrates || []).slice(-60);
  const top = Math.max(1000, ...b);
  const spark = b.length > 1 ? `<svg viewBox="0 0 120 30" class="lv-spark"><path d="${b.map((v, i) => `${i ? "L" : "M"}${(i / (b.length - 1) * 120).toFixed(1)},${(28 - v / top * 26).toFixed(1)}`).join("")}"/></svg>` : "";
  const level = (v, w, d) => (v == null ? "" : v >= d ? "bad" : v >= w ? "warn" : "");
  const cell = (label, value, cls, sub) => `<div class="lv-h ${cls || ""}"><small>${label}</small><b>${value}</b>${sub ? `<i>${sub}</i>` : ""}</div>`;
  $("lvHealth").innerHTML = `
    <div class="lv-hgrid">
      ${cell("Upload speed", obs.streaming ? `${lvNum(obs.bitrate)}<em> kbps</em>` : "–", "", spark)}
      ${cell("Dropped frames", obs.streaming ? `${(obs.droppedPct || 0).toFixed(1)}%` : "–", level(obs.droppedPct, 1, 5), obs.streaming ? `${lvNum(obs.dropped)} of ${lvNum(obs.total)}` : "")}
      ${cell("FPS", lvNum(obs.fps), "", (obs.laggedPct || 0) >= 2 ? `${obs.laggedPct.toFixed(1)}% drawn late` : "")}
      ${cell("OBS CPU", obs.cpu == null ? "–" : obs.cpu.toFixed(0) + "%", level(obs.cpu, 70, 90), obs.memory ? `${lvNum(obs.memory)} MB memory` : "")}
      ${cell("Graphics card", obs.gpu == null ? "–" : obs.gpu + "%", level(obs.gpu, 90, 97), obs.gpuTemp ? obs.gpuTemp + "°C" : obs.gpu == null ? "NVIDIA only" : "")}
      ${cell("Network", !obs.streaming ? "–" : obs.reconnecting ? "Lost" : (obs.congestion || 0) > 0.5 ? "Busy" : (obs.congestion || 0) > 0.15 ? "A bit busy" : "Steady", obs.reconnecting || (obs.congestion || 0) > 0.5 ? "bad" : (obs.congestion || 0) > 0.15 ? "warn" : "", "")}
    </div>
    ${(obs.warnings || []).filter((w) => w.key !== "norec").map((w) => `<div class="lv-warn ${w.level}">${lvEsc(w.text)}</div>`).join("")}`;
}

function lvRecordingHtml(obs) {
  if (!obs.connected) return "";
  const r = obs.recording || {};
  const disk = r.diskMB != null ? (r.diskMB > 10240 ? (r.diskMB / 1024).toFixed(0) + " GB" : lvNum(r.diskMB) + " MB") + " free" : "";
  const left = r.hoursLeft != null ? ` · room for about ${r.hoursLeft >= 1 ? r.hoursLeft.toFixed(1) + " hours" : Math.max(1, Math.round(r.hoursLeft * 60)) + " minutes"}` : "";
  if (r.active) {
    return `<i class="lv-rec-dot ${r.paused ? "paused" : "on"}"></i><b>${r.paused ? "Recording paused" : "Recording"}</b><span>${lvClock(r.ms / 1000)}</span><span class="lv-muted">${disk}${left}</span>`;
  }
  return `<i class="lv-rec-dot"></i><b>Not recording</b><span class="lv-muted">${obs.streaming ? "Press Start Recording in OBS if you want a copy for YouTube. " : ""}${disk}</span>`;
}

function lvDrawGoals(force) {
  const c = LV.cfg || {}, t = (LV.state && LV.state.session && LV.state.session.totals) || {};
  const box = $("lvGoals");
  if ($("lvGoalsEdit")) $("lvGoalsEdit").textContent = LV.editGoals ? "Cancel" : "Edit";
  if (LV.editGoals) {
    if (!force && box.querySelector(".lv-goal-edit")) return;
    const goals = (c.goals || []).length ? c.goals : [{ kind: "followers", target: 10 }];
    box.innerHTML = `<div class="lv-goal-edit">${goals.map((g) => lvGoalRow(g)).join("")}</div>
      <div class="lv-row"><button type="button" class="link" id="lvGoalAdd">+ Add a goal</button><span class="sp"></span><button type="button" class="small-button" id="lvGoalSave">Save</button></div>`;
    $("lvGoalAdd").addEventListener("click", () => {
      const ed = box.querySelector(".lv-goal-edit");
      if (ed.children.length < 6) ed.insertAdjacentHTML("beforeend", lvGoalRow({ kind: "chat", target: 500 }));
    });
    box.onclick = (e) => { if (e.target.closest(".lv-goal-x")) e.target.closest(".lv-goal-row").remove(); };
    $("lvGoalSave").addEventListener("click", async () => {
      const goals = [...box.querySelectorAll(".lv-goal-row")].map((r) => ({ kind: r.querySelector("select").value, target: +r.querySelector("input").value }));
      const res = await api("/api/live-setup", { goals }).catch(() => null);
      if (res && res.ok) LV.cfg = res.config;
      LV.editGoals = false;
      lvDrawGoals(true);
    });
    return;
  }
  const goals = c.goals || [];
  if (!goals.length) {
    box.innerHTML = `<p class="lv-muted">Pick a few goals for each stream, like 10 new followers or 500 chat messages.</p>`;
    return;
  }
  box.innerHTML = goals.map((g) => {
    const have = t[g.kind] || 0, pct = Math.min(100, have / g.target * 100);
    return `<div class="lv-goal ${pct >= 100 ? "done" : ""}"><div class="lv-row"><span>${LV_GOAL_NAMES[g.kind] || g.kind}</span><span class="sp"></span><b>${lvNum(have)}</b><span class="lv-muted">/ ${lvNum(g.target)}</span></div><div class="lv-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
  }).join("");
}

function lvGoalRow(g) {
  return `<div class="lv-goal-row"><select>${Object.entries(LV_GOAL_NAMES).map(([k, n]) => `<option value="${k}" ${k === g.kind ? "selected" : ""}>${n}</option>`).join("")}</select>
    <label class="input"><input type="number" min="1" max="9999999" value="${+g.target || 1}"></label><button type="button" class="icon-button lv-goal-x" title="Remove">×</button></div>`;
}

function lvDrawEvents() {
  const s = LV.state && LV.state.session;
  const box = $("lvEvents");
  const events = s ? s.events.slice(-30).reverse() : [];
  if (!events.length) {
    box.innerHTML = `<p class="lv-muted">${s ? "Follows, subs, raids, Super Chats and members show up here." : "When you're live, follows, subs, raids and Super Chats show up here."}</p>`;
    return;
  }
  box.innerHTML = "";
  for (const e of events) {
    const row = document.createElement("div");
    row.className = "lv-ev k-" + e.kind;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = lvClock(e.at - s.start);
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.textContent = LV_EVENT_EMOJI[e.kind] || "•";
    const words = document.createElement("span");
    const [who, what] = (LV_EVENT_WORDS[e.kind] || ((x) => [x.user, ""]))(e);
    const b = document.createElement("b");
    b.textContent = who || "Someone";
    words.append(b, what);
    row.append(t, ico, lvPlat(e.p), words);
    box.append(row);
  }
}

// ---- chat

function lvChatTools(item) {
  if (item.type !== "msg" || item.own) return [];
  const c = LV.cfg || {}, s = LV.state || {};
  const to = item.guest ? "co:" + item.guest : item.p;
  const out = [lvToolButton("reply", "Answer", () => { const i = $("lvSendText"); i.value = "@" + item.user + " "; i.focus(); LV.sendTo = to; lvSendOptions(); lvDrawSendState(); })];
  if (item.guest) return out;  // (a friend's chat: their mods look after it)
  const canTw = item.p === "tw" && c.twitchSignedIn;
  const canYt = item.p === "yt" && s.youtube && s.youtube.canWrite;
  if (canTw || canYt) {
    out.push(lvToolButton("clock", "Time out for 10 minutes", () => lvMod(item, "timeout"), true));
    if (canTw) out.push(lvToolButton("trash", "Delete this message", () => lvMod(item, "delete"), true));
    out.push(lvToolButton("ban", "Ban", () => lvMod(item, "ban"), true));
  }
  return out;
}

async function lvMod(item, action) {
  if (action === "ban" && !confirmBan(item)) return;
  const res = await api("/api/live-mod", { p: item.p, action, id: item.id, userId: item.userId || "", login: item.login || "", channelId: item.channelId || "" }).catch(() => null);
  lvToast(res && res.ok ? { title: action === "delete" ? "Message deleted" : action === "timeout" ? `${item.user} is timed out for 10 minutes` : `${item.user} is banned`, quiet: true }
    : { title: "That didn't work", text: (res && res.error) || "Try again." , quiet: true });
}
function confirmBan(item) {
  // (the app avoids browser pop-ups; a second click within 4 seconds confirms)
  const key = item.p + (item.userId || item.channelId || item.login || item.user);
  if (LV.banAsk === key && Date.now() - LV.banAt < 4000) { LV.banAsk = ""; return true; }
  LV.banAsk = key; LV.banAt = Date.now();
  lvToast({ title: `Ban ${item.user}?`, text: "Click ban again to be sure.", quiet: true });
  return false;
}

function lvShown(item) {
  if (item.guest && typeof lvCoSide === "function" && lvCoSide()) return false;  // (in its own column)
  return LV.filter === "both" || item.p === LV.filter;
}

function lvRedrawChat() {
  const m = $("lvMsgs");
  if (!m) return;
  m.innerHTML = "";
  const words = lvMyWords();
  for (const item of LV.chat.filter(lvShown).slice(-250)) m.append(lvChatLine(item, { words, tools: lvChatTools }));
  if (!m.children.length) m.innerHTML = `<p class="lv-chat-empty">${lvChatEmptyText()}</p>`;
  $("lvFilter").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.f === LV.filter));
  m.scrollTop = m.scrollHeight;
  LV.stick = true;
  if (typeof lvCoRedraw === "function") lvCoRedraw();
}
function lvChatEmptyText() {
  const s = LV.state || {}, c = LV.cfg || {};
  if (c.twitch && s.twitch && s.twitch.chat === "on") return "Connected to your Twitch chat. Messages show up here.";
  if (c.twitch || c.youtube) return "Chat shows up here when you're live.";
  return "Add your Twitch name or YouTube channel in Set up.";
}

function lvAppendChat(fresh) {
  const m = $("lvMsgs");
  if (!m) return;
  if (LV.removed.length) {
    const keep = new Set(LV.chat.map((i) => i.id));
    $("lvMsgCols").querySelectorAll(".lv-m").forEach((row) => { if (row.dataset.id && !keep.has(row.dataset.id)) row.remove(); });
  }
  if (typeof lvCoAppend === "function") lvCoAppend(fresh);
  const show = fresh.filter(lvShown);
  if (!show.length) return;
  m.querySelector(".lv-chat-empty")?.remove();
  const words = lvMyWords();
  for (const item of show) m.append(lvChatLine(item, { words, tools: lvChatTools }));
  while (m.children.length > 300) m.firstElementChild.remove();
  if (LV.stick) m.scrollTop = m.scrollHeight;
  else {
    LV.newBelow += show.length;
    $("lvMore").hidden = false;
    $("lvMore").textContent = `${LV.newBelow} new message${LV.newBelow === 1 ? "" : "s"}`;
  }
}

// Where a message can go: Both, Twitch, YouTube, and (2.42.0) each friend's chat when co-streaming.
function lvSendOptions() {
  const sel = $("lvSendTo");
  if (!sel) return;
  const co = ((LV.state && LV.state.co) || []).map((f) => f.name);
  const want = ["both", "tw", "yt", ...co.map((n) => "co:" + n)];
  const have = [...sel.options].map((o) => o.value);
  if (want.join() !== have.join()) {
    sel.innerHTML = `<option value="both">Both</option><option value="tw">Twitch</option><option value="yt">YouTube</option>`
      + co.map((n) => `<option value="co:${lvEsc(n)}">${lvEsc(n)}'s chat</option>`).join("");
  }
  if (!want.includes(LV.sendTo)) LV.sendTo = "both";
  sel.value = LV.sendTo;
}

function lvDrawSendState() {
  const s = LV.state || {}, c = LV.cfg || {};
  const note = $("lvSendNote");
  if (!note) return;
  lvSendOptions();
  const to = $("lvSendTo").value;
  let text = "";
  if (to.startsWith("co:") && !c.twitchSignedIn) text = "Sign in to Twitch in Set up to write in your friend's chat.";
  else if ((to === "tw" || to === "both") && c.twitch && !c.twitchSignedIn) text = "Sign in to Twitch in Set up to write in Twitch chat.";
  else if ((to === "yt" || to === "both") && c.youtube && s.youtube && !s.youtube.canWrite) text = "To write in YouTube chat, sign in with Google on the Comments tab.";
  note.textContent = text;
}

async function lvSendNow(e) {
  e.preventDefault();
  const input = $("lvSendText"), text = input.value.trim();
  if (!text) return;
  input.value = "";
  const res = await api("/api/live-send", { text, to: $("lvSendTo").value }).catch(() => null);
  const err = res && (res.twError || res.ytError);
  if (!res || !res.ok || (err && !res.tw && !res.yt)) {
    input.value = text;
    $("lvSendNote").textContent = err || "Couldn't send it. Try again.";
  } else if (err) $("lvSendNote").textContent = err;
  lvPoll();
}

async function lvPopOut() {
  const pref = loadPref("lvPop") || {};
  const res = await api("/api/live-popout", { onTop: pref.onTop !== false, see: pref.see || 100 }).catch(() => null);
  if (!res || !res.ok) lvToast({ title: "Can't pop out the chat", text: (res && res.error) || "Try again.", quiet: true });
}

// ---------------------------------------------------------------- set up

function lvOpenSetup() {
  const c = LV.cfg || {}, s = LV.state || {};
  $("lvSetupError").textContent = "";
  $("lvSetupBody").innerHTML = `
    <section class="lv-set">
      <h4><span class="lv-logo tw">${LV_ICONS.tw}</span>Twitch</h4>
      <label class="fx-field"><span>Your Twitch name</span><span class="input"><input id="lvSetTwitch" placeholder="twitch.tv/yourname" value="${lvEsc(c.twitch)}" spellcheck="false"></span></label>
      <div class="lv-set-sign" id="lvTwSign">${lvTwitchSignHtml()}</div>
    </section>
    <section class="lv-set">
      <h4><span class="lv-logo yt">${LV_ICONS.yt}</span>YouTube</h4>
      <label class="fx-field"><span>Your channel</span><span class="input"><input id="lvSetYoutube" placeholder="youtube.com/@yourname" value="${lvEsc(c.youtube)}" spellcheck="false"></span></label>
      <p class="lv-muted">${s.youtube && s.youtube.canWrite ? "Signed in with Google: you can write in chat and time people out from here." : c.google ? "Reading chat works. To write in chat, sign in again on the Comments tab (it asks to manage your channel)." : "Reading chat works with no sign-in. To write in chat too, sign in with Google on the Comments tab."}</p>
    </section>
    <section class="lv-set">
      <h4><span class="lv-logo obs">OBS</span>OBS<span class="sp"></span><label class="check"><input type="checkbox" id="lvSetObs" ${c.obsOn ? "checked" : ""}></label></h4>
      <ol class="lv-steps"><li>In OBS, open <b>Tools &gt; WebSocket Server Settings</b>.</li><li>Tick <b>Enable WebSocket server</b> and press OK.</li><li>If <b>Enable Authentication</b> is ticked, press <b>Show Connect Info</b> and copy the password here.</li></ol>
      <div class="lv-row">
        <label class="fx-field" style="width:120px"><span>Port</span><span class="input"><input id="lvSetPort" value="${+c.obsPort || 4455}" inputmode="numeric"></span></label>
        <label class="fx-field" style="flex:1"><span>Password</span><span class="input"><input id="lvSetPass" type="password" placeholder="${c.obsPassword ? "Saved (type to change)" : "Only if OBS asks for one"}" autocomplete="off"></span></label>
      </div>
    </section>`;
  lvWireTwitchSign();
  $("lvSetupModal").hidden = false;
}

function lvTwitchSignHtml() {
  const c = LV.cfg || {};
  if (c.twitchSignedIn) {
    return `<p class="lv-muted">Signed in as <b style="color:var(--text)">${lvEsc(c.twitchLogin)}</b>. You get followers, exact viewers, writing in chat, time-outs and changing your title and game. <button type="button" class="link" id="lvTwOut">Sign out</button></p>`;
  }
  return `<div class="lv-tw-easy">
      <button type="button" class="small-button lv-tw-btn" id="lvTwEasy">${LV_ICONS.tw}Sign in with Twitch</button>
      <p class="lv-muted">Optional and free. Gives you followers, writing in chat, time-outs, clips and changing your title and game.</p>
    </div>
    <div id="lvTwCode"></div>
    <details class="lv-more-box lv-tw-own"><summary>Use your own Twitch app instead</summary>
    <ol class="lv-steps">
      <li>Open <button type="button" class="link" data-open="https://dev.twitch.tv/console/apps/create">dev.twitch.tv</button> and log in. (Twitch asks you to turn on two-step login first.)</li>
      <li>Name it <i>VaultHub ${Math.floor(Math.random() * 9000 + 1000)}</i>, type <i>http://localhost</i> as the OAuth Redirect URL, pick <b>Chat Bot</b> as the category and <b>Public</b> as the client type, then press <b>Create</b>.</li>
      <li>Press <b>Manage</b> and copy the <b>Client ID</b> here.</li>
    </ol>
    <div class="lv-row"><label class="input" style="flex:1"><input id="lvTwClient" placeholder="Client ID" value="" spellcheck="false" autocomplete="off"></label><button type="button" class="small-button" id="lvTwGo">Sign in</button></div>
    </details>`;
}

function lvWireTwitchSign() {
  const box = $("lvTwSign");
  box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => api("/api/live-open", { url: b.dataset.open })));
  $("lvTwOut")?.addEventListener("click", async () => { await api("/api/live-twitch-signout", {}); await lvLoadConfig(); box.innerHTML = lvTwitchSignHtml(); lvWireTwitchSign(); });
  const start = async (clientId) => {
    $("lvSetupError").textContent = "";
    const name = $("lvSetTwitch").value.trim();
    if (name) await api("/api/live-setup", { twitch: name }).catch(() => null);
    const res = await api("/api/live-twitch-signin", { clientId }).catch(() => null);
    if (!res || !res.ok) { $("lvSetupError").textContent = (res && res.error) || "Couldn't reach Twitch."; return; }
    // (2.42.0) The link Twitch gives already has the code in it: you just press Activate and Authorize.
    $("lvTwCode").innerHTML = `<div class="lv-code lv-code-easy"><div><b class="w">Twitch opened in your browser.</b><span>Press <b>Activate</b>, then <b>Authorize</b>. VaultHub notices by itself.</span>
      <small>Didn't open? <button type="button" class="link" id="lvTwOpen">Open it again</button> · the code is <b>${lvEsc(res.userCode)}</b></small></div></div>
      <p class="lv-muted" id="lvTwWait">Waiting for Twitch...</p>`;
    $("lvTwOpen").addEventListener("click", () => api("/api/live-open", { url: res.url }));
    api("/api/live-open", { url: res.url });
    clearInterval(LV.signTimer);
    LV.signTimer = setInterval(async () => {
      // (3.0) Keeps waiting after Save too (only Close stops it), so pressing Save before Authorize doesn't lose the sign-in.
      const r = await api("/api/live-twitch-check", {}).catch(() => null);
      if (r && r.ok && r.done) {
        clearInterval(LV.signTimer);
        await lvLoadConfig();
        if (!$("lvSetupModal").hidden && $("lvTwSign") === box) { box.innerHTML = lvTwitchSignHtml(); lvWireTwitchSign(); }
        lvToast({ emoji: "✅", title: "Signed in to Twitch", text: "Everything Twitch in the console works now." });
      } else if (r && !r.ok) {
        clearInterval(LV.signTimer);
        $("lvSetupError").textContent = r.error;
      }
    }, 3000);
  };
  $("lvTwEasy")?.addEventListener("click", () => start(""));
  $("lvTwGo")?.addEventListener("click", () => start($("lvTwClient").value));
}

async function lvSaveSetup() {
  const data = { twitch: $("lvSetTwitch").value, youtube: $("lvSetYoutube").value, obsOn: $("lvSetObs").checked, obsPort: $("lvSetPort").value };
  if ($("lvSetPass").value) data.obsPassword = $("lvSetPass").value;
  const res = await api("/api/live-setup", data).catch(() => null);
  if (!res || !res.ok) { $("lvSetupError").textContent = (res && res.error) || "Couldn't save."; return; }
  LV.cfg = res.config;
  $("lvSetupModal").hidden = true;
  LV.chat = []; LV.seq = 0; LV.first = true;
  $("lvBody").innerHTML = "";
  lvPoll();
}
$("lvSetupSave").addEventListener("click", lvSaveSetup);
$("lvSetupCancel").addEventListener("click", () => { $("lvSetupModal").hidden = true; clearInterval(LV.signTimer); });

// ---------------------------------------------------------------- sounds (soundboard and alerts)

let lvAudio = null;
function lvCtx() {
  if (!lvAudio) {
    const ctx = typeof appSinkCtx === "function" ? appSinkCtx(new AudioContext({ sampleRate: 48000 })) : new AudioContext();
    lvAudio = { ctx, gain: ctx.createGain(), playing: new Map() };
    lvAudio.gain.connect(ctx.destination);
  }
  if (lvAudio.ctx.state === "suspended") lvAudio.ctx.resume().catch(() => {});
  return lvAudio;
}
function lvBuffer(url) {
  const a = lvCtx();
  return typeof callBoardBuffer === "function" ? callBoardBuffer(a.ctx, url)
    : fetch(url).then((r) => r.arrayBuffer()).then((b) => a.ctx.decodeAudioData(b));
}

// Built-in alert sounds, made right here (so alerts work before you pick Library sounds).
function lvTone(kind, volume) {
  if (!kind || kind === "none") return;
  const a = lvCtx(), ctx = a.ctx, t0 = ctx.currentTime + 0.02;
  const notes = { ding: [[880, 0, 0.5]], chime: [[784, 0, 0.35], [1175, 0.12, 0.5]], pop: [[600, 0, 0.09]],
    fanfare: [[523, 0, 0.16], [659, 0.13, 0.16], [784, 0.26, 0.16], [1047, 0.39, 0.55]] }[kind] || [[880, 0, 0.4]];
  for (const [f, at, len] of notes) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = kind === "pop" ? "sine" : "triangle";
    o.frequency.value = f;
    if (kind === "pop") o.frequency.exponentialRampToValueAtTime(f * 1.8, t0 + at + len);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.35 * volume, t0 + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + len + 0.05);
  }
}

async function lvPlayUrl(url, volume, key, toCall) {
  const a = lvCtx();
  let buffer;
  try { buffer = await lvBuffer(url); } catch (e) { return lvToast({ title: "Couldn't load that sound", text: "Check your internet connection.", quiet: true }); }
  const src = a.ctx.createBufferSource(), g = a.ctx.createGain();
  src.buffer = buffer;
  g.gain.value = volume;
  src.connect(g).connect(a.ctx.destination);
  const entry = { src };
  if (toCall && typeof callMix !== "undefined" && callMix) {
    try {
      const c = callMix.ctx.createBufferSource(), cg = callMix.ctx.createGain();
      c.buffer = buffer;
      cg.gain.value = volume;
      c.connect(cg).connect(callMix.board);
      c.start();
      entry.call = c;
    } catch (e) { /* not in a call after all */ }
  }
  if (key) a.playing.set(key, entry);
  src.onended = () => { if (key && a.playing.get(key) === entry) { a.playing.delete(key); lvDrawPadsPlaying(); } };
  src.start();
  lvDrawPadsPlaying();
}
function lvStopAll(except) {
  if (!lvAudio) return;
  for (const [k, e] of [...lvAudio.playing]) {
    if (k === except) continue;
    try { e.src.stop(); } catch (x) { /* done */ }
    try { if (e.call) e.call.stop(); } catch (x) { /* done */ }
    lvAudio.playing.delete(k);
  }
  lvDrawPadsPlaying();
}
function lvSound(sound, volume) {
  // sound: a built-in tone name, or "lib:<id>" for a Library sound
  if (String(sound).startsWith("lib:")) {
    const s = (typeof sfxSounds !== "undefined" ? sfxSounds : []).find((x) => String(x.id) === sound.slice(4));
    if (s && s.url) return lvPlayUrl(s.url, volume, "", false);
    return lvTone("ding", volume);
  }
  lvTone(sound, volume);
}

// ---------------------------------------------------------------- alerts

function lvAlertFor(items) {
  const a = lvAlerts();
  const words = lvMyWords();
  let n = 0;
  for (const i of items) {
    if (n >= 3) break; // a big raid with lots of messages: don't play 50 sounds
    let rule = null, title = "", text = "";
    if (i.type === "event") {
      const kind = i.kind === "gift" ? "sub" : i.kind === "sticker" ? "superchat" : i.kind;
      if (!a[kind] || !a[kind].on) continue;
      rule = a[kind];
      const [who, what] = (LV_EVENT_WORDS[i.kind] || ((e) => [e.user, ""]))(i);
      title = (who || "Someone") + what;
      text = i.text || "";
    } else if (i.type === "msg" && a.keyword.on && words.length && lvSays(i.text, words)) {
      rule = a.keyword;
      title = `${i.user} said "${words.find((w) => lvSays(i.text, [w]))}"`;
      text = i.text;
    } else if (i.type === "msg" && i.first && a.first.on) {
      rule = a.first;
      title = `${i.user} chatted for the first time`;
      text = i.text;
    }
    if (!rule) continue;
    n++;
    lvSound(rule.sound, a.volume);
    lvToast({ title, text, p: i.p, emoji: i.type === "event" ? LV_EVENT_EMOJI[i.kind] : i.first ? "👋" : "🔔" });
  }
}

function lvToast(t) {
  const box = $("lvToasts");
  const el = document.createElement("div");
  el.className = "lv-toast";
  const ico = document.createElement("span");
  ico.className = "ico";
  ico.textContent = t.emoji || "🔔";
  const words = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = t.title || "";
  words.append(b);
  if (t.text) {
    const s = document.createElement("small");
    s.textContent = t.text.length > 120 ? t.text.slice(0, 117) + "..." : t.text;
    words.append(s);
  }
  if (t.quiet) el.classList.add("quiet");
  el.append(t.quiet ? "" : ico, words);
  el.addEventListener("click", () => el.remove());
  box.prepend(el);
  while (box.children.length > 4) box.lastElementChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, t.quiet ? 3500 : 7000);
}

function lvDrawAlerts() {
  const a = lvAlerts();
  const lib = (typeof sfxSounds !== "undefined" ? sfxSounds : []).filter((s) => s.url);
  const pads = lvPads();
  const options = (cur) => Object.entries(LV_TONES).map(([k, n]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${n}</option>`).join("")
    + (pads.length ? `<optgroup label="Your soundboard">${pads.map((p) => `<option value="lib:${lvEsc(p.id)}" ${cur === "lib:" + p.id ? "selected" : ""}>${lvEsc(p.name)}</option>`).join("")}</optgroup>` : "")
    + (lib.length ? `<optgroup label="Library">${lib.slice(0, 200).filter((s) => !pads.some((p) => String(p.id) === String(s.id))).map((s) => `<option value="lib:${lvEsc(s.id)}" ${cur === "lib:" + s.id ? "selected" : ""}>${lvEsc(s.name)}</option>`).join("")}</optgroup>` : "");
  $("lvAlerts").innerHTML = `
    <div class="lv-grid">
      <div class="lv-card">
        <h3>Play a sound when...</h3>
        ${LV_ALERT_RULES.map(([k, emo, name, p, sub]) => `
          <div class="lv-rule ${a[k].on ? "" : "off"}" data-k="${k}">
            <span class="ico">${emo}</span>
            <div class="words"><b>${name}</b><small>${p ? `<span class="lv-tiny ${p}">${LV_ICONS[p]}</span> ` : ""}${sub}</small></div>
            <span class="sp"></span>
            <select class="lv-snd" title="Sound">${options(a[k].sound)}</select>
            <button type="button" class="icon-button lv-test" title="Try it"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>
            <label class="check"><input type="checkbox" ${a[k].on ? "checked" : ""}></label>
          </div>
          ${k === "keyword" ? `<div class="lv-kw" id="lvWords">${a.words.map((w, i) => `<span class="lv-chip">${lvEsc(w)}<button type="button" data-i="${i}" title="Remove">×</button></span>`).join("")}<form id="lvWordForm"><input id="lvWordIn" placeholder="+ Add a word" maxlength="40"></form></div>` : ""}`).join("")}
        <p class="lv-muted" style="margin-top:12px">Your own name always counts as a word. The sounds play from VaultHub, so if OBS records your desktop sound, viewers hear them too.</p>
      </div>
      <div class="lv-col">
        <div class="lv-card">
          <h3>Volume</h3>
          <input type="range" class="volume-slider" id="lvAlertVol" min="0" max="100" value="${Math.round(a.volume * 100)}">
        </div>
        <div class="lv-card">
          <h3>What you see</h3>
          <p class="lv-muted">A card pops up in the corner of VaultHub, like this one:</p>
          <div class="lv-toast demo"><span class="ico">💜</span><div><b>frostbyte_ followed</b><small>Twitch · just now</small></div></div>
        </div>
      </div>
    </div>`;
  const box = $("lvAlerts");
  box.querySelectorAll(".lv-rule").forEach((row) => {
    const k = row.dataset.k;
    row.querySelector("input[type=checkbox]").addEventListener("change", (e) => { const x = lvAlerts(); x[k].on = e.target.checked; lvSaveAlerts(x); row.classList.toggle("off", !e.target.checked); });
    row.querySelector("select").addEventListener("change", (e) => { const x = lvAlerts(); x[k].sound = e.target.value; lvSaveAlerts(x); lvSound(e.target.value, x.volume); });
    row.querySelector(".lv-test").addEventListener("click", () => {
      const x = lvAlerts();
      lvSound(x[k].sound, x.volume);
      const sample = { follow: "frostbyte_ followed", sub: "pixelpete subscribed", raid: "frostbyte_ raided with 31 people", bits: "nightowl_k cheered 100 bits",
        superchat: "Kari sent NOK 50", member: "Tor became a member", keyword: 'Tor said "' + (x.words[0] || LV.cfg?.twitch || "your name") + '"', first: "newbie123 chatted for the first time" }[k];
      lvToast({ title: sample, text: "This is a test.", emoji: LV_ALERT_RULES.find((r) => r[0] === k)[1] });
    });
  });
  $("lvWords").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const x = lvAlerts();
    x.words.splice(+b.dataset.i, 1);
    lvSaveAlerts(x);
    lvDrawAlerts();
  });
  $("lvWordForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = $("lvWordIn").value.trim();
    if (!w) return;
    const x = lvAlerts();
    if (!x.words.includes(w) && x.words.length < 30) x.words.push(w);
    lvSaveAlerts(x);
    lvDrawAlerts();
    $("lvWordIn").focus();
  });
  $("lvAlertVol").addEventListener("change", (e) => { const x = lvAlerts(); x.volume = e.target.value / 100; lvSaveAlerts(x); lvTone("ding", x.volume); });
}

// ---------------------------------------------------------------- the soundboard

const LV_COLORS = ["#5c3b1e", "#1e3d5c", "#4d4416", "#23401f", "#5c1e1e", "#3d1e5c", "#1e4d4a", "#5c4a1e"];
const LV_KEY_NAMES = { 0x70: "F1", 0x71: "F2", 0x72: "F3", 0x73: "F4", 0x74: "F5", 0x75: "F6", 0x76: "F7", 0x77: "F8", 0x78: "F9", 0x79: "F10", 0x7A: "F11", 0x7B: "F12",
  0x60: "Num 0", 0x61: "Num 1", 0x62: "Num 2", 0x63: "Num 3", 0x64: "Num 4", 0x65: "Num 5", 0x66: "Num 6", 0x67: "Num 7", 0x68: "Num 8", 0x69: "Num 9" };
function lvPads() { const p = loadPref("lvPads"); return Array.isArray(p) ? p : []; }
function lvSavePads(p) { savePref("lvPads", p); lvSendHotkeys(); }
function lvBoardPrefs() { return { volume: 0.7, one: true, call: true, ...(loadPref("lvBoardPrefs") || {}) }; }
function lvKeyLabel(p) {
  if (!p.vk) return "No key";
  const mods = [p.mods & 2 ? "Ctrl" : "", p.mods & 1 ? "Alt" : "", p.mods & 4 ? "Shift" : ""].filter(Boolean);
  const key = LV_KEY_NAMES[p.vk] || (p.vk >= 0x30 && p.vk <= 0x5A ? String.fromCharCode(p.vk) : "Key " + p.vk);
  return [...mods, key].join(" ");
}
function lvSendHotkeys() {
  const keys = lvPads().map((p, i) => ({ id: i + 1, mods: p.mods || 0, vk: p.vk || 0 })).filter((k) => k.vk);
  const clip = loadPref("lvClipKey");
  if (clip && clip.vk) keys.push({ id: 100, mods: clip.mods || 0, vk: clip.vk });  // (the Clip key, lvtwitch.js)
  if (typeof lvoKeyList === "function") lvoKeyList().forEach(([, k], n) => keys.push({ id: 200 + n, mods: k.mods || 0, vk: k.vk }));  // (OBS scenes, lvobs.js)
  api("/api/live-hotkeys", { keys }).then((res) => { LV.taken = new Set((res && res.taken) || []); if (!$("lvboardTab").hidden) lvDrawBoard(); }).catch(() => {});
}
function lvPlayPad(i) {
  const p = lvPads()[i];
  if (!p) return;
  const prefs = lvBoardPrefs();
  const key = "pad" + i;
  if (lvAudio && lvAudio.playing.has(key)) return lvStopAll(), undefined;
  if (prefs.one) lvStopAll();
  // (the Library's own link, if it's loaded: the one saved with the pad can be old)
  const lib = (typeof sfxSounds !== "undefined" ? sfxSounds : []).find((s) => String(s.id) === String(p.id));
  lvPlayUrl((lib && lib.url) || p.url, prefs.volume * (p.volume ?? 1), key, prefs.call);
}
function lvDrawPadsPlaying() {
  document.querySelectorAll(".lv-pad[data-i]").forEach((el) => el.classList.toggle("playing", !!(lvAudio && lvAudio.playing.has("pad" + el.dataset.i))));
}

function lvDrawBoard() {
  const pads = lvPads(), prefs = lvBoardPrefs();
  const taken = LV.taken || new Set();
  $("lvBoard").innerHTML = `
    <div class="lv-grid">
      <div>
        <div class="lv-row" style="margin-bottom:14px"><span class="lv-muted">${pads.length ? "Click a sound or press its key. The keys work even while you're in a game." : "No sounds yet. Add a few from your Library and give each one a key."}</span><span class="sp"></span>${pads.length ? `<button type="button" class="lv-ghost" id="lvStop"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Stop all</button>` : ""}</div>
        <div class="lv-pads" id="lvPads">
          ${pads.map((p, i) => `<div class="lv-pad" data-i="${i}" role="button" tabindex="0">
            <span class="emo" style="background:${lvEsc(p.color || LV_COLORS[i % 8])}">${lvEsc(p.emoji || "🔊")}</span>
            <kbd class="${taken.has(i + 1) ? "taken" : ""}" title="${taken.has(i + 1) ? "Another program already uses this key. Pick another one." : "Its key"}">${lvEsc(lvKeyLabel(p))}</kbd>
            <b>${lvEsc(p.name)}</b>
            <button type="button" class="lv-pad-edit" title="Change">⋯</button>
          </div>`).join("")}
          <button type="button" class="lv-pad add" id="lvPadAdd"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add from Library</button>
        </div>
        <div id="lvPadPanel"></div>
      </div>
      <div class="lv-col">
        <div class="lv-card">
          <h3>Where the sound goes</h3>
          <div class="lv-plat"><div><b>Your stream</b><small>OBS hears VaultHub through Desktop Audio (on by default)</small></div></div>
          <div class="lv-plat"><div><b>Voice calls</b><small>Friends in a VaultHub call hear it too</small></div><span class="sp"></span><label class="check"><input type="checkbox" id="lvBCall" ${prefs.call ? "checked" : ""}></label></div>
          <div class="lv-plat"><div><b>One sound at a time</b><small>A new sound stops the one playing</small></div><span class="sp"></span><label class="check"><input type="checkbox" id="lvBOne" ${prefs.one ? "checked" : ""}></label></div>
        </div>
        <div class="lv-card"><h3>Volume</h3><input type="range" class="volume-slider" id="lvBVol" min="0" max="100" value="${Math.round(prefs.volume * 100)}"></div>
        <div class="lv-card"><h3>Not on stream?</h3><p class="lv-muted">In OBS, check that <b style="color:var(--text)">Desktop Audio</b> is in the Audio Mixer. If you use separate audio tracks, add <b style="color:var(--text)">Application Audio Capture</b> and pick <b style="color:var(--text)">msedgewebview2.exe</b> (that's VaultHub's sound).</p></div>
      </div>
    </div>`;
  lvDrawPadsPlaying();
  $("lvStop")?.addEventListener("click", () => lvStopAll());
  $("lvPads").addEventListener("click", (e) => {
    const pad = e.target.closest(".lv-pad[data-i]");
    if (!pad) return;
    if (e.target.closest(".lv-pad-edit")) return lvEditPad(+pad.dataset.i);
    lvPlayPad(+pad.dataset.i);
  });
  $("lvPads").addEventListener("contextmenu", (e) => { const pad = e.target.closest(".lv-pad[data-i]"); if (pad) { e.preventDefault(); lvEditPad(+pad.dataset.i); } });
  $("lvPadAdd").addEventListener("click", lvPickSound);
  const save = (k, v) => { const p = lvBoardPrefs(); p[k] = v; savePref("lvBoardPrefs", p); };
  $("lvBCall").addEventListener("change", (e) => save("call", e.target.checked));
  $("lvBOne").addEventListener("change", (e) => save("one", e.target.checked));
  $("lvBVol").addEventListener("change", (e) => save("volume", e.target.value / 100));
}

async function lvPickSound() {
  const panel = $("lvPadPanel");
  if (typeof sfxSounds !== "undefined" && !sfxSounds.length && typeof loadSfx === "function") {
    panel.innerHTML = `<div class="lv-card"><p class="lv-muted">Loading the Library's sounds...</p></div>`;
    await loadSfx({ quiet: true }).catch(() => {});
  }
  const all = (typeof sfxSounds !== "undefined" ? sfxSounds : []).filter((s) => s.url);
  panel.innerHTML = `<div class="lv-card lv-picker"><div class="lv-row"><h3 style="margin:0">Pick a sound</h3><span class="sp"></span><button type="button" class="icon-button" id="lvPickX" title="Close">×</button></div>
    <label class="input" style="margin:10px 0"><input id="lvPickQ" placeholder="Find a sound"></label><div class="lv-pick-list" id="lvPickList"></div></div>`;
  const draw = () => {
    const q = $("lvPickQ").value.trim().toLowerCase();
    const list = all.filter((s) => !q || String(s.name).toLowerCase().includes(q)).sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)).slice(0, 80);
    $("lvPickList").innerHTML = list.length ? "" : `<p class="lv-muted">${all.length ? "No sounds with that name." : "No sounds yet. Log in on the Library tab, or add sounds there first."}</p>`;
    for (const s of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lv-pick";
      b.textContent = (s.favorite ? "★ " : "") + s.name;
      b.addEventListener("click", () => {
        const pads = lvPads();
        if (pads.length >= 24) return;
        const used = new Set(pads.map((p) => (p.mods || 0) + ":" + p.vk));
        let vk = 0;
        for (let k = 0x31; k <= 0x39; k++) if (!used.has("2:" + k)) { vk = k; break; } // Ctrl 1..9
        pads.push({ id: s.id, name: s.name, url: s.url, vk, mods: vk ? 2 : 0, color: LV_COLORS[pads.length % 8], emoji: "🔊" });
        lvSavePads(pads);
        panel.innerHTML = "";
        lvDrawBoard();
      });
      $("lvPickList").append(b);
    }
  };
  $("lvPickQ").addEventListener("input", draw);
  $("lvPickX").addEventListener("click", () => { panel.innerHTML = ""; });
  draw();
  $("lvPickQ").focus();
}

function lvEditPad(i) {
  const pads = lvPads(), p = pads[i];
  if (!p) return;
  const panel = $("lvPadPanel");
  const emojis = ["🔊", "🥁", "📯", "😂", "🦗", "💥", "🎺", "👏", "🎉", "😱", "🔥", "💀", "🤡", "🎵", "⚡", "👋"];
  panel.innerHTML = `<div class="lv-card lv-pad-panel">
    <div class="lv-row"><h3 style="margin:0">${lvEsc(p.name)}</h3><span class="sp"></span><button type="button" class="icon-button" id="lvEdX" title="Close">×</button></div>
    <span class="lv-label">Key</span>
    <div class="lv-row"><button type="button" class="lv-ghost lv-keycap" id="lvEdKey">${lvEsc(lvKeyLabel(p))}</button><span class="lv-muted" id="lvEdKeyNote">Click, then press the keys you want (like Ctrl + 1 or F9).</span></div>
    <span class="lv-label">Picture</span>
    <div class="lv-emojis">${emojis.map((e) => `<button type="button" class="${e === p.emoji ? "on" : ""}">${e}</button>`).join("")}</div>
    <span class="lv-label">Color</span>
    <div class="lv-emojis">${LV_COLORS.map((c) => `<button type="button" data-c="${c}" class="sw ${c === p.color ? "on" : ""}" style="background:${c}"></button>`).join("")}</div>
    <span class="lv-label">Its own volume</span>
    <input type="range" class="volume-slider" id="lvEdVol" min="10" max="150" value="${Math.round((p.volume ?? 1) * 100)}">
    <div class="lv-row" style="margin-top:14px"><button type="button" class="ghost-button" id="lvEdDel">Remove from soundboard</button><span class="sp"></span><button type="button" class="small-button" id="lvEdDone">Done</button></div>
  </div>`;
  const update = (change) => { const all = lvPads(); Object.assign(all[i], change); lvSavePads(all); };
  panel.querySelectorAll(".lv-emojis button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.c) update({ color: b.dataset.c }); else update({ emoji: b.textContent });
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    lvDrawBoard(); lvEditPad(i);
  }));
  $("lvEdVol").addEventListener("change", (e) => update({ volume: e.target.value / 100 }));
  $("lvEdX").addEventListener("click", () => { panel.innerHTML = ""; });
  $("lvEdDone").addEventListener("click", () => { panel.innerHTML = ""; lvDrawBoard(); });
  $("lvEdDel").addEventListener("click", () => { const all = lvPads(); all.splice(i, 1); lvSavePads(all); panel.innerHTML = ""; lvDrawBoard(); });
  $("lvEdKey").addEventListener("click", () => {
    const btn = $("lvEdKey");
    btn.textContent = "Press keys...";
    btn.classList.add("on");
    const grab = (e) => {
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      e.preventDefault();
      document.removeEventListener("keydown", grab, true);
      btn.classList.remove("on");
      if (e.key === "Escape") { btn.textContent = lvKeyLabel(lvPads()[i]); return; }
      if (e.key === "Backspace" || e.key === "Delete") { update({ vk: 0, mods: 0 }); btn.textContent = "No key"; lvDrawBoard(); lvEditPad(i); return; }
      const vk = lvVk(e);
      if (!vk) { $("lvEdKeyNote").textContent = "That key can't be used. Try a letter, number or F-key."; btn.textContent = lvKeyLabel(lvPads()[i]); return; }
      const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
      if (!mods && !(vk >= 0x70 && vk <= 0x7B) && !(vk >= 0x60 && vk <= 0x69)) {
        $("lvEdKeyNote").textContent = "Hold Ctrl, Alt or Shift too (or use an F-key or the number pad), so typing in a game doesn't play it.";
        btn.textContent = lvKeyLabel(lvPads()[i]);
        return;
      }
      update({ vk, mods });
      lvDrawBoard(); lvEditPad(i);
    };
    document.addEventListener("keydown", grab, true);
  });
}
function lvVk(e) {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.charCodeAt(3);
  if (/^Digit\d$/.test(c)) return 0x30 + +c[5];
  if (/^Numpad\d$/.test(c)) return 0x60 + +c[6];
  const f = /^F(\d{1,2})$/.exec(c);
  if (f && +f[1] >= 1 && +f[1] <= 12) return 0x6F + +f[1];
  return 0;
}

// The keys arrive from Windows through the app's window (they work even when a game is in front).
if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener("message", (e) => {
    const m = /^hotkey:(\d+)$/.exec(String(e.data || ""));
    if (m && +m[1] >= 200) lvoSceneKey(+m[1]);
    else if (m && +m[1] === 100) lvClipNow();
    else if (m) lvPlayPad(+m[1] - 1);
  });
} else {
  // (no app window of our own, like in Edge: the keys only work while VaultHub is in front)
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, [contenteditable]")) return;
    const vk = lvVk(e), mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
    const clip = loadPref("lvClipKey");
    if (clip && clip.vk === vk && (clip.mods || 0) === mods) { e.preventDefault(); return lvClipNow(); }
    const scene = lvoKeyList().findIndex(([, k]) => k.vk === vk && (k.mods || 0) === mods);
    if (scene >= 0) { e.preventDefault(); return lvoSceneKey(200 + scene); }
    const i = lvPads().findIndex((p) => p.vk && p.vk === vk && (p.mods || 0) === mods);
    if (i >= 0) { e.preventDefault(); lvPlayPad(i); }
  });
}

// ---------------------------------------------------------------- stream stats

async function lvDrawStats() {
  const box = $("lvStats");
  if (!LV.statsList) box.innerHTML = `<h1 class="headline">Your streams.<br><em>How they went.</em></h1><p class="lv-muted">Loading...</p>`;
  const res = await api("/api/live-streams", {}).catch(() => null);
  LV.statsList = (res && res.streams) || [];
  if (!LV.statsList.length) {
    box.innerHTML = `<h1 class="headline">Your streams.<br><em>How they went.</em></h1>
      <div class="lv-card"><p class="lv-muted">Your streams show up here after you stream with VaultHub open. Twitch and YouTube don't save a viewer graph, so VaultHub writes the numbers down while you're live.</p></div>`;
    return;
  }
  if (!LV.statsList.some((s) => s.id === LV.statsId)) LV.statsId = LV.statsList[0].id;
  const data = await api("/api/live-stream", { id: LV.statsId }).catch(() => null);
  if (!data || !data.ok) return;
  const s = data.summary, list = LV.statsList;
  const i = list.findIndex((x) => x.id === s.id), prev = list[i + 1];
  const diff = (k) => {
    if (!prev || prev[k] == null || s[k] == null) return "";
    const d = Math.round((s[k] - prev[k]) * 10) / 10;
    return d === 0 ? `<i>same as last time</i>` : `<i class="${d < 0 ? "dn" : ""}">${d > 0 ? "▲" : "▼"} ${lvNum(Math.abs(d))} from last time</i>`;
  };
  const when = new Date(s.start * 1000), end = new Date(s.end * 1000);
  const hm = (d) => d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  box.innerHTML = `
    <div class="lv-row lv-stats-head"><h1 class="headline" style="margin:0">${i === 0 ? "Last stream." : "That stream."}<br><em>How it went.</em></h1><span class="sp"></span>
      <select id="lvStatsPick" title="Pick a stream">${list.map((x) => `<option value="${x.id}" ${x.id === s.id ? "selected" : ""}>${lvEsc(new Date(x.start * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }))} · ${lvEsc(x.title)}</option>`).join("")}</select></div>
    <p class="lv-muted" style="margin:8px 0 16px">${lvEsc(s.title)} · ${lvEsc(when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}, ${hm(when)} to ${hm(end)} · ${Math.floor(s.minutes / 60) ? Math.floor(s.minutes / 60) + " h " : ""}${s.minutes % 60} min</p>
    <div class="lv-nums">
      <div class="lv-num"><small>Most watching</small><b>${lvNum(s.peak)}</b>${diff("peak")}</div>
      <div class="lv-num"><small>On average</small><b>${lvNum(s.average)}</b>${diff("average")}</div>
      <div class="lv-num"><small>Chat messages</small><b>${lvNum(s.chat)}</b>${diff("chat")}</div>
      <div class="lv-num"><small>New followers</small><b>${lvNum(s.followers)}</b>${diff("followers")}</div>
      <div class="lv-num"><small>Hours watched</small><b>${lvNum(s.hoursWatched)}</b>${diff("hoursWatched")}</div>
    </div>
    ${(() => {
      // (3.0) One left and one right column, so a tall right side no longer leaves a big hole under the graph.
      const p = typeof lvRecapParts === "function" ? lvRecapParts(data) : null;
      return `<div class="lv-grid lvr-stats">
      <div class="lv-col">
        <div class="lv-card">
          <h3>Watching over time<span class="sp"></span><span class="lv-legend"><span><i class="tw"></i>Twitch</span>${(data.series || []).some((x) => x.yt > 0) ? `<span><i class="yt"></i>YouTube</span>` : ""}</span></h3>
          <div class="lv-chart">${lvGraphSvg(data.series, data.events, s.start, { empty: "This stream was too short for a graph." })}</div>
          <h3 style="margin-top:14px">Chat<span class="sp"></span><span class="lv-muted">messages per minute</span></h3>
          <div class="lv-chart">${lvChatBars(data.series)}</div>
        </div>
        ${p ? `<div class="lv-card"><h3>Top chatters</h3>${p.topHtml}<h3 style="margin-top:16px">New chatters <span class="lv-muted">${lvNum((data.newbies || []).length)}</span></h3>${p.newHtml}</div>` : ""}
      </div>
      <div class="lv-col">
        <div class="lv-card"><h3>Best moments</h3>${data.moments.length ? data.moments.map((m) => `<div class="lv-moment"><span class="t">${Math.floor(m.t / 3600)}:${String(Math.floor(m.t / 60) % 60).padStart(2, "0")}</span><div>${lvEsc(m.text)}<small>${lvEsc(m.sub)}</small></div></div>`).join("") + `<p class="lv-muted" style="margin-top:10px">Good spots to cut a clip or a Short from your recording.</p>` : `<p class="lv-muted">Nothing stood out this time.</p>`}</div>
        <div class="lv-card"><h3>Also</h3><div class="lv-who-list">
          <div>People who chatted<span class="n">${lvNum(s.chatters)}</span></div>
          <div>Subs (Twitch)<span class="n">${lvNum(s.subs)}</span></div>
          <div>Members (YouTube)<span class="n">${lvNum(s.members)}</span></div>
          <div>Raids<span class="n">${lvNum(s.raids)}</span></div>
          ${s.bits ? `<div>Bits<span class="n">${lvNum(s.bits)}</span></div>` : ""}
          ${s.money ? `<div>Super Chats<span class="n">${lvEsc(s.money)}</span></div>` : ""}
        </div><button type="button" class="link lv-forget" id="lvForget">Delete this stream from the list</button></div>
        ${p ? `<div class="lv-card"><h3>Clips</h3>${p.clipHtml}</div><div class="lv-card"><h3>Stream health</h3>${p.healthHtml}</div>
        <button type="button" class="ghost-button" id="lvStatsRecap">Show the recap card</button>` : ""}
      </div>
    </div>`; })()}`;
  if (typeof lvRecapWire === "function") lvRecapWire(box);
  if ($("lvStatsRecap")) $("lvStatsRecap").onclick = () => lvRecapOpen(s.id, false);
  $("lvStatsPick").addEventListener("change", (e) => { LV.statsId = e.target.value; lvDrawStats(); });
  $("lvForget").addEventListener("click", async (e) => {
    if (e.target.dataset.sure !== "1") { e.target.dataset.sure = "1"; e.target.textContent = "Click again to delete it"; return; }
    await api("/api/live-forget", { id: s.id });
    LV.statsId = "";
    lvDrawStats();
  });
}

// ---------------------------------------------------------------- opening the pages

function liveTabChanged(tab) {
  if (tab === "live") {
    if (!LV.cfg) lvLoadConfig().then(() => lvDrawConsole([]));
    else lvDrawConsole([]);
    lvPoll();
    clearInterval(LV.clock);
    LV.clock = setInterval(() => {
      const c = $("lvClock"), s = LV.state && LV.state.session;
      if (c && s) c.textContent = lvClock(Date.now() / 1000 - s.start);
    }, 1000);
  } else {
    clearInterval(LV.clock);
    if (typeof lvStopPreview === "function") lvStopPreview();  // (no video in the background: it would use your internet)
    if (typeof lvStopObs === "function") lvStopObs();
  }
  if (tab === "lvboard") lvDrawBoard();
  if (tab === "lvalerts") {
    lvDrawAlerts();
    if (typeof sfxSounds !== "undefined" && !sfxSounds.length && typeof loadSfx === "function") loadSfx({ quiet: true }).then(() => { if (!$("lvalertsTab").hidden) lvDrawAlerts(); }).catch(() => {});
  }
  if (tab === "lvstats") lvDrawStats();
}

lvLoadConfig().then((c) => {
  if (c && c.set) lvPoll();
  if (lvPads().length || (loadPref("lvClipKey") || {}).vk || lvoKeyList().length) lvSendHotkeys();
  const t = loadPref("tab");
  if (["live", "lvboard", "lvalerts", "lvstats"].includes(t) && !$(t + "Tab").hidden) liveTabChanged(t);
});
