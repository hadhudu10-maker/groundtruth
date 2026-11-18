---
tags: [hackfest, groundtruth, research]
---
# 08 Library Feasibility Research

Back to [[Groundtruth Overview]]

Checked on 2026-11-16 against GitHub API (`gh api repos/...`), the npm registry (`npm view`), project READMEs and source, MDN browser-compat-data, and specs. "Unverified" means I could not confirm it from a primary source in this pass. Star counts and dates are as of the check date.

## Summary verdicts

| # | Item | Pick | Verdict | One-line reason |
|---|------|------|---------|-----------------|
| 1 | Data over sound | `ggwave` (npm), audible protocol | SAFE (audible), RISKY (ultrasound, iOS) | Works in browser via WASM, but hard cap 140 bytes per message and roughly 8 to 16 bytes/s; iOS Safari not documented by the project |
| 2 | Animated QR | `@ngraveio/bc-ur` fountain + `qr` (paulmillr) or `qr-scanner` | SAFE | Maintained, pure JS; BarcodeDetector is NOT available on iOS Safari so a JS decoder is required |
| 3 | WebRTC, manual signaling, no internet | Raw `RTCPeerConnection`, QR-exchanged SDP, no trystero | RISKY | Needs a shared IP network (Wi-Fi on), and mDNS-obfuscated host candidates can fail; must be tested on the real devices on day 1 |
| 4 | LP solver | `javascript-lp-solver` (or `yalps`); `highs` as fallback | SAFE | Pure JS, JSON model, no WASM asset to cache; glpk.js is GPL-3.0 |
| 5 | Signatures | `@noble/ed25519` or `@noble/curves` | SAFE | Tiny, audited-style libs; native WebCrypto Ed25519 also exists in Chrome 137+ and Safari 17+ |
| 6 | Anonymous one-person-one-report | `@cloudflare/blindrsa-ts` (RFC 9474) | Semaphore RISKY, blind RSA SAFE | Semaphore works off-chain but pulls snarkjs + ethers and about 4 to 6 MB of artifacts fetched from a CDN by default |
| 7 | In-browser LLM | Skip, or laptop-only `@mlc-ai/web-llm` with SmolLM2-360M | RISKY (AVOID for medical advice) | WebGPU required for web-llm, 200+ MB model must be pre-cached, tiny models are not trustworthy for triage |
| 8 | Mains hum (ENF) sensing | Demo with a played tone; do not promise real grid sensing | RISKY | Real technique, but AnalyserNode resolution is 1.46 Hz at best and phone/laptop mics plus browser filters may not pass 50 to 60 Hz |
| 9 | PWA offline | `vite-plugin-pwa` 2.0.0 | SAFE (with iOS camera caveat) | Maintained; iOS home-screen mode has a history of getUserMedia bugs, so demo in a Safari tab if it misbehaves |
| 10 | Capture-recapture | Chapman estimator, hand-coded | SAFE | Standard epidemiology method (Hook and Regal 1995); 5 lines of code |
| 11 | 3D | `@react-three/fiber` 9 + `@react-three/drei` 10 + React 19 | SAFE | Versions must be paired: fiber 9 needs React 19 |
| 12 | CRDT | Hand-rolled grow-only set of signed reports | Yjs SAFE over WebRTC/QR, AVOID over sound | Measured Yjs: 18 to 53 bytes per small op, 833 bytes for 23 entries; too big for a 140 byte acoustic frame |

## Things that will NOT work as assumed

