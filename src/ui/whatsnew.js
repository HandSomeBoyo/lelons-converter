// "What's new": shown once after the app updates, and any time from the question mark at the top.
// Add the new version at the top of CHANGES with each release.

const CHANGES = [
  { version: "2.5.1", items: [
    "Smoother everywhere: scrolling, the chat and long download lists take a lot less work now, and the app rests when it's minimized.",
    "Waveforms in the Library show up much faster, because everyone shares them.",
    "Your save folder isn't forgotten any more when its drive (like a USB stick) is unplugged.",
    "Updates are safer: a download that gets cut off is never installed, and the app closes properly first.",
    "Half-made files from stopped downloads get cleaned up in every folder, not just the main one.",
    "Closing the trim editor stops a clip that's still downloading.",
    "Lots of chat and group fixes, like leaving a group that's gone, and old chat pictures getting cleaned up.",
    "Docs: a picture that's too big to share now says so, and you're asked before leaving with changes that didn't send.",
  ] },
  { version: "2.5.0", items: [
    "Genres in the Library! Pick Music, SFX or Ambience and a list of genres shows up on the left, like Action, Chill or Whooshes.",
    "Put a sound in a genre with the pencil button, or pick the genre when you upload.",
    "Memes and Other are gone: meme sounds are now in SFX under Memes, and the rest is in SFX.",
    "A new, clearer glass look: see-through glass with bright edges, all over the app.",
  ] },
  { version: "2.4.0", items: [
    "A new logo: a white V on black.",
    "The chat is a whole page now, like Discord. Open it with the new chat button at the top.",
    "On the left you'll find the everyone chat, your groups and your private messages.",
    "Make your own groups with the + next to Groups, and only the people you pick can see them. Add more people later, rename the group or leave it from the buttons at the top.",
    "Give a group its own picture: open Group settings and click the picture.",
    "Start a private chat with anyone using the + next to Private messages.",
  ] },
  { version: "2.3.0", items: [
    "The app has a new name: VaultHub! Your settings, login, docs and history all stay.",
    "Drag a page onto another page in Docs to put it under that page. Drag near the top or bottom edge to move it above or below instead.",
    "Links in docs show a hand when you point at them, and one click opens them.",
    "Black text is now easy to read on the dark page: it turns white (coloured text keeps its colour).",
    "The tour has a new Docs part, and it opens once for everybody after this update. Watch it again any time from the question mark at the top.",
  ] },
  { version: "2.2.0", items: [
    "Collab docs are live now: you see the other person typing right away, and there's no Save button to press any more.",
    "Pages in a document: add pages with the + on the left side, and pages under a page with the ··· button.",
    "Comments in Collab docs: select some words and press the yellow bubble (or Ctrl+Alt+M). Everyone can reply, and you can mark a comment as done.",
    "The new moon button at the top switches the page to black (dark page) or back to white. It's just for you, others keep their own look.",
    "Who's online in a document only shows at the top now, not twice.",
  ] },
  { version: "2.1.0", items: [
    "New document now asks what you want to write: a movie script, video script, shot list, storyboard and more.",
    "Every new document starts completely empty. A short guide next to the page explains how to write that kind of document.",
    "Shot lists, storyboards and call sheets can add an empty table with the right columns in one click.",
    "Close the guide with the X, and bring it back with View, Writing guide.",
  ] },
  { version: "2.0.0", items: [
    "New Docs tab: write documents and movie scripts right in the app, with a page that looks like Google Docs.",
    "Local docs stay private on your computer. Collab docs let you invite people with an account, and only the people who joined can see them.",
    "Templates for a movie script, video script, treatment, storyboard and call sheet, plus fonts, page setup (Letter or A4, margins, paper colour) and zoom.",
    "Docs only save when you press Save or Ctrl+S. If you leave with changes, the app asks if you want to save.",
  ] },
  { version: "1.35.0", items: [
    "A fresh Apple-inspired look: a cleaner font, big bold headlines and Apple's own soft greys in dark and light mode.",
    "The Library list is one neat rounded card with thin lines between sounds, like the iPhone Settings app.",
    "On/off options are now iPhone-style switches, and Settings is laid out in tidy grouped rows.",
    "Rounder buttons and softer corners everywhere, plus easier-to-read links in light mode.",
  ] },
  { version: "1.34.0", items: [
    "Liquid glass everywhere: cards, buttons, menus, popups, the chat and the player are all frosted glass now.",
    "The player floats at the bottom of the Library as a glass bar, and the page softly blurs behind popups.",
    "Fixed: the tab bar no longer covers Settings or other popups, and the chat no longer hides the player's buttons.",
    "Fixed: in a small window the Library categories scroll sideways instead of getting cut off, plus a few smaller fixes.",
  ] },
  { version: "1.33.0", items: [
    "New tabs: a floating glass bar at the top (like Artlist) that's much easier to see, and it stays with you when you scroll.",
    "Every tab has its own little icon, and a glass bubble slides smoothly to the one you pick.",
    "In a small window the tabs show just their icons. Point at one to see its name.",
  ] },
  { version: "1.32.0", items: [
    "The Library checks its sounds for you: anything that turns out to be a known song says \"Most likely copyrighted\" right under its name, with the song and artist.",
    "It happens in the background and is shared, so a sound is only ever checked once for everyone.",
    "The Copyright tab is still there for your own files, and the shield button on a sound still checks it right away.",
  ] },
  { version: "1.31.0", items: [
    "New Copyright tab: drop in a song or sound and the app tells you if it's a known (copyrighted) song, with the title and artist. You can also check any Library sound with the shield button.",
    "No more double uploads: the Library won't take a sound with the same name, or the exact same file, as one that's already there.",
    "Dragging a sound into your editor now shows a little card with its waveform instead of a plain file, with smooth lift and drop animations.",
  ] },
  { version: "1.30.0", items: [
    "Lelons Converter is now called Ultimate Recording! Same app, same account, same settings and history, just a new name.",
    "The new shortcut is on your desktop and in the Start menu. The old ones are removed for you.",
    "An even better tour voice: warmer and much more like a real person, with friendlier words.",
  ] },
  { version: "1.29.0", items: [
    "The Library has cleaner categories: pills at the top (like Artlist), and \"Uploaded by\" is now one small button next to Sort. The list gets the whole width.",
    "The player bar now only shows in the Library, so it never covers the other tabs. Leave the Library and the sound pauses; come back and press play to go on.",
    "The tour has a new, much more natural voice. Turn on \"Voice\" in How to use to hear it.",
    "Lots of small fixes: the Find sounds player, jumping in a sound, settings sometimes not saving on Windows, the chat taking a moment when switching, \"typing...\" staying after you closed the chat, and a faster Library search.",
  ] },
  { version: "1.28.0", items: [
    "A player at the bottom, like Artlist: see what's playing, pause and go on where you were, skip to the next sound, jump around in the waveform, star it, download it and set the volume.",
    "Sounds keep playing when you close the chat, a profile or Find sounds. Press Space to pause.",
    "Help, Send feedback and Settings are now icons at the top. Updates moved into Settings.",
    "A cleaner installer: no more long list of files, just a simple progress bar.",
  ] },
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
