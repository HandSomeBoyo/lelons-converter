// (2.34.0) Preview in the Live console: your own stream, the way viewers see it, with sound.
// The backend finds the stream with yt-dlp and passes it through the app (streampreview.py); hls.js plays it.
// It only plays while the Console is open and the preview is on, so it doesn't use your internet otherwise.
// Uses $, api(), loadPref/savePref from app.js and LV, LV_ICONS, lvEsc from livecon.js / liveui.js.

const LVP = { hls: null, key: "", loading: false, waitUntil: 0, msg: "" };
const LVP_ICONS = {
  on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.3-1.3-2.7 2.7-2.7-2.7-1.3 1.3 2.7 2.7-2.7 2.7 1.3 1.3 2.7-2.7 2.7 2.7 1.3-1.3z"/></svg>',
  big: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
};

function lvpPrefs() { return { on: false, p: "tw", vol: 0.6, muted: true, ...(loadPref("lvPreview") || {}) }; }
function lvpSave(change) { savePref("lvPreview", { ...lvpPrefs(), ...change }); }

function lvpSites() {
  const c = LV.cfg || {};
  return [c.twitch ? "tw" : "", c.youtube ? "yt" : ""].filter(Boolean);
}

// What to play right now: {p, name, live} for the picked site.
function lvpTarget() {
  const sites = lvpSites(), pref = lvpPrefs();
  const p = sites.includes(pref.p) ? pref.p : sites[0];
  const s = LV.state || {}, c = LV.cfg || {};
  if (p === "tw") return { p, name: c.twitch || "", live: !!(s.twitch && s.twitch.live) };
  return { p, name: (s.youtube && s.youtube.video) || "", live: !!(s.youtube && s.youtube.live && s.youtube.video) };
}

function lvDrawPreview() {
  const card = $("lvPrevCard");
  if (!card) return;
  const sites = lvpSites(), pref = lvpPrefs();
  card.hidden = !sites.length;
  if (!sites.length) return lvStopPreview();
  const t = lvpTarget();
  const shape = [pref.on, sites.join(), t.p].join("|");
  if (card.dataset.shape !== shape) {
    card.dataset.shape = shape;
    lvpBuild(card, pref, sites, t.p);
  }
  if (!pref.on) return;
  if (!t.live) {
    lvStopPreview();
    return lvpMessage(`You're not live on ${t.p === "tw" ? "Twitch" : "YouTube"} right now. The preview starts by itself when you are.`);
  }
  if (LVP.key === t.p + ":" + t.name || LVP.loading || Date.now() < LVP.waitUntil) return;
  lvpStart(t);
}

function lvpBuild(card, pref, sites, p) {
  lvStopPreview();
  const seg = sites.length > 1
    ? `<span class="lv-seg" id="lvpSite">${sites.map((x) => `<button type="button" data-f="${x}" class="${x === p ? "on" : ""}">${LV_ICONS[x]}${x === "tw" ? "Twitch" : "YouTube"}</button>`).join("")}</span>`
    : "";
  card.classList.toggle("off", !pref.on);
  card.innerHTML = `
    <h3>Preview<small class="lvp-sub">what viewers see</small><span class="sp"></span>${pref.on ? seg : ""}
      <button type="button" class="link" id="lvpToggle">${pref.on ? "Hide" : "Show"}</button></h3>
    ${pref.on ? `
    <div class="lvp-box" id="lvpBox">
      <video id="lvpVideo" playsinline autoplay></video>
      <div class="lvp-msg" id="lvpMsg">Loading your stream...</div>
      <div class="lvp-bar">
        <button type="button" class="lvp-btn" id="lvpMute" title="Sound on/off"></button>
        <input type="range" id="lvpVol" min="0" max="1" step="0.05" title="Volume">
        <span class="sp"></span>
        <span class="lvp-late">A few seconds behind you</span>
        <button type="button" class="lvp-btn" id="lvpBig" title="Full screen">${LVP_ICONS.big}</button>
      </div>
    </div>
    <p class="lvp-note" id="lvpNote" hidden>Wear headphones. OBS hears your PC's sound too, so this would echo on your stream.</p>`
    : `<p class="lvp-off">See and hear your stream the way viewers do, right here. It only plays while this is open.</p>`}`;
  $("lvpToggle").onclick = () => { lvpSave({ on: !pref.on }); LVP.waitUntil = 0; lvDrawPreview(); };
  if (!pref.on) return;
  if ($("lvpSite")) $("lvpSite").onclick = (e) => {
    const b = e.target.closest("button");
    if (b) { lvpSave({ p: b.dataset.f }); LVP.waitUntil = 0; lvDrawPreview(); }
  };
  const v = $("lvpVideo");
  v.volume = pref.vol;
  v.muted = pref.muted;
  $("lvpVol").value = pref.vol;
  $("lvpVol").oninput = () => {
    v.volume = +$("lvpVol").value;
    if (v.muted && v.volume > 0) v.muted = false;
    lvpSave({ vol: v.volume, muted: v.muted });
    lvpDrawSound();
  };
  $("lvpMute").onclick = () => { v.muted = !v.muted; lvpSave({ muted: v.muted }); lvpDrawSound(); v.play().catch(() => {}); };
  $("lvpBig").onclick = () => ($("lvpBox").requestFullscreen ? $("lvpBox").requestFullscreen() : null);
  v.addEventListener("playing", () => lvpMessage(""));
  v.addEventListener("waiting", () => lvpMessage("Loading..."));
  lvpDrawSound();
}

function lvpDrawSound() {
  const v = $("lvpVideo");
  if (!v) return;
  $("lvpMute").innerHTML = v.muted ? LVP_ICONS.off : LVP_ICONS.on;
  $("lvpMute").classList.toggle("on", !v.muted);
  $("lvpNote").hidden = v.muted;
}

function lvpMessage(text) {
  LVP.msg = text;
  const m = $("lvpMsg");
  if (m) { m.textContent = text; m.hidden = !text; }
}

async function lvpStart(t) {
  LVP.loading = true;
  lvpMessage("Loading your stream...");
  const key = t.p + ":" + t.name;
  const res = await api("/api/live-preview", { p: t.p, name: t.name }).catch(() => null);
  LVP.loading = false;
  const v = $("lvpVideo");
  if (!v || lvpTarget().p !== t.p || !lvpPrefs().on) return;
  if (!res || !res.ok) {
    LVP.waitUntil = Date.now() + 20000;  // (try again in a bit: a stream that just started can take a moment)
    return lvpMessage((res && res.error) || "Couldn't load the stream just now.");
  }
  lvStopPreview(true);
  LVP.key = key;
  if (typeof Hls !== "undefined" && Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 10, backBufferLength: 10 });
    LVP.hls = hls;
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal || LVP.hls !== hls) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
      lvStopPreview(true);
      LVP.waitUntil = Date.now() + 8000;
      lvpMessage("The preview stopped. Trying again...");
    });
    hls.loadSource(res.url);
    hls.attachMedia(v);
  } else {
    v.src = res.url;  // (a browser that plays these by itself)
  }
  v.play().catch(() => {
    // Sound can only start after a click: start muted instead.
    v.muted = true;
    lvpSave({ muted: true });
    lvpDrawSound();
    v.play().catch(() => {});
  });
}

// Stops the video (keepBox: leave the player on the page, ready for the next start).
function lvStopPreview(keepBox) {
  if (LVP.hls) { LVP.hls.destroy(); LVP.hls = null; }
  LVP.key = "";
  const v = $("lvpVideo");
  if (v) { v.removeAttribute("src"); v.load(); }
  if (!keepBox) LVP.loading = false;
}
