// The Resolve tab: add one video, watch it, then pick Subtitles, Cut the silence or Fix for Resolve.
// Subtitles are checked and fixed right here (on the same player) before they go into Resolve.
// Project folders sit below. Uses $, api(), clock(), openTrim(), whereToSave(), refresh() from app.js
// and showTab(), sizeText() from images.js.

let rtTool = "";
let rtView = "pick"; // pick | setup | subs | done
let rtOptions = { fix: "", style: "normal", language: "", model: "best", level: "normal", pause: "0.5", cutAs: "timeline", device: "gpu", words: "", track: "auto" };
let rtNvidia = false; // an NVIDIA graphics card to listen on
let rtServer = []; // from the app's state
let rtId = ""; // the video on the tab
let rtLocal = null; // a dropped video still being copied in: {name, size, url, percent, xhr, error}
let rtPart = null; // only part of the video: {start, end}
let rtError = "";
let rtProjectPath = "";
let rtSeenRun = ""; // the finished job the tab already moved on from
const rtVideo = $("rtVideo");
// With several sound tracks (OBS: game on one, your mic on another) the window would only play the first,
// so a mix of them all plays along with the picture instead.
const rtSound = new Audio();
rtSound.preload = "auto";
let rtMixed = false;
let rtMixText = "";

api("/api/rt-options", {}).then((res) => {
  if (!res.ok) return;
  rtOptions = { ...rtOptions, ...res.options, track: "auto" };
  rtNvidia = !!res.nvidia;
  $("rtWords").value = rtOptions.words || "";
  drawResolve();
}).catch(() => {});

const RT_NAMES = { fix: "Fix for Resolve", subtitles: "Subtitles", silence: "Cut the silence" };
const RT_NOTES = {
  fix: (o) => o.fix === "smooth"
    ? "Makes an editing file (DNxHR) that plays smoothly even on a slow PC. Files get about 10 times bigger."
    : "A steady frame rate, sound Resolve always reads, and every sound track (game, mic, Discord) kept separate.",
  subtitles: (o) => "Listens on your PC, nothing is uploaded. "
    + `The first time it downloads the speech model (${o.model !== "best" ? "about 480 MB" : rtUsesGpu() ? "about 3 GB" : "about 1.6 GB"}`
    + (rtUsesGpu() ? ", plus NVIDIA's tools for your graphics card, about 1.3 GB)." : ")."),
  silence: (o) => o.cutAs === "video"
    ? "Makes a new video without the quiet parts."
    : "Makes a timeline without the quiet parts. Every cut is a normal cut you can still change in Resolve.",
};
const rtUsesGpu = () => rtNvidia && rtOptions.device !== "cpu";
const rtItem = () => rtServer.find((f) => f.id === rtId) || null;
const rtBusy = (f) => !!f && (f.status === "active" || f.status === "queued" || f.waitingFor);

// ---------------------------------------------------------------- adding the video

