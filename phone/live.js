// The Live tab on the phone: your Twitch stream (time, viewers, followers, next ad), chat you can write in,
// and buttons to change the title, run an ad and make a clip. Signs in to Twitch straight from the phone
// (Twitch's "implicit" sign-in: the token comes back in the link, no secret needed).
"use strict";

const TWITCH_CLIENT_ID = "93vewoxax6ixje6tg26af1yfwzrtxn";  // the user's Twitch developer app (dev.twitch.tv); its redirect URL must be this page
const TWITCH_SCOPES = "chat:read chat:edit channel:manage:broadcast channel:edit:commercial clips:edit moderator:read:followers channel:read:ads";
const HELIX = "https://api.twitch.tv/helix/";

const LV = {
  token: store.get("tw_token", ""),
  me: store.get("tw_me", null),   // {login, user_id}
  stream: null,                   // from helix/streams (null: offline)
  channel: null,                  // title and game, also when offline
  followers: null,
  ads: null,
  chat: [],
  ws: null,
  loaded: false,
  timer: null,
  editing: false,
};

// ---------------------------------------------------------------- signing in

function twitchRedirect() { return location.origin + location.pathname.replace(/index\.html$/, ""); }

function twitchSignIn() {
  if (!TWITCH_CLIENT_ID) return toast("Twitch sign-in isn't set up yet.");
  const state = Math.random().toString(36).slice(2);
  store.set("tw_state", state);
  location.href = "https://id.twitch.tv/oauth2/authorize?" + new URLSearchParams({
    response_type: "token", client_id: TWITCH_CLIENT_ID, redirect_uri: twitchRedirect(), scope: TWITCH_SCOPES, state, force_verify: "false",
  });
}

function twitchSignOut() {
  if (LV.token && TWITCH_CLIENT_ID) {
    fetch("https://id.twitch.tv/oauth2/revoke", { method: "POST", body: new URLSearchParams({ client_id: TWITCH_CLIENT_ID, token: LV.token }) }).catch(() => {});
  }
  LV.token = ""; LV.me = null; LV.stream = null; LV.channel = null; LV.chat = []; LV.loaded = false;
  store.set("tw_token", ""); store.set("tw_me", null);
  twCloseChat();
  render();
}

// Back from Twitch: the token is in the link's # part.
(function cameBack() {
  if (!location.hash.includes("access_token=")) return;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  if (h.get("state") !== store.get("tw_state", "")) return;
  LV.token = h.get("access_token") || "";
  store.set("tw_token", LV.token);
  S.tab = "live";
  store.set("tab", "live");
})();

