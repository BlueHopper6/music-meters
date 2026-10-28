<div align="center">

<img src="phase2/editor-app/assets/brand/icon-64.png" alt="MusicMeters icon" width="64" height="64">

# MusicMeters

**Turn your music into videos with editable audio visualizers.**

[Download for Windows](https://github.com/BlueHopper6/music-meters/releases) · [Getting started](#getting-started) · [User guide](docs/user-guide.md) · [Changelog](CHANGELOG.md)

</div>

MusicMeters is an offline desktop music visualizer built around [Prism](https://github.com/Boof2015/prism)'s native audio analysis and meter rendering. Combine meters, artwork, and text into a composition, preview it with your music, and export a video.

## Features

### Eight audio visualizers

Each meter has its own settings, colors, and placement.

| Visualizer | What it shows |
| --- | --- |
| Spectrum analyzer | Frequency levels with configurable FFT, smoothing, and frequency scale |
| Oscilloscope | Audio waveform with pitch-triggered or free-running display |
| Vectorscope | Stereo phase with five projections and optional multiband traces |
| Spectrogram | Scrolling frequency history in either orientation |
| Waveform history | Scrolling mono or stereo waves with optional band colors |
| VU meter | Stereo bars or analog needles with an adjustable reference level |
| Loudness / peak | Momentary, short-term, or integrated LUFS and true peak |
| Waterfall spectrum | Spectrum ridges with adjustable history, density, and tilt |

### Design your composition

- Arrange, resize, rotate, reorder, hide, and lock layers. Use snapping, alignment guides, and an optional grid.
- Add local artwork and editable text with fonts, colors, opacity, and shadows.
- Choose a solid, gradient, or image background, plus independent backgrounds for meter and text layers.
- Work in landscape **16:9** or portrait **9:16** and export at **720p or 1080p, 30 FPS**.

### Preview and reuse

- Play your audio with synchronized live meters, pause, mute, scrub, or jump to a timecode.
- Start from eight factory templates: **Afterglow**, **Contour**, **Night Radio**, **Observatory**, **Synthwave**, **Minimalist Ambient**, **Social**, and **Hyper Chase**.
- Save your own templates and manage them through the Project Manager.
- Save local projects, reopen recent work, and relink missing audio or artwork.

### Export locally

- **MP4:** H.264 video with lossy AAC audio targeting up to 320 kb/s; mono and low-sample-rate sources use lower targets.
- **MKV:** H.264 video with supported MP3, FLAC, or WAV/PCM audio copied without re-encoding. MP3 remains lossy.
- Track export progress, cancel an export, and keep existing videos safe from silent overwrites.

These features describe the current source. See the [changelog](CHANGELOG.md) for changes since the published preview.

## Download

MusicMeters targets **Windows x64**. Get available builds from [GitHub Releases](https://github.com/BlueHopper6/music-meters/releases) and check the selected release's assets and requirements. Linux and macOS builds have not been validated.

1. Install the FFmpeg command-line tools and put both `ffmpeg` and `ffprobe` on your Windows `PATH`. Check `ffmpeg -version` and `ffprobe -version` in a new terminal.
2. When the release offers a **setup EXE**, run it to install MusicMeters for your Windows account, then open **MusicMeters** from the Start menu. Setup adds an uninstall entry and preserves the existing templates/preferences location.
3. For a **portable ZIP**, extract the **whole folder** and open `MusicMeters.exe`. Keep the other files beside it. The earlier 0.6.0 preview uses `electron.exe` instead and offers only portable packaging.

Node.js and developer build tools are not needed to run downloaded builds. FFmpeg and FFprobe are required separately. No automatic updater is included.

The application and setup are unsigned. Check the selected release's checksums and validation limits before running it.
## Getting started

1. Choose **New from template…** in the Project Manager, or start a blank project.
2. Choose **Import / replace audio** and open a local WAV, MP3, or FLAC file.
3. Edit the text, choose your artwork, and arrange your meters. Choose **Canvas → Portrait · 9:16** for vertical video.
4. Press **Play** to preview the composition with audio. Use **Full-history still** when you want analysis through the selected timestamp.
5. **Save** your project, then choose **Export…** to select the resolution, format, and output filename.

Saving a new project creates a project folder. Keep its JSON and sibling `.assets` folder together; audio remains a separate file reference. Templates reuse the layout with fresh song media. The [user guide](docs/user-guide.md) explains media handling, template behavior, preview history, and shortcuts.

## Documentation

- [User guide](docs/user-guide.md) — meters, composition, playback, templates, and project files.
- [Changelog](CHANGELOG.md) — release history and the upcoming feature baseline.
- [Build from source](docs/development.md) — Windows prerequisites, pinned Prism setup, and direct build commands.
- [Release checklist](docs/release-checklist.md) — verification and matching source delivery.
- [Contributing](CONTRIBUTING.md) · [Report an issue](https://github.com/BlueHopper6/music-meters/issues).

## Credits and license

MusicMeters uses [Prism](https://github.com/Boof2015/prism) for native analysis and Canvas meter rendering.

The software code is **GPL-3.0-only**; see [LICENSE](LICENSE) and [license notices](LICENSE-NOTICES.md). Official binary releases include a matching source archive containing the pinned Prism source.

The MusicMeters logo and icons have separate artwork terms. Unchanged official releases and contribution review builds may retain the branding under those terms; independently distributed modified products must rebrand unless separately authorized. See [LICENSE-NOTICES.md](LICENSE-NOTICES.md).
