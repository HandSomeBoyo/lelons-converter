// Our own "Share your screen" window for calls, instead of the browser engine's "Choose what to share".
// It lists your screens and open windows with live little pictures (sharepick.py takes them), plus the
// quality and "Share my PC's sound". The engine is then told which one to share without asking again
// (see sharepick.py), and its "... is sharing your screen" bar is kept hidden.
// Uses $, api() from app.js, loadPref()/savePref() from theme.js, and from call.js: SHARE_SIZES,
// SHARE_RATES, callQuality(), callSetQuality(), CALL_ICONS.

const shareUi = { tab: "screens", list: null, pick: "", resolve: null, timer: 0, busy: false, cards: new Map() };

function callShareSoundWanted() { return loadPref("callShareSound") !== false; }

// The lists, from the app (a function of its own, so it's easy to try out without Windows).
function callShareSources(thumbs) {
  return api("/api/share-sources", { thumbs }).catch(() => ({ ok: false }));
}

// Open the picker. Resolves {id, sound} when you press Share, or null.
function callSharePick() {
  if (shareUi.resolve) shareUi.resolve(null);
  return new Promise((resolve) => {
    shareUi.resolve = resolve;
    shareUi.pick = "";
    shareUi.list = null;
    shareUi.cards.clear();
    $("shareGrid").replaceChildren();
    const modal = $("shareModal");
    modal.classList.remove("leaving");
    modal.hidden = false;
    drawSharePicker();
    callShareRefresh();
    setTimeout(() => $("shareGo").focus(), 50);
  });
}

function callShareClose(result) {
  clearTimeout(shareUi.timer);
  const resolve = shareUi.resolve;
  shareUi.resolve = null;
  const modal = $("shareModal");
  if (!modal.hidden && !modal.classList.contains("leaving")) {
    modal.classList.add("leaving");
    setTimeout(() => { if (!shareUi.resolve) { modal.hidden = true; modal.classList.remove("leaving"); } }, 220);
  }
  if (resolve) resolve(result);
}

async function callShareRefresh() {
  clearTimeout(shareUi.timer);
  if (!shareUi.resolve) return;
  const res = await callShareSources(true);
  if (!shareUi.resolve) return;
  if (res && res.ok) {
    shareUi.list = { screens: res.screens || [], windows: res.windows || [] };
    const all = [...shareUi.list.screens, ...shareUi.list.windows];
    if (shareUi.pick && !all.some((s) => s.id === shareUi.pick)) shareUi.pick = ""; // (that window was closed)
    if (!shareUi.pick && shareUi.tab === "screens" && shareUi.list.screens.length) shareUi.pick = shareUi.list.screens[0].id;
  } else if (!shareUi.list) {
    shareUi.list = { screens: [], windows: [] };
  }
  drawSharePicker();
  shareUi.timer = setTimeout(callShareRefresh, 2500); // (the pictures stay fresh while it's open)
}

