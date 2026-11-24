# AirSync snap-in template

This repository provides a template to implement an AirSync snap-in that imports data from an external system into DevRev.

## Usage

1. Select **Use this template** > **Create a new repository**.
2. Name the repository `airdrop-<external-system-name>-snap-in` or `airsync-<external-system-name>-snap-in`.
3. Wait for **Set up the repository** in Actions. If it opens a setup PR, merge the PR before cloning.
4. Clone the initialized repository and follow its README.

Setup uses the GitHub actor as the initial maintainer. Set the `AIRSYNC_MAINTAINERS` and
`AIRSYNC_OWNING_TEAM` Actions variables or supply the corresponding inputs when running
the workflow manually. Give those users and the owning team write access so GitHub can request
their review through CODEOWNERS.

If the first run is missing, run **Set up the repository** against `main`.
If repository policy prevents Actions from opening PRs, open a PR to `main` from the
setup branch named in the workflow summary.

## Private repository workflows

In a private DevRev connector checkout, run these commands on a branch and review the
generated files before merging. You can enable either workflow independently.

```bash
python3 .github/scripts/enable_private_workflows.py review
python3 .github/scripts/enable_private_workflows.py marketplace
```

- **Connector PR review** uses the [shared review workflow](https://github.com/devrev/connectors-codegen/blob/main/repo-docs/connector-pr-review.md).
  Confirm Actions access and AWS OIDC trust for the repository. Check an automatic
  review on a same-repository PR and rerun it with `/connector-review`.
- **DEV Marketplace drafts** use the [shared submission action](https://github.com/devrev/github-actions/tree/main/create-marketplace-submission).
  Confirm access to the action and the `READ_GITHUB_ACTIONS_RELEASES` and `DEVREV_DEV_PAT`
  secrets. Review the DEV slugs in `marketplace.yaml`. Create the `marketplace-submission`
  label if needed and apply it to a PR with snap-in changes before merging into `main`.

The installer keeps existing workflow files and Marketplace configuration. If another
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
