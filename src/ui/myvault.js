// (3.2.0) MyVault: your passwords, 2FA codes and notes, locked with a PIN, only on this PC (see myvault.py).
// The page never holds the list's passwords: it asks for one when you press show or copy.

const mvIc = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const MV_I = {
  lock: mvIc('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  plus: mvIc('<path d="M12 5v14M5 12h14"/>'),
  search: mvIc('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  eye: mvIc('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff: mvIc('<path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.4 6.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  copy: mvIc('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  check: mvIc('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  sliders: mvIc('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  user: mvIc('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  codes: mvIc('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 9.5h2M8 14.5h2M14 9.5h2M14 14.5h2"/>'),
  note: mvIc('<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.5h6M9 16h4"/>'),
  back: mvIc('<path d="M15 5l-7 7 7 7"/>'),
  dice: mvIc('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".8" fill="currentColor"/><circle cx="15" cy="15" r=".8" fill="currentColor"/><circle cx="15" cy="9" r=".8" fill="currentColor"/><circle cx="9" cy="15" r=".8" fill="currentColor"/>'),
  shield: mvIc('<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
  down: mvIc('<path d="m6 9 6 6 6-6"/>'),
  trash: mvIc('<path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7"/>'),
  clock: mvIc('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  qr: mvIc('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M20 14v6h-4M14 18v2"/>'),
  x: mvIc('<path d="M6 6l12 12M18 6 6 18"/>'),
  download: mvIc('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  phone: mvIc('<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>'),
};
const mvEsc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MV_COLORS = ["#e5484d", "#f76b15", "#e2a300", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#5d6370"];

const mv = {
  st: null, open: false, items: [], codes: {}, codesAt: 0, pin: "", pinStep: 0, firstPin: "", busy: false,
  shown: {}, // id -> {value, until}
  copied: {}, // id+field -> until
  timer: 0, tick: 0, lastTouch: 0, search: "",
};

async function mvPost(path, body) {
  try { return await api("/api/mv-" + path, body || {}); } catch { return { ok: false, error: "Couldn't reach VaultHub." }; }
}

// ---- the side bar button: at the very top, its own little group
function mvSideState() {
  const pill = $("mvSideState");
  if (!pill || !mv.st) return;
  const open = !!mv.st.open;
  pill.textContent = !mv.st.exists ? "New" : open ? "Open" : "Locked";
  pill.classList.toggle("open", open);
}

function myvaultTabChanged(tab) {
  const was = mv.open;
  mv.open = tab === "myvault";
  if (mv.open && !was) { mvLoad(true); }
  if (!mv.open) mvStopTick();
}

async function mvLoad(fresh) {
  const st = await mvPost("state");
  if (!st.ok) return;
  const changed = !mv.st || mv.st.open !== st.open || mv.st.exists !== st.exists;
  mv.st = st;
  mvSideState();
  if (!mv.open) return;
  if (st.open) {
    if (changed || fresh) await mvRefresh();
    else mvDraw();
  } else {
    if (changed || fresh) { mv.pin = ""; mv.items = []; mv.shown = {}; }
    mvDraw();
  }
}

async function mvRefresh() {
  const r = await mvPost("items");
  if (!r.ok) { if (/locked/i.test(r.error || "")) return mvLoad(true); return mvToast(r.error); }
  mv.items = r.items; mv.codes = r.codes || {}; mv.codesAt = Date.now();
  mvDraw();
}

// ---- drawing
function mvDraw() {
  const page = $("myvaultTab");
  if (!page || !mv.st) return;
  if (!mv.st.exists) return mvDrawLock(page, "setup");
  if (!mv.st.open) return mvDrawLock(page, "locked");
  mvDrawList(page);
  mvStartTick();
}

function mvDots(n, cls = "") {
  return `<div class="mv-dots ${cls}" id="mvDots">${Array.from({ length: 6 }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`;
}

function mvDrawLock(page, kind) {
  const setup = kind === "setup";
  const wait = mv.st.wait || 0;
  const head = setup
    ? (mv.pinStep === 0
      ? `<div class="mv-steps"><i class="on"></i><i></i></div><div class="mv-lock-ic">${MV_I.shield}</div><h2>Pick a PIN for MyVault</h2><p>6 numbers. You type it each time you open MyVault.</p>`
      : `<div class="mv-steps"><i class="on"></i><i class="on"></i></div><div class="mv-lock-ic">${MV_I.shield}</div><h2>Type it once more</h2><p>Just to be sure you got it right.</p>`)
    : `<div class="mv-lock-ic">${MV_I.lock}</div><h2>MyVault is locked</h2><p>Type your PIN to open it.</p>`;
  const hint = setup
    ? `<div class="mv-hint">Everything stays on this PC, locked with your PIN. Nothing is uploaded.<br><button type="button" class="link-button" id="mvRestore">Bring in a backup instead</button></div>`
    : `<div class="mv-hint ${mv.lockError ? "bad" : ""}" id="mvHint">${mvEsc(mv.lockError || (wait ? `Too many wrong tries. Wait ${wait} seconds.` : "You can also just type on your keyboard."))}</div>`;
  page.innerHTML = `<div class="mv-lock"><div class="mv-lock-box">${head}${mvDots(mv.pin.length, mv.lockError ? "bad" : "")}
    <div class="mv-pad" id="mvPad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join("")}
      <button type="button" class="ghost" data-act="${setup ? (mv.pinStep ? "back" : "") : "forgot"}">${setup ? (mv.pinStep ? "Back" : "") : "Forgot?"}</button>
      <button type="button" data-n="0">0</button><button type="button" class="ghost" data-act="del" title="Delete">${MV_I.back}</button></div>
    ${hint}</div></div>`;
  page.querySelectorAll("#mvPad button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.n != null) mvPinKey(b.dataset.n);
    else if (b.dataset.act === "del") mvPinKey("Backspace");
    else if (b.dataset.act === "back") { mv.pinStep = 0; mv.pin = ""; mv.firstPin = ""; mvDraw(); }
    else if (b.dataset.act === "forgot") mvForgot();
  }));
  const r = $("mvRestore");
  if (r) r.addEventListener("click", mvRestoreDialog);
}

function mvPinKey(k) {
  if (mv.busy || !mv.st || mv.st.open) return;
  if (k === "Backspace") mv.pin = mv.pin.slice(0, -1);
  else if (/^\d$/.test(k) && mv.pin.length < 6) mv.pin += k;
  else return;
  mv.lockError = "";
  const dots = $("mvDots");
  if (dots) {
    dots.classList.remove("bad");
    dots.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < mv.pin.length));
    const last = dots.querySelectorAll("i")[mv.pin.length - 1];
    if (last && k !== "Backspace") { last.classList.remove("pop"); void last.offsetWidth; last.classList.add("pop"); }
  }
  const pad = $("mvPad");
  if (pad && /^\d$/.test(k)) { const b = pad.querySelector(`[data-n="${k}"]`); if (b) { b.classList.add("press"); setTimeout(() => b.classList.remove("press"), 120); } }
  const hint = $("mvHint");
  if (hint) { hint.classList.remove("bad"); hint.textContent = "You can also just type on your keyboard."; }
  if (mv.pin.length === 6) setTimeout(mvPinDone, 120);
}

async function mvPinDone() {
  const pin = mv.pin;
  if (pin.length !== 6) return;
  if (!mv.st.exists) {
    if (mv.pinStep === 0) { mv.firstPin = pin; mv.pin = ""; mv.pinStep = 1; return mvDraw(); }
    if (pin !== mv.firstPin) { mv.pinStep = 0; mv.firstPin = ""; mv.pin = ""; mvDraw(); return mvShake("Those didn't match. Pick your PIN again."); }
    mv.busy = true;
    const r = await mvPost("setup", { pin });
    mv.busy = false; mv.pin = ""; mv.pinStep = 0; mv.firstPin = "";
    if (!r.ok) return mvToast(r.error);
    mv.st = r; mvSideState();
    mvToast("MyVault is ready. Press Add to save your first password.");
    return mvRefresh();
  }
  mv.busy = true;
  const r = await mvPost("unlock", { pin });
  mv.busy = false; mv.pin = "";
  if (!r.ok) {
    const st = await mvPost("state");
    if (st.ok) mv.st = st;
    mv.lockError = r.error;
    mvDrawLock($("myvaultTab"), "locked");
    return mvShake(r.error, true);
  }
  mv.lockError = ""; mv.st = r; mvSideState();
  await mvRefresh();
}

function mvShake(text, keepDots) {
  const dots = $("mvDots");
  if (dots) {
    if (keepDots) dots.querySelectorAll("i").forEach((d) => d.classList.add("on"));
    dots.classList.add("bad"); dots.classList.remove("shake"); void dots.offsetWidth; dots.classList.add("shake");
    setTimeout(() => { if (!mv.pin) dots.querySelectorAll("i").forEach((d) => d.classList.remove("on")); }, 650);
  }
  const hint = $("mvHint");
  if (hint) { hint.textContent = text; hint.classList.add("bad"); } else if (text) mvToast(text);
}

document.addEventListener("keydown", (e) => {
  if (!mv.open || !mv.st || mv.st.open || document.querySelector(".mv-modal")) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (/^\d$/.test(e.key) || e.key === "Backspace") { e.preventDefault(); mvPinKey(e.key); }
});

function mvIconHtml(i, cls = "") {
  if (i.icon) return `<div class="mv-ic img ${cls}"><img src="${mvEsc(i.icon)}" alt=""></div>`;
  if (i.kind === "codes") return `<div class="mv-ic ${cls}" style="background:#f76b15">${MV_I.codes}</div>`;
  if (i.kind === "note") return `<div class="mv-ic ${cls}" style="background:#0090ff">${MV_I.note}</div>`;
  const name = i.name || i.site || "?";
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<div class="mv-ic ${cls}" style="background:${MV_COLORS[h % MV_COLORS.length]}">${mvEsc(name.trim()[0] || "?").toUpperCase()}</div>`;
}

function mvRing(frac) {
  const c = 47.1;
  return `<svg class="mv-ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" class="bg"/><circle cx="10" cy="10" r="7.5" class="fg" stroke-dasharray="${(c * frac).toFixed(1)} ${c}" transform="rotate(-90 10 10)"/></svg>`;
}

function mvCode(id) {
  const c = mv.codes[id];
  if (!c) return null;
  const left = Math.max(0, c.left - (Date.now() - mv.codesAt) / 1000);
  return { code: c.code, left, period: c.period };
}

function mvFmtCode(code) { return code.length === 6 ? code.slice(0, 3) + " " + code.slice(3) : code; }

function mvRow(i) {
  const tags = (i.tags || []).map((t) => `<i class="mv-tag ${t === "weak" ? "red" : ""}">${t === "weak" ? "Weak" : "Used twice"}</i>`).join("");
  const sub = i.kind === "codes" ? `${i.count} code${i.count === 1 ? "" : "s"}` : i.kind === "note" ? "Note" : (i.user || i.site || "");
  const shown = mv.shown[i.id];
  const field = i.kind === "account" ? "password" : "text";
  const copiedPw = mv.copied[i.id + field] > Date.now();
  const copiedUser = mv.copied[i.id + "user"] > Date.now();
  const code = i.otp ? mvCode(i.id) : null;
  const left = shown ? Math.ceil((shown.until - Date.now()) / 1000) : 0;
  const canShow = i.kind !== "account" || i.hasPass;
  return `<div class="mv-row ${shown ? "hl" : ""}" data-id="${i.id}">
    ${mvIconHtml(i)}
    <div class="mv-txt"><b>${mvEsc(i.name)}${tags}</b><span>${mvEsc(sub)}</span>${shown ? `<span class="shown">${mvEsc(shown.value)}</span>` : ""}</div>
    ${shown ? `<span class="mv-timer">Hides in ${left}s</span>` : ""}
    ${code ? `<button type="button" class="mv-otp ${mv.copied[i.id + "otp"] > Date.now() ? "done" : ""}" data-act="otp" title="Copy 2FA code">${mvRing(code.left / code.period)}<b>${mvFmtCode(code.code)}</b></button>` : ""}
    <div class="mv-btns">
      ${i.kind === "account" && i.user ? `<button type="button" data-act="user" class="${copiedUser ? "done" : ""}" title="Copy username">${copiedUser ? MV_I.check : MV_I.user}</button>` : ""}
      ${canShow ? `<button type="button" data-act="show" title="${shown ? "Hide" : "Show"}">${shown ? MV_I.eyeoff : MV_I.eye}</button>
      <button type="button" data-act="copy" class="wide ${copiedPw ? "done" : ""}">${copiedPw ? MV_I.check + "Copied" : MV_I.copy + (i.kind === "account" ? "Password" : "Copy")}</button>` : `<button type="button" data-act="edit" class="wide add-pw">${MV_I.plus}Add password</button>`}
    </div></div>`;
}

function mvDrawList(page) {
  const q = mv.search.trim().toLowerCase();
  const list = q ? mv.items.filter((i) => [i.name, i.user, i.site].some((t) => (t || "").toLowerCase().includes(q))) : mv.items;
  const acc = list.filter((i) => i.kind === "account"), other = list.filter((i) => i.kind !== "account");
  const weak = mv.items.filter((i) => (i.tags || []).includes("weak")).length;
  const reused = mv.items.filter((i) => (i.tags || []).includes("reused")).length;
  const bad = mv.items.filter((i) => (i.tags || []).length).length;
  const p = mv.st.prefs || {};
  const keepSearch = document.activeElement && document.activeElement.id === "mvSearch";
  const health = bad ? `<div class="mv-health"><div class="mv-health-ic">${MV_I.shield}</div><div><b>${bad} password${bad === 1 ? " needs" : "s need"} a look</b><span>${[weak ? `${weak} weak` : "", reused ? `${reused} used on more than one site` : ""].filter(Boolean).join(" · ")}</span></div><button type="button" id="mvHealthBtn">Fix them</button></div>` : "";
  const empty = !mv.items.length;
  page.innerHTML = `<div class="mv-top"><h1 class="headline">MyVault.<em> Your passwords, locked.</em></h1>
      <div class="mv-actions"><button type="button" class="mv-icon-btn" id="mvSetBtn" title="MyVault settings">${MV_I.sliders}</button><button type="button" class="mv-icon-btn" id="mvLockBtn" title="Lock now">${MV_I.lock}</button><button type="button" class="convert" id="mvAddBtn">${MV_I.plus}Add</button></div></div>
    ${empty ? `<div class="mv-empty"><div class="mv-lock-ic">${MV_I.shield}</div><h2>Nothing saved yet</h2><p>Add your first account, or bring your 2FA codes over from Google Authenticator.</p>
      <div class="mv-empty-acts"><button type="button" class="convert" id="mvAddFirst">${MV_I.plus}Add an account</button><button type="button" class="ghost-button" id="mvImportFirst">${MV_I.phone}Import from Google Authenticator</button></div></div>` : `
    ${health}
    <label class="mv-search">${MV_I.search}<input id="mvSearch" placeholder="Search your accounts" value="${mvEsc(mv.search)}" autocomplete="off" spellcheck="false"></label>
    ${acc.length ? `<div class="mv-label">Accounts</div><div class="mv-group">${acc.map(mvRow).join("")}</div>` : ""}
    ${other.length ? `<div class="mv-label">Codes &amp; notes</div><div class="mv-group">${other.map(mvRow).join("")}</div>` : ""}
    ${!acc.length && !other.length ? `<p class="mv-none">Nothing matches "${mvEsc(mv.search)}".</p>` : ""}
    <div class="mv-foot">${MV_I.clock}${mv.items.length} saved, only on this PC · locks by itself after ${p.lockAfter || 5} minute${p.lockAfter === 1 ? "" : "s"} away<span style="flex:1"></span><button type="button" class="link-button" id="mvImportBtn">Import 2FA codes</button></div>`}`;
  const s = $("mvSearch");
  if (s) {
    s.addEventListener("input", () => { mv.search = s.value; mvDrawList(page); });
    if (keepSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  $("mvAddBtn").addEventListener("click", () => mvEdit(null));
  $("mvLockBtn").addEventListener("click", mvLockNow);
  $("mvSetBtn").addEventListener("click", mvSettings);
  if ($("mvHealthBtn")) $("mvHealthBtn").addEventListener("click", mvHealth);
  if ($("mvAddFirst")) $("mvAddFirst").addEventListener("click", () => mvEdit(null));
  if ($("mvImportFirst")) $("mvImportFirst").addEventListener("click", mvImport);
  if ($("mvImportBtn")) $("mvImportBtn").addEventListener("click", mvImport);
  page.querySelectorAll(".mv-row").forEach((row) => row.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    const id = row.dataset.id;
    if (!b) return mvEdit(id);
    const act = b.dataset.act;
    if (act === "show") mvShow(id);
    else if (act === "copy") mvCopy(id, mv.items.find((i) => i.id === id).kind === "account" ? "password" : "text");
    else if (act === "user") mvCopy(id, "user");
    else if (act === "otp") mvCopy(id, "otp");
    else if (act === "edit") mvEdit(id);
  }));
}

// ---- every second: codes count down, shown passwords hide again
function mvStartTick() {
  if (mv.tick) return;
  mv.tick = setInterval(mvTickNow, 1000);
}
function mvStopTick() { clearInterval(mv.tick); mv.tick = 0; }

async function mvTickNow() {
  if (!mv.open || !mv.st || !mv.st.open) return mvStopTick();
  const now = Date.now();
  let redraw = false;
  for (const [id, s] of Object.entries(mv.shown)) if (s.until <= now) { delete mv.shown[id]; redraw = true; }
  for (const [k, until] of Object.entries(mv.copied)) if (until <= now) { delete mv.copied[k]; redraw = true; }
  const expired = Object.keys(mv.codes).some((id) => { const c = mvCode(id); return c && c.left <= 0.2; });
  if (expired) {
    const r = await mvPost("codes");
    if (r.ok) { mv.codes = r.codes; mv.codesAt = Date.now(); }
    else if (/locked/i.test(r.error || "")) return mvLoad(true);
    redraw = true;
  }
  if (document.querySelector(".mv-modal")) return mvUpdateModalCode();
  if (redraw) return mvDrawList($("myvaultTab"));
  // just move the rings and timers
  document.querySelectorAll("#myvaultTab .mv-row").forEach((row) => {
    const c = mvCode(row.dataset.id);
    const ring = row.querySelector(".mv-ring .fg");
    if (c && ring) ring.setAttribute("stroke-dasharray", `${(47.1 * c.left / c.period).toFixed(1)} 47.1`);
    const s = mv.shown[row.dataset.id], t = row.querySelector(".mv-timer");
    if (s && t) t.textContent = `Hides in ${Math.ceil((s.until - now) / 1000)}s`;
  });
}

function mvLive() { const on = $("lvOnAir"); return !!(on && !on.hidden); }

async function mvShow(id) {
  if (mv.shown[id]) { delete mv.shown[id]; return mvDrawList($("myvaultTab")); }
  if (mvLive() && (mv.st.prefs || {}).hideLive) return mvToast("Hidden while you're live. You can still copy it.");
  const item = mv.items.find((i) => i.id === id);
  const r = await mvPost("reveal", { id, field: item && item.kind !== "account" ? "text" : "password" });
  if (!r.ok) return mvToast(r.error);
  mv.shown[id] = { value: r.value, until: Date.now() + 15000 };
  mvDrawList($("myvaultTab"));
}

async function mvCopy(id, field) {
  const r = await mvPost("copy", { id, field });
  if (!r.ok) return mvToast(r.error);
  mv.copied[id + field] = Date.now() + 2500;
  const what = field === "user" ? "Username" : field === "otp" ? "2FA code" : field === "password" ? "Password" : "Copied";
  const after = r.clearIn ? (field === "otp" ? `New code in ${Math.ceil((mvCode(id) || { left: 30 }).left)}s` : `Clipboard clears in ${r.clearIn}s`) : "";
  mvToast(what === "Copied" ? "Copied" : what + " copied", after);
  if (!document.querySelector(".mv-modal")) mvDrawList($("myvaultTab"));
}

async function mvLockNow() {
  await mvPost("lock");
  mv.shown = {}; mv.items = []; mv.codes = {};
  mvCloseModal();
  await mvLoad(true);
}

// ---- small things
function mvToast(text, small) {
  let t = $("mvToast");
  if (!t) { t = document.createElement("div"); t.id = "mvToast"; t.className = "mv-toast"; document.body.appendChild(t); }
  t.innerHTML = `${MV_I.check}<span>${mvEsc(text)}</span>${small ? `<small>${mvEsc(small)}</small>` : ""}`;
  t.classList.remove("on"); void t.offsetWidth; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600);
}

function mvModal(html, cls = "") {
  mvCloseModal(true);
  const m = document.createElement("div");
  m.className = "modal mv-modal";
  m.innerHTML = `<div class="dialog mv-dlg ${cls}" role="dialog">${html}</div>`;
  document.body.appendChild(m);
  m.addEventListener("mousedown", (e) => { if (e.target === m) mvCloseModal(); });
  return m;
}

function mvCloseModal(now) {
  const m = document.querySelector(".mv-modal");
  if (!m) return;
  if (m._close) m._close();
  if (now) return m.remove();
  m.classList.add("leaving");
  setTimeout(() => m.remove(), 220);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector(".mv-modal")) { e.stopPropagation(); mvCloseModal(); }
}, true);

function mvStrength(pw) {
  pw = pw || "";
  if (!pw) return 0;
  const common = ["123456", "password", "qwerty", "111111", "abc123", "password1", "12345678", "iloveyou", "passord", "minecraft", "fortnite"];
  if (common.includes(pw.toLowerCase()) || new Set(pw).size <= 2) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length;
  let pool = { 1: 26, 2: 52, 3: 62, 4: 94 }[kinds] || 10;
  if (/^\d+$/.test(pw)) pool = 10;
  let bits = pw.length * Math.log2(pool);
  if (/(.)\1\1/.test(pw) || /0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf/i.test(pw)) bits -= 10;
  return bits < 28 ? 0 : bits < 40 ? 1 : bits < 55 ? 2 : bits < 75 ? 3 : 4;
}

function mvMakePassword() {
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!#$%&*+-=?@"];
  const all = sets.join("");
  const pick = (s) => { const r = new Uint32Array(1); crypto.getRandomValues(r); return s[r[0] % s.length]; };
  for (;;) {
    const pw = Array.from({ length: 20 }, () => pick(all)).join("");
    if (sets.every((s) => [...pw].some((c) => s.includes(c)))) return pw;
  }
}

// ---- add / edit
async function mvEdit(id) {
  let item = { kind: "account", name: "", site: "", user: "", password: "", text: "", otp: null };
  if (id) {
    const r = await mvPost("get", { id });
    if (!r.ok) return mvToast(r.error);
    item = r.item;
  }
  const ed = { ...item, showPw: false };
  const m = mvModal("", "mv-edit");
  const draw = () => {
    const k = ed.kind;
    const st = mvStrength(ed.password);
    const otpBox = ed.otp
      ? `<div class="mv-in mv-otp-set"><span class="mv-otp-now" id="mvEdCode">${ed.otpCode ? mvFmtCode(ed.otpCode) : "2FA code saved"}</span><em class="ph">${mvEsc(ed.otp.issuer || "")}</em><button type="button" id="mvOtpRemove">${MV_I.trash}Remove</button></div>`
      : `<div class="mv-in"><input id="mvOtpIn" placeholder="Paste the setup key" autocomplete="off" spellcheck="false"><button type="button" id="mvOtpScan">${MV_I.qr}Scan QR on screen</button></div>`;
    m.querySelector(".mv-dlg").innerHTML = `
      <h2>${id ? "Edit" : "Add to MyVault"}</h2><p>Only you can see it, and only after your PIN.</p>
      ${id ? "" : `<div class="mv-types">${[["account", MV_I.user, "Account"], ["codes", MV_I.codes, "Codes"], ["note", MV_I.note, "Note"]].map(([v, ic, label]) => `<button type="button" class="${k === v ? "on" : ""}" data-kind="${v}">${ic}${label}</button>`).join("")}</div>`}
      ${k === "account" ? `
        <div class="mv-field"><label for="mvSite">Website or app</label><div class="mv-in">${ed.icon ? `<img class="mv-in-ic" src="${mvEsc(ed.icon)}" alt="">` : ""}<input id="mvSite" placeholder="twitch.tv" value="${mvEsc(ed.site || ed.name)}" autocomplete="off" spellcheck="false"></div></div>
        <div class="mv-field"><label for="mvUser">Username or email</label><div class="mv-in"><input id="mvUser" value="${mvEsc(ed.user)}" autocomplete="off" spellcheck="false"></div></div>
        <div class="mv-field"><label for="mvPw">Password</label><div class="mv-in"><input id="mvPw" class="mono" type="${ed.showPw ? "text" : "password"}" value="${mvEsc(ed.password)}" autocomplete="new-password" spellcheck="false"><button type="button" id="mvPwShow" title="${ed.showPw ? "Hide" : "Show"}">${ed.showPw ? MV_I.eyeoff : MV_I.eye}</button><button type="button" id="mvPwMake">${MV_I.dice}Make one</button></div>
          <div class="mv-strength s${st}" id="mvStrength">${[0, 1, 2, 3].map((n) => `<i class="${ed.password && n < Math.max(1, st) ? "on" : ""}"></i>`).join("")}<span>${ed.password ? ["Very weak", "Weak", "Okay", "Good", "Strong"][st] : ""}</span></div></div>
        <div class="mv-field"><label>2FA code (optional)</label>${otpBox}</div>`
      : `<div class="mv-field"><label for="mvName">Name</label><div class="mv-in"><input id="mvName" value="${mvEsc(ed.name)}" placeholder="${k === "codes" ? "Google backup codes" : "Wi-Fi at home"}" autocomplete="off"></div></div>
        <div class="mv-field"><label for="mvText">${k === "codes" ? "Codes, one on each line" : "Note"}</label><textarea id="mvText" class="mv-area ${k === "codes" ? "mono" : ""}" rows="${k === "codes" ? 8 : 6}" spellcheck="false">${mvEsc(ed.text)}</textarea></div>`}
      <div class="mv-err" id="mvErr"></div>
      <div class="mv-acts">${id ? `<button type="button" class="ghost-button mv-del" id="mvDel">${MV_I.trash}Delete</button><span style="flex:1"></span>` : ""}<button type="button" class="ghost-button" id="mvCancel">Cancel</button><button type="button" class="convert" id="mvSave">Save</button></div>`;
    const dlg = m.querySelector(".mv-dlg");
    dlg.querySelectorAll(".mv-types button").forEach((b) => b.addEventListener("click", () => { grab(); ed.kind = b.dataset.kind; draw(); }));
    const bind = (elId, key) => { const el = $(elId); if (el) el.addEventListener("input", () => { ed[key] = el.value; if (key === "password") strength(); }); };
    bind("mvSite", "site"); bind("mvUser", "user"); bind("mvPw", "password"); bind("mvName", "name"); bind("mvText", "text"); bind("mvOtpIn", "otpText");
    if ($("mvPwShow")) $("mvPwShow").addEventListener("click", () => { grab(); ed.showPw = !ed.showPw; draw(); });
    if ($("mvPwMake")) $("mvPwMake").addEventListener("click", () => { grab(); ed.password = mvMakePassword(); ed.showPw = true; draw(); });
    if ($("mvOtpRemove")) $("mvOtpRemove").addEventListener("click", () => { grab(); ed.otp = null; ed.otpText = ""; draw(); });
    if ($("mvOtpScan")) $("mvOtpScan").addEventListener("click", async () => {
      grab();
      const b = $("mvOtpScan"); b.disabled = true; b.innerHTML = `${MV_I.qr}Looking…`;
      const link = await mvScanScreen();
      if (!link) { b.disabled = false; b.innerHTML = `${MV_I.qr}Scan QR on screen`; return err("No QR code found. Show it on your screen, then try again."); }
      if (/^otpauth-migration:/i.test(link)) { mvCloseModal(true); return mvImport(link); }
      await useOtp(link);
    });
    $("mvCancel").addEventListener("click", () => mvCloseModal());
    $("mvSave").addEventListener("click", save);
    if ($("mvDel")) $("mvDel").addEventListener("click", del);
    dlg.querySelectorAll("input").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); }));
    const first = dlg.querySelector(k === "account" ? (id ? "#mvPw" : "#mvSite") : "#mvName");
    if (first) first.focus();
  };
  const grab = () => {
    for (const [elId, key] of [["mvSite", "site"], ["mvUser", "user"], ["mvPw", "password"], ["mvName", "name"], ["mvText", "text"], ["mvOtpIn", "otpText"]]) { const el = $(elId); if (el) ed[key] = el.value; }
  };
  const strength = () => {
    const box = $("mvStrength"); if (!box) return;
    const st = mvStrength(ed.password);
    box.className = `mv-strength s${st}`;
    box.querySelectorAll("i").forEach((d, n) => d.classList.toggle("on", !!ed.password && n < Math.max(1, st)));
    box.querySelector("span").textContent = ed.password ? ["Very weak", "Weak", "Okay", "Good", "Strong"][st] : "";
  };
  const err = (t) => { const e = $("mvErr"); if (e) e.textContent = t || ""; };
  const useOtp = async (text) => {
    const r = await mvPost("otp-parse", { text });
    if (!r.ok) { err(r.error); return false; }
    ed.otp = r.otp; ed.otpText = "";
    if (!ed.user && r.otp.account) ed.user = r.otp.account;
    if (!ed.site && r.otp.issuer) ed.site = r.otp.issuer;
    draw();
    return true;
  };
  const save = async () => {
    grab();
    if (ed.kind === "account" && ed.otpText && ed.otpText.trim() && !ed.otp) { if (!(await useOtp(ed.otpText))) return; }
    const input = (ed.site || "").trim();
    const looksSite = /\.[a-z]{2,}(\/|$)/i.test(input);
    const body = { id: id || undefined, kind: ed.kind, text: ed.text || "" };
    if (ed.kind === "account") {
      if (!input) return err("Type the website or app, like twitch.tv or Steam.");
      let name, site;
      if (looksSite) { site = input; name = id && input === item.site ? item.name : ""; }
      else { name = input; site = mvGuessSite(input) || (id && input === item.name ? item.site : ""); }
      Object.assign(body, { name, site, user: ed.user || "", password: ed.password || "", otp: ed.otp || null });
    } else body.name = ed.name || "";
    const r = await mvPost("save", { item: body });
    if (!r.ok) return err(r.error);
    mvCloseModal();
    mvToast(id ? "Saved" : "Added to MyVault");
    mvRefresh();
  };
  const del = async () => {
    const b = $("mvDel");
    if (!b.classList.contains("sure")) { b.classList.add("sure"); b.innerHTML = `${MV_I.trash}Delete for good?`; return; }
    const r = await mvPost("delete", { id });
    if (!r.ok) return err(r.error);
    mvCloseModal(); mvToast("Deleted"); mvRefresh();
  };
  ed.otpCode = id && mv.codes[id] ? mv.codes[id].code : "";
  draw();
}

function mvUpdateModalCode() {
  // (the edit window shows the saved 2FA code; nothing to move every second besides that)
}

const MV_SITES = {
  google: "google.com", gmail: "google.com", youtube: "youtube.com", twitch: "twitch.tv", discord: "discord.com", steam: "steampowered.com",
  epic: "epicgames.com", "epic games": "epicgames.com", instagram: "instagram.com", facebook: "facebook.com", x: "x.com", twitter: "x.com",
  tiktok: "tiktok.com", microsoft: "microsoft.com", outlook: "microsoft.com", github: "github.com", amazon: "amazon.com", apple: "apple.com",
  reddit: "reddit.com", kick: "kick.com", paypal: "paypal.com", spotify: "spotify.com", netflix: "netflix.com", "battle.net": "battle.net",
  blizzard: "battle.net", riot: "riotgames.com", "riot games": "riotgames.com", ea: "ea.com", "ea app": "ea.com", ubisoft: "ubisoft.com",
  snapchat: "snapchat.com", streamelements: "streamelements.com", streamlabs: "streamlabs.com", vipps: "vipps.no", nvidia: "nvidia.com",
  roblox: "roblox.com", minecraft: "minecraft.net", playstation: "playstation.com", xbox: "xbox.com", nintendo: "nintendo.com",
};
function mvGuessSite(name) { return MV_SITES[String(name || "").trim().toLowerCase()] || ""; }

// ---- QR codes: on the screen, from the webcam, or a photo (jsQR, loaded only when needed)
function mvQrLib() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "vendor/jsQR.js"; s.onload = () => ok(window.jsQR); s.onerror = fail;
    document.head.appendChild(s);
  });
}

function mvQrFrom(source, w, h, scale = 1) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const found = window.jsQR(img.data, c.width, c.height, { inversionAttempts: "attemptBoth" });
  return found ? found.data : "";
}

async function mvScanScreen() {
  try {
    await mvQrLib();
    const res = await fetch("/api/mv-screen");
    if (!res.ok) return "";
    const bmp = await createImageBitmap(await res.blob());
    return mvQrFrom(bmp, bmp.width, bmp.height) || (bmp.width > 2400 ? mvQrFrom(bmp, bmp.width, bmp.height, .5) : "");
  } catch { return ""; }
}

async function mvScanFile(file) {
  try {
    await mvQrLib();
    const bmp = await createImageBitmap(file);
    const big = Math.max(bmp.width, bmp.height);
    return mvQrFrom(bmp, bmp.width, bmp.height, big > 2000 ? 2000 / big : 1) || mvQrFrom(bmp, bmp.width, bmp.height, big > 1000 ? 1000 / big : 1);
  } catch { return ""; }
}

// ---- import from Google Authenticator
async function mvImport(firstLink) {
  const got = { codes: [], batches: new Set(), size: 1 };
  let stream = null, timer = 0, reading = false;
  const m = mvModal(`
    <h2>Import from Google Authenticator</h2><p>Move your 2FA codes over in about a minute.</p>
    <div class="mv-imp">
      <ol class="mv-ol"><li><span><b>Open Google Authenticator</b> on your phone</span></li><li><span>Tap <b>⋯</b> then <b>Transfer accounts</b> › <b>Export accounts</b></span></li><li><span>Pick your accounts, then hold the QR code up to your webcam</span></li></ol>
      <div class="mv-cam-col"><div class="mv-cam" id="mvCam"><video id="mvVideo" playsinline muted></video><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><span class="mv-cam-tag" id="mvCamTag"><i></i>Getting ready…</span></div>
      <label class="mv-cam-pick" id="mvCamWrap" hidden><span>Camera</span><select id="mvCamPick"></select></label></div>
    </div>
    <div class="mv-err" id="mvErr"></div>
    <div class="mv-acts"><label class="ghost-button mv-photo">Use a photo instead<input type="file" id="mvPhoto" accept="image/*" hidden></label><button type="button" class="ghost-button" id="mvRetry" hidden>Try again</button><span style="flex:1"></span><button type="button" class="ghost-button" id="mvCancel">Cancel</button></div>`, "mv-import");
  const tag = (t) => { const e = $("mvCamTag"); if (e) e.innerHTML = `<i></i>${mvEsc(t)}`; };
  const stop = () => { clearInterval(timer); timer = 0; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
  m._close = stop;
  $("mvCancel").addEventListener("click", () => mvCloseModal());
  const use = async (link) => {
    link = (link || "").trim();
    if (!link || reading) return;
    if (!/^otpauth-migration:/i.test(link)) {
      if (/^otpauth:/i.test(link)) return void ($("mvErr").textContent = "That's a single 2FA code. Add it with Add > 2FA code instead.");
      $("mvErr").className = "mv-err";
      return void ($("mvErr").textContent = `That QR code isn't from Google Authenticator's Export accounts (it starts with "${link.slice(0, 40)}"). In Authenticator, use Transfer accounts > Export accounts.`);
    }
    reading = true;
    const r = await mvPost("import-read", { link });
    reading = false;
    if (!r.ok) return void ($("mvErr").textContent = r.error);
    const [index, size] = r.batch || [0, 1];
    if (got.batches.has(index)) return;
    got.batches.add(index); got.size = size;
    for (const c of r.codes) got.codes.push({ ...c, on: true });
    if (got.batches.size < size) { tag(`Got ${got.batches.size} of ${size}. Show the next QR code.`); return; }
    stop();
    mvImportFound(got.codes);
  };
  $("mvPhoto").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const link = await mvScanFile(f);
    if (!link) return void ($("mvErr").textContent = "No QR code found in that picture. Try a sharper photo.");
    use(link);
  });
  if (firstLink) return use(firstLink);
  // (3.2.1) the webcam: never wait forever. Skip virtual cameras (OBS etc.) first, and let the user switch.
  const VIRTUAL = /obs|virtual|snap camera|xsplit|streamlabs|nvidia broadcast|ndi|mmhmm|manycam/i;
  const late = (p, ms, why) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(why)), ms))]);
  let cams = [], run = 0;
  const pick = $("mvCamPick");
  const fail = (why) => {
    stop();
    tag(why === "busy" ? "The webcam didn't start" : why === "blocked" ? "Webcam blocked" : "No webcam found");
    $("mvCam").classList.add("off");
    $("mvErr").className = "mv-tip";
    $("mvErr").textContent = why === "busy" ? "Windows didn't hand over the webcam. Close apps that might be using it (OBS, Discord, Teams) and press Try again. Or open the Windows Camera app, take a photo of the QR code there, and press Use a photo instead."
      : why === "blocked" ? "Windows is blocking the webcam. Open Settings > Privacy & security > Camera and turn on \"Let desktop apps access your camera\", then press Try again."
      : "Take a photo of the QR code with another phone, then press Use a photo instead.";
    $("mvRetry").hidden = false;
  };
  const listCams = async () => {  // (3.2.2) the user picks the camera; real ones first, virtual ones (OBS...) last
    try { cams = (await late(navigator.mediaDevices.enumerateDevices(), 4000, "list")).filter((d) => d.kind === "videoinput"); } catch { cams = []; }
    cams.sort((x, y) => VIRTUAL.test(x.label) - VIRTUAL.test(y.label));
    const was = pick.value || (loadPref("mvCamId") || "");
    pick.innerHTML = cams.map((c, n) => `<option value="${mvEsc(c.deviceId)}">${mvEsc(c.label || `Camera ${n + 1}`)}</option>`).join("");
    if (cams.some((c) => c.deviceId === was)) pick.value = was;
    $("mvCamWrap").hidden = cams.length < 2;
  };
  const start = async () => {
    const me = ++run;
    stop();
    $("mvCam").classList.remove("off"); $("mvRetry").hidden = true;
    $("mvErr").className = "mv-err"; $("mvErr").textContent = "";
    // A watchdog: whatever gets stuck, the box never just sits on "Starting".
    const dog = setTimeout(() => { if (me === run && !timer && document.body.contains(m)) { run++; fail("busy"); } }, 15000);
    try {
      tag("Starting the webcam…");
      const deviceId = pick.value;
      const video = deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
      const asking = navigator.mediaDevices.getUserMedia({ video, audio: false });
      let gaveUp = false;
      asking.then((got) => { if (gaveUp || me !== run) got.getTracks().forEach((t) => t.stop()); }, () => {});  // came too late: let go of it
      const got = await late(asking, 10000, "busy").catch((e) => { gaveUp = true; throw e; });
      if (me !== run || !document.body.contains(m)) return got.getTracks().forEach((t) => t.stop());
      stream = got;
      const now = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
      await listCams();  // names show up once the camera is allowed
      if (!deviceId && cams.length > 1 && VIRTUAL.test(cams.find((c) => c.deviceId === now)?.label || "") && !VIRTUAL.test(cams[0].label)) {
        pick.value = cams[0].deviceId; clearTimeout(dog); return start();  // it gave us OBS's camera: use the real one
      }
      if (now && cams.some((c) => c.deviceId === now)) pick.value = now;
      tag("Turning on the camera…");
      const v = $("mvVideo"); v.srcObject = stream;
      await late(v.play(), 6000, "busy");
      await late(new Promise((ok) => { if (v.videoWidth) ok(); else v.addEventListener("loadeddata", ok, { once: true }); }), 6000, "busy");
      tag("Getting the QR reader…");
      await late(mvQrLib(), 6000, "busy");
      if (me !== run) return;
      tag("Looking for a QR code…");
      timer = setInterval(() => {
        if (!v.videoWidth || reading || !window.jsQR) return;
        const link = mvQrFrom(v, v.videoWidth, v.videoHeight, Math.min(1, 960 / v.videoWidth));
        if (link) use(link);
      }, 250);
    } catch (e) {
      if (me !== run || !document.body.contains(m)) return;
      const n = (e && e.name) || "";
      fail(n === "NotAllowedError" || n === "SecurityError" ? "blocked" : n === "NotFoundError" || n === "OverconstrainedError" ? "none" : "busy");
    } finally { clearTimeout(dog); }
  };
  $("mvRetry").addEventListener("click", () => start());
  pick.addEventListener("change", () => { savePref("mvCamId", pick.value); start(); });
  listCams().then(start, start);
}

function mvImportFound(codes) {
  const m = mvModal("", "mv-import");
  const draw = () => {
    const on = codes.filter((c) => c.on);
    const matched = codes.filter((c) => c.match).length;
    m.querySelector(".mv-dlg").innerHTML = codes.length ? `
      <div class="mv-score"><div class="mv-health-ic ok">${MV_I.check}</div><div><h2>Found ${codes.length} code${codes.length === 1 ? "" : "s"}</h2><p>${matched ? `${matched} go${matched === 1 ? "es" : ""} with accounts you already saved.` : "They'll be added as new accounts."}</p></div></div>
      <div class="mv-group mv-found">${codes.map((c, n) => `<label class="mv-row" data-n="${n}">${mvIconHtml({ name: c.issuer || c.account, kind: "account" })}
        <div class="mv-txt"><b>${mvEsc(c.issuer || "2FA code")}</b><span>${mvEsc(c.account)}</span></div>
        <span class="mv-match ${c.match ? "" : "new"}">${c.match ? (c.hasCode ? `Replaces the code on ${mvEsc(c.matchName)}` : `Goes with ${mvEsc(c.matchName)}`) : "New account"}</span>
        <input type="checkbox" ${c.on ? "checked" : ""} hidden><i class="mv-cb ${c.on ? "on" : ""}">${MV_I.check}</i></label>`).join("")}</div>
      <div class="mv-note">${MV_I.shield}<span>Keep them in Google Authenticator too until you've checked they work here.</span></div>
      <div class="mv-err" id="mvErr"></div>
      <div class="mv-acts"><button type="button" class="ghost-button" id="mvCancel">Cancel</button><button type="button" class="convert" id="mvAddCodes" ${on.length ? "" : "disabled"}>Add ${on.length} code${on.length === 1 ? "" : "s"}</button></div>`
      : `<h2>No codes found</h2><p>That QR code had no time-based 2FA codes in it.</p><div class="mv-acts"><button type="button" class="convert" id="mvCancel">OK</button></div>`;
    m.querySelectorAll(".mv-found .mv-row").forEach((row) => row.addEventListener("click", (e) => { e.preventDefault(); const c = codes[+row.dataset.n]; c.on = !c.on; draw(); }));
    $("mvCancel").addEventListener("click", () => mvCloseModal());
    if ($("mvAddCodes")) $("mvAddCodes").addEventListener("click", async () => {
      const r = await mvPost("import-add", { codes: codes.filter((c) => c.on) });
      if (!r.ok) return void ($("mvErr").textContent = r.error);
      mvCloseModal(); mvToast(`Added ${r.added} code${r.added === 1 ? "" : "s"}`); mvRefresh();
    });
  };
  draw();
}

// ---- password health
async function mvHealth() {
  const r = await mvPost("health");
  if (!r.ok) return mvToast(r.error);
  const bad = new Set([...r.weak, ...r.reused].map((i) => i.id)).size;
  const frac = r.total ? r.good / r.total : 1;
  const row = (i) => `<div class="mv-row" data-id="${i.id}">${mvIconHtml(i)}<div class="mv-txt"><b>${mvEsc(i.name)}</b><span>${mvEsc(i.why)}</span></div><div class="mv-btns"><button type="button" class="wide" data-act="new">Make a new one</button></div></div>`;
  const m = mvModal(`
    <div class="mv-score"><div class="mv-score-ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" class="bg"/><circle cx="32" cy="32" r="27" class="fg" stroke-dasharray="${(169.6 * frac).toFixed(1)} 169.6" transform="rotate(-90 32 32)"/></svg><b>${r.good}/${r.total}</b></div>
      <div><h2>Password health</h2><p>${bad ? `Fix ${bad === 1 ? "this one" : `these ${bad}`} and you're all good.` : "All your passwords look good."}</p></div></div>
    ${r.weak.length ? `<div class="mv-label">Weak</div><div class="mv-group">${r.weak.map(row).join("")}</div>` : ""}
    ${r.reused.length ? `<div class="mv-label">Used on more than one site</div><div class="mv-group">${r.reused.map(row).join("")}</div>` : ""}
    ${bad ? `<div class="mv-note">${MV_I.check}<span>Make a new one makes a strong password for you. Change it on the site too, then press Save.</span></div>` : ""}
    <div class="mv-acts"><button type="button" class="convert" id="mvDone">Done</button></div>`, "mv-wide");
  $("mvDone").addEventListener("click", () => mvCloseModal());
  m.querySelectorAll("[data-act=new]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.closest(".mv-row").dataset.id;
    mvCloseModal(true);
    await mvEdit(id);
    const make = $("mvPwMake"); if (make) make.click();
  }));
}

// ---- settings
function mvSettings() {
  const p = { ...(mv.st.prefs || {}) };
  const sel = (key, opts) => `<span class="mv-sel"><select data-k="${key}">${opts.map(([v, t]) => `<option value="${v}" ${p[key] === v ? "selected" : ""}>${t}</option>`).join("")}</select>${MV_I.down}</span>`;
  const sw = (key) => `<button type="button" class="mv-sw ${p[key] ? "on" : ""}" data-k="${key}" role="switch" aria-checked="${!!p[key]}"></button>`;
  const m = mvModal(`
    <h2>MyVault settings</h2><p>How MyVault locks and opens.</p>
    <div class="mv-set">
      <div class="r"><div><b>Lock by itself</b><small>When you leave MyVault alone</small></div>${sel("lockAfter", [[1, "After 1 minute"], [5, "After 5 minutes"], [15, "After 15 minutes"], [30, "After 30 minutes"], [60, "After 1 hour"]])}</div>
      <div class="r"><div><b>Offer to fill in logins</b><small>A small pop-up when Steam, Epic or a login page opens</small></div>${sw("offerFill")}</div>
      <div class="r"><div><b>Lock when I minimize</b><small>Or when the PC goes to sleep</small></div>${sw("lockMinimize")}</div>
      <div class="r"><div><b>Hide passwords while I'm live</b><small>So nothing shows up on stream by accident</small></div>${sw("hideLive")}</div>
      <div class="r"><div><b>Clear copied passwords</b><small>Removes them from the clipboard</small></div>${sel("clearAfter", [[10, "After 10 seconds"], [30, "After 30 seconds"], [60, "After 1 minute"], [0, "Never"]])}</div>
      ${p.never && p.never.length ? `<div class="r"><div><b>Never offer for</b><small>${mvEsc(p.never.map((n) => n.replace(/\.exe$/, "")).join(", "))}</small></div><button type="button" class="btn" id="mvNeverClear">Offer again</button></div>` : ""}
      <div class="r"><div><b>Change PIN</b></div><button type="button" class="btn" id="mvPinBtn">Change</button></div>
      <div class="r"><div><b>Back up MyVault</b><small>A locked file you can move to a new PC</small></div><button type="button" class="btn" id="mvBackupBtn">Save file</button></div>
      <div class="r"><div><b>Forgot your PIN?</b><small>Wipes MyVault so you can start over</small></div><button type="button" class="btn red" id="mvResetBtn">Reset</button></div>
    </div>
    <div class="mv-acts"><button type="button" class="convert" id="mvDone">Done</button></div>`, "mv-wide");
  const put = async (changes) => {
    const r = await mvPost("prefs", { prefs: changes });
    if (r.ok) { mv.st.prefs = r.prefs; Object.assign(p, r.prefs); }
  };
  m.querySelectorAll("select[data-k]").forEach((s) => s.addEventListener("change", () => put({ [s.dataset.k]: +s.value })));
  m.querySelectorAll(".mv-sw").forEach((b) => b.addEventListener("click", () => {
    const on = !b.classList.contains("on"); b.classList.toggle("on", on); b.setAttribute("aria-checked", on); put({ [b.dataset.k]: on });
  }));
  if ($("mvNeverClear")) $("mvNeverClear").addEventListener("click", () => { put({ never: [] }); $("mvNeverClear").closest(".r").remove(); });
  $("mvPinBtn").addEventListener("click", mvChangePin);
  $("mvBackupBtn").addEventListener("click", mvBackup);
  $("mvResetBtn").addEventListener("click", () => mvForgot(true));
  $("mvDone").addEventListener("click", () => { mvCloseModal(); mvDrawList($("myvaultTab")); });
}

function mvAsk({ title, text, fields, button, danger, onSubmit }) {
  const m = mvModal(`<h2>${mvEsc(title)}</h2><p>${text}</p>
    ${fields.map((f) => `<div class="mv-field"><label for="${f.id}">${mvEsc(f.label)}</label><div class="mv-in"><input id="${f.id}" type="${f.type || "password"}" ${f.pin ? 'inputmode="numeric" maxlength="6" class="mono"' : ""} autocomplete="off" placeholder="${mvEsc(f.placeholder || "")}"></div></div>`).join("")}
    <div class="mv-err" id="mvErr"></div>
    <div class="mv-acts"><button type="button" class="ghost-button" id="mvCancel">Cancel</button><button type="button" class="convert ${danger ? "danger" : ""}" id="mvOk">${mvEsc(button)}</button></div>`);
  const go = async () => {
    const vals = Object.fromEntries(fields.map((f) => [f.id, $(f.id).value]));
    $("mvOk").disabled = true;
    const e = await onSubmit(vals);
    if ($("mvOk")) $("mvOk").disabled = false;
    if (e) $("mvErr").textContent = e;
  };
  $("mvCancel").addEventListener("click", () => mvCloseModal());
  $("mvOk").addEventListener("click", go);
  m.querySelectorAll("input").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }));
  const first = m.querySelector("input"); if (first) first.focus();
  return m;
}

function mvChangePin() {
  mvAsk({
    title: "Change PIN", text: "Type your PIN now, then the new one.", button: "Change PIN",
    fields: [{ id: "mvOld", label: "PIN now", pin: true }, { id: "mvNew", label: "New PIN (6 numbers)", pin: true }, { id: "mvNew2", label: "New PIN again", pin: true }],
    onSubmit: async (v) => {
      if (v.mvNew !== v.mvNew2) return "The new PINs don't match.";
      const r = await mvPost("change-pin", { old: v.mvOld, new: v.mvNew });
      if (!r.ok) return r.error;
      mvCloseModal(); mvToast("PIN changed");
    },
  });
}

function mvBackup() {
  mvAsk({
    title: "Back up MyVault", text: "The file is locked with a backup password. You need it to bring MyVault to another PC. Keep it somewhere safe.", button: "Save file",
    fields: [{ id: "mvBp", label: "Backup password (at least 8 characters)" }, { id: "mvBp2", label: "Backup password again" }],
    onSubmit: async (v) => {
      if (v.mvBp !== v.mvBp2) return "The passwords don't match.";
      if (v.mvBp.length < 8) return "Pick a backup password with at least 8 characters.";
      const r = await mvPost("backup", { password: v.mvBp });
      if (r.cancelled) return "";
      if (!r.ok) return r.error;
      mvCloseModal(); mvToast("Backup saved", r.path.split(/[\\/]/).pop());
    },
  });
}

function mvRestoreDialog() {
  mvAsk({
    title: "Bring in a backup", text: "Pick your MyVault backup file next. Then type its backup password and a new PIN for this PC.", button: "Pick the file",
    fields: [{ id: "mvBp", label: "Backup password" }, { id: "mvPinNew", label: "New PIN for this PC (6 numbers)", pin: true }],
    onSubmit: async (v) => {
      const r = await mvPost("restore", { password: v.mvBp, pin: v.mvPinNew });
      if (r.cancelled) return "";
      if (!r.ok) return r.error;
      mvCloseModal(); mv.st = r; mvSideState(); mvToast("MyVault is back"); mvRefresh();
    },
  });
}

function mvForgot(fromSettings) {
  mvAsk({
    title: "Reset MyVault?", text: "There's no way into MyVault without your PIN, not even for us. Resetting <b>deletes everything in it</b> so you can start over. Type <b>RESET</b> to be sure.",
    button: "Delete everything", danger: true, fields: [{ id: "mvSure", label: "Type RESET", type: "text" }],
    onSubmit: async (v) => {
      if (v.mvSure.trim().toUpperCase() !== "RESET") return "Type RESET to delete everything.";
      const r = await mvPost("reset");
      if (!r.ok) return r.error;
      mvCloseModal(); mv.st = r; mv.items = []; mv.pin = ""; mvSideState(); mvDraw();
      mvToast(fromSettings ? "MyVault was reset" : "MyVault was reset. Pick a new PIN.");
    },
  });
}

// ---- staying open only while you use it
["mousemove", "keydown", "mousedown", "wheel"].forEach((ev) => document.addEventListener(ev, () => {
  if (!mv.open || !mv.st || !mv.st.open) return;
  if (Date.now() - mv.lastTouch < 20000) return;
  mv.lastTouch = Date.now();
  mvPost("touch");
}, { passive: true }));

document.addEventListener("visibilitychange", () => {
  if (document.hidden && mv.st && mv.st.open && (mv.st.prefs || {}).lockMinimize) mvLockNow();
});

// Every few seconds: locked by itself (time ran out, or from the login pop-up)?
setInterval(() => { if (mv.open || (mv.st && mv.st.open)) mvLoad(); }, 5000);
mv.open = !!($("myvaultTab") && !$("myvaultTab").hidden); // (the app may have opened right on MyVault)
mvLoad(true);
