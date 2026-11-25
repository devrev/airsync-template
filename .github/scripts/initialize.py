"""Initialize a repository created from the AirSync template."""

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

TEMPLATES = Path(".github/templates")
README_TEMPLATE = TEMPLATES / "README.md"
CONNECTOR_NAME = re.compile(r"(?:airdrop|airsync)-([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)-snap-in")
USERNAME = re.compile(r"[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?")
TEAM = re.compile(r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+")


def render_setup(repository, maintainers, owning_team):
    owner, _, name = repository.lower().partition("/")
    if not USERNAME.fullmatch(owner):
        raise ValueError("Specify the GitHub repository as owner/name.")
    connector = CONNECTOR_NAME.fullmatch(name)
    if not connector:
        raise ValueError("Repository name must be airdrop-<system>-snap-in or airsync-<system>-snap-in.")

    users = [user.removeprefix("@") for user in maintainers.split()]
    if not users or any(not USERNAME.fullmatch(user) for user in users):
        raise ValueError("Specify at least one GitHub maintainer login for CODEOWNERS.")
    team = (owning_team or "").removeprefix("@")
    if owning_team is not None and not TEAM.fullmatch(team):
        raise ValueError("Specify the owning team as organization/team-slug.")

    display_name = " ".join(word.capitalize() for word in re.split(r"[-._]+", connector[1]))
    manifest_path = Path("manifest.yaml")
    manifest = manifest_path.read_text(encoding="utf-8")
    template_slug = "  - slug: airdrop-todo-snap-in\n"
    connector_slug = f"  - slug: {name}\n"
    if template_slug in manifest:
        # The rendered slug also identifies a manifest written by an interrupted setup.
        manifest = manifest.replace(template_slug, connector_slug).replace("Todo", display_name)
    elif connector_slug not in manifest:
        raise ValueError(f"Expected the template import slug or {name} in manifest.yaml.")
    readme = README_TEMPLATE.read_text(encoding="utf-8").replace("Todo", display_name)
    mcp_config = Path(".cursor/mcp.json").read_text(encoding="utf-8")
    mapping_rule = Path(".cursor/rules/initial-mapping.mdc").read_text(encoding="utf-8")
    _, separator, mapping_instructions = mapping_rule.removeprefix("---\n").partition("\n---\n")
    if not separator or not mapping_instructions.strip():
        raise ValueError("Expected mapping instructions after the frontmatter in the Cursor rule.")

    owners = users + ([team] if team else [])
    codeowners = "* " + " ".join("@" + owner for owner in dict.fromkeys(owners)) + "\n"
    updates = {manifest_path: manifest, Path("README.md"): readme, Path(".github/CODEOWNERS"): codeowners}
    additions = {Path(".mcp.json"): mcp_config, Path("CLAUDE.md"): mapping_instructions.lstrip("\n")}
    return updates, additions


def origin_repository():
    origin = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
    result = subprocess.check_output(
        ["gh", "repo", "view", origin, "--json", "nameWithOwner,visibility"], text=True,
    )
    return json.loads(result)


def write_file(destination, content, *, keep_existing=False):
    if keep_existing and destination.is_file():
        print(f"Kept {destination}")
        return
    with tempfile.TemporaryDirectory(dir=destination.parent) as staging:
        staged = Path(staging) / destination.name
        staged.write_text(content, encoding="utf-8")
        if not keep_existing:
            staged.replace(destination)
            return
        try:
            os.link(staged, destination)
        except FileExistsError:
            if not destination.is_file():
                raise
            print(f"Kept {destination}")
        else:
            print(f"Added {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", nargs="?", help="GitHub repository in owner/name format (defaults to origin)")
    parser.add_argument("--maintainers", help="Space-separated GitHub logins (defaults to the gh login)")
    parser.add_argument("--owning-team", help="Add an owning team in organization/team-slug format")
    parser.add_argument("--enable-review", action="store_true", help="Install the shared connector review workflow")
    parser.add_argument("--enable-marketplace", action="store_true", help="Install DEV Marketplace draft submission")
    args = parser.parse_args()

    if Path.cwd() != Path(__file__).resolve().parents[2]:
        parser.error("Run this script from the connector repository root.")

    needs_setup = README_TEMPLATE.exists()
    workflows = args.enable_review or args.enable_marketplace
    if not needs_setup and not workflows:
        return

    try:
        repository = args.repository
        if repository is None or workflows:
            metadata = origin_repository()
            origin_name = metadata["nameWithOwner"]
            if repository and repository.lower() != origin_name.lower():
                raise ValueError("Repository argument must match origin when enabling workflows.")
            repository = origin_name
            if workflows and (not repository.lower().startswith("devrev/") or metadata["visibility"] != "PRIVATE"):
                raise ValueError("These workflows require a private repository in devrev.")

        updates = {}
        additions = {}
        if needs_setup:
            maintainers = args.maintainers
            if maintainers is None:
                maintainers = subprocess.check_output(["gh", "api", "user", "--jq", ".login"], text=True).strip()
            updates, additions = render_setup(repository, maintainers, args.owning_team)

        if args.enable_marketplace:
            slug = repository.lower().split("/", 1)[1]
            config = (TEMPLATES / "marketplace.yaml").read_text(encoding="utf-8")
            additions[Path("marketplace.yaml")] = config.replace("REPOSITORY_SLUG", slug)

        for enabled, name in (
            (args.enable_review, "claude-code-review.yml"),
            (args.enable_marketplace, "create-marketplace-submission.yml"),
        ):
            if enabled:
                additions[Path(".github/workflows") / name] = (TEMPLATES / "workflows" / name).read_text(encoding="utf-8")

        for destination in (*updates, *additions):
            if (destination.exists() or destination.is_symlink()) and not destination.is_file():
                raise ValueError(f"Expected a file at {destination}.")
            if not destination.parent.is_dir():
                raise ValueError(f"Expected a directory at {destination.parent}.")

        for destination, content in updates.items():
            write_file(destination, content)
        for destination, content in additions.items():
            write_file(destination, content, keep_existing=True)
        if needs_setup:
            README_TEMPLATE.unlink(missing_ok=True)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
