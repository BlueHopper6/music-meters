# Meter feature parity

This table tracks the **application's** verified features after Phase 3.2. `Supported` means editor stills and exported MP4 frames use real Prism analysis and drawing. It does not claim pixel-for-pixel equivalence with MiniMeters. Prism is pinned to `49721802252b115d169e353c98b27408daa5e2b7`. MiniMeters features below are drawn from its [official feature list](https://minimeters.app/); Prism capabilities are checked against the pinned source paths named in the evidence column.

| Feature or mode | Status | Evidence and scope |
| --- | --- | --- |
| Spectrum line, mid channel | Supported | Prism `native/src/spectrum.cpp` and `src/renderer/visualizers/SpectrumAnalyzer.ts`; 440 Hz and 1 kHz fixture peaks, editor stills, and MP4 frames in [Phase 3.1 report](phase-3-1-report.md). |
| Spectrum side channel line | Supported | Optional side line uses Prism `getSideMagnitudes`; anti-phase fixture has silent mid and strong side. Separate L/R display is not exposed yet. |
| Spectrum FFT sizes 1024, 2048, 4096, 8192 | Supported | Per-layer settings in `phase2/project.cjs`, native prepasses in `phase3/spectrum.cjs`; two unlike instances verified. MiniMeters also lists 16384, which is not exposed here. |
| Spectrum logarithmic, Mel, linear frequency scales | Supported | Prism `types/frequencyScale.ts` and `SpectrumAnalyzer.ts`; UI selection saved and restored. Display mapping is Prism's implementation. |
| Spectrum frequency/dB ranges | Supported | Prism Canvas options; per-layer controls, validation, and history checks. |
| Spectrum smoothing response versus live Prism | Different behavior | Uses Prism's native smoothing math and independent per-layer values, updated once per 30 FPS video frame. Live Prism can receive chunks at a different cadence, so its transient response may differ. |
| Spectrum left/right mode | Not yet implemented | Current analysis captures Prism mid and side magnitudes. MiniMeters lists L/R and M/S channel modes; L/R needs a separate rendering/data path. |
| Spectrum 16384 FFT, color bars, combined mode, frequency readout | Not yet implemented | MiniMeters lists these on its official feature page. Current UI exposes line mode and FFT sizes through 8192. |
| Spectrum tilt, heatmap, reference curve | Not yet implemented | Prism `SpectrumAnalyzer.ts` has tilt, heatmap, and reference options; they are not wired into this application's project schema or export. |
| Vectorscope stereo Lissajous trace | Supported | Prism `native/src/vectorscope.cpp` and `Vectorscope.ts`; Phase 2 and 3.1 regression exports. |
| Vectorscope polar/linear modes, zoom, multiband colors | Not yet implemented | Options exist in Prism `Vectorscope.ts`; current app fixes the basic Lissajous mode. MiniMeters lists scaled, linear, Lissajous, RGB, and multiband variants. |
| Stereo correlation and multiband correlation | Not yet implemented | MiniMeters lists single/multiband correlation. Prism has native stereo analysis modules, but this editor does not present a correlation meter. |
| Spectrogram FFT scale/size, orientation, history | Not yet implemented | Prism `Spectrogram.ts` exists; no editor/export layer yet. MiniMeters lists Mel/log/linear, horizontal/vertical, and history options. |
| Oscilloscope sample wave and pitch trigger | Supported | Prism `native/src/oscilloscope.cpp` and `src/renderer/visualizers/Oscilloscope.ts`; Phase 3.2 native frequency and consecutive-frame trigger checks, editor stills, and MP4 frames in [Phase 3.2 report](phase-3-2-report.md). |
| Oscilloscope free-running, underfill, and grid controls | Supported | Per-layer project settings use the same Prism Canvas painter; pitch-locked and free-running instances were tested together and independently. |
| Oscilloscope channel routing | Different behavior | Prism's oscilloscope consumes the left channel from `AudioRouter.ts`; this application follows it. The user cannot select right, mid, or side for this meter. |
| Oscilloscope time-window/trigger adjustment | Not yet implemented | Prism fixes the display window through `getNormalizedOscilloscopeDisplaySamples`; the application exposes pitch lock, not an adjustable window or trigger level. |
| Scrolling waveform modes and multiband colors | Not yet implemented | Prism `Waveform.ts` exists; no editor/export layer yet. MiniMeters lists channel selection, multiband, speed, and loop. |
| Waterfall spectrum history | Not yet implemented | Prism `Waterfall.ts` and native waterfall exist; no editor/export layer yet. This is a Prism category, not a distinct MiniMeters module in its current official feature list. |
| Loudness/peak windows and readouts | Not yet implemented | Prism `LUFSMeter.ts` and native `lufsmeter.cpp` exist; no editor/export layer yet. MiniMeters lists momentary/short-term LUFS and fast/slow RMS windows. |
| VU ballistics, channel selection, and calibration | Not yet implemented | Prism `VUMeter.ts` and native `vumeter.cpp` exist; no editor/export layer yet. MiniMeters lists L/R/M/S channel options and input calibration. |

`Different behavior` and `Not feasible` remain available statuses for future rows when a tested feature warrants them. Features listed as not yet implemented are roadmap items, not claims that Prism cannot provide them.
