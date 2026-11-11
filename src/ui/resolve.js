// The Resolve tab: Fix for Resolve, Subtitles (with the subtitle editor), Cut the silence, and
// project folders. Uses $, api(), clock(), openTrim(), setDrag() from app.js and showTab(),
// sizeText() from images.js. The list works like the Files tab's.

let rtTool = loadPref("rtTool") || "subtitles";
let rtOptions = { fix: "", style: "normal", language: "", model: "quick", level: "normal", pause: "0.5", cutAs: "timeline", device: "gpu" };
let rtNvidia = false; // an NVIDIA graphics card to listen on
let rtServer = []; // from the app's state
const rtUploads = []; // still being copied in, or couldn't be opened
const rtTrims = new Map();
let rtError = "";
let rtProjectPath = "";

api("/api/rt-options", {}).then((res) => {
  if (!res.ok) return;
  rtOptions = { ...rtOptions, ...res.options };
  rtNvidia = !!res.nvidia;
  drawResolve();
}).catch(() => {});

const RT_NAMES = { fix: "Fix for Resolve", subtitles: "Subtitles", silence: "Cut the silence" };
const RT_NOTES = {
  fix: (o) => o.fix === "smooth"
    ? "Makes an editing file (DNxHR) that plays smoothly even on a slow PC. Files get about 10 times bigger."
    : "A steady frame rate, sound Resolve always reads, and every sound track (game, mic, Discord) kept separate.",
  subtitles: (o) => "Listens on your PC (nothing is uploaded). Then you check the words, and VaultHub makes a timeline with your video and the subtitles for Resolve. "
    + `The first time it downloads the speech model, ${o.model === "best" ? "about 1.6 GB" : "about 480 MB"}`
    + (rtNvidia && o.device !== "cpu" ? ", plus NVIDIA's tools for your graphics card (about 1.3 GB)." : "."),
  silence: (o) => o.cutAs === "video"
    ? "Makes a new video without the quiet parts."
    : "Makes a timeline without the quiet parts. In Resolve: File › Import › Timeline. Every cut is a normal cut you can still change.",
};

// ---- adding files

function rtTakesDrop(files) {
  if ($("resolveTab").hidden) return false;
  rtAdd(files);
  return true;
}

// The same video (name and size) already in the list.
function rtHas(name, bytes) {
  return rtServer.some((f) => f.name === name && f.bytes === bytes);
}

async function rtAdd(list) {
  showTab("resolve");
  for (const file of list) {
    if (rtHas(file.name, file.size)) continue;
    const upload = { key: "u" + Math.random(), name: file.name, status: "loading", message: `Opening... (${sizeText(file.size)})` };
    upload.stop = new AbortController();
    rtUploads.push(upload);
    drawResolve();
    let res;
    try {
      res = await fetch("/api/rt-add", {
        method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file, signal: upload.stop.signal,
      }).then((r) => r.json());
    } catch (e) {
      res = { ok: false, error: "Couldn't open this file." };
    }
    const index = rtUploads.indexOf(upload);
    if (index < 0) {
      if (res.ok) api("/api/rt-remove", { id: res.file.id });
      continue;
    }
    if (res.ok) {
      rtUploads.splice(index, 1);
      rtServer.push(res.file);
    } else {
      Object.assign(upload, { status: "error", message: res.error });
    }
    drawResolve();
  }
}

let rtPicking = false;
$("rtDrop").addEventListener("click", async (e) => {
  if (e.target === $("rtFiles")) return;
  e.preventDefault();
  if (rtPicking) return;
  rtPicking = true;
  const res = await api("/api/rt-pick", {}).catch(() => ({ ok: false, fallback: true }));
  rtPicking = false;
  if (!res.ok) return res.fallback && $("rtFiles").click();
  for (const file of res.files) {
    if (rtHas(file.name, file.bytes)) api("/api/rt-remove", { id: file.id });
    else rtServer.push(file);
  }
  for (const error of res.errors) rtUploads.push({ key: "u" + Math.random(), name: "", status: "error", message: error });
  drawResolve();
});
$("rtFiles").addEventListener("change", (e) => {
  rtAdd([...e.target.files]);
  e.target.value = "";
});

