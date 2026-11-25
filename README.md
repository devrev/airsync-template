# AirSync snap-in template

This repository provides a template to implement an AirSync snap-in that imports data from an external system into DevRev.

## Usage

1. Select **Use this template** > **Create a new repository**.
2. Name the repository `airsync-<external-system-name>-snap-in`.
3. Clone the repository and switch to your working branch.

With Python 3.9 or newer and an authenticated GitHub CLI, run the initializer
from the repository root.

```bash
python3 .github/scripts/initialize.py
```

The initializer takes the connector name from the Git origin and adds your
GitHub login to CODEOWNERS. Pass `--owning-team org/team-slug` to add a team.

Commit the setup changes together on your working branch and follow the generated README.

## Private repository workflows

In a private DevRev repository, pass either option or both to the same initializer
to include the selected workflows in the setup commit.

```bash
python3 .github/scripts/initialize.py --enable-review --enable-marketplace
```

- **Connector PR review** uses the [shared review workflow](https://github.com/devrev/connectors-codegen/blob/main/repo-docs/connector-pr-review.md).
  Confirm Actions access and AWS OIDC trust for the repository. Check an automatic
  review on a same-repository PR and rerun it with `/connector-review`.
- **DEV Marketplace drafts** use the [shared submission action](https://github.com/devrev/github-actions/tree/main/create-marketplace-submission).
  Confirm access to the action and the `READ_GITHUB_ACTIONS_RELEASES` and `DEVREV_DEV_PAT`
  secrets. Review the DEV slugs in `marketplace.yaml`. Create the `marketplace-submission`
  label if needed and apply it to a PR with snap-in changes before merging into `main`.

The initializer keeps existing workflow files and Marketplace configuration. If another
automated reviewer is present, replace its workflow when adopting the shared reviewer.

## Documentation

See the [AirSync snap-in documentation](https://developer.devrev.ai/airsync) for development guidance.

The template uses `@devrev/airsync-sdk` and requires Node.js 20 or newer.

## Local Fixture Testing

From the `code/` directory, you can run the built-in fixture runner to test the
template locally:

```bash
npm start -- --fixturePath start_extracting_external_sync_units
npm start -- --fixturePath start_extracting_data
npm start -- --fixturePath start_extracting_data_selective
npm start -- --fixturePath start_loading_data
```

The runner reads `code/.env` and resolves `${TODO_API_KEY}` in fixture files,
so copy `code/.env.example` before running the fixtures.
The fixture runner and local test server set `AIRSYNC_LOCAL_DEVELOPMENT=1`
to enable local logging and artifact copies in `code/extracted_files/`.
