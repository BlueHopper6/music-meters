# First Windows x64 public preview plan

Prepared for owner review on 2026-10-26 after the owner requested testing on the development laptop and retaining the installed Electron runtime. This plan proposes two exceptions for the first public preview. Preparing it does not approve a public upload. The final release approval must explicitly accept these exceptions and identify the exact binary/source ZIP names, commit, and SHA-256 hashes.

## Proposed exceptions

1. **Electron 45.0.0 security patch gap.** Retain the pinned stable Electron 45.0.0, which embeds Node 24.22.0. Node 24.22.1 contains security fixes absent from that embedded runtime. The official Electron release list checked on 2026-10-26 offers the newer Node in prereleases, but no patched stable runtime. This exception accepts an unresolved security patch gap; application sandboxing and passing tests do not establish that the missing fixes are irrelevant. Updating the separately installed Node does not update Electron's embedded Node. Recheck stable Electron immediately before final approval; prefer a patched stable release if one becomes available, and rebuild/retest the pair after upgrading. Track a follow-up runtime update after the preview if it ships on 45.0.0.
2. **Clean Windows manual validation deferred.** Use the fresh hosted Windows CI evidence and a manual packaged-app pass on the existing development Windows laptop for this preview. A fresh app profile does not make this laptop a clean Windows installation. Record that clean Windows installation behavior, another physical machine, and download-triggered SmartScreen behavior remain unverified. Resume clean Windows testing when an environment is available. Do not report the clean-machine gate as passed.

These are deviations from the normal release requirements in [the release checklist](release-checklist.md), not results of a successful patched-runtime or clean-machine test. The owner reviews them with the release changes before merging and explicitly accepts them when approving the final public upload.

## Required work before upload

- Complete and record the manual Windows pass: launch without a developer terminal; native open/save dialogs; WAV/MP3/FLAC; late-timestamp multiple-meter preview; selection, templates, project save/reopen and dirty guards; MP4/AAC and MKV copy export; playback and synchronization; overwrite protection; cancellation and partial-file cleanup. Record unsigned-binary/antivirus behavior and any untested permissions scenario. Local copies may lack Mark-of-the-Web, so absence of a SmartScreen prompt is inconclusive.
- Review the owner-confirmed logo policy in `LICENSE-NOTICES.md`, including contribution use and independent-fork rebranding. Preserve GPL rights to the software and all third-party notices. This records the owner's policy and the technical distribution checks; it is not an independent legal opinion on enforceability.
- Review and merge all intended release changes, with a passing hosted Windows CI run for the release changes. Build a fresh portable folder from the final clean commit, generate its matching source ZIP, validate its checksum and provenance, and complete the extracted-source rebuild check. Rerun the required package tests and final manual pass on that exact pair. Earlier evaluation ZIPs remain private historical evidence.
- Provide the binary ZIP, named matching source ZIP, and checksums together with equivalent access at the same download location and no extra source charge. GitHub's automatically generated source ZIP is insufficient because it omits the pinned ignored Prism tree.
- Obtain the owner's explicit approval of the final pair before any public upload. The owner handles merging the release changes.

## Required release-note disclosures

Describe the release as an initial Windows x64 portable preview. State that FFmpeg and FFprobe must be installed separately and available on PATH, and that no installer, signing, or automatic update channel is supplied. State the Electron/Node patch gap and the development-laptop validation limit above. Avoid claims of clean-machine validation or security clearance.

Sources: [Electron release list](https://releases.electronjs.org/), [Node 24.22.1 security release](https://nodejs.org/en/blog/release/v24.22.1), [GPLv3 section 7](https://www.gnu.org/licenses/gpl-3.0.html#section7), and [Mozilla's open source branding guidance](https://www.mozilla.org/en-US/foundation/trademarks/policy/#open-source-project-guidelines). Mozilla is a policy example; MusicMeters uses its own notice and permissions.
