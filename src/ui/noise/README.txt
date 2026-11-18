Noise suppression for calls (used by ../call.js).

From the npm package @sapphi-red/web-noise-suppressor 0.4.1 (MIT, see LICENSE.txt), unchanged:
- rnnoise.js + rnnoise.wasm / rnnoise_simd.wasm: RNNoise by Xiph (BSD-3-Clause), built by
  Shiguredo (@shiguredo/rnnoise-wasm, Apache-2.0). The "Strong" setting.
- gtcrn.js + gtcrn.wasm: GTCRN by Xiaobin Rong (MIT), built by sapphi-red (gtcrn-wasm). The "Max" setting.

DeepFilterNet 3 (the "DeepFilter" setting), by Hendrik Schröter, MIT OR Apache-2.0 (see
DEEPFILTERNET-LICENSE-MIT.txt and DEEPFILTERNET-LICENSE-APACHE.txt), from github.com/Rikorose/DeepFilterNet
at commit 7b14b895fe7fc42cab72b4a4c1e49c982bd6404b:
- deepfilter_model.tar.gz: models/DeepFilterNet3_onnx.tar.gz, unchanged.
- deepfilter.wasm + deepfilter_glue.js: libDF built for the browser, with ../../../build/deepfilter_wasm.patch
  (the model is loaded separately instead of built in, and the same voice thresholds as the deep-filter program;
  without them it cuts voices about in half when there's noise):
    cd libDF && RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown \
      --no-default-features --features wasm --lib
    wasm-bindgen 0.2.92 --target web --remove-name-section --remove-producers-section --out-name df
  (df_bg.wasm -> deepfilter.wasm, df.js -> deepfilter_glue.js)
- deepfilter.js: VaultHub's own AudioWorklet around it.
