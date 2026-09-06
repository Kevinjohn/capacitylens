# Code conventions: audit, debt retirement and upkeep

Status: agreed 2026-09-06 (revision 2; revision 1 reviewed and revised the same day). Base: `main` at `e07278b8`, version 0.60.1-alpha.1.
Issues: #638 (audit), #639 (debt retirement), #643 (upkeep).
Previous batch (conventions page and lint baseline, PRs #640–#642) is complete; its plan is in git
history.

AGENTS.md governs everything not stated here. No build, test or CI reads this file. This plan
authorises no implementation: C3, C4 and C5 each start only when selected.

## Outcome

Every non-test file in the typed packages has been read against
`docs-src/reference/conventions.md`, each deviation is a cited row with a class and a proposal,
the rows are triaged into batches that retire the debt without touching any stable identifier,
and a standing decision says how the page and its lint baseline are kept current.

## Rules for the programme

- **Order.** C3 first and alone. C4 starts only from a triaged audit, one batch at a time. C5 is
  docs-only and may land with C3.
- **Hard exclusions, all tasks.** No change to wire fields, SQL names, routes, environment
  variables, ids, emails, test-ids, released migrations, database fixtures or the exported
  surface of `@capacitylens/shared`, except where a C4 batch block records an explicit
  authorisation for a named export. No new dependencies, scripts, lint rules or tooling.
- **Footprint is the contract.** Each batch lists its files. An edit outside that list stops the
  task and reports.
- **Stop rule.** Two failed fix attempts on a focused check, or a boundary that cannot preserve a
  listed behaviour, stops the task with the obstacle, files changed and smallest remaining step.
- **Validation.** Prose tasks: `pnpm exec prettier --check` on the file and a citation
  spot-check. Code batches: during implementation `pnpm run lint`, `pnpm exec tsc -b`, Prettier
  on touched files and the batch's focused tests; before submission one integration worktree per
  batch, `pnpm run gate`, `pnpm run gate:server`, `pnpm run e2e`, Node >= 24. Main CI after each
  merge is the GitHub evidence.
- **Release.** One release per C4 batch, after the batch lands. C3 and C5 are not releases.
- **Merges to `main` at least five minutes apart** (the alpha host deploys on every merge).

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
parameters, `Status` and `OfflineCacheWriteResult` naming. Surveys at 3bb01646 also found one
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
- Scope: every non-test file in the lint scope. Tests are not audited for prose rules; test files
  appear only through the `consumers` column and through baseline entries. Every
  `eslint-suppressions.json` entry, including entries in test files, is resolved to its
  declarations (the baseline records only file, rule and count) and each declaration gets its own
  classified row: a suppressed name is `R`, `E` or `X` on its own merits (`notInAccount` in
  `shared/src/domain/tenancy.ts:25` is a package export, so `E` or `X`, never `R`), a suppressed
  parameter list is `P`, `X` or `D`.
- Every row cites a line at the base SHA and quotes the rule it breaks. A row without a rule is
  not a finding. The page is not changed by the audit; a rule the audit finds unworkable becomes
  a `D` row with the reason and a note for C5.
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
  `P` grouped by directory, then `S` one module per pull request.
- Each batch is briefed from the audit rows it takes, and the brief is reviewed adversarially
  before implementation, as for any plan. The brief lists every file the rows touch plus the
  tests that reference the renamed symbols, and names the focused tests.
- Every batch prunes `eslint-suppressions.json` for the files it touches and adds no entry. A
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

**Files.** Per batch, listed in its brief. This plan gains one block per batch when it is selected.

**Focused tests.** Per batch, listed in its brief; every batch runs `pnpm run lint` with the
pruned baseline.

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
  - `eslint-suppressions.json` only shrinks. A change touching a file with entries prunes what it
    can and never adds an entry; new code meets the rules.
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

## Sequence

1. This plan lands by its own pull request; #638 and #639 are updated with the agreed C3 and C4
   blocks, and the upkeep issue is opened with C5.
2. C3 when selected (its pull request may carry C5). C4 batches when selected, one at a time.
3. Stop.

## Completion record

- [ ] Plan merged: PR #, merge SHA
- [x] #638 and #639 updated; upkeep issue #643 opened
- [ ] C3 merged: PR #, merge SHA
- [ ] C5 merged: PR #, merge SHA
- [ ] C4 batches: added per batch
