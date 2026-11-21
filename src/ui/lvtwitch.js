// (2.34.0) Twitch cards for the Live console: Clips (button + a hotkey that works in games),
// Chat modes (slow, followers-only, emote-only, subs-only, one-of-a-kind, Shield Mode) and New chatters.
// They need the Twitch sign-in (Set up). Uses $, api(), loadPref/savePref from app.js and LV, lvEsc,
// lvKeyLabel, lvVk, lvSendHotkeys, lvToast, lvTone, lvOpenSetup, lvTime from livecon.js / liveui.js.

const LVT = { modes: null, modesAt: 0, modesBusy: false, modesError: "", clipping: false, catching: false };

function lvtSignedIn() { const c = LV.cfg || {}; return !!(c.twitch && c.twitchSignedIn); }
function lvtNeedSignIn(box, title, what) {
  // (3.0) Forget what was drawn before, or the card kept saying "Sign in" after signing in again.
  box.dataset.shape = "";
  box.innerHTML = `<h3>${title}</h3><p class="lv-muted">Sign in to Twitch in Set up to ${what}.</p>
    <button type="button" class="small-button lvi-ghost lvt-sign">Sign in to Twitch</button>`;
  box.querySelector(".lvt-sign").onclick = () => lvOpenSetup();
}
function lvtAgo(at) {
  const s = Math.max(0, Date.now() / 1000 - at);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}

function lvDrawTwitchCards() {
  lvDrawClips();
  lvDrawModes();
  lvDrawNewbies();
}

// ---------------------------------------------------------------- Clips

function lvDrawClips() {
  const box = $("lvClips");
  if (!box || LVT.catching) return;
  const c = LV.cfg || {};
  box.hidden = !c.twitch;
  if (!c.twitch) return;
  if (!lvtSignedIn()) return lvtNeedSignIn(box, "Clips", "clip your stream from here");
  const key = loadPref("lvClipKey") || {};
  const taken = key.vk && LV.taken && LV.taken.has(100);
  const clips = ((LV.state && LV.state.session && LV.state.session.clips) || []).slice().reverse();
  const live = !!(LV.state && LV.state.twitch && LV.state.twitch.live);
  const shape = JSON.stringify([key, taken, clips.map((x) => x.id), live, LVT.clipping]);
  if (box.dataset.shape === shape) {
    box.querySelectorAll("[data-at]").forEach((el) => { el.textContent = lvtAgo(+el.dataset.at); });
    return;
  }
  box.dataset.shape = shape;
  box.innerHTML = `
    <h3>Clips<span class="sp"></span><span class="lv-muted lvt-count">${clips.length ? `${clips.length} this stream` : ""}</span></h3>
    <button type="button" class="lvt-clip" id="lvtClip" ${live && !LVT.clipping ? "" : "disabled"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>
      ${LVT.clipping ? "Clipping..." : live ? "Clip that!" : "Clip (when you're live)"}
    </button>
    <div class="lvt-key">Hotkey: <b>${lvEsc(lvKeyLabel(key))}</b>${taken ? ` <em>another program uses this key</em>` : ""}
      <span class="sp"></span><button type="button" class="link" id="lvtKey">${key.vk ? "Change" : "Pick a key"}</button></div>
    <div class="lvt-clips">${clips.slice(0, 6).map((x) => `
      <div class="lvt-cliprow"><span>Clip <small data-at="${x.at}">${lvtAgo(x.at)}</small></span><span class="sp"></span>
        <button type="button" class="link" data-copy="${lvEsc(x.url)}">Copy link</button>
        <button type="button" class="link" data-open="${lvEsc(x.edit || x.url)}">Edit on Twitch</button></div>`).join("")}</div>
    ${clips.length ? "" : `<p class="lv-muted lvt-hint">The clip is the last 30 seconds or so, the way Twitch makes them. It takes Twitch a few seconds to have it ready.</p>`}`;
  $("lvtClip").onclick = lvClipNow;
  $("lvtKey").onclick = lvtPickKey;
  box.querySelectorAll("[data-copy]").forEach((b) => { b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).catch(() => {}); b.textContent = "Copied"; }; });
  box.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => api("/api/live-open", { url: b.dataset.open }); });
}

