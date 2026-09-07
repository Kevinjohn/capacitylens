---
title: Name functions, variables and results
description: What a function name promises, how long a variable name should be, when parameters become an options object, and what shape a result takes in CapacityLens code.
---

# Name functions, variables and results

This page is the standard for how code inside a module reads: what a function's name
promises, how long a variable name should be, when parameters become an options object,
and what shape a result takes. It is for contributors and reviewers. Filenames, exports,
imports and module ownership are in the [development guide](/reference/development); error
handling is in `DEFENSIVE-CODING.md` at the repository root, and this page defers to it.

The rules apply to new code and to deliberate migrations. Existing differences are tracked
debt, not licence to add more. Wire fields, SQL names, environment variables, ids, emails
and test-ids are stable identifiers and never change under this page.

## The verb is the contract

Read these two calls from `server/src/controlTables/members.ts` and
`server/src/accounts/adminPort/authority.ts`:

```ts
const role = getMemberRole(db, accountId, userId); // Role | null: absence is a value
const actorRole = assertAccountAuthority(db, actor, workspaceId, "manage-invitations"); // throws if refused
```

The first name says "this may be absent, check it"; the second says "if this returns, you are
authorised". Neither caller needs to open the function. That is the whole standard: a function
name starts with a verb, the verb tells the caller what comes back and whether anything happens
on the way, and the verb comes from this table.

| Verb               | Promise                                                                                                                                                                                 | Example in the tree                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `is`, `has`, `can` | Returns a boolean. No side effects.                                                                                                                                                     | `canArchive(entity)` in `shared/src/domain/lifecycle/transitions.ts`                       |
| `assert`           | Throws when the condition fails. On success returns the value it established, or nothing.                                                                                               | `assertAccountAuthority` in `server/src/accounts/adminPort/authority.ts` returns the `Role` |
| `ensure`           | Makes a state true if it is not already, returns nothing. Safe to call twice.                                                                                                           | `ensureControlTables(db)` in `server/src/controlTables/retentionV24.ts`                    |
| `get`              | Looks one thing up by key in storage. Returns it, or `null` when absent. Never throws for absence.                                                                                      | `getMemberRole(db, accountId, userId)` in `server/src/controlTables/members.ts`            |
| `list`             | Returns an array of matches, empty when there are none.                                                                                                                                 | `listMembersForAccount(db, accountId)` in the same file                                    |
| `read`             | Reads from storage, the network or the environment.                                                                                                                                     | `readApiError(res)` in `src/lib/readApiError.ts`                                           |
| `parse`            | Turns untrusted input into a typed value and never returns garbage. A decoder returns `null`; a boundary parser throws a typed error; a configuration parser applies its documented default or refuses start-up. | `parseISOTimestamp` (`null`) in `shared/src/lib/integrity.ts`; `parseData` (throws) in `shared/src/data/transfer.ts`; `parseRateLimit` (default) in `server/src/rateLimit.ts` and `parsePort` (refuses) in `server/src/boot/refusals.ts` |
| `validate`         | Checks a value that is already typed. Returns a `ValidationResult` or reports through a `fail` callback, and never throws, as `DEFENSIVE-CODING.md` section 2 sets out.                 | `validateProjectClient(clientId)` in `shared/src/lib/integrity.ts`                         |
| `normalize`        | Returns a repaired copy of the same type.                                                                                                                                               | `normalizeAccountEmail(value)` in `shared/src/account/validation.ts`                       |
| `resolve`          | Picks one concrete value from preferences or candidates.                                                                                                                                | `resolveBarColor(allocation, maps)` in `shared/src/lib/color.ts`                           |
| `build`            | Derives a new structure from its inputs. Pure.                                                                                                                                          | `buildColumnGeometry` in `src/components/scheduler/columnGeometry.ts`                      |
| `apply`            | Returns the input with a change applied. Pure unless the name says otherwise.                                                                                                           | `applyOps(base, ops)` in `src/data/syncOps.ts`                                             |
| `create`           | Constructs something with identity or capabilities: an entity, a command set, a closure.                                                                                                | `createAllocationCommands(input)` in `src/components/scheduler/allocationSubmit.ts`        |
| `make`             | Test fixtures only.                                                                                                                                                                     | `makeResource(overrides)` in `src/test/fixtures.ts`                                        |
| `use`              | A React hook.                                                                                                                                                                           | `useScopedData` in `src/store/useScopedData.ts`                                            |

Two verbs the table deliberately leaves out: `find`, because `get` and the `<thing>ById`
selectors already say "or nothing", and `handle`, because a callback is named for what it
does. A component prop is `onSubmit`; the function passed to it is `submit` or `saveDraft`,
not `handleSubmit`.

Counterexamples that are now tracked debt:

- `ensureInternalClients` exists twice with different contracts: the shared one in
  `shared/src/data/internalClient.ts` returns a new `AppData`, the server one in
  `server/src/db/repairs.ts` returns nothing. Under this table the shared one is an `apply`.
- `validateAuthUser(value: unknown, requireEmail = false)` returns `AuthUser | null`. It takes
  untrusted input and returns the typed value, so it is a `parse`, and its flag parameter is
  parameter debt too.
- `validate*` functions return four shapes across the tree: `ValidationResult`, a problem or
  `null` (`validateAllocationDraft`), a boolean (`validateHex`) and the typed value or `null`.
  The last group are parses; the audit decides the rest.
- `ensureBarColors(hex)` returns a colour pair. It derives a value, so it is a `resolve`.

