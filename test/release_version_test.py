"""Exercise the release planner against real Git commits and tags."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PLANNER = Path(__file__).resolve().parents[1] / "scripts" / "release_version.py"


class ReleaseVersionTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Release Test")
        self.git("config", "user.email", "test@example.invalid")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, text=True).strip()

    def commit(self, version):
        (self.repo / "package.json").write_text(json.dumps({"version": version}))
        self.git("add", "package.json")
        self.git("commit", "--allow-empty", "-qm", "Update")
        return self.git("rev-parse", "HEAD")

    def plan(self):
        out = subprocess.check_output([sys.executable, PLANNER], cwd=self.repo, text=True)
        return dict(line.split("=", 1) for line in out.splitlines())

    def test_first_publish_retries_and_superseded_runs(self):
        first = self.commit("0.3.0")
        self.assertEqual(self.plan(), {"version": "0.3.0", "initialized": "false", "stale": "false"})
        self.git("tag", "marketplace-v0.3.0")
        self.assertEqual(self.plan(), {"version": "0.3.0", "initialized": "true", "stale": "false"})
        self.commit("0.3.0")
        self.assertEqual(self.plan()["version"], "0.3.1")
        self.git("tag", "marketplace-v0.3.1")
        self.git("checkout", "-q", first)
        self.assertEqual(self.plan()["stale"], "true")

    def test_numeric_patches_and_explicit_minor(self):
        self.commit("0.3.0")
        self.git("tag", "marketplace-v0.3.9")
        self.commit("0.3.0")
        self.git("tag", "marketplace-v0.3.10")
        self.commit("0.3.0")
        self.assertEqual(self.plan()["version"], "0.3.11")
        self.commit("0.4.0")
        self.assertEqual(self.plan()["version"], "0.4.0")


if __name__ == "__main__":
    unittest.main()