function drawSharePicker() {
  const tab = shareUi.tab;
  document.querySelectorAll("#shareTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("shareTabs").style.setProperty("--at", tab === "screens" ? 0 : 1);
  const grid = $("shareGrid");
  grid.classList.toggle("windows", tab === "windows");
  const list = shareUi.list ? shareUi.list[tab] : null;
  if (!list) {
    // Still getting the pictures: soft placeholders.
    if (!grid.querySelector(".share-card.loading")) {
      grid.replaceChildren(...Array.from({ length: tab === "screens" ? 2 : 6 }, () => {
        const el = document.createElement("div");
        el.className = "share-card loading";
        el.innerHTML = '<span class="share-thumb"></span><span class="share-name"><i></i><b></b></span>';
        return el;
      }));
    }
  } else if (!list.length) {
    grid.replaceChildren(Object.assign(document.createElement("p"), {
      className: "share-empty",
      textContent: tab === "screens" ? "No screens found." : "No open windows to share. Open the app you want to show, and it shows up here.",
    }));
  } else {
    const keep = new Set(list.map((s) => tab + s.id));
    for (const [key, el] of shareUi.cards) if (!keep.has(key)) { el.remove(); shareUi.cards.delete(key); }
    grid.querySelectorAll(".share-card.loading, .share-empty").forEach((el) => el.remove());
    list.forEach((s, i) => {
      const key = tab + s.id;
      let el = shareUi.cards.get(key);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "share-card";
        el.style.setProperty("--i", Math.min(i, 12));
        el.innerHTML = '<span class="share-thumb"><img alt=""></span><span class="share-name"></span>';
        el.addEventListener("click", () => { shareUi.pick = s.id; drawSharePicker(); });
        el.addEventListener("dblclick", () => { shareUi.pick = s.id; callShareGo(); });
        shareUi.cards.set(key, el);
      }
      const img = el.querySelector("img");
      if (s.thumb && img.getAttribute("src") !== s.thumb) img.src = s.thumb;
      el.querySelector(".share-thumb").classList.toggle("blank", !s.thumb);
      el.querySelector(".share-thumb").dataset.note = !s.thumb && s.minimized ? "Minimized" : "";
      const sig = JSON.stringify([s.name, s.icon, s.app, s.main, tab]);
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        const name = el.querySelector(".share-name");
        name.replaceChildren();
        if (tab === "windows") {
          const icon = document.createElement("i");
          if (s.icon) icon.append(Object.assign(document.createElement("img"), { src: s.icon, alt: "" }));
          else icon.textContent = (s.app || s.name || "?").slice(0, 1).toUpperCase();
          name.append(icon);
        }
        name.append(Object.assign(document.createElement("b"), { textContent: tab === "screens" && list.length === 1 ? "Your whole screen" : s.name }));
        if (tab === "screens" && s.main && list.length > 1) name.append(Object.assign(document.createElement("small"), { textContent: "Main" }));
        el.title = s.app && s.app.toLowerCase() !== s.name.toLowerCase() ? `${s.name} (${s.app})` : s.name;
      }
      el.classList.toggle("on", s.id === shareUi.pick);
      el.setAttribute("aria-pressed", String(s.id === shareUi.pick));
      if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
    });
  }
  // Quality and sound
  const q = callQuality();
  const seg = (box, values, current, label, pick) => {
    const sig = JSON.stringify([values, current]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.replaceChildren(...values.map((v) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: label(v), className: v === current ? "on" : "" });
      b.addEventListener("click", () => { pick(v); drawSharePicker(); });
      return b;
    }));
  };
  seg($("shareSize"), SHARE_SIZES, q.size, (v) => v + "p", (v) => callSetQuality({ size: v }));
  seg($("shareFps"), SHARE_RATES, q.fps, (v) => v + " fps", (v) => callSetQuality({ fps: v }));
  $("shareSound").checked = callShareSoundWanted();
  $("shareGo").disabled = !shareUi.pick || shareUi.busy;
}

function callShareGo() {
  if (!shareUi.pick) return;
  callShareClose({ id: shareUi.pick, sound: callShareSoundWanted() });
}

document.querySelectorAll("#shareTabs button").forEach((b) => b.addEventListener("click", () => {
  if (shareUi.tab === b.dataset.tab) return;
  shareUi.tab = b.dataset.tab;
  const list = shareUi.list && shareUi.list[shareUi.tab];
  if (list && !list.some((s) => s.id === shareUi.pick)) shareUi.pick = list.length && shareUi.tab === "screens" ? list[0].id : "";
  drawSharePicker();
}));
$("shareSound").addEventListener("change", () => savePref("callShareSound", $("shareSound").checked));
$("shareGo").addEventListener("click", callShareGo);
$("shareCancel").addEventListener("click", () => callShareClose(null));
$("shareClose").addEventListener("click", () => callShareClose(null));
$("shareModal").addEventListener("mousedown", (e) => { if (e.target === $("shareModal")) callShareClose(null); });
$("shareModal").addEventListener("click", (e) => e.stopPropagation()); // (a click here doesn't close the call's little windows)
document.addEventListener("keydown", (e) => {
  if (!shareUi.resolve) return;
  if (e.key === "Escape") { e.preventDefault(); callShareClose(null); }
  else if (e.key === "Enter" && shareUi.pick && !/^(BUTTON|INPUT)$/.test(e.target.tagName)) { e.preventDefault(); callShareGo(); }
});