// ---- options

$("rtTools").querySelectorAll(".rt-tool").forEach((b) => b.addEventListener("click", () => {
  rtTool = b.dataset.tool;
  savePref("rtTool", rtTool);
  rtError = "";
  drawResolve();
}));
$("rtOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  rtOptions[box.dataset.key] = b.dataset.value;
  rtError = "";
  drawResolve();
})));
$("rtClear").addEventListener("click", () => {
  rtUploads.splice(0);
  rtTrims.clear();
  rtServer = rtServer.filter((f) => f.status === "active" || f.status === "queued");
  api("/api/rt-clear", {}).then(refresh);
  drawResolve();
});

function rtFits(file, tool) {
  return tool === "fix" ? file.video : file.audio;
}

function rtReady() {
  return rtServer.filter((f) => f.status !== "active" && f.status !== "queued" && !f.fromResolve && rtFits(f, rtTool));
}

$("rtGo").addEventListener("click", async () => {
  const ready = rtReady();
  if (!ready.length) return;
  const items = ready.map((f) => {
    const part = rtTrims.get(f.id);
    return { id: f.id, ...(part ? { start: part.start.toFixed(2), end: part.end.toFixed(2) } : {}) };
  });
  const folder = await whereToSave();
  if (!folder) return;
  rtError = "";
  for (const f of ready) Object.assign(f, { status: "queued", message: "Waiting...", waitingFor: f.run + 1, tool: rtTool });
  drawResolve();
  const res = await api("/api/rt-convert", { items, folder, options: { ...rtOptions, tool: rtTool } })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) {
    for (const f of ready) delete f.waitingFor;
    rtError = res.error;
  }
  refresh();
});

function rtTrim(file) {
  const saved = rtTrims.get(file.id);
  openTrim({
    key: "rt:" + file.id, request: { file: file.id },
    video: file.video, title: file.name, duration: file.seconds,
    start: saved ? saved.start : 0, end: saved ? saved.end : file.seconds, maxLength: 0,
    done: (part) => {
      if (part) rtTrims.set(file.id, part); else rtTrims.delete(file.id);
      drawResolve();
    },
  });
}

// ---- the list

const RT_ICONS = {
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  resolve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 6.8 6.5v6L12 15.5l5.2-3v-6z"/><path d="M6.8 12.5 3.5 14.4v3.8L6.8 20l3.3-1.9"/><path d="M17.2 12.5l3.3 1.9v3.8L17.2 20l-3.3-1.9"/></svg>',
};

