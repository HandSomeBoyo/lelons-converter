// (Beta) Projects: edit videos together. One shared folder per video: the footage, every saved cut,
// notes at an exact second of a cut, and music and sounds from the Library. Only one person edits at a
// time: "Edit in Resolve" gets everything onto this PC and writes the cut's timeline for File > Import >
// Timeline; "Upload new cut" takes the timeline Resolve exports (File > Export > Timeline, FCPXML).
// The work is done by editprojects.py (/api/pj-*). Uses $ and api() from app.js, showTab() from images.js,
// avatarEl()/openLogin()/sfxUser() from sfx.js, timeAgo() from docs.js.

const PJ_KINDS = [
  { key: "video", name: "YouTube video" }, { key: "short", name: "Short" }, { key: "film", name: "Short film" },
  { key: "vlog", name: "Vlog" }, { key: "stream", name: "Stream highlights" }, { key: "other", name: "Something else" },
];
const PJ_STAGES = [
  { key: "footage", name: "Footage" }, { key: "rough", name: "Rough cut" }, { key: "fine", name: "Fine cut" },
  { key: "color", name: "Color" }, { key: "sound", name: "Sound" }, { key: "export", name: "Export" },
];
const PJ_ROLES = [
  { key: "editor", name: "Editor", about: "Edits in Resolve, adds footage and notes" },
  { key: "footage", name: "Footage", about: "Adds footage and notes" },
  { key: "notes", name: "Notes only", about: "Watches cuts and leaves notes" },
];
const PJ_FOLDERS = ["A-cam", "B-cam", "Audio", "Graphics"];
const pjKindName = (k) => (PJ_KINDS.find((x) => x.key === k) || PJ_KINDS[0]).name;
const pjStageName = (k) => k === "done" ? "Done" : (PJ_STAGES.find((x) => x.key === k) || PJ_STAGES[0]).name;
const pjRoleName = (k) => (PJ_ROLES.find((x) => x.key === k) || PJ_ROLES[0]).name;

