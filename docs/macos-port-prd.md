# MusicMeters macOS Port: Product Requirements & Architecture Specification

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines the architecture, security invariants, platform adaptations, packaging format, corresponding-source compliance, and automated verification matrix for running and packaging **MusicMeters** natively on macOS alongside the existing Windows release target.

Included in scope:

- Native compilation of the pinned Prism C++17/Objective-C++ N-API DSP addon (`visualizer_dsp.node`) against Electron `45.3.0` (`node 24.22.2` headers) on macOS.
- Cross-platform Electron runtime and packaged executable resolution for both Windows portable directories (`MusicMeters.exe`) and macOS application bundles (`MusicMeters.app/Contents/MacOS/MusicMeters`).
- Bounded, injection-safe macOS font discovery and deterministic cross-platform font fallback so built-in factory layouts and projects created on either Windows or macOS open, preview, and export consistently without silently corrupting saved project files.
- Deterministic FFmpeg and FFprobe discovery that works both from terminal sessions and when `MusicMeters.app` is launched from Finder/Dock (where macOS provides a minimal `PATH` that omits `/opt/homebrew/bin` and `/usr/local/bin`).
- macOS filesystem, canonical temporary path (`/var/folders` -> `/private/var/folders`), symlink/junction defense, external volume (`/Volumes/...`), cross-OS missing-media relink recovery, case-sensitivity, and Trash semantics.
- Native macOS window chrome (`titleBarStyle: 'hiddenInset'` with traffic-light inset), macOS application menu integration (`MusicMeters`, `File`, `Edit`, `Templates`, `View`, `Window`, `Help`), `Command`-key (`metaKey`) shortcuts, and Dock `activate` / `window-all-closed` / `before-quit` lifecycle management.
- Self-contained macOS `.app` bundle and full package `.zip` archive packaging (`phase6/package-macos.cjs`) with `Info.plist`, `.icns` bundle icon, preserved `Framework` symbolic links, ad-hoc code signing (`--sign -`) for contribution/CI builds, `phase6/MACOS-README.md` (`README.md`), license notices, `BUILD-PROVENANCE.json`, and `SOURCE-ARCHIVE.json`.
- Corresponding-source archive generation and verification (`phase6/release-source.py`, `phase6/test/source-archive.py`) supporting both Windows and macOS packages.
- Automated GitHub Actions macOS CI workflow (`.github/workflows/macos-build.yml`) executing native builds, unit tests, strict TypeScript checks, `.app` packaging, Mach-O and path-privacy audits, packaged smoke/security/export suites, and extracted-source rebuild verification.

### 1.2 Non-Goals

- Modifying upstream Prism DSP algorithms or tracked files under `upstream/prism`.
- Introducing runtime network calls, auto-updaters, telemetry, or cloud services.
- Changing the project schema version or breaking backward compatibility with existing v1/v2 MusicMeters project files.
- Publishing signed/notarized public macOS release binaries without explicit release-gate sign-off and Apple Developer ID credentials.

---

## 2. Target macOS Versions and Architectures

| Target | Architecture | Bundle Minimum OS (`LSMinimumSystemVersion`) | CI Runner Image (Verified OS) | Packaging Output |
| :--- | :--- | :--- | :--- | :--- |
| Apple Silicon | `arm64` | macOS `13.0` (`phase6/application.cjs`; native addon `MACOSX_DEPLOYMENT_TARGET: 10.15`) | `macos-15` (`arm64`, macOS 15.7.5) | `MusicMeters.app` + `MusicMeters-macos-arm64.zip` |
| Intel Mac | `x64` | macOS `13.0` (`phase6/application.cjs`; native addon `MACOSX_DEPLOYMENT_TARGET: 10.15`) | `macos-15-intel` (`x64`, macOS 15.7.5) | `MusicMeters.app` + `MusicMeters-macos-x64.zip` |

> **Runtime verification scope:** `LSMinimumSystemVersion: 13.0` in `Info.plist` matches the minimum declared by the bundled Electron 45 Mach-O executable. The packaged branding test rejects a bundle minimum below its executable/framework requirements. This metadata floor does not establish oldest-OS compatibility. Automated CI targets GitHub-hosted macOS 15 (`macos-15` and `macos-15-intel`); macOS 13–14 remain unverified until tested on target OS hardware or VMs. Recheck CI results for the exact source being released.

