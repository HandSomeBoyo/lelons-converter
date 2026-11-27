// (3.4.0) The Clips page (Recording > Clips): press your key, even in a game, and OBS's Replay Buffer saves
// the last moments as a clip. A little "Clipped!" pop-up says so (clip-popup.js). Every clip is a file on
// your PC, in your clips folder, and they all show here. See replays.py.
// Uses $, api(), clock(), setDrag(), callToast() from app.js/callplus.js, recSure() from games.js,
// lvVk(), lvKeyLabel(), lvSendHotkeys(), lvPads(), lvoKeyList() from the Live console.

const CL = { clips: [], prefs: { key: {} }, obs: null, sig: "", game: "", open: null, timer: 0, catching: false, loaded: false, setupOpen: false };
const CL_KEY_ID = 300; // (the window's hotkey id: 1-99 soundboard, 100 Twitch clip, 200+ OBS scenes)

const clIcon = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const CL_I = {
  clip: clIcon('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
  folder: clIcon('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  more: clIcon('<circle cx="5.5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18.5" cy="12" r="1" fill="currentColor"/>'),
  play: clIcon('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
  star: clIcon('<path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7z"/>'),
  x: clIcon('<path d="M6 6l12 12M18 6 6 18"/>'),
  left: clIcon('<path d="m14.5 6-6 6 6 6"/>'),
  right: clIcon('<path d="m9.5 6 6 6-6 6"/>'),
  check: clIcon('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 2.4),
};
const clEsc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clKeyLabel = (k) => (k && k.vk && typeof lvKeyLabel === "function" ? lvKeyLabel(k) : "");

function clWhen(at) {
  const d = new Date(at * 1000), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= day) return "Today " + time;
  if (d.getTime() >= day - 86400000) return "Yesterday " + time;
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }) + " " + time;
}
const clLength = (s) => (s ? (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `0:${String(Math.round(s)).padStart(2, "0")}`) : "");

// ---------------------------------------------------------------- loading

async function clLoad() {
  const res = await api("/api/clips-list", {}).catch(() => null);
  if (!res || !res.ok) return;
  const sig = JSON.stringify(res.clips.map((c) => [c.id, c.name, c.fav, c.size])) + JSON.stringify(res.prefs);
  const keyChanged = JSON.stringify(CL.prefs.key || {}) !== JSON.stringify(res.prefs.key || {});
  CL.clips = res.clips;
  CL.prefs = res.prefs;
  CL.loaded = true;
  if (keyChanged) lvSendHotkeys();
  if (sig !== CL.sig) { CL.sig = sig; clDraw(); }
}

async function clCheckObs() {
  CL.obs = await api("/api/clips-obs", {}).catch(() => null);
  clDrawTop();
}

function clipsTabChanged(tab) {
  clearInterval(CL.timer);
  if (tab !== "clips") return;
  clDraw();
  clLoad();
  clCheckObs();
  CL.timer = setInterval(() => { if (!$("clipsTab").hidden) { clLoad(); if (!clReady()) clCheckObs(); } }, 4000);
}

const clReady = () => !!(CL.obs && CL.obs.obs && CL.obs.replay && CL.prefs.key && CL.prefs.key.vk);

// ---------------------------------------------------------------- drawing

function clDraw() {
  const page = $("clipsTab");
  if (!page || page.hidden) return;
  if (!$("clMain")) {
    page.insertAdjacentHTML("beforeend", `
      <div class="cl-top"><h1 class="headline">Clips.<br><em>Press your key and the last moments are saved, even in a game.</em></h1></div>
      <div id="clBar"></div><div id="clSetup"></div><div id="clGames"></div><div class="cl-grid" id="clMain"></div>`);
  }
  clDrawTop();
  clDrawGrid();
}

// The bar at the top: your key, a Clip now button, the folder. Before it all works: three short steps.
function clDrawTop() {
  const bar = $("clBar"), setup = $("clSetup");
  if (!bar || CL.catching) return;
  const o = CL.obs, key = CL.prefs.key || {};
  const steps = [
    { done: !!(o && o.obs), title: "Open OBS", text: o && o.error && !o.obs ? o.error.replace("Live console's Set up", "Live > Console > Set up") : "VaultHub talks to OBS to save your clips.", btn: o && !o.obs ? ["clRetry", "Check again"] : null },
    { done: !!(o && o.replay), title: "Turn on the clip recorder", text: "OBS's Replay Buffer keeps the last moments ready to save.", btn: o && o.obs && !o.replay ? ["clTurnOn", "Turn it on"] : null },
    { done: !!key.vk, title: "Pick your clip key", text: key.vk ? `Your key is ${clKeyLabel(key)}.` : "Like F8 or Alt+C. It works in any game.", btn: key.vk ? null : ["clKey2", "Pick a key"] },
  ];
  const show = o && (!clReady() || CL.setupOpen);
  setup.innerHTML = show ? `
    <div class="cl-setup">
      <div class="cl-setup-head"><b>${clReady() ? "All set" : "Get clipping in three steps"}</b>${clReady() ? `<button type="button" class="link" id="clSetupClose">Done</button>` : ""}</div>
      <ol>${steps.map((s, i) => `
        <li class="${s.done ? "done" : ""}"><span class="cl-num">${s.done ? CL_I.check : i + 1}</span>
          <div><b>${s.title}</b><small id="clStep${i}">${clEsc(s.text)}</small></div>
          ${s.btn ? `<button type="button" class="small-button" id="${s.btn[0]}">${s.btn[1]}</button>` : ""}</li>`).join("")}</ol>
    </div>` : "";
  const len = o && o.seconds ? `${o.seconds} seconds` : "the last moments";
  bar.innerHTML = `
    <div class="cl-bar">
      <button type="button" class="cl-now" id="clNow" ${o && o.replay ? "" : "disabled"}>${CL_I.clip}<span>Clip now</span></button>
      <div class="cl-key"><span>${key.vk ? `Press <kbd>${clEsc(clKeyLabel(key))}</kbd> to save ${len}` : "No clip key yet"}</span>
        <button type="button" class="link" id="clKey">${key.vk ? "Change" : "Pick a key"}</button></div>
      <span class="sp"></span>
      <button type="button" class="cl-icon-btn" id="clFolder" title="Open your clips folder">${CL_I.folder}</button>
      <button type="button" class="cl-icon-btn" id="clMore" title="More">${CL_I.more}</button>
    </div>`;
  $("clNow").onclick = clNow;
  $("clKey").onclick = () => clPickKey($("clKey"));
  $("clFolder").onclick = () => api("/api/clips-open-folder", {});
  $("clMore").onclick = clMenu;
  if ($("clKey2")) $("clKey2").onclick = () => clPickKey($("clKey2"));
  if ($("clRetry")) $("clRetry").onclick = clCheckObs;
  if ($("clTurnOn")) $("clTurnOn").onclick = clTurnOn;
  if ($("clSetupClose")) $("clSetupClose").onclick = () => { CL.setupOpen = false; clDrawTop(); };
}

function clDrawGrid() {
  const grid = $("clMain"), chips = $("clGames");
  if (!grid) return;
  const games = [...new Set(CL.clips.map((c) => c.game).filter(Boolean))];
  if (CL.game && CL.game !== "★" && !games.includes(CL.game)) CL.game = "";
  const favs = CL.clips.some((c) => c.fav);
  chips.innerHTML = games.length > 1 || favs ? `<div class="cl-chips">${[["", "All"], ...(favs ? [["★", "Starred"]] : []), ...games.map((g) => [g, g])]
    .map(([v, t]) => `<button type="button" class="${CL.game === v ? "on" : ""}" data-g="${clEsc(v)}">${clEsc(t)}</button>`).join("")}</div>` : "";
  chips.querySelectorAll("[data-g]").forEach((b) => { b.onclick = () => { CL.game = b.dataset.g; clDrawGrid(); }; });
  const list = CL.clips.filter((c) => !CL.game || (CL.game === "★" ? c.fav : c.game === CL.game));
  if (!CL.loaded) { grid.innerHTML = ""; return; }
  if (!list.length) {
    const key = CL.prefs.key || {};
    grid.innerHTML = `<div class="cl-empty">${CL_I.clip}<b>No clips yet</b><small>${key.vk ? `Play something and press <kbd>${clEsc(clKeyLabel(key))}</kbd> when it gets good.` : "Pick a clip key above, then press it when something good happens."}</small></div>`;
    return;
  }
  grid.innerHTML = list.map((c) => `
    <div class="cl-card" data-id="${c.id}">
      <div class="cl-thumb"><img src="/clip-thumb/${c.id}?${c.size}" alt="" loading="lazy"><span class="cl-play">${CL_I.play}</span>
        ${c.seconds ? `<i class="cl-len">${clLength(c.seconds)}</i>` : ""}${c.fav ? `<i class="cl-fav">${CL_I.star}</i>` : ""}</div>
      <div class="cl-info"><div><b title="${clEsc(c.name)}">${clEsc(c.game || c.name)}</b><small>${clWhen(c.at)}</small></div>
        <button type="button" class="cl-icon-btn" data-more="${c.id}" title="More">${CL_I.more}</button></div>
    </div>`).join("");
  grid.querySelectorAll(".cl-card").forEach((card) => {
    const c = CL.clips.find((x) => x.id === card.dataset.id);
    const img = card.querySelector("img");
    if (img) img.onerror = () => img.remove();
    card.querySelector(".cl-thumb").onclick = () => clView(c.id);
    card.querySelector("[data-more]").onclick = (e) => { e.stopPropagation(); clClipMenu(c, e.currentTarget); };
    setDrag(card, { kind: "replay", id: c.id, name: c.name + "." + c.file.split(".").pop() });
  });
}

// ---------------------------------------------------------------- doing things

async function clNow() {
  const res = await api("/api/clips-now", {}).catch(() => null);
  if (!res || !res.ok) return callToast((res && res.error) || "Couldn't reach VaultHub.");
  if (!(window.chrome && window.chrome.webview)) clWatchLast(); // (no pop-up window of our own here)
  setTimeout(clLoad, 1500);
  setTimeout(clLoad, 4000);
}

// Without the app's own window there's no pop-up: say it on the page instead.
async function clWatchLast(tries = 0) {
  const res = await api("/api/clips-last", {}).catch(() => null);
  const l = res && res.last;
  if (!l || (l.ok === null && tries < 60)) return setTimeout(() => clWatchLast(tries + 1), 250);
  callToast(l.ok ? `Clipped! ${l.text}` : l.text || "No clip this time.");
  clLoad();
}

async function clTurnOn() {
  const btn = $("clTurnOn");
  if (btn) { btn.disabled = true; btn.textContent = "Turning on..."; }
  const res = await api("/api/clips-turn-on", {}).catch(() => null);
  if (!res || !res.ok) { callToast((res && res.error) || "Couldn't reach OBS."); return clCheckObs(); }
  CL.obs = res;
  clDrawTop();
  if (res.restart) {
    const t = $("clStep1");
    if (t) t.innerHTML = "Close OBS and open it again once, then it's on. (Or in OBS: <b>Settings &gt; Output &gt; Replay Buffer</b>, tick <b>Enable</b>.)";
  }
}

function clTaken(vk, mods) {
  const same = (k) => k && k.vk === vk && (k.mods || 0) === mods;
  if (same(loadPref("lvClipKey"))) return "the Twitch clip button";
  if (typeof lvPads === "function" && lvPads().some(same)) return "a soundboard sound";
  if (typeof lvoKeyList === "function" && lvoKeyList().some(([, k]) => same(k))) return "an OBS scene";
  return "";
}

function clPickKey(btn) {
  CL.catching = true;
  const was = btn.textContent;
  btn.textContent = "Press a key... (Esc to cancel)";
  const done = () => { CL.catching = false; document.removeEventListener("keydown", grab, true); clDrawTop(); clDrawGrid(); };
  const grab = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { btn.textContent = was; return done(); }
    if (e.key === "Backspace" || e.key === "Delete") return save({ vk: 0, mods: 0 });
    const vk = lvVk(e);
    if (!vk || ["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
    // (a plain letter would fire while you type in a game's chat: it needs Ctrl/Alt/Shift, unless it's an F-key or Numpad key)
    if (!mods && !(vk >= 0x70 && vk <= 0x7B) && !(vk >= 0x60 && vk <= 0x69)) { btn.textContent = "Hold Ctrl, Alt or Shift with it (or use an F-key)"; return; }
    const taken = clTaken(vk, mods);
    if (taken) { btn.textContent = `That key is already ${taken}. Try another.`; return; }
    save({ vk, mods });
  };
  const save = async (key) => {
    document.removeEventListener("keydown", grab, true);
    const res = await api("/api/clips-prefs", { key }).catch(() => null);
    if (res && res.ok) CL.prefs = res.prefs;
    lvSendHotkeys();
    done();
    setTimeout(() => { if (key.vk && LV.taken && LV.taken.has(CL_KEY_ID)) callToast(`Another program already uses ${clKeyLabel(key)}. Pick another key.`); }, 700);
  };
  document.addEventListener("keydown", grab, true);
}

// A small menu under a button: [[label, fn, danger?], ...]
function clPop(anchor, items) {
  document.querySelectorAll(".cl-pop").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "cl-pop";
  items.forEach(([label, fn, danger]) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
    if (danger) b.className = "danger";
    b.onclick = (e) => { e.stopPropagation(); if (danger) return recSure(b, "Sure? Click again", () => { menu.remove(); fn(); }); menu.remove(); fn(); };
    menu.append(b);
  });
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 6) + "px";
  menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + "px";
  requestAnimationFrame(() => menu.classList.add("on"));
  setTimeout(() => document.addEventListener("click", function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", off); } }), 0);
}

function clMenu() {
  const p = CL.prefs;
  clPop($("clMore"), [
    [p.keepOn ? "✓ Keep the clip recorder on" : "Keep the clip recorder on", () => clSetPrefs({ keepOn: !p.keepOn })],
    ["Change clips folder...", async () => { const res = await api("/api/clips-pick-folder", {}).catch(() => null); if (res && res.ok) { CL.prefs = res.prefs; CL.sig = ""; clLoad(); } }],
    ["Set up again", () => { CL.setupOpen = true; clCheckObs(); }],
  ]);
}

async function clSetPrefs(changes) {
  const res = await api("/api/clips-prefs", changes).catch(() => null);
  if (res && res.ok) CL.prefs = res.prefs;
}

function clClipMenu(c, anchor) {
  clPop(anchor, [
    [c.fav ? "Unstar" : "Star", () => clFav(c)],
    ["Rename", () => clRename(c)],
    ["Show in folder", () => api("/api/clips-show", { id: c.id })],
    ["Delete", () => clDelete(c), true],
  ]);
}

async function clFav(c) {
  await api("/api/clips-fav", { id: c.id, on: !c.fav }).catch(() => null);
  CL.sig = "";
  await clLoad();
  if (CL.open) clView(CL.open);
}

async function clDelete(c) {
  const res = await api("/api/clips-delete", { id: c.id }).catch(() => null);
  if (res && !res.ok) return callToast(res.error);
  if (CL.open === c.id) clCloseView();
  callToast("Moved to the Recycle Bin.");
  CL.sig = "";
  clLoad();
}

function clRename(c, where) {
  const card = where || document.querySelector(`.cl-card[data-id="${c.id}"] .cl-info b`);
  if (!card) return;
  const input = Object.assign(document.createElement("input"), { className: "cl-rename", value: c.name, maxLength: 60 });
  card.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() && input.value.trim() !== c.name) {
      const res = await api("/api/clips-rename", { id: c.id, name: input.value.trim() }).catch(() => null);
      if (res && !res.ok) callToast(res.error);
    }
    CL.sig = "";
    await clLoad();
    if (CL.open) { const now = CL.clips.find((x) => x.name === input.value.trim()) || CL.clips.find((x) => x.id === CL.open); if (now) clView(now.id); }
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); };
  input.onblur = () => finish(true);
}

