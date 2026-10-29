# Changelog

User-facing release history, newest first. GitHub release notes provide the download announcement and exact package details; this file keeps the feature history with the source.

## Unreleased

### Added

- A three-dot menu on recent-project cards for Rename, Move to, Copy to, and confirmed Delete project. Rename updates the folder and filename; Delete recycles the project and recorded copied media while preserving originals. Copies include audio and artwork; moves verify the new files before removing the old project files and retain original audio tracks and unrelated content.
- Project undo/redo through the Edit menu and Ctrl+Z, Ctrl+Y, or Ctrl+Shift+Z, with grouped typing/dragging and up to 100 steps per session.

### Fixed

- First-save and Save As filename suggestions use the entered project name rather than the imported audio filename, with Windows filename sanitization.
- The New from Template dropdown and its open options list now match the app's dark styling while retaining native keyboard navigation.
- Space toggles preview playback after clicking or dragging the timeline. Timeline focus uses a playhead cue for keyboard users instead of a white box around the seek bar.
- Layout changes retain the live playback position after pausing. Template Manager no longer highlights a remembered dropdown selection as though it were the active layout.
- Still updates after undo/redo and layout changes run without locking the editor. Starting playback cancels the pending still update.
- Pressing Play immediately after seeking starts playback instead of being overridden by a delayed paused seek.
- Switching layouts through the editor's Template Manager keeps imported audio, the project title, preview position, and save location. Starting a new project from the Project Manager still starts without audio.

## [1.0.0](https://github.com/BlueHopper6/music-meters/releases/tag/v1.0.0) — 2026-10-27

This release establishes the first comprehensive changelog entry. Its feature inventory deliberately includes capabilities shipped in the earlier portable preview. That preview remains part of the release history; the sections below distinguish subsequent changes from the inherited baseline. Published October 27 in America/Indianapolis (October 28 UTC). See the [release notes](docs/releases/1.0.0.md) for exact downloads and validation.

### Added since v0.6.0-preview.1

- Branded MusicMeters.exe with application icon and Windows product details, plus an assisted per-user setup EXE with a MusicMeters Start menu shortcut and uninstall entry. Existing packaged templates/preferences keep their original storage location; setup adds no automatic updater. Exact-commit hosted Windows CI passed installation, installed startup/export, reinstall, uninstall, and profile-data preservation checks.

- Live video preview with source-audio playback and synchronized meters, without first encoding a video or analyzing the entire song.
- Play/pause, mute, Space shortcut, seek bar with a larger playhead drag target and arrow-key support, elapsed/duration display, and editable seconds or timecode seeking.
- Fast analysis for seeking even before the first Play, with short local history warm-up and an explicit full-history still option. Final export retains full-song analysis.
- Portrait 9:16 compositions with 720 × 1280 editing and 720p or 1080p vertical exports. Orientation changes fit and center the layout; projects and templates retain canvas dimensions.
- Integrated window title bar with minimize, maximize/restore, close, drag, double-click maximize, and F11/Escape app fullscreen controls.
- File, Templates, and Help menus with keyboard navigation; Save and Export actions in the title bar.
- Export dialog with resolution, format/audio mode, native destination browsing, and a save dialog when no output path has been selected.
- Explicit Quit MusicMeters actions in both the Project Manager and editor, using the existing unsaved-change guard.
- Independent background color and opacity for visualizer and text layers, preserved in projects and templates and rendered with the layer's rotation and opacity. Older projects default to transparent layer backgrounds.

### Changed since v0.6.0-preview.1

- Updated the shipped runtime from Electron 45.0.0 to 45.1.0, including embedded Node 24.22.1 and Chromium 156.0.8078.49. This includes the Node patch level missing from the initial preview; the final package passed application regression checks.
- Included reproducible native build configuration with the package and corresponding source so developer paths can be trimmed without changing Prism or disabling assertions.

- Replaced the original factory layouts with eight designed templates: Afterglow, Contour, Night Radio, Observatory, Synthwave, Minimalist Ambient, Social, and Hyper Chase.
- Added refined typography, lowercase layer names, editable song/artist/album/brand/genre placeholders, and hidden empty artwork slots that let factory designs preview and export before artwork is chosen.
- Social supplies a portrait layout; the other factory designs are landscape. Night Radio uses paired combined-stereo VU needles; Hyper Chase combines a rotated spectrum, cover slot, loudness, and waterfall overlay.
- Factory placeholder text stays as written when importing audio. Custom template saves and duplicates continue to clear text content and song media.
- Refined Project Manager branding and title state, editor command placement, and preview transport. Playback/seeking does not mark a project unsaved; an explicit Save preserves the selected preview marker.
- Reorganized the README around features, download instructions, and first steps; moved detailed controls and developer setup into dedicated guides; introduced this changelog.

### Complete feature baseline

The following capabilities carry forward from the initial preview alongside the additions above.

#### Audio and visualizers

