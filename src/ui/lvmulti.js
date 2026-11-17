// (2.36.0) Multistreaming in the Live console: OBS sends one stream to VaultHub, and VaultHub passes it on
// to Twitch, YouTube, Kick and TikTok (a switch for each), with an upload speed check. Also the
// "You're live. Close anyway?" box, since closing VaultHub would stop the stream on every site.
// Uses $, api(), LV, LV_ICONS, lvEsc, lvToast from livecon.js / liveui.js.

const LVM = { busy: false, cfg: null, testing: false };
const LVM_ORDER = ["tw", "yt", "kick", "tt"];
const LVM_COLORS = { tw: "#9146ff", yt: "#ff3b30", kick: "#53fc18", tt: "#25f4ee" };
const LVM_TT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.6 3c.3 2.3 1.6 3.8 3.9 3.9v2.7c-1.3.1-2.5-.3-3.9-1.1v5.1c0 6.4-7 8.4-9.8 3.8-1.8-3-.7-8.2 5.2-8.4v2.8c-.4.1-.9.2-1.3.3-1.3.4-2 1.3-1.8 2.8.4 2.7 5.3 3.5 4.9-1.8V3z"/></svg>';

function lvmLogo(sid, tiny) {
  const inner = sid === "tw" || sid === "yt" ? LV_ICONS[sid] : sid === "kick" ? "K" : LVM_TT;
  return `<span class="${tiny ? "lv-tiny" : "lv-logo"} ${sid}">${inner}</span>`;
}
function lvmMbps(bits) { return bits ? (bits / 1e6).toFixed(bits >= 1e7 ? 0 : 1) : "0"; }
function lvmSwitch(on, attrs) { return `<button type="button" class="ms-sw ${on ? "on" : ""}" role="switch" aria-checked="${on}" ${attrs}></button>`; }

// The other sites as little pills next to Twitch and YouTube at the top of the console.
function lvMsPills() {
  const ms = LV.state && LV.state.ms;
  if (!ms || !ms.on || !ms.receiving) return "";
  return ["kick", "tt"].filter((sid) => ["live", "behind", "starting"].includes(ms.sites[sid].state)).map((sid) => {
    const s = ms.sites[sid];
    return `<span class="lv-pill">${lvmLogo(sid, true)}${s.state === "behind" ? `<b class="ms-pill-warn">Falling behind</b>` : `${lvEsc(s.name)} live`}</span>`;
  }).join("");
}

