// Loaded first (in <head>). Two things:
// - Things the page remembers (the open tab, sort, options). The app writes what was saved
//   into the page as LELONS_SAVED, because the browser's own storage is lost every time
//   the app starts (it gets a new address each time).
// - Themes: dark, black or light, with an accent color, set before anything is drawn.

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

// accent -> [color on dark themes, darker color for the light theme]
const ACCENT_COLORS = {
  yellow: ["#ffcf3f", "#e9ab00"],
  orange: ["#ff9a4d", "#f07a1a"],
  red: ["#ff6b5e", "#e5483f"],
  pink: ["#ff7ab8", "#e4559c"],
  purple: ["#b495ff", "#8a6cf0"],
  blue: ["#62adff", "#2f86ea"],
  teal: ["#45dccb", "#14ad9d"],
  green: ["#8fdc6a", "#4cb337"],
  white: ["#f2f2f5", "#3a3a3f"],
};

function applyTheme(theme, accent) {
  if (!["ocean", "graphite", "dark", "black", "light"].includes(theme)) theme = "ocean";
  if (!ACCENT_COLORS[accent]) accent = "yellow";
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  const color = ACCENT_COLORS[accent][theme === "light" ? 1 : 0];
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-rgb", [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(", "));
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
