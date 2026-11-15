// Find sounds & music: search free sound effects, copyright-free music and meme sounds online,
// from the Library.
// Uses $, api(), clock(), whereToSave() from app.js, SFX_ICONS, sfxUser(), openSfxUpload(),
// useSfxFile(), pickUploadCategory() from sfx.js.

let findSource = "effects";
let findQuery = "";
let findPage = 1;
let findResults = [];
let findMore = false;
let findBusy = false;
let findLoadingMore = false;
let findError = "";
let findPlaying = null;
let findTimer = null;
let findSafe = true; // music: only songs that are fine in a video that makes money
// Quick searches for music (the same names as the Library's music genres, so "Add to Library"
// can pick the genre too).
const FIND_MOODS = ["Chill", "Lofi", "Happy", "Epic", "Cinematic", "Action", "Sad", "Horror", "Hip Hop", "Electronic", "Funny"];
let findAsked = 0; // so an old answer can't replace a newer one
const findNotes = new Map(); // id -> {text, kind, path}
const findAudio = new Audio();
findAudio.addEventListener("ended", () => { findPlaying = null; drawFind(); });
registerPlayer(findAudio, () => { findAudio.pause(); findPlaying = null; drawFind(); });
findAudio.addEventListener("error", () => {
  if (!findPlaying) return;
  findNotes.set(findPlaying, { text: "Couldn't play this one.", kind: "bad" });
  findPlaying = null;
  drawFind();
});

for (const type of ["play", "pause"]) findAudio.addEventListener(type, () => { if (findPlaying) drawFind(); });
const findSaving = new Set(); // ids being downloaded (a second click does nothing)

// Preview a result (click again to pause), shown in the player bar.
function playFind(r) {
  if (findPlaying === r.id && findAudio.src) {
    if (!findAudio.paused) return findAudio.pause();
  } else if (findAudio.src === r.preview && findAudio.currentTime > 0 && !findAudio.ended) {
    findPlaying = r.id; // paused earlier: go on from there
  } else {
    findAudio.src = r.preview;
    findPlaying = r.id;
    findNotes.delete(r.id);
  }
  findAudio.play().catch(() => {});
  const step = (n) => () => {
    const at = findResults.findIndex((x) => x.id === r.id);
    const other = findResults[(at + n + findResults.length) % findResults.length];
    if (other && other.id !== r.id) playFind(other);
  };
  showPlayer(findAudio, {
    key: r.id,
    title: r.title,
    sub: [r.creator, r.site || (r.source === "memes" ? "Meme sound" : r.source === "music" ? "Music" : "Sound effect")].filter(Boolean).join(" · "),
    avatar: { name: r.title },
    toggle: () => playFind(r),
    next: step(1),
    prev: step(-1),
    download: () => saveFind(r),
  });
  drawFind();
}

async function saveFind(r) {
  if (findSaving.has(r.id)) return;
  findSaving.add(r.id);
  try {
    const folder = await whereToSave().catch(() => "");
    if (!folder) return;
    findNotes.set(r.id, { text: "Downloading...", kind: "" });
    drawFind();
    const res = await api("/api/find-save", { id: r.id, folder }).catch(() => ({ ok: false, error: "Couldn't download it." }));
    findNotes.set(r.id, res.ok ? { text: "Saved as " + res.fileName + (r.credit ? ". Don't forget to copy the credit." : ""), kind: "saved", path: res.path }
      : { text: res.error, kind: "bad" });
    drawFind();
  } finally {
    findSaving.delete(r.id);
  }
}

function openFind() {
  $("findModal").hidden = false;
  drawFindSource();
  drawFind();
  setTimeout(() => $("findInput").focus(), 50);
}
function closeFind() {
  $("findModal").hidden = true; // (a sound that's playing goes on, in the player bar)
}

