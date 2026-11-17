// (2.36.0) The ad timer in the Live console: when Twitch runs your next ad break, run it yourself at a
// good moment or snooze it, a message in chat a minute before, and OBS's BRB scene while the ads play.
// The app does the chat message and the scene switch (adtimer.py), so they work while VaultHub is minimized.
// Uses $, api(), LV, LV_ICONS, lvEsc, lvToast, lvTone, loadPref/savePref, lvtSignedIn, lvtNeedSignIn, lvOpenSetup.

const LVA = { warned: 0, scenes: null, editing: false, timer: 0, skew: 0, shape: "" };

function lvaClock(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}
function lvaMin(s) { return s >= 120 ? Math.round(s / 60) + " min" : s >= 60 ? "1 min" : Math.round(s) + " s"; }
function lvaLen(s) { return s >= 60 ? (s % 60 ? (s / 60).toFixed(1) : s / 60) + " min" : s + " s"; }
function lvaNow() { return Date.now() / 1000 + LVA.skew; }

function lvDrawAds() {
  const box = $("lvAds");
  if (!box) return;
  const c = LV.cfg || {}, a = LV.state && LV.state.ads;
  box.hidden = !c.twitch;
  if (!c.twitch || !a) return;
  LVA.skew = a.now - Date.now() / 1000;
  if (!lvtSignedIn()) { box.dataset.shape = ""; return lvtNeedSignIn(box, "Ad timer", "see when your next ad break comes and run it at a good moment"); }
  // A new "1 minute" warning: a toast here, and a beep only you hear if you want one.
  if (a.warn && a.warn.id !== LVA.warned) {
    const first = !LVA.warned;
    LVA.warned = a.warn.id;
    if (!first || a.warn.at - lvaNow() > 5) {
      lvToast({ emoji: "⏰", title: "Ad break in 1 minute", text: a.prefs.tellChat ? "Chat was told. Run it now, snooze it, or let it start by itself." : "Run it now, snooze it, or let it start by itself." });
      if (a.prefs.beep && typeof lvTone === "function") lvTone("ding", 0.7);
    }
  }
  const shape = JSON.stringify([a.ready, a.live, a.next, a.length, a.snoozes, a.prerollUntil, a.running, a.error, a.prefs, LVA.editing, LVA.scenes, lvaPhase(a)]);
  if (box.dataset.shape !== shape) {
    box.dataset.shape = shape;
    lvaBuild(box, a);
  }
  lvaTick();
  clearInterval(LVA.timer);
  LVA.timer = setInterval(lvaTick, 1000);
}

function lvaPhase(a) {
  const now = lvaNow();
  if (a.running && now < a.running.until) return "run";
  if (!a.live) return "off";
  if (!a.next) return "none";
  if (a.next - now <= 60 && a.next > now) return "soon";
  return "wait";
}

function lvaRing(frac, cls, label) {
  return `<div class="ad-ring ${cls}"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/><circle class="fg" id="lvaRing" cx="50" cy="50" r="42" stroke-dasharray="${(Math.max(0, Math.min(1, frac)) * 264).toFixed(0)} 264"/></svg><span>${label || ""}</span></div>`;
}

