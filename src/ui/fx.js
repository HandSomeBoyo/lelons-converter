// The Film assets tab: packs of VFX clips (explosions, fire, smoke, sparks...) like ActionVFX.
// First look only: the packs below are samples and their previews are drawn live on a canvas
// (fxArt), so the page can be tried before real clips are stored anywhere.
// Uses $ from app.js, showTab() from images.js, loadPref()/savePref() from theme.js.

const FX_CATS = [
  { key: "explosion", name: "Explosions" }, { key: "fire", name: "Fire" }, { key: "smoke", name: "Smoke" },
  { key: "muzzle", name: "Muzzle flashes" }, { key: "sparks", name: "Sparks" }, { key: "debris", name: "Debris" },
  { key: "dust", name: "Dust" }, { key: "blood", name: "Blood" }, { key: "lightning", name: "Lightning" },
  { key: "water", name: "Water" }, { key: "magic", name: "Magic" }, { key: "lightleak", name: "Light leaks" },
  { key: "other", name: "Other" },
];
const fxCatName = (key) => (FX_CATS.find((c) => c.key === key) || {}).name || key;


// ---- live previews

function fxRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Each kind: how often to make particles (rate per frame, or a burst every `every` frames), how they move and look.
// Positions are 0..1 of the width/height; sizes are parts of the height.
const FX_KINDS = {
  fire: { add: true, rate: 3, make: (r) => ({ x: .5 + (r() - .5) * .22, y: .92, vx: (r() - .5) * .002, vy: -.006 - r() * .006, s: .07 + r() * .07, life: 50 + r() * 30 }),
    move: (p, r) => { p.vx += (r() - .5) * .0006; p.s *= .985; }, color: (k) => k < .25 ? [255, 240, 190] : k < .6 ? [255, 140, 30] : [200, 40, 10] },
  smoke: { rate: .7, make: (r) => ({ x: .5 + (r() - .5) * .25, y: .95, vx: (r() - .5) * .0015, vy: -.002 - r() * .002, s: .08 + r() * .05, life: 160 + r() * 60 }),
    move: (p) => { p.s *= 1.006; }, color: () => [150, 150, 150], alpha: .22 },
  explosion: { add: true, every: 64, burst: 80, alpha: .32, warm: 14, make: (r) => { const a = r() * Math.PI * 2, v = .004 + r() * .012; return { x: .5, y: .62, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .8 - .003, s: .06 + r() * .08, life: 45 + r() * 30 }; },
    move: (p) => { p.vx *= .95; p.vy = p.vy * .95 - .0002; p.s *= 1.01; }, color: (k) => k < .12 ? [255, 240, 200] : k < .4 ? [255, 130, 30] : [200, 45, 10], flash: true },
  sparks: { add: true, rate: 4, line: true, make: (r) => ({ x: .3, y: .75, vx: .004 + r() * .01, vy: -.012 - r() * .01, s: .006, life: 40 + r() * 30 }),
    move: (p) => { p.vy += .0006; }, color: (k) => k < .5 ? [255, 245, 200] : [255, 150, 40] },
  muzzle: { add: true, every: 32, burst: 26, warm: 4, make: (r) => { const a = (r() - .5) * .5; const v = .01 + r() * .03; return { x: .18, y: .5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: .05 + r() * .06, life: 5 + r() * 5 }; },
    move: () => {}, color: (k) => k < .5 ? [255, 250, 225] : [255, 170, 60], flash: true },
  debris: { every: 80, burst: 40, chunk: true, warm: 24, make: (r) => { const a = -Math.PI / 2 + (r() - .5) * 1.6, v = .008 + r() * .014; return { x: .5, y: .85, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: .02 + r() * .03, life: 70 + r() * 30, rot: r() * 6 }; },
    move: (p) => { p.vy += .0005; p.rot += .15; }, color: () => [165, 150, 135] },
  dust: { every: 90, burst: 50, make: (r) => { const side = r() < .5 ? -1 : 1; return { x: .5 + side * r() * .05, y: .9, vx: side * (.002 + r() * .008), vy: -r() * .003, s: .05 + r() * .06, life: 90 + r() * 50 }; },
    move: (p) => { p.vx *= .97; p.vy *= .97; p.s *= 1.012; }, color: () => [190, 160, 120], alpha: .25 },
  blood: { every: 70, burst: 46, make: (r) => { const a = -.4 + (r() - .5) * 1.2, v = .006 + r() * .016; return { x: .35, y: .5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: .008 + r() * .02, life: 60 + r() * 30 }; },
    move: (p) => { p.vy += .0005; p.vx *= .985; }, color: () => [150, 10, 15], alpha: .95 },
  water: { add: true, every: 75, burst: 60, make: (r) => { const a = -Math.PI / 2 + (r() - .5) * 1.4, v = .008 + r() * .016; return { x: .5, y: .85, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: .008 + r() * .016, life: 60 + r() * 30 }; },
    move: (p) => { p.vy += .0007; }, color: () => [120, 190, 255] },
  magic: { add: true, rate: 3, make: (r) => ({ a: r() * Math.PI * 2, d: .05 + r() * .05, x: .5, y: .5, vx: 0, vy: 0, s: .015 + r() * .03, life: 70 + r() * 40, hue: r() }),
    move: (p) => { p.a += .07; p.d += .0025; p.x = .5 + Math.cos(p.a) * p.d * .6; p.y = .5 + Math.sin(p.a) * p.d; }, color: (k, p) => p.hue < .5 ? [170, 90, 255] : [80, 220, 255] },
  lightning: { bolt: true }, lightleak: { leak: true },
};