function rtRow(el, file) {
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = `
      <div class="pic"></div>
      <div class="body">
        <div class="title"></div>
        <div class="line"><span class="badge"></span><span class="msg"></span></div>
        <div class="file-trim"></div>
        <div class="bar"><div></div></div>
      </div>
      <div class="pct"></div>
      <div class="actions"></div>`;
  }
  const tool = file.status === "ready" || !file.tool ? rtTool : file.tool;
  const skipped = file.id && !file.fromResolve && file.status === "ready" && !rtFits(file, rtTool);
  el.className = "image-row file-row rt-row " + file.status + (skipped ? " skipped" : "");
  const draggable = file.status === "done" && file.canShow;
  setDrag(el, draggable ? { kind: "rt", id: file.id } : null);
  el.title = draggable ? DRAG_HINT : "";
  const pic = el.querySelector(".pic");
  const picKind = file.fromResolve ? "resolve" : file.thumb || (file.status === "loading" ? "" : "music");
  if (pic.dataset.kind !== picKind) {
    pic.dataset.kind = picKind;
    pic.innerHTML = file.thumb ? `<img alt="" src="${file.thumb}">` : picKind === "resolve" ? RT_ICONS.resolve : picKind ? FILE_ICONS.music : "";
  }
  el.querySelector(".title").textContent = file.name;
  el.querySelector(".title").title = file.name;
  const badge = el.querySelector(".badge");
  badge.hidden = !file.id;
  badge.textContent = file.fromResolve ? (file.fromResolve === "silence" ? "Cut silence in Resolve" : "Subtitles in Resolve") : RT_NAMES[tool];

  const idle = file.id && !["queued", "active"].includes(file.status);
  let message = file.message;
  if (skipped) {
    message = rtTool === "fix" ? "This has no video in it." : "This has no sound in it.";
  } else if (file.id && file.status === "ready") {
    const bits = [file.video ? `${file.width} × ${file.height}` : "Sound only"];
    if (file.fps && rtTool === "fix") bits.push(`${Math.abs(file.fps - Math.round(file.fps)) < 0.01 ? Math.round(file.fps) : file.fps.toFixed(2)} fps`);
    if (file.audioTracks > 1 && rtTool === "fix") bits.push(`${file.audioTracks} sound tracks (kept separate)`);
    bits.push(clock(file.seconds, false), sizeText(file.bytes));
    message = bits.join(" · ");
  }
  if (file.status === "done" && file.hasCues && file.timeline) {
    message = `Timeline ready: in Resolve, File › Import › Timeline, and pick "${file.timeline}".`;
  }
  el.querySelector(".msg").textContent = message;

  // Trim, or the subtitle editor
  const box = el.querySelector(".file-trim");
  const part = rtTrims.get(file.id);
  const key = file.status === "done" && file.hasCues ? "subs:" + file.timeline : file.fromResolve || skipped ? "none"
    : !idle ? (file.trimLabel ? "label:" + file.trimLabel : "") : part ? `part:${part.start}-${part.end}` : "trim";
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = "";
    if (key.startsWith("subs:")) {
      const open = document.createElement("button");
      open.className = "link";
      open.textContent = file.fromResolve ? "Check the words" : "Check and fix the subtitles";
      open.onclick = () => openSubs(file.id);
      box.append(open);
      if (file.timeline) {
        const show = document.createElement("button");
        show.className = "link";
        show.textContent = "Show timeline file";
        show.onclick = () => api("/api/rt-show", { id: file.id, timeline: true });
        box.append(show);
      }
    } else if (key.startsWith("label:")) {
      box.textContent = "Keeping " + file.trimLabel;
    } else if (key.startsWith("part:")) {
      const edit = document.createElement("button");
      edit.className = "link";
      edit.textContent = `Keeping ${clock(part.start)} to ${clock(part.end)}`;
      edit.onclick = () => rtTrim(file);
      const clear = document.createElement("button");
      clear.className = "icon-button";
      clear.title = "Don't trim";
      clear.innerHTML = RT_ICONS.remove;
      clear.onclick = () => { rtTrims.delete(file.id); drawResolve(); };
      box.append(edit, clear);
    } else if (key === "trim") {
      const button = document.createElement("button");
      button.className = "link";
      button.textContent = "Trim";
      button.onclick = () => rtTrim(file);
      box.append(button);
    }
  }

  const bar = el.querySelector(".bar");
  bar.hidden = file.status !== "active";
  bar.classList.toggle("indeterminate", !file.progress);
  bar.firstElementChild.style.width = file.progress ? file.progress + "%" : "";
  el.querySelector(".pct").textContent = file.status === "active" && file.progress ? Math.floor(file.progress) + "%" : "";

  const actions = el.querySelector(".actions");
  const wanted = file.status === "active" ? (file.cancel ? [] : ["stop"]) : file.status === "queued" && file.id ? ["stop"]
    : file.canShow && file.status === "done" ? ["folder", "remove"] : ["remove"];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    for (const kind of wanted) {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = { folder: "Show in folder", stop: "Stop" }[kind] || "Remove from list";
      b.innerHTML = RT_ICONS[kind];
      b.onclick = () => {
        if (kind === "folder") return api("/api/rt-show", { id: file.id });
        if (kind === "stop") return api("/api/rt-cancel", { id: file.id }).then(refresh);
        if (!file.id) {
          if (file.stop) file.stop.abort();
          const index = rtUploads.indexOf(file);
          if (index >= 0) rtUploads.splice(index, 1);
        } else {
          rtServer = rtServer.filter((f) => f.id !== file.id);
          rtTrims.delete(file.id);
          api("/api/rt-remove", { id: file.id }).then(refresh);
        }
        drawResolve();
      };
      actions.append(b);
    }
  }
  return el;
}

