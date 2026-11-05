# MusicMeters 1.2.0 - Windows x64

Release candidate preparation; this version has not been published. Final download names, checksums, revision, and exact-package results are supplied with the frozen candidate before publication.

MusicMeters 1.2.0 adds video layers, independent soundtrack mixing and meter inputs, richer meter styling, and higher-quality export choices.

## Video and soundtrack mixing

- Import a local video and arrange artwork, text, and meters above or below it. Choose cover/contain, transforms, and freeze/loop/hide picture endings.
- Mix video audio and an imported WAV, FLAC, or MP3 with separate volume sliders, editable percentages, source mutes, and master output level.
- Drive meters from the final mix, video audio, or imported music independently of what listeners hear. For example, keep speech audible while the meters follow only the background music.
- Choose project duration from the video, imported audio, or longest source. Video audio plays once, and silent video is supported.

## Export quality

- Export 1440p or 2160p/4K at 30 FPS. H.264 uses a slow preset, CRF 16, and explicit SDR color metadata.
- MP4 targets up to 384 kb/s stereo AAC (192 kb/s mono; lower targets for low sample rates). AAC remains lossy.
- Choose MKV with 24-bit FLAC audio, or a large lossless RGB video/32-bit float PCM master. Eligible unchanged soundtracks retain source-audio copy.
- Mixed soundtracks use floating-point intermediates and preserve the highest input sample rate. Integer/lossy exports reject an overloaded mix rather than silently clipping.
- Adjustable gradient texture can help disguise banding. Upload services re-encode video and may remove texture or introduce new artifacts; an artifact-free streamed gradient cannot be guaranteed.

## Media storage and meter styling

- Choose Copy or Link for each image, audio, or video import in a themed, keyboard-accessible dialog. Copy preserves original file bytes when saving; Link saves disk space and requires the original file to remain available.
- Save As and project Copy/Move preserve those choices. Deletion preserves linked originals and modified copied files. Copied audio/video retain readable source filenames.
- Six coordinated meter palettes plus Prism appearance controls for trace width, grid/scale opacity, labels, spectrum line/gradient/heat fill, side color, heat colors, and oscilloscope underfill. Settings work with undo/redo, templates, preview, and export.
- Spectrum heat fill now receives raw FFT data and updates with the audio instead of appearing as a plain line.

## Editor improvements

- Ctrl+Q quits through the unsaved-changes guard; Ctrl+F toggles full-screen preview. Full-screen playback includes the timeline seek line and time readout.
- Save as Template uses a themed name field with a subtle focus treatment.
- Saving a blank or placeholder project title adopts the chosen JSON filename in the project field and window title. Explicit custom titles are preserved.
- Bundled Electron updated to 45.2.3 (embedded Node 24.22.2) with upstream Chromium and media-library fixes.

Implemented through [PR18](https://github.com/BlueHopper6/music-meters/pull/18), [PR19](https://github.com/BlueHopper6/music-meters/pull/19), [PR20](https://github.com/BlueHopper6/music-meters/pull/20), [PR21](https://github.com/BlueHopper6/music-meters/pull/21), [PR22](https://github.com/BlueHopper6/music-meters/pull/22), [PR23](https://github.com/BlueHopper6/music-meters/pull/23), and [PR24](https://github.com/BlueHopper6/music-meters/pull/24).

## Download and run

Windows x64 setup EXE and portable ZIP, with a matching complete source ZIP. Install FFmpeg/FFprobe separately and put both on PATH. Node.js and developer build tools are not needed. Run the setup for a per-user installation, or extract the whole portable folder and open MusicMeters.exe.

## Known limitations

Unsigned application/setup; no automatic updater; Windows x64 only. One video layer, SDR output, and 30 FPS. Linked originals must remain available. New video/storage/style projects require this version or newer for their new features. MP4/AAC is lossy; lossless options use MKV and can be much larger.

## Source and licenses

The complete matching source ZIP includes MusicMeters, the pinned Prism source, build scripts, lockfiles, and node-addon-api source. Software is GPL-3.0-only; branding is separately owned under the included notice. Preserve the matching source and license notices when redistributing an unchanged official release.

## Validation scope

The application source before release metadata/runtime updates passed 118 unit cases with zero skips, strict TypeScript, packaged feature/export checks, and Windows CI on merged commit 711cdba12a5e3df386c6c0929beb7748d7557571 ([workflow](https://github.com/BlueHopper6/music-meters/actions/runs/41988267055)). Those results used Electron 45.1.0.

At the owner's request, the full local regression suite and additional manual testing will not be repeated for this candidate. Focused final-package/runtime, source-pair, installer-payload, privacy, and integrity verification will be recorded with the frozen downloads. Clean-Windows manual, SmartScreen/download reputation, and cross-version upgrade checks remain unverified. The three locked dependency audits reported zero known vulnerabilities during preparation.