const PJ_ICONS = {
  doc: '<path d="M4 7h16M4 12h10M4 17h13"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z"/>',
  note: '<path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19.5l1.5-4.3A7.5 7.5 0 1 1 20 11.5z"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  resolve: '<path d="M12 3.5 6.8 6.5v6L12 15.5l5.2-3v-6z"/><path d="M6.8 12.5 3.5 14.4v3.8L6.8 20l3.3-1.9"/><path d="M17.2 12.5l3.3 1.9v3.8L17.2 20l-3.3-1.9"/>',
  up: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  down: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
};
function pjIcon(name, cls = "pj-icon") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PJ_ICONS[name] || ""}</svg>`;
}
function pjEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  if (tag === "button") el.type = "button";
  return el;
}
function pjButton(label, cls, onClick, icon) {
  const b = pjEl("button", cls);
  b.innerHTML = icon ? pjIcon(icon) : "";
  b.append(document.createTextNode(label));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
function pjSize(bytes) {
  if (!bytes) return "0 MB";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1) + " GB";
  return Math.max(1, Math.round(bytes / 1e6)) + " MB";
}
function pjClock(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
const pjAgo = (when) => typeof timeAgo === "function" ? timeAgo(when) : "";
const pjStem = (name) => String(name || "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
function pjFace(person, cls = "") {
  const el = typeof avatarEl === "function" ? avatarEl(person.avatarUrl || "", person.username || "?", "pj-av " + cls)
    : pjEl("span", "pj-av " + cls, (person.username || "?")[0].toUpperCase());
  el.title = person.username || "";
  return el;
}
function pjFileUrl(store, path) {
  return store && path ? store.base + path.split("/").map(encodeURIComponent).join("/") + "?Authorization=" + encodeURIComponent(store.auth) : "";
}
function pjStill(store, thumb, icon = "film") {
  const box = pjEl("div", "pj-still");
  if (thumb && store) {
    const img = pjEl("img");
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => { img.remove(); box.insertAdjacentHTML("afterbegin", pjIcon(icon, "")); };
    img.src = pjFileUrl(store, thumb);
    box.append(img);
  } else {
    box.innerHTML = pjIcon(icon, "");
  }
  return box;
}
const pjLoggedIn = () => typeof sfxUser === "function" && !!sfxUser();
const pjMe = () => (pjLoggedIn() && sfxUser().username) || "";

// What happened, in words ("Kim added 6 clips to A-cam").
function pjEventText(e) {
  const who = e.by === pjMe() ? "You" : (e.by || "Someone");
  switch (e.kind) {
    case "made": return `${who} made the project`;
    case "joined": return `${who} joined`;
    case "files": {
      const [n, ...rest] = String(e.detail || "").split(" ");
      return `${who} added ${n === "1" ? "a clip" : n + " clips"} to ${rest.join(" ") || "Footage"}`;
    }
    case "sound": return `${who} added "${e.detail}" from the Library`;
    case "editing": return `${who} started editing`;
    case "stopped": return `${who} stopped editing`;
    case "cut": return `${who} uploaded ${e.detail}`;
    case "note": return `${who} left a note: "${e.detail}"`;
    case "stage": return `${who} moved it to ${pjStageName(e.detail)}`;
    case "ask": return `${who} asked ${e.detail === pjMe() ? "you" : e.detail} for a turn`;
    default: return who;
  }
}

// ---- the dialog (one, filled in for each use)

let pjModalGo = null;
function pjDialog({ title, sub = "", body = null, go = "OK", cancel = "Cancel", onGo = null, wide = false }) {
  $("pjModalHeading").textContent = title;
  $("pjModalSub").textContent = sub;
  $("pjModalSub").hidden = !sub;
  $("pjModalBody").replaceChildren(...(body ? [body] : []));
  $("pjModalNote").textContent = "";
  $("pjModalGo").textContent = go;
  $("pjModalGo").hidden = !onGo;
  $("pjModalGo").disabled = false;
  $("pjModalCancel").textContent = cancel;
  $("pjModal").querySelector(".dialog").classList.toggle("pj-wide", wide);
  pjModalGo = onGo;
  $("pjModal").hidden = false;
  const first = $("pjModalBody").querySelector("input:not([type=checkbox])");
  if (first) setTimeout(() => first.focus(), 30);
}
const pjCloseDialog = () => { $("pjModal").hidden = true; pjModalGo = null; };
const pjDialogNote = (text) => { $("pjModalNote").textContent = text || ""; };
$("pjModalGo").addEventListener("click", async () => {
  if (!pjModalGo) return pjCloseDialog();
  $("pjModalGo").disabled = true;
  let close = false;
  try { close = await pjModalGo(); } catch { pjDialogNote("That didn't work. Try again."); }
  $("pjModalGo").disabled = false;
  if (close) pjCloseDialog();
});
$("pjModalCancel").addEventListener("click", pjCloseDialog);
$("pjModal").addEventListener("click", (e) => { if (e.target === $("pjModal")) pjCloseDialog(); });
$("pjModalBody").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input:not([type=checkbox])") && pjModalGo) { e.preventDefault(); $("pjModalGo").click(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("pjModal").hidden) pjCloseDialog(); });

function pjField(label, input) {
  const wrap = pjEl("label", "fx-field");
  wrap.append(pjEl("span", "", label));
  if (input.tagName === "INPUT") {
    const box = pjEl("span", "input");
    box.append(input);
    wrap.append(box);
  } else wrap.append(input);
  return wrap;
}

// ---- the list of projects

let pjData = null, pjFilter = "all", pjOpen = null, pjView = "overview", pjBinFolder = "", pjCutId = "";

async function loadPj() {
  const res = await api("/api/pj-list", {}).catch(() => ({ ok: false, error: "Couldn't load the projects." }));
  if (res.loggedOut && typeof sfxLoggedOut === "function") sfxLoggedOut();
  if (!res.ok) {
    $("pjStatus").textContent = res.error;
    $("pjStatus").hidden = false;
    return;
  }
  $("pjStatus").hidden = true;
  pjData = res;
  pjBadge();
  renderPjHome();
}

function pjBadge() {
  const n = pjData ? pjData.invites.length : 0;
  $("projectsTabBadge").textContent = n || "";
  $("projectsTabBadge").hidden = !n;
}

function renderPjHome() {
  const loggedIn = pjLoggedIn();
  $("pjOut").hidden = loggedIn;
  const ready = !!(pjData && pjData.ready);
  $("pjSetup").hidden = !loggedIn || !pjData || ready || !pjData.canSetup;
  $("pjWait").hidden = !loggedIn || !pjData || ready || pjData.canSetup;
  $("pjNew").hidden = !loggedIn || !ready;
  $("pjBar").hidden = !loggedIn || !pjData || !pjData.projects.length;
  if (!loggedIn || !pjData) {
    $("pjInvites").replaceChildren();
    $("pjGrid").replaceChildren();
    return;
  }
  $("pjInvites").replaceChildren(...pjData.invites.map((inv) => {
    const row = pjEl("div", "pj-card pj-invite");
    const text = pjEl("div");
    text.append(pjEl("b", "", inv.from), document.createTextNode(" invited you to "), pjEl("b", "", inv.name),
      document.createTextNode(" as "), pjEl("span", "pj-role y", pjRoleName(inv.role)));
    const answer = async (join) => {
      const res = await api("/api/pj-answer", { project: inv.id, join }).catch(() => ({ ok: false, error: "That didn't work." }));
      if (!res.ok) return alert(res.error);
      await loadPj();
      if (join) openPj(inv.id);
    };
    row.append(pjFace({ username: inv.from, avatarUrl: inv.avatarUrl }, "big"), text,
      pjButton("Not now", "ghost-button", () => answer(false)), pjButton("Join", "small-button", () => answer(true)));
    return row;
  }));
  document.querySelectorAll("#pjFilter button").forEach((b) => b.classList.toggle("on", b.dataset.f === pjFilter));
  const shown = pjData.projects.filter((p) => pjFilter === "mine" ? p.mine : pjFilter === "shared" ? !p.mine
    : pjFilter === "done" ? p.stage === "done" : true);
  const tiles = shown.map((p) => pjTile(p));
  if (ready && pjFilter === "all") {
    const add = pjEl("button", "pj-tile pj-add-tile");
    add.innerHTML = `<div>${pjIcon("plus", "pj-icon")}<b>New project</b><span class="pj-small">Start a folder for a video</span></div>`;
    add.addEventListener("click", pjNewProject);
    tiles.push(add);
  }
  if (!tiles.length) tiles.push(pjEl("p", "pj-empty", pjData.projects.length ? "Nothing here." : ""));
  $("pjGrid").replaceChildren(...tiles);
}

function pjTile(p) {
  const tile = pjEl("button", "pj-tile");
  const still = pjStill(pjData.store, p.cover);
  const tag = pjEl("span", "pj-tag " + (p.stage === "done" ? "g" : p.stage === "footage" ? "" : "y"), pjStageName(p.stage));
  still.append(tag);
  const title = pjEl("div");
  const bits = [pjKindName(p.kind)];
  if (p.seconds) bits.push(pjClock(p.seconds));
  bits.push(p.people.filter((x) => x.joined).length === 1 ? "Just you" : p.people.filter((x) => x.joined).length + " people");
  title.append(pjEl("b", "t", p.name), pjEl("div", "pj-muted pj-small", bits.join(" · ")));
  const bar = pjEl("div", "pj-bar-line" + (p.stage === "done" ? " done" : ""));
  const fill = pjEl("i");
  const step = p.stage === "done" ? PJ_STAGES.length : PJ_STAGES.findIndex((s) => s.key === p.stage) + 1;
  fill.style.width = Math.max(4, Math.round((step / PJ_STAGES.length) * 100)) + "%";
  bar.append(fill);
  const row = pjEl("div", "pj-row");
  const faces = pjEl("div", "pj-avs");
  faces.append(...p.people.filter((x) => x.joined).slice(0, 5).map((x) => pjFace(x)));
  const last = p.editor ? `${p.editor === pjMe() ? "You're" : p.editor + " is"} editing now` : p.last ? pjEventText(p.last) : "";
  row.append(faces, pjEl("span", "pj-muted pj-small", last));
  tile.append(still, title, bar, row);
  tile.addEventListener("click", () => openPj(p.id));
  return tile;
}

$("pjFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  pjFilter = b.dataset.f;
  renderPjHome();
});
$("pjNew").addEventListener("click", () => pjNewProject());
$("pjLogin").addEventListener("click", () => openLogin("login"));
$("pjB2Site").addEventListener("click", () => api("/api/docs-open-link", { url: "https://www.backblaze.com/sign-up/cloud-storage" }));
$("pjSetupGo").addEventListener("click", async () => {
  const keyId = $("pjKeyId").value.trim(), key = $("pjKey").value.trim();
  if (!keyId || !key) { $("pjSetupNote").textContent = "Paste both the keyID and the applicationKey."; return; }
  $("pjSetupGo").disabled = true;
  $("pjSetupNote").textContent = "Setting it up...";
  const res = await api("/api/pj-setup", { keyId, key }).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  $("pjSetupGo").disabled = false;
  if (!res.ok) { $("pjSetupNote").textContent = res.error; return; }
  $("pjKeyId").value = $("pjKey").value = "";
  pjData = res;
  renderPjHome();
});

function pjNewProject() {
  const body = pjEl("div");
  const name = pjEl("input");
  Object.assign(name, { maxLength: 80, placeholder: "Night Shift", autocomplete: "off" });
  let kind = "video";
  const kinds = pjEl("div", "pj-kinds");
  for (const k of PJ_KINDS) {
    const b = pjEl("button", k.key === kind ? "on" : "", k.name);
    b.addEventListener("click", () => { kind = k.key; kinds.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    kinds.append(b);
  }
  const about = pjEl("textarea");
  Object.assign(about, { maxLength: 600, placeholder: "What's it about? Anything the crew should know." });
  const kindField = pjEl("div", "fx-field");
  kindField.append(pjEl("span", "", "What is it?"), kinds);
  body.append(pjField("Name", name), kindField, pjField("About it (optional)", about));
  body.className = "pj-modal-body";
  pjDialog({
    title: "New project", sub: "A shared folder for one video. You invite your crew next.", body, go: "Make the project",
    onGo: async () => {
      if (!name.value.trim()) { pjDialogNote("Give it a name."); return false; }
      const res = await api("/api/pj-create", { name: name.value, kind, about: about.value }).catch(() => ({ ok: false, error: "That didn't work." }));
      if (!res.ok) { pjDialogNote(res.error); return false; }
      await loadPj();
      openPj(res.id);
      return true;
    },
  });
}

// ---- one project

async function openPj(id, quiet = false) {
  const res = await api("/api/pj-open", { project: id }).catch(() => ({ ok: false, error: "Couldn't open the project." }));
  if (!res.ok) {
    if (!quiet) alert(res.error);
    if (!quiet) closePj();
    return;
  }
  const changed = !pjOpen || pjOpen.project.id !== id;
  pjOpen = res;
  if (changed) {
    pjView = "overview";
    pjBinFolder = "";
    pjCutId = res.cuts[0] ? res.cuts[0].id : "";
  }
  if (pjCutId && !res.cuts.some((c) => c.id === pjCutId)) pjCutId = res.cuts[0] ? res.cuts[0].id : "";
  $("pjHome").hidden = true;
  $("pjPage").hidden = false;
  renderPj();
}

function closePj() {
  pjOpen = null;
  pjStopVideo();
  $("pjPage").hidden = true;
  $("pjPage").replaceChildren();
  $("pjHome").hidden = false;
  loadPj();
}

const pjCanEdit = () => pjOpen && pjOpen.role === "editor";
const pjCanAdd = () => pjOpen && pjOpen.role !== "notes";
const pjIsOwner = () => pjOpen && pjOpen.project.mine;
const pjFootage = () => pjOpen.files.filter((f) => f.kind === "footage");
const pjSoundsIn = () => pjOpen.files.filter((f) => f.kind === "sound");

function pjStopVideo() {
  const v = $("pjPage").querySelector("video");
  if (v) v.pause();
}

function renderPj() {
  if (!pjOpen) return;
  const keepScroll = $("pjPage").querySelector(".pj-notes") ? $("pjPage").querySelector(".pj-notes").scrollTop : 0;
  const video = $("pjPage").querySelector("video");
  if (video && pjView === "notes" && video.dataset.cut === pjCutId) {
    // (the cut playing keeps playing: only the parts around it are drawn again)
    pjDrawNotesSide();
    return;
  }
  pjStopVideo();
  const p = pjOpen.project;
  const page = $("pjPage");
  const crumbs = pjEl("div", "pj-crumbs");
  crumbs.append(pjButton("Projects", "", closePj), pjEl("span", "", "›"), pjEl("b", "", p.name));

  const head = pjEl("div", "pj-head");
  const cover = pjStill(pjOpen.store, p.cover);
  const main = pjEl("div", "pj-head-main");
  const row = pjEl("div", "pj-head-row");
  const buttons = pjEl("div", "pj-buttons");
  if (pjCanEdit()) {
    if (p.editor === pjMe()) buttons.append(pjButton("Upload new cut", "convert small-button", pjUploadCut, "up"));
    else if (!p.editor) buttons.append(pjButton("Edit in Resolve", "convert small-button", () => pjYourTurn(), "resolve"));
  }
  buttons.append(pjButton("", "ghost-button pj-more", pjMenu, "more"));
  buttons.lastChild.title = "More";
  row.append(pjEl("h1", "", p.name), pjEl("span", "pj-tag " + (p.stage === "done" ? "g" : "y"), pjStageName(p.stage)), buttons);
  const footage = pjFootage();
  const meta = [pjKindName(p.kind)];
  if (pjOpen.cuts[0]) meta.push(`Latest: Cut ${pjOpen.cuts[0].n}${pjOpen.cuts[0].seconds ? " (" + pjClock(pjOpen.cuts[0].seconds) + ")" : ""}`);
  meta.push(`${footage.length} clip${footage.length === 1 ? "" : "s"}, ${pjSize(footage.reduce((a, f) => a + f.size, 0))}`);
  const steps = pjEl("div", "pj-steps");
  const at = p.stage === "done" ? PJ_STAGES.length : PJ_STAGES.findIndex((s) => s.key === p.stage);
  PJ_STAGES.forEach((s, i) => {
    const b = pjEl("button", i < at ? "done" : i === at ? "now" : "", s.name);
    b.disabled = !pjCanEdit();
    if (pjCanEdit()) b.title = "Move the project to " + s.name;
    b.addEventListener("click", () => pjSetStage(i === at && i === PJ_STAGES.length - 1 ? "done" : s.key));
    steps.append(b);
  });
  main.append(row, pjEl("div", "pj-head-meta", meta.join(" · ")));
  if (p.about) main.append(pjEl("div", "pj-head-meta", p.about));
  main.append(steps);
  head.append(cover, main);

  const parts = [crumbs, head];
  if (p.editor) parts.push(pjLockBar());
  const tabs = pjEl("div", "pj-subtabs");
  const openNotes = pjOpen.notes.filter((n) => !n.done).length;
  for (const [key, label, count] of [["overview", "Overview"], ["footage", "Footage", footage.length], ["cuts", "Cuts", pjOpen.cuts.length],
    ["notes", "Notes", openNotes], ["sounds", "Music & sounds", pjSoundsIn().length]]) {
    const b = pjEl("button", key === pjView ? "on" : "", label);
    if (count) b.append(pjEl("em", "", count));
    b.addEventListener("click", () => { pjView = key; renderPj(); });
    tabs.append(b);
  }
  parts.push(tabs);
  const view = pjEl("div", "pj-view");
  ({ overview: pjOverview, footage: pjFootageView, cuts: pjCutsView, notes: pjNotesView, sounds: pjSoundsView })[pjView](view);
  parts.push(view);
  page.replaceChildren(...parts);
  if (pjView === "notes") pjDrawNotesSide();
  const notes = page.querySelector(".pj-notes");
  if (notes) notes.scrollTop = keepScroll;
}

function pjLockBar() {
  const p = pjOpen.project;
  const bar = pjEl("div", "pj-card pj-lockbar");
  const icon = pjEl("span", "pj-lockicon");
  icon.innerHTML = pjIcon("lock");
  const text = pjEl("div");
  const since = pjOpen.editingSince ? new Date(pjOpen.editingSince * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  if (p.editor === pjMe()) {
    text.append(pjEl("b", "", "You're editing"),
      pjEl("span", "pj-muted pj-small", `Since ${since}. When you're done, export the timeline from Resolve and upload it as the new cut. Nobody else can edit until then.`));
    bar.append(icon, text, pjButton("Stop editing", "ghost-button", pjStopEditing), pjButton("Upload new cut", "small-button", pjUploadCut));
  } else {
    const person = p.people.find((x) => x.username === p.editor) || { username: p.editor };
    text.append(pjEl("b", "", `${p.editor} is editing right now`),
      pjEl("span", "pj-muted pj-small", `Since ${since}. You'll get the new cut when ${p.editor} is done, so two people never edit the same timeline at once.`));
    bar.append(icon, pjFace(person, "big"), text);
    if (pjIsOwner()) bar.append(pjButton("Take over", "ghost-button", () => pjYourTurn(true)));
    bar.append(pjButton("Ask for a turn", "ghost-button", async (e) => {
      const res = await api("/api/pj-ask_turn", { project: p.id }).catch(() => ({ ok: false }));
      e.target.textContent = res.ok ? "Asked" : "Try again";
      e.target.disabled = !!res.ok;
    }));
  }
  return bar;
}

