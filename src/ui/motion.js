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

function moveTabLine(instant) {
  const active = document.getElementById("tabs").querySelector("button.active");
  if (!active || document.querySelector("#accountTab:not([hidden])")) {
    tabLine.style.opacity = "0";
    return;
  }
  tabLine.style.opacity = "1";
  const x = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`; // (the tabs are a list down the side)
  // Moving to a tab close by, the highlight slides there quickly. Going further it doesn't fly past
  // everything in between: it just fades in on the new tab.
  const from = tabLine.style.transform && /translate\([^,]*,\s*(-?[\d.]+)px/.exec(tabLine.style.transform);
  const far = !instant && tabLineReady && from && from.length > 1 && Math.abs(Number(from[1]) - active.offsetTop) > 90 && !reduceMotion.matches;
  if (far) tabLine.classList.remove("ready");
  tabLine.style.width = active.offsetWidth + "px";
  tabLine.style.height = active.offsetHeight + "px";
  tabLine.style.transform = x;
  if (far) {
    void tabLine.offsetWidth;
    tabLine.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)" });
    requestAnimationFrame(() => { if (!following) tabLine.classList.add("ready"); });
  }
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
// (Snapped without the slide: putting the slide back on only after the new spot is drawn.)
function snapTabLine() {
  tabLine.classList.remove("ready", "moving");
  moveTabLine(true);
  void tabLine.offsetWidth;
}
window.addEventListener("resize", () => {
  snapTabLine();
  if (!following) requestAnimationFrame(() => tabLine.classList.add("ready"));
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
// While the side bar changes size, the glass under the open page is moved along every frame,
// until the side bar is done (or a moment later, if that never comes).
let following = false, followGiveUp = 0;
function followTabLine() {
  followGiveUp = performance.now() + 1500;
  if (following) return;
  following = true;
  (function frame() {
    snapTabLine();
    if (following && performance.now() < followGiveUp) return void requestAnimationFrame(frame);
    following = false;
    tabLine.classList.add("ready");
  })();
}
document.getElementById("sideFold").addEventListener("click", () => {
  savePref("sideSmall", !document.documentElement.classList.contains("side-small"));
  drawSideFold();
  followTabLine();
});
window.addEventListener("resize", drawSideFold);
// The glass under the open page follows once the side bar has changed size.
document.getElementById("sidebar").addEventListener("transitionend", (e) => {
  if (e.target.id === "sidebar" && e.propertyName === "width") { following = false; window.dispatchEvent(new Event("resize")); }
});
drawSideFold();

// ---- side bar groups (Convert, Create, Tools): click a group's name to fold its pages away, and again to bring
// them back. Remembered. The open page always stays in view, and a folded group shows a dot when a page in it has news.
const sideGroupsShut = new Set(Array.isArray(loadPref("sideGroupsShut")) ? loadPref("sideGroupsShut") : []);
function groupButtons(head) {
  const out = [];
  for (let el = head.nextElementSibling; el && !el.classList.contains("tab-group"); el = el.nextElementSibling) if (el.matches("button[data-tab]")) out.push(el);
  return out;
}
function drawSideGroups() {
  for (const head of document.querySelectorAll("#tabs .tab-group[data-group]")) {
    const shut = sideGroupsShut.has(head.dataset.group);
    head.classList.toggle("shut", shut);
    head.setAttribute("aria-expanded", String(!shut));
    let news = false;
    for (const b of groupButtons(head)) {
      const hide = shut && !b.classList.contains("active");
      b.classList.toggle("group-shut", hide);
      if (hide) b.tabIndex = -1; else b.removeAttribute("tabindex");
      const badge = b.querySelector(".tab-badge");
      if (hide && badge && !badge.hidden) news = true;
    }
    head.classList.toggle("news", news);
  }
}
function toggleSideGroup(head) {
  const g = head.dataset.group;
  sideGroupsShut.has(g) ? sideGroupsShut.delete(g) : sideGroupsShut.add(g);
  savePref("sideGroupsShut", [...sideGroupsShut]);
  drawSideGroups();
  followTabLine();
}
document.getElementById("tabs").addEventListener("click", (e) => {
  const head = e.target.closest(".tab-group[data-group]");
  if (head && !document.documentElement.classList.contains("side-small")) toggleSideGroup(head);
});
document.getElementById("tabs").addEventListener("keydown", (e) => {
  const head = e.target.closest(".tab-group[data-group]");
  if (head && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleSideGroup(head); }
});
// A page opened (or a badge changed) while its group is folded: keep things right.
new MutationObserver(() => drawSideGroups()).observe(document.getElementById("tabs"), { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
drawSideGroups();
