// "How to use": a short animated tour of the app. Opens by itself once (the first time the app
// opens with it), and again from the help menu at the top. It can read itself out loud (a recorded Kokoro voice in ui/voice/, see build/make_tour_voice.py).
// Uses $, api() from app.js and loadPref(), savePref() from theme.js.

// A pretend call (used by two tour steps): three people and the call buttons.
function tourCallBox() {
  const ic = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const sig = (n) => `<span class="t-sig${n < 3 ? " meh" : ""}">${"<i></i>".repeat(3)}</span>`;
  return `<div class="t-call-box">
    <div class="t-call-tiles">
      <div class="t-tile talk" style="--i:0"><span class="t-face a">L</span><small>Lelon</small></div>
      <div class="t-tile cam" style="--i:1"><i class="t-person"></i><small>Kim</small>${sig(3)}</div>
      <div class="t-tile screen" style="--i:2"><i class="t-scr"></i><small>Bob's screen</small><em class="t-pcsound">🔊 PC sound</em>${sig(2)}</div>
    </div>
    <div class="t-call-bar">
      <i>${ic('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>')}</i>
      <i>${ic('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>')}</i>
      <i class="camb">${ic('<rect x="3" y="6.5" width="13" height="11" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/>')}</i>
      <i class="share">${ic('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>')}</i>
      <i class="board">${ic('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>')}</i>
      <i class="rec"><b></b></i>
      <i class="tune">${ic('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>')}</i>
      <i class="end">${ic('<path d="M3.5 14.5c4.5-4.5 12.5-4.5 17 0l-2 2.2-3.2-1.6v-2.4a11 11 0 0 0-6.6 0v2.4l-3.2 1.6z" fill="currentColor" stroke="none"/>')}</i>
    </div>
  </div>`;
}

