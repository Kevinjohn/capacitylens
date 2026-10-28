---
title: Code standards
description: How CapacityLens code is formatted, named, documented and reviewed across the backend, frontend and shared packages.
---

# Code standards

This page is the standard for code in `apps/backend`, `apps/frontend` and `packages/shared`. It
is for contributors and reviewers. The rules apply to new code and to code you are already
changing. Existing differences are tracked debt, not licence to add more. Wire fields, SQL
names, environment variables, ids, emails and test-ids are stable identifiers and never change
under this page.

## What tools own

Prettier owns whitespace, quoting and line breaks. The root `.prettierrc.json` sets single quotes
and a 100-column width. `apps/backend/.prettierrc.cjs` spreads `@adonisjs/prettier-config` and
keeps semicolons, which the repository uses everywhere. The shadcn primitives in
`apps/frontend/src/components/ui/` keep the upstream 80-column width and double quotes so
registry diffs show substantive changes. Style is not reviewable: if Prettier produced it, it is correct.

ESLint owns the mechanical rules, run by `pnpm run lint` and again on staged files before each
commit.

- The backend uses `@adonisjs/eslint-config` as published, plus these type-aware rules on
  `app/`, `commands/`, `providers/` and `start/`: braces on multi-line blocks, strict equality
  (`== null` allowed), no non-null assertions, no unnecessary conditions, throw only `Error`
  values, nullish coalescing over `||` for defaults, exhaustive `switch` on unions and no
  non-string values in template literals. The `no-unsafe-*` family stays off there because Lucid
  query results and `HttpContext` are typed `any`; the next section says how to narrow them.
- The frontend and shared packages add the same brace and equality rules, one declaration per
  statement, no shadowing (a callback parameter may reuse the name of the variable it is
  initialising), camelCase or UPPER_CASE variables and PascalCase types, and the `unicorn` rules
  for `node:` imports, `Number.parseInt`, `for…of` over index loops and no property access on an
  awaited expression.

Everything else on this page is checked in review.

## Filenames

- Backend files are `snake_case`, as the framework requires and `@unicorn/filename-case`
  enforces: `app/controllers/members_controller.ts`, `app/middleware/security_headers_middleware.ts`.
- Frontend and shared files keep their current names. Match a principal component or type export
  with a PascalCase filename and a hook or utility with a camelCase one when you add a file; do
  not rename existing files to fit.
- shadcn primitives keep their registry names.

## Names inside a module

A function name starts with a verb, and the verb tells the caller what comes back and whether
anything happens on the way. Read these two calls from `app/services/auth/authorization.ts`:

```ts
const role = await activeCompanyRole(userId, accountId, trx); // Role | null: absence is a value
await assertCompanyAction(accountId, 'write', trx); // throws if refused
```

| Verb               | Promise                                                                                              | Example in the tree                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `is`, `has`, `can` | Returns a boolean. No side effects.                                                                  | `canArchive` in `packages/shared/src/domain/lifecycle/transitions.ts`             |
| `assert`           | Throws when the condition fails. On success returns what it established, or nothing.                 | `assertCompanyAction` in `apps/backend/app/services/auth/authorization.ts`        |
| `require`          | Returns what the caller needs or throws. The throwing partner of `get`.                              | `requireCompanyScope` in `apps/backend/app/models/scoped_model.ts`                |
| `ensure`           | Makes a state true if it is not already. Safe to call twice.                                         | `ensurePrivateBackupDirectory` in `apps/backend/app/services/backup/snapshot.ts`  |
| `get`              | Looks one thing up by key. Returns it, or `null` when absent. Never throws for absence.               | `getMasqueradeContextToken` in `apps/frontend/src/auth/masqueradeContext.ts`         |
| `list`             | Returns an array of matches, empty when there are none.                                              | `listSnapshots` in `apps/backend/app/services/backup/retention.ts`                |
| `read`             | Reads from storage, the network or the environment.                                                  | `readApiError` in `apps/frontend/src/lib/readApiError.ts`                         |
| `parse`            | Turns untrusted input into a typed value and never returns garbage: `null`, a typed error or a default. | `parseISOTimestamp` in `packages/shared/src/lib/integrity.ts`                   |
| `validate`         | Checks a value that is already typed. Returns a `ValidationResult` and never throws.                 | `validateProjectClient` in `packages/shared/src/lib/integrity.ts`                 |
| `normalize`        | Returns a repaired copy of the same type.                                                            | `normalizeAccountEmail` in `packages/shared/src/account/validation.ts`            |
| `resolve`          | Picks one concrete value from preferences or candidates.                                             | `resolveBarColor` in `packages/shared/src/lib/color.ts`                           |
| `build`            | Derives a new structure from its inputs. Pure.                                                       | `buildColumnGeometry` in `apps/frontend/src/components/scheduler/columnGeometry.ts` |
| `create`           | Constructs something with identity or capabilities.                                                  | `createActionProof` in `apps/backend/app/services/auth/action_proof.ts`           |
| `make`             | Test fixtures only.                                                                                  | `makeResource` in `apps/frontend/src/test/fixtures.ts`                            |
| `use`              | A React hook.                                                                                        | `useScopedData` in `apps/frontend/src/store/useScopedData.ts`                     |

