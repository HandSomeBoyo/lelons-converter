// (3.4.0) The Voices page: type something, pick a voice, and it's read out (see tts.py).
// Everything runs on this PC. Uses $, api, setDrag, callToast and whereToSave from app.js.

const voIc = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const VO_I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  save: voIc('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  library: voIc('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  trash: voIc('<path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7"/>'),
  again: voIc('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/>'),
  wave: voIc('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>'),
};
const voEsc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const VO_SPEEDS = [["slow", "Slow", 0.85], ["normal", "Normal", 1], ["fast", "Fast", 1.2]];

const vo = {
  st: null, drawn: false, voice: loadPref("voVoice") || "heart", speed: loadPref("voSpeed") || "normal",
  text: loadPref("voText") || "", job: null, jobState: null, playing: null, audio: null, poll: 0,
};

function voicesTabChanged(tab) {
  if (tab !== "voices") { if (vo.audio) vo.audio.pause(); return; }
  voLoad();
}

async function voLoad() {
  const res = await api("/api/tts-state", {}).catch(() => null);
  if (!res || !res.ok) return;
  vo.st = res;
  voDraw();
  if (res.download.busy) voWatchDownload();
}

function voDraw() {
  const page = $("voicesTab");
  if (!vo.st) return;
  const head = `<h1 class="headline">Voices.<em> Type it, hear it.</em></h1>`;
  if (!vo.st.ready) {
    const d = vo.st.download;
    const pct = d.total ? Math.floor((d.got / d.total) * 100) : 0;
    page.innerHTML = `${head}
      <div class="vo-setup">
        <span class="vo-setup-ic">${VO_I.wave}</span>
        <div class="vo-setup-text">
          <b>Get the voices first</b>
          <p>A one-time download of about 120 MB. After that it all runs on your PC, free and offline.</p>
          ${d.busy ? `<div class="vo-bar"><i style="width:${pct}%"></i></div><small>${pct}%</small>` : ""}
          ${d.error ? `<p class="vo-error">${voEsc(d.error)}</p>` : ""}
        </div>
        <button type="button" class="small-button" id="voGet" ${d.busy ? "disabled" : ""}>${d.busy ? "Downloading..." : d.error ? "Try again" : "Download"}</button>
      </div>`;
    const btn = $("voGet");
    if (btn) btn.onclick = async () => { await api("/api/tts-get", {}); voLoad(); };
    vo.drawn = false;
    return;
  }
  if (!vo.drawn) {
    page.innerHTML = `${head}
      <div class="vo-box">
        <textarea id="voText" maxlength="${vo.st.maxChars}" placeholder="Type what you want said..." spellcheck="true"></textarea>
        <div class="vo-box-foot">
          <div class="vo-speed" id="voSpeed" role="radiogroup" aria-label="Speed">
            ${VO_SPEEDS.map(([id, name]) => `<button type="button" data-speed="${id}">${name}</button>`).join("")}
          </div>
          <span class="vo-count" id="voCount"></span>
          <button type="button" class="convert vo-go" id="voGo">${VO_I.play}<span>Read it out</span></button>
        </div>
        <div class="vo-progress" id="voProgress" hidden><i></i></div>
      </div>
      <div id="voClipsWrap" hidden>
        <h2 class="vo-h">Your clips</h2>
        <div class="vo-clips" id="voClips"></div>
      </div>
      <h2 class="vo-h">People</h2>
      <div class="vo-voices" id="voPeople"></div>
      <h2 class="vo-h">Characters</h2>
      <div class="vo-voices" id="voChars"></div>`;
    vo.drawn = true;
    const ta = $("voText");
    ta.value = vo.text;
    ta.addEventListener("input", () => {
      vo.text = ta.value; voDrawCount();
      clearTimeout(vo.saveT); vo.saveT = setTimeout(() => savePref("voText", vo.text.slice(0, 4000)), 700);
    });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); voGo(); } });
    $("voSpeed").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-speed]");
      if (!b) return;
      vo.speed = b.dataset.speed; savePref("voSpeed", vo.speed); voDrawSpeed();
    });
    $("voGo").onclick = voGo;
    const pick = (e) => {
      const b = e.target.closest("button[data-voice]");
      if (!b) return;
      vo.voice = b.dataset.voice; savePref("voVoice", vo.voice); voDrawVoices();
    };
    $("voPeople").addEventListener("click", pick);
    $("voChars").addEventListener("click", pick);
  }
  voDrawVoices();
  voDrawSpeed();
  voDrawCount();
  voDrawBusy();
  voDrawClips();
}

function voDrawVoices() {
  const all = [...vo.st.voices.people, ...vo.st.voices.characters];
  if (!all.some((v) => v.id === vo.voice)) vo.voice = all[0].id;
  const card = (v) => `<button type="button" class="vo-voice${v.id === vo.voice ? " on" : ""}" data-voice="${v.id}" aria-pressed="${v.id === vo.voice}">
      <b>${voEsc(v.name)}</b><small>${voEsc(v.about)}</small></button>`;
  $("voPeople").innerHTML = vo.st.voices.people.map(card).join("");
  $("voChars").innerHTML = vo.st.voices.characters.map(card).join("");
}

function voDrawSpeed() {
  $("voSpeed").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.speed === vo.speed);
    b.setAttribute("aria-checked", String(b.dataset.speed === vo.speed));
  });
}

