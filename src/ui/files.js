// The Files tab: videos and songs from the PC, converted to another format,
// made smaller, or turned into a GIF. Uses $, api(), clock(), openTrim()
// from app.js and showTab(), sizeText() from images.js.

const FILE_QUALITIES = {
  mp3: [["320", "320 kbps"], ["256", "256 kbps"], ["192", "192 kbps"], ["128", "128 kbps"]],
  m4a: [["256", "256 kbps"], ["192", "192 kbps"], ["128", "128 kbps"]],
  mp4: [["", "Same as now"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"]],
  gif: [["320", "320 px"], ["480", "480 px"], ["640", "640 px"], ["800", "800 px"]],
};
const FILE_DEFAULTS = { mp3: "320", m4a: "256", mp4: "", gif: "480" };

let fileOptions = { format: "mp3", quality: { ...FILE_DEFAULTS }, fit: "", fitCustom: "", normalize: false };
try {
  const saved = loadPref("fileOptions") || {};
  fileOptions = { ...fileOptions, ...saved, quality: { ...FILE_DEFAULTS, ...(saved.quality || {}) } };
} catch (e) { /* nothing saved */ }

let serverFiles = []; // from the app's state
const uploads = []; // files still being copied into the app, or that couldn't be opened
const fileTrims = new Map(); // file id -> {start, end}
let fileError = ""; // shown under the options until they're changed

function saveFileOptions() {
  fileError = "";
  savePref("fileOptions", fileOptions);
}

// ---- adding files

// list: File objects, or {file, folder} for files from a dropped folder ("Holiday/day 2"), which
// keep that folder inside the save folder.
async function addMediaFiles(list) {
  showTab("files");
  for (const entry of list) {
    const file = entry instanceof File ? entry : entry.file;
    const folder = entry instanceof File ? "" : entry.folder || "";
    const upload = { key: "u" + Math.random(), name: file.name, sub: folder, status: "loading", message: `Opening... (${sizeText(file.size)})` };
    upload.stop = new AbortController(); // the remove button stops the copying
    uploads.push(upload);
    drawFiles();
    let res;
    try {
      res = await fetch("/api/file-add", {
        method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name), "X-File-Folder": encodeURIComponent(folder) },
        body: file, signal: upload.stop.signal,
      }).then((r) => r.json());
    } catch (e) {
      res = { ok: false, error: "Couldn't open this file." };
    }
    const index = uploads.indexOf(upload);
    if (index < 0) {
      // removed while it was being copied
      if (res.ok) api("/api/file-remove", { id: res.file.id });
      continue;
    }
    if (res.ok) {
      uploads.splice(index, 1);
      serverFiles.push(res.file);
    } else {
      Object.assign(upload, { status: "error", message: res.error });
    }
    drawFiles();
  }
}

// "choose files" opens the Windows Open window, which lets the app read the
// files where they are instead of copying them first. (Dropped files have to be copied.)
let picking = false;
$("fileDrop").addEventListener("click", async (e) => {
  if (e.target === $("mediaFiles")) return;
  e.preventDefault();
  if (picking) return;
  picking = true;
  const res = await api("/api/files-pick", {}).catch(() => ({ ok: false, fallback: true }));
  picking = false;
  if (!res.ok) return res.fallback && $("mediaFiles").click();
  for (const file of res.files) serverFiles.push(file);
  for (const error of res.errors) uploads.push({ key: "u" + Math.random(), name: "", status: "error", message: error });
  drawFiles();
});

// A whole folder: the app looks through it (and its subfolders) and uses the files where they are.
$("fileFolderPick").addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (picking) return;
  picking = true;
  const res = await api("/api/files-pick-folder", {}).catch(() => ({ ok: false }));
  picking = false;
  if (res.error) uploads.push({ key: "u" + Math.random(), name: "", status: "error", message: res.error });
  refresh();
  drawFiles();
});