function pjFold(icon, title, from, action) {
  const card = pjEl("div", "pj-card pj-fold");
  const head = pjEl("div", "pj-fh");
  const ic = pjEl("span", "pj-ic");
  ic.innerHTML = pjIcon(icon);
  const text = pjEl("div");
  text.append(pjEl("b", "n", title), pjEl("span", "from", from));
  head.append(ic, text);
  if (action) head.append(action);
  card.append(head);
  return card;
}

function pjOverview(view) {
  const two = pjEl("div", "pj-two");
  const folders = pjEl("div", "pj-folders");
  const footage = pjFootage();
  const here = footage.filter((f) => f.here).length;
  const newest = [...footage].sort((a, b) => b.created - a.created);
  const f1 = pjFold("film", "Footage", footage.length ? `${footage.length} clips · ${here === footage.length ? "all on your PC" : here + " on your PC"}` : "Nothing yet",
    pjButton(footage.length ? "See all" : "Add", "link pj-small", () => { pjView = "footage"; renderPj(); }));
  const mini = pjEl("div", "pj-mini");
  mini.append(...newest.slice(0, 4).map((f) => pjStill(pjOpen.store, f.thumb)));
  if (footage.length) f1.append(mini);
  else f1.append(pjEl("p", "pj-help", pjCanAdd() ? "Drop everyone's clips here. They download to each PC by themselves when it's your turn." : "The crew hasn't added footage yet."));

  const f2 = pjFold("doc", "Cuts", "Every saved version of the edit", pjButton("See all", "link pj-small", () => { pjView = "cuts"; renderPj(); }));
  const cuts = pjEl("ul", "pj-list");
  cuts.append(...pjOpen.cuts.slice(0, 3).map((c) => {
    const li = pjEl("li");
    li.append(pjEl("span", "tx", `Cut ${c.n}${c.note ? " · " + c.note : ""}`), pjEl("span", "pj-muted pj-small", `${c.by || "?"} · ${pjAgo(c.created)}`));
    return li;
  }));
  if (pjOpen.cuts.length) f2.append(cuts);
  else f2.append(pjEl("p", "pj-help", "No cut yet. Press Edit in Resolve to start one from all the footage."));

  const latest = pjOpen.cuts[0];
  const notes = latest ? pjOpen.notes.filter((n) => n.cut === latest.id) : [];
  const open = notes.filter((n) => !n.done);
  const f3 = pjFold("note", latest ? `Notes on Cut ${latest.n}` : "Notes", latest ? `${open.length} to fix · ${notes.length - open.length} done` : "Waiting for the first cut",
    latest ? pjButton("Watch", "link pj-small", () => { pjView = "notes"; pjCutId = latest.id; renderPj(); }) : null);
  const list = pjEl("ul", "pj-list");
  list.append(...notes.slice(0, 4).map((n) => {
    const li = pjEl("li", n.done ? "done" : "");
    li.append(pjEl("span", "pj-tag " + (n.done ? "" : "y"), pjClock(n.at)), pjEl("span", "tx", n.body), pjFace({ username: n.by }, "tiny"));
    return li;
  }));
  if (notes.length) f3.append(list);
  else if (latest) f3.append(pjEl("p", "pj-help", "Watch the cut and click to leave a note at an exact second."));

  const sounds = pjSoundsIn();
  const f4 = pjFold("music", "Music & sounds", "From the Library · comes along with the footage",
    pjCanAdd() ? pjButton("Add", "link pj-small", pjAddSound) : null);
  const sl = pjEl("ul", "pj-list");
  sl.append(...sounds.slice(0, 4).map((s) => { const li = pjEl("li"); li.append(pjEl("span", "tx", pjStem(s.name))); return li; }));
  if (sounds.length) f4.append(sl);
  else f4.append(pjEl("p", "pj-help", "Pick songs and sound effects from the Library. Everyone gets the same files."));
  folders.append(f1, f2, f3, f4);

  const side = pjEl("div");
  side.append(pjCrewBox(), pjNewsBox());
  two.append(folders, side);
  view.append(two);
}

