# Tasks Demo AirSync connector

A one-way connector from a small Tasks API to DevRev issues, built from `devrev/airsync-template` and the supplied data extraction guide. See [TEMPLATE_SOURCE.md](TEMPLATE_SOURCE.md) for the exact template revision and source link.

## Scope

- One project, `demo-project`, discovered as an external sync unit.
- Ten seeded tasks, imported as issues with their source title and timestamps.
- Three tasks per worker invocation, with persisted continuation state.
- Incremental extraction using the source update time and the platform time window.
- Selection, source validation, HTTP timeout, and rate-limit delay handling.
- Static metadata and initial issue mapping, plus a bearer-token connection.

The connector exposes extraction only. Attachment extraction completes without records because this source has no attachments. Reverse sync, users, comments, and deletions are outside this example.

## Run locally

Requires Node.js 22 or newer and npm. From the repository root:

```sh
cd code
npm ci
cp .env.example .env
npm run source
```

Keep that terminal running. In a second terminal, from `code/`:

```sh
npm start -- --fixturePath start_extracting_external_sync_units
npm start -- --fixturePath start_extracting_metadata
npm start -- --fixturePath start_extracting_data
npm start -- --fixturePath start_extracting_data_selective
npm start -- --fixturePath start_extracting_attachments
```

These use the template fixture runner and a local mock of DevRev platform endpoints. SDK output files are copied to `code/extracted_files/`. Each fixture invokes one worker; the data fixture extracts the first three tasks. The selective fixture excludes tasks and produces no task artifact. The integration test below drives all continuations automatically.

The source API listens on `127.0.0.1:3100`. It stores records in memory and resets when restarted. `.env.example` contains a local demonstration token; use the same token on the source and its connection.

## Change source data

```sh
curl -X PATCH -H 'Authorization: Bearer local-demo-token' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Edited example task"}' \
  http://127.0.0.1:3100/tasks/1
```

After editing, the `start_extracting_data_incremental` fixture selects updates since February 1, 2026; the seeded task timestamps precede that date. The API's `GET /tasks` accepts `project_id`, `limit`, `cursor`, `updated_from`, and `updated_to`. Time boundaries are inclusive. Its offset pagination assumes the source is not edited during a paginated run.

## Verify

From `code/`:

```sh
npm run build
npm run lint
npm test
npm run test:source
npm run test:integration
npm run package
```

The integration test starts both HTTP servers itself. It executes the actual SDK worker threads, installs the mapping against a simulated platform endpoint, saves and reloads state, receives callbacks, uploads and decompresses JSONL artifacts, and checks discovery, metadata, all ten tasks across four invocations, one incremental update, selection exclusion, and attachment completion.

Unit checks cover rate-limit delay, upload failure without cursor advancement, malformed data, repeated cursors, and numeric/HTTP-date retry hints. These checks do not run DevRev's transformer or create real issues.

## Configure for a live DevRev import

1. Host `source-api/server.mjs` at an HTTPS origin reachable from DevRev. Set `EXAMPLE_API_TOKEN` to a new token and set `HOST=0.0.0.0` if your hosting platform needs it. `PORT` defaults to 3100. The included source is an in-memory demonstration service.
2. From `code/`, set the source origin before building:

   ```sh
   npm run configure:source -- https://your-tasks-host.example
   npm run package
   ```

   This writes the origin to the bundled `source-config.json` and the manifest verification and organization URLs. `EXAMPLE_API_ORIGIN` overrides it for local runs. Deployed credentials come from the connection key, not local environment variables.
3. Validate the manifest against the intended authenticated DevRev profile:

   ```sh
   devrev snap_in_version validate-manifest ../manifest.yaml
   ```

4. The template deployment script is retained as `npm run deploy`. It prompts for your environment, organization, email, deployment mode, and package slug. Deployment has not been run here.
5. In DevRev, create the **Tasks API Connection** using the source bearer token, start **Tasks Demo**, and select **Demo Project**. Credentials are verified against the authenticated `/projects` endpoint when creating the connection. Organization discovery uses that same endpoint and identifies this single-account demo as `tasks-demo` / **Tasks Demo**.
6. Review the Tasks-to-issue mapping. The template's `applies_to_part_id` mapping needs an existing DevRev product selected for the issues; no organization-specific target ID is hardcoded.

## Validation status

Build, lint, five unit tests, one source API test, one complete SDK lifecycle test, four fixture runs, manifest YAML/wiring checks, and package creation passed locally. The DevRev CLI manifest check could not run because its selected profile is not authenticated. Live manifest acceptance, mapping acceptance, and real DevRev issue creation remain unverified.
