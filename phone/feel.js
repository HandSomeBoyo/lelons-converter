// Makes the phone app feel like an iPhone app: screens slide in and out, you can swipe back from
// the left edge, pull down to refresh, and hold a chat bubble to react to it.
// Loaded last: it wraps app.js's navigation functions, so it only adds to them.
"use strict";

// ---------------------------------------------------------------- slides between screens

const FEEL = { dir: null, at: 0 };
const FEEL_MS = 340;

function feelNav(dir) { FEEL.dir = dir; FEEL.at = performance.now(); }

// Wrap the functions that change screens, so we know which way to slide.
for (const [name, dir] of [["openChat", "in"], ["openServer", "in"], ["openDocs", "in"], ["openDoc", "in"], ["closeView", "out"], ["closeDoc", "out"]]) {
  const orig = window[name];
  if (typeof orig !== "function") continue;
  window[name] = function (...args) { feelNav(dir); return orig.apply(this, args); };
}

// Each time a screen is put on, give it its slide. A screen drawn again a moment later
// (the data came in) keeps sliding from where the first one was, so nothing jumps.
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) {
    if (n.nodeType !== 1 || !n.classList.contains("screen")) continue;
    const since = performance.now() - FEEL.at;
    if (!FEEL.dir || since > FEEL_MS) { FEEL.dir = null; continue; }
    n.classList.add("go-" + FEEL.dir);
    n.style.animationDelay = `-${Math.round(since)}ms`;
  }
}).observe(document.getElementById("app"), { childList: true });

// Tabs: a quick fade.
document.addEventListener("click", (e) => {
  if (e.target.closest(".tabs button, [data-tab-go]")) feelNav("tab");
}, true);

// ---------------------------------------------------------------- swipe back from the left edge

(function swipeBack() {
  let drag = null;
  const backBtn = () => document.getElementById("back");
  document.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.clientX > 24 || !S.view || !backBtn() || document.getElementById("call") || PL.open) return;
    const screen = document.querySelector("#app > .screen");
    if (!screen) return;
    drag = { x: t.clientX, y: t.clientY, dx: 0, t: performance.now(), screen, moved: false };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!drag) return;
    const t = e.touches[0];
    const dx = t.clientX - drag.x, dy = t.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }  // scrolling up/down
    drag.moved = true;
    drag.dx = Math.max(0, dx);
    drag.screen.style.transition = "none";
    drag.screen.style.transform = `translateX(${drag.dx}px)`;
    drag.screen.style.boxShadow = "-10px 0 30px rgba(0,0,0,.5)";
    e.preventDefault();
  }, { passive: false });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    const fast = d.dx / Math.max(1, performance.now() - d.t) > 0.5;
    const go = d.dx > window.innerWidth * 0.33 || (fast && d.dx > 40);
    d.screen.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)";
    d.screen.style.transform = go ? "translateX(100%)" : "";
    if (go) setTimeout(() => { FEEL.dir = "back"; FEEL.at = performance.now(); const b = backBtn(); if (b) b.click(); FEEL.dir = "back"; }, 200);
    else setTimeout(() => { d.screen.style.boxShadow = ""; d.screen.style.transition = ""; }, 230);
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
})();

// ---------------------------------------------------------------- pull down to refresh

(function pullToRefresh() {
  let pull = null;
  const what = () => {
    if (S.view && S.view.kind === "docs") return () => loadDocs();
    if (S.view) return null;
    if (S.tab === "lib") return () => loadSounds();
    if (S.tab === "live") return typeof liveLoad === "function" ? () => liveLoad() : null;
    if (S.tab === "home") return () => { S.games = null; return refreshAll(); };
    return () => refreshAll();
  };
  document.addEventListener("touchstart", (e) => {
    const sc = e.target.closest(".scroll");
    if (!sc || sc.id === "msgs" || sc.id === "dscroll" || sc.scrollTop > 0 || e.touches.length !== 1 || !what()) return;
    pull = { y: e.touches[0].clientY, x: e.touches[0].clientX, sc, d: 0, el: null };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!pull) return;
    const dy = e.touches[0].clientY - pull.y;
    if (dy <= 0 || pull.sc.scrollTop > 0) { if (pull.el) pull.el.style.height = "0px"; pull.d = 0; return; }
    if (Math.abs(e.touches[0].clientX - pull.x) > dy) { pull = null; return; }
    pull.d = Math.min(110, dy * 0.5);
    if (!pull.el) {
      pull.el = document.createElement("div");
      pull.el.className = "ptr";
      pull.el.innerHTML = "<i></i>";
      pull.sc.prepend(pull.el);
    }
    pull.el.style.height = pull.d + "px";
    pull.el.firstChild.style.transform = `rotate(${pull.d * 4}deg)`;
    pull.el.classList.toggle("ready", pull.d > 64);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", async () => {
    if (!pull) return;
    const p = pull;
    pull = null;
    if (!p.el) return;
    if (p.d > 64) {
      p.el.classList.add("busy");
      p.el.style.height = "52px";
      try { await what()(); } catch { /* the page says so itself */ }
      setTimeout(() => { if (p.el.isConnected) { p.el.style.height = "0px"; setTimeout(() => p.el.remove(), 250); } }, 250);
    } else {
      p.el.style.height = "0px";
      setTimeout(() => p.el.remove(), 250);
    }
  });
})();