function rtTakesDrop(files) {
  if ($("resolveTab").hidden) return false;
  const file = [...files].find((f) => /^(video|audio)\//.test(f.type) || /\.(mkv|avi|mov|wmv|flv|webm|m4a|flac|wav|mp4)$/i.test(f.name));
  if (file) rtUse(file);
  return true;
}

// Takes the old video off the tab (unless it's still being worked on).
function rtLetGo() {
  const old = rtItem();
  if (old && !rtBusy(old)) {
    api("/api/rt-remove", { id: old.id });
    rtServer = rtServer.filter((f) => f.id !== old.id);
  }
  if (rtLocal) {
    if (rtLocal.xhr) rtLocal.xhr.abort();
    URL.revokeObjectURL(rtLocal.url);
  }
  rtLocal = null;
  rtId = "";
  rtPart = null;
  rtError = "";
  rtSeenRun = "";
  subs.cues = [];
  subs.peaks = null;
  rtVideo.removeAttribute("src");
  rtVideo.load();
  rtMixed = false;
  rtMixText = "";
  rtSound.pause();
  rtSound.removeAttribute("src");
  rtVideo.muted = false;
}

// A dropped file: it plays right away from memory while it's copied into VaultHub.
function rtUse(file) {
  showTab("resolve");
  rtLetGo();
  rtView = "pick";
  rtLocal = { name: file.name, size: file.size, url: URL.createObjectURL(file), percent: 0 };
  rtPlay(rtLocal.url);
  const xhr = new XMLHttpRequest();
  rtLocal.xhr = xhr;
  const local = rtLocal;
  xhr.open("POST", "/api/rt-add");
  xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { local.percent = (e.loaded / e.total) * 100; drawResolve(); } };
  xhr.onload = () => {
    let res;
    try { res = JSON.parse(xhr.responseText); } catch (e) { res = { ok: false, error: "Couldn't open this file." }; }
    if (rtLocal !== local) {
      if (res.ok) api("/api/rt-remove", { id: res.file.id });
      return;
    }
    if (!res.ok) { local.error = res.error; drawResolve(); return; }
    local.xhr = null;
    rtServer.push(res.file);
    rtId = res.file.id;
    rtLoadWave();
    rtLoadMix();
    if (rtVideo.dataset.broken) rtMakePreview(); // the window couldn't play it: make a copy it can
    drawResolve();
  };
  xhr.onerror = () => { if (rtLocal === local) { local.error = "Couldn't open this file."; drawResolve(); } };
  xhr.send(file);
  drawResolve();
}

// "Add a video": the Open window. The video is used where it is, so it plays at once.
let rtPicking = false;
$("rtDrop").addEventListener("click", rtPick);
$("rtChange").addEventListener("click", rtPick);
async function rtPick(e) {
  if (e && e.target === $("rtFiles")) return;
  if (e) e.preventDefault();
  if (rtPicking) return;
  rtPicking = true;
  const res = await api("/api/rt-pick", {}).catch(() => ({ ok: false, fallback: true }));
  rtPicking = false;
  if (!res.ok) return res.fallback && $("rtFiles").click();
  const [file, ...extra] = res.files;
  for (const f of extra) api("/api/rt-remove", { id: f.id });
  if (!file) {
    if (res.errors.length) { rtError = res.errors[0]; drawResolve(); }
    return;
  }
  rtLetGo();
  rtView = "pick";
  rtServer.push(file);
  rtId = file.id;
  rtPlay(`/rt-video/${file.id}`);
  rtLoadWave();
  rtLoadMix();
  drawResolve();
}
$("rtFiles").addEventListener("change", (e) => {
  if (e.target.files[0]) rtUse(e.target.files[0]);
  e.target.value = "";
});

// ---------------------------------------------------------------- playing

function rtPlay(src) {
  delete rtVideo.dataset.broken;
  rtVideo.src = src;
  rtLoading("Opening the video...");
}

function rtLoading(text) {
  $("rtLoading").hidden = !text;
  $("rtLoadingText").textContent = text || "";
}

rtVideo.addEventListener("loadeddata", () => {
  const item = rtItem();
  // Sound plays but no picture: the window can't show this kind of video.
  if (!rtVideo.videoWidth && (item ? item.video : rtLocal && /^video|\.(mkv|mov|avi|mp4)$/i.test(rtLocal.name))) return rtCantPlay();
  rtLoading("");
  rtTick();
});
rtVideo.addEventListener("error", () => { if (rtVideo.getAttribute("src")) rtCantPlay(); });

function rtCantPlay() {
  if (rtVideo.dataset.broken) return;
  rtVideo.dataset.broken = "1";
  if (rtId) rtMakePreview();
  else rtLoading("Getting the video ready...");
}

