# Phase 3.3: Prism spectrogram

## Architecture and provenance

- Based on merged main `941d287` and pinned Prism `49721802252b115d169e353c98b27408daa5e2b7`. Astrofox code is not used. The Prism checkout is unchanged.
- Reuses `upstream/prism/native/src/spectrogram.cpp`, `spectrogram.h`, and `main.cpp` for stereo FFT, temporal columns, scale, orientation, clarity, contrast, tilt, and heat values. The analyzer combines stereo channel powers, so anti-phase material remains visible. Reuses the original `upstream/prism/src/renderer/visualizers/Spectrogram.ts` Canvas painter for the scrolling history, color LUT, and frequency grid. The build inserts only the same in-memory `renderFrame()` entry point used for earlier meters. No screen recording or replacement meter drawing is used.
- `phase3/spectrogram.cjs` advances each layer's native analyzer continuously from the start of the audio. Preview retains only the columns needed for the visible time span, then replays that history into a fresh Prism painter on a seek. Export writes variable-length native display/heat columns to a temporary disk cache per layer and feeds one frame's columns at a time to persistent Prism painters. The cache is removed after success, cancellation, or error. Row count follows the actual layer pixel dimensions at 720p or 1080p.
- Version 1 projects remain compatible. Each spectrogram layer saves independent FFT size, log/Mel/linear scale, horizontal/vertical orientation, frequency and dB ranges, speed, contrast, tilt, clarity, heat/mono scheme, grid, position, size, opacity, and color. The DAW timeline ruler is absent because this offline file editor has no DAW transport; Prism's frequency grid remains available.

## Verification

The ten-second 48 kHz stereo fixture has silence at 0–2 s, 440 Hz in-phase at 2–4 s, 440 Hz anti-phase at 4–6 s, 440 Hz left-only at 6–8 s, and 1 kHz in-phase at 8–10 s. The review composition contains a vectorscope and two spectrograms: horizontal/log/heat and vertical/Mel/mono. Both use a 1024-point FFT in this smoke; the UI and validation offer 1024–8192.

| Check | Result |
| --- | --- |
| Native signal and scrolling history | **PASS:** silence peak was 0. At 440 Hz, in-phase and anti-phase peaks were 1.0; left-only peak was 0.970. The horizontal log peak row moved from 248 at 440 Hz to 194 at 1 kHz; linear mode moved from row 440 to 427. At 8.1 s, the retained history contained both log rows 248 and 194, visible in the [transition still](../samples/phase3/spectrogram-transition.png). Scroll speed 1 generated 13 native columns in the sampled frame and speed 4 generated 50. |
| Two independent instances | **PASS:** horizontal frequency row count was 450, vertical was 570 at 720p. Reanalyzing either layer alone produced the exact same native history as the two-layer project. Preview and sequential export-cache columns were exactly equal at frames 105, 165, 225, and 270 for both layers. |
| Editor and project | **PASS:** silence, in-phase, anti-phase, left-only, transition, and 1 kHz stills were saved and visually inspected. The 3 s still matched byte-for-byte after a 9 → 3 s backward seek, project save/reopen, and width 570 → 540 → 570 resize. JSON retained distinct orientations, scales, colors, and layer geometry. |
| Editor versus video | **PASS:** MP4 frames 90, 150, 210, and 270 matched corresponding editor stills at 43.69, 43.60, 44.03, and 44.02 dB whole-frame PSNR. Their individual spectrogram regions exceeded 40 dB. The 8.1 s transition frame matched at 42.30 dB overall, with 42.11 dB horizontal and 40.00 dB vertical region PSNR. Sampled frames were visually inspected. |
| MP4 and audio | **PASS:** the [review MP4](../samples/phase3/spectrogram-gate.mp4) and local 1080p export each fully decoded as 300 H.264 `yuv420p` frames at 30 FPS with AAC audio and 10.000 s duration. Source/output left-channel correlation rounded to 1.00000 at 3, 5, 7, and 9 s; in-phase, anti-phase, and left-only right-channel relations were correct. AAC added 256 decoded frames (5.3 ms) of padding. |
| Cancellation | **PASS:** controlled cancellation after 30 rendered frames reported `Export cancelled` with process exit code 2. No final or partial MP4 or temporary spectrogram cache directory remained. |
| Regression | **PASS:** prior Spectrum analyzer, oscilloscope/mixed-meter, and original vectorscope editor/export smokes passed. `node --test phase2/test/project.test.cjs phase1/test/pcm-reader.test.cjs` passed 12/12. Browser bundle, strict TypeScript over the composition/editor/export files, and `git diff --check` passed. |

The first spectrum regression invocation found an existing output filename and stopped at the export step; rerunning with a fresh output name passed. The first standalone TypeScript invocation omitted Prism's ambient window and Node declarations; adding those project declarations passed. Neither left a code failure.

The review video and stills are in `samples/phase3/spectrogram-*`. The 1080p output and test project are under ignored `artifacts/phase3/spectrogram/`. To try your own song, run `node phase2/run.cjs`, import WAV/MP3/FLAC, add **Spectrogram** from the layer selector, choose its scale and orientation in the inspector, scrub to a timestamp, then choose a preset and **Render MP4**. The editor and exporter use the same Prism painter.

## Performance and limits

The ten-second 1080p export with two spectrograms and a vectorscope took **29.33 s** on this machine. It rendered 300 frames; the reported composition/PNG bridge time was 16.96 s and peak **Electron main-process** RSS was 177,287,168 bytes. The memory number excludes the renderer, FFmpeg, and disk cache. These are observations, not guarantees.

Native analysis advances in 30 FPS audio chunks, so fast transient history can differ slightly from live Prism's callback timing. A still preview reprocesses audio from the beginning through the requested time; very long-song seeks may be slow. Only the file-based frequency grid is presented, without Prism's DAW timeline labels. Later Phase 3 meters and composition features remain outside this subphase.