## Variables

- **Length grows with distance.** A loop index three lines from its declaration can be `i`.
  Anything exported, passed between files or read more than a screen away says its role in
  full: `activeMemberIds`, not `ids`.
- **Abbreviations are a closed list**: `id`, `db`, `tx` (a transaction), `op` (a batch
  operation), `req` and `res` (HTTP), `el` (a DOM element), `e` in a `catch` clause or an
  event handler, `i` and `j` as indices, `a` and `b` inside a comparator. Anything else is
  written out.
- **Say what it holds, not what type it is.** `resources`, not `resourceList` or
  `resourceArray`. A map is named by its key: `resourcesById`. A count ends in `Count`.
- **Collections are plural**, one item is singular, and a loop reads `for (const resource of
  resources)`.
- **Booleans read as a yes/no question**: `enabled`, `isOpen`, `hasChanges`,
  `canEdit`. Never negate a name (`notReady`, `hasNoRows`); negate at the use site instead.
  Entity fields keep their shipped names (`ignoreWeekends`), and `isNotNull` in
  `server/src/schema/introspection.ts` is the SQL term, not a negated boolean.

## Parameters

- **At most three positional parameters**, subject first: `(db, accountId, userId)`,
  `(resource, date)`. A fourth parameter, or a boolean flag in any position, turns the whole
  list into a single options object with a named type ending in `Options` or `Input`, so every
  call site reads as key and value. `createAllocationCommands(input: CommandInput)` is the
  pattern; `isUnavailable(resource, date, timeOff, closures)` in
  `src/lib/capacity/availability.ts` is the debt. An optional object, as in
  `makeResource(overrides = {})`, is already an options object.
- **Dependencies are parameters.** A function receives the database, clock or fetch it uses,
  and only the capabilities it consumes. The development guide's ownership section says why.
- **Optional means absent, not `null`.** Use `?` on the option; reserve `null` for values
  that are looked up and missing.

## Results

- **A multi-outcome result is a discriminated union on `kind`**, each variant carrying only
  its own data, named `<Thing>Result` or `<Thing>Outcome`. `SessionListResult` in
  `src/account/sessionClient.ts` and `ReserveAccountCommandResult` in
  `server/src/accounts/state/commandLedgerWrites.ts` are the pattern. Callers `switch` on
  `kind`; there is no boolean to check first. UI state unions such as `ModalState` in
  `src/components/scheduler/schedulerGridModal.ts` use the same `kind` discriminant without
  the suffix. `Status` in `src/auth/authStatus.ts`
  discriminates on `kind` but carries a lifecycle name, and `OfflineCacheWriteResult` in
  `src/data/offline/types.ts` discriminates on `status`; both are tracked debt.
- **`status` is the lifecycle state of a thing**, such as a membership or a command, never
  the outcome of a call. The `status` union on operation receipts in
  `shared/src/account/ports.ts` is an existing portable contract and stays as it is.
- **`ok` belongs to `ValidationResult`** in `shared/src/lib/integrity.ts` and to wire shapes:
  HTTP responses such as `server/src/routes/systemRoutes.ts` and the import worker message
  protocol in `server/src/importWorker.ts`. It is not a general outcome shape.
- **Absence follows the source.** In-memory lookups return `undefined`, as `Array.find` and
  `Map.get` do: `resourceById` in `src/store/selectors.ts`. Database lookups return `null`,
  as SQL does: `getMemberRole`. Do not convert one into the other at a boundary.
- **Tuples are for labelled positional pairs** that are always destructured together, like
  `rowKeyParts(key): [table: string, id: string]` in `src/data/sync/revisions.ts`. An
  outcome is never a tuple.
- **Expected failures are values; enforcement throws.** A missing record or an invalid draft
  comes back as data. A broken invariant, a corrupt row, a refused write or a refused
  authorisation throws, using the typed errors `DEFENSIVE-CODING.md` section 2 names (server
  authorisation throws `AccountContractError` carrying an `AccountFailure` from `shared/src/account/errors.ts`, which the routes map to an HTTP status), with
  `cause` attached whenever another error is being wrapped.
- **Async functions return `Promise<T>` with the same naming**, no `Async` suffix. The
  lint rules for floating and misused promises hold the call sites to `await` or `void`.

## What lint enforces

Only the mechanical part of this page is enforced by `pnpm run lint`, in the typed packages
(`src`, `shared/src`, `server/src`, `server/scripts`):

- casing, through `@typescript-eslint/naming-convention`: camelCase for `let` variables,
  camelCase, UPPER_CASE or PascalCase for `const`, camelCase or PascalCase for functions and
  parameters (a component is a value too), PascalCase for types; properties, methods and
  imports are exempt because many mirror wire fields, SQL columns and library names
- negated names, through the same rule: a variable or parameter starting with `hasNo`,
  `not` followed by a capital, or `isNot` (other than `isNotNull`) fails
- `max-params` at three, so a fourth parameter fails

Existing violations are recorded as a count per file and rule in `eslint-suppressions.json`
at the repository root. A count that rises fails lint. A count that falls also fails, until
the entry is pruned with

```
pnpm exec eslint . --prune-suppressions
```

so the baseline only shrinks. Replacing one violation with another in the same file at the
same count is invisible to lint; review catches it.

Everything else on this page is checked in review. When a rule here and the tree disagree
in code you are already changing, fix the code; when they disagree in code you are not
changing, leave it and note it in the audit issue rather than widening the diff.