function pjCrewBox() {
  const p = pjOpen.project;
  const box = pjEl("div", "pj-card pj-side");
  const head = pjEl("div", "pj-hrow");
  head.append(pjEl("h3", "", "Crew"), pjEl("span", "spacer"));
  if (pjIsOwner()) head.append(pjButton("Invite", "link pj-small", pjInvite));
  box.append(head);
  for (const person of p.people) {
    const row = pjEl("div", "pj-person");
    const text = pjEl("div");
    const state = !person.joined ? "Invited" : p.editor === person.username ? "Editing now" : person.here ? "Here now" : person.owner ? "Owner" : "";
    text.append(pjEl("b", "", person.username), pjEl("span", "pj-muted pj-small", state));
    row.append(pjFace(person, "big"), text);
    if (pjIsOwner() && !person.owner) {
      const pick = pjEl("select");
      for (const r of PJ_ROLES) { const o = pjEl("option", "", r.name); o.value = r.key; pick.append(o); }
      pick.value = person.role;
      pick.title = "What they can do";
      pick.addEventListener("change", async () => {
        const res = await api("/api/pj-role", { project: p.id, username: person.username, role: pick.value }).catch(() => ({ ok: false }));
        if (!res.ok) alert(res.error || "Couldn't change it.");
        openPj(p.id, true);
      });
      const x = pjButton("", "pj-x", async () => {
        if (!confirm(`Take ${person.username} out of this project?`)) return;
        await api("/api/pj-remove", { project: p.id, username: person.username }).catch(() => null);
        openPj(p.id, true);
      }, "x");
      x.title = "Take out of the project";
      row.append(pick, x);
    } else {
      row.append(pjEl("span", "pj-role" + (person.role === "editor" ? " y" : ""), pjRoleName(person.role)));
    }
    box.append(row);
  }
  return box;
}

function pjNewsBox() {
  const box = pjEl("div", "pj-card pj-side");
  box.append(pjEl("h3", "", "What's new"));
  for (const e of pjOpen.events.slice(0, 8)) {
    const row = pjEl("div", "pj-act");
    const text = pjEl("div", "", pjEventText(e));
    text.append(pjEl("small", "", pjAgo(e.at)));
    row.append(pjFace({ username: e.by || "?" }, "tiny"), text);
    box.append(row);
  }
  return box;
}

async function pjSetStage(stage) {
  if (!pjCanEdit()) return;
  const res = await api("/api/pj-edit", { project: pjOpen.project.id, stage }).catch(() => ({ ok: false }));
  if (!res.ok) return alert(res.error || "Couldn't change it.");
  openPj(pjOpen.project.id, true);
}