// Share it: ask the engine for exactly what was picked (sharepick.py makes the engine pick it by itself).
async function callShareStart(pick) {
  const q = callQuality();
  const prep = await api("/api/share-pick", { id: pick.id }).catch(() => ({ ok: false }));
  if (!prep.ok) { if (prep.error) callSay(prep.error); return null; }
  const sound = pick.sound ? callShareAudioOptions() : false;
  if (prep.kind === "screen" && prep.index > 0) return callShareOther(prep.index, sound);
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { height: { ideal: q.size, max: q.size }, frameRate: { ideal: q.fps, max: q.fps } },
      audio: sound,
      systemAudio: sound ? "include" : "exclude",
      // (only the kind that was picked, so the engine can't pick the other one)
      monitorTypeSurfaces: prep.kind === "window" ? "exclude" : "include",
      selfBrowserSurface: "include", surfaceSwitching: "exclude",
    });
  } catch (e) {
    stream = null;
  } finally {
    api("/api/share-picked", {}).catch(() => {});
  }
  if (stream) api("/api/share-bar", { on: true }).catch(() => {});
  return stream;
}

// A screen other than the main one: the hidden helper takes it (its engine picks exactly that screen) and
// hands it over here, on this PC. The PC's sound still comes from here (the main screen's share, picture
// left out), so friends' voices stay out of it.
let callShareRelayPc = null; // the newest one
const callShareRelays = []; // {pc, stream}
async function callShareOther(index, sound) {
  const q = callQuality();
  const pc = callShareRelayPc = new RTCPeerConnection({ iceServers: [] });
  const relay = { pc, stream: null };
  callShareRelays.push(relay);
  const fail = (text) => { callShareOtherStop(); if (text) callSay(text); return null; };
  pc.addTransceiver("video", { direction: "recvonly" });
  const got = new Promise((resolve) => { pc.ontrack = (e) => resolve(e.track); });
  await pc.setLocalDescription(await pc.createOffer());
  await callGathered(pc);
  const start = await api("/api/share-relay", { what: "start", screen: index, sdp: pc.localDescription.sdp, size: q.size, fps: q.fps }).catch(() => ({ ok: false }));
  if (!start.ok) return fail("");
  let answer = null;
  for (let i = 0; i < 90 && callShareRelayPc === pc; i++) { // (the helper may take a few seconds to start)
    const r = await api("/api/share-relay", { what: "wait", id: start.id }).catch(() => ({ ok: false }));
    if (!r.ok || r.error) break;
    if (r.answer) { answer = r.answer; break; }
    await new Promise((done) => setTimeout(done, 400));
  }
  if (callShareRelayPc !== pc) return null;
  if (!answer) return fail("Couldn't share that screen. Try again, or pick your main screen.");
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  const track = await Promise.race([got, new Promise((done) => setTimeout(() => done(null), 8000))]);
  if (callShareRelayPc !== pc) return null;
  if (!track) return fail("Couldn't share that screen. Try again, or pick your main screen.");
  const stream = relay.stream = new MediaStream([track]);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") track.dispatchEvent(new Event("ended"));
  };
  if (sound) {
    try { // (the PC's sound: from the main screen's share, without its picture)
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: sound, systemAudio: "include", monitorTypeSurfaces: "include", surfaceSwitching: "exclude" });
      s.getVideoTracks().forEach((t) => { t.enabled = false; stream.addTrack(t); }); // (kept, not sent: stopping it would end the sound too)
      s.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (e) { /* no PC sound, the screen still goes */ }
  }
  api("/api/share-bar", { on: true }).catch(() => {});
  return stream;
}
// A new share is in place (stream), or sharing stopped (null): let go of the helper's older pictures.
function callShareSwapped(stream) {
  for (const r of [...callShareRelays]) {
    if (stream && r.stream === stream) continue;
    callShareRelays.splice(callShareRelays.indexOf(r), 1);
    try { r.pc.close(); } catch (e) { /* closed */ }
  }
  if (!callShareRelays.length) {
    if (callShareRelayPc) api("/api/share-relay", { what: "stop" }).catch(() => {});
    callShareRelayPc = null;
  }
}
function callShareOtherStop() { callShareSwapped(null); }
