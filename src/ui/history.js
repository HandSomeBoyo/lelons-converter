// The History tab: everything made in the Link, Files and Images tabs, to find or get again.
// (Links can be downloaded again; files and pictures can be shown in their folder.)
// Uses $, api(), refresh(), ICONS from app.js and showTab() from images.js.

const historyEls = new Map(); // item id -> {el, sig}, so typing in the search doesn't rebuild every row
let historyItems = [];
let historyVersion = -1;
let historyLoading = false;
let historyKind = ""; // the filter: "", "link", "file" or "image"
const kindOf = (item) => item.source || "link";

async function loadHistory() {
  if (historyLoading) return;
  historyLoading = true;
  try {
    const res = await api("/api/history");
    historyItems = res.items || [];
    historyVersion = res.version;
    drawHistory();
  } catch (e) { /* the app is closing */ }
  historyLoading = false;
}

// Called by app.js with the app's state: fetch the list again when it changed.
function renderHistoryVersion(version) {
  if (version !== historyVersion && !$("historyTab").hidden) loadHistory();
  else if (version !== historyVersion) historyVersion = null; // load when the tab is opened
}

function whenText(seconds) {
  const date = new Date(seconds * 1000);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return "Today " + time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday " + time;
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function historyRow(item) {
  const el = document.createElement("div");
  el.className = "job done";
  el.innerHTML = `
    <div class="thumb"></div>
    <div class="body">
      <div class="title"></div>
      <div class="line"><span class="badge"></span><span class="msg"></span></div>
    </div>
    <div class="actions"></div>`;
  if (item.exists) {
    setDrag(el, { kind: "history", id: item.id });
    el.title = DRAG_HINT;
  }
  setThumb(el.querySelector(".thumb"), item.thumbnail, item.format);
  el.querySelector(".title").textContent = el.querySelector(".title").title = item.title || item.url || "";
  el.querySelector(".badge").textContent = [(item.format || "").toUpperCase(), (item.qualityLabel || "").replace(/ \(.*\)/, ""), item.trimLabel]
    .filter(Boolean).join(" · ");
  const msg = el.querySelector(".msg");
  const from = { file: "From Files", image: "From Images" }[kindOf(item)] || "";
  msg.textContent = [whenText(item.date), item.exists ? "" : "File moved or deleted", item.exists ? item.channel || from : ""].filter(Boolean).join(" · ");
  msg.classList.toggle("gone", !item.exists);

  const actions = el.querySelector(".actions");
  if (item.url) actions.append(againButton(item));
  const buttons = item.exists ? ["folder", "remove"] : ["remove"];
  for (const kind of buttons) {
    const b = document.createElement("button");
    b.className = "icon-button";
    b.title = kind === "folder" ? "Show in folder" : "Remove from history";
    b.innerHTML = ICONS[kind];
    b.onclick = () => {
      if (kind === "folder") return api("/api/history-show", { id: item.id });
      historyItems = historyItems.filter((i) => i.id !== item.id);
      drawHistory();
      api("/api/history-remove", { id: item.id });
    };
    actions.append(b);
  }
  return el;
}

// "Download again" for a link.
function againButton(item) {
  const again = document.createElement("button");
  again.className = "outline-button again row-hover";
  again.textContent = "Download again";
  again.onclick = async () => {
    const folder = await whereToSave();
    if (!folder) return;
    again.disabled = true;
    const res = await api("/api/history-again", { id: item.id, folder }).catch(() => ({ ok: false }));
    again.disabled = false;
    if (res.ok) {
      showTab("video");
      refresh();
    } else {
      again.textContent = res.error || "Didn't work";
      setTimeout(() => { again.textContent = "Download again"; }, 4000);
    }
  };
  return again;
}

function drawHistory() {
  const words = $("historySearch").value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = historyItems.filter((item) => {
    if (historyKind && kindOf(item) !== historyKind) return false;
    const text = `${item.title} ${item.channel || ""} ${item.format} ${item.url || ""} ${item.file || ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const list = $("historyList");
  const rows = shown.slice(0, 300);
  setChildren(list, rows.map((item) => keptNode(historyEls, item.id, JSON.stringify([item, whenText(item.date)]), () => historyRow(item))));
  forgetNodes(historyEls, historyItems.map((item) => item.id));
  $("historyMoreWrap").hidden = !historyItems.length;
  $("historyEmpty").hidden = shown.length > 0;
  const kindName = { link: "links", file: "files", image: "pictures" }[historyKind];
  $("historyEmpty").textContent = !historyItems.length
    ? "Nothing here yet. Everything you make in Link, Files and Images shows up here."
    : words.length ? "Nothing matches that search."
    : kindName ? `No ${kindName} yet.` : "Nothing matches that search.";
  $("historyKinds").hidden = !historyItems.length;
}

$("historyKinds").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  historyKind = b.dataset.kind;
  $("historyKinds").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  drawHistory();
}));

$("historySearch").addEventListener("input", drawHistory);

// Clearing needs a second click, so it can't happen by accident.
let clearTimer = null;
$("historyClear").addEventListener("click", () => {
  const button = $("historyClear");
  if (!clearTimer) {
    button.textContent = "Click again to clear everything";
    clearTimer = setTimeout(() => { button.textContent = "Clear history"; clearTimer = null; }, 3000);
    return;
  }
  clearTimeout(clearTimer);
  clearTimer = null;
  button.textContent = "Clear history";
  historyItems = [];
  $("historyMenu").hidden = true;
  drawHistory();
  api("/api/history-clear", {});
});

// (3.0) The ⋯ menu holds "Clear history", so it isn't always on the page.
$("historyMore").addEventListener("click", () => { $("historyMenu").hidden = !$("historyMenu").hidden; });
document.addEventListener("pointerdown", (e) => {
  if (!$("historyMenu").hidden && !e.target.closest(".hist-menu-wrap")) $("historyMenu").hidden = true;
});

if (!$("historyTab").hidden) loadHistory();
