"""Exercise local connector setup and workflow selection."""

import json
import os
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

    def command(self, *args, env=None, check=True):
        return subprocess.run(
            args, cwd=self.repo, check=check, text=True, capture_output=True, env=env,
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
        self.command("python3", str(SCRIPTS / "initialize.py"), f"example/{name}", "--maintainers", "alice")
        self.assertIn(f"slug: {name}", (self.repo / "manifest.yaml").read_text())
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice\n")

    def test_bot_actor_requires_a_maintainer(self):
        result = self.initialize("airdrop-demo-snap-in", maintainers="github-actions[bot]", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Specify at least one GitHub maintainer", result.stderr)
        self.assertTrue((self.repo / ".github/templates/README.md").exists())
        self.assertIn("airdrop-todo-snap-in", (self.repo / "manifest.yaml").read_text())

    def initialize_from_origin(self, *options, owner="devrev", visibility="PRIVATE", check=True):
        origin = f"git@github.com:{owner}/airsync-demo-snap-in.git"
        git_stub = self.root / "git"
        git_stub.write_text(
            '#!/bin/sh\n[ "$*" = "remote get-url origin" ] || exit 1\nprintf "%s\\n" "$EXPECTED_ORIGIN"\n'
        )
        git_stub.chmod(0o755)
        gh_stub = self.root / "gh"
        gh_stub.write_text(
            """#!/bin/sh
case "$1 $2" in
  "repo view")
    [ "$3" = "$EXPECTED_ORIGIN" ] || exit 1
    printf '%s\\n' "$REPO_METADATA"
    ;;
  "api user")
    [ "$3 $4" = "--jq .login" ] || exit 1
    printf '%s\\n' 'alice'
    ;;
  *) exit 1 ;;
esac
"""
        )
        gh_stub.chmod(0o755)
        repository = {"nameWithOwner": f"{owner}/airsync-demo-snap-in", "visibility": visibility}
        return self.command(
            "python3", str(SCRIPTS / "initialize.py"), *options,
            env={
                **os.environ,
                "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
                "EXPECTED_ORIGIN": origin,
                "REPO_METADATA": json.dumps(repository),
            },
            check=check,
        )

    def test_detects_origin_maintainer_and_devrev_team(self):
        self.initialize_from_origin()
        self.assertIn("slug: airsync-demo-snap-in", (self.repo / "manifest.yaml").read_text())
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice @devrev/connector_team\n")
        self.assertFalse((self.repo / ".github/workflows/claude-code-review.yml").exists())
        self.assertFalse((self.repo / ".github/workflows/create-marketplace-submission.yml").exists())
        self.assertFalse((self.repo / "marketplace.yaml").exists())

    def test_can_omit_devrev_team(self):
        self.initialize_from_origin("--no-owning-team")
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice\n")

    def test_can_override_devrev_team(self):
        self.initialize_from_origin("--owning-team", "devrev/another-team")
        self.assertEqual((self.repo / ".github/CODEOWNERS").read_text(), "* @alice @devrev/another-team\n")

    def test_initializes_with_both_private_workflows_and_preserves_existing_files(self):
        self.initialize_from_origin("--enable-review", "--enable-marketplace")
        workflows = self.repo / ".github/workflows"
        review = workflows / "claude-code-review.yml"
        submission = workflows / "create-marketplace-submission.yml"
        config = self.repo / "marketplace.yaml"
        self.assertFalse((self.repo / ".github/templates/README.md").exists())
        self.assertIn("devrev/connectors-codegen/.github/workflows/connector-review.yml", review.read_text())
        self.assertIn("Create DEV draft", submission.read_text())
        self.assertIn("marketplace_listing_slug: airsync-demo-snap-in", config.read_text())
        self.assertIn("snap_in_package_slug: airsync-demo-snap-in", config.read_text())

        review.write_text("Existing review workflow\n")
        config.write_text("Existing Marketplace configuration\n")
        self.initialize_from_origin("--enable-review", "--enable-marketplace")
        self.assertEqual(review.read_text(), "Existing review workflow\n")
        self.assertEqual(config.read_text(), "Existing Marketplace configuration\n")

    def test_rejects_workflow_selection_for_public_or_external_repositories(self):
        for owner, visibility in (("devrev", "PUBLIC"), ("external", "PRIVATE")):
            with self.subTest(owner=owner, visibility=visibility):
                result = self.initialize_from_origin("--enable-review", owner=owner, visibility=visibility, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("require a private repository in devrev", result.stderr)
        self.assertTrue((self.repo / ".github/templates/README.md").exists())
        self.assertFalse((self.repo / ".github/workflows/claude-code-review.yml").exists())
        self.assertFalse((self.repo / "marketplace.yaml").exists())


if __name__ == "__main__":
    unittest.main()
