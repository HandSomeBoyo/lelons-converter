// Playlists in the Library: your own lists of sounds (the ones you use most, say).
// Only you see a playlist, plus the people you invite to it; they can add and take out sounds too.
// Only the one who made it can rename it, invite or remove people, or delete it.
// Uses sfx.js (sfxSounds, sfxCategory, drawSfx, sideButton, avatarEl, playSfx...).

const PL_ICONS = {
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M4 11h12M4 16h7"/><path d="M17 14v6M14 17h6"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 11h11M4 16h7"/><circle cx="16.5" cy="17.5" r="2.5"/><path d="M19 17.5V8l2.5-1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.2 3.2-4.8 6-4.8s5.1 1.6 6 4.8"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.9c1.5.7 2.5 2.2 3 4.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
};

let plLists = []; // your playlists first, then the ones you were invited to: {id, name, mine, owner, ownerAvatar, sounds: [ids], members}
let plPeople = []; // everyone else with an account (to invite): {username, avatarUrl}
let sfxPlaylist = loadPref("sfxPlaylist") || ""; // the playlist that's open
let plLoading = false;
let plSeq = 0; // the newest change sent (an older answer arriving late mustn't undo a newer one)

const plCurrent = () => plLists.find((p) => p.id === sfxPlaylist) || plLists[0] || null;
const plHasSound = (id) => { const p = plCurrent(); return !!p && p.sounds.includes(id); };
const plInAny = (id) => plLists.some((p) => p.sounds.includes(id));
const plCount = (p) => { const ids = new Set(sfxSounds.map((s) => s.id)); return p.sounds.filter((id) => ids.has(id)).length; };

function playlistsForget() {
  plLists = [];
  plPeople = [];
  plSeq++;
}

function plTake(res) {
  plLists = res.playlists || [];
  plPeople = res.people || [];
}

async function loadPlaylists() {
  if (plLoading) return;
  plLoading = true;
  const seq = plSeq;
  const res = await api("/api/sfx-playlists", {}).catch(() => null);
  plLoading = false;
  if (!res || !res.ok || seq !== plSeq) return; // (the list itself says what went wrong)
  plTake(res);
  drawSfx();
  if (!$("plModal").hidden) drawPlaylistModal();
}

// Every change goes through here. Returns the answer, or null (and says why in the note, if given).
async function playlistAction(data, note = null) {
  const seq = ++plSeq;
  const res = await api("/api/sfx-playlist", data).catch(() => ({ ok: false, error: "That didn't work. Check your internet connection." }));
  if (sfxLoggedOut(res)) { closePlaylistModal(); return null; }
  if (!res.ok) {
    if (note) note.textContent = res.error;
    if (seq === plSeq) loadPlaylists(); // undo what was shown already
    return null;
  }
  if (seq === plSeq) plTake(res);
  drawSfx();
  return res;
}

function openPlaylist(id) {
  sfxPlaylist = id;
  savePref("sfxPlaylist", id);
}

// ---- the left side when Playlists is picked

function drawPlaylistSide(box) {
  $("sfxMain").classList.add("has-genres");
  const current = plCurrent();
  const head = box._plHead || (box._plHead = document.createElement("h3"));
  head.className = "lib-genres-head";
  head.innerHTML = PL_ICONS.list + "Playlists";
  const make = sideButton("New playlist", "", false, () => openPlaylistModal("create"), "lib-genre pl-new", "pl-new");
  if (!make.dataset.icon) { make.dataset.icon = "1"; make.insertAdjacentHTML("afterbegin", PL_ICONS.plus); }
  const item = (p) => {
    const b = sideButton(p.name, plCount(p), current && current.id === p.id, () => openPlaylist(p.id), "lib-genre pl-item", "pl|" + p.id);
    b.title = p.mine ? (p.members.length ? `You and ${p.members.length} ${p.members.length === 1 ? "person" : "people"}` : "Only you can see it")
      : `${p.owner} shared it with you`;
    return b;
  };
  const label = (key, text) => {
    const el = box["_" + key] || (box["_" + key] = Object.assign(document.createElement("h4"), { className: "pl-side-label" }));
    el.textContent = text;
    return el;
  };
  const mine = plLists.filter((p) => p.mine);
  const shared = plLists.filter((p) => !p.mine);
  setChildren(box, [head, make,
    ...(mine.length && shared.length ? [label("plMine", "Yours")] : []), ...mine.map(item),
    ...(shared.length ? [label("plShared", "Shared with you"), ...shared.map(item)] : [])]);
  if (box.hidden) { box.hidden = false; box.classList.remove("genres-in"); void box.offsetWidth; box.classList.add("genres-in"); }
}