// What's in a dropped folder (and the folders in it): [{file, folder}] with folder like "Holiday/day 2".
// Has to be started inside the drop event (the entries are gone after it).
const MEDIA_RE = /\.(mp4|mkv|mov|avi|wmv|flv|webm|m4v|mpg|mpeg|3gp|ts|mts|m2ts|mp3|m4a|wav|flac|ogg|opus|wma|aac|aiff?|amr)$/i;
function droppedFolders(dataTransfer) {
  const entries = [...(dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.some((e) => e.isDirectory)) return null;
  const readAll = (dir) => new Promise((done) => {
    const reader = dir.createReader(), all = [];
    const more = () => reader.readEntries((got) => { if (!got.length) return done(all); all.push(...got); more(); }, () => done(all));
    more();
  });
  const walk = async (entry, folder, out) => {
    if (out.length >= 2000) return;
    if (entry.isFile) {
      const file = await new Promise((ok) => entry.file(ok, () => ok(null)));
      if (file) out.push({ file, folder });
    } else if (entry.isDirectory && !entry.name.startsWith(".")) {
      const inside = (await readAll(entry)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const child of inside) await walk(child, folder ? folder + "/" + entry.name : entry.name, out);
    }
  };
  return (async () => {
    const out = [];
    for (const entry of entries) await walk(entry, "", out);
    return out;
  })();
}

$("mediaFiles").addEventListener("change", (e) => {
  addMediaFiles([...e.target.files]);
  e.target.value = "";
});

// ---- options

$("fileFormat").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  fileOptions.format = b.dataset.value;
  saveFileOptions();
  drawFiles();
}));
$("fileFit").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  fileOptions.fit = b.dataset.value;
  saveFileOptions();
  drawFiles();
}));
$("fileFitCustom").addEventListener("input", () => {
  $("fileFitCustom").value = $("fileFitCustom").value.replace(/[^\d.]/g, "").slice(0, 6);
  fileOptions.fitCustom = $("fileFitCustom").value;
  saveFileOptions();
  drawFiles();
});
$("fileNormalize").addEventListener("click", () => {
  fileOptions.normalize = !fileOptions.normalize;
  saveFileOptions();
  drawFiles();
});
$("fileClear").addEventListener("click", () => {
  uploads.splice(0);
  fileTrims.clear();
  serverFiles = serverFiles.filter((f) => f.status === "active" || f.status === "queued");
  api("/api/files-clear", {}).then(refresh);
  drawFiles();
});

function targetMb() {
  if (fileOptions.format !== "mp4") return null;
  const value = fileOptions.fit === "custom" ? parseFloat(fileOptions.fitCustom) : parseFloat(fileOptions.fit);
  return value > 0 ? value : null;
}

// ---- trimming one file

function trimFile(file) {
  const gif = fileOptions.format === "gif";
  const saved = fileTrims.get(file.id);
  openTrim({
    key: "file:" + file.id, request: { file: file.id },
    video: file.video && (["mp4", "gif"].includes(fileOptions.format) || !file.audio),
    title: file.name, duration: file.seconds,
    start: saved ? saved.start : 0,
    end: saved ? saved.end : gif ? Math.min(10, file.seconds) : file.seconds,
    maxLength: gif ? 60 : 0,
    clip: () => ({ source: { file: file.id }, title: file.name.replace(/\.[^.]+$/, ""), format: fileOptions.format,
                   quality: fileOptions.quality[fileOptions.format] ?? "", targetMb: targetMb(), normalize: fileOptions.normalize }),
    done: (part) => {
      if (part) fileTrims.set(file.id, part); else fileTrims.delete(file.id);
      drawFiles();
    },
  });
}

// ---- converting

// Files that can become the picked format (a song can't become an MP4).
function fits(file, fmt) {
  return ["mp4", "gif"].includes(fmt) ? file.video : file.audio;
}

// The choices a file would be converted with now. A file already made with exactly these
// is left out of Convert (clicking it again would only make "name (2)").
function fileSig(file) {
  const fmt = fileOptions.format, part = fileTrims.get(file.id);
  return JSON.stringify([fmt, fileOptions.quality[fmt] ?? "", targetMb(), fmt !== "gif" && !!fileOptions.normalize,
    part ? [part.start.toFixed(2), part.end.toFixed(2)] : null]);
}
const madeAlready = (file) => file.status === "done" && !!file.doneAs && file.doneAs === fileSig(file);

function readyFiles() {
  // (Files from a watched folder already use that folder's own choices.)
  return serverFiles.filter((f) => !f.watch && f.status !== "active" && f.status !== "queued" && fits(f, fileOptions.format) && !madeAlready(f));
}

