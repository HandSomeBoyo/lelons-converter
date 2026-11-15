// The Titles & tags tab: type a title, get a score with tips, other ways to say it, and tags.
// The score and the ideas are made here as you type. "Look it up on YouTube" asks titles.py for
// what people search and the tags the top videos use.
// Uses $, api() from app.js, loadPref()/savePref() from theme.js, shortNumber() from home.js,
// sfxAgo() from sfx.js, openWatch() from watch.js, setChildren() from motion.js.

const tt = {
  found: null,          // what YouTube said for the topic (titles.py look_up)
  foundFor: "",         // ...and for which topic
  looking: false,
  run: 0,
  ideaRound: 0,         // "More ideas" shows the next ones
  picked: new Set(),    // tags you turned off are not in here (by lowercase name)
  off: new Set(loadPref("ttOff") || []),
  own: loadPref("ttOwn") || [],
  saveTimer: 0,
};

// Words that grab attention. Superlatives (biggest, scariest...) count too.
const TT_STRONG = ["insane", "impossible", "secret", "secrets", "worst", "best", "never", "finally", "every", "ultimate",
  "crazy", "shocking", "terrifying", "hardest", "easiest", "fastest", "craziest", "only", "real", "truth", "hidden",
  "banned", "broke", "broken", "destroyed", "survived", "escaped", "challenge", "perfect", "legendary", "epic", "rare",
  "illegal", "cursed", "unbelievable", "mistake", "mistakes", "wrong", "fail", "failed", "win", "won", "beat", "beat",
  "huge", "tiny", "giant", "first", "last", "free", "million", "overpowered", "op", "rage", "scary", "funniest", "wild"];
const TT_CURIOUS = ["why", "how", "what", "secret", "truth", "never", "vs", "versus", "but", "until", "nobody", "actually",
  "really", "tried", "happened", "happens", "if", "without", "instead", "almost", "finally"];
const TT_SMALL = new Set(["a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "from", "by",
  "is", "it", "my", "i", "we", "you", "this", "that", "so", "as", "be", "are", "was", "vs", "your", "me", "our"]);
// Title words that make bad tags on their own.
const TT_WEAK = new Set(["played", "playing", "play", "time", "long", "very", "really", "just", "made", "make", "went", "going", "goes",
  "doing", "done", "does", "were", "have", "had", "will", "would", "could", "should", "then", "than", "when", "what", "where",
  "there", "their", "they", "them", "this", "that", "with", "into", "about", "after", "before", "again", "still", "even", "some",
  "much", "many", "more", "most", "here", "episode", "part", "video", "today", "tried", "trying", "got", "getting", "hard", "easy", "it's", "i'm"]);
const TT_FILLER = /\b(very|really|just|actually|literally|basically|kinda|sort of|totally)\s+/gi;
const TT_ACRONYM = new Set(["VS", "FPS", "PVP", "PVE", "RPG", "GTA", "NPC", "DIY", "AI", "TV", "PC", "PS5", "UK", "USA", "OP", "IRL", "MVP", "XP", "HP", "TNT", "YT", "4K", "HD", "DLC"]);