// ---- the playlist's own bar above its sounds: name, who's in it, play, invite, settings

function drawPlaylistBar() {
  const bar = $("sfxPlaylistBar");
  const p = sfxCategory === "playlists" ? plCurrent() : null;
  bar.hidden = !p;
  $("sfxShowing").hidden = !!p; // (the bar says it already)
  if (!p) return;
  $("plBarName").textContent = p.name;
  const n = plCount(p);
  const people = p.members.length;
  $("plBarSub").textContent = (p.mine ? (people ? `Shared with ${people} ${people === 1 ? "person" : "people"}` : "Only you can see it")
    : `Made by ${p.owner} · shared with you`) + ` · ${n} sound${n === 1 ? "" : "s"}`;
  $("plBarLock").innerHTML = people || !p.mine ? PL_ICONS.people : PL_ICONS.lock;
  const faces = [{ username: p.owner, avatarUrl: p.ownerAvatar }, ...p.members];
  const sig = people ? faces.map((m) => m.username + m.avatarUrl).join("|") : "";
  if ($("plBarFaces").dataset.sig !== sig) {
    $("plBarFaces").dataset.sig = sig;
    $("plBarFaces").replaceChildren(...(people ? faces.slice(0, 5).map((m) => avatarEl(m.avatarUrl, m.username, "tiny")) : []));
  }
  $("plBarPlay").disabled = !n;
  $("plBarInvite").hidden = !p.mine;
  $("plBarEdit").title = p.mine ? "Rename it, or change who's in it" : "Who's in it, or leave it";
}

$("plBarPlay").addEventListener("click", () => { if (sfxShown.length) playSfx(sfxShown[0]); });
$("plBarInvite").addEventListener("click", () => openPlaylistModal("edit", true));
$("plBarEdit").addEventListener("click", () => openPlaylistModal("edit"));

function playlistEmptyText() {
  const p = plCurrent();
  if (!p) return "No playlists yet. Click New playlist to make one, then add sounds with the playlist button on any sound.";
  return `Nothing in ${p.name} yet. Go to All, then click the playlist button on a sound to add it here.`;
}

// ---- "Add to playlist": the little menu from a sound's playlist button

const plPop = $("plPop");
smoothHidden(plPop);
let plPopSound = null;

function openPlaylistPop(button, sound) {
  if (!plPop.hidden && plPopSound === sound) { plPop.hidden = true; return; }
  plPopSound = sound;
  $("plPopNew").hidden = true;
  $("plPopName").value = "";
  drawPlaylistPop();
  plPop.hidden = false;
  // Next to the button, inside the window.
  const box = button.getBoundingClientRect();
  const w = plPop.offsetWidth, h = plPop.offsetHeight;
  plPop.style.left = Math.max(8, Math.min(innerWidth - w - 8, box.right - w)) + "px";
  plPop.style.top = (box.bottom + 6 + h > innerHeight - 8 ? Math.max(8, box.top - h - 6) : box.bottom + 6) + "px";
}

function drawPlaylistPop() {
  const sound = plPopSound;
  if (!sound) return;
  setChildren($("plPopList"), plLists.length ? plLists.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    const on = p.sounds.includes(sound.id);
    b.className = "pl-pop-item" + (on ? " on" : "");
    b.innerHTML = `<i class="pl-check">${on ? PL_ICONS.check : ""}</i><span></span><small></small>`;
    b.querySelector("span").textContent = p.name;
    b.querySelector("small").textContent = p.mine ? "" : p.owner;
    b.onclick = () => togglePlaylistSound(p, sound);
    return b;
  }) : [Object.assign(document.createElement("p"), { className: "pl-pop-empty", textContent: "You don't have a playlist yet." })]);
}

