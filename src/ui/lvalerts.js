// (3.0) The Alerts page: alerts that pop up ON your stream, like StreamElements. A picture (your GIF, or a big
// emoji), text like "frostbyte_ is now following!" and a sound. OBS shows them through a Browser Source
// (streamoverlay.py serves the page; "Add to OBS" puts it in every scene). Below: two small sounds just for
// you in VaultHub (a word in chat, a first-time chatter).
// Uses $, api(), LV, LV_ICONS, LV_TONES, lvEsc, lvAlerts/lvSaveAlerts, lvMyWords, lvSound, lvTone, lvToast, lvPads.

const LVA_ORDER = [["follow", "tw"], ["sub", "tw"], ["gift", "tw"], ["raid", "tw"], ["bits", "tw"], ["superchat", "yt"], ["member", "yt"]];
const LVA_SOUNDS = { fanfare: "Fanfare", levelup: "Level up", coins: "Coins", chime: "Chime", ding: "Soft ding", pop: "Pop", none: "No sound" };
const LVA_COLORS = ["#ffcf3f", "#b495ff", "#ff7ab8", "#5ee38f", "#5cc8ff", "#ffffff"];
const LVA_SAMPLE = {
  follow: { name: "frostbyte_" }, sub: { name: "pixelpete", months: 3, message: "Love the streams!" }, gift: { name: "grumpygoat", amount: 5 },
  raid: { name: "BigStreamer", amount: 48 }, bits: { name: "nightowl_k", amount: 500, message: "cheer500 great play" },
  superchat: { name: "Kari", money: "NOK 50", message: "Hi from Bergen!" }, member: { name: "Tor" },
};
const LVAS = { ov: null, open: "", busy: false, error: "", obsMsg: "", peek: false };

async function lvaLoad() {
  const res = await api("/api/live-ov", {}).catch(() => null);
  if (res && res.ok) LVAS.ov = res.ov;
  return LVAS.ov;
}
async function lvaSet(change) {
  const res = await api("/api/live-ov-set", change).catch(() => null);
  if (res && res.ok) LVAS.ov = res.ov;
  else lvToast({ emoji: "⚠️", title: "Couldn't save that", text: (res && res.error) || "" });
}

// The overlay on your stream: is an alert of this kind on? (lvAlertFor then stays quiet in VaultHub)
function lvaOnStream(kind) {
  const k = kind === "sticker" ? "superchat" : kind;
  return !!(LVAS.ov && LVAS.ov.prefs.kinds[k] && LVAS.ov.prefs.kinds[k].on);
}

// The preview card only shows once you press ▶ (and goes away with Hide)
function lvaPreview(kind, open) {
  if (!LVAS.peek) {
    if (!open) return;
    LVAS.peek = true;
    lvDrawAlerts();
    $("lvaFrame").addEventListener("load", () => setTimeout(() => lvaPreview(kind), 300), { once: true });
    return;
  }
  const f = $("lvaFrame"), ov = LVAS.ov;
  if (!f || !ov) return;
  const kinds = {};
  for (const [k, v] of Object.entries(ov.prefs.kinds)) kinds[k] = { ...v, emoji: ov.kinds[k].emoji };
  f.contentWindow.postMessage({ type: "vh-alert", kinds, style: { color: ov.prefs.color, seconds: ov.prefs.seconds, volume: ov.prefs.volume, tts: ov.prefs.tts },
    alert: { kind, amount: 0, months: 0, to: "", money: "", message: "", ...LVA_SAMPLE[kind] } }, "*");
}

function lvaFileName(name) {
  if (!name) return "";
  return name.replace(/^[a-z]+-(sound|picture)-\d+/, "Your file");
}

