# Third-party components

- **Prism**, pinned at `49721802252b115d169e353c98b27408daa5e2b7`, by its upstream contributors. License: GPL-3.0-only. This package contains Prism native analysis code and bundled Canvas painters. See `PRISM-LICENSE.txt`. Source: https://github.com/Boof2015/prism/tree/49721802252b115d169e353c98b27408daa5e2b7
- **node-addon-api** 8.6.0, used to compile the Prism native addon. License: MIT. See `NODE-ADDON-API-LICENSE.md`. Source: https://github.com/nodejs/node-addon-api/tree/v8.6.0
- **Electron** 45.0.0 runtime, installed from the separately locked runtime dependency. Electron's license and Chromium third-party notices are supplied in the package root as `LICENSE` and `LICENSES.chromium.html`. The copied Electron runtime includes `ffmpeg.dll`; its notice is in `LICENSES.chromium.html`.
- **FFmpeg and FFprobe command-line tools** are separately installed system prerequisites. This package does not include `ffmpeg.exe` or `ffprobe.exe`. Their applicable licenses depend on the user's installed build and configuration.

The application-specific source is in this repository. Before any public binary distribution, review the complete corresponding-source and license obligations for Prism and the application's own code.
