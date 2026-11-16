// The Account page: your picture, username and password, and (for the owner) everyone's roles.
// Uses $, api() from app.js, showTab() from images.js, and the account bits in sfx.js.

const months = (when) => new Date(when).toLocaleDateString([], { month: "long", year: "numeric" });

function openAccount() {
  closeMenu();
  if (!sfxAccount) loadAccount();
  for (const id of ["acctNameNote", "acctPasswordNote", "acctDeleteNote"]) $(id).textContent = "";
  $("acctDeleteForm").hidden = true;
  $("acctDeleteOpen").hidden = false;
  drawAccountPage(true);
  if (typeof loadProfileEditor === "function") loadProfileEditor();
  if (sfxUser()) loadDevices({ what: "list" });
  if (sfxUser() && sfxUser().canUpload) loadInviteCodes({ what: "list" });
  if (sfxUser() && sfxUser().isOwner) {
    if (typeof loadInbox === "function") loadInbox();
    if (!people.length) $("libPeopleList").textContent = "Loading...";
    loadPeople(api("/api/sfx-people", {}));
  }
}

// Called by drawSfxAccount() whenever the account changes. fresh: also refill the username box.
function drawAccountPage(fresh) {
  const user = sfxUser();
  $("acctLoggedOut").hidden = !!user;
  $("acctMain").hidden = !user;
  if (!user) return;
  $("acctAvatar").replaceWith(Object.assign(avatarEl(user.avatarUrl, user.username, "huge"), { id: "acctAvatar" }));
  $("acctName").textContent = user.username;
  $("acctRole").textContent = user.roleName;
  $("acctRole").className = "role role-" + user.role;
  $("acctSince").textContent = [
    user.created_at ? "Joined " + months(user.created_at) : "",
    user.sounds != null ? `${user.sounds} sound${user.sounds === 1 ? "" : "s"} uploaded` : "",
  ].filter(Boolean).join(" · ");
  $("acctPictureRemove").hidden = !user.avatar;
  if (fresh || document.activeElement !== $("acctUsername")) $("acctUsername").value = user.username;
  $("libPeople").hidden = !user.isOwner;
  $("acctInvites").hidden = !user.canUpload;
  $("acctInbox").hidden = !user.isOwner;
  $("acctTabInvites").hidden = !user.canUpload;
  $("acctTabPeople").hidden = !user.isOwner;
  const open = $("acctTabs").querySelector("button.active");
  if (open && open.hidden) acctPane("profile");
  $("acctDeleteBox").hidden = user.isOwner; // the owner's account can't be deleted
  if (typeof drawProfileEditor === "function") drawProfileEditor();
}

function note(id, text, good) {
  $(id).textContent = text;
  $(id).classList.toggle("good", !!good);
}

// From the account button's menu
$("libAccountOpen").addEventListener("click", () => showTab("account"));
$("libPeopleOpen").addEventListener("click", () => { showTab("account"); acctPane("people"); });
$("libInvitesOpen").addEventListener("click", () => { showTab("account"); acctPane("invites"); });

// (2.33.0) The page's tabs: Profile, Account, Invites, People.
function acctPane(name) {
  for (const b of $("acctTabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.pane === name);
  for (const pane of $("acctMain").querySelectorAll(".acct-pane")) pane.hidden = pane.dataset.pane !== name;
}
$("acctTabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pane]");
  if (b) acctPane(b.dataset.pane);
});
$("acctOutLogin").addEventListener("click", (e) => { e.stopPropagation(); openLogin("login"); });
$("acctOutSignup").addEventListener("click", (e) => { e.stopPropagation(); openLogin("signup"); });
$("acctLogout").addEventListener("click", logOut);

// ---- picture

async function sendPicture(promise) {
  $("libMeButton").classList.add("saving");
  $("acctPicture").disabled = true;
  $("acctPicture").classList.add("saving");
  const res = await promise.catch(() => ({ ok: false, error: "Couldn't save the picture." }));
  $("acctPicture").disabled = false;
  $("acctPicture").classList.remove("saving");
  if (sfxLoggedOut(res)) return;
  if (res.ok && res.account) setSfxAccount(res.account);
  else drawSfxAccount();
  if (!res.ok) alert(res.error);
}

$("acctPicture").addEventListener("click", async () => {
  const res = await api("/api/sfx-picture-pick", {}).catch(() => ({ ok: false, fallback: true }));
  if (res.fallback) return $("acctPictureInput").click(); // not on Windows: the browser's own picker
  sendPicture(Promise.resolve(res));
});
$("acctPictureInput").addEventListener("change", () => {
  const file = $("acctPictureInput").files[0];
  $("acctPictureInput").value = "";
  if (file) sendPicture(fetch("/api/sfx-picture", { method: "POST", body: file }).then((r) => r.json()));
});
$("acctPictureRemove").addEventListener("click", () => sendPicture(api("/api/sfx-picture-remove", {})));

// ---- username

