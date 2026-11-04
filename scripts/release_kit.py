"""Bundle the installable VSIX and the source files needed to rebuild it."""

import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
FILE_LIST = "SOURCE-FILES.txt"


def source_files():
    # A downloaded kit retains its source inventory and needs no Git checkout.
    inventory = ROOT / FILE_LIST
    if inventory.is_file() and not (ROOT / ".git").exists():
        return inventory.read_text(encoding="utf-8").splitlines()
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    return sorted(name for name in tracked.decode().split("\0")
                  if name and name not in (FILE_LIST, "SHA256SUMS")
                  and not name.startswith(("downloads/", "release/"))
                  and not name.endswith(".vsix"))


def main():
    manifest = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    stem = f"{manifest['name']}-{manifest['version']}"
    installer = ROOT / f"{stem}.vsix"
    with ZipFile(installer) as vsix:
        packed = json.loads(vsix.read("extension/package.json"))
        if any(packed[key] != manifest[key] for key in ("name", "publisher", "version")):
            raise ValueError("The VSIX does not match package.json. Run npm run package again.")
    output = ROOT / "release" / f"{stem}-release-kit.zip"
    output.parent.mkdir(exist_ok=True)
    files = source_files()
    temporary = output.with_suffix(".tmp")
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED, compresslevel=6) as kit:
            for name in files:
                source = ROOT / name
                if source.is_symlink() or not source.resolve().is_relative_to(ROOT):
                    raise ValueError(f"Invalid source path in inventory: {name}")
                kit.write(source, name)
            kit.writestr(FILE_LIST, "\n".join(files) + "\n")
            kit.write(installer, installer.name, compress_type=ZIP_STORED)
            checksum = hashlib.sha256(installer.read_bytes()).hexdigest()
            kit.writestr("SHA256SUMS", f"{checksum}  {installer.name}\n")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
