"""Exercise repository setup using copies of the template and a local Git remote."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
TEMPLATE = SCRIPTS.parents[1]
SETUP_PR = "https://github.example/test/connector/pull/1"


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

    def git(self, *args):
        return self.command("git", *args).stdout.strip()

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

    def prepare_remote(self):
        remote = self.root / "origin.git"
        self.git("init", "-q", "--bare", "--initial-branch=main", str(remote))
        self.git("init", "-q", "--initial-branch=main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("add", "--all")
        self.git("commit", "-qm", "Template")
        self.git("remote", "add", "origin", str(remote))
        self.git("push", "origin", "main")
        return remote

    def publish(self, **variables):
        return self.command(
            "bash", str(SCRIPTS / "publish-setup.sh"),
            env={
                **os.environ,
                "GITHUB_REPOSITORY": "example/airdrop-demo-snap-in",
                "GITHUB_STEP_SUMMARY": str(self.root / "summary"),
                **variables,
            },
        )

    def test_publishes_normal_commit_to_unprotected_main(self):
        self.prepare_remote()
        initial = self.git("rev-parse", "HEAD")
        self.initialize("airdrop-demo-snap-in")
        self.assertIn("Repository setup is on main.", self.publish().stdout)
        self.assertEqual(self.git("rev-parse", "origin/main"), self.git("rev-parse", "HEAD"))
        self.assertEqual(self.git("rev-parse", "HEAD^"), initial)
        self.assertIn("already on main", self.publish().stdout)

    def test_reuses_protected_branch_and_pull_request_on_retry(self):
        remote = self.prepare_remote()
        initial = self.git("rev-parse", "HEAD")
        hook = remote / "hooks/update"
        hook.write_text('#!/bin/sh\n[ "$1" != refs/heads/main ]\n')
        hook.chmod(0o755)

        stub = self.root / "gh"
        stub.write_text(
            "#!/bin/sh\n"
            'case "$1 $2" in\n'
            '  "pr list") if [ -f "$PR_CREATED" ]; then cat "$PR_CREATED"; fi ;;\n'
            f'  "pr create") echo "{SETUP_PR}" | tee "$PR_CREATED" ;;\n'
            "  *) exit 1 ;;\n"
            "esac\n"
        )
        stub.chmod(0o755)
        variables = {"PATH": str(self.root) + os.pathsep + os.environ["PATH"], "PR_CREATED": str(self.root / "pr")}
        name = "airdrop-demo-snap-in"
        self.initialize(name)
        self.assertIn(SETUP_PR, self.publish(**variables).stdout)
        setup_ref = "refs/heads/airsync/template-setup"
        first = self.git("ls-remote", "origin", setup_ref)
        self.assertTrue(first)
        self.assertEqual(self.git("rev-parse", "origin/main"), initial)

        self.git("reset", "--hard", initial)
        hook.unlink()
        (self.repo / "unrelated.txt").write_text("Change on main\n")
        self.git("add", "unrelated.txt")
        self.git("commit", "-qm", "Advance main")
        self.git("push", "origin", "main")

        self.initialize(name)
        self.assertIn(SETUP_PR, self.publish(**variables).stdout)
        self.assertEqual(self.git("ls-remote", "origin", setup_ref), first)


    def enable_workflows(self, *workflows, owner="devrev", visibility="PRIVATE", check=True):
        gh_stub = self.root / "gh"
        gh_stub.write_text('#!/bin/sh\nprintf "%s\\n" "$REPO_METADATA"\n')
        gh_stub.chmod(0o755)
        repository = {"nameWithOwner": f"{owner}/airsync-demo-snap-in", "visibility": visibility}
        return self.command(
            "python3", str(SCRIPTS / "enable_private_workflows.py"), *workflows,
            env={
                **os.environ,
                "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
                "REPO_METADATA": json.dumps(repository),
            },
            check=check,
        )

    def test_private_workflows_are_opt_in_and_existing_files_survive(self):
        self.initialize("airsync-demo-snap-in")
        workflows = self.repo / ".github/workflows"
        review = workflows / "claude-code-review.yml"
        submission = workflows / "create-marketplace-submission.yml"
        config = self.repo / "marketplace.yaml"
        self.assertFalse(review.exists())
        self.assertFalse(submission.exists())
        self.assertFalse(config.exists())

        self.enable_workflows("review")
        self.assertIn("devrev/connectors-codegen/.github/workflows/connector-review.yml", review.read_text())
        self.assertFalse(submission.exists())
        self.assertFalse(config.exists())

        review.write_text("Existing review workflow\n")
        self.enable_workflows("review", "marketplace")
        self.assertEqual(review.read_text(), "Existing review workflow\n")
        self.assertIn("Create DEV draft", submission.read_text())
        self.assertIn("marketplace_listing_slug: airsync-demo-snap-in", config.read_text())
        self.assertIn("snap_in_package_slug: airsync-demo-snap-in", config.read_text())
        config.write_text("Existing Marketplace configuration\n")
        self.enable_workflows("marketplace")
        self.assertEqual(config.read_text(), "Existing Marketplace configuration\n")

    def test_rejects_public_or_external_workflow_install(self):
        for owner, visibility in (("devrev", "PUBLIC"), ("external", "PRIVATE")):
            with self.subTest(owner=owner, visibility=visibility):
                result = self.enable_workflows("review", "marketplace", owner=owner, visibility=visibility, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("require a private repository in devrev", result.stderr)
        self.assertFalse((self.repo / ".github/workflows/claude-code-review.yml").exists())
        self.assertFalse((self.repo / "marketplace.yaml").exists())


if __name__ == "__main__":
    unittest.main()
