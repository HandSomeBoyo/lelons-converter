// (3.2) The Input overlay page: your keys, mouse or controller on your stream. OBS shows it through a Browser
// Source (inputoverlay.py reads the keys, streamoverlay.py serves the page; "Add to OBS" puts it in every scene).
// Uses $, api(), lvEsc, lvToast.

const LVI_STYLES = [
  ["caps", "Keycaps", "3D keys"], ["glass", "Glass", "See-through keys"], ["line", "Outline", "Just thin lines"],
  ["pad", "Controller", "Xbox or PlayStation"], ["pops", "Key pops", "Shows what you press"]];
const LVI_COLORS = ["auto", "#ffcf3f", "#ffffff", "#ff7ab8", "#5ee38f", "#5cc8ff"];
const LVI_CORNERS = [["bl", "Bottom left"], ["br", "Bottom right"], ["tl", "Top left"], ["tr", "Top right"]];
const LVIS = { st: null, busy: false, obsMsg: "", added: false, fitter: null };

async function lvisLoad() {
  const res = await api("/api/live-in", {}).catch(() => null);
  if (res && res.ok) LVIS.st = res.input;
  return LVIS.st;
}
async function lviSet(change) {
  const res = await api("/api/live-in-set", change).catch(() => null);
  if (res && res.ok) LVIS.st = res.input;
  else lvToast({ emoji: "⚠️", title: "Couldn't save that", text: (res && res.error) || "" });
}