const TOUR = [
  {
    key: "welcome", seconds: 5,
    title: "Welcome to VaultHub",
    text: "A quick tour of everything you can do. It takes about two minutes.",
    say: "Hey, welcome to VaultHub! Let me show you around. It takes about two minutes.",
    html: `<div class="t-center">
      <div class="t-logo"><svg viewBox="0 0 64 64"><path d="M16 18h10l6 15 6-15h10L36.5 46h-9z"/></svg><i></i><i></i></div>
      <div class="t-words"><span>Paste.</span><span>Convert.</span><span>Done.</span></div>
    </div>`,
  },
  {
    key: "paste", seconds: 8,
    title: "Paste a link, pick a format",
    text: "Paste a YouTube or TikTok link, pick MP3, MP4 or GIF, and press Convert. It asks where to save.",
    say: "First, paste a link from YouTube, TikTok, or pretty much anywhere. Pick a format, like MP3 or MP4, and hit Convert. Then just choose where to save it.",
    html: `<div class="t-app">
      <div class="t-input"><span class="t-typed">youtube.com/watch?v=dQw4w9WgXcQ</span><b class="t-caret"></b></div>
      <div class="t-button t-convert">Convert →</div>
      <div class="t-chips"><span class="t-chip t-mp3">MP3</span><span class="t-chip">MP4</span><span class="t-chip">WAV</span><span class="t-chip">GIF</span></div>
      <div class="t-preview"><div class="t-thumb"></div><div><b>Never Gonna Give You Up</b><small>Rick Astley · 3:33</small></div></div>
      <div class="t-job"><div class="t-thumb small"></div><div class="t-job-body"><b>Never Gonna Give You Up.mp3</b><div class="t-bar"><i></i></div></div><span class="t-done">✓</span></div>
      <div class="t-cursor"></div>
    </div>`,
  },
  {
    key: "trim", seconds: 7.5,
    title: "Keep only the part you want",
    text: "Click Trim, drag the start and end, and play your part before you convert.",
    say: "Only need part of it? Click Trim, and drag the start and the end. Press play to check your part.",
    html: `<div class="t-trim">
      <div class="t-wave">${"<i></i>".repeat(56)}</div>
      <div class="t-shade left"></div><div class="t-shade right"></div>
      <div class="t-handle start"><span>0:42</span></div><div class="t-handle end"><span>1:18</span></div>
      <div class="t-playhead"></div>
      <div class="t-trim-note">Keeping 0:36</div>
    </div>`,
  },
  {
    key: "drag", seconds: 7,
    title: "Drag it straight into your editor",
    text: "Finished files, Library sounds and clips can be dragged right into DaVinci Resolve, Premiere or a folder.",
    say: "When it's done, you can drag the file straight into DaVinci Resolve, Premiere, or any folder.",
    html: `<div class="t-drag">
      <div class="t-file"><span class="t-note">♪</span><b>Song.mp3</b></div>
      <div class="t-editor"><div class="t-editor-top"><i></i><i></i><i></i><span>Timeline</span></div>
        <div class="t-track"><span class="t-clip video"></span></div>
        <div class="t-track"><span class="t-clip audio"></span></div>
      </div>
      <div class="t-cursor"></div>
    </div>`,
  },
  {
    key: "resolve", seconds: 9,
    title: "Get your video ready for Resolve",
    text: "In the Resolve tab, drop in a video and pick what you want: subtitles, cutting out the quiet parts, or fixing laggy clips. It opens in DaVinci Resolve ready to edit.",
    say: "Editing in DaVinci Resolve? Open the Resolve tab, drop in your video, and pick what you want. Subtitles, cutting out the quiet parts, or fixing laggy clips. Then it opens in Resolve, ready to edit.",
    html: `<div class="t-rv">
      <div class="t-rv-opts">${[["Subtitles", "Writes down what's said"], ["Cut the silence", "Takes out the quiet parts"], ["Fix for Resolve", "Laggy clips play smoothly"]].map(([b, s], i) => `
        <div class="t-rv-opt" style="--i:${i}"><span class="t-tick"></span><div><b>${b}</b><small>${s}</small></div></div>`).join("")}
      </div>
      <div class="t-rv-tl">
        <div class="t-editor-top"><i></i><i></i><i></i><span>DaVinci Resolve</span></div>
        <div class="t-rv-view"><span class="t-rv-sub one">so we found this cave</span><span class="t-rv-sub two">wait, what's that?</span></div>
        <div class="t-rv-track"><i></i><em></em><i></i><em></em><i></i></div>
        <div class="t-rv-track audio"><i></i><em></em><i></i><em></em><i></i></div>
      </div>
    </div>`,
  },
  {
    key: "library", seconds: 8.5,
    title: "Share sounds with the crew",
    text: "The Library holds everyone's sounds. Play, download and favorite them. Find sounds & music gets you new ones, even copyright-free songs that are safe for monetized videos.",
    say: "The Library has sounds from the whole crew. Play them, download them, and star your favorites. Need something new? Try Find sounds and music. It even has copyright-free songs.",
    html: `<div class="t-lib">
      ${[["Vine boom", "SFX · Memes", "Bob"], ["Chill beat", "Music · Chill", "Lelon"], ["Door slam", "SFX", "Kim"]].map(([n, c, u], i) => `
      <div class="t-row" style="--i:${i}"><span class="t-play${i === 0 ? " on" : ""}"></span>
        <div class="t-row-text"><b>${n}</b><small><em>${c}</em> · ${u}</small></div>
        <div class="t-mini-wave">${"<i></i>".repeat(18)}</div>
        <span class="t-icons"><i>☆</i><i>↓</i><i class="t-pencil">✎</i></span></div>`).join("")}
    </div>`,
  },
  {
    key: "crew", seconds: 7.5,
    title: "Home, chat and live subscribers",
    text: "Home shows our channels' subscribers live and who's online. Chat with everyone, send sounds and react.",
    say: "Home shows our channels' subscribers, live, and who's online right now. Open the chat to talk, send sounds, and react.",
    html: `<div class="t-crew">
      <div class="t-counter"><div class="t-digits">${[1, 6, 9, 3, 9, 7].map((d, i) => (i === 3 ? '<span class="t-comma">,</span>' : "") +
        `<span class="t-digit" style="--d:${d};--i:${i}"><span>${"0123456789".split("").map((x) => `<i>${x}</i>`).join("")}</span></span>`).join("")}</div>
        <small>subscribers across our channels</small></div>
      <div class="t-chat">
        <div class="t-msg" style="--i:0"><span class="t-face a">B</span><p>new video is out!! 🔥</p></div>
        <div class="t-msg me" style="--i:1"><p>watching it now</p></div>
        <div class="t-msg" style="--i:2"><span class="t-face b">K</span><p>sending you the sound <span class="t-sound">▶ Vine boom</span></p></div>
        <span class="t-react">😂 2</span>
      </div>
    </div>`,
  },
  {
    key: "calls", seconds: 9.5,
    title: "Call and share your screen",
    text: "Press Call in any chat or group. Turn on your camera and share your screen, with your PC sound too. Click a friend's picture to make them louder or quieter, and the little bars show their signal.",
    say: "Want to talk? Press Call in any chat or group. Turn on your camera, and share your screen, with your game sound too. Click a friend to make them louder or quieter. The little bars show how good their connection is.",
    html: `<div class="t-call">
      ${tourCallBox()}
      <div class="t-call-pop t-vol">
        <div class="t-vol-who"><span class="t-face b">K</span><b>Kim</b><span class="t-sig"><i></i><i></i><i></i></span></div>
        <div class="t-vol-row"><span>Volume</span><span class="t-vol-num"><span><i>100%</i><i>150%</i></span></span></div>
        <div class="t-vol-track"><b></b><i></i></div>
        <div class="t-vol-btn">See profile</div>
      </div>
      <div class="t-cursor"></div>
    </div>`,
  },
  {
    key: "calltools", seconds: 10,
    title: "Sound board, recording and more",
    text: "The sound board plays Library sounds into the call, and the red button records everyone as an MP3. In the sliders menu, set a push-to-talk key and pick your sound quality or Music mode.",
    say: "Calls have some fun extras too. The sound board plays sounds from the Library right into the call. The red button records the call as an MP3. And in the sliders menu, set a push to talk key, and pick your sound quality, or Music mode for stereo.",
    html: `<div class="t-call t-call2">
      ${tourCallBox()}
      <span class="t-rec-badge"><i></i>REC 0:04</span>
      <div class="t-call-pop t-board-pop"><b>Sound board</b>
        <div class="t-sboard">${["Vine boom", "Airhorn", "Drumroll", "Bruh", "Laugh", "Wow"].map((n, i) => `<span${i === 1 ? ' class="hit"' : ""}>${n}</span>`).join("")}</div>
      </div>
      <div class="t-call-pop t-set-pop">
        <div class="t-ptt"><span>Push to talk</span><kbd>Mouse 4</kbd></div>
        <div class="t-kbps"><span>64</span><span class="was">128</span><span class="pick">256</span><span>510</span><em>kbps</em></div>
        <div class="t-music"><span>Music mode<small>Stereo, no cleanup</small></span><i class="t-switch"></i></div>
      </div>
      <div class="t-cursor"></div>
    </div>`,
  },
  {
    key: "profiles", seconds: 8.5,
    title: "See your friends' profiles",
    text: "Click anyone's name or picture to see their profile: their status, newest videos, games and sounds. Videos play right inside VaultHub, even in slow motion.",
    say: "Click anyone's name or picture to open their profile. You'll see their status, their newest videos, and the stuff they've shared. And videos play right here in the app.",
    html: `<div class="t-pf">
      <div class="t-pf-card">
        <div class="t-pf-banner"></div>
        <span class="t-face b">K</span>
        <div class="t-pf-name"><b>Kim</b><small><i></i>Online · editing the new video</small></div>
        <div class="t-pf-vids">${[0, 1, 2].map((i) => `<div class="t-pf-vid" style="--i:${i}"><div class="t-thumb"></div><span></span></div>`).join("")}</div>
      </div>
      <div class="t-pf-player">
        <div class="t-pf-screen"><div class="t-pf-prog"><i></i></div></div>
        <div class="t-pf-speeds"><span>0.5x</span><span class="was">1x</span><span class="pick">1.5x</span><span>2x</span></div>
      </div>
      <div class="t-cursor"></div>
    </div>`,
  },
  {
    key: "docs", seconds: 9,
    title: "Write together in Docs",
    text: "Write scripts and ideas in Docs. In Collab docs you see your friends type live. Drag pages onto each other to put one under another.",
    say: "Got a story to write? Open Docs. In a Collab doc, you see your friends typing live, and you can leave comments. Add pages on the left, and drag one page onto another to tuck it underneath.",
    html: `<div class="t-docs">
      <div class="t-side"><small>Pages</small>
        <div class="t-pg on" style="--y:0">Our film</div>
        <div class="t-pg t-pg-target" style="--y:1">Characters</div>
        <div class="t-pg t-pg-down" style="--y:2">Music ideas</div>
        <div class="t-pg t-pg-move" style="--y:3">Kim</div>
      </div>
      <div class="t-paper">
        <div class="t-doc-title"><span>THE TRUTH</span></div>
        <div class="t-doc-line" style="--w:88%;--d:1.8s"></div>
        <div class="t-doc-line" style="--w:72%;--d:2.05s"></div>
        <div class="t-them"><span>Kim is writing this, live</span><b><em>Kim</em></b></div>
        <div class="t-doc-line" style="--w:64%;--d:4.3s"></div>
        <div class="t-bubble"><span class="t-face b">K</span>Love this part!</div>
      </div>
      <div class="t-faces"><span class="t-face a">L</span><span class="t-face b">K</span></div>
      <div class="t-cursor"></div>
    </div>`,
  },
  {
    key: "boards", seconds: 9.5,
    title: "Plan it on Boards and Games",
    text: "Boards are to-do lists you share with your team: drag cards from list to list. In Games, post Steam links, vote on what to record next, and see when a game goes on sale.",
    say: "Planning a video? Make a board, and drag cards from To do to Done, together with your team. And in Games, post a Steam link, vote on what to record next, and see when it goes on sale.",
    html: `<div class="t-bg">
      <div class="t-board">
        <div class="t-list" style="--i:0"><small>To do</small><span class="t-bcard">Write the script</span><span class="t-bcard ghost"></span></div>
        <div class="t-list" style="--i:1"><small>Filming</small><span class="t-bcard">Record gameplay</span></div>
        <div class="t-list" style="--i:2"><small>Done</small><span class="t-bcard">Pick a game</span></div>
        <span class="t-bcard t-bmove"><i class="t-blabel"></i>Edit the intro</span>
      </div>
      <div class="t-game">
        <div class="t-game-art"><span class="t-sale">-50%</span></div>
        <b>Lost Signal</b>
        <div class="t-price"><s>199 kr</s><em>99 kr</em></div>
        <div class="t-votes"><span class="t-up">▲</span><span class="t-vnum"><span><i>3</i><i>4</i></span></span><small>want to record it</small></div>
      </div>
    </div>`,
  },
  {
    key: "povs", seconds: 8.5,
    title: "Share recordings and film assets",
    text: "POVs sends your full game recordings straight to your friends, PC to PC. Film assets holds the crew's effects and clips, ready to drag into your edit.",
    say: "Recorded a game together? Use POVs to send your whole recording straight to your friends. And Film assets has the crew's effects and clips, ready to drop into your edit.",
    html: `<div class="t-pv">
      <div class="t-pc a"><div class="t-pc-screen"></div><small>Your PC</small></div>
      <div class="t-pv-wire"><div class="t-pv-file"><b>Full match.mp4</b><small>4.2 GB</small><div class="t-bar"><i></i></div></div></div>
      <div class="t-pc b"><div class="t-pc-screen"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></div><small>Kim's PC</small></div>
      <div class="t-fx">${[["Explosions", "#ff8a3d", "#ef5350"], ["Smoke", "#8a8f99", "#3d424a"], ["Glitch", "#9b7bf7", "#22b8a5"], ["Muzzle flash", "#ffcf3f", "#ff8a3d"]].map(([n, a, b], i) => `
        <div class="t-pack" style="--i:${i};--a:${a};--b:${b}"><i></i><b>${n}</b><span>↓</span></div>`).join("")}
      </div>
    </div>`,
  },
  {
    key: "channel", seconds: 10,
    title: "Grow your channel",
    text: "Channel stats shows your views and how each video does. Compare two videos side by side, and in Titles & tags, score your title and grab the tags top videos use.",
    say: "Want to grow your channel? Channel stats shows your views, and how every video is doing. Compare two videos side by side. And in Titles and tags, get a score for your title, plus the tags the top videos use.",
    html: `<div class="t-ch">
      <div class="t-ch-card t-ch-chart"><small>Views per day</small>
        <div class="t-ch-bars">${[30, 42, 36, 50, 46, 58, 54, 66, 62, 74, 70, 84, 80, 96].map((h, i) => `<i style="--h:${h}%;--i:${i}"></i>`).join("")}</div>
        <b class="t-ch-up">+38% this week</b></div>
      <div class="t-ch-card t-ch-cmp"><small>Compare two videos</small>
        <div class="t-ch-cols">
          <div class="t-ch-col" style="--i:0"><div class="t-thumb"></div><b>12.4K</b><span>views</span></div>
          <div class="t-ch-col win" style="--i:1"><div class="t-thumb"></div><b>31.9K</b><span>views</span></div>
        </div></div>
      <div class="t-ch-card t-ch-title"><small>Titles &amp; tags</small>
        <div class="t-ring"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22"/><circle class="v" cx="26" cy="26" r="22"/></svg><b>86</b></div>
        <div class="t-tagchips"><span style="--i:0">100 days</span><span style="--i:1">hardcore</span><span style="--i:2">#survival</span></div></div>
    </div>`,
  },
  {
    key: "search", seconds: 9,
    title: "Find anything fast",
    text: "Press Ctrl+K to jump to any page, doc, board or game. The bell at the top shows what's new. Click Convert, Create or Tools in the side bar to fold them away.",
    say: "To find anything fast, press Control K and start typing. The bell at the top shows everything new, like messages and invites. And click a group in the side bar to fold it away.",
    html: `<div class="t-sr">
      <div class="t-sb">
        <div class="t-sb-search">Search<kbd>Ctrl K</kbd></div>
        <small class="t-sb-g">Convert</small><div class="t-sb-items"><i>Video</i><i>Files</i><i>Images</i></div>
        <small class="t-sb-g fold">Create<b>▾</b></small><div class="t-sb-items fold"><i>Library</i><i>Docs</i><i>Boards</i></div>
        <small class="t-sb-g">Tools</small><div class="t-sb-items"><i>Channel stats</i><i>Titles &amp; tags</i></div>
      </div>
      <div class="t-keys"><kbd>Ctrl</kbd><span>+</span><kbd>K</kbd></div>
      <div class="t-q">
        <div class="t-q-box"><span class="t-q-typed">boa</span><b class="t-caret"></b></div>
        <div class="t-q-row on" style="--i:0"><b>Boards</b><small>Page</small></div>
        <div class="t-q-row" style="--i:1"><b>Video plan</b><small>Board</small></div>
        <div class="t-q-row" style="--i:2"><b>Boat Racers</b><small>Game</small></div>
      </div>
      <div class="t-bell"><svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg><b>3</b></div>
    </div>`,
  },
  {
    key: "yours", seconds: 7.5,
    title: "Make it yours",
    text: "In Settings: themes, colors, size and volume. The speaker at the top changes the volume too.",
    say: "And make it yours! In Settings, you can pick a theme and a color, change the size, and set the volume.",
    html: `<div class="t-yours">
      <div class="t-window"><div class="t-win-top"><span class="t-dot"></span><b>VaultHub</b></div>
        <div class="t-win-line w1"></div><div class="t-win-line w2"></div><div class="t-win-button"></div></div>
      <div class="t-controls">
        <div class="t-swatches">${["#ffcf3f", "#ff8a3d", "#ef5350", "#ec5fa8", "#9b7bf7", "#4d9ef7", "#22b8a5", "#5cc15c"].map((c, i) => `<i style="--c:${c};--i:${i}"></i>`).join("")}</div>
        <div class="t-slider"><span class="t-speaker">🔊</span><div class="t-track"><b></b><i></i></div></div>
        <div class="t-size"><span>A</span><span class="big">A</span></div>
      </div>
    </div>`,
  },
  {
    key: "done", seconds: 6.5,
    title: "You're all set!",
    text: "You can watch this again any time: click the question mark at the top, then \"How to use\". Press Ctrl+/ to see every keyboard shortcut.",
    say: "That's it, you're all set! Want to watch this again? Just click the question mark at the top. And press Control slash to see every keyboard shortcut.",
    html: `<div class="t-center">
      <svg class="t-check" viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>
      <div class="t-words"><span>Have fun!</span></div>
    </div>`,
  },
];