// The window can't play this one (some MKV, ProRes or 10-bit videos): VaultHub makes a copy it can.
async function rtMakePreview() {
  const id = rtId;
  while (id === rtId) {
    const res = await api("/api/rt-preview", { id }).catch(() => ({ ok: false }));
    if (id !== rtId) return;
    if (!res.ok || res.error) return rtLoading(res.error || "Couldn't show this video, but the tools still work on it.");
    if (res.ready) {
      const at = rtVideo.currentTime || 0;
      rtVideo.src = `/rt-video/${id}/copy`;
      rtVideo.currentTime = at;
      return;
    }
    rtLoading(`Getting the video ready... ${Math.floor(res.progress || 0)}%`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function rtLoadMix() {
  const item = rtItem();
  if (!item || (item.audioTracks || 0) < 2) return;
  const id = rtId;
  while (id === rtId) {
    const res = await api("/api/rt-mix", { id }).catch(() => ({ ok: false }));
    if (id !== rtId) return;
    if (!res.ok || res.error) { rtMixText = ""; drawResolve(); return; }
    if (res.ready) {
      rtSound.src = `/rt-video/${id}/mix`;
      rtMixed = true;
      rtVideo.muted = true;
      rtMixText = "";
      rtSyncSound(true);
      drawResolve();
      return;
    }
    rtMixText = `Adding your other sound tracks... ${Math.floor(res.progress || 0)}%`;
    drawResolve();
    await new Promise((r) => setTimeout(r, 700));
  }
}

function rtSyncSound(force) {
  if (!rtMixed) return;
  if (force || Math.abs(rtSound.currentTime - rtVideo.currentTime) > 0.25) rtSound.currentTime = rtVideo.currentTime;
  rtSound.playbackRate = rtVideo.playbackRate;
  if (rtVideo.paused) rtSound.pause();
  else rtSound.play().catch(() => {});
}
for (const ev of ["play", "pause", "seeked", "ratechange", "waiting", "playing"]) rtVideo.addEventListener(ev, () => rtSyncSound(ev !== "pause"));

async function rtLoadWave() {
  const id = rtId;
  const res = await api("/api/rt-wave", { id }).catch(() => ({ ok: false }));
  if (id !== rtId || !res.ok) return;
  subs.peaks = res.peaks;
  drawSubsWave();
}

function subsClock(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

function seekSubs(t) {
  if (rtVideo.getAttribute("src")) rtVideo.currentTime = Math.max(0, t);
  rtTick();
}
$("rtPlay").addEventListener("click", () => (rtVideo.paused ? rtVideo.play().catch(() => {}) : rtVideo.pause()));
$("rtScreen").addEventListener("click", () => $("rtPlay").click());
rtVideo.addEventListener("play", () => { $("rtPlay").classList.add("playing"); rtTick(); });
rtVideo.addEventListener("pause", () => $("rtPlay").classList.remove("playing"));
rtVideo.addEventListener("seeked", rtTick);
rtVideo.addEventListener("loadedmetadata", () => drawSubsMarks());
document.addEventListener("keydown", (e) => {
  if ($("resolveTab").hidden || $("rtWork").hidden) return;
  if (e.key === " " && !/TEXTAREA|INPUT|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $("rtPlay").click(); }
});

function rtLength() {
  const item = rtItem();
  return (item && item.seconds) || rtVideo.duration || 0;
}

function rtTick() {
  const t = rtVideo.currentTime || 0;
  $("rtTime").textContent = subsClock(t);
  const length = rtLength() || 1;
  $("rtHead").style.left = Math.min(100, (t / length) * 100) + "%";
  drawCaption();
  rtSyncSound(false);
  if (!rtVideo.paused && !$("resolveTab").hidden) requestAnimationFrame(rtTick);
}

$("rtWave").addEventListener("click", (e) => {
  const box = $("rtWave").getBoundingClientRect();
  seekSubs(((e.clientX - box.left) / box.width) * rtLength());
});
window.addEventListener("resize", () => { if (!$("rtWork").hidden) drawSubsWave(); });

function drawSubsWave() {
  const canvas = $("rtCanvas");
  const box = $("rtWave").getBoundingClientRect();
  canvas.width = Math.max(1, box.width * devicePixelRatio);
  canvas.height = Math.max(1, box.height * devicePixelRatio);
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!subs.peaks || !subs.peaks.length) return;
  g.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#888";
  const n = subs.peaks.length, w = canvas.width / n, mid = canvas.height / 2;
  subs.peaks.forEach((p, i) => {
    const h = Math.max(1, p * canvas.height * 0.9);
    g.fillRect(i * w, mid - h / 2, Math.max(1, w - 0.5), h);
  });
}

// ---------------------------------------------------------------- picking a tool

$("rtTools").querySelectorAll(".rt-tool").forEach((b) => b.addEventListener("click", () => {
  rtTool = b.dataset.tool;
  rtError = "";
  const item = rtItem();
  // Subtitles already made for this video: straight back to checking them.
  rtView = rtTool === "subtitles" && item && item.hasCues && item.tool === "subtitles" && !rtBusy(item) ? "subs" : "setup";
  if (rtView === "subs") openSubs();
  drawResolve();
}));
$("rtBack").addEventListener("click", () => { rtView = "pick"; drawResolve(); });
$("rtSubsBack").addEventListener("click", () => { saveSubsNow(); rtView = "pick"; drawResolve(); });
$("rtDoneBack").addEventListener("click", () => { rtView = "pick"; drawResolve(); });
$("rtOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  rtOptions[box.dataset.key] = b.dataset.value;
  rtError = "";
  drawResolve();
})));
$("rtWords").addEventListener("input", () => { rtOptions.words = $("rtWords").value; });

