// The Images tab: drop pictures, pick options, save them in another format.
// Uses $ and api() from app.js.

const imageItems = []; // {id, name, width, height, bytes, kind, animated, thumb, status, message, path}
const DEFAULT_IMAGE_OPTIONS = { format: "png", size: "original", width: "", height: "", quality: 90, rotate: 0, flipH: false, flipV: false, square: false, gray: false };
let imageOptions = { ...DEFAULT_IMAGE_OPTIONS };
let converting = false;

try {
  const saved = loadPref("imageOptions") || {};
  for (const key of ["format", "size", "quality", "square", "gray"]) if (key in saved) imageOptions[key] = saved[key];
} catch (e) { /* nothing saved */ }

function saveImageOptions() {
  savePref("imageOptions", imageOptions);
}

// ---- tabs

// The side bar has 8 places. Some hold a few pages, picked with the bar at the top of the page.
const TAB_SECTIONS = { convert: ["video", "files", "images", "history"], 
  recording: ["games", "povs"], youtube: ["channel", "comments", "titles", "copyright"],
  live: ["live", "lvboard", "lvalerts", "lvstats"] };
const sectionOf = (tab) => Object.keys(TAB_SECTIONS).find((k) => TAB_SECTIONS[k].includes(tab) && document.querySelector(`.sub-tabs button[data-tab="${tab}"]`)) || "";
// A page that belongs in a place but still sits in the side bar (like Comments) moves into that place's bar.
for (const [section, tabs] of Object.entries(TAB_SECTIONS)) {
  const bar = document.querySelector(`.sub-tabs[data-section="${section}"]`);
  tabs.forEach((t, i) => {
    const b = document.querySelector(`#tabs button[data-tab="${t}"]:not([data-section])`);
    if (!b || !bar) return;
    b.type = "button"; b.setAttribute("role", "tab");
    const next = tabs.slice(i + 1).map((n) => bar.querySelector(`button[data-tab="${n}"]`)).find(Boolean);
    bar.insertBefore(b, next || null);
  });
}

function showTab(tab) {
  const section = sectionOf(tab);
  if (section) {
    // The side bar button opens the page of this place you used last; the bar sits on top of the page.
    document.querySelector(`#tabs button[data-section="${section}"]`).dataset.tab = tab;
    const bar = document.querySelector(`.sub-tabs[data-section="${section}"]`);
    if (bar.parentElement !== $(tab + "Tab")) $(tab + "Tab").prepend(bar);
  }
  document.querySelectorAll("#tabs button, .sub-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === (tab === "stats" ? "home" : tab));
    if (b.closest(".sub-tabs")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  });
  for (const name of ["home", "feed", "stats", "video", "files", "images", "resolve", "remote", "sfx", "projects", "docs", "boards", "fx", "games", "povs", "channel", "comments", "titles", "copyright", "history", "account", "live", "lvboard", "lvalerts", "lvstats"]) $(name + "Tab").hidden = tab !== name;
  if (tab === "home" && typeof openHome === "function") openHome();
  if (tab === "stats" && typeof openStats === "function") openStats();
  if (tab === "history" && typeof loadHistory === "function") loadHistory();
  if (tab === "sfx" && typeof openSfx === "function") openSfx();
  if (tab === "account" && typeof openAccount === "function") openAccount();
  if (tab === "copyright" && typeof openCopyright === "function") openCopyright();
  if (typeof docsTabChanged === "function") docsTabChanged(tab);
  if (typeof boardsTabChanged === "function") boardsTabChanged(tab);
  if (typeof resolveTabChanged === "function") resolveTabChanged(tab);
  if (typeof remoteTabChanged === "function") remoteTabChanged(tab);
  if (typeof fxTabChanged === "function") fxTabChanged(tab);
  if (typeof pjTabChanged === "function") pjTabChanged(tab);
  if (typeof gamesTabChanged === "function") gamesTabChanged(tab);
  if (typeof povsTabChanged === "function") povsTabChanged(tab);
  if (typeof feedTabChanged === "function") feedTabChanged(tab);
  if (typeof channelTabChanged === "function") channelTabChanged(tab);
  if (typeof commentsTabChanged === "function") commentsTabChanged(tab);
  if (typeof titlesTabChanged === "function") titlesTabChanged(tab);
  if (typeof liveTabChanged === "function") liveTabChanged(tab);
  if (typeof playerTabChanged === "function") playerTabChanged();
  if (loadPref("tab") !== tab) savePref("tab", tab);
}
document.querySelectorAll("#tabs button, .sub-tabs button").forEach((b) => b.addEventListener("click", () => {
  if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat(); // (the chat sits next to the side bar: picking a page leaves it)
  showTab(b.dataset.tab);
}));
// The app opens on the tab used last; after the update that added Home, on Home once.
if (["video", "files", "images", "resolve", "remote", "sfx", "projects", "docs", "boards", "games", "povs", "channel", "comments", "titles", "copyright", "history", "live", "lvboard", "lvalerts", "lvstats"].includes(loadPref("tab")) && loadPref("homeSeen")) showTab(loadPref("tab"));
if (!loadPref("homeSeen")) savePref("homeSeen", 1);

