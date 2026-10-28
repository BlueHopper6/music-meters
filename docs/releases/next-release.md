# MusicMeters — upcoming release notes draft

Unpublished draft. Choose the version, date, and distribution format during final release preparation. Replace all preparation paragraphs with verified information before publication.

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

## Download and run

Preparation: supply exact approved asset names and instructions for the final distribution format. Current source builds a branded portable folder and setup EXE. Publish setup instructions only after its lifecycle checks pass; the previous preview still launches through `electron.exe`. Windows x64 requires external FFmpeg and FFprobe on PATH. Users need no Node.js or build tools.

## Known limitations

Preparation: record the final package's actual signing, installer/updater, Electron/embedded-Node security status, clean-Windows/manual testing scope, and any accepted exceptions. Recheck these for this release. Linux and macOS remain unvalidated. Mention preview history reset and external media/fonts where relevant.

## Source and licenses

Preparation: name the exact corresponding source archive offered beside every binary. Retain GPL-3.0-only software and separate branding notices, include pinned Prism source, and link rebuild instructions. GitHub's automatically generated source archive alone is insufficient.

## Validation

Preparation: give the exact source revision and link completed CI for that revision. Summarize automated checks and manual observations separately. Historical results must not be presented as results for this release.

## Exact downloads

Preparation: list final filenames, sizes, and SHA-256 hashes after all bytes are final. Obtain approval for the exact binary/source pair before upload and verify anonymous downloads afterward.