async function runFind(more = false) {
  const query = $("findInput").value.trim();
  if (query.length < 2) {
    findAsked++; // an answer still on its way is for words that are gone now
    findBusy = false;
    findResults = []; findMore = false; findError = ""; findQuery = "";
    return drawFind();
  }
  if (more && findBusy) return;
  const asked = ++findAsked;
  findBusy = true;
  findLoadingMore = more;
  findError = "";
  if (!more) findQuery = query;
  drawFind();
  const res = await api("/api/find-search", { query, source: findSource, safe: findSafe, page: more ? findPage + 1 : 1 })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (asked !== findAsked) return;
  findBusy = false;
  if (!res.ok) {
    findError = res.error;
    if (!more) findResults = [];
  } else {
    findPage = res.page;
    for (const r of res.results) { r.source = findSource; r.query = query; }
    const have = new Set(more ? findResults.map((r) => r.id) : []);
    findResults = more ? findResults.concat(res.results.filter((r) => !have.has(r.id))) : res.results;
    if (!more) $("findList").scrollTop = 0;
    findMore = res.more;
  }
  drawFind();
}

function drawFindSource() {
  document.querySelectorAll("#findSources button").forEach((b) => b.classList.toggle("active", b.dataset.source === findSource));
  const active = $("findSources").querySelector("button.active");
  const pill = $("findPill");
  pill.style.width = active.offsetWidth + "px";
  pill.style.transform = `translateX(${active.offsetLeft - 4}px)`;
  $("findInput").placeholder = findSource === "memes" ? "Search meme sounds, like bruh or vine boom"
    : findSource === "music" ? "Search music, like chill, epic or piano" : "Search sound effects, like whoosh, door or explosion";
  $("findMusic").hidden = findSource !== "music";
  drawFindMoods();
}

// The mood chips under the search box (Music only). Click one to search it.
function drawFindMoods() {
  const box = $("findMoods");
  if (!box.children.length) {
    for (const mood of FIND_MOODS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = mood;
      b.onclick = () => {
        $("findInput").value = $("findInput").value.trim().toLowerCase() === mood.toLowerCase() ? "" : mood;
        clearTimeout(findTimer);
        runFind();
        drawFindMoods();
      };
      box.append(b);
    }
  }
  const typed = $("findInput").value.trim().toLowerCase();
  for (const b of box.children) b.classList.toggle("active", b.textContent.toLowerCase() === typed);
}

// Copy the line a song's license asks you to put in your video's description.
async function copyFindCredit(r) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(r.credit);
    ok = true;
  } catch {
    const box = document.createElement("textarea");
    box.value = r.credit;
    document.body.append(box);
    box.select();
    ok = document.execCommand("copy");
    box.remove();
  }
  findNotes.set(r.id, ok ? { text: "Credit copied. Paste it in your video's description.", kind: "saved" }
    : { text: "Couldn't copy the credit.", kind: "bad" });
  drawFind();
}

// Rows are made once per sound and then only updated, so playing one or loading more doesn't
// redraw (and re-animate) the whole list.
const findRows = new Map(); // id -> row element

