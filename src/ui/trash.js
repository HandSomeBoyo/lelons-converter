// Settings > Trash: deleted documents, boards and Library sounds wait here for 30 days.
// Put back brings them back where they were; Delete for good (or Empty Trash) gets rid of them now.

let trashItems = [];
let trashKind = "";
const trashSure = new Set();  // "Delete for good" was clicked once: the second click really does it

const TRASH_ICONS = {
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 8v7M12 8v4M16 8v9"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/></svg>',
};

async function loadTrash() {
  if (!trashItems.length) $("trashList").innerHTML = '<div class="trash-none">Loading...</div>';
  const res = await api("/api/trash-list", {}).catch(() => ({ ok: false, error: "Couldn't open the Trash." }));
  if (!res.ok) {
    trashItems = [];
    $("trashNote").hidden = false;
    $("trashNote").textContent = res.error || "Couldn't open the Trash.";
  } else {
    trashItems = res.items || [];
    $("trashNote").hidden = !res.note;
    $("trashNote").textContent = res.note || "";
  }
  drawTrash();
}

function trashKindName(i) {
  if (i.kind === "doc") return i.where === "online" ? "Shared document" : "Document";
  if (i.kind === "board") return i.where === "online" ? "Team board" : "Board";
  return "Library sound";
}

function trashLine(i) {
  const bits = [trashKindName(i)];
  bits.push(i.kind === "sound" && i.who ? `${trashAgo(i.deleted)} by ${i.who}` : trashAgo(i.deleted));
  bits.push(i.daysLeft <= 1 ? "gone for good tomorrow" : `${i.daysLeft} days left`);
  return bits.join(" · ");
}

function trashAgo(when) {
  if (typeof timeAgo === "function") return timeAgo(when);
  const days = Math.floor((Date.now() / 1000 - when) / 86400);
  return days < 1 ? "today" : days === 1 ? "yesterday" : days + " days ago";
}

function drawTrash() {
  $("trashSoundsFilter").hidden = !trashItems.some((i) => i.kind === "sound");
  if (trashKind === "sound" && $("trashSoundsFilter").hidden) trashKind = "";
  document.querySelectorAll("#trashFilters button").forEach((b) => b.classList.toggle("active", b.dataset.kind === trashKind));
  const shown = trashItems.filter((i) => !trashKind || i.kind === trashKind);
  $("trashEmpty").disabled = !trashItems.length;
  $("trashEmpty").textContent = trashSure.has("*") ? "Click again to empty" : "Empty Trash";
  $("trashEmpty").classList.toggle("sure", trashSure.has("*"));
  if (!shown.length) {
    $("trashList").innerHTML = `<div class="trash-none"><svg class="trash-none-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg><b>${trashItems.length ? "Nothing like that in the Trash" : "The Trash is empty"}</b><span>When you delete a document, a board or a sound, it waits here for 30 days.</span></div>`;
    return;
  }
  $("trashList").replaceChildren(...shown.map(trashRow));
}

function trashRow(i) {
  const key = `${i.where}:${i.kind}:${i.id}`;
  const row = document.createElement("div");
  row.className = "set-row trash-row";
  row.innerHTML = `<span class="trash-icon k-${i.kind}">${TRASH_ICONS[i.kind] || ""}</span>
    <span class="set-text"><b></b><small></small></span>
    <span class="trash-acts"><button type="button" class="trash-back">${TRASH_ICONS.back}<span>Put back</span></button>
    <button type="button" class="trash-kill"></button></span>`;
  row.querySelector("b").textContent = i.title || "Untitled";
  row.querySelector("small").textContent = trashLine(i);
  const kill = row.querySelector(".trash-kill");
  kill.textContent = trashSure.has(key) ? "Click again" : "Delete for good";
  kill.classList.toggle("sure", trashSure.has(key));
  row.querySelector(".trash-back").addEventListener("click", (e) => trashAct("restore", i, e.currentTarget));
  kill.addEventListener("click", (e) => {
    if (!trashSure.has(key)) {
      trashSure.add(key);
      drawTrash();
      setTimeout(() => { if (trashSure.delete(key)) drawTrash(); }, 4000);
      return;
    }
    trashSure.delete(key);
    trashAct("purge", i, e.currentTarget);
  });
  return row;
}

async function trashAct(what, i, btn) {
  btn.disabled = true;
  const res = await api("/api/trash-" + what, { kind: i.kind, id: i.id, where: i.where }).catch(() => ({ ok: false }));
  if (!res.ok) {
    btn.disabled = false;
    $("trashNote").hidden = false;
    $("trashNote").textContent = res.error || "That didn't work. Try again.";
    return;
  }
  trashItems = trashItems.filter((x) => x !== i);
  drawTrash();
  if (what === "restore") trashRefreshTabs(i.kind);
}

// Something came back: the tab it belongs to shows it again.
function trashRefreshTabs(kind) {
  if (kind === "doc" && typeof loadDocsList === "function") loadDocsList();
  if (kind === "board" && typeof bdLoadHome === "function") bdLoadHome();
  if (kind === "sound" && typeof loadSfx === "function") loadSfx({ quiet: true });
}

$("trashEmpty").addEventListener("click", async () => {
  if (!trashSure.has("*")) {
    trashSure.add("*");
    drawTrash();
    setTimeout(() => { if (trashSure.delete("*")) drawTrash(); }, 4000);
    return;
  }
  trashSure.delete("*");
  $("trashEmpty").disabled = true;
  const res = await api("/api/trash-empty", {}).catch(() => ({ ok: false }));
  if (!res.ok) {
    $("trashNote").hidden = false;
    $("trashNote").textContent = res.error || "That didn't work. Try again.";
  }
  loadTrash();
});

document.querySelectorAll("#trashFilters button").forEach((b) => b.addEventListener("click", () => {
  trashKind = b.dataset.kind;
  drawTrash();
}));

// The "Trash" buttons on the Docs, Boards and Library pages open this page.
function openTrash() {
  if (typeof openSettings === "function") openSettings("trash");
}
["docsTrash", "bdTrash"].forEach((id) => { if ($(id)) $(id).addEventListener("click", openTrash); });
