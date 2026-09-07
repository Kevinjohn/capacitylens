# Code conventions: audit, debt retirement and upkeep

Status: authorised 2026-09-07 (revision 7). Audit base: `d9824dfd3d7df3006a810e7368795fda08f9bd7f`, version 0.60.1-alpha.1.
Issues: #638 (audit), #639 (debt retirement), #643 (upkeep), #645 (enforcement),
#647 (strictness and structure), #646 (boundary and error dispositions).
Previous batch (conventions page and lint baseline, PRs #640–#642) is complete; its plan is in git
history.

AGENTS.md governs everything not stated here. No build, test or CI reads this file. This plan
records the authorised programme. Each implementation batch starts after its dependency and
independently reviewed footprint are ready.

## Outcome

Every non-test file in the typed packages has been read against
`docs-src/reference/conventions.md`, each deviation is a cited row with a class and a proposal,
the rows are triaged into batches that retire the debt without touching any stable identifier,
and a standing decision says how the page and its lint baseline are kept current.

## Rules for the programme

- **Order and releases.** Milestone 1 lands C3 (#638), then bounded C4 retirement (#639), then
  one separate patch release. Milestone 2 lands C5 (#643), then one separate patch release.
  Milestone 3 lands #645 enforcement, #647 strictness/structure and final #646 dispositions,
  then one separate minor release. Derive versions from settled main: absent intervening releases,
  0.60.2-alpha.1, 0.60.3-alpha.1 and 0.61.0-alpha.1.
- **Parallel preparation.** Audit directories are disjoint and collectively exhaustive. #646 and
  overlapping #647 observations feed C3 once. Independent C4 footprints may be prepared and
  validated together; renames precede parameters, then result changes. C5 may be drafted earlier
  but lands in milestone 2. Server and app strictness preparation can overlap after shared
  contracts settle; activation remains shared, server, then app.
- **Hard exclusions, all tasks.** No change to wire fields, SQL names, routes, environment
  variables, ids, emails, test-ids, released migrations, database fixtures or exported shared and
  externally consumed contracts, except an explicitly authorised named export with complete
  consumer footprint in a reviewed batch. This applies to every class, strictness and removals.
  Keep compatibility exports, including `AuthMode`. Docker-specific work is deferred; mutation
  tests are excluded throughout this programme.
- **Tooling scope.** C3–C5 add no dependencies, scripts, lint rules or tooling. Separately scoped
  #645/#647 batches may introduce their requested rules and compiler settings after review.
- **Baseline policy.** Existing file/rule counts never increase or transfer to another file or
  rule. Each newly introduced rule may receive one independently reviewed initial baseline with
  frozen file/rule/declaration inventory and classified residual findings; it only shrinks from
  then on and is never re-enrolled. Baselines must not hide confirmed unfixed defects. Enforced
  rules with residual debt do not mean every violation has been eliminated. C4 closure concerns
  its original convention debt and confirmed incorporated findings; milestone 3 owns new-rule debt.
- **Central ownership.** One coordinator owns compiler/lint configs, suppressions, package/lock
  files, changelog, plan/audit records and generated docs. Implementation briefs state this
  exception: owners propose central changes; the coordinator integrates and prunes them.
- **Footprint is the contract.** Each batch names source, test, import, re-export, filename and
  string consumers, fixed decisions, permitted discretion, preserved guarantees and checks.
  Out-of-footprint changes require revised review. Each writer uses a fresh feature branch and
  sibling worktree from fetched main. Implementation owners return signed commits without push
  or history rewriting.
- **Stop rule.** After two failed focused fix attempts, stop that owner's attempts and obtain an
  independent diagnosis. A boundary unable to preserve a listed guarantee is reported with the
  obstacle, changed files and smallest remaining step; independent work continues.
- **Validation.** Apply the risk-based programme policy below. Focused checks accompany each
  change; full suites run at a recorded integrated milestone, not every batch or PR.
- **GitHub CI.** Every non-minor-release PR carries `[skip ci]`, including functional PRs.
  The minor release dispatches `gate.yml` and waits for success; no other pre-merge CI is
  required for this programme. Do not dispatch mutation or
  Docker workflows. Verify relevant run state and distinguish intentional skips from green checks.
  Review complete outgoing content, use DCO and normal merges, then verify issue, merge and branch
  cleanup. Merges to main remain at least five minutes apart for the alpha host.
- **Deadline.** Target 17:30 UTC / 18:30 London on 7 September 2026. Check scope/toolchain in the
  first 15 minutes; forecast within 60 minutes, at audit triage, after the first accepted gate,
  and after each batch or 30 minutes. Reserve measured validation/release time, provisionally
  90 minutes. Report an evidenced overrun and unfinished scope; never turn delay into accepted debt.

```mermaid
flowchart TD
  Prepare[Refresh, inventory and independent programme review] --> Audit[638 directory audit and rotated consumer review]
  Probe[646 and overlapping 647 observations] --> Audit
  Audit --> Rename[639 R/E package batches]
  Rename --> Parameters[639 P directory batches]
  Parameters --> Results[639 S module batches]
  Results --> Patch1[Reconcile 639 and separate patch release]
  Prepare -. available capacity .-> Upkeep[Draft 643 upkeep]
  Patch1 --> Decision[Land 643 decision]
  Upkeep --> Decision
  Decision --> Patch2[Separate patch release]
  Patch2 --> Enforcement[645 fixes, rules and reviewed initial baselines]
  Enforcement --> Shared[647 shared strictness preparation]
  Shared --> Server[Server preparation]
  Shared --> App[App preparation]
  Server --> Flags[Activate shared then server then app]
  App --> Flags
  Flags --> Structure[Structural checks and confirmed cleanup]
  Structure --> Final[Reconcile six issues and residual debt]
  Final --> Minor[Separate minor release and necessary GitHub CI]
```

## Programme validation policy — agreed 7 September 2026

This policy supersedes historical blanket full-suite instructions for this programme, including
accepted briefs and checkpoint checklists. Scope and preserved guarantees are unchanged.

| Change risk                                                              | Required local evidence                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanical naming, extraction or settled signature/result transformation | Existing affected behavior tests, applicable project typechecks, touched-directory lint, formatting and relevant size/baseline checks. Result transformations must cover absence/default and control-flow guarantees; they are not necessarily names-only. |
| Server behavior or integration                                           | The above plus relevant server checks covering affected authorization, transaction, persistence or API guarantees. Use the server gate when the affected boundary warrants that breadth.                                                                   |
| Browser behavior or frontend integration                                 | The above plus relevant browser scenarios. A frontend file change alone does not require full E2E.                                                                                                                                                         |
| Prose only                                                               | Formatting, relevant links/citations and documentation build; verify generated output. No application suites.                                                                                                                                              |
| Meaningful integrated milestone                                          | Coordinator runs `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e` once on the accepted combined tree before the milestone release, not after every small batch or PR.                                                                            |

Each packet records its risk, covered guarantees and exact commands. The stage record names the
next full-validation milestone. Reviewers inspect evidence without rerunning passed checks by
default. Broaden checks only for an uncovered guarantee, relevant change, failure or unresolved
integration risk. After corrections, refresh affected evidence rather than automatically restarting
all suites. Record the tested commit/tree: a full pass does not certify later changes. After a full
milestone pass, changed code needs affected checks and a recorded assessment of whether to repeat
full validation. Do not add tests that merely mirror mechanical edits.

Use pnpm and Node >=24; only one E2E process at a time. No Stryker/mutation suites, Docker checks
or routine cross-browser runs. GitHub CI and merge spacing are separate; non-minor PRs retain
`[skip ci]`. Implementation remains paused until a stage is selected.

## Independent execution of accepted batches

The implementation programme remains paused at the saved checkpoint until the next bounded
stage is selected. Updating this plan does not start a code stage. Preserve the six issues,
three release boundaries, exclusions and validation requirements above.

- **Use settled decisions.** An accepted batch specifies the transformation and its complete
  consumer footprint. Implement that decision; do not repeat the design exercise. An independent
  review verifies the complete diff against the decision and preserved guarantees. One accepted
  review is sufficient; another review is warranted only by changed code, an unresolved finding
  or a required external policy.
- **Make each handoff self-contained.** Supply the task and row ids, accepted brief, exact base,
  branch and worktree, prerequisites, editable and verification-only paths, fixed decisions,
  permitted discretion, invariants and exact check commands. Include central-file proposals as
  handoff requirements. Do not dispatch an incomplete packet or make its owner reconstruct the
  programme history. Historical line numbers are hints; verify symbols on the assigned base.
- **Keep context local.** Start each independent assignment from its packet and applicable
  repository instructions. Read its relevant sources and complete diff, not unrelated batches,
  logs or audit inventories. Store large caller maps as reference data; inspect the relevant
  entries rather than duplicating them in narrative reports.
- **Prove independence before parallel work.** Compare every source, test, fixture, generated
  file and central-file write footprint, plus dependency contracts. Sharing a read-only file is
  permitted. Shared writes or a producer/consumer contract change are sequenced unless combined
  into one reviewed assignment. Never divide an inseparable signature migration between writers.
  Each writer has its own worktree and command working directory. The coordinator integrates
  prerequisites before assigning the pinned base; owners never merge other branches themselves.
- **Use a bounded stage.** Select a small ready set and record its deliverable and stopping
  condition. Owners perform only their assigned work and checks. Stop at that checkpoint for
  stage selection; a completed owner does not start the next task automatically. During the
  stage, routine permitted implementation choices need no additional approval.
- **Keep verification proportional.** Apply the programme validation policy above. Use symbol/reference checks and
  verified transformation comparisons for repetitive mappings; neither syntax equality nor
  typechecking replaces meaningful behavior checks. Do not add tests that merely mirror a
  mechanical edit. Fix a genuine coverage gap within a reviewed footprint. Report the specific
  uncertainty when checks cannot establish a guarantee.
- **Escalate evidence, not labels.** A directory name or convention class alone does not require
  another design review. Escalate changed public contracts, ambiguous absence behavior, unresolved
  authorization or transaction ordering, incomplete consumers, an invalid intermediate state,
  or two failed focused fix attempts. Provide the exact error and smallest disputed code span;
  independent assignments continue. The coordinator may resolve a demonstrated, bounded footprint
  omission and record it without reopening settled decisions or weakening assertions.
- **Return a compact result.** Report DONE or BLOCKED, the signed commit and base, changed files,
  checks and outcomes, new versus moved tests, deviations, and central handoff items. Keep detailed
  logs as artifacts. The coordinator reviews the exact committed head, integrates accepted work,
  applies central changes and runs risk-selected checks; full gates belong to the recorded milestone. Failed or unreviewed work is never
  labelled ready for merge.

```mermaid
flowchart TD
  Select[Select bounded ready stage] --> Check[Verify prerequisites and complete write footprints]
  Check --> A[Independent packet and worktree A]
  Check --> B[Independent packet and worktree B]
  A --> AC[Focused checks and signed commit]
  B --> BC[Focused checks and signed commit]
  AC --> Review[Independent complete diff review]
  BC --> Review
  Review -->|accepted| Integrate[Coordinator integrates and applies central changes]
  Review -->|specific unresolved finding| Resolve[Resolve the bounded question]
  Resolve --> Recheck[Owner applies correction and focused checks]
  Recheck --> Review
  Integrate --> Gates[Risk-selected checks; full suites at milestone]
  Gates --> Delivery[Authorised delivery and exact state verification]
  Delivery --> Stop[Record checkpoint and stop before next stage]
```

## Batch briefs

### C3 — Audit (#638)

**Facts.** The lint scope is `src/**`, `shared/src/**`, `server/src/**` and `server/scripts/**`
(`eslint.config.js`, conventions block). The ownership table in
`docs-src/reference/development.md:227–236` names ten owner areas, but leaves out directories
that hold much of the code: `src/lib` (38 non-test files), `src/components` outside the scheduler
(13 at the top level plus feature subdirectories), `src/hooks`, `server/src` at its root (49) and
`server/scripts`. So the audit unit is the directory, not the ownership row. Baseline at
e07278b8 (`eslint-suppressions.json`): `max-params` 252 (server/src 144, src/components 41,
src/lib 27, shared/src 20, src/data 10, other 10) and `naming-convention` 15 (ten `COLS_<table>`
constants in `server/src/tables/columns.ts`, one PascalCase `let` in a test, four negated names).
Known deviations recorded on the page: `ensureInternalClients` twice with different contracts,
`validateAuthUser` (a parse with a flag parameter), the four `validate*` return shapes,
`ensureBarColors`, `getRow` returning `undefined`, `isUnavailable` with four positional
parameters and `Status` naming. Surveys at 3bb01646 also found one
exported `find*` (`findUserIdsByEmail`, `server/src/auth.ts:192`), four `handle*` names in
`src/`, and `resolveTheme(pref)` outside the abbreviation list. `tasks/plan-consensus.md` and
`tasks/plan-review.md` are leftovers of maintainability batch 2, whose plan is in git history.

**Fixed decisions.**

- Output is one file, `tasks/conventions-audit.md`, landed by its own docs-only pull request. It
  holds one table per directory with the columns `file:line` (at the audit base SHA), `symbol`,
  `rule` (the page section and bullet), `class`, `proposal` (the new name or signature), and
  `consumers` (every importer, re-export path, owning filename that must follow a principal
  rename per `development.md:161–168`, test file and string pin that the change touches). A
  symbol with two deviations gets two rows, one per rule (`validateAuthUser`: rename and flag
  parameter).
- Classes: `R` rename within one file; `E` rename of an export with callers in other files; `P`
  parameter shape (positional list to options type); `S` result shape (return type changes);
  `X` excluded by the hard exclusions, with the identifier named; `D` accepted debt, with the
  reason. Every row has exactly one class.
- Scope: every non-test file in the actual conventions globs and ignores in `eslint.config.js`: app
  TS/TSX, server source/operator TS, and shared TS/TSX/MTS/CTS. Record every read file, including
  zero-finding files. The four JavaScript operator scripts have separate context coverage outside
  the typed conventions block. Tests are not audited for prose rules; test files
  appear only through the `consumers` column and through baseline entries. Every
  `eslint-suppressions.json` entry, including entries in test files, is resolved to its
  declarations (the baseline records only file, rule and count) and each declaration gets its own
  classified row: a suppressed name is `R`, `E` or `X` on its own merits (`notInAccount` in
  `shared/src/domain/tenancy.ts:25` is a package export, so `E` or `X`, never `R`), a suppressed
  parameter list is `P`, `X` or `D`.
- Every row cites a line at the base SHA and quotes the rule it breaks. A row without a rule is
  not a finding. The page is not changed by the audit; a rule the audit finds unworkable becomes
  a `D` row with the reason and a note for C5.
- Development/import/TSDoc observations outside the six convention classes have a separate
  disposition ledger: actionable with an owning issue, nonviolating with evidence, or outside
  scope with the boundary named. A taxonomy gap alone is never accepted debt.
- The audit changes no code and proposes nothing on stable identifiers beyond an `X` row.
- Triage is part of C3: the file ends with the C4 batch list, each batch naming its class, its
  directories, its row count and its focused tests.
- The two leftover batch-2 files in `tasks/` are deleted in the same pull request.

**Permitted discretion.** How directories are grouped into tables; row order; proposal wording;
whether one directory with under five rows is folded into its parent's table.

**Files.** `tasks/conventions-audit.md` (new), `tasks/plan-consensus.md` and
`tasks/plan-review.md` (deleted), `tasks/plan.md` (completion record).

**Focused tests.** `pnpm exec prettier --check tasks/conventions-audit.md`; ten randomly chosen
rows resolve at the base SHA (`git show <sha>:<file> | sed -n <line>p`).

**Done.** Audit merged; a comment on #638 gives the row count per class and links the merge; the
C4 batch list is in the file.

### C4 — Debt retirement (#639)

**Facts.** `docs-src/reference/development.md:179–180` requires explicit compatibility exceptions
for package exports and externally consumed symbols; AGENTS.md "Naming and module contracts"
says naming changes never alter wire fields, stable identifiers or released migrations. ESLint
prunes the baseline with `pnpm exec eslint . --prune-suppressions`; an unpruned entry fails
`pnpm run lint`. Renames of exported symbols ripple into tests and, for `shared/`, into both
`src/` and `server/`; a principal rename moves its owning filename and test filename
(`development.md:161–168`). `P` rows on package exports exist (`rangesOverlap`,
`shared/src/lib/dateMath.ts:122`, four positional parameters, called with that signature in
`dateMath.test.ts:111–118`), so `P` changes call expressions in tests as well as sources. A
result-shape change (`S`) changes every caller's control flow.

**Fixed decisions.**

- Batches run in class order, each on its own branch and worktree: `R` and `E` renames grouped
  by package (`shared/`, `src/`, `server/`; at most one pull request per package per batch), then
  `P` grouped by directory, then `S` one module per pull request. A required principal-file
  rename that would otherwise transfer existing parameter suppressions is an inseparable `E+P`
  exception: retire every old-file suppression in the same reviewed batch before moving the file,
  with no new-path entry. Cohesive collections retain their capability filenames; this exception
  never creates a reason to move them. A rename inseparable from a result representation stays
  with that result-owning module (B677/B759). Connected callback or authorizer interfaces and
  implementations form one signature batch under their common parent directory; directory
  boundaries never create an invalid intermediate contract.
- Each batch is briefed from the audit rows it takes, and the brief is reviewed adversarially
  before implementation, as for any plan. The brief lists every file the rows touch plus the
  tests that reference the renamed symbols, and names the focused tests.
- The coordinator prunes `eslint-suppressions.json` for each integrated batch; C4 adds no entry. A
  batch that would need a new entry stops.
- Any row of any class that changes a `@capacitylens/shared` export or another externally
  consumed symbol proceeds only when the batch block in this plan records the authorisation for
  that symbol by name together with its complete consumer footprint from the audit's `consumers`
  column; otherwise the row becomes `X` and its baseline entry stays.
- Behaviour is preserved in `R`, `E` and `P` batches: every existing assertion keeps its
  guarantee. Tests may change mechanically to follow the change (renamed identifiers and
  imports, renamed test files, call expressions rewritten to the options type, mock and
  assertion references, string pins), and nothing else. Where a renamed symbol is a returned or
  shorthand object key that is also a wire or contract key, the key keeps its name through a
  local alias. Predicate renames keep their polarity. An `S` batch keeps every existing
  assertion's guarantee and labels any test as moved or new.
- `D` rows are not touched; they stay in the audit file with their reason.

**Permitted discretion.** Batch boundaries within a class; the order of modules inside a batch;
local helper placement where an options type is introduced.

**Files.** Per batch, listed in its brief. The selected batch packet records its exact base and consumer footprint; completed historical blocks are not instructions to repeat work.

**Focused tests.** Per batch, listed in its brief; each packet names touched-directory lint and required baseline verification.

**Done.** Every `R`, `E`, `P` and `S` row is either landed or reclassified `D` or `X` with a
reason; the baseline holds only the entries of `D` and `X` rows; #639 closed with the merge links.

### C5 — Upkeep (going forward)

**Facts.** In place at e07278b8: `AGENTS.md` "Naming and module contracts" points at the page;
`CONTRIBUTING.md:59` says review checks names, parameters and result shapes against it;
`DECISIONS.md:334–339` names the page beside the development guide; the page's "What lint
enforces" section documents the baseline and the prune command. Not in place: a standing decision
that says the baseline only shrinks, how a new verb or shape enters the page, and where debt that
a batch declines to fix is recorded.

**Fixed decisions.**

- One bullet group added under `DECISIONS.md` "Maintainable module boundaries", after the bullet
  at lines 334–339:
  - Existing `eslint-suppressions.json` file/rule counts only shrink. A change prunes what it
    can and never increases existing counts; new code meets the rules. A newly introduced rule
    may have one reviewed initial baseline with classified residual findings, then only shrinks,
    as specified in the programme policy above.
  - A new verb, abbreviation or result shape enters the page in the same pull request as its
    first use, with a tree example, and is reviewed like code.
  - Debt a batch declines to fix is recorded in `tasks/conventions-audit.md` as `D` with a reason,
    never dropped; the audit issue, which the page names as the place to note untouched
    deviations, links to that record.
- No other file changes. The page itself is not edited by C5.

**Permitted discretion.** Wording.

**Files.** `DECISIONS.md`.

**Focused tests.** `pnpm exec prettier --check DECISIONS.md`.

**Done.** Decision merged; #643 closed with the merge link.

## Milestone 3 acceptance

#645 records exact rules, options and production/test scope; preserves deprecated compatibility
exports while migrating internal consumers; fixes near-zero findings without baseline entries;
resolves unnecessary assertions and boolean comparisons; and classifies the five larger smell
families with meaningful absence/default/error tests. Confirmed defects are fixed before enrollment.
The frozen declaration-level inventory and classifications are governed by
[`tasks/conventions-enforcement-baseline.md`](conventions-enforcement-baseline.md).

#647 maps both `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` through
`tsconfig.app.json`, `tsconfig.node.json`, inherited `tsconfig.e2e.json`, `shared/tsconfig.json`,
inherited `shared/tsconfig.test.json` and `server/tsconfig.json`; root references are verified too.
Prepare both flags together within each owned file, preserve public contracts and explicitly test
empty collections, missing records, zero, empty strings, null/undefined, authority and transactions.
No blanket non-null assertions, speculative defaults or type widening to silence diagnostics.
Update `docs-src/reference/conventions.md` with the adopted rules and initial-baseline policy,
then rebuild and commit generated docs. Measure function length, complexity and nesting across
production and tests in `src`, `shared/src`, `server/src` and `server/scripts`, plus E2E scenarios
in `e2e`; review exact settings and the one initial residual baseline in
[`tasks/strictness-structure-baseline.md`](strictness-structure-baseline.md) against standing tooling
decisions. Verify dynamic/string consumers before dead-export removal, and record justified
duplication/removal dispositions.

#646 closes only after every candidate category has a verified disposition. A generic error or
unknown record is not itself a defect: quote the violated rule, respect the conventions page's
deferral to `DEFENSIVE-CODING.md`, and retain nonviolating observations with reasons.

### #646 stable implementation blocks

These blocks turn BO207–BO210 and BO212–BO227 into bounded future work. They are not authority to
change stable wire, route, database, or package contracts. BO203 and BO211 remain assigned to #647;
BO204 and BO205 are fixed; BO206 is the site ledger; BO228 is accepted/nonviolating.

#### C6-RU — Review every unknown-record boundary

**Facts.** `tasks/conventions-disposition-sites.md` pins RU001–RU220: 220
`Record<string, unknown>` occurrences on 196 source lines across 68 production files. The type is
valid for genuinely dynamic or untrusted keyed data only when each value is narrowed before domain
use. Its syntax proves neither that narrowing occurs nor that the bag leaks beyond its boundary.

**Fixed decisions.** Review every RU row in its containing declaration and trace its producers and
consumers. Accept a row only with recorded evidence that keys are genuinely dynamic or input is
untrusted, reads are checked before typed use, and the bag does not replace a stable known shape.
Replace a row with a named interface, mapped type, schema-derived type, or local narrow type when
keys are fixed. Repair any unchecked read at the boundary; never use an assertion, placeholder
default, or wider `unknown`/`any` type to silence it. Preserve wire fields and sanitisation,
authorization, absence, atomicity, and error-surfacing contracts.

**Files.** Exactly the 68 files named by RU001–RU220 in
`tasks/conventions-disposition-sites.md`; tests may be added or changed only beside a row whose
classification requires behavior repair. The manifest and this plan are the central records.

**Tests.** For each changed row, run its nearest parser/sanitiser/API/storage tests with meaningful
untrusted values, missing keys, wrong primitive/container types, empty strings, zero, and `null` or
`undefined` as applicable. Run the affected package typecheck, lint every touched directory with
zero warnings, Prettier, and the manifest reconciliation. Add server authorization/transaction or
browser tests when that row crosses those boundaries.

**Done.** All RU001–RU220 rows record either (a) accepted boundary evidence naming the validating
read and bounded consumer, or (b) a landed repair with focused evidence. No row disappears, remains
generically deferred, or is accepted because the syntax is common; occurrence and line totals are
regenerated at the accepted evidence SHA.

#### C6-AS — Review every production type assertion

**Facts.** The manifest pins AS001–AS771: 771 `AsExpression` occurrences on 691 operator lines
across 223 production files. #645's `no-unnecessary-type-assertion` rule detects a mechanical subset;
a clean lint result does not establish runtime soundness, especially for assertions over network,
storage, database, environment, parsed JSON, or other untrusted values.

**Fixed decisions.** Review each AS row from asserted expression through its source validation and
downstream use. Remove assertions when control-flow narrowing, a generic constraint, or a precise
return type can express the fact. Retain one only when a named prior validator/sanitiser proves it or
an external-library interoperability contract cannot be represented more precisely; record that
evidence per row. An `as unknown as`, non-null substitute, or widened type is never an acceptable
repair. Any untrusted-boundary assertion without prior validation is fixed at that boundary and
must follow `DEFENSIVE-CODING.md` error surfacing.

**Files.** Exactly the 223 files named by AS001–AS771 in
`tasks/conventions-disposition-sites.md`; tests change only where removal or boundary repair affects
a runtime guarantee. The manifest and this plan are the central records.

**Tests.** Run the enrolled assertion rule and affected package typechecks after each bounded group.
For behavior changes, run nearest tests covering malformed input, absence, empty values, zero, and
error paths; add server authorization/transaction or browser coverage when applicable. Run lint for
every touched directory with zero warnings, Prettier, and manifest reconciliation.

**Done.** Every AS001–AS771 row records its validator/interoperability evidence or is removed by a
verified change. The typed assertion probe is clean, no replacement assertion or broadening hides a
diagnostic, and regenerated occurrence/line totals match the accepted evidence tree.

#### BO207 — Preserve in-memory lookup absence

**Facts.** `AppShell` converts the combined two-source `Array.find` miss to `null`. The value is
consumed by the `AppEntryGate` check `activeAccount !== null` and by the nullable `AppSidebar`
`activeAccount` prop, which guards account-name rendering.

**Fixed decisions.** Remove the terminal `?? null`, change the tenant-gate check to
`activeAccount !== undefined`, and change `AppSidebarProps.activeAccount` to
`{ name: string } | undefined`. Preserve the account-summaries pick-gap fallback, sidebar conditional
rendering, access copy, and route behavior. **Files.** `src/components/AppShell.tsx`,
`src/components/AppShell.test.tsx`, `src/components/AppSidebar.tsx`. **Tests.** `pnpm exec vitest run
src/components/AppShell.test.tsx`; app typecheck, lint for the three files, formatter. **Done.** Both
exact null consumers use `undefined`, missing active account still blocks the app, summary fallback
still opens it, and sidebar/account copy is unchanged.

#### BO208 — Name the storage reset error input

**Facts.** `StorageResetError(offlineDataCleared, options)` carries a positional boolean and wraps an
aggregate cause. **Fixed decisions.** Introduce `StorageResetErrorInput` with
`offlineDataCleared` and `cause`; preserve the error name/message, readonly property, and native
cause chain. **Files.** `src/components/StorageRecovery.tsx`,
`src/components/StorageRecovery.test.tsx`. **Tests.** `pnpm exec vitest run
src/components/StorageRecovery.test.tsx`; app typecheck, file lint, formatter. **Done.** Every
constructor call uses named fields and partial/full reset failures expose the same information.

#### BO209 — Expand time-zone option names

**Facts.** `useCreateAccountForm` now uses `timeZoneOptions` internally but still returns
`tzSelectOptions`; `AccountPicker` consumes that alias. **Fixed decisions.** Rename the returned and
destructured property to `timeZoneSelectOptions`; do not change account wire field `timezone` or
stored values. **Files.** `src/components/accounts/useCreateAccountForm.ts`,
`src/components/accounts/AccountPicker.tsx`, `src/components/accounts/AccountPicker.test.tsx`.
**Tests.** `pnpm exec vitest run src/components/accounts/AccountPicker.test.tsx`; app typecheck,
file lint, formatter. **Done.** No `tzOptions`/`tzSelectOptions` identifier remains and picker labels,
values, and submission payloads are unchanged.

#### BO210 — Use optional activity selection absence

**Facts.** `ActivityList` declares an optional prop as `string | null` and defaults it to `null`;
`router.tsx` supplies the route-derived selection. **Fixed decisions.** Use
`selectedActivityId?: string`, omit absence at the route boundary, and preserve every route path,
focus rule, and `aria-current` result. **Files.** `src/components/activities/ActivityList.tsx`,
`src/components/activities/ActivityList.test.tsx`, `src/router.tsx`. **Tests.** `pnpm exec vitest run
src/components/activities/ActivityList.test.tsx`; app typecheck, file lint, formatter. **Done.** An
absent route selection is `undefined`, while matching selection still focuses and identifies its row.

#### BO212 — Inject the allocation seed date

**Facts.** `buildAllocationModalSeed` is otherwise pure but calls `todayISO(calendarTimeZone)`;
`useAllocationModalState` owns its invocation. **Fixed decisions.** Add `today: ISODate` to the seed
input and compute it at the hook boundary; preserve edit/create precedence and timezone semantics.
**Files.** `src/components/scheduler/buildAllocationModalSeed.ts`,
`src/components/scheduler/useAllocationModalState.ts`,
`src/components/scheduler/AllocationModal.test.tsx`. **Tests.** `pnpm exec vitest run
src/components/scheduler/AllocationModal.test.tsx`; app typecheck, scheduler lint, formatter.
**Done.** The seed builder reads no clock and deterministic tests cover create-without-date and edit
precedence.

#### BO213 — Remove the negated effective-days name

**Facts.** `buildAllocationModalSeed` still declares `initialHasNoEffectiveDays` and uses it in one
branch. **Fixed decisions.** Rename it to `initialHasEffectiveDays`, invert the predicate and branch,
and preserve the neutral one-day seed for impossible working spans. **Files.**
`src/components/scheduler/buildAllocationModalSeed.ts`,
`src/components/scheduler/AllocationModal.test.tsx`. **Tests.** The BO212 focused test command plus
app typecheck, scheduler lint, formatter. **Done.** No negated identifier remains and zero-effective-
day inputs retain their current neutral seed.

#### BO214 — Align effective-week absence

**Facts.** `AllocationModalSnapshot.selectedEffectiveWeek` is an in-memory lookup/derivation but uses
`null`; six scheduler modules consume it. **Fixed decisions.** Change only this internal field to
`EffectiveWorkingWeek | undefined`; preserve the distinction between no selected resource and an
unusable effective week, and add no speculative default. **Files.**
`src/components/scheduler/allocationModalSnapshot.ts`, `allocationSubmit.ts`,
`buildAllocationAdvisory.ts`, `buildRepeatProjection.ts`, `useAllocationModalState.ts`,
`useAllocationScheduleState.ts`, and `AllocationModal.test.tsx` in the same directory. **Tests.**
`pnpm exec vitest run src/components/scheduler/AllocationModal.test.tsx`; app typecheck, scheduler
lint, formatter. **Done.** All producers/consumers compile with `undefined` absence and missing versus
invalid selections retain existing validation/error behavior.

#### BO215 — Separate scheduler validation from reporting

**Facts.** `hasRenderableDateRange` returns a boolean but mutates a `WeakSet` and logs; callers live in
three scheduler model modules. **Fixed decisions.** Keep a pure boolean predicate and move the
once-per-row `console.error` reporting to an explicitly named caller-owned helper; retain WeakSet
deduplication and omission of corrupt rows. **Files.**
`src/components/scheduler/schedulerModelIndexing.ts`, `schedulerModel.ts`,
`schedulerRowModel.ts`, `schedulerModel.test.ts`. **Tests.** `pnpm exec vitest run
src/components/scheduler/schedulerModel.test.ts`; app typecheck, scheduler lint, formatter.
**Done.** Predicate evaluation has no side effect, each stable invalid row is reported once, and no
invalid range reaches indexing.

#### BO216 — Give `CapacitySource` methods operation verbs

**Facts.** Six methods on the internal `CapacitySource` interface omit operation verbs and are
implemented/consumed across four scheduler model files. **Fixed decisions.** Rename them together to
`listTimeOffOn`, `getCapacityOnDay`, `getAllocationCountOn`, `getTimeOffCountOn`,
`resolveUtilizationOver`, and `isOverOn`; preserve tracked-resource starvation and calculations.
**Files.** `src/components/scheduler/schedulerModelTypes.ts`, `schedulerModel.ts`,
`schedulerRowCapacity.ts`, `schedulerRowModel.ts`, `schedulerModel.test.ts`. **Tests.** The BO215
focused test command; app typecheck, scheduler lint, formatter. **Done.** Old method keys have no
consumers and model outputs remain equal for tracked and external resources.

#### BO217 — Make the gesture predicate positive

**Facts.** `lacksEffectiveDaysFor` is local to `useAllocationGesture` and reads store state.
**Fixed decisions.** Rename it to `hasEffectiveDaysFor`, invert every local caller, and retain the
store dependency and weekend/calendar rules. **Files.**
`src/components/scheduler/useAllocationGesture.ts`, `AllocationBar.interaction.test.tsx`,
`SchedulerGrid.drawGate.test.tsx`. **Tests.** `pnpm exec vitest run
src/components/scheduler/AllocationBar.interaction.test.tsx
src/components/scheduler/SchedulerGrid.drawGate.test.tsx`; app typecheck, scheduler lint, formatter.
**Done.** Gesture acceptance/rejection is unchanged for working-day, weekend, and no-effective-day
cases.

#### BO218 — Name the local pointer action

**Facts.** `useAllocationGesture` has a local `onPointerDown` handler and returns an
`onPointerDown` contract key. **Fixed decisions.** Rename only the local function to
`beginPointerGesture`; retain the returned key and component prop contract. **Files.**
`src/components/scheduler/useAllocationGesture.ts`, `AllocationBar.tsx`,
`ResourceLane.tsx`, `AllocationBar.interaction.test.tsx`. **Tests.** `pnpm exec vitest run
src/components/scheduler/AllocationBar.interaction.test.tsx`; app typecheck, scheduler lint,
formatter. **Done.** The local action name follows the verb rule and pointer capture/drag behavior is
unchanged.

#### BO219 — Name allocation schedule actions

**Facts.** Local callbacks `onRepeatChange` and `onRepeatUntilChange` are returned into
`AllocationScheduleFields` props. **Fixed decisions.** Rename locals to `changeRepeat` and
`changeRepeatUntil`, retaining the component's `on*` prop keys and repeat validation behavior.
**Files.** `src/components/scheduler/useAllocationScheduleState.ts`,
`AllocationScheduleFields.tsx`, `AllocationModal.test.tsx`. **Tests.** `pnpm exec vitest run
src/components/scheduler/AllocationModal.test.tsx`; app typecheck, scheduler lint, formatter.
**Done.** Local callbacks use action verbs and repeat/until updates remain behaviorally identical.

#### BO220 — Name allocation target actions

**Facts.** Local `onAssigneeChange` and `onAddActivity` still feed `AllocationTargetFields`;
`changeProject` is already expanded and is returned under the `onProjectChange` prop key.
**Fixed decisions.** Rename the remaining locals to `changeAssignee` and `addInlineActivity`;
preserve caller-facing `on*` prop keys, placeholder constraints, and selection reset order.
**Files.** `src/components/scheduler/useAllocationTargetState.ts`,
`AllocationTargetFields.tsx`, `AllocationModal.test.tsx`. **Tests.** The BO219 focused test command;
app typecheck, scheduler lint, formatter. **Done.** Local names follow action verbs and all target
selection effects remain unchanged.

#### BO221 — Name visible-span counts

**Facts.** `buildRealizedVisibleSpan` returns numeric `days` and optional `weeks`; its only result-
shape consumer is `buildVisibleSpanLabels` in the same file, and the focused test asserts both
shapes. **Fixed decisions.** Rename only those returned keys to `dayCount` and `weekCount`; preserve
label text and inclusive-date arithmetic. **Files.** `src/components/scheduler/visibleSpan.ts`,
`src/components/scheduler/visibleSpan.test.ts`. **Tests.** `pnpm exec vitest run
src/components/scheduler/visibleSpan.test.ts`; app typecheck, lint the two files, formatter.
**Done.** The old result keys have no occurrence in `visibleSpan.ts`, the focused shape expectations
use count names, and every label/date-span assertion remains unchanged in meaning.

#### BO222 — Use `kind` for member confirmation state

**Facts.** Internal `MemberConfirmation` is a multi-variant UI union discriminated by `action` and
rendered/dispatched through four settings modules. **Fixed decisions.** Rename only the discriminant
to `kind`; retain variant payloads, copy, confirmation ordering, and server action selection.
**Files.** `src/components/settings/memberConfirmationCopy.ts`, `MemberConfirmations.tsx`,
`MemberRow.tsx`, `MembersSection.tsx`, `useMembersOrchestration.ts`, `MembersSection.test.tsx`.
**Tests.** `pnpm exec vitest run src/components/settings/MembersSection.test.tsx`; app typecheck,
settings lint, formatter. **Done.** Every branch switches on `kind` and all confirmation outcomes and
copy remain unchanged.

#### BO223 — Expand invitation state name

**Facts.** Local state `invitePreauth` crosses `useMemberInvites`, `MembersSection`, and
`InviteMemberPanel`; server wire field `preauthEmail` is stable. **Fixed decisions.** Rename the local
state/property to `invitationPreauthorizedEmail`; never rename the request/response wire field.
**Files.** `src/components/settings/useMemberInvites.ts`, `MembersSection.tsx`,
`InviteMemberPanel.tsx`, `MembersSection.test.tsx`. **Tests.** The BO222 focused test command; app
typecheck, settings lint, formatter. **Done.** No local abbreviated identifier remains and emitted
payloads still use `preauthEmail`.

#### BO224 — Model team-directory state explicitly

**Facts.** `useTeamDirectory` combines a gate and nullable members; reconciliation/readiness
consumers rely on retaining authorized members during transient errors. **Fixed decisions.** Replace
the coupled fields with a `kind` union whose variants encode hidden/loading/ready/error; the error
variant retains the last authorized member snapshot. **Files.**
`src/components/settings/useTeamDirectory.ts`, `createMemberAccessReconciliation.ts`,
`useMembersOrchestration.ts`, `useWorkspaceReadiness.ts`, `MembersSection.test.tsx`.
**Tests.** `pnpm exec vitest run src/components/settings/MembersSection.test.tsx`; app typecheck,
settings lint, formatter. **Done.** Impossible combinations are unrepresentable and permission loss
still clears data while transient failure preserves authorized stale data.

#### BO225 — Model workspace readiness explicitly

**Facts.** `useWorkspaceReadiness` stores readiness and error separately; its effect cleanup uses a
`cancelled` guard to stop stale async completions. **Fixed decisions.** Replace the pair with a
`kind` union while preserving the loaded snapshot contract, cancellation ordering, and retry
behavior. **Files.** `src/components/settings/useWorkspaceReadiness.ts`,
`useMembersOrchestration.ts`, `MembersSection.test.tsx`. **Tests.** The BO224 focused test command;
app typecheck, settings lint, formatter. **Done.** No impossible readiness/error state exists and
stale completions remain unable to overwrite the current effect.

#### BO226 — Expand the CRUD hook name only

**Facts.** `useCrudListState` is imported by seven list modules; its three independent state values
do not constitute a multi-outcome result. **Fixed decisions.** Rename the hook/file to
`useEntityListState` and update imports only. Reject combining create/edit/confirmation state:
no quoted result-shape rule requires it and combination could remove currently representable UI
behavior. **Files.** `src/hooks/useCrudListState.ts` → `src/hooks/useEntityListState.ts`;
`src/components/activities/ActivityList.tsx`, `clients/ClientList.tsx`,
`disciplines/DisciplineList.tsx`, `projects/ProjectList.tsx`, `resources/ResourceList.tsx`,
`timeoff/CompanyClosureSection.tsx`, `timeoff/TimeOffList.tsx`, plus
`src/components/activities/ActivityList.test.tsx`. **Tests.** `pnpm exec vitest run
src/components/activities/ActivityList.test.tsx`; app typecheck, hooks/list lint, formatter.
**Done.** No `Crud` identifier/path remains and the returned state shape and list behavior are
unchanged.

#### BO227 — Inject deadline-clock capabilities

**Facts.** `useDeadlineClock` directly reads `Date.now` and uses window timers; its tests already
exercise rollover and timeout clamping, and two settings consumers supply deadline selection.
**Fixed decisions.** Add a named input containing `pickNextDeadline` and `readNow`, with `Date.now`
as the production clock; retain browser timer ownership, `+1` boundary behavior,
`MAX_TIMEOUT_DELAY` rearming, and cleanup. **Files.**
`src/hooks/useDeadlineClock.ts`, `src/hooks/useDeadlineClock.test.tsx`,
`src/components/settings/ArchivedSection.tsx`, `useMembersOrchestration.ts`,
`ArchivedSection.test.tsx`, `MembersSection.test.tsx`. **Tests.** `pnpm exec vitest run
src/hooks/useDeadlineClock.test.tsx src/components/settings/ArchivedSection.test.tsx
src/components/settings/MembersSection.test.tsx`; app typecheck, hooks/settings lint, formatter.
**Done.** Tests use the injected clock and prove exact-boundary, early-fire, long-delay rearm, and
cleanup behavior without changing production scheduling.

## Completion record

- [x] Remote main and six issue states refreshed at the audit base; Node 24.19.0 and pnpm 11.4.0 available.
- [x] Deadline confirmed: 17:30 UTC / 18:30 London.
- [x] Revised programme independently reviewed; dependency, baseline, export and compiler scope corrections incorporated.
- [x] Exact audit coverage reconciled: 602 typed files, four operator context files and all 267 original suppression declarations. Independent consumer/classification reviews incorporated.
- [x] Audit delivery checks: independent assembly review accepted; ten randomly chosen source citations resolve at the base; Prettier and documentation build pass with generated docs unchanged.
- [x] #638 audit merged in PR #648 (`66eb8a9b`); issue closed and branch cleanup verified: 2,016 rows (R 1,102; E 361; P 276; S 34; X 101; D 142), with 72 triaged groups requiring bounded implementation briefs.
- [x] #639 original actionable rows retired or justified D/X; closure evidence reviewed. At
      integrated head `7f5e96a3eddd98333bb88d2314505f397c9da084`, the reviewed C4 heads account for
      1,772 implemented actionable rows plus B734 reclassified to X. Final classes are R 1,102 / E
      360 / P 276 / S 34 / X 102 / D 142 (2,016 total); the X-only suppression baseline is 16
      declarations. C4-01–C4-72 reviewed implementation heads and their merge ancestry were checked
      against the integrated tree, with no remaining actionable group or unresolved exclusion.
- [ ] First separate patch release merged and verified.
- [ ] #643 upkeep decision merged and closed.
- [ ] Second separate patch release merged and verified.
- [x] #645 exact enforcement, fixes and initial residual baselines verified. Internal `AuthMode`
      consumers use `AccountMode` while compatibility exports remain; unnecessary assertions and
      every zero-baseline family are clean. The reviewed declaration ledger accounts for all 1,734
      residual suppressions in the seven authorised smell families.
- [x] #647 all intended flags, structural rules and cleanup dispositions verified. Both compiler
      flags are enabled and pass with zero diagnostics in app, Node, E2E, shared production/test and
      server projects.
      Structural enrollment is verified at `6a9cf77480a34cb4f3c3429bae48561af90b7948`: the frozen
      baseline contains 158 complexity, 59 depth and 694 length declarations, including 42 E2E length
      declarations, and exactly matches `eslint-suppressions.json`. The three byte-identical cached
      statement helpers remain local to account-state, audit-outbox and control-table owners because
      centralising the small closure would couple those layers for negligible reuse. The sole confirmed
      dead declaration, `buildOperationReceipt`, and its stale JSDoc consumer were removed in the
      reviewed integrated tree; the other exact-body groups have explicit retain/defer dispositions.
- [x] #646 all categories reconciled without duplicate findings. The exhaustive AST-backed site
      manifest and terminal ledger are pinned to `05fef1cf`; RU001–RU220 and AS001–AS771 are
      explicitly deferred to complete C6 owner blocks rather than asserted sound, BO204/BO205 are
      fixed, BO203/BO211 have explicit #647 owners, BO207–BO210 and BO212–BO227 have complete
      stable-ID blocks, and BO228 is accepted with a quoted-rule analysis.
- [ ] Complete final review and required local gates pass on the accepted tree.
- [ ] Separate minor release passes necessary GitHub CI and is verified after merge.
- [ ] Actual finish, residual debt and any unmet criteria recorded.

## Selected retirement batches

### Shared package names — #639

Status: implementation committed at `d0de79d8`; independent complete diff review accepted. Audit group C4-02; 137 R/E rows. Full integrated validation belongs to the recorded milestone under the current policy.

Fixed decisions: names only; public X contracts, persisted keys, positional signatures, result shapes and released migrations remain unchanged. Use `parseSchemaVersion` and `resolveArray` for A096/A098. Existing local comment references follow renamed bindings. All aliases preserve original object keys.

Files: `shared/src/data/internalClient.ts`, `shared/src/data/migrate.ts`, `shared/src/data/migrate/detect.ts`, `shared/src/data/seed/activities.ts`, `shared/src/data/seed/allocations.ts`, `shared/src/data/seed/constants.ts`, `shared/src/data/seed/orgTables.ts`, `shared/src/data/seed/resources.ts`, `shared/src/data/seed/schedule.ts`, `shared/src/data/transfer.ts`, `shared/src/domain/assertions/dependents.ts`, `shared/src/domain/assertions/refs.ts`, `shared/src/domain/importFold.ts`, `shared/src/domain/lifecycle/ancestry.ts`, `shared/src/domain/lifecycle/projection.ts`, `shared/src/domain/lifecycle/types.ts`, `shared/src/domain/mutations.ts`, `shared/src/domain/validationLookup.ts`, `shared/src/lib/color.test.ts`, `shared/src/lib/color.ts`, `shared/src/lib/dateMath.ts`, `shared/src/lib/integrity.ts`, `shared/src/lib/repeatingDates.ts`, `shared/src/lib/sanitize/account.ts`, `shared/src/lib/sanitize/coerce.ts`, `shared/src/lib/sanitize/importedFields.ts`, `shared/src/lib/sanitizeImport.ts`, `shared/src/lib/schedulingDays.ts`, `shared/src/lib/strings.ts`, `shared/src/types/entityHelpers.ts`.

Existing focused tests: `shared/src/data/internalClient.test.ts`, `shared/src/data/migrate.test.ts`, `shared/src/data/seed.test.ts`, `shared/src/data/transfer.test.ts`, `shared/src/domain/mutations.test.ts`, `shared/src/domain/lifecycle.test.ts`, `shared/src/domain/tenancy.test.ts`, `shared/src/lib/color.test.ts`, `shared/src/lib/dateMath.test.ts`, `shared/src/lib/integrity.test.ts`, `shared/src/lib/repeatingDates.test.ts`, `shared/src/lib/sanitizeImport.test.ts`, `shared/src/lib/schedulingDays.test.ts`, `shared/src/lib/strings.test.ts`, `shared/src/types/entityHelpers.test.ts`, `shared/src/packageExports.test.ts`.

Owner checks: shared production/test typecheck, lint over `shared/src`, and formatter over the explicit footprint. The coordinator owns integrated app/server gates and E2E. No new or weakened assertions are needed for names-only changes.

### Server package names — #639

Status: implementation committed at `7233323e`; independent review found no runtime changes and two live documentation-link corrections, now included. Audit group C4-01: 346 R/E rows, excluding the four E+P groups. The commit fixes the exact source/test footprint; two additional comment-only paths are `server/src/authConfig/authTypes.ts` and `server/src/db/lifecycle.ts`.

Seven source moves align principal names: `KeyedOperationLock.ts`, `WriteOnceSecretReplay.ts`, `buildApplicationSessionHandle.ts`, `createTrustedLocalIdentityPort.ts`, `MasqueradeRegistry.ts`, `createFileAuditSink.ts` and `resolveEntitlements.ts`. Internal re-export aliases follow their owned names; stable object keys, SQL, HTTP shapes, signatures, result shapes and released migrations stay unchanged. C514 uses `decodedRow` to avoid the existing `row` parameter.

Central footprint: `docs-src/security/crypto-inventory.json`, `docs-src/sso-cutover-design.md`, regenerated `docs/security/crypto-inventory.json`, suppression pruning and this plan. Historical audit/changelog citations retain the base spelling.

Owner evidence: Node 24.19.0; 1,394 tests across 70 focused files passed in 72.59 seconds; server typecheck and formatter pass. Scoped lint passes with only unused suppressions deferred for central pruning; final integration requires ordinary unflagged lint. Three tests moved with their principal files; no tests were added or assertions weakened.

### Additional connected filename retirement

App brief review identified one more baseline-bearing principal move: B036/B152/B333 in `src/components/scheduler/weekSnap.ts`. Keep all three rows in one E+P group, retire the existing parameter suppression before moving to `resolveWeekStartSnapTarget.ts`, and create no new-path suppression. They are excluded from the app rename batch. This is the same reviewed baseline rule used by the four server groups.

### Coherent parameter groups

Independent packaging review selects 22 P groups from the original 36 leaf-directory groups. Account administration, HTTP route boundaries, shared domain validation, scheduler grid inputs and persistence have concrete overlapping consumers under common parent directories. The other 17 groups remain separate. `tasks/conventions-audit.md` records exact replacement groups and all row IDs. No rows are omitted or reclassified by this consolidation; five E+P groups and 29 result modules remain separate. The revised 59-group count is triage, not a claim that every implementation brief is approved.