function lvDrawInput() {
  const box = $("lvInput");
  if (!box) return;
  if (!LVIS.st) {
    box.innerHTML = `<p class="lv-muted">Loading...</p>`;
    lvisLoad().then(() => { if (LVIS.st) lvDrawInput(); });
    return;
  }
  const st = LVIS.st, p = st.prefs;
  const frame = $("lviFrame");
  const keepFrame = frame && frame.dataset.url === st.url;  // (moving it reloads it, which is quick)
  const tiles = LVI_STYLES.map(([k, name, sub]) => `
    <button type="button" class="lvi-st ${p.style === k ? "on" : ""}" data-s="${k}">
      <span class="art"><img src="inputstyles/${k}.png" alt=""></span>
      <span class="t"><span class="w"><b>${name}</b><small>${sub}</small></span>${p.style === k ? `<span class="tick">✓</span>` : ""}</span>
    </button>`).join("");
  box.innerHTML = `
    <div class="lv-grid">
      <div class="lv-col">
        <div class="lv-card">
          <h3>Preview<span class="sp"></span><span class="lv-muted" style="font-weight:500">only you see this</span></h3>
          <div class="lva-stage lvi-stage" id="lviStage"></div>
          <p class="lvi-hint"><i></i>${st.windows ? "Press some keys to try it. It lights up as you press." : "Shows a pretend game here. Your own keys show on Windows."}</p>
        </div>
        <div class="lv-card">
          <h3>Style</h3>
          <div class="lvi-styles">${tiles}</div>
        </div>
      </div>
      <div class="lv-col">
        <div class="lv-card">
          <h3>In OBS<span class="sp"></span>${st.watching ? `<span class="lva-ok">Showing</span>` : ""}</h3>
          ${st.watching || LVIS.added ? `<p class="lv-muted">${st.watching ? "OBS shows the overlay." : "Added to OBS."} Move or resize the <b>VaultHub input overlay</b> source in OBS if you like.</p>`
            : `<p class="lv-muted">One click puts the overlay in all your OBS scenes. OBS needs to be open.</p>
              <button type="button" class="small-button" id="lviAdd" ${LVIS.busy ? "disabled" : ""}>${LVIS.busy ? "Adding..." : "Add to OBS"}</button>`}
          ${LVIS.obsMsg ? `<p class="lva-msg">${lvEsc(LVIS.obsMsg)}</p>` : ""}
          <details class="lv-more-box"><summary>Add it yourself instead</summary>
            <ol class="lv-steps"><li>In OBS, press <b>+</b> under Sources and pick <b>Browser</b>.</li>
              <li>Paste this as the URL, with width <b>1920</b> and height <b>1080</b>:</li></ol>
            <div class="lv-row"><label class="input" style="flex:1"><input readonly value="${lvEsc(st.url)}" id="lviUrl"></label><button type="button" class="ghost-button" id="lviCopy">Copy</button></div>
          </details>
        </div>
        <div class="lv-card">
          <h3>Look</h3>
          <div class="lva-set"><span>Pressed color</span><span class="sp"></span><span class="lva-colors">${LVI_COLORS.map((c) => c === "auto"
            ? `<button type="button" class="lvi-auto ${p.color === c ? "on" : ""}" data-c="auto" title="The style's own color">Auto</button>`
            : `<button type="button" class="${p.color === c ? "on" : ""}" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join("")}</span></div>
          <div class="lva-set"><span>Size</span><span class="sp"></span><input type="range" class="volume-slider" id="lviSize" min="50" max="150" step="5" value="${p.size}"><b id="lviSizeN">${p.size}%</b></div>
          <div class="lva-set"><span>Corner</span><span class="sp"></span><select id="lviCorner" class="lvi-select">${LVI_CORNERS.map(([k, n]) => `<option value="${k}" ${p.corner === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
          ${p.style === "pad" ? `<div class="lva-set"><span>Buttons</span><span class="sp"></span><span class="lv-seg" id="lviPad"><button type="button" data-p="xbox" class="${p.pad === "xbox" ? "on" : ""}">Xbox</button><button type="button" data-p="ps" class="${p.pad === "ps" ? "on" : ""}">PlayStation</button></span></div>` : ""}
          ${["caps", "glass", "line"].includes(p.style) ? `<div class="lva-set"><span class="words"><b>Keys per second</b><small>A small counter above the keys</small></span><span class="sp"></span><label class="check"><input type="checkbox" id="lviKps" ${p.kps ? "checked" : ""}></label></div>` : ""}
          <div class="lva-set"><span class="words"><b>Fade out when idle</b><small>Hides after 5 seconds with no presses</small></span><span class="sp"></span><label class="check"><input type="checkbox" id="lviFade" ${p.fade ? "checked" : ""}></label></div>
        </div>
        ${p.style === "pad" ? `<div class="lv-card">
          <h3>Controller</h3>
          <div class="lvi-dev"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.9 4.4a2.4 2.4 0 0 1-4.1 1.1L13.6 15.5h-3.2l-2.3 2.4a2.4 2.4 0 0 1-4.1-1.1l-.9-4.4A4.5 4.5 0 0 1 7.5 7z"/><path d="M8 10v3M6.5 11.5h3"/></svg></span>
            <span class="w"><b>${st.pad ? "Controller connected" : "No controller found"}</b><small>${st.pad ? "Press a button to see it light up." : "Plug one in or turn it on. Xbox controllers work right away. PlayStation ones work through Steam or DS4Windows."}</small></span>
            ${st.pad ? `<span class="lva-ok">Ready</span>` : ""}</div>
        </div>` : ""}
        ${p.style === "pops" ? `<p class="lv-muted lvi-note">When you type fast, like a chat message or a password, Key pops shows “Typing...” instead of the letters.</p>` : ""}
      </div>
    </div>`;
  // The preview is the real 1920 x 1080 page, made small. Size, corner and fade reach it live, without a redraw.
  const stage = $("lviStage");
  if (keepFrame) stage.append(frame);
  else stage.innerHTML = `<iframe id="lviFrame" title="Input overlay preview" data-url="${lvEsc(st.url)}" src="${lvEsc(st.url)}?preview=1"></iframe>`;
  const fit = () => { if ($("lviFrame")) $("lviFrame").style.transform = `scale(${stage.clientWidth / 1920})`; };
  fit();
  if (LVIS.fitter) LVIS.fitter.disconnect();
  LVIS.fitter = new ResizeObserver(fit);
  LVIS.fitter.observe(stage);
  lviWire();
}

function lviWire() {
  const box = $("lvInput");
  box.querySelectorAll(".lvi-st").forEach((b) => { b.onclick = async () => { await lviSet({ style: b.dataset.s }); lvDrawInput(); }; });
  box.querySelectorAll(".lva-colors button").forEach((b) => { b.onclick = async () => { await lviSet({ color: b.dataset.c }); lvDrawInput(); }; });
  $("lviSize").oninput = (e) => { $("lviSizeN").textContent = e.target.value + "%"; };
  $("lviSize").onchange = (e) => lviSet({ size: +e.target.value });
  $("lviCorner").onchange = (e) => lviSet({ corner: e.target.value });
  $("lviFade").onchange = (e) => lviSet({ fade: e.target.checked });
  $("lviKps")?.addEventListener("change", (e) => lviSet({ kps: e.target.checked }));
  box.querySelectorAll("#lviPad button").forEach((b) => { b.onclick = async () => { await lviSet({ pad: b.dataset.p }); lvDrawInput(); }; });
  $("lviCopy").onclick = () => { navigator.clipboard.writeText($("lviUrl").value).catch(() => {}); $("lviCopy").textContent = "Copied"; };
  $("lviAdd")?.addEventListener("click", async () => {
    LVIS.busy = true; LVIS.obsMsg = ""; lvDrawInput();
    const res = await api("/api/live-in-obs", {}).catch(() => null);
    LVIS.busy = false;
    LVIS.added = !!(res && res.ok);
    LVIS.obsMsg = res && res.ok ? `Done! The overlay is in ${res.obs.scenes === 1 ? "your scene" : `all ${res.obs.scenes} scenes`}, in the corner you picked.` : (res && res.error) || "Couldn't reach OBS.";
    await lvisLoad();
    lvDrawInput();
  });
}

// Keep "Showing" and "Controller connected" fresh while the page is open
setInterval(async () => {
  if (!$("lvinputTab") || $("lvinputTab").hidden || !LVIS.st || LVIS.busy) return;
  const was = [LVIS.st.watching, LVIS.st.pad].join();
  await lvisLoad();
  if (LVIS.st && [LVIS.st.watching, LVIS.st.pad].join() !== was && !$("lvinputTab").hidden && !document.activeElement?.closest?.("#lvInput")) lvDrawInput();
}, 5000);