function pjMenu(e) {
  const p = pjOpen.project;
  const menu = pjEl("div", "lib-menu pj-menu");
  const add = (label, fn) => { const b = pjEl("button", "", label); b.addEventListener("click", () => { menu.remove(); fn(); }); menu.append(b); };
  if (pjIsOwner()) add("Invite people", pjInvite);
  if (pjCanEdit()) add("Rename or change it", pjRename);
  add("Open the folder on this PC", () => api("/api/pj-show", { path: pjOpen.folder }));
  if (pjFootage().some((f) => !f.here) || pjSoundsIn().some((f) => !f.here)) add("Download everything", pjGetAll);
  if (pjIsOwner()) add("Delete the project", async () => {
    if (!confirm(`Delete "${p.name}" with all its footage and cuts for everyone? This can't be undone. (The files on your PC stay.)`)) return;
    const res = await api("/api/pj-delete", { project: p.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
    if (!res.ok) return alert(res.error);
    closePj();
  });
  else add("Leave the project", async () => {
    if (!confirm(`Leave "${p.name}"? The files on your PC stay.`)) return;
    const res = await api("/api/pj-leave", { project: p.id }).catch(() => ({ ok: false, error: "Couldn't leave." }));
    if (!res.ok) return alert(res.error);
    closePj();
  });
  const r = e.currentTarget.getBoundingClientRect();
  Object.assign(menu.style, { position: "fixed", top: r.bottom + 6 + "px", right: Math.max(8, innerWidth - r.right) + "px", zIndex: 60 });
  document.body.append(menu);
  setTimeout(() => document.addEventListener("pointerdown", function away(ev) {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("pointerdown", away); }
  }), 0);
}

function pjRename() {
  const p = pjOpen.project;
  const body = pjEl("div", "pj-modal-body");
  const name = pjEl("input");
  Object.assign(name, { maxLength: 80, value: p.name });
  const about = pjEl("textarea");
  Object.assign(about, { maxLength: 600, value: p.about || "" });
  let kind = p.kind;
  const kinds = pjEl("div", "pj-kinds");
  for (const k of PJ_KINDS) {
    const b = pjEl("button", k.key === kind ? "on" : "", k.name);
    b.addEventListener("click", () => { kind = k.key; kinds.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    kinds.append(b);
  }
  const kindField = pjEl("div", "fx-field");
  kindField.append(pjEl("span", "", "What is it?"), kinds);
  body.append(pjField("Name", name), kindField, pjField("About it", about));
  pjDialog({ title: "Change the project", body, go: "Save", onGo: async () => {
    const res = await api("/api/pj-edit", { project: p.id, name: name.value, about: about.value, kind }).catch(() => ({ ok: false, error: "That didn't work." }));
    if (!res.ok) { pjDialogNote(res.error); return false; }
    openPj(p.id, true);
    return true;
  } });
}

async function pjInvite() {
  const p = pjOpen.project;
  const res = await api("/api/pj-people", {}).catch(() => ({ ok: false, error: "Couldn't load the people." }));
  if (!res.ok) return alert(res.error);
  const inside = new Set(p.people.map((x) => x.username.toLowerCase()));
  const body = pjEl("div", "pj-modal-body");
  let role = "editor";
  const roles = pjEl("div", "pj-kinds");
  for (const r of PJ_ROLES) {
    const b = pjEl("button", r.key === role ? "on" : "");
    b.append(document.createTextNode(r.name), pjEl("small", "pj-muted pj-small", ""));
    b.lastChild.style.display = "block";
    b.lastChild.textContent = r.about;
    b.addEventListener("click", () => { role = r.key; roles.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    roles.append(b);
  }
  const roleField = pjEl("div", "fx-field");
  roleField.append(pjEl("span", "", "What they can do"), roles);
  const list = pjEl("div", "pj-sounds");
  const picked = new Set();
  const people = res.people.filter((x) => !inside.has(x.username.toLowerCase()));
  for (const person of people) {
    const row = pjEl("label", "pj-check");
    const box = pjEl("input");
    box.type = "checkbox";
    box.addEventListener("change", () => box.checked ? picked.add(person.username) : picked.delete(person.username));
    row.append(box, pjEl("span", "", person.username), pjFace(person, "tiny"));
    list.append(row);
  }
  if (!people.length) list.append(pjEl("p", "pj-help", "Everyone is in this project already."));
  body.append(roleField, list);
  pjDialog({ title: "Invite people", sub: `They get an invitation on their Projects page. Editors can take turns editing in Resolve.`, body, go: "Invite",
    onGo: async () => {
      if (!picked.size) { pjDialogNote("Pick someone first."); return false; }
      const r = await api("/api/pj-invite", { project: p.id, usernames: [...picked], role }).catch(() => ({ ok: false, error: "That didn't work." }));
      if (!r.ok) { pjDialogNote(r.error); return false; }
      openPj(p.id, true);
      return true;
    } });
}

// ---- footage

function pjFootageView(view) {
  const footage = pjFootage();
  const folders = [...new Set([...footage.map((f) => f.folder)])].sort((a, b) => a.localeCompare(b));
  if (pjBinFolder && !folders.includes(pjBinFolder) && !pjBinFolder.startsWith("+")) pjBinFolder = "";
  const bin = pjEl("div", "pj-bin");
  const side = pjEl("div");
  const list = pjEl("div", "pj-bin-side");
  const pick = (name, label, count) => {
    const b = pjEl("button", pjBinFolder === name ? "on" : "", label);
    b.append(pjEl("em", "", count));
    b.addEventListener("click", () => { pjBinFolder = name; renderPj(); });
    list.append(b);
  };
  pick("", "All footage", footage.length);
  for (const f of folders) pick(f, f, footage.filter((x) => x.folder === f).length);
  if (pjCanAdd()) {
    const add = pjButton("New folder", "", () => {
      const name = (prompt("Name of the folder (like A-cam, Drone or Audio):", PJ_FOLDERS.find((f) => !folders.includes(f)) || "") || "").trim().slice(0, 40);
      if (!name) return;
      pjBinFolder = name;
      pjNewFolders.add(name);
      renderPj();
    }, "plus");
    list.append(add);
  }
  for (const f of pjNewFolders) if (!folders.includes(f)) {
    const b = pjEl("button", pjBinFolder === f ? "on" : "", f);
    b.append(pjEl("em", "", 0));
    b.addEventListener("click", () => { pjBinFolder = f; renderPj(); });
    list.insertBefore(b, list.lastChild);
  }
  const here = footage.filter((f) => f.here);
  const pc = pjEl("div", "pj-card pj-side");
  pc.style.marginTop = "14px";
  pc.append(pjEl("b", "", "On your PC"));
  const bar = pjEl("div", "pj-bar-line done");
  const fill = pjEl("i");
  fill.style.width = (footage.length ? Math.round((here.length / footage.length) * 100) : 0) + "%";
  bar.append(fill);
  pc.append(bar, pjEl("span", "pj-muted pj-small", footage.length ? `${here.length} of ${footage.length} clips.` : "Nothing yet."));
  const missing = footage.filter((f) => !f.here);
  if (missing.length) pc.append(pjButton(`Download ${pjSize(missing.reduce((a, f) => a + f.size, 0))}`, "small-button", pjGetAll, "down"));
  side.append(list, pc);

  const main = pjEl("div");
  const head = pjEl("div", "pj-hrow");
  head.style.marginBottom = "12px";
  head.append(pjEl("h3", "pj-sec", pjBinFolder || "All footage"),
    pjEl("span", "pj-muted pj-small", "Shared footage. Everyone in the project sees the same clips."), pjEl("span", "spacer"));
  if (pjCanAdd()) head.append(pjButton("Add footage", "small-button", () => pjPickFootage(), "up"));
  const shown = footage.filter((f) => !pjBinFolder || f.folder === pjBinFolder);
  const grid = pjEl("div", "pj-clips");
  grid.append(...shown.map((f) => {
    const clip = pjEl("div", "pj-clip");
    const still = pjStill(pjOpen.store, f.thumb);
    if (f.seconds) still.append(pjEl("span", "dur", pjClock(f.seconds)));
    const who = pjEl("span", "who");
    who.append(pjFace({ username: f.by || "?" }, "tiny"));
    still.append(who);
    const name = pjEl("div", "cn");
    name.append(pjEl("span", "", f.name));
    name.lastChild.title = `${f.name} · ${pjSize(f.size)} · added by ${f.by || "?"}${f.folder ? " to " + f.folder : ""}`;
    name.append(pjEl("span", "pj-sync " + (f.here ? "ok" : "no"), f.here ? "✓" : "↓"));
    name.lastChild.title = f.here ? "On your PC" : "Not on your PC yet";
    if (f.by === pjMe() || pjIsOwner()) {
      const x = pjButton("", "pj-x", async () => {
        if (!confirm(`Delete ${f.name} from the project for everyone? (A copy on your PC stays.)`)) return;
        const res = await api("/api/pj-delete-file", { project: pjOpen.project.id, id: f.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
        if (!res.ok) return alert(res.error);
        openPj(pjOpen.project.id, true);
      }, "x");
      x.title = "Delete";
      name.append(x);
    }
    clip.append(still, name);
    return clip;
  }));
  main.append(head, grid);
  if (pjCanAdd()) {
    const drop = pjEl("div", "pj-drop");
    drop.innerHTML = `<b>Drop footage here</b> or click to pick files. It goes into <b></b>.`;
    drop.querySelectorAll("b")[1].textContent = pjBinFolder || "Footage";
    drop.addEventListener("click", () => pjPickFootage());
    main.append(drop);
  } else if (!shown.length) main.append(pjEl("p", "pj-empty", "No footage here yet."));
  const where = pjEl("div", "pj-card pj-where");
  const icon = pjEl("span", "pj-ic");
  icon.innerHTML = pjIcon("folder");
  const text = pjEl("div");
  text.append(pjEl("b", "", "On your PC in"), pjEl("span", "pj-muted pj-small", pjOpen.folder));
  where.append(icon, text, pjButton("Open folder", "link pj-small", () => api("/api/pj-show", { path: pjOpen.folder })));
  main.append(where);
  bin.append(side, main);
  view.append(bin);
}
const pjNewFolders = new Set();

async function pjPickFootage() {
  const folder = pjBinFolder || "Footage";
  const res = await api("/api/pj-pick-footage", { project: pjOpen.project.id, folder }).catch(() => ({ ok: false, fallback: true }));
  if (res.fallback) return pjFileInput(folder);
  if (!res.ok) return alert(res.error);
  if (res.added) pjPollJobs();
}

function pjFileInput(folder) {
  const input = pjEl("input");
  Object.assign(input, { type: "file", multiple: true, accept: "video/*,audio/*,image/*,.mov,.mxf,.braw,.r3d,.exr" });
  input.addEventListener("change", () => pjSendFiles([...input.files], folder));
  input.click();
}

function pjTakesDrop(files) {
  if ($("projectsTab").hidden || !pjOpen || !pjCanAdd() || pjView !== "footage") return false;
  pjSendFiles(files, pjBinFolder || "Footage");
  return true;
}

async function pjSendFiles(files, folder) {
  $("pjJobs").hidden = false;
  for (const file of files) {
    const res = await fetch("/api/pj-add", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name),
      "X-Project": pjOpen.project.id, "X-Folder": encodeURIComponent(folder) }, body: file })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't open " + file.name }));
    if (!res.ok) alert(res.error);
    pjPollJobs();
  }
}

async function pjGetAll() {
  const res = await api("/api/pj-get-all", { project: pjOpen.project.id }).catch(() => ({ ok: false, error: "Couldn't start the download." }));
  if (!res.ok) return alert(res.error);
  pjPollJobs();
}

// ---- cuts

function pjCutsView(view) {
  const head = pjEl("div", "pj-hrow");
  head.style.marginBottom = "12px";
  head.append(pjEl("h3", "pj-sec", "Cuts"), pjEl("span", "pj-muted pj-small", "Every version of the edit anyone uploaded, newest first."), pjEl("span", "spacer"));
  if (pjCanEdit() && pjOpen.project.editor === pjMe()) head.append(pjButton("Upload new cut", "small-button", pjUploadCut, "up"));
  view.append(head);
  if (!pjOpen.cuts.length) {
    view.append(pjEl("p", "pj-empty", pjCanEdit() ? "No cut yet. Press Edit in Resolve: you get a timeline with all the footage to start from." : "No cut yet. The editors upload one when they're done."));
    return;
  }
  for (const c of pjOpen.cuts) {
    const row = pjEl("div", "pj-cut");
    const notes = pjOpen.notes.filter((n) => n.cut === c.id);
    const text = pjEl("div");
    text.append(pjEl("b", "", `Cut ${c.n}`), document.createTextNode(c.note ? " · " + c.note : ""));
    text.append(pjEl("div", "pj-muted pj-small", `${c.by || "?"} · ${pjAgo(c.created)}${c.seconds ? " · " + pjClock(c.seconds) : ""} · ${notes.filter((n) => !n.done).length} open notes${c.video ? "" : " · no video to watch"}`));
    const icon = pjEl("span", "pj-ic");
    icon.innerHTML = pjIcon("doc");
    const buttons = pjEl("div", "pj-buttons");
    buttons.append(pjButton(c.video ? "Watch" : "Notes", "ghost-button", () => { pjCutId = c.id; pjView = "notes"; renderPj(); }));
    if (pjCanEdit() && !pjOpen.project.editor) buttons.append(pjButton("Edit from this cut", "ghost-button", () => pjYourTurn(false, c.id)));
    if (c.by === pjMe() || pjIsOwner()) {
      const x = pjButton("", "pj-x", async () => {
        if (!confirm(`Delete Cut ${c.n} and its notes for everyone?`)) return;
        const res = await api("/api/pj-delete-cut", { project: pjOpen.project.id, id: c.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
        if (!res.ok) return alert(res.error);
        openPj(pjOpen.project.id, true);
      }, "x");
      x.title = "Delete this cut";
      buttons.append(x);
    }
    row.append(icon, text, buttons);
    view.append(row);
  }
}

// ---- notes on a cut (watch it, click to leave a note at that second)

function pjNotesView(view) {
  if (!pjOpen.cuts.length) {
    view.append(pjEl("p", "pj-empty", "Notes go on a cut. There's no cut yet."));
    return;
  }
  const cut = pjOpen.cuts.find((c) => c.id === pjCutId) || pjOpen.cuts[0];
  pjCutId = cut.id;
  const two = pjEl("div", "pj-two");
  two.style.gridTemplateColumns = "minmax(0, 1fr) 330px";
  const left = pjEl("div", "pj-card pj-player");
  if (cut.video && pjOpen.store) {
    const video = pjEl("video");
    video.controls = true;
    video.preload = "metadata";
    video.dataset.cut = cut.id;
    video.src = pjFileUrl(pjOpen.store, cut.video);
    left.append(video);
  } else {
    left.append(pjEl("div", "pj-novideo", "This cut has no video to watch. Whoever uploads a cut can add a quick render (File › Quick Export in Resolve) so the crew can watch it here."));
  }
  const bar = pjEl("div", "pj-pbar");
  const top = pjEl("div", "pj-hrow");
  top.append(pjEl("b", "", `Cut ${cut.n}`), pjEl("span", "pj-muted pj-small", `by ${cut.by || "?"} · ${pjAgo(cut.created)}`), pjEl("span", "spacer"));
  if (pjOpen.cuts.length > 1) {
    const seg = pjEl("div", "pj-seg");
    for (const c of pjOpen.cuts.slice(0, 5).reverse()) {
      const b = pjEl("button", c.id === cut.id ? "on" : "", `Cut ${c.n}`);
      b.addEventListener("click", () => { pjCutId = c.id; renderPj(); });
      seg.append(b);
    }
    top.append(seg);
  }
  const scrub = pjEl("div", "pj-scrub");
  scrub.title = "Click to jump there";
  bar.append(top, scrub, pjEl("span", "pj-muted pj-small", cut.video ? "Pause where something should change and write a note. It's saved at that exact second." : "Type the time in the note box, like 1:42 Cut this shorter."));
  left.append(bar);
  const right = pjEl("div", "pj-card pj-side pj-notes-side");
  two.append(left, right);
  view.append(two);
  const video = left.querySelector("video");
  if (video) {
    video.addEventListener("timeupdate", () => pjDrawScrub());
    video.addEventListener("loadedmetadata", () => pjDrawScrub());
  }
  scrub.addEventListener("click", (e) => {
    const length = pjLength();
    if (!video || !length) return;
    const r = scrub.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length;
  });
}

const pjVideo = () => $("pjPage").querySelector(".pj-player video");
function pjLength() {
  const cut = pjOpen && pjOpen.cuts.find((c) => c.id === pjCutId);
  const v = pjVideo();
  return (v && isFinite(v.duration) && v.duration) || (cut && cut.seconds) || 0;
}

function pjDrawScrub() {
  const scrub = $("pjPage").querySelector(".pj-scrub");
  if (!scrub || !pjOpen) return;
  const length = pjLength(), v = pjVideo();
  const fill = pjEl("i");
  fill.style.width = length && v ? (v.currentTime / length) * 100 + "%" : "0";
  const marks = pjOpen.notes.filter((n) => n.cut === pjCutId && length).map((n) => {
    const m = pjEl("em", n.done ? "done" : "");
    m.style.left = Math.min(100, (n.at / length) * 100) + "%";
    m.title = `${pjClock(n.at)} ${n.by}: ${n.body}`;
    m.addEventListener("click", (e) => { e.stopPropagation(); if (v) v.currentTime = n.at; });
    return m;
  });
  scrub.replaceChildren(fill, ...marks);
}

function pjDrawNotesSide() {
  const side = $("pjPage").querySelector(".pj-notes-side");
  if (!side) return;
  const typing = side.querySelector("input");
  const draft = typing ? typing.value : "";
  const hadFocus = typing && document.activeElement === typing;
  const notes = pjOpen.notes.filter((n) => n.cut === pjCutId);
  const open = notes.filter((n) => !n.done);
  const head = pjEl("div", "pj-hrow");
  head.append(pjEl("h3", "", "Notes"), pjEl("span", "pj-tag " + (open.length ? "y" : "g"), open.length ? `${open.length} to fix` : "All done"));
  const list = pjEl("div", "pj-notes");
  for (const n of notes) {
    const row = pjEl("div", "pj-note" + (n.done ? " done" : ""));
    row.tabIndex = 0;
    const text = pjEl("div");
    text.append(pjEl("b", "", n.by + " "), document.createTextNode(n.body));
    const small = pjEl("small");
    small.append(pjEl("span", "", n.done ? `Fixed${n.doneBy ? " · " + n.doneBy : ""}` : pjAgo(n.created)));
    const done = pjEl("button", "", n.done ? "Not fixed" : "Fixed");
    done.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api("/api/pj-note_done", { project: pjOpen.project.id, id: n.id, done: !n.done }).catch(() => null);
      openPj(pjOpen.project.id, true);
    });
    small.append(done);
    if (n.by === pjMe() || pjIsOwner()) {
      const del = pjEl("button", "", "Delete");
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await api("/api/pj-note_delete", { project: pjOpen.project.id, id: n.id }).catch(() => null);
        openPj(pjOpen.project.id, true);
      });
      small.append(del);
    }
    text.append(small);
    row.append(pjEl("span", "tc", pjClock(n.at)), text);
    row.addEventListener("click", () => { const v = pjVideo(); if (v) { v.currentTime = n.at; v.pause(); } });
    list.append(row);
  }
  if (!notes.length) list.append(pjEl("p", "pj-help", "No notes on this cut yet."));
  const form = pjEl("form", "pj-note-form");
  const box = pjEl("label", "input");
  const input = pjEl("input");
  Object.assign(input, { maxLength: 1000, placeholder: "Leave a note at this second...", autocomplete: "off", value: draft });
  box.append(input);
  form.append(box, pjButton("Add", "small-button"));
  form.lastChild.type = "submit";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let body = input.value.trim();
    if (!body) return;
    const v = pjVideo();
    let at = v ? v.currentTime : 0;
    const typed = body.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$/);  // "1:42 Cut this shorter"
    if (typed) { at = (+typed[1] || 0) * 3600 + +typed[2] * 60 + +typed[3]; body = typed[4]; }
    const res = await api("/api/pj-note", { project: pjOpen.project.id, cut: pjCutId, at, body }).catch(() => ({ ok: false, error: "Couldn't save the note." }));
    if (!res.ok) return alert(res.error);
    input.value = "";
    openPj(pjOpen.project.id, true);
  });
  input.addEventListener("focus", () => { const v = pjVideo(); if (v) v.pause(); });
  side.replaceChildren(head, list, form);
  if (hadFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  pjDrawScrub();
}

