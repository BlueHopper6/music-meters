# Phase 5: reusable projects and song workflow

```text
PHASE: Phase 5 — Save presets and minimize time-to-upload
STATUS: PASS
SOURCE COMMIT(S): Our base `498e3f14e2dd6e93116eee2b02358e65122ad9cd` (fetched `origin/main`); implementation `6e99eca04f465f496f95ca75462ce156f46a511b`; Prism `49721802252b115d169e353c98b27408daa5e2b7`; Astrofox `ef3312505eb2830f34440da0196fa1ec545be659`.
WHAT CHANGED: Added a local, versioned layout-template library with three original starters, duplicate/rename/use controls, missing-media relinking, Save As, song-aware editable title suggestions, remembered template/export choices, a 1080p default, output-name suggestion, and explicit existing-file handling. Complete version 1 and 2 project JSON remains compatible.
REUSED UPSTREAM CODE: Existing pinned Prism native analyzers and Canvas painters still drive preview and export through `phase2/composition.ts`; no upstream source was edited. Astrofox was only a source reference and no Astrofox module was imported.
TESTS RUN: The commands and results below passed, except the intentional cancellation command, which reported `Export cancelled` and exited 1 in this Windows CLI while cleanup checks passed.
REAL ARTIFACTS: `artifacts/phase5/gate-1792891951773/` contains the generated A/B audio and artwork, template library, B project and copied assets, 1080p MP4, repeat MP4, editor stills, extracted frame 60, logs, and JSON verification. `artifacts/phase5/gate-1792891951773/relink-1792891985083/` contains the missing-media screenshot and repaired project. The Phase 4 regression is under `artifacts/phase4/gate-1792892024522/`. These paths are ignored local artifacts; no personal media is committed.
VERIFICATION: The final B MP4 fully decoded as H.264 `yuv420p` 1920×1080/30, 120 frames, 4.000 s, with stereo 48 kHz AAC. Decoded audio correlated 0.999901 with B and 0.000667 with A; the 880 Hz output tone dominated 440 Hz. All 120 decoded video-frame SHA-256 hashes matched a repeat export. The B editor still and encoded frame 60 were inspected visually; the 1080p frame was downscaled for a 28.75 dB whole-frame PSNR comparison (artwork 37.07, oscilloscope 32.82, spectrum 34.10 dB).
PERFORMANCE: One 4 s, 1080p/30 repeat export took 9.092 s in the exporter, including 7.704 s frame rendering/transfer and 0.398 s encoder backpressure. Peak Electron main-process RSS was 175,181,824 bytes; renderer and FFmpeg memory are excluded.
KNOWN ISSUES / LIMITATIONS: Native Windows picker clicks and the normal existing-file dialog were not manually driven; automated tests injected local paths and checked that an existing MP4 stayed unchanged. Long-song performance and other machines' font installations were not tested in this phase. Templates are local to this device's Electron user data; there is no external template import/export UI. A background image is intentionally retained as layout styling; every text body and artwork-layer path is cleared. The optional short test-render button was not implemented. AAC is lossy.
NEXT RECOMMENDED PHASE: Phase 6 hardening and release work, only after explicit approval.
WAITING FOR USER APPROVAL: YES
```

## Workflow and data rules

The feature branch was created from a clean worktree after fetching `origin/main`; both local and remote main resolved to `498e3f14e2dd6e93116eee2b02358e65122ad9cd`. Phase 5 changes were made only on `feature/phase-5-presets-workflow`.

Version 1 and 2 project files still store relative audio references; version 2 artwork is copied into the project's sibling `.assets` folder. Saving now switches the active editor to those copied artwork paths, so the current session uses the same artwork as the saved project. **Save as…** gives the next song its own JSON and asset folder. When an opened project's audio or artwork is missing, the editor lists each missing reference and offers a Relink button. Missing artwork is omitted from the editor's asset preview until relinked, while export still requires complete media.

Template files have `kind: music-visualizer-template` and `version: 1`, live under Electron user data, and are validated before load. They keep layer geometry, order, visibility, lock state, opacity, meter settings, typography, background colors, and any background image copied into the template's own `.assets` folder. They clear the audio path, project title, every text body, and every image-layer path. Applying a template keeps the currently imported song and suggests its title in a layer named **Song title**. Audio replacement invalidates pending preview work and clears the previous still analysis. An automatically suggested title changes with an automatically named audio file; a manually edited title stays editable and is preserved when audio alone is replaced.