1. "Both devices in airplane mode" is incompatible with WebRTC unless Wi-Fi is turned back on and both are on the same network. Sound and QR are the only transports here that work with every radio off.
2. The native `BarcodeDetector` is not usable on iOS Safari (behind a preference flag in Safari 17+ per MDN data) and is partial in Chrome. Ship a JS decoder.
3. `LedgerHQ/qrloop` does not exist (404). The repo is `gre/qrloop`, it is archived, last push 2023-01.
4. The npm `ggwave` package is 0.4.0 from 2022-07; the repo has a newer tag (ggwave-v0.4.3, 2026-03) that was not published to npm.
5. Trystero: the belief "no strategy works offline" is slightly wrong. Five of six need internet; `@trystero-p2p/ws-relay` can run on a LAN, but it needs a Node process, which breaks the "no backend" rule.
6. Semaphore downloads its wasm/zkey from `snark-artifacts.pse.dev` unless you pass local paths, so by default it fails offline.
7. Camera and microphone need a secure context. The iPhone must load the app from an HTTPS origin at least once (then the service worker serves it offline). `http://<laptop-ip>:5173` will not get camera or mic on the phone.
8. AnalyserNode cannot resolve 0.1 Hz. Max fftSize is 32768, which is 1.46 Hz per bin at 48 kHz.
9. A full Ed25519 signature (64 bytes) plus public key (32 bytes) uses 96 of the 140 bytes ggwave allows per message.

---

## 1. Data over sound: ggwave

- (a) Exists. Repo `ggerganov/ggwave`, npm package `ggwave` (JS + WASM via Emscripten, source in `bindings/javascript`). README: https://github.com/ggerganov/ggwave , npm: https://www.npmjs.com/package/ggwave
- (b) 7,926 stars, last push 2026-04-16, MIT. Latest GitHub release tag `ggwave-v0.4.3` (2026-03-21). npm latest is still `0.4.0`, published 2022-07-05 (`npm view ggwave time`). Unpacked size 163 kB.
- (c) Runs in the browser. The official example (`examples/ggwave-js/index-tmpl.html`) uses `navigator.mediaDevices.getUserMedia` with `echoCancellation: false, autoGainControl: false, noiseSuppression: false`, an `AudioContext({sampleRate: 48000})` with `webkitAudioContext` fallback, and `createScriptProcessor`. `getUserMedia` requires a secure context and is in Safari 11+ (MDN compat data, `api.MediaDevices.getUserMedia`, `secure_context_required`). iOS Safari is not mentioned in the README or JS binding docs: unverified by the project. The repo does ship a native iOS example (`ggwave-objc`), which says nothing about Safari. Expect to need a tap to start/resume the AudioContext on iOS (standard autoplay policy, unverified here).
- (d) Limits, from `include/ggwave/ggwave.h`: `kMaxLengthVariable = 140` bytes per transmission, `kMaxLengthFixed = 64`, `kMaxDataSize = 256`, default sample rate 48000, 1024 samples per frame. README: "The bandwidth rate is between 8-16 bytes/sec depending on the protocol parameters." Protocol table in the header: audible and ultrasound variants each send 3 bytes per tone group over 9 (Normal), 6 (Fast) or 3 (Fastest) frames. Derived by me from those numbers: raw symbol rate 15.6, 23.4 and 46.9 bytes/s before Reed-Solomon overhead and start/end markers; trust the README figure for planning. Audible band starts at 1875 Hz, ultrasound at 15000 Hz, each spanning 4.5 kHz (README modulation section). A 100 byte message takes on the order of 6 to 12 seconds.
- (e) Verdict: SAFE for the audible protocols laptop to phone (the library is self-contained and the API is 3 calls: `init`, `encode`, `decode`). RISKY for ultrasound (15 to 19.5 kHz depends on speaker and mic response and on the browser honoring the processing-off constraints) and for iOS Safari until tested on the actual phone.
- (f) Alternatives: `quiet/quiet-js` (2,273 stars, BSD-3-Clause) has had no commit since 2021-05-19 and its own README compatibility table lists Safari and iOS Safari receive as "Not Supported". No official npm package (`quietjs-bundle` 0.1.3 is a third-party wrapper, 2024-03). Verdict AVOID. Fallback if ggwave fails on iOS: make sound one-directional (phone transmits, laptop receives) or fall back to QR.

## 2. Animated / multi-frame QR