let tourAt = 0;
let tourTimer = null;
let tourStarted = 0; // when this scene (or the part after a pause) started
let tourLeft = 0; // ms left in this scene
let tourPaused = false;
let tourVoice = loadPref("tourVoice") === true;
const TOUR_ROUND = "2.30"; // raise this to show the tour to everyone again after an update
let tourShownNow = false; // opened by itself this time (then "What's new" waits for the next update)
let tourSpeechDone = true;

function tourShowing() { return !$("tourModal").hidden; }

function openTour(auto = false) {
  tourShownNow = tourShownNow || auto;
  $("tourStage").replaceChildren(); // start clean
  $("tourModal").hidden = false;
  if (loadPref("tourSeen") !== TOUR_ROUND) savePref("tourSeen", TOUR_ROUND);
  showScene(0);
}

function closeTour() {
  clearTimeout(tourTimer);
  stopSpeaking();
  $("tourModal").hidden = true;
  setTimeout(() => { if (!tourShowing()) $("tourStage").replaceChildren(); }, 400);
}

function drawTourBars() {
  setChildren($("tourBars"), TOUR.map((scene, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = scene.title;
    b.className = i < tourAt ? "done" : i === tourAt ? "now" : "";
    b.innerHTML = "<i></i>";
    if (i === tourAt) b.firstChild.style.animationDuration = scene.seconds + "s";
    b.onclick = () => showScene(i);
    return b;
  }));
}