// A page inside a place has news (like a game on sale): a dot on the place's side bar button too.
function drawSectionDots() {
  for (const [section, tabs] of Object.entries(TAB_SECTIONS)) {
    const news = tabs.some((t) => { const b = document.querySelector(`.sub-tabs button[data-tab="${t}"] .tab-badge`); return b && !b.hidden; });
    const dot = document.querySelector(`#tabs button[data-section="${section}"] .tab-dot`);
    if (dot && dot.hidden === news) dot.hidden = !news;
  }
}
document.querySelectorAll(".sub-tabs .tab-badge").forEach((b) => new MutationObserver(drawSectionDots).observe(b, { attributes: true, attributeFilter: ["hidden"] }));
drawSectionDots();

// ---- adding pictures (drop anywhere in the window, or choose files)

function sizeText(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

async function addImageFiles(files) {
  showTab("images");
  for (const file of files) {
    const item = { id: "", name: file.name, status: "loading", message: "Opening..." };
    imageItems.push(item);
    renderImages();
    try {
      const res = await fetch("/api/image-add", {
        method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file,
      }).then((r) => r.json());
      if (res.ok) Object.assign(item, res.image, { status: "ready", message: "" });
      else Object.assign(item, { status: "error", message: res.error });
    } catch (e) {
      Object.assign(item, { status: "error", message: "Couldn't open this file." });
    }
    renderImages();
  }
}

$("imageFiles").addEventListener("change", (e) => {
  addImageFiles([...e.target.files]);
  e.target.value = "";
});

// Dropping a file on a web page normally opens it in the window; catch it instead.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); }
});
window.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  // Pictures go to the Images tab, videos and songs to the Files tab.
  const files = [...e.dataTransfer.files];
  // The SFX upload window takes the first file itself.
  if (typeof sfxTakesDrop === "function" && sfxTakesDrop(files)) return;
  if (typeof copyTakesDrop === "function" && copyTakesDrop(files)) return;
  if (typeof fxTakesDrop === "function" && fxTakesDrop(files)) return;
  if (typeof pjTakesDrop === "function" && pjTakesDrop(files)) return;
  if (typeof rtTakesDrop === "function" && rtTakesDrop(files)) return;
  const isPicture = (f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?|ico)$/i.test(f.name);
  // A whole folder: its videos and songs go to the Files tab (or its pictures to Images, if that's all it has).
  const inFolders = typeof droppedFolders === "function" && droppedFolders(e.dataTransfer);
  if (inFolders) {
    inFolders.then((all) => {
      const media = all.filter((x) => MEDIA_RE.test(x.file.name)), pics = all.filter((x) => isPicture(x.file));
      if (media.length) addMediaFiles(media);
      else if (pics.length) addImageFiles(pics.map((x) => x.file));
      else fileProblem("There are no videos or songs in that folder.");
    });
    return;
  }
  const pictures = files.filter(isPicture), others = files.filter((f) => !isPicture(f));
  if (others.length) addMediaFiles(others);
  if (pictures.length) addImageFiles(pictures);
});

