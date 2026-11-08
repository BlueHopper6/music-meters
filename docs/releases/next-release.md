# MusicMeters 1.3.0 - macOS Experimental Preview 1 (draft)

Preparation only. Replace the sections below with verified final release details before publication. Exact downloads, hashes, dates, source revision, and validation must come from the frozen candidate. Do not publish preparation placeholders.

The previous announcement is [MusicMeters 1.3.0](1.3.0.md). Keep its historical validation and hashes unchanged.

This first Mac preview brings MusicMeters' offline editor and video exports to Apple Silicon and Intel Macs. It is experimental and **unnotarized**: macOS may block downloaded builds. Windows users can continue using the existing stable 1.3.0 release.

## Changes

- macOS application bundles for Apple Silicon (`arm64`) and Intel (`x64`).
- Native Mac window controls, application menus, keyboard shortcuts, and normal window reopening behavior.
- FFmpeg/FFprobe discovery in standard macOS package-manager locations as well as configured paths.
- Preserve foreign Windows media references and distinguish thumbnail locations on case-sensitive volumes.

Thanks to [@NitronicM](https://github.com/NitronicM) for native Mac testing and the window, type-checking, and runtime-requirement fixes in [PR #39](https://github.com/BlueHopper6/music-meters/pull/39).

The meters, templates, media layers, project storage, PNG stills, and export controls are existing MusicMeters features carried into the Mac build.

## Download and run

Choose the package matching your Mac's processor. The bundled runtime requires **macOS 13 or later**; this minimum is not confirmation of testing on every supported OS. Keep the full extracted package, including notices and provenance, together and open `MusicMeters.app`.

Install the separate `ffmpeg` and `ffprobe` command-line tools before importing media or exporting video (for example, `brew install ffmpeg`). They are not bundled. Verify both commands in Terminal. The app also checks standard installation locations when launched outside Terminal.

## Known limitations

- Ad-hoc signed, without an Apple-verified Developer ID or Apple notarization; managed Macs may prohibit it. No automatic updater.
- Clean-Mac browser-download/Gatekeeper acceptance, macOS 13–14, external and case-sensitive volumes, and the broader native-dialog/Trash acceptance checklist remain unverified.
- The contributor reported an intermittent video-drag test failure on the unchanged baseline followed by an unchanged passing retry; no cause or fix is established.
- FFmpeg and FFprobe remain external prerequisites. Linux remains unverified.
- This preview does not replace the published Windows release or satisfy the production Mac signing gates.

## Source and licenses

Software code is GPL-3.0-only, with separate branding terms. Each architecture must be published with the exact source ZIP named by its `SOURCE-ARCHIVE.json`, including pinned Prism source and notices. GitHub's automatic source archive alone is insufficient.

## Validation

The contributor head `27cd0bc8b764301490a8cfebac79f485f28d228a` passed [macOS CI on both architectures](https://github.com/NitronicM/music-meters/actions/runs/42437925779) and [Windows CI](https://github.com/NitronicM/music-meters/actions/runs/42437925850), including packaged tests and corresponding-source rebuilds. These are contributor-head results, not clearance of a future release's final bytes.

Independent Windows review passed renderer build, strict TypeScript, all 160 unit cases after a sandbox-permission rerun, fresh package branding, and packaged security/startup/portrait/import-feedback/source-copy-editor checks. The contributor reports manual Apple Silicon checks of window chrome, template creation, WAV Copy import, audible playback, and project save/reopen; these were not independently observed by the maintainer.

Before publication: replace this paragraph with the final source revision, exact owner-workflow results, frozen-archive checks, explicit experimental exceptions, and actual test scope. Retest the extracted final Mac download where possible; do not relabel contributor evidence as final-download or clean-machine testing.

## Exact downloads

List each approved filename, byte count, and SHA-256 checksum. Verify server digests and anonymous full downloads after publication.