$("fileConvert").addEventListener("click", async () => {
  const ready = readyFiles();
  if (!ready.length) return;
  const items = ready.map((f) => {
    const part = fileTrims.get(f.id);
    return { id: f.id, sig: fileSig(f), ...(part ? { start: part.start.toFixed(2), end: part.end.toFixed(2) } : {}) };
  });
  const fmt = fileOptions.format;
  if (fmt === "mp4" && fileOptions.fit === "custom" && !(targetMb() >= 0.5 && targetMb() <= 4000)) {
    fileError = "Type a size between 0.5 and 4000 MB.";
    return drawFiles();
  }
  const folder = await whereToSave();
  if (!folder) return;
  // Shown as "Waiting..." until the app says this conversion (its next run) has started.
  fileError = "";
  for (const f of ready) Object.assign(f, { status: "queued", message: "Waiting...", waitingFor: f.run + 1 });
  drawFiles();
  const res = await api("/api/files-convert", {
    items, folder,
    options: { format: fmt, quality: fileOptions.quality[fmt] ?? "", targetMb: targetMb(), normalize: fileOptions.normalize },
  }).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (!res.ok) {
    for (const f of ready) delete f.waitingFor;
    fileError = res.error;
  }
  refresh();
});

// ---- drawing

const FILE_ICONS = {
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

function fileRow(el, file) {
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = `
      <div class="pic"></div>
      <div class="body">
        <div class="title"></div>
        <div class="line"><span class="badge"></span><span class="file-from" hidden></span><span class="msg"></span></div>
        <div class="file-trim"></div>
        <div class="bar"><div></div></div>
      </div>
      <div class="pct"></div>
      <div class="actions"></div>`;
  }
  // Finished, but the choices changed since: it looks ready to convert again (not "Saved as" the old one).
  const madeOther = file.status === "done" && !file.watch && !madeAlready(file);
  el.className = "image-row file-row " + (madeOther ? "ready" : file.status) + (file.id && !file.watch && !fits(file, fileOptions.format) ? " skipped" : "");
  const draggable = file.status === "done" && file.canShow;
  setDrag(el, draggable ? { kind: "file", id: file.id } : null);
  el.title = draggable ? DRAG_HINT : "";
  const pic = el.querySelector(".pic");
  const picKind = file.thumb || (file.status === "loading" ? "" : "music");
  if (pic.dataset.kind !== picKind) {
    pic.dataset.kind = picKind;
    pic.innerHTML = file.thumb ? `<img alt="" src="${file.thumb}">` : picKind ? FILE_ICONS.music : "";
  }
  el.querySelector(".title").textContent = file.name;
  el.querySelector(".title").title = file.name;

  const watching = file.watch && watchList.find((w) => w.id === file.watch);
  const fmt = watching ? watching.options.format : fileOptions.format;
  const ext = (file.name.split(".").pop() || "").toUpperCase().slice(0, 5);
  const badge = el.querySelector(".badge");
  badge.hidden = !file.id;
  badge.textContent = `${ext} → ${fmt.toUpperCase()}`;

  // Where it came from: a folder that was added (its subfolder), or a watched folder
  const from = el.querySelector(".file-from");
  const watched = watching;
  const fromText = file.watch ? "Watched" + (watched ? ": " + watched.name : "") : file.sub || "";
  from.hidden = !fromText;
  if (from.dataset.text !== fromText) {
    from.dataset.text = fromText;
    from.innerHTML = FILE_ICONS[file.watch ? "eye" : "folder"];
    from.append(fromText);
    from.title = file.watch ? "Added by itself from a watched folder" : `From the folder ${fromText}. It's saved in a folder with the same name.`;
  }

  const idle = file.id && !file.watch && !["queued", "active"].includes(file.status);
  let message = madeOther ? "" : file.message;
  if (idle && !fits(file, fmt)) {
    const an = fmt.startsWith("m") ? "an" : "a"; // "an MP4", "a GIF"
    message = `This has no ${["mp4", "gif"].includes(fmt) ? "video" : "sound"}, so it can't be ${an} ${fmt.toUpperCase()}.`;
  } else if (!message && file.id) {
    message = [file.video ? `${file.width} × ${file.height}` : "Sound only", clock(file.seconds, false), sizeText(file.bytes)].join(" · ");
  }
  el.querySelector(".msg").textContent = message;

  // Trim: a button, or the part that's kept
  const trimBox = el.querySelector(".file-trim");
  const part = fileTrims.get(file.id);
  const trimKey = file.id && !fits(file, fmt) ? "skip" : !idle ? (file.trimLabel ? "label:" + file.trimLabel : "") : part ? `part:${part.start}-${part.end}` : "none:" + fmt;
  if (trimBox.dataset.key !== trimKey) {
    trimBox.dataset.key = trimKey;
    trimBox.innerHTML = "";
    if (file.id && !fits(file, fmt)) {
      // can't be converted to this format, so nothing to trim
    } else if (!idle) {
      if (file.trimLabel) trimBox.textContent = "Keeping " + file.trimLabel;
    } else if (part) {
      const edit = document.createElement("button");
      edit.className = "link";
      edit.textContent = `Keeping ${clock(part.start)} to ${clock(part.end)}`;
      edit.onclick = () => trimFile(file);
      const clear = document.createElement("button");
      clear.className = "icon-button";
      clear.title = "Don't trim";
      clear.innerHTML = FILE_ICONS.remove;
      clear.onclick = () => { fileTrims.delete(file.id); drawFiles(); };
      trimBox.append(edit, clear);
    } else {
      const button = document.createElement("button");
      button.className = "link";
      button.textContent = fmt === "gif" ? "Pick the part for the GIF (first 10 seconds if you don't)" : "Trim";
      button.onclick = () => trimFile(file);
      trimBox.append(button);
    }
  }

  const bar = el.querySelector(".bar");
  bar.hidden = file.status !== "active";
  bar.classList.toggle("indeterminate", !file.progress);
  bar.firstElementChild.style.width = file.progress ? file.progress + "%" : "";
  el.querySelector(".pct").textContent = file.status === "active" && file.progress ? Math.floor(file.progress) + "%" : "";

  const actions = el.querySelector(".actions");
  const wanted = file.status === "active" ? (file.cancel ? [] : ["stop"]) : file.status === "queued" && file.id ? ["stop"] : file.canShow && file.status === "done" ? ["folder", "remove"] : ["remove"];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    for (const kind of wanted) {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = { folder: "Show in folder", stop: "Stop converting" }[kind] || "Remove from list";
      b.innerHTML = FILE_ICONS[kind];
      b.onclick = () => {
        if (kind === "folder") return api("/api/file-show", { id: file.id });
        if (kind === "stop") return api("/api/file-cancel", { id: file.id }).then(refresh);
        if (!file.id) {
          if (file.stop) file.stop.abort();
          const index = uploads.indexOf(file);
          if (index >= 0) uploads.splice(index, 1);
        } else {
          serverFiles = serverFiles.filter((f) => f.id !== file.id);
          fileTrims.delete(file.id);
          api("/api/file-remove", { id: file.id }).then(refresh);
        }
        drawFiles();
      };
      actions.append(b);
    }
  }
  return el;
}