// ---- options

function bindChips(id, key) {
  $(id).querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    imageOptions[key] = b.dataset.value;
    renderImages();
  }));
}
bindChips("imgFormat", "format");
bindChips("imgSize", "size");

$("imgQuality").addEventListener("input", () => { imageOptions.quality = +$("imgQuality").value; renderImages(); });
for (const [id, key] of [["imgWidth", "width"], ["imgHeight", "height"]]) {
  $(id).addEventListener("input", () => {
    $(id).value = $(id).value.replace(/\D/g, "").slice(0, 5);
    imageOptions[key] = $(id).value;
    renderImages();
  });
}
$("rotateLeft").addEventListener("click", () => { imageOptions.rotate = (imageOptions.rotate + 270) % 360; renderImages(); });
$("rotateRight").addEventListener("click", () => { imageOptions.rotate = (imageOptions.rotate + 90) % 360; renderImages(); });
for (const key of ["flipH", "flipV"]) $(key).addEventListener("click", () => { imageOptions[key] = !imageOptions[key]; renderImages(); });
$("imgSquare").addEventListener("click", () => { imageOptions.square = !imageOptions.square; renderImages(); });
$("imgGray").addEventListener("click", () => { imageOptions.gray = !imageOptions.gray; renderImages(); });
$("imgReset").addEventListener("click", () => { imageOptions = { ...DEFAULT_IMAGE_OPTIONS, format: imageOptions.format }; renderImages(); });

$("imgClear").addEventListener("click", () => {
  for (const item of imageItems.splice(0)) if (item.id) api("/api/image-remove", { id: item.id });
  renderImages();
});

// What size a picture will come out, to show next to it.
function outputSize(item) {
  let w = item.width, h = item.height;
  const o = imageOptions;
  if (o.square) w = h = Math.min(w, h);
  if (["75", "50", "25"].includes(o.size)) {
    w = Math.max(1, Math.round(w * o.size / 100));
    h = Math.max(1, Math.round(h * o.size / 100));
  } else if (o.size === "custom") {
    const cw = +o.width || 0, ch = +o.height || 0;
    if (cw && ch) [w, h] = [cw, ch];
    else if (cw) [w, h] = [cw, Math.max(1, Math.round(h * cw / w))];
    else if (ch) [w, h] = [Math.max(1, Math.round(w * ch / h)), ch];
  }
  return o.rotate % 180 ? [h, w] : [w, h];
}

// ---- converting

$("imgConvert").addEventListener("click", async () => {
  if (converting) return;
  const todo = imageItems.filter((i) => i.id && i.status !== "loading");
  if (!todo.length) return;
  converting = true;
  const folder = await whereToSave();
  if (!folder) return void (converting = false);
  saveImageOptions();
  for (const item of todo) Object.assign(item, { status: "waiting", message: "Waiting..." });
  renderImages();
  for (const item of todo) {
    Object.assign(item, { status: "working", message: "Converting..." });
    renderImages();
    try {
      const res = await api("/api/image-convert", { id: item.id, options: imageOptions, folder });
      if (res.ok) Object.assign(item, { status: "done", path: res.path, message: `Saved as ${res.name} · ${res.width} × ${res.height} · ${sizeText(res.bytes)}` });
      else Object.assign(item, { status: "error", message: res.error });
    } catch (e) {
      Object.assign(item, { status: "error", message: "Couldn't save this picture." });
    }
    renderImages();
  }
  converting = false;
  renderImages();
});

// ---- drawing