Pinned runtime dependencies remain identical across Windows and macOS:

- **Application version**: `1.3.0` (`phase6/application.cjs`)
- **Electron runtime**: `45.3.0` (`phase6/electron-runtime.cjs`)
- **Electron Node headers**: `24.22.2`
- **Prism commit**: `49721802252b115d169e353c98b27408daa5e2b7` (`upstream/prism`)

---

## 3. Security Invariants

All Windows security controls remain mandatory on macOS:

1. **BrowserWindow Hardening (`phase2/window-security.cjs`)**:
   - `contextIsolation: true`
   - `sandbox: true`
   - `nodeIntegration: false`
   - `webSecurity: true`
   - `allowRunningInsecureContent: false`
   - `experimentalFeatures: false`
   - `webviewTag: false`
   - `navigateOnDragDrop: false`
   - `spellcheck: false`
2. **Navigation, Popup, and Permission Lockdown**:
   - `setWindowOpenHandler(() => ({ action: 'deny' }))`
   - `will-navigate` and `will-attach-webview` prevented on all windows.
   - `session.setPermissionRequestHandler` and `session.setPermissionCheckHandler` deny all permission requests.
3. **Content Security Policy (`phase2/editor-app/index.html`, `phase2/export-app/index.html`)**:
   - Strict local-only CSP (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src musicmeters-preview:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'`).
4. **IPC Boundary Validation (`phase2/editor-app/main.cjs`)**:
   - Every `ipcMain.handle` and `ipcMain.on` handler verifies `assertTrustedSender(event)` (`event.sender === win.webContents` and `event.senderFrame === win.webContents.mainFrame`).
   - All renderer-supplied project objects, paths, numbers, and options are normalized and validated before use.
   - Audio, video, and image file paths are capability-gated by native file-picker selection or validated project-relative membership (`allowedAudioPaths`, `allowedVideoPaths`, `allowedImagePaths`).
5. **Subprocess Safety**:
   - All child processes (`ffmpeg`, `ffprobe`, `system_profiler`, `electron`, `node-gyp`) are spawned with `shell: false` and explicit argument arrays.
6. **Symlink and Junction Rejection (`phase2/media-storage.cjs`, `phase2/project-library.cjs`)**:
   - All project, artwork, video, and audio file operations reject symbolic links and junctions inside user, workspace, and project directory trees.

---

## 4. Platform Architecture and Technical Adaptations

### 4.1 Electron Runtime and Packaged Bundle Layout

| Component | Windows (`win32`) | macOS (`darwin`) |
| :--- | :--- | :--- |
| Unpackaged Electron binary | `upstream/prism/node_modules/electron/dist/electron.exe` | `upstream/prism/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` |
| Packaged executable | `<package>/MusicMeters.exe` | `<package>/MusicMeters.app/Contents/MacOS/MusicMeters` (or `<app>/Contents/MacOS/MusicMeters`) |
| Packaged app payload | `<package>/resources/app` | `<package>/MusicMeters.app/Contents/Resources/app` |
| Bundle metadata & icon | PE resources + `music-meters.ico` | `Contents/Info.plist` (`com.musicmeters.app`) + `Contents/Resources/music-meters.icns` |
| Top-level notices & provenance | `<package>/<NOTICE>`, `README.md` (`phase6/PORTABLE-README.md`), `BUILD-PROVENANCE.json`, and `SOURCE-ARCHIVE.json` | `<package>/<NOTICE>`, `<package>/README.md` (`phase6/MACOS-README.md`), `<package>/BUILD-PROVENANCE.json`, `<package>/SOURCE-ARCHIVE.json`, and `MusicMeters.app/Contents/Resources/<NOTICE>` |
| Final downloadable `.zip` | Portable directory archive | Full `<package>` directory archive (`node phase6/package-macos.cjs --pack-existing <package-dir> --zip <zip>`) containing `MusicMeters.app`, `BUILD-PROVENANCE.json`, `SOURCE-ARCHIVE.json`, `README.md`, `BUILD-CONFIGURATION.md`, and all license/notice files |

`phase6/electron-runtime.cjs` and `phase6/packaged-executable.cjs` resolve both layouts deterministically and expose helpers (`packagedExecutable`, `packagedAppRoot`, `packagedNoticePath`) used across runtime, smoke tests, and source-archive verification.

### 4.2 Native Addon Compilation and Path Privacy (`phase6/build-native.cjs`)

- On macOS, `upstream/prism/native/binding.gyp` compiles `visualizer_dsp.node` with Clang (`-std=c++17 -O3 -ffast-math`), Objective-C++ ARC (`CLANG_ENABLE_OBJC_ARC: YES`), `MACOSX_DEPLOYMENT_TARGET: 10.15`, and links `Foundation`, `CoreAudio`, and `AudioToolbox`.
- To prevent build-machine paths (`/Users/...`, checkout directory, temporary directories) from leaking into Mach-O symbol tables or DWARF debug info:
  - `phase6/build-native.cjs` passes `-ffile-prefix-map=<root>=.` and `-fdebug-prefix-map=<root>=.` (plus home-directory prefix remapping when applicable) via `CFLAGS` and `CXXFLAGS`, strips local file symbols with `strip -x` on macOS release builds, and scans the resulting `.node` binary against `privacyMarkers()` (failing the build if `root`, `HOME`, `USERPROFILE`, `/Users/<user>`, or `/private/var/folders` appears).

### 4.3 Installed Font Discovery and Cross-Platform Font Fallback (`phase2/fonts.cjs`, `phase2/composition.ts`)

- **macOS Discovery**:
  - `phase2/fonts.cjs` queries `/usr/sbin/system_profiler SPFontsDataType -json` (`shell: false`, bounded timeout and buffer) to extract enabled, valid typographic font family names (`typefaces[].family`) and merges the cross-platform baseline font families (`BASELINE_FONTS`). Raw font filenames are not used as family names on macOS because file stems differ from typographic family names.
  - Every discovered family name is validated through `validFontFamily()` (`phase2/project.cjs`), deduplicated, and sorted with deterministic locale comparison.
- **Cross-Platform Font Equivalence & Fallback**:
  - Built-in baseline families (`Segoe UI`, `Arial`, `Georgia`, `Consolas`, `Bahnschrift`) and macOS counterparts (`Helvetica Neue`, `Menlo`, `SF Pro`, `Avenir`, `Courier New`) map to deterministic fallback chains (`CROSS_PLATFORM_FONT_FALLBACKS` and `canvasFontStack(fontFamily)`).
  - Saved project `.json` files are never silently mutated when opened on another OS; `layer.fontFamily` is preserved, `Composition` renders with `canvasFontStack(layer.fontFamily)` in both editor preview and export workers (ensuring 1:1 preview/thumbnail/export parity), and the inspector font selector surfaces active cross-platform fallback information in its tooltip/title.
  - Arbitrary uninstalled fonts outside the known cross-platform fallback set continue to be rejected by `assertInstalledFonts()`.

### 4.4 FFmpeg and FFprobe Discovery (`phase2/ffmpeg.cjs`)

- Finder-launched macOS `.app` bundles inherit a minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) that excludes Homebrew installations.
- `phase2/ffmpeg.cjs` resolves `ffmpeg` and `ffprobe` without spawning login shells:
  1. Explicit validated environment overrides (`MUSICMETERS_FFMPEG_PATH`, `MUSICMETERS_FFPROBE_PATH`).
  2. Entries in `process.env.PATH`.
  3. On `darwin`, standard fixed package directories: `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`.
