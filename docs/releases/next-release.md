# MusicMeters 1.0.0 - Windows x64

Unpublished release candidate draft. Target version: 1.0.0. Publication date, final source revision, exact download hashes, and final validation are pending. Do not publish until those fields and the remaining release checks are complete.

MusicMeters brings live audio-driven video preview, portrait compositions, eight redesigned templates, and a more integrated editor to its first full feature release. Build a layout with meters, artwork, and text, listen and preview while editing, then export your video locally.

This release also establishes a complete feature baseline covering the earlier portable preview. The [changelog](../../CHANGELOG.md) distinguishes new changes from existing capabilities.

## Video preview

- Play and pause source audio while meters render on the editable canvas.
- Mute, scrub, use keyboard transport controls, or enter a timecode to jump directly.
- Preview starts with local analysis rather than waiting for a full-song render. Rolling history and cumulative loudness restart after seeking; full-history still and export remain available.

## Portrait compositions and editor controls

- Create landscape 16:9 or portrait 9:16 compositions and export at 720p or 1080p, 30 FPS.
- Use the integrated File, Templates, and Help menus, window controls, and export dialog.
- Quit from the Project Manager or editor with Save/Discard/Cancel protection for unsaved work.

## Templates and styling

- Choose Afterglow, Contour, Night Radio, Observatory, Synthwave, Minimalist Ambient, Social, or Hyper Chase.
- Customize typography and artwork; Social provides a vertical starting point.
- Give meter and text layers independent background color and opacity.

## Included feature baseline

- Eight Prism-based visualizers: spectrum, oscilloscope, vectorscope, spectrogram, waveform history, VU, loudness/peak, and waterfall.
- Editable layers, artwork, text, solid/gradient/image backgrounds, snapping, rotation, and aspect locking.
- Local projects with media relinking, recent projects, saved markers, and reusable custom templates.
- MP4/H.264 with lossy AAC up to 320 kb/s, or MKV/H.264 with supported source audio copied without re-encoding.
- Export progress, cancellation, output overwrite protection, and partial-file cleanup.

## Windows installation

- Branded MusicMeters.exe with the application icon and Windows product details.
- Assisted setup for your Windows account, with a MusicMeters Start menu shortcut and uninstall entry.
- Existing templates and preferences retain their original storage location; uninstall preserves that data.
- A portable folder remains available to package separately. FFmpeg/FFprobe remain external prerequisites; no automatic updater is included.

## Runtime update

MusicMeters 1.0.0 targets Electron 45.1.0 with embedded Node 24.22.1 and Chromium 156.0.8078.49. This addresses the embedded-Node patch gap recorded for the initial preview. It does not establish that the application is free of security issues. See the [Electron release notes](https://releases.electronjs.org/release/v45.1.0) and [Node security release](https://nodejs.org/en/blog/release/v24.22.1).

## Download and run

Two Windows x64 options are planned for the final release:

- **Setup EXE:** run setup to install MusicMeters for your Windows account. Open MusicMeters from the Start menu afterward; Windows can index its shortcut for search. Setup also adds an uninstall entry in Windows settings.
- **Portable ZIP:** extract the entire folder and open `MusicMeters.exe`. Keep the other files beside it.

Install FFmpeg and FFprobe separately and put both on PATH before starting MusicMeters. Verify `ffmpeg -version` and `ffprobe -version` in a new terminal. Node.js, Python, and developer build tools are not needed to run the downloaded app.

Open **New from template…**, import a local WAV, MP3, or FLAC file, customize the layout, press **Play**, then choose **Export…**. Keep saved project JSON with its `.assets` folder and its separately referenced audio.

## Known limitations

- Windows x64 only; Linux and macOS have not been validated.
- The application and setup are unsigned. Verify the official download and checksum; do not disable Windows protections to run an unverified copy. No automatic updater is included.
- FFmpeg/FFprobe are external requirements. System fonts may differ between computers, and moving projects can require media relinking.
- Live preview restarts rolling history and cumulative loudness after a seek with a short local warm-up. Full-history still and final export analyze through the required song history.
- MP4 audio uses lossy AAC, targeting up to 320 kb/s with lower targets for mono and low-sample-rate sources. MKV source-audio copy preserves supported compressed/PCM packets; MP3 remains lossy, and the container/metadata/padding are not byte-identical to the original file.
- Final manual installation, Windows search, native dialogs, and download-triggered SmartScreen observations are not yet recorded for this candidate. Hosted install/reinstall/uninstall automation is distinct from those manual checks.

## Source and licenses

The final download set must include the exact matching source archive beside setup and the portable ZIP. It contains MusicMeters source and build scripts, pinned Prism source, node-addon-api source, lockfiles, license notices, and the recorded native build configuration. GitHub's automatically generated source archive alone is insufficient.

The software code is GPL-3.0-only. Preserve the included notices. The MusicMeters logo and icons have separate artwork terms in [LICENSE-NOTICES.md](../../LICENSE-NOTICES.md). Follow the [release checklist](../release-checklist.md) and included `BUILD-CONFIGURATION.md` when rebuilding; developer path trimming does not alter pinned Prism source or disable assertions.

## Validation

Final release validation is in progress. Before publication, record the exact application revision and completed CI link for that revision, then summarize packaged checks, corresponding-source rebuild, native-path privacy scans, and manual observations separately. Earlier preview/installer-PR results do not validate the final 1.0.0 bytes or the updated runtime.

## Exact downloads

Planned filenames; final sizes and SHA-256 values are pending final committed-source packaging and approval:

| Download | Filename | SHA-256 |
| --- | --- | --- |
| Windows setup | `MusicMeters-1.0.0-windows-x64-setup.exe` | Pending |
| Windows portable | `MusicMeters-1.0.0-windows-x64.zip` | Pending |
| Corresponding source | `MusicMeters-1.0.0-source.zip` | Pending |

Publish the approved source archive with equivalent access beside both binaries, and verify anonymous downloads after upload. These draft names are not evidence that assets have been built or released.
