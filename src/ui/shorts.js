// The Clip maker tab: add a long video, find (or add) the best moments, pick a look, and every
// moment becomes its own vertical Short (1080 x 1920). The phone next to the video shows how it
// will look while it plays. Uses $, api(), clock(), whereToSave(), refresh(), setDrag() from app.js,
// showTab(), sizeText() from images.js and loadPref(), savePref() from theme.js.

const CM_CAM = 1080 / 768; // the facecam's shape at the top of a Short (40% of it)
const CM_GAME = 1080 / 1152; // the game's shape under the facecam
let cmServer = []; // from the app's state
let cmId = ""; // the video on the tab
let cmLocal = null; // a dropped video still being copied in: {name, size, url, percent, xhr, error}
let cmMoments = []; // [{start, end, score, on, own}]
let cmSel = -1;
let cmFinding = false;
let cmFindText = "";
let cmError = "";
let cmStopAt = null; // playing one moment: pause at its end
let cmNvidia = false;
let cmSpeechReady = true;
let cmSeenRun = "";
let cmLength = Number(loadPref("cmLength")) || 30;
let cmLook = { layout: "fill", pos: 0.5, cam: { x: 0.68, y: 0.06, w: 0.28 }, subs: "1", language: "" };
try { cmLook = { ...cmLook, ...JSON.parse(loadPref("cmLook") || "{}") }; } catch (e) { /* keep the defaults */ }
const cmVideo = $("cmVideo");
const cmSound = new Audio(); // all the sound tracks mixed, when there are several (like the Resolve tab)
cmSound.preload = "auto";
let cmMixed = false;
let cmMixText = "";

api("/api/sh-options", {}).then((res) => {
  if (!res.ok) return;
  cmNvidia = !!res.nvidia;
  cmSpeechReady = !!res.speechReady;
  if (!loadPref("cmLook")) cmLook.language = res.language || "";
  drawShorts();
}).catch(() => {});

const cmItem = () => cmServer.find((f) => f.id === cmId) || null;
const cmBusy = (f) => !!f && (f.status === "active" || f.status === "queued" || f.waitingFor);
const cmSaveLook = () => savePref("cmLook", JSON.stringify(cmLook));