Functions that do something rather than answer something use a plain domain verb (`remove`,
`revoke`, `send`, `record`, `transform`) and say which. Two verbs stay out: `find`, because `get`
already says "or nothing", and `handle`, because a callback is named for what it does. A prop is
`onSubmit`; the function passed to it is `submit` or `saveDraft`.

Variables say what they hold, not what type they are: `resources`, not `resourceList`; a map is
named by its key, `resourcesById`; a count ends in `Count`. Booleans read as a yes/no question
(`enabled`, `isOpen`, `canEdit`) and are never negated in the name. Length grows with distance: a
loop index three lines from its declaration can be `i`; anything exported says its role in full.
Abbreviations are a closed list: `id`, `db`, `trx`, `ctx`, `req`, `res`, `el`, `i`, `j`, and `a`
and `b` inside a comparator.

Parameters are at most three, subject first. A fourth parameter, or a boolean flag in any
position, turns the list into one options object with a named type ending in `Options` or
`Input`. Dependencies (the transaction, the clock, the fetch) are parameters, never imports of a
singleton. Optional means absent, not `null`.

Results with several outcomes are a discriminated union on `kind`, named `<Thing>Result` or
`<Thing>Outcome`; `OwnershipTransferOutcome` in `packages/shared/src/account/ownershipTransfer.ts`
is the pattern, and callers `switch` on `kind`. `status` is the lifecycle state of a thing, never
the outcome of a call. `ok` belongs to `ValidationResult` and to wire shapes. In-memory lookups
return `undefined`, as `Array.find` does; database lookups return `null`, as SQL does; do not
convert one into the other at a boundary. Async functions return `Promise<T>` under the same
names, with no `Async` suffix.

## Errors

The one rule is surface, never swallow. A `catch` has three legitimate jobs: re-throw with more
context and `{ cause }` attached; route the error to a visible surface (a form field, a toast, an
HTTP status with a safe message, the operator log); or degrade to a documented default for state
that is not load-bearing. `catch {}` that drops the error, or `catch { return null }` on a data
path, turns a loud failure into invisible corruption. Replacing a specific message with a generic
one is a swallow too.

Validation returns a value; enforcement throws. Validators return a `ValidationResult` or a VineJS
schema result and never throw on bad input. The write boundary converts a failed result into a
typed error whose message is safe to show, such as `PlanningOperationError` in
`apps/backend/app/services/planning_operations/writer.ts`, and `app/exceptions/handler.ts` maps
the class to a status. The frontend catches at the form or gesture handler and relays the message
to the field or toast. Add to the typed error vocabulary rather than sniffing message strings; the
one exception is a library's own wording, which a test pins.

Wrap the boundaries where the world is untrusted or fallible: parsing, storage, the network,
request bodies, environment lookups and the browser file operations. Do not wrap pure functions
on the render path, the store's deliberate integrity throws, or the server's rollback-and-rethrow
points; each of those carries a guard comment saying why. When a pure path needs "more safety",
clamp or return early inside the pure function with a why comment, as the day-span and
utilisation helpers in `packages/shared/src/lib/` do.

