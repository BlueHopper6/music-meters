# Build MusicMeters from source

For running a downloaded build, use the [README](../README.md). These instructions are for Windows x64 development; there is no root package.json.

## Prerequisites

Install Node.js 24 LTS, Python, Visual Studio 2022 C++ build tools, and FFmpeg/FFprobe on PATH. Verify the selected tools before building. Host-specific Visual Studio detection notes are in the [Phase 0 setup record](phase-0-report.md).

Official release builds must also follow [the native build configuration](../BUILD-CONFIGURATION.md) and scan the resulting addon for developer paths.

## Set up Prism and build tools

From the MusicMeters repository root:

```powershell
git clone https://github.com/Boof2015/prism.git upstream/prism
git -C upstream/prism checkout 49721802252b115d169e353c98b27408daa5e2b7
npm --prefix phase6/build-tools ci --ignore-scripts --no-audit --no-fund
node phase6/build-native.cjs
```

The upstream checkout and installed dependencies are ignored. MusicMeters uses locked build/native dependencies rather than installing Prism's full development tree.

## Install the pinned Electron runtime

From the repository root:

```powershell
npm --prefix phase6/electron-runtime ci --ignore-scripts --no-audit --no-fund
node phase6/electron-runtime/node_modules/electron/install.js
```

The runtime helper rejects a missing or wrong-version Electron installation.

## Build and open the editor

```powershell
python phase1/make-fixtures.py
node phase2/build.cjs
node phase2/run.cjs
```

Fixtures are synthetic and ignored. Bundling does not perform strict TypeScript validation. Use the [Windows CI workflow](../.github/workflows/windows-build.yml) for the separate strict type check and automated verification commands.

## Install Windows packaging tools

From the repository root, run `npm --prefix phase6/installer-tools ci --ignore-scripts --no-audit --no-fund`. This locked toolset provides executable branding and NSIS installer creation; it is used only at build time.

## Create a portable development package

```powershell
node phase6/package-windows.cjs --output artifacts/phase6/my-new-package
```

Choose a fresh output directory that does not already exist. Launch its `MusicMeters.exe` and keep the whole folder together. It includes Electron, built renderer code, runtime icons, and the pinned Prism native addon. System FFmpeg and FFprobe are required separately. Installed-font discovery and this packaging script currently require Windows; Linux and macOS are unvalidated.

Work files and export analysis caches use the current user's temp directory. Tests and development can redirect profiles/caches to isolated locations. Export checks estimated workspace needs and removes partial output after cancellation or failure.

For direct MKV export:

```powershell
node phase2/export.cjs --project <project.json> --output <video.mkv> --audio-mode copy
```

Omitting the audio-mode option keeps the MP4/AAC default.

## Verification and distribution

Follow the [release checklist](release-checklist.md) for packaging checks, exact corresponding source delivery, privacy, and final release gates. Local development packaging does not establish public-release readiness.

The [Phase 6 report](phase-6-report.md), [audio export report](audio-export-report.md), [AAC quality review](aac-quality-review.md), [layout/template review](layout-template-review.md), and [public release review](public-release-review.md) provide historical evidence and its limits. Recheck the current revision and runtime for each release.

## Build a setup EXE

After creating a portable folder:

```powershell
node phase6/package-installer.cjs --package artifacts/phase6/my-new-package --output artifacts/phase6/my-new-installer --development
```

Use fresh output directories. This builds an assisted per-user Windows setup with a MusicMeters Start menu shortcut and uninstall entry. It does not run the installer. FFmpeg and FFprobe remain separate prerequisites. The portable and installed app share the existing `music-visualizer` user-data directory; templates and preferences survive reinstall/uninstall. Automatic updates and signing are not supplied.

`--development` permits a local package without its final source archive; that output is not a release candidate. For distribution, commit the intended source, build a clean portable folder, generate its exact matching source archive, then omit `--development` when compiling setup. The wrapper verifies the package hashes and source descriptor and records setup and portable hashes in `INSTALLER-PROVENANCE.json`. Distribute setup with that same source archive. Do not edit or add files in the portable folder after compiling setup.

Builder caches default to ignored `artifacts/installer-cache`; the local development environment also isolates temp/npm caches. The setup compiles at moderate compression by default, overridable with `ELECTRON_BUILDER_COMPRESSION_LEVEL`. See the release checklist for validation. The hosted CI lifecycle test intentionally refuses to install on a developer account.
