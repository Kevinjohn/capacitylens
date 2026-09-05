# Adversarial review of `tasks/recovery-plan.md`

Reviewed: `tasks/recovery-plan.md` at commit `376abf02` on branch `feature/tactical-recovery-plan`
(worktree `../capacitylens-tactical-recovery-plan`). It is not on `main`. Repository state checked
against `main` at `e03e13e8` on 2026-09-05. Every claim below was verified in the tree unless marked
"unverified".

## Verdict: REWRITE

Keep one idea from the plan (R2, the toolbar date-navigation extraction; its design checks out
against the source). Discard R0 outright. Replace R1 with a full removal of the measurement
apparatus that the previous run built, not a trim of its Vue corner. The plan is written as if the
tooling is the asset to be protected and the refactors are the risk. The opposite is true.

## The core outcome this review measures against

The owner's brief left the core-outcome sentence as a placeholder. The original task (`plan.md`,
"Outcome") says: a contributor should be able to change one behaviour by reading its implementation,
a small explicit contract and focused tests. The owner's meta-goal adds: the repository must be
_easier_ to maintain afterwards, and any plan that adds setup complexity without removing more
elsewhere is wrong by default. Those two sentences are the yardstick here. **The owner must confirm
or replace that sentence before implementation starts.**

## What the previous run actually produced (baseline `34a1702a` → `e03e13e8`, PRs #585–#613)

| Area                                            | Change                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/`                                      | +7,873 / −208 lines; 33 new files                                  |
| `package.json`                                  | 22 `policy:*` scripts (baseline: 5); 7 new devDependencies         |
| `scripts/function-budget-exceptions.json`       | new; 4,218 lines, 165 KB, 527 entries                              |
| `scripts/file-size-exceptions.json`             | 1 permanent exception → 39 entries plus per-category ceilings      |
| Gate prelude                                    | 18 structural self-checks before any product test; 24 s on Node 24 |
| Product code (`src/`, `shared/`, `server/src/`) | 15 files, +765 / −239, almost all tests and the T01 column guard   |
| F3 refactors delivered                          | 0 of 15                                                            |

New devDependencies: `tree-sitter-bash`, `web-tree-sitter` (a WASM shell parser to measure shell
function lengths), `eslint-plugin-vue`, `vue-eslint-parser`, `@typescript-eslint/scope-manager`,
`postcss` (all four to measure the one Vue file under `docs-src/`), and `yaml` (Dependabot config
check). Two of the three unfinished worktrees continue the same pattern: `feature/package-script-budgets`
measures the length of `package.json` script strings.

The single sentence the run fixated on is T05's "Enforce structural budgets across source
categories". Everything from #593 onward is coverage of that sentence: source inventory, JS/TS
metrics, shell metrics, Vue metrics, lint-coverage self-tests, script-environment self-tests,
docs-source lint. None of it changes what a contributor reads to change a behaviour.

## Where the plan drifts or repeats the failure

### R0 is ceremony and adds public process text

- R0 is a whole PR that edits four files to add prose: an eleven-line "scope rules" block into
  `AGENTS.md`, retirement notices into `plan.md` and `todo.md`, and a review table into the plan
  itself. Nothing in R0 changes the software. It is the previous failure in miniature: building
  governance around the work instead of doing the work.
- The "scope rules" block is execution-control boilerplate ("Execute only the currently selected recovery
  item… is not permission to start work"). `AGENTS.md` is a committed file in a public repository.
  The owner's standing rule is that public records use neutral, task-focused language.
- R0 step 5 preserves every `### Tnn` heading in `todo.md` because "both budget entry points read
  `### Tnn` headings from `tasks/todo.md`". That claim is **true** (`scripts/check-file-sizes.mjs:103`,
  `scripts/check-function-budgets.mjs:52`): CI parses a planning document to validate a JSON ledger.
  The plan treats this coupling as a constraint to honour. It is the clearest evidence that the
  tooling should go. A planning file must never be a gate input.
