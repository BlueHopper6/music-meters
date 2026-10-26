# Layout and template workflow review (2026-10-25)

This report covers `feature/layout-template-workflow`, based on `main` after the AAC export PR merge. It is development verification, not a public release candidate.

The stage uses fixed 1280 × 720 project coordinates. Its label now distinguishes that logical layout from the selected 1280 × 720 or 1920 × 1080 video output. Project coordinates and saved files are unchanged.

Saving a custom template with an existing name asks to replace it or choose a different name. Replacement retains the template ID and writes the new JSON before replacing the old file. Generated artwork that the new layout no longer references is pruned; unrelated files in its asset folder are left alone. Duplicates receive the next available Copy name. The Template Manager shows factory templates as read-only and provides inline rename and delete for custom templates. Modal focus stays inside while open; closing the manager returns focus to Manage, and closing the conflict prompt focuses the template name field.

| Check | Result |
| --- | --- |
| Focused direct Node tests, including name conflicts, overwrite, asset pruning, auto-copy, deletion, and traversal rejection | 39/39 passed |
| Strict TypeScript check and direct renderer build | Passed |
| Fresh `node phase5/test/run-gate.cjs` output `artifacts/phase5/gate-1792984549414` | Save conflict choices, template manager actions and keyboard focus, preference cleanup after delete, song A to B reuse, project persistence, still preview, and export passed. |
| Packaged editor smoke using `artifacts/phase6/layout-template-package-20261025-01` and `artifacts/phase6/layout-template-editor-20261025-01` | Both resolution labels, fixed stage dimensions, minimum window heading fit, and two MKV exports passed. |
| Packaged MP4 smoke and repeat editor smoke in fresh `artifacts/phase6/layout-template-*` outputs | MP4 produced 60 frames with AAC. Repeat editor produced two 60-frame videos; preview versus encoded frame mean RGB difference was 0.813. |

The package above was built from an uncommitted development checkout for testing. Before any public binary, the release checklist still requires an exact source-paired, patched-Electron, clean-machine candidate.
