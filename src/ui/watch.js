// Watch a YouTube video right here in the app, in a big popup, instead of in the browser.
// openWatch(url, {title, sub, convert}) plays it. If the video isn't a YouTube video, or its
// owner turned off playing it on other sites, the popup offers to open it on YouTube instead.
// Uses api() and $() from app.js and appPlayers from volume.js.

const WATCH_ERRORS = {
  2: "That video link doesn't look right.",
  5: "This video can't play inside VaultHub.",
  100: "This video was removed or made private.",
  101: "The owner of this video only lets it play on YouTube.",
  150: "The owner of this video only lets it play on YouTube.",
  152: "This video can't play inside VaultHub.",
  153: "This video can't play inside VaultHub.",
};

// The 11 letter id of a YouTube video, or null.
function youtubeId(url) {
  const m = String(url || "").match(/^(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

let watchUrl = "";
let watchConvert = null;

function openWatch(url, info = {}) {
  const id = youtubeId(url);
  if (!id) return api("/api/games-open", { url }); // not YouTube: the browser it is
  watchUrl = "https://www.youtube.com/watch?v=" + id;
  watchConvert = info.convert === false ? null : (info.convert || (() => homeConvert(watchUrl, false)));
  // Stop the app's own sounds so they don't play over the video.
  for (const [audio, stop] of appPlayers) if (!audio.paused) stop();
  if (typeof playerAudio !== "undefined" && playerAudio && !playerAudio.paused) playerAudio.pause();

  $("watchTitle").textContent = $("watchTitle").title = info.title || "YouTube video";
  $("watchSub").textContent = info.sub || "";
  $("watchConvert").hidden = !watchConvert;
  $("watchError").hidden = true;
  $("watchSpeed").value = "1";
  const frame = document.createElement("iframe");
  frame.id = "watchFrame";
  frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin";
  frame.title = info.title || "YouTube video";
  frame.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  // Ask the player to tell us about errors (like "the owner turned off embedding").
  frame.addEventListener("load", () => {
    try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "vh-watch", channel: "widget" }), "*"); } catch {}
  });
  $("watchScreen").replaceChildren(frame);
  $("watchModal").hidden = false;
  $("watchClose").focus();
}

function closeWatch() {
  if ($("watchModal").hidden) return;
  $("watchModal").hidden = true;
  $("watchScreen").replaceChildren(); // removing the player stops the sound
}

function watchFailed(code) {
  $("watchScreen").replaceChildren();
  $("watchErrorText").textContent = WATCH_ERRORS[code] || "This video can't play inside VaultHub.";
  $("watchError").hidden = false;
}

window.addEventListener("message", (e) => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin) || $("watchModal").hidden) return;
  let data;
  try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  if (data && data.event === "onError") watchFailed(Number(data.info));
  // The speed changed in the player's own gear menu: show it here too.
  const rate = data && data.event === "infoDelivery" && data.info && data.info.playbackRate;
  if (rate && $("watchSpeed").querySelector(`option[value="${rate}"]`)) $("watchSpeed").value = String(rate);
});

// Speed: slow motion (0.25x) up to 2x, through the player's own controls. (Quality is in the
// player's gear button: YouTube no longer lets other apps pick it.)
function watchCommand(func, args) {
  const frame = $("watchFrame");
  try { if (frame) frame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args, id: "vh-watch", channel: "widget" }), "*"); } catch {}
}
$("watchSpeed").addEventListener("change", () => watchCommand("setPlaybackRate", [Number($("watchSpeed").value)]));

$("watchClose").addEventListener("click", closeWatch);
$("watchModal").addEventListener("click", (e) => { if (e.target === $("watchModal")) closeWatch(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("watchModal").hidden) { e.stopPropagation(); closeWatch(); } }, true);
for (const id of ["watchOpen", "watchErrorOpen"]) {
  $(id).addEventListener("click", () => { api("/api/open-youtube", { url: watchUrl }); closeWatch(); });
}
$("watchConvert").addEventListener("click", () => { const go = watchConvert; closeWatch(); if (go) go(); });
