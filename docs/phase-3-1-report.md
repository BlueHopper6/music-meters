# Phase 3.1 spectrum analyzer report

**Status: PASS for the first Phase 3 meter gate. Stop before Phase 3.2.**

## Source and implementation

- Branch: `feature/phase-3-spectrum-analyzer`, based on merged `main` commit `a5ee43f13ea04c3db5110550d327929ab25cc62d`.
- Reused Prism commit `49721802252b115d169e353c98b27408daa5e2b7`: native C++ `native/src/spectrum.cpp` and `native/src/main.cpp` for Hann-windowed FFT, calibrated dB bins, mid/side channel magnitudes, and smoothing; Canvas `src/renderer/visualizers/SpectrumAnalyzer.ts` for frequency guides, scale mapping, dB projection, and line drawing. The pinned upstream checkout was not edited. As for the vectorscope, the build inserts a small public `renderFrame()` call into the pinned painter source **in memory**.
- Prism's current N-API module exposes one process-wide spectrum analyzer. `phase3/spectrum.cjs` therefore makes one continuous, frame-boundary PCM pass for each distinct FFT-size/smoothing pair. Preview reprocesses from song start through the selected frame; export writes temporary, sequential binary snapshots and streams one frame of data from each configuration into the shared `phase2/composition.ts` renderer. Two layers can share a snapshot when their DSP settings match, while keeping independent scale, range, color, geometry, opacity, and side-line drawing. The temporary files are removed on success, cancellation, or error.
- The project schema remains version 1 and accepts older vectorscope-only projects. Spectrum layers add FFT size (1024/2048/4096/8192), smoothing (0–0.99), log/Mel/linear scale, frequency and dB bounds, and an optional side-channel line. The editor saves/reopens these settings and uses the same Canvas composition as the MP4 export. No screen recording or substitute meter implementation is used.
- Astrofox remains a source reference at `ef3312505eb2830f34440da0196fa1ec545be659`. No Astrofox code was imported in this subphase. See [meter parity](meter-parity.md) for supported and pending modes.

## Run and inspect

Run `node phase2/run.cjs` from the repository root after the Phase 0 prerequisites are installed. Choose **Spectrum analyzer** in the Add meter selector. For the review signal, run `python phase3/test/make-fixture.py` first; it creates an ignored WAV under `artifacts/phase3/` with silence (0–2 s), 440 Hz in-phase (2–4 s), 440 Hz anti-phase (4–6 s), 440 Hz left-only (6–8 s), and 1 kHz in-phase (8–10 s).

Committed review samples are `samples/phase3/spectrum-gate.mp4`, `editor-window.png`, and the `silence.png`, `in-phase.png`, `anti-phase.png`, `left-only.png`, and `one-khz.png` stills. The full local proof set is under ignored `artifacts/phase3/`, including the 1080p MP4, frame extracts, saved project, and smoke result JSON. Input audio is not embedded in project JSON or uploaded.

## Gate results

| Criterion | Result |
| --- | --- |
| Native frequency and level | **PASS:** With a 0.5-amplitude sine, 1024-point Prism FFT found 440 Hz at 421.875 Hz / −6.865 dBFS and 1 kHz at 984.375 Hz / −6.647 dBFS, each within one bin. 2048 and 8192 sizes found 445.313 Hz / −6.310 dBFS and 439.453 Hz / −6.070 dBFS respectively. At 44.1 kHz mono, the 2048-point peak was 430.664 Hz / −6.929 dBFS and side-channel bins stayed at the silence floor. |
| Silence and stereo channels | **PASS:** Silence reached Prism's −120 dB floor. Anti-phase 440 Hz produced −120 dB mid and −6.865 dB side at the tone bin; left-only mid dropped 6.021 dB relative to in-phase. The corresponding preview images were visually inspected. |
| Two independent instances | **PASS:** A 1024-point unsmoothed log layer and a 4096-point, 0.8-smoothed linear layer with a side line appeared together with the existing vectorscope. Reanalyzing the first layer alone yielded identical bins. The editor saved/reopened all three layers and settings; switching to Mel changed the drawing and reopening restored linear. |
| History and seeking | **PASS:** The 10-second still at 3 s matched exactly after seeking to 9 s and back, including after JSON reopen. On a 180-second stereo fixture, bins at 90 s matched exactly after a 90 → 150 → 90 s seek, and differed from 150 s. Analysis uses the same sample boundary and update cadence as export. |
| Editor versus MP4 | **PASS:** The UI rendered a 10.000-second 1280×720 MP4 with 300 H.264 `yuv420p` frames and AAC audio. Sampled frames at 3, 5, 7, and 9 s matched editor stills at 41.84, 44.23, 41.63, and 42.31 dB whole-image PSNR. Each meter region exceeded 32 dB PSNR, and the vectorscope horizontal trace edges differed by at most one pixel. The layer-aware comparison avoids mistaking teal spectrum pixels for vectorscope pixels. All sample frames were visually inspected. |
| Sound and 1080p | **PASS:** Full-file FFmpeg decode passed for the UI 720p and saved-project 1920×1080 exports. Decoded audio matched the source at the in-phase, anti-phase, left-only, and 1 kHz sections; silence RMS was zero. The source/output correlation at tested non-silent times was 1.00000 to reported precision. AAC introduced 256 decoded sample frames (5.3 ms) of padding; it is lossy and no mastering/effects were applied. |
| Cancellation and regression | **PASS:** Controlled cancellation after 30 rendered frames reported exporter exit code 2, removed final/partial MP4s and temporary spectrum snapshots, and left neither tested FFmpeg child PID running. The prior vectorscope editor smoke and Phase 1 audio verifier passed after the integration. |
| Automated checks | **PASS:** `node --test phase2/test/project.test.cjs phase1/test/pcm-reader.test.cjs` passed 8/8; build and syntax checks passed. The Phase 3.1 numerical/editor smoke, `phase3/test/verify-export.py`, four layer-aware frame comparisons, 1080p verification, and cancellation checks passed. |

The first integration run found that the build seam still matched only `Vectorscope.ts`; it was corrected to match Prism's spectrum painter too. An older image checker then misidentified teal spectrum pixels as vectorscope trace pixels in the anti-phase frame. The dedicated layer-aware checker passed all four frames. No unresolved test failure remains.

## Performance and limits

The two-spectrum plus vectorscope 1080p project rendered 10 seconds in **14.136 s** on this machine, including the two spectrum prepasses. The render/PNG bridge accounted for 11.474 s, vectorscope PCM/DSP progression 0.096 s, and encoder backpressure 0.438 s. Peak **Electron main-process** RSS was 124,301,312 bytes; that figure excludes the renderer, FFmpeg processes, and temporary files. For the tested two configurations, snapshots occupy about 6.1 MB before cleanup. These are observations, not guarantees.

Native spectrum smoothing is updated once per 30 FPS video frame, so its transient response can differ from live Prism's variable GUI/audio chunk cadence while remaining deterministic between preview and export. Preview seeks decode from the start for each distinct FFT/smoothing pair, which can be slow on long tracks; export uses temporary disk space proportional to song length, frame rate, and FFT sizes. Independent C++ analyzer instances, spectrum L/R mode, 16384 FFT, heatmap/color bars, tilt, reference curve, and peak frequency readout are not yet exposed. The app is still a local development build.

**Next:** Phase 3.2 oscilloscope, after explicit user approval. **Waiting for approval: YES.**