The editor remembers the selected template and 720p/1080p export choice in local preferences. The normal export dialog suggests `<title>_visualizer.mp4`. If the chosen file exists, it asks for another name or cancellation and does not overwrite. The headless injected-path test also confirmed an existing MP4 is rejected without altering its SHA-256 hash.

## Gate and regression evidence

The final Phase 5 editor gate imported generated stereo 440 Hz song A, used and adjusted the Studio Dashboard starter, selected generated artwork A, and saved a custom template. It duplicated and renamed the template, switched to generated stereo 880 Hz song B, loaded the saved layout, changed title text and artwork, saved/reopened the B project, then exported B at the default 1080p/30. The gate checked the spectrum layer's X coordinate of 85 and seven-layer order after template reuse and project reopen. A later audio-only replacement check confirmed a manually edited project name and title text stayed intact. A and B preview PNG hashes differed; visually, the spectrum peak moved from 440 Hz to 880 Hz and the oscilloscope gained the expected denser cycles. The B encoded frame shows the B title and B artwork, with no A artwork or title. The audio comparison above rules out A sound in the B MP4.

The relink regression copied B's project JSON to a fresh folder without its audio or `.assets` folder. In a second Electron launch, both missing references appeared with visible Relink buttons. Choosing B audio and artwork, saving, and reopening removed both missing-media warnings. That second launch also restored the saved template selection and 1080p choice. The screenshot was viewed to confirm the controls were visible.

The existing Phase 4 composition gate passed again after the last project-save change. It covers meter preview/export, artwork/text/background layering, save/reopen, and the merged installed-font picker. Its version 1 legacy smoke also passed. The final cancellation check stopped a 720p B export at frame 30; neither final nor partial MP4 remained, and the logged decoder/encoder PIDs had exited. Its Windows command returned 1 even though the exporter reports cancellation; this matches the behavior documented by Phase 4.

### Commands and results

| Command | Result |
| --- | --- |
| `node --test phase5/test/templates.test.cjs phase2/test/project.test.cjs phase4/test/assets.test.cjs phase2/test/fonts.test.cjs phase1/test/pcm-reader.test.cjs phase3/test/vectorscope-correlation.test.cjs` | PASS, 31/31. Includes template clearing, copied background, duplicate/rename, invalid paths, preferences, old schema, fonts, and DSP checks. |
| `node phase2/build.cjs` | PASS. |
| `node upstream/prism/node_modules/typescript/lib/tsc.js --noEmit --strict --skipLibCheck --allowJs --checkJs false --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --typeRoots upstream/prism/node_modules/@types --types node upstream/prism/src/renderer/env.d.ts phase2/composition.ts phase2/editor.ts phase2/export-renderer.ts` | PASS. |
| `node phase5/test/run-gate.cjs` | PASS; final directory `artifacts/phase5/gate-1792891951773/`. |
| `node phase5/test/run-relink.cjs artifacts/phase5/gate-1792891951773` | PASS; final relink directory named above. |
| `node phase2/export.cjs --project artifacts/phase5/gate-1792891951773/song-B-project.json --output artifacts/phase5/gate-1792891951773/song-B-repeat-1080p.mp4 --preset 1080p` | PASS; 120 frames, 9.092 s exporter time. |
| `python phase5/test/verify-gate.py artifacts/phase5/gate-1792891951773` | PASS; full decode, streams/duration, A/B audio comparison, frame 60 comparison, and all-frame deterministic repeat. Details in `verification.json`. |
| `node phase4/test/run-gate.cjs` and `node phase4/test/run-legacy.cjs artifacts/phase4/gate-1792892024522` | PASS; composition, font picker, save/reopen, 720p export, and version 1 compatibility. |
| `node phase2/export.cjs --project artifacts/phase5/gate-1792891951773/song-B-project.json --output artifacts/phase5/gate-1792891951773/cancel-check-720p.mp4 --preset 720p --cancel-after-frames 30` | Expected cancellation, CLI exit 1; no final/partial output or live child PIDs. |
| `git diff --check` | PASS before implementation commit. |

Representative files: `song-A-preview.png`, `song-B-preview.png`, `song-B-frame-60.png`, `song-B-1080p.mp4`, `song-B-repeat-1080p.mp4`, `song-B-project.json`, `gate-summary.json`, and `verification.json` in the final Phase 5 gate directory; `missing-media.png` and `relink.log` in its final relink directory. The tests used generated audio and original generated artwork only.
