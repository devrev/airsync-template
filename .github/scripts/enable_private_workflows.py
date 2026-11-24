"""Install opt-in workflows in a private DevRev connector checkout."""

import argparse
import json
import subprocess
from pathlib import Path

TEMPLATES = Path(".github/templates")
WORKFLOWS = {
    "review": "claude-code-review.yml",
    "marketplace": "create-marketplace-submission.yml",
}


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
    parser.add_argument("workflows", choices=WORKFLOWS, nargs="+")
    args = parser.parse_args()
    origin = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
    result = subprocess.check_output(
        ["gh", "repo", "view", origin, "--json", "nameWithOwner,visibility"], text=True,
    )
    repository = json.loads(result)
    owner, slug = repository["nameWithOwner"].lower().split("/", 1)
    if owner != "devrev" or repository["visibility"] != "PRIVATE":
        parser.error("These workflows require a private repository in devrev.")

    if "marketplace" in args.workflows:
        config = (TEMPLATES / "marketplace.yaml").read_text()
        install(Path("marketplace.yaml"), config.replace("REPOSITORY_SLUG", slug))

    for workflow in dict.fromkeys(args.workflows):
        name = WORKFLOWS[workflow]
        install(Path(".github/workflows") / name, (TEMPLATES / "workflows" / name).read_text())


if __name__ == "__main__":
    main()