function showScene(i) {
  clearTimeout(tourTimer);
  stopSpeaking();
  tourAt = Math.max(0, Math.min(TOUR.length - 1, i));
  const scene = TOUR[tourAt];
  const stage = $("tourStage");
  const el = document.createElement("div");
  el.className = "t-scene ts-" + scene.key;
  el.innerHTML = scene.html;
  // Every scene still there slides out (clicking fast can leave more than one).
  for (const old of [...stage.children]) {
    if (old.classList.contains("t-out")) continue;
    old.classList.add("t-out");
    setTimeout(() => old.remove(), 400);
  }
  stage.append(el);
  $("tourCaption").classList.remove("t-in");
  void $("tourCaption").offsetWidth;
  $("tourTitle").textContent = scene.title;
  $("tourText").textContent = scene.text;
  $("tourCaption").classList.add("t-in");
  $("tourBack").disabled = tourAt === 0;
  $("tourNext").textContent = tourAt === TOUR.length - 1 ? "Let's go" : "Next";
  setTourPaused(false);
  drawTourBars();
  tourLeft = scene.seconds * 1000;
  speak(scene);
  runTourTimer();
}

function runTourTimer() {
  clearTimeout(tourTimer);
  tourStarted = Date.now();
  tourTimer = setTimeout(sceneEnded, tourLeft);
}