- Local WAV, MP3, and FLAC import/replacement; offline analysis and video rendering.
- Eight independently configurable Prism-based meter types, with multiple meter layers in one composition.
- Spectrum analyzer: FFT size, smoothing, frequency scale/range, and side-channel controls.
- Vectorscope: five stereo projections, zoom, optional three-band traces/colors, and signed full-band/band correlation indicators.
- Oscilloscope: left-channel waveform, pitch-triggered or free-running display, underfill, and grid.
- Spectrogram: either scrolling orientation with frequency-scale, color, and analysis settings.
- Waveform history: mono left-channel or stereo lanes, scroll speed 1–8, and optional low/mid/high colors.
- VU: horizontal/vertical stereo bars, stereo/combined needles, configurable 0 VU reference, and colors.
- Loudness/peak: momentary, short-term, or integrated LUFS, stereo bars, true peak, and configurable readouts/colors.
- Waterfall: spectrum history with FFT, scale, history, density, smoothing, tilt, and color controls.
- Timestamp-based full-history still analysis, explicit refresh, stale-analysis status, and responsive editing during analysis.

#### Composition and projects

- Stage layer selection, movement, resizing, visibility, locking, ordering, opacity, and rotation; aspect-ratio locking, edge/center snapping, alignment guides, and optional 16/32/64 px grids.
- PNG, JPEG, and WebP artwork layers with cover/contain fitting, opacity, rotation, and shadow.
- Text layers with editable content, installed fonts, size, weight, alignment, color, rotation, and shadow.
- Solid, gradient, and local-image composition backgrounds; shared composition placement for preview and export.
- Local versioned JSON projects, Save and Save as, relative audio references, artwork copied into sibling `.assets` folders, missing-media lists, and per-file relinking.
- Compatibility with version 1 landscape projects and their original title/subtitle/timestamp display; upgrading composition features creates version 2 projects.
- Startup Project Manager with blank/template/open/recent actions, dedicated folders for newly saved projects, recent-project naming, and Close project.
- Save/Discard/Cancel guards when replacing or closing work or quitting; saved preview markers restored on reopening, with older projects defaulting to zero.
- Separate fullscreen composition preview and persistent local preferences for template/export choices.

#### Reusable templates

- Named custom templates with replacement confirmation and a manager for browsing, using, duplicating, renaming, and deleting layouts.
- Read-only factory templates that can be duplicated and customized.
- Layout reuse preserves meter settings, layer order, typography, background styling, and background-image assets while clearing song audio, artwork/logo paths, text content, and preview positions for custom templates.
- Song replacement clears stale analysis; templates and preferences stay in the current account's local app data.

#### Export and distribution

- Landscape 1280 × 720 editing with 720p or 1080p output at 30 FPS, plus the new portrait sizes described above.
- H.264 MP4 with lossy AAC targeting up to 320 kb/s, with explicit lower targets for mono and low-sample-rate inputs.
- H.264 MKV with supported MP3, FLAC, or WAV/PCM streams copied without re-encoding. MP3 remains lossy; remuxed files/metadata/padding are not byte-identical to source files.
- Suggested format-appropriate filenames, progress, cancellation/recovery, working-space preflight estimates, protection against output overwrites, and partial-output cleanup after failures/cancellation.
- Windows x64 portable packaging, application icons, included third-party notices, build provenance, and exact corresponding source archives with pinned Prism source and rebuild instructions.

### Requirements and limitations

- Windows x64; FFmpeg and FFprobe must be installed separately and available on PATH. Linux and macOS remain unvalidated.
- Version 1.0.0 provides branded portable and per-user setup builds. The earlier preview launches through `electron.exe` and has no installer. The app and setup are unsigned, and no automatic updater is included.
- Live preview resets rolling history and cumulative loudness after a seek with local warm-up. Use full-history still or export for full-song analysis.
- Audio remains externally referenced. Keep project JSON with its assets, and copy custom templates with their asset folders when changing machines. Installed fonts can vary between computers.
- Current source pins Electron 45.1.0 with Node 24.22.1. The earlier embedded-Node patch gap is addressed by this upgrade; this is not a blanket security clearance or a substitute for final checks.
- The [release notes](docs/releases/1.0.0.md) record exact downloads, checksums, hosted automation, source rebuild, and manual laptop checks. Manual clean-Windows testing and download-triggered SmartScreen behavior remain unverified.

## v0.6.0-preview.1 — 2026-10-26

Initial Windows x64 portable preview, published on October 26 in America/Indianapolis (October 27 UTC). Its features are included in the baseline above; live playback, portrait editing, the new title bar/menus, redesigned factories, and layer backgrounds arrived afterward.

See the [original release notes](https://github.com/BlueHopper6/music-meters/releases/tag/v0.6.0-preview.1) for the exact source/binary pair, validation, unsigned-build disclosure, accepted runtime patch exception, and deferred clean-Windows manual testing. The published preview and its assets are unchanged.