Fountain / framing:
- `@ngraveio/bc-ur` (repo `ngraveio/bc-ur`): v1.1.13, npm modified 2026-10-12, repo push 2026-06-05, MIT, 17 stars, 114 kB unpacked, ESM + CJS. README documents `UrFountainEncoder(ur, maxFragmentLength)`, `nextPartUr()`, and `UrFountainDecoder.receivePartUr()`, `isComplete()`, `getProgress()`. It encodes to bytewords so QR alphanumeric mode can be used. https://github.com/ngraveio/bc-ur . Spec: https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2024-001-multipart-ur.md . Low star count but it is the wallet-vendor implementation of a published spec. SAFE.
- `qrloop`: `LedgerHQ/qrloop` returns 404. Actual repo is `gre/qrloop`, 171 stars, archived, last push 2023-01-27; npm `qrloop` 1.4.1 from 2022-09. API is simple (`dataToFrames`, `parseFramesReducer`, `areFramesComplete`, `framesToData`) and needs `buffer`. RISKY only because unmaintained; it is small enough to vendor.
- Simplest fallback: hand-rolled "index/total + chunk" frames cycled in a loop. No fountain coding, but a few kB is fine if you loop.

Scanner:
- Native `BarcodeDetector`: MDN compat data says Chrome 88+ is partial ("Supported on ChromeOS and macOS only"), Chrome Android 83+, Safari 17 only behind the "Shape Detection API" preference flag (iOS mirrors Safari), Firefox no. Source: https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json . Do not depend on it for the iPhone.
- `nimiq/qr-scanner` (npm `qr-scanner` 1.4.2): 2,904 stars, MIT, npm last published 2022-11, repo last push 2024-03-30. README: uses native BarcodeDetector if available, otherwise a jsQR-based worker; "~59.3 kB (~16.3 kB gzipped)"; "to read from a Web Cam stream, your page must be served via HTTPS". Stable but not actively developed.
- `paulmillr/qr` (npm `qr` 0.7.2, published 2026-09-28): 392 stars, MIT or Apache-2.0, zero dependencies. README: encode 5.4 kB gz; `qr/decode.js` 7.3 kB; `qr/dom.js` (9.3 kB including decoder) gives `rearCamera`, `frameLoop`, `QRCanvas`; states camera access needs a secure context, https on iOS Safari. Generator and scanner in one maintained package. https://github.com/paulmillr/qr
- `cozmo/jsQR` (npm `jsqr` 1.4.0): 4,052 stars, Apache-2.0, repo push 2026-05-15 but version 1.4.0 is old. Decoder only, you write the camera loop.
- `zxing-js/library` (`@zxing/library` 0.23.0, 2026-04; `@zxing/browser` 0.2.1): 2,948 stars. Large (11.9 MB unpacked). Works, heavier than needed.
- Also on npm, not examined beyond registry data: `zxing-wasm` 3.1.7 and the `barcode-detector` polyfill 3.2.4 (both published 2026-11-15, MIT).

Generator: `qr` (above), or `qrcode` (repo `soldair/node-qrcode`, 8,191 stars, MIT, v1.5.4, repo last push 2024-08, stable), or `qr-code-styling` 1.9.2 (2,984 stars, MIT) if styled codes are wanted.

- (d) Throughput: unverified, no primary benchmark found. Plan on low-density frames (roughly 100 to 300 bytes each) at a few frames per second and measure on the real devices.
- (e) Verdict: SAFE. Pick `@ngraveio/bc-ur` + `qr` (encode, decode, camera helpers), with `qr-scanner` as the scanner fallback.

## 3. WebRTC with manual signaling, no internet