function sceneEnded() {
  // With the voice on, the next scene waits until it has finished talking.
  if (tourVoice && !tourSpeechDone) {
    tourLeft = 300;
    return runTourTimer();
  }
  if (tourAt < TOUR.length - 1) showScene(tourAt + 1);
  else setTourPaused(true, true); // the last scene stays until you close it
}

function setTourPaused(paused, ended = false) {
  tourPaused = paused;
  $("tourModal").classList.toggle("t-paused", paused);
  $("tourPause").innerHTML = paused && !ended
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';
  $("tourPause").title = paused ? "Play" : "Pause";
  $("tourPause").hidden = ended;
}

function togglePause() {
  if (!tourPaused) {
    clearTimeout(tourTimer);
    tourLeft = Math.max(0, tourLeft - (Date.now() - tourStarted));
    setTourPaused(true);
    tourVoiceAudio.pause();
    if (window.speechSynthesis) speechSynthesis.pause();
  } else {
    setTourPaused(false);
    if (!tourSpeechDone && tourVoiceAudio.src && tourVoiceAudio.paused) tourVoiceAudio.play().catch(() => {});
    if (window.speechSynthesis) speechSynthesis.resume();
    runTourTimer();
  }
}

// ---- the voice over: a recorded voice (made with build/make_tour_voice.py), or Windows' own
// voice if a recording can't play.

