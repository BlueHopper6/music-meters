# Music Visualizer Windows development package

This folder is a portable **development preview** for Windows x64. Run `electron.exe` from this folder to open the editor. Keep the whole folder together. No installer is required.

Install the FFmpeg command-line tools separately and put both `ffmpeg.exe` and `ffprobe.exe` on `PATH` before starting the app. Verify with `ffmpeg -version` and `ffprobe -version` in a new terminal. Those two executables are **not** bundled. Electron includes its own `ffmpeg.dll`, covered by the Chromium notices in this folder. The application uses the external FFmpeg tools to decode audio and encode H.264/AAC MP4. AAC output is lossy. The package does not upload songs or render in the cloud.

Import a WAV, FLAC, or MP3 file, select a template, adjust layers at a song timestamp, add artwork and text, and press **Render MP4**. Output defaults to 1080p/30. Choose a fresh MP4 filename; existing files are not overwritten. Keep saved project JSON next to its `.assets` folder. If moving a project breaks a media link, use **Relink…** and save again. Templates and preferences live in Electron user data for this Windows account.

The Prism-based MusicMeters application is GPL-3.0-only. You may share and modify the covered software under that license; see `MUSICMETERS-LICENSE.txt` and `LICENSE-NOTICES.md`. Prism's license is in `PRISM-LICENSE.txt`; Prism's native decoder and resampler notices, node-addon-api's MIT license, and Electron notices are also included. See `THIRD_PARTY_NOTICES.md` for the file list. The MusicMeters logo has a separate artwork notice in `LICENSE-NOTICES.md`.

For a release package, obtain the source archive named in `SOURCE-ARCHIVE.json` from the same download location as this package. That file gives its SHA-256 checksum and matches this package's `BUILD-PROVENANCE.json`. The archive contains the MusicMeters source and build scripts, exact Prism source, and node-addon-api source. If `SOURCE-ARCHIVE.json` is absent, this folder is a development build without a paired release source archive. Public distribution still requires the separate security and clean-machine release gates.