function togglePlaylistSound(p, sound) {
  const on = !p.sounds.includes(sound.id);
  p.sounds = on ? [sound.id, ...p.sounds] : p.sounds.filter((id) => id !== sound.id); // show it right away
  drawPlaylistPop();
  drawSfx();
  playlistAction({ what: on ? "add" : "take_out", playlist: p.id, sound: sound.id }).then((res) => {
    if (!res) { sfxNotes.set(sound.id, { text: "Couldn't change the playlist. Try again.", kind: "bad" }); drawSfx(); }
    if (!plPop.hidden) drawPlaylistPop();
  });
}

$("plPopNewOpen").addEventListener("click", () => {
  $("plPopNew").hidden = false;
  $("plPopName").focus();
});
async function plPopCreate() {
  const name = $("plPopName").value.trim();
  const sound = plPopSound;
  if (!name || !sound) return $("plPopName").focus();
  $("plPopCreate").disabled = true;
  const res = await playlistAction({ what: "create", name });
  if (res) {
    openPlaylist(res.id);
    const p = plLists.find((x) => x.id === res.id);
    if (p) togglePlaylistSound(p, sound);
    $("plPopNew").hidden = true;
    $("plPopName").value = "";
  }
  $("plPopCreate").disabled = false;
  drawPlaylistPop();
}
$("plPopCreate").addEventListener("click", plPopCreate);
$("plPopName").addEventListener("keydown", (e) => { if (e.key === "Enter") plPopCreate(); });
document.addEventListener("click", (e) => {
  if (!plPop.hidden && !plPop.contains(e.target) && !e.target.closest(".pl-add")) plPop.hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !plPop.hidden) plPop.hidden = true; });
window.addEventListener("resize", () => { plPop.hidden = true; });
document.addEventListener("scroll", (e) => { if (!plPop.contains(e.target)) plPop.hidden = true; }, { passive: true, capture: true });

// ---- the playlist window: make one, rename it, invite or remove people, delete it or leave it

let plMode = "create";
let plEditing = null; // the playlist being changed
let plSureDelete = false;
const plPicked = new Set();

function openPlaylistModal(mode, focusInvite = false) {
  plMode = mode;
  plEditing = mode === "edit" ? plCurrent() : null;
  if (mode === "edit" && !plEditing) return;
  plPicked.clear();
  plSureDelete = false;
  $("plName").value = plEditing ? plEditing.name : "";
  $("plSearch").value = "";
  $("plNote").textContent = "";
  drawPlaylistModal();
  $("plModal").hidden = false;
  if (focusInvite || (plEditing && !plEditing.mine)) $("plSearch").focus();
  else { $("plName").focus(); $("plName").select(); }
}
function closePlaylistModal() { $("plModal").hidden = true; plEditing = null; }