function findRow(r, i) {
  let row = findRows.get(r.id);
  if (!row) {
    row = document.createElement("div");
    row.className = "find-row";
    row.style.animationDelay = Math.min(i % PER_FIND_PAGE, 12) * 30 + "ms";
    row.innerHTML = `<button type="button" class="play"></button><div class="find-info"><b></b><small></small></div>
      <div class="find-actions"><button type="button" class="icon-button" title="Download as MP3">${SFX_ICONS.download}</button></div>`;
    row.querySelector("b").textContent = row.querySelector("b").title = r.title;
    row.querySelector(".play").onclick = () => playFind(r);
    const save = row.querySelector(".icon-button");
    save.onclick = () => saveFind(r);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "outline-button find-add";
    add.textContent = "Add to Library";
    add.onclick = async () => {
      add.disabled = true;
      findNotes.set(r.id, { text: "Getting it ready...", kind: "" });
      drawFind();
      const res = await api("/api/find-add", { id: r.id }).catch(() => ({ ok: false, error: "Couldn't download it." }));
      add.disabled = false;
      if (!res.ok) {
        findNotes.set(r.id, { text: res.error, kind: "bad" });
        return drawFind();
      }
      findNotes.delete(r.id);
      drawFind();
      closeFind();
      openSfxUpload();
      if (r.source === "music") {
        const genre = FIND_MOODS.find((m) => m.toLowerCase() === (r.genre || r.query || "").toLowerCase()) || "";
        pickUploadCategory("music", genre === "Lofi" ? "Chill" : genre === "Funny" ? "Happy" : genre);
      } else pickUploadCategory("sfx", r.source === "memes" ? "Memes" : "");
      $("sfxName").dataset.auto = "1";
      useSfxFile(res.file);
    };
    if (r.credit) {
      const credit = document.createElement("button");
      credit.type = "button";
      credit.className = "ghost-button find-credit";
      credit.textContent = "Copy credit";
      credit.title = "This song is free to use if you credit the artist. Copies the line to put in your video's description.";
      credit.onclick = () => copyFindCredit(r);
      row.querySelector(".find-actions").prepend(credit);
    }
    row.querySelector(".find-actions").append(add);
    findRows.set(r.id, row);
  }
  const playing = findPlaying === r.id && !findAudio.paused;
  row.classList.toggle("playing", findPlaying === r.id);
  const play = row.querySelector(".play");
  if (play.dataset.on !== String(playing)) {
    play.dataset.on = String(playing);
    play.innerHTML = playing ? SFX_ICONS.pause : SFX_ICONS.play;
    play.title = playing ? "Pause" : "Listen";
  }
  const note = findNotes.get(r.id);
  const meta = row.querySelector("small");
  meta.className = note ? "note " + note.kind : "";
  meta.textContent = note ? note.text
    : (r.source === "music" // (for music, whether you can use it comes first, so it's never cut off)
      ? [r.license, r.seconds ? clock(r.seconds, false) : "", r.creator ? "by " + r.creator : "", r.genre, r.site]
      : [r.seconds ? clock(r.seconds, false) : "", r.creator ? "by " + r.creator : "", r.license, r.site]).filter(Boolean).join(" · ");
  row.querySelector(".find-add").hidden = !(sfxUser() && sfxUser().canUpload);
  return row;
}

function drawFind() {
  const list = $("findList");
  $("findState").textContent = findError || (findBusy && !findResults.length ? "Searching..."
    : findQuery && !findResults.length && !findBusy ? "Nothing found. Try other words." : !findQuery ? (findSource === "memes"
      ? "Meme sounds come from Myinstants."
      : findSource === "music" ? "Free music from Jamendo, ccMixter and more. Pick a mood or type what you need. Songs marked CC BY are free if you credit the artist (use Copy credit)."
      : "Free sound effects from Freesound and more (Creative Commons). Check the license before using one in a video.") : "");
  $("findState").className = "find-state" + (findError ? " bad" : "");
  // While a new search runs, the old results stay (a bit faded) instead of the list going blank.
  list.classList.toggle("stale", findBusy && !findLoadingMore);
  setChildren(list, findResults.map(findRow));
  const ids = new Set(findResults.map((r) => r.id));
  for (const id of findRows.keys()) if (!ids.has(id)) findRows.delete(id);
  // (A sound that's playing goes on in the player bar even when it's not in the new results.)
  $("findMore").hidden = !findMore || !findResults.length;
  $("findMore").disabled = findBusy;
  $("findMore").textContent = findBusy && findLoadingMore ? "Loading..." : "Show more";
  $("findSpinner").hidden = !findBusy;
}
const PER_FIND_PAGE = 20;

$("findOpen").addEventListener("click", openFind);
$("findClose").addEventListener("click", closeFind);
$("findModal").addEventListener("click", (e) => { if (e.target === $("findModal")) closeFind(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("findModal").hidden) closeFind(); });
$("findInput").addEventListener("input", () => {
  clearTimeout(findTimer);
  if (findSource === "music") drawFindMoods();
  findTimer = setTimeout(() => runFind(), 450);
});
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(findTimer); runFind(); }
});
$("findMore").addEventListener("click", () => runFind(true));
$("findSafe").addEventListener("change", () => {
  findSafe = $("findSafe").checked;
  findNotes.clear();
  if ($("findInput").value.trim().length >= 2) runFind();
});
document.querySelectorAll("#findSources button").forEach((b) => b.addEventListener("click", () => {
  if (findSource === b.dataset.source) return;
  findSource = b.dataset.source;
  drawFindSource();
  findNotes.clear();
  if ($("findInput").value.trim().length < 2) findResults = [];
  if ($("findInput").value.trim().length >= 2) runFind();
  else drawFind();
}));