async function helix(path, opts = {}) {
  const res = await fetch(HELIX + path, {
    method: opts.method || "GET",
    headers: { "Client-Id": TWITCH_CLIENT_ID, Authorization: "Bearer " + LV.token, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { twitchSignOut(); throw new Error("Twitch signed you out. Sign in again."); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error((data && data.message) || `Twitch said no (${res.status}).`);
  return data;
}

// ---------------------------------------------------------------- what's going on

async function liveLoad() {
  if (!LV.token || !TWITCH_CLIENT_ID) return;
  try {
    if (!LV.me) {
      const v = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: "OAuth " + LV.token } });
      if (!v.ok) { twitchSignOut(); return; }
      const j = await v.json();
      LV.me = { login: j.login, user_id: j.user_id };
      store.set("tw_me", LV.me);
    }
    const id = LV.me.user_id;
    const [st, ch, fo, ad] = await Promise.allSettled([
      helix(`streams?user_id=${id}`), helix(`channels?broadcaster_id=${id}`),
      helix(`channels/followers?broadcaster_id=${id}&first=1`), helix(`channels/ads?broadcaster_id=${id}`),
    ]);
    LV.stream = st.status === "fulfilled" ? (st.value.data || [])[0] || null : LV.stream;
    LV.channel = ch.status === "fulfilled" ? (ch.value.data || [])[0] || null : LV.channel;
    LV.followers = fo.status === "fulfilled" ? fo.value.total : LV.followers;
    LV.ads = ad.status === "fulfilled" ? (ad.value.data || [])[0] || null : LV.ads;
    LV.loaded = true;
    twOpenChat();
  } catch (e) {
    toast(e.message);
  }
  if (S.tab === "live" && !S.view && !LV.editing) render();
}

function liveTick() {
  clearTimeout(LV.timer);
  LV.timer = setTimeout(() => { if (S.tab === "live" && !document.hidden) liveLoad(); liveTick(); }, 30000);
}

// ---------------------------------------------------------------- Twitch chat (over a WebSocket)

function twOpenChat() {
  if (LV.ws || !LV.me) return;
  const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
  LV.ws = ws;
  ws.onopen = () => {
    ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
    ws.send("PASS oauth:" + LV.token);
    ws.send("NICK " + LV.me.login);
    ws.send("JOIN #" + LV.me.login);
  };
  ws.onmessage = (e) => {
    for (const line of String(e.data).split("\r\n")) {
      if (!line) continue;
      if (line.startsWith("PING")) { ws.send("PONG :tmi.twitch.tv"); continue; }
      const m = parseIrc(line);
      if (!m) continue;
      if (m.cmd === "PRIVMSG") twAdd({ name: m.tags["display-name"] || m.nick, color: m.tags.color || "", text: m.text });
      else if (m.cmd === "USERNOTICE") twAdd({ notice: m.tags["system-msg"] || "", text: m.text });
      else if (m.cmd === "CLEARCHAT" || m.cmd === "CLEARMSG") { /* (removed messages stay on the phone for now) */ }
    }
  };
  ws.onclose = () => { if (LV.ws === ws) { LV.ws = null; if (LV.token) setTimeout(twOpenChat, 5000); } };
}

function twCloseChat() {
  const ws = LV.ws;
  LV.ws = null;
  if (ws) try { ws.close(); } catch { /* closed */ }
}

function parseIrc(line) {
  let rest = line, tags = {};
  if (rest[0] === "@") {
    const sp = rest.indexOf(" ");
    for (const kv of rest.slice(1, sp).split(";")) {
      const i = kv.indexOf("=");
      tags[kv.slice(0, i)] = kv.slice(i + 1).replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\");
    }
    rest = rest.slice(sp + 1);
  }
  let nick = "";
  if (rest[0] === ":") {
    const sp = rest.indexOf(" ");
    nick = rest.slice(1, sp).split("!")[0];
    rest = rest.slice(sp + 1);
  }
  const ti = rest.indexOf(" :");
  const head = ti >= 0 ? rest.slice(0, ti) : rest;
  const text = ti >= 0 ? rest.slice(ti + 2) : "";
  return { tags, nick, cmd: head.split(" ")[0], text };
}

function twAdd(m) {
  LV.chat.push(m);
  if (LV.chat.length > 80) LV.chat.shift();
  const box = document.getElementById("lvChat");
  if (box) {
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const empty = box.querySelector(".lv-empty");
    if (empty) empty.remove();
    box.insertAdjacentHTML("beforeend", twLine(m));
    while (box.children.length > 80) box.firstElementChild.remove();
    if (near) box.scrollTop = box.scrollHeight;
  }
}

function twLine(m) {
  if (m.notice !== undefined) return `<div class="lv-note">⭐ ${esc(m.notice)}${m.text ? ` <span class="muted">${esc(m.text)}</span>` : ""}</div>`;
  const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : NAMECOLORS[hash(m.name) % NAMECOLORS.length];
  return `<div><b style="color:${color}">${esc(m.name)}</b> ${esc(m.text)}</div>`;
}

function sendTwitch() {
  const box = document.getElementById("lvSay");
  const text = box && box.value.trim();
  if (!text) return;
  if (!LV.ws || LV.ws.readyState !== 1) return toast("Twitch chat isn't connected yet. Try again in a moment.");
  LV.ws.send(`PRIVMSG #${LV.me.login} :${text}`);
  twAdd({ name: LV.me.login, color: "#ffcf3f", text });
  box.value = "";
}

// ---------------------------------------------------------------- the buttons

async function liveAct(what) {
  const id = LV.me && LV.me.user_id;
  if (!id) return;
  try {
    if (what === "title") { LV.editing = true; return render(); }
    if (what === "cancel") { LV.editing = false; return render(); }
    if (what === "save") {
      const title = document.getElementById("lvTitle").value.trim();
      if (!title) return toast("Give the stream a title.");
      await helix(`channels?broadcaster_id=${id}`, { method: "PATCH", body: { title } });
      LV.editing = false;
      if (LV.channel) LV.channel.title = title;
      if (LV.stream) LV.stream.title = title;
      toast("Title changed.");
      return render();
    }
    if (what === "ad") {
      const r = await helix("channels/commercial", { method: "POST", body: { broadcaster_id: id, length: 60 } });
      const d = (r.data || [])[0] || {};
      toast(d.message || "Ad break started (60 seconds).");
      return liveLoad();
    }
    if (what === "clip") {
      const r = await helix(`clips?broadcaster_id=${id}`, { method: "POST" });
      const d = (r.data || [])[0];
      toast(d ? "Clip made! It's in your Twitch clips." : "Couldn't make a clip.");
    }
  } catch (e) {
    toast(what === "clip" && /offline|not live/i.test(e.message) ? "You can only clip while you're live." : e.message);
  }
}

function ago(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- the page

function liveHtml() {
  const head = `<div class="row between"><h1>Live</h1><div class="row sm" style="gap:6px;background:#2a1d3d;color:#c9a8ff;padding:5px 10px;border-radius:14px;font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:#9146ff"></span>Twitch</div></div>`;
  if (!LV.token) {
    return head + `<div class="card soon"><div style="color:#c9a8ff">${I.live.replace("<svg", '<svg width="44" height="44"')}</div>
      <div class="big">Your stream, on your phone</div>
      <div class="muted">See viewers and chat, write in chat, change the title, run ads and make clips.</div>
      <button class="btn" data-lv="signin" style="margin-top:18px;background:#9146ff;color:#fff">Sign in with Twitch</button></div>`;
  }
  if (!LV.loaded) { liveLoad(); liveTick(); return head + '<div class="spin"></div>'; }
  const s = LV.stream, ch = LV.channel || {};
  const title = (s && s.title) || ch.title || "";
  const game = (s && s.game_name) || ch.game_name || "";
  const nextAd = LV.ads && LV.ads.next_ad_at ? Math.max(0, Math.round((LV.ads.next_ad_at * 1000 - Date.now()) / 60000)) : null;
  const status = s
    ? `<div class="row between"><div class="row" style="gap:8px"><span class="lv-live">LIVE</span><b id="lvClock" data-start="${esc(s.started_at)}">${ago(s.started_at)}</b></div>
        <div class="row" style="gap:6px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f1efe9" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><b>${s.viewer_count}</b></div></div>`
    : `<div class="row" style="gap:8px"><span class="lv-off">OFFLINE</span><span class="muted sm">Go live from OBS on your PC</span></div>`;
  const titleBox = LV.editing
    ? `<input class="field" id="lvTitle" value="${esc(title)}" maxlength="140" style="margin-top:10px">
       <div class="row" style="gap:8px;margin-top:8px"><button class="btn2" data-lv="cancel" style="flex:1;height:40px">Cancel</button><button class="btn" data-lv="save" style="flex:1;height:40px">Save title</button></div>`
    : `<div class="sm muted" style="margin-top:8px">${esc([game, title].filter(Boolean).join(" · "))}</div>`;
  return head + `<div class="card ${s ? "lv-on" : ""}">${status}${titleBox}
      ${LV.editing ? "" : `<div class="row" style="gap:8px;margin-top:12px"><button class="btn2" data-lv="title" style="flex:1;height:40px">Edit title</button><button class="btn2" data-lv="ad" style="flex:1;height:40px">Run ad</button><button class="btn2" data-lv="clip" style="flex:1;height:40px">Clip</button></div>`}
      <div class="row sm" style="margin-top:10px;gap:14px;color:var(--muted)">
        ${LV.followers != null ? `<span><b style="color:var(--text)">${LV.followers}</b> followers</span>` : ""}
        ${nextAd != null && s ? `<span style="color:var(--accent)">Next ad in ${nextAd} min</span>` : ""}</div></div>
    <div class="lbl">Chat</div>
    <div class="card" style="padding:10px 14px"><div id="lvChat" class="lv-chat">${LV.chat.length ? LV.chat.map(twLine).join("") : '<div class="muted sm lv-empty">Nothing in chat yet.</div>'}</div>
      <div class="row" style="gap:8px;margin-top:8px"><input class="field" id="lvSay" placeholder="Say something in chat" enterkeyhint="send" style="height:42px;flex:1;border-radius:999px;background:var(--panel2)">
      <button class="send" data-lv="say" aria-label="Send">${I.send}</button></div></div>
    <div style="text-align:center;margin-top:18px"><button class="sm muted" data-lv="signout">Signed in as ${esc(LV.me ? LV.me.login : "")} · Sign out</button></div>`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-lv]");
  if (!b) return;
  const a = b.dataset.lv;
  if (a === "signin") twitchSignIn();
  else if (a === "signout") twitchSignOut();
  else if (a === "say") sendTwitch();
  else liveAct(a);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.id === "lvSay") { e.preventDefault(); sendTwitch(); }
  if (e.key === "Enter" && e.target && e.target.id === "lvTitle") { e.preventDefault(); liveAct("save"); }
});
setInterval(() => { const c = document.getElementById("lvClock"); if (c) c.textContent = ago(c.dataset.start); }, 1000);
// Called by app.js after it draws a page: keep the chat scrolled to the newest line.
function liveAfterRender() { const box = document.getElementById("lvChat"); if (box) box.scrollTop = box.scrollHeight; }
