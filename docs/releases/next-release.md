# MusicMeters 1.3.0 - Windows x64

Release preparation draft. Exact downloads, checksums, source revision, and final CI evidence will be filled from the frozen candidate before publication. The current published release remains [1.2.0](1.2.0.md).

MusicMeters 1.3.0 makes projects easier to recognize and compositions easier to arrange. Export just the section you need, save a frame as an image, and refine your layout with snapping and off-canvas positioning.

## Project thumbnails

- Recent-project cards show the saved composition at its selected playhead position. Older projects receive an automatic layout/video preview.
- Small previews are cached locally at up to 320 pixels. Saving replaces the existing thumbnail for that project location rather than accumulating a history of images. Original media is unchanged.

## Export video regions and still frames

- Choose start and end times, or use the playhead to set boundaries, and export only that region with aligned video, audio, and meters. Meter history starts at the region boundary.
- Existing MP4/AAC, MKV/FLAC, and lossless-master quality choices remain available. Source-audio copy continues to require a full-length eligible soundtrack.
- Export the current composition as a lossless PNG at the selected resolution, including artwork/text compositions without audio.

## Arrange and style your composition

- Snap dragged layers to other visible layers' edges and centers. Pink alignment guides distinguish layer snapping from yellow canvas/grid snapping.
- Move and resize layers beyond the canvas edges, with matching cropping in preview and export and editable negative coordinates.
- Video layers have a larger inset resize handle plus Half size and Canvas size controls.
- Meter presets use a themed swatch picker, keep the selected name in sync, and return keyboard focus so Space plays or pauses after a selection.
- Single waveform history can use left, right, mono mix, or a stereo envelope with left above and right below the centerline. Existing projects retain their earlier left-channel behavior; separate stereo lanes remain available. This changes the display, not the soundtrack.

## Clearer import feedback

- Images up to 16 MB can be imported; the combined project-artwork budget remains 24 MB.
- Important import, open, save, and export failures appear in a persistent dismissible notice with clearer messages.
- Video imports display Loading video until the picture and first preview are ready.
- Space after dragging plays or pauses without highlighting the stage outline. Undoing imported video preserves the Redo entry.

## Download and run

Windows x64 setup EXE and portable ZIP, accompanied by the exact complete source ZIP. Install FFmpeg and FFprobe separately and put both on PATH. Node.js and developer build tools are not needed to run the app. Use the setup for a per-user installation, or extract the whole portable folder and open MusicMeters.exe.

## Known limitations

Unsigned application/setup; no automatic updater; Windows x64 only. One video layer, SDR output, and 30 FPS. Linked media must remain available. MP4/AAC is lossy; lossless MKV options can be much larger. Thumbnails are local cached previews and are regenerated when needed; they do not travel with the project. Existing 1.2.0 projects remain supported; use 1.3.0 or newer for the new controls.

## Source and licenses

The matching source archive includes MusicMeters, the pinned Prism source, build scripts, lockfiles, and node-addon-api source. Software is GPL-3.0-only; branding has the separate terms in LICENSE-NOTICES.md. Preserve the exact corresponding source and license notices when redistributing an unchanged official release.

## Validation

This candidate retains Electron 45.2.3 / embedded Node 24.22.2. At the owner's request, additional local app tests and manual installation checks are not being repeated. Final-commit Windows CI must pass before release preparation is considered complete. Final artifact integrity, corresponding source, licenses, provenance, and privacy will be checked before requesting approval of the exact downloads. Clean-Windows manual validation, SmartScreen/download reputation, and cross-version upgrade behavior remain unverified.

## Exact downloads

Added from the final frozen candidate before publication.
