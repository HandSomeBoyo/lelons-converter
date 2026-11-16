// (2.34.0) Twitch title, game and tags, changed right from the Live console (Twitch sign-in needed).
// Uses $, api(), loadPref/savePref from app.js and LV, lvEsc, lvOpenSetup from livecon.js.

const LVI = { info: null, at: 0, loading: false, editing: false, error: "", draft: null, search: 0, results: [] };

function lviRecent() { const r = loadPref("lvGames"); return Array.isArray(r) ? r : []; }
function lviRemember(g) {
  if (!g || !g.id) return;
  savePref("lvGames", [g, ...lviRecent().filter((x) => x.id !== g.id)].slice(0, 6));
}

function lvDrawInfo() {
  const box = $("lvInfo");
  if (!box) return;
  const c = LV.cfg || {}, tw = (LV.state && LV.state.twitch) || {};
  box.hidden = !c.twitch;
  if (!c.twitch || LVI.editing) return;
  if (!c.twitchSignedIn) {
    box.innerHTML = `
      <div class="lvi-row">
        <span class="lvi-art lvi-empty">${LV_ICONS.tw}</span>
        <div class="lvi-text"><b>${lvEsc(tw.title || "Your Twitch title and game")}</b>
          <span>${lvEsc(tw.game || "Sign in to Twitch to change them from here, without opening the Twitch dashboard.")}</span></div>
        <button type="button" class="small-button" id="lviSetup">Sign in to Twitch</button>
      </div>`;
    $("lviSetup").onclick = () => lvOpenSetup();
    return;
  }
  if ((!LVI.info || Date.now() - LVI.at > 120000) && !LVI.loading) lviLoad();
  const i = LVI.info;
  box.innerHTML = `
    <div class="lvi-row">
      ${i && i.art ? `<img class="lvi-art" alt="" src="${lvEsc(i.art)}">` : `<span class="lvi-art lvi-empty">${LV_ICONS.tw}</span>`}
      <div class="lvi-text">
        <b>${lvEsc(i ? i.title || "No title yet" : "Loading your title...")}</b>
        <span>${lvEsc(i ? i.game || "No game picked" : "")}${i && i.tags.length ? `<span class="lvi-tags">${i.tags.map((t) => `<i>${lvEsc(t)}</i>`).join("")}</span>` : ""}</span>
        ${LVI.error ? `<em class="lvi-err">${lvEsc(LVI.error)}</em>` : ""}
      </div>
      <button type="button" class="small-button lvi-ghost" id="lviEdit" ${i ? "" : "disabled"}>Change title & game</button>
    </div>`;
  $("lviEdit").onclick = lviOpen;
}

async function lviLoad() {
  LVI.loading = true;
  const res = await api("/api/live-tw-info", {}).catch(() => null);
  LVI.loading = false;
  LVI.at = Date.now();
  if (res && res.ok) { LVI.info = res.info; LVI.error = ""; } else LVI.error = (res && res.error) || "Couldn't load your Twitch title.";
  lvDrawInfo();
}

