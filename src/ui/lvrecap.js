// (2.42.0) After-stream recap: when a stream ends, a card pops up with how it went (compared to last
// time), who chatted the most, new chatters, clips, the best moments and whether the stream had
// problems. The same parts show on the Stream stats page for every saved stream.
// Uses $, api(), loadPref/savePref, showTab() from app.js and LV, lvEsc, lvNum, lvClock, lvPlat, lvToast,
// lvTone from livecon.js / liveui.js.

const LVR = { showing: "", busy: false };

function lvrDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}
function lvrStamp(t) { return Math.floor(t / 3600) + ":" + String(Math.floor(t / 60) % 60).padStart(2, "0"); }
function lvrHm(at) { const d = new Date(at * 1000); return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }

// Called with each answer from the app: a stream that ended and wasn't shown yet gets its recap.
function lvRecapCheck(res) {
  const e = res && res.ended;
  if (!e || !e.id || LVR.busy || LVR.showing === e.id || loadPref("lvRecapSeen") === e.id) return;
  if (!lvOnPage()) return;  // (it waits until you open the Live place)
  lvRecapOpen(e.id, true);
}

async function lvRecapOpen(id, fresh) {
  LVR.busy = true;
  const [data, list] = await Promise.all([
    api("/api/live-stream", { id }).catch(() => null),
    api("/api/live-streams", {}).catch(() => null),
  ]);
  LVR.busy = false;
  if (!data || !data.ok) return;
  const streams = (list && list.streams) || [];
  const i = streams.findIndex((x) => x.id === id);
  const prev = i >= 0 ? streams[i + 1] : null;
  LVR.showing = id;
  savePref("lvRecapSeen", id);
  lvrDraw(data, prev, fresh);
}

function lvrDiff(s, prev, k) {
  if (!prev || prev[k] == null || s[k] == null) return "";
  const d = Math.round((s[k] - prev[k]) * 10) / 10;
  return d === 0 ? `<i>same as last time</i>` : `<i class="${d < 0 ? "dn" : ""}">${d > 0 ? "▲" : "▼"} ${lvNum(Math.abs(d))} from last time</i>`;
}

// The parts shared by the pop-up and the Stream stats page.
function lvRecapParts(data) {
  const s = data.summary, top = data.top || [], newbies = data.newbies || [], clips = data.clips || [];
  const max = top.length ? top[0].n : 1;
  const topHtml = top.length
    ? top.map((t, n) => `<div class="lvr-top"><span class="r">${n + 1}</span>${t.p === "yt" ? LV_ICONS.yt : LV_ICONS.tw}<b>${lvEsc(t.user)}</b>
        <span class="bar"><i style="width:${Math.max(6, Math.round(t.n / max * 100))}%"></i></span><span class="n">${lvNum(t.n)}</span></div>`).join("")
    : `<p class="lv-muted">Nobody chatted this time.</p>`;
  const shown = newbies.slice(0, 18);
  const newHtml = newbies.length
    ? `<div class="lvr-chips">${shown.map((n) => `<span class="lvr-chip">${lvEsc(n)}</span>`).join("")}${newbies.length > shown.length ? `<span class="lvr-chip more">+${newbies.length - shown.length} more</span>` : ""}</div>`
    : `<p class="lv-muted">No first-time chatters this stream.</p>`;
  const momentHtml = (data.moments || []).length
    ? data.moments.map((m) => `<div class="lv-moment"><span class="t">${lvrStamp(m.t)}</span><div>${lvEsc(m.text)}<small>${lvEsc(m.sub)}</small></div></div>`).join("")
    : `<p class="lv-muted">Nothing stood out this time.</p>`;
  const clipHtml = clips.length
    ? clips.slice(-5).reverse().map((c) => `<div class="lvt-cliprow"><span>Clip at <b>${lvrStamp(Math.max(0, c.at - s.start))}</b></span><span class="sp"></span>
        <button type="button" class="link" data-copy="${lvEsc(c.url)}">Copy link</button><button type="button" class="link" data-open="${lvEsc(c.edit || c.url)}">Edit on Twitch</button></div>`).join("")
    : `<p class="lv-muted">No clips this stream. Press the clip key next time something good happens.</p>`;
  return { topHtml, newHtml, momentHtml, clipHtml, healthHtml: lvrHealth(data.health || {}) };
}

function lvrHealth(h) {
  if (!h.obs) return `<div class="lvr-ok none">VaultHub wasn't connected to OBS, so it couldn't check the stream.</div>`;
  const bad = [];
  if (h.reconnects) bad.push(["bad", `OBS lost the connection ${h.reconnects === 1 ? "once" : h.reconnects + " times"}. Viewers saw the stream stop for a moment.`]);
  if (h.droppedPct >= 1) bad.push([h.droppedPct >= 5 ? "bad" : "warn", `${h.droppedPct.toFixed(1)}% of frames were dropped (${lvNum(h.dropped)}). Your internet couldn't keep up: try a lower bitrate in OBS.`]);
  if (h.slow >= 60) bad.push(["warn", `Your upload speed dipped for about ${Math.round(h.slow / 60)} min. Something else may have used the internet.`]);
  if (h.lag >= 60) bad.push(["warn", `OBS couldn't keep up for about ${Math.round(h.lag / 60)} min. The game may have used the whole graphics card.`]);
  if (!bad.length) return `<div class="lvr-ok">✓ No problems. The stream ran smoothly the whole time.</div>`;
  return bad.map(([lvl, t]) => `<div class="lvr-ok ${lvl}">${lvl === "bad" ? "✕" : "!"} ${lvEsc(t)}</div>`).join("");
}