function rtFits(item, tool) {
  return tool === "fix" ? item.video : item.audio;
}

$("rtGo").addEventListener("click", async () => {
  const item = rtItem();
  if (!item || rtBusy(item) || !rtFits(item, rtTool)) return;
  const folder = await whereToSave();
  if (!folder) return;
  rtError = "";
  Object.assign(item, { status: "queued", message: "Starting...", waitingFor: item.run + 1, tool: rtTool, progress: 0 });
  drawResolve();
  const pick = { id: item.id, ...(rtPart ? { start: rtPart.start.toFixed(2), end: rtPart.end.toFixed(2) } : {}) };
  const res = await api("/api/rt-convert", { items: [pick], folder, options: { ...rtOptions, tool: rtTool } })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) {
    delete item.waitingFor;
    item.status = "ready";
    rtError = res.error;
  }
  refresh();
});
$("rtStop").addEventListener("click", () => {
  const item = rtItem();
  if (item) api("/api/rt-cancel", { id: item.id }).then(refresh);
});

function rtTrim() {
  const item = rtItem();
  if (!item) return;
  rtVideo.pause();
  openTrim({
    key: "rt:" + item.id, request: { file: item.id },
    video: item.video, title: item.name, duration: item.seconds,
    start: rtPart ? rtPart.start : 0, end: rtPart ? rtPart.end : item.seconds, maxLength: 0,
    done: (part) => { rtPart = part || null; drawResolve(); },
  });
}

// ---------------------------------------------------------------- drawing the tab

function rtShow(view) {
  for (const [id, name] of [["rtPick", "pick"], ["rtSetup", "setup"], ["rtSubs", "subs"], ["rtDone", "done"]]) $(id).hidden = view !== name;
}