function lviOpen() {
  const i = LVI.info;
  LVI.editing = true;
  LVI.error = "";
  LVI.draft = { title: i.title, game: i.gameId ? { id: i.gameId, name: i.game, art: i.art } : null, tags: [...i.tags] };
  const box = $("lvInfo");
  box.innerHTML = `
    <div class="lvi-edit">
      <label class="lv-label" for="lviTitle">Title <small id="lviCount"></small></label>
      <label class="input"><input id="lviTitle" maxlength="140" autocomplete="off"></label>
      <label class="lv-label" for="lviGame">Game</label>
      <div class="lvi-gamepick">
        <div class="lvi-picked" id="lviPicked"></div>
        <label class="input"><input id="lviGame" placeholder="Search Twitch for a game..." autocomplete="off"></label>
        <div class="lvi-results" id="lviResults" hidden></div>
      </div>
      <div class="lvi-recent" id="lviRecent"></div>
      <label class="lv-label" for="lviTag">Tags <small>up to 10, press Enter after each</small></label>
      <div class="lvi-tagbox" id="lviTagBox"><input id="lviTag" maxlength="25" placeholder="English, Survival..." autocomplete="off"></div>
      <p class="lvi-err" id="lviErr" hidden></p>
      <div class="lvi-actions"><span class="sp"></span>
        <button type="button" class="small-button lvi-ghost" id="lviCancel">Cancel</button>
        <button type="button" class="small-button lvi-save" id="lviSave">Save to Twitch</button></div>
    </div>`;
  const title = $("lviTitle");
  title.value = LVI.draft.title;
  const count = () => { $("lviCount").textContent = `${title.value.length} / 140`; };
  title.oninput = () => { LVI.draft.title = title.value; count(); };
  count();
  $("lviGame").oninput = () => {
    clearTimeout(LVI.search);
    const q = $("lviGame").value.trim();
    if (!q) { $("lviResults").hidden = true; return; }
    LVI.search = setTimeout(async () => {
      const res = await api("/api/live-tw-games", { q }).catch(() => null);
      if ($("lviGame").value.trim() !== q) return;
      lviDrawResults(res && res.ok ? res.games : [], res && !res.ok ? res.error : "");
    }, 250);
  };
  $("lviGame").onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); const first = LVI.results[0]; if (first) lviPick(first); }
    if (e.key === "Escape") $("lviResults").hidden = true;
  };
  $("lviTag").onkeydown = (e) => {
    const v = $("lviTag").value.replace(/[^\p{L}\p{N}_]/gu, "");
    if ((e.key === "Enter" || e.key === ",") && v) {
      e.preventDefault();
      if (LVI.draft.tags.length < 10 && !LVI.draft.tags.some((t) => t.toLowerCase() === v.toLowerCase())) LVI.draft.tags.push(v);
      $("lviTag").value = "";
      lviDrawTags();
    } else if (e.key === "Backspace" && !$("lviTag").value && LVI.draft.tags.length) {
      LVI.draft.tags.pop();
      lviDrawTags();
    }
  };
  $("lviCancel").onclick = () => { LVI.editing = false; lvDrawInfo(); };
  $("lviSave").onclick = lviSave;
  lviDrawPicked();
  lviDrawTags();
  title.focus();
}

function lviDrawResults(games, error) {
  LVI.results = games;
  const r = $("lviResults");
  r.hidden = false;
  if (!games.length) { r.innerHTML = `<p class="lvi-none">${lvEsc(error || "No games found. Try another name.")}</p>`; return; }
  r.replaceChildren(...games.map((g) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<img alt="" src="${lvEsc(g.art)}"><span>${lvEsc(g.name)}</span>`;
    b.onclick = () => lviPick(g);
    return b;
  }));
}

function lviPick(g) {
  LVI.draft.game = g;
  $("lviGame").value = "";
  $("lviResults").hidden = true;
  lviDrawPicked();
}

function lviDrawPicked() {
  const g = LVI.draft.game;
  $("lviPicked").innerHTML = g
    ? `<img alt="" src="${lvEsc(g.art || "")}"><b>${lvEsc(g.name)}</b>`
    : `<span class="lv-muted">No game picked</span>`;
  const recent = lviRecent().filter((x) => !g || x.id !== g.id);
  $("lviRecent").hidden = !recent.length;
  $("lviRecent").innerHTML = recent.length ? `<span class="lv-muted">Recent:</span>` : "";
  for (const x of recent) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lvi-chip";
    b.textContent = x.name;
    b.onclick = () => lviPick(x);
    $("lviRecent").append(b);
  }
}

function lviDrawTags() {
  const box = $("lviTagBox"), input = $("lviTag");
  box.querySelectorAll(".lvi-tag").forEach((t) => t.remove());
  LVI.draft.tags.forEach((t, n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lvi-tag";
    b.title = "Remove";
    b.textContent = t + " ×";
    b.onclick = () => { LVI.draft.tags.splice(n, 1); lviDrawTags(); };
    box.insertBefore(b, input);
  });
  input.hidden = LVI.draft.tags.length >= 10;
}

async function lviSave() {
  const d = LVI.draft;
  const err = $("lviErr");
  if (!d.title.trim()) { err.hidden = false; err.textContent = "The title can't be empty."; return; }
  $("lviSave").disabled = true;
  $("lviSave").textContent = "Saving...";
  const res = await api("/api/live-tw-set", { title: d.title, gameId: d.game ? d.game.id : undefined, tags: d.tags }).catch(() => null);
  if (!$("lviSave")) return;
  if (!res || !res.ok) {
    $("lviSave").disabled = false;
    $("lviSave").textContent = "Save to Twitch";
    err.hidden = false;
    err.textContent = (res && res.error) || "Couldn't reach Twitch. Try again.";
    return;
  }
  lviRemember(d.game);
  LVI.info = res.info;
  LVI.at = Date.now();
  LVI.editing = false;
  lvDrawInfo();
  if (typeof lvToast === "function") lvToast({ emoji: "✅", title: "Saved to Twitch", text: "Your title and game are updated." });
}
