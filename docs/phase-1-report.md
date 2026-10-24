# Phase 1 offline export report

**Status: PASS for the Phase 1 gate. Stop before Phase 2.**

## Implementation

- Branch: `feature/phase-1-offline-export`, created from the updated `main` merge commit `b2ce7d45ced2a5f6af243bb08879453d3d6a157b`.
- Prism remains pinned to `49721802252b115d169e353c98b27408daa5e2b7` in ignored `upstream/prism/`. The runner checks that pin. It uses Prism's native C++ vectorscope analyzer and original Canvas painter. At build time, a narrow adapter adds an explicit `renderFrame()` entry point to the pinned `Vectorscope.ts` source in memory; it does not replace the drawing logic or edit the upstream checkout.
- `phase1/export.cjs` validates paths and options, bundles the renderer, and starts a hidden Electron job. `phase1/pcm-reader.cjs` streams FFmpeg-decoded 32-bit stereo PCM into the analyzer. The job advances exactly to each 30 FPS sample boundary, obtains Prism's points, draws the original Canvas scope offscreen, and streams one PNG at a time to FFmpeg. FFmpeg encodes H.264 `yuv420p` and muxes a separate AAC encode of the input audio with no audio filters, mastering, or effects. AAC conversion is lossy.
- The exporter has 720p and 1080p presets, configurable output path and title, frame/time progress events, timing fields, cancellation, process cleanup, and atomic promotion of a temporary MP4 after success. It refuses to overwrite an existing output. The PCM stream and encoder stdin use backpressure; the job never accumulates all decoded samples or frames.
- Astrofox's offline export structure was inspected in Phase 0. Importing its platform and stage dependencies would complicate this single-meter export core; no Astrofox code is bundled here.

## How to run

Use the Phase 0 report's pinned Prism setup and have `ffmpeg` and `ffprobe` on PATH. From the project root:

```powershell
python phase1/make-fixtures.py
node phase1/export.cjs --input artifacts/phase1/fixtures/stereo-10s-48k.wav --output artifacts/phase1/example.mp4 --preset 720p --title 'Stereo Phase Study'
python phase1/verify-export.py artifacts/phase1/fixtures/stereo-10s-48k.wav artifacts/phase1/example.mp4 --duration 10
```

Use a new output path for each run. Press Ctrl+C to cancel an active CLI export; the wrapper sends a cancellation marker to the Electron job and waits for decoder, encoder, and partial-file cleanup. `--cancel-after-frames N` is an integration-test hook.

## Gate evidence

| Check | Result |
| --- | --- |
| Import and channels | **PASS:** 48 kHz stereo WAV, 44.1 kHz mono WAV, 48 kHz FLAC, and 48 kHz MP3 exported. Mono is duplicated only for Prism analysis; output audio is encoded directly from the source file. |
| 10-second 720p output | **PASS:** 300 H.264 `yuv420p` video frames at 30 FPS, AAC, 10.000 s; whole-file decode and source/output audio correlation checks passed. |
| 10-second 1080p output | **PASS:** FLAC input produced 1920×1080 H.264 `yuv420p`/AAC MP4 with 300 frames; whole-file and audio checks passed. |
| Three-minute output | **PASS:** 48 kHz stereo WAV produced 5,400 frames, 180.000 s, H.264 `yuv420p`/AAC. Whole-file decode and audio checks at 30, 90, and 150 s passed. |
| Audio alignment | **PASS:** The verifier decodes the source and MP4 audio, checks sample-count difference within 50 ms, source/output correlation above 0.94, expected stereo phase or mono relation, and the complete video decode. The long WAV export differed by 512 audio sample frames (10.7 ms) due to AAC padding. No audio effects were applied. |
| Visual output | **PASS:** Frames extracted from the encoded long MP4 at 30, 90, and 150 s were viewed and show rising-diagonal, vertical, and falling-diagonal scope traces. A mono frame and a 1080p FLAC frame were also viewed. |
| Determinism | **PASS:** Two complete 10-second WAV exports after the cancellation fix had identical MP4 SHA-256 hashes. Sample progression is indexed to output frames, independent of wall-clock timing. |
| Cancellation | **PASS:** A 30-frame cancellation hook and an actual Ctrl+C cancelled exports, stopped the encoder and decoder, removed partial output, and left no tested child PID running. The controlled cancellation returned exit code 2. |
| Error handling | **PASS:** Missing input, unsupported extension, existing output, and corrupt WAV produce errors without a finished or partial MP4. |
| Regression tests | **PASS:** `node --test phase1/test/pcm-reader.test.cjs` passed 3/3: irregular read continuity, mono duplication for analysis, and prompt close of a partly consumed long decoder. `node --check` passed for all three CommonJS modules. |

The first cancellation implementation hung while waiting for an unread FFmpeg stdout stream to close. The reader now destroys that pipe and waits for process exit, with a force-kill timeout. The first Ctrl+C test let Electron receive the console interrupt before cleanup; the wrapper now starts it in a separate Windows process group and sends the cancellation marker. Both paths passed retests. A restricted sandbox also blocked one later Electron launch; rerunning the same long export with normal process access succeeded.

## Performance and memory

The verified three-minute export completed in **126.504 s** on this machine: **1.475 s** decoding/DSP progression, **117.944 s** offscreen frame rendering and PNG transfer, and **2.059 s** waiting on encoder backpressure. These categories do not sum to total wall time because encoder completion and setup take additional time. The earlier 180-second run took 123.219 s. The 1080p 10-second export took 13.676 s. These are observed runs, not throughput guarantees.

During the second three-minute run, Electron's main-process RSS peaked at **131,555,328 bytes**. Sampled aggregate Electron working set started at **314,444 KiB** after the first second, peaked at **447,488 KiB**, dropped repeatedly after garbage collection, and ended at **398,864 KiB**. The job finished without a hang or memory exhaustion; the sample does not establish behavior for songs longer than three minutes. Electron's aggregate metric does not include the separate FFmpeg processes. The working-set value uses Electron's documented KiB unit: [MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info/).

## Review artifacts and limits

- Committed review samples: `samples/phase1/stereo-10s-720p.mp4`, `flac-10s-1080p.mp4`, and `long-90.png`. The 720p and 1080p samples are copies of the verified short exports; the image is extracted from the verified three-minute export.
- Full verified video: `artifacts/phase1/stereo-180s-720p-mem.mp4`; additional short exports: `artifacts/phase1/mono-10s-720p.mp4` and `mp3-10s-720p.mp4`. Other extracted visual checks are `long-30.png`, `long-90.png`, `long-150.png`, `long-mem-90.png`, `mono-5.png`, and `flac-1080p-5.png` there. These generated files are ignored by Git and remain in this workspace for inspection.
- The single Prism native analyzer is process-global. Multiple independent meters need instance ownership in a later phase. Phase 1 offers a CLI export core and a fixed representative layout; it does not implement an editor.
- PNG serialization and a JavaScript bridge are the present bounded frame transport. A raw pixel pipe may improve performance later, but was not needed to satisfy the measured three-minute gate.
- Prism is GPL-3.0-only. Distribution must meet its license obligations; this phase does not package FFmpeg or Electron for release.

**Phase 2 has not started. Waiting for explicit approval: YES.**