function drawResolve() {
  const item = rtItem();
  const has = !!(item || rtLocal);
  $("rtDrop").hidden = has;
  $("rtWork").hidden = !has;
  $("rtInResolve").hidden = has;
  const waiting = rtServer.filter((f) => f.tool === "subtitles" && f.status === "done" && f.hasCues && !f.sent).length;
  $("resolveTabBadge").hidden = !waiting;
  $("resolveTabBadge").textContent = waiting || "";
  if (!has) {
    rtShow("");
    return;
  }

  // The video's name and what's in it
  const name = item ? item.name : rtLocal.name;
  $("rtFileName").textContent = name;
  $("rtFileName").title = name;
  let info;
  if (rtLocal && rtLocal.error) info = rtLocal.error;
  else if (!item) info = `Getting it ready for the tools... ${Math.floor(rtLocal.percent)}% (${sizeText(rtLocal.size)})`;
  else {
    const bits = [item.video ? `${item.width} × ${item.height}` : "Sound only"];
    if (item.fps) bits.push(`${Math.abs(item.fps - Math.round(item.fps)) < 0.01 ? Math.round(item.fps) : item.fps.toFixed(2)} fps`);
    if (item.audioTracks > 1) bits.push(`${item.audioTracks} sound tracks`);
    bits.push(clock(item.seconds, false), sizeText(item.bytes));
    info = bits.join(" · ") + (rtMixText ? " · " + rtMixText : "");
  }
  $("rtFileInfo").textContent = info;
  $("rtFileInfo").classList.toggle("error", !!(rtLocal && rtLocal.error));
  $("rtScreen").classList.toggle("no-video", !!item && !item.video);
  $("rtChange").disabled = rtBusy(item);

  // A job finished: move on to checking the subtitles, or to the result.
  if (item && item.status === "done" && !item.waitingFor && rtSeenRun !== `${item.id}:${item.run}`) {
    rtSeenRun = `${item.id}:${item.run}`;
    rtTool = item.tool;
    if (item.tool === "subtitles" && item.hasCues) { rtView = "subs"; openSubs(); }
    else rtView = "done";
  }
  if (item && rtBusy(item)) { rtView = "setup"; rtTool = item.tool || rtTool; }
  rtShow(rtView);

  $("rtTools").querySelectorAll(".rt-tool").forEach((b) => {
    const ok = !item || rtFits(item, b.dataset.tool);
    b.disabled = !ok;
    b.title = ok ? "" : b.dataset.tool === "fix" ? "This has no video in it." : "This has no sound in it.";
  });

  if (rtView === "setup") drawSetup(item);
  if (rtView === "done") drawDone(item);
  if (rtView === "subs") $("rtSubsCount").textContent = subs.cues.length ? `${subs.cues.length} lines` : "";
  if (rtDrawnView !== rtView) {
    rtDrawnView = rtView;
    subs.current = -2;
    drawCaption();
    drawSubsMarks();
  }
}
let rtDrawnView = "";

function drawSetup(item) {
  $("rtSetupTitle").textContent = RT_NAMES[rtTool] || "";
  const rows = { rtFixRow: "fix", rtStyleRow: "subtitles", rtLangRow: "subtitles", rtModelRow: "subtitles", rtWordsRow: "subtitles",
                 rtDeviceRow: rtNvidia ? "subtitles" : "none", rtLevelRow: "silence", rtPauseRow: "silence", rtCutAsRow: "silence" };
  for (const [id, tool] of Object.entries(rows)) $(id).hidden = rtTool !== tool;
  // Which sound track to listen to, when there are several (OBS often puts your mic on its own).
  const tracks = item ? item.audioTracks || 0 : 0;
  $("rtTrackRow").hidden = rtTool !== "subtitles" || tracks < 2;
  const chips = $("rtTrackChips");
  if (chips.dataset.n !== String(tracks)) {
    chips.dataset.n = tracks;
    chips.innerHTML = "";
    const choices = [["auto", "Find my voice by itself"], ["all", "All together"]];
    for (let i = 0; i < tracks; i++) choices.push([String(i), `Track ${i + 1}`]);
    for (const [value, label] of choices) {
      const b = document.createElement("button");
      b.dataset.value = value;
      b.textContent = label;
      b.onclick = () => { rtOptions.track = value; drawResolve(); };
      chips.append(b);
    }
  }
  chips.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === rtOptions.track));
  $("rtOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.value === String(rtOptions[box.dataset.key] ?? ""))));

  const busy = rtBusy(item);
  const failed = item && item.status === "error" && !item.waitingFor && item.tool === rtTool && item.message !== "Stopped.";
  $("rtNote").classList.toggle("error", !!(rtError || failed));
  $("rtNote").textContent = rtError || (failed ? item.message : RT_NOTES[rtTool] ? RT_NOTES[rtTool](rtOptions) : "");
  $("rtNote").hidden = busy;

  // Only part of the video
  const part = $("rtPart");
  const key = busy || !item ? "none" : rtPart ? `${rtPart.start}-${rtPart.end}` : "all";
  if (part.dataset.key !== key) {
    part.dataset.key = key;
    part.innerHTML = "";
    if (key !== "none") {
      const edit = document.createElement("button");
      edit.className = "link";
      edit.textContent = rtPart ? `Only ${clock(rtPart.start)} to ${clock(rtPart.end)} (change)` : "Use only a part of the video";
      edit.onclick = rtTrim;
      part.append(edit);
      if (rtPart) {
        const all = document.createElement("button");
        all.className = "link";
        all.textContent = "Use all of it";
        all.onclick = () => { rtPart = null; drawResolve(); };
        part.append(all);
      }
    }
  }

  $("rtProgress").hidden = !busy;
  if (busy) {
    const bar = $("rtProgress").querySelector(".bar");
    bar.classList.toggle("indeterminate", !item.progress);
    bar.firstElementChild.style.width = item.progress ? item.progress + "%" : "";
    $("rtProgressText").textContent = item.message || "Working...";
    $("rtStop").hidden = !!item.cancel;
  }
  $("rtGo").hidden = busy;
  $("rtGo").disabled = !item;
  $("rtGoText").textContent = !item ? "Getting it ready..." : { fix: "Fix it", subtitles: "Make subtitles", silence: "Cut the silence" }[rtTool] || "Start";
}

