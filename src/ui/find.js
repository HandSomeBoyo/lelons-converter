// Find sounds: search free sound effects and meme sounds online, from the Library.
// Uses $, api(), clock(), whereToSave() from app.js, SFX_ICONS, sfxUser(), openSfxUpload(),
// useSfxFile(), pickUploadCategory() from sfx.js.

let findSource = "effects";
let findQuery = "";
let findPage = 1;
let findResults = [];
let findMore = false;
let findBusy = false;
let findError = "";
let findPlaying = null;
let findTimer = null;
let findAsked = 0; // so an old answer can't replace a newer one
const findNotes = new Map(); // id -> {text, kind, path}
const findAudio = new Audio();
findAudio.addEventListener("ended", () => { findPlaying = null; drawFind(); });
findAudio.addEventListener("error", () => {
  if (!findPlaying) return;
  findNotes.set(findPlaying, { text: "Couldn't play this one.", kind: "bad" });
  findPlaying = null;
  drawFind();
});

function openFind() {
  $("findModal").hidden = false;
  drawFindSource();
  drawFind();
  setTimeout(() => $("findInput").focus(), 50);
}
function closeFind() {
  $("findModal").hidden = true;
  findAudio.pause();
  findPlaying = null;
}

async function runFind(more = false) {
  const query = $("findInput").value.trim();
  if (query.length < 2) {
    findResults = []; findMore = false; findError = ""; findQuery = "";
    return drawFind();
  }
  const asked = ++findAsked;
  findBusy = true;
  findError = "";
  if (!more) { findQuery = query; findPage = 1; findResults = []; }
  drawFind();
  const res = await api("/api/find-search", { query, source: findSource, page: more ? findPage + 1 : 1 })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  if (asked !== findAsked) return;
  findBusy = false;
  if (!res.ok) {
    findError = res.error;
  } else {
    findPage = res.page;
    findResults = more ? findResults.concat(res.results) : res.results;
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
  $("findInput").placeholder = findSource === "memes" ? "Search meme sounds, like bruh or vine boom" : "Search sound effects, like whoosh, door or explosion";
}

function drawFind() {
  const list = $("findList");
  const can = sfxUser() && sfxUser().canUpload;
  $("findState").textContent = findError || (findBusy && !findResults.length ? "Searching..."
    : findQuery && !findResults.length ? "Nothing found. Try other words." : !findQuery ? (findSource === "memes"
      ? "Meme sounds come from Myinstants."
      : "Free sound effects from Freesound and more (Creative Commons). Check the license before using one in a video.") : "");
  $("findState").className = "find-state" + (findError ? " bad" : "");
  list.replaceChildren(...findResults.map((r, i) => {
    const row = document.createElement("div");
    row.className = "find-row" + (findPlaying === r.id ? " playing" : "");
    row.style.animationDelay = Math.min(i % PER_FIND_PAGE, 12) * 30 + "ms";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "play";
    play.innerHTML = findPlaying === r.id ? SFX_ICONS.pause : SFX_ICONS.play;
    play.title = findPlaying === r.id ? "Stop" : "Listen";
    play.onclick = () => {
      if (findPlaying === r.id) {
        findAudio.pause();
        findPlaying = null;
      } else {
        findAudio.src = r.preview;
        findAudio.play().catch(() => {});
        findPlaying = r.id;
        findNotes.delete(r.id);
      }
      drawFind();
    };
    const info = document.createElement("div");
    info.className = "find-info";
    const title = Object.assign(document.createElement("b"), { textContent: r.title, title: r.title });
    const note = findNotes.get(r.id);
    const meta = document.createElement("small");
    meta.className = note ? "note " + note.kind : "";
    meta.textContent = note ? note.text
      : [r.seconds ? clock(r.seconds, false) : "", r.creator ? "by " + r.creator : "", r.license, r.site].filter(Boolean).join(" · ");
    info.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "find-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "icon-button";
    save.title = "Download as MP3";
    save.innerHTML = SFX_ICONS.download;
    save.onclick = async () => {
      const folder = await whereToSave();
      if (!folder) return;
      findNotes.set(r.id, { text: "Downloading...", kind: "" });
      drawFind();
      const res = await api("/api/find-save", { id: r.id, folder }).catch(() => ({ ok: false, error: "Couldn't download it." }));
      findNotes.set(r.id, res.ok ? { text: "Saved as " + res.fileName, kind: "saved", path: res.path } : { text: res.error, kind: "bad" });
      drawFind();
    };
    actions.append(save);
    if (can) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "outline-button find-add";
      add.textContent = "Add to Library";
      add.onclick = async () => {
        add.disabled = true;
        findNotes.set(r.id, { text: "Getting it ready...", kind: "" });
        drawFind();
        const res = await api("/api/find-add", { id: r.id }).catch(() => ({ ok: false, error: "Couldn't download it." }));
        if (!res.ok) {
          findNotes.set(r.id, { text: res.error, kind: "bad" });
          return drawFind();
        }
        findNotes.delete(r.id);
        closeFind();
        openSfxUpload();
        pickUploadCategory(findSource === "memes" ? "memes" : "sfx");
        $("sfxName").dataset.auto = "1";
        useSfxFile(res.file);
      };
      actions.append(add);
    }
    row.append(play, info, actions);
    return row;
  }));
  $("findMore").hidden = !findMore || !findResults.length;
  $("findMore").disabled = findBusy;
  $("findMore").textContent = findBusy && findResults.length ? "Loading..." : "Show more";
  $("findSpinner").hidden = !findBusy;
}
const PER_FIND_PAGE = 20;

$("findOpen").addEventListener("click", openFind);
$("findClose").addEventListener("click", closeFind);
$("findModal").addEventListener("click", (e) => { if (e.target === $("findModal")) closeFind(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("findModal").hidden) closeFind(); });
$("findInput").addEventListener("input", () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => runFind(), 450);
});
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(findTimer); runFind(); }
});
$("findMore").addEventListener("click", () => runFind(true));
document.querySelectorAll("#findSources button").forEach((b) => b.addEventListener("click", () => {
  if (findSource === b.dataset.source) return;
  findSource = b.dataset.source;
  drawFindSource();
  findResults = [];
  findNotes.clear();
  if ($("findInput").value.trim().length >= 2) runFind();
  else drawFind();
}));
