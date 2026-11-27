// (3.4.0) The "Clipped!" pop-up: VaultHub shows this little window at the top of your screen when you press
// your clip key, even over a game. It slides in, says how it went and goes away by itself (see replays.py).
const $ = (id) => document.getElementById(id);
const ICON = {
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
};
let shown = "", hideTimer = 0, pollTimer = 0;

async function post(path) {
  try {
    const r = await fetch("/api/clips-" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return await r.json();
  } catch { return null; }
}

function draw(l) {
  const kind = l.ok === null ? "wait" : l.ok ? "ok" : "bad";
  const sig = kind + l.at;
  if (sig === shown) return kind;
  shown = sig;
  if (l.accent) document.documentElement.style.setProperty("--accent", l.accent);
  const box = $("cp");
  box.className = "cp " + kind;
  $("cpIcon").innerHTML = ICON[kind];
  $("cpTitle").textContent = kind === "wait" ? "Clipping..." : kind === "ok" ? "Clipped!" : "No clip this time";
  $("cpSub").textContent = l.text || "";
  requestAnimationFrame(() => box.classList.add("on"));
  return kind;
}

async function look() {
  clearTimeout(pollTimer);
  const res = await post("last");
  if (!res || !res.ok) return;
  const kind = draw(res.last);
  clearTimeout(hideTimer);
  if (kind === "wait") pollTimer = setTimeout(look, 200);
  else hideTimer = setTimeout(hide, kind === "ok" ? 2400 : 4200);
}

function hide() {
  const box = $("cp");
  box.classList.remove("on");
  box.classList.add("off");
  setTimeout(() => { shown = ""; post("popup-hide"); }, 220);
}

if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener("message", (e) => { if (e.data === "bubble:show") look(); });
}
look();