// ---------------------------------------------------------------- reactions on chat bubbles

const REACTS = ["❤️", "😂", "🔥", "👍", "😮", "😢"];

function reactBarClose() { const b = document.querySelector(".reactbar"); if (b) b.remove(); document.querySelectorAll(".brow.held").forEach((x) => x.classList.remove("held")); }

function reactBarOpen(row) {
  reactBarClose();
  const id = Number(row.dataset.mid);
  const m = S.view && S.view.messages && S.view.messages.find((x) => x.id === id);
  if (!m) return;
  row.classList.add("held");
  const bar = document.createElement("div");
  bar.className = "reactbar glass";
  bar.innerHTML = REACTS.map((e) => {
    const mine = (m.reactions || []).some((r) => r.emoji === e && r.mine);
    return `<button class="${mine ? "mine" : ""}" data-react="${e}" data-mid="${id}" data-on="${mine ? 0 : 1}">${e}</button>`;
  }).join("");
  document.getElementById("app").appendChild(bar);
  const r = row.querySelector(".bub").getBoundingClientRect();
  const app = document.getElementById("app").getBoundingClientRect();
  const w = bar.offsetWidth;
  let left = row.classList.contains("me") ? r.right - w : r.left;
  left = Math.max(10, Math.min(app.width - w - 10, left - app.left));
  let top = r.top - app.top - bar.offsetHeight - 8;
  if (top < 90) top = r.bottom - app.top + 8;
  bar.style.left = left + "px";
  bar.style.top = top + "px";
}

async function reactTo(id, emoji, on) {
  reactBarClose();
  const v = S.view;
  const m = v && v.messages && v.messages.find((x) => x.id === id);
  if (!m) return;
  // Show it straight away, then tell the library.
  const list = (m.reactions || []).map((r) => ({ ...r }));
  const r = list.find((x) => x.emoji === emoji);
  if (on) { if (r) { if (!r.mine) { r.mine = true; r.count++; } } else list.push({ emoji, count: 1, mine: true }); }
  else if (r && r.mine) { r.mine = false; r.count--; }
  m.reactions = list.filter((x) => x.count > 0);
  renderMessages();
  try { await rpcMe("lelons_chat_react", { message_id: id, emoji, on_off: !!on }); }
  catch (e) { toast(e.message); }
}

(function holdToReact() {
  let hold = null, lastTap = { id: 0, t: 0 }, opened = 0, swallow = false;
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".reactbar")) swallow = false;
    const bub = e.target.closest("#msgs .bub");
    if (!bub || e.target.closest("button, a, audio")) return;
    const row = bub.closest(".brow");
    hold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { hold = null; opened = performance.now(); swallow = true; reactBarOpen(row); }, 420) };
  });
  document.addEventListener("pointermove", (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) { clearTimeout(hold.timer); hold = null; }
  });
  document.addEventListener("pointerup", () => { if (hold) { clearTimeout(hold.timer); hold = null; } });
  document.addEventListener("pointercancel", () => { if (hold) { clearTimeout(hold.timer); hold = null; } });
  document.addEventListener("contextmenu", (e) => { if (e.target.closest("#msgs .bub")) e.preventDefault(); });
  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-react]");
    if (r) { e.stopPropagation(); return reactTo(Number(r.dataset.mid), r.dataset.react, r.dataset.on === "1"); }
    if (swallow) { swallow = false; e.stopPropagation(); return; }  // (the click that ends the long press)
    if (document.querySelector(".reactbar") && !e.target.closest(".reactbar")) { reactBarClose(); return; }
    // Double tap a bubble: ❤️
    const bub = e.target.closest("#msgs .bub");
    if (bub && !e.target.closest("button, a, audio")) {
      const id = Number(bub.closest(".brow").dataset.mid);
      const now = performance.now();
      if (lastTap.id === id && now - lastTap.t < 320) {
        lastTap = { id: 0, t: 0 };
        const m = S.view && S.view.messages && S.view.messages.find((x) => x.id === id);
        const mine = m && (m.reactions || []).some((x) => x.emoji === "❤️" && x.mine);
        reactTo(id, "❤️", !mine);
      } else lastTap = { id, t: now };
    }
  }, true);
  document.addEventListener("scroll", (e) => { if (e.target.id === "msgs" && performance.now() - opened > 600) reactBarClose(); }, true);
})();