- WebRTC itself does not define or require a signaling server; offer/answer can be moved by any channel (copy/paste, QR). With `iceServers: []` only host candidates are gathered, which is sufficient when both peers are on the same IP subnet. I did not find a primary source that states "Chrome macOS to iOS Safari, host-only, offline hotspot, confirmed"; treat as unverified until tested.
- Hard requirement: an IP network. With Wi-Fi off there is no interface and no host candidate. So "airplane mode" must mean airplane mode with Wi-Fi re-enabled, both devices on the same router (no WAN needed) or hotspot. Whether iPhone Personal Hotspot can run with cellular off: unverified.
- mDNS caveat: per the IETF draft, browsers replace private host IPs with `<uuid>.local` names; "If mDNS resolution fails the remote candidate is ignored", and the fallback is NAT hairpin or TURN, neither of which exists offline. The draft reports mDNS succeeded only "about half the time" in the cases where it was the deciding factor. https://datatracker.ietf.org/doc/html/draft-ietf-mmusic-mdns-ice-candidates (sections 3.1.1, 3.2.1, 5.1).
- Safari: WebKit blog "A Closer Look Into WebRTC": without capture access WebKit does not expose host ICE candidates; "When access is granted, WebKit will expose host ICE candidates." https://webkit.org/blog/7763/a-closer-look-into-webrtc/ . Later WebKit work (bug 174500) added mDNS names instead. Practical mitigation: call `getUserMedia` (you already need camera for QR) before creating the peer connection so real host IPs are used. Chrome doing the same after a getUserMedia grant is commonly reported but unverified here.
- Signaling needs two messages (offer, then answer), so two QR scans in opposite directions. SDP for a data-channel-only connection is several hundred bytes to a couple of kB; compress or strip before putting in a QR (size unverified, measure).
- Trystero (`dmotz/trystero`, npm `trystero` 0.27.0, 2026-11-11, MIT, 2,856 stars). `docs/signaling.md` lists six strategies: Nostr (default), MQTT, BitTorrent trackers, Supabase, Firebase, and `@trystero-p2p/ws-relay` (self-hosted Node WebSocket relay). The first five need internet. `ws-relay` is documented for "VPS, Fly.io container, or local LAN" and uses `ws://` URLs, so it works offline but requires running a Node server, which is a backend. There is also `createTopicStrategy` for custom pub/sub, still relay based. No manual/QR strategy. https://github.com/dmotz/trystero/blob/main/docs/signaling.md
- (e) Verdict: RISKY. It is the highest-bandwidth transport but has the most environmental failure modes. Build QR and sound first, treat WebRTC as a stretch goal, and test on the real laptop + iPhone on the real hotspot on day 1.
- (f) Alternative: animated QR for kB payloads (item 2), ggwave for tiny ones (item 1).

## 4. LP/MIP solver

| Package | Repo | Version, date | License | Stars | Form | Notes |
|---|---|---|---|---|---|---|
| `highs` | `lovasoa/highs-js` | 1.15.4, 2026-10-16 | MIT | 91 | WASM build of HiGHS | 4.0 MB unpacked; CPLEX LP string in, JSON out, plus a persistent `createModel` API; in a browser you must serve `highs.wasm` and pass `locateFile`; README says to run long solves in a Worker |
| `glpk.js` | `jvail/glpk.js` | 5.0.0, 2025-12-23 | GPL-3.0 | 141 | WASM build of GLPK | 2.6 MB unpacked; JSON interface, async in browser; GPL is a licensing concern for the project |
| `javascript-lp-solver` | `JWally/jsLPSolver` | 1.0.3, 2026-01-24 (repo push 2026-11-03) | Unlicense | 466 | Pure JS/TS | JSON model (`optimize`, `opType`, `constraints`, `variables`, `ints`); README: LP via simplex, MIP via branch and cut, zero dependencies, works in browsers and Web Workers; has a `browser` export |
| `yalps` | `IanManske/YALPS` | 0.6.4, 2025-12-24 | MIT | 106 | Pure TS | "A rewrite of javascript-lp-solver"; 240 kB unpacked |

- Minified/gzipped bundle sizes: unverified (only npm unpacked sizes checked).
- (e) Verdict: SAFE. For a max-min fair allocation LP (maximize t subject to x_i >= t, capacity rows) and a small crop-mix LP, `javascript-lp-solver` is the lowest-risk choice: no WASM file to locate or precache, plain objects in and out. Use `highs` if you want an industrial solver, dual values or exact status codes; it is also SAFE but adds the WASM asset step. AVOID `glpk.js` because of GPL-3.0.
- Sources: https://github.com/lovasoa/highs-js , https://github.com/jvail/glpk.js , https://github.com/JWally/jsLPSolver , https://github.com/IanManske/YALPS

## 5. Cryptography: noble + WebCrypto Ed25519

