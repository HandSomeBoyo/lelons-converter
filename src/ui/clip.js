// The trim editor's clip: make it once, then drag it straight into DaVinci Resolve or any app.
// After the first one, every new start or end makes the clip again by itself.
// Uses $, api(), clock(), setDrag(), editor and trimSource from app.js.

let clipOn = false; // making clips for the open trim editor
let clipKey = "";
let clipSent = ""; // the start and end last asked for
let clipTimer = null;
let clipPolling = false;
let clipPending = false; // the lines moved and the new clip hasn't been asked for yet

function clipRequest() {
  return { key: clipKey, ...trimSource.clip(), trim: [editor.start, editor.end] };
}

function clipOpened(source) {
  clipOn = false;
  clipKey = source.key;
  clipSent = "";
  $("trimClip").hidden = !source.clip;
  showClip({ status: "idle" });
  if (!source.clip) return;
  // Made one for this before? Carry on with it.
  api("/api/clip-state", { key: clipKey }).then((res) => {
    if (res.ok && res.clip.status !== "idle" && clipKey === source.key && !$("trimModal").hidden) startClip();
  }).catch(() => {});
}

function clipClosed() {
  clearTimeout(clipTimer);
  clipOn = false;
}

function startClip() {
  clipOn = true;
  sendClip();
}

// The lines moved: make the clip again once they've stopped moving for a moment.
function clipChanged() {
  if (!clipOn) return;
  clearTimeout(clipTimer);
  const wanted = [editor.start, editor.end].map((t) => t.toFixed(2)).join("-");
  if (wanted === clipSent) return;
  clipPending = true;
  showClip({ status: "working", message: "Waiting for you to finish moving..." });
  clipTimer = setTimeout(sendClip, 700);
}

async function sendClip() {
  clipPending = false;
  if (!clipOn || $("trimModal").hidden) return;
  clipSent = [editor.start, editor.end].map((t) => t.toFixed(2)).join("-");
  const res = await api("/api/clip", clipRequest()).catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  if (!res.ok) return showClip({ status: "error", message: res.error });
  showClip(res.clip);
  pollClip();
}

async function pollClip() {
  if (clipPolling) return;
  clipPolling = true;
  try {
    while (clipOn && !$("trimModal").hidden) {
      const res = await api("/api/clip-state", { key: clipKey }).catch(() => null);
      if (!clipOn) break;
      if (res && res.ok) {
        if (!clipPending) showClip(res.clip);
        if (res.clip.status === "ready" || res.clip.status === "error") break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    clipPolling = false;
  }
}

function showClip(clip) {
  const idle = clip.status === "idle";
  $("clipMake").hidden = !idle;
  if (idle) $("clipShare").hidden = true;
  $("clipChip").hidden = idle;
  if (idle) return;
  const ready = clip.status === "ready";
  const chip = $("clipChip");
  chip.className = "clip-chip " + clip.status;
  setDrag(chip, ready ? { kind: "clip", key: clipKey } : null);
  // (GIFs have no sound to send.)
  $("clipShare").hidden = !ready || !sfxUser() || trimSource.clip().format === "gif";
  chip.title = ready ? DRAG_HINT : "";
  $("clipBar").style.width = clip.status === "working" && clip.progress ? clip.progress + "%" : "0";
  if (ready) {
    const [start, end] = clip.trim;
    $("clipTitle").textContent = "Drag me into your editor";
    $("clipInfo").textContent = `${clock(end - start)} clip · ${clip.fileName}`;
  } else if (clip.status === "error") {
    $("clipTitle").textContent = "Couldn't make the clip";
    $("clipInfo").textContent = clip.message;
  } else {
    $("clipTitle").textContent = "Making your clip...";
    $("clipInfo").textContent = clip.message || "";
  }
}

$("clipMake").addEventListener("click", startClip);
$("clipShare").addEventListener("click", () => {
  shareToChat({ clip: clipKey, name: $("clipInfo").textContent.split(" · ").slice(1).join(" · ") || "Clip" });
});
$("clipChip").addEventListener("click", () => { if ($("clipChip").classList.contains("error")) sendClip(); });