function lvaBuild(box, a) {
  const phase = lvaPhase(a), p = a.prefs, now = lvaNow();
  box.classList.toggle("ad-hot", phase === "soon");
  box.classList.toggle("ad-on", phase === "run");
  const needSign = /sign in to twitch again/i.test(a.error || "");
  let top = "", mid = "";
  if (needSign) {
    mid = `<p class="lv-muted">VaultHub needs a new Twitch permission for ads. Sign in to Twitch again (Set up &gt; Twitch) and the timer starts.</p>
      <button type="button" class="small-button lvi-ghost" data-ad="setup">Sign in again</button>`;
  } else if (phase === "run") {
    const r = a.running;
    top = `<div class="ad-big">${lvaRing(0, "run", "AD")}<div class="ad-when"><small>Ad break now</small><b id="lvaClock"></b><i>left of ${lvaLen(r.length)}</i></div></div>`;
    mid = `<div class="ad-live"><b>Your viewers are watching ads</b>${r.back ? `OBS switched to <strong>${lvEsc(r.brb || "BRB")}</strong> and goes back to <strong>${lvEsc(r.back)}</strong> when the ads end.` : "Chat can still talk to you while the ads play."}</div>
      ${r.back ? `<div class="ad-acts one"><button type="button" class="ad-snooze" data-ad="end">Back to ${lvEsc(r.back)} now</button></div>` : ""}`;
  } else if (phase === "off") {
    top = `<div class="ad-big">${lvaRing(0, "", "")}<div class="ad-when"><small>Next ad break</small><b class="dim">–</b><i>The timer starts when you go live on Twitch.</i></div></div>`;
  } else if (phase === "none") {
    top = `<div class="ad-big">${lvaRing(0, "", "")}<div class="ad-when"><small>Next ad break</small><b class="dim">None planned</b><i>Twitch plans breaks for Affiliates and Partners with ads on (Ads Manager).</i></div></div>`;
    mid = lvaActs(a);
  } else {
    const soon = phase === "soon";
    top = `<div class="ad-big">${lvaRing(0, soon ? "hot" : "", "")}<div class="ad-when"><small>Next ad break in</small><b id="lvaClock" class="${soon ? "hot" : ""}"></b><i>${a.length ? lvaLen(a.length) + " · " : ""}Twitch runs it by itself</i></div></div>`;
    const preLeft = a.prerollUntil ? a.prerollUntil - now : 0;
    mid = `${soon ? `<p class="ad-hint hot"><b>${p.tellChat ? "Chat was told." : "Get ready."}</b> ${p.tellChat ? `VaultHub wrote “${lvEsc(p.chatText)}” in chat.` : "The ads start in a minute."}</p>`
        : `<p class="ad-hint"><b>Good moment?</b> Run the ad yourself when you're in a menu or between rounds, so it doesn't hit in the middle of a fight.</p>`}
      <div class="ad-facts"><div class="ad-fact"><small>No pre-rolls for new viewers</small><b>${preLeft > 30 ? lvaMin(preLeft) + " more" : "Not now"}</b></div>
        <div class="ad-fact"><small>Snoozes left</small><b>${a.snoozes == null ? "–" : a.snoozes + " of 3"}</b></div></div>
      ${lvaActs(a)}`;
  }
  const scenes = LVA.scenes || [];
  const brbName = p.brbScene || "your BRB scene";
  box.innerHTML = `<h3>Ad timer<span class="sp"></span><span class="lv-pill ad-tw"><span class="lv-tiny tw">${LV_ICONS.tw}</span>Twitch</span></h3>
    ${a.error && !needSign ? `<p class="lvi-err">${lvEsc(a.error)}</p>` : ""}
    ${top}${mid}
    <div class="ad-opts">
      <div class="ad-opt"><span>Tell chat 1 minute before<small>${LVA.editing ? "" : `“${lvEsc(p.chatText)}” <button type="button" class="link" data-ad="edit">Change</button>`}</small></span>${lvmSwitch(p.tellChat, 'data-pref="tellChat"')}</div>
      ${LVA.editing ? `<div class="ad-edit"><label class="input"><input id="lvaText" maxlength="300" value="${lvEsc(p.chatText)}"></label><button type="button" class="small-button" data-ad="save">Save</button></div>` : ""}
      <div class="ad-opt"><span>Switch OBS to BRB during ads<small>${scenes.length ? `<select id="lvaScene"><option value="">A scene called BRB</option>${scenes.map((s) => `<option ${s === p.brbScene ? "selected" : ""}>${lvEsc(s)}</option>`).join("")}</select>` : `Uses ${lvEsc(brbName)}, back to your scene after. <button type="button" class="link" data-ad="scenes">Pick scene</button>`}</small></span>${lvmSwitch(p.brb, 'data-pref="brb"')}</div>
      <div class="ad-opt"><span>Beep for me 1 minute before<small>Only you hear it, not your stream</small></span>${lvmSwitch(p.beep, 'data-pref="beep"')}</div>
    </div>`;
  box.querySelectorAll("[data-pref]").forEach((b) => { b.onclick = () => lvaSet({ [b.dataset.pref]: !b.classList.contains("on") }); });
  box.querySelectorAll("[data-ad]").forEach((b) => { b.onclick = () => lvaDo(b.dataset.ad); });
  const sel = $("lvaScene");
  if (sel) sel.onchange = () => lvaSet({ brbScene: sel.value });
  const len = $("lvaLen");
  if (len) len.onclick = (e) => e.stopPropagation();
}

