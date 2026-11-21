// (3.0) Remote desktop: plays this PC's own sound (from remote-host.js) into a sound track.
// It keeps the delay low by dropping old sound when it falls behind.
class Feed extends AudioWorkletProcessor {
  constructor() { super(); this.q = []; this.at = 0; this.size = 0;
    this.port.onmessage = (e) => { this.q.push(e.data); this.size += e.data.l.length;
      while (this.size > sampleRate * 0.12 && this.q.length > 1) { const d = this.q.shift(); this.size -= d.l.length - this.at; this.at = 0; } }; }
  process(_, outputs) {
    const [l, r] = outputs[0]; let i = 0;
    while (i < l.length && this.q.length) {
      const d = this.q[0], n = Math.min(l.length - i, d.l.length - this.at);
      l.set(d.l.subarray(this.at, this.at + n), i); r.set(d.r.subarray(this.at, this.at + n), i);
      i += n; this.at += n; this.size -= n;
      if (this.at >= d.l.length) { this.q.shift(); this.at = 0; }
    }
    return true;
  }
}
registerProcessor("rd-feed", Feed);
