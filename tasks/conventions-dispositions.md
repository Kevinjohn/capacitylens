# Issue #646 disposition ledger

Evidence tree: `f83d9643ef1d2770c03cb8ecaed0b7afd929177c` (7 September 2026).
Issue #646 reported grep candidates, not confirmed defects. The exhaustive occurrence ledger is
[`tasks/conventions-disposition-sites.md`](conventions-disposition-sites.md); its stable
`file:line:column/symbol` keys, classifications, and reasons are the source of these totals.

## Scope and method

Production syntax categories cover all tracked `.ts` and `.tsx` files under `src`, `server/src`,
and `shared/src`, excluding tests, specs, `__tests__`, and fixture directories. Source directives
cover every tracked typed file because negative type tests are relevant evidence. TypeScript 6.0.3
AST nodes provide occurrence and line counts; the 47 async findings come from the typed
`@typescript-eslint/require-await` probe. Comment trivia is used only for debt markers, and
directive text is inventoried separately. This avoids treating words in comments, strings, or
multiple same-line nodes as source sites.

## Candidate dispositions

| Category                          | Occurrences / lines | Terminal disposition                                                                                                                                                                                                         |
| --------------------------------- | ------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Record<string, unknown>`         |           220 / 196 | Deferred tracked debt owned by C6-RU. Syntax alone proves neither safe boundary narrowing nor a leak; each stable row needs contextual evidence before acceptance or repair.                                                 |
| Native `throw new Error`          |           258 / 258 | Accepted individually by role. `DEFENSIVE-CODING.md` permits native display-safe enforcement, contextual wrappers with `cause`, and invariant failures; typed errors are required only when callers route by classification. |
| `console.*`                       |           123 / 123 | Accepted individually as operator/developer diagnostics or documented fallback breadcrumbs. Seven additional grep hits are prose comments, not executable sites. No logging rule bans these references.                      |
| Async without `await`             |             47 / 47 | Accepted Promise-interface debt. The typed probe identifies Promise-returning ports/adapters whose interface must remain asynchronous; #645 deliberately did not enroll `require-await`.                                     |
| `as` assertions                   |           771 / 691 | Deferred tracked debt owned by C6-AS. The #645 rule removes mechanically unnecessary assertions but does not prove the remaining assertions sound; each stable row needs validation/interoperability evidence or removal.    |
| `satisfies`                       |             32 / 32 | Accepted compile-time conformance checks; `satisfies` does not override the expression's inferred type.                                                                                                                      |
| Boolean-literal comparisons       |           110 / 107 | Accepted after #645 removed the one typed unnecessary comparison and enrolled `no-unnecessary-boolean-literal-compare`; remaining sites preserve boolean, optional, or unknown narrowing semantics.                          |
| `String(...)` / `Number(...)`     |           161 / 141 | Accepted individually as explicit conversions. No rule prohibits them, and syntax alone proves no absence, empty-string, zero, `NaN`, or identity-contract defect.                                                           |
| `TODO` / `FIXME` / `HACK`         |               0 / 0 | Fixed/absent in production comment trivia.                                                                                                                                                                                   |
| `eslint-disable`                  |               6 / 6 | Accepted individually in the manifest with their adjacent rule-specific rationale, including the compile-time schema assertions in `server/src/tables/columns.ts`.                                                           |
| `@ts-ignore` / `@ts-expect-error` |               4 / 4 | Four checked `@ts-expect-error` negative contracts are accepted; zero unchecked `@ts-ignore` directives remain.                                                                                                              |

## BO203–BO228 reconciliation

| Row   | Terminal disposition                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BO203 | Routed to #647: `FAKE_USER.name` still violates the repository fixture-name invariant; only its display name may change, with stable id/email and UI string consumers preserved.     |
| BO204 | Fixed in `586180aa`: throwing `matchMedia` construction now warns and takes the documented light/no-op fallback; focused resolution/subscription tests cover the boundary.           |
| BO205 | Fixed in `586180aa`: synchronous action and error-reporter throws cannot wedge the exclusion gate or escape as unhandled rejections; focused tests cover both paths.                 |
| BO206 | Superseded by the category table and exhaustive site manifest.                                                                                                                       |
| BO207 | Actionable plan block in `tasks/plan.md`; the in-memory lookup must preserve `undefined` rather than manufacture `null`.                                                             |
| BO208 | Actionable plan block; migrate the positional boolean constructor to an input object while preserving `cause`.                                                                       |
| BO209 | Actionable plan block; source names are expanded, but returned aliases and `AccountPicker` consumers still use `tz*`.                                                                |
| BO210 | Actionable plan block; remove the redundant `null` from an optional UI prop without changing route paths.                                                                            |
| BO211 | Routed to #647: the broad cross-feature barrel is structural import/ownership work with a complete consumer map requirement.                                                         |
| BO212 | Actionable plan block; inject the date into the pure allocation seed builder.                                                                                                        |
| BO213 | Actionable plan block; replace the remaining negated local boolean and invert its branches.                                                                                          |
| BO214 | Actionable plan block; align in-memory effective-week absence with `undefined` and preserve failed-lookup behavior.                                                                  |
| BO215 | Actionable plan block; separate the pure predicate from deduplicated visible diagnostics.                                                                                            |
| BO216 | Actionable plan block; rename all six `CapacitySource` operations and their implementations/consumers together.                                                                      |
| BO217 | Actionable plan block; use a positive local predicate and invert callers without moving the store boundary.                                                                          |
| BO218 | Actionable plan block; rename only the local handler, preserving the returned `onPointerDown` contract key.                                                                          |
| BO219 | Actionable plan block; rename local callbacks while preserving `on*` component prop keys.                                                                                            |
| BO220 | Actionable plan block; rename local callbacks while preserving `AllocationTargetFields` prop keys.                                                                                   |
| BO221 | Actionable plan block; returned numeric `days`/`weeks` become `dayCount`/`weekCount` with all consumers.                                                                             |
| BO222 | Actionable plan block; migrate the internal UI union discriminant and render/dispatch branches together.                                                                             |
| BO223 | Actionable plan block; expand only the local invitation-state name, never the wire `preauthEmail` field.                                                                             |
| BO224 | Actionable plan block; model directory state as a discriminated union while retaining authorized stale members on transient errors.                                                  |
| BO225 | Actionable plan block; model readiness as a discriminated union while preserving loaded snapshots and stale-effect cancellation.                                                     |
| BO226 | Split terminal decision: rename the hook/file to expand `Crud`; reject combining independent list states because no result-shape violation is established and behavior could change. |
| BO227 | Actionable plan block; inject clock/timer capabilities and preserve rollover and long-delay rearming behavior.                                                                       |
| BO228 | Accepted/nonviolating. `locked()` is a boolean-returning function whose name already reads as a state question; `isLocked` is preference, not a quoted violation.                    |

## Closure

Every #646 syntax candidate now has a stable disposition row. BO204 and BO205 are fixed; BO203 and
BO211 have explicit #647 ownership; RU001–RU220 and AS001–AS771 are deferred to complete C6 owner
blocks; BO207–BO210 and BO212–BO227 have self-contained implementation blocks; BO228 is
nonviolating. Closing the disposition issue does not claim that C6-RU or C6-AS implementation is
done, and no #645 finding is duplicated.
