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
  if (sfxUser() && sfxUser().isOwner) {
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
  $("acctDeleteBox").hidden = user.isOwner; // the owner's account can't be deleted
}

function note(id, text, good) {
  $(id).textContent = text;
  $(id).classList.toggle("good", !!good);
}

// From the account button's menu
$("libAccountOpen").addEventListener("click", () => showTab("account"));
$("libPeopleOpen").addEventListener("click", () => {
  showTab("account");
  setTimeout(() => $("libPeople").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
});
$("acctOutLogin").addEventListener("click", (e) => { e.stopPropagation(); openLogin("login"); });
$("acctOutSignup").addEventListener("click", (e) => { e.stopPropagation(); openLogin("signup"); });
$("acctLogout").addEventListener("click", logOut);

// ---- picture

async function sendPicture(promise) {
  $("libMeButton").classList.add("saving");
  $("acctPicture").disabled = true;
  $("acctPicture").textContent = "Saving...";
  const res = await promise.catch(() => ({ ok: false, error: "Couldn't save the picture." }));
  $("acctPicture").disabled = false;
  $("acctPicture").textContent = "Change picture";
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
  $("libPeopleList").replaceChildren(...people.map((person) => {
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
