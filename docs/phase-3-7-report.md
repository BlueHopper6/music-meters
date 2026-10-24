# Phase 3.7: Prism waterfall spectrum history

## Result and source

**PASS.** Work began from clean `main` at `4614416` (merged Phase 3.6 PR #9) on `feature/phase-3-waterfall`. Prism remains pinned to `49721802252b115d169e353c98b27408daa5e2b7`; Astrofox remains pinned to `ef3312505eb2830f34440da0196fa1ec545be659`. No upstream checkout source was edited.

The implementation reuses Prism `native/src/waterfall.cpp`, `.h`, and `waterfall_napi.cpp` for sample-clocked 60 Hz spectral history, stereo channel maxima, FFT, smoothing, tilt, frequency projection, and ridge age. It reuses `src/renderer/visualizers/Waterfall.ts` and `waterfallPlot.ts` for Canvas ridges, depth, theme/heat colors, and rulers, plus `src/types/waterfall.ts` for settings. The build adds an in-memory `renderFrame()` seam to the painter; Prism's file on disk is untouched.

Each visible waterfall layer has independent FFT size, scale, audible/extended frequency range, 1–30 s history, ridge density, smoothing, tilt, color mode, and guides. Preview decodes from song start to the requested frame and takes a native history snapshot. Export precomputes snapshots per layer into temporary frame records, so multiple unlike layers do not share mutable native history. Both paths feed the same Prism Canvas painter and composition. The temporary cache is removed on completion, cancellation, and error. Version 1 project files remain compatible.

## Gate evidence

The deterministic ten-second 48 kHz fixture has 0–2 s silence, 440 Hz in-phase stereo during 2–4 s, 440 Hz anti-phase during 4–6 s, 440 Hz left only during 6–8 s, and 1 kHz in-phase during 8–10 s. The review layout contains a log-scale, balanced, theme-color waterfall and a Mel-scale, dense, heat-color waterfall, plus a vectorscope. They use unlike FFT sizes and history lengths.

| Check | Result |
| --- | --- |
| Signal and history | **PASS:** Silence's latest native level was −120 dB. The 440 Hz in-phase, anti-phase, and left-only peaks appeared at 443.7 Hz and −6.31 dB; the 1 kHz peak appeared at 1010.0 Hz and −6.65 dB. At frame 244, native history held both frequency peaks. Ridge ages stayed within the configured five-second history; balanced/dense layers had 31/58 ridges at frame 270. |
| Sample rates | **PASS:** The same 440 Hz fixture at 44.1 and 96 kHz produced native ridge peaks at 432.2 Hz/−7.09 dB and 423.9 Hz/−6.87 dB, respectively, within the expected 2048-point FFT bin tolerance. The editor/export MP4 gate used 48 kHz. |
| Two instances and editor | **PASS:** Each layer's native preview snapshot equaled its snapshot when analyzed alone. Preview and export cache records matched exactly at frames 105, 165, 225, 244, and 270. Stills at silence, tone, anti-phase, left-only, transition, and 1 kHz were inspected. Backward seek to 3.5 s, save/reopen, and 570 → 540 → 570 width changes reproduced the original still byte-for-byte when restored. JSON retained both configurations and positions. |
| Still versus MP4 | **PASS:** Numbered 720p frames 105, 244, and 270 were compared with editor stills. Whole-frame PSNR was 37.05, 36.58, and 36.51 dB; the lowest waterfall-region PSNR was 31.63 dB, above the 35/30 dB gates. The transition still and encoded 1080p frame were visually inspected. |
| MP4 and sound | **PASS:** The 720p review video and ignored 1080p video fully decoded, with 300 H.264 `yuv420p` frames at 30 FPS, AAC audio, and 10.000 s duration. Source/output audio correlation was 1.0 in the sampled active sections; in-phase, anti-phase, left-only, and silence behavior remained correct. |
| Cancellation and regression | **PASS:** Cancellation after 30 rendered frames left no final or partial MP4 and no waterfall cache files. Fresh editor/export smoke tests passed for spectrum/vectorscope, oscilloscope, spectrogram, waveform, VU, and loudness. The browser build, strict TypeScript, project/PCM tests (20/20), syntax check, and `git diff --check` passed. |

Review artifacts: [720p MP4](../samples/phase3/waterfall-gate.mp4), [silence](../samples/phase3/waterfall-silence.png), [440 Hz](../samples/phase3/waterfall-tone.png), [anti-phase](../samples/phase3/waterfall-anti-phase.png), [left only](../samples/phase3/waterfall-left-only.png), [frequency transition](../samples/phase3/waterfall-transition.png), and [1 kHz](../samples/phase3/waterfall-one-khz.png). The generated fixture, saved project, 1080p MP4, comparison frames, and smoke JSON are under ignored `artifacts/phase3/`.

## Commands, performance, and limits

Commands run: `python phase3/test/make-fixture.py` at 48, 44.1, and 96 kHz; `node phase2/build.cjs`; strict TypeScript over the three app modules with pinned Prism declarations; `node --test phase2/test/project.test.cjs phase1/test/pcm-reader.test.cjs`; the Electron waterfall and six previous-meter smoke scripts; `python phase3/test/compare-waterfall-frame.py` for three numbered frames; `python phase3/test/verify-export.py` for both presets; 1080p and cancelled `node phase2/export.cjs` jobs; syntax and diff checks.

The fresh 1080p export took **22.35 s**, including **19.84 s** in render/PNG transfer and **0.38 s** of encoder backpressure; peak Electron main-process RSS was **169,209,856 bytes**. The RSS excludes renderer, FFmpeg, and cache memory. These observations are not performance guarantees.

The offline file pipeline has no live capture-gap sequence numbers, so it does not exercise Prism's live history reset on a missed capture chunk. Previews decode from the song start and can be slow for long-song seeks. Export stores full native ridge snapshots per frame; long songs with dense or multiple waterfall layers can use substantial temporary disk space. The 44.1 and 96 kHz variants were checked numerically through the app's native preview path; their MP4 output was not separately exported in this gate.

All eight Prism meter categories are now integrated; the vectorscope was completed in Phase 0/2. Next recommended phase: Phase 4 music-video composition, only after user approval.
