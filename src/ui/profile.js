// Profiles: click anyone's name or picture (chat, Library, Boards, Games, POVs, calls, Home...) to see
// their banner, bio, status, whether they're online or in a call, their newest YouTube videos, games,
// POVs and sounds, with buttons to message them, call them or invite them to a board.
// Also the "Your profile" editor on the Account page.
// Uses $, api(), clock(), setDrag(), DRAG_HINT from app.js, setChildren() from motion.js, showTab() from
// images.js, avatarEl(), sfxAgo(), sfxLoggedOut(), sfxUser(), openLogin(), SFX_ICONS from sfx.js,
// openChat() from chat.js, callStart() from call.js, openWatch() from watch.js, openGame() from games.js,
// shortNumber() from home.js and bdBg() from boards.js (only once they're used).

const ROLE_NAMES = { owner: "Owner", admin: "Admin", viewer: "Viewer" };
const CAT_NAMES = { sfx: "SFX", music: "Music", memes: "Memes", ambience: "Ambience", other: "Other" };
// The colors you can pick for your profile (null: the app's own accent color).
const PF_COLORS = [null, "#ff8a3d", "#ff5c5c", "#ff6fb5", "#a879ff", "#4f9dff", "#3fd0c9", "#7ed957", "#e8e4da"];
const PF_PARTS = [
  ["online", "Online status"], ["videos", "Videos and streams"], ["games", "Games"],
  ["povs", "POVs"], ["sounds", "Sounds"], ["stats", "Numbers"],
];
const PF_PART_NAMES = { online: "online status", videos: "videos and streams", games: "games", povs: "POVs", sounds: "sounds", stats: "numbers" };

let profileShown = null;
let profilePlaying = null;
let profileVideoTimer = 0;
const profileAudio = new Audio();
profileAudio.addEventListener("ended", () => { profilePlaying = null; drawProfileSounds(); });
registerPlayer(profileAudio, () => { profileAudio.pause(); profilePlaying = null; drawProfileSounds(); });
for (const type of ["play", "pause"]) profileAudio.addEventListener(type, () => { if (profilePlaying) drawProfileSounds(); });

function pfEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// Dark or light text, whichever is easier to read on this color.
function pfInk(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return "";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#141414" : "#ffffff";
}

// Puts someone's color on a profile card (or takes it off: the app's accent color).
function pfPaint(el, accent) {
  if (accent) {
    el.style.setProperty("--pf", accent);
    el.style.setProperty("--pf-ink", pfInk(accent));
  } else {
    el.style.removeProperty("--pf");
    el.style.removeProperty("--pf-ink");
  }
}

function pfBanner(el, url) {
  el.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "";
  el.classList.toggle("has-picture", !!url);
}

// Makes a name or a picture open that person's profile when clicked.
function profileLink(el, username) {
  if (!el || !username) return el;
  el.dataset.profile = username;
  el.classList.add("profile-link");
  if (!el.title) el.title = `See ${username}'s profile`;
  return el;
}
// (Caught before the click reaches anything else, so a face on a card doesn't also open the card.)
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-profile]");
  if (!el || el.closest("#profileModal")) return;
  e.preventDefault();
  e.stopPropagation();
  openProfile(el.dataset.profile);
}, true);

// ---------------------------------------------------------------- someone's profile

async function openProfile(username) {
  if (!username) return;
  if (!sfxUser()) return openLogin("login");
  profileShown = { username, loading: true };
  closeProfileInvite();
  clearTimeout(profileVideoTimer);
  const dialog = $("profileModal").querySelector(".dialog");
  pfPaint(dialog, null);
  pfBanner($("profileBanner"), "");
  $("profileName").textContent = username;
  $("profileAvatar").replaceChildren(avatarEl("", username, "huge"));
  $("profileDot").hidden = true;
  $("profileRole").textContent = "";
  $("profileSeen").textContent = "Loading...";
  $("profileSeen").className = "";
  for (const id of ["profileStatus", "profileBio", "profileVideosPart", "profileGamesPart", "profilePovsPart",
    "profileSoundsPart", "profileHiddenNote", "profileActions"]) $(id).hidden = true;
  $("profileStats").replaceChildren();
  $("profileNote").textContent = "";
  $("profileModal").hidden = false;
  dialog.scrollTop = 0;
  const res = await api("/api/sfx-profile", { username }).catch(() => ({ ok: false, error: "Couldn't load the profile." }));
  if (!profileShown || profileShown.username !== username) return;
  if (sfxLoggedOut(res)) return closeProfile();
  if (!res.ok) {
    $("profileSeen").textContent = "";
    $("profileNote").textContent = res.error;
    return;
  }
  drawProfile(res.profile);
}