- Resolved paths are verified as regular executable files and used across `phase2/build.cjs`, `phase2/audio.cjs`, `phase2/project-media.cjs`, `phase2/video-frames.cjs`, `phase2/export-app/main.cjs`, and `phase1/pcm-reader.cjs`.

### 4.5 Filesystem, Symlinks, Volumes, Case Sensitivity, and Trash

- **Canonical Temp Paths (`phase2/runtime.cjs`)**:
  - On macOS, `os.tmpdir()` points under `/var/folders/...`, where `/var` is a Darwin root symlink to `/private/var`. `realTempDir()` resolves `fs.realpathSync` so temporary job files, media caches, and preview caches operate on canonical `/private/var/folders/...` paths.
- **Symlink Defense (`phase2/media-storage.cjs`, `phase2/project-library.cjs`)**:
  - `assertLocal()` walks every ancestor component from the target path to the filesystem root and rejects any symbolic link or junction, while recognizing the three immutable Darwin root system aliases (`/var`, `/tmp`, `/etc` -> `/private/...`) at root depth so canonical and non-canonical temp paths work without weakening symlink rejection inside any subdirectory.
- **Cross-Volume and Cross-OS Media References (`phase2/project-audio.cjs`, `phase2/editor-app/main.cjs`, `phase2/project-library.cjs`)**:
  - `projectAudioReference()` accepts POSIX absolute paths on macOS as well as Windows drive paths on Windows, producing portable relative paths within the same volume and preserving `/Volumes/<Drive>/...` references when a project links media on an external macOS volume.
  - Foreign-platform references (`C:\...`, `D:\...` opened on macOS, or `/Volumes/<Drive>/...` opened on Windows) are detected via `isForeignPlatformReference()` and preserved verbatim by `resolveProjectAudio()`, `projectAudioReference()`, and `renameLibraryProject()` without inventing local paths, colliding distinct drive letters, or probing local disk. `missingMedia` reports foreign-platform references as missing so the user can relink them via `Relink…`, or keep them intact across unrelated edits, Save, Save As, and library operations.
