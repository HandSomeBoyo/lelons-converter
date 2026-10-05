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
  const saved = JSON.parse(localStorage.getItem("fileOptions") || "{}");
  fileOptions = { ...fileOptions, ...saved, quality: { ...FILE_DEFAULTS, ...(saved.quality || {}) } };
} catch (e) { /* nothing saved */ }

let serverFiles = []; // from the app's state
const uploads = []; // files still being copied into the app, or that couldn't be opened
const fileTrims = new Map(); // file id -> {start, end}

function saveFileOptions() {
  try { localStorage.setItem("fileOptions", JSON.stringify(fileOptions)); } catch (e) { /* not important */ }
}

// ---- adding files

async function addMediaFiles(list) {
  showTab("files");
  for (const file of list) {
    const upload = { key: "u" + Math.random(), name: file.name, status: "loading", message: `Opening... (${sizeText(file.size)})` };
    uploads.push(upload);
    drawFiles();
    try {
      const res = await fetch("/api/file-add", {
        method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file,
      }).then((r) => r.json());
      if (res.ok) {
        uploads.splice(uploads.indexOf(upload), 1);
        serverFiles.push(res.file);
      } else {
        Object.assign(upload, { status: "error", message: res.error });
      }
    } catch (e) {
      Object.assign(upload, { status: "error", message: "Couldn't open this file." });
    }
    drawFiles();
  }
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

function readyFiles() {
  return serverFiles.filter((f) => f.status !== "active" && f.status !== "queued" && fits(f, fileOptions.format));
}

$("fileConvert").addEventListener("click", async () => {
  const ready = readyFiles();
  if (!ready.length) return;
  const items = ready.map((f) => {
    const part = fileTrims.get(f.id);
    return { id: f.id, ...(part ? { start: part.start.toFixed(2), end: part.end.toFixed(2) } : {}) };
  });
  const fmt = fileOptions.format;
  for (const f of ready) Object.assign(f, { status: "queued", message: "Waiting..." });
  drawFiles();
  await api("/api/files-convert", {
    items,
    options: { format: fmt, quality: fileOptions.quality[fmt] ?? "", targetMb: targetMb(), normalize: fileOptions.normalize },
  });
  refresh();
});

// ---- drawing

const FILE_ICONS = {
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

function fileRow(el, file) {
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
  el.className = "image-row file-row " + file.status + (file.id && !fits(file, fileOptions.format) ? " skipped" : "");
  const pic = el.querySelector(".pic");
  const picKind = file.thumb || (file.status === "loading" ? "" : "music");
  if (pic.dataset.kind !== picKind) {
    pic.dataset.kind = picKind;
    pic.innerHTML = file.thumb ? `<img alt="" src="${file.thumb}">` : picKind ? FILE_ICONS.music : "";
  }
  el.querySelector(".title").textContent = file.name;
  el.querySelector(".title").title = file.name;

  const fmt = fileOptions.format;
  const ext = (file.name.split(".").pop() || "").toUpperCase().slice(0, 5);
  const badge = el.querySelector(".badge");
  badge.hidden = !file.id;
  badge.textContent = `${ext} → ${fmt.toUpperCase()}`;

  const idle = file.id && !["queued", "active"].includes(file.status);
  let message = file.message;
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
  const wanted = file.status === "active" ? [] : file.canShow && file.status === "done" ? ["folder", "remove"] : ["remove"];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    for (const kind of wanted) {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = kind === "folder" ? "Show in folder" : "Remove from list";
      b.innerHTML = FILE_ICONS[kind];
      b.onclick = () => {
        if (kind === "folder") return api("/api/file-show", { id: file.id });
        if (!file.id) {
          uploads.splice(uploads.indexOf(file), 1);
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
  $("fileNote").textContent = fmt === "mp4" && targetMb()
    ? `Videos are made just small enough to stay under ${targetMb()} MB. Long videos get a smaller picture to fit.`
    : notes[fmt] || "";

  const ready = readyFiles().length;
  const busy = serverFiles.some((f) => f.status === "active" || f.status === "queued");
  $("fileConvert").disabled = !ready;
  $("fileConvertText").textContent = !ready && busy ? "Converting..." : ready > 1 ? `Convert ${ready} files` : "Convert";
  $("fileClear").hidden = busy;
}

// Called by app.js with the app's state a few times a second.
function renderFiles(list) {
  const known = new Map(serverFiles.map((f) => [f.id, f]));
  serverFiles = (list || []).map((f) => {
    const mine = known.get(f.id);
    // Just clicked Convert, and the app hasn't caught up yet: keep showing "Waiting..."
    if (mine && mine.status === "queued" && f.status !== "queued" && f.status !== "active" && f.message === mine._lastMessage) return mine;
    return { ...f, _lastMessage: f.message };
  });
  for (const id of fileTrims.keys()) if (!serverFiles.some((f) => f.id === id)) fileTrims.delete(id);
  drawFiles();
}

drawFiles();