function drawDone(item) {
  if (!item) return;
  const timeline = item.outName && item.outName.endsWith(".fcpxml");
  $("rtDoneTitle").textContent = item.status === "done" ? (item.tool === "fix" ? "Ready for Resolve" : "The quiet parts are out") : "";
  $("rtDoneText").innerHTML = "";
  const text = document.createElement("span");
  if (item.tool === "fix") text.innerHTML = "Drag the file below straight into Resolve's <b>Media Pool</b>.";
  else if (timeline) text.innerHTML = "In Resolve: <b>File › Import › Timeline</b>, and pick the file below. Every cut can still be changed.";
  else text.innerHTML = "Drag the new video below into Resolve.";
  const how = document.createElement("div");
  how.className = "rt-small";
  how.textContent = (item.message || "").split(" · In Resolve")[0];
  $("rtDoneText").append(text, how);
  const file = $("rtDoneFile");
  file.textContent = item.outName || "";
  setDrag(file, item.canShow && !timeline ? { kind: "rt", id: item.id } : null);
  file.title = item.canShow && !timeline ? DRAG_HINT : "";
}
$("rtDoneShow").addEventListener("click", () => { if (rtId) api("/api/rt-show", { id: rtId }); });

// Called by app.js with the app's state a few times a second.
function renderResolve(list, projectPath) {
  const known = new Map(rtServer.map((f) => [f.id, f]));
  rtServer = (list || []).map((f) => {
    const mine = known.get(f.id);
    if (mine && mine.waitingFor > f.run) return { ...f, status: "queued", message: "Starting...", waitingFor: mine.waitingFor, progress: 0 };
    return f;
  });
  if (rtId && !rtItem() && !known.has(rtId)) rtId = "";
  if (rtId && !rtItem() && known.has(rtId)) rtServer.push(known.get(rtId)); // just added: not in the app's state yet
  if ((projectPath || "") !== rtProjectPath) {
    rtProjectPath = projectPath || "";
    loadProjects();
  }
  drawResolve();
}

// ---------------------------------------------------------------- project folders