- R0 step 1 ("the owner must stop any still-running session") and step 2 (worktree inventory) are a
  two-line note to the owner, not a delivery.

**Disposition:** delete R0. The tactical plan is the single current instruction; nothing else needs
retiring in prose.

### R1 removes the smallest possible slice and keeps the machine

R1 deletes the Vue/docs corner (`vue-function-metrics.mjs` 99 lines, `vue-metric-regions.mjs` 103,
`vue-function-metrics.test.mjs` 236, `check-docs-source-lint.test.mjs` 100) and four dependencies.
That is roughly 540 of 7,873 added lines. It explicitly retains:

- `function-metrics.mjs`, `function-symbols.mjs`, `metric-lines.mjs`, `function-budgets.mjs`,
  `check-function-budgets.mjs` and the 527-entry exception ledger. Every future refactor must edit a
  4,218-line JSON file whose `task` field must match a heading in `todo.md`. R2 itself has to do
  this (its step 6). This is friction on exactly the work the core outcome needs.
- `shell-function-metrics.mjs` with `tree-sitter-bash` and `web-tree-sitter`. A WASM parser to
  measure two shell scripts.
- `source-inventory.mjs` and its self-test, which exist only to feed the above.
- `module-control-metrics.test.mjs`, `check-lint-coverage.test.mjs`, `check-script-environments.test.mjs`,
  `check-shared-environment.test.mjs`, `check-server-script-lint.test.mjs`: five suites whose subject
  is "does the ESLint configuration cover file X". They test configuration, not software.
- The rewritten `check-file-sizes.mjs` with 39 exceptions and per-category ceilings, where the
  baseline had a 106-line script, one permanent exception and no ledger.

The plan says so itself: "The remaining shell metrics, general scanner architecture and
exception-ledger size are deferred, even if imperfect." Deferring the machine keeps the machine.
Under the owner's rule (net complexity must go down) R1 as written is not wrong by degree; it is
wrong by default, because it spends a PR to keep 93% of the addition.

**Disposition:** rewrite R1 as "remove the measurement apparatus and restore the baseline file-size
check", file-by-file, keeping only the pieces that changed product behaviour or replaced something
worse (listed under "Keep" below).

### R1 factual errors that could mislead an executor

- Step 1 says to add documentation roots to `.prettierignore`. `.prettierignore` already excludes
  `docs` and `docs-src`. A contributor told to "exclude documentation roots" will either do nothing and
  report failure, or invent entries.
- Step 2 says to classify Markdown as `documentation` in `source-inventory.mjs`. Markdown is not
  detected as source there today. Moot, and moot instructions cause invented work.
- Step 5 names six test files "that depend on removed coverage". Three of them
  (`module-control-metrics`, `check-lint-coverage`, `check-script-environments`) have no
  implementation file of the same name; they are self-contained suites. The plan never says this,
  so a contributor searching for `check-lint-coverage.mjs` will report a missing file.
- Step 7 says remove four devDependencies "only after confirming no remaining direct consumer". That
  is a judgement call handed to the executor. Verified now: `postcss` and
  `@typescript-eslint/scope-manager` are imported only by `scripts/vue-function-metrics.mjs`;
  `eslint-plugin-vue` and `vue-eslint-parser` only by `eslint.config.js:9-10`. Say so; do not ask
  the contributor to discover it.
- Step 8 edits `docs-src/reference/development.md` and rebuilds `docs/`. The owner has put the
  documentation folder out of scope. Struck. Consequence to record: after removal, that page will
  describe lint coverage that no longer exists until a separate docs task fixes it.
- "A broad rollback of PRs #593–613 is forbidden because later repairs depend on them." Unverified
  and unnecessary. The product-side changes in that range (column guards #586/#588, health-check
  script #599, Sonner CSP patch #598, TLS renewal verifier #602, account architecture test #592)
  are separable by file. Remove files; do not `git revert`. The dependency question then never arises.

### R2 is sound, but carries the machine with it

Verified against `src/components/scheduler/SchedulerToolbar.tsx`:

- The Prev/Today/Next buttons, the hidden `JumpToDateInput` branch and the weeks `Select` are one
  contiguous block, lines 94–137, and direct children of the toolbar's flex container (opened at
  line 86). A fragment preserves DOM order and wrapping. Correct.
