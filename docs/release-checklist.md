# Windows development preview and release checklist

## Reproduce the build

1. On Windows x64, install Node.js 24, Python, Visual Studio C++ build tools, FFmpeg, and FFprobe. Verify `node`, `python`, `ffmpeg`, and `ffprobe` on `PATH`.
2. Clone this repository. Clone `https://github.com/Boof2015/prism.git` into ignored `upstream/prism` and check out `49721802252b115d169e353c98b27408daa5e2b7`.
3. In `upstream/prism`, run `npm ci --ignore-scripts --no-audit --no-fund`, `node node_modules/electron/install.js`, and `npm run build:native`. If node-gyp cannot find Visual Studio, use the host-specific environment setup described in `docs/phase-0-report.md`.
4. From the repository root, run `python phase1/make-fixtures.py`, `node phase2/build.cjs`, and the unit command in `docs/phase-6-report.md`. Build a fresh portable folder with `node phase6/package-windows.cjs --output artifacts/phase6/<new-name>`.
5. Run `node phase6/test/package-smoke.cjs <package-dir> <new-artifact-dir>` and `node phase6/test/run-repeat.cjs --package <package-dir> <new-artifact-dir>`. Check an exported frame and decoded audio, not just MP4 metadata. The Windows CI workflow runs these checks on pull requests, but a local run does not establish that hosted CI passed.

## Use the app

Run `electron.exe` in the portable folder while FFmpeg and FFprobe are on `PATH`. Import a local WAV, FLAC, or MP3 song; choose or edit a template; select a preview timestamp; set artwork/text; and render an MP4. Export defaults to 1080p/30 with H.264 video and lossy AAC audio. Existing MP4s are never silently overwritten. Save the project JSON with its sibling `.assets` folder; relink missing audio or artwork after moving it. Templates and preferences are stored in Electron user data for the current account.

## Before any public binary distribution

- Confirm the application's own license and provide complete corresponding source for the GPL-3.0-only Prism components and any application code subject to that license. Preserve Prism attribution and include `PRISM-LICENSE.txt` and `THIRD_PARTY_NOTICES.md` in the package.
- Keep Electron's `LICENSE` and `LICENSES.chromium.html` in the portable folder.
- FFmpeg/FFprobe are system dependencies in this build. If a future package bundles FFmpeg, review the exact binary's configuration and license obligations first.
- Validate the final binary on a clean Windows x64 machine with FFmpeg installed. Recheck antivirus/SmartScreen behavior, install location write permissions, and actual native dialog flows. No installer, signing, or update channel is supplied yet.
- Treat Linux and macOS as unverified. Font discovery uses Windows `System.Drawing`, the native addon is built for the local OS, and `package-windows.cjs` copies `electron.exe`.

## Known test limits

The automated low-disk test simulates a volume with insufficient free bytes and verifies the preflight error; the real disk was not filled. The encoder-failure test substitutes an executable that rejects FFmpeg arguments and verifies partial-file cleanup. Real hardware disk exhaustion, system FFmpeg removal during export, native Windows file pickers, and a public release installation were not exercised.
