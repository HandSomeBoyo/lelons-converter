// (3.2.0) MyVault's login pop-up: "Log in to Steam?" with a Fill button (see myvault.py, watch_* and fill).
// It never gets a password: Fill asks VaultHub to type it into the login window.
const $ = (id) => document.getElementById(id);
const ic = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = { x: ic('<path d="M6 6l12 12M18 6 6 18"/>'), check: ic('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 2.2), lock: ic('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>') };
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const COLORS = ["#e5484d", "#f76b15", "#e2a300", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#5d6370"];
const b = { o: null, pin: "", err: "", busy: false, sent: 0, timer: 0, key: "" };

async function post(path, body) {
  try {
    const r = await fetch("/api/mv-" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch { return { ok: false, error: "Couldn't reach VaultHub." }; }
}

function icon(a) {
  if (a.icon) return `<div class="ic img"><img src="${esc(a.icon)}" alt=""></div>`;
  const n = a.name || "?"; let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<div class="ic" style="background:${COLORS[h % COLORS.length]}">${esc(n.trim()[0] || "?").toUpperCase()}</div>`;
}

function ring(frac) {
  return `<svg class="ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" class="bg"/><circle cx="10" cy="10" r="7.5" class="fg" stroke-dasharray="${(47.1 * frac).toFixed(1)} 47.1" transform="rotate(-90 10 10)"/></svg>`;
}

function draw() {
  const o = b.o;
  if (!o || !o.show) return;
  const head = `<div class="hd"><span class="v">V</span>VaultHub · MyVault<button class="x" id="x" title="Not now">${I.x}</button></div>`;
  let body = "";
  if (!o.open && o.mode === "bw" && !o.quick) {
    body = `<h4>Log in to ${esc(o.app)}?</h4><p class="none">MyVault is locked. Open it with your Bitwarden master password first.</p><button class="fill full ghost" id="openApp">Open MyVault</button>`;
  } else if (!o.open) {
    body = `<h4>Log in to ${esc(o.app)}?</h4><div class="pin"><p>Type your ${o.mode === "bw" ? "quick" : "MyVault"} PIN to fill it in.</p>
      <div class="dots ${b.err ? "bad" : ""}" id="dots">${Array.from({ length: 6 }, (_, i) => `<i class="${i < b.pin.length ? "on" : ""}"></i>`).join("")}</div>
      <div class="err">${esc(b.err || (o.wait ? `Wait ${o.wait} seconds.` : ""))}</div><input id="pinIn" inputmode="numeric" autocomplete="off"></div>`;
  } else if (o.done) {
    const c = o.code;
    body = `<div class="done"><span class="ok">${I.check}</span><div><b>Filled in for ${esc(o.app)}</b><small>${c ? "Asked for a 2FA code? It's right here." : "You can close this."}</small></div></div>
      ${c ? `<div class="acc" style="margin-top:10px">${ring(c.left / c.period)}<div><b class="otp">${esc(c.code)}</b><small>${esc(c.name)} · new code in ${Math.ceil(c.left)}s</small></div><button class="fill" id="code">Fill code</button></div>` : ""}`;
  } else if (!o.accounts.length) {
    body = `<h4>Log in to ${esc(o.app)}?</h4><p class="none">Nothing saved for ${esc(o.app)} in MyVault yet.</p><button class="fill full ghost" id="openApp">Open MyVault</button>`;
  } else {
    body = `<h4>Log in to ${esc(o.app)}?</h4>${o.browser ? `<div class="match">${I.check}${esc(o.site)} matches your saved site</div>` : ""}
      ${o.accounts.map((a, n) => `<div class="acc ${n ? "dim" : ""}">${icon(a)}<div><b>${esc(a.user || a.name)}</b><small>${a.hasPass ? "Saved in MyVault" : "No password saved"}</small></div><button class="fill ${n ? "ghost" : ""}" data-id="${esc(a.id)}" ${a.hasPass ? "" : "disabled"}>Fill</button></div>`).join("")}`;
  }
  const foot = o.done ? "" : `<div class="foot"><button id="later">Not now</button><button id="never">Never for ${esc(o.app)}</button></div>`;
  $("vb").innerHTML = head + body + foot;
  $("x").onclick = () => dismiss(false);
  if ($("later")) $("later").onclick = () => dismiss(false);
  if ($("never")) $("never").onclick = () => dismiss(true);
  if ($("openApp")) $("openApp").onclick = () => post("open-app");
  document.querySelectorAll(".fill[data-id]").forEach((el) => el.onclick = () => fill(el.dataset.id, "login", el));
  if ($("code")) $("code").onclick = () => fill(o.code.id, "code", $("code"));
  const pin = $("pinIn");
  if (pin) { pin.focus(); }
  size();
}

function size() {
  const h = Math.ceil($("vb").getBoundingClientRect().height);
  if (Math.abs(h - b.sent) > 2) { b.sent = h; post("bubble-size", { height: h }); }
}

async function fill(id, what, el) {
  if (b.busy) return;
  b.busy = true;
  if (el) { el.disabled = true; el.textContent = "Filling…"; }
  const r = await post("fill", { id, what });
  b.busy = false;
  if (!r.ok) { if (el) { el.disabled = false; el.textContent = "Fill"; } b.err = r.error; return refresh(); }
  refresh();
}

async function dismiss(never) { await post("dismiss", { never }); }

document.addEventListener("keydown", async (e) => {
  if (!b.o || !b.o.show || b.o.open || b.busy || (b.o.mode === "bw" && !b.o.quick)) return;
  if (/^\d$/.test(e.key) && b.pin.length < 6) b.pin += e.key;
  else if (e.key === "Backspace") b.pin = b.pin.slice(0, -1);
  else if (e.key === "Escape") return dismiss(false);
  else return;
  e.preventDefault();
  b.err = "";
  draw();
  if (b.pin.length === 6) {
    b.busy = true;
    const r = await post(b.o.mode === "bw" ? "bw-pin-unlock" : "unlock", { pin: b.pin });
    b.busy = false; b.pin = "";
    if (!r.ok) {
      b.err = r.error.replace(/ before it makes you wait\./, ".");
      draw();
      const d = $("dots"); if (d) { d.querySelectorAll("i").forEach((i) => i.classList.add("on")); d.classList.add("bad", "shake"); setTimeout(draw, 600); }
      return;
    }
    refresh();
  }
});

async function refresh() {
  clearTimeout(b.timer);
  const o = await post("offer");
  if (o.ok) {
    const key = o.show ? `${o.app}|${o.open}|${o.done}|${(o.accounts || []).map((a) => a.id).join()}|${o.code ? o.code.code : ""}|${o.wait}` : "";
    b.o = o;
    if (key !== b.key || (o.code && o.done)) { b.key = key; draw(); }
  }
  b.timer = setTimeout(refresh, document.hidden ? 3000 : 1000);
}

if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener("message", (e) => { if (e.data === "bubble:show") { b.err = ""; b.pin = ""; b.key = ""; refresh(); } });
refresh();