function lvaActs(a) {
  const len = a.prefs.length || 180;
  return `<div class="ad-acts"><div class="ad-run"><button type="button" data-ad="run">Run ad now</button><select id="lvaLen" title="How long">${[30, 60, 90, 120, 150, 180].map((s) => `<option value="${s}" ${s === len ? "selected" : ""}>${lvaLen(s)}</option>`).join("")}</select></div>
    ${a.next ? `<button type="button" class="ad-snooze" data-ad="snooze" ${a.snoozes === 0 ? "disabled title=\"No snoozes left right now\"" : "title=\"Push the ad break 5 minutes later\""}>Snooze</button>` : ""}</div>`;
}

function lvaTick() {
  const a = LV.state && LV.state.ads, el = $("lvaClock");
  if (!a || $("liveTab").hidden) return;
  if (LVA.lastPhase && LVA.lastPhase !== lvaPhase(a)) { $("lvAds").dataset.shape = ""; LVA.lastPhase = lvaPhase(a); return lvDrawAds(); }
  LVA.lastPhase = lvaPhase(a);
  if (!el) return;
  const now = lvaNow(), ring = $("lvaRing");
  if (a.running && now < a.running.until) {
    el.textContent = lvaClock(a.running.until - now);
    if (ring) ring.setAttribute("stroke-dasharray", `${((a.running.until - now) / a.running.length * 264).toFixed(0)} 264`);
  } else if (a.next) {
    const left = a.next - now;
    el.textContent = lvaClock(left);
    const span = a.last && a.next > a.last ? a.next - a.last : 3600;
    if (ring) ring.setAttribute("stroke-dasharray", `${(Math.max(0, Math.min(1, 1 - left / span)) * 264).toFixed(0)} 264`);
  }
}

async function lvaSet(change) {
  const res = await api("/api/live-ads-set", { prefs: change }).catch(() => null);
  if (!res || !res.ok) return lvToast({ emoji: "⚠️", title: "Couldn't save", text: (res && res.error) || "Try again." });
  if (LV.state && LV.state.ads) LV.state.ads.prefs = res.prefs;
  lvDrawAds();
}

async function lvaDo(what) {
  if (what === "setup") return lvOpenSetup();
  if (what === "edit") { LVA.editing = true; lvDrawAds(); const t = $("lvaText"); if (t) { t.focus(); t.select(); } return; }
  if (what === "save") { LVA.editing = false; return lvaSet({ chatText: $("lvaText").value.trim() || "Ad break in 1 minute!" }); }
  if (what === "scenes") {
    const res = await api("/api/live-ads-scenes", {}).catch(() => null);
    LVA.scenes = (res && res.scenes) || [];
    if (!LVA.scenes.length) lvToast({ emoji: "⚠️", title: "Couldn't see OBS's scenes", text: "Is OBS open with its WebSocket server on?" });
    return lvDrawAds();
  }
  const body = what === "run" ? { length: +$("lvaLen").value } : {};
  if (what === "run") lvaSet({ length: body.length });
  const res = await api("/api/live-ads-" + what, body).catch(() => null);
  if (!res || !res.ok) return lvToast({ emoji: "⚠️", title: what === "run" ? "Couldn't run the ad" : what === "snooze" ? "Couldn't snooze" : "Couldn't switch back", text: (res && res.error) || "Try again." });
  if (LV.state) LV.state.ads = res.ads;
  if (what === "snooze") lvToast({ emoji: "😴", title: "Snoozed 5 minutes", text: "Twitch moved your next ad break." });
  lvDrawAds();
}
