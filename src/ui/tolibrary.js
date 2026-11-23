// (3.1.3) Convert straight into the Library.
// "Save to: Library" in the Link page's format button. Converting then asks for a name and a
// category (like uploading on the Library page), and the app downloads the link into a temporary
// file, uploads it and deletes it. Nothing ends up in Downloads. Only for people who can upload.

let toLibCategory = "sfx";
let toLibGenre = "";
let toLibDone = null; // resolves the open window's promise
let toLibSend = null; // (library) => the convert call

const toLibCan = () => typeof sfxUser === "function" && !!sfxUser() && !!sfxUser().canUpload;

// Logged in, out, or the role changed: the Save to choice shows only for those who can upload.
function toLibAccountChanged() {
  $("saveToBox").hidden = !toLibCan();
  drawSaveTo();
}

function drawSaveTo() {
  for (const b of $("saveTo").children) b.classList.toggle("active", (b.dataset.to === "library") === libraryOn());
  showFormatExtras();
  updateConvertText();
}

for (const b of $("saveTo").children) {
  b.addEventListener("click", () => {
    toLibrary = b.dataset.to === "library";
    savePref("convertToLibrary", toLibrary);
    drawSaveTo();
  });
}
toLibrary = !!loadPref("convertToLibrary");

function toLibPick(category, genre = "") {
  const cats = (sfxAccount && sfxAccount.categories) || {};
  if (!cats[category]) category = "sfx";
  toLibCategory = category;
  toLibGenre = genre;
  setChildren($("toLibCategory"), Object.entries(cats).map(([value, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = value === category ? "active" : "";
    b.onclick = () => toLibPick(value);
    return b;
  }));
  drawGenreChips($("toLibGenres"), category, genre, (g) => toLibPick(toLibCategory, g));
}

// Opens the window. Resolves with the convert call's answer once it's on its way, or null for Cancel.
function askToLibrary(title, count, send) {
  if (toLibDone) toLibDone(null);
  toLibSend = send;
  $("toLibNameRow").hidden = count > 0;
  $("toLibSub").textContent = count > 0
    ? `Each of the ${count} videos goes in under its own title. Nothing is saved on your PC.`
    : "It's converted and uploaded for you. Nothing is saved on your PC.";
  $("toLibHeading").textContent = count > 0 ? `Add ${count} to the Library` : "Add to the Library";
  $("toLibName").value = title || "";
  $("toLibError").textContent = "";
  $("toLibSend").disabled = false;
  const last = loadPref("toLibLast") || {};
  toLibPick(last.category || "sfx", last.genre || "");
  $("toLibModal").hidden = false;
  if (!count) {
    $("toLibName").focus();
    $("toLibName").select();
  }
  return new Promise((resolve) => { toLibDone = resolve; });
}

function toLibClose(result) {
  $("toLibModal").hidden = true;
  const done = toLibDone;
  toLibDone = null;
  if (done) done(result);
}

async function toLibGo() {
  const named = $("toLibNameRow").hidden;
  const name = $("toLibName").value.trim();
  if (!named && !name) {
    $("toLibError").textContent = "Give the sound a name.";
    return $("toLibName").focus();
  }
  $("toLibSend").disabled = true;
  $("toLibError").textContent = "";
  const res = await toLibSend({ name, category: toLibCategory, genre: toLibGenre })
    .catch(() => ({ ok: false, error: "Couldn't reach the app." }));
  $("toLibSend").disabled = false;
  if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return toLibClose(null);
  if (!res.ok) {
    $("toLibError").textContent = res.error || "Couldn't add it to the Library.";
    return;
  }
  savePref("toLibLast", { category: toLibCategory, genre: toLibGenre });
  toLibClose(res);
}

$("toLibSend").addEventListener("click", toLibGo);
$("toLibName").addEventListener("keydown", (e) => { if (e.key === "Enter") toLibGo(); });
$("toLibCancel").addEventListener("click", () => toLibClose(null));
$("toLibModal").addEventListener("click", (e) => { if (e.target === $("toLibModal")) toLibClose(null); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("toLibModal").hidden) toLibClose(null); });

if (sfxAccount) toLibAccountChanged();