const ttWords = (text) => text.match(/[\p{L}\p{N}$](?:[\p{L}\p{N}'%]|[.,](?=\p{N}))*/gu) || [];
const ttMain = (text) => ttWords(text.toLowerCase()).filter((w) => !TT_SMALL.has(w) && w.length > 1);
const ttEmoji = (text) => (text.match(/\p{Extended_Pictographic}/gu) || []).length;
const ttEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ttHas = (title, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${ttEsc(word)}($|[^\\p{L}\\p{N}])`, "iu").test(title);

// Title Case For A Topic ("minecraft hardcore" -> "Minecraft Hardcore"), leaving words like "iPhone" or "GTA" alone.
function ttCap(text) {
  return text.trim().split(/\s+/).map((w, i) => (/[A-Z]/.test(w.slice(1)) || (i && TT_SMALL.has(w.toLowerCase()))) ? w
    : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ---------------------------------------------------------------- the score

// Each check: {pts, max, ok (true / false / "half"), text}. A check that can't be done yet has max 0.
function ttScore(title, topic, searches) {
  const t = title.trim();
  const len = [...t].length;
  const words = ttWords(t);
  const lower = t.toLowerCase();
  const checks = [];
  const add = (max, pts, text) => checks.push({ max, pts, ok: pts >= max ? true : pts > max * 0.4 ? "half" : false, text });

  // 1. Length: phones show about 60 letters, search about 70.
  if (len < 20) add(20, 8, "A bit short. Say a little more about what happens.");
  else if (len < 30) add(20, 16, "Okay length. A few more words could help.");
  else if (len <= 60) add(20, 20, "Good length. It fits on phones without being cut.");
  else if (len <= 70) add(20, 15, `Phones cut it after about 60 letters. It's ${len}.`);
  else add(20, 5, `Too long: YouTube cuts it after about 70 letters. It's ${len}.`);

  // 2. The topic, near the start, so people searching for it find it.
  const main = ttMain(topic);
  if (main.length) {
    const missing = main.filter((w) => !ttHas(t, w));
    const first = Math.min(...main.map((w) => { const m = lower.search(new RegExp(`(^|[^\\p{L}\\p{N}])${ttEsc(w)}`, "u")); return m < 0 ? 999 : m; }));
    if (missing.length === main.length) add(15, 0, `Put "${topic.trim()}" in the title, so people searching for it find it.`);
    else if (missing.length) add(15, 8, `Add "${missing.join(" ")}" too. People search for the whole thing.`);
    else if (first > 35) add(15, 10, `Move "${main[0]}" closer to the start. The first words matter most.`);
    else add(15, 15, "What it's about comes early. Good for search.");
  } else add(0, 0, "Type what the video is about above, to check it's in the title.");

  // 3. A number.
  if (/\d/.test(t) || /\b(one|two|three|five|ten|hundred|thousand|million)\b/i.test(t)) add(10, 10, "Has a number. Numbers stand out in a list.");
  else add(10, 3, "Try a number if it fits (100 days, 24 hours, $1 vs $1,000).");

  // 4. A word with feeling.
  const strong = words.find((w) => TT_STRONG.includes(w.toLowerCase()) || (/^[a-z]{4,}est$/i.test(w) && !/^(test|interest|request|forest|honest|contest|guest|chest|quest)$/i.test(w)));
  if (strong) add(15, 15, `"${strong}" grabs attention.`);
  else add(15, 2, "Add a word with feeling, like insane, secret, worst or finally.");

  // 5. Not shouting.
  const caps = words.filter((w) => w.length > 1 && /\p{Lu}/u.test(w) && w === w.toUpperCase() && !/^\d+$/.test(w) && !TT_ACRONYM.has(w.toUpperCase()));
  const letters = words.filter((w) => /\p{L}/u.test(w));
  if (letters.length > 2 && caps.length >= letters.length * 0.6) add(10, 0, "All CAPS looks like shouting. Use CAPS on one word at most.");
  else if (caps.length > 2) add(10, 4, `${caps.length} words in CAPS is a lot. Keep one to make it stand out.`);
  else if (caps.length) add(10, 10, `"${caps[0]}" in CAPS stands out. Nice.`);
  else add(10, 10, "No shouting. Clean and easy to trust.");

  // 6. Easy to read.
  const marks = (t.match(/[!?]{3,}|\|/g) || []).length;
  if (words.length > 14) add(10, 3, `${words.length} words is a lot. Cut the ones you don't need.`);
  else if (ttEmoji(t) > 2 || marks) add(10, 4, ttEmoji(t) > 2 ? "Lots of emoji. One is plenty." : "Lots of symbols (|, !!!, ???). Keep it simple.");
  else add(10, 10, "Easy to read at a glance.");

  // 7. Makes people curious.
  const curious = /\?/.test(t) || /[(\[]/.test(t) || /\.\.\.|…/.test(t) || TT_CURIOUS.some((w) => ttHas(t, w)) || /^(i|we|my)\b/i.test(t);
  if (curious) add(10, 10, "Leaves a question in their head. They'll want to know.");
  else add(10, 3, "Make them curious: \"Why...\", \"I tried...\", \"...but then\", or a question.");

  // 8. Words people search for (after looking it up).
  if (searches && searches.length) {
    const hit = searches.find((s) => ttMain(s).every((w) => ttHas(t, w)) && ttMain(s).length > (main.length || 1) - 1 && s.toLowerCase() !== topic.toLowerCase());
    if (hit) add(10, 10, `Matches a search people make: "${hit}".`);
    else add(10, 4, `Try words people search for, like "${searches[0]}".`);
  }

  const max = checks.reduce((a, c) => a + c.max, 0);
  const got = checks.reduce((a, c) => a + c.pts, 0);
  return { score: len ? Math.round((got / max) * 100) : 0, checks, len };
}

const ttWord = (n) => (n >= 85 ? "Great title" : n >= 70 ? "Good title" : n >= 50 ? "Okay title" : "Needs work");
const ttTone = (n) => (n >= 70 ? "good" : n >= 50 ? "okay" : "bad");

// ---------------------------------------------------------------- ideas

function ttIdeas(title, topic, searches) {
  const t = title.trim().replace(/\s+/g, " ");
  const k = ttCap(topic || "");
  const seen = new Set([t.toLowerCase()]);
  const yours = [];
  const ideas = [];
  const add = (list, s) => {
    s = s.replace(/\s+/g, " ").replace(/\s+([,.!?:)])/g, "$1").trim();
    if (s && [...s].length <= 100 && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); list.push(s); }
  };
  const score = (s) => ttScore(s, topic, searches).score;

  if (t && score(t) < 85) {
    // Your title, cleaned up: no filler words, nothing after a " | ", Title Case if it was all lower case.
    let base = t.replace(/\s+[|]\s+.*$/, "").replace(TT_FILLER, "");
    if (base === base.toLowerCase()) base = ttCap(base);
    const mine = [];
    add(mine, base);
    // One word in CAPS (the strongest one).
    const strong = ttWords(base).find((w) => TT_STRONG.includes(w.toLowerCase()));
    if (strong && strong !== strong.toUpperCase()) add(mine, base.replace(strong, strong.toUpperCase()));
    // What it's about first.
    if (k && !ttMain(k).some((w) => ttHas(base, w))) add(mine, `${k}: ${base}`);
    // A little twist at the end.
    if (!/[?!).…]$/.test(base) && !/\.\.\.|…/.test(base) && [...base].length < 60 && ttWords(base).length >= 3) {
      add(mine, `${base} (It Went Wrong)`);
      add(mine, `${base}... But There's a Catch`);
    }
    if (/^i\s/i.test(base)) add(mine, base.replace(/^i\s/i, "We ") + " (With Friends)");
    const now = score(t);
    yours.push(...mine.filter((m) => score(m) > now).sort((a, b) => score(b) - score(a)).slice(0, 3));
  }
  if (k) {
    for (const s of [`I Tried ${k} So You Don't Have To`, `${k} Is Harder Than You Think`, `The Truth About ${k}`,
      `Why Nobody Talks About ${k}`, `Beginner vs Pro: ${k}`, `${k} Tips I Wish I Knew Sooner`, `I Finally Beat ${k}`,
      `${k}, But Everything Goes Wrong`, `Everything Wrong With ${k}`, `I Played ${k} for 100 Days`,
      `How I Got Good at ${k} (Fast)`, `The ${k} Mistake Everyone Makes`]) add(ideas, s);
    ideas.sort((a, b) => score(b) - score(a));
  }
  return { yours, ideas };
}

// ---------------------------------------------------------------- tags

function ttTagList(title, topic) {
  const list = [];
  const have = new Set();
  const add = (tag, from, count) => {
    tag = tag.replace(/^#/, "").replace(/\s+/g, " ").trim();
    const key = tag.toLowerCase();
    if (tag.length < 2 || tag.length > 60 || have.has(key)) return;
    have.add(key);
    list.push({ tag, key, from, count });
  };
  const k = topic.trim();
  for (const own of tt.own) add(own, "own");
  if (k) add(k.toLowerCase(), "topic");
  const f = tt.found && tt.foundFor.toLowerCase() === k.toLowerCase() ? tt.found : null;
  if (f) {
    f.searches.slice(0, 6).forEach((s) => add(s.toLowerCase(), "search"));
    f.tags.filter((x) => x.count >= 2).forEach((x) => add(x.tag, "video", x.count));
    f.searches.slice(6).forEach((s) => add(s.toLowerCase(), "search"));
    f.tags.filter((x) => x.count < 2).slice(0, 10).forEach((x) => add(x.tag, "video", x.count));
  }
  if (k && ttMain(k).length > 1) ttMain(k).forEach((w) => add(w, "topic"));
  // Words from your title.
  const main = ttMain(title).filter((w) => w.length > 3 && !/^\d+$/.test(w) && !TT_WEAK.has(w) && !TT_STRONG.includes(w) && !ttHas(k, w));
  if (!f) main.slice(0, 3).forEach((w) => add(w, "title"));
  return list;
}

// YouTube counts the letters, a comma between tags, and quotes around tags with spaces. 500 at most.
const ttTagLength = (tags) => tags.reduce((a, t) => a + t.tag.length + (/\s/.test(t.tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

function ttChosen(list) {
  // Everything you didn't turn off, while it fits in 500.
  const chosen = [];
  for (const t of list) {
    if (tt.off.has(t.key)) continue;
    if (ttTagLength([...chosen, t]) > 500) continue;
    chosen.push(t);
  }
  return chosen;
}

function ttHashtags(list, topic) {
  const camel = (s) => ttMain(s).length ? s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") : "";
  const tags = [];
  const add = (s) => { const h = camel(s); if (h && h.length <= 30 && !tags.some((x) => x.toLowerCase() === h.toLowerCase())) tags.push(h); };
  if (topic.trim()) add(topic);
  list.filter((t) => !tt.off.has(t.key) && (t.from === "search" || t.from === "video" || t.from === "own")).forEach((t) => { if (tags.length < 3 && t.tag.split(" ").length <= 2) add(t.tag); });
  ttMain(topic).forEach((w) => { if (tags.length < 3) add(w); });
  return tags.slice(0, 3).map((h) => "#" + h);
}

// ---------------------------------------------------------------- drawing

function ttDraw() {
  const title = $("ttTitle").value;
  const topic = $("ttTopic").value;
  const f = tt.found && tt.foundFor.toLowerCase() === topic.trim().toLowerCase() ? tt.found : null;
  const s = ttScore(title, topic, f && f.searches);

  // Score
  $("ttCount").textContent = `${s.len} / 100`;
  $("ttCount").className = "tt-count" + (s.len > 70 ? " bad" : s.len > 60 ? " okay" : "");
  const tone = s.len ? ttTone(s.score) : "";
  $("ttScore").className = "tt-score " + tone;
  $("ttNum").textContent = s.len ? s.score : "–";
  $("ttRingFill").style.strokeDashoffset = String(169.6 * (1 - (s.len ? s.score : 0) / 100));
  $("ttWord").textContent = s.len ? ttWord(s.score) : "Type a title";
  const fixes = s.checks.filter((c) => c.ok !== true && c.max).length;
  $("ttSummary").textContent = !s.len ? "You'll see a score and tips right away."
    : fixes ? `${fixes} thing${fixes > 1 ? "s" : ""} could make it better.` : "Nothing to fix. Go upload it!";
  setChildren($("ttChecks"), s.len ? s.checks.map((c) => {
    const li = document.createElement("li");
    li.className = c.ok === true ? "ok" : c.ok === "half" ? "half" : c.max ? "bad" : "skip";
    li.innerHTML = `<i aria-hidden="true">${c.ok === true ? "✓" : c.max ? "!" : "·"}</i>`;
    li.append(c.text);
    return li;
  }) : []);

  // Preview
  const shown = title.trim() || "Your title shows up here";
  $("ttPhoneTitle").textContent = shown;
  $("ttSearchTitle").textContent = shown;
  $("ttCut").textContent = s.len > 70 ? `Cut off after: "...${[...title.trim()].slice(62, 70).join("")}"` : "";

  // Ideas: up to 3 made from your title first, then the next few from the topic.
  const made = ttIdeas(title, topic, f && f.searches);
  const per = 6 - made.yours.length;
  const start = made.ideas.length > per ? (tt.ideaRound * per) % made.ideas.length : 0;
  const pick = [...made.yours.map((text) => ({ text, yours: true })),
    ...[...made.ideas.slice(start), ...made.ideas.slice(0, start)].slice(0, per).map((text) => ({ text }))]
    .map((idea) => ({ ...idea, score: ttScore(idea.text, topic, f && f.searches).score }));
  $("ttIdeasNote").hidden = pick.length > 0;
  $("ttMore").hidden = made.ideas.length <= per;
  setChildren($("ttIdeas"), pick.map((idea) => {
    const row = document.createElement("div");
    row.className = "tt-idea";
    const n = Object.assign(document.createElement("b"), { className: "tt-pill " + ttTone(idea.score), textContent: idea.score });
    const text = Object.assign(document.createElement("span"), { textContent: idea.text });
    if (idea.yours) text.append(Object.assign(document.createElement("small"), { textContent: "from your title" }));
    const use = Object.assign(document.createElement("button"), { type: "button", className: "link-button", textContent: "Use" });
    use.onclick = () => { $("ttTitle").value = idea.text; ttChanged(); $("ttTitle").focus(); };
    const copy = Object.assign(document.createElement("button"), { type: "button", className: "icon-button", title: "Copy" });
    copy.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>';
    copy.onclick = () => ttCopy(idea.text, "Title copied.");
    row.append(n, text, use, copy);
    return row;
  }));

  // Tags
  const list = ttTagList(title, topic);
  const chosen = new Set(ttChosen(list).map((t) => t.key));
  const length = ttTagLength(list.filter((t) => chosen.has(t.key)));
  $("ttMeterText").textContent = `${length} / 500`;
  $("ttMeterFill").style.width = Math.min(100, length / 5) + "%";
  $("ttMeter").className = "tt-meter" + (length > 450 ? " full" : "");
  setChildren($("ttTags"), list.map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tt-tag" + (chosen.has(t.key) ? " on" : "") + (t.from === "own" ? " own" : "");
    b.title = chosen.has(t.key) ? "Click to leave it out" : tt.off.has(t.key) ? "Click to use it" : "Doesn't fit in 500 letters";
    b.append(t.tag);
    const hint = { search: "searched", video: `${t.count} top video${t.count > 1 ? "s" : ""}` }[t.from];
    if (hint) b.append(Object.assign(document.createElement("small"), { textContent: hint }));
    b.onclick = () => {
      if (tt.off.has(t.key)) tt.off.delete(t.key);
      else if (chosen.has(t.key)) tt.off.add(t.key);
      else return;
      ttSave();
      ttDraw();
    };
    if (t.from === "own") {
      const x = Object.assign(document.createElement("span"), { className: "tt-tag-x", title: "Remove", textContent: "×" });
      x.onclick = (e) => { e.stopPropagation(); tt.own = tt.own.filter((o) => o.toLowerCase() !== t.key); ttSave(); ttDraw(); };
      b.append(x);
    }
    return b;
  }));
  $("ttCopyTags").disabled = !chosen.size;
  const hashes = ttHashtags(list, topic);
  $("ttHash").textContent = hashes.join(" ");
  $("ttCopyHash").disabled = !hashes.length;

  // Looking it up
  const k = topic.trim();
  $("ttLook").disabled = tt.looking || k.length < 2;
  $("ttLook").textContent = tt.looking ? "Looking..." : f ? "Look again" : "Look it up on YouTube";
  $("ttLook").classList.toggle("busy", tt.looking);
  $("ttLookNote").textContent = tt.looking ? `Looking at the top videos for "${k}". This takes a few seconds...`
    : f ? `From YouTube for "${f.topic}": ${f.searches.length} searches and the tags of ${f.looked} top videos.`
    : k.length < 2 ? "Type what the video is about, then find the tags the top videos use."
    : `Find the tags the top videos for "${k}" use, and what people search for.`;
  ttDrawFound(f);
}

function ttDrawFound(f) {
  $("ttFound").hidden = !f;
  if (!f) return;
  setChildren($("ttSearches"), f.searches.map((s) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "tt-search-chip" });
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>';
    b.append(s);
    b.title = "Add as a tag";
    b.onclick = () => {
      const key = s.toLowerCase();
      tt.off.delete(key);
      if (!tt.own.some((x) => x.toLowerCase() === key)) tt.own.push(s.toLowerCase());
      ttSave();
      ttDraw();
    };
    return b;
  }));
  $("ttTopNote").textContent = "their titles' scores";
  setChildren($("ttVideos"), f.videos.map((v, i) => {
    const row = Object.assign(document.createElement("button"), { type: "button", className: "ch-video tt-video", title: "Watch it" });
    row.style.animationDelay = i * 40 + "ms";
    row.onclick = () => openWatch(v.url, { title: v.title, sub: v.channel });
    const thumb = Object.assign(document.createElement("span"), { className: "ch-thumb" });
    thumb.append(Object.assign(document.createElement("img"), { src: v.thumbnail, alt: "", loading: "lazy" }));
    const text = Object.assign(document.createElement("span"), { className: "ch-video-text" });
    const bits = [v.channel, v.views != null ? shortNumber(v.views) + " views" : "", v.when ? sfxAgo(v.when * 1000) : ""].filter(Boolean);
    text.append(Object.assign(document.createElement("b"), { textContent: v.title }), Object.assign(document.createElement("small"), { textContent: bits.join(" · ") }));
    const score = ttScore(v.title, f.topic, f.searches).score;
    const pill = Object.assign(document.createElement("b"), { className: "tt-pill " + ttTone(score), textContent: score });
    row.append(thumb, text, pill);
    return row;
  }));
}

// ---------------------------------------------------------------- doing things

function ttSave() {
  clearTimeout(tt.saveTimer);
  tt.saveTimer = setTimeout(() => {
    savePref("ttTitle", $("ttTitle").value);
    savePref("ttTopic", $("ttTopic").value);
    savePref("ttOff", [...tt.off].slice(-200));
    savePref("ttOwn", tt.own.slice(-60));
  }, 600);
}

function ttChanged() {
  tt.ideaRound = 0;
  ttSave();
  ttDraw();
}

async function ttLook() {
  const topic = $("ttTopic").value.trim();
  if (topic.length < 2 || tt.looking) return;
  const mine = ++tt.run;
  tt.looking = true;
  $("ttLookError").textContent = "";
  ttDraw();
  let res;
  try {
    res = await api("/api/titles-look", { topic });
  } catch {
    res = { ok: false, error: "Couldn't look it up. Try again." };
  }
  if (mine !== tt.run) return;
  tt.looking = false;
  if (res.ok) { tt.found = res; tt.foundFor = res.topic; } else $("ttLookError").textContent = res.error || "Couldn't look it up.";
  ttDraw();
}

let ttCopiedTimer = 0;
async function ttCopy(text, note) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.append(box);
    box.select();
    ok = document.execCommand("copy");
    box.remove();
  }
  $("ttCopied").textContent = ok ? note : "Couldn't copy it.";
  $("ttCopied").classList.toggle("show", true);
  clearTimeout(ttCopiedTimer);
  ttCopiedTimer = setTimeout(() => $("ttCopied").classList.remove("show"), 2200);
}

