# Phase 3.6: Prism loudness and true peak

## Result and source

**PASS.** Work began from clean `main` at `829b451` (merged Phase 3.5 PR #8) on `feature/phase-3-loudness-peak`. Pinned Prism is `49721802252b115d169e353c98b27408daa5e2b7`; Astrofox remains `ef3312505eb2830f34440da0196fa1ec545be659` and no Astrofox code was imported. Both ignored upstream checkouts remained unchanged.

The implementation reuses Prism `native/src/lufsmeter.cpp` and `.h` for K-weighted BS.1770 momentary (400 ms), short-term (3 s), and gated integrated loudness, stereo fast bars, and oversampled true-peak reconstruction. It reuses `src/renderer/visualizers/LUFSMeter.ts` for Canvas bars and readouts and `src/types/lufsmeter.ts` for readout choices. The native true-peak *maximum* is sample-driven and deterministic. Its per-channel display hold/decay uses `std::chrono::steady_clock`, so `phase3/true-peak.cjs` ports the pinned Prism FIR reconstruction and 750 ms hold/18 dB/s decay to explicit video-frame time. The port's cumulative maximum is checked against the native maximum rather than replacing the native BS.1770 measurement. The build inserts an in-memory `renderFrame()` seam into Prism's painter; the upstream source on disk is untouched.

`phase3/loudness.cjs` analyzes stereo PCM continuously in 30 FPS chunks. One native analysis pass serves all loudness layers; each layer independently chooses momentary, short-term, or integrated display and colors. Export stores eleven floats per frame in a temporary fixed-width cache and supplies them to persistent Prism painters. Preview reanalyzes through the selected frame, so a backward seek reproduces integrated gating and peak state. Cache files are removed on success, cancellation, and error. Version 1 projects remain compatible.

## Gate evidence

The deterministic ten-second fixture has 0–2 s silence, a 1 kHz stereo sine at −23 dBFS RMS during 2–4 s in phase and 4–6 s anti-phase, the same sine in the left channel during 6–8 s, then silence with a 5 ms 12 kHz stereo burst at 8.10 s. That burst exposes an intersample true peak: FFmpeg `volumedetect` found a −3.5 dBFS sample maximum while Prism measured −0.352 dBTP. The review composition has unlike momentary and integrated loudness layers plus a vectorscope.

| Check | Result |
| --- | --- |
| Standards and signal response | **PASS:** Silence reads −60 LUFS in Prism. Momentary loudness at 3 and 5 s was −19.985 LUFS; at 7 s left-only it was −22.995 LUFS, a 3.01 LU drop. At 3 s, short-term was −24.613 LUFS because its three-second window includes earlier silence. Final integrated was −20.353 LUFS. FFmpeg EBU R128 independently reported −20.4 LUFS integrated on the source and encoded audio. |
| True peak | **PASS:** The burst reached −0.352 dBTP in Prism; FFmpeg reported −0.3 dBTP. The displayed peak held through frame 264, then decayed to −3.052 dBTP at frame 270 and −12.052 dBTP at frame 285. The frame-clocked FIR port's cumulative maximum matched Prism native within 0.05 dB at sampled frames. |
| Sample rates | **PASS:** Additional 44.1 and 96 kHz versions retained about −20.35/−20.37 LUFS integrated. Native/port true-peak maxima agreed within 0.05 dB at each tested one-second checkpoint. FFmpeg reported −20.4 LUFS integrated for both and true peaks of −0.1/−0.4 dBTP, matching the native rounded values. |
| Two instances and editor | **PASS:** Momentary and integrated layers received identical analysis and matched each layer analyzed alone. Preview and export cache readings were exactly equal at frame 270. Still PNGs at 1, 3, 5, 7, 8.13, 8.8, and 9.5 s were visually inspected. The 3 s PNG reproduced byte-for-byte after a 9.5 → 3 s backward seek, readout change/restoration, save/reopen, and a 580 → 540 → 580 width change. JSON preserved both readouts, colors, and positions. |
| Editor versus MP4 | **PASS:** Numbered frames 90, 150, 210, 244, 264, and 285 were compared with matching stills. Whole-frame PSNR ranged from 38.95 to 42.34 dB; meter regions were at least 36.50 dB. All exceeded the 30 dB whole-frame and 25 dB region gates. Sampled editor and encoded frames were visually inspected. |
| MP4 and audio | **PASS:** The 720p review video and ignored 1080p export fully decoded. Both have 300 H.264 `yuv420p` frames at 30 FPS, AAC audio, and 10.000 s duration. Source/output channel correlation exceeded 0.98 at 3, 5, and 7 s; in-phase, anti-phase, and left-only relations remained correct. FFmpeg measured −20.4 LUFS and −0.3 dBTP in both source and encoded audio. |
| Cancellation and regression | **PASS:** Cancellation after 30 rendered frames left no final or partial MP4, temporary loudness cache, or test encoder/decoder process. Fresh editor/export smokes passed for spectrum/vectorscope, oscilloscope, spectrogram, waveform, and VU. Browser build, strict TypeScript, project/PCM tests, syntax checks, and `git diff --check` passed. |

Review artifacts: [720p MP4](../samples/phase3/loudness-gate.mp4), [silence](../samples/phase3/loudness-silence.png), [tone](../samples/phase3/loudness-tone.png), [anti-phase](../samples/phase3/loudness-anti-phase.png), [left only](../samples/phase3/loudness-left-only.png), [pulse](../samples/phase3/loudness-pulse.png), [peak hold](../samples/phase3/loudness-hold.png), [peak decay](../samples/phase3/loudness-decay.png), and [short-term readout](../samples/phase3/loudness-short-term.png). The source fixtures, saved project, 1080p MP4, and numbered comparison frames are under ignored `artifacts/phase3/`.

## Commands, performance, and limits

Commands run: `python phase3/test/make-loudness-fixture.py` at 48, 44.1, and 96 kHz; `node phase2/build.cjs`; strict TypeScript over the app modules; `node --test phase2/test/project.test.cjs phase1/test/pcm-reader.test.cjs`; Electron loudness and five prior-meter smoke scripts; `python phase3/test/compare-loudness-frame.py` for six numbered frames; `python phase3/test/verify-loudness-export.py` for both presets; `node phase2/export.cjs` for 1080p and cancelled jobs; syntax checks; and `git diff --check`.

The fresh 1080p export took **13.92 s**, with **10.82 s** in the render/PNG bridge and **0.41 s** of encoder backpressure; peak Electron main-process RSS was **118,521,856 bytes**. These observations exclude renderer, FFmpeg, and cache memory and are not performance guarantees.

Prism's painter has a fixed −14 LUFS target guide, which the editor can recolor but not reposition. Its L/R bars use the native fast envelopes; selectable fast/slow RMS windows and M/S input routing are not exposed. The frame-clocked true-peak port performs extra FIR work in JavaScript during analysis. Still previews process from the song start, so long-song seeks can be slow. Prism floors silent loudness at −60 LUFS while FFmpeg reports lower numerical silence values; the displayed floor is intentional in the pinned painter.

Next recommended phase: Phase 3.7 waterfall, only after user approval.
