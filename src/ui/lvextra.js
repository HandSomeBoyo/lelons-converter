// (2.43.0) Three Live console cards: Game auto-detect (your Twitch game follows what you play),
// Earnings (a rough estimate of what this stream and this month made) and Game ducking (the game gets
// quieter while you talk, with OBS's own Compressor filter).
// Uses $, api(), LV, lvEsc, lvNum, lvToast, lvOpenSetup, lvtSignedIn, lvtNeedSignIn, lvtAgo from the other lv files.

const LVX = { gdBusy: false, gdPick: false, gdResults: [], gdSearch: 0, earnEdit: false, duck: null, duckAt: 0, duckBusy: false, duckErr: "" };

function lvDrawExtras() {
  lvDrawGd();
  lvDrawEarn();
  lvDrawDuck();
}

// ---------------------------------------------------------------- Game auto-detect

async function lvGdSet(change) {
  const res = await api("/api/live-gd-set", change).catch(() => null);
  if (res && res.ok && LV.state) LV.state.gd = res.gd;
  lvDrawGd(true);
}

function lvDrawGd(force) {
  const box = $("lvGd");
  if (!box) return;
  const c = LV.cfg || {};
  box.hidden = !c.twitch;
  if (!c.twitch) return;
  if (!lvtSignedIn()) return lvtNeedSignIn(box, "Game auto-detect", "let VaultHub change your Twitch game");
  if (LVX.gdPick && !force) return;  // (searching for the right game: don't redraw under the typing)
  const gd = (LV.state && LV.state.gd) || {}, p = gd.prefs || {}, see = gd.seeing, ask = gd.ask;
  const shape = JSON.stringify([gd, LVX.gdPick]);
  if (!force && box.dataset.shape === shape) return;
  box.dataset.shape = shape;
  const art = (g) => g && g.art ? `<img class="lvx-art" alt="" src="${lvEsc(g.art)}">` : `<span class="lvx-art empty">🎮</span>`;
  const same = see && see.game && gd.twitchGame && see.game.name === gd.twitchGame;
  box.innerHTML = `
    <h3>Game auto-detect<span class="sp"></span><label class="check" title="Turn on or off"><input type="checkbox" id="lvxGdOn" ${p.on ? "checked" : ""}></label></h3>
    ${!p.on ? `<p class="lv-muted">Turn it on and your Twitch game changes by itself to the game you're playing. No more streaming "Minecraft" while playing Fortnite.</p>` : `
    <div class="lvx-gd">
      ${art(see && see.game)}
      <div class="t">
        <small>You're playing</small>
        <b>${see ? lvEsc(see.game ? see.game.name : see.name) : "No game found"}</b>
        <span class="lv-muted">${see && see.exe ? lvEsc(see.exe) : see ? "No game is open" : "Start a game and it shows up here."}</span>
      </div>
    </div>
    <div class="lvx-status ${ask ? "ask" : same ? "ok" : ""}">
      ${ask ? `<span>Change your Twitch game to <b>${lvEsc(ask.game.name)}</b>?</span><button type="button" class="small-button" id="lvxGdApply">Change</button>`
        : same ? `<span>✓ Your Twitch game is <b>${lvEsc(gd.twitchGame)}</b></span>`
        : see && see.game ? `<span>Changing your Twitch game in a moment...</span>` : `<span>Twitch game: <b>${lvEsc(gd.twitchGame || "none")}</b></span>`}
    </div>
    ${see && see.exe ? `<button type="button" class="link lvx-wrong" id="lvxGdWrong">Wrong game?</button>` : ""}
    ${LVX.gdPick ? `<div class="lvx-pick">
      <label class="input"><input id="lvxGdQ" placeholder="Search Twitch for the right game..." autocomplete="off"></label>
      <div class="lvx-results" id="lvxGdRes"></div>
      <button type="button" class="link" id="lvxGdNot">${lvEsc(see.exe)} isn't a game</button></div>` : ""}
    <div class="lvx-opts">
      <span class="lv-seg" id="lvxGdMode"><button data-m="auto" class="${p.mode !== "ask" ? "on" : ""}">Change by itself</button><button data-m="ask" class="${p.mode === "ask" ? "on" : ""}">Ask me first</button></span>
      <label class="check lvx-small"><input type="checkbox" id="lvxGdChat" ${p.chatting ? "checked" : ""}><span>Just Chatting when no game is open</span></label>
    </div>
    ${(gd.last || []).length ? `<div class="lvx-last">${gd.last.slice(0, 3).map((x) => `<div><span class="lv-muted" data-at="${x.at}">${lvtAgo(x.at)}</span> ${x.from ? lvEsc(x.from) + " → " : ""}<b>${lvEsc(x.to)}</b></div>`).join("")}</div>` : ""}
    ${gd.error ? `<p class="lvi-err">${lvEsc(gd.error)}</p>` : ""}`}`;
  $("lvxGdOn").onchange = (e) => lvGdSet({ on: e.target.checked });
  if (!p.on) return;
  $("lvxGdMode").onclick = (e) => { const b = e.target.closest("button"); if (b) lvGdSet({ mode: b.dataset.m }); };
  $("lvxGdChat").onchange = (e) => lvGdSet({ chatting: e.target.checked });
  if ($("lvxGdApply")) $("lvxGdApply").onclick = async () => {
    const res = await api("/api/live-gd-apply", {}).catch(() => null);
    if (res && res.ok) { LV.state.gd = res.gd; lvToast({ emoji: "🎮", title: "Twitch game changed", text: ask.game.name }); }
    else lvToast({ emoji: "⚠️", title: "Couldn't change it", text: (res && res.error) || "Try again." });
    lvDrawGd(true);
  };
  if ($("lvxGdWrong")) $("lvxGdWrong").onclick = () => { LVX.gdPick = !LVX.gdPick; lvDrawGd(true); if (LVX.gdPick) $("lvxGdQ").focus(); };
  if (LVX.gdPick) {
    const teach = async (game) => {
      const res = await api("/api/live-gd-teach", { exe: see.exe, game }).catch(() => null);
      LVX.gdPick = false;
      if (res && res.ok) LV.state.gd = res.gd;
      lvToast({ emoji: "🧠", title: "Got it", text: game ? `${see.exe} is ${game.name} from now on.` : `VaultHub won't treat ${see.exe} as a game.` });
      lvDrawGd(true);
    };
    $("lvxGdNot").onclick = () => teach(null);
    $("lvxGdQ").oninput = () => {
      clearTimeout(LVX.gdSearch);
      const q = $("lvxGdQ").value.trim();
      LVX.gdSearch = setTimeout(async () => {
        if (!q) { $("lvxGdRes").innerHTML = ""; return; }
        const res = await api("/api/live-tw-games", { q }).catch(() => null);
        const games = (res && res.ok && res.games) || [];
        $("lvxGdRes").replaceChildren(...games.slice(0, 5).map((g) => {
          const b = document.createElement("button");
          b.type = "button";
          b.innerHTML = `<img alt="" src="${lvEsc(g.art)}"><span>${lvEsc(g.name)}</span>`;
          b.onclick = () => teach(g);
          return b;
        }));
      }, 250);
    };
  }
}

