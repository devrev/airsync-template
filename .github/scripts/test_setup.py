"""Exercise the local initializer on copies of the template."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
TEMPLATE = SCRIPTS.parents[1]


class SetupTest(unittest.TestCase):
    def setUp(self):
        area = tempfile.TemporaryDirectory()
        self.addCleanup(area.cleanup)
        self.root = Path(area.name)
        self.repo = self.root / "connector"
        self.repo.mkdir()
        for directory in (".github/templates", ".github/workflows", ".cursor"):
            shutil.copytree(TEMPLATE / directory, self.repo / directory)
        for name in ("README.md", "manifest.yaml", ".github/CODEOWNERS"):
            shutil.copyfile(TEMPLATE / name, self.repo / name)

    def command(self, *args, check=True):
        return subprocess.run(
            args, cwd=self.repo, check=check, text=True, capture_output=True,
        )

    def initialize(self, name, maintainers="alice @bob", team="@example/integrations", check=True):
        return self.command(
            "python3", str(SCRIPTS / "initialize.py"), f"example/{name}",
            "--maintainers", maintainers, "--owning-team", team, check=check,
        )

    def test_airsync_name_files_and_repeat(self):
        name = "airsync-demo-system-snap-in"
        workflows = self.repo / ".github/workflows"
        originals = {file.name: file.read_bytes() for file in workflows.iterdir()}
        self.initialize(name)
        self.assertIn(f"slug: {name}", (self.repo / "manifest.yaml").read_text())
        readme = self.repo / "README.md"
        self.assertIn("# AirSync Demo System snap-in", readme.read_text())
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice @bob @example/integrations\n")
        self.assertEqual({file.name: file.read_bytes() for file in workflows.iterdir()}, originals)
        self.assertEqual((self.repo / ".mcp.json").read_bytes(), (self.repo / ".cursor/mcp.json").read_bytes())
        self.assertTrue((self.repo / "CLAUDE.md").read_text().startswith("When asked"))
        self.assertFalse((self.repo / ".github/templates/README.md").exists())

        readme.write_text("Maintainer edits\n")
        self.initialize(name, maintainers="another-user")
        self.assertEqual(readme.read_text(), "Maintainer edits\n")
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice @bob @example/integrations\n")

    def test_airdrop_name_and_maintainer(self):
        name = "airdrop-demo-snap-in"
        self.initialize(name, maintainers="alice", team="")
        self.assertIn(f"slug: {name}", (self.repo / "manifest.yaml").read_text())
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice\n")

    def test_bot_actor_requires_a_maintainer(self):
        result = self.initialize("airdrop-demo-snap-in", maintainers="github-actions[bot]", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Specify at least one GitHub maintainer", result.stderr)
        self.assertTrue((self.repo / ".github/templates/README.md").exists())
        self.assertIn("airdrop-todo-snap-in", (self.repo / "manifest.yaml").read_text())


if __name__ == "__main__":
    unittest.main()
