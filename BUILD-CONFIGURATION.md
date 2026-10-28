# Windows native build configuration

Official packages use the pinned Prism source without editing its files or disabling assertions. Before building its native addon with MSVC, set these options in the build process so diagnostic metadata does not expose the developer's source directory:

```powershell
$sourceRoot = (Get-Location).Path
$env:_CL_ = (($env:_CL_ + ' "/d1trimfile:' + $sourceRoot + '"').Trim())
$env:_LINK_ = (($env:_LINK_ + ' /PDBALTPATH:%_PDB%').Trim())
node phase6/build-native.cjs
```

Run this from the MusicMeters source root. These process-scoped settings append to existing compiler/linker options; they do not change the Windows environment permanently. `/d1trimfile` trims the source-root prefix in diagnostic file strings, and `/PDBALTPATH` records only the PDB filename. Use the actual extracted source root when rebuilding a source archive, rather than copying another machine's path. Install the locked build dependencies and select the documented Windows C++ toolchain first; see [developer setup](docs/development.md).

The release build must still scan the resulting native addon for developer paths in both ASCII and UTF-16. These flags and a successful build do not replace that check. Keep private native build logs outside the distributed package. Package the addon with its exact pinned Prism source and the included license notices; see [the release checklist](docs/release-checklist.md).

The development Node.js installation is a build tool. The shipped runtime is separately pinned in `phase6/electron-runtime/package-lock.json`; changing development Node alone does not update Electron's embedded Node.