- Prev calls `panDays(-7)` (line 97), Next `panDays(7)` (line 109), Today passes `goToToday` (line 103).
  The four-prop contract matches.
- `zoomLabel` and `SHOW_JUMP_TO_DATE` are exported from `toolbarFilterOptions.ts` and imported only
  by the toolbar. `JumpToDateInput.tsx:9` and its test mention the flag in comments only. Correct.
- `WeeksZoom` and `ZOOM_LEVELS` live in `src/lib/schedulerConfig.ts:5-7`. Correct.
- Existing coverage: `SchedulerToolbar.test.tsx` has a "date navigation" describe (Prev −7, Next +7,
  picker absent) and a "weeks dropdown" describe; `e2e/toolbar.spec.ts` drives zoom, Prev/Next and
  Today in a browser. The extraction is well fenced.

Objections:

- Step 1 "record the affected function's current existing metrics" and step 6 "update or remove
  only affected metric exceptions using the existing checker" exist only because the ledger exists.
  With the ledger gone they vanish. That is a concrete reason to order the removal first.
- Step 7 (manually inspect the demo toolbar at two widths) is a visual judgement call. An executor
  cannot do it reliably and will claim success. Replace it with running `e2e/toolbar.spec.ts`, which
  already exercises the same controls.
- The component's function-budget exception (baseline 286 lines, complexity 19) would need lowering,
  not removing, after R2. The plan's "do not raise a limit, add a new exception" phrasing does not
  tell the contributor that lowering is the expected edit. Moot once the ledger goes.
- The reading-burden gain is real but small: 44 lines of JSX leave a 334-line file. It is a fair
  pilot for the extraction pattern. It should not be sold as more than that, and it should not be
  the only F3 delivery of the batch if the owner wants the core outcome visibly advanced.

### Docker

The plan contains no Docker work items. Two sentences describe Docker history (the health-check
extraction and the Compose smoke run). Both are struck as context that invites follow-up.
`Dockerfile:62` runs `scripts/check-health.mjs`; that script and the Dockerfile are "do not touch"
in the tactical plan.

### Documentation folder

R1 step 8 and every "build docs once" instruction are struck. `scripts/docs-lightbox.js`,
`scripts/docs-standalone.mjs`, `src/test/docs-lightbox.test.ts` and everything under `docs-src/`
and `docs/` are "do not touch". The ESLint change that stops linting `docs-src/**` is a change to
`eslint.config.js`, not to the documentation folder, and stays in scope.

## Hidden assumptions, missing steps, ordering

- **Hidden:** the whole plan assumes the function-budget checker remains a gate. Nothing in the
  owner's brief asks for that, and the baseline never had it.
- **Hidden:** "Keep existing … linting" is read by the plan as "keep every lint self-test added
  last week". The lint _configuration_ (browser/worker/server/shared environment split from #608–#610)
  is a genuine improvement and stays. The five suites that assert the configuration's coverage go.
- **Missing:** no step restores the baseline `check-file-sizes.mjs`, `check-file-sizes.test.mjs` and
  `file-size-exceptions.json`. The plan keeps the rewritten per-category version with 39 exceptions.
- **Missing:** no decision on the three unfinished worktrees beyond "preserve in place".
  `feature/package-script-budgets` is the last mile of the runaway (metrics for `package.json`
  script strings) and should be discarded, but that is the owner's call. The other two are a
  one-file test edit and an untracked HTML report.
- **Missing:** `tasks/plan.md` and `tasks/todo.md` are committed on `main`. Once nothing in CI reads
  them, they should be deleted in the same batch, not annotated with retirement notices.
