# Run and test MusicMeters locally

For running a downloaded build, use the [README](../README.md). These instructions are for Windows x64 development; there is no root package.json.

For a first checkout, complete the prerequisites, Prism/build-tools setup, and pinned Electron installation below. Then use [Run during development](#run-during-development) for the edit/run loop and [Test your changes](#test-your-changes) for verification. All commands run in PowerShell from the repository root. This guide uses tracked scripts available to contributors; no private/local launcher is required.

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

## Run during development

After completing the setup above, create an isolated development session so experiments use separate preferences, templates, and temporary files. Run this once in your current PowerShell session:

```powershell
$devSession = Join-Path (Get-Location) ('artifacts/development/session-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$devSession/temp", "$devSession/user-data" -Force | Out-Null
$env:TEMP = Join-Path $devSession 'temp'
$env:TMP = $env:TEMP
$env:PHASE5_TEST_USER_DATA = Join-Path $devSession 'user-data'
```

These environment settings apply to this terminal and its child processes; they do not change system settings. The session folder is ignored by Git. Keep any test projects, exports, and sample media under that folder too. Closing the terminal ends these environment overrides; files remain available for inspection.

Launch the editor:

```powershell
node phase2/run.cjs
```

The launcher checks prerequisites, rebuilds the renderer, and opens the Project Manager. Create a project and import a local WAV, MP3, or FLAC to try your changes. For synthetic sample audio, run `python phase1/make-fixtures.py` and import `artifacts/phase1/fixtures/stereo-10s-48k.wav`.

After editing TypeScript, renderer HTML/CSS, or main/preload code, **close the development app and rerun `node phase2/run.cjs`**. There is no hot reload. Native code changes also require `node phase6/build-native.cjs` before relaunching. For a build without opening the app, use `node phase2/build.cjs`.

## Test your changes

Use the same isolated terminal session. Start with the checks relevant to your change; the [Windows CI workflow](../.github/workflows/windows-build.yml) is the reference for the complete suite and prerequisites.

### Unit tests and TypeScript

Generate the synthetic fixtures, then run the core project, history, template, and window-security tests:

```powershell
python phase1/make-fixtures.py
node --test phase2/test/project.test.cjs phase2/test/project-history.test.cjs phase5/test/templates.test.cjs phase6/test/window-security.test.cjs
```

Run the separate strict TypeScript check as well; bundling does not type-check:

```powershell
node phase6/build-tools/node_modules/typescript/lib/tsc.js --noEmit --strict --skipLibCheck --allowJs --checkJs false --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --typeRoots phase6/build-tools/node_modules/@types --types node upstream/prism/src/renderer/env.d.ts phase2/composition.ts phase2/editor.ts phase2/export-renderer.ts
git diff --check
```

Check each command's exit code (`$LASTEXITCODE`): zero means success. Stop and investigate failures before treating later commands as validation.

### Manual editor checks

Use a fresh test project and new output filenames:

1. Import audio and verify Play/Pause, seeking, and a full-history still.
2. Make a visible layer/text/style edit. Try Edit → Undo/Redo and Ctrl+Z / Ctrl+Y outside text fields; check the saved/unsaved indicator.
3. In the editor, use Templates → Manage templates… → Use layout. Confirm the audio stays loaded and plays. Seek to a different timestamp, then undo and redo the layout change; the playhead should stay at the current timestamp.
4. Save, close, and reopen the test project. Check its audio, artwork, layout, and preview position.
5. Export a short synthetic clip. Check the resulting video/audio and cancellation/recovery if your change affects export.

Include checks for the specific behavior and failure cases your change affects. Report what you actually ran and any remaining limitations in the pull request.

## Install Windows packaging tools

From the repository root, run `npm --prefix phase6/installer-tools ci --ignore-scripts --no-audit --no-fund`. This locked toolset provides executable branding and NSIS installer creation; it is used only at build time.

## Create a portable development package

```powershell
node phase6/package-windows.cjs --output artifacts/phase6/my-new-package
```

Choose a fresh output directory that does not already exist. Launch its `MusicMeters.exe` and keep the whole folder together. It includes Electron, built renderer code, runtime icons, and the pinned Prism native addon. System FFmpeg and FFprobe are required separately. Installed-font discovery and this packaging script currently require Windows; Linux and macOS are unvalidated.

Work files and export analysis caches use the current user's temp directory. Tests and development can redirect profiles/caches to isolated locations. Export checks estimated workspace needs and removes partial output after cancellation or failure.

### Packaged regression tests

After installing packaging tools and creating the development package above, run the packaged checks relevant to the change. Each command below uses an isolated test profile; choose output paths that do not already exist on each run:

```powershell
node phase2/test/run-startup-smoke.cjs --package artifacts/phase6/my-new-package
node phase2/test/run-history-smoke.cjs artifacts/phase6/my-new-package artifacts/phase6/my-history-test
node phase6/test/run-repeat.cjs --package artifacts/phase6/my-new-package artifacts/phase6/my-repeat-test
node phase6/test/run-security.cjs artifacts/phase6/my-new-package artifacts/phase6/my-security-test
```

The startup check covers project creation/open/save and editor commands; history covers audio retention and undo/redo; repeat covers exports, cancellation, and recovery; security checks the Electron window/IPC/CSP boundaries. Runners print their evidence paths and return a nonzero exit code on failure. These checks launch actual app processes and some display a test window. They do not install the app. Source changes require rebuilding a new package before rerunning packaged checks.

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
