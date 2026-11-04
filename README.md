# AirSync snap-in template

This repository provides a template to implement an AirSync snap-in that imports data from an external system into DevRev.

## Usage

1. Click "Use this template" > "Create a new repository"
2. Name your repository `airdrop-<external-system-name>-snap-in` (e.g., `airdrop-github-snap-in`)
3. Clone and follow the setup instructions in the generated README

## Documentation

See the [AirSync snap-in documentation](https://developer.devrev.ai/airsync) for development guidance.

The template uses `@devrev/airsync-sdk` and requires Node.js 20 or newer.

Todo HTML bodies are converted to Markdown rich-text arrays and mapped with
`use_rich_text`. Reverse sync renders rich text back to HTML. The sample
attachments download a README pinned to a repository commit; replace these URLs
with downloadable files from your external system.

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

Run the rich-text and attachment fixture regression tests from `code/` with
`npm test -- --runInBand`.