// ---- music and sounds from the Library

function pjSoundsView(view) {
  const head = pjEl("div", "pj-hrow");
  head.style.marginBottom = "12px";
  head.append(pjEl("h3", "pj-sec", "Music & sounds"), pjEl("span", "pj-muted pj-small", "From the Library. They download with the footage, into the project's folder."), pjEl("span", "spacer"));
  if (pjCanAdd()) head.append(pjButton("Add from Library", "small-button", pjAddSound, "plus"));
  view.append(head);
  const sounds = pjSoundsIn();
  if (!sounds.length) return view.append(pjEl("p", "pj-empty", "Nothing picked yet."));
  const list = pjEl("ul", "pj-list");
  for (const s of sounds) {
    const li = pjEl("li");
    const play = pjButton("", "pj-x", () => pjPlay(s.url, play), "play");
    play.title = "Listen";
    li.append(play, pjEl("span", "tx", pjStem(s.name)), pjEl("span", "pj-muted pj-small", `${s.by || "?"}${s.seconds ? " · " + pjClock(s.seconds) : ""}`),
      pjEl("span", "pj-sync " + (s.here ? "ok" : "no"), s.here ? "✓ on your PC" : ""));
    if (s.by === pjMe() || pjIsOwner()) {
      li.append(pjButton("", "pj-x", async () => {
        await api("/api/pj-delete-file", { project: pjOpen.project.id, id: s.id }).catch(() => null);
        openPj(pjOpen.project.id, true);
      }, "x"));
      li.lastChild.title = "Take it out";
    }
    list.append(li);
  }
  view.append(list);
}