$("acctNameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("acctUsername").value.trim();
  if (name === sfxUser().username) return note("acctNameNote", "That's already your username.");
  $("acctNameSave").disabled = true;
  const res = await api("/api/sfx-rename", { username: name }).catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  $("acctNameSave").disabled = false;
  if (sfxLoggedOut(res)) return;
  if (!res.ok) return note("acctNameNote", res.error);
  setSfxAccount(res.account);
  $("acctUsername").value = sfxUser().username;
  note("acctNameNote", "Saved! Everyone sees your new name now.", true);
  sfxLastLoad = 0; // the Library shows the new name next time
});

// ---- password

$("acctPasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/sfx-password", { old: $("acctOldPassword").value, new: $("acctNewPassword").value })
    .catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  if (sfxLoggedOut(res)) return;
  if (!res.ok) return note("acctPasswordNote", res.error);
  $("acctOldPassword").value = $("acctNewPassword").value = "";
  note("acctPasswordNote", "Password changed.", true);
  loadDevices({ what: "list" }); // (the others were logged out)
});

// ---- delete my account

$("acctDeleteOpen").addEventListener("click", () => {
  $("acctDeleteOpen").hidden = true;
  $("acctDeleteForm").hidden = false;
  $("acctDeletePassword").value = "";
  $("acctDeletePassword").focus();
});
$("acctDeleteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/sfx-delete-me", { password: $("acctDeletePassword").value })
    .catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
  if (sfxLoggedOut(res)) return;
  if (!res.ok) return note("acctDeleteNote", res.error);
  stopSfx();
  setSfxAccount(res.account);
  setLoginMode("login");
  showTab("sfx");
});

// ---- People and roles (only the owner)

let people = [];
const peopleSure = new Set();

async function loadPeople(request) {
  const res = await request.catch(() => ({ ok: false, error: "Couldn't load the accounts." }));
  if (sfxLoggedOut(res)) return;
  $("libPeopleError").textContent = res.ok ? "" : res.error;
  if (res.ok) people = res.people;
  drawPeople();
}

function drawPeople() {
  setChildren($("libPeopleList"), people.map((person) => {
    const el = document.createElement("div");
    el.className = "person";
    el.innerHTML = `<div class="person-info"><b></b><span></span></div><div class="person-role"></div><div class="actions"></div>`;
    el.prepend(avatarEl(person.avatarUrl, person.username, "big"));
    el.querySelector("b").textContent = person.username + (person.me ? " (you)" : "");
    el.querySelector(".person-info span").textContent = [
      "Joined " + sfxAgo(person.created_at),
      person.sounds ? `${person.sounds} sound${person.sounds === 1 ? "" : "s"}` : "",
      person.last_seen ? "seen " + sfxAgo(person.last_seen) : "",
    ].filter(Boolean).join(" · ");
    const roleBox = el.querySelector(".person-role");
    if (person.role === "owner") {
      roleBox.innerHTML = '<span class="role role-owner">Owner</span>';
    } else {
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const role of ["admin", "viewer"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = sfxAccount.roles[role];
        b.className = person.role === role ? "active" : "";
        b.onclick = () => {
          if (person.role === role) return;
          person.role = role;
          drawPeople();
          loadPeople(api("/api/sfx-role", { id: person.id, role }));
        };
        chips.append(b);
      }
      roleBox.append(chips);
      const remove = document.createElement("button");
      remove.className = "icon-button";
      remove.innerHTML = SFX_ICONS.trash;
      remove.title = peopleSure.has(person.id) ? "Click again to remove the account" : "Remove this account (their sounds stay)";
      if (peopleSure.has(person.id)) remove.style.color = "var(--red)";
      remove.onclick = () => {
        if (!peopleSure.has(person.id)) {
          peopleSure.add(person.id);
          $("libPeopleError").textContent = `Click the bin again to remove ${person.username}. Their sounds stay.`;
          drawPeople();
          setTimeout(() => { if (peopleSure.delete(person.id)) { $("libPeopleError").textContent = ""; drawPeople(); } }, 4000);
          return;
        }
        peopleSure.delete(person.id);
        $("libPeopleError").textContent = "";
        people = people.filter((p) => p.id !== person.id);
        drawPeople();
        loadPeople(api("/api/sfx-remove-person", { id: person.id }));
      };
      el.querySelector(".actions").append(remove);
    }
    return el;
  }));
}

if (!$("accountTab").hidden) openAccount();

// ---- invite codes (owner and admins): new accounts need one

let inviteCodes = [], inviteCodeNew = "";

function inviteCodeLeft(seconds) {
  const left = seconds - Date.now() / 1000;
  if (left < 3600) return `${Math.max(1, Math.round(left / 60))} min`;
  if (left < 48 * 3600) return `${Math.round(left / 3600)} hour${Math.round(left / 3600) === 1 ? "" : "s"}`;
  return `${Math.round(left / 86400)} days`;
}

