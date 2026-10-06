// The Library tab: sounds and music shared with friends, who log in with an account.
// Uses $, api(), clock(), openTrim(), ICONS from app.js, showTab() and sizeText() from images.js.

const SFX_ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z"/><path d="M14.6 9.6a3.6 3.6 0 1 0 0 4.8"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
};

let sfxAccount = null;
let sfxSounds = [];
let sfxCategory = "all";
let sfxLoading = false;
let sfxError = "";
let sfxPlaying = null; // id of the sound playing
const sfxSure = new Set(); // sounds whose bin was clicked once
const sfxDragReady = new Set(); // sounds with a copy ready to drag into other apps
const sfxNotes = new Map(); // id -> {text, kind, path}: "Saved as ..." under a sound
let sfxLastLoad = 0;
let sfxFromCache = false; // the account shown is from last time (the fresh one is on its way)

function sfxAgo(when) {
  const seconds = (Date.now() - new Date(when).getTime()) / 1000;
  if (seconds < 90) return "just now";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + " h ago";
  if (seconds < 86400 * 30) return Math.round(seconds / 86400) + " days ago";
  return new Date(when).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

// ---- accounts

// A round profile picture, or the first letter of the name on a colour.
function avatarEl(url, name, cls = "") {
  const el = document.createElement("span");
  el.className = "avatar " + cls;
  const letter = () => {
    const hue = [...(name || "?")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    el.style.background = `hsl(${hue} 45% 38%)`;
    el.textContent = (name || "?")[0].toUpperCase();
  };
  if (url) {
    const img = document.createElement("img");
    img.alt = "";
    img.onerror = letter;  // picture gone or offline: show their letter
    img.src = url;
    el.append(img);
  } else {
    letter();
  }
  return el;
}

const sfxUser = () => sfxAccount && sfxAccount.user;

// Who's logged in. Loaded when the app opens, so the account button at the top right shows your picture.
async function loadAccount() {
  const res = await api("/api/sfx-account", {}).catch(() => null);
  if (!res || !res.ok) {
    $("sfxNotSetUp").hidden = false;
    $("sfxNotSetUp").textContent = (res && res.error) || "Couldn't reach the library. Check your internet connection.";
    return false;
  }
  const was = sfxUser() && sfxUser().id;
  sfxAccount = res.account;
  sfxFromCache = false;
  if (was && (!sfxUser() || sfxUser().id !== was)) { // not who was shown from last time
    sfxSounds = [];
    $("sfxList").replaceChildren();
    if (typeof homeAccountChanged === "function") homeAccountChanged(true);
  }
  drawSfxAccount();
  return true;
}

async function openSfx() {
  sfxPeaksFailed.clear();
  if ((!sfxAccount || sfxFromCache) && !(await loadAccount()) && !sfxAccount) return;
  drawSfxAccount();
  if (sfxUser() && Date.now() - sfxLastLoad > 5000) loadSfx();
}

const sfxTabOpen = () => !$("sfxTab").hidden;

function setSfxAccount(account) {
  const was = sfxUser() && sfxUser().id;
  sfxAccount = account;
  if (!sfxUser() || sfxUser().id !== was) {
    sfxSounds = [];
    sfxLastLoad = 0;
    $("sfxList").replaceChildren();
  }
  drawSfxAccount();
  if (typeof chatAccountChanged === "function") chatAccountChanged();
  if (typeof homeAccountChanged === "function") homeAccountChanged(!sfxUser() || sfxUser().id !== was);
}

// Something said the login ran out: back to the log in screen.
function sfxLoggedOut(res) {
  if (!res || !res.loggedOut) return false;
  setSfxAccount({ ...sfxAccount, user: null });
  $("libLoginError").textContent = res.error;
  return true;
}

function drawSfxAccount() {
  const a = sfxAccount;
  const user = a.user;
  if (typeof drawAccountPage === "function") drawAccountPage();
  if (typeof docsAccountChanged === "function") docsAccountChanged();
  $("sfxNotSetUp").hidden = a.configured;
  $("libMe").hidden = !a.configured;
  $("libMeButton").classList.remove("saving");
  $("libLogin").hidden = !!user;
  $("libMeCard").hidden = $("libMenuItems").hidden = !user;
  $("libLoggedOut").hidden = !a.configured || !!user;
  $("sfxMain").hidden = !a.configured || !user;
  $("libMeButton").title = user ? `${user.username} (${user.roleName})` : "Log in or create an account";
  if (!$("sfxCategory").children.length) {
    for (const [value, label] of Object.entries(a.categories)) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.value = value;
      b.textContent = label;
      b.onclick = () => pickUploadCategory(value);
      $("sfxCategory").append(b);
    }
  }
  if (!user) {
    $("libMeButton").classList.remove("has-news");
    $("libMeAvatar").replaceWith(Object.assign(document.createElement("span"), {
      id: "libMeAvatar", className: "avatar account-empty",
      innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/></svg>',
    }));
    return;
  }
  $("libMeAvatar").replaceWith(Object.assign(avatarEl(user.avatarUrl, user.username), { id: "libMeAvatar" }));
  $("libMeCardAvatar").replaceWith(Object.assign(avatarEl(user.avatarUrl, user.username, "big"), { id: "libMeCardAvatar" }));
  $("libMeName").textContent = user.username;
  $("libMeRole").textContent = user.roleName;
  $("libMeRole").className = "role role-" + user.role;
  $("libPeopleOpen").hidden = !user.isOwner;
  $("libInboxOpen").hidden = !user.isOwner;
  $("libInboxCount").textContent = user.open_feedback || "";
  $("libMeButton").classList.toggle("has-news", !!(user.isOwner && user.open_feedback));
  $("sfxUploadOpen").hidden = !user.canUpload;
}

// ---- log in / create account

let loginMode = "login";
document.querySelectorAll(".lib-login-tabs button").forEach((b) => b.addEventListener("click", () => setLoginMode(b.dataset.mode)));
function setLoginMode(mode) {
  loginMode = mode;
  document.querySelectorAll(".lib-login-tabs button").forEach((x) => x.classList.toggle("active", x.dataset.mode === mode));
  $("libLoginButton").textContent = loginMode === "login" ? "Log in" : "Create account";
  $("libPassword").autocomplete = loginMode === "login" ? "current-password" : "new-password";
  $("libLoginHint").textContent = loginMode === "login" ? "Log in to hear everyone's sounds."
    : "Pick a username and a password (at least 6 characters). New accounts can listen and download; the owner can let you upload.";
  $("libLoginError").textContent = "";
  $("libUsername").focus();
}

// The buttons on the Library tab when you're logged out open the account panel.
function openLogin(mode) {
  showMenu(true);
  setLoginMode(mode);
}
$("libOutLogin").addEventListener("click", (e) => { e.stopPropagation(); openLogin("login"); });
$("libOutSignup").addEventListener("click", (e) => { e.stopPropagation(); openLogin("signup"); });

$("libLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("libLoginButton").disabled = true;
  $("libLoginError").textContent = "";
  const res = await api("/api/sfx-" + loginMode, { username: $("libUsername").value, password: $("libPassword").value })
    .catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  $("libLoginButton").disabled = false;
  if (!res.ok) {
    $("libLoginError").textContent = res.error;
    return;
  }
  $("libPassword").value = "";
  closeMenu();
  setSfxAccount(res.account);
  if (sfxTabOpen()) loadSfx();
  if (!$("accountTab").hidden) openAccount();
});