async function loadProjects() {
  const res = await api("/api/project-list", {}).catch(() => null);
  if (!res || !res.ok) return;
  const on = !!res.project;
  $("rtProjectOn").hidden = !on;
  $("rtProjectNone").hidden = on;
  $("rtProjectSome").hidden = !on;
  $("rtProject").classList.toggle("on", on);
  if (on) {
    $("rtProjectTitle").textContent = res.project.split(/[\\/]/).pop();
    $("rtProjectPath").textContent = res.project;
    $("rtFolders").innerHTML = "";
    for (const name of res.folders) {
      const chip = document.createElement("span");
      chip.textContent = name;
      $("rtFolders").append(chip);
    }
  }
  const others = res.projects.filter((p) => p.path !== res.project);
  $("rtRecent").innerHTML = "";
  if (others.length) {
    const label = document.createElement("span");
    label.className = "rt-recent-label";
    label.textContent = on ? "Switch to" : "Earlier projects";
    $("rtRecent").append(label);
    for (const p of others.slice(0, 5)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rt-recent-chip";
      b.textContent = p.name;
      b.title = p.path;
      b.onclick = () => api("/api/project-use", { path: p.path }).then(refresh);
      $("rtRecent").append(b);
    }
  }
}

function projectError(text) {
  $("rtProjectError").hidden = !text;
  $("rtProjectError").textContent = text || "";
}

