// The Film assets tab: packs of VFX clips (explosions, fire, smoke, sparks...) like ActionVFX.
// First look only: the packs below are samples and their previews are drawn live on a canvas
// (fxArt), so the page can be tried before real clips are stored anywhere.
// Uses $ from app.js, showTab() from images.js, loadPref()/savePref() from theme.js.

const FX_CATS = [
  { key: "explosion", name: "Explosions" }, { key: "fire", name: "Fire" }, { key: "smoke", name: "Smoke" },
  { key: "muzzle", name: "Muzzle flashes" }, { key: "sparks", name: "Sparks" }, { key: "debris", name: "Debris" },
  { key: "dust", name: "Dust" }, { key: "blood", name: "Blood" }, { key: "lightning", name: "Lightning" },
  { key: "water", name: "Water" }, { key: "magic", name: "Magic" }, { key: "lightleak", name: "Light leaks" },
];
// Sample packs: [name, category, clips, size in GB, downloads, days since added]
const FX_PACKS = [
  ["Inferno", "fire", 24, 6.2, 1840, 1], ["Big Booms", "explosion", 32, 9.4, 3120, 2], ["Street Smoke", "smoke", 18, 4.1, 960, 3],
  ["Gunfire Essentials", "muzzle", 40, 1.2, 4410, 5], ["Grinder Sparks", "sparks", 22, 2.8, 1270, 6], ["Concrete Hits", "debris", 16, 3.6, 720, 8],
  ["Desert Dust", "dust", 20, 3.9, 640, 9], ["Splatter Kit", "blood", 26, 1.9, 1530, 11], ["Storm Strikes", "lightning", 14, 1.4, 880, 12],
  ["Splash Zone", "water", 28, 5.1, 1010, 14], ["Spell Book", "magic", 30, 2.4, 2260, 15], ["Golden Hour Leaks", "lightleak", 36, 7.8, 2980, 17],
  ["Car Explosions", "explosion", 12, 5.6, 2050, 20], ["Campfire & Embers", "fire", 18, 3.3, 1190, 22], ["Ground Smoke", "smoke", 15, 3.0, 540, 25],
  ["Welding Sparks", "sparks", 14, 1.6, 610, 28],
].map(([name, cat, clips, gb, downloads, days], i) => ({ id: "p" + i, name, cat, clips, gb, downloads, days, seed: i * 97 + 13 }));

const FX_CLIP_WORDS = {
  explosion: ["Ground Blast", "Air Burst", "Fireball", "Shockwave", "Big Boom"], fire: ["Flame Loop", "Fire Burst", "Torch", "Wall of Fire", "Embers"],
  smoke: ["Plume", "Drift", "Wisps", "Smoke Column", "Haze"], muzzle: ["Pistol Flash", "Rifle Flash", "Shotgun Blast", "Side Flash", "Burst Fire"],
  sparks: ["Shower", "Spray", "Sparkle Hit", "Spark Fall", "Cut Sparks"], debris: ["Rock Chunks", "Bullet Hit", "Wall Burst", "Gravel Spray", "Shards"],
  dust: ["Ground Puff", "Dust Wave", "Footstep Dust", "Landing Dust", "Dust Cloud"], blood: ["Hit Splat", "Spray", "Drip", "Side Splat", "Mist"],
  lightning: ["Strike", "Branching Bolt", "Arc", "Flicker", "Sky Bolt"], water: ["Splash", "Drop Hit", "Spray", "Wave Crash", "Puddle Jump"],
  magic: ["Portal", "Spell Cast", "Orb", "Swirl", "Shimmer"], lightleak: ["Warm Leak", "Flare Sweep", "Orange Glow", "Film Burn", "Soft Flash"],
};

const fxCatName = (key) => (FX_CATS.find((c) => c.key === key) || {}).name || key;
let fxCat = "", fxQuery = "", fxOpenPack = null, fxReady = false;

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

// A preview tile: still until the mouse is on it, then it plays.
function fxPreview(kind, seed, hoverEl) {
  const canvas = document.createElement("canvas");
  canvas.className = "fx-art";
  const art = fxArt(canvas, kind, seed);
  requestAnimationFrame(() => art.warm());
  (hoverEl || canvas).addEventListener("mouseenter", () => fxPlay(art));
  (hoverEl || canvas).addEventListener("mouseleave", () => fxStop(art));
  return canvas;
}

// ---- the page

const fxEl = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const fxGb = (gb) => (gb < 1 ? Math.round(gb * 1000) + " MB" : gb.toFixed(1) + " GB");
const fxNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));
const fxBadges = (pack) => { const b = fxEl("div", "fx-badges"); for (const t of ["4K", "Alpha"]) b.append(fxEl("span", "fx-badge", t)); if (pack.days <= 7) b.append(fxEl("span", "fx-badge new", "New")); return b; };

function renderFxCats() {
  const box = $("fxCats");
  const pill = (key, name, count) => {
    const b = fxEl("button", "fx-cat" + (fxCat === key ? " active" : ""));
    b.type = "button";
    if (key) { const dot = fxEl("span", "fx-cat-dot " + key); b.append(dot); }
    b.append(fxEl("span", "", name), fxEl("small", "", String(count)));
    b.addEventListener("click", () => { fxCat = key; renderFx(); });
    return b;
  };
  box.replaceChildren(pill("", "All", FX_PACKS.length), ...FX_CATS.map((c) => pill(c.key, c.name, FX_PACKS.filter((p) => p.cat === c.key).length)));
}

