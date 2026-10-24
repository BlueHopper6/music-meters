# Music Visualizer

An offline music visualizer built around Prism's native analysis and Canvas meter rendering. The current development build has a static Electron layout editor and MP4 export.

## Run the editor

Set up the pinned Prism checkout and native addon as described in [the Phase 0 report](docs/phase-0-report.md). Keep `ffmpeg` and `ffprobe` on PATH. Then run from the repository root:

```powershell
node phase2/run.cjs
```

Choose **Import audio** to load a WAV, MP3, or FLAC file. Select a timestamp to see a real still frame, add vectorscope, spectrum analyzer, oscilloscope, or spectrogram layers, move or resize them, save a JSON project, and choose **Render MP4**. Spectrum layers have independent FFT size, smoothing, frequency scale, range, and side-channel settings. Oscilloscope layers show Prism's left-channel wave with pitch-triggered or free-running display, optional underfill, and optional grid. Spectrogram layers scroll frequency history in either orientation with independent scale, color, and analysis settings. The editor offers 720p and 1080p output at 30 FPS. Project files store an audio path relative to the JSON file; if that file moves, import it again to relink it.

For a developer smoke test, generate the synthetic fixtures with `python phase1/make-fixtures.py` and run `node phase2/run.cjs --audio artifacts/phase1/fixtures/stereo-10s-48k.wav`.

The [Phase 2 report](docs/phase-2-report.md), [Phase 3.1 spectrum report](docs/phase-3-1-report.md), [Phase 3.2 oscilloscope report](docs/phase-3-2-report.md), and [Phase 3.3 spectrogram report](docs/phase-3-3-report.md) contain implementation details and verification evidence. The [meter parity matrix](docs/meter-parity.md) tracks current support. Other Prism meters and composition elements are scheduled for later phases.