function lvDrawMulti() {
  const box = $("lvMulti");
  if (!box) return;
  const ms = LV.state && LV.state.ms;
  if (!ms) { box.innerHTML = `<h3>Multistream</h3><p class="lv-muted">Loading...</p>`; return; }
  const shape = JSON.stringify([ms.on, ms.receiving, ms.listening, ms.error, ms.slow, ms.behind, ms.obs, ms.obsError, ms.obsPending, ms.test, ms.testing,
    LVM_ORDER.map((sid) => [ms.sites[sid].on, ms.sites[sid].state, ms.sites[sid].error, ms.sites[sid].hasKey, Math.round(ms.sites[sid].rate / 2e5)]),
    Math.round(ms.inRate / 2e5), Math.round(ms.have / 1e6), LV.state.twitch && LV.state.twitch.viewers, LV.state.youtube && LV.state.youtube.viewers]);
  if (box.dataset.shape === shape) return;
  box.dataset.shape = shape;
  const sites = ms.sites;
  const anyKey = LVM_ORDER.some((sid) => sites[sid].hasKey);

  if (!ms.on) {
    box.innerHTML = `
      <h3>Multistream<span class="sp"></span><button type="button" class="link" data-ms="setup">Set up</button>${lvmSwitch(false, 'data-ms="switch" title="Turn multistreaming on"')}</h3>
      <div class="ms-flow"><b>OBS</b>sends straight to<b class="ms-tw">Twitch</b></div>
      ${ms.obs === "done" && ms.obsPending === null && anyKey ? `<div class="ms-okbox"><span class="ms-check">✓</span><div><b>OBS sends to Twitch again</b><p>You're streaming the normal way. You can close VaultHub any time and your stream keeps going.</p></div></div>` : ""}
      ${ms.obs === "waiting" ? `<div class="ms-note">OBS points back at Twitch as soon as this stream ends (OBS can't change it while it's live).</div>` : ""}
      ${ms.obs === "failed" ? `<div class="ms-note bad">Couldn't change OBS: ${lvEsc(ms.obsError)} In OBS, open Settings &gt; Stream and pick Twitch again.</div>` : ""}
      <p class="lv-muted ms-pitch">${anyKey ? "Flip the switch to stream to every site you picked at once." : "Stream to Twitch, YouTube, Kick and TikTok at the same time. Press Set up to add your sites."}</p>`;
    lvmWire(box);
    return;
  }

  const tw = LV.state.twitch || {}, yt = LV.state.youtube || {};
  const watching = { tw: tw.live ? tw.viewers : null, yt: yt.live ? yt.viewers : null };
  const sending = LVM_ORDER.filter((sid) => ["live", "behind", "starting"].includes(sites[sid].state));
  const pill = ms.slow && ms.receiving ? `<span class="ms-head-pill bad">Upload too slow</span>`
    : ms.receiving ? `<span class="ms-head-pill">Live on ${sending.length} site${sending.length === 1 ? "" : "s"}</span>`
    : `<span class="ms-head-pill dim">Waiting for OBS</span>`;
  const siteLine = (sid) => {
    const s = sites[sid];
    if (!s.on) return [s.hasKey ? "Off" : "No stream key yet", "off"];
    if (!ms.receiving) return [s.state === "nokey" ? "Add the stream key in Set up" : "Ready", s.state === "nokey" ? "warn" : "ready"];
    if (s.state === "starting") return ["Connecting...", "warn"];
    if (s.state === "behind") return ["Falling behind", "warn"];
    if (s.state === "error") return [s.error || "Trying again...", "bad"];
    if (s.state === "nokey") return ["Add the stream key in Set up", "warn"];
    const n = watching[sid];
    return [`Live${n != null ? ` · ${Number(n).toLocaleString("en-US")} watching` : ` · ${lvmMbps(s.rate)} Mbps`}`, ""];
  };

  // Upload: what each site uses now (or would use), against what the line can do.
  const per = ms.inRate || 6e6;
  const useOf = (sid) => (ms.receiving ? sites[sid].rate || per : per);
  const counted = (ms.receiving ? sending : LVM_ORDER.filter((sid) => sites[sid].on && sites[sid].hasKey));
  const used = counted.reduce((a, sid) => a + useOf(sid), 0);
  const have = ms.have || 0;
  const full = Math.max(have, ms.need || used, used, 1);
  const short = ms.slow ? Math.max(0, (ms.need || used) - have) : 0;
  const bar = counted.map((sid) => `<i style="width:${(useOf(sid) / full * 100).toFixed(1)}%;background:${LVM_COLORS[sid]}"></i>`).join("")
    + (short ? `<i class="over" style="width:${(short / full * 100).toFixed(1)}%"></i>` : "");
  const room = have && !ms.slow ? Math.floor((have * 0.85 - used) / per) : 0;
  const test = ms.test;
  const testAge = test ? Math.round((Date.now() / 1000 - test.at) / 60) : 0;
  const upTop = have
    ? `<b>Upload speed</b><span>${ms.slow ? `${lvmMbps(ms.need || used)} Mbps needed, about ${lvmMbps(have)} Mbps there` : `${lvmMbps(used)} of ${lvmMbps(have)} Mbps used`}</span><span class="sp"></span>${ms.slow ? `<span class="ms-short">${lvmMbps(short)} Mbps short</span>` : room > 0 ? `<span class="ms-ok">Room for ${room} more site${room === 1 ? "" : "s"}</span>` : `<span class="ms-ok">Fits</span>`}`
    : `<b>Upload speed</b><span>Not tested yet</span><span class="sp"></span>`;
  const turnOff = sending.filter((sid) => sid !== "tw").sort((a, b) => (sites[a].state === "behind" ? -1 : 0) - (sites[b].state === "behind" ? -1 : 0));
  const warn = ms.slow && ms.receiving ? `<div class="ms-warn"><b>Your internet can't keep up with ${sending.length} sites</b>
      <p>Your upload is about <strong>${lvmMbps(have)} Mbps</strong>, but ${sending.length} sites need <strong>${lvmMbps(ms.need)} Mbps</strong>.
      ${ms.behind.length ? `${ms.behind.map((sid) => sites[sid].name).join(" and ")} ${ms.behind.length === 1 ? "is" : "are"} already falling behind. ` : ""}Turn a site off to keep your main stream smooth.</p>
      <div class="row">${turnOff.slice(0, 2).map((sid, i) => `<button type="button" class="ms-btn ${i ? "" : "y"}" data-off="${sid}">Turn off ${lvEsc(sites[sid].name)}</button>`).join("")}<button type="button" class="ms-btn" data-ms="test">${ms.testing ? "Testing..." : "Test again"}</button></div></div>` : "";

  box.innerHTML = `
    <h3>Multistream<span class="sp"></span>${pill}<button type="button" class="link" data-ms="setup">Set up</button>${lvmSwitch(true, 'data-ms="switch" title="Turn multistreaming off"')}</h3>
    <div class="ms-flow"><b>OBS</b>sends one stream to<b>VaultHub</b>which copies it to every site you switch on</div>
    ${ms.error ? `<div class="ms-note bad">${lvEsc(ms.error)}</div>` : ""}
    ${!ms.receiving && !ms.error ? `<div class="ms-note">${ms.obs === "failed" ? `Couldn't set up OBS by itself (${lvEsc(ms.obsError)}). <button type="button" class="link" data-ms="setup">Do it by hand</button>` : ms.obs === "waiting" ? "OBS is still live the old way. It switches to VaultHub when that stream ends." : "Ready. Press <b>Start Streaming</b> in OBS and VaultHub sends it on."}</div>` : ""}
    <div class="ms-sites">${LVM_ORDER.map((sid) => {
      const s = sites[sid], [line, dot] = siteLine(sid);
      return `<div class="ms-site ${s.on ? "" : "off"}">${lvmLogo(sid)}
        <div class="t"><b>${lvEsc(s.name)}${s.main ? '<span class="ms-main">MAIN</span>' : ""}</b><small title="${lvEsc(line)}"><i class="ms-dot ${dot}"></i>${lvEsc(line)}</small></div>
        ${lvmSwitch(s.on, `data-site="${sid}" title="${s.on ? "Stop sending to" : "Send to"} ${lvEsc(s.name)}"`)}
      </div>`;
    }).join("")}</div>
    <div class="ms-up">
      <div class="ms-up-top">${upTop}</div>
      <div class="ms-bar">${bar}</div>
      <div class="ms-legend">${counted.map((sid) => `<span><i style="background:${LVM_COLORS[sid]}"></i>${lvEsc(sites[sid].name)} ${lvmMbps(useOf(sid))}</span>`).join("")}
        <span>${test ? `Tested ${testAge < 1 ? "just now" : testAge < 60 ? testAge + " min ago" : "earlier"}` : ""} <button type="button" class="link" data-ms="test">${ms.testing ? "Testing..." : test ? "Test again" : "Test it"}</button></span></div>
      ${warn}
    </div>`;
  lvmWire(box);
}

function lvmWire(box) {
  box.querySelectorAll('[data-ms="setup"]').forEach((b) => { b.onclick = lvmOpenSetup; });
  box.querySelectorAll('[data-ms="test"]').forEach((b) => { b.onclick = lvmTest; });
  const sw = box.querySelector('[data-ms="switch"]');
  if (sw) sw.onclick = () => lvmSwitchAll(!sw.classList.contains("on"));
  box.querySelectorAll("[data-site]").forEach((b) => { b.onclick = () => lvmSite(b.dataset.site, !b.classList.contains("on")); });
  box.querySelectorAll("[data-off]").forEach((b) => { b.onclick = () => lvmSite(b.dataset.off, false); });
}

function lvmTake(ms) {
  if (ms && LV.state) { LV.state.ms = ms; $("lvMulti").dataset.shape = ""; lvDrawMulti(); }
}

async function lvmSwitchAll(on) {
  const ms = LV.state && LV.state.ms;
  if (on && ms && !LVM_ORDER.some((sid) => ms.sites[sid].hasKey && ms.sites[sid].on)) return lvmOpenSetup();
  const res = await api("/api/live-ms-switch", { on }).catch(() => null);
  if (!res || !res.ok) return lvToast({ emoji: "⚠️", title: "Couldn't switch", text: (res && res.error) || "Try again." });
  lvmTake(res.ms);
  const obs = res.ms.obs;
  if (obs === "done") lvToast({ emoji: on ? "📡" : "✅", title: on ? "OBS now sends to VaultHub" : "OBS points at Twitch again",
    text: on ? "Press Start Streaming in OBS, and VaultHub sends it to every site you switched on." : "Multistreaming is off. You can close VaultHub and keep streaming." });
  else if (obs === "waiting") lvToast({ emoji: "⏳", title: "OBS switches after this stream", text: "OBS can't change where it sends while it's live." });
}

async function lvmSite(sid, on) {
  const res = await api("/api/live-ms-site", { site: sid, on }).catch(() => null);
  if (!res || !res.ok) {
    lvToast({ emoji: "⚠️", title: "Couldn't switch", text: (res && res.error) || "Try again." });
    if (res && /stream key|server/.test(res.error || "")) lvmOpenSetup();
    return;
  }
  lvmTake(res.ms);
}

async function lvmTest() {
  if (LVM.testing) return;
  LVM.testing = true;
  if (LV.state && LV.state.ms) { LV.state.ms.testing = true; $("lvMulti").dataset.shape = ""; lvDrawMulti(); }
  const box = $("msTestBox");
  if (box) box.innerHTML = `<b>...</b><div class="t">Testing your upload speed for a few seconds...</div>`;
  const res = await api("/api/live-ms-test", {}).catch(() => null);
  LVM.testing = false;
  if (!res || !res.ok) {
    lvToast({ emoji: "⚠️", title: "Couldn't test", text: (res && res.error) || "Check your internet." });
    if (box) lvmDrawTest(box);
    return;
  }
  if (LV.state && LV.state.ms) { LV.state.ms.test = res.test; LV.state.ms.testing = false; $("lvMulti").dataset.shape = ""; lvDrawMulti(); }
  if (box) lvmDrawTest(box, res.test);
}

// ---------------------------------------------------------------- Set up

function lvmModal() {
  let m = $("msSetupModal");
  if (m) return m;
  m = document.createElement("div");
  m.className = "modal";
  m.id = "msSetupModal";
  m.hidden = true;
  m.innerHTML = `<div class="dialog lv-setup ms-setup" role="dialog" aria-labelledby="msSetupHeading">
      <h2 id="msSetupHeading">Set up multistreaming</h2>
      <p class="sub">Stream to more sites at once. OBS sends your stream to VaultHub, and VaultHub passes the same stream on to each site you switch on.</p>
      <div id="msSetupBody"></div>
      <p class="sfx-error" id="msSetupError"></p>
      <div class="dialog-actions"><span class="spacer"></span>
        <button type="button" class="ghost-button" id="msSetupCancel">Close</button>
        <button type="button" class="small-button" id="msSetupSave">Save</button></div>
    </div>`;
  document.body.append(m);
  $("msSetupCancel").onclick = () => { m.hidden = true; };
  $("msSetupSave").onclick = lvmSave;
  m.addEventListener("mousedown", (e) => { if (e.target === m) m.hidden = true; });
  return m;
}

async function lvmOpenSetup() {
  const m = lvmModal();
  const res = await api("/api/live-ms-config", {}).catch(() => null);
  if (!res || !res.ok) return lvToast({ emoji: "⚠️", title: "Couldn't open Set up", text: "Try again." });
  const c = LVM.cfg = res.config, ms = (LV.state && LV.state.ms) || {};
  const obsOk = ms.obs !== "failed";
  $("msSetupError").textContent = "";
  $("msSetupBody").innerHTML = `
    <section class="ms-step"><h4><span class="ms-num">1</span>OBS is set up for you</h4>
      <div class="ms-auto"><span class="ms-check ${obsOk ? "" : "bad"}">${obsOk ? "✓" : "!"}</span><div><b>${obsOk ? "VaultHub changes OBS for you" : "VaultHub couldn't reach OBS"}</b>
        ${obsOk ? "When you turn multistreaming on, VaultHub tells OBS to send to VaultHub. When you turn it off, VaultHub points OBS straight back at Twitch. You never have to open OBS's stream settings."
          : lvEsc(ms.obsError || "") + " Turn on OBS's WebSocket server (Live > Set up > OBS), or copy these into OBS by hand."}</div></div>
      <details class="lv-more-box" ${obsOk ? "" : "open"}><summary>Rather do it by hand?</summary>
        <p class="lv-muted">In OBS, open <b>Settings &gt; Stream</b>, pick <b>Custom...</b> as the Service, and copy these two in:</p>
        <div class="ms-copy"><span>Server</span><code>${lvEsc(c.obsServer)}</code><button type="button" class="ms-btn" data-copy="${lvEsc(c.obsServer)}">Copy</button></div>
        <div class="ms-copy"><span>Stream key</span><code>${lvEsc(c.obsKey)}</code><button type="button" class="ms-btn" data-copy="${lvEsc(c.obsKey)}">Copy</button></div>
      </details>
    </section>
    <section class="ms-step"><h4><span class="ms-num">2</span>Pick your sites</h4>
      ${LVM_ORDER.map((sid) => {
        const s = c.sites[sid];
        return `<div class="ms-krow" data-sid="${sid}">${lvmLogo(sid)}<b>${lvEsc(s.name)}</b>
          <label class="input"><input type="password" data-key placeholder="${s.hasKey ? "Saved (paste to change)" : "Paste your stream key"}" autocomplete="off" spellcheck="false"></label>
          ${lvmSwitch(s.on, 'data-on')}
          ${s.fixed ? "" : `<label class="input ms-server"><input data-server placeholder="Server (rtmp:// or rtmps://)" value="${lvEsc(s.server)}" spellcheck="false"></label>`}
          <small>${lvEsc(s.where)}${sid === "tw" ? ". If OBS already streams to Twitch, VaultHub takes the key from OBS by itself." : ""}</small></div>`;
      }).join("")}
      <p class="lv-muted">Stream keys are saved locked on this PC and never shown again. Don't show them on stream.</p>
    </section>
    <section class="ms-step"><h4><span class="ms-num">3</span>Check your internet</h4>
      <div class="ms-test" id="msTestBox"></div>
      <p class="lv-muted" style="margin-top:12px">While you multistream, keep VaultHub open. It asks before it closes. With multistreaming off, you can close it any time.</p>
    </section>`;
  lvmDrawTest($("msTestBox"), ms.test);
  $("msSetupBody").querySelectorAll("[data-on]").forEach((b) => { b.onclick = () => { b.classList.toggle("on"); b.setAttribute("aria-checked", b.classList.contains("on")); }; });
  $("msSetupBody").querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1500); }); };
  });
  m.hidden = false;
}

function lvmDrawTest(box, test) {
  test = test || (LV.state && LV.state.ms && LV.state.ms.test);
  const on = LVM.cfg ? LVM_ORDER.filter((sid) => LVM.cfg.sites[sid].on).length : 0;
  const per = (LV.state && LV.state.ms && LV.state.ms.inRate) || 6e6;
  if (!test) {
    box.innerHTML = `<b>?</b><div class="t">See how fast your internet can send. Each site needs about <strong class="w">${lvmMbps(per)} Mbps</strong> at your OBS quality. The test sends random data to Cloudflare's free speed test for a few seconds.</div><button type="button" class="ms-btn y" id="msTestGo">Test now</button>`;
  } else {
    const fits = Math.floor(test.mbps * 1e6 * 0.85 / per);
    const msg = fits <= 0 ? `<em class="bad">Too slow for multistreaming.</em> Stream to one site only.`
      : on > fits ? `<em class="bad">Room for ${fits} site${fits === 1 ? "" : "s"}, but ${on} are switched on.</em> Switch some off.`
      : `<em>${on ? `${on} site${on === 1 ? "" : "s"} fit` : `Room for ${fits} site${fits === 1 ? "" : "s"}`}${fits > on && on ? ", with room to spare" : ""}.</em>`;
    box.innerHTML = `<b>${test.mbps} Mbps</b><div class="t">upload speed. Each site needs about <strong class="w">${lvmMbps(per)} Mbps</strong> at your OBS quality, so ${msg} VaultHub checks again while you're live and warns you if it gets too slow.</div><button type="button" class="ms-btn" id="msTestGo">Test again</button>`;
  }
  $("msTestGo").onclick = lvmTest;
}

async function lvmSave() {
  const sites = {};
  $("msSetupBody").querySelectorAll(".ms-krow").forEach((row) => {
    const sid = row.dataset.sid, d = { on: row.querySelector("[data-on]").classList.contains("on") };
    const key = row.querySelector("[data-key]").value.trim();
    if (key) d.key = key;
    const server = row.querySelector("[data-server]");
    if (server) d.server = server.value.trim();
    sites[sid] = d;
  });
  for (const [sid, d] of Object.entries(sites)) {
    if (d.on && !d.key && !LVM.cfg.sites[sid].hasKey) {
      $("msSetupError").textContent = `Paste your ${LVM.cfg.sites[sid].name} stream key, or switch ${LVM.cfg.sites[sid].name} off.`;
      return;
    }
    if (d.on && "server" in d && !d.server) {
      $("msSetupError").textContent = `${LVM.cfg.sites[sid].name} needs its server too (it's next to the stream key on ${LVM.cfg.sites[sid].name}).`;
      return;
    }
  }
  const res = await api("/api/live-ms-setup", { sites }).catch(() => null);
  if (!res || !res.ok) { $("msSetupError").textContent = (res && res.error) || "Couldn't save."; return; }
  $("msSetupModal").hidden = true;
  lvToast({ emoji: "✅", title: "Saved", text: (LV.state && LV.state.ms && LV.state.ms.on) ? "Your sites are updated." : "Flip the Multistream switch to start." });
  if (typeof lvPoll === "function") lvPoll();
}

// ---------------------------------------------------------------- "You're live. Close anyway?"

async function lvmCloseAsk() {
  const res = await api("/api/live-close-ask", {}).catch(() => null);
  const sites = (res && res.sites) || [];
  let m = $("msCloseModal");
  if (!m) {
    m = document.createElement("div");
    m.className = "modal";
    m.id = "msCloseModal";
    document.body.append(m);
  }
  const ids = { Twitch: "tw", YouTube: "yt", Kick: "kick", TikTok: "tt" };
  m.innerHTML = `<div class="dialog ms-close" role="dialog" aria-labelledby="msCloseHeading">
      <h2 id="msCloseHeading">You're live. Close anyway?</h2>
      <p class="sub">You're multistreaming through VaultHub. If you close it, your stream stops on ${sites.length === 1 ? "" : sites.length === 2 ? "both sites" : `all ${sites.length} sites`}${sites.length === 1 ? lvEsc(sites[0]) : ""}.</p>
      <div class="ms-sites">${sites.map((n) => `<div class="ms-site">${lvmLogo(ids[n] || "tw")}<div class="t"><b>${lvEsc(n)}</b><small><i class="ms-dot"></i>Live</small></div></div>`).join("")}</div>
      <p class="lv-muted">Tip: <b>Hide to tray</b> closes the window but keeps your stream going. Open VaultHub again from the little icon by the clock.</p>
      <div class="dialog-actions"><button type="button" class="ghost-button ms-red" id="msCloseNow">Close and stop stream</button><span class="spacer"></span>
        <button type="button" class="ghost-button" id="msCloseHide">Hide to tray</button><button type="button" class="small-button" id="msCloseKeep">Keep streaming</button></div>
    </div>`;
  m.hidden = false;
  $("msCloseKeep").onclick = () => { m.hidden = true; };
  $("msCloseHide").onclick = () => { m.hidden = true; api("/api/live-hide", {}).catch(() => {}); };
  $("msCloseNow").onclick = () => { m.hidden = true; api("/api/live-close-now", {}).catch(() => {}); };
  setTimeout(() => $("msCloseKeep").focus(), 50);
}

if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener("message", (e) => { if (e.data === "close-ask") lvmCloseAsk(); });
}
