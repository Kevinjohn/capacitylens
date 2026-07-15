# 09 — State, persistence, offline and errors

The most important reliability rule is simple: a user must never believe a change is saved when the
source of truth disagrees.

## State categories

Keep these conceptually distinct even if some share a Zustand store:

| Category | Examples | Owner |
| --- | --- | --- |
| Domain snapshot | clients, projects, allocations | Server/adapter |
| Tenant navigation | active account | In-memory client |
| Undo/redo | previous/next domain snapshots | Client store |
| Form state | draft values, dirty flag, field error | Component/hook |
| Device preference | theme, sidebar, display toggles | Local storage |
| Offline snapshot | verified role-filtered account data | IndexedDB |
| Auth state | session/user/mode | Server + auth provider |
| Operator state | DB path, backups, auth posture | Environment |

Do not put everything into exported tenant data.

## Store responsibilities

`src/store/useStore.ts` is the orchestration seam for:

- current data;
- ids and timestamps;
- active tenant;
- domain mutations;
- shared integrity enforcement;
- history;
- notices/errors and selected UI preferences.

Use pure selectors and hooks for projections. Components should not reach into raw cross-tenant
arrays and rebuild policy.

## Persistence outside the store

Attach the adapter through an external orchestrator. Benefits:

- store unit tests need no I/O;
- demo/server adapters swap explicitly;
- subscription, debounce, retry and refresh logic has one owner;
- server persistence can reconcile revisions without contaminating domain actions.

The store is optimistic. Optimism does not mean pretending persistence failures succeeded; the
orchestrator tracks unacknowledged state and the shell shows a banner.

## Explicit persistence flavours

### Normal server

- Empty API origin means same-origin API.
- SQLite is authoritative.
- A missing/unreachable API is a visible error.
- No browser-storage scheduling fallback.

### Demo

- Selected only by an explicit build flag.
- In-memory adapter.
- Editable sample data.
- Resets on refresh.
- No scheduling data in local storage.
- No auth/network calls.

The explicit selector prevents a misconfigured production build from quietly storing important data
in one browser.

## Whole-tree diff and atomic batch

CapacityLens's store produces the complete next tree. The server adapter:

1. compares next tree with last acknowledged tree;
2. emits PUT/DELETE operations;
3. orders parent upserts before children;
4. orders deletes child-first;
5. sends a single batch;
6. server validates the running projection and applies one transaction;
7. receipt returns server-owned revisions;
8. adapter updates its snapshot only after success.

This supports forward edits, cascade effects, undo/redo and local demo import through one seam.

Do not split a logically atomic change merely to fit a batch limit. An oversized delta should stop
retrying, remain visibly unsaved and tell the user to make a smaller change.

## Save lifecycle

```text
store data changes
  ↓ debounce
pending + unacknowledged snapshot
  ↓ serialized save
success ──> acknowledge latest, clear retry/error
failure ──> surface, capped exponential retry
                ↓ exhausted
          retry on online/visible recovery event
```

Important details:

- retry sends latest state, not a stale failed snapshot;
- in-flight saves are awaited during tenant switch;
- beforeunload checks dirty form and unacknowledged persistence;
- visibility hidden flushes normally;
- pagehide may use a keepalive path;
- the last-synced snapshot advances only after successful server acknowledgement.

## Refresh without data loss

A server refresh can destroy a debounced local edit if it simply replaces state.

Safe refresh:

1. flush pending edit;
2. await in-flight save;
3. abort refresh if save remains failed (unless refresh is the explicit conflict resolution);
4. suspend writes during load;
5. token/tag request with account and sequence;
6. install only if still current;
7. reseed adapter snapshot;
8. rebase an edit made during the load when safe;
9. surface any edit that cannot be safely retained.

Use the same orchestrator for focus refresh and out-of-band lifecycle routes.

## Unknown outcomes

A timeout means the browser stopped waiting; it does not mean the server rolled back.