function drawFiles() {
  const all = [...serverFiles, ...uploads];
  const list = $("fileList");
  const rows = new Map([...list.children].map((el) => [el.dataset.key, el]));
  all.forEach((file, i) => {
    const key = file.id ? "f" + file.id : file.key;
    const el = fileRow(rows.get(key), file);
    el.dataset.key = key;
    rows.delete(key);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  for (const el of rows.values()) el.remove();

  const o = fileOptions, fmt = o.format;
  const any = all.length > 0;
  $("fileDrop").classList.toggle("compact", any);
  $("filesTab").classList.toggle("has-images", any);
  $("fileOptions").hidden = !serverFiles.length;

  $("fileFormat").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === fmt));
  const choices = FILE_QUALITIES[fmt];
  $("fileQualityRow").hidden = !choices;
  if (choices) {
    $("fileQualityLabel").textContent = fmt === "gif" ? "Width" : fmt === "mp4" ? "Size" : "Quality";
    const box = $("fileQuality");
    if (box.dataset.format !== fmt) {
      box.dataset.format = fmt;
      box.innerHTML = "";
      for (const [value, label] of choices) {
        const b = document.createElement("button");
        b.dataset.value = value;
        b.textContent = label;
        b.onclick = () => { o.quality[fmt] = value; saveFileOptions(); drawFiles(); };
        box.append(b);
      }
    }
    box.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === (o.quality[fmt] ?? "")));
  }
  $("fileFitRow").hidden = fmt !== "mp4";
  $("fileFit").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === o.fit));
  $("fileFitCustomBox").hidden = o.fit !== "custom";
  if ($("fileFitCustom").value !== o.fitCustom) $("fileFitCustom").value = o.fitCustom;
  $("fileVolumeRow").hidden = fmt === "gif";
  $("fileNormalize").classList.toggle("active", !!o.normalize);

  const notes = {
    wav: "WAV is the original sound with nothing taken away, so the files are big.",
    flac: "FLAC keeps the sound perfect like WAV, at about half the size.",
    gif: "GIFs have no sound and can be up to 60 seconds.",
  };
  const ready = readyFiles().length;
  const busy = serverFiles.some((f) => f.status === "active" || f.status === "queued");
  const allMade = !ready && !busy && serverFiles.some(madeAlready);
  $("fileNote").classList.toggle("error", !!fileError);
  $("fileNote").textContent = fileError || (allMade ? "All of these are made. Pick another format or size to make more."
    : fmt === "mp4" && targetMb() ? `Videos are made just small enough to stay under ${targetMb()} MB. Long videos get a smaller picture to fit.`
    : notes[fmt] || "");
  $("fileConvert").disabled = !ready;
  $("fileConvertText").textContent = !ready && busy ? "Converting..." : allMade ? "All done" : ready > 1 ? `Convert ${ready} files` : "Convert";
  $("fileClear").hidden = busy;
}

