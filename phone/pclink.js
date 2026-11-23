// Your PC from the phone: send it a link to download, add a game from Steam, and control OBS.
// The phone leaves a job in the database; VaultHub on your PC picks it up within a few seconds and says
// how it went. While you look at the OBS card, your PC tells the phone what OBS is doing.
"use strict";

const PCL = { pcs: null, loading: false, at: 0, obsTimer: 0, busy: {}, fmt: store.get("pcFmt", "mp4") };

async function pcList(watch) {
  if (PCL.loading) return PCL.pcs;
  PCL.loading = true;
  try {
    PCL.pcs = ((await rpcMe("lelons_pc", { what: "list", data: { watch: !!watch } })) || {}).pcs || [];
    PCL.at = Date.now();
  } catch (e) { PCL.pcs = PCL.pcs || []; }
  PCL.loading = false;
  return PCL.pcs;
}

const pcOnline = () => (PCL.pcs || []).filter((p) => p.online);
// The PC to use: the one you picked last time if it's on, else the one seen most recently.
function pcPick() {
  const on = pcOnline();
  return on.find((p) => p.id === store.get("pcPick", "")) || on[0] || null;
}

// Leaves a job for the PC and waits (up to ~40 s) to hear how it went.
async function pcDo(pc, kind, data) {
  const { id } = await rpcMe("lelons_pc", { what: "send", pc: pc.id, data: { kind, data } });
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1200));
    const t = await rpcMe("lelons_pc", { what: "task", task: id }).catch(() => null);
    if (t && t.state === "done") return t.result || "Done";
    if (t && t.state === "failed") throw new Error(t.result || "Your PC couldn't do that.");
  }
  throw new Error(`${pc.name} didn't answer. Is VaultHub open on it?`);
}

// ---------------------------------------------------------------- Home: "Send to your PC"

function pcHomeHtml() {
  if (!PCL.pcs) { if (!PCL.loading) pcList().then(() => { if (S.tab === "home" && !S.view) pcHomeRefresh(); }); }
  const pc = pcPick();
  const status = !PCL.pcs ? "" : pc ? `<span class="pc-dot on"></span>${esc(pc.name)}` : `<span class="pc-dot"></span>${(PCL.pcs || []).length ? "Your PC is off" : "Open VaultHub on your PC"}`;
  return `<div class="card pc-send" id="pcSend">
      <div class="row between"><b>Send to your PC</b><span class="sm muted row pc-st">${status}</span></div>
      <input class="field" id="pcUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" placeholder="Paste a YouTube or TikTok link" enterkeyhint="send">
      <div class="row pc-go">
        <div class="seg mini">${[["mp4", "Video"], ["mp3", "Audio"]].map(([k, n]) => `<button data-pcfmt="${k}" class="${PCL.fmt === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <button class="btn pc-btn" data-pcact="send">Download</button></div></div>`;
}

function pcHomeRefresh() {
  const box = $("#pcSend");
  if (!box || document.activeElement === $("#pcUrl")) return;
  const url = $("#pcUrl").value;
  box.outerHTML = pcHomeHtml();
  $("#pcUrl").value = url;
}