// ---- your account menu

function showMenu(open) {
  $("libMenu").hidden = !open;
  $("libMeButton").setAttribute("aria-expanded", open);
}
function closeMenu() { showMenu(false); }
$("libMeButton").addEventListener("click", (e) => {
  e.stopPropagation();
  showMenu($("libMenu").hidden);
  if (!$("libMenu").hidden && !sfxUser()) $("libUsername").focus();
});
document.addEventListener("click", (e) => { if (!$("libMe").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

async function logOut() {
  closeMenu();
  stopSfx();
  const res = await api("/api/sfx-logout", {});
  if (res.ok) setSfxAccount(res.account);
  setLoginMode("login");
}
$("libLogout").addEventListener("click", logOut);

// ---- the list

// The same sound keeps the same object, so its row (and the player bar, if it's playing) is kept.
function mergeSounds(list) {
  const old = new Map(sfxSounds.map((x) => [x.id, x]));
  sfxSounds = list.map((x) => {
    const was = old.get(x.id);
    if (!was) return x;
    for (const key of Object.keys(was)) if (!(key in x)) delete was[key];
    return Object.assign(was, x);
  });
}

let sfxSongTimer = 0;
async function loadSfx() {
  if (sfxLoading) return;
  sfxLoading = true;
  sfxLastLoad = Date.now();
  if (!sfxSounds.length) {
    sfxError = "";
    $("sfxEmpty").hidden = false;
    $("sfxEmpty").textContent = "Loading sounds...";
  }
  const res = await api("/api/sfx-list", {}).catch(() => ({ ok: false, error: "Couldn't load the sounds." }));
  sfxLoading = false;
  clearTimeout(sfxSongTimer);
  if (res.ok) {
    mergeSounds(res.sounds);
    sfxError = "";
    // Sounds still being checked for songs: look again in a bit (only while the Library is open).
    if (res.songsChecking) sfxSongTimer = setTimeout(() => { if (!$("sfxTab").hidden && !document.hidden) loadSfx(); }, 5000);
  } else if (sfxLoggedOut(res)) {
    return;
  } else {
    sfxError = res.error;
  }
  drawSfx();
}

// ---- the side panel: what to show

let sfxUploader = ""; // only sounds from this person ("" = everyone)
let sfxSort = "favorites";
let sfxLimit = 200; // rows drawn at once; "Show more" draws more
sfxSort = loadPref("sfxSort") || sfxSort;
$("sfxSort").value = sfxSort;
if (!$("sfxSort").value) $("sfxSort").value = sfxSort = "favorites";

// Side buttons are kept (by what they pick) and only updated, so clicking one never rebuilds the list it's in.
const sfxSideButtons = new Map();
function sideButton(label, count, active, onclick, extraClass = "", key = extraClass + "|" + label) {
  let b = sfxSideButtons.get(key);
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="side-label"></span><span class="count"></span>';
    sfxSideButtons.set(key, b);
  }
  b.className = "side-item " + extraClass + (active ? " active" : "");
  b.querySelector(".side-label").textContent = label;
  b.querySelector(".count").textContent = count;
  b.onclick = () => { onclick(); sfxLimit = 200; drawSfx(); };
  return b;
}

// Category pills at the top of the Library (like Artlist), each with its own little icon.
const CAT_ICONS = {
  all: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  favorites: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
  sfx: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  memes: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  ambience: '<path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0"/>',
  other: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
};

function catPill(value, label, count) {
  const b = sideButton(label, count, sfxCategory === value, () => { sfxCategory = value; }, "lib-cat cat-" + value, "cat|" + value);
  if (!b.dataset.icon) {
    b.dataset.icon = "1";
    b.setAttribute("role", "tab");
    b.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAT_ICONS[value] || CAT_ICONS.other}</svg>`);
  }
  b.setAttribute("aria-selected", sfxCategory === value);
  return b;
}

function drawSfxSide() {
  const counts = { all: sfxSounds.length, favorites: 0 };
  const people = new Map(); // uploader -> {count, avatar}
  for (const s of sfxSounds) {
    counts[s.category] = (counts[s.category] || 0) + 1;
    if (s.favorite) counts.favorites++;
    const who = people.get(s.uploader) || { count: 0, avatar: s.uploaderAvatar };
    who.count++;
    people.set(s.uploader, who);
  }
  setChildren($("sfxCats"), [$("sfxCatsPill"), catPill("all", "All", counts.all), catPill("favorites", "Favorites", counts.favorites),
    ...Object.entries(sfxAccount.categories).map(([value, label]) => catPill(value, label, counts[value] || 0))]);
  moveCatsPill();
  if (sfxUploader && sfxSounds.length && !people.has(sfxUploader)) sfxUploader = "";
  const names = [...people.keys()].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));
  setChildren($("sfxPeople"), [
    sideButton("Everyone", counts.all, !sfxUploader, () => { sfxUploader = ""; }, "", "everyone"),
    ...names.map((name) => {
      const b = sideButton(name, people.get(name).count, sfxUploader === name, () => { sfxUploader = sfxUploader === name ? "" : name; },
        "", "person|" + name);
      const avatar = people.get(name).avatar || "";
      if (!b._face || b.dataset.avatar !== avatar) {
        b.dataset.avatar = avatar;
        if (b._face) b._face.remove();
        b._face = avatarEl(avatar, name, "tiny");
        b.prepend(b._face);
      }
      return b;
    })]);
  // The people button shows who's picked (or the first few faces).
  const faces = sfxUploader ? [sfxUploader] : names.slice(0, 3);
  const sig = faces.map((n) => n + (people.get(n) || {}).avatar).join("|");
  if ($("sfxPeopleFaces").dataset.sig !== sig) {
    $("sfxPeopleFaces").dataset.sig = sig;
    $("sfxPeopleFaces").replaceChildren(...faces.map((n) => avatarEl((people.get(n) || {}).avatar, n, "tiny")));
  }
  $("sfxPeopleText").textContent = sfxUploader || "Everyone";
  $("sfxPeopleButton").classList.toggle("picked", !!sfxUploader);
}

// The highlight slides to the picked category.
function moveCatsPill() {
  const active = $("sfxCats").querySelector(".lib-cat.active");
  const pill = $("sfxCatsPill");
  if (!active || !active.offsetWidth) { pill.style.opacity = 0; return; }
  pill.style.opacity = 1;
  pill.style.width = active.offsetWidth + "px";
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  markCatsOverflow();
}
window.addEventListener("resize", moveCatsPill);
document.fonts && document.fonts.ready.then(moveCatsPill); // (the pills get their real width once the font is in)

// In a small window the pills don't all fit: they scroll sideways (the mouse wheel works too),
// and the edges fade out so you can see there are more.
function markCatsOverflow() {
  const box = $("sfxCats");
  box.classList.toggle("more-right", box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
  box.classList.toggle("more-left", box.scrollLeft > 2);
}
$("sfxCats").addEventListener("scroll", markCatsOverflow, { passive: true });
$("sfxCats").addEventListener("wheel", (e) => {
  const box = $("sfxCats");
  if (box.scrollWidth <= box.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const max = box.scrollWidth - box.clientWidth;  // at the end already: let the page scroll
  if ((e.deltaY > 0 && box.scrollLeft >= max - 1) || (e.deltaY < 0 && box.scrollLeft <= 0)) return;
  e.preventDefault();
  box.scrollLeft += e.deltaY;
}, { passive: false });
window.addEventListener("resize", markCatsOverflow);

const peoplePop = $("sfxPeoplePop");
smoothHidden(peoplePop);
$("sfxPeopleButton").addEventListener("click", (e) => { e.stopPropagation(); peoplePop.hidden = !peoplePop.hidden; });
$("sfxPeople").addEventListener("click", () => { peoplePop.hidden = true; });
document.addEventListener("click", (e) => { if (!peoplePop.hidden && !peoplePop.contains(e.target)) peoplePop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !peoplePop.hidden) peoplePop.hidden = true; });

const SORTS = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  longest: (a, b) => b.seconds - a.seconds,
  shortest: (a, b) => a.seconds - b.seconds,
  uploader: (a, b) => a.uploader.localeCompare(b.uploader, undefined, { sensitivity: "base" }) || b.created_at.localeCompare(a.created_at),
  favorites: (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.created_at.localeCompare(a.created_at),
};

$("sfxSort").addEventListener("change", () => {
  sfxSort = $("sfxSort").value;
  savePref("sfxSort", sfxSort);
  drawSfx();
});

// Rows are kept and only made again when something on them changed, so typing in the search stays quick.
const sfxRows = new Map(); // id -> {el, sig}
const sfxDownloading = new Set(); // ids being downloaded (a second click does nothing)

function rowFor(sound) {
  const note = sfxNotes.get(sound.id);
  const sig = [sound.name, sound.category, sound.favorite, sound.uploader, sound.uploaderAvatar, sound.peaks ? 1 : 0,
    note && note.text, sfxSure.has(sound.id), sfxUser() && sfxUser().canUpload,
    sfxSongMatch(sound) ? sfxSongMatch(sound).title + "/" + sfxSongMatch(sound).artist : ""].join("|");
  const kept = sfxRows.get(sound.id);
  if (kept && kept.sig === sig && kept.sound === sound) return kept.el;
  // A row being dragged right now keeps its node (a new one would lose the drag and the animation).
  if (kept && kept.el.classList.contains("drag-lift")) return kept.el;
  const el = sfxRow(sound);
  sfxRows.set(sound.id, { el, sig, sound });
  return el;
}

// Playing or not is changed on the row itself (no new row), so the list stays still.
function markSfxPlaying(el, sound) {
  const current = sfxPlaying === sound.id;
  const playing = current && !sfxAudio.paused;
  if (el.classList.contains("playing") === current && el.classList.contains("paused") === (current && !playing) && el.dataset.marked) return;
  el.dataset.marked = "1";
  el.classList.toggle("playing", current);
  el.classList.toggle("paused", current && !playing);
  const play = el.querySelector(".play");
  play.innerHTML = playing ? SFX_ICONS.pause : SFX_ICONS.play;
  play.title = playing ? "Pause" : "Play";
  if (!current) {
    el.querySelectorAll(".bars i.on").forEach((bar) => bar.classList.remove("on"));
    el.querySelector(".time").textContent = clock(sound.seconds, false);
  }
}

// Only this person's sounds (from their profile).
function showUploader(name) {
  sfxUploader = name;
  sfxCategory = "all";
  sfxLimit = 200;
  drawSfx();
}

function drawSfx() {
  if (!sfxAccount) return;
  drawSfxSide();
  const words = $("sfxSearch").value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sfxSounds.filter((s) => (sfxCategory === "all" || s.category === sfxCategory ||
    (sfxCategory === "favorites" && s.favorite)) && (!sfxUploader || s.uploader === sfxUploader) &&
    words.every((w) => `${s.name} ${s.uploader} ${s.categoryName}`.toLowerCase().includes(w)));
  shown.sort(SORTS[sfxSort] || SORTS.favorites);
  sfxShown = shown;
  playerRefresh();
  const rows = shown.slice(0, sfxLimit).map((sound) => {
    const el = rowFor(sound);
    markSfxPlaying(el, sound);
    return el;
  });
  if (shown.length > sfxLimit) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "outline-button lib-more";
    more.textContent = `Show more (${shown.length - sfxLimit} left)`;
    more.onclick = () => { sfxLimit += 200; drawSfx(); };
    rows.push(more);
  }
  setChildren($("sfxList"), rows);
  const ids = new Set(sfxSounds.map((s) => s.id));
  for (const id of sfxRows.keys()) if (!ids.has(id)) sfxRows.delete(id);
  const what = sfxCategory === "all" ? "All sounds" : sfxCategory === "favorites" ? "Favorites"
    : sfxAccount.categories[sfxCategory] || "Sounds";
  $("sfxShowing").textContent = `${what}${sfxUploader ? " from " + sfxUploader : ""} · ${shown.length} sound${shown.length === 1 ? "" : "s"}`;
  $("sfxEmpty").hidden = shown.length > 0;
  $("sfxEmpty").textContent = sfxError ||
    (!sfxSounds.length ? "No sounds yet. Be the first: click Upload."
      : words.length ? "Nothing matches that search."
      : sfxCategory === "favorites" ? "No favorites yet. Click the star on a sound to add it here."
      : sfxUploader ? `${sfxUploader} hasn't uploaded anything here.` : "No sounds in this category yet.");
}

function sfxSep() {
  return Object.assign(document.createElement("span"), { className: "sep", textContent: "·" });
}

// The Library's song check (done in the background by the app, saved for everyone): the song, or null.
function sfxSongMatch(sound) {
  const c = sound.copyright;
  return c && c.match ? c.match : null;
}

function sfxRow(sound) {
  const el = document.createElement("div");
  el.className = "sound" + (sfxPlaying === sound.id ? " playing" : "");
  el.dataset.id = sound.id;
  // Drag a sound straight into another app. Its kept copy is fetched as soon as the mouse is over it.
  setDrag(el, { kind: "sound", url: sound.url, name: sound.name });
  el.title = DRAG_HINT;
  // (Only once the mouse stays a moment, so sweeping over the list doesn't fetch every sound.)
  let readyTimer = null;
  el.addEventListener("mouseenter", () => {
    if (sfxDragReady.has(sound.url)) return;
    readyTimer = setTimeout(() => {
      sfxDragReady.add(sound.url);
      api("/api/drag-ready", { url: sound.url, name: sound.name }).then((res) => { if (!res.ok) sfxDragReady.delete(sound.url); })
        .catch(() => sfxDragReady.delete(sound.url));
    }, 350);
  });
  el.addEventListener("mouseleave", () => clearTimeout(readyTimer));
  el.innerHTML = `
    <button class="play" title="Play"></button>
    <div class="sound-info">
      <div class="title"></div>
      <div class="meta"></div>
    </div>
    <div class="sound-wave" title="Click to play from here"><div class="bars"></div><span class="time"></span></div>
    <div class="actions"></div>`;
  const play = el.querySelector(".play");
  play.innerHTML = sfxPlaying === sound.id ? SFX_ICONS.pause : SFX_ICONS.play;
  play.onclick = () => playSfx(sound);
  el.querySelector(".title").textContent = el.querySelector(".title").title = sound.name;
  const song = sfxSongMatch(sound);
  if (song) {
    const flag = document.createElement("div");
    flag.className = "song-flag";
    const what = [song.title && `"${song.title}"`, song.artist && "by " + song.artist].filter(Boolean).join(" ");
    flag.innerHTML = SFX_ICONS.shield + "<span></span>";
    flag.querySelector("span").textContent = "Most likely copyrighted" + (what ? ": " + what : "");
    flag.title = "The song checker found this in a song database" + (what ? ` (${what})` : "") +
      ". Using it in a video can get a copyright claim.";
    el.querySelector(".title").after(flag);
  }
  const meta = el.querySelector(".meta");
  const note = sfxNotes.get(sound.id);
  if (note) {
    meta.textContent = note.text;
    meta.className = "meta " + note.kind;
  } else {
    const cat = document.createElement("span");
    cat.className = "cat cat-" + sound.category;
    cat.textContent = sound.categoryName;
    meta.append(cat);
    if (sound.uploader) {
      const by = document.createElement("span");
      by.className = "by";
      by.title = "Uploaded by " + sound.uploader;
      by.append(avatarEl(sound.uploaderAvatar, sound.uploader, "tiny"));
      const name = document.createElement("b");
      name.className = "by-name";
      name.textContent = sound.uploader;
      name.title = "See " + sound.uploader + "'s profile";
      name.onclick = (e) => { e.stopPropagation(); openProfile(sound.uploader); };
      by.append(name);
      meta.append(sfxSep(), by);
    }
    // The time goes last and is the part cut short when there isn't room (never the name).
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = sfxAgo(sound.created_at);
    meta.append(sfxSep(), when);
  }
  const wave = el.querySelector(".sound-wave");
  drawSoundWave(wave, sound);
  wave.querySelector(".time").textContent = clock(sound.seconds, false);
  wave.onclick = (e) => {
    const box = wave.querySelector(".bars").getBoundingClientRect();
    playSfx(sound, Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
  };

  const actions = el.querySelector(".actions");
  const add = (icon, title, onclick) => {
    const b = document.createElement("button");
    b.className = "icon-button";
    b.title = title;
    b.innerHTML = icon;
    b.onclick = () => onclick(b);
    actions.append(b);
    return b;
  };
  const star = add(sound.favorite ? SFX_ICONS.starOn : SFX_ICONS.star,
    sound.favorite ? "Remove from your favorites" : "Add to your favorites (they show at the top)", () => toggleSfxFavorite(sound));
  star.classList.add("star");
  star.classList.toggle("on", !!sound.favorite);
  if (note && note.path) add(ICONS.folder, "Show in folder", () => api("/api/sfx-show", { path: note.path }));
  add(SFX_ICONS.download, "Download as MP3", () => downloadSfx(sound));
  // The rest only shows when the mouse is over the row (less to look at).
  add(SFX_ICONS.chat, "Send to the live chat", () => shareToChat({ sound: { id: sound.id, name: sound.name } })).classList.add("extra");
  add(SFX_ICONS.shield, "Check if it's a copyrighted song", () => checkSoundCopyright(sound)).classList.add("extra");
  if (sfxUser() && (sfxUser().canUpload || sound.mine)) {
    add(SFX_ICONS.edit, "Change the name or category", () => openEditSound(sound)).classList.add("extra");
  }
  if (sfxUser() && sfxUser().canUpload) {
    // Deleting needs a second click, so it can't happen by accident.
    const bin = add(SFX_ICONS.trash, "Delete this sound for everyone", async () => {
      if (!sfxSure.has(sound.id)) {
        sfxSure.add(sound.id);
        sfxNotes.set(sound.id, { text: "Click the bin again to delete it for everyone.", kind: "bad" });
        drawSfx();
        setTimeout(() => {
          if (!sfxSure.delete(sound.id)) return;
          sfxNotes.delete(sound.id);
          drawSfx();
        }, 4000);
        return;
      }
      sfxSure.delete(sound.id);
      sfxNotes.set(sound.id, { text: "Deleting...", kind: "" });
      drawSfx();
      const res = await api("/api/sfx-delete", { id: sound.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
      if (res.ok) {
        sfxNotes.delete(sound.id);
        sfxSounds = sfxSounds.filter((s) => s.id !== sound.id);
        if (sfxPlaying === sound.id) stopSfx();
      } else {
        sfxNotes.set(sound.id, { text: res.error, kind: "bad" });
      }
      drawSfx();
    });
    bin.classList.add("extra");
    if (sfxSure.has(sound.id)) { bin.style.color = "var(--red)"; bin.classList.add("sure"); }
  }
  return el;
}

async function toggleSfxFavorite(sound) {
  const on = !sound.favorite;
  sound.favorite = on; // show it right away
  drawSfx();
  const res = await api("/api/sfx-favorite", { id: sound.id, on }).catch(() => ({ ok: false, error: "Couldn't save that." }));
  if (sfxLoggedOut(res)) return;
  if (!res.ok) {
    sound.favorite = !on;
    sfxNotes.set(sound.id, { text: res.error, kind: "bad" });
    drawSfx();
  }
}

async function downloadSfx(sound) {
  if (sfxDownloading.has(sound.id)) return;
  sfxDownloading.add(sound.id);
  const folder = await whereToSave().finally(() => sfxDownloading.delete(sound.id));
  if (!folder || sfxDownloading.has(sound.id)) return;
  sfxDownloading.add(sound.id);
  sfxNotes.set(sound.id, { text: "Downloading...", kind: "" });
  drawSfx();
  const res = await api("/api/sfx-download", { url: sound.url, name: sound.name, folder })
    .catch(() => ({ ok: false, error: "Couldn't download that sound." }))
    .finally(() => sfxDownloading.delete(sound.id));
  sfxNotes.set(sound.id, res.ok ? { text: "Saved as " + res.fileName, kind: "saved", path: res.path }
    : { text: res.error, kind: "bad" });
  drawSfx();
}

$("sfxSearch").addEventListener("input", drawSfx);

// ---- playing

const sfxAudio = $("sfxAudio");

// The sounds in the list right now, in order (for next and previous in the player bar).
let sfxShown = [];

function sfxNeighbour(sound, step) {
  const list = sfxShown.length ? sfxShown : sfxSounds;
  const at = list.findIndex((s) => s.id === sound.id);
  const next = list[at === -1 ? 0 : (at + step + list.length) % list.length];
  return next && next.id !== sound.id ? next : null;
}

function sfxPlayerMeta(sound) {
  return {
    key: sound.id,
    title: sound.name,
    sub: [sound.uploader, sound.categoryName].filter(Boolean).join(" · "),
    avatar: { url: sound.uploaderAvatar, name: sound.uploader || sound.name },
    peaks: () => sound.peaks || sfxPeaks.get(sound.path),
    toggle: () => playSfx(sound),
    next: () => { const n = sfxNeighbour(sound, 1); if (n) playSfx(n); },
    prev: () => { const n = sfxNeighbour(sound, -1); if (n) playSfx(n); },
    download: () => downloadSfx(sound),
    favorite: { on: () => sound.favorite, toggle: () => toggleSfxFavorite(sound) },
    // (Jumping doesn't start a paused sound, like any player.)
    seek: (fraction) => {
      if (sfxPlaying === sound.id && sfxAudio.duration) sfxAudio.currentTime = fraction * sfxAudio.duration;
      else playSfx(sound, fraction);
    },
  };
}

// Click the playing sound again to pause it (it stays where it was), and again to go on.
// Where to start a sound that's still loading (only for that sound, not the next one clicked).
let sfxSeekWanted = null;

function playSfx(sound, from = null) {
  if (sfxPlaying === sound.id && from === null) {
    if (!sfxAudio.paused) return sfxAudio.pause();
    showPlayer(sfxAudio, sfxPlayerMeta(sound));
    return sfxAudio.play().catch(() => {});
  }
  if (sfxPlaying !== sound.id) {
    sfxPlaying = sound.id;
    sfxSeekWanted = from === null ? null : { id: sound.id, from };
    sfxAudio.src = sound.url;
    drawSfx();
  } else if (from !== null && sfxAudio.duration) {
    sfxAudio.currentTime = from * sfxAudio.duration;
  }
  showPlayer(sfxAudio, sfxPlayerMeta(sound));
  sfxAudio.play().catch((e) => {
    // Another sound was clicked before this one started: not an error.
    if (e && e.name === "AbortError" || sfxPlaying !== sound.id) return;
    sfxNotes.set(sound.id, { text: "Couldn't play it. Check your internet connection.", kind: "bad" });
    stopSfx();
  });
}

function stopSfx() {
  sfxAudio.pause();
  sfxPlaying = null;
  drawSfx();
}

sfxAudio.addEventListener("ended", stopSfx);
sfxAudio.addEventListener("loadedmetadata", () => {
  const want = sfxSeekWanted;
  sfxSeekWanted = null;
  if (want && want.id === sfxPlaying && sfxAudio.duration) sfxAudio.currentTime = want.from * sfxAudio.duration;
});
// Paused from the player bar (or Space): the row's button follows.
for (const type of ["play", "pause"]) sfxAudio.addEventListener(type, () => { if (sfxPlaying) drawSfx(); });
registerPlayer(sfxAudio, stopSfx);
sfxAudio.addEventListener("timeupdate", () => {
  const row = sfxPlaying && $("sfxList").querySelector(`[data-id="${sfxPlaying}"]`);
  if (!row || !sfxAudio.duration) return;
  const done = sfxAudio.currentTime / sfxAudio.duration;
  const bars = row.querySelectorAll(".bars i");
  bars.forEach((bar, i) => bar.classList.toggle("on", i / bars.length < done));
  row.querySelector(".time").textContent = clock(sfxAudio.currentTime, false);
});

// ---- waveforms (made by the app the first time a sound is shown, then remembered)

const sfxPeaks = new Map(); // path -> peaks
const sfxPeaksWanted = [];
const sfxPeaksBeingMade = new Set(); // paths asked for right now (so they're not asked for twice)
const sfxPeaksFailed = new Set(); // not tried again until the tab is opened again
let sfxPeaksBusy = 0;

function drawSoundWave(wave, sound) {
  const peaks = sound.peaks || sfxPeaks.get(sound.path);
  const bars = wave.querySelector(".bars");
  const count = 72;
  for (let i = 0; i < count; i++) {
    const bar = document.createElement("i");
    bar.style.height = peaks ? Math.max(8, peaks[i] * 100) + "%" : "8%";
    bars.append(bar);
  }
  wave.classList.toggle("loading", !peaks);
  if (!peaks && !sfxPeaksWanted.includes(sound.path) && !sfxPeaksBeingMade.has(sound.path) && !sfxPeaksFailed.has(sound.path)) {
    sfxPeaksWanted.push(sound.path);
    fetchPeaks();
  }
}

async function fetchPeaks() {
  while (sfxPeaksBusy < 2 && sfxPeaksWanted.length) {
    const path = sfxPeaksWanted.shift();
    sfxPeaksBusy++;
    sfxPeaksBeingMade.add(path);
    api("/api/sfx-peaks", { path }).catch(() => ({ ok: false })).then((res) => {
      sfxPeaksBusy--;
      sfxPeaksBeingMade.delete(path);
      if (!res.ok) sfxPeaksFailed.add(path);
      if (res.ok) {
        sfxPeaks.set(path, res.peaks);
        for (const sound of sfxSounds) if (sound.path === path) sound.peaks = res.peaks;
        for (const sound of sfxSounds.filter((s) => s.path === path)) {
          const row = $("sfxList").querySelector(`[data-id="${sound.id}"]`);
          if (!row) continue;
          const wave = row.querySelector(".sound-wave");
          wave.querySelector(".bars").replaceChildren();
          drawSoundWave(wave, sound);
        }
        playerRefresh();
      }
      fetchPeaks();
    });
  }
}

// ---- uploading

let sfxFile = null; // {id, file, seconds, name}
let sfxPart = null; // {start, end} or null for all of it
let sfxUploadCategory = "sfx";

function pickUploadCategory(value) {
  sfxUploadCategory = value;
  for (const b of $("sfxCategory").children) b.classList.toggle("active", b.dataset.value === value);
}

function openSfxUpload() {
  $("sfxModal").hidden = false;
  $("sfxUploadError").textContent = "";
  pickUploadCategory(sfxAccount.categories[sfxCategory] ? sfxCategory : sfxUploadCategory);
  drawSfxFile();
}

function closeSfxUpload() {
  $("sfxModal").hidden = true;
  if (sfxFile) api("/api/sfx-forget", { id: sfxFile.id });
  sfxFile = null;
  sfxPart = null;
}

// The same name (any capitals) or the very same file can only be in the Library once.
function sfxUploadProblem() {
  if (!sfxFile) return "";
  const name = $("sfxName").value.trim().toLowerCase();
  const taken = name && sfxSounds.find((s) => s.name.trim().toLowerCase() === name);
  if (taken) return `There's already a sound called "${taken.name}". Pick another name.`;
  const dup = sfxFile.duplicate;
  if (dup && !sfxPart) {
    return `This file is already in the Library${dup.uploader ? ` (${dup.uploader} uploaded it as "${dup.name}")` : ""}. `
      + "Trim it to upload just a part, or pick another file.";
  }
  return "";
}

function drawSfxProblem() {
  const problem = sfxUploadProblem();
  const box = $("sfxUploadError");
  if (problem || box.classList.contains("clash")) box.textContent = problem;
  box.classList.toggle("clash", !!problem);
  $("sfxSend").disabled = !sfxFile || !!problem;
}

function drawSfxFile() {
  $("sfxForm").hidden = !sfxFile;
  drawSfxProblem();
  $("sfxDropText").innerHTML = sfxFile
    ? `<strong></strong> · <span class="link">pick another</span>`
    : `<strong>Drop a sound or video here</strong> or <span class="link">choose a file</span>`;
  if (sfxFile) {
    $("sfxDropText").querySelector("strong").textContent = sfxFile.file;
    $("sfxPart").textContent = sfxPart ? `${clock(sfxPart.start)} to ${clock(sfxPart.end)}` : `All of it (${clock(sfxFile.seconds, false)})`;
  }
}

function useSfxFile(file) {
  if (sfxFile) api("/api/sfx-forget", { id: sfxFile.id });
  sfxFile = file;
  sfxPart = null;
  if (!$("sfxName").value || $("sfxName").dataset.auto === "1") {
    $("sfxName").value = file.name;
    $("sfxName").dataset.auto = "1";
  }
  drawSfxFile();
}
$("sfxName").addEventListener("input", () => { $("sfxName").dataset.auto = ""; drawSfxProblem(); });

async function addSfxFile(file) {
  $("sfxUploadError").textContent = "";
  $("sfxDropText").textContent = `Opening ${file.name}... (${sizeText(file.size)})`;
  const res = await fetch("/api/sfx-add", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file })
    .then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't open this file." }));
  if (res.ok) useSfxFile(res.file);
  else {
    $("sfxUploadError").textContent = res.error;
    drawSfxFile();
  }
}

// Called by images.js for files dropped on the window.
function sfxTakesDrop(files) {
  if ($("sfxModal").hidden && $("sfxTab").hidden) return false;
  if (!sfxUser() || !sfxUser().canUpload) return false;
  if ($("sfxModal").hidden) openSfxUpload();
  addSfxFile(files[0]);
  return true;
}

let sfxPicking = false;
$("sfxDrop").addEventListener("click", async (e) => {
  if (e.target === $("sfxFileInput")) return;
  e.preventDefault();
  if (sfxPicking) return;
  sfxPicking = true;
  const res = await api("/api/sfx-pick", {}).catch(() => ({ ok: false, fallback: true }));
  sfxPicking = false;
  if (res.fallback) return $("sfxFileInput").click(); // not on Windows: the browser's own picker
  if (!res.ok) $("sfxUploadError").textContent = res.error;
  else if (res.file) useSfxFile(res.file);
});
$("sfxFileInput").addEventListener("change", () => {
  if ($("sfxFileInput").files[0]) addSfxFile($("sfxFileInput").files[0]);
  $("sfxFileInput").value = "";
});

$("sfxTrim").addEventListener("click", () => {
  if (!sfxFile) return;
  const file = sfxFile;
  openTrim({
    key: "sfx:" + file.id, request: { sfx: file.id }, video: false,
    title: file.file, duration: file.seconds,
    start: sfxPart ? sfxPart.start : 0, end: sfxPart ? sfxPart.end : file.seconds,
    done: (part) => {
      if (sfxFile !== file) return;
      sfxPart = part;
      drawSfxFile();
    },
  });
});

$("sfxUploadOpen").addEventListener("click", openSfxUpload);
$("sfxCancel").addEventListener("click", closeSfxUpload);

$("sfxSend").addEventListener("click", async () => {
  if (!sfxFile) return;
  const name = $("sfxName").value.trim();
  if (!name) {
    $("sfxUploadError").textContent = "Give the sound a name.";
    return $("sfxName").focus();
  }
  if (sfxUploadProblem()) return drawSfxProblem();
  $("sfxSend").disabled = true;
  const res = await api("/api/sfx-upload", {
    id: sfxFile.id, name, category: sfxUploadCategory,
    start: sfxPart ? sfxPart.start : null, end: sfxPart ? sfxPart.end : null,
  }).catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  drawSfxProblem();
  if (sfxLoggedOut(res)) return ($("sfxModal").hidden = true);
  if (!res.ok) {
    $("sfxUploadError").textContent = res.error;
    return;
  }
  // It uploads in the background; the tab shows how it's going.
  sfxFile = null;
  sfxPart = null;
  $("sfxName").value = "";
  $("sfxModal").hidden = true;
});

// Uploads in progress, from the app's state (called by app.js a few times a second).
let sfxDoneSeen = new Set();
let sfxUploadsDrawn = "";
const sfxStrips = new Map(); // upload id -> its strip
function renderSfxUploads(list) {
  list = list || [];
  // Unchanged since last time: leave it be (rebuilding it every moment can swallow a click).
  const sig = JSON.stringify(list);
  if (sig === sfxUploadsDrawn) return;
  sfxUploadsDrawn = sig;
  const box = $("sfxUploads");
  setChildren(box, list.map((item) => {
    let el = sfxStrips.get(item.id);
    if (!el) {
      el = document.createElement("div");
      el.innerHTML = `<div class="up-text"><b></b><span></span></div><div class="bar"><div></div></div>`;
      sfxStrips.set(item.id, el);
    }
    el.className = "upload-strip " + item.status;
    el.querySelector("b").textContent = item.name;
    el.querySelector("span").textContent = item.message;
    const bar = el.querySelector(".bar");
    bar.hidden = item.status !== "uploading";
    bar.classList.toggle("indeterminate", !item.progress || item.progress >= 100);
    bar.firstElementChild.style.width = item.progress && item.progress < 100 ? item.progress + "%" : "";
    let hide = el.querySelector(".up-text .icon-button");
    if (item.status !== "uploading" && !hide) {
      hide = document.createElement("button");
      hide.className = "icon-button";
      hide.title = "Hide";
      hide.innerHTML = ICONS.remove;
      hide.onclick = () => api("/api/sfx-forget", { id: item.id });
      el.querySelector(".up-text").append(hide);
    } else if (item.status === "uploading" && hide) {
      hide.remove();
    }
    return el;
  }));
  for (const id of sfxStrips.keys()) if (!list.some((item) => item.id === id)) sfxStrips.delete(id);
  // A sound finished uploading: show it in the list.
  const done = list.filter((i) => i.status === "done").map((i) => i.id);
  if (done.some((id) => !sfxDoneSeen.has(id)) && sfxUser()) loadSfx();
  sfxDoneSeen = new Set(done);
}

// New sounds from friends show up while the tab is open.
setInterval(() => {
  if (!$("sfxTab").hidden && sfxUser() && !document.hidden) loadSfx();
}, 60000);

// Instant start: show who was logged in, and their Library, from last time.
if (pageCache.account && pageCache.account.user) {
  sfxAccount = pageCache.account;
  sfxFromCache = true;
  if (Array.isArray(pageCache.sounds)) sfxSounds = pageCache.sounds;
  drawSfxAccount();
}
if (!$("sfxTab").hidden) openSfx();
else loadAccount();

// ---- changing a sound's name or category (the one who uploaded it, or an owner or admin)

let editingSound = null;
function openEditSound(sound) {
  editingSound = { id: sound.id, category: sound.category };
  $("editSoundName").value = sound.name;
  $("editSoundNote").textContent = "";
  drawEditCats();
  $("editSoundModal").hidden = false;
  $("editSoundName").focus();
  $("editSoundName").select();
}
function drawEditCats() {
  const cats = (sfxAccount && sfxAccount.categories) || {};
  setChildren($("editSoundCats"), Object.entries(cats).map(([value, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = value === editingSound.category ? "active" : "";
    b.onclick = () => { editingSound.category = value; drawEditCats(); };
    return b;
  }));
}
function closeEditSound() { $("editSoundModal").hidden = true; editingSound = null; }
async function saveEditSound() {
  if (!editingSound) return;
  $("editSoundSave").disabled = true;
  const res = await api("/api/sfx-edit", { id: editingSound.id, name: $("editSoundName").value, category: editingSound.category })
    .catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  $("editSoundSave").disabled = false;
  if (sfxLoggedOut(res)) return closeEditSound();
  if (!res.ok) return void ($("editSoundNote").textContent = res.error);
  mergeSounds(res.sounds);
  closeEditSound();
  drawSfx();
}
$("editSoundSave").addEventListener("click", saveEditSound);
$("editSoundName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveEditSound(); });
$("editSoundCancel").addEventListener("click", closeEditSound);
$("editSoundModal").addEventListener("click", (e) => { if (e.target === $("editSoundModal")) closeEditSound(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("editSoundModal").hidden) closeEditSound(); });