function lvRecapWire(box) {
  box.querySelectorAll("[data-copy]").forEach((b) => { b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).catch(() => {}); b.textContent = "Copied"; }; });
  box.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => api("/api/live-open", { url: b.dataset.open }); });
}

// A short text to paste in Discord or wherever.
function lvrText(data) {
  const s = data.summary, top = data.top || [];
  const lines = [`📺 ${s.title}`, `⏱️ ${lvrDuration(s.minutes)} · 👀 ${lvNum(s.peak)} watching at most, ${lvNum(s.average)} on average`];
  const got = [];
  if (s.followers) got.push(`${lvNum(s.followers)} new follower${s.followers === 1 ? "" : "s"}`);
  if (s.subs) got.push(`${lvNum(s.subs)} sub${s.subs === 1 ? "" : "s"}`);
  if (s.raids) got.push(`${lvNum(s.raids)} raid${s.raids === 1 ? "" : "s"}`);
  if (s.newChatters) got.push(`${lvNum(s.newChatters)} new chatter${s.newChatters === 1 ? "" : "s"}`);
  if (got.length) lines.push("🎉 " + got.join(", "));
  lines.push(`💬 ${lvNum(s.chat)} messages from ${lvNum(s.chatters)} people`);
  if (top.length) lines.push("🏆 Top chatters: " + top.slice(0, 3).map((t) => t.user).join(", "));
  lines.push("Thanks for watching! 💜");
  return lines.join("\n");
}

function lvrDraw(data, prev, fresh) {
  const s = data.summary;
  const p = lvRecapParts(data);
  let m = $("lvRecapModal");
  if (!m) {
    m = document.createElement("div");
    m.className = "modal";
    m.id = "lvRecapModal";
    document.body.append(m);
  }
  const when = new Date(s.start * 1000);
  m.innerHTML = `<div class="dialog lvr" role="dialog" aria-labelledby="lvrHeading">
      <div class="lvr-head">
        <div><h2 id="lvrHeading">${fresh ? "Stream over. Nice one! 🎉" : "How your stream went"}</h2>
          <p class="sub">${lvEsc(s.title)} · ${lvEsc(when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}, ${lvrHm(s.start)} to ${lvrHm(s.end)} · ${lvrDuration(s.minutes)}</p></div>
        <button type="button" class="lvr-x" id="lvrClose" title="Close">✕</button>
      </div>
      <div class="lv-nums lvr-nums">
        <div class="lv-num"><small>Most watching</small><b>${lvNum(s.peak)}</b>${lvrDiff(s, prev, "peak")}</div>
        <div class="lv-num"><small>On average</small><b>${lvNum(s.average)}</b>${lvrDiff(s, prev, "average")}</div>
        <div class="lv-num"><small>New followers</small><b>${lvNum(s.followers)}</b>${lvrDiff(s, prev, "followers")}</div>
        <div class="lv-num"><small>New chatters</small><b>${lvNum(s.newChatters || 0)}</b>${lvrDiff(s, prev, "newChatters")}</div>
        <div class="lv-num"><small>Chat messages</small><b>${lvNum(s.chat)}</b>${lvrDiff(s, prev, "chat")}</div>
      </div>
      ${s.subs || s.raids || s.bits || s.money ? `<p class="lvr-extra">${[s.subs && `⭐ ${lvNum(s.subs)} sub${s.subs === 1 ? "" : "s"}`, s.raids && `🚀 ${lvNum(s.raids)} raid${s.raids === 1 ? "" : "s"}`, s.bits && `💎 ${lvNum(s.bits)} bits`, s.money && `💸 ${lvEsc(s.money)}`].filter(Boolean).join(" · ")}</p>` : ""}
      <div class="lvr-grid">
        <div class="lvr-col">
          <section><h3>Top chatters</h3>${p.topHtml}</section>
          <section><h3>New chatters <small>${lvNum((data.newbies || []).length)}</small></h3>${p.newHtml}</section>
        </div>
        <div class="lvr-col">
          <section><h3>Best moments</h3>${p.momentHtml}</section>
          <section><h3>Clips <small>${lvNum((data.clips || []).length)}</small></h3>${p.clipHtml}</section>
          <section><h3>Stream health</h3>${p.healthHtml}</section>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="ghost-button" id="lvrCopy">Copy recap for Discord</button><span class="spacer"></span>
        <button type="button" class="ghost-button" id="lvrStats">See all stats</button>
        <button type="button" class="small-button" id="lvrDone">Done</button>
      </div>
    </div>`;
  m.hidden = false;
  lvRecapWire(m);
  const close = () => { m.hidden = true; LVR.showing = ""; };
  $("lvrClose").onclick = close;
  $("lvrDone").onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  $("lvrStats").onclick = () => { close(); LV.statsId = s.id; if (typeof showTab === "function") showTab("lvstats"); };
  $("lvrCopy").onclick = () => {
    navigator.clipboard.writeText(lvrText(data)).catch(() => {});
    $("lvrCopy").textContent = "Copied! Paste it anywhere";
  };
  if (fresh && typeof lvTone === "function") lvTone("chime", 0.4);
  setTimeout(() => $("lvrDone") && $("lvrDone").focus(), 50);
}
