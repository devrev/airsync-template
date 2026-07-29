# v2 Migration Review

Migrated `@devrev/ts-adaas` 1.20.0 → `@devrev/airsync-sdk` 2.0.0-beta.6.
Baseline was already the latest stable v1 (1.20.0, migration-free), so no v1
baseline upgrade was needed. Only sections needing a second look are noted; the
rest applied cleanly.

## Sections

- §1 package rename — high
- §2 `AirdropEvent` → `AirSyncEvent` — high
- §3 worker split (`processExtractionTask` / `processLoadingTask`) — high
- §4 emit → return — high
- §4 onTimeout rewrites — medium: the progress-only `onTimeout` handlers in
  `data-extraction` (resumable) and both loading workers were **deleted** — the
  SDK's phase-aware default emits the same continuation. The `metadata` and
  `external-sync-units` handlers were **kept** and converted to
  `return { status: 'error', error: {...} }` because each carried a custom
  timeout message that the SDK default would otherwise replace with a generated
  one. Confirm these two non-resumable phases should still surface those exact
  messages.
- §6 loading pass-through (`load-data`, `load-attachments`) — high
- §6 attachment streaming (`attachments-extraction`) — medium: replaced the v1
  `streamAttachments` result branching (delay/error/done emits) with a straight
  `return adapter.streamAttachments(...)`. This also dropped the surrounding
  `try/catch` whose only action was `console.error` + swallow (it emitted
  nothing). The returned `TaskResult` already encodes delay/error/success, so
  behavior is preserved or improved; confirm no bespoke catch handling is
  wanted here.
- §7 external sync units via repo — high (connector already pushed ESUs to the
  `EXTERNAL_SYNC_UNITS` repo; only the trailing emit changed to `return`)
- §10 `Mappers` `.data` unwrap — high (only a commented-out template example was
  updated; no live mapper read exists in this connector)

Verified no-ops (no code changed): §5 (no `WorkerAdapter` annotations/
constructions), §8 (no SDK fields in `ExtractorState`/`LoaderState`, no
`lastSync*`, no `AdapterState`), §9 (connector imports `axios` directly, never
the SDK axios surface; no `statusCode` on the streaming error), §11–§15 (no
legacy modules, deleted enum members, deep imports, or `workerPath`), §16 (the
connector has no jest test suite).

## Verification

tsc ✓ · lint ✓ · build ✓ · test — n/a (no jest suite; `npm test` reports "No
tests found" on both the pre-migration and post-migration tree — a pre-existing
condition, not caused by this migration).