// Called by app.js with the app's state a few times a second.
function renderFiles(list, scans, watches) {
  drawFileScans(scans || []);
  renderWatches(watches || []);
  const known = new Map(serverFiles.map((f) => [f.id, f]));
  serverFiles = (list || []).map((f) => {
    const mine = known.get(f.id);
    // Just clicked Convert, and the app hasn't caught up yet: keep showing "Waiting..."
    if (mine && mine.waitingFor > f.run) return { ...f, status: "queued", message: "Waiting...", waitingFor: mine.waitingFor };
    return f;
  });
  for (const id of fileTrims.keys()) if (!serverFiles.some((f) => f.id === id)) fileTrims.delete(id);
  drawFiles();
}


function fileProblem(message) {
  showTab("files");
  uploads.push({ key: "u" + Math.random(), name: "", status: "error", message });
  drawFiles();
}

// ---- folders being looked through ("Looking through Holiday... 12 of 40")

function drawFileScans(scans) {
  const box = $("fileScans");
  const key = scans.map((s) => `${s.key}:${s.done}`).join();
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  for (const scan of scans) {
    const row = document.createElement("div");
    row.className = "file-scan";
    row.innerHTML = `${FILE_ICONS.folder}<span class="file-scan-text"></span><div class="bar"><div></div></div>`;
    row.querySelector(".file-scan-text").textContent = `Looking through ${scan.name}... ${scan.done} of ${scan.total}`;
    row.querySelector(".bar div").style.width = (scan.total ? (100 * scan.done) / scan.total : 0) + "%";
    box.append(row);
  }
}

// ---- watched folders: new files in them get converted by themselves

let watchList = []; // from the app's state
const watchOpen = new Set(); // watched folders whose settings are showing
let watchError = "";

const WATCH_FORMATS = ["mp3", "m4a", "wav", "flac", "mp4", "gif"];

function watchSummary(w) {
  const o = w.options, fmt = o.format;
  const label = (FILE_QUALITIES[fmt] || []).find(([v]) => v === o.quality);
  const parts = [fmt.toUpperCase()];
  if (o.targetMb) parts.push(`under ${o.targetMb} MB`);
  else if (label && !(fmt === "mp4" && !o.quality)) parts.push(label[1]);
  if (o.normalize) parts.push("even volume");
  return parts.join(" · ");
}

function shortPath(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 3 ? "…\\" + parts.slice(-2).join("\\") : path;
}