// ---------------------------------------------------------------- watching a clip

function clView(id) {
  const list = CL.clips.filter((c) => !CL.game || (CL.game === "★" ? c.fav : c.game === CL.game));
  const i = list.findIndex((c) => c.id === id);
  const c = list[i];
  if (!c) return clCloseView();
  CL.open = id;
  let box = $("clView");
  const fresh = !box;
  if (fresh) {
    box = Object.assign(document.createElement("div"), { id: "clView", className: "cl-view" });
    document.body.append(box);
    box.addEventListener("click", (e) => { if (e.target === box) clCloseView(); });
  }
  box.innerHTML = `
    <div class="cl-view-card">
      <div class="cl-view-head"><div><b id="clViewName">${clEsc(c.name)}</b><small>${clEsc([c.game, clWhen(c.at), clLength(c.seconds)].filter(Boolean).join(" · "))}</small></div>
        <span class="sp"></span>
        <button type="button" class="cl-icon-btn ${c.fav ? "on" : ""}" id="clViewFav" title="${c.fav ? "Unstar" : "Star"}">${CL_I.star}</button>
        <button type="button" class="cl-icon-btn" id="clViewMore" title="More">${CL_I.more}</button>
        <button type="button" class="cl-icon-btn" id="clViewX" title="Close (Esc)">${CL_I.x}</button></div>
      <div class="cl-view-video">
        <video id="clVideo" src="/clip-video/${c.id}?${c.size}" controls autoplay></video>
        ${i > 0 ? `<button type="button" class="cl-nav prev" id="clPrev" title="Newer">${CL_I.left}</button>` : ""}
        ${i < list.length - 1 ? `<button type="button" class="cl-nav next" id="clNext" title="Older">${CL_I.right}</button>` : ""}
      </div>
      <div class="cl-view-foot"><span class="cl-drag can-drag" id="clViewDrag">${CL_I.clip}Drag me into Resolve, Discord or a folder</span></div>
    </div>`;
  if (fresh) requestAnimationFrame(() => box.classList.add("on"));
  $("clViewX").onclick = clCloseView;
  $("clViewFav").onclick = () => clFav(c);
  $("clViewMore").onclick = (e) => clPop(e.currentTarget, [["Rename", () => clRename(c, $("clViewName"))], ["Show in folder", () => api("/api/clips-show", { id: c.id })], ["Delete", () => clDelete(c), true]]);
  if ($("clPrev")) $("clPrev").onclick = () => clView(list[i - 1].id);
  if ($("clNext")) $("clNext").onclick = () => clView(list[i + 1].id);
  setDrag($("clViewDrag"), { kind: "replay", id: c.id, name: c.name + "." + c.file.split(".").pop() });
}

function clCloseView() {
  const box = $("clView");
  CL.open = null;
  if (!box) return;
  const v = $("clVideo");
  if (v) v.pause();
  box.classList.remove("on");
  setTimeout(() => box.remove(), 220);
}

document.addEventListener("keydown", (e) => {
  if (!CL.open || (e.target.closest && e.target.closest("input"))) return;
  if (e.key === "Escape") { e.preventDefault(); clCloseView(); }
  if (e.key === "ArrowLeft" && $("clPrev")) $("clPrev").click();
  if (e.key === "ArrowRight" && $("clNext")) $("clNext").click();
});

// ---------------------------------------------------------------- the key

// The key arrives from Windows through the app's window (it works even when a game is in front), see livecon.js.
function clHotkey() { clNow(); }

// Load your key once at the start, so it works from any page.
api("/api/clips-list", {}).then((res) => {
  if (!res || !res.ok) return;
  CL.prefs = res.prefs;
  if (CL.prefs.key && CL.prefs.key.vk) lvSendHotkeys();
}).catch(() => {});
if (!$("clipsTab").hidden) clipsTabChanged("clips");
