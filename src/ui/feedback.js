// Send feedback: bug reports and wishes for the owner. The owner reads them in the Feedback inbox on the Account page.
// Uses $, api() from app.js, showTab() from images.js, sfxUser(), avatarEl(), sfxAgo(), openLogin() from sfx.js.

let feedbackKind = "bug";

function openFeedback() {
  closeMenu();
  const user = sfxUser();
  $("feedbackOut").hidden = !!user;
  $("feedbackForm").hidden = !user;
  $("feedbackThanks").hidden = true;
  $("feedbackNote").textContent = "";
  $("feedbackModal").hidden = false;
  if (user) $("feedbackText").focus();
  countFeedback();
}

function closeFeedback() { $("feedbackModal").hidden = true; }

function countFeedback() {
  const n = $("feedbackText").value.length;
  $("feedbackCount").textContent = n > 1500 ? `${2000 - n} letters left` : "";
}

$("feedbackOpen").addEventListener("click", openFeedback);
$("libFeedbackOpen").addEventListener("click", openFeedback);
$("feedbackCancel").addEventListener("click", closeFeedback);
$("feedbackDone").addEventListener("click", closeFeedback);
$("feedbackText").addEventListener("input", () => { countFeedback(); $("feedbackNote").textContent = ""; });
$("feedbackModal").addEventListener("click", (e) => { if (e.target === $("feedbackModal")) closeFeedback(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("feedbackModal").hidden) closeFeedback(); });
$("feedbackLogin").addEventListener("click", (e) => { e.stopPropagation(); closeFeedback(); openLogin("login"); });
document.querySelectorAll("#feedbackKinds button").forEach((b) => b.addEventListener("click", () => {
  feedbackKind = b.dataset.kind;
  document.querySelectorAll("#feedbackKinds button").forEach((x) => x.classList.toggle("active", x === b));
  $("feedbackText").placeholder = { bug: "What happened? What did you click, and what did you expect?",
    idea: "What should the app do?", other: "What's on your mind?" }[feedbackKind];
}));

$("feedbackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("feedbackSend").disabled = true;
  const res = await api("/api/sfx-feedback-send", { kind: feedbackKind, message: $("feedbackText").value })
    .catch(() => ({ ok: false, error: "That didn't send. Check your internet connection." }));
  $("feedbackSend").disabled = false;
  if (sfxLoggedOut(res)) return openFeedback();
  if (!res.ok) return note("feedbackNote", res.error);
  $("feedbackText").value = "";
  $("feedbackForm").hidden = true;
  $("feedbackThanks").hidden = false;
});

// ---- the owner's inbox

let inbox = [];
const inboxSure = new Set();
const KIND_NAMES = { bug: "Bug", idea: "Idea", other: "Other" };

async function loadInbox(request) {
  const res = await (request || api("/api/sfx-feedback-list", {})).catch(() => ({ ok: false, error: "Couldn't load the feedback." }));
  if (sfxLoggedOut(res)) return;
  $("inboxError").textContent = res.ok ? "" : res.error;
  if (!res.ok) return;
  inbox = res.feedback;
  drawInbox();
  const open = inbox.filter((f) => !f.done).length;
  if (sfxUser() && sfxUser().open_feedback !== open) {
    sfxAccount.user.open_feedback = open;
    drawSfxAccount();
  }
}

function drawInbox() {
  if (!inbox.length) {
    $("inboxList").innerHTML = '<p class="acct-help inbox-empty">Nothing yet. When friends use "Send feedback", it shows up here.</p>';
    return;
  }
  $("inboxList").replaceChildren(...inbox.map((item) => {
    const el = document.createElement("div");
    el.className = "inbox-item" + (item.done ? " done" : "");
    el.innerHTML = `<div class="inbox-main"><div class="inbox-head"><b></b><span class="inbox-kind"></span><span class="inbox-when"></span></div>
      <p class="inbox-text"></p></div><div class="actions"></div>`;
    el.prepend(avatarEl(item.avatarUrl, item.username));
    el.querySelector("b").textContent = item.username;
    const kind = el.querySelector(".inbox-kind");
    kind.textContent = KIND_NAMES[item.kind] || "Other";
    kind.classList.add("kind-" + item.kind);
    el.querySelector(".inbox-when").textContent = sfxAgo(item.created_at) + (item.app_version ? " · version " + item.app_version : "");
    el.querySelector(".inbox-text").textContent = item.message;
    const actions = el.querySelector(".actions");
    const done = document.createElement("button");
    done.type = "button";
    done.className = "outline-button inbox-done";
    done.textContent = item.done ? "Not done" : "Done";
    done.onclick = () => {
      item.done = !item.done;
      drawInbox();
      loadInbox(api("/api/sfx-feedback-set", { id: item.id, done: item.done }));
    };
    const bin = document.createElement("button");
    bin.type = "button";
    bin.className = "icon-button";
    bin.innerHTML = SFX_ICONS.trash;
    bin.title = inboxSure.has(item.id) ? "Click again to delete it" : "Delete";
    if (inboxSure.has(item.id)) bin.style.color = "var(--red)";
    bin.onclick = () => {
      if (!inboxSure.has(item.id)) {
        inboxSure.add(item.id);
        drawInbox();
        setTimeout(() => { if (inboxSure.delete(item.id)) drawInbox(); }, 4000);
        return;
      }
      inboxSure.delete(item.id);
      inbox = inbox.filter((f) => f.id !== item.id);
      drawInbox();
      loadInbox(api("/api/sfx-feedback-set", { id: item.id, remove: true }));
    };
    actions.append(done, bin);
    return el;
  }));
}

$("libInboxOpen").addEventListener("click", () => {
  showTab("account");
  setTimeout(() => $("acctInbox").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
});