const tourVoiceAudio = new Audio();
tourVoiceAudio.preload = "auto";
tourVoiceAudio.addEventListener("ended", () => { tourSpeechDone = true; });

function tourVoicePick() {
  const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return english.find((v) => /natural|online/i.test(v.name)) || english.find((v) => /aria|jenny|zira|female/i.test(v.name)) || english[0] || null;
}

function speakWithWindows(text) {
  if (!window.speechSynthesis) { tourSpeechDone = true; return; }
  const line = new SpeechSynthesisUtterance(text);
  const voice = tourVoicePick();
  if (voice) line.voice = voice;
  line.rate = 1.02;
  line.volume = typeof volumeLevel === "function" ? Math.max(0.15, Math.sqrt(volumeLevel())) : 1;
  line.onend = line.onerror = () => { tourSpeechDone = true; };
  speechSynthesis.speak(line);
}

function speak(scene) {
  stopSpeaking();
  if (!tourVoice) return;
  tourSpeechDone = false;
  const asked = scene.key;
  tourVoiceAudio.src = "voice/" + scene.key + ".mp3";
  tourVoiceAudio.play().catch((e) => {
    if (e && e.name === "AbortError") return; // the next scene came first
    if (TOUR[tourAt] && TOUR[tourAt].key === asked && !tourSpeechDone) speakWithWindows(scene.say);
  });
  // The next scene's voice loads now, so it starts right away.
  const next = TOUR[TOUR.indexOf(scene) + 1];
  if (next) fetch("voice/" + next.key + ".mp3").catch(() => {});
}