- Packages (all MIT, by paulmillr, all published 2026-08-27): `@noble/curves` 2.4.0 (repo `paulmillr/noble-curves`, 972 stars), `@noble/ed25519` 3.2.0 (`paulmillr/noble-ed25519`, 525 stars), `@noble/hashes` 2.4.0 (`paulmillr/noble-hashes`, 945 stars).
- API notes from the READMEs: imports use a `.js` suffix, e.g. `import { ed25519 } from '@noble/curves/ed25519.js'`; `ed25519.keygen()`, `sign(msg, secretKey)`, `verify(sig, msg, publicKey)`. `@noble/ed25519` is "3.7KB (gzipped)" and exposes only async methods by default; for sync methods set `ed.hashes.sha512` from `@noble/hashes/sha2.js`. noble-curves also ships a "wrapper with identical API over native WebCrypto".
- Native WebCrypto Ed25519: MDN compat data (`api.SubtleCrypto.sign.ed25519`, also verify and generateKey): Chrome 137, Safari 17 (iOS mirrors), Firefox 129. https://github.com/mdn/browser-compat-data/blob/main/api/SubtleCrypto.json . `crypto.subtle` needs a secure context.
- Sizes: Ed25519 public key 32 bytes, signature 64 bytes (RFC 8032, section 5.1). https://www.rfc-editor.org/rfc/rfc8032
- (e) Verdict: SAFE. Use `@noble/ed25519` (works identically on every browser, no feature detection). Budget note: 64 byte signature is nearly half of a ggwave frame.

## 6. Anonymous one-person-one-report

Semaphore:
- Repo `semaphore-protocol/semaphore`, 1,097 stars, MIT, last push 2026-10-17. npm `@semaphore-protocol/identity`, `/group`, `/proof`, all 4.14.5 (2026-10-17).
- Off-chain in browser: yes. `/proof` README documents `generateProof(identity, group, message, scope, merkleTreeDepth?, snarkArtifacts?)` and `verifyProof(proof)` as plain JS; no contract call is required. Dependencies of `/proof`: `snarkjs` 0.7.5, `ethers` 6.13.4, `@zk-kit/artifacts`, `@zk-kit/utils`.
- Artifacts: README: if `snarkArtifacts` are not provided "they will be automatically downloaded". For offline you must self-host and pass `{ wasm, zkey }`. Measured `content-length` at `https://snark-artifacts.pse.dev/semaphore/latest/semaphore-<depth>.<ext>`: depth 10 wasm 1.82 MB + zkey 2.42 MB; depth 16 wasm 1.84 MB + zkey 3.41 MB; depth 20 wasm 1.85 MB + zkey 3.89 MB.
- Proof generation time: the official benchmarks page has browser numbers only as an image (M2 Pro, Chrome 139); numeric value unverified. iOS Safari timing unverified. https://github.com/semaphore-protocol/semaphore/blob/main/apps/docs/versioned_docs/version-V4/benchmarks.md
- Proof size is hundreds of bytes (Groth16 points plus root, nullifier, message, scope), so QR or WebRTC only, not sound.
- Verdict: RISKY. Feasible, but it adds heavy dependencies, a Worker, artifact precaching, and group-membership distribution over your offline transports. Only do it if anonymity is the headline feature.

Blind RSA:
- `cloudflare/blindrsa-ts`, npm `@cloudflare/blindrsa-ts` 0.4.6 (2026-09-03), Apache-2.0 on npm, 38 stars, last push 2026-10-26. README: compliant with RFC 9474, matches its test vectors; exposes `RSABSSA.SHA384.PSS.Randomized` and three other variants, plus partially blind variants. Flow: client `blind`, issuer `blindSign`, client `finalize`, anyone `verify`. https://github.com/cloudflare/blindrsa-ts , https://www.rfc-editor.org/rfc/rfc9474
- Needs an issuer role (one device, e.g. the "clinic" laptop, holds the RSA key and signs one blinded token per person). Signature length equals the RSA modulus (256 bytes for 2048 bit), so QR/WebRTC only. iOS Safari support not stated in the README: unverified, test early.
- Verdict: SAFE and the better fit for 4 days: one token per enrolled person, token is unlinkable to the enrollment, double use is detected by storing spent tokens.

