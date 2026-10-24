# Music Visualizer

An offline music visualizer built around Prism's native analysis and Canvas meter rendering. The current development build has a static Electron layout editor and MP4 export.

## Run the editor

Set up the pinned Prism checkout and native addon as described in [the Phase 0 report](docs/phase-0-report.md). Keep `ffmpeg` and `ffprobe` on PATH. Then run from the repository root:

```powershell
node phase2/run.cjs
```

Choose **Import audio** to load a WAV, MP3, or FLAC file. Select a timestamp to see a real still frame, add vectorscope, spectrum analyzer, oscilloscope, spectrogram, waveform history, VU, loudness/peak, or waterfall spectrum layers, move or resize them, save a JSON project, and choose **Render MP4**. Vectorscope layers offer five Prism stereo projections, zoom, optional native three-band traces and colors, and optional signed full-band/band correlation indicators. Spectrum layers have independent FFT size, smoothing, frequency scale, range, and side-channel settings. Oscilloscope layers show Prism's left-channel wave with pitch-triggered or free-running display, optional underfill, and optional grid. Spectrogram layers scroll frequency history in either orientation with independent scale, color, and analysis settings. Waveform history layers offer mono left-channel or stereo lanes, scroll speed 1–8, and optional low/mid/high band colors. VU layers offer horizontal or vertical stereo bars, stereo or combined needles, a configurable 0 VU dBFS reference, and colors. Loudness/peak layers show momentary, short-term, or integrated LUFS alongside stereo bars and true peak, with independent readout and colors. Waterfall layers show Prism's native time-evolving spectrum ridges with independent FFT, scale, history, density, smoothing, tilt, and colors. The editor offers 720p and 1080p output at 30 FPS. Project files store an audio path relative to the JSON file; if that file moves, import it again to relink it.

For a finished composition, choose **Artwork / logo** or **Text** in the Add layer menu. Image layers use a local PNG, JPEG, or WebP file, crop-to-fill or fit-inside, opacity, rotation, and shadow. Text layers have content, font, size, weight, alignment, color, rotation, and shadow. The composition background can be a solid color, gradient, or local image. Layer order is shared across meters, artwork, and text: **Move up** places a layer in front. The project name is metadata; in version 2 projects, visible song and artist lettering comes from text layers. Older version 1 projects retain their original fixed title/subtitle/timestamp display until a new graphic layer or background style upgrades them. Saving a version 2 project copies artwork into a sibling `<project-name>.assets` folder. Keep that folder with the JSON when moving the project; a missing file is reported and blocks export. Audio is still referenced separately and is never embedded.

For a developer smoke test, generate the synthetic fixtures with `python phase1/make-fixtures.py` and run `node phase2/run.cjs --audio artifacts/phase1/fixtures/stereo-10s-48k.wav`.

The [Phase 4 report](docs/phase-4-report.md) documents the finished composition gate and its limits. Earlier [phase reports](docs/phase-3-8-report.md) and the [meter parity matrix](docs/meter-parity.md) track meter implementation and verification.