function voDrawCount() {
  const n = vo.text.length, max = vo.st.maxChars;
  $("voCount").textContent = n > max * 0.8 ? `${n.toLocaleString()} / ${max.toLocaleString()}` : "";
}

function voDrawBusy() {
  const busy = !!vo.job;
  const go = $("voGo");
  if (!go) return;
  go.disabled = busy;
  go.querySelector("span").textContent = busy ? "Reading..." : "Read it out";
  const bar = $("voProgress");
  bar.hidden = !busy;
  const j = vo.jobState;
  bar.querySelector("i").style.width = busy && j ? `${Math.max(6, Math.round((j.done / Math.max(1, j.total)) * 100))}%` : "6%";
}

async function voGo() {
  if (vo.job) return;
  if (!vo.text.trim()) { $("voText").focus(); return callToast("Type something to read out."); }
  const speed = (VO_SPEEDS.find((s) => s[0] === vo.speed) || VO_SPEEDS[1])[2];
  const res = await api("/api/tts-make", { text: vo.text, voice: vo.voice, speed }).catch(() => ({ ok: false, error: "Couldn't reach VaultHub." }));
  if (!res.ok) return callToast(res.error);
  vo.job = res.job; vo.jobState = null;
  voDrawBusy();
  clearInterval(vo.poll);
  vo.poll = setInterval(voCheckJob, 400);
}

async function voCheckJob() {
  const res = await api("/api/tts-job", { job: vo.job }).catch(() => null);
  if (!res) return;
  vo.jobState = res;
  if (res.ok && res.status === "busy") return voDrawBusy();
  clearInterval(vo.poll);
  vo.job = null;
  voDrawBusy();
  if (!res.ok || res.status === "error") return callToast(res.error || "Couldn't read that out.");
  vo.st.clips = [res.clip, ...vo.st.clips.filter((c) => c.id !== res.clip.id)];
  voDrawClips();
  voPlay(res.clip.id);
}

function voDrawClips() {
  if (!$("voClips")) return;
  const clips = vo.st.clips || [];
  $("voClipsWrap").hidden = !clips.length;
  const list = $("voClips");
  list.innerHTML = clips.map((c) => `
    <div class="vo-clip" data-id="${c.id}" title="${voEsc(DRAG_HINT)}">
      <button type="button" class="vo-play" data-act="play" aria-label="Play">${vo.playing === c.id ? VO_I.pause : VO_I.play}</button>
      <div class="vo-clip-text"><b>${voEsc(c.text)}</b><small>${voEsc(c.voiceName)} · ${clock(c.seconds, false)}</small></div>
      <div class="vo-clip-acts">
        <button type="button" class="vo-act" data-act="save" title="Save as MP3">${VO_I.save}<span>Save</span></button>
        <button type="button" class="vo-act" data-act="library" title="Add to the Library">${VO_I.library}</button>
        <button type="button" class="vo-act" data-act="remove" title="Remove">${VO_I.trash}</button>
      </div>
    </div>`).join("");
  list.querySelectorAll(".vo-clip").forEach((el) => setDrag(el, { kind: "tts", id: el.dataset.id, name: voClip(el.dataset.id).name + ".mp3" }));
  list.onclick = (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.closest(".vo-clip").dataset.id;
    ({ play: voPlay, save: voSave, library: voToLibrary, remove: voRemove })[b.dataset.act](id);
  };
}

const voClip = (id) => (vo.st.clips || []).find((c) => c.id === id);

function voPlay(id) {
  const clip = voClip(id);
  if (!clip) return;
  if (vo.playing === id && vo.audio) {
    vo.audio.pause(); vo.playing = null; return voDrawClips();
  }
  if (vo.audio) vo.audio.pause();
  vo.audio = new Audio("/media/" + clip.media);
  vo.audio.onended = () => { vo.playing = null; voDrawClips(); };
  vo.audio.play().catch(() => {});
  vo.playing = id;
  voDrawClips();
}

async function voSave(id) {
  const folder = await whereToSave();
  if (!folder) return;
  const res = await api("/api/tts-save", { id, folder }).catch(() => ({ ok: false, error: "Couldn't save it." }));
  if (!res.ok) return callToast(res.error);
  callToast("Saved as MP3.", "Show", () => api("/api/tts-show", { path: res.path }));
}

async function voToLibrary(id) {
  if (typeof sfxUser !== "function" || !sfxUser() || !sfxUser().canUpload) return callToast("Log in to add sounds to the Library.");
  const res = await api("/api/tts-library", { id }).catch(() => ({ ok: false, error: "Couldn't do that." }));
  if (!res.ok) return callToast(res.error);
  showTab("sfx");
  openSfxUpload();
  useSfxFile(res.file);
}

async function voRemove(id) {
  if (vo.playing === id && vo.audio) { vo.audio.pause(); vo.playing = null; }
  await api("/api/tts-remove", { id }).catch(() => {});
  vo.st.clips = vo.st.clips.filter((c) => c.id !== id);
  voDrawClips();
}

function voWatchDownload() {
  clearInterval(vo.dl);
  vo.dl = setInterval(async () => {
    const res = await api("/api/tts-state", {}).catch(() => null);
    if (!res || !res.ok) return;
    vo.st = res;
    if (!res.download.busy) clearInterval(vo.dl);
    if ($("voicesTab").hidden) return;
    voDraw();
  }, 600);
}

if (!$("voicesTab").hidden) voicesTabChanged("voices");