function stopSpeaking() {
  tourSpeechDone = true;
  tourVoiceAudio.pause();
  if (window.speechSynthesis) speechSynthesis.cancel();
}

function drawVoiceButton() {
  $("tourVoice").classList.toggle("on", tourVoice);
  $("tourVoice").title = tourVoice ? "Voice over is on" : "Turn on the voice over";
  $("tourVoiceText").textContent = tourVoice ? "Voice on" : "Voice off";
}

$("tourVoice").addEventListener("click", () => {
  tourVoice = !tourVoice;
  savePref("tourVoice", tourVoice);
  drawVoiceButton();
  if (tourVoice) speak(TOUR[tourAt]);
  else stopSpeaking();
});
if (window.speechSynthesis) speechSynthesis.getVoices(); // starts loading the list
drawVoiceButton();

$("tourBack").addEventListener("click", () => showScene(tourAt - 1));
$("tourNext").addEventListener("click", () => (tourAt === TOUR.length - 1 ? closeTour() : showScene(tourAt + 1)));
$("tourPause").addEventListener("click", togglePause);
$("tourStage").addEventListener("click", () => { if (!$("tourPause").hidden) togglePause(); });
$("tourClose").addEventListener("click", closeTour);
$("tourOpen").addEventListener("click", () => openTour());
$("tourModal").addEventListener("click", (e) => { if (e.target === $("tourModal")) closeTour(); });
document.addEventListener("keydown", (e) => {
  if (!tourShowing()) return;
  if (e.key === "Escape") closeTour();
  else if (e.key === "ArrowRight") showScene(tourAt + 1);
  else if (e.key === "ArrowLeft") showScene(tourAt - 1);
  else if (e.key === " ") { e.preventDefault(); if (!$("tourPause").hidden) togglePause(); }
});

// The first time (and once after an update with a new tour): open by itself, once the app has loaded.
if (loadPref("tourSeen") !== TOUR_ROUND) openTour(true);
