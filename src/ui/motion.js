// Smooth motion: popups, the chat panel and the account menu glide in and out, and a line slides
// under the active tab. Loaded before the other scripts.
//
// Popups are shown and hidden all over the app with `el.hidden = true / false`. For the ones below,
// hiding first plays the closing animation (class "leaving") and only then really hides them.
// Reading el.hidden gives the new value straight away, so the rest of the app doesn't notice.

// Like el.replaceChildren(...nodes), but nodes already in place stay put, and the old ones only go
// once the new ones are in. replaceChildren empties the list first: with a button in it focused,
// the browser lays out the empty page and the window jumps to the top.
function setChildren(parent, nodes, ...more) {
  nodes = [...nodes, ...more].map((n) => typeof n === "string" ? document.createTextNode(n) : n);
  const keep = new Set(nodes);
  let at = parent.firstChild;
  for (const node of nodes) {
    while (at && !keep.has(at)) at = at.nextSibling; // old ones are skipped here, removed below
    if (at === node) { at = at.nextSibling; continue; }
    parent.insertBefore(node, at);
  }
  for (const child of [...parent.childNodes]) if (!keep.has(child)) child.remove();
}

// A cached element: the one made before for this key if what it shows (sig) is the same, else a
// new one from make(). Lists that redraw often use it so unchanged rows aren't made again.
function keptNode(cache, key, sig, make) {
  const kept = cache.get(key);
  if (kept && kept.sig === sig) return kept.el;
  const el = make();
  cache.set(key, { el, sig });
  return el;
}
function forgetNodes(cache, keys) {
  const keep = new Set(keys);
  for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const LEAVE_MS = 220;

function smoothHidden(el) {
  let hidden = el.hasAttribute("hidden");
  let timer = null;
  Object.defineProperty(el, "hidden", {
    configurable: true,
    get: () => hidden,
    set(value) {
      value = !!value;
      if (value === hidden) return;
      hidden = value;
      clearTimeout(timer);
      if (!value) {
        el.classList.remove("leaving");
        el.removeAttribute("hidden");
        return;
      }
      if (reduceMotion.matches || !el.isConnected) {
        el.setAttribute("hidden", "");
        return;
      }
      el.classList.add("leaving");
      timer = setTimeout(() => {
        el.classList.remove("leaving");
        if (hidden) el.setAttribute("hidden", "");
      }, LEAVE_MS);
    },
  });
}

document.querySelectorAll(".modal, #chatPanel, #libMenu").forEach(smoothHidden);

// ---- the line under the active tab

const tabLine = document.createElement("span");
tabLine.className = "tab-line";
document.getElementById("tabs").append(tabLine);
let tabLineReady = false;
tabLine.addEventListener("animationend", () => tabLine.classList.remove("moving"));

function moveTabLine() {
  const active = document.getElementById("tabs").querySelector("button.active");
  if (!active || document.querySelector("#accountTab:not([hidden])")) {
    tabLine.style.opacity = "0";
    return;
  }
  tabLine.style.opacity = "1";
  const x = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`; // (the tabs are a list down the side)
  // Moving to another tab, the glass stretches a little on the way, like a drop of liquid.
  if (tabLineReady && tabLine.style.transform && tabLine.style.transform !== x && !reduceMotion.matches) {
    tabLine.classList.remove("moving");
    void tabLine.offsetWidth;
    tabLine.classList.add("moving");
  }
  tabLine.style.width = active.offsetWidth + "px";
  tabLine.style.height = active.offsetHeight + "px";
  tabLine.style.transform = x;
  if (!tabLineReady) {
    // The first time it just appears there; after that it slides.
    tabLineReady = true;
    requestAnimationFrame(() => tabLine.classList.add("ready"));
  }
}

// (its own class changes don't count: those are just the slide starting and ending)
new MutationObserver((changes) => { if (changes.some((c) => c.target !== tabLine)) moveTabLine(); })
  .observe(document.getElementById("tabs"), { subtree: true, attributes: true, attributeFilter: ["class"] });
new MutationObserver(moveTabLine).observe(document.getElementById("accountTab"), { attributes: true, attributeFilter: ["hidden"] });
// Resizing the window: the glass follows at once (no slide, no stretch).
window.addEventListener("resize", () => {
  tabLine.classList.remove("ready", "moving");
  tabLine.style.transform = "";
  moveTabLine();
  requestAnimationFrame(() => tabLine.classList.add("ready"));
});
document.fonts && document.fonts.ready.then(moveTabLine);
moveTabLine();

// ---- the side bar: fold it in (icons only) and out again; remembered. A narrow window always shows it small.
function drawSideFold() {
  const small = sideSmallNow();
  document.documentElement.classList.toggle("side-small", small);
  const fold = document.getElementById("sideFold");
  fold.title = small ? "Show the side bar" : "Make the side bar smaller";
  fold.classList.toggle("folded", small);
}
document.getElementById("sideFold").addEventListener("click", () => {
  savePref("sideSmall", !document.documentElement.classList.contains("side-small"));
  drawSideFold();
});
window.addEventListener("resize", drawSideFold);
// The glass under the open page follows once the side bar has changed size.
document.getElementById("sidebar").addEventListener("transitionend", (e) => {
  if (e.target.id === "sidebar" && e.propertyName === "width") window.dispatchEvent(new Event("resize"));
});
drawSideFold();
