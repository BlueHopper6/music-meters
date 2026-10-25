# Windows portable public release review

**Status as of 2026-10-25: development preview only.** This is an inventory and release gate, not legal clearance. It covers the Windows x64 folder built by `phase6/package-windows.cjs`; an installer, other operating systems, or a future dependency set need a new review.

## What the folder contains

| Component | Evidence and license material | Release action |
| --- | --- | --- |
| MusicMeters application code and brand images | This repository has no root `LICENSE` file. The `phase2/editor-app/assets/brand/` images came from a local master image. The project owner confirmed on 2026-10-25 that they own or have permission to redistribute it. | The copyright owner must choose and publish an appropriate license for the application code. Keep the logo permission record with the release materials. |
| Prism native addon and bundled Canvas painters | `upstream/prism` is fixed at `49721802252b115d169e353c98b27408daa5e2b7`; its package declares `GPL-3.0-only`. The package copies `PRISM-LICENSE.txt`, but the full Prism source is not in the binary folder or this Git repository. `phase2/build.cjs` injects offline rendering methods when bundling Prism painter source. | Treat the distributed app as a combined GPLv3 work unless qualified legal review establishes another basis. Provide the exact corresponding application and Prism source, including build and adaptation scripts, with equivalent access when publishing a binary. Preserve upstream notices and identify the pin. |
| node-addon-api 8.6.0 | Prism's `native/binding.gyp` includes its headers. The dependency declares MIT and the portable folder now includes `NODE-ADDON-API-LICENSE.md`. | Keep the MIT notice with the native addon. |
| Electron 45.0.0 | The standalone `phase6/electron-runtime/package-lock.json` fixes the version. Packaging copies Electron's `LICENSE` and `LICENSES.chromium.html` with the runtime. Its `ffmpeg.dll` is included there and has a notice in the Chromium file. | Keep both runtime license files. Review the exact final Electron version again before publication. |
| External FFmpeg and FFprobe command-line tools | The package calls executables on the user's `PATH`; it does not copy `ffmpeg.exe` or `ffprobe.exe`. | Document this prerequisite. If these executables are later bundled, inspect that build's enabled codecs and license terms before distribution. |
| Fonts | The editor CSS names Windows/system fonts and does not bundle font files. | Recheck if packaged fonts are added. |

The [GPLv3 text](https://www.gnu.org/licenses/gpl.en.html) and the [GNU compatibility FAQ](https://www.gnu.org/licenses/gpl-faq.en.html) explain the corresponding-source and combined-work questions. The source delivery method must be decided for the actual release channel. A pointer to an upstream repository alone does not establish that recipients can obtain all source and build scripts corresponding to a particular binary.

## Security and distribution gates

1. **Open: Electron patch level.** Electron 45.0.0 is supported, but its bundled Node is 24.22.0. Node 24.22.1 is the October 2026 security release. As of this review, only Electron prereleases carry it; wait for a patched stable build, upgrade the exact runtime lock, and rerun the Windows package smokes before a public binary. [Electron releases](https://releases.electronjs.org/) · [Node security release](https://nodejs.org/en/blog/release/v24.22.1)
2. **Open: application license and source delivery.** Obtain the copyright owner's licensing decision and publish corresponding source for the final binary. The ignored `upstream/prism` checkout cannot be assumed to travel with a source archive of this repository.
3. **Partially resolved: asset provenance.** The project owner confirmed redistribution rights for the logo master and derived PNG/ICO assets on 2026-10-25. Keep that confirmation with release records; identify any other externally sourced assets before publication.
4. **Open: final-machine validation.** Test the exact binary on a clean Windows x64 installation with FFmpeg/FFprobe available. Inspect native dialogs, SmartScreen behavior, and output files. No signing, installer, or update channel exists yet.
5. **Open: pinned build tools.** `npm audit` on the Prism checkout reports 33 findings (1 critical, 28 high, 1 moderate, 3 low), including a critical transitive `tar` finding under the native build toolchain. The separately locked Electron 45 runtime dependency reports zero npm audit findings. Prism's development dependency tree is not copied into the portable folder, but it runs during the build. Review and update that toolchain reproducibly before treating a public build pipeline as finalized; the npm audit counts alone do not establish exploitability in this app.
6. **Open: Electron application security review.** The editor and exporter already set `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` and load local HTML. Before publication, review navigation and new-window handling, content security policy, and IPC sender validation against [Electron's security checklist](https://www.electronjs.org/docs/latest/tutorial/security) and verify any hardening with the editor/export smokes.

Local packaged export and editor smoke tests establish that Electron 45.0.0 can run the pinned addon and renderer on the development machine. They do not close the security, legal, or clean-machine gates above.

## Local verification on 2026-10-25

- `node phase2/build.cjs` and `node phase6/package-windows.cjs --output artifacts/phase6/electron45-release-review-final-20261025` passed. The final package contains Electron 45.0.0 and all five checked license/notice files.
- The project's 37 unit tests passed. The final package MP4 smoke decoded 60 H.264 frames and AAC audio, and the packaged editor smoke completed two exports.
- The packaged audio matrix passed nine cases. The two-minute stress export decoded all 3,600 frames and AAC audio; the late frame at 119 seconds was visually inspected. Its main-process peak RSS was 188,157,952 bytes.
- `npm audit` reported zero findings for the separate Electron runtime lock and 33 for the pinned Prism build tree as described above.
- The development machine uses Node 26.12.1 and an existing Prism native addon. The native addon was not rebuilt as part of this local pass. The pull-request Windows CI build and a clean-machine run remain to be checked.
