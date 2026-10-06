// "How to use": a short animated tour of the app. Opens by itself once (the first time the app
// opens with it), and again from the help menu at the top. It can read itself out loud (a recorded Kokoro voice in ui/voice/, see build/make_tour_voice.py).
// Uses $, api() from app.js and loadPref(), savePref() from theme.js.

const TOUR = [
  {
    key: "welcome", seconds: 5,
    title: "Welcome to Ultimate Recording",
    text: "A quick tour of everything you can do. It only takes a minute.",
    say: "Hey, welcome to Ultimate Recording! Let me show you around. It only takes a minute.",
    html: `<div class="t-center">
      <div class="t-logo"><svg viewBox="0 0 16 16"><path d="M3 1.5v13l11-6.5z"/></svg><i></i><i></i></div>
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
    key: "library", seconds: 7.5,
    title: "Share sounds with the crew",
    text: "The Library holds everyone's sounds. Play, download, favorite, or fix one with the pencil.",
    say: "The Library has sounds from the whole crew. Play them, download them, and star your favorites. Need something new? Try Find sounds.",
    html: `<div class="t-lib">
      ${[["Vine boom", "Memes", "Bob"], ["Chill beat", "Music", "Lelon"], ["Door slam", "SFX", "Kim"]].map(([n, c, u], i) => `
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
    key: "yours", seconds: 7.5,
    title: "Make it yours",
    text: "In Settings: themes, colors, size and volume. The speaker at the top changes the volume too.",
    say: "And make it yours! In Settings, you can pick a theme and a color, change the size, and set the volume.",
    html: `<div class="t-yours">
      <div class="t-window"><div class="t-win-top"><span class="t-dot"></span><b>Ultimate</b></div>
        <div class="t-win-line w1"></div><div class="t-win-line w2"></div><div class="t-win-button"></div></div>
      <div class="t-controls">
        <div class="t-swatches">${["#ffcf3f", "#ff8a3d", "#ef5350", "#ec5fa8", "#9b7bf7", "#4d9ef7", "#22b8a5", "#5cc15c"].map((c, i) => `<i style="--c:${c};--i:${i}"></i>`).join("")}</div>
        <div class="t-slider"><span class="t-speaker">🔊</span><div class="t-track"><b></b><i></i></div></div>
        <div class="t-size"><span>A</span><span class="big">A</span></div>
      </div>
    </div>`,
  },
  {
    key: "done", seconds: 5,
    title: "You're all set!",
    text: "You can watch this again any time: click the question mark at the top, then \"How to use\".",
    say: "That's it, you're all set! Want to watch this again? Just click the question mark at the top.",
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
let tourShownNow = false; // opened by itself this time (then "What's new" waits for the next update)
let tourSpeechDone = true;

function tourShowing() { return !$("tourModal").hidden; }

function openTour(auto = false) {
  tourShownNow = tourShownNow || auto;
  $("tourStage").replaceChildren(); // start clean
  $("tourModal").hidden = false;
  if (!loadPref("tourSeen")) savePref("tourSeen", true);
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

// The first time: open by itself, once the app has loaded.
if (!loadPref("tourSeen")) openTour(true);
