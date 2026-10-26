"""Create the source archive that accompanies one clean portable build."""

import argparse
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
PRISM = ROOT / "upstream" / "prism"
PIN = "49721802252b115d169e353c98b27408daa5e2b7"
FIXED_TIME = (2020, 1, 1, 0, 0, 0)
RUNTIME_BRAND_FILES = {
    "phase2/editor-app/assets/brand/icon-32.png",
    "phase2/editor-app/assets/brand/icon-64.png",
    "phase2/editor-app/assets/brand/music-meters.ico",
}


def git(cwd, *args):
    return subprocess.check_output(["git", *args], cwd=cwd)


def add_bytes(archive, name, data):
    info = zipfile.ZipInfo(name, FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data)


def add_git_tree(archive, cwd, revision, prefix):
    data = git(cwd, "archive", "--format=tar", revision)
    with tarfile.open(fileobj=io.BytesIO(data)) as source:
        for member in source:
            if member.isfile():
                if prefix == "musicmeters/" and member.name.startswith("samples/"):
                    continue
                if (prefix == "musicmeters/" and
                        member.name.startswith("phase2/editor-app/assets/brand/") and
                        member.name not in RUNTIME_BRAND_FILES):
                    continue
                add_bytes(archive, prefix + member.name, source.extractfile(member).read())
            elif member.issym() or member.islnk():
                raise RuntimeError(f"Source tree contains a link: {member.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    package = args.package.resolve()
    output = args.output.resolve()
    if output.exists():
        raise RuntimeError(f"Source archive already exists: {output}")
    if not package.is_dir() or not (package / "electron.exe").is_file():
        raise RuntimeError("Choose a completed Windows portable package")
    revision = git(ROOT, "rev-parse", "HEAD").decode().strip()
    if git(ROOT, "status", "--porcelain", "--untracked-files=no").strip():
        raise RuntimeError("Commit tracked source changes before generating release source")
    if git(PRISM, "rev-parse", "HEAD").decode().strip() != PIN:
        raise RuntimeError("Prism checkout does not match the pinned commit")
    if git(PRISM, "status", "--porcelain", "--untracked-files=no").strip():
        raise RuntimeError("Prism tracked sources have local changes")
    provenance = json.loads((package / "BUILD-PROVENANCE.json").read_text())
    if (provenance["applicationRevision"] != revision or provenance["trackedChanges"]
            or provenance["prismTrackedChanges"]
            or provenance["prismRevision"] != PIN):
        raise RuntimeError("Package build does not match clean MusicMeters and Prism sources")
    for name, expected in provenance["appFileSha256"].items():
        if hashlib.sha256((package / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Packaged application file changed after build: {name}")
    addon = ROOT / "phase6" / "build-tools" / "node_modules" / "node-addon-api"
    if json.loads((addon / "package.json").read_text())["version"] != "8.6.0":
        raise RuntimeError("Expected node-addon-api 8.6.0")
    if output.is_relative_to(package):
        raise RuntimeError("Place the source archive beside, not inside, the package")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(output, "w") as archive:
            add_git_tree(archive, ROOT, revision, "musicmeters/")
            add_git_tree(archive, PRISM, PIN, "musicmeters/upstream/prism/")
            add_bytes(archive, "musicmeters/upstream/prism/.musicmeters-prism-commit", (PIN + "\n").encode())
            add_bytes(archive, "musicmeters/PACKAGE-BUILD-PROVENANCE.json",
                      (json.dumps(provenance, indent=2) + "\n").encode())
            for file in sorted(addon.rglob("*")):
                if file.is_file() and "node_modules" not in file.relative_to(addon).parts:
                    add_bytes(archive, "musicmeters/third_party/node-addon-api/" + file.relative_to(addon).as_posix(), file.read_bytes())
            add_bytes(archive, "musicmeters/SOURCE-MANIFEST.json", (json.dumps({
                "applicationRevision": revision, "applicationVersion": provenance["applicationVersion"],
                "prismRevision": PIN, "nodeAddonApiVersion": "8.6.0",
                "electronVersion": provenance["electronVersion"],
                "sourceArchiveRule": "Includes committed MusicMeters source excluding historical sample media and unused brand images; retains three runtime icons under their separate artwork notice; includes exact Prism tree and node-addon-api 8.6.0 source; excludes generated binaries and npm dependencies.",
            }, indent=2) + "\n").encode())
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        (package / "SOURCE-ARCHIVE.json").write_text(json.dumps({
            "filename": output.name, "sha256": digest,
            "applicationRevision": revision, "prismRevision": PIN,
        }, indent=2) + "\n")
        print(json.dumps({"archive": str(output), "sha256": digest, "applicationRevision": revision}))
    except Exception:
        output.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    main()
