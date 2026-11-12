# MusicMeters 1.3.0 - macOS Experimental Preview 1

This first Mac preview brings MusicMeters' offline editor and video exports to Apple Silicon and Intel Macs. It is **experimental and unnotarized**: macOS may block downloaded builds. The existing [stable Windows 1.3.0 release](https://github.com/BlueHopper6/music-meters/releases/tag/v1.3.0) is unchanged.

## Mac support

- Separate Apple Silicon (`arm64`) and Intel (`x64`) application packages.
- Electron 45.3.0 includes updated Chromium security fixes.
- Native Mac window controls, application menus, Command shortcuts and window reopening.
- FFmpeg/FFprobe discovery in standard Homebrew/MacPorts locations, plus configured paths.
- Cross-platform project references and font fallbacks while retaining the existing editor, meters, templates, media layers, PNG stills and export controls.

Thanks to [@NitronicM](https://github.com/NitronicM) for native Mac testing and the window, type-checking and runtime-requirement fixes in [PR #39](https://github.com/BlueHopper6/music-meters/pull/39).

## Download and run

Choose the ZIP for your Mac's processor. The bundled runtime requires **macOS 13 or later**; macOS 13–14 compatibility remains unverified. Extract the full package and keep its notices and provenance together with `MusicMeters.app`.

Install the separate `ffmpeg` and `ffprobe` command-line tools first, for example with `brew install ffmpeg`. Verify `ffmpeg -version` and `ffprobe -version` in Terminal. They are not bundled; standard Homebrew/MacPorts locations are also checked when launching from Finder.

## Known limitations

- Electron 45.3.0 embeds Node 24.22.2. Upstream Node 24.22.3 shipped security fixes on November 11; inclusion of those fixes in this Electron build is unverified. The inspected application code does not expose Node HTTP/HTTP2/TLS servers, but this is a disclosed patch gap and is not blanket security clearance.

- Ad-hoc signed, without Apple Developer ID signing, an Apple-verified publisher identity or notarization. macOS may block it and managed Macs may prohibit it. No automatic updater.
- Clean-Mac browser-download/Gatekeeper acceptance, macOS 13–14, broader native-dialog/Trash checks and external/case-sensitive volumes remain unverified. These are accepted experimental-preview exceptions, not passing production gates.
- The contributor reported an intermittent video-drag test failure on the unchanged baseline followed by an unchanged passing retry; no cause or fix is established.
- Linux remains unverified. FFmpeg and FFprobe remain external prerequisites.

## Source and licenses

Software code is GPL-3.0-only, with separate branding terms. Each binary's `SOURCE-ARCHIVE.json` names its exact corresponding source ZIP below. Both source archives include pinned Prism source, build scripts and required notices. Keep the matching pair together; GitHub's automatic source archive alone is insufficient.

## Validation

Frozen source: `115bcc0ec91096836f83cdb057f8ac8f4077fe18`. Exact-source [candidate Mac CI](https://github.com/BlueHopper6/music-meters/actions/runs/43133529413), [main Mac CI](https://github.com/BlueHopper6/music-meters/actions/runs/43133522943) and [Windows CI](https://github.com/BlueHopper6/music-meters/actions/runs/43133522925) passed. Native CI covered Apple Silicon and Intel on macOS 15, packaged editor/export/security checks, ad-hoc signature/architecture/minimum-OS checks, relocated full-ZIP validation and corresponding-source rebuilds. The downloaded originals were independently checked for hashes, source pairing, notices, ZIP paths/links, architecture and native build-path privacy.

Independent Windows review also passed 160 unit cases and packaged regressions. A synthetic eight-meter comparison matched all 60 decoded video frames, audio and seven preview/still/waveform images exactly against Windows 1.3.0. Existing Windows release asset hashes remain unchanged.

Before the runtime refresh, the contributor reported manual Apple Silicon checks of native chrome, template creation, WAV Copy import, audible playback and save/reopen on the contributor build. Those observations were not independently witnessed and are not clean-machine or final-download acceptance tests.

## Exact downloads

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [MusicMeters-macos-arm64.zip](https://github.com/BlueHopper6/music-meters/releases/download/macos-v1.3.0-preview.1/MusicMeters-macos-arm64.zip) | 122169874 | `9745e516ff8d7f83062dbd7e5aa1070d42cee8d083a36d3309f4856bbf92f3dd` |
| [MusicMeters-source-macos-arm64.zip](https://github.com/BlueHopper6/music-meters/releases/download/macos-v1.3.0-preview.1/MusicMeters-source-macos-arm64.zip) | 53084144 | `455c5ba86057d11ecef84e2d4742709689bb1718073f659c5ec2eac9c46f834a` |
| [MusicMeters-macos-x64.zip](https://github.com/BlueHopper6/music-meters/releases/download/macos-v1.3.0-preview.1/MusicMeters-macos-x64.zip) | 127965141 | `6ca632c0554fe93e5833408be36d8e9c84fb457e84a8a8bd8638f879c3768be1` |
| [MusicMeters-source-macos-x64.zip](https://github.com/BlueHopper6/music-meters/releases/download/macos-v1.3.0-preview.1/MusicMeters-source-macos-x64.zip) | 53084141 | `7d333a814273f9f3fdc5afb747665f492fcdf927caa9cb56b45cc2e9b2ff7ec0` |
