// Little sounds in calls, like Discord: someone joins or leaves, you mute or deafen, a screen share starts
// or stops. Made right here with the sound engine (no sound files), short and soft. Settings > Sound has a
// switch for them. Uses loadPref() from theme.js, volumeLevel() and appSinkCtx() from volume.js.

function callSoundsOn() { return loadPref("callSounds") !== false; }

// Each sound: notes of [pitch (Hz), when (s), how long (s)], and how it slides (a little up or down at the start).
const CALL_SOUNDS = {
  join: { notes: [[659, 0, 0.13], [988, 0.085, 0.2]], slide: 1.04 },
  leave: { notes: [[880, 0, 0.13], [587, 0.085, 0.22]], slide: 0.97 },
  mute: { notes: [[523, 0, 0.09], [392, 0.06, 0.14]], slide: 0.98, soft: 0.8 },
  unmute: { notes: [[392, 0, 0.09], [587, 0.06, 0.14]], slide: 1.02, soft: 0.8 },
  deafen: { notes: [[466, 0, 0.1], [349, 0.07, 0.1], [262, 0.14, 0.18]], slide: 0.98, soft: 0.85 },
  undeafen: { notes: [[262, 0, 0.1], [349, 0.07, 0.1], [523, 0.14, 0.18]], slide: 1.02, soft: 0.85 },
  shareOn: { notes: [[587, 0, 0.11], [784, 0.07, 0.11], [1175, 0.14, 0.24]], slide: 1.03 },
  shareOff: { notes: [[1047, 0, 0.11], [784, 0.07, 0.11], [523, 0.14, 0.22]], slide: 0.98 },
  // a friend started sharing (softer than your own)
  shareThem: { notes: [[784, 0, 0.1], [1175, 0.07, 0.2]], slide: 1.02, soft: 0.6 },
};

let callSoundCtx = null;
let callSoundLast = {};
function callSound(name) {
  const s = CALL_SOUNDS[name];
  if (!s || !callSoundsOn()) return;
  const now = Date.now();
  if (now - (callSoundLast[name] || 0) < 120) return; // (two clicks at once: one sound)
  callSoundLast[name] = now;
  try {
    callSoundCtx = callSoundCtx || appSinkCtx(new AudioContext({ latencyHint: "interactive" }));
    const ctx = callSoundCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    // Always easy to hear, but a bit quieter when the app's volume is low.
    const loud = 0.2 * (s.soft || 1) * (0.45 + 0.55 * Math.sqrt(volumeLevel()));
    const out = ctx.createGain();
    out.gain.value = loud;
    // a soft round tone: rounder highs, no clicks
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    tone.connect(out).connect(ctx.destination);
    for (const [freq, at, length] of s.notes) {
      const start = t0 + at, end = start + length;
      for (const [mult, type, level] of [[1, "sine", 1], [2, "sine", 0.18], [3, "triangle", 0.05]]) {
        const osc = ctx.createOscillator(), env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq * mult / s.slide, start);
        osc.frequency.exponentialRampToValueAtTime(freq * mult, start + 0.035);
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(level, start + 0.008);
        env.gain.exponentialRampToValueAtTime(level * 0.35, start + Math.min(0.06, length * 0.5));
        env.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(env).connect(tone);
        osc.start(start);
        osc.stop(end + 0.02);
      }
    }
  } catch (e) { /* no sound card: no sound */ }
}