## 7. In-browser LLM

- `mlc-ai/web-llm`: npm `@mlc-ai/web-llm` 0.2.88 (2026-11-10), Apache-2.0, 19,383 stars, pushed 2026-11-16. README: "accelerated with WebGPU" (required, no WASM CPU fallback documented). Smallest chat models in `src/config.ts` by `vram_required_MB`: `SmolLM2-135M-Instruct-q0f16-MLC` 360 MB, `SmolLM2-360M-Instruct-q4f16_1-MLC` 376 MB, `LFM2.5-350M-q4f16_1-MLC` 532 MB, `TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC-1k` 675 MB, `gemma3-1b-it-q4f16_1-MLC` 711 MB, `Llama-3.2-1B-Instruct-q4f16_1-MLC` 879 MB, `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` 945 MB. Download sizes (Hugging Face repo totals): SmolLM2-360M q4f16_1 207 MB, Qwen2.5-0.5B q4f16_1 290 MB, Llama-3.2-1B q4f16_1 705 MB. Weights are cached via the Cache API by default.
- `huggingface/transformers.js`: npm `@huggingface/transformers` 4.3.2 (2026-10-30), Apache-2.0, 16,424 stars. (`@xenova/transformers` 2.17.2 is the old name, last published 2024.) README: runs on CPU via WASM by default, `device: 'webgpu'` optional, `dtype` selects quantization (`q8` default for WASM, `q4`, `fp16`). ONNX sizes: `HuggingFaceTB/SmolLM2-135M-Instruct` q4f16 118 MB, int8 137 MB; `SmolLM2-360M-Instruct` q4f16 273 MB, int8 365 MB; `onnx-community/Qwen2.5-0.5B-Instruct` q4f16 483 MB. WASM binaries load from a CDN by default; set `env.backends.onnx.wasm.wasmPaths` to self-host for offline.
- WebGPU: MDN compat data lists Chrome desktop (macOS included) and Safari 26. WebKit: WebGPU "is now shipping in Safari 26 beta for macOS, iOS, iPadOS, and visionOS". https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ . So the iPhone needs iOS 26 or later for web-llm. iOS tab memory limits with a 300+ MB model: unverified.
- (e) Verdict: RISKY technically, and AVOID as a medical decision-maker. A 135M to 360M model is the only size that is realistic to precache, and models that small are not reliable for triage. The model must be downloaded while online and cached before the demo.
- (f) Alternative: a deterministic rule-based triage checklist (auditable, instant, offline, works on the phone). If an LLM is wanted for the pitch, run it on the laptop only, label it as a phrasing/explanation aid, and keep the rules as the source of the triage result.

## 8. Mains hum (ENF) detection with Web Audio

- Established technique: yes. Grigoras, C. (2005), "Digital audio recording analysis: the Electric Network Frequency (ENF) Criterion", International Journal of Speech, Language and the Law 12(1), 63-76. https://journal.equinoxpub.com/IJSLL/article/view/9977 . For battery-powered recorders: Hajj-Ahmad et al., IEEE Transactions on Information Forensics and Security (2018), which identifies acoustic mains hum from nearby mains-powered equipment as the usual way ENF gets into such recordings (public copy: https://par.nsf.gov/servlets/purl/10254057 ); and the AES paper "Source of ENF in Battery-Powered Digital Recordings" (https://www.aes.org/e-lib/browse.cfm?elib=17055 ). Implication: a phone on battery only picks up hum if something nearby is audibly humming.
- AnalyserNode resolution: `fftSize` must be a power of 2 up to 32768 (MDN: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/fftSize ). Bin width = sampleRate / fftSize: 48000/32768 = 1.46 Hz, 44100/32768 = 1.35 Hz. That cannot show 0.1 Hz changes, and real grid deviations are typically smaller than that (magnitude unverified here).
- Better approach (signal-processing arithmetic, not a library claim): frequency resolution is about 1/T, so 0.1 Hz needs about 10 s of signal and 0.01 Hz about 100 s. Capture raw samples with an `AudioWorklet` (Chrome 66+, Safari 14.1+ per MDN data), band-pass and decimate to roughly 1 kHz, then use a long-window FFT with peak interpolation, or a Goertzel bank in 0.01 Hz steps around the nominal frequency, or phase-difference/zero-crossing on the band-passed signal. Harmonics help: a deviation of d Hz at the fundamental is k*d at the k-th harmonic, and using 100/120 Hz or 150/180 Hz is standard in the ENF literature (specific citation unverified in this pass).
- Do mics and browsers pass 50 to 60 Hz: unverified per device; small MEMS mics and laptop arrays are usually weak below about 100 Hz. Browser side: the WebRTC audio processing module has a `high_pass_filter` stage alongside echo cancellation, noise suppression and gain control (`api/audio/audio_processing.h` in the WebRTC source). The relevant `getUserMedia` constraints are `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false` (the same three the ggwave example sets). Whether that also disables the high-pass stage in Chrome, and whether iOS Safari honors all three, is unverified.
- (e) Verdict: RISKY as a real sensor; do not make the plan depend on measuring actual grid drift from a phone mic. Detecting presence of hum at 120 Hz or 180 Hz (power on/off) is more realistic than measuring drift at 60 Hz.
- (f) Alternative: make it a demonstrable signal chain. Play a synthetic 120 Hz tone that drifts by a known amount from the second device (or a speaker), and show your Goertzel/long-window estimator tracking it. That proves the algorithm honestly without claiming grid measurement.