function drawResolve() {
  $("rtTools").querySelectorAll(".rt-tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === rtTool));
  const all = [...rtServer, ...rtUploads];
  const list = $("rtList");
  const rows = new Map([...list.children].map((el) => [el.dataset.key, el]));
  all.forEach((file, i) => {
    const key = file.id ? "f" + file.id : file.key;
    const el = rtRow(rows.get(key), file);
    el.dataset.key = key;
    rows.delete(key);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  for (const el of rows.values()) el.remove();

  const mine = rtServer.filter((f) => !f.fromResolve);
  $("rtDrop").classList.toggle("compact", all.length > 0);
  $("rtOptions").hidden = !mine.length;
  const show = { rtFixRow: "fix", rtStyleRow: "subtitles", rtLangRow: "subtitles", rtModelRow: "subtitles", rtDeviceRow: rtNvidia ? "subtitles" : "none", rtLevelRow: "silence", rtPauseRow: "silence", rtCutAsRow: "silence" };
  for (const [id, tool] of Object.entries(show)) $(id).hidden = rtTool !== tool;
  $("rtOptions").querySelectorAll(".chips[data-key]").forEach((box) => box.querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.value === String(rtOptions[box.dataset.key] ?? ""))));
  $("rtNote").classList.toggle("error", !!rtError);
  $("rtNote").textContent = rtError || RT_NOTES[rtTool](rtOptions);
  const ready = rtReady().length;
  const busy = rtServer.some((f) => f.status === "active" || f.status === "queued");
  $("rtGo").disabled = !ready;
  const verb = { fix: "Fix", subtitles: "Make subtitles for", silence: "Cut the silence in" }[rtTool];
  $("rtGoText").textContent = !ready && busy ? "Working..." : ready > 1 ? `${verb} ${ready} videos`
    : { fix: "Fix it", subtitles: "Make subtitles", silence: "Cut the silence" }[rtTool];
  $("rtClear").hidden = busy;
  const waiting = rtServer.filter((f) => f.fromResolve === "subtitles" && f.status === "done" && f.hasCues && !f.sent).length;
  $("resolveTabBadge").hidden = !waiting;
  $("resolveTabBadge").textContent = waiting || "";
}

// Called by app.js with the app's state a few times a second.
const rtSeen = new Set();
function renderResolve(list, projectPath) {
  const known = new Map(rtServer.map((f) => [f.id, f]));
  rtServer = (list || []).map((f) => {
    const mine = known.get(f.id);
    if (mine && mine.waitingFor > f.run) return { ...f, status: "queued", message: "Waiting...", waitingFor: mine.waitingFor };
    return f;
  });
  // Jobs from the buttons in Resolve: show them here, and open the subtitle editor when the words are ready.
  for (const f of rtServer) {
    if (!f.fromResolve) continue;
    if (!rtSeen.has(f.id)) {
      rtSeen.add(f.id);
      if (f.status === "queued" || f.status === "active") showTab("resolve");
    }
    if (f.fromResolve === "subtitles" && f.status === "done" && f.hasCues && !f.sent && !rtSeen.has("open" + f.id)) {
      rtSeen.add("open" + f.id);
      showTab("resolve");
      openSubs(f.id);
    }
  }
  for (const id of rtTrims.keys()) if (!rtServer.some((f) => f.id === id)) rtTrims.delete(id);
  if ((projectPath || "") !== rtProjectPath) {
    rtProjectPath = projectPath || "";
    loadProjects();
  }
  drawResolve();
}

// ---- project folders

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

// ---------------------------------------------------------------- the subtitle editor

const subs = { id: "", cues: [], offset: 0, saveTimer: 0, current: -1, duration: 0, peaks: null };
const subsVideo = $("subsVideo");

function subsClock(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

async function openSubs(id) {
  const res = await api("/api/rt-cues", { id }).catch(() => ({ ok: false }));
  if (!res.ok) return;
  Object.assign(subs, { id, cues: res.cues, offset: res.offset || 0, current: -1, duration: res.duration || 0, peaks: res.peaks || null,
                        fromResolve: res.fromResolve });
  $("subsSub").textContent = `${res.name} · ${res.cues.length} lines`;
  $("subsScreen").classList.toggle("no-video", !res.video);
  subsVideo.src = res.media || "";
  $("subsSend").hidden = false;
  $("subsSaved").textContent = "";
  $("subsModal").hidden = false;
  drawSubsList();
  drawSubsWave();
  subsTick();
}

function closeSubs() {
  subsVideo.pause();
  saveSubsNow();
  $("subsModal").hidden = true;
}
$("subsClose").addEventListener("click", closeSubs);
$("subsModal").addEventListener("click", (e) => { if (e.target === $("subsModal")) closeSubs(); });

// Times in the list are times in the video (trimmed videos start later than 0).
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
    row.querySelector(".subs-when").textContent = `${subsClock(cueStart(cue))} – ${subsClock(cue.end + subs.offset)}`;
    const text = row.querySelector("textarea");
    text.value = cue.text;
    text.addEventListener("input", () => { cue.text = text.value; subsChanged(); drawCaption(); });
    text.addEventListener("focus", () => { if (subsVideo.paused) seekSubs(cueStart(cue)); });
    row.querySelector(".subs-when").onclick = () => { seekSubs(cueStart(cue)); subsVideo.play().catch(() => {}); };
    row.querySelectorAll(".nudge[data-d]").forEach((b) => b.onclick = () => {
      const d = parseFloat(b.dataset.d);
      cue.start = Math.max(0, cue.start + d);
      cue.end = Math.max(cue.start + 0.2, cue.end + d);
      subsChanged(); redrawRow(row, cue); drawSubsMarks();
      seekSubs(cueStart(cue));
    });
    row.querySelector(".here").onclick = () => {
      const length = cue.end - cue.start;
      cue.start = Math.max(0, subsVideo.currentTime - subs.offset);
      cue.end = cue.start + length;
      subsChanged(); redrawRow(row, cue); drawSubsMarks();
    };
    row.querySelector(".del").onclick = () => {
      subs.cues.splice(i, 1);
      subsChanged(); drawSubsList(); drawSubsMarks();
    };
    list.append(row);
  });
  drawSubsMarks();
}