function drawProfile(p) {
  profileShown = p;
  const dialog = $("profileModal").querySelector(".dialog");
  pfPaint(dialog, p.accent);
  pfBanner($("profileBanner"), p.bannerUrl);
  $("profileName").textContent = p.username;
  $("profileAvatar").replaceChildren(avatarEl(p.avatarUrl, p.username, "huge"));
  $("profileRole").textContent = ROLE_NAMES[p.role] || p.role;
  $("profileRole").className = "role role-" + p.role;

  const seen = $("profileSeen");
  const dot = $("profileDot");
  dot.hidden = !p.online;
  dot.className = "pf-dot" + (p.in_call ? " in-call" : "");
  dot.title = p.in_call ? "In a call" : "Online";
  seen.className = p.in_call ? "online" : p.online ? "online" : "";
  seen.textContent = p.in_call ? "In a call right now" : p.online ? "Online now"
    : p.last_seen ? "Last online " + sfxAgo(p.last_seen) : p.me ? "" : "Not online for a while";

  $("profileStatus").hidden = !p.status;
  $("profileStatus").textContent = p.status || "";
  $("profileBio").hidden = !p.bio;
  $("profileBio").textContent = p.bio || "";

  const since = new Date(p.created_at).toLocaleDateString([], { month: "short", year: "numeric" });
  setChildren($("profileStats"), (p.show_stats ? [
    [p.sounds, p.sounds === 1 ? "sound" : "sounds"],
    [p.votes, p.votes === 1 ? "game vote" : "game votes"],
    [p.messages, p.messages === 1 ? "message" : "messages"],
    [since, "joined"],
  ] : [[since, "joined"]]).map(([value, label]) => {
    const box = pfEl("div");
    box.append(pfEl("b", "", value), pfEl("span", "", label));
    return box;
  }));
  $("profileStats").classList.toggle("one", !p.show_stats);
  if (typeof drawProfileLive === "function") drawProfileLive(p);

  // Buttons: yours is "Edit profile"; theirs are message, call and invite.
  $("profileActions").hidden = false;
  $("profileEdit").hidden = !p.me;
  for (const id of ["profileMessage", "profileCall", "profileInvite"]) $(id).hidden = p.me;
  $("profileCall").disabled = !p.online || !!p.in_call;
  $("profileCall").title = p.in_call ? `${p.username} is in another call right now` : p.online ? `Call ${p.username}` : `${p.username} isn't online right now`;

  const hidden = p.hide || [];
  $("profileVideosPart").hidden = true;
  if (p.youtube && !(p.me && hidden.includes("videos"))) loadProfileVideos(p);
  drawProfileGames();
  drawProfilePovs();
  $("profileSoundsPart").hidden = !p.recent.length;
  $("profileAll").hidden = !p.sounds;
  drawProfileSounds();
  $("profileHiddenNote").hidden = !(p.me && hidden.length);
  if (p.me && hidden.length) {
    $("profileHiddenNote").textContent = "Friends don't see your " + hidden.map((h) => PF_PART_NAMES[h]).filter(Boolean).join(", ")
      .replace(/, ([^,]*)$/, " or $1") + ". You can change that in Edit profile.";
  }
}

// Their YouTube channel's newest videos (looked up in the background: it can take a few seconds).
async function loadProfileVideos(p, tries = 0) {
  const res = await api("/api/sfx-profile-videos", { url: p.youtube }).catch(() => ({ ok: false }));
  if (profileShown !== p) return;
  if (res.ok && res.loading && tries < 15) {
    drawProfileVideos(p, null);
    profileVideoTimer = setTimeout(() => loadProfileVideos(p, tries + 1), 1500);
    return;
  }
  drawProfileVideos(p, res.ok ? res : { videos: [], error: res.error || "Couldn't load the videos." });
}