## 9. PWA offline

- `vite-pwa/vite-plugin-pwa`: npm `vite-plugin-pwa` 2.0.0 (released 2026-10-03; 1.3.0 on 2026-05-05), MIT, 4,312 stars, last push 2026-10-09. Peer deps: `vite ^3.1 || ^4 || ^5 || ^6 || ^7 || ^8`, `workbox-build ^7.4.1`, `workbox-window ^7.4.1`. Current Vite is 8.3.8. SAFE.
- Service workers and camera/mic both require HTTPS (or localhost on the laptop). Deploy to a static HTTPS host, open once online on each device, let the service worker precache everything (including any WASM, zkey, model files), then go offline.
- iOS home-screen (standalone) caveats, from WebKit Bugzilla: bug 185448 (getUserMedia did not work in standalone mode; closed as fixed around iOS 13.4) https://bugs.webkit.org/show_bug.cgi?id=185448 ; bug 215884 (repeated permission prompts in standalone on hash change) https://bugs.webkit.org/show_bug.cgi?id=215884 ; bug 212040 (tracks muted after `history.pushState` in a standalone PWA) https://bugs.webkit.org/show_bug.cgi?id=212040 ; bug 280394 (request to persist getUserMedia permission in home-screen apps, 2024); bug 273938 (camera stream failing in PWA on some devices on iOS 17.4.1, 2024, resolution unverified). Current status on iOS 26: unverified.
- (e) Verdict: SAFE for the plugin. For the demo, verify camera and mic in the installed PWA on the actual iPhone; if flaky, run it in a normal Safari tab (the service worker still serves it offline). Avoid hash/pushState route changes while a stream is live.

## 10. Capture-recapture

- Standard in epidemiology: Hook, E. B. and Regal, R. R. (1995), "Capture-recapture methods in epidemiology: methods and limitations", Epidemiologic Reviews 17(2), 243-264, DOI 10.1093/oxfordjournals.epirev.a036192. It treats overlapping incomplete case lists as "captures" to adjust for incomplete ascertainment. See also the International Working Group for Disease Monitoring and Forecasting papers, American Journal of Epidemiology 1995 (cited from memory, not re-fetched).
- Two lists with n1 and n2 cases and m cases on both:
  - Lincoln-Petersen: N = n1 * n2 / m (undefined when m = 0, biased for small m).
  - Chapman (bias-corrected): N = (n1 + 1)(n2 + 1) / (m + 1) - 1
  - Variance: Var(N) = (n1 + 1)(n2 + 1)(n1 - m)(n2 - m) / ((m + 1)^2 (m + 2))
  - Approximate 95% interval: N +/- 1.96 * sqrt(Var(N)). Ascertainment completeness of list 1 is n1 / N.
