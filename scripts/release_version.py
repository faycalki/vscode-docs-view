"""Plan a stable Marketplace version from the manifest and the reserved Git tags."""

import json
import re
import subprocess
from pathlib import Path


TAG_PREFIX = "marketplace-v"


def version(text):
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", text):
        raise ValueError(f"Expected a stable major.minor.patch version, got {text!r}")
    return tuple(map(int, text.split(".")))


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def main():
    base = version(json.loads(Path("package.json").read_text())["version"])
    tags = git("tag", "--list", TAG_PREFIX + "*").splitlines()
    candidate = base
    stale = False
    if tags:
        latest = max(tags, key=lambda tag: version(tag[len(TAG_PREFIX):]))
        major, minor, patch = version(latest[len(TAG_PREFIX):])
        if git("rev-parse", latest + "^{commit}") == git("rev-parse", "HEAD"):
            candidate = (major, minor, patch)  # Retry the same release.
        elif subprocess.run(["git", "merge-base", "--is-ancestor", latest, "HEAD"]).returncode == 0:
            candidate = max(base, (major, minor, patch + 1))
        else:
            # A queued run for an older or superseded commit must never publish.
            stale = True
    print("version=" + ".".join(map(str, candidate)))
    print("initialized=" + str(bool(tags)).lower())
    print("stale=" + str(stale).lower())


if __name__ == "__main__":
    main()