function drawProfileVideos(p, info) {
  $("profileVideosPart").hidden = false;
  const channel = $("profileChannel");
  channel.textContent = info && info.subscribers != null ? `${shortNumber(info.subscribers)} subscribers` : "Channel";
  channel.onclick = () => api("/api/games-open", { url: p.youtube });
  const box = $("profileVideos");
  if (!info) return box.replaceChildren(...[0, 1].map(() => pfEl("div", "pf-video loading")));
  if (!info.videos.length) return box.replaceChildren(pfEl("p", "pf-empty", info.error || "No videos yet."));
  box.replaceChildren(...info.videos.slice(0, 4).map((v) => {
    const el = pfEl("button", "pf-video");
    el.type = "button";
    el.title = v.title;
    const pic = pfEl("span", "pf-thumb");
    const img = pfEl("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = v.thumbnail;
    pic.append(img);
    if (v.seconds) pic.append(pfEl("i", "", clock(v.seconds, false)));
    const sub = [v.views != null ? shortNumber(v.views) + " views" : "", v.when ? sfxAgo(v.when * 1000) : ""].filter(Boolean).join(" · ");
    el.append(pic, pfEl("b", "", v.title), pfEl("span", "", sub));
    el.onclick = () => openWatch(v.url, { title: v.title, sub: info.name || p.username });
    return el;
  }));
}

function drawProfileGames() {
  const p = profileShown;
  $("profileGamesPart").hidden = !p.games.length;
  const STATUS = { idea: "", recording: "Recording", done: "Recorded" };
  $("profileGames").replaceChildren(...p.games.map((g) => {
    const el = pfEl("button", "pf-game");
    el.type = "button";
    el.title = g.name;
    const pic = pfEl("span", "pf-game-pic");
    if (g.header) {
      const img = pfEl("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = g.header;
      pic.append(img);
    }
    const tags = pfEl("span", "pf-tags");
    if (g.posted) tags.append(pfEl("em", "", "Posted"));
    if (g.voted) tags.append(pfEl("em", "", "Voted"));
    if (STATUS[g.status]) tags.append(pfEl("em", "st", STATUS[g.status]));
    el.append(pic, pfEl("b", "", g.name), tags);
    el.onclick = () => {
      closeProfile();
      if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
      showTab("games");
      if (typeof openGame === "function") openGame(g.id);
    };
    return el;
  }));
}

function drawProfilePovs() {
  const p = profileShown;
  $("profilePovsPart").hidden = !p.povs.length;
  $("profilePovs").replaceChildren(...p.povs.map((f) => {
    const el = pfEl("button", "pf-pov");
    el.type = "button";
    const pic = pfEl("span", "pf-thumb");
    if (f.thumb) {
      const img = pfEl("img");
      img.alt = "";
      img.src = f.thumb;
      pic.append(img);
    }
    if (f.seconds) pic.append(pfEl("i", "", clock(f.seconds, false)));
    el.append(pic, pfEl("b", "", f.title), pfEl("span", "", [f.game, sfxAgo(f.created * 1000)].filter(Boolean).join(" · ")));
    el.onclick = () => {
      closeProfile();
      if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
      showTab("povs");
    };
    return el;
  }));
}

// Play one of their sounds (click again to pause).
function playProfileSound(s) {
  if (profilePlaying === s.id && profileAudio.src) {
    if (!profileAudio.paused) return profileAudio.pause();
  } else {
    profileAudio.src = s.url;
    profilePlaying = s.id;
  }
  profileAudio.play().catch(() => {});
  drawProfileSounds();
}

function drawProfileSounds() {
  const p = profileShown;
  if (!p || !p.recent) return;
  setChildren($("profileSounds"), p.recent.map((s) => {
    const row = pfEl("div", "chat-sound" + (profilePlaying === s.id ? " playing" : ""));
    setDrag(row, { kind: "sound", url: s.url, name: s.name });
    row.title = DRAG_HINT;
    const play = pfEl("button", "play");
    play.type = "button";
    play.innerHTML = profilePlaying === s.id && !profileAudio.paused ? SFX_ICONS.pause : SFX_ICONS.play;
    play.addEventListener("click", () => playProfileSound(s));
    const info = pfEl("div", "info");
    info.append(pfEl("b", "", s.name), pfEl("span", "", `${CAT_NAMES[s.category] || "SFX"} · ${clock(s.seconds, false)} · ${sfxAgo(s.created_at)}`));
    row.append(play, info);
    return row;
  }));
}

function closeProfile() {
  $("profileModal").hidden = true;
  closeProfileInvite();
  clearTimeout(profileVideoTimer);
  profileAudio.pause();
  profilePlaying = null;
  profileShown = null;
}

// ---- invite them to one of your team boards

function closeProfileInvite() {
  const pop = $("profileModal").querySelector(".pf-invite");
  if (pop) pop.remove();
}

async function openProfileInvite() {
  if ($("profileModal").querySelector(".pf-invite")) return closeProfileInvite();
  const p = profileShown;
  const pop = pfEl("div", "pf-invite");
  pop.append(pfEl("b", "", `Invite ${p.username} to...`), pfEl("p", "pf-empty", "Loading your boards..."));
  $("profileInvite").after(pop);
  const res = await api("/api/boards-team-list", {}).catch(() => ({ ok: false }));
  if (profileShown !== p || !pop.isConnected) return;
  const boards = res.ok ? res.boards.filter((b) => b.mine) : [];
  const rows = boards.map((b) => {
    const on = (b.people || []).some((m) => m.username.toLowerCase() === p.username.toLowerCase());
    const row = pfEl("button", "pf-invite-row");
    row.type = "button";
    const swatch = pfEl("span", "pf-swatch");
    if (typeof bdBg === "function") swatch.style.background = bdBg(b.bg);
    const state = pfEl("small", "", on ? "On it" : "Invite");
    row.append(swatch, pfEl("span", "", b.title), state);
    row.disabled = on;
    row.onclick = async () => {
      row.disabled = true;
      state.textContent = "...";
      const r = await api("/api/boards-team-invite", { id: b.id, usernames: [p.username] }).catch(() => ({ ok: false }));
      state.textContent = r.ok ? "Invited" : "Didn't work";
      if (!r.ok) row.disabled = false;
    };
    return row;
  });
  pop.replaceChildren(pfEl("b", "", `Invite ${p.username} to...`), ...(rows.length ? rows
    : [pfEl("p", "pf-empty", res.ok ? "You don't have any team boards yet. Make one in the Boards tab." : "Couldn't load your boards.")]));
}

$("profileX").addEventListener("click", closeProfile);
$("profileModal").addEventListener("click", (e) => {
  if (e.target === $("profileModal")) return closeProfile();
  if (!e.target.closest(".pf-invite, #profileInvite")) closeProfileInvite();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("profileModal").hidden && $("watchModal").hidden) closeProfile(); });
$("profileFeed")?.addEventListener("click", () => {
  const p = profileShown;
  if (!p || !p.username) return;
  closeProfile();
  if (typeof openFeed === "function") openFeed(p.username);
});
$("profileMessage").addEventListener("click", () => {
  const name = profileShown.username;
  closeProfile();
  openChat(name);
});
$("profileCall").addEventListener("click", () => {
  const name = profileShown.username;
  closeProfile();
  callStart(name);
});
$("profileInvite").addEventListener("click", openProfileInvite);
$("profileEdit").addEventListener("click", () => {
  closeProfile();
  if (typeof chatIsOpen === "function" && chatIsOpen()) closeChat();
  showTab("account");
  setTimeout(() => $("profileEditor").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
});
$("profileAll").addEventListener("click", () => {
  const name = profileShown.username;
  closeProfile();
  if (chatIsOpen()) closeChat();
  showTab("sfx");
  showUploader(name);
});

// ---------------------------------------------------------------- your own profile (Account page)

let peSaved = null;   // your profile as it's saved
let peAccent = null;  // the color picked (not saved yet)
let peHide = [];

async function loadProfileEditor() {
  const user = sfxUser();
  if (!user) return;
  const res = await api("/api/sfx-profile", { username: user.username }).catch(() => ({ ok: false }));
  if (sfxLoggedOut(res) || !res.ok) return;
  peFill(res.profile);
}

function peFill(p) {
  peSaved = p;
  peAccent = p.accent || null;
  peHide = [...(p.hide || [])];
  $("peStatus").value = p.status || "";
  $("peBio").value = p.bio || "";
  $("peYoutube").value = p.youtube ? p.youtube.replace("https://www.", "") : "";
  $("peTwitch").value = p.twitch ? "twitch.tv/" + p.twitch : "";
  $("peNote").textContent = "";
  drawProfileEditor();
}

function peChanged() {
  if (!peSaved) return false;
  const yt = $("peYoutube").value.trim().replace(/^(https?:\/\/)?(www\.)?/, "");
  return $("peStatus").value.trim() !== (peSaved.status || "") || $("peBio").value.trim() !== (peSaved.bio || "")
    || (peAccent || null) !== (peSaved.accent || null) || yt !== (peSaved.youtube || "").replace("https://www.", "")
    || $("peTwitch").value.trim().replace(/^(https?:\/\/)?(www\.)?(twitch\.tv\/)?@?/i, "").replace(/\/$/, "").toLowerCase() !== (peSaved.twitch || "")
    || [...peHide].sort().join() !== [...(peSaved.hide || [])].sort().join();
}

function drawProfileEditor() {
  const user = sfxUser();
  if (!user || !peSaved) return;
  // Colors
  $("peColors").replaceChildren(...PF_COLORS.map((c) => {
    const b = pfEl("button", "pe-color" + ((peAccent || null) === c ? " on" : "") + (c ? "" : " app"));
    b.type = "button";
    b.title = c ? c : "The app's color";
    if (c) b.style.background = c;
    b.onclick = () => { peAccent = c; drawProfileEditor(); };
    return b;
  }));
  // What shows
  $("peShow").replaceChildren(...PF_PARTS.map(([key, label]) => {
    const on = !peHide.includes(key);
    const b = pfEl("button", "pe-chip" + (on ? " on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", on);
    b.innerHTML = on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : "";
    b.append(label);
    b.onclick = () => {
      peHide = on ? [...peHide, key] : peHide.filter((h) => h !== key);
      drawProfileEditor();
    };
    return b;
  }));
  $("peBannerRemove").hidden = !peSaved.banner;
  $("peBanner").textContent = peSaved.banner ? "Change banner" : "Add a banner";
  $("peBioCount").textContent = `${$("peBio").value.length}/300`;
  // Preview
  pfPaint($("pePreview"), peAccent);
  pfBanner($("peBannerView"), peSaved.bannerUrl);
  $("peFace").replaceChildren(avatarEl(user.avatarUrl, user.username, "huge"));
  $("peName").textContent = user.username;
  $("peStatusView").textContent = $("peStatus").value.trim();
  $("peStatusView").hidden = !$("peStatus").value.trim();
  $("peBioView").textContent = $("peBio").value.trim() || "A few words about you show up here.";
  $("peBioView").classList.toggle("empty", !$("peBio").value.trim());
  $("pePreview").querySelector(".pf-dot").hidden = peHide.includes("online");
  $("peSave").disabled = !peChanged();
}

for (const id of ["peStatus", "peBio", "peYoutube", "peTwitch"]) $(id).addEventListener("input", drawProfileEditor);

$("profileEditor").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("peSave").disabled = true;
  $("peSave").textContent = "Saving...";
  const res = await api("/api/sfx-profile-save", { profile: {
    status: $("peStatus").value, bio: $("peBio").value, accent: peAccent, youtube: $("peYoutube").value, twitch: $("peTwitch").value, hide: peHide,
  } }).catch(() => ({ ok: false, error: "Couldn't save. Try again." }));
  $("peSave").textContent = "Save profile";
  if (sfxLoggedOut(res)) return;
  if (!res.ok) {
    note("peNote", res.error);
    return drawProfileEditor();
  }
  peFill(res.profile);
  note("peNote", "Saved!", true);
});

async function sendBanner(promise) {
  $("peBanner").disabled = true;
  $("peBanner").textContent = "Saving...";
  const res = await promise.catch(() => ({ ok: false, error: "Couldn't save the banner." }));
  $("peBanner").disabled = false;
  if (sfxLoggedOut(res)) return;
  if (res.ok && res.profile) {
    // Keep what you typed but haven't saved yet.
    peSaved = { ...peSaved, banner: res.profile.banner, bannerUrl: res.profile.bannerUrl };
  }
  drawProfileEditor();
  if (!res.ok) note("peNote", res.error);
}

$("peBanner").addEventListener("click", async () => {
  const res = await api("/api/sfx-banner-pick", {}).catch(() => ({ ok: false, fallback: true }));
  if (res.fallback) return $("peBannerInput").click(); // not on Windows: the browser's own picker
  sendBanner(Promise.resolve(res));
});
$("peBannerInput").addEventListener("change", () => {
  const file = $("peBannerInput").files[0];
  $("peBannerInput").value = "";
  if (file) sendBanner(fetch("/api/sfx-banner", { method: "POST", body: file }).then((r) => r.json()));
});
$("peBannerRemove").addEventListener("click", () => sendBanner(api("/api/sfx-banner-remove", {})));
$("acctSeeProfile").addEventListener("click", () => sfxUser() && openProfile(sfxUser().username));
