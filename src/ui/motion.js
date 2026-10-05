// Smooth motion: popups, the chat panel and the account menu glide in and out, and a line slides
// under the active tab. Loaded before the other scripts.
//
// Popups are shown and hidden all over the app with `el.hidden = true / false`. For the ones below,
// hiding first plays the closing animation (class "leaving") and only then really hides them.
// Reading el.hidden gives the new value straight away, so the rest of the app doesn't notice.

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
