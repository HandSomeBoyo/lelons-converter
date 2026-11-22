// (3.1) The pre-stream check: one button on the Live page that looks at everything before you go live
// (OBS, the scene, your mic, your Twitch title and game, alerts, your internet) and says how to fix
// what's wrong, with a fix button when VaultHub can do it for you. The checks are in precheck.py.
// Uses $, api() from app.js, LV, lvEsc, lvOpenSetup, lvToast from livecon.js, LVI, lviOpen from lvinfo.js.

const PRE = { run: 0, rows: {}, listen: null, busy: false };
const PRE_ORDER = [
  ["obs", "OBS"], ["scene", "Scene"], ["sound", "Mic and sound"],
  ["twitch", "Title and game"], ["alerts", "Alerts"], ["net", "Internet"],
];
const PRE_ICONS = {
  good: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12.5 4 4 8-9"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6"/><path d="M12 17h.01"/></svg>',
  bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="m8 8 8 8M16 8l-8 8"/></svg>',
  skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M8 12h8"/></svg>',
};
const PRE_FIX = {
  setup: "Set up", unmute: "Unmute", title: "Change", alerts: "Add to OBS", show: "Show it",
  reload: "Reload", test: "Send a test", net: "Test again", listen: "Listen again",
};

function preOpen() {
  $("preModal").hidden = false;
  preStart();
}

function preClose() {
  $("preModal").hidden = true;
  PRE.run++; // (stops a mic test that's still going)
}

async function preStart() {
  const run = ++PRE.run;
  PRE.rows = {};
  for (const [key] of PRE_ORDER) PRE.rows[key] = { key, state: "wait" };
  preDraw(true);
  const res = await api("/api/live-pre", {}).catch(() => null);
  if (run !== PRE.run) return;
  if (!res || !res.ok) {
    for (const [key] of PRE_ORDER) PRE.rows[key] = { key, state: "skip", title: "Couldn't check", text: (res && res.error) || "Try again in a moment." };
    return preDraw();
  }
  preTake(res.checks, run);
  preNet(run);
}

// The checks came back: missing ones need OBS (it isn't connected).
function preTake(checks, run) {
  const got = Object.fromEntries((checks || []).map((c) => [c.key, c]));
  for (const [key] of PRE_ORDER) {
    if (key === "net") continue;
    PRE.rows[key] = got[key] || { key, state: "skip", title: "Needs OBS", text: "Connect OBS first." };
  }
  preDraw();
  if (PRE.rows.sound.state === "listen") preListen(run);
}

async function preNet(run) {
  PRE.rows.net = { key: "net", state: "wait", title: "Testing your upload speed...", text: "" };
  preDraw();
  const res = await api("/api/live-pre-net", {}).catch(() => null);
  if (run !== PRE.run) return;
  PRE.rows.net = res && res.ok ? res.check : { key: "net", state: "warn", title: "Couldn't test your internet", text: "Is it on?", fix: "net" };
  preDraw();
}

// Say something: the bar follows your mic (OBS's own sound levels), for 5 seconds.
async function preListen(run) {
  const row = PRE.rows.sound;
  row.state = "listen";
  row.title = "Say something";
  row.text = `Listening to “${row.mic}”...`;
  preDraw();
  let top = 0;
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const res = await api("/api/live-obs", {}).catch(() => null);
    if (run !== PRE.run) return;
    const input = res && res.ok && (res.obs.inputs || []).find((i) => i.name === row.mic);
    const level = input ? input.level || 0 : 0;
    top = Math.max(top, level);
    const bar = $("preMeter");
    if (bar) bar.style.setProperty("--lvl", Math.min(1, Math.sqrt(level)).toFixed(3));
    if (top > 0.12 && Date.now() > end - 3000) break; // (heard you clearly: no need to wait the whole time)
    await new Promise((r) => setTimeout(r, 160));
  }
  if (run !== PRE.run) return;
  if (top < 0.02) {
    Object.assign(row, { state: "warn", title: "Couldn't hear you", fix: "listen",
      text: `Is the right mic picked? In OBS, press the gear next to “${row.mic}” and open Properties.` });
  } else if (top >= 0.99) {
    Object.assign(row, { state: "warn", title: "Your mic is very loud", fix: "listen",
      text: "It may crackle for viewers. Turn it down a little in OBS's Audio Mixer." });
  } else {
    Object.assign(row, { state: "good", title: "Your mic works", fix: null, text: `“${row.mic}” is on and viewers will hear you.` });
  }
  preDraw();
}

// ---------------------------------------------------------------- drawing