function fxCard(pack) {
  const card = fxEl("button", "fx-card");
  card.type = "button";
  const thumb = fxEl("div", "fx-thumb");
  thumb.append(fxPreview(pack.cat, pack.seed, card), fxBadges(pack), fxEl("span", "fx-play", "Hover to play"));
  const info = fxEl("div", "fx-info");
  info.append(fxEl("strong", "", pack.name), fxEl("span", "", `${fxCatName(pack.cat)} · ${pack.clips} clips · ${fxGb(pack.gb)}`));
  const dl = fxEl("span", "fx-dl");
  dl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  dl.append(fxNum(pack.downloads));
  info.append(dl);
  card.append(thumb, info);
  card.addEventListener("click", () => openFxPack(pack));
  return card;
}

function renderFx() {
  renderFxCats();
  const sort = $("fxSort").value, q = fxQuery.trim().toLowerCase();
  let list = FX_PACKS.filter((p) => (!fxCat || p.cat === fxCat) && (!q || (p.name + " " + fxCatName(p.cat)).toLowerCase().includes(q)));
  list = list.slice().sort(sort === "popular" ? (a, b) => b.downloads - a.downloads : sort === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => a.days - b.days);
  for (const art of fxPlaying) if (art !== fxHeroArt) fxPlaying.delete(art);
  $("fxGrid").replaceChildren(...list.map(fxCard));
  $("fxGridTitle").textContent = fxCat ? fxCatName(fxCat) : q ? "Results" : "All packs";
  $("fxGridCount").textContent = list.length + (list.length === 1 ? " pack" : " packs");
  $("fxEmpty").hidden = list.length > 0;
}

function openFxPack(pack) {
  fxOpenPack = pack;
  fxPlaying.clear();
  const box = $("fxPack");
  const back = fxEl("button", "fx-back");
  back.type = "button";
  back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  back.append("All packs");
  back.addEventListener("click", closeFxPack);

  const top = fxEl("div", "fx-pack-top");
  const big = fxEl("div", "fx-pack-art");
  const canvas = document.createElement("canvas");
  canvas.className = "fx-art";
  big.append(canvas, fxBadges(pack));
  const side = fxEl("div", "fx-pack-side");
  side.append(fxEl("span", "fx-kicker", fxCatName(pack.cat)), fxEl("h1", "", pack.name),
    fxEl("p", "", `${pack.clips} clips shot on black, ready to drop on top of your video. Set the clip to "Screen" or "Add" in your editor, or use the alpha version.`));
  const facts = fxEl("div", "fx-facts");
  for (const [k, v] of [["Clips", pack.clips], ["Size", fxGb(pack.gb)], ["Quality", "4K, 60 fps"], ["Format", "MOV + alpha"], ["Downloads", fxNum(pack.downloads)]]) {
    const f = fxEl("div"); f.append(fxEl("small", "", k), fxEl("strong", "", String(v))); facts.append(f);
  }
  const buttons = fxEl("div", "fx-pack-buttons");
  const get = fxEl("button", "convert small-button", "Download pack");
  get.type = "button";
  get.addEventListener("click", () => fxSoon(get));
  buttons.append(get);
  side.append(facts, buttons);
  top.append(big, side);

  const r = fxRandom(pack.seed), words = FX_CLIP_WORDS[pack.cat] || ["Clip"];
  const clips = fxEl("div", "fx-clips");
  for (let i = 0; i < Math.min(pack.clips, 12); i++) {
    const tile = fxEl("div", "fx-clip");
    const thumb = fxEl("div", "fx-thumb");
    thumb.append(fxPreview(pack.cat, pack.seed + i * 31 + 1, tile));
    const secs = (2 + r() * 6).toFixed(1);
    tile.append(thumb, fxEl("strong", "", `${words[i % words.length]} ${String(Math.floor(i / words.length) + 1).padStart(2, "0")}`), fxEl("span", "", `${secs}s · 4K`));
    clips.append(tile);
  }
  const head = fxEl("div", "fx-grid-head");
  head.append(fxEl("h2", "", "In this pack"), fxEl("span", "", pack.clips > 12 ? `12 of ${pack.clips} shown` : `${pack.clips} clips`));
  box.replaceChildren(back, top, head, clips);
  $("fxPage").hidden = true;
  box.hidden = false;
  window.scrollTo(0, 0);
  const art = fxArt(canvas, pack.cat, pack.seed);
  requestAnimationFrame(() => { art.warm(); fxPlay(art); });
}

function closeFxPack() {
  fxOpenPack = null;
  fxPlaying.clear();
  $("fxPack").hidden = true;
  $("fxPage").hidden = false;
  if (fxHeroArt) fxPlay(fxHeroArt);
}

function fxSoon(button) {
  const old = button.textContent;
  button.textContent = "Coming soon";
  button.disabled = true;
  setTimeout(() => { button.textContent = old; button.disabled = false; }, 1600);
}

let fxHeroArt = null;
function fxTabChanged(tab) {
  if (tab !== "fx") { fxPlaying.clear(); return; }
  if (!fxReady) {
    fxReady = true;
    const hero = FX_PACKS[1];
    fxHeroArt = fxArt($("fxHeroArt"), hero.cat, hero.seed);
    $("fxHeroMeta").textContent = `${hero.name} · ${hero.clips} clips · 4K with alpha`;
    $("fxHeroOpen").addEventListener("click", () => openFxPack(hero));
    $("fxSearch").addEventListener("input", (e) => { fxQuery = e.target.value; renderFx(); });
    $("fxSort").addEventListener("change", renderFx);
    renderFx();
    requestAnimationFrame(() => fxHeroArt.warm());
  }
  if (!fxOpenPack) fxPlay(fxHeroArt);
  else openFxPack(fxOpenPack);
}
if (!$("fxTab").hidden) fxTabChanged("fx");
