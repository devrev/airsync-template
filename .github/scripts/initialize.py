"""Initialize a repository created from the AirSync template."""

import argparse
import re
from pathlib import Path

README_TEMPLATE = Path(".github/templates/README.md")
CONNECTOR_NAME = re.compile(r"(?:airdrop|airsync)-([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)-snap-in")
USERNAME = re.compile(r"[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?")
TEAM = re.compile(r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+")


def initialize(repository, maintainers, owning_team):
    _, _, name = repository.lower().partition("/")
    connector = CONNECTOR_NAME.fullmatch(name)
    if not connector:
        raise ValueError("Repository name must be airdrop-<system>-snap-in or airsync-<system>-snap-in.")

    if not README_TEMPLATE.exists():
        return

    users = [user.removeprefix("@") for user in maintainers.split()]
    if not users or any(not USERNAME.fullmatch(user) for user in users):
        raise ValueError("Specify at least one GitHub maintainer login for CODEOWNERS.")
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", help="GitHub repository in owner/name format")
    parser.add_argument("--maintainers", default="", help="Space-separated GitHub logins")
    parser.add_argument("--owning-team", default="", help="GitHub team in organization/team-slug format")
    args = parser.parse_args()
    try:
        initialize(args.repository, args.maintainers, args.owning_team)
    except ValueError as error:
        parser.error(str(error))