function cmTime(t) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const sec = `${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  return h ? `${h}:${m < 10 ? "0" : ""}${m}:${sec}` : `${m}:${sec}`;
}
const cmShort = (t) => cmTime(t).replace(/\.\d$/, "");

// ---------------------------------------------------------------- adding the video

function cmTakesDrop(files) {
  if ($("shortsTab").hidden) return false;
  const file = [...files].find((f) => /^video\//.test(f.type) || /\.(mkv|avi|mov|wmv|flv|webm|mp4|m4v|ts)$/i.test(f.name));
  if (file) cmUse(file);
  return true;
}

function cmLetGo() {
  const old = cmItem();
  if (old && !cmBusy(old)) {
    api("/api/sh-remove", { id: old.id });
    cmServer = cmServer.filter((f) => f.id !== old.id);
  }
  if (cmLocal) {
    if (cmLocal.xhr) cmLocal.xhr.abort();
    URL.revokeObjectURL(cmLocal.url);
  }
  cmLocal = null;
  cmId = "";
  cmMoments = [];
  cmSel = -1;
  cmFinding = false;
  cmFindText = "";
  cmError = "";
  cmSeenRun = "";
  cmPeaks = null;
  cmVideo.removeAttribute("src");
  cmVideo.load();
  cmMixed = false;
  cmMixText = "";
  cmSound.pause();
  cmSound.removeAttribute("src");
  cmVideo.muted = false;
}

function cmReady(file) {
  cmServer.push(file);
  cmId = file.id;
  cmLoadWave();
  cmLoadMix();
}

// A dropped file plays right away from memory while it's copied into VaultHub.
function cmUse(file) {
  showTab("shorts");
  cmLetGo();
  cmLocal = { name: file.name, size: file.size, url: URL.createObjectURL(file), percent: 0 };
  cmPlay(cmLocal.url);
  const xhr = new XMLHttpRequest();
  cmLocal.xhr = xhr;
  const local = cmLocal;
  xhr.open("POST", "/api/sh-add");
  xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { local.percent = (e.loaded / e.total) * 100; drawShorts(); } };
  xhr.onload = () => {
    let res;
    try { res = JSON.parse(xhr.responseText); } catch (e) { res = { ok: false, error: "Couldn't open this file." }; }
    if (cmLocal !== local) {
      if (res.ok) api("/api/sh-remove", { id: res.file.id });
      return;
    }
    if (!res.ok) { local.error = res.error; drawShorts(); return; }
    local.xhr = null;
    cmReady(res.file);
    if (cmVideo.dataset.broken) cmMakePreview();
    drawShorts();
  };
  xhr.onerror = () => { if (cmLocal === local) { local.error = "Couldn't open this file."; drawShorts(); } };
  xhr.send(file);
  drawShorts();
}

// "Add a long video": the Open window. The video is used where it is, so it plays at once.
let cmPicking = false;
$("cmDrop").addEventListener("click", cmPick);
$("cmChange").addEventListener("click", cmPick);
async function cmPick(e) {
  if (e && e.target === $("cmFiles")) return;
  if (e) e.preventDefault();
  if (cmPicking) return;
  cmPicking = true;
  const res = await api("/api/sh-pick", {}).catch(() => ({ ok: false, fallback: true }));
  cmPicking = false;
  if (!res.ok) return res.fallback && $("cmFiles").click();
  const file = res.files[0];
  if (!file) {
    if (res.errors.length) { cmError = res.errors[0]; drawShorts(); }
    return;
  }
  cmLetGo();
  cmReady(file);
  cmPlay(`/sh-video/${file.id}`);
  drawShorts();
}
$("cmFiles").addEventListener("change", (e) => {
  if (e.target.files[0]) cmUse(e.target.files[0]);
  e.target.value = "";
});

// ---------------------------------------------------------------- playing

function cmPlay(src) {
  delete cmVideo.dataset.broken;
  cmVideo.src = src;
  cmLoadingText("Opening the video...");
}

function cmLoadingText(text) {
  $("cmLoading").hidden = !text;
  $("cmLoadingText").textContent = text || "";
}

cmVideo.addEventListener("loadeddata", () => {
  if (!cmVideo.videoWidth) return cmCantPlay();
  cmLoadingText("");
  cmPlace();
  cmTick();
});
cmVideo.addEventListener("error", () => { if (cmVideo.getAttribute("src")) cmCantPlay(); });

function cmCantPlay() {
  if (cmVideo.dataset.broken) return;
  cmVideo.dataset.broken = "1";
  if (cmId) cmMakePreview();
  else cmLoadingText("Getting the video ready...");
}

// The window can't play this one (some MKV or 10-bit videos): VaultHub makes a copy it can.
async function cmMakePreview() {
  const id = cmId;
  while (id === cmId) {
    const res = await api("/api/sh-preview", { id }).catch(() => ({ ok: false }));
    if (id !== cmId) return;
    if (!res.ok || res.error) return cmLoadingText(res.error || "Couldn't show this video, but Shorts can still be made from it.");
    if (res.ready) {
      const at = cmVideo.currentTime || 0;
      cmVideo.src = `/sh-video/${id}/copy`;
      cmVideo.currentTime = at;
      return;
    }
    cmLoadingText(`Getting the video ready... ${Math.floor(res.progress || 0)}%`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function cmLoadMix() {
  const item = cmItem();
  if (!item || (item.audioTracks || 0) < 2) return;
  const id = cmId;
  while (id === cmId) {
    const res = await api("/api/sh-mix", { id }).catch(() => ({ ok: false }));
    if (id !== cmId) return;
    if (!res.ok || res.error) { cmMixText = ""; drawShorts(); return; }
    if (res.ready) {
      cmSound.src = `/sh-video/${id}/mix`;
      cmMixed = true;
      cmVideo.muted = true;
      cmMixText = "";
      cmSyncSound(true);
      drawShorts();
      return;
    }
    cmMixText = `Adding your other sound tracks... ${Math.floor(res.progress || 0)}%`;
    drawShorts();
    await new Promise((r) => setTimeout(r, 700));
  }
}

function cmSyncSound(force) {
  if (!cmMixed) return;
  if (force || Math.abs(cmSound.currentTime - cmVideo.currentTime) > 0.25) cmSound.currentTime = cmVideo.currentTime;
  if (cmVideo.paused) cmSound.pause();
  else cmSound.play().catch(() => {});
}
for (const ev of ["play", "pause", "seeked", "waiting", "playing"]) cmVideo.addEventListener(ev, () => cmSyncSound(ev !== "pause"));

let cmPeaks = null;
async function cmLoadWave() {
  const id = cmId;
  const res = await api("/api/sh-wave", { id }).catch(() => ({ ok: false }));
  if (id !== cmId || !res.ok) return;
  cmPeaks = res.peaks;
  cmDrawWave();
}

function cmLengthOf() {
  const item = cmItem();
  return (item && item.seconds) || cmVideo.duration || 0;
}

function cmSeek(t) {
  if (cmVideo.getAttribute("src")) cmVideo.currentTime = Math.max(0, Math.min(t, cmLengthOf()));
  cmTick();
}

$("cmPlay").addEventListener("click", () => {
  cmStopAt = null;
  if (cmVideo.paused) cmVideo.play().catch(() => {});
  else cmVideo.pause();
});
$("cmScreen").addEventListener("click", (e) => { if (!e.target.closest(".cm-box")) $("cmPlay").click(); });
cmVideo.addEventListener("play", () => { $("cmPlay").classList.add("playing"); cmTick(); });
cmVideo.addEventListener("pause", () => $("cmPlay").classList.remove("playing"));
cmVideo.addEventListener("seeked", () => { cmTick(); cmDrawPhone(); });
cmVideo.addEventListener("loadedmetadata", () => { cmPlace(); cmDrawBlocks(); });
document.addEventListener("keydown", (e) => {
  if ($("shortsTab").hidden || $("cmWork").hidden) return;
  if (e.key === " " && !/TEXTAREA|INPUT|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $("cmPlay").click(); }
});

function cmTick() {
  const t = cmVideo.currentTime || 0;
  if (cmStopAt !== null && t >= cmStopAt) {
    cmVideo.pause();
    cmStopAt = null;
  }
  $("cmTime").textContent = cmTime(t);
  $("cmHead").style.left = Math.min(100, (t / (cmLengthOf() || 1)) * 100) + "%";
  cmDrawPhone();
  cmSyncSound(false);
  if (!cmVideo.paused && !$("shortsTab").hidden) requestAnimationFrame(cmTick);
}

// ---------------------------------------------------------------- the timeline

$("cmTimeline").addEventListener("click", (e) => {
  const block = e.target.closest(".cm-block");
  if (block) return cmSelect(Number(block.dataset.i), true);
  const box = $("cmTimeline").getBoundingClientRect();
  cmSeek(((e.clientX - box.left) / box.width) * cmLengthOf());
});
window.addEventListener("resize", () => { if (!$("cmWork").hidden) { cmDrawWave(); cmPlace(); } });

function cmDrawWave() {
  const canvas = $("cmCanvas");
  const box = $("cmTimeline").getBoundingClientRect();
  canvas.width = Math.max(1, box.width * devicePixelRatio);
  canvas.height = Math.max(1, box.height * devicePixelRatio);
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!cmPeaks || !cmPeaks.length) return;
  g.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#888";
  const n = cmPeaks.length, w = canvas.width / n, mid = canvas.height / 2;
  cmPeaks.forEach((p, i) => {
    const h = Math.max(1, p * canvas.height * 0.85);
    g.fillRect(i * w, mid - h / 2, Math.max(1, w - 0.5), h);
  });
}

function cmDrawBlocks() {
  const length = cmLengthOf() || 1;
  const box = $("cmBlocks");
  box.innerHTML = "";
  cmMoments.forEach((m, i) => {
    const b = document.createElement("div");
    b.className = "cm-block" + (i === cmSel ? " sel" : "") + (m.on ? "" : " off");
    b.dataset.i = i;
    b.style.left = (m.start / length) * 100 + "%";
    b.style.width = `max(8px, ${((m.end - m.start) / length) * 100}%)`;
    b.title = `Moment ${i + 1}: ${cmShort(m.start)} to ${cmShort(m.end)}`;
    b.innerHTML = `<span>${i + 1}</span>`;
    box.append(b);
  });
}

// ---------------------------------------------------------------- moments

function cmSort() {
  const sel = cmMoments[cmSel];
  cmMoments.sort((a, b) => a.start - b.start);
  cmSel = sel ? cmMoments.indexOf(sel) : -1;
}

function cmSelect(i, seek) {
  cmSel = i;
  const m = cmMoments[i];
  if (m && seek) {
    cmStopAt = null;
    cmSeek(m.start);
  }
  drawShorts();
}

function cmPlayMoment(i) {
  const m = cmMoments[i];
  if (!m) return;
  cmSel = i;
  cmSeek(m.start);
  cmStopAt = m.end;
  cmVideo.play().catch(() => {});
  drawShorts();
}

$("cmAddHere").addEventListener("click", () => {
  const length = cmLengthOf();
  if (!length) return;
  let start = Math.max(0, Math.min(cmVideo.currentTime || 0, length - 1));
  const end = Math.min(length, start + cmLength);
  start = Math.max(0, Math.min(start, end - cmLength));
  const m = { start, end, score: 0, on: true, own: true };
  cmMoments.push(m);
  cmSort();
  cmSel = cmMoments.indexOf(m);
  drawShorts();
});

$("cmLengths").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  cmLength = Number(b.dataset.value);
  savePref("cmLength", cmLength);
  drawShorts();
}));

$("cmFind").addEventListener("click", async () => {
  const item = cmItem();
  if (!item || cmFinding) return;
  cmFinding = true;
  cmError = "";
  cmFindText = "Listening to the video...";
  drawShorts();
  const id = item.id, length = cmLength;
  while (id === cmId) {
    const res = await api("/api/sh-find", { id, length, count: 5 }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
    if (id !== cmId) return;
    if (!res.ok) { cmError = res.error; break; }
    if (res.ready) {
      // Moments you added yourself stay; the ones found before are swapped for the new ones.
      const own = cmMoments.filter((m) => m.own);
      const found = res.moments.filter((m) => !own.some((o) => m.start < o.end && m.end > o.start))
        .map((m) => ({ ...m, on: true, own: false }));
      cmMoments = [...own, ...found];
      cmSel = -1;
      cmSort();
      if (!found.length) cmError = "Couldn't find any parts that stand out. Play the video and click + Moment here at the good parts.";
      else cmSelect(cmMoments.indexOf(cmMoments.reduce((a, b) => (b.score > a.score ? b : a))), true);
      break;
    }
    cmFindText = `Listening to the video... ${Math.floor(res.progress || 0)}%`;
    drawShorts();
    await new Promise((r) => setTimeout(r, 500));
  }
  cmFinding = false;
  cmFindText = "";
  drawShorts();
});

function cmNudge(i, which, by, here) {
  const m = cmMoments[i];
  const length = cmLengthOf();
  if (!m || !length) return;
  let t = here ? cmVideo.currentTime || 0 : m[which] + by;
  if (which === "start") m.start = Math.max(0, Math.min(t, m.end - 1));
  else m.end = Math.min(length, Math.max(t, m.start + 1));
  if (which === "start") cmSeek(m.start);
  cmSort();
  drawShorts();
}

function cmDrawList() {
  const list = $("cmList");
  list.innerHTML = "";
  const busy = cmBusy(cmItem());
  cmMoments.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "cm-row" + (i === cmSel ? " sel" : "") + (m.on ? "" : " off");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = m.on;
    check.disabled = busy;
    check.title = m.on ? "Make this one (click to skip it)" : "Skipped (click to make it)";
    check.onclick = (e) => { e.stopPropagation(); m.on = check.checked; drawShorts(); };
    const num = document.createElement("span");
    num.className = "cm-num";
    num.textContent = i + 1;
    const main = document.createElement("div");
    main.className = "cm-row-main";
    main.innerHTML = `<div class="cm-row-time">${cmShort(m.start)} – ${cmShort(m.end)} <span>${Math.round(m.end - m.start)} s</span></div>`;
    const tag = document.createElement("div");
    tag.className = "cm-row-tag";
    if (m.own) tag.textContent = "Added by you";
    else tag.innerHTML = `<span class="cm-heat"><i style="width:${m.score}%"></i></span>${m.score >= 85 ? "Best moment" : m.score >= 55 ? "Stands out" : "Worth a look"}`;
    main.append(tag);
    const play = document.createElement("button");
    play.type = "button";
    play.className = "cm-icon";
    play.title = "Play this moment";
    play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
    play.onclick = (e) => { e.stopPropagation(); cmPlayMoment(i); };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "cm-icon";
    del.title = "Remove this moment";
    del.disabled = busy;
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.onclick = (e) => {
      e.stopPropagation();
      cmMoments.splice(i, 1);
      cmSel = cmSel === i ? -1 : cmSel > i ? cmSel - 1 : cmSel;
      drawShorts();
    };
    row.append(check, num, main, play, del);
    row.onclick = () => cmSelect(i, true);
    list.append(row);

    if (i === cmSel && !busy) {
      const edit = document.createElement("div");
      edit.className = "cm-edit";
      for (const [which, label] of [["start", "Start"], ["end", "End"]]) {
        const line = document.createElement("div");
        line.className = "cm-edit-line";
        line.innerHTML = `<span class="cm-edit-label">${label}</span>`;
        const minus = document.createElement("button");
        minus.className = "nudge";
        minus.textContent = "−1 s";
        minus.onclick = () => cmNudge(i, which, -1);
        const at = document.createElement("span");
        at.className = "cm-edit-at";
        at.textContent = cmTime(m[which]);
        const plus = document.createElement("button");
        plus.className = "nudge";
        plus.textContent = "+1 s";
        plus.onclick = () => cmNudge(i, which, 1);
        const here = document.createElement("button");
        here.className = "link";
        here.textContent = which === "start" ? "Start here" : "End here";
        here.title = `Use where the video is now (${cmTime(cmVideo.currentTime)})`;
        here.onclick = () => cmNudge(i, which, 0, true);
        line.append(minus, at, plus, here);
        edit.append(line);
      }
      list.append(edit);
    }
  });
}

// ---------------------------------------------------------------- the look: boxes on the video

// Where the picture really is inside the player (it keeps its shape, with black bars around it).
function cmPlace() {
  const item = cmItem();
  const vw = cmVideo.videoWidth || (item && item.width) || 16, vh = cmVideo.videoHeight || (item && item.height) || 9;
  const box = $("cmScreen").getBoundingClientRect();
  if (!box.width) return;
  const scale = Math.min(box.width / vw, box.height / vh);
  const w = vw * scale, h = vh * scale;
  Object.assign($("cmFrame").style, { left: (box.width - w) / 2 + "px", top: (box.height - h) / 2 + "px", width: w + "px", height: h + "px" });
  cmDrawBoxes();
}

function cmSize() {
  const item = cmItem();
  return { vw: cmVideo.videoWidth || (item && item.width) || 1920, vh: cmVideo.videoHeight || (item && item.height) || 1080 };
}

// How wide the Short's crop is, as a part of the video's width (1 when the video is already narrow).
function cmCropWidth() {
  const { vw, vh } = cmSize();
  return Math.min(1, (vh * (cmLook.layout === "facecam" ? CM_GAME : 9 / 16)) / vw);
}
function cmCamHeight() {
  const { vw, vh } = cmSize();
  return (cmLook.cam.w * vw) / CM_CAM / vh;
}
function cmClampCam() {
  const c = cmLook.cam;
  const { vw, vh } = cmSize();
  c.w = Math.max(0.06, Math.min(c.w, 1, (CM_CAM * vh) / vw));
  const h = cmCamHeight();
  c.x = Math.max(0, Math.min(c.x, 1 - c.w));
  c.y = Math.max(0, Math.min(c.y, 1 - h));
}

function cmDrawBoxes() {
  const crop = $("cmCrop"), cam = $("cmCam");
  const wf = cmCropWidth();
  crop.hidden = cmLook.layout === "blur" || wf >= 0.999;
  crop.style.width = wf * 100 + "%";
  crop.style.left = cmLook.pos * (1 - wf) * 100 + "%";
  crop.querySelector("span").textContent = cmLook.layout === "facecam" ? "Game" : "Short";
  cam.hidden = cmLook.layout !== "facecam";
  if (!cam.hidden) {
    cmClampCam();
    Object.assign(cam.style, { left: cmLook.cam.x * 100 + "%", top: cmLook.cam.y * 100 + "%", width: cmLook.cam.w * 100 + "%", height: cmCamHeight() * 100 + "%" });
  }
  $("cmScreen").classList.toggle("dim", !crop.hidden);
}

// Dragging the boxes: the Short's crop slides left and right; the facecam box moves anywhere and grows from its corner.
function cmDrag(el, onMove) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const frame = $("cmFrame").getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, pos: cmLook.pos, cam: { ...cmLook.cam } };
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    const move = (ev) => {
      onMove((ev.clientX - start.x) / frame.width, (ev.clientY - start.y) / frame.height, start);
      cmDrawBoxes();
      cmDrawPhone();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("dragging");
      cmSaveLook();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}
cmDrag($("cmCrop"), (dx, _dy, s) => {
  const room = 1 - cmCropWidth();
  cmLook.pos = room > 0 ? Math.max(0, Math.min(1, s.pos + dx / room)) : 0.5;
});
cmDrag($("cmCam"), (dx, dy, s) => { cmLook.cam.x = s.cam.x + dx; cmLook.cam.y = s.cam.y + dy; });
cmDrag($("cmCamSize"), (dx, _dy, s) => { cmLook.cam.w = s.cam.w + dx; });

$("cmLayouts").querySelectorAll(".cm-layout").forEach((b) => b.addEventListener("click", () => {
  cmLook.layout = b.dataset.layout;
  cmSaveLook();
  drawShorts();
}));
$("cmOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  cmLook[box.dataset.key] = b.dataset.value;
  cmSaveLook();
  drawShorts();
})));

// ---------------------------------------------------------------- the phone: how the Short looks

const cmPhone = $("cmPhone");
const cmG = cmPhone.getContext("2d");
function cmDrawPhone() {
  const W = cmPhone.width, H = cmPhone.height;
  cmG.fillStyle = "#000";
  cmG.fillRect(0, 0, W, H);
  const { vw, vh } = cmSize();
  const ready = cmVideo.readyState >= 2 && cmVideo.videoWidth;
  // Draws the part (sx, sy, sw, sh) of the video so it fills (dx, dy, dw, dh), cutting off what doesn't fit.
  const fill = (sx, sy, sw, sh, dx, dy, dw, dh) => {
    const want = dw / dh;
    if (sw / sh > want) { const w = sh * want; sx += (sw - w) * 0.5; sw = w; } else { const h = sw / want; sy += (sh - h) * 0.5; sh = h; }
    cmG.drawImage(cmVideo, sx, sy, sw, sh, dx, dy, dw, dh);
  };
  if (ready) {
    if (cmLook.layout === "blur") {
      cmG.save();
      cmG.filter = "blur(10px) brightness(0.8)";
      fill(0, 0, vw, vh, -20, -20, W + 40, H + 40);
      cmG.restore();
      const h = Math.min(H, (W * vh) / vw), w = (h * vw) / vh;
      cmG.drawImage(cmVideo, 0, 0, vw, vh, (W - w) / 2, (H - h) / 2, w, h);
    } else if (cmLook.layout === "facecam") {
      const top = Math.round(H * 0.4);
      const c = cmLook.cam;
      fill(c.x * vw, c.y * vh, c.w * vw, cmCamHeight() * vh, 0, 0, W, top);
      const cw = cmCropWidth() * vw;
      fill((vw - cw) * cmLook.pos, 0, cw, vh, 0, top, W, H - top);
      cmG.fillStyle = "rgba(0,0,0,.6)";
      cmG.fillRect(0, top - 1, W, 2);
    } else {
      const cw = cmCropWidth() * vw;
      fill((vw - cw) * cmLook.pos, 0, cw, vh, 0, 0, W, H);
    }
  }
  if (cmLook.subs) {
    const y = cmLook.layout === "facecam" ? H * (0.4 + 40 / 1920) + 26 : H * (1 - 560 / 1920);
    cmG.font = `900 ${Math.round(W * 0.076)}px "Arial Black", Arial, sans-serif`;
    cmG.textAlign = "center";
    cmG.lineJoin = "round";
    cmG.lineWidth = W * 0.013;
    cmG.strokeStyle = "#000";
    cmG.fillStyle = "#fff";
    const text = cmMoments.length ? "SUBTITLES GO HERE" : "YOUR SUBTITLES";
    cmG.strokeText(text, W / 2, y);
    cmG.fillText(text, W / 2, y);
  }
}

// ---------------------------------------------------------------- making the Shorts

$("cmGo").addEventListener("click", async () => {
  const item = cmItem();
  const clips = cmMoments.filter((m) => m.on).map((m) => ({ start: m.start.toFixed(2), end: m.end.toFixed(2) }));
  if (!item || cmBusy(item) || !clips.length) return;
  const folder = await whereToSave();
  if (!folder) return;
  cmError = "";
  cmVideo.pause();
  Object.assign(item, { status: "queued", message: "Starting...", waitingFor: item.run + 1, progress: 0, made: [] });
  drawShorts();
  const options = { layout: cmLook.layout, pos: cmLook.pos, subs: !!cmLook.subs, language: cmLook.language,
                    cam: { ...cmLook.cam, h: cmCamHeight() } };
  const res = await api("/api/sh-make", { id: item.id, folder, clips, options }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) {
    delete item.waitingFor;
    item.status = "ready";
    cmError = res.error;
  }
  refresh();
});
$("cmStop").addEventListener("click", () => {
  const item = cmItem();
  if (item) api("/api/sh-cancel", { id: item.id }).then(refresh);
});
$("cmOpenFolder").addEventListener("click", () => { const item = cmItem(); if (item) api("/api/sh-show", { id: item.id }); });

function cmDrawMade(item) {
  const made = (item && item.made) || [];
  const done = made.filter((m) => m.status === "done");
  $("cmMade").hidden = !made.length;
  if (!made.length) return;
  $("cmMadeTitle").textContent = cmBusy(item) ? `Made ${done.length} of ${made.length}` : `${done.length} Short${done.length === 1 ? "" : "s"} ready`;
  $("cmOpenFolder").hidden = !done.length;
  const list = $("cmMadeList");
  const key = JSON.stringify(made.map((m) => [m.n, m.status, m.thumb]));
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = "";
  for (const m of made) {
    const card = document.createElement("div");
    card.className = "cm-short " + m.status;
    const pic = document.createElement("div");
    pic.className = "cm-short-pic";
    if (m.thumb) pic.style.backgroundImage = `url("${m.thumb}?${item.run}")`;
    else if (m.status === "active") pic.innerHTML = '<span class="spinner"></span>';
    const text = document.createElement("div");
    text.className = "cm-short-text";
    text.innerHTML = `<strong>Short ${m.n}</strong><span>${m.status === "done" ? `${Math.round(m.seconds)} s · ${sizeText(m.bytes)}${m.subs ? " · subtitles" : ""}`
      : m.status === "active" ? "Making it..." : m.status === "waiting" ? "Waiting..." : "Not made"}</span>`;
    card.append(pic, text);
    if (m.status === "done") {
      setDrag(card, { kind: "short", id: item.id, n: m.n, name: m.name });
      card.title = "Drag it out, or click to see it in its folder";
      card.onclick = () => api("/api/sh-show", { id: item.id, n: m.n });
    }
    list.append(card);
  }
}

// ---------------------------------------------------------------- drawing the tab

function drawShorts() {
  const item = cmItem();
  const has = !!(item || cmLocal);
  $("cmDrop").hidden = has;
  $("cmWork").hidden = !has;
  $("cmHow").hidden = has;
  if (!has) return;

  const name = item ? item.name : cmLocal.name;
  $("cmFileName").textContent = name;
  $("cmFileName").title = name;
  let info;
  if (cmLocal && cmLocal.error) info = cmLocal.error;
  else if (!item) info = `Getting it ready... ${Math.floor(cmLocal.percent)}% (${sizeText(cmLocal.size)})`;
  else {
    const bits = [`${item.width} × ${item.height}`];
    if (item.fps) bits.push(`${Math.round(item.fps)} fps`);
    if (item.audioTracks > 1) bits.push(`${item.audioTracks} sound tracks`);
    bits.push(clock(item.seconds, false), sizeText(item.bytes));
    info = bits.join(" · ") + (cmMixText ? " · " + cmMixText : "");
  }
  $("cmFileInfo").textContent = info;
  $("cmFileInfo").classList.toggle("error", !!(cmLocal && cmLocal.error));
  const busy = cmBusy(item);
  $("cmChange").disabled = busy;
  $("cmAddHere").disabled = !item || busy;

  // Moments
  const on = cmMoments.filter((m) => m.on).length;
  $("cmCount").textContent = cmMoments.length ? `${on} of ${cmMoments.length} picked` : "";
  $("cmFind").disabled = !item || cmFinding || busy || !item.audio;
  $("cmFindText").textContent = cmFinding ? cmFindText : cmMoments.some((m) => !m.own) ? "Find them again" : "Find the best moments";
  $("cmLengths").querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.value) === cmLength));
  $("cmFindNote").hidden = cmMoments.length > 0 && !cmError;
  $("cmFindNote").classList.toggle("error", !!cmError && !busy);
  $("cmFindNote").textContent = cmError && !busy ? cmError
    : item && !item.audio ? "This video has no sound, so add the moments yourself: play it and click + Moment here."
    : "VaultHub listens to the whole video and picks the parts that stand out: shouting, laughing, explosions, the big plays.";
  cmDrawList();
  cmDrawBlocks();

  // Look
  $("cmLayouts").querySelectorAll(".cm-layout").forEach((b) => b.classList.toggle("active", b.dataset.layout === cmLook.layout));
  $("cmOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.value === String(cmLook[box.dataset.key] ?? ""))));
  $("cmLangRow").hidden = !cmLook.subs;
  cmDrawBoxes();
  cmDrawPhone();

  // Making them
  const failed = item && item.status === "error" && !item.waitingFor && item.message !== "Stopped.";
  $("cmNote").classList.toggle("error", !!failed);
  $("cmNote").hidden = busy;
  $("cmNote").textContent = failed ? item.message
    : cmLook.subs && !cmSpeechReady
      ? `Subtitles are heard on your PC. The first time, VaultHub downloads the speech engine (${cmNvidia ? "about 4 GB with the graphics card tools" : "about 1.6 GB"}).`
      : cmLook.subs ? "Subtitles are heard on your PC, nothing is uploaded. A .srt file is saved next to each Short too."
      : "Each moment becomes its own 1080 × 1920 video with even sound.";
  $("cmProgress").hidden = !busy;
  if (busy) {
    const bar = $("cmProgress").querySelector(".bar");
    bar.classList.toggle("indeterminate", !item.progress);
    bar.firstElementChild.style.width = (item.progress || 0) + "%";
    $("cmProgressText").textContent = item.message || "Starting...";
  }
  $("cmGo").hidden = busy;
  $("cmGo").disabled = !item || !on;
  $("cmGoText").textContent = on ? `Make ${on} Short${on === 1 ? "" : "s"}` : "Pick a moment first";
  cmDrawMade(item);
  if (item && item.status === "done" && !item.waitingFor && cmSeenRun !== `${item.id}:${item.run}`) cmSeenRun = `${item.id}:${item.run}`;
}

function renderShorts(list) {
  const known = new Map(cmServer.map((f) => [f.id, f]));
  cmServer = (list || []).map((f) => {
    const mine = known.get(f.id);
    if (mine && mine.waitingFor > f.run) return { ...f, status: "queued", message: "Starting...", waitingFor: mine.waitingFor, progress: 0, made: [] };
    return f;
  });
  if (cmId && !cmItem() && !known.has(cmId)) cmId = "";
  if (cmId && !cmItem() && known.has(cmId)) cmServer.push(known.get(cmId)); // just added: not in the app's state yet
  if (!$("shortsTab").hidden || cmBusy(cmItem())) drawShorts();
}

// Leaving the page stops the video (it kept playing out of sight).
function shortsTabChanged(tab) {
  if (tab === "shorts") {
    requestAnimationFrame(() => { cmPlace(); cmDrawWave(); drawShorts(); });
    return;
  }
  if (!cmVideo.paused) cmVideo.pause();
  cmSound.pause();
}

drawShorts();
