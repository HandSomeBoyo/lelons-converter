// The Live console's chat lines, shared by the Live tab and the pop-out chat window (livechat.html).
// Chat text comes from strangers, so it's only ever put in the page as text (never as HTML).

const LV_ICONS = {
  tw: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3 3.5 6.5V19h4v2.5h2.5L12.5 19h3.5l5-5V3zm14 10-3 3h-3.5l-2.5 2.5V16H6.5V5H19z"/><path d="M15 7.5h2v5h-2zM10.5 7.5h2v5h-2z"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.5 7.5v9l7.5-4.5z"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8 5 12.5l5 4.5"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>',
};
const LV_NAMES = ["#ff8a65", "#80cbc4", "#b39ddb", "#90caf9", "#a5d6a7", "#ffe082", "#f48fb1", "#ce93d8", "#ffab91", "#81d4fa"];
const LV_EVENT_WORDS = {
  follow: (e) => [e.user, " followed"],
  sub: (e) => [e.user, e.months > 1 ? ` subscribed for ${e.months} months` : " subscribed"],
  gift: (e) => [e.user, e.to ? ` gifted a sub to ${e.to}` : ` gifted ${e.amount || 1} ${e.p === "yt" ? "memberships" : "subs"}`],
  raid: (e) => [e.user, ` raided with ${e.amount || 0} people`],
  bits: (e) => [e.user, ` cheered ${e.amount} bits`],
  superchat: (e) => [e.user, ` sent ${e.money || "a Super Chat"}`],
  sticker: (e) => [e.user, ` sent a Super Sticker (${e.money || ""})`],
  member: (e) => [e.user, e.months > 1 ? ` has been a member for ${e.months} months` : " became a member"],
};
const LV_EVENT_EMOJI = { follow: "💜", sub: "⭐", gift: "🎁", raid: "🚀", bits: "💎", superchat: "💸", sticker: "💸", member: "🎖️" };

function lvPlat(p) {
  const s = document.createElement("span");
  s.className = "lv-tiny " + (p === "yt" ? "yt" : "tw");
  s.title = p === "yt" ? "YouTube" : "Twitch";
  s.innerHTML = LV_ICONS[p === "yt" ? "yt" : "tw"];
  return s;
}

function lvClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}

function lvTime(at) {
  const d = new Date(at * 1000);
  return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
}

function lvNameColor(item) {
  const c = String(item.color || "");
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.42) return c; // dark names are hard to read on the dark page
  }
  let h = 0;
  for (const ch of String(item.login || item.user || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LV_NAMES[h % LV_NAMES.length];
}

function lvSafeImage(url) {
  return /^https:\/\/(static-cdn\.jtvnw\.net|yt\d?\.ggpht\.com|[a-z0-9-]+\.googleusercontent\.com|www\.gstatic\.com)\//.test(String(url || ""));
}

// Does the message say one of these words (your name, !clip...)? Whole words, any case.
function lvSays(text, words) {
  const t = " " + String(text || "").toLowerCase() + " ";
  return (words || []).some((w) => {
    w = String(w || "").trim().toLowerCase();
    if (!w) return false;
    const i = t.indexOf(w);
    if (i < 0) return false;
    const before = t[i - 1], after = t[i + w.length];
    return !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after || " ");
  });
}

// One line of chat (or an event like a follow) as an element. opts: {words, tools: (item) => [buttons]}
function lvChatLine(item, opts = {}) {
  const row = document.createElement("div");
  row.className = "lv-m";
  row.dataset.id = item.id || "";
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = lvTime(item.at || Date.now() / 1000);
  row.append(time);
  const body = document.createElement("span");
  body.className = "body";
  body.append(lvPlat(item.p), " ");
  if (item.guest && !opts.noTag) {  // (2.42.0) from a friend's chat, while co-streaming
    const tag = document.createElement("span");
    tag.className = "lv-co-tag";
    tag.style.setProperty("--c", lvCoColor(item.guest));
    tag.textContent = item.guest;
    tag.title = `From ${item.guest}'s chat`;
    body.append(tag, " ");
    row.classList.add("guest");
  }
  if (item.type === "event") {
    row.classList.add("event", "k-" + item.kind);
    const [who, what] = (LV_EVENT_WORDS[item.kind] || ((e) => [e.user, ""]))(item);
    const b = document.createElement("b");
    b.textContent = who || "Someone";
    body.append(b, what);
    if (item.text && item.kind !== "follow") {
      const q = document.createElement("span");
      q.className = "quote";
      q.textContent = item.text;
      body.append(q);
    }
    row.append(body);
    return row;
  }
  for (const badge of item.badges || []) {
    const b = document.createElement("span");
    b.className = "badge " + badge;
    b.textContent = { host: "HOST", mod: "MOD", vip: "VIP", sub: "SUB", member: "MEMBER" }[badge] || badge.toUpperCase();
    body.append(b);
  }
  const who = document.createElement("span");
  who.className = "who";
  who.style.color = lvNameColor(item);
  who.textContent = item.user || "?";
  body.append(who, item.me ? " " : ": ");
  const txt = document.createElement("span");
  txt.className = "txt" + (item.me ? " me" : "");
  for (const part of item.parts && item.parts.length ? item.parts : [{ t: item.text || "" }]) {
    if (part.e && lvSafeImage(part.e)) {
      const img = document.createElement("img");
      img.className = "emote";
      img.src = part.e;
      img.alt = img.title = part.t || "";
      img.loading = "lazy";
      txt.append(img);
    } else txt.append(part.t || "");
  }
  body.append(txt);
  row.append(body);
  if (item.first) row.classList.add("first");
  if (item.announce) row.classList.add("announce");
  if (opts.words && lvSays(item.text, opts.words)) row.classList.add("hl");
  if (opts.tools) {
    const tools = opts.tools(item);
    if (tools && tools.length) {
      const box = document.createElement("span");
      box.className = "tools";
      box.append(...tools);
      row.append(box);
    }
  }
  return row;
}

const LV_CO_COLORS = ["#4fc3f7", "#f48fb1", "#aed581"];
function lvCoColor(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LV_CO_COLORS[h % LV_CO_COLORS.length];
}

function lvToolButton(icon, title, onClick, red) {
  const b = document.createElement("button");
  b.type = "button";
  b.title = title;
  b.className = red ? "red" : "";
  b.innerHTML = LV_ICONS[icon];
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// Takes out messages Twitch or YouTube removed (a mod deleted it, or the person was timed out).
function lvRemoved(list, removed) {
  if (!removed || !removed.length) return list;
  return list.filter((m) => !removed.some((r) => r.value && (
    (r.by === "id" && m.id === r.value) || (r.by === "login" && m.p === "tw" && m.login === r.value) ||
    (r.by === "channelId" && m.p === "yt" && m.channelId === r.value))));
}
