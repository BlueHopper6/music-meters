# Phase 0 feasibility report

**Status: PASS for the nine-second proof. Stop before Phase 1.**

## Source and decision

- Project branch: `feature/phase-0-prism-export`, based on `649c68465bac52644bb8a5487e5989cb638fa03f`. Phase 0 changes are uncommitted.
- Prism: [`Boof2015/prism`](https://github.com/Boof2015/prism), commit `49721802252b115d169e353c98b27408daa5e2b7`, GPL-3.0-only. The checkout is in ignored `upstream/prism/`; the runner rejects a different commit.
- Astrofox: [`astrofox-io/astrofox`](https://github.com/astrofox-io/astrofox), commit `ef3312505eb2830f34440da0196fa1ec545be659`, MIT. Its `src/lib/video/offlineEncoder.ts` pipes offline frames to FFmpeg; `src/lib/core/render/offlineFrames.ts` manages frame-at-time rendering through its stage. Neither file was imported. Both depend on Astrofox platform/stage contracts that would add needless integration work for this proof.
- Windows 10.0.26300, Node 24.11.0, npm 11.6.1, Python 3.14.0, Visual Studio 2022 C++ tools 14.44.35207, FFmpeg 8.0.1. No system-wide installs were made. Prism dependencies and Electron were installed locally in the ignored checkout.

**Chosen seam:** FFmpeg decodes the generated WAV to stereo float PCM. Electron's main process feeds every 1,600-sample chunk to Prism's unmodified native vectorscope at 48 kHz and obtains its latest 1,024 X/Y points. The hidden, sandboxed Electron renderer passes those real points through a narrow injected analyzer adapter into Prism's original `Vectorscope` Canvas class. It paints the meter on an internal canvas at an explicit frame index; a second canvas composites background and title. Canvas PNG bytes stream through FFmpeg stdin to H.264/AAC MP4. The audio file is separately passed to FFmpeg for AAC encoding; no audio mastering or effects are applied.

This establishes direct offscreen rendering and avoids any screen/window recording. PNG piping is a proof-only transport. Astrofox's offline rendering pattern is useful, but importing its exporter would pull in its stage, platform, and export-job abstractions. A future export core should stream raw RGBA through a bounded queue.

## Exact Prism reuse

| Role | Prism source | Adaptation |
| --- | --- | --- |
| Native DSP circular stereo buffer and X/Y points | `native/src/vectorscope.cpp`, `native/src/vectorscope.h` | None; compiled with Prism's `native/binding.gyp` and native build script. |
| Native JS entry points | `native/src/main.cpp` (`vectorscope.pushSamples`, `getPoints`, `reset`, `setSampleRate`) | None. |
| Actual scope painting and persistence | `src/renderer/visualizers/Vectorscope.ts` | Imported unchanged. Phase 0 calls its TypeScript-private `drawFrame` via an adapter; this must become a supported explicit render method for production. |
| Grid, geometry, calibrated projection | `src/renderer/visualizers/vectorscopeGrids.ts`, `src/types/vectorscope.ts`, `src/renderer/utils/color.ts` | Imported unchanged through `Vectorscope.ts`. |
| Visualizer support | `src/renderer/visualizers/dataSource.ts`, `frameScheduler.ts`, `visualizerFrameLoop.ts`, `multibandSplitter.ts` | Imported unchanged; the injected offline data source prevents the live scheduler from starting. |

Prism's native vectorscope is currently a process-global singleton in `native/src/main.cpp`. The Phase 0 adapter has one meter and one native analyzer. Multiple independent meters will require instance ownership, but that is outside this phase.

## Proof files and reproduction

- `phase0/make-fixture.py`: deterministic nine-second WAV, 440 Hz in phase for 0–3 s, left-only for 3–6 s, anti-phase for 6–9 s.
- `phase0/renderer.ts`: Prism Canvas adapter and basic composition.
- `phase0/electron-app/main.cjs`: FFmpeg decode, native progression, deterministic frame loop, PNG pipe, AAC/H.264 encode, timing and main-process memory log.
- `phase0/run.cjs`: checks pinned Prism commit/prerequisites, bundles the renderer with Prism's local esbuild, and launches hidden Electron.
- `phase0/verify-audio.py`: decoded-source correlation, channel relation, phase-change timing, and AAC padding check.

From a fresh project checkout on Windows with Node, Python, Visual Studio C++ tools, and FFmpeg on PATH, run:

```powershell
git clone https://github.com/Boof2015/prism.git upstream/prism
git -C upstream/prism checkout 49721802252b115d169e353c98b27408daa5e2b7
Push-Location upstream/prism
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
$env:VCINSTALLDIR = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\'
$env:VSCMD_VER = '17.14.0'
$env:WindowsSDKVersion = '10.0.26100.0\'
npm run build:native
Pop-Location
python phase0/make-fixture.py
node phase0/run.cjs artifacts/phase0/stereo-phases.mp4
python phase0/verify-audio.py
```

The Visual Studio environment variables were needed on this host because node-gyp did not auto-detect the installed tools. Use a new output path for another run; the runner refuses to overwrite an existing file. The pinned Astrofox checkout was used only for source inspection and is not needed to reproduce the proof.

## Tests and artifacts

| Criterion | Result and evidence |
| --- | --- |
| Native and JS tests | **PASS**: `npm run build:native`; `npm run typecheck`; `npm run build`; `npm run test:vectorscope-native` (2/2); `npm run test:renderer-helpers` (222/222); full `npm test` (29 test scripts, exit 0; log in `artifacts/phase0/prism-test.log`). |
| Real PCM to Prism native DSP and original Canvas painter | **PASS**: FFmpeg decoded the generated stereo WAV to 48 kHz float samples; the original addon produced points passed to the original `Vectorscope.ts` painter. No self-made meter was substituted. |
| MP4 encode and decode | **PASS**: `ffprobe -count_frames` reports H.264, `yuv420p`, 1280×720, 30/1 FPS, 270 decoded video frames, 9.000 s; AAC, 9.000 s. `ffmpeg -v error -i artifacts/phase0/stereo-phases.mp4 -f null NUL` exited 0. MP4 size: 388,246 bytes. |
| Visual inspection of encoded video frames | **PASS**: Frames extracted from the MP4 at 1.5, 4.5, and 7.5 s were actually viewed. The scope shows a rising diagonal, vertical line, and falling diagonal respectively. See `artifacts/phase0/video-1.5.png`, `video-4.5.png`, `video-7.5.png`. |
| Determinism | **PASS**: A second full export produced identical SHA-256 hashes for raw Canvas PNGs at frames 45, 135, and 225: `20CA875D26FF74898E57C5149295DF9D6991FF64FC054D6406F866F3FA2B03AF`, `C7B0191879135F3196CF3EF994F89B3BF4227293A9FAB03644B577EA0AC82F7A`, `66EA065A0D552F8826E3AB9BB5349C15E98A4B21D90C54009AA890A4F6FBFB4E9`. A final export after adding pin/overwrite safeguards matched these frame hashes and the first MP4's whole-file SHA-256. |
| Audio content and alignment | **PASS**: `python phase0/verify-audio.py` exited 0. Left-channel decoded source/output correlations were 0.999875, 1.000000, 1.000000 at the three sampled times. Right channel was active, quiet, active as expected, with correct positive/negative relation. Both phase transitions occurred within 30 ms of 3 and 6 s. AAC decoding adds 128 trailing sample frames (2.667 ms), accepted as codec padding. |
| No screen/audio capture | **PASS**: The code reads file PCM, draws internal Canvas pixels with `toDataURL`, and passes PNG bytes to FFmpeg. It does not call desktop/window screenshot, real-time capture, MediaRecorder, or system-audio APIs. |

The first full `npm test` attempt failed because the restricted execution sandbox denied a temporary Git fixture write. Rerunning it with normal temp-directory access passed all 29 scripts. The first native build likewise needed Node headers from the network and an explicit Visual Studio path; the successful build is the one reported above.

**Review samples committed with this branch:** `samples/phase0/stereo-phases.mp4` and `samples/phase0/frame-1.5.png`, `frame-4.5.png`, `frame-7.5.png` are copies of the verified final video and its encoded frame extracts. **Local run artifacts:** The final verified video is `artifacts/phase0/final/stereo-phases.mp4`. The first and repeat exports are `artifacts/phase0/stereo-phases.mp4` and `artifacts/phase0/repeat/stereo-phases.mp4`. Also inspect `artifacts/phase0/frame-045.png`, `frame-135.png`, `frame-225.png`, the three `video-*.png` MP4 extracts, `artifacts/phase0/stereo-phases.wav`, and `artifacts/phase0/prism-test.log`. `artifacts/` is ignored by Git; these files remain in the workspace for inspection.

**Performance:** First export 7.427 s; repeat 7.307 s; final export 7.523 s, each for nine seconds of 1280×720/30 FPS output. Peak measured Electron main-process RSS was 119,537,664, 117,080,064, and 120,041,472 bytes respectively. Renderer and FFmpeg memory were not included. These are local proof measurements, not production performance guarantees.

## Limits and next decision

The proof holds the whole decoded nine-second fixture in memory and passes point arrays to the renderer through `executeJavaScript`. It serializes PNG frames, not raw RGBA. It has no long-track streaming, cancellation, editor, arbitrary input import, or multiple meter instances. Calling a private Prism painter method is a brittle seam. A production adapter should expose an explicit `renderFrame` API in a small Prism-compatible patch and retain native analyzer instances per meter. FFmpeg is used from the system PATH and no binary is bundled. Any distributed application incorporating Prism will need GPL-3.0-only-compatible licensing and notices; FFmpeg redistribution terms also need review if a binary is later bundled.

**Next recommended phase:** After approval, build a bounded PCM/analysis/frame stream and explicit painter API for full-song export. **Waiting for user approval: YES.**
