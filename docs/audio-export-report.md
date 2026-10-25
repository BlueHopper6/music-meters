# Audio export option verification (2026-10-25)

This report covers the `feature/audio-preserving-export` development branch. It does not establish that a later public binary passed these checks.

The editor now offers **MP4 · AAC 192 kb/s** (the compatible default, with lossy audio conversion) and **MKV · copy source audio**. The latter accepts MP3, FLAC, and supported mono/stereo WAV PCM codecs after FFprobe validation. It copies the compressed or PCM audio packets into MKV without another audio encode. A remuxed video file and its metadata are different from the original audio file. The direct CLI uses `--audio-mode copy` with a `.mkv` output; omitting it retains MP4/AAC.

The MKV encoder reads the complete audio stream after the final video frame. A probe showed that FFmpeg's `-frames:v` limit could otherwise omit a final MP3 packet. The export path validates the selected extension, includes copied audio size in its disk-space estimate, refuses overwrite, and removes partial `.mkv` or `.mp4` files on cancellation or failure.

## Checks run

All paths below are ignored local test artifacts, not release packages.

| Check | Result |
| --- | --- |
| Packaged MKV matrix, `phase6/test/audio-copy.cjs`, output `artifacts/phase6/audio-fidelity-copy-matrix-20261025-a/` | MP3 with a Unicode/punctuation filename, 24-bit PCM WAV, float PCM WAV, and FLAC each produced 60 H.264 frames and the source audio codec. FFmpeg fully decoded each video. Demuxed audio packet bytes had the same SHA-256 as the respective source stream. Decoded-sample correlation was 1.0 after alignment. |
| Audio/video timing | WAV and FLAC starts and durations matched. The MP3 case had a 23 ms audio/video stream-start difference and a 40 ms container-duration difference; decoded samples aligned after 1,105 frames of MP3 priming, within one 30 FPS video frame. Matroska does not retain the MP3 source's gapless skip/padding side data in this FFmpeg path, so playback padding can differ at the edges. |
| MKV failure and repeat cases | Existing output was unchanged; repeated export passed; cancellation and simulated encoder failure left no final or partial file. ADPCM-in-WAV and wrong container extensions were rejected with specific errors. |
| Packaged editor, `phase6/test/run-audio-copy-editor.cjs`, output `artifacts/phase6/audio-copy-editor-20261025-e/` | The MKV selector changed the render action. An intercepted save dialog verified its MKV title, filter, suggested extension, and automatic extension completion. Two FLAC-copy exports succeeded in one editor session with matching source packet hashes. Export controls fit the minimum window width. |
| Existing MP4 regressions, package `artifacts/phase6/audio-fidelity-package-20261025-e/` | Package smoke decoded 60 H.264 frames and AAC audio. The nine-case audio matrix and simulated MP4 encoder-failure cleanup passed. The packaged editor exported twice; still/video mean RGB difference was 0.81. |
| Direct CLI and source checks | `node phase2/export.cjs --audio-mode copy` produced H.264/FLAC MKV. The direct build, strict TypeScript check, and 38 focused Node tests passed. A frame from the MKV/MP3 export was visually inspected. |

The native Windows save picker itself, other media players, hosted CI, and a clean-machine installation remain to be checked with the final release candidate. Earlier Phase 6 and public-release reports remain historical evidence for their own builds.
