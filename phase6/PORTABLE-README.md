# Music Visualizer Windows development package

This folder is a portable **development preview** for Windows x64. Run `electron.exe` from this folder to open the editor. Keep the whole folder together. No installer is required.

Install FFmpeg separately and put both `ffmpeg.exe` and `ffprobe.exe` on `PATH` before starting the app. Verify with `ffmpeg -version` and `ffprobe -version` in a new terminal. FFmpeg is **not** bundled. The application uses FFmpeg to decode audio and encode H.264/AAC MP4. AAC output is lossy. The package does not upload songs or render in the cloud.

Import a WAV, FLAC, or MP3 file, select a template, adjust layers at a song timestamp, add artwork and text, and press **Render MP4**. Output defaults to 1080p/30. Choose a fresh MP4 filename; existing files are not overwritten. Keep saved project JSON next to its `.assets` folder. If moving a project breaks a media link, use **Relink…** and save again. Templates and preferences live in Electron user data for this Windows account.

The generated binary includes a pinned Prism native analyzer and bundled Prism Canvas painters. See `THIRD_PARTY_NOTICES.md` and `PRISM-LICENSE.txt`. This package has not been prepared for public distribution; source and license release requirements need a final review.
