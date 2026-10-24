# Music Visualizer

An offline music visualizer built around Prism's native analysis and Canvas meter rendering. The current development build has a static Electron layout editor and MP4 export.

## Run the editor

Set up the pinned Prism checkout and native addon as described in [the Phase 0 report](docs/phase-0-report.md). Keep `ffmpeg` and `ffprobe` on PATH. Then run from the repository root:

```powershell
node phase2/run.cjs
```

Choose **Import audio** to load a WAV, MP3, or FLAC file. Select a timestamp to see a real still frame, move or resize the vectorscope, save a JSON project, and choose **Render MP4**. The editor offers 720p and 1080p output at 30 FPS. Project files store an audio path relative to the JSON file; if that file moves, import it again to relink it.

For a developer smoke test, generate the synthetic fixtures with `python phase1/make-fixtures.py` and run `node phase2/run.cjs --audio artifacts/phase1/fixtures/stereo-10s-48k.wav`.

The Phase 2 implementation and verification details are in [the Phase 2 report](docs/phase-2-report.md). The current editor has vectorscope layers, title, and solid background; additional Prism meters and composition elements are scheduled for later phases.
