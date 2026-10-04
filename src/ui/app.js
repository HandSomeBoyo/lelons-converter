const $ = (id) => document.getElementById(id);
let format = "mp3";
let shownQuality = "";
let previewUrl = "";
let previewTimer = null;
let previewSeconds = 0;

const ICONS = {
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return res.json();
}

// ---- format toggle and quality

document.querySelectorAll("#toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    format = btn.dataset.format;
    $("toggle").classList.toggle("mp4", format === "mp4");
    document.querySelectorAll("#toggle button").forEach((b) => b.classList.toggle("active", b === btn));
    refresh();
  });
});

$("quality").addEventListener("change", async () => {
  render(await api("/api/quality", { format, quality: $("quality").value }));
});

// ---- video preview: look the link up shortly after it's pasted or typed

function looksLikeLink(text) {
  return /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(text) || /^https?:\/\//i.test(text);
}

function showPreview(kind, title, meta, thumbnail) {
  const box = $("preview");
  box.className = "preview show " + kind;
  $("previewTitle").textContent = title;
  $("previewMeta").textContent = meta || "";
  $("previewThumb").style.backgroundImage = thumbnail ? `url("${thumbnail}")` : "";
}

function hidePreview() {
  clearTimeout(previewTimer);
  closeTrim();
  $("preview").className = "preview";
  previewUrl = "";
}

async function lookUp(url) {
  previewUrl = url;
  closeTrim();
  previewSeconds = 0;
  showPreview("loading", "Looking up video...", "", "");
  const res = await api("/api/info", { url }).catch(() => ({ ok: false, error: "Couldn't look up that link." }));
  if (previewUrl !== url) return; // the link changed while we were waiting
  if (res.ok) {
    const p = res.preview;
    showPreview("", p.title, [p.channel, p.duration].filter(Boolean).join(" · "), p.thumbnail);
    previewSeconds = p.seconds || 0;
    $("trimEnd").placeholder = p.duration || "end";
  } else {
    showPreview("error", res.error, "Check the link and try again.", "");
  }
}

$("url").addEventListener("input", () => {
  clearTimeout(previewTimer);
  const url = $("url").value.trim();
  if (!url || !looksLikeLink(url)) return hidePreview();
  if (url === previewUrl) return;
  previewTimer = setTimeout(() => lookUp(url), 400);
});

// ---- trim: download only part of the video

// "1:20", "1:02:03" or "80" -> seconds, or null if it isn't a time
function parseTime(text) {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return null;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function openTrim() {
  $("trim").hidden = false;
  $("trimToggle").classList.add("open");
  $("trimStart").focus();
}

function closeTrim() {
  $("trim").hidden = true;
  $("trimToggle").classList.remove("open");
  $("trimStart").value = $("trimEnd").value = "";
  $("trimStart").classList.remove("bad");
  $("trimEnd").classList.remove("bad");
}

// Returns {start, end} to send, {} for no trim, or null if the times are wrong.
function readTrim() {
  if ($("trim").hidden) return {};
  const start = $("trimStart").value.trim(), end = $("trimEnd").value.trim();
  const s = start ? parseTime(start) : 0, e = end ? parseTime(end) : previewSeconds || null;
  const badStart = s === null || (previewSeconds && s >= previewSeconds);
  const badEnd = (end && e === null) || (e !== null && s !== null && e <= s);
  $("trimStart").classList.toggle("bad", !!badStart);
  $("trimEnd").classList.toggle("bad", !!badEnd);
  if (badStart || badEnd) return null;
  return { start, end };
}

$("trimToggle").addEventListener("click", openTrim);
$("trimClose").addEventListener("click", closeTrim);
["trimStart", "trimEnd"].forEach((id) => $(id).addEventListener("input", () => $(id).classList.remove("bad")));

// ---- adding to the queue

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  const trim = readTrim();
  if (!trim) {
    $("notice").className = "notice error";
    $("notice").textContent = "Check the trim times, like 1:20 to 2:05.";
    return;
  }
  $("url").value = "";
  hidePreview();
  $("url").focus();
  const res = await api("/api/convert", { url, format, ...trim });
  $("notice").className = res.ok ? "notice" : "notice error";
  $("notice").textContent = res.ok ? "" : res.error;
  refresh();
});