async function lvClipNow() {
  if (LVT.clipping || !lvtSignedIn()) return;
  LVT.clipping = true;
  lvDrawClips();
  const res = await api("/api/live-tw-clip", {}).catch(() => null);
  LVT.clipping = false;
  if (res && res.ok) {
    lvTone("pop", 0.5);
    lvToast({ emoji: "🎬", title: "Clipped!", text: "It's in the Clips card in a few seconds." });
    const s = LV.state && LV.state.session;
    if (s) (s.clips = s.clips || []).push({ ...res.clip, at: Date.now() / 1000 });
  } else {
    lvToast({ emoji: "⚠️", title: "No clip this time", text: (res && res.error) || "Couldn't reach Twitch." });
  }
  lvDrawClips();
}

function lvtPickKey() {
  const btn = $("lvtKey");
  LVT.catching = true;
  btn.textContent = "Press a key... (Esc to cancel)";
  const done = () => { LVT.catching = false; document.removeEventListener("keydown", grab, true); $("lvClips").dataset.shape = ""; lvDrawClips(); };
  const grab = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return done();
    if (e.key === "Backspace" || e.key === "Delete") { savePref("lvClipKey", {}); lvSendHotkeys(); return done(); }
    const vk = lvVk(e);
    if (!vk || ["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
    // (a plain letter would fire while you type in a game's chat: it needs Ctrl/Alt/Shift, unless it's an F-key or Numpad key)
    if (!mods && !(vk >= 0x70 && vk <= 0x7B) && !(vk >= 0x60 && vk <= 0x69)) { btn.textContent = "Hold Ctrl, Alt or Shift with it (or use an F-key)"; return; }
    savePref("lvClipKey", { vk, mods });
    lvSendHotkeys();
    done();
  };
  document.addEventListener("keydown", grab, true);
}

// ---------------------------------------------------------------- Chat modes

const LVT_MODES = [
  ["slow", "Slow mode", "People wait between messages"],
  ["followers", "Followers-only", "Only followers can chat"],
  ["subs", "Subs-only", "Only subscribers can chat"],
  ["emotes", "Emote-only", "Only emotes, no words"],
  ["unique", "No repeats", "Blocks the same message twice in a row"],
  ["shield", "Shield Mode", "For hate raids: Twitch's strict settings at once"],
];

function lvDrawModes() {
  const box = $("lvModes");
  if (!box) return;
  const c = LV.cfg || {};
  box.hidden = !c.twitch;
  if (!c.twitch) return;
  if (!lvtSignedIn()) return lvtNeedSignIn(box, "Chat modes", "change chat modes from here");
  if (Date.now() - LVT.modesAt > 30000 && !LVT.modesBusy && !$("liveTab").hidden) lvtLoadModes();
  const m = LVT.modes;
  const shape = JSON.stringify([m, LVT.modesError, LVT.modesBusy && !m]);
  if (box.dataset.shape === shape) return;
  box.dataset.shape = shape;
  if (!m) {
    box.innerHTML = `<h3>Chat modes</h3><p class="lv-muted">${lvEsc(LVT.modesError || "Loading...")}</p>`;
    return;
  }
  const on = LVT_MODES.filter(([k]) => m[k]).length;
  box.innerHTML = `
    <h3>Chat modes<span class="sp"></span>${on ? `<span class="lvt-on">${on} on</span>` : `<span class="lv-muted lvt-count">Chat is open</span>`}</h3>
    <div class="lvt-modes">${LVT_MODES.filter(([k]) => k !== "shield" || m.shield !== null).map(([k, name, desc]) => `
      <div class="lvt-mode ${m[k] ? "on" : ""} ${k === "shield" ? "shield" : ""}">
        <span class="lvt-mode-text"><b>${name}</b><small>${desc}</small></span>
        ${k === "slow" ? `<select data-opt="slowWait" title="Seconds between messages">${[3, 5, 10, 20, 30, 60, 120].map((s) => `<option value="${s}" ${+m.slowWait === s ? "selected" : ""}>${s} s</option>`).join("")}</select>` : ""}
        ${k === "followers" ? `<select data-opt="followersFor" title="How long they must have followed">${[[0, "any time"], [10, "10 min"], [60, "1 hour"], [1440, "1 day"], [10080, "1 week"], [43200, "1 month"]].map(([v, t]) => `<option value="${v}" ${+m.followersFor === v ? "selected" : ""}>${t}</option>`).join("")}</select>` : ""}
        <label class="check"><input type="checkbox" data-mode="${k}" ${m[k] ? "checked" : ""}></label>
      </div>`).join("")}</div>
    ${LVT.modesError ? `<p class="lvi-err">${lvEsc(LVT.modesError)}</p>` : ""}`;
  box.querySelectorAll("[data-mode]").forEach((cb) => {
    cb.onchange = () => {
      const k = cb.dataset.mode, change = { [k]: cb.checked };
      if (k === "slow") change.slowWait = +box.querySelector('[data-opt="slowWait"]').value;
      if (k === "followers") change.followersFor = +box.querySelector('[data-opt="followersFor"]').value;
      lvtSetModes(change);
    };
  });
  box.querySelectorAll("[data-opt]").forEach((sel) => {
    sel.onchange = () => {
      const k = sel.dataset.opt === "slowWait" ? "slow" : "followers";
      if (m[k]) lvtSetModes({ [k]: true, [sel.dataset.opt]: +sel.value });
      else m[sel.dataset.opt] = +sel.value;
    };
  });
}

async function lvtLoadModes() {
  LVT.modesBusy = true;
  const res = await api("/api/live-tw-modes", {}).catch(() => null);
  LVT.modesBusy = false;
  LVT.modesAt = Date.now();
  if (res && res.ok) { LVT.modes = res.modes; LVT.modesError = ""; } else LVT.modesError = (res && res.error) || "Couldn't load the chat modes.";
  lvDrawModes();
}

async function lvtSetModes(change) {
  LVT.modesBusy = true;
  const res = await api("/api/live-tw-modes-set", { change }).catch(() => null);
  LVT.modesBusy = false;
  LVT.modesAt = Date.now();
  if (res && res.ok) { LVT.modes = res.modes; LVT.modesError = ""; } else LVT.modesError = (res && res.error) || "Twitch said no. Try again.";
  $("lvModes").dataset.shape = "";
  lvDrawModes();
}

// ---------------------------------------------------------------- New chatters

function lvtWelcomed() {
  const w = loadPref("lvWelcomed") || {};
  const sid = (LV.state && LV.state.session && LV.state.session.id) || "";
  return w.sid === sid && Array.isArray(w.names) ? w.names : [];
}
function lvtSetWelcomed(names) {
  savePref("lvWelcomed", { sid: (LV.state && LV.state.session && LV.state.session.id) || "", names: names.slice(-300) });
}

function lvDrawNewbies() {
  const box = $("lvNewbies");
  if (!box) return;
  const c = LV.cfg || {};
  box.hidden = !c.twitch;
  if (!c.twitch) return;
  const first = ((LV.state && LV.state.session && LV.state.session.first) || []).slice().reverse();
  const welcomed = lvtWelcomed();
  const waiting = first.filter((f) => !welcomed.includes(f.login || f.user));
  const shape = JSON.stringify([first.length, welcomed.length]);
  if (box.dataset.shape === shape) return;
  box.dataset.shape = shape;
  box.innerHTML = `
    <h3>New chatters<span class="sp"></span>${waiting.length ? `<span class="lvt-on">${waiting.length} to welcome</span>` : ""}</h3>
    ${first.length ? `<div class="lvt-new">${first.slice(0, 12).map((f) => {
      const who = f.login || f.user, done = welcomed.includes(who);
      return `<div class="lvt-newrow ${done ? "done" : ""}">
        <span class="lvt-newtext"><b>${lvEsc(f.user)}</b><small>${lvEsc(f.text || "")}</small></span>
        ${done ? `<span class="lvt-welcomed">Welcomed</span>` : `<button type="button" class="small-button lvt-hi" data-who="${lvEsc(who)}" data-name="${lvEsc(f.user)}">Say hi</button>
        <button type="button" class="lv-tool" data-done="${lvEsc(who)}" title="Mark as welcomed">✓</button>`}
      </div>`;
    }).join("")}</div>` : `<p class="lv-muted">Nobody new yet. When someone chats in your channel for the very first time, they show up here, so you can welcome them.</p>`}`;
  box.querySelectorAll("[data-who]").forEach((b) => {
    b.onclick = () => {
      const input = $("lvSendText");
      if (input) { input.value = `Welcome @${b.dataset.name}! `; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      if ($("lvSendTo") && LV.sendTo === "yt") { LV.sendTo = "tw"; $("lvSendTo").value = "tw"; }
      lvtSetWelcomed([...lvtWelcomed(), b.dataset.who]);
      lvDrawNewbies();
    };
  });
  box.querySelectorAll("[data-done]").forEach((b) => { b.onclick = () => { lvtSetWelcomed([...lvtWelcomed(), b.dataset.done]); lvDrawNewbies(); }; });
}
