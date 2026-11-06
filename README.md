<div align="center">

<img src="phase2/editor-app/assets/brand/icon-64.png" alt="MusicMeters icon" width="64" height="64">

# MusicMeters

**Turn your music into videos with editable audio visualizers.**

[Download for Windows](https://github.com/BlueHopper6/music-meters/releases) · [Getting started](#getting-started) · [User guide](docs/user-guide.md) · [Changelog](CHANGELOG.md)

</div>

MusicMeters is an offline desktop music visualizer built around [Prism](https://github.com/Boof2015/prism)'s native audio analysis and meter rendering. Combine meters, video, artwork, and text into a composition, mix your soundtrack, and export a video.

Current source adds project thumbnails, selected-region video exports, PNG still-frame export, off-canvas positioning, layer snapping, and more waveform input choices. These improvements are being prepared for MusicMeters 1.3.0; the published download below remains 1.2.0. See [video and export quality](docs/user-guide.md#video-layers-and-audio-routing).

## Features

### Eight audio visualizers

Each meter has its own settings, colors, and placement, with six coordinated color presets and fine appearance controls.

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
- Import a video layer and arrange artwork, text, and meters above or below it.
- Add local artwork and editable text with fonts, colors, opacity, and shadows.
- Choose a solid, gradient, or image background, plus independent backgrounds for meter and text layers.
- Work in landscape **16:9** or portrait **9:16** and export at **720p, 1080p, 1440p, or 2160p/4K at 30 FPS**.

### Preview and reuse

- Play your composition with synchronized live meters, pause, mute, scrub, or jump to a timecode.
- Mix video audio and imported music independently, and choose which source or final mix drives the meters.
- Copy media into the project when saving, or link originals to save disk space.
- Start from eight factory templates: **Afterglow**, **Contour**, **Night Radio**, **Observatory**, **Synthwave**, **Minimalist Ambient**, **Social**, and **Hyper Chase**.
- Save your own templates and manage them through the Project Manager.
- Save local projects, reopen recent work, and relink missing audio or artwork.

### Export locally

- **MP4:** H.264 video with lossy AAC audio targeting up to 384 kb/s; mono and low-sample-rate sources use lower targets.
- **MKV:** H.264 with lossless 24-bit FLAC audio, or eligible unchanged source audio copied without re-encoding. MP3 source audio remains lossy.
- **Lossless master:** MKV with lossless RGB video and 32-bit float PCM audio; files can be much larger.
- Track export progress, cancel an export, and keep existing videos safe from silent overwrites.

The latest release is [MusicMeters 1.2.0](https://github.com/BlueHopper6/music-meters/releases/tag/v1.2.0), with video mixing, separate meter inputs, richer meter styling, media storage choices, and higher-quality exports. See the [changelog](CHANGELOG.md) for the release history.

## Download

MusicMeters targets **Windows x64**. Download the setup EXE or portable ZIP from [MusicMeters 1.2.0](https://github.com/BlueHopper6/music-meters/releases/tag/v1.2.0) and check its requirements and checksums. Linux and macOS builds have not been validated.

1. Install the FFmpeg command-line tools and put both `ffmpeg` and `ffprobe` on your Windows `PATH`. Check `ffmpeg -version` and `ffprobe -version` in a new terminal.
2. For the **setup EXE**, run it to install MusicMeters for your Windows account, then open **MusicMeters** from the Start menu. Setup adds an uninstall entry and preserves the existing templates/preferences location.
3. For a **portable ZIP**, extract the **whole folder** and open `MusicMeters.exe`. Keep the other files beside it. The earlier 0.6.0 preview uses `electron.exe` instead and offers only portable packaging.

Node.js and developer build tools are not needed to run downloaded builds. FFmpeg and FFprobe are required separately. No automatic updater is included.

The application and setup are unsigned. Check the selected release's checksums and validation limits before running it.

## Getting started

1. Choose **New from template…** in the Project Manager, or start a blank project.
2. Choose **Import / replace audio** and open a local WAV, MP3, or FLAC file.
3. Edit the text, choose your artwork, and arrange your meters. Choose **Canvas → Portrait · 9:16** for vertical video.
4. Press **Play** to preview the composition with audio. Use **Full-history still** when you want analysis through the selected timestamp.
5. **Save** your project, then choose **Export…** to select the resolution, format, and output filename.

Saving a new project creates a project folder. Keep its JSON and sibling `.assets` folder together; media follows its Copy/Link choice. Keep linked original files available. Templates reuse the layout with fresh song media. The [user guide](docs/user-guide.md) explains media handling, template behavior, preview history, and shortcuts.

## Developing

Want to change the app? Start with [Run and test locally](docs/development.md): it covers Windows setup, launching the editor, rebuilding after edits, and automated/manual checks. There is no root package.json or `npm run dev` command.

After completing setup, run this from the repository root:

```powershell
node phase2/run.cjs
```

The launcher rebuilds the renderer and opens the development app. See the guide's [development session setup](docs/development.md#run-during-development) to keep test projects and preferences separate from your normal app profile.

## Documentation

- [User guide](docs/user-guide.md) — meters, composition, playback, templates, and project files.
- [Changelog](CHANGELOG.md) — release history and the complete 1.0.0 feature baseline.
- [Run and test locally](docs/development.md) — Windows setup, the edit/run loop, automated tests, and development packages.
- [Release checklist](docs/release-checklist.md) — verification and matching source delivery.
- [Contributing](CONTRIBUTING.md) · [Report an issue](https://github.com/BlueHopper6/music-meters/issues).

## Credits and license

MusicMeters uses [Prism](https://github.com/Boof2015/prism) for native analysis and Canvas meter rendering.

The software code is **GPL-3.0-only**; see [LICENSE](LICENSE) and [license notices](LICENSE-NOTICES.md). Official binary releases include a matching source archive containing the pinned Prism source.

The MusicMeters logo and icons have separate artwork terms. Unchanged official releases and contribution review builds may retain the branding under those terms; independently distributed modified products must rebrand unless separately authorized. See [LICENSE-NOTICES.md](LICENSE-NOTICES.md).