function fxArt(canvas, kind, seed) {
  const def = FX_KINDS[kind] || FX_KINDS.fire;
  const ctx = canvas.getContext("2d");
  const art = { canvas, running: false, frame: 0, parts: [], r: fxRandom(seed), bolt: null, flash: 0 };
  art.size = () => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  };
  art.step = () => {
    const r = art.r;
    art.frame++;
    if (def.rate) for (let n = def.rate + (r() < def.rate % 1 ? 1 : 0); n >= 1; n--) art.parts.push(Object.assign(def.make(r), { age: 0 }));
    if (def.every && art.frame % def.every === 1) { for (let n = 0; n < def.burst; n++) art.parts.push(Object.assign(def.make(r), { age: 0 })); if (def.flash) art.flash = 1; }
    for (const p of art.parts) { p.x += p.vx; p.y += p.vy; p.age++; def.move(p, r); }
    art.parts = art.parts.filter((p) => p.age < p.life);
    art.flash *= .8;
    if (def.bolt) {
      if (!art.bolt || art.frame % 60 === 0 || (art.frame % 60 === 8 && r() < .6)) art.bolt = fxBolt(r);
      art.boltAge = art.frame % 60;
    }
  };
  art.draw = () => {
    art.size();
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#070707"; ctx.fillRect(0, 0, W, H);
    if (def.leak) return fxDrawLeak(ctx, W, H, art.frame, seed);
    if (def.bolt) return fxDrawBolt(ctx, W, H, art.bolt, art.boltAge);
    if (art.flash > .02) {
      const g = ctx.createRadialGradient(W * (kind === "muzzle" ? .18 : .5), H * .55, 0, W * .5, H * .55, W * .7);
      g.addColorStop(0, `rgba(255,190,110,${.35 * art.flash})`); g.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = def.add ? "lighter" : "source-over";
    for (const p of art.parts) {
      const k = p.age / p.life, [cr, cg, cb] = def.color(k, p), a = (def.alpha || .5) * Math.sin(Math.PI * Math.min(1, k * 1.2 + .05));
      const x = p.x * W, y = p.y * H, s = Math.max(.5, p.s * H);
      if (def.line) {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a * 1.6})`; ctx.lineWidth = Math.max(1, H * .006); ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x - p.vx * W * 2.5, y - p.vy * H * 2.5); ctx.stroke();
      } else if (def.chunk) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, a * 2)})`;
        ctx.fillRect(-s / 2, -s / 3, s, s * .66); ctx.restore();
      } else {
        const g = ctx.createRadialGradient(x, y, 0, x, y, s);
        g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = g; ctx.fillRect(x - s, y - s, s * 2, s * 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };
  // Run a bit ahead so a still preview already shows the effect at its best.
  art.warm = () => { for (let i = 0; i < (def.warm || (def.every ? 18 : 90)); i++) art.step(); art.draw(); };
  return art;
}

function fxBolt(r) {
  const pts = [[.45 + r() * .1, 0]];
  while (pts[pts.length - 1][1] < 1) { const [x, y] = pts[pts.length - 1]; pts.push([x + (r() - .5) * .12, y + .05 + r() * .06]); }
  const branch = pts.slice(3 + Math.floor(r() * 4)).slice(0, 5).map(([x, y], i) => [x + (i + 1) * .035 * (r() < .5 ? -1 : 1), y + i * .03]);
  return { pts, branch };
}
function fxDrawBolt(ctx, W, H, bolt, age) {
  if (!bolt) return;
  const on = age < 14 && age % 6 < 4 ? 1 - age / 16 : 0;
  ctx.fillStyle = `rgba(120,150,255,${.12 * on})`; ctx.fillRect(0, 0, W, H);
  if (!on) return;
  ctx.globalCompositeOperation = "lighter"; ctx.lineJoin = "round";
  for (const [line, width] of [[bolt.pts, 1], [bolt.branch, .5]]) for (const [w, c] of [[14, "rgba(90,120,255,.25)"], [5, "rgba(170,190,255,.6)"], [1.6, "rgba(255,255,255,.95)"]]) {
    ctx.strokeStyle = c; ctx.globalAlpha = on; ctx.lineWidth = w * width * H / 200; ctx.beginPath();
    line.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H))); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}