let pjAudio = null;
function pjPlay(url, button) {
  if (pjAudio && pjAudio.src === url && !pjAudio.paused) { pjAudio.pause(); return; }
  if (pjAudio) pjAudio.pause();
  pjAudio = new Audio(url);
  pjAudio.play().catch(() => {});
  if (button) button.blur();
}

async function pjAddSound() {
  const body = pjEl("div", "pj-modal-body");
  const search = pjEl("input");
  Object.assign(search, { placeholder: "Search the Library...", autocomplete: "off", spellcheck: false });
  const list = pjEl("div", "pj-sounds");
  body.append(pjField("Find a song or sound", search), list);
  pjDialog({ title: "Add from the Library", sub: "Click a sound to add it to the project.", body, cancel: "Done" });
  list.append(pjEl("p", "pj-help", "Loading the Library..."));
  const res = await api("/api/sfx-list", {}).catch(() => ({ ok: false }));
  const sounds = res.ok ? res.sounds : [];
  const added = new Set(pjSoundsIn().map((s) => s.path));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = sounds.filter((s) => !q || s.name.toLowerCase().includes(q)).slice(0, 80);
    list.replaceChildren(...shown.map((s) => {
      const b = pjEl("button");
      const play = pjButton("", "pj-x", (e) => { e.stopPropagation(); pjPlay(s.url, play); }, "play");
      b.append(play, pjEl("span", "", s.name), pjEl("span", "pj-muted pj-small", added.has(s.path) ? "Added ✓" : s.categoryName || ""));
      b.lastChild.style.flex = "none";
      b.addEventListener("click", async () => {
        if (added.has(s.path)) return;
        const r = await api("/api/pj-add-sound", { project: pjOpen.project.id, sound: { name: s.name, path: s.path, seconds: s.seconds } }).catch(() => ({ ok: false, error: "Couldn't add it." }));
        if (!r.ok) return pjDialogNote(r.error);
        added.add(s.path);
        draw();
        openPj(pjOpen.project.id, true);
      });
      return b;
    }));
    if (!shown.length) list.append(pjEl("p", "pj-help", res.ok ? "No sounds with that name." : "Couldn't load the Library."));
  };
  search.addEventListener("input", draw);
  draw();
}

// ---- your turn: Edit in Resolve, and Upload new cut

async function pjYourTurn(force = false, cutId = "") {
  const p = pjOpen.project;
  const cut = pjOpen.cuts.find((c) => c.id === cutId) || pjOpen.cuts[0];
  const footage = pjFootage(), sounds = pjSoundsIn();
  const missing = pjOpen.files.filter((f) => !f.here);
  const openNotes = cut ? pjOpen.notes.filter((n) => n.cut === cut.id && !n.done) : [];
  const body = pjEl("div", "pj-modal-body");
  const line = (label, state, ok) => {
    const row = pjEl("div", "pj-check");
    row.append(pjEl("span", "pj-state " + (ok ? "ok" : ""), ok ? "✓" : "↓"), pjEl("span", "", label), pjEl("span", "pj-muted pj-small", state));
    return row;
  };
  body.append(line("Footage on your PC", missing.some((f) => f.kind === "footage") ? `${pjSize(missing.filter((f) => f.kind === "footage").reduce((a, f) => a + f.size, 0))} to download` : `${footage.length} of ${footage.length}`, !missing.some((f) => f.kind === "footage")));
  if (sounds.length) body.append(line("Music & sounds from the Library", `${sounds.length} file${sounds.length === 1 ? "" : "s"}`, !missing.some((f) => f.kind === "sound")));
  const markers = pjEl("label", "pj-check");
  const markBox = pjEl("input");
  markBox.type = "checkbox";
  markBox.checked = true;
  markers.append(markBox, pjEl("span", "", `${openNotes.length} open note${openNotes.length === 1 ? "" : "s"} as markers in Resolve`));
  if (cut && openNotes.length) body.append(markers);
  body.append(pjEl("p", "pj-help", "Nobody else can edit while it's your turn, so two people never change the same timeline at once."));
  const help = pjEl("p", "pj-help");
  help.innerHTML = "When you're done: in Resolve <b>File › Export › Timeline</b> (pick FCPXML), then press <b>Upload new cut</b> here.";
  body.append(help);
  pjDialog({
    title: force ? "Take over the edit" : "Your turn to edit",
    sub: cut ? `VaultHub gets everything onto your PC and writes Cut ${cut.n} for this PC, ready for DaVinci Resolve.`
      : "There's no cut yet, so you start with a timeline of all the footage, one clip after the other.",
    body, go: force ? "Take over" : "Get it ready",
    onGo: async () => {
      const res = await api("/api/pj-edit-start", { project: p.id, cut: cut ? cut.id : "", markers: markBox.checked, force }).catch(() => ({ ok: false, error: "That didn't work." }));
      if (!res.ok) { pjDialogNote(res.error); return false; }
      if (res.busy) { pjDialogNote(`${res.busy} is editing right now. Ask for a turn, or wait for their cut.`); openPj(p.id, true); return false; }
      pjWaitFor = res.job;
      $("pjModalGo").hidden = true;
      $("pjModalHeading").textContent = "Getting it ready...";
      pjPollJobs();
      openPj(p.id, true);
      return false;
    },
  });
}