- **Case-Sensitivity, Inode Identity, and Thumbnail Cache Keys (`phase2/media-storage.cjs`, `phase2/project-thumbnails.cjs`)**:
  - `samePath()` compares resolved paths and, when both paths exist on disk, verifies `stat.dev` and `stat.ino` so case-only renames (`New Project` -> `new project`) work on case-insensitive APFS/NTFS while distinct files on case-sensitive APFS volumes are never conflated.
  - `phase2/project-thumbnails.cjs` keys cached thumbnails by the canonical on-disk path (`fs.realpathSync.native` with `path.resolve(file)` fallback, without `.toLowerCase()`) so case-distinct projects on case-sensitive volumes never overwrite or return each other's cached thumbnails.
- **Trash Semantics**:
  - Project deletion uses `shell.trashItem()` with platform-accurate confirmation and status copy (`Trash` on macOS; `Recycle Bin` on Windows).

### 4.6 Window Chrome, Menus, Shortcuts, and App Lifecycle

- **Window Chrome**:
  - On macOS, `BrowserWindow` uses `titleBarStyle: 'hiddenInset'` with `trafficLightPosition: { x: 14, y: 12 }`.
  - When `document.body.classList.contains('platform-darwin')` is active, `.app-titlebar-content` reserves left inset (`82px`, collapsing to `12px` in fullscreen) for the native traffic lights and hides the Windows right-hand `.window-controls` cluster.
- **Application Menu and Shortcuts (`phase2/editor-app/darwin-platform.cjs`, `phase2/editor-app/main.cjs`, `phase2/editor.ts`)**:
  - On macOS, `Menu.setApplicationMenu` installs a native macOS application menu (`MusicMeters`, `File`, `Edit`, `Templates`, `View`, `Window`, `Help`) wired through `menu-command` IPC (`onMenuCommand` in `preload.cjs` and `editor.ts`) while keeping the in-window command toolbar functional.
  - `Edit -> Undo` and `Edit -> Redo` preserve native text editing (`document.execCommand`) when a text input or textarea is focused and route to project-history `restoreEdit(-1 | 1)` otherwise.
  - Command-key shortcuts (`Cmd+N`, `Cmd+O`, `Cmd+S`, `Cmd+Shift+S`, `Cmd+W`, `Cmd+Z`, `Cmd+Shift+Z`, `Cmd+Y`, `Cmd+E`, `Cmd+F`, `Cmd+Q`, and `Ctrl+Cmd+F` / `F11`) work alongside native text-input editing (`Cmd+C`, `Cmd+V`, `Cmd+X`, `Cmd+A`, `Cmd+Z` inside text fields).
