# Local validation

Date: October 15, 2026

| Check | Result |
| --- | --- |
| TypeScript build | Passed |
| ESLint | Passed |
| Worker/client unit tests | 5 passed |
| Source API integration test | 1 passed |
| Actual SDK worker lifecycle test | 1 passed |
| Template fixture runner | Discovery, metadata, initial data page, and selection passed |
| Manifest YAML and local function wiring | Passed |
| Code package creation | Passed |
| Live manifest validation | Not run: selected CLI profile is not authenticated |
| Deployment and DevRev issue creation | Not run |

The SDK lifecycle test uses the real `@devrev/airsync-sdk` 2.0.0 worker threads and a local HTTP platform simulator. It verifies project discovery, metadata artifacts, ten normalized tasks across four invocations, persisted cursor state, a new incremental run importing one edited task, selection exclusion, and empty attachment completion. It decompresses uploaded artifact bytes to check their records. It does not validate DevRev transformer behavior or live mapping semantics.
