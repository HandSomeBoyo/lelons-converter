// Loaded first (in <head>). Two things:
// - Things the page remembers (the open tab, sort, options). The app writes what was saved
//   into the page as LELONS_SAVED, because the browser's own storage is lost every time
//   the app starts (it gets a new address each time).
// - The look (one for everyone), set before anything is drawn.

const pageSaved = (typeof LELONS_SAVED === "object" && LELONS_SAVED) || {};
// What the page showed last time (account, Home, the Library list): drawn straight away when the
// app opens, then replaced by the fresh answers. See pagecache.py.
const pageCache = (typeof LELONS_CACHE === "object" && LELONS_CACHE) || {};
function loadPref(key) {
  return key in pageSaved ? pageSaved[key] : null;
}
function savePref(key, value) {
  pageSaved[key] = value;
  fetch("/api/page-pref", { method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ key, value }) }).catch(() => {});
}

// The side bar: small (icons only) when it was folded in, or when the window is narrow. Set before drawing.
function sideSmallNow() { return loadPref("sideSmall") === true || innerWidth <= 900; }
document.documentElement.classList.toggle("side-small", sideSmallNow());

// One look for everyone (4.0, "light and friendly"): the old dark/black/light themes and accent
// colors are gone. applyTheme() stays so older calls keep working; it always sets the same look.
const ACCENT = "#6d5dfc";
function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = "light";
  root.dataset.accent = "violet";
  root.style.setProperty("--accent", ACCENT);
  root.style.setProperty("--accent-rgb", "109, 93, 252");
}

applyTheme(pageSaved.theme, pageSaved.accent);

// The Size setting. The app's own window draws the page bigger itself (sharp at any size);
// in a browser window the page is zoomed here instead.
let pageZoom = Number(pageSaved.zoom) || 1;
let nativeZoom = !!pageSaved.nativeZoom;
function applyZoom(zoom, native) {
  pageZoom = zoom;
  nativeZoom = native;
  document.documentElement.style.zoom = native || zoom === 1 ? "" : String(zoom);
}
applyZoom(pageZoom, nativeZoom);
