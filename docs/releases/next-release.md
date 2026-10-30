# MusicMeters 1.1.0 - Windows x64

Release draft for review. Not yet published; final source revision, validation, download sizes, and checksums will be recorded after the release candidate is frozen.

MusicMeters 1.1.0 makes it easier to try different looks for the same song, manage saved projects, and undo edits. Template previews now show the actual starting layout before you choose it.

## Templates and editing

- Switch templates in the editor while keeping your imported audio, project title, playhead position, and save location. This addresses [issue #10](https://github.com/BlueHopper6/music-meters/issues/10), opened by [@Bhagip0003](https://github.com/Bhagip0003), in [PR #11](https://github.com/BlueHopper6/music-meters/pull/11).
- Browse rendered thumbnails in New from Template and Manage templates, including from the editor. Sample glowing circle artwork matches each template's theme; saved layouts and newly created projects keep their original content. ([PR #14](https://github.com/BlueHopper6/music-meters/pull/14))
- Undo and redo layout edits with the Edit menu, Ctrl+Z, Ctrl+Y, or Ctrl+Shift+Z. Related typing and dragging are grouped, with up to 100 steps per session; the current playback position is retained. ([PR #11](https://github.com/BlueHopper6/music-meters/pull/11))
- Continue editing while a still refreshes after layout changes or undo/redo. Starting playback cancels the pending still update. Template Manager no longer presents a remembered selection as the active layout. ([PR #11](https://github.com/BlueHopper6/music-meters/pull/11))

## Projects and startup

- Rename, move, copy, or delete saved projects from a three-dot menu in Recent Projects. Rename updates the project folder and filename. ([PR #13](https://github.com/BlueHopper6/music-meters/pull/13))
- Move and Copy carry project images while keeping the original song linked where it is. Confirmed Delete sends project-owned files to the Recycle Bin and preserves original media and unrelated files.
- Save and Save As suggest filenames from the project name. Missing projects disappear from Recent Projects, and project-action errors use clearer wording.
- Start with a maximized window and normal window controls.

## Playback fixes

- Space plays and pauses after clicking or dragging the timeline, with a subtle keyboard playhead cue. ([PR #12](https://github.com/BlueHopper6/music-meters/pull/12))
- Seeking immediately retires the old playback session, preventing late pause events or queued frames from resetting the selected position. ([PR #11](https://github.com/BlueHopper6/music-meters/pull/11), [PR #13](https://github.com/BlueHopper6/music-meters/pull/13))

## Community

Thank you to [@Bhagip0003](https://github.com/Bhagip0003) for opening [issue #10](https://github.com/BlueHopper6/music-meters/issues/10) and suggesting that selected audio stay loaded when switching templates. The improvement is included through [PR #11](https://github.com/BlueHopper6/music-meters/pull/11).

Issue reporting and contribution instructions are also simpler, with optional templates for bugs, feature ideas, and questions, plus clearer local run/test guidance. ([PR #9](https://github.com/BlueHopper6/music-meters/pull/9), [PR #11](https://github.com/BlueHopper6/music-meters/pull/11))

See the [changelog](../../CHANGELOG.md) for the complete changes since 1.0.0.

## Download and run

The planned downloads are a Windows x64 setup EXE and portable ZIP. Setup installs for your Windows account; for portable use, extract the entire folder and open `MusicMeters.exe`. Existing templates/preferences retain their app-data location. No automatic updater is included.

Install FFmpeg and FFprobe separately and put both on PATH. Node.js, Python, and build tools are not needed to run the downloaded app. Keep saved project JSON with its artwork assets and separately referenced audio.

## Known limitations

- Windows x64 only; Linux and macOS remain unvalidated.
- The app and setup are unsigned. FFmpeg/FFprobe remain external requirements, and installed fonts can vary between computers.
- Live playback restarts rolling history and cumulative loudness after seeking. Use full-history still or export for full-song analysis.
- MP4 uses lossy AAC; MKV can copy supported source audio without re-encoding. MP3 remains lossy.
- The owner tested the features during development and requested no additional manual app testing for this release. Manual testing on clean Windows and download-triggered SmartScreen behavior remain unverified. Automated installer checks are separate evidence.

## Source and licenses

The release will provide `MusicMeters-1.1.0-source.zip` alongside both Windows downloads, containing the exact matching MusicMeters and pinned Prism source, build configuration, lockfiles, and required notices. GitHub's automatically generated source ZIP alone is insufficient.

The software code is GPL-3.0-only. Preserve third-party notices and the separate logo/icon terms in [LICENSE-NOTICES.md](../../LICENSE-NOTICES.md).

## Validation

The review build uses Electron 45.1.0 with embedded Node 24.22.1. The [official stable release list](https://releases.electronjs.org/?channel=stable) and [Node security release](https://nodejs.org/en/blog/release/v24.22.1) were rechecked on October 29, 2026. Locked build, runtime, and installer-tool audits reported zero known vulnerabilities; no blanket security clearance is implied.

PR #14 passed its [Windows workflow](https://github.com/BlueHopper6/music-meters/actions/runs/40978009565), including packaged startup/playback/export checks, matching-source rebuild, and automated installation/reinstall/uninstallation on a disposable hosted runner. The [post-merge main workflow](https://github.com/BlueHopper6/music-meters/actions/runs/40979469830) also passed for commit `751205a8b02be2ae0e522a9b91f142e82be45ee7`. This is feature-merge evidence; validation of the final 1.1.0 release revision and its exact packages remains pending.

The local 1.1.0 review build passed unit checks, strict TypeScript, executable branding, packaged startup, portrait export, undo/redo, playback, IPC/CSP security, MP4/AAC, repeated export and cancellation/recovery, MKV source-audio copying, the 12-case AAC matrix, and late-song multi-meter preview checks. Review-package scans found no developer home/checkout paths in the checked native and application files.

A development setup was built without installing it, and all 144 embedded files matched the review package. These results cover a development review build. The clean final release revision, matching-source archive/rebuild, final setup payload, and download checksums still require verification before publication. No additional manual app checks will be performed at the owner's request.

## Exact downloads

Planned filenames (not yet published):

- `MusicMeters-1.1.0-windows-x64-setup.exe`
- `MusicMeters-1.1.0-windows-x64.zip`
- `MusicMeters-1.1.0-source.zip`

Final byte counts and SHA-256 checksums will be added after the exact source/setup/portable set is built and frozen. No 1.1.0 files have been uploaded.
