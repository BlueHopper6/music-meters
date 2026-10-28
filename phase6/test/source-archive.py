"""Validate and extract one release source archive to a new directory."""

import argparse
import hashlib
import json
import pathlib
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=pathlib.Path)
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("destination", type=pathlib.Path)
    args = parser.parse_args()
    if args.destination.exists():
        raise RuntimeError("Extraction destination already exists")
    descriptor = json.loads((args.package / "SOURCE-ARCHIVE.json").read_text())
    if args.archive.name != descriptor["filename"]:
        raise RuntimeError("Archive filename does not match package descriptor")
    if hashlib.sha256(args.archive.read_bytes()).hexdigest() != descriptor["sha256"]:
        raise RuntimeError("Archive digest does not match package descriptor")
    package_provenance = json.loads((args.package / "BUILD-PROVENANCE.json").read_text())
    for name, expected in package_provenance["appFileSha256"].items():
        if hashlib.sha256((args.package / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Packaged application file changed: {name}")
    with zipfile.ZipFile(args.archive) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(
                not name.startswith("musicmeters/") or ".." in pathlib.PurePosixPath(name).parts
                for name in names):
            raise RuntimeError("Unsafe or duplicate source archive path")
        required = [
            "LICENSE", "LICENSE-NOTICES.md", "README.md", "phase2/build.cjs",
            "BUILD-CONFIGURATION.md",
            "PACKAGE-BUILD-PROVENANCE.json",
            "phase2/composition.ts", "phase6/package-windows.cjs", "phase6/release-source.py",
            "phase2/editor-app/assets/brand/icon-32.png",
            "phase2/editor-app/assets/brand/icon-64.png",
            "phase2/editor-app/assets/brand/music-meters.ico",
            "phase6/electron-runtime/package-lock.json", "phase6/build-tools/package-lock.json",
            "phase6/installer-tools/package-lock.json", "phase6/application.cjs",
            "phase6/package-installer.cjs", "phase6/brand-executable.cjs", "phase6/installer.nsh",
            "phase6/build-native.cjs", "SOURCE-MANIFEST.json",
            "upstream/prism/.musicmeters-prism-commit", "upstream/prism/LICENSE",
            "upstream/prism/THIRD_PARTY_NOTICES.md",
            "upstream/prism/package-lock.json", "upstream/prism/native/binding.gyp",
            "upstream/prism/native/src/main.cpp", "upstream/prism/src/renderer/visualizers/Vectorscope.ts",
            "upstream/prism/native/vendor/dr_libs/LICENSE",
            "upstream/prism/native/vendor/r8brain/LICENSE",
            "third_party/node-addon-api/LICENSE.md", "third_party/node-addon-api/package.json",
            "third_party/node-addon-api/napi.h",
        ]
        for name in required:
            if "musicmeters/" + name not in names:
                raise RuntimeError(f"Missing corresponding source: {name}")
        if "musicmeters/phase2/editor-app/assets/brand/logo-master.png" in names:
            raise RuntimeError("Unused logo master must not be in release source")
        manifest = json.loads(archive.read("musicmeters/SOURCE-MANIFEST.json"))
        if json.loads(archive.read("musicmeters/PACKAGE-BUILD-PROVENANCE.json")) != package_provenance:
            raise RuntimeError("Archived package build provenance does not match")
        if (manifest["applicationRevision"] != descriptor["applicationRevision"]
                or manifest["applicationRevision"] != package_provenance["applicationRevision"]
                or manifest["prismRevision"] != descriptor["prismRevision"]
                or manifest["prismRevision"] != package_provenance["prismRevision"]
                or archive.read("musicmeters/upstream/prism/.musicmeters-prism-commit").decode().strip() != manifest["prismRevision"]):
            raise RuntimeError("Package and source revision mismatch")
        archive.extractall(args.destination)
    print(json.dumps({"sourceRoot": str(args.destination / "musicmeters"), "files": len(names), **manifest}))


if __name__ == "__main__":
    main()