- **Lifecycle (`activate`, `window-all-closed`, `before-quit`)**:
  - IPC handlers in `phase2/editor-app/main.cjs` are registered once at application startup and bound to the current `win` reference so closing the window on macOS (`Window -> Close Window` or the traffic-light close button) keeps the application process alive (`shouldQuitOnWindowAllClosed` returns `false` when `!quitRequested`) and clicking the Dock icon (`activate`) recreates the window via `createWindow()` without duplicating IPC handlers.
  - Closing the editor window on macOS stops active preview/playback/media preparation and resets the project session (`resetProjectSession()`), or cancels an in-flight export before closing the window.
  - Unsaved changes are guarded on window close, `Cmd+W`, `Cmd+Q`, Dock/OS Quit (`before-quit`), and menu Quit (`cancel-app-close` resets `quitRequested` and `forceQuit` when the user cancels the unsaved-changes prompt or native Save dialog). Automated test sessions (`isAutomatedTest`) quit deterministically when the test finishes.

### 4.7 Code Signing, Notarization, and Public Release Gates

- `phase6/package-macos.cjs` supports ad-hoc Mach-O code signing (`codesign --force --sign -`) only (`assertSupportedSignIdentity`) for local contributor and CI builds (required by Apple Silicon's kernel task policy when modifying bundled Mach-O executables and frameworks), and records `signingMode: "adhoc"` in `BUILD-PROVENANCE.json`.
- Passing any non-ad-hoc signing identity (`MUSICMETERS_MACOS_SIGN_IDENTITY`) is explicitly rejected until a dedicated Developer ID release-signing workflow (with `--options runtime`, secure `--timestamp`, Electron helper entitlements, `xcrun notarytool submit`, and `xcrun stapler staple`) is separately implemented and approved.
- Production macOS releases require Developer ID Application signing and Apple notarization on the exact release archive. Ad-hoc signed CI builds are development/contribution verification artifacts and must never be called notarized.
- A project-owner-approved experimental GitHub prerelease may instead use ad-hoc signing without paid Apple enrollment. Record that exception for the exact source/binary pair, clearly label the download **unnotarized**, disclose OS/architecture, FFmpeg prerequisites and deferred acceptance checks, and obtain separate owner approval before publication. Such a preview does not satisfy the production signing or clean-Mac gates; macOS may block its launch. Documentation and release notes must never instruct users to strip quarantine extended attributes or bypass macOS Gatekeeper.

---

## 5. Requirements-to-Test Matrix

| Requirement ID | Requirement Summary | Primary Modules | Automated Verification |
| :--- | :--- | :--- | :--- |
| `MAC-01` | Electron runtime & packaged `.app` binary/resource resolution on `darwin` and `win32` | `phase6/electron-runtime.cjs`, `phase6/packaged-executable.cjs` | `phase2/test/macos-support.test.cjs`, `phase6/test/package-macos-branding.cjs` |
| `MAC-02` | Native `visualizer_dsp.node` build on macOS with Clang prefix-map privacy flags and zero path leaks | `phase6/build-native.cjs`, `BUILD-CONFIGURATION.md` | `node phase6/build-native.cjs`, Mach-O `file`/`otool -L`/string scan in `.github/workflows/macos-build.yml` |
| `MAC-03` | Bounded macOS font discovery (`SPFontsDataType` + font directories) and cross-platform font fallback without mutating project JSON | `phase2/fonts.cjs`, `phase2/project.cjs`, `phase2/composition.ts`, `phase2/editor.ts` | `phase2/test/fonts.test.cjs`, `phase2/test/macos-support.test.cjs`, `phase2/test/run-startup-smoke.cjs` |
| `MAC-04` | Deterministic FFmpeg/FFprobe discovery across `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, and explicit overrides | `phase2/ffmpeg.cjs`, `phase2/build.cjs`, `phase2/audio.cjs`, `phase2/project-media.cjs`, `phase2/video-frames.cjs`, `phase1/pcm-reader.cjs`, `phase2/export-app/main.cjs` | `phase2/test/macos-support.test.cjs`, `node phase2/build.cjs`, packaged export smoke suites |
| `MAC-05` | Canonical temp paths (`/private/var/folders`), Darwin root symlink handling, user symlink rejection, `/Volumes/...` & cross-OS missing-media relink, case-sensitivity, Trash copy | `phase2/runtime.cjs`, `phase2/media-storage.cjs`, `phase2/project-library.cjs`, `phase2/project-audio.cjs`, `phase2/editor-app/main.cjs` | `phase2/test/macos-support.test.cjs`, `phase2/test/media-storage.test.cjs`, `phase2/test/project-library.test.cjs`, `phase2/test/project-audio.test.cjs` |
| `MAC-06` | macOS `hiddenInset` traffic-light window chrome, application menu, `Command`-key shortcuts, and Dock `activate`/quit lifecycle | `phase6/application.cjs`, `phase2/editor-app/main.cjs`, `phase2/editor.ts`, `phase2/editor-app/style.css`, `phase2/editor-app/index.html` | `phase2/test/run-startup-smoke.cjs`, `phase2/test/run-history-smoke.cjs`, `phase2/test/run-portrait-smoke.cjs` |
| `MAC-07` | Self-contained `MusicMeters.app` + `.zip` packaging with `Info.plist`, `.icns`, preserved Framework symlinks, notices, ad-hoc `codesign`, and `BUILD-PROVENANCE.json` | `phase6/package-macos.cjs`, `phase6/test/package-macos-branding.cjs` | `node phase6/package-macos.cjs`, `node phase6/test/package-macos-branding.cjs`, `node phase6/test/package-smoke.cjs` |
| `MAC-08` | Security invariants (`contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP, popup/navigation denial, trusted IPC sender) on packaged macOS `.app` | `phase2/window-security.cjs`, `phase2/editor-app/main.cjs` | `node phase6/test/run-security.cjs`, `node phase6/test/window-security.test.cjs` |
| `MAC-09` | Full packaged editor, playback, portrait, repeat export, audio matrix/copy, media storage, meter style, export range, video transform, thumbnails, feedback, and snapping suites on macOS | `phase2/test/*`, `phase6/test/*` | `.github/workflows/macos-build.yml` packaged test steps |
| `MAC-10` | Corresponding-source archive generation, SHA-256 provenance verification, and clean rebuild from extracted source archive on macOS | `phase6/release-source.py`, `phase6/test/source-archive.py` | `python phase6/test/source-archive.py` on macOS CI runner |
| `MAC-11` | Zero regressions on Windows build, unit tests, strict TypeScript check, and packaging | All shared modules | `.github/workflows/windows-build.yml` and local Windows verification suite |

