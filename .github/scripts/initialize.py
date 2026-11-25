"""Initialize a repository created from the AirSync template."""

import argparse
import json
import re
import subprocess
from pathlib import Path

TEMPLATES = Path(".github/templates")
README_TEMPLATE = TEMPLATES / "README.md"
DEFAULT_OWNING_TEAM = "devrev/connector_team"
CONNECTOR_NAME = re.compile(r"(?:airdrop|airsync)-([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)-snap-in")
USERNAME = re.compile(r"[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?")
TEAM = re.compile(r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+")


def initialize(repository, maintainers, owning_team):
    owner, _, name = repository.lower().partition("/")
    connector = CONNECTOR_NAME.fullmatch(name)
    if not connector:
        raise ValueError("Repository name must be airdrop-<system>-snap-in or airsync-<system>-snap-in.")

    users = [user.removeprefix("@") for user in maintainers.split()]
    if not users or any(not USERNAME.fullmatch(user) for user in users):
        raise ValueError("Specify at least one GitHub maintainer login for CODEOWNERS.")
    if owning_team is None:
        owning_team = DEFAULT_OWNING_TEAM if owner == "devrev" else ""
    team = owning_team.removeprefix("@")
    if team and not TEAM.fullmatch(team):
        raise ValueError("Specify the owning team as organization/team-slug.")

    display_name = " ".join(word.capitalize() for word in re.split(r"[-._]+", connector[1]))
    manifest_path = Path("manifest.yaml")
    manifest = manifest_path.read_text().replace("airdrop-todo-snap-in", name).replace("Todo", display_name)
    readme = README_TEMPLATE.read_text().replace("Todo", display_name)
    mcp_config = Path(".cursor/mcp.json").read_text()
    mapping_rule = Path(".cursor/rules/initial-mapping.mdc").read_text()
    _, separator, mapping_instructions = mapping_rule.removeprefix("---\n").partition("\n---\n")
    if not separator or not mapping_instructions.strip():
        raise ValueError("Expected mapping instructions after the frontmatter in the Cursor rule.")

    owners = users + ([team] if team else [])
    codeowners = "* " + " ".join("@" + owner for owner in dict.fromkeys(owners)) + "\n"
    manifest_path.write_text(manifest)
    Path("README.md").write_text(readme)
    Path(".github/CODEOWNERS").write_text(codeowners)
    if not Path(".mcp.json").exists():
        Path(".mcp.json").write_text(mcp_config)
    if not Path("CLAUDE.md").exists():
        Path("CLAUDE.md").write_text(mapping_instructions.lstrip("\n"))
    README_TEMPLATE.unlink()


def origin_repository():
    origin = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
    result = subprocess.check_output(
        ["gh", "repo", "view", origin, "--json", "nameWithOwner,visibility"], text=True,
    )
    return json.loads(result)


def install(destination, content):
    try:
        with destination.open("x", encoding="utf-8") as output:
            output.write(content)
    except FileExistsError:
        print(f"Kept {destination}")
    else:
        print(f"Added {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", nargs="?", help="GitHub repository in owner/name format (defaults to origin)")
    parser.add_argument("--maintainers", help="Space-separated GitHub logins (defaults to the gh login)")
    team = parser.add_mutually_exclusive_group()
    team.add_argument("--owning-team", help=f"Owning team (defaults to {DEFAULT_OWNING_TEAM} in devrev)")
    team.add_argument("--no-owning-team", dest="owning_team", action="store_const", const="", help="Omit the owning team")
    parser.add_argument("--enable-review", action="store_true", help="Install the shared connector review workflow")
    parser.add_argument("--enable-marketplace", action="store_true", help="Install DEV Marketplace draft submission")
    args = parser.parse_args()

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

        if needs_setup:
            maintainers = args.maintainers
            if maintainers is None:
                maintainers = subprocess.check_output(["gh", "api", "user", "--jq", ".login"], text=True).strip()
            initialize(repository, maintainers, args.owning_team)

        if args.enable_marketplace:
            slug = repository.lower().split("/", 1)[1]
            config = (TEMPLATES / "marketplace.yaml").read_text()
            install(Path("marketplace.yaml"), config.replace("REPOSITORY_SLUG", slug))

        for enabled, name in (
            (args.enable_review, "claude-code-review.yml"),
            (args.enable_marketplace, "create-marketplace-submission.yml"),
        ):
            if enabled:
                install(Path(".github/workflows") / name, (TEMPLATES / "workflows" / name).read_text())
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
