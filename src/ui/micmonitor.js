// Hear your own microphone: the Settings "Test it" button, and anything else that wants a mic check
// (like a check before going live). It opens the microphone the same way a call does (your picked
// microphone, noise suppression, Music mode), so you hear what friends would hear, and it gives a level
// for a moving bar. Uses callOpenMic()/callMicClose() from call.js and appSinkCtx() from volume.js.
//
//   const test = await micMonitorStart({ hear: true, onLevel: (v) => bar.style.width = v * 100 + "%" });
//   test.setHear(false); test.stop();
//
// Throws if there's no microphone.
async function micMonitorStart({ hear = true, onLevel = null } = {}) {
  const mic = await callOpenMic();
  const ctx = appSinkCtx(new AudioContext({ latencyHint: "interactive" })); // (out of the picked speakers)
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(mic.stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const out = ctx.createGain();
  out.gain.value = hear ? 1 : 0;
  source.connect(analyser);
  source.connect(out).connect(ctx.destination);
  const data = new Uint8Array(analyser.fftSize);
  let frame = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    if (onLevel) onLevel(Math.min(1, (peak / 128) * 1.6));
    frame = requestAnimationFrame(tick);
  };
  if (onLevel) tick();
  return {
    stream: mic.stream,
    setHear(on) { out.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02); },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      callMicClose(mic.stream, mic.parts);
      ctx.close().catch(() => {});
    },
  };
}

// "Hear yourself" in calls: your voice comes back to you (after mute and noise suppression), so you can tell
// if it sounds bad. Saved as micHear.
function callHearSelfOn() { return loadPref("micHear") === true; }
function callSetHearSelf(on) {
  savePref("micHear", !!on);
  callHearSelfApply();
  if (typeof drawSoundSettings === "function") drawSoundSettings();
  if (typeof drawCallPop === "function") drawCallPop();
}
function callHearSelfApply() {
  if (!callMix) return;
  try {
    if (!callMix.hear) {
      callMix.hear = callMix.ctx.createGain();
      callMix.hear.gain.value = 0;
      callMix.micGain.connect(callMix.hear);
      callMix.hear.connect(callMix.ctx.destination);
      appSinkCtx(callMix.ctx);
    }
    const on = callHearSelfOn() && !callDeafened;
    callMix.hear.gain.setTargetAtTime(on ? 1 : 0, callMix.ctx.currentTime, 0.02);
  } catch (e) { /* no way to hear yourself here */ }
}