function preRowHtml(r, label, i) {
  const icon = r.state === "wait" || r.state === "listen" ? '<i class="lvp-spin"></i>' : PRE_ICONS[r.state] || "";
  let fix = "";
  if (r.fix === "scene" && (r.scenes || []).length > 1) {
    fix = `<select class="lvp-scene" data-fix="scene" title="Pick the scene to start on">${r.scenes.map((s) => `<option${s === r.scene ? " selected" : ""}>${lvEsc(s)}</option>`).join("")}</select>`;
  } else if (r.fix && PRE_FIX[r.fix] && r.state !== "wait") {
    const quiet = r.state === "good" || r.fix === "net" || r.fix === "listen";
    fix = `<button type="button" class="${quiet ? "link" : r.state === "bad" ? "small-button lvp-fix" : "lvp-fix lvp-soft"}" data-fix="${r.fix}">${PRE_FIX[r.fix]}</button>`;
  }
  const text = r.state === "wait" && !r.title ? "Checking..." : r.text || "";
  return `<li class="lvp-row ${r.state}" style="--i:${i}" data-key="${r.key}">
    <span class="lvp-icon">${icon}</span>
    <div class="lvp-text"><small>${label}</small><b>${lvEsc(r.state === "wait" && !r.title ? label : r.title || label)}</b>${text ? `<span>${lvEsc(text)}</span>` : ""}
      ${r.state === "listen" ? '<span class="lvp-meter" id="preMeter"><i></i></span>' : ""}</div>
    ${fix}
  </li>`;
}

function preDraw(fresh) {
  const rows = PRE_ORDER.map(([key, label], i) => preRowHtml(PRE.rows[key] || { key, state: "wait" }, label, i));
  const list = $("preList");
  if (fresh) {
    list.innerHTML = rows.join("");
    list.classList.remove("in");
    void list.offsetWidth; // (plays the rows' coming-in animation again)
    list.classList.add("in");
  } else {
    // Only the rows that changed are redrawn, so the others don't flicker (and the mic bar keeps moving).
    PRE_ORDER.forEach(([key], i) => {
      const old = list.querySelector(`[data-key="${key}"]`);
      if (!old || old.dataset.html === rows[i]) return;
      const tmp = document.createElement("template");
      tmp.innerHTML = rows[i].trim();
      const el = tmp.content.firstChild;
      el.dataset.html = rows[i];
      if (old.classList.contains("wait") || old.classList.contains("listen")) el.classList.add("done");
      old.replaceWith(el);
    });
  }
  preDrawHead();
}

function preDrawHead() {
  const all = PRE_ORDER.map(([k]) => PRE.rows[k] || {});
  const going = all.some((r) => r.state === "wait" || r.state === "listen");
  const bad = all.filter((r) => r.state === "bad").length, warn = all.filter((r) => r.state === "warn").length;
  const head = $("preHead");
  const state = going ? "going" : bad ? "bad" : warn ? "warn" : "good";
  if (head.dataset.state !== state) {
    head.dataset.state = state;
    head.className = "lvp-head " + state;
    $("preRing").innerHTML = going ? '<i class="lvp-spin"></i>' : PRE_ICONS[state];
  }
  $("preTitle").textContent = going ? "Checking your stream..." : bad + warn === 0 ? "You're ready to go live" :
    bad ? `${bad === 1 ? "One thing" : bad + " things"} to fix first` : `Ready, with ${warn === 1 ? "one thing" : warn + " things"} to look at`;
  $("preSub").textContent = going ? "This takes about 10 seconds." : bad + warn === 0 ? "Everything looks good. Have a great stream!" :
    bad ? "Viewers would notice these. Fix them, then check again." : "You can go live, but have a look first.";
  $("preAgain").disabled = going;
}

// ---------------------------------------------------------------- fixing

async function preFix(what, el) {
  const row = PRE.rows[el.closest("[data-key]").dataset.key] || {};
  if (what === "setup") { preClose(); return lvOpenSetup(); }
  if (what === "net") return preNet(PRE.run);
  if (what === "listen") return preListen(PRE.run);
  if (what === "title") {
    preClose();
    if (typeof lviOpen !== "function" || !$("lvInfo") || $("lvInfo").hidden) return lvToast("Add the Twitch info card in Customize to change your title here.");
    if (row.info) LVI.info = row.info;
    if (!LVI.info) return;
    lviOpen();
    $("lvInfo").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => $("lviTitle") && $("lviTitle").focus(), 350);
    return;
  }
  if (PRE.busy) return;
  PRE.busy = true;
  el.disabled = true;
  const data = { what, input: row.input, scene: what === "scene" ? el.value : row.scene, item: row.item };
  const res = await api("/api/live-pre-fix", data).catch(() => null);
  PRE.busy = false;
  el.disabled = false;
  if (!res || !res.ok) return lvToast((res && res.error) || "That didn't work. Try it in OBS.");
  if (what === "test") return lvToast("Sent a test follow to your stream.");
  preTake(res.checks, PRE.run);
}

$("preList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-fix]");
  if (b) preFix(b.dataset.fix, b);
});
$("preList").addEventListener("change", (e) => {
  const s = e.target.closest("select[data-fix]");
  if (s) preFix("scene", s);
});
$("preAgain").addEventListener("click", preStart);
$("preDone").addEventListener("click", preClose);
$("preModal").addEventListener("click", (e) => { if (e.target === $("preModal")) preClose(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("preModal").hidden) preClose(); });
