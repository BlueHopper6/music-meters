# Phase 2 static layout editor report

**Status: PASS for the Phase 2 gate. Stop before Phase 3.**

## Source and architecture

- Branch: `feature/phase-2-layout-editor`, created from clean `main` at merge commit `c930e9b51247fd0cfa330a1d7215cda7845a8cb8`.
- Prism remains pinned to `49721802252b115d169e353c98b27408daa5e2b7`, GPL-3.0-only. Its native vectorscope C++ (`native/src/vectorscope.cpp`, `native/src/main.cpp`) and original Canvas painter (`src/renderer/visualizers/Vectorscope.ts` plus grid/support modules) are reused. The build adds only the explicit `renderFrame()` seam to the pinned TypeScript source in memory, as Phase 1 did. The upstream checkout is not edited.
- Astrofox remains a source reference at `ef3312505eb2830f34440da0196fa1ec545be659`, MIT. No Astrofox modules were imported for this phase.
- `phase2/composition.ts` owns the actual Canvas drawing for both the visible editor still and hidden MP4 export. It draws the same title/background and real Prism vectorscope layers in 1280×720 project coordinates, scaled for 720p or 1080p output. A selected-layer border is editor UI only and is intentionally absent from the MP4.
- `phase2/audio.cjs` decodes from the beginning of the song through the end of the selected video frame before asking Prism for points. This complete pre-roll preserves the analyzer's history and makes backward seeks deterministic. It uses the same `(frameIndex + 1) × sampleRate / 30` sample boundary as export. Preview requests are serialized; superseded requests stop at the next bounded chunk. Full reprocessing is a correctness-first strategy, not a seek cache.
- The Electron editor has a 16:9 stage, audio import, timestamp slider/time input, layers list, property inspector, add/duplicate/delete/reorder, show/hide, lock, opacity, drag, bottom-right resize, numeric geometry, project save/open, and a Render MP4 button with 720p/1080p selection, progress, and cancel. The preload exposes narrow IPC operations; renderer Node integration is disabled and context isolation/sandbox are enabled.
- Versioned JSON projects use 1280×720/30 FPS coordinates and relative audio references. Missing audio is reported for relinking; the song is not embedded. Project inputs and geometry are validated before save or export. Phase 2 reuses the bounded Phase 1 PCM reader and FFmpeg image pipe, with separate decoder/encoder child processes and temporary-output cleanup.

## Run and inspect

After the Phase 0 prerequisite setup, run `node phase2/run.cjs` from the repository root. The optional `--audio <path>` opens with a chosen file. The editor builds its browser bundles into ignored `artifacts/phase2/` and launches Electron locally. No audio or project file is uploaded.

Committed review samples are `samples/phase2/editor-smoke.mp4`, `editor-window.png`, `preview-90.png`, and `preview-150.png`. The full local test set remains under ignored `artifacts/phase2/`: `editor-smoke-pr3.mp4`, `editor-1080p.mp4`, `editor-window.png`, `preview-0.png`, `preview-5.png`, `preview-30.png`, `preview-90.png`, `preview-150.png`, `export-frame-150-pr3.png`, `editor-project.json`, and `editor-smoke.json`.

## Gate results

| Criterion | Result |
| --- | --- |
| Real audio stills | **PASS:** The editor displayed Prism vectorscope traces from the 180-second stereo fixture at 30, 90, and 150 seconds. I viewed the saved PNGs: rising diagonal, vertical left-only, and falling anti-phase diagonal. Seeking from 150 back to 90 seconds produced an identical PNG SHA-256 hash. The 10-second fixture likewise gave distinct in-phase, left-only, and anti-phase stills, and repeat 5-second stills matched exactly. |
| Layer editing | **PASS:** Automated Electron UI input added, duplicated, deleted, reordered, hid and showed layers; toggled lock; set 70% opacity and numeric X/Y/W/H; then performed two pointer drags and two pointer resizes. The selected layer moved from X=270 to X=340 and grew from W=420 to W=500. |
| Project persistence | **PASS:** The UI saved a two-layer JSON project, changed X, reopened the file, and restored X=340, width=500, opacity=0.7, and the relative audio reference. The editor rendered the reopened project. |
| Missing audio and relink | **PASS:** A project referencing a missing WAV opened with a visible missing-audio message. Its edited layout saved while the file was absent. Importing a replacement WAV restored a real still and updated the saved relative reference. |
| File import | **PASS:** The UI import control loaded a mono 44.1 kHz fixture after the stereo export, updated the format display, and computed a real still. |
| Preview versus export | **PASS:** The saved project's editor canvas at video frame 150 and frame 150 extracted from the UI-rendered 720p MP4 are both 1280×720. Full-image RMSE was 1.961 RGB levels and PSNR was 42.28 dB; the detected cyan trace had zero horizontal edge displacement. The comparison gate is PSNR ≥40 dB and horizontal edge displacement ≤3 px. Faint trace endpoints differ under lossy H.264, so a strict vertical bounding-box test would be misleading. I viewed both images and found no geometric shift. |
| MP4 and sound | **PASS:** The UI-produced 720p MP4 and saved-project 1080p MP4 each have 300 H.264 `yuv420p` frames at 30 FPS, AAC audio, 10.000-second duration, and full-file FFmpeg decode success. Source/output audio correlation was 0.99990 or higher at tested times; the in-phase, left-only, and anti-phase channel relationships appeared at the expected sections. AAC added 256 decoded sample frames (5.3 ms) of padding. No audio mastering or effects were applied. AAC is lossy. |
| Export cancellation | **PASS:** A controlled cancellation after 30 frames removed the temporary and final MP4 and left neither tested FFmpeg child PID running. The CLI reported exit code 2. |
| Tests | **PASS:** `node --test phase2/test/project.test.cjs phase1/test/pcm-reader.test.cjs` passed 6/6; `node phase2/build.cjs` and all CommonJS syntax checks passed. The Electron editor smoke, missing-audio/relink, and long-preview drivers exited 0. `python phase2/test/compare-frame.py` and `python phase1/verify-export.py` passed for the reviewed 720p MP4; the audio verifier also passed for 1080p. |

The first UI smoke run found an automatic-semicolon parsing bug during inspector startup. It was fixed before the passing runs. A first image comparison gate overreacted to dim trace endpoints changed by H.264; the final comparison uses whole-image fidelity plus horizontal trace placement and documents that tolerance. A sandboxed Electron launch was blocked by process restrictions; the same tests passed with normal process access. Automated tests exercised the file controls with injected paths; the native operating-system file picker itself was not manually driven.

## Performance and limits

The saved two-layer 1080p/30 FPS project exported 10 seconds of video in **8.395 s** on this machine: **0.082 s** PCM/DSP progression, **7.452 s** frame rendering and PNG transfer, **0.201 s** encoder backpressure, and **127,770,624 bytes** peak Electron main-process RSS. Setup and encoder completion account for the remaining wall time. This is an observed run, not a throughput guarantee.

Only the vectorscope is available as a layer in Phase 2; duplicated layers share the same real Prism analysis points while retaining independent position, size, order, opacity, visibility, and color. Prism's native analyzer is still process-global, so independent analyzer instances and other meter categories belong to later phases. Preview seeking reprocesses audio from the start each time, which is accurate but may feel slow on longer songs. The renderer still passes PNG frames through a JavaScript bridge. Image backgrounds, artwork, artist text, and the other Prism meters are outside this phase. The app is a local development build and is not packaged for distribution.

**Next recommended phase:** Add the first additional Prism meter through the same shared composition path, then verify it in editor stills and exported video. **Waiting for explicit user approval: YES.**