$("change").addEventListener("click", async () => render(await api("/api/pick-folder", {})));
$("update").addEventListener("click", () => api("/api/update", {}).then(refresh));
$("clear").addEventListener("click", () => api("/api/clear", {}).then(refresh));
$("installUpdate").addEventListener("click", () => api("/api/install-app-update", {}).then(refresh));

// ---- drawing the window from the app's state

function renderJob(el, job) {
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = `
      <div class="thumb"></div>
      <div class="body">
        <div class="title"></div>
        <div class="line"><span class="badge"></span><span class="msg"></span></div>
        <div class="bar"><div></div></div>
      </div>
      <div class="actions"></div>`;
    el.dataset.id = job.id;
  }
  el.className = "job " + job.status;
  el.querySelector(".thumb").style.backgroundImage = job.thumbnail ? `url("${job.thumbnail}")` : "";
  el.querySelector(".title").textContent = job.title;
  el.querySelector(".title").title = job.title;
  el.querySelector(".badge").textContent = [job.format.toUpperCase(), job.qualityLabel.replace(/ \(.*\)/, ""), job.trimLabel]
    .filter(Boolean).join(" · ");
  el.querySelector(".msg").textContent = job.message;

  const bar = el.querySelector(".bar");
  bar.hidden = job.status !== "active";
  bar.classList.toggle("indeterminate", !job.progress || job.progress >= 100);
  bar.firstElementChild.style.width = job.progress && job.progress < 100 ? job.progress + "%" : "";

  const actions = el.querySelector(".actions");
  const wanted = { queued: ["remove"], active: [], done: ["folder", "remove"], error: ["retry", "remove"] }[job.status];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    const titles = { remove: "Remove from list", retry: "Try again", folder: "Show in folder" };
    const routes = { remove: "/api/remove", retry: "/api/retry", folder: "/api/show-file" };
    for (const kind of wanted) {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = titles[kind];
      b.innerHTML = ICONS[kind];
      b.onclick = () => api(routes[kind], { id: job.id }).then(refresh);
      actions.append(b);
    }
  }
  return el;
}

function renderQueue(jobs) {
  $("queue").classList.toggle("show", jobs.length > 0);
  $("clear").hidden = !jobs.some((j) => j.status === "done" || j.status === "error");
  const list = $("jobs");
  const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
  const ordered = [...jobs].reverse(); // newest on top
  ordered.forEach((job, i) => {
    const el = renderJob(existing.get(String(job.id)), job);
    existing.delete(String(job.id));
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  existing.forEach((el) => el.remove());
}

function renderUpdateBanner(s) {
  const banner = $("banner");
  banner.classList.toggle("show", !!s.appUpdate);
  if (!s.appUpdate) return;
  const installing = s.appUpdateProgress !== null;
  $("bannerText").innerHTML = installing
    ? (s.appUpdateProgress >= 100 ? "Opening the installer..." : "Downloading the update...")
    : `<strong>Version ${s.appUpdate.version} is available.</strong> You have ${s.version}.`;
  $("installUpdate").hidden = installing;
  $("bannerBar").hidden = !installing;
  $("bannerBar").firstElementChild.style.width = installing ? s.appUpdateProgress + "%" : "";
  if (installing && s.appUpdateProgress >= 100) setTimeout(() => window.close(), 1500);
}

function render(s) {
  $("folder").textContent = s.folderName;
  $("folder").title = s.folder;
  $("version").textContent = "Version " + s.version;
  const key = format + ":" + s.quality[format];
  if (key !== shownQuality) {
    $("quality").innerHTML = "";
    for (const [value, label] of s.qualities[format]) $("quality").add(new Option(label, value));
    $("quality").value = s.quality[format];
    shownQuality = key;
  }
  $("update").disabled = s.updating;
  if (s.notice) {
    $("notice").className = "notice " + s.notice.kind;
    $("notice").textContent = s.notice.text;
  } else if (!$("notice").classList.contains("error")) {
    $("notice").textContent = "";
  }
  renderQueue(s.jobs);
  renderUpdateBanner(s);
}

async function refresh() {
  try { render(await api("/api/state")); } catch (e) { /* app closed */ }
}
refresh();
setInterval(refresh, 500);
window.addEventListener("pagehide", () => navigator.sendBeacon("/api/bye"));