---

## 6. Phased Execution Plan and Release Gates

1. **Phase 1 — Architecture, PRD, and Local Cross-Platform Implementation**:
   - Land cross-platform runtime/package helpers, `phase2/ffmpeg.cjs`, macOS font discovery and fallback, path/symlink/Trash adaptations, macOS window/menu/shortcut/Dock lifecycle, `phase6/package-macos.cjs`, source-archive updates, unit tests, and `.github/workflows/macos-build.yml`.
   - Pass all local Windows unit tests, strict TypeScript validation, and Windows regression checks.
2. **Phase 2 — GitHub-Hosted macOS Runner CI Verification**:
   - Execute `.github/workflows/macos-build.yml` on GitHub-hosted macOS runners.
   - Verify native compilation, Mach-O architecture, path privacy, unit tests, `.app` bundle integrity, packaged smoke/security/export suites, and extracted-source rebuild.
3. **Phase 3 — Independent Review & PR Merge Gate**:
   - Complete independent verification of macOS and Windows CI artifacts and logs before merging to `main`.
4. **Phase 4 — Release & Signing Gate**:
   - Keep public release notes explicit regarding unsigned/ad-hoc signed builds versus Apple Developer ID signed/notarized releases.
   - Require exact-pair source archive verification and anonymous download verification before publishing any public macOS release asset.
