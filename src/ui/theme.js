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

// The side bar: small (icons only) when it was folded in, or when the window is narrow. Set before drawing.
function sideSmallNow() { return loadPref("sideSmall") === true || innerWidth <= 900; }
document.documentElement.classList.toggle("side-small", sideSmallNow());

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
};

// Your own color (#rrggbb): kept light enough on the dark themes that dark text on it stays easy to read,
// and a bit deeper on the light theme, like the ready-made ones.
function customAccent(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const toHex = (L) => {
    const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
    const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [R, G, B].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
  };
  const onDark = Math.min(Math.max(l, 0.6), 0.86);
  return [toHex(onDark), toHex(Math.max(0.36, Math.min(onDark - 0.14, 0.5)))];
}
const isCustomAccent = (a) => typeof a === "string" && /^#[0-9a-f]{6}$/i.test(a);

function applyTheme(theme, accent) {
  if (!["dark", "black", "dim", "warm", "light"].includes(theme)) theme = "dark";
  if (!ACCENT_COLORS[accent] && !isCustomAccent(accent)) accent = "yellow";
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = isCustomAccent(accent) ? "custom" : accent;
  const color = (isCustomAccent(accent) ? customAccent(accent) : ACCENT_COLORS[accent])[theme === "light" ? 1 : 0];
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-rgb", [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(", "));
}

applyTheme(pageSaved.theme, pageSaved.accent);

// Your own picture behind the pages (Settings > Appearance). Empty: the normal background.
function applyPageBg(url) {
  const ok = typeof url === "string" && /^\/board-bg\/[\w.-]+$/.test(url);
  document.documentElement.classList.toggle("has-page-bg", ok);
  document.documentElement.style.setProperty("--page-bg", ok ? `url("${url}")` : "none");
}
applyPageBg(pageSaved.pageBg);

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
