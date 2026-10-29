# Contributing to MusicMeters

Bug reports, feature ideas, questions, and code contributions are welcome.

## Opening an issue

Take a quick look at [existing issues](https://github.com/BlueHopper6/music-meters/issues) first. If someone already reported the same thing, add any useful details there. Otherwise, [open a new issue](https://github.com/BlueHopper6/music-meters/issues/new/choose) with a clear title and a few sentences:

- **Bug:** What happened, what you expected, and the steps that make it happen. Include your MusicMeters version and Windows version if you know them. Screenshots or a short log excerpt help when relevant.
- **Feature idea:** What you'd like to do and how it would help. You don't need a finished design or implementation plan.
- **Question:** What you're trying to do and where you're stuck.

For example: **"Export stops when I use a portrait layout"** — "I'm using MusicMeters 1.0.0 on Windows 11. I open a project, switch to a portrait layout, and start an MP4 export. It stops halfway through instead of finishing. The error message is attached."

That's enough to start a conversation. The templates are optional prompts: skip anything that doesn't apply, or use a blank issue. No special title format or long checklist required. If we need more detail, we'll ask in the comments. Keep it friendly and focused on the problem or idea.

Share only files you have permission to share. Remove personal paths, account details, and other private information from screenshots, logs, and projects; a small sample that reproduces the problem is better than your whole music library.

### Issue labels

You don't need to pick labels when opening an issue. The bug and feature templates suggest the appropriate label automatically; maintainers can adjust labels afterward.

| Label | Use |
| --- | --- |
| `bug` | Something isn't working as intended |
| `enhancement` | A feature request or improvement |
| `question` | Help with using or understanding the app |
| `documentation` | Missing, unclear, or incorrect instructions |
| `accessibility` | A barrier affecting people with disabilities |
| `help wanted` | A maintainer would welcome a contribution |
| `good first issue` | A scoped task suitable for someone new to the project |
| `duplicate` | Already covered by another issue; link to it |

Use `enhancement` for feature requests; a separate `feature-request` label isn't needed. Maintainers should add `help wanted` and `good first issue` after checking the scope, rather than asking reporters to choose them.

## Contributing code

Fork the repository, make a focused change on a `feature/` or `fix/` branch, and submit a pull request to the official project. Small fixes can go straight to a pull request; for larger changes, open an issue first so we can agree on the direction. Describe the resulting behavior and the checks you ran.

### Run and test locally

Use [the development guide](docs/development.md) for first-time Windows setup, then follow [Run during development](docs/development.md#run-during-development) to launch the editor and [Test your changes](docs/development.md#test-your-changes) for the actual test commands and a manual checklist. `node phase2/run.cjs` rebuilds and opens the app; close and rerun it after source changes. There is no root package.json or `npm run dev` command.

The [Windows CI workflow](.github/workflows/windows-build.yml) contains the full automated suite, and [the release checklist](docs/release-checklist.md) covers distribution checks. Code contributions must meet the project's engineering requirements:

- Match the existing architecture and code conventions. Validate untrusted inputs, handle failures explicitly, and keep changes focused.
- Preserve the pinned Prism source, saved-project compatibility, and consistent preview/export behavior. Explain any intentional compatibility change before implementation.
- Preserve Electron's security boundaries, including context isolation, sandboxing, restricted IPC, and navigation/window restrictions. Do not disable checks or weaken these boundaries to make a feature work.
- Run the build, the separate strict TypeScript check, and relevant automated tests. Bundling alone is not a type check. Add regression coverage for changed behavior and failure cases where applicable; do not weaken existing tests to make them pass.
- For editor, preview, export, or security changes, run the relevant packaged-app smoke/security/export checks and inspect affected UI behavior. Use fresh output directories, synthetic media, and isolated profiles/caches so tests don't overwrite user data.
- Run `git diff --check` and review the diff for accidental files, secrets, personal paths, and unrelated changes. Preserve third-party license notices and required source delivery.

In the pull request, say exactly what you tested and disclose checks you couldn't run. Local tests don't establish hosted CI, clean-Windows, or release readiness. Changes need review and the applicable checks to pass before merging; reporting an issue doesn't require doing any of this development work.

## License and assets

The software code is GPL-3.0-only. By submitting code, you agree to provide it under that license and confirm you have the rights to do so. Keep third-party copyright and license notices. Submit only media and other assets for which you can grant the needed permissions.

The MusicMeters logo and icons belong to Vilohit Kale and have separate terms in [LICENSE-NOTICES.md](LICENSE-NOTICES.md). You may retain the unchanged branding in contribution forks, local tests, screenshots, and clearly marked unofficial review builds while preparing changes for this project. This permission applies before a pull request is merged and allows its fork and review history to remain if it is declined. Official releases incorporating accepted contributions keep the official branding. Independent modified products and third-party release builds must rebrand unless separately authorized. The GPL rights to the software code remain available.
