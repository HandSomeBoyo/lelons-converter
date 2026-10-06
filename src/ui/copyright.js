// The Copyright tab: drop a song, sound or video and it's looked up in AcoustID's song database
// (see copycheck.py). Uses $, api(), clock() from app.js, SFX_ICONS from sfx.js, showTab() from images.js.

let copyItems = [];
let copyTimer = null;
let copyRun = 0; // only the newest load keeps the polling going (else each one starts its own)
const copyRows = new Map(); // id -> {el, sig}

function openCopyright() { loadCopyright(); }

async function loadCopyright() {
  clearTimeout(copyTimer);
  const mine = ++copyRun;
  const res = await api("/api/copyright-list", {}).catch(() => null);
  if (mine !== copyRun) return; // a newer load took over
  if (res && res.ok) copyItems = res.items;
  drawCopyright();
  // Quick while something is being checked; not at all while the tab is closed.
  if (!$("copyrightTab").hidden && !document.hidden) {
    copyTimer = setTimeout(loadCopyright, copyItems.some((i) => i.status === "listening" || i.status === "checking") ? 600 : 4000);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("copyrightTab").hidden) loadCopyright(); });

const COPY_ICONS = {
  busy: '<span class="copy-spin"></span>',
  match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M14.8 9.3a4 4 0 1 0 0 5.4"/></svg>',
  free: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
};

function copyRow(item) {
  const busy = item.status === "listening" || item.status === "checking";
  const kind = busy ? "busy" : item.status === "error" ? "error" : item.match ? "match" : "free";
  const sig = JSON.stringify([item.status, item.message, item.match, item.tags, item.seconds]);
  const kept = copyRows.get(item.id);
  if (kept && kept.sig === sig) return kept.el;
  const el = kept ? kept.el : document.createElement("div");
  el.className = "copy-card copy-" + kind + (kept ? " changed" : "");
  el.innerHTML = `<span class="copy-icon"></span><div class="copy-body"><div class="copy-top"><b class="copy-name"></b>
    <span class="copy-len"></span></div><p class="copy-verdict"></p><p class="copy-more"></p></div>
    <button type="button" class="icon-button copy-x" title="Remove">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>`;
  el.querySelector(".copy-icon").innerHTML = COPY_ICONS[kind];
  el.querySelector(".copy-name").textContent = el.querySelector(".copy-name").title = item.name;
  el.querySelector(".copy-len").textContent = item.seconds ? clock(item.seconds, false) : "";
  const verdict = el.querySelector(".copy-verdict"), more = el.querySelector(".copy-more");
  const m = item.match;
  if (busy) {
    verdict.textContent = item.message;
  } else if (item.status === "error") {
    verdict.textContent = item.message;
  } else if (m && m.title) {
    verdict.append("Known song: ", Object.assign(document.createElement("b"), { textContent: `"${m.title}"` }),
      m.artist ? ` by ${m.artist}` : "");
    const bits = [m.album ? `From ${m.album}` : "", `${Math.round(m.score * 100)}% sure`];
    more.append(bits.filter(Boolean).join(" · ") + ". Using it will probably get your video a copyright claim.");
    if (m.link) {
      const link = Object.assign(document.createElement("a"), { href: m.link, target: "_blank", textContent: "See the song" });
      more.append(" ", link);
    }
  } else if (m) {
    verdict.textContent = "It matches a song in the database (no name known for it).";
    more.textContent = "Treat it as copyrighted.";
  } else {
    verdict.textContent = "No known song found.";
    more.textContent = item.seconds && item.seconds < 12
      ? "A good sign, but short sounds can't really be checked: most sound effects and memes aren't in the database."
      : "A good sign, but not a promise. If you didn't make it yourself, check where it came from.";
  }
  const t = item.tags || {};
  if (!busy && (t.copyright || t.artist || t.title)) {
    const said = [t.artist && t.title ? `${t.artist} - ${t.title}` : t.title || t.artist, t.copyright ? `© ${t.copyright.replace(/^(\(c\)|©)\s*/i, "")}` : ""]
      .filter(Boolean).join(" · ");
    const tag = Object.assign(document.createElement("span"), { className: "copy-tag", textContent: "The file says: " + said });
    more.append(tag);
  }
  more.hidden = !more.textContent;
  el.querySelector(".copy-x").hidden = busy;
  el.querySelector(".copy-x").onclick = async () => {
    el.classList.add("leaving");
    const res = await api("/api/copyright-remove", { id: item.id }).catch(() => null);
    setTimeout(() => { if (res && res.ok) { copyItems = res.items; drawCopyright(); } }, 220);
  };
  copyRows.set(item.id, { el, sig });
  if (kept) setTimeout(() => el.classList.remove("changed"), 600);
  return el;
}

function drawCopyright() {
  const ids = new Set(copyItems.map((i) => i.id));
  for (const id of copyRows.keys()) if (!ids.has(id)) copyRows.delete(id);
  setChildren($("copyList"), copyItems.map(copyRow));
  $("copyHead").hidden = !copyItems.some((i) => i.status === "done" || i.status === "error");
}

async function addCopyFiles(files) {
  showTab("copyright");
  for (const file of files.slice(0, 20)) {
    const res = await fetch("/api/copyright-add", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't open this file." }));
    if (!res.ok) alert(res.error);
    loadCopyright();
  }
}

// Files dropped on the window while this tab is open are checked.
function copyTakesDrop(files) {
  if ($("copyrightTab").hidden) return false;
  addCopyFiles(files);
  return true;
}

// The shield button on a Library sound.
async function checkSoundCopyright(sound) {
  showTab("copyright");
  const res = await api("/api/copyright-sound", { url: sound.url, name: sound.name, id: sound.id }).catch(() => ({ ok: false, error: "Couldn't get that sound." }));
  if (!res.ok) alert(res.error);
  loadCopyright();
}

let copyPicking = false;
$("copyDrop").addEventListener("click", async (e) => {
  if (e.target === $("copyFiles")) return;
  e.preventDefault();
  if (copyPicking) return;
  copyPicking = true;
  const res = await api("/api/copyright-pick", {}).catch(() => ({ ok: false, fallback: true }));
  copyPicking = false;
  if (!res.ok) return res.fallback && $("copyFiles").click();
  loadCopyright();
});
$("copyFiles").addEventListener("change", (e) => {
  addCopyFiles([...e.target.files]);
  e.target.value = "";
});
$("copyClear").addEventListener("click", async () => {
  const res = await api("/api/copyright-clear", {}).catch(() => null);
  if (res && res.ok) { copyItems = res.items; drawCopyright(); }
});

if (!$("copyrightTab").hidden) openCopyright(); // (the app opened on this tab)