function fxDrawLeak(ctx, W, H, t, seed) {
  ctx.globalCompositeOperation = "lighter";
  const blobs = [[255, 120, 30], [255, 60, 40], [255, 200, 90]];
  blobs.forEach(([r, g, b], i) => {
    const x = W * (.5 + .45 * Math.sin(t / (90 + i * 23) + seed + i * 2)), y = H * (.5 + .4 * Math.cos(t / (120 + i * 17) + i)), s = W * (.45 + .1 * i);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, s);
    grad.addColorStop(0, `rgba(${r},${g},${b},.55)`); grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  });
  ctx.globalCompositeOperation = "source-over";
}

// One loop draws every preview that is playing (the big one at the top and whatever is hovered).
const fxPlaying = new Set();
let fxLoop = 0;
function fxPlay(art) {
  fxPlaying.add(art);
  if (!fxLoop) fxLoop = requestAnimationFrame(fxTick);
}
function fxStop(art) { fxPlaying.delete(art); }
function fxTick() {
  fxLoop = 0;
  if ($("fxTab").hidden || document.hidden) return;
  for (const art of fxPlaying) { if (!art.canvas.isConnected) { fxPlaying.delete(art); continue; } art.step(); art.draw(); }
  if (fxPlaying.size) fxLoop = requestAnimationFrame(fxTick);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && fxPlaying.size && !fxLoop) fxLoop = requestAnimationFrame(fxTick); });

// ---- the page

let fxData = null, fxCat = "", fxQuery = "", fxOpen = null, fxHeroArt = null, fxReady = false, fxLoading = false;
const fxEl = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const fxSvg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const FX_ICONS = {
  download: fxSvg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'), back: fxSvg('<path d="M15 5l-7 7 7 7"/>'),
  trash: fxSvg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'), pencil: fxSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  close: fxSvg('<path d="M6 6l12 12M18 6L6 18"/>'), film: fxSvg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17M8 5l-1.5 4M13 5l-1.5 4M18 5l-1.5 4"/>'),
};
const fxSize = (bytes) => { const b = +bytes || 0; if (b < 1024 ** 2) return Math.round(b / 1024) + " KB"; if (b < 1024 ** 3) return Math.round(b / 1024 ** 2) + " MB"; return (b / 1024 ** 3).toFixed(1) + " GB"; };
const fxNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n || 0));
const fxQuality = (w) => (!w ? "" : w >= 3800 ? "4K" : w >= 2500 ? "2.7K" : w >= 2000 ? "2K" : w >= 1900 ? "1080p" : w >= 1260 ? "720p" : w + "px");
const fxIsNew = (pack) => Date.now() / 1000 - pack.created < 7 * 86400;
const fxSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : (Math.round(s * 10) / 10) + "s");

function fxUrl(path) {
  const files = fxData && fxData.files;
  if (!path || !files) return "";
  return files.base + path.split("/").map(encodeURIComponent).join("/") + "?Authorization=" + encodeURIComponent(files.auth);
}

