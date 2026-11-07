# Native build configuration

Official packages use the pinned Prism source without editing its files or disabling assertions. Before building its native addon, configure compiler and linker path-privacy flags so diagnostic metadata does not expose the developer's source directory.

## Windows (MSVC)

Set these options in the build process before running `node phase6/build-native.cjs`:

```powershell
$sourceRoot = (Get-Location).Path
$env:_CL_ = (($env:_CL_ + ' "/d1trimfile:' + $sourceRoot + '"').Trim())
$env:_LINK_ = (($env:_LINK_ + ' /PDBALTPATH:%_PDB%').Trim())
node phase6/build-native.cjs
```

Run this from the MusicMeters source root. These process-scoped settings append to existing compiler/linker options; they do not change the Windows environment permanently. `/d1trimfile` trims the source-root prefix in diagnostic file strings, and `/PDBALTPATH` records only the PDB filename. Use the actual extracted source root when rebuilding a source archive, rather than copying another machine's path. Install the locked build dependencies and select the documented Windows C++ toolchain first; see [developer setup](docs/development.md).

## macOS (Clang / Apple Command Line Tools)

On macOS (`darwin`), `node phase6/build-native.cjs` automatically appends process-scoped Clang prefix-remapping flags (`-ffile-prefix-map=<dir>=.`, `-fdebug-prefix-map=<dir>=.`, `-fmacro-prefix-map=<dir>=.`) for the active repository root, `upstream/prism`, and `phase6/build-tools/node_modules`, strips local symbols (`strip -x`), and scans the compiled `visualizer_dsp.node` Mach-O binary for developer home and temporary directory markers:

```bash
node phase6/build-native.cjs
```

## Verification and packaging

Every release build must scan the resulting native addon for developer paths in both ASCII and UTF-16. Compiler flags and a successful build do not replace that check. Keep private native build logs outside the distributed package. Package the addon with its exact pinned Prism source and the included license notices; see [the release checklist](docs/release-checklist.md).

The development Node.js installation is a build tool. The shipped runtime is separately pinned in `phase6/electron-runtime/package-lock.json`; changing development Node alone does not update Electron's embedded Node.