function redrawRow(row, cue) {
  row.querySelector(".subs-when").textContent = `${subsClock(cueStart(cue))} – ${subsClock(cue.end + subs.offset)}`;
}

document.querySelectorAll("#subsModal .nudge[data-all]").forEach((b) => b.addEventListener("click", () => {
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
  const res = await api("/api/rt-cues-save", { id: subs.id, cues: subs.cues }).catch(() => ({ ok: false, error: "Couldn't save." }));
  $("subsSaved").textContent = res.ok ? "Saved." : res.error;
}

$("subsShow").addEventListener("click", () => api("/api/rt-show", { id: subs.id }));
$("subsSend").addEventListener("click", async () => {
  await saveSubsNow();
  const res = await api("/api/rt-send", { id: subs.id }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) { $("subsSaved").textContent = res.error; return; }
  const note = $("subsSaved");
  note.innerHTML = "";
  const text = document.createElement("span");
  text.innerHTML = "Done! In Resolve: <b>File › Import › Timeline</b>, and pick ";
  const name = document.createElement("b");
  name.textContent = `"${res.name}"`;
  const show = document.createElement("button");
  show.className = "link";
  show.textContent = "Show it";
  show.onclick = () => api("/api/rt-show", { id: subs.id, timeline: true });
  note.append(text, name, ". ", show);
  refresh();
});

// ---- playing

function seekSubs(t) {
  if (subsVideo.src) subsVideo.currentTime = Math.max(0, t);
  subsTick();
}
$("subsPlay").addEventListener("click", () => (subsVideo.paused ? subsVideo.play().catch(() => {}) : subsVideo.pause()));
$("subsScreen").addEventListener("click", () => $("subsPlay").click());
subsVideo.addEventListener("play", () => { $("subsPlay").classList.add("playing"); subsTick(); });
subsVideo.addEventListener("pause", () => $("subsPlay").classList.remove("playing"));
document.addEventListener("keydown", (e) => {
  if ($("subsModal").hidden) return;
  if (e.key === "Escape") closeSubs();
  if (e.key === " " && !/TEXTAREA|INPUT/.test(document.activeElement.tagName)) { e.preventDefault(); $("subsPlay").click(); }
});

function drawCaption() {
  const t = subsVideo.currentTime - subs.offset;
  const i = subs.cues.findIndex((c) => t >= c.start && t < c.end);
  $("subsCaption").textContent = i >= 0 ? subs.cues[i].text : "";
  if (i !== subs.current) {
    subs.current = i;
    $("subsList").querySelectorAll(".subs-row").forEach((r) => r.classList.toggle("now", +r.dataset.i === i));
    const row = $("subsList").querySelector(`.subs-row[data-i="${i}"]`);
    if (row && !subsVideo.paused) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function subsTick() {
  const t = subsVideo.currentTime || 0;
  $("subsTime").textContent = subsClock(t);
  const length = subs.duration || subsVideo.duration || 1;
  $("subsHead").style.left = (t / length) * 100 + "%";
  drawCaption();
  if (!subsVideo.paused && !$("subsModal").hidden) requestAnimationFrame(subsTick);
}
subsVideo.addEventListener("seeked", subsTick);
subsVideo.addEventListener("loadedmetadata", () => { if (!subs.duration) subs.duration = subsVideo.duration; drawSubsMarks(); });

$("subsWave").addEventListener("click", (e) => {
  const box = $("subsWave").getBoundingClientRect();
  seekSubs(((e.clientX - box.left) / box.width) * (subs.duration || subsVideo.duration || 0));
});

function drawSubsWave() {
  const canvas = $("subsCanvas");
  const box = $("subsWave").getBoundingClientRect();
  canvas.width = Math.max(1, box.width * devicePixelRatio);
  canvas.height = Math.max(1, box.height * devicePixelRatio);
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!subs.peaks) return;
  g.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#888";
  const n = subs.peaks.length, w = canvas.width / n, mid = canvas.height / 2;
  subs.peaks.forEach((p, i) => {
    const h = Math.max(1, p * canvas.height * 0.9);
    g.fillRect(i * w, mid - h / 2, Math.max(1, w - 0.5), h);
  });
}

function drawSubsMarks() {
  const marks = $("subsMarks");
  marks.innerHTML = "";
  const length = subs.duration || subsVideo.duration;
  if (!length) return;
  for (const cue of subs.cues) {
    const m = document.createElement("div");
    m.style.left = (cueStart(cue) / length) * 100 + "%";
    m.style.width = ((cue.end - cue.start) / length) * 100 + "%";
    marks.append(m);
  }
}

drawResolve();
