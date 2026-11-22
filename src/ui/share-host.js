// (3.0.1) The hidden screen helper (share-host.html): takes the screen you picked (its engine was started
// to pick exactly that screen by itself) and sends it to the app's window, right here on this PC.

const SH_TOKEN = new URLSearchParams(location.search).get("t") || "";
const sh = { job: "", pc: null, stream: null };

function shPost(path, body) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Lelons-Token": SH_TOKEN }, body: JSON.stringify(body || {}) })
    .then((r) => r.json());
}

function shStop() {
  if (sh.pc) try { sh.pc.close(); } catch (e) { /* closed */ }
  if (sh.stream) sh.stream.getTracks().forEach((t) => t.stop());
  sh.pc = sh.stream = null;
  sh.job = "";
}

async function shStart(job) {
  shStop();
  sh.job = job.id;
  document.getElementById("what").textContent = "Sharing screen " + (job.screen + 1);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { height: { ideal: job.size, max: job.size }, frameRate: { ideal: job.fps, max: job.fps }, cursor: "always" },
      audio: false, monitorTypeSurfaces: "include", selfBrowserSurface: "exclude", surfaceSwitching: "exclude",
    });
  } catch (e) {
    return shPost("/api/share-relay", { what: "answer", id: job.id, error: "screen" });
  }
  if (sh.job !== job.id) return stream.getTracks().forEach((t) => t.stop());
  sh.stream = stream;
  const track = stream.getVideoTracks()[0];
  track.contentHint = job.fps >= 60 ? "motion" : "detail";
  const pc = sh.pc = new RTCPeerConnection({ iceServers: [] });
  await pc.setRemoteDescription({ type: "offer", sdp: job.offer });
  const tx = pc.getTransceivers()[0];
  tx.direction = "sendonly";
  await tx.sender.replaceTrack(track);
  await pc.setLocalDescription(await pc.createAnswer());
  // (right here on this PC: lots of detail, the app's window sends it on at the call's quality)
  const params = tx.sender.getParameters();
  if (!params.encodings || !params.encodings.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = 30000000;
  params.encodings[0].maxFramerate = job.fps;
  params.degradationPreference = "maintain-resolution";
  tx.sender.setParameters(params).catch(() => {});
  await new Promise((done) => {
    if (pc.iceGatheringState === "complete") return done();
    const t = setTimeout(done, 3000);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); done(); } });
  });
  if (sh.job !== job.id) return;
  await shPost("/api/share-relay", { what: "answer", id: job.id, sdp: pc.localDescription.sdp });
}

async function shTick() {
  try {
    const res = await shPost("/api/share-relay", { what: "job" });
    const job = res && res.job;
    if (!job) { if (sh.job) shStop(); }
    else if (job.id !== sh.job) shStart(job).catch(() => {});
    else if (sh.stream) {
      const track = sh.stream.getVideoTracks()[0];
      track.applyConstraints({ height: { ideal: job.size, max: job.size }, frameRate: { ideal: job.fps, max: job.fps } }).catch(() => {});
    }
  } catch (e) { /* the app is closing */ }
  setTimeout(shTick, 500);
}
shTick();