function drawPlaylistModal() {
  if (plMode === "edit") {
    plEditing = plLists.find((p) => plEditing && p.id === plEditing.id) || null;
    if (!plEditing) return closePlaylistModal();
  }
  const p = plEditing;
  const owner = !p || p.mine;
  $("plTitle").textContent = !p ? "New playlist" : owner ? "Playlist settings" : p.name;
  $("plNameRow").hidden = !owner;
  $("plHelp").textContent = !p ? "Only you can see it, unless you invite people. Everyone you invite can add and take out sounds."
    : owner ? "Only you and the people in it can see it. They can add and take out sounds too."
    : `${p.owner} made this playlist and shared it with you. You can add and take out sounds.`;
  $("plMembersLabel").hidden = $("plMembers").hidden = !p;
  if (p) {
    const everyone = [{ username: p.owner, avatarUrl: p.ownerAvatar, made: true }, ...p.members];
    setChildren($("plMembers"), everyone.map((m) => {
      const row = document.createElement("div");
      row.className = "group-member";
      row.append(avatarEl(m.avatarUrl, m.username), Object.assign(document.createElement("span"), { textContent: m.username }));
      if (m.made) row.append(Object.assign(document.createElement("small"), { textContent: "Made it" }));
      if (owner && !m.made) {
        const x = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Remove" });
        x.addEventListener("click", () => playlistAction({ what: "remove", playlist: p.id, usernames: [m.username] }, $("plNote"))
          .then(() => drawPlaylistModal()));
        row.append(x);
      }
      return row;
    }));
  }
  // Invite people (only the one who made it).
  $("plPickLabel").hidden = $("plSearchRow").hidden = $("plPick").hidden = !owner;
  const inIt = new Set(((p && p.members) || []).map((m) => m.username.toLowerCase()));
  const typed = $("plSearch").value.trim().toLowerCase();
  const rows = plPeople.filter((m) => !inIt.has(m.username.toLowerCase()) && (!typed || m.username.toLowerCase().includes(typed)))
    .slice(0, 60).map((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "group-person" + (plPicked.has(m.username) ? " on" : "");
      b.append(avatarEl(m.avatarUrl, m.username), Object.assign(document.createElement("span"), { textContent: m.username }),
        Object.assign(document.createElement("i"), { className: "group-check" }));
      b.addEventListener("click", () => {
        plPicked.has(m.username) ? plPicked.delete(m.username) : plPicked.add(m.username);
        drawPlaylistModal();
      });
      return b;
    });
  if (!rows.length) rows.push(Object.assign(document.createElement("p"), { className: "group-empty",
    textContent: typed ? "Nobody with that name." : plPeople.length ? "Everyone is already in it." : "Nobody else has an account yet." }));
  setChildren($("plPick"), rows);
  $("plDanger").hidden = !p;
  $("plDanger").textContent = !p ? "" : owner ? (plSureDelete ? "Click again to delete it" : "Delete playlist") : "Leave playlist";
  $("plSave").hidden = !owner;
  $("plSave").textContent = !p ? (plPicked.size ? `Create and invite ${plPicked.size}` : "Create playlist")
    : plPicked.size ? `Save and invite ${plPicked.size}` : "Save";
  $("plCancel").textContent = owner ? "Cancel" : "Close";
}
$("plSearch").addEventListener("input", drawPlaylistModal);

$("plSave").addEventListener("click", async () => {
  const name = $("plName").value.trim();
  if (!name) { $("plNote").textContent = "Give the playlist a name."; return $("plName").focus(); }
  $("plSave").disabled = true;
  try {
    let p = plEditing;
    if (!p) {
      const res = await playlistAction({ what: "create", name }, $("plNote"));
      if (!res) return;
      openPlaylist(res.id);
      p = plLists.find((x) => x.id === res.id);
      if (sfxCategory !== "playlists") { sfxCategory = "playlists"; sfxGenre = ""; }
    } else if (name !== p.name && !(await playlistAction({ what: "rename", playlist: p.id, name }, $("plNote")))) {
      return;
    }
    if (p && plPicked.size && !(await playlistAction({ what: "invite", playlist: p.id, usernames: [...plPicked] }, $("plNote")))) return;
    closePlaylistModal();
    drawSfx();
  } finally {
    $("plSave").disabled = false;
  }
});

$("plDanger").addEventListener("click", async () => {
  const p = plEditing;
  if (!p) return;
  if (p.mine && !plSureDelete) { // deleting needs a second click
    plSureDelete = true;
    drawPlaylistModal();
    setTimeout(() => { if (plSureDelete) { plSureDelete = false; if (!$("plModal").hidden) drawPlaylistModal(); } }, 4000);
    return;
  }
  $("plDanger").disabled = true;
  const res = await playlistAction({ what: p.mine ? "delete" : "leave", playlist: p.id }, $("plNote"));
  $("plDanger").disabled = false;
  if (res) closePlaylistModal();
});

$("plCancel").addEventListener("click", closePlaylistModal);
$("plName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("plSave").click(); });
$("plModal").addEventListener("click", (e) => { if (e.target === $("plModal")) closePlaylistModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("plModal").hidden) closePlaylistModal(); });