let pjWaitFor = "";
function pjTurnReady(job) {
  if ($("pjModal").hidden) return;  // (the window was closed: the jobs corner says it's done)
  const r = job.result || {};
  const body = pjEl("div", "pj-modal-body");
  const steps = pjEl("ol", "pj-help");
  steps.style.paddingLeft = "18px";
  steps.innerHTML = "<li>Open DaVinci Resolve and your project (or make a new one).</li><li><b>File › Import › Timeline</b>, and pick the file below.</li><li>When you're done, <b>File › Export › Timeline</b> (FCPXML), then <b>Upload new cut</b> here.</li>";
  const file = pjEl("div", "pj-pick");
  file.append(pjEl("span", "got", (r.file || "").split(/[\\/]/).pop()), pjButton("Show the file", "link pj-small", () => api("/api/pj-show", { path: r.file })));
  body.append(steps, file);
  if (r.missing && r.missing.length) body.append(pjEl("p", "pj-help", `Not in the project, so Resolve will ask where these are: ${r.missing.join(", ")}`));
  pjDialog({ title: "Ready for Resolve!", sub: r.cut ? `Cut ${r.cut} with everything on your PC.` : "A timeline with all the footage to start from.", body, cancel: "Got it" });
}

function pjUploadCut() {
  const p = pjOpen.project;
  const picked = { timeline: "", video: "" };
  const body = pjEl("div", "pj-modal-body");
  const help = pjEl("p", "pj-help");
  help.innerHTML = "In Resolve: <b>File › Export › Timeline</b>, pick <b>FCPXML</b> and save it. For the crew to watch it, also render a quick video (<b>File › Quick Export</b>, H.264).";
  const pickRow = (kind, label, optional) => {
    const row = pjEl("div", "pj-pick");
    const name = pjEl("span", "", label);
    row.append(name, pjButton("Choose...", "ghost-button", async () => {
      const res = await api("/api/pj-pick-file", { kind }).catch(() => ({ ok: false, error: "Couldn't open the window." }));
      if (!res.ok) return pjDialogNote(res.error);
      if (!res.path) return;
      picked[kind] = res.path;
      name.textContent = res.name;
      name.classList.add("got");
    }));
    if (optional) row.title = "Optional";
    return row;
  };
  const note = pjEl("input");
  Object.assign(note, { maxLength: 300, placeholder: "What changed? (like: shorter intro, new music)", autocomplete: "off" });
  body.append(help, pickRow("timeline", "The timeline file (.fcpxml)"), pickRow("video", "A video of the cut to watch (optional)", true), pjField("Note (optional)", note));
  const next = (pjOpen.cuts[0] ? pjOpen.cuts[0].n : 0) + 1;
  pjDialog({
    title: `Upload Cut ${next}`, sub: "Clips you added that the project doesn't have yet go up too. Then it's someone else's turn.", body, go: "Upload",
    onGo: async () => {
      if (!picked.timeline) { pjDialogNote("Choose the timeline file first."); return false; }
      const res = await api("/api/pj-upload-cut", { project: p.id, timeline: picked.timeline, video: picked.video, note: note.value })
        .catch(() => ({ ok: false, error: "That didn't work." }));
      if (!res.ok) { pjDialogNote(res.error); return false; }
      pjPollJobs();
      return true;
    },
  });
}

async function pjStopEditing() {
  if (!confirm("Stop editing without uploading a cut? Then someone else can take a turn.")) return;
  await api("/api/pj-edit-stop", { project: pjOpen.project.id }).catch(() => null);
  openPj(pjOpen.project.id, true);
}

// ---- uploads and downloads in the corner

let pjJobs = [], pjJobsTimer = 0, pjJobsGen = 0, pjSeenDone = new Set();
async function pjPollJobs() {
  clearTimeout(pjJobsTimer);
  const gen = ++pjJobsGen;
  const res = await api("/api/pj-jobs", {}).catch(() => null);
  if (gen !== pjJobsGen) return;
  if (res && res.ok) {
    pjJobs = res.jobs;
    drawPjJobs();
    let refresh = false;
    for (const j of pjJobs) {
      if (j.status === "working" || j.status === "waiting" || pjSeenDone.has(j.id)) continue;
      pjSeenDone.add(j.id);
      refresh = true;
      if (j.id === pjWaitFor) {
        pjWaitFor = "";
        if (j.status === "done") pjTurnReady(j);
        else if (!$("pjModal").hidden) { $("pjModalHeading").textContent = "That didn't work"; pjDialogNote(j.message); }
      }
    }
    if (refresh && pjOpen) openPj(pjOpen.project.id, true);
  }
  if (pjJobs.some((j) => j.status === "waiting" || j.status === "working")) {
    pjJobsTimer = setTimeout(pjPollJobs, document.hidden || $("projectsTab").hidden ? 3000 : 800);
  }
}

function drawPjJobs() {
  const box = $("pjJobs");
  box.hidden = !pjJobs.length;
  if (!pjJobs.length) return box.replaceChildren();
  const head = pjEl("div", "fx-jobs-head");
  head.append(pjEl("strong", "", "Projects"));
  const clear = pjButton("Clear", "link", async () => { const r = await api("/api/pj-clear", {}); if (r.ok) { pjJobs = r.jobs; drawPjJobs(); } });
  head.append(clear);
  const label = (j) => {
    const pct = j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
    if (j.status === "done") return { up: "Uploaded", cut: `Cut ${(j.result && j.result.n) || ""} is up`, get: "On your PC", edit: "Ready for Resolve" }[j.kind];
    if (j.status === "error") return j.message;
    if (j.status === "waiting") return "Waiting...";
    if (j.step && !/^Upload|^Download/.test(j.step)) return j.step + "...";
    return `${j.step || (j.kind === "up" || j.kind === "cut" ? "Uploading" : "Downloading")} ${j.total ? pct + "% · " + pjSize(j.done) + " of " + pjSize(j.total) : ""}`;
  };
  const rows = pjJobs.map((j) => {
    const row = pjEl("div", "fx-job " + j.status);
    const pct = j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
    const text = pjEl("div", "fx-job-text");
    text.append(pjEl("b", "", (j.kind === "up" || j.kind === "cut" ? "↑ " : "↓ ") + j.name), pjEl("small", "", label(j)));
    const bar = pjEl("div", "fx-job-bar");
    const fill = pjEl("i");
    fill.style.width = (j.status === "done" ? 100 : pct) + "%";
    bar.append(fill);
    row.append(text);
    if (j.status === "working" || j.status === "waiting") {
      const stop = pjButton("", "fx-icon", async () => { await api("/api/pj-cancel", { id: j.id }); pjPollJobs(); }, "x");
      stop.title = "Stop";
      row.append(stop);
    } else if (j.status === "done" && j.kind === "edit" && j.result) {
      row.append(pjButton("Show", "link", () => api("/api/pj-show", { path: j.result.file })));
    }
    row.append(bar);
    return row;
  });
  box.replaceChildren(head, ...rows);
}

// ---- opening the tab, and keeping it fresh

let pjUserId = null, pjTicker = 0;
function pjAccountChanged() {
  const id = pjLoggedIn() ? sfxUser().id : null;
  if (id === pjUserId) return;
  pjUserId = id;
  pjData = null;
  if (pjOpen) { pjOpen = null; $("pjPage").hidden = true; $("pjHome").hidden = false; }
  renderPjHome();
  if (id) loadPj();  // (for the invitation badge on the side bar)
  else pjBadge();
}

async function pjTabChanged(tab) {
  clearInterval(pjTicker);
  if (tab !== "projects") {
    pjStopVideo();
    if (pjAudio) pjAudio.pause();
    return;
  }
  renderPjHome();
  if (typeof sfxAccount !== "undefined" && (!sfxAccount || sfxFromCache)) await loadAccount();
  if (!pjLoggedIn()) return renderPjHome();
  if (pjOpen) openPj(pjOpen.project.id, true);
  else await loadPj();
  pjPollJobs();
  // Someone else may upload, take a turn or leave a note: look again now and then.
  pjTicker = setInterval(() => {
    if (document.hidden || !$("pjModal").hidden) return;
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("#pjPage input, #pjPage select");
    if (typing) return;
    if (pjOpen) openPj(pjOpen.project.id, true);
    else loadPj();
  }, 12000);
}
if (!$("projectsTab").hidden) pjTabChanged("projects");
