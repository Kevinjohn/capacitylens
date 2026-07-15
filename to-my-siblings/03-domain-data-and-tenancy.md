# 03 — Domain, data and tenancy

This chapter captures the data-safety patterns siblings should copy even when every domain noun
changes.

## Canonical entity base

Every persisted entity has:

```ts
interface Entity {
  id: string
  createdAt: string
  updatedAt: string
}

interface ScopedEntity extends Entity {
  accountId: string
}
```

Use URL-safe bounded ids, ISO timestamps and date-only strings for date-only concepts. Generate ids
and local timestamps at the orchestration boundary; let the server return authoritative revisions.

All tenant-owned rows carry `accountId`. Top-level account rows do not. Never infer tenancy only
through a parent foreign key: carrying the tenant id makes authorization, imports, filtering and
integrity checks explicit.

## Selected tenant is transient

`activeAccountId` is a navigation/session choice:

- do not persist it in account data;
- do not include it in export;
- clear it on company switch/sign-out;
- show the picker on each fresh load;
- validate it against account summaries before loading;
- tag asynchronous results with the account they belong to.

This prevents yesterday's device choice becoming shared tenant state and reduces cross-account
stale-result bugs.

## Scoped reads

Create one standard projection for active tenant data. In CapacityLens:

- `scopedTables()` gives an exhaustive uniform view of scoped arrays;
- `useScopedData` / `useActiveScopedData` provide client projections;
- the server independently queries and authorizes the requested account;
- inactive rows are excluded by the same lifecycle predicate.

Do not allow components to scatter `row.accountId === activeAccountId` filters. A named seam is
testable, exhaustive and reviewable.

## Authorization and integrity are different

- **Authorization**: may this session perform this action on this tenant?
- **Integrity**: would the resulting data satisfy domain relationships?

The server must do both. A valid editor can still submit an activity pointing at another tenant's
project; membership alone does not make the row coherent.

For every scoped write:

1. authenticate session if auth is enabled;
2. read asserted tenant id from the request;
3. resolve membership and action;
4. validate entity id/body shape;
5. merge patch with stored row when relevant;
6. ensure every reference belongs to the same tenant;
7. apply domain and lifecycle rules;
8. write in a transaction;
9. project sensitive fields for the caller;
10. audit field names, not values.

## Relationship rules

Write required relationships in types and enforce coherence at the boundary. CapacityLens examples:

- a project must have an in-account client;
- a phase must have an in-account project;
- a project activity must have a project;
- an internal/repeatable activity must have neither project nor phase;
- a phase referenced by an activity must belong to that activity's project;
- allocations must reference an in-account resource and activity;
- placeholders are constrained by their bound project;
- external resources cannot carry load or time off.

The transferable lesson: validate the pair or tuple, not just each foreign key independently.

## Validation has two tiers

### Interactive form

Reject invalid user input and keep it visible:

- required values;
- normalised name/code-name rules;
- maximum lengths;
- numeric ranges;
- real calendar dates and non-reversed ranges;
- allowed preset colours;
- conditional fields for discriminated kinds.

Do not silently clamp a value the user can correct. If five days of work over one day implies more
than twenty-four hours/day, explain the corrective action.

### Import/server boundary

Untrusted bulk data may be repaired when safe:

- normalise strings;
- clamp harmless numeric values;
- fill documented legacy defaults;
- drop rows with unsafe/missing references;
- repair malformed privacy values fail-closed;
- canonicalise lifecycle chronology;
- remap ids without creating duplicate built-ins.

The difference is intentional: a form has a human present; an import must either construct a safe
coherent slice or reject atomically.

## Validator/enforcer flow

Use this shape:

```text
pure validator returns { ok, errors }
        ↓
write boundary throws a clear, user-safe error
        ↓
UI catches and displays it / server maps caller error to 4xx
```

Validators should not throw for ordinary invalid input. Write boundaries should not swallow
integrity throws. UI call sites should not let expected write errors escape into a generic render
boundary.

## Import and export

An import is not “a loop of creates”.

- Parse and size-bound the payload.
- Verify product/schema markers.
- Migrate older supported versions.
- Remap and sanitise in memory.
- Validate full referential integrity.
- Apply the complete tenant replacement in one server transaction.
- Authorize at a tier appropriate to replacement/destruction.
- Reconcile the client from the committed server state.

CapacityLens server imports are owner-only because a non-owner export is deliberately redacted and
cannot replace the owner's confidential identity fields losslessly. This is a useful general rule:
if a role cannot read every field required for a round trip, it cannot safely perform a whole-slice
replacement.

Exports must:

- contain only the active/selected tenant;
- preserve inactive records when they are part of recovery;
- omit device preferences and selected-tenant state;
- apply the same field-level privacy projection as API reads;
- include a schema/product marker.

## Built-in records

A product may need a system anchor such as CapacityLens's Internal client.

Rules for built-ins:

- mark them with an explicit field, not a magic id or name;
- create exactly one per tenant on every account-creation/migration/import path;
- prevent rename/archive/delete/purge at every write boundary;
- hide them from management lists if they are implementation detail;
- allow them in selectors where their relationship is meaningful;
- include full fixtures and invariant tests.

## Lifecycle state machine

Default family lifecycle:

```text
active ──archive──> archived ──delete──> soft-deleted ──purge──> absent
  ^                    │
  └─────unarchive──────┘
```

Recommended rules:

- illegal transitions return conflict, not silent success;
- only selected root entities participate;
- normal reads show active rows only;
- inactive reads require elevated permission;
- soft deletion scrubs personal display fields where appropriate;
- purge requires both elevated permission and a minimum tombstone age;
- purge cascades in one transaction;
- built-ins are protected;
- the UI names archive separately from permanent delete.

Do not add a “Delete” button until its state transition and recovery story are defined.

## Cascades

Classify each relationship:

- **owned child** — delete/cascade with parent;
- **reference** — unbind when target disappears;
- **system anchor** — cannot disappear;
- **historical link** — preserve/snapshot label;
- **private field** — retain or scrub according to lifecycle/privacy policy.

CapacityLens cascades client descendants, project descendants and a resource's allocations/time off,
while deleting a discipline ungroups resources and deleting a phase ungroups activities. The
important practice is that the rule is single-sourced and tests cover every path—interactive,
generic API, batch, import and lifecycle route.

## Field-level privacy projection

Private client/project names demonstrate a reusable pattern:

1. Store the real value and cover value.
2. Let only the owning role receive raw fields.
3. Project the cover value for all lower roles on every response path.
4. Preserve protected stored fields on a lower-role write, because that caller cannot round-trip
   values they were not allowed to read.
5. Apply projection to active/inactive reads, exports, write echoes and conflict payloads.
6. Treat backups/operator access separately; projection is not encryption.

Never implement privacy only by hiding a field in JSX.

## Device data is not tenant data

Theme, sidebar state, display density, introductory acknowledgements and offline opt-in belong to
the browser/device unless there is a real cross-device user need. Give all keys one product prefix
and provide “Clear device data”.

Account export should not move these preferences to another company or device.

## Database discipline

- Enable SQLite foreign keys and WAL.
- Keep SQL columns exhaustively checked against entity types.
- Store optional values as NULL and omit them from decoded objects.
- Store JSON-shaped fields through one row codec.
- Order parent creates before child creates and reverse for deletes.
- Use optimistic concurrency by default.
- Use the online backup API, never copy a live WAL database.
- Keep auth/membership/invite/control tables outside the portable domain `AppData`.
