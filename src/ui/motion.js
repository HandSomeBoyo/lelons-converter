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

function moveTabLine() {
  const active = document.getElementById("tabs").querySelector("button.active");
  if (!active || document.querySelector("#accountTab:not([hidden])")) {
    tabLine.style.opacity = "0";
    return;
  }
  tabLine.style.opacity = "1";
  tabLine.style.width = active.offsetWidth + "px";
  tabLine.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!tabLineReady) {
    // The first time it just appears there; after that it slides.
    tabLineReady = true;
    requestAnimationFrame(() => tabLine.classList.add("ready"));
  }
}

new MutationObserver(moveTabLine).observe(document.getElementById("tabs"), { subtree: true, attributes: true, attributeFilter: ["class"] });
new MutationObserver(moveTabLine).observe(document.getElementById("accountTab"), { attributes: true, attributeFilter: ["hidden"] });
window.addEventListener("resize", moveTabLine);
document.fonts && document.fonts.ready.then(moveTabLine);
moveTabLine();
