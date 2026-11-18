// (2.42.0) Co-stream: when you stream together with friends, their Twitch chats show in your Chat card,
// mixed in with a colored name tag, or side by side in columns. You can write in their chat too.
// Reading a chat is free and needs nothing; writing needs the Twitch sign-in. Up to 3 friends.
// Uses $, api(), loadPref/savePref from app.js and LV, lvEsc, lvNum, lvChatLine, lvChatTools, lvMyWords,
// lvCoColor, lvToast, lvSendOptions from livecon.js / liveui.js.

const LVC = { friends: null, friendsAt: 0, busy: false, error: "" };

function lvCoList() { return (LV.state && LV.state.co) || []; }
function lvCoSide() { return loadPref("lvCoView") === "side" && lvCoList().length > 0; }

async function lvCoSet(names) {
  LVC.busy = true;
  LVC.error = "";
  lvDrawCo(true);
  const res = await api("/api/live-co-set", { names }).catch(() => null);
  LVC.busy = false;
  if (res && res.ok) {
    if (LV.state) LV.state.co = res.co;
  } else LVC.error = (res && res.error) || "Couldn't change it. Try again.";
  lvDrawCo(true);
  lvSendOptions();
  lvRedrawChat();
}

async function lvCoFriends() {
  LVC.friendsAt = Date.now();
  const res = await api("/api/live-co-friends", {}).catch(() => null);
  LVC.friends = (res && res.ok && res.friends) || [];
  lvDrawCo(true);
}