const IMAGE_ICONS = {
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

function renderImageRow(el, item) {
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = `
      <div class="pic"><img alt=""></div>
      <div class="body">
        <div class="title"></div>
        <div class="line"><span class="badge"></span><span class="msg"></span></div>
      </div>
      <div class="actions"></div>`;
  }
  el.className = "image-row " + item.status;
  setDrag(el, item.status === "done" && item.path ? { kind: "image", path: item.path } : null);
  el.title = item.status === "done" && item.path ? DRAG_HINT : "";
  const o = imageOptions;
  const img = el.querySelector("img");
  if (item.thumb && img.getAttribute("src") !== item.thumb) img.src = item.thumb;
  img.hidden = !item.thumb;
  img.style.transform = `rotate(${o.rotate}deg) scale(${o.flipH ? -1 : 1}, ${o.flipV ? -1 : 1})`;
  img.style.filter = o.gray ? "grayscale(1)" : "";
  el.querySelector(".pic").classList.toggle("square", o.square);
  el.querySelector(".title").textContent = item.name;
  el.querySelector(".title").title = item.name;

  const badge = el.querySelector(".badge");
  badge.hidden = !item.kind;
  badge.textContent = item.kind ? `${item.kind} → ${o.format.toUpperCase()}` : "";
  let message = item.message;
  if (!message && item.width) {
    const [w, h] = outputSize(item);
    const same = w === item.width && h === item.height;
    message = `${item.width} × ${item.height}${same ? "" : ` → ${w} × ${h}`} · ${sizeText(item.bytes)}`;
    if (item.animated && !["gif", "webp"].includes(o.format)) message += " · only the first frame";
  }
  el.querySelector(".msg").textContent = message;

  const actions = el.querySelector(".actions");
  const wanted = converting ? [] : item.status === "done" ? ["folder", "remove"] : ["remove"];
  if (actions.dataset.kind !== wanted.join()) {
    actions.dataset.kind = wanted.join();
    actions.innerHTML = "";
    for (const kind of wanted) {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = kind === "folder" ? "Show in folder" : "Remove from list";
      b.innerHTML = IMAGE_ICONS[kind];
      b.onclick = () => {
        if (kind === "folder") return api("/api/image-show", { path: item.path });
        imageItems.splice(imageItems.indexOf(item), 1);
        if (item.id) api("/api/image-remove", { id: item.id });
        renderImages();
      };
      actions.append(b);
    }
  }
  return el;
}

function renderImages() {
  const o = imageOptions;
  const list = $("imageList");
  const rows = new Map([...list.children].map((el) => [el._item, el]));
  imageItems.forEach((item, i) => {
    const el = renderImageRow(rows.get(item), item);
    el._item = item;
    rows.delete(item);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  for (const el of rows.values()) el.remove();

  const any = imageItems.length > 0;
  $("dropzone").classList.toggle("compact", any);
  $("imagesTab").classList.toggle("has-images", any);
  $("imageOptions").hidden = !any;
  for (const [id, key] of [["imgFormat", "format"], ["imgSize", "size"]]) {
    $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.value === o[key]));
  }
  $("customSize").hidden = o.size !== "custom";
  if ($("imgWidth").value !== o.width) $("imgWidth").value = o.width;
  if ($("imgHeight").value !== o.height) $("imgHeight").value = o.height;
  $("qualityRow").hidden = !["jpg", "webp"].includes(o.format);
  $("imgQuality").value = o.quality;
  $("imgQualityValue").textContent = o.quality;
  $("imgSquare").classList.toggle("active", o.square);
  $("imgGray").classList.toggle("active", o.gray);
  $("flipH").classList.toggle("active", o.flipH);
  $("flipV").classList.toggle("active", o.flipV);

  const ready = imageItems.filter((i) => i.id).length;
  $("imgConvert").disabled = converting || !ready;
  $("imgConvert").classList.toggle("busy", converting);
  $("imgConvertText").textContent = converting ? "Converting..." : ready > 1 ? `Convert ${ready} images` : "Convert";
  $("imgClear").hidden = converting;
}

renderImages();

// Home's start buttons: straight to the place.
document.querySelectorAll("#homeStart button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.go)));