- Formula source: `recapr` R documentation (`vChapman`) https://search.r-project.org/CRAN/refmans/recapr/html/vChapman.html ; the same variance is attributed to Chapman 1951, Wittes 1972 and Seber 1982 in https://arxiv.org/pdf/2510.27580 . (Attribution to "Seber 1970" specifically is unverified; cite Seber 1982, The Estimation of Animal Abundance.)
- Assumptions to state in the app: closed population, the two lists are independent, every case has equal chance of being listed, and records are matched correctly. Positive dependence between lists makes the estimate too low.
- (e) Verdict: SAFE. Hand-code it; no library needed.

## 11. react-three-fiber and drei

- `@react-three/fiber` 9.8.2 (2026-10-21), MIT, repo `pmndrs/react-three-fiber`, 33,775 stars. README: "@react-three/fiber@8 pairs with react@18, @react-three/fiber@9 pairs with react@19." Peer deps: `react >=19 <19.4`, `react-dom >=19 <19.4`, `three >=0.156`.
- `@react-three/drei` 10.7.9 (2026-09-25), MIT, repo `pmndrs/drei`, 10,169 stars. Peer deps: `react ^19`, `react-dom ^19`, `@react-three/fiber ^9.0.0`, `three >=0.159`.
- Current `react` is 19.3.1 and `three` is 0.187.0, both inside those ranges. A fiber 10 alpha and drei 11 alpha exist on npm dist-tags; do not use them.
- (e) Verdict: SAFE. Install `react@19 @react-three/fiber@9 @react-three/drei@10 three`. Watch iPhone GPU load; keep the scene simple.

## 12. Yjs vs hand-rolled CRDT

- `yjs/yjs`, npm `yjs` 13.6.33 (2026-09-23), MIT (npm), 23,074 stars, pushed 2026-11-16.
- Measured locally with yjs 13.6.33 (one `Y.Map`, update v1 encoding):
  - `map.set('a', 1)`: 18 byte update
  - `map.set('report:7f3a', {sector, cases, t})`: 53 byte update
  - `map.set('k3', 'hello world')`: 30 byte update
  - Full state with 3 entries: 83 bytes; state vector: 7 bytes
  - Full state with 23 small object entries: 833 bytes (779 with v2 encoding)
- So a single small operation fits in about 100 bytes, but a state sync does not, and Yjs sync normally needs a state-vector round trip. Updates are also unsigned, so you would wrap them anyway.
- (e) Verdict: Yjs is SAFE over WebRTC or animated QR, AVOID over the acoustic link. Better fit for this app: a hand-rolled grow-only set keyed by report id (hash of the signed report), merge = set union, optional last-writer-wins map keyed by (id, timestamp, author key) for mutable fields. Each report is self-contained and individually signed, any transport can carry one report per frame, and merge order does not matter.

## Other maintained libraries noticed

- Web Worker RPC: `comlink` 4.4.2 (repo `GoogleChromeLabs/comlink`, Apache-2.0, 12,810 stars, repo push 2026-11-05). SAFE.
- Seeded PRNG: `pure-rand` 8.4.2 (repo `dubzzz/pure-rand`, MIT, published 2026-07, pushed 2026-11-16), pure functional generators, good for deterministic simulation. `seedrandom` 3.0.5 (2,131 stars, npm last published 2022, repo last push 2024): stable but stale.
- Statistics: `simple-statistics` 8.0.0 (ISC, 3,528 stars, published 2026-10-28). `jstat` 1.9.6 (MIT, 1,807 stars, npm last published 2022): distributions/CDFs if needed.
- Graphs: `graphology` 0.26.0 (MIT, 1,774 stars, repo push 2026-11-10) with its standard library of algorithms; `ngraph.graph` 20.1.2 (BSD-3-Clause, 584 stars).
- Max-flow: no maintained dedicated package verified in this pass. Options: hand-roll Edmonds-Karp (about 40 lines) or express max-flow as an LP in the solver from item 4.
- QR all-in-one: `qr` by paulmillr (item 2). Barcode polyfill: `barcode-detector` (npm, 2026-11) if you want the native API shape on iOS.