function lvDrawCo(force) {
  const box = $("lvCo");
  if (!box) return;
  const c = LV.cfg || {};
  box.hidden = !c.twitch;
  if (!c.twitch) return;
  if (!LVC.friends && Date.now() - LVC.friendsAt > 60000) lvCoFriends();
  const co = lvCoList();
  const view = loadPref("lvCoView") === "side" ? "side" : "mix";
  const cols = co.map((f) => f.name).join() + "|" + view;
  if (LVC.cols !== cols) { LVC.cols = cols; lvRedrawChat(); lvSendOptions(); }
  const mine = new Set([c.twitch, ...co.map((f) => f.name)]);
  const offer = (LVC.friends || []).filter((f) => !mine.has(f.twitch)).slice(0, 8);
  const live = new Set((typeof liveNow !== "undefined" ? liveNow : []).filter((s) => s.kind === "twitch").map((s) => s.username.toLowerCase()));
  const shape = JSON.stringify([co, view, offer.map((f) => f.twitch), [...live], LVC.busy, LVC.error]);
  if (!force && box.dataset.shape === shape) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;  // (don't wipe what's being typed)
  box.dataset.shape = shape;
  box.innerHTML = `
    <h3>Co-stream${co.length ? `<span class="sp"></span><span class="lv-seg lvco-view" id="lvcoView"><button data-v="mix" class="${view === "mix" ? "on" : ""}">Mixed</button><button data-v="side" class="${view === "side" ? "on" : ""}">Side by side</button></span>` : ""}</h3>
    ${co.length ? `<div class="lvco-list">${co.map((f) => `
      <div class="lvco-row"><i class="lvco-dot" style="--c:${lvCoColor(f.name)}"></i>
        <div class="t"><b>${lvEsc(f.name)}</b><small>${f.live ? `<span class="lvco-live">LIVE</span>${f.viewers != null ? ` ${lvNum(f.viewers)} watching` : ""}` : f.loading ? "Looking..." : "Not live right now"}</small></div>
        <button type="button" class="lvco-x" data-drop="${lvEsc(f.name)}" title="Stop showing ${lvEsc(f.name)}'s chat">✕</button></div>`).join("")}</div>`
      : `<p class="lv-muted">Streaming together with a friend? Add their Twitch name and their chat shows up in your Chat card, so you can see what their viewers say.</p>`}
    ${co.length < 3 ? `<form class="lvco-add" id="lvcoAdd" autocomplete="off">
      <label class="input"><input id="lvcoName" maxlength="60" placeholder="Friend's Twitch name or link"></label>
      <button type="submit" class="small-button" ${LVC.busy ? "disabled" : ""}>Add</button></form>` : `<p class="lv-muted lvco-note">That's the most at once (3 friends).</p>`}
    ${offer.length && co.length < 3 ? `<div class="lvco-offer"><span class="lv-muted">Friends on VaultHub:</span>${offer.map((f) => `<button type="button" class="lvi-chip" data-add="${lvEsc(f.twitch)}">${live.has(f.username.toLowerCase()) ? '<i class="lvco-on"></i>' : ""}${lvEsc(f.username)}</button>`).join("")}</div>` : ""}
    ${LVC.error ? `<p class="lvi-err">${lvEsc(LVC.error)}</p>` : ""}
    ${co.length && !(c.twitchSignedIn) ? `<p class="lv-muted lvco-note">Sign in to Twitch in Set up to write in their chat too.</p>` : ""}`;
  const add = (name) => {
    name = String(name || "").trim().replace(/^@/, "").replace(/^(https?:\/\/)?(www\.|m\.)?twitch\.tv\//i, "").split(/[/?#]/)[0].toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(name)) { LVC.error = "That isn't a Twitch name. It looks like twitch.tv/name."; return lvDrawCo(true); }
    if (name === c.twitch) { LVC.error = "That's your own channel."; return lvDrawCo(true); }
    lvCoSet([...co.map((f) => f.name), name]);
  };
  const form = $("lvcoAdd");
  if (form) form.onsubmit = (e) => { e.preventDefault(); add($("lvcoName").value); };
  box.querySelectorAll("[data-add]").forEach((b) => { b.onclick = () => add(b.dataset.add); });
  box.querySelectorAll("[data-drop]").forEach((b) => { b.onclick = () => lvCoSet(co.map((f) => f.name).filter((n) => n !== b.dataset.drop)); });
  const seg = $("lvcoView");
  if (seg) seg.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    savePref("lvCoView", b.dataset.v);
    lvDrawCo(true);
    lvRedrawChat();
  };
}

// ---- the columns in the Chat card (side by side)

function lvCoColumn(name) {
  const cols = $("lvMsgCols");
  let col = cols.querySelector(`.lv-cocol[data-co="${CSS.escape(name)}"]`);
  if (!col) {
    col = document.createElement("div");
    col.className = "lv-cocol";
    col.dataset.co = name;
    col.innerHTML = `<div class="lv-cohead"><i style="background:${lvCoColor(name)}"></i><b></b></div><div class="lv-msgs"></div>`;
    col.querySelector("b").textContent = name + "'s chat";
    cols.append(col);
  }
  return col.querySelector(".lv-msgs");
}

function lvCoRedraw() {
  const cols = $("lvMsgCols");
  if (!cols) return;
  const side = lvCoSide(), names = lvCoList().map((f) => f.name);
  cols.classList.toggle("side", side);
  cols.querySelectorAll(".lv-cocol").forEach((col) => { if (!side || !names.includes(col.dataset.co)) col.remove(); });
  if (!side) return;
  const words = lvMyWords();
  for (const name of names) {
    const m = lvCoColumn(name);
    m.innerHTML = "";
    for (const item of LV.chat.filter((i) => i.guest === name).slice(-200)) m.append(lvChatLine(item, { words, tools: lvChatTools, noTag: true }));
    if (!m.children.length) m.innerHTML = `<p class="lv-chat-empty">Connected to ${lvEsc(name)}'s chat. Messages show up here.</p>`;
    m.scrollTop = m.scrollHeight;
  }
}

function lvCoAppend(fresh) {
  if (!lvCoSide()) return;
  const words = lvMyWords();
  for (const item of fresh) {
    if (!item.guest) continue;
    const m = lvCoColumn(item.guest);
    const stuck = m.scrollHeight - m.scrollTop - m.clientHeight < 40;
    m.querySelector(".lv-chat-empty")?.remove();
    m.append(lvChatLine(item, { words, tools: lvChatTools, noTag: true }));
    while (m.children.length > 250) m.firstElementChild.remove();
    if (stuck) m.scrollTop = m.scrollHeight;
  }
}
