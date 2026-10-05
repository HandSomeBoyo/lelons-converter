// "What's new": shown once after the app updates, and any time from the link at the bottom.
// Add the new version at the top of CHANGES with each release.

const CHANGES = [
  { version: "1.18.0", items: [
    "Drag clips straight out of the trim editor: pick your part, click \"Make a clip to drag\" and drop it into DaVinci Resolve. Move the lines and the clip updates by itself.",
    "Favorites in the Library: click the star on a sound. Your starred sounds show at the top, and the Favorites chip shows only them.",
  ] },
  { version: "1.17.0", items: [
    "This window! After every update it shows what changed. You can open it again with \"What's new\" at the bottom.",
  ] },
  { version: "1.16.0", items: [
    "Drag finished downloads, history items, converted files, pictures and Library sounds straight into DaVinci Resolve, Premiere, Discord or a folder.",
    "Tip: trim, download, then grab it from the Downloads list.",
  ] },
  { version: "1.15.0", items: [
    "Your own Account page: change your picture, username or password, log out, or delete your account.",
    "People and roles moved to the Account page.",
  ] },
  { version: "1.14.1", items: [
    "A round account button at the top right, on every tab, for logging in and managing your account.",
  ] },
  { version: "1.14.0", items: [
    "SFX is now the Library, with real accounts (username and password) instead of a friend code.",
    "Roles: the Owner manages everyone, Admins upload and delete, Viewers listen and download.",
    "Sounds show who uploaded them, and everyone can have a profile picture.",
  ] },
  { version: "1.13.1", items: [
    "A cleaner sound library with a waveform for every sound. Click it to play from that spot.",
  ] },
  { version: "1.13.0", items: [
    "A shared sound library with your friends, with categories like SFX, Music and Memes.",
  ] },
  { version: "1.12.0", items: [
    "Stop button for downloads, a History tab, the window remembers where you left it, and faster trimming.",
  ] },
];

const versionParts = (v) => String(v || "0").split(".").map((n) => parseInt(n, 10) || 0);
function newerThan(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function showWhatsNew(entries, sub) {
  $("whatsNewList").replaceChildren(...entries.map((entry) => {
    const block = document.createElement("section");
    const head = document.createElement("h3");
    head.textContent = "Version " + entry.version;
    const list = document.createElement("ul");
    list.append(...entry.items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    block.append(head, list);
    return block;
  }));
  $("whatsNewSub").textContent = sub;
  $("whatsNewAll").hidden = entries.length >= CHANGES.length;
  $("whatsNewModal").hidden = false;
  $("whatsNewList").scrollTop = 0;
}

let whatsNewChecked = false;
function checkWhatsNew(s) {
  if (whatsNewChecked) return;
  whatsNewChecked = true;
  if (s.seenVersion === s.version) return;
  // Everything since the last version you saw (or just this one, on a new install).
  const fresh = CHANGES.filter((c) => !newerThan(c.version, s.version) && (s.seenVersion ? newerThan(c.version, s.seenVersion) : c.version === s.version));
  api("/api/seen-version", {}).catch(() => {});
  if (fresh.length) showWhatsNew(fresh, `You're on version ${s.version} now. Here's what changed.`);
}

$("whatsNewOpen").addEventListener("click", () => showWhatsNew(CHANGES.slice(0, 3), ""));
$("whatsNewAll").addEventListener("click", () => showWhatsNew(CHANGES, ""));
$("whatsNewClose").addEventListener("click", () => { $("whatsNewModal").hidden = true; });
$("whatsNewModal").addEventListener("click", (e) => { if (e.target === $("whatsNewModal")) $("whatsNewModal").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("whatsNewModal").hidden = true; });
