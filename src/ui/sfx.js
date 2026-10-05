// The Library tab: sounds and music shared with friends, who log in with an account.
// Uses $, api(), clock(), openTrim(), ICONS from app.js, showTab() and sizeText() from images.js.

const SFX_ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
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
  sfxAccount = res.account;
  drawSfxAccount();
  return true;
}

async function openSfx() {
  sfxPeaksFailed.clear();
  if (!sfxAccount && !(await loadAccount())) return;
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
  if (res.ok) {
    sfxSounds = res.sounds;
    sfxError = "";
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

function sideButton(label, count, active, onclick, extraClass = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "side-item " + extraClass + (active ? " active" : "");
  b.innerHTML = '<span class="side-label"></span><span class="count"></span>';
  b.querySelector(".side-label").textContent = label;
  b.querySelector(".count").textContent = count;
  b.onclick = () => { onclick(); sfxLimit = 200; drawSfx(); };
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
  const pick = (value) => () => { sfxCategory = value; };
  $("sfxBrowse").replaceChildren(
    sideButton("All sounds", counts.all, sfxCategory === "all", pick("all"), "side-all"),
    sideButton("Favorites", counts.favorites, sfxCategory === "favorites", pick("favorites"), "fav-chip"));
  $("sfxCats").replaceChildren(...Object.entries(sfxAccount.categories).map(([value, label]) =>
    sideButton(label, counts[value] || 0, sfxCategory === value, pick(value), "cat-" + value)));
  if (sfxUploader && sfxSounds.length && !people.has(sfxUploader)) sfxUploader = "";
  const names = [...people.keys()].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));
  $("sfxPeople").replaceChildren(
    sideButton("Everyone", counts.all, !sfxUploader, () => { sfxUploader = ""; }),
    ...names.map((name) => {
      const b = sideButton(name, people.get(name).count, sfxUploader === name, () => { sfxUploader = sfxUploader === name ? "" : name; });
      b.prepend(avatarEl(people.get(name).avatar, name, "tiny"));
      return b;
    }));
}

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

function rowFor(sound) {
  const note = sfxNotes.get(sound.id);
  const sig = [sound.name, sound.favorite, sound.uploader, sound.uploaderAvatar, sound.peaks ? 1 : 0, sfxPlaying === sound.id,
    note && note.text, sfxSure.has(sound.id), sfxUser() && sfxUser().canUpload].join("|");
  const kept = sfxRows.get(sound.id);
  if (kept && kept.sig === sig && kept.sound === sound) return kept.el;
  const el = sfxRow(sound);
  sfxRows.set(sound.id, { el, sig, sound });
  return el;
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
  const rows = shown.slice(0, sfxLimit).map(rowFor);
  if (shown.length > sfxLimit) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "outline-button lib-more";
    more.textContent = `Show more (${shown.length - sfxLimit} left)`;
    more.onclick = () => { sfxLimit += 200; drawSfx(); };
    rows.push(more);
  }
  $("sfxList").replaceChildren(...rows);
  for (const id of sfxRows.keys()) if (!sfxSounds.some((s) => s.id === id)) sfxRows.delete(id);
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
      by.append("Uploaded by ", avatarEl(sound.uploaderAvatar, sound.uploader, "tiny"));
      const name = document.createElement("b");
      name.className = "by-name";
      name.textContent = sound.uploader;
      name.title = "See " + sound.uploader + "'s profile";
      name.onclick = (e) => { e.stopPropagation(); openProfile(sound.uploader); };
      by.append(name);
      meta.append(" · ", by);
    }
    meta.append(" · " + sfxAgo(sound.created_at));
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
    sound.favorite ? "Remove from your favorites" : "Add to your favorites (they show at the top)", async () => {
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
    });
  star.classList.add("star");
  star.classList.toggle("on", !!sound.favorite);
  if (note && note.path) add(ICONS.folder, "Show in folder", () => api("/api/sfx-show", { path: note.path }));
  add(SFX_ICONS.download, "Download (saved in your downloads folder as MP3)", async (b) => {
    b.disabled = true;
    sfxNotes.set(sound.id, { text: "Downloading...", kind: "" });
    drawSfx();
    const res = await api("/api/sfx-download", { url: sound.url, name: sound.name })
      .catch(() => ({ ok: false, error: "Couldn't download that sound." }));
    sfxNotes.set(sound.id, res.ok ? { text: "Saved as " + res.fileName, kind: "saved", path: res.path }
      : { text: res.error, kind: "bad" });
    drawSfx();
  });
  add(SFX_ICONS.chat, "Send to the live chat", () => shareToChat({ sound: { id: sound.id, name: sound.name } }));
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
    if (sfxSure.has(sound.id)) bin.style.color = "var(--red)";
  }
  return el;
}