// A picture of a pack or clip; its preview video plays while the mouse is on hoverEl.
function fxThumb(thumb, preview, hoverEl, cat) {
  const box = fxEl("div", "fx-thumb");
  if (thumb && fxUrl(thumb)) {
    const img = fxEl("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = fxUrl(thumb);
    img.addEventListener("error", () => img.remove());
    box.append(img);
  } else {
    const none = fxEl("div", "fx-noart");
    none.innerHTML = FX_ICONS.film;
    if (cat) none.append(fxEl("span", "fx-cat-dot " + cat));
    box.append(none);
  }
  if (preview && fxUrl(preview)) {
    let video = null;
    hoverEl.addEventListener("mouseenter", () => {
      video = fxEl("video", "fx-video");
      Object.assign(video, { muted: true, loop: true, playsInline: true, src: fxUrl(preview) });
      video.addEventListener("playing", () => video && video.classList.add("on"));
      box.append(video);
      video.play().catch(() => {});
    });
    hoverEl.addEventListener("mouseleave", () => { if (video) { video.pause(); video.remove(); video = null; } });
  }
  return box;
}

function fxBadges(pack) {
  const b = fxEl("div", "fx-badges");
  const q = fxQuality(pack.width);
  if (q) b.append(fxEl("span", "fx-badge", q));
  if (fxIsNew(pack)) b.append(fxEl("span", "fx-badge new", "New"));
  return b;
}

async function loadFx() {
  if (fxLoading) return;
  fxLoading = true;
  const res = await api("/api/fx-list", {}).catch(() => ({ ok: false, error: "Couldn't load the packs." }));
  fxLoading = false;
  if (!res.ok) {
    if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return renderFxPage();
    $("fxStatus").textContent = res.error;
    $("fxStatus").hidden = false;
    return;
  }
  $("fxStatus").hidden = true;
  fxData = res;
  renderFxPage();
}

function renderFxPage() {
  const loggedIn = typeof sfxUser === "function" && !!sfxUser();
  const ready = loggedIn && fxData && fxData.ready;
  $("fxOut").hidden = loggedIn;
  $("fxSetup").hidden = !(loggedIn && fxData && !fxData.ready && fxData.canSetup);
  $("fxWait").hidden = !(loggedIn && fxData && !fxData.ready && !fxData.canSetup);
  $("fxBrowse").hidden = !ready;
  if (ready) renderFx();
  renderFxHero();
}

function renderFxHero() {
  const pack = fxData && fxData.ready && (typeof sfxUser !== "function" || sfxUser()) && fxData.packs[0];
  const video = $("fxHeroVideo");
  $("fxHeroButtons").hidden = !pack;
  if (pack) {
    $("fxHeroKicker").textContent = fxIsNew(pack) ? "New pack" : "Newest pack";
    $("fxHeroTitle").replaceChildren(document.createTextNode(pack.name), document.createElement("br"), fxEl("em", "", fxCatName(pack.category)));
    $("fxHeroAbout").textContent = pack.about || "Explosions, fire, smoke, sparks and more. Drop them right into Resolve or Premiere.";
    $("fxHeroMeta").textContent = `${pack.clips} ${pack.clips === 1 ? "clip" : "clips"} · ${fxSize(pack.size)}${pack.by ? " · by " + pack.by : ""}`;
    $("fxHeroOpen").onclick = () => openFxPack(pack.id);
  } else {
    $("fxHeroKicker").textContent = "Film assets";
    $("fxHeroTitle").replaceChildren(document.createTextNode("Film assets."), document.createElement("br"), fxEl("em", "", "Make it go boom."));
    $("fxHeroAbout").textContent = "Explosions, fire, smoke, sparks and more. Drop them right into Resolve or Premiere.";
  }
  const src = pack && pack.cover ? fxUrl(pack.cover.preview) : "";
  const poster = pack && pack.cover ? fxUrl(pack.cover.thumb) : "";
  if (src || poster) {
    if (video.dataset.src !== src + poster) {
      video.dataset.src = src + poster;
      video.poster = poster;
      if (src) video.src = src; else video.removeAttribute("src");
    }
    video.hidden = false;
    if (src && !$("fxTab").hidden) video.play().catch(() => {});
    fxStop(fxHeroArt);
    $("fxHeroArt").hidden = true;
  } else {
    video.hidden = true;
    video.pause();
    $("fxHeroArt").hidden = false;
    if (!$("fxTab").hidden && !fxOpen) fxPlay(fxHeroArt);
  }
}

function renderFxCats() {
  const packs = fxData.packs;
  const pill = (key, name, count) => {
    const b = fxEl("button", "fx-cat" + (fxCat === key ? " active" : ""));
    b.type = "button";
    if (key) b.append(fxEl("span", "fx-cat-dot " + key));
    b.append(fxEl("span", "", name), fxEl("small", "", String(count)));
    b.addEventListener("click", () => { fxCat = key; renderFx(); });
    return b;
  };
  const used = FX_CATS.filter((c) => packs.some((p) => p.category === c.key) || c.key === fxCat);
  $("fxCats").replaceChildren(pill("", "All", packs.length), ...used.map((c) => pill(c.key, c.name, packs.filter((p) => p.category === c.key).length)));
}

function fxCard(pack) {
  const card = fxEl("button", "fx-card");
  card.type = "button";
  const thumb = fxThumb(pack.cover && pack.cover.thumb, pack.cover && pack.cover.preview, card, pack.category);
  thumb.append(fxBadges(pack));
  if (pack.cover && pack.cover.preview) thumb.append(fxEl("span", "fx-play", "Hover to play"));
  const info = fxEl("div", "fx-info");
  info.append(fxEl("strong", "", pack.name), fxEl("span", "", `${fxCatName(pack.category)} · ${pack.clips} ${pack.clips === 1 ? "clip" : "clips"} · ${fxSize(pack.size)}`));
  const dl = fxEl("span", "fx-dl");
  dl.innerHTML = FX_ICONS.download;
  dl.append(fxNum(pack.downloads));
  dl.title = "Downloads";
  info.append(dl);
  card.append(thumb, info);
  card.addEventListener("click", () => openFxPack(pack.id));
  return card;
}

function renderFx() {
  renderFxCats();
  const sort = $("fxSort").value, q = fxQuery.trim().toLowerCase();
  let list = fxData.packs.filter((p) => (!fxCat || p.category === fxCat) && (!q || (p.name + " " + fxCatName(p.category) + " " + (p.about || "") + " " + (p.by || "")).toLowerCase().includes(q)));
  list = list.slice().sort(sort === "popular" ? (a, b) => b.downloads - a.downloads : sort === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.created - a.created);
  $("fxGrid").replaceChildren(...list.map(fxCard));
  $("fxGridTitle").textContent = fxCat ? fxCatName(fxCat) : q ? "Results" : "All packs";
  $("fxGridCount").textContent = list.length + (list.length === 1 ? " pack" : " packs");
  $("fxNew").hidden = !fxData.canAdd;
  $("fxUsed").textContent = fxData.canAdd && fxData.used != null ? `${fxSize(fxData.used)} of 10 GB free storage used` : "";
  $("fxEmpty").hidden = list.length > 0;
  $("fxEmpty").textContent = fxData.packs.length ? "Nothing found. Try another word." : fxData.canAdd ? "No packs yet. Click + New pack to add the first one." : "No packs yet. They'll show up here.";
}

// ---- one pack

async function openFxPack(packId, quiet) {
  const res = await api("/api/fx-pack", { pack: packId }).catch(() => ({ ok: false, error: "Couldn't open the pack." }));
  if (!res.ok) {
    if (typeof sfxLoggedOut === "function" && sfxLoggedOut(res)) return closeFxPack();
    if (!quiet) alert(res.error);
    return;
  }
  if (res.files && fxData) fxData.files = res.files;
  const wasOpen = fxOpen && fxOpen.pack.id === packId;
  fxOpen = res;
  fxStop(fxHeroArt);
  $("fxHeroVideo").pause();
  drawFxPack();
  $("fxPage").hidden = true;
  $("fxPack").hidden = false;
  if (!wasOpen) window.scrollTo(0, 0);
}

function drawFxPack() {
  const { pack, clips, canEdit } = fxOpen;
  const box = $("fxPack");
  const back = fxEl("button", "fx-back");
  back.type = "button";
  back.innerHTML = FX_ICONS.back;
  back.append("All packs");
  back.addEventListener("click", closeFxPack);

  const top = fxEl("div", "fx-pack-top");
  const big = fxEl("div", "fx-pack-art");
  const cover = pack.cover || {};
  if (cover.preview || cover.thumb) {
    const video = fxEl("video", "fx-art");
    Object.assign(video, { muted: true, loop: true, playsInline: true, autoplay: true, poster: fxUrl(cover.thumb) });
    if (cover.preview) video.src = fxUrl(cover.preview);
    big.append(video);
  } else {
    const none = fxEl("div", "fx-noart");
    none.innerHTML = FX_ICONS.film;
    big.append(none);
  }
  big.append(fxBadges(pack));
  const side = fxEl("div", "fx-pack-side");
  side.append(fxEl("span", "fx-kicker", fxCatName(pack.category)), fxEl("h1", "", pack.name),
    fxEl("p", "", pack.about || "Put a clip on top of your video and set it to \"Screen\" or \"Add\" in your editor, so the black goes away."));
  const facts = fxEl("div", "fx-facts");
  for (const [k, v] of [["Clips", pack.clips], ["Size", fxSize(pack.size)], ["Quality", fxQuality(pack.width) || "-"], ["Downloads", fxNum(pack.downloads)], ["Shared by", pack.by || "-"]]) {
    const f = fxEl("div");
    f.append(fxEl("small", "", k), fxEl("strong", "", String(v)));
    facts.append(f);
  }
  const buttons = fxEl("div", "fx-pack-buttons");
  const get = fxEl("button", "convert small-button", clips.length ? "Download pack" : "No clips yet");
  get.type = "button";
  get.disabled = !clips.length;
  get.addEventListener("click", () => fxDownload(pack.id));
  buttons.append(get);
  if (canEdit) {
    const edit = fxEl("button", "ghost-button");
    edit.type = "button";
    edit.innerHTML = FX_ICONS.pencil;
    edit.append("Edit");
    edit.addEventListener("click", () => openFxPackModal(pack));
    const del = fxEl("button", "ghost-button fx-danger");
    del.type = "button";
    del.innerHTML = FX_ICONS.trash;
    del.append("Delete");
    del.addEventListener("click", () => deleteFxPack(pack));
    buttons.append(edit, del);
  }
  side.append(facts, buttons);
  top.append(big, side);

  const parts = [back, top];
  if (canEdit) parts.push(fxDropzone(pack.id));
  const head = fxEl("div", "fx-grid-head");
  head.append(fxEl("h2", "", "In this pack"), fxEl("span", "", `${clips.length} ${clips.length === 1 ? "clip" : "clips"}`));
  const list = fxEl("div", "fx-clips");
  for (const clip of clips) list.append(fxClip(pack, clip, canEdit));
  if (!clips.length) list.append(fxEl("p", "fx-empty", canEdit ? "No clips yet. Add them above." : "No clips yet."));
  parts.push(head, list);
  box.replaceChildren(...parts);
}

function fxClip(pack, clip, canEdit) {
  const tile = fxEl("div", "fx-clip");
  const thumb = fxThumb(clip.thumb, clip.preview, tile, pack.category);
  const tools = fxEl("div", "fx-clip-tools");
  const dl = fxEl("button", "fx-icon");
  dl.type = "button";
  dl.title = "Download this clip";
  dl.innerHTML = FX_ICONS.download;
  dl.addEventListener("click", () => fxDownload(pack.id, clip.id));
  tools.append(dl);
  if (canEdit) {
    const del = fxEl("button", "fx-icon");
    del.type = "button";
    del.title = "Delete this clip";
    del.innerHTML = FX_ICONS.trash;
    del.addEventListener("click", async () => {
      if (!confirm(`Delete "${clip.name}"?`)) return;
      const res = await api("/api/fx-delete-clip", { pack: pack.id, clip: clip.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
      if (!res.ok) return alert(res.error);
      openFxPack(pack.id, true);
      loadFx();
    });
    tools.append(del);
  }
  thumb.append(tools);
  const meta = [clip.seconds ? fxSecs(clip.seconds) : "", fxQuality(clip.width), fxSize(clip.size)].filter(Boolean).join(" · ");
  tile.append(thumb, fxEl("strong", "", clip.name), fxEl("span", "", meta));
  return tile;
}

function closeFxPack() {
  fxOpen = null;
  $("fxPack").hidden = true;
  $("fxPack").querySelectorAll("video").forEach((v) => v.pause());
  $("fxPage").hidden = false;
  renderFxHero();
}

// ---- adding clips (owner and admins)

function fxDropzone(packId) {
  const zone = fxEl("label", "dropzone fx-drop");
  const input = fxEl("input");
  Object.assign(input, { type: "file", multiple: true, hidden: true, accept: "video/*,image/*,.mov,.mxf,.exr,.zip" });
  zone.innerHTML = FX_ICONS.film;
  const text = fxEl("span", "drop-text");
  text.innerHTML = "<strong>Drop clips here</strong> or <span class=\"link\">choose files</span>";
  zone.append(input, text, fxEl("span", "drop-hint", "Videos with a black or see-through background work best. Big files are fine."));
  zone.addEventListener("click", async (e) => {
    e.preventDefault();
    const res = await api("/api/fx-pick", { pack: packId }).catch(() => ({ ok: false, fallback: true }));
    if (res.fallback) input.click();
    else if (!res.ok) alert(res.error);
    else if (res.added) fxPollJobs();
  });
  input.addEventListener("change", () => { fxSendFiles(packId, [...input.files]); input.value = ""; });
  return zone;
}

// A file dropped anywhere on an open pack you can add to (see the window's drop in images.js).
function fxTakesDrop(files) {
  if ($("fxTab").hidden || !fxOpen || !fxOpen.canEdit || $("fxPack").hidden) return false;
  fxSendFiles(fxOpen.pack.id, files);
  return true;
}

async function fxSendFiles(packId, files) {
  fxShowJobs();
  for (const file of files) {
    const res = await fetch("/api/fx-add", { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name), "X-Pack": packId }, body: file })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't open " + file.name }));
    if (!res.ok) alert(res.error);
    fxPollJobs();
  }
}

// ---- uploads and downloads in the corner

let fxJobs = { uploads: [], downloads: [] }, fxJobsTimer = 0, fxDoneUploads = 0;
function fxShowJobs() { $("fxJobs").hidden = false; }

async function fxPollJobs() {
  clearTimeout(fxJobsTimer);
  const res = await api("/api/fx-jobs", {}).catch(() => null);
  if (res && res.ok) {
    fxJobs = res;
    drawFxJobs();
    const done = res.uploads.filter((u) => u.status === "done").length;
    if (done !== fxDoneUploads) {
      fxDoneUploads = done;
      if (fxOpen) openFxPack(fxOpen.pack.id, true);
      loadFx();
    }
  }
  const busy = [...fxJobs.uploads, ...fxJobs.downloads].some((j) => j.status === "waiting" || j.status === "working");
  if (busy) fxJobsTimer = setTimeout(fxPollJobs, 700);
}

function drawFxJobs() {
  const all = [...fxJobs.uploads.map((j) => ({ ...j, up: true })), ...fxJobs.downloads];
  const box = $("fxJobs");
  box.hidden = !all.length;
  if (!all.length) return box.replaceChildren();
  const head = fxEl("div", "fx-jobs-head");
  head.append(fxEl("strong", "", "Uploads and downloads"));
  const clear = fxEl("button", "link", "Clear");
  clear.type = "button";
  clear.addEventListener("click", async () => { const res = await api("/api/fx-clear", {}); if (res.ok) { fxJobs = res; drawFxJobs(); } });
  head.append(clear);
  const rows = all.map((j) => {
    const row = fxEl("div", "fx-job " + j.status);
    const pct = j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
    const label = j.status === "done" ? (j.up ? "Uploaded" : "Downloaded") : j.status === "error" ? j.message
      : j.status === "waiting" ? "Waiting..." : j.step === "Making the preview" ? "Making the preview..." : `${j.up ? "Uploading" : "Downloading"} ${pct}% · ${fxSize(j.done)} of ${fxSize(j.total)}`;
    const text = fxEl("div", "fx-job-text");
    text.append(fxEl("b", "", (j.up ? "↑ " : "↓ ") + j.name), fxEl("small", "", label));
    const bar = fxEl("div", "fx-job-bar");
    const fill = fxEl("i");
    fill.style.width = (j.status === "done" ? 100 : pct) + "%";
    bar.append(fill);
    row.append(text);
    if (j.status === "working" || j.status === "waiting") {
      const stop = fxEl("button", "fx-icon");
      stop.type = "button";
      stop.title = "Stop";
      stop.innerHTML = FX_ICONS.close;
      stop.addEventListener("click", async () => { await api("/api/fx-cancel", { id: j.id }); fxPollJobs(); });
      row.append(stop);
    } else if (j.status === "done" && !j.up && j.path) {
      const show = fxEl("button", "link", "Show");
      show.type = "button";
      show.addEventListener("click", () => api("/api/fx-show", { path: j.path }));
      row.append(show);
    }
    row.append(bar);
    return row;
  });
  box.replaceChildren(head, ...rows);
}

async function fxDownload(packId, clipId) {
  const folder = await whereToSave();
  if (!folder) return;
  const res = await api("/api/fx-download", { pack: packId, clip: clipId || "", folder }).catch(() => ({ ok: false, error: "Couldn't start the download." }));
  if (!res.ok) return alert(res.error);
  fxShowJobs();
  fxPollJobs();
}

// ---- making and editing packs

let fxEditing = null;
function openFxPackModal(pack) {
  fxEditing = pack || null;
  $("fxPackHeading").textContent = pack ? "Edit pack" : "New pack";
  $("fxPackSave").textContent = pack ? "Save" : "Make the pack";
  $("fxPackName").value = pack ? pack.name : "";
  $("fxPackCat").replaceChildren(...FX_CATS.map((c) => { const o = fxEl("option", "", c.name); o.value = c.key; return o; }));
  $("fxPackCat").value = pack ? pack.category : fxCat || "explosion";
  $("fxPackAbout").value = pack ? pack.about || "" : "";
  $("fxPackNote").textContent = "";
  $("fxPackModal").hidden = false;
  $("fxPackName").focus();
}
const closeFxPackModal = () => { $("fxPackModal").hidden = true; };

$("fxPackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { name: $("fxPackName").value, category: $("fxPackCat").value, about: $("fxPackAbout").value };
  if (fxEditing) body.pack = fxEditing.id;
  $("fxPackSave").disabled = true;
  const res = await api(fxEditing ? "/api/fx-edit-pack" : "/api/fx-new-pack", body).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  $("fxPackSave").disabled = false;
  if (!res.ok) { $("fxPackNote").textContent = res.error; return; }
  closeFxPackModal();
  await loadFx();
  openFxPack(res.pack.id);
});
$("fxPackCancel").addEventListener("click", closeFxPackModal);
$("fxPackModal").addEventListener("click", (e) => { if (e.target === $("fxPackModal")) closeFxPackModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("fxPackModal").hidden) closeFxPackModal(); });