async function pcSendLink() {
  const box = $("#pcUrl");
  const url = (box.value || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { box.focus(); return toast("Paste a link first, like a YouTube video."); }
  await pcList(true);
  const pc = pcPick();
  if (!pc) return toast((PCL.pcs || []).length ? "Your PC is off. Open VaultHub on it (minimized is fine)." : "Log in to VaultHub on your PC first.");
  const btn = $("[data-pcact=send]");
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const said = await pcDo(pc, "link", { url, fmt: PCL.fmt });
    box.value = "";
    toast(`${said} (${PCL.fmt === "mp3" ? "audio" : "video"}).`);
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = "Download";
}

// ---------------------------------------------------------------- the sheet (links and games)

function sendToPcSheet(what) {
  const game = what.kind === "game";
  const sheet = bSheet(game ? "Add a game from Steam" : "Send to your PC", `<div class="sm muted sheet-sub">${game
    ? "Paste the game's Steam link. Your PC looks it up on Steam and adds it to the list." : "Your PC downloads it into your Downloads folder."}</div>
    <input class="field sheet-in" id="pcsUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" placeholder="${game ? "store.steampowered.com/app/..." : "Paste a link"}" value="${esc(what.url || "")}">
    <div class="sm muted pc-who" id="pcsWho">Looking for your PC...</div>
    <button class="btn" id="pcsGo">${game ? "Add game" : "Send"}</button>`);
  const who = sheet.querySelector("#pcsWho"), go = sheet.querySelector("#pcsGo"), input = sheet.querySelector("#pcsUrl");
  pcList(true).then(() => {
    const pc = pcPick();
    who.innerHTML = pc ? `<span class="pc-dot on"></span>${esc(pc.name)} will do it` : `<span class="pc-dot"></span>Your PC is off. Open VaultHub on it (minimized is fine).`;
  });
  setTimeout(() => input.focus(), 60);
  go.onclick = async () => {
    const url = input.value.trim();
    if (!url) return input.focus();
    const pc = pcPick();
    if (!pc) return toast("Your PC is off. Open VaultHub on it first.");
    go.disabled = true; go.textContent = game ? "Adding..." : "Sending...";
    try {
      const said = await pcDo(pc, game ? "game" : "link", game ? { url } : { url, fmt: what.fmt || "mp4" });
      sheet.remove();
      toast(said);
      if (game && typeof loadGameList === "function") loadGameList();
    } catch (e) { toast(e.message); go.disabled = false; go.textContent = game ? "Add game" : "Send"; }
  };
}

// ---------------------------------------------------------------- Live: OBS

function obsHtml() {
  const pc = pcPick();
  const o = pc && pc.status && pc.status.obs;
  const head = `<div class="row between obs-head"><b>OBS</b><span class="sm muted row pc-st">${pc ? `<span class="pc-dot on"></span>${esc(pc.name)}` : PCL.pcs ? '<span class="pc-dot"></span>PC off' : ""}</span></div>`;
  if (!PCL.pcs) return `<div class="card obs" id="obsCard">${head}<div class="spin" style="margin:18px auto"></div></div>`;
  if (!pc) return `<div class="card obs" id="obsCard">${head}<div class="sm muted">Open VaultHub on your PC to control OBS from here. Minimized is fine.</div></div>`;
  if (!o) return `<div class="card obs" id="obsCard">${head}<div class="sm muted">Asking ${esc(pc.name)} about OBS...</div></div>`;
  if (!o.connected) return `<div class="card obs" id="obsCard">${head}<div class="sm muted">${esc(o.error || "Connecting to OBS...")}</div></div>`;
  const busy = (k) => (PCL.busy[k] ? " busy" : "");
  return `<div class="card obs" id="obsCard">${head}
    <div class="obs-big">
      <button class="obs-b ${o.stream ? "live" : ""}${busy("stream")}" data-obs="stream"><span class="obs-i">${OI.live}</span><b>${o.stream ? "End stream" : "Go live"}</b><span class="xs">${o.stream ? "You're live" : "Offline"}</span></button>
      <button class="obs-b ${o.record ? "rec" : ""}${busy("record")}" data-obs="record"><span class="obs-i">${OI.rec}</span><b>${o.record ? "Stop" : "Record"}</b><span class="xs">${o.record ? (o.recordPaused ? "Paused" : "Recording") : "Not recording"}</span></button>
    </div>
    ${(o.scenes || []).length ? `<div class="obs-lbl">Scenes</div><div class="obs-scenes">${o.scenes.map((s) => `<button class="${s === o.scene ? "on" : ""}${busy("scene:" + s)}" data-obs-scene="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}
    ${(o.inputs || []).length ? `<div class="obs-lbl">Sound</div><div class="obs-mix">${o.inputs.map((i) => `<button class="obs-in ${i.muted ? "muted" : ""}" data-obs-mute="${esc(i.name)}">
        <span class="obs-mic">${i.muted ? OI.off : OI.mic}</span><span class="grow one">${esc(i.name)}</span><span class="xs">${i.muted ? "Muted" : "On"}</span></button>`).join("")}</div>` : ""}
    ${o.replay ? `<button class="btn2 obs-replay" data-obs="replay-save">Save replay</button>` : ""}
  </div>`;
}

function obsRefresh() {
  const card = $("#obsCard");
  if (card) card.outerHTML = obsHtml();
}

// While the Live tab is open: ask every 2 seconds (your PC answers faster while you look).
function obsLoop() {
  clearTimeout(PCL.obsTimer);
  if (S.tab !== "live" || S.view || document.hidden || !S.token) return;
  pcList(true).then(() => obsRefresh());
  PCL.obsTimer = setTimeout(obsLoop, 2000);
}

async function obsDo(key, data, change) {
  const pc = pcPick();
  if (!pc || PCL.busy[key]) return false;
  const o = pc.status && pc.status.obs;
  PCL.busy[key] = true;
  if (o && change) change(o);  // show it straight away (the next look fixes it if it didn't work)
  obsRefresh();
  let ok = true;
  try { await pcDo(pc, "obs", data); } catch (e) { toast(e.message); ok = false; }
  delete PCL.busy[key];
  pcList(true).then(obsRefresh);
  return ok;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-pcfmt],[data-pcact],[data-obs],[data-obs-scene],[data-obs-mute]");
  if (!t) return;
  if (t.dataset.pcfmt) {
    PCL.fmt = t.dataset.pcfmt; store.set("pcFmt", PCL.fmt);
    document.querySelectorAll("[data-pcfmt]").forEach((b) => b.classList.toggle("on", b.dataset.pcfmt === PCL.fmt));
    return;
  }
  if (t.dataset.pcact === "send") return pcSendLink();
  const pc = pcPick();
  const o = (pc && pc.status && pc.status.obs) || {};
  if (t.dataset.obsScene) { const s = t.dataset.obsScene; return obsDo("scene:" + s, { action: "scene", scene: s }, (x) => { x.scene = s; }); }
  if (t.dataset.obsMute) {
    const name = t.dataset.obsMute, inp = (o.inputs || []).find((i) => i.name === name);
    if (!inp) return;
    return obsDo("mute:" + name, { action: "mute", input: name, muted: !inp.muted }, () => { inp.muted = !inp.muted; });
  }
  const a = t.dataset.obs;
  if (a === "stream") {
    const on = !o.stream;
    const sheet = bSheet(on ? "Go live now?" : "End the stream?", `<div class="sm muted sheet-sub">${on
      ? "OBS starts streaming with the scene you have on now." : "OBS stops streaming. Your viewers see the stream end."}</div>
      <button class="btn ${on ? "" : "red"}" data-yes>${on ? "Go live" : "End stream"}</button>`);
    sheet.querySelector("[data-yes]").onclick = () => { sheet.remove(); obsDo("stream", { action: "stream", on }, (x) => { x.stream = on; }); };
    return;
  }
  if (a === "record") return obsDo("record", { action: "record" }, (x) => { x.record = !x.record; x.recordPaused = false; });
  if (a === "replay-save") return obsDo("replay", { action: "replay-save" }).then((ok) => { if (ok) toast("Replay saved on your PC."); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.id === "pcUrl") { e.preventDefault(); pcSendLink(); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) obsLoop(); });

const OI = {
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>',
  rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/></svg>',
};