For non-idempotent/destructive actions:

- disable double submit while in flight;
- after transport failure, refetch authoritative state;
- close or disarm forms that could duplicate the action;
- tell the user the outcome was unknown and the view/list was refreshed;
- only offer retry after reconciliation.

Examples: tenant create/delete, invite creation/revocation, import, archive/purge, membership and
password-reset link issuance.

## Conflict policy

Optimistic concurrency returns 409 for stale writes. CapacityLens currently uses a documented
server-wins interim policy:

- stop retrying the same stale diff;
- surface that the edit did not save;
- reload authoritative state;
- reseed the snapshot;
- retain the sticky notice even after the generic banner clears.

A future merge UI may replace this. What matters is never retrying a deterministic conflict forever.

## Import write suspension

Whole-slice replacement creates a special race:

- ordinary pending edits must land before import;
- edits made while import is in flight must not land against either the old or ambiguously new tree;
- successful import must reload the committed remapped slice;
- parked edits may be rebased only when safe;
- if the server committed but reload failed, stale parked edits are dropped and visibly reported
  rather than resurrecting pre-import rows.

This is why bulk replacement cannot reuse casual fetch-and-replace code.

## Offline access

Family default:

- off by default;
- explicit per-device opt-in;
- cache application shell plus last verified identity, account list and role-filtered slices;
- IndexedDB for snapshots;
- seven-day expiry;
- scoped to browser origin and verified user id;
- effective role becomes Viewer;
- no create/update/delete/import/member actions;
- no queued mutation and no reconciliation algorithm;
- visible offline/read-only banner with snapshot time;
- sign-out clears current user's cache;
- “Clear device data” clears all product caches/preferences;
- disabling unregisters workers and removes all shell cache generations.

Why read-only: conflict-free offline writing is a product of its own. It requires command identity,
ordering, merge rules, deletion semantics, permission expiry and user conflict UI. A small SaaS
should not accidentally acquire it.

Offline snapshots are not encrypted beyond browser-profile protection and are not backups.

## Error standard

Every catch has one of three jobs:

1. rethrow with context and `{ cause }`;
2. route to a visible surface;
3. degrade to a documented default for non-load-bearing state.

No fourth job exists.

### Boundaries that need handling

- JSON and response parsing;
- local/IndexedDB/SQLite I/O;
- fetch/auth/provider calls;
- imported/request/response data;
- environment/runtime APIs;
- store mutation call sites in forms/gestures;
- browser file/download operations.

### Places catch is harmful

- pure render math;
- deliberate store integrity throws;
- transaction rollback/rethrow;
- “advance acknowledgement only on success” seams;
- total error-formatting helpers.

Let programmer errors and integrity violations remain loud.

### Acceptable quiet degradation

Only for documented non-domain state, for example:

- theme/sidebar preference storage blocked;
- portrait hint session storage blocked;
- best-effort reading of an error response body;
- page teardown where no surface survives.

Leave a warning breadcrumb when it helps diagnose a real problem.

## Error types

Prefer classified errors:

- load unavailable vs corrupt;
- validation/caller fault vs server defect;
- auth configuration refusal;
- conflict;
- batch too large;
- discarded/reload edit.

Map them to recovery and HTTP status without string sniffing. If a library message must be sniffed,
pin it with a test.

## Data safety acceptance checklist

- Unreachable API never becomes local persistence.
- Failed save remains visible and retriable.
- Tenant switch cannot install stale previous-tenant data.
- Refresh cannot clobber a pending edit.
- Conflict does not retry forever.
- Oversized atomic diff does not retry forever or partially apply.
- Unknown create/delete/import outcome reconciles.
- Import is one transaction.
- Offline snapshot is role-filtered, expiring and read-only.
- Sign-out and clear-device-data erase the right caches.
- Corrupt stored data never opens as an empty editable dataset.
- Every data-path catch surfaces or preserves cause.