The only acceptable swallows are page teardown, a side effect that is itself the surface (a
health check's 503), device-local preferences falling back to their default, and best-effort
diagnostics such as reading an error body. Each carries a one-line why comment, and a fallback
whose cause would otherwise be invisible leaves a `console.warn` breadcrumb.

Backend boundary rule: `ctx.params`, `request.body()` and Lucid query rows arrive typed `any`.
Narrow them where they enter, with a `validateUsing` schema for bodies and queries, a one-line
checked read for route parameters (`userIdParam` in `app/controllers/admission_controller.ts`),
and `String(row.column)` or a typed model for rows. An `as` cast is not a narrowing; a comment
beside any remaining cast says why it is sound.

## Comments and TSDoc

Comments are for the contributor reading this cold, and they explain why, not what. The rules are
numbered so a review can cite one.

1. **A comment says why; the code says what.** Delete any comment a reader would not miss.
2. **Every exported symbol gets TSDoc.** The first sentence stands alone and says what the call
   does, in the third person: "Authorizes one company action from live membership." State
   preconditions, what a throw means, and purity whenever they apply. Document the contract the
   type cannot carry: "a foreign id throws and nothing is changed" is the most important thing a
   caller can know.
3. **Tags are TSDoc:** `@param`, `@returns`, `@throws`, `@remarks`, `@deprecated`, `@example`.
   No types inside tags; the signature carries them. Add `@param` and `@returns` only when the
   name and type cannot say it. `@deprecated` names the replacement.
4. **Internal code uses `//` above the line, in full sentences.** No trailing comments.
5. **Catch and guard comments are mandatory.** Every `catch` says what is swallowed or surfaced
   and why. Every "do not wrap" point carries its guard comment.
6. **Emphasis comes from wording, never from capitals.** Say "must" or "never" in a normal
   sentence. Acronyms stay upper-case.
7. **No plan or ticket references, and no history.** Cite a `DECISIONS.md` heading or an issue URL
   instead of a phase label. Migration narratives and promises about future callers go.
8. **No section banners and no commented-out code.** A file that needs banners needs splitting.
   A `TODO` carries an issue URL or is deleted.
9. **Explain the invariant, not the fix.** Write what must stay true, especially where safety
   depends on something non-local: "this cast is sound because the row was just validated".
   A comment that describes behaviour the code does not implement is worse than none.
10. **Density.** An intricate file carries one head paragraph. Any other file needs no comments
    beyond rules 2 and 5, plus a why comment wherever rule 1 or 9 calls for one.

One example for each backend shape. Controllers document the route's contract, not the HTTP
mechanics; models document what the column promises; middleware documents what it refuses.

```ts
/** Returns the companies this principal may enter, or 409 while the installation has more than one. */
export default class CompaniesController {

/**
 * Authorizes one company action from live membership inside the actor's verified transaction.
 *
 * @throws `IdentityAuthorityError`, mapped to 403 by the handler; nothing was read or written.
 */
export async function assertCompanyAction(

/** A client row. `isPrivate` hides the name from non-owners; `builtin` marks the internal client. */
export default class Client extends SoftDeletes(ClientSchema) {

/** Captures one package admission and enforces context/read-only policy before route parsing. */
export default class MasqueradeReadOnlyMiddleware {
```

The second and fourth are in the tree today. The first and third are the shape to add when you
touch those files; do not backfill the rest of the backend in an unrelated change.

## Review checklist

1. Prettier and `pnpm run lint` pass on the changed files; nothing is `eslint-disable`d without a
   why comment.
2. Every new export has TSDoc whose first sentence stands alone.
3. Every new function name starts with a verb from the table and keeps its promise.
4. No `find…` or `handle…` names; no negated booleans; no fourth positional parameter.
5. Multi-outcome results discriminate on `kind`; `status` is lifecycle only.
6. Every `catch` surfaces, re-throws with `cause`, or carries a comment naming the acceptable
   swallow.
7. No `try/catch` around pure functions or deliberate integrity throws.
8. Backend `any` is narrowed where it enters; every remaining `as` cast has a soundness comment.
9. No trailing comments, banners, commented-out code, ticket labels or history in comments.
10. Stable identifiers (wire fields, SQL names, test-ids, routes) are unchanged by any rename.