async function deleteFxPack(pack) {
  if (!confirm(`Delete the pack "${pack.name}" and all its clips? This can't be undone.`)) return;
  const res = await api("/api/fx-delete-pack", { pack: pack.id }).catch(() => ({ ok: false, error: "Couldn't delete it." }));
  if (!res.ok) return alert(res.error);
  closeFxPack();
  loadFx();
}

// ---- the owner sets up the storage

$("fxSetupGo").addEventListener("click", async () => {
  const keyId = $("fxKeyId").value.trim(), key = $("fxKey").value.trim();
  if (!keyId || !key) { $("fxSetupNote").textContent = "Paste both the keyID and the applicationKey."; return; }
  $("fxSetupGo").disabled = true;
  $("fxSetupNote").textContent = "Setting it up...";
  const res = await api("/api/fx-setup", { keyId, key }).catch(() => ({ ok: false, error: "That didn't work. Try again." }));
  $("fxSetupGo").disabled = false;
  if (!res.ok) { $("fxSetupNote").textContent = res.error; return; }
  $("fxKeyId").value = $("fxKey").value = "";
  fxData = res;
  renderFxPage();
});
$("fxB2Site").addEventListener("click", () => api("/api/docs-open-link", { url: "https://www.backblaze.com/sign-up/cloud-storage" }));
$("fxLogin").addEventListener("click", () => openLogin("login"));
$("fxNew").addEventListener("click", () => openFxPackModal(null));
$("fxSearch").addEventListener("input", (e) => { fxQuery = e.target.value; renderFx(); });
$("fxSort").addEventListener("change", renderFx);

// ---- opening the tab

let fxUserId = null;
function fxAccountChanged() {
  const id = typeof sfxUser === "function" && sfxUser() ? sfxUser().id : null;
  if (id === fxUserId) return;
  fxUserId = id;
  fxData = null;
  if (fxOpen) closeFxPack();
  if (!$("fxTab").hidden) fxTabChanged("fx");
}

async function fxTabChanged(tab) {
  if (tab !== "fx") {
    fxPlaying.clear();
    $("fxHeroVideo").pause();
    $("fxPack").querySelectorAll("video").forEach((v) => v.pause());
    return;
  }
  if (!fxReady) {
    fxReady = true;
    fxHeroArt = fxArt($("fxHeroArt"), "explosion", 13);
    requestAnimationFrame(() => fxHeroArt.warm());
  }
  renderFxPage();
  if (fxOpen) $("fxPack").querySelectorAll("video[autoplay]").forEach((v) => v.play().catch(() => {}));
  if (typeof sfxAccount !== "undefined" && (!sfxAccount || sfxFromCache)) await loadAccount();
  renderFxPage();
  if (typeof sfxUser === "function" && sfxUser()) {
    await loadFx();
    fxPollJobs();
  }
}
if (!$("fxTab").hidden) fxTabChanged("fx");
