// Someone's profile: click a name or picture in the chat, the Library or the online list.
// Uses $, api(), clock(), setDrag(), DRAG_HINT from app.js, showTab() from images.js,
// avatarEl(), sfxAgo(), sfxLoggedOut(), sfxUser(), SFX_ICONS from sfx.js and openChat() from chat.js.

const ROLE_NAMES = { owner: "Owner", admin: "Admin", viewer: "Viewer" };
const CAT_NAMES = { sfx: "SFX", music: "Music", memes: "Memes", ambience: "Ambience", other: "Other" };
let profileShown = null;
let profilePlaying = null;
const profileAudio = new Audio();
profileAudio.addEventListener("ended", () => { profilePlaying = null; drawProfileSounds(); });
registerPlayer(profileAudio, () => { profileAudio.pause(); profilePlaying = null; drawProfileSounds(); });
for (const type of ["play", "pause"]) profileAudio.addEventListener(type, () => { if (profilePlaying) drawProfileSounds(); });

// Play one of their sounds (click again to pause), shown in the player bar.
function playProfileSound(s) {
  if (profilePlaying === s.id && profileAudio.src) {
    if (!profileAudio.paused) return profileAudio.pause();
  } else {
    profileAudio.src = s.url;
    profilePlaying = s.id;
  }
  profileAudio.play().catch(() => {});
  const list = (profileShown && profileShown.recent) || [];
  const who = profileShown && profileShown.username;
  const step = (n) => () => {
    const at = list.findIndex((x) => x.id === s.id);
    const other = list[(at + n + list.length) % list.length];
    if (other && other.id !== s.id) playProfileSound(other);
  };
  showPlayer(profileAudio, librarySoundPlayer(s.id, {
    key: s.id,
    title: s.name,
    sub: [who, CAT_NAMES[s.category]].filter(Boolean).join(" · "),
    avatar: { url: profileShown && profileShown.avatarUrl, name: who || s.name },
    toggle: () => playProfileSound(s),
    next: list.length > 1 ? step(1) : null,
    prev: list.length > 1 ? step(-1) : null,
  }));
  drawProfileSounds();
}

async function openProfile(username) {
  if (!username) return;
  if (!sfxUser()) return openLogin("login");
  profileShown = { username, loading: true };
  $("profileName").textContent = username;
  $("profileAvatar").replaceChildren(avatarEl("", username, "huge"));
  $("profileRole").textContent = "";
  $("profileSeen").textContent = "Loading...";
  $("profileStats").replaceChildren();
  $("profileSounds").replaceChildren();
  $("profileSoundsHead").hidden = true;
  $("profileNote").textContent = "";
  $("profileMessage").hidden = $("profileAll").hidden = true;
  $("profileModal").hidden = false;
  const res = await api("/api/sfx-profile", { username }).catch(() => ({ ok: false, error: "Couldn't load the profile." }));
  if (!profileShown || profileShown.username !== username) return;
  if (sfxLoggedOut(res)) return closeProfile();
  if (!res.ok) {
    $("profileSeen").textContent = "";
    $("profileNote").textContent = res.error;
    return;
  }
  const p = profileShown = res.profile;
  $("profileName").textContent = p.username;
  $("profileAvatar").replaceChildren(avatarEl(p.avatarUrl, p.username, "huge"));
  $("profileRole").textContent = ROLE_NAMES[p.role] || p.role;
  $("profileRole").className = "role role-" + p.role;
  const seen = $("profileSeen");
  seen.className = p.online ? "online" : "";
  seen.textContent = p.me ? "This is you" : p.online ? "Online now" : p.last_seen ? "Last online " + sfxAgo(p.last_seen) : "Not online for a while";
  const since = new Date(p.created_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  setChildren($("profileStats"), [
    [p.sounds, p.sounds === 1 ? "sound uploaded" : "sounds uploaded"],
    [p.messages, p.messages === 1 ? "chat message" : "chat messages"],
    [since, "member since"],
  ].map(([value, label]) => {
    const box = document.createElement("div");
    const big = document.createElement("b");
    big.textContent = value;
    const small = document.createElement("span");
    small.textContent = label;
    box.append(big, small);
    return box;
  }));
  $("profileSoundsHead").hidden = !p.recent.length;
  drawProfileSounds();
  $("profileMessage").hidden = p.me;
  $("profileAll").hidden = !p.sounds;
}

function drawProfileSounds() {
  const p = profileShown;
  if (!p || !p.recent) return;
  setChildren($("profileSounds"), p.recent.map((s) => {
    const row = document.createElement("div");
    row.className = "chat-sound" + (profilePlaying === s.id ? " playing" : "");
    setDrag(row, { kind: "sound", url: s.url, name: s.name });
    row.title = DRAG_HINT;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "play";
    play.innerHTML = profilePlaying === s.id && !profileAudio.paused ? SFX_ICONS.pause : SFX_ICONS.play;
    play.addEventListener("click", () => playProfileSound(s));
    const info = document.createElement("div");
    info.className = "info";
    const title = document.createElement("b");
    title.textContent = s.name;
    const sub = document.createElement("span");
    sub.textContent = `${CAT_NAMES[s.category] || "Other"} · ${clock(s.seconds, false)} · ${sfxAgo(s.created_at)}`;
    info.append(title, sub);
    row.append(play, info);
    return row;
  }));
}

function closeProfile() {
  $("profileModal").hidden = true;
  profileShown = null; // (a sound that's playing goes on, in the player bar)
}

$("profileClose").addEventListener("click", closeProfile);
$("profileModal").addEventListener("click", (e) => { if (e.target === $("profileModal")) closeProfile(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("profileModal").hidden) closeProfile(); });
$("profileMessage").addEventListener("click", () => {
  const name = profileShown.username;
  closeProfile();
  openChat(name);
});
$("profileAll").addEventListener("click", () => {
  const name = profileShown.username;
  closeProfile();
  if (chatIsOpen()) closeChat();
  showTab("sfx");
  showUploader(name);
});
