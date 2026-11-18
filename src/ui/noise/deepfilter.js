// DeepFilterNet 3 noise suppression for calls, as an AudioWorklet (the "DeepFilter" setting in ../call.js).
// The AI itself is deepfilter.wasm (built from github.com/Rikorose/DeepFilterNet, see README.txt) with its
// model in deepfilter_model.tar.gz. call.js loads both and hands them over in processorOptions:
// { wasmModule: WebAssembly.Module, model: ArrayBuffer }.
//
// The AI works on 480 sounds at a time (10 ms at 48 kHz) and the browser hands over 128 at a time, so sound
// is gathered up first. That adds 10 ms, on top of the AI's own look ahead.
import { initSync, df_create, df_get_frame_length, df_process_frame } from "./deepfilter_glue.js";

const NAME = "vaulthub/deepfilter";

class DeepFilterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasmModule, model, attenLimit } = options.processorOptions || {};
    this.alive = true;
    this.state = 0;
    try {
      initSync(wasmModule);
      this.state = df_create(new Uint8Array(model), attenLimit || 100);
      this.hop = df_get_frame_length(this.state);
    } catch (e) {
      // (the sound just goes through as it is, and call.js hears about it)
      this.state = 0;
      this.port.postMessage({ failed: String(e && e.message || e) });
    }
    this.hop = this.hop || 480;
    this.inBuf = new Float32Array(this.hop);
    this.inLen = 0;
    // Finished sound waiting to go out. Starts with one frame of quiet so there's always enough.
    this.outBuf = new Float32Array(this.hop * 4);
    this.outRead = 0;
    this.outLen = this.hop;
    this.port.onmessage = (e) => { if (e.data === "destroy") this.alive = false; };
    if (this.state) this.port.postMessage({ ready: true });
  }

  pushOut(frame) {
    const cap = this.outBuf.length;
    for (let i = 0; i < frame.length; i++) {
      if (this.outLen >= cap) break; // (can't happen: one frame in for every frame out)
      this.outBuf[(this.outRead + this.outLen) % cap] = frame[i];
      this.outLen++;
    }
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!this.state) {
      if (input) output.set(input);
      return true;
    }
    const n = output.length;
    for (let i = 0; i < n; i++) {
      this.inBuf[this.inLen++] = input ? input[i] : 0;
      if (this.inLen === this.hop) {
        this.inLen = 0;
        let frame;
        try { frame = df_process_frame(this.state, this.inBuf); } catch (e) { frame = this.inBuf.slice(); }
        this.pushOut(frame);
      }
    }
    const cap = this.outBuf.length;
    for (let i = 0; i < n; i++) {
      if (this.outLen > 0) {
        output[i] = this.outBuf[this.outRead];
        this.outRead = (this.outRead + 1) % cap;
        this.outLen--;
      } else {
        output[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor(NAME, DeepFilterProcessor);