$("rtProjectMake").addEventListener("click", async () => {
  projectError("");
  const name = $("rtProjectName").value.trim();
  if (!name) return projectError("Give the project a name first.");
  const res = await api("/api/project-make", { name }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (res.cancelled) return;
  if (!res.ok) return projectError(res.error);
  $("rtProjectName").value = "";
  refresh();
});
$("rtProjectName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("rtProjectMake").click(); });
$("rtProjectOpen").addEventListener("click", () => api("/api/project-open", {}));
$("rtProjectOff").addEventListener("click", () => api("/api/project-use", { path: "" }).then(refresh));
$("rtProjectAnother").addEventListener("click", () => {
  $("rtProjectNone").hidden = false;
  $("rtProjectSome").hidden = true;
  $("rtProjectName").focus();
});
loadProjects();

// ---------------------------------------------------------------- checking the subtitles

const subs = { cues: [], offset: 0, saveTimer: 0, current: -1, peaks: null };

async function openSubs() {
  const id = rtId;
  const res = await api("/api/rt-cues", { id }).catch(() => ({ ok: false }));
  if (!res.ok || id !== rtId) return;
  Object.assign(subs, { cues: res.cues, offset: res.offset || 0, current: -1 });
  $("subsSaved").textContent = res.sent ? "" : "";
  drawSubsList();
  rtVideo.pause();
  seekSubs(subs.cues.length ? cueStart(subs.cues[0]) : 0);
  drawResolve();
}

// Times in the list are times in the video (a part of a video starts later than 0).
const cueStart = (c) => c.start + subs.offset;

function drawSubsList() {
  const list = $("subsList");
  list.innerHTML = "";
  subs.cues.forEach((cue, i) => {
    const row = document.createElement("div");
    row.className = "subs-row";
    row.dataset.i = i;
    row.innerHTML = `
      <div class="subs-row-top">
        <button type="button" class="subs-when" title="Play from here"></button>
        <span class="spacer"></span>
        <button type="button" class="nudge" data-d="-0.1" title="Show it 0.1 second earlier">◀</button>
        <button type="button" class="nudge" data-d="0.1" title="Show it 0.1 second later">▶</button>
        <button type="button" class="nudge here" title="Start this line where the video is now">Start here</button>
        <button type="button" class="nudge del" title="Delete this line">✕</button>
      </div>
      <textarea rows="2" spellcheck="true"></textarea>`;
    redrawRow(row, cue);
    const text = row.querySelector("textarea");
    text.value = cue.text;
    text.addEventListener("input", () => { cue.text = text.value; subsChanged(); drawCaption(); });
    text.addEventListener("focus", () => { if (rtVideo.paused) seekSubs(cueStart(cue)); });
    row.querySelector(".subs-when").onclick = () => { seekSubs(cueStart(cue)); rtVideo.play().catch(() => {}); };
    row.querySelectorAll(".nudge[data-d]").forEach((b) => b.onclick = () => {
      const d = parseFloat(b.dataset.d);
      cue.start = Math.max(0, cue.start + d);
      cue.end = Math.max(cue.start + 0.2, cue.end + d);
      subsChanged(); redrawRow(row, cue); drawSubsMarks();
      seekSubs(cueStart(cue));
    });
    row.querySelector(".here").onclick = () => {
      const length = cue.end - cue.start;
      cue.start = Math.max(0, rtVideo.currentTime - subs.offset);
      cue.end = cue.start + length;
      subsChanged(); redrawRow(row, cue); drawSubsMarks();
    };
    row.querySelector(".del").onclick = () => {
      subs.cues.splice(i, 1);
      subsChanged(); drawSubsList(); drawResolve();
    };
    list.append(row);
  });
  drawSubsMarks();
  subs.current = -2;
  drawCaption();
}

function redrawRow(row, cue) {
  row.querySelector(".subs-when").textContent = `${subsClock(cueStart(cue))} – ${subsClock(cue.end + subs.offset)}`;
}

document.querySelectorAll("#rtSubs .nudge[data-all]").forEach((b) => b.addEventListener("click", () => {
  const d = parseFloat(b.dataset.all);
  for (const cue of subs.cues) {
    cue.start = Math.max(0, cue.start + d);
    cue.end = Math.max(cue.start + 0.2, cue.end + d);
  }
  subsChanged();
  drawSubsList();
}));

function subsChanged() {
  $("subsSaved").textContent = "Saving...";
  clearTimeout(subs.saveTimer);
  subs.saveTimer = setTimeout(saveSubsNow, 600);
}

async function saveSubsNow() {
  if (!subs.saveTimer) return;
  clearTimeout(subs.saveTimer);
  subs.saveTimer = 0;
  const res = await api("/api/rt-cues-save", { id: rtId, cues: subs.cues }).catch(() => ({ ok: false, error: "Couldn't save." }));
  $("subsSaved").textContent = res.ok ? "Saved." : res.error;
}

async function rtSend(old) {
  await saveSubsNow();
  const res = await api("/api/rt-send", { id: rtId, old }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  const note = $("subsSaved");
  if (!res.ok) { note.textContent = res.error; return; }
  note.innerHTML = "";
  const text = document.createElement("span");
  text.innerHTML = "Done! In Resolve: <b>File › Import › Timeline</b>, and pick ";
  const name = document.createElement("b");
  name.textContent = `"${res.name}"`;
  const show = document.createElement("button");
  show.className = "link";
  show.textContent = "Show it";
  show.onclick = () => api("/api/rt-show", { id: rtId, timeline: true });
  note.append(text, name, ". ", show);
  if (old) {
    const tip = document.createElement("div");
    tip.innerHTML = "To get Text+ from it: right-click the subtitle track's name (ST1) › <b>Convert Subtitles to Text+</b>.";
    note.append(tip);
  }
  refresh();
}
$("subsSend").addEventListener("click", () => rtSend(false));
$("subsOld").addEventListener("click", () => rtSend(true));

function drawCaption() {
  const t = rtVideo.currentTime - subs.offset;
  const on = rtView === "subs";
  const i = on ? subs.cues.findIndex((c) => t >= c.start && t < c.end) : -1;
  $("rtCaption").textContent = i >= 0 ? subs.cues[i].text : "";
  if (i !== subs.current) {
    subs.current = i;
    $("subsList").querySelectorAll(".subs-row").forEach((r) => r.classList.toggle("now", +r.dataset.i === i));
    const row = $("subsList").querySelector(`.subs-row[data-i="${i}"]`);
    if (row && !rtVideo.paused) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function drawSubsMarks() {
  const marks = $("rtMarks");
  marks.innerHTML = "";
  const length = rtLength();
  if (!length || rtView !== "subs") return;
  for (const cue of subs.cues) {
    const m = document.createElement("div");
    m.style.left = (cueStart(cue) / length) * 100 + "%";
    m.style.width = ((cue.end - cue.start) / length) * 100 + "%";
    marks.append(m);
  }
}

drawResolve();