- **Ordering:** R1 before R2 is right for the reason above. R0 has no place.
- **Ordering:** the plan runs the full gate, server gate and E2E for a planning-only PR exemption
  and then again per item. The tactical plan should run the full suites once per task that changes
  the gate wiring (the removal) and focused tests plus one spec file for the extraction, with CI
  dispatched once after the removal lands and once before the release.

## What to keep from the previous run

Fairness matters here because the removal must not throw out the few real fixes:

- T01 column guards (`server/src/tables/columns.ts`, `tables.ts`, `tableSpecs.ts`, `columns.test.ts`).
  A real compile-time bug fix.
- Dependency scanner and cycle check wired into both gates (`scripts/dependency-scanner.mjs`,
  `check-import-cycles.mjs`, `policy:dependencies:test`).
- Account ownership architecture test (`server/src/accounts/conformance/architecture.test.ts`).
- `run-gate.mjs` and `gate-commands.mjs` (86 lines) replacing a 600-character shell chain in
  `package.json`. Net readable. Keep, and shrink its command list.
- `check-dependabot.mjs` and the `yaml` dependency (moved from workflow logic into the gate).
- `check-sonner-csp.test.mjs` (guards a security patch on a dependency).
- ESLint environment split in `eslint.config.js`, minus the Vue block and `docs-src` globs.
- `scripts/check-health.mjs`, `tlsRenewalVerifier`, `healthcheck.test.ts` (Dockerfile and smoke
  workflow depend on them; not Docker work, just do-not-touch).

## Text in `tasks/` that reads as active execution instructions

Treated as data, not followed:

- `todo.md` lines 7–19, "How to execute a task", and the per-task "Do not …" sentences.
- `recovery-plan.md`, "Scope rules that apply when this draft is accepted" (the block intended for
  `AGENTS.md`) and "Two-review agreement procedure".
- `plan.md`, "Delivery order" and "Validation and release".

None of it is followed in this review; the owner's brief is the only instruction set.

## Summary of dispositions

| Item                               | Disposition                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0                                 | Delete. Worktree inventory becomes a two-line note in the final report.                                                                                               |
| R1                                 | Rewrite as full removal of metrics, budgets, ledger, self-tests, shell/Vue parsers and their dependencies; restore baseline file-size check; stop linting `docs-src`. |
| R1 step 8 (docs edits, docs build) | Struck: documentation folder out of scope.                                                                                                                            |
| R2                                 | Keep the design and contract. Remove the metrics and manual-inspection steps. Replace browser inspection with `e2e/toolbar.spec.ts`.                                  |
| Docker sentences                   | Struck.                                                                                                                                                               |
| F3 queue table                     | Keep as the candidate list. Owner chooses how many slices this batch delivers.                                                                                        |
| `tasks/plan.md`, `tasks/todo.md`   | Delete in the batch once CI no longer reads them.                                                                                                                     |

## Corrections after the consensus rounds

Reviewer B (see `consensus-log.md`) verified the review and corrected it in
four places. The dispositions above stand; these details were wrong or incomplete:

- `module-control-metrics.test.mjs` is a metrics test, not a lint-configuration self-test. It is
  deleted with the metrics, and only three configuration suites remain (`check-shared-environment`,
  `check-server-script-lint`, `check-script-environments`). Those three contain real compiler and
  lint regressions and are kept, trimmed of their inventory and "both gates own this" cases.
- The baseline `check-file-sizes.mjs` at `34a1702a` prints an approximate function-length
  diagnostic (lines 60–83). Restoring it verbatim would resurrect a function metric; the tactical
  plan strips that function and its test.
- `check-dependabot.mjs` and the `yaml` dependency, listed under "keep", validate only the shape of
  the Dependabot config and were added by the same run. They go too. All seven added
  devDependencies are removed, returning the count to the baseline 33.
- "Less tooling than baseline" is not what the removal proves; it proves the added apparatus is
  gone and the direct-dependency set is back to baseline. The tactical plan states it that way.