function agoText(when) {
  const s = Math.max(0, Date.now() / 1000 - when);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

async function watchCall(path, body) {
  const res = await api(path, body).catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  watchError = res.error || "";
  if (res.watch) watchList = watchList.map((w) => (w.id === res.watch.id ? res.watch : w)).concat(watchList.some((w) => w.id === res.watch.id) ? [] : [res.watch]);
  drawWatches();
  refresh();
  return res;
}

$("watchAdd").addEventListener("click", async () => {
  // Starts with the format picked above, which can be changed on its card.
  const fmt = fileOptions.format;
  const res = await watchCall("/api/watch-add", {
    options: { format: fmt, quality: fileOptions.quality[fmt] ?? "", targetMb: targetMb(), normalize: fileOptions.normalize },
  });
  if (res.watch) watchOpen.add(res.watch.id);
  drawWatches();
});

function watchChip(label, active, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.classList.toggle("active", active);
  b.onclick = onClick;
  return b;
}

function watchSettings(w) {
  const box = document.createElement("div");
  box.className = "watch-settings";
  const o = w.options;
  const save = (changes) => watchCall("/api/watch-update", { id: w.id, ...changes });
  const setOptions = (changes) => save({ options: { ...o, ...changes } });
  const row = (label, ...content) => {
    const r = document.createElement("div");
    r.className = "opt-row";
    const l = document.createElement("span");
    l.className = "opt-label";
    l.textContent = label;
    r.append(l, ...content);
    box.append(r);
    return r;
  };
  const chips = (...buttons) => { const c = document.createElement("div"); c.className = "chips"; c.append(...buttons); return c; };

  row("Format", chips(...WATCH_FORMATS.map((f) => watchChip(f.toUpperCase(), o.format === f,
    () => setOptions({ format: f, quality: FILE_DEFAULTS[f] ?? "", targetMb: null, normalize: f === "gif" ? false : o.normalize })))));
  const choices = FILE_QUALITIES[o.format];
  if (choices) {
    row(o.format === "gif" ? "Width" : o.format === "mp4" ? "Size" : "Quality",
      chips(...choices.map(([v, label]) => watchChip(label, (o.quality || "") === v && !o.targetMb, () => setOptions({ quality: v, targetMb: null })))));
  }
  if (o.format === "mp4") {
    row("Smaller", chips(...[[null, "Off"], [10, "Under 10 MB (Discord)"], [25, "25 MB"], [50, "50 MB"]].map(([mb, label]) =>
      watchChip(label, (o.targetMb || null) === mb, () => setOptions({ targetMb: mb }))))); 
  }
  if (o.format !== "gif") {
    row("Volume", chips(watchChip("Even out volume", o.normalize, () => setOptions({ normalize: !o.normalize }))));
  }
  const sub = document.createElement("label");
  sub.className = "check watch-check";
  sub.innerHTML = '<input type="checkbox"><span>Also look in the folders inside it</span>';
  sub.querySelector("input").checked = w.subfolders;
  sub.querySelector("input").onchange = (e) => save({ subfolders: e.target.checked });
  row("Folders", sub);

  const where = document.createElement("span");
  where.className = "watch-path";
  const inside = w.out.replace(/[\\/]+$/, "").toLowerCase() === (w.folder.replace(/[\\/]+$/, "") + "\\converted").toLowerCase()
    || w.out.replace(/[\\/]+$/, "").toLowerCase() === (w.folder.replace(/[\\/]+$/, "") + "/converted").toLowerCase();
  where.textContent = inside ? "A \"Converted\" folder inside it" : shortPath(w.out);
  where.title = w.out;
  const change = document.createElement("button");
  change.className = "link";
  change.textContent = "Change";
  change.onclick = () => watchCall("/api/watch-out", { id: w.id });
  const open = document.createElement("button");
  open.className = "link";
  open.textContent = "Open";
  open.onclick = () => api("/api/watch-open", { id: w.id, which: "out" });
  row("Save to", where, change, open);
  return box;
}

function watchRow(w) {
  const el = document.createElement("div");
  el.className = "watch-row" + (w.on ? "" : " paused") + (w.missing ? " missing" : "");
  const icon = document.createElement("div");
  icon.className = "watch-icon";
  icon.innerHTML = FILE_ICONS[w.on && !w.missing ? "eye" : "folder"];
  if (w.on && !w.missing) icon.classList.add("live");

  const body = document.createElement("div");
  body.className = "watch-body";
  const name = document.createElement("div");
  name.className = "watch-name";
  name.textContent = w.name;
  name.title = w.folder;
  const path = document.createElement("button");
  path.className = "watch-folder";
  path.textContent = shortPath(w.folder);
  path.title = "Open " + w.folder;
  path.onclick = () => api("/api/watch-open", { id: w.id });
  name.append(path);

  const line = document.createElement("div");
  line.className = "watch-line";
  const turns = document.createElement("span");
  turns.className = "watch-turns";
  turns.textContent = "→ " + watchSummary(w);
  const status = document.createElement("span");
  status.className = "watch-status";
  let text;
  if (w.missing) text = "Can't find this folder. Was it moved or is the drive unplugged?";
  else if (!w.on) text = "Paused";
  else if (w.working) text = `Converting ${w.working} new file${w.working > 1 ? "s" : ""}...`;
  else if (w.converted) text = `${w.converted} converted · last ${agoText(w.lastAt)}`;
  else text = "Watching for new files";
  if (w.failed && !w.missing) text += ` · ${w.failed} didn't work`;
  status.textContent = text;
  line.append(turns, status);
  body.append(name, line);

  // Files that were already in there when it was added
  if (w.backlog && w.on) {
    const ask = document.createElement("div");
    ask.className = "watch-backlog";
    const t = document.createElement("span");
    t.textContent = `${w.backlog} file${w.backlog > 1 ? "s were" : " was"} already in here.`;
    const yes = document.createElement("button");
    yes.className = "link";
    yes.textContent = `Convert ${w.backlog > 1 ? "them" : "it"} too`;
    yes.onclick = () => watchCall("/api/watch-backlog", { id: w.id });
    const no = document.createElement("button");
    no.className = "link muted";
    no.textContent = "Only new ones";
    no.onclick = () => watchCall("/api/watch-backlog", { id: w.id, skip: true });
    ask.append(t, yes, no);
    body.append(ask);
  }

  const actions = document.createElement("div");
  actions.className = "watch-actions";
  const toggle = document.createElement("label");
  toggle.className = "check";
  toggle.title = w.on ? "Pause watching" : "Start watching again";
  toggle.innerHTML = '<input type="checkbox">';
  toggle.querySelector("input").checked = w.on;
  toggle.querySelector("input").onchange = (e) => watchCall("/api/watch-update", { id: w.id, on: e.target.checked });
  const gear = document.createElement("button");
  gear.className = "icon-button" + (watchOpen.has(w.id) ? " active" : "");
  gear.title = "Change what it turns files into";
  gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
  gear.onclick = () => { if (!watchOpen.delete(w.id)) watchOpen.add(w.id); drawWatches(); };
  const remove = document.createElement("button");
  remove.className = "icon-button";
  remove.title = "Stop watching this folder (nothing is deleted)";
  remove.innerHTML = FILE_ICONS.remove;
  remove.onclick = () => { watchList = watchList.filter((x) => x.id !== w.id); watchCall("/api/watch-remove", { id: w.id }); };
  actions.append(toggle, gear, remove);

  const top = document.createElement("div");
  top.className = "watch-top";
  top.append(icon, body, actions);
  el.append(top);
  if (watchOpen.has(w.id)) el.append(watchSettings(w));
  return el;
}

function drawWatches() {
  const list = $("watchList");
  const key = JSON.stringify([watchList, [...watchOpen], Math.floor(Date.now() / 60000)]);
  $("filesWatchError").hidden = !watchError;
  $("filesWatchError").textContent = watchError;
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = "";
  if (!watchList.length) {
    const empty = document.createElement("div");
    empty.className = "watch-empty";
    empty.textContent = "Pick a folder, like where your recordings or downloads land, and every new video or song in it is converted the way you choose.";
    list.append(empty);
  }
  for (const w of watchList) list.append(watchRow(w));
}

function renderWatches(list) {
  watchList = list;
  for (const id of watchOpen) if (!list.some((w) => w.id === id)) watchOpen.delete(id);
  drawWatches();
}

drawFiles();
drawWatches();