function titlesTabChanged(tab) {
  if (tab === "titles") ttDraw();
}

$("ttTitle").value = loadPref("ttTitle") || "";
$("ttTopic").value = loadPref("ttTopic") || "";
$("ttTitle").addEventListener("input", ttChanged);
$("ttTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); }); // titles are one line
$("ttTopic").addEventListener("input", () => { $("ttLookError").textContent = ""; ttChanged(); });
$("ttTopic").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ttLook(); } });
$("ttLook").onclick = ttLook;
$("ttMore").onclick = () => { tt.ideaRound++; ttDraw(); };
$("ttAddForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const tag = $("ttAdd").value.replace(/^#/, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (tag.length < 2) return;
  tt.off.delete(tag.toLowerCase());
  if (!tt.own.some((x) => x.toLowerCase() === tag.toLowerCase())) tt.own.push(tag);
  $("ttAdd").value = "";
  ttSave();
  ttDraw();
});
$("ttCopyTags").onclick = () => {
  const list = ttChosen(ttTagList($("ttTitle").value, $("ttTopic").value));
  ttCopy(list.map((t) => t.tag).join(", "), `${list.length} tags copied.`);
};
$("ttCopyHash").onclick = () => ttCopy($("ttHash").textContent, "Hashtags copied.");
if (!$("titlesTab").hidden) titlesTabChanged("titles"); // the app opened on this tab