$("sfxSearch").addEventListener("input", drawSfx);

// ---- playing

const sfxAudio = $("sfxAudio");

function playSfx(sound, from = null) {
  if (sfxPlaying === sound.id && from === null) return stopSfx();
  const start = () => {
    if (from !== null && sfxAudio.duration) sfxAudio.currentTime = from * sfxAudio.duration;
  };
  if (sfxPlaying !== sound.id) {
    sfxPlaying = sound.id;
    sfxAudio.src = sound.url;
    if (from !== null) sfxAudio.addEventListener("loadedmetadata", start, { once: true });
    drawSfx();
  } else {
    start();
  }
  sfxAudio.play().catch(() => {
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
  if (!peaks && !sfxPeaksWanted.includes(sound.path) && !sfxPeaksFailed.has(sound.path)) {
    sfxPeaksWanted.push(sound.path);
    fetchPeaks();
  }
}

async function fetchPeaks() {
  while (sfxPeaksBusy < 2 && sfxPeaksWanted.length) {
    const path = sfxPeaksWanted.shift();
    sfxPeaksBusy++;
    api("/api/sfx-peaks", { path }).catch(() => ({ ok: false })).then((res) => {
      sfxPeaksBusy--;
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

function drawSfxFile() {
  $("sfxForm").hidden = !sfxFile;
  $("sfxSend").disabled = !sfxFile;
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
$("sfxName").addEventListener("input", () => { $("sfxName").dataset.auto = ""; });

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
  $("sfxSend").disabled = true;
  const res = await api("/api/sfx-upload", {
    id: sfxFile.id, name, category: sfxUploadCategory,
    start: sfxPart ? sfxPart.start : null, end: sfxPart ? sfxPart.end : null,
  }).catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  $("sfxSend").disabled = false;
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
function renderSfxUploads(list) {
  list = list || [];
  // Unchanged since last time: leave it be (rebuilding it every moment can swallow a click).
  const sig = JSON.stringify(list);
  if (sig === sfxUploadsDrawn) return;
  sfxUploadsDrawn = sig;
  const box = $("sfxUploads");
  box.replaceChildren(...list.map((item) => {
    const el = document.createElement("div");
    el.className = "upload-strip " + item.status;
    el.innerHTML = `<div class="up-text"><b></b><span></span></div><div class="bar"><div></div></div>`;
    el.querySelector("b").textContent = item.name;
    el.querySelector("span").textContent = item.message;
    const bar = el.querySelector(".bar");
    bar.hidden = item.status !== "uploading";
    bar.classList.toggle("indeterminate", !item.progress || item.progress >= 100);
    bar.firstElementChild.style.width = item.progress && item.progress < 100 ? item.progress + "%" : "";
    if (item.status !== "uploading") {
      const b = document.createElement("button");
      b.className = "icon-button";
      b.title = "Hide";
      b.innerHTML = ICONS.remove;
      b.onclick = () => api("/api/sfx-forget", { id: item.id });
      el.querySelector(".up-text").append(b);
    }
    return el;
  }));
  // A sound finished uploading: show it in the list.
  const done = list.filter((i) => i.status === "done").map((i) => i.id);
  if (done.some((id) => !sfxDoneSeen.has(id)) && sfxUser()) loadSfx();
  sfxDoneSeen = new Set(done);
}

// New sounds from friends show up while the tab is open.
setInterval(() => {
  if (!$("sfxTab").hidden && sfxUser() && !document.hidden) loadSfx();
}, 60000);

if (!$("sfxTab").hidden) openSfx();
else loadAccount();