async function loadInviteCodes(body) {
  const res = await api("/api/sfx-invites", body).catch(() => ({ ok: false, error: "Couldn't load the invite codes." }));
  if (sfxLoggedOut(res)) return;
  note("invNote", res.ok ? "" : res.error);
  if (res.ok) {
    inviteCodes = res.invites;
    if (res.made) inviteCodeNew = res.made;
  }
  drawInviteCodes();
}

function drawInviteCodes() {
  const list = $("invList");
  if (!inviteCodes.length) {
    setChildren(list, [Object.assign(document.createElement("p"), { className: "inv-empty", textContent: "No codes yet." })]);
    return;
  }
  setChildren(list, inviteCodes.map((inv) => {
    const el = document.createElement("div");
    el.className = "inv" + (inv.working ? "" : " ran-out") + (inv.code === inviteCodeNew ? " is-new" : "");
    el.innerHTML = '<div class="inv-info"><span class="inv-code"></span><small></small><small class="inv-joined" hidden></small></div><div class="actions"></div>';
    el.querySelector(".inv-code").textContent = inv.code.slice(0, 5) + "-" + inv.code.slice(5);
    const used = inv.max_uses ? `used ${inv.uses} of ${inv.max_uses}` : `used ${inv.uses} time${inv.uses === 1 ? "" : "s"}`;
    el.querySelector("small").textContent = [
      !inv.working ? "Ran out" : inv.expires ? "Works for " + inviteCodeLeft(inv.expires) : "Works until you delete it",
      used,
      inv.mine ? "" : "made by " + inv.by,
    ].filter(Boolean).join(" · ");
    if (inv.joined.length) {
      const joined = el.querySelector(".inv-joined");
      joined.hidden = false;
      joined.textContent = "Joined with it: " + inv.joined.join(", ");
    }
    const actions = el.querySelector(".actions");
    if (inv.working) {
      const copy = Object.assign(document.createElement("button"), { type: "button", className: "small-button", textContent: "Copy" });
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(el.querySelector(".inv-code").textContent);
          copy.textContent = "Copied!";
        } catch { copy.textContent = "Couldn't copy"; }
        setTimeout(() => { copy.textContent = "Copy"; }, 1600);
      };
      actions.append(copy);
    }
    if (inv.mine || sfxUser().isOwner) {
      const del = Object.assign(document.createElement("button"), { type: "button", className: "small-button acct-danger",
        textContent: "Delete", title: "The code stops working. People who already joined keep their accounts." });
      del.onclick = () => {
        inviteCodes = inviteCodes.filter((x) => x !== inv);
        drawInviteCodes();
        loadInviteCodes({ what: "delete", code: inv.code });
      };
      actions.append(del);
    }
    return el;
  }));
}

$("invMake").addEventListener("click", async () => {
  $("invMake").disabled = true;
  await loadInviteCodes({ what: "make", hours: $("invHours").value || null, uses: $("invUses").value || null });
  $("invMake").disabled = false;
});

// ---- your devices: the computers logged in to your account (2.33.0)

let acctDevices = [];
const DEV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';

async function loadDevices(body) {
  const res = await api("/api/sfx-devices", body).catch(() => ({ ok: false, error: "Couldn't load your devices." }));
  if (sfxLoggedOut(res)) return;
  note("devNote", res.ok ? "" : res.error);
  if (res.ok) acctDevices = res.devices;
  drawDevices();
}

function drawDevices() {
  setChildren($("devList"), acctDevices.map((d) => {
    const el = document.createElement("div");
    el.className = "dev" + (d.this ? " this" : "");
    el.innerHTML = `<span class="dev-icon">${DEV_ICON}</span><div class="dev-info"><b></b><small></small></div>`;
    el.querySelector("b").textContent = d.device || "A computer (logged in before devices were shown)";
    if (d.this) el.querySelector("b").append(Object.assign(document.createElement("span"), { className: "dev-here", textContent: "This PC" }));
    el.querySelector("small").textContent = [
      d.version ? "VaultHub " + d.version : "",
      d.this ? "using it now" : "last used " + sfxAgo(d.used * 1000),
      d.device ? "logged in " + sfxAgo(d.since * 1000) : "",
    ].filter(Boolean).join(" · ");
    if (!d.this) {
      const out = Object.assign(document.createElement("button"), { type: "button", className: "small-button acct-logout", textContent: "Log out" });
      out.onclick = () => {
        acctDevices = acctDevices.filter((x) => x !== d);
        drawDevices();
        loadDevices({ what: "out", id: d.id });
      };
      el.append(out);
    }
    return el;
  }));
  $("devOutOthers").hidden = acctDevices.filter((d) => !d.this).length < 2;
}

$("devOutOthers").addEventListener("click", () => {
  acctDevices = acctDevices.filter((d) => d.this);
  drawDevices();
  loadDevices({ what: "out_others" }).then(() => note("devNote", "Logged out everywhere else.", true));
});
