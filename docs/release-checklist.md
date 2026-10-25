# Windows development preview and release checklist

## Reproduce the build

1. On Windows x64, install the latest patched Node.js 24 LTS, Python, Visual Studio 2022 C++ build tools, FFmpeg, and FFprobe. Verify `node`, `python`, `ffmpeg`, and `ffprobe` on `PATH`.
2. Clone this repository. Clone `https://github.com/Boof2015/prism.git` into ignored `upstream/prism` and check out `49721802252b115d169e353c98b27408daa5e2b7`.
3. In `upstream/prism`, run `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build:native`. Pinned node-gyp 10 does not detect Visual Studio 2026. If it cannot find Visual Studio 2022, use the host-specific environment setup described in `docs/phase-0-report.md`.
4. In `phase6/electron-runtime`, run `npm ci --ignore-scripts --no-audit --no-fund` and `node node_modules/electron/install.js`. `phase6/electron-runtime.cjs` rejects a missing or wrong-version runtime.
5. From the repository root, run `python phase1/make-fixtures.py`, `node phase2/build.cjs`, and the unit command in `docs/phase-6-report.md`. Build a fresh portable folder with `node phase6/package-windows.cjs --output artifacts/phase6/<new-name>`.
6. Confirm `resources/app/phase2/editor-app/assets/brand/music-meters.ico` exists in the package. Run `node phase6/test/package-smoke.cjs <package-dir> <new-artifact-dir>` and `node phase6/test/run-repeat.cjs --package <package-dir> <new-artifact-dir>`. The package smoke checks the exact Electron version, licenses, decoded audio, and MP4 frames. Check stage controls and editor/export still parity. The Windows CI workflow runs these checks on pull requests, but a local run does not establish that hosted CI passed.

## Use the app

Run `electron.exe` in the portable folder while FFmpeg and FFprobe are on `PATH`. Import a local WAV, FLAC, or MP3 song; choose or edit a template; select a preview timestamp; set artwork/text; and render an MP4. Export defaults to 1080p/30 with H.264 video and lossy AAC audio. Existing MP4s are never silently overwritten. Save the project JSON with its sibling `.assets` folder; relink missing audio or artwork after moving it. Templates and preferences are stored in Electron user data for the current account.

## Before any public binary distribution

- Resolve every open item in [the public release review](public-release-review.md), including the application's own license, brand asset rights, and complete corresponding source for the combined GPL-3.0-only Prism-based application.
- Keep `PRISM-LICENSE.txt`, `NODE-ADDON-API-LICENSE.md`, `THIRD_PARTY_NOTICES.md`, and Electron's `LICENSE` and `LICENSES.chromium.html` in the portable folder.
- Use an Electron stable build containing the latest applicable Node.js security fixes; the current stable 45.0.0 contains Node 24.22.0, so this gate remains open for the October 2026 Node fixes.
- FFmpeg/FFprobe command-line executables are system dependencies in this build. Electron's copied runtime includes `ffmpeg.dll` with a notice in `LICENSES.chromium.html`. If a future package bundles the FFmpeg command-line executables, review the exact binaries' configuration and license obligations first.
- Validate the final binary on a clean Windows x64 machine with FFmpeg installed. Recheck antivirus/SmartScreen behavior, install location write permissions, and actual native dialog flows. No installer, signing, or update channel is supplied yet.
- Treat Linux and macOS as unverified. Font discovery uses Windows `System.Drawing`, the native addon is built for the local OS, and `package-windows.cjs` copies `electron.exe`.

## Known test limits

The automated low-disk test simulates a volume with insufficient free bytes and verifies the preflight error; the real disk was not filled. The encoder-failure test substitutes an executable that rejects FFmpeg arguments and verifies partial-file cleanup. Real hardware disk exhaustion, system FFmpeg removal during export, native Windows file pickers, and a public release installation were not exercised.
