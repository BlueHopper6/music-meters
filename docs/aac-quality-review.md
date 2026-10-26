# AAC export quality review (2026-10-25)

This report covers the `feature/aac-export-quality` development branch. It is not a public binary or clean-machine release validation.

MP4 export now requests AAC at up to 320 kb/s for standard stereo and explicit lower targets for mono and low-sample-rate sources. AAC remains lossy, and FFprobe's observed bitrate varies with the signal. The MKV choice is labeled **Source audio copy (no re-encode)** because copying an MP3 stream does not make its audio lossless. The existing supported MP3, FLAC, and WAV/PCM stream-copy path remains unchanged.

A short 8 kHz WAV could previously reach frame zero with no decoded analyzer samples in the packaged exporter, including in a package built before this branch. Opening the FFmpeg decoder immediately before the render loop resolved the failure in the fresh packaged matrix. This changes decoder start timing only; it does not add audio processing.

All paths below are ignored, isolated local test outputs:

| Check | Result |
| --- | --- |
| `node --test` focused project, audio, template, space, and meter tests | 38/38 passed |
| Strict `tsc` check of editor, composition, and export renderer | Passed |
| `node phase6/test/audio-matrix.cjs` using fresh packages `artifacts/phase6/aac-quality-package-20261025-01` and `-02`, outputs `artifacts/phase6/aac-quality-matrix-20261025-01` and `-02` | Two complete runs passed. Each covered eight MP4/AAC inputs: mono 8/44.1/48 kHz; stereo 44.1/48/96 kHz; silence; clipped MP3. FFmpeg decoded each result and FFprobe found 45 video frames and AAC. Overwrite, cancellation, unreadable input, and missing image checks passed. The 8 kHz mono output used a 32 kb/s target and had 12,000 decoded analyzer frames. |
| `node phase6/test/audio-copy.cjs`, output `artifacts/phase6/aac-quality-copy-20261025-01` | MP3 with unusual Unicode/punctuation filename, 24-bit and float PCM WAV, and FLAC retained their codecs. Audio packet hashes matched source streams; decoded-sample correlation was 1.0 after alignment. Repeat export, timing, full playback decode, overwrite, cancellation, encoder failure, codec, and extension checks passed. |
| `node phase6/test/run-audio-copy-editor.cjs`, output `artifacts/phase6/aac-quality-editor-20261025-02` | New labels and every export control's position at the 1000 px minimum window width passed; two editor MKV/FLAC exports had matching source audio packet hashes. |
| `node phase6/test/package-smoke.cjs`, output `artifacts/phase6/aac-quality-package-smoke-20261025-01` | Portable MP4 export with Unicode WAV filename produced 60 frames, AAC audio, and a decodable video. |
| `node phase6/test/run-repeat.cjs --package`, output `artifacts/phase6/aac-quality-repeat-20261025-01` | Two editor MP4 exports passed at 60 frames each; preview versus encoded frame mean RGB difference was 0.813. |

The older `docs/audio-export-report.md` remains the evidence for its original branch. These results do not establish that a future release candidate or public binary passed the release checklist.
