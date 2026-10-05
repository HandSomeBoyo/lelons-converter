// "What's new": shown once after the app updates, and any time from the link at the bottom.
// Add the new version at the top of CHANGES with each release.

const CHANGES = [
  { version: "1.27.0", items: [
    "The chat shows when someone is typing, and little faces show who has seen your message.",
    "Home has a new Activity list: new sounds (play them right there), new people, new videos and channels hitting a big number.",
    "The app opens instantly: it shows what you saw last time straight away, and updates it in the background.",
    "A cleaner look: Settings has its own button at the top, and the Library shows fewer buttons until you point at a sound.",
  ] },
  { version: "1.26.1", items: [
    "Playing a sound in the Library no longer jumps you back to the top. The same fix is in every list in the app.",
    "Find sounds doesn't flicker anymore while you type or play sounds.",
    "Only one sound plays at a time now. Starting a new one stops the other.",
    "Clicking two sounds quickly no longer shows a wrong \"check your internet\" message.",
    "Home, History, the chat and Stats update without everything fading in again, so clicks don't get lost.",
    "Double-clicking Convert or Download only starts it once.",
    "Stats loads faster and keeps updating after you minimize the app.",
  ] },
  { version: "1.26.0", items: [
    "Find sounds: search free sound effects and meme sounds right from the Library. Listen, download, or add them to the Library in one click.",
    "Channel stats: click \"See stats\" on Home for charts of how our channels are growing, a leaderboard and the most watched videos.",
    "Fixed the tour playing scenes on top of each other when you watched it again.",
  ] },
  { version: "1.25.0", items: [
    "A new animated tour that shows how to use the app. Watch it again any time with \"How to use\" at the bottom.",
    "Turn on \"Voice\" in the tour and it reads itself out loud.",
  ] },
  { version: "1.24.0", items: [
    "A volume slider! Click the speaker at the top (or go to Settings). It works for every sound in the app.",
    "Uploaded a sound to the wrong category? Click the pencil on it to change its name or category.",
    "A refresh button at the top (F5 works too) loads the page you're on again.",
    "The app now asks where to save every time you convert or download. Want it to always save in one folder? Pick that in Settings, Where to save.",
  ] },
  { version: "1.23.0", items: [
    "A new Home page! It's the first tab now.",
    "Live subscriber counters for all our YouTube channels, plus the total. The numbers roll up when they change.",
    "The newest uploads from our channels: watch them, or convert them in one click.",
    "See who's online, the newest sounds in the Library and the latest chat messages, right on Home.",
    "Your own stats (files converted, minutes, favorite format) and your recent downloads, ready to drag into your editor.",
    "Paste a link on Home and it starts converting right away.",
  ] },
  { version: "1.22.0", items: [
    "Make the whole app bigger or smaller: Settings, Size. Or hold Ctrl and scroll, or press Ctrl and + or -. Ctrl and 0 goes back to normal.",
    "You can always see who uploaded a sound in the Library now, even in a small window.",
    "A cleaner look: softer corners, less clutter and a roomier layout on big screens.",
    "Smooth animations everywhere: popups glide in, the chat slides open, a line follows the tab you pick and new messages float in.",
    "The window's title bar now matches your theme.",
  ] },
  { version: "1.21.0", items: [
    "Send Library sounds in the chat with the new chat button on a sound, or a trimmed clip with \"Send to chat\" in the trim editor. Others can play them or drag them into their editor.",
    "React to messages with emojis, and @mention people (type @ to pick a name). Mentions light up and ding.",
    "Private messages: click someone's name, then \"Send a message\". Only you two can see it.",
    "Profiles: click a name or picture to see someone's role, when they were last online, and their newest sounds.",
    "Paste a bunch of links at once (or a few playlists) and convert them all in one go.",
    "A soft ding for new messages. You can turn it off in Settings.",
  ] },
  { version: "1.20.0", items: [
    "Live chat! Click \"online\" at the top right to chat with everyone who has an account.",
    "See how many people have the app open right now, and who.",
    "Themes: pick Dark, Black or Light, and your own color, in Settings (at the bottom).",
    "A Hardware acceleration switch in Settings. It's on by default; turn it off if videos come out broken or the app looks glitchy.",
    "The app now remembers your last tab, your Library sort and your Files and Images options after you close it.",
  ] },
  { version: "1.19.0", items: [
    "Send feedback: found a bug or want something added? Click \"Send feedback\" at the bottom (or in the account menu) and write to the owner.",
    "A new Library layout: All sounds, Favorites, the categories and who uploaded them are in a panel on the left.",
    "Sort the Library by favorites, newest, oldest, name, length or uploader.",
    "Bug fixes and a faster, lighter app: it uses less of your PC while it sits open, and cleans up clips and sounds you never dragged anywhere.",
  ] },
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
  setChildren($("whatsNewList"), entries.map((entry) => {
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
  if (typeof tourShowing === "function" && tourShowing()) return; // after the tour
  whatsNewChecked = true;
  if (s.seenVersion === s.version) return;
  // The tour opened by itself on a new install: that's enough for now.
  if (!s.seenVersion && typeof tourShownNow !== "undefined" && tourShownNow) return void api("/api/seen-version", {}).catch(() => {});
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