// ---------------------------------------------------------------- Earnings (estimate)

function lvMoney(usd, p) {
  const v = usd * (p.cur === "USD" ? 1 : p.rate || 1);
  const n = v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2);
  return { USD: "$" + n, EUR: "€" + n, GBP: "£" + n, NOK: "kr " + n, SEK: "kr " + n, DKK: "kr " + n }[p.cur] || `${p.cur} ${n}`;
}

function lvDrawEarn(force) {
  const box = $("lvEarn");
  if (!box) return;
  const c = LV.cfg || {};
  box.hidden = !c.twitch;
  if (!c.twitch) return;
  if (LVX.earnEdit && !force) return;
  const e = (LV.state && LV.state.earn) || {}, p = e.prefs || { split: 50, cpm: 3.5, cur: "NOK", rate: 10.5 }, s = e.stream;
  const shape = JSON.stringify([e, LVX.earnEdit]);
  if (!force && box.dataset.shape === shape) return;
  box.dataset.shape = shape;
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  box.innerHTML = `
    <h3>Earnings <small class="lv-muted">estimate</small><span class="sp"></span><button type="button" class="link" id="lvxEarnEdit">${LVX.earnEdit ? "Done" : "Settings"}</button></h3>
    <div class="lvx-earn">
      <div><small>This stream</small><b>${s ? lvMoney(s.total, p) : "–"}</b></div>
      <div><small>${lvEsc(month)}</small><b>${lvMoney(e.month || 0, p)}</b><span class="lv-muted">${lvNum(e.monthStreams || 0)} stream${e.monthStreams === 1 ? "" : "s"}</span></div>
    </div>
    <div class="lvx-rows">
      <div><span>⭐ Subs <i>${lvNum(s ? s.subCount : 0)}</i></span><b>${lvMoney(s ? s.subs : 0, p)}</b></div>
      <div><span>💎 Bits <i>${lvNum(s ? s.bitCount : 0)}</i></span><b>${lvMoney(s ? s.bits : 0, p)}</b></div>
      <div><span>📺 Ads</span><b>${lvMoney(s ? s.ads : 0, p)}</b></div>
    </div>
    ${LVX.earnEdit ? `<div class="lvx-earnset">
      <label class="fx-field"><span>Your sub split</span><select id="lvxSplit">${[50, 60, 70].map((v) => `<option value="${v}" ${+p.split === v ? "selected" : ""}>${v}%${v === 50 ? " (most streamers)" : v === 70 ? " (Plus program)" : ""}</option>`).join("")}</select></label>
      <label class="fx-field"><span>Money</span><select id="lvxCur">${["NOK", "SEK", "DKK", "EUR", "GBP", "USD"].map((v) => `<option ${p.cur === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="fx-field"><span>1 US dollar is</span><span class="input"><input id="lvxRate" value="${p.rate}" inputmode="decimal" ${p.cur === "USD" ? "disabled" : ""}></span></label>
      <label class="fx-field"><span>Ads pay per 1,000 views ($)</span><span class="input"><input id="lvxCpm" value="${p.cpm}" inputmode="decimal"></span></label>
    </div>` : ""}
    <p class="lv-muted lvx-note">Twitch doesn't tell apps what you earn, so this is worked out from your subs, bits and ad breaks. Your real payout is in the Twitch dashboard.</p>`;
  $("lvxEarnEdit").onclick = async () => {
    if (LVX.earnEdit) {
      const res = await api("/api/live-earn-set", { split: $("lvxSplit").value, cur: $("lvxCur").value, rate: $("lvxRate").value.replace(",", "."), cpm: $("lvxCpm").value.replace(",", ".") }).catch(() => null);
      if (!res || !res.ok) return lvToast({ emoji: "⚠️", title: "Couldn't save", text: (res && res.error) || "Try again." });
      if (LV.state) LV.state.earn = res.earn;
    }
    LVX.earnEdit = !LVX.earnEdit;
    lvDrawEarn(true);
  };
  if (LVX.earnEdit) $("lvxCur").onchange = () => { $("lvxRate").disabled = $("lvxCur").value === "USD"; };
}

// ---------------------------------------------------------------- Game quieter when you talk

async function lvDuckLoad() {
  LVX.duckAt = Date.now();
  const res = await api("/api/live-duck", {}).catch(() => null);
  if (res && res.ok) LVX.duck = res.duck;
  lvDrawDuck(true);
}

async function lvDuckSet(change) {
  LVX.duckBusy = true;
  LVX.duckErr = "";
  lvDrawDuck(true);
  const res = await api("/api/live-duck-set", change).catch(() => null);
  LVX.duckBusy = false;
  if (res && res.ok) {
    LVX.duck = res.duck;
    if ("on" in change) lvToast({ emoji: change.on ? "🎧" : "🔇", title: change.on ? "Game ducking is on" : "Game ducking is off", text: change.on ? "Talk and the game goes quieter." : "The filter is taken off in OBS." });
  } else LVX.duckErr = (res && res.error) || "Couldn't reach OBS.";
  lvDrawDuck(true);
}

function lvDrawDuck(force) {
  const box = $("lvDuck");
  if (!box) return;
  const obs = (typeof LVO !== "undefined" && LVO.s) || {};
  const c = LV.cfg || {};
  box.hidden = !c.obsOn;
  if (!c.obsOn) return;
  // (the OBS card asks OBS often; without it on the page, this card asks by itself)
  if (typeof lvoShown === "function" && !lvoShown() && !LVX.duckTimer && !box.classList.contains("lv-off") && !$("liveTab").hidden) {
    LVX.duckTimer = setTimeout(async () => {
      const res = await api("/api/live-obs", {}).catch(() => null);
      if (res && res.ok) LVO.s = res.obs;
      LVX.duckTimer = 0;
      lvDrawDuck();
    }, 400);
  }
  if (obs.connected && (!LVX.duck || Date.now() - LVX.duckAt > 30000)) { if (Date.now() - LVX.duckAt > 3000) lvDuckLoad(); }
  const d = LVX.duck;
  const levels = Object.fromEntries((obs.inputs || []).map((i) => [i.name, i.level || 0]));
  const shape = JSON.stringify([d, obs.connected, LVX.duckBusy, LVX.duckErr]);
  if (!force && box.dataset.shape === shape) {
    if (d) lvDuckMeters(levels, d);
    return;
  }
  box.dataset.shape = shape;
  if (!obs.connected || !d) {
    box.innerHTML = `<h3>Game ducking</h3><p class="lv-muted">${obs.connected ? "Loading..." : "Connect OBS (Set up) and the game gets quieter by itself while you talk."}</p>`;
    return;
  }
  const opts = (sel) => d.sources.map((n) => `<option ${n === sel ? "selected" : ""}>${lvEsc(n)}</option>`).join("") || `<option value="">No sound sources in OBS</option>`;
  box.innerHTML = `
    <h3>Game ducking<span class="sp"></span><label class="check" title="Turn on or off"><input type="checkbox" id="lvxDuckOn" ${d.on ? "checked" : ""} ${LVX.duckBusy ? "disabled" : ""}></label></h3>
    <p class="lv-muted lvx-lead">The game gets quieter while you talk, and comes back when you stop.</p>
    <div class="lvx-duck">
      <label class="fx-field"><span>Game sound</span><select id="lvxDuckGame">${opts(d.game)}</select></label>
      <div class="lvx-meter" data-m="game"><i></i></div>
      <label class="fx-field"><span>Your mic</span><select id="lvxDuckMic">${opts(d.mic)}</select></label>
      <div class="lvx-meter mic" data-m="mic"><i></i></div>
    </div>
    <div class="lvx-opts"><span class="lv-muted">How much quieter</span>
      <span class="lv-seg" id="lvxDuckLevel">${["light", "medium", "strong"].map((l) => `<button data-l="${l}" class="${d.level === l ? "on" : ""}">${l[0].toUpperCase() + l.slice(1)}</button>`).join("")}</span></div>
    ${d.on && d.found === false ? `<p class="lvi-err">The filter is turned off in OBS. Turn this off and on again to fix it.</p>` : ""}
    ${LVX.duckErr ? `<p class="lvi-err">${lvEsc(LVX.duckErr)}</p>` : ""}
    <p class="lv-muted lvx-note">${d.on ? `✓ Working. In OBS it's a Compressor filter called "VaultHub ducking" on ${lvEsc(d.game)}.` : "It uses OBS's own Compressor filter, so it keeps working even when VaultHub is closed."}</p>`;
  $("lvxDuckOn").onchange = (e) => lvDuckSet({ on: e.target.checked, game: $("lvxDuckGame").value, mic: $("lvxDuckMic").value });
  $("lvxDuckGame").onchange = () => lvDuckSet({ game: $("lvxDuckGame").value });
  $("lvxDuckMic").onchange = () => lvDuckSet({ mic: $("lvxDuckMic").value });
  $("lvxDuckLevel").onclick = (e) => { const b = e.target.closest("button"); if (b) lvDuckSet({ level: b.dataset.l }); };
  lvDuckMeters(levels, d);
}

function lvDuckMeters(levels, d) {
  const box = $("lvDuck");
  const set = (k, v) => { const i = box.querySelector(`.lvx-meter[data-m="${k}"] i`); if (i) i.style.width = Math.min(100, Math.round(Math.sqrt(v || 0) * 100)) + "%"; };
  set("game", levels[d.game]);
  set("mic", levels[d.mic]);
}