function lvDrawAlerts() {
  if (!LVAS.ov) {
    $("lvAlerts").innerHTML = `<p class="lv-muted">Loading...</p>`;
    lvaLoad().then(() => { if (LVAS.ov) lvDrawAlerts(); });
    return;
  }
  const ov = LVAS.ov, p = ov.prefs, a = lvAlerts();
  const base = ov.url ? ov.url.replace(/\/alerts$/, "") : "";
  const soundOptions = (cur) => Object.entries(LVA_SOUNDS).map(([k, n]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${n}</option>`).join("")
    + (/\./.test(cur) ? `<option value="${lvEsc(cur)}" selected>Your sound</option>` : "") + `<option value="__file">Use my own sound...</option>`;
  const row = ([k, plat]) => {
    const pk = p.kinds[k], info = ov.kinds[k], open = LVAS.open === k;
    return `<div class="lva-row ${pk.on ? "" : "off"} ${open ? "open" : ""}" data-k="${k}">
      <div class="lva-top">
        <span class="lva-pic">${pk.picture ? /\.(webm|mp4)$/i.test(pk.picture) ? `<video src="${lvEsc(base)}/alerts/media/${lvEsc(pk.picture)}" muted></video>` : `<img alt="" src="${lvEsc(base)}/alerts/media/${lvEsc(pk.picture)}">` : info.emoji}</span>
        <div class="words"><b>${lvEsc(info.name)} <span class="lv-tiny ${plat}">${LV_ICONS[plat]}</span></b><small>${lvEsc(pk.text)}</small></div>
        <span class="sp"></span>
        <button type="button" class="icon-button lva-try" title="Show it in the preview"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>
        <button type="button" class="link lva-edit">${open ? "Done" : "Edit"}</button>
        <label class="check"><input type="checkbox" class="lva-on" ${pk.on ? "checked" : ""}></label>
      </div>
      ${open ? `<div class="lva-edit-box">
        <label class="fx-field"><span>What it says <i>${k === "gift" ? "{name} {subs}" : k === "raid" || k === "bits" ? "{name} {amount}" : k === "superchat" ? "{name} {money}" : k === "sub" ? "{name} {months}" : "{name}"} fill in by themselves</i></span>
          <span class="input"><input class="lva-text" maxlength="120" value="${lvEsc(pk.text)}" spellcheck="false"></span></label>
        <div class="lva-two">
          <div class="fx-field"><span>Picture</span>
            <div class="lva-filerow"><span class="lva-file">${pk.picture ? "Your picture" : `Emoji ${info.emoji}`}</span>
              <button type="button" class="ghost-button lva-pick" data-what="picture">${pk.picture ? "Change" : "Use a GIF"}</button>
              ${pk.picture ? `<button type="button" class="link lva-unpic">Back to emoji</button>` : ""}</div></div>
          <div class="fx-field"><span>Sound</span>
            <div class="lva-filerow"><select class="lv-snd lva-snd">${soundOptions(pk.sound)}</select>
              <input type="range" class="volume-slider lva-vol" min="0" max="100" value="${pk.volume}" title="This alert's volume"></div></div>
        </div>
        <form class="lva-link"><span class="input"><input class="lva-link-in" placeholder="Or paste a link to a GIF or sound (Giphy, Tenor...)" spellcheck="false"></span>
          <button type="submit" class="ghost-button" ${LVAS.linking ? "disabled" : ""}>${LVAS.linking ? "Getting it..." : "Use it"}</button></form>
        <div class="lva-row-actions"><button type="button" class="link lva-reset">Use the standard text</button><span class="sp"></span>
          <button type="button" class="ghost-button lva-obs-test">Send a test to OBS</button></div>
      </div>` : ""}
    </div>`;
  };
  $("lvAlerts").innerHTML = `
    <div class="lv-grid">
      <div class="lv-col">
        <div class="lv-card">
          <h3>Alerts on your stream</h3>
          ${LVA_ORDER.map(row).join("")}
          <p class="lv-muted" style="margin-top:12px">Use your own GIFs and sounds (from StreamElements too, if you saved them), or VaultHub's. Press ▶ to see one in the preview.</p>
        </div>
        <div class="lv-card">
          <h3>Just for you<span class="sp"></span><span class="lv-muted" style="font-weight:500">plays in VaultHub, not on stream</span></h3>
          ${[["keyword", "🔔", "A word shows up in chat", "Your name always counts"], ["first", "👋", "Someone chats for the first time", "Twitch"]].map(([k, emo, name, sub]) => `
            <div class="lv-rule ${a[k].on ? "" : "off"}" data-k="${k}">
              <span class="ico">${emo}</span><div class="words"><b>${name}</b><small>${sub}</small></div><span class="sp"></span>
              <select class="lv-snd" title="Sound">${Object.entries(LV_TONES).map(([t, n]) => `<option value="${t}" ${a[k].sound === t ? "selected" : ""}>${n}</option>`).join("")}</select>
              <label class="check"><input type="checkbox" ${a[k].on ? "checked" : ""}></label>
            </div>
            ${k === "keyword" ? `<div class="lv-kw" id="lvWords">${a.words.map((w, i) => `<span class="lv-chip">${lvEsc(w)}<button type="button" data-i="${i}" title="Remove">×</button></span>`).join("")}<form id="lvWordForm"><input id="lvWordIn" placeholder="+ Add a word" maxlength="40"></form></div>` : ""}`).join("")}
        </div>
      </div>
      <div class="lv-col">
        ${LVAS.peek ? `<div class="lv-card">
          <h3>Preview<span class="sp"></span><span class="lv-muted" style="font-weight:500">only you see this</span><button type="button" class="link" id="lvaHide" style="margin-left:12px">Hide</button></h3>
          <div class="lva-stage"><iframe id="lvaFrame" title="Alert preview" allow="autoplay" src="${lvEsc(ov.url)}?preview=1"></iframe></div>
        </div>` : ""}
        <div class="lv-card">
          <h3>In OBS<span class="sp"></span>${ov.watching ? `<span class="lva-ok">Showing</span>` : ""}</h3>
          ${ov.watching || LVAS.added ? `<p class="lv-muted">${ov.watching ? "OBS shows your alerts in every scene." : "Added to OBS."} Move or resize the <b>VaultHub alerts</b> source in OBS if you like.</p>`
            : `<p class="lv-muted">One click puts the alerts in all your OBS scenes. OBS needs to be open.</p>
              <button type="button" class="small-button" id="lvaAdd" ${LVAS.busy ? "disabled" : ""}>${LVAS.busy ? "Adding..." : "Add to OBS"}</button>`}
          ${LVAS.obsMsg ? `<p class="lva-msg">${lvEsc(LVAS.obsMsg)}</p>` : ""}
          <details class="lv-more-box"><summary>Add it yourself instead</summary>
            <ol class="lv-steps"><li>In OBS, press <b>+</b> under Sources and pick <b>Browser</b>.</li>
              <li>Paste this as the URL, with width <b>1920</b> and height <b>1080</b>:</li></ol>
            <div class="lv-row"><label class="input" style="flex:1"><input readonly value="${lvEsc(ov.url)}" id="lvaUrl"></label><button type="button" class="ghost-button" id="lvaCopy">Copy</button></div>
            <ol class="lv-steps" start="3"><li>Tick <b>Control audio via OBS</b>, so the sounds reach your stream.</li></ol>
          </details>
        </div>
        <div class="lv-card">
          <h3>Look</h3>
          <div class="lva-set"><span>Name color</span><span class="sp"></span><span class="lva-colors">${LVA_COLORS.map((c) => `<button type="button" class="${p.color.toLowerCase() === c ? "on" : ""}" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join("")}</span></div>
          <div class="lva-set"><span>On screen for</span><span class="sp"></span><input type="range" class="volume-slider" id="lvaSecs" min="3" max="15" value="${p.seconds}"><b id="lvaSecsN">${p.seconds} s</b></div>
          <div class="lva-set"><span>Volume</span><span class="sp"></span><input type="range" class="volume-slider" id="lvaVol" min="0" max="100" value="${p.volume}"><b id="lvaVolN">${p.volume}%</b></div>
          <div class="lva-set"><span class="words"><b>Read messages out loud</b><small>Messages with subs, bits and Super Chats</small></span><span class="sp"></span>
            <label class="check"><input type="checkbox" id="lvaTts" ${p.tts ? "checked" : ""}></label></div>
        </div>
      </div>
    </div>
    <input type="file" id="lvaFile" hidden>`;
  lvaWire();
  // The preview is the real 1920 x 1080 page, made small
  const stage = document.querySelector(".lva-stage");
  if (!stage) return;
  const fit = () => { if ($("lvaFrame")) $("lvaFrame").style.transform = `scale(${stage.clientWidth / 1920})`; };
  fit();
  if (LVAS.fitter) LVAS.fitter.disconnect();
  LVAS.fitter = new ResizeObserver(fit);
  LVAS.fitter.observe(stage);
}

function lvaWire() {
  const box = $("lvAlerts");
  box.querySelectorAll(".lva-row").forEach((r) => {
    const k = r.dataset.k;
    r.querySelector(".lva-on").onchange = async (e) => { r.classList.toggle("off", !e.target.checked); await lvaSet({ kinds: { [k]: { on: e.target.checked } } }); };
    r.querySelector(".lva-try").onclick = () => lvaPreview(k, true);
    r.querySelector(".lva-edit").onclick = () => { LVAS.open = LVAS.open === k ? "" : k; lvDrawAlerts(); };
    const text = r.querySelector(".lva-text");
    if (!text) return;
    text.onchange = async () => { await lvaSet({ kinds: { [k]: { text: text.value } } }); lvDrawAlerts(); lvaPreview(k); };
    r.querySelector(".lva-reset").onclick = async () => { await lvaSet({ kinds: { [k]: { text: "" } } }); lvDrawAlerts(); lvaPreview(k); };
    r.querySelector(".lva-snd").onchange = async (e) => {
      if (e.target.value === "__file") return lvaPick(k, "sound");
      await lvaSet({ kinds: { [k]: { sound: e.target.value } } });
      lvaPreview(k);
    };
    r.querySelector(".lva-vol").onchange = async (e) => { await lvaSet({ kinds: { [k]: { volume: +e.target.value } } }); lvaPreview(k); };
    r.querySelector(".lva-pick").onclick = () => lvaPick(k, "picture");
    r.querySelector(".lva-link").onsubmit = async (e) => {
      e.preventDefault();
      const url = r.querySelector(".lva-link-in").value.trim();
      if (!url || LVAS.linking) return;
      LVAS.linking = true; lvDrawAlerts();
      const res = await api("/api/live-ov-link", { kind: k, what: "auto", url }).catch(() => null);
      LVAS.linking = false;
      if (!res || !res.ok) lvToast({ emoji: "⚠️", title: "Couldn't use that link", text: (res && res.error) || "" });
      await lvaLoad();
      lvDrawAlerts();
      if (res && res.ok) lvaPreview(k);
    };
    r.querySelector(".lva-unpic")?.addEventListener("click", async () => { await lvaSet({ kinds: { [k]: { picture: "" } } }); lvDrawAlerts(); lvaPreview(k); });
    r.querySelector(".lva-obs-test").onclick = async (e) => {
      const res = await api("/api/live-ov-test", { kind: k }).catch(() => null);
      e.target.textContent = res && res.ok ? (LVAS.ov.watching ? "Sent! Look in OBS" : "Sent (OBS isn't showing alerts yet)") : "Couldn't send it";
    };
  });
  // Just for you
  box.querySelectorAll(".lv-rule").forEach((row) => {
    const k = row.dataset.k;
    row.querySelector("input[type=checkbox]").onchange = (e) => { const x = lvAlerts(); x[k].on = e.target.checked; lvSaveAlerts(x); row.classList.toggle("off", !e.target.checked); };
    row.querySelector("select").onchange = (e) => { const x = lvAlerts(); x[k].sound = e.target.value; lvSaveAlerts(x); lvSound(e.target.value, x.volume); };
  });
  $("lvWords").onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const x = lvAlerts();
    x.words.splice(+b.dataset.i, 1);
    lvSaveAlerts(x);
    lvDrawAlerts();
  };
  $("lvWordForm").onsubmit = (e) => {
    e.preventDefault();
    const w = $("lvWordIn").value.trim();
    if (!w) return;
    const x = lvAlerts();
    if (!x.words.includes(w) && x.words.length < 30) x.words.push(w);
    lvSaveAlerts(x);
    lvDrawAlerts();
    $("lvWordIn").focus();
  };
  // OBS
  $("lvaAdd")?.addEventListener("click", async () => {
    LVAS.busy = true; LVAS.obsMsg = ""; lvDrawAlerts();
    const res = await api("/api/live-ov-obs", {}).catch(() => null);
    LVAS.busy = false;
    LVAS.added = !!(res && res.ok);
    LVAS.obsMsg = res && res.ok ? `Done! The alerts are in ${res.obs.scenes === 1 ? "your scene" : `all ${res.obs.scenes} scenes`}. To see one in OBS, press Edit on an alert, then Send a test to OBS.` : (res && res.error) || "Couldn't reach OBS.";
    await lvaLoad();
    lvDrawAlerts();
    setTimeout(async () => { await lvaLoad(); if (!$("lvalertsTab").hidden && !LVAS.open) lvDrawAlerts(); }, 4000);
  });
  $("lvaHide")?.addEventListener("click", () => { LVAS.peek = false; lvDrawAlerts(); });
  $("lvaTts").onchange = async (e) => { await lvaSet({ tts: e.target.checked }); if (e.target.checked) lvaPreview("sub"); };
  $("lvaCopy").onclick = () => { navigator.clipboard.writeText($("lvaUrl").value).catch(() => {}); $("lvaCopy").textContent = "Copied"; };
  // Look
  box.querySelectorAll(".lva-colors button").forEach((b) => { b.onclick = async () => { await lvaSet({ color: b.dataset.c }); lvDrawAlerts(); lvaPreview(LVAS.open || "follow"); }; });
  $("lvaSecs").oninput = (e) => { $("lvaSecsN").textContent = e.target.value + " s"; };
  $("lvaSecs").onchange = async (e) => { await lvaSet({ seconds: +e.target.value }); lvaPreview(LVAS.open || "follow"); };
  $("lvaVol").oninput = (e) => { $("lvaVolN").textContent = e.target.value + "%"; };
  $("lvaVol").onchange = async (e) => { await lvaSet({ volume: +e.target.value }); lvaPreview(LVAS.open || "follow"); };
}

function lvaPick(kind, what) {
  const input = $("lvaFile");
  input.accept = what === "sound" ? ".mp3,.wav,.ogg,.m4a,audio/*" : ".gif,.png,.jpg,.jpeg,.webp,.webm,.mp4";
  input.value = "";
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return lvDrawAlerts();
    const res = await fetch("/api/live-ov-file", { method: "POST", body: f,
      headers: { "X-File-Name": encodeURIComponent(f.name), "X-Alert-Kind": kind, "X-Alert-What": what } }).then((r) => r.json()).catch(() => null);
    if (!res || !res.ok) lvToast({ emoji: "⚠️", title: "Couldn't use that file", text: (res && res.error) || "" });
    await lvaLoad();
    lvDrawAlerts();
    lvaPreview(kind);
  };
  input.oncancel = () => lvDrawAlerts();
  input.click();
}

// Keep "Showing in OBS" fresh while the page is open
setInterval(async () => {
  if (!$("lvalertsTab") || $("lvalertsTab").hidden || !LVAS.ov || LVAS.open || LVAS.busy) return;
  const was = LVAS.ov.watching;
  await lvaLoad();
  if (LVAS.ov && LVAS.ov.watching !== was && !$("lvalertsTab").hidden && !document.activeElement?.closest?.("#lvAlerts")) lvDrawAlerts();
}, 5000);
lvaLoad();
