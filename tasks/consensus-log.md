# Consensus log: independent plan review

Date: 2026-09-05. Base revision `e03e13e8`. Both reviewers checked claims against the repository
tree. Reviewer A drafted and revised the plan; Reviewer B performed an independent adversarial
review. Referenced documents are the files in `tasks/` and are not repeated here.

Rounds 1–5 under the original five-round cap reached AGREED on round 5. Rounds 6–8 were requested by the owner after answering the open questions (keep tooling that delivers value and document why; minor release with full CI at the end). Rounds used: 8. Final outcome: AGREED on round 8.

---

## Round 1 — Reviewer A proposal

Reviewer A requested an adversarial review of the recovery-plan assessment, supported by
file-and-line evidence against `e03e13e8`.

The review covered five questions: whether R1's proposed removal preserved useful protection;
whether R0 was necessary given the planning-file readers; whether the proposed
`ToolbarDateNavigation` boundary was sound; whether more F3 slices could be safely bounded; and
whether hidden coupling, ambiguity, ordering, or added complexity remained.

## Owner's brief

The previous programme intended to make CapacityLens easier to understand and maintain. It
produced `tasks/plan.md` and `tasks/todo.md`, focused on T05 ("enforce structural budgets across
source categories"), added about 7,900 lines of scripts, seven development dependencies, a
527-entry exception ledger and 22 policy scripts, and delivered none of the 15 F3 refactors. A
subsequent retrospective produced `tasks/recovery-plan.md`, which required independent review.

Core outcome (owner left this as a placeholder; the reviewer's working assumption, to be confirmed by the owner): a contributor can change one behaviour by reading its implementation, one small explicit contract and focused tests; and the repository carries less setup/tooling than it did at baseline 34a1702a.

Meta-goal: this is open-source software that must be easier to maintain afterward. Any plan that adds setup complexity without removing more elsewhere is wrong by default.

Hard constraints from the owner:

- Do not implement anything. Output is planning markdown only.
- Do not touch, plan for, or reference work in the documentation folder (docs-src/, docs/). Out of scope.
- No Docker work of any kind.
- Do not add new tooling, frameworks or abstraction layers unless the plan also removes more than it adds.
- If the recovery plan conflicts with the core outcome, the core outcome wins.
- The final tactical plan must be executable without unstated judgement calls: per-task id,
  one-line goal, why it serves the outcome, exact files in scope, do-not-touch list, explicit steps,
  done criteria and exact local verification commands, dependencies, two to four firm safeguards,
  and S/M/L size. Plan-level requirements include a dependency graph, phases ending in a working
  testable state, a delete/simplify section, local testing per task, and GitHub CI batched toward
  the end.

## Round 1 — Reviewer B findings

**The review is directionally right about deleting the measurement apparatus, but its blanket deletion of regression tests is unjustified. R2 checks out. Its replacement verification does not.**

Checked `e03e13e8`. No files changed, installations performed, or gates run.

**1. R1: remove the metrics; preserve specific regression protection.**

Delete the function/shell/Vue collectors, function-budget ledger, inventory and metric-only tests. Nothing inspected in those modules checks scheduling results, authorization or saved-data correctness. `module-control-metrics.test.mjs:19–36`, for example, tests complexity/depth thresholds—not ESLint coverage. Calling it one of “five lint-configuration self-test suites” is factually wrong.

The blanket deletion also throws away useful checks:

- **Keep the shared production compiler-graph assertion**, `scripts/check-shared-environment.test.mjs:32–44`. It detects Node declarations and test files entering the production graph. This is more than checking configuration text. `shared/tsconfig.json:8` disables automatic ambient types; it does not prevent explicit imports pulling Node declarations back in—the suite demonstrates that distinction at lines 60–68.
- **Keep the focused promise-rule regression**, `scripts/check-server-script-lint.test.mjs:26–37`. It runs invalid and valid code through the actual project configuration for the password-reset script. This protects error-handling enforcement, although it is not a password-reset behavior test.
- **Keep representative runtime-boundary probes**, `scripts/check-script-environments.test.mjs:15–39` and `scripts/check-shared-environment.test.mjs:95–127`. Browser/worker separation and shared-runtime restrictions prevent real runtime failures.

These protections need not preserve the inventory or exhaustive matrices. Remove inventory imports, enumeration cases and “both gates own this test” assertions; retain the small executable regressions in their existing files. The review’s distinction—“configuration, not software”—does not establish that deletion is safe.

Restoring the baseline file-size checker, test and JSON configuration together is feasible. A read-only reproduction of its file selection/counting found only `src/components/ui/sidebar.tsx` above 400 lines, already the baseline permanent exception. **But exact restoration resurrects function metrics:** `34a1702a:scripts/check-file-sizes.mjs:60–83` contains approximate function-length diagnostics, called at line 99. Remove those diagnostics and their dedicated test too.

**Something the review keeps that should go:** `check-dependabot.mjs`, its self-test and the direct `yaml` dependency. The validator checks version, field types and three schedule strings (`scripts/check-dependabot.mjs:24–35`); its test explicitly accepts empty ecosystem/directory strings (`scripts/check-dependabot.test.mjs:26`). It does not validate advisory status or the actual update policy. Keep dependency auditing (`scripts/gate-commands.mjs:24`); this partial configuration validator is a poor maintenance trade.

The review’s arithmetic is also wrong: removing 540 lines while retaining other additions still reduces complexity relative to current main. It simply does **not establish the owner’s stronger requirement of less tooling than baseline**. Neither proposal demonstrates that requirement yet.

**2. R0: delete the separate delivery; no preliminary policy edits are technically required.**

Leaving `AGENTS.md`, `plan.md` and `todo.md` unchanged does not break R2. Neither toolbar code nor its imports reads them. The task readers at `scripts/check-file-sizes.mjs:103–105` and `scripts/check-function-budgets.mjs:52–54` require existing headings, not retirement notices.

The ordering distinction matters:

- Leaving the files alone: no technical breakage.
- Deleting `todo.md` while either current checker remains: deterministic failure.
- Removing those readers and deleting obsolete task files in the same completed change: valid.

Therefore, agree with deleting R0 as a prerequisite PR. Do not confuse that with permission to delete the ledger first. A brief execution handoff should state that historical task prose is data.

The review also overstates the public-content rule. Neutral workflow guidance is not automatically prohibited attribution; `AGENTS.md:8–17` already describes worktree/session workflow. R0 is unnecessary because it adds no required dependency—not because all executor-oriented prose is forbidden.

**3. R2: the source verification is correct, with one qualification.**

`SchedulerToolbar.tsx:86–137` confirms:

- The navigation/zoom block is contiguous and follows the heading.
- Prev/Next dispatch −7/+7 at lines 97/109; Today uses `goToToday` at line 103.
- The flag guards the picker at line 115.
- Zoom converts the selected string to `WeeksZoom` at line 120.
- A fragment preserves the existing flex children.

The proposed four props are sufficient. Moving `zoomLabel` and the flag from `toolbarFilterOptions.ts:6–17` removes an irrelevant filter dependency.

Qualification: **the component is not transitively store-independent**. `JumpToDateInput.tsx:13–14` subscribes to the store. That is harmless while hidden and explicitly retained, but “four props” must not become a claim that enabling the picker needs no other state.

No smaller _complete date-navigation boundary_ is better: extracting only the three buttons leaves zoom ownership behind for little saving. Keep R2 first.

**Reject the browser-test substitution as written.** `e2e/toolbar.spec.ts:7–72` covers zoom, panning, Today and picker absence; it does not establish narrow-width reflow. The existing relevant check is `e2e/a11y.spec.ts:183–197`. Run both the toolbar spec and that focused reflow test. They provide objective evidence without inventing a visual harness. Neither substitutes for every keyboard/layout claim.

**4. Deliver several slices: three narrowly specified capabilities, not several whole F3 rows.**

I recommend R2 plus these two, giving the batch concrete behavior boundaries beyond a pilot:

- **SchedulerToolbar activity selector.** Move `SchedulerToolbar.tsx:223–277` into new `ToolbarActivityFilter.tsx`, with a local contract for selected activity ID/kind, the two option lists and a selection callback. Footprint: parent, new component, new component test; preserve `SchedulerToolbar.test.tsx`. Existing tests cover groups, absence and lens exclusion at lines 437–505. Keep search ownership in the parent and route the callback through **`setToolbarFilters`**, whose cancellation/search-preservation behavior lives at `useToolbarSearch.ts:57–60`. Passing raw `setFilters` would introduce a regression.
- **ResourceList person/placeholder row presentation.** Extract the `Item`/content/action-container structure at `ResourceList.tsx:151–170` into new `ResourceListRow.tsx`. Pass display name, color, metadata, placeholder status and the existing action subtree as children. Keep favorite subscriptions, permission checks, edit/confirm callbacks and lifecycle operations in the parent. Footprint: `ResourceList.tsx`, new component and new component test; preserve `ResourceList.test.tsx`. Existing evidence covers favorite behavior at lines 73–105, metadata at 180–221, contextual action names at 224–231 and placeholder presentation at 277. Leave external rows untouched.

These are bounded presentation extractions suitable for weaker executors. Do not approve the entire ResourceList or toolbar row as “safe.”

Do not add LoginScreen merely because hooks exist: its shared busy/error/MFA/setup state is explicit at `LoginScreen.tsx:53–88`. Grid work likewise touches live gesture state and callback identity (`SchedulerGrid.tsx:78–107`). The other auth, gesture, transaction and cancellation-oriented rows are not prevalidated low-risk work.

**5. Missed coupling and unnecessary process.**

- `scripts/run-gate.test.mjs:73–74` searches for `policy:function-budgets` and asserts it exists. Removing the command requires changing that failure probe to a retained command.
- Delete the orphan `scripts/__tests__/policy-import.mjs`; its consumer is `check-function-budgets.test.mjs:133–134`.
- “No implementation file with the same name” is not a plan defect. The named `.test.mjs` files exist; inventing a hypothetical executor search adds noise.
- The review adds two CI dispatches and a release checkpoint without an authorized release. Use the owner’s batched validation requirement.
- Reduced tooling relative to baseline remains an unresolved acceptance claim; removing most of yesterday’s additions does not prove it.

## Points of disagreement

- Blanket deletion of configuration regressions discards useful compiler, promise and runtime-boundary protection.
- Exact baseline restoration reintroduces function-length diagnostics.
- The retained Dependabot validator and direct YAML dependency should also go.
- Partial removal is insufficient evidence of the outcome, not automatically net-negative.
- Neutral workflow prose is not inherently prohibited public attribution.
- The toolbar spec alone cannot replace reflow verification.
- Missing same-name implementation files are not a defect in instructions naming existing tests.
- Extra CI dispatches and a release checkpoint add unsupported process.

## Points of agreement

- Remove the measurement apparatus and task-linked function ledger.
- Delete R0 as a separate prerequisite delivery.
- Remove task readers before, or atomically with, deleting their input.
- Keep R2’s fragment and four-prop contract.
- Preserve product fixes, security regressions and dependency-boundary checks.
- Strike out-of-scope work and deliver multiple explicitly bounded F3 capabilities.

---

## Round 2 — Reviewer A revision

Reviewer A accepted or disputed the first-round findings and proposed the following task list for
further review.

## Reviewer A's dispositions of the round-1 points

ACCEPTED (verified in tree):

1. Keep `check-shared-environment.test.mjs`, `check-server-script-lint.test.mjs`, `check-script-environments.test.mjs`. Trim by deleting named tests only: in server-script-lint delete "every authored server TypeScript script receives typed promise rules" (line 12, the only `collectSourceInventory` consumer) and "both gates own the effective server script lint regression" (line 48); in shared-environment delete "both gates enforce the shared production environment" (line 130); in script-environments delete "both gates check effective JavaScript environments" (line 55). Remove the then-unused imports. My "five lint-configuration self-tests" label was wrong for module-control-metrics; it is a metrics test and goes with the metrics.
2. Baseline `check-file-sizes.mjs` restoration must delete `printFunctionDiagnostics` (34a1702a lines 60–83), its call (line 99) and the test "long-function diagnostics follow the verdict without enforcing a cap" (baseline test line 117).
3. Drop `check-dependabot.mjs`, its test, the two gate commands and the `yaml` devDependency. Nothing is restored to the workflow.
4. `run-gate.test.mjs:73` probe switches from `policy:function-budgets` to `policy:file-sizes`; delete orphan `scripts/__tests__/policy-import.mjs`.
5. R2 verification adds `e2e/a11y.spec.ts` reflow test (lines 183–197) alongside `e2e/toolbar.spec.ts`.
6. Single CI dispatch, once, at the end of the batch. No release task; whether to bump the version is an owner question, not a plan item.
7. Wording: R0 is deleted because it adds nothing required, not because executor prose is forbidden. The "no same-name implementation" point is softened to "the plan should say these are test-only files".

MEASURABLE ACCEPTANCE for "less tooling than baseline" (your point that neither proposal proves it): after the removal tasks, `devDependencies` count in package.json is 33 (baseline 33; the 7 additions are all removed), `scripts/` contains no file from the metrics/inventory/budget cluster, and `pnpm run gate` structural prelude is the baseline set plus `policy:dependencies:test`, `policy:sonner-csp:test`, `policy:gate-runner:test` and the three trimmed environment suites. State this as done-criteria, not a goal.

REJECTED: 8. `ResourceListRow` (ResourceList.tsx:151–170) as an F3 slice. It is a ~20-line presentational wrapper that would take the action subtree as children: a pass-through helper that narrows nothing. Counter-proposal, probed in tree: extract the External section, `ResourceList.tsx:265–320`, into `ExternalResourceSection.tsx` with props `{ externals: Resource[]; onAdd: () => void; onEdit: (r: Resource) => void; onArchive: (r: Resource) => void }`; the `externalEnabled &&` guard stays in the parent; `FavouriteButton` stays where it is and is imported; test-id `external-row`, `id="external-heading"` and the `m.list_resources_*` strings unchanged. Covered by `ResourceList.test.tsx:50,73,244` and `e2e/external.spec.ts:27-66,101-107,193-204`. 56 lines, four props, no store access inside the block.

ACCEPTED WITH A CONDITION: 9. `ToolbarActivityFilter` (SchedulerToolbar.tsx:223–277). Accepted, callback routed through `setToolbarFilters` from `useToolbarSearch.ts:57-60`; brief will say "never pass raw setFilters". Same file as R2, so it is sequenced after R2.

## Draft task list (ids, scope, size; details go in the plan)

Phase 1 — remove the measurement apparatus (each ends with green `pnpm run gate` + `pnpm run gate:server` on Node 24):

- T1 (L): delete function/shell/Vue metrics, budgets, ledger, source-inventory, module-control test, docs-source-lint test, lint-coverage test, `__tests__/policy-import.mjs`; delete `policy:*` scripts for them from package.json and `structuralChecks` in gate-commands.mjs; fix run-gate.test probe; restore baseline check-file-sizes.mjs/.test.mjs/file-size-exceptions.json from 34a1702a and strip the function diagnostic; trim the three environment suites as named; remove devDependencies eslint-plugin-vue, vue-eslint-parser, @typescript-eslint/scope-manager, postcss, tree-sitter-bash, web-tree-sitter; `pnpm install` (lockfile updated). ESLint: remove lines 9–10 imports and the `docs-src/**/*.vue` block (159–170), remove `docs-src/.vitepress/theme/**` and `scripts/docs-lightbox.js` from the browser-globals block and the ignores that reference them, drop `docs-src/**/*.{ts,mts,cts}` from the typed block (95–96), add "docs-src" to globalIgnores next to "docs" (restoring the baseline state at 34a1702a lines 29–32).
- T2 (S): delete check-dependabot.mjs/.test.mjs, their two gate commands and package scripts, `yaml` devDependency. Depends on T1 (shares package.json, gate-commands.mjs).
- T3 (S): delete `tasks/plan.md`, `tasks/todo.md` (no reader remains after T1; verified by grep in the task). Depends on T1.

Phase 2 — F3 slices (focused vitest + named e2e spec files per task; no gate rerun):

- T4 (M): ToolbarDateNavigation as in R2 minus metrics/inspection steps. Depends on T1 (so no ledger edits).
- T5 (M): ToolbarActivityFilter. Depends on T4 (same file).
- T6 (M): ExternalResourceSection. Depends on T1. Parallel with T4/T5.

Phase 3 — close:

- T7 (S): CHANGELOG `Unreleased` entries for the removal and the three extractions; `gh workflow run gate.yml --ref main` once after everything merges; report. Depends on T2, T3, T5, T6.

Review questions:
a. Is anything in T1's delete list load-bearing that we have both missed? In particular `scripts/check-sonner-csp.test.mjs` and `run-gate.mjs` stay; agree?
b. Is the ESLint edit list complete and correct against eslint.config.js as it stands (lines 40–70, 95–96, 155–170)? Anything else references docs-src there?
c. Should T1 be split (ESLint/docs part vs metrics part) for execution clarity, given both touch package.json and gate-commands.mjs? Reviewer A's position: one task, because a half-removed state has no useful green checkpoint.
d. Confirm T4/T5/T6 footprints are disjoint (T6 vs T4/T5) so T6 can run in parallel.
e. Is anything in this list likely to be misread by an executor?

## Round 2 — Reviewer B findings

**T1 and T6 are not executable as written.** T1 leaves a live inventory import and misclassifies a browser script; T6 introduces a circular import. These are concrete failures, not discretionary cleanup.

Read-only review against `e03e13e8`; no tests, gates or installations run.

**a. T1’s deletion set is sound, but its retained consumers are not fully repaired.**

The proposed shared-environment trim deletes only the gate-ownership test. **`classifyRepositoryPath` remains imported at `scripts/check-shared-environment.test.mjs:7` and called at line 40.** Deleting the inventory therefore prevents this retained suite from loading.

Keep the compiler-graph assertion. Replace that call with a local test-path predicate covering `.test.`, `.spec.` and `/__tests__/`, scoped to shared source. Those are the relevant categories already exercised at lines 139–150. Then remove the import. “Delete named tests only” cannot accomplish the agreed removal.

Yes, retain:

- `check-sonner-csp.test.mjs`, **including `__tests__/sonner-import.mjs`**, which it launches at lines 9–19.
- `run-gate.mjs`, its test, **`__tests__/gate-command.mjs`**, and `pnpm-spawn.mjs`. The dependencies are explicit at `run-gate.mjs:3` and `run-gate.test.mjs:19`.
- The switch to `policy:file-sizes` for the gate failure probe: that command remains in both modes (`scripts/gate-commands.mjs:16,30,46`).

No additional product/security protection was found inside the named metric-only deletion set.

**b. The ESLint edit list is incomplete and would break the retained environment tests.**

Removing `scripts/docs-lightbox.js` from both the browser block and Node exclusions **does not exclude it from linting**. It then matches the global JavaScript baseline and receives Node globals (`eslint.config.js:50–58`). Add explicit global ignores for both `scripts/docs-lightbox.js` and `scripts/docs-standalone.mjs`.

Also remove the lightbox path from `scripts/check-script-environments.test.mjs:11`. Otherwise its retained tests either exercise the wrong environment or receive an ignored-file diagnostic instead of the expected rule results (`:15–30`).

The remaining `docs-src` references are exactly `eslint.config.js:57,64,95,96,159`. Your proposed removals cover those. Update the now-false comment at line 46 and remove the obsolete Vue explanation at 156–157.

Finally, **lines 95–96 are the Node-globals block, not the typed block**. The server/shared typed block starts at line 119. Name the block correctly so a weaker executor does not remove promise-rule configuration.

**c. Keep T1 cohesive; the stated reason is overstated.**

A metrics-only removal followed by ESLint cleanup could produce green intermediate states, so “no useful green checkpoint” is false. Nevertheless, splitting this particular removal duplicates dependency and caller work without improving its final boundary. One task with an exact deletion manifest and focused retained-suite checks is reasonable.

T2 must explicitly include **`pnpm-lock.yaml` regeneration**. Removing `yaml` from `package.json:149` without updating the lockfile leaves the manifest/lockfile pair inconsistent. Either fold T2 into T1’s dependency update or specify its own update and frozen-lockfile verification.

Do not run full application/server gates for T3’s planning-file deletion. The live readers are the two checkers already removed/replaced by T1; checking remaining references is sufficient.

**d. T6’s proposed import is broken; its files can still be disjoint from T4/T5.**

`FavouriteButton` is private inside `ResourceList.tsx:49–79`. Importing it into `ExternalResourceSection` first requires exporting it. Then:

`ResourceList → ExternalResourceSection → ResourceList`

That is a runtime cycle, and the retained checker rejects cycles (`scripts/check-import-cycles.mjs:58–62`).

The smallest straightforward repair is to move the existing button unchanged into **`src/components/resources/FavouriteButton.tsx`**, imported by both components. T6’s explicit footprint becomes:

- `ResourceList.tsx`
- New `ExternalResourceSection.tsx`
- New `FavouriteButton.tsx`
- New `ExternalResourceSection.test.tsx`
- `ResourceList.test.tsx` only for a missing integration assertion.

This remains disjoint from T4/T5’s scheduler files. **Implementation may run concurrently; Playwright processes may not:** they share port 5173 and disable server reuse (`playwright.config.ts:43–51`).

I accept the External section as a more useful boundary than my proposed row wrapper, **with that repair**. It still has transitive store/permission coupling through `FavouriteButton.tsx`; the original implementation reads both at `ResourceList.tsx:50–52`. Do not advertise it as completely state-independent.

Rename `onArchive` to **`onRequestArchive`**. The current row action only opens confirmation (`ResourceList.tsx:309–311`); the actual archive happens later at lines 341–348. That naming prevents a weaker executor from bypassing confirmation. Preserve `requiresEdit: true` on the empty-state action (`:283–287`) and test both Add affordances.

**e. Acceptance and closing steps still need correction.**

The dependency arithmetic checks out: 40 current direct development dependencies, 33 at baseline, seven additions. But **33 equals 33; it does not establish “less tooling than baseline.”** Baseline checks plus six retained suites also do not prove that claim. State the measurable result honestly as removal of the added measurement apparatus and restoration of the baseline direct-dependency set. Do not silently redefine the owner’s outcome.

“No file from the metrics/inventory/budget cluster” is ambiguous: T1 intentionally retains the baseline file-size checker. Use exact filenames, not “budget” as a deletion category.

Phase 2 needs static verification as well as Vitest/E2E. Include type-checking, lint/format checks and the retained cycle checker before merge. `scripts/gate-commands.mjs:35–40` treats these as distinct checks; focused runtime tests do not replace them. T6’s circular-import proposal demonstrates why.

T7’s dispatch is redundant with the final merge’s automatic run: `.github/workflows/gate.yml:8–12` triggers on every push to main. Another dispatch can cancel the existing run because concurrency uses the same ref (`:19–21`). Record and await the final SHA’s successful run; dispatch only if absent. A literal “CI once at the end” promise is incompatible with separately merging every task under these triggers.

## Points of disagreement

- T1’s named-test deletions leave a live source-inventory dependency.
- The ESLint edits misclassify the lightbox script and omit explicit exclusions/test-fixture cleanup.
- T6’s proposed parent import creates a prohibited runtime cycle.
- `onArchive` obscures the existing confirmation boundary.
- Disjoint implementation files do not permit concurrent Playwright processes.
- Equal dependency counts do not prove less tooling than baseline.
- T2 omits lockfile regeneration, and Phase 2 omits necessary static checks.
- Full gates for T3 and an unconditional final CI dispatch are unnecessary.

## Points of agreement

- Keep T1 as one cohesive removal with an explicit file manifest.
- Preserve Sonner protection, the gate runner and their required fixtures.
- Keep the three repaired environment suites and the baseline size check without function diagnostics.
- Sequence T5 after T4 and preserve `setToolbarFilters`.
- Prefer the repaired External section extraction over my smaller row wrapper.
- No R0 delivery or release task is needed.

---

## Round 3 — Reviewer A revision

Round 3. All eight of your round-2 disagreements were verified and accepted: the classifyRepositoryPath predicate replacement, explicit lightbox ignore and fixture cleanup, block naming (95–96 is the Node-globals block), FavouriteButton moved to its own file to avoid the cycle, onRequestArchive, serialised Playwright, honest wording of the dependency result, T2 folded into T1 (single lockfile update), static checks in every Phase-2 task, no gates for the planning-file deletion, and no CI dispatch (verify the automatic push-to-main run instead).

The next review checked the complete tactical plan for mismatched anchors, unstated judgement calls,
missing or unused imports, commands that could not run as written, and violations of the owner's
scope constraints.

## Round 3 — Reviewer B findings

## Blocking defects

1. **The mandatory line-number rule guarantees false stops.** `tasks/tactical-plan.md:5–6` requires stopping whenever numbered text differs. T4 runs after T3 has shortened `SchedulerToolbar.tsx`; T5 removes `FavouriteButton` before addressing later numbered lines. Specify that numbers identify **base-revision locations**, while edits locate the quoted symbols/JSX in the current file. Also correct the filename-comment anchors: they are `JumpToDateInput.tsx:10` and `JumpToDateInput.test.tsx:8`, not 9 and 7.

2. **T4’s extraction range includes the parent guard terminator.** The Select ends at `SchedulerToolbar.tsx:276`; line 277 is `)}`. Both T4 instructions saying “224–277” contradict “keep that guard in the parent” (`tasks/tactical-plan.md:379–386`). Extract **224–276 only**, using the Select’s boundaries after T3.

3. **T3’s specified function does not bind its callbacks.** Its signature takes `props`, but the replacement JSX references bare `onPanDays`, `onToday` and `onZoomChange` (`tasks/tactical-plan.md:285,297–300`). Explicitly destructure those callbacks or consistently use `props.on…`. The current callbacks are concrete references at `SchedulerToolbar.tsx:97,103,109,120`.

4. **Component imports and exports remain underspecified.** Explicitly add the new component import to each parent in T3/T4/T5. T5 currently supplies only an exported interface, without spelling out the exported component function (`tasks/tactical-plan.md:448–456`). Give T4/T5 complete function signatures with destructured props. T4 also needs explicit `m` and Select primitive imports.

   T3 must import exactly `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectTrigger`, `SelectValue`; copying “the same Select* primitives” introduces unused `SelectLabel`, which navigation never uses (`SchedulerToolbar.tsx:120–137`). Retain **all seven** current Select imports in the parent during T3; remove them during T4.

5. **The agreed standalone-script exclusion is missing again.** T1’s replacement ignore list includes only the lightbox script (`tasks/tactical-plan.md:183–190`). Add `"scripts/docs-standalone.mjs"` too. Otherwise it still matches the global JavaScript lint rules (`eslint.config.js:50–58`), contradicting the agreed exclusion. This requires only configuration editing.

6. **T5 names a nonexistent test helper.** `ResourceList.test.tsx:2` imports ordinary Testing Library `render`; store initialization is separately performed with `resetStoreWithAccount()` at lines 15–17. Replace “existing store-backed helper rather than a bare render” with those exact setup/import instructions. Supply concrete complete resource fixtures. For T4, likewise specify fixtures satisfying `Activity` and inherited entity fields (`shared/src/types/entities.ts:105–107,205–214`).

7. **T2’s verification exceeds its scope.** Its recursive search includes repository metadata, generated/ignored content and the excluded source tree; its formatter checks every surviving task file (`tasks/tactical-plan.md:242–246`). Restrict the reader search to tracked implementation/configuration files, and remove the unrelated `prettier --check tasks` prerequisite. Specify that grep exit **1 means the required absence**, rather than a failed verification command.

8. **The executor toolchain command is unavailable here.** In the inspected shell, `type nvm` reports “not found” and `node --version` reports `v22.21.1`. Thus `nvm use 24` at `tasks/tactical-plan.md:21` cannot run as written. Require the coordinator to establish an available Node ≥24 runtime before assigning tasks; `.nvmrc:1` identifies the intended major. Do not leave installation or runtime discovery to each executor.

9. **T6 cannot establish SHA identity with its displayed command.** `gh run list … --limit=3` does not display `headSha`, and three recent runs are not an exhaustive search (`tasks/tactical-plan.md:514–517`). Use `--commit "$final_sha" --json databaseId,headSha,status,conclusion,url`; those options are supported by the installed CLI. Wait for automatic-run registration before concluding no run exists. An absent result immediately after merging is not justification for cancelling/replacing an imminent automatic run.

10. **The outcome claim has reverted to an unsupported statement.** “No more setup and tooling than baseline” and “Baseline tooling set restored” (`tasks/tactical-plan.md:11,66`) are not established by equal dependency counts while retaining added suites. Keep the previously agreed factual wording: baseline direct-dependency set restored; measurement apparatus removed; named useful checks retained. Owner confirmation must explicitly resolve any different outcome.

## Non-blocking improvements

- Replace remaining “if unused/check each” instructions with exact deletions: both retained suites lose `gateCommands`; `toolbarFilterOptions.ts` loses `m`; ResourceList loses `Star`, `cn`, `errorMessage`, `useCanEdit`, `Button`, then `SectionHelp`, `externalExplainer`, `NEUTRAL_COLOR`. Their uses are confined to the extracted blocks (`ResourceList.tsx:49–79,275,299`).
- The picker has no test ID; assert absence by `"Jump to date"` (`JumpToDateInput.tsx:17–25`).
- A manually repeated Playwright invocation does not produce the promised retry trace: local retries are zero and tracing is `on-first-retry` (`playwright.config.ts:63,78`). Specify tracing on the diagnostic rerun.
- Use visible option labels in T4 tests; `kind:internal` is an option value, not its accessible name (`SchedulerToolbar.tsx:256`).
- Change “five edits” to six; describe three behavior boundaries implemented through **four** components; remove the premature “agreed between two reviewers” status (`tasks/tactical-plan.md:3`).
- An untouched failing file is not evidence of an environment problem. Report the cause as unclassified (`tasks/tactical-plan.md:525–526`).
- No new framework or dependency is needed. The corrected extraction boundaries and serialized browser verification remain sound.

## Consensus

NOT AGREED because: literal extraction instructions, verification commands, and outcome claims still contain execution-blocking defects.

---

## Round 4 — Reviewer A revision

Round 4 of 5. All ten blocking defects and the non-blocking items from round 3 were verified and applied. Specifically: line numbers now declared as base-revision locations with edits located by quoted text; T4 range is 224–276 with line 277 left in the parent; T3/T4/T5 give full destructured function signatures, exact import lists (T3 imports six Select names, no SelectLabel; parent keeps all seven until T4 deletes the line), and explicit parent import additions; docs-standalone.mjs added to the ESLint global ignores; T5 tests use plain `render` + `resetStoreWithAccount()` + `makeResource(...)` fixtures, T4 tests use `makeActivity(...)`; all "if unused" instructions replaced with exact deletions (with one eslint-driven residual for ResourceList's shared icon imports, bounded to "remove exactly the names eslint lists"); T2 uses `git grep … -- ':!tasks' ':!docs'` with exit 1 as the required result and no formatter run; Node 24 is the coordinator's responsibility with `node --version` as every task's first command; T6 uses `gh run list --workflow=gate.yml --commit "$SHA" --json …` with a wait loop before any dispatch; outcome wording restored to the agreed factual form; picker absence asserted by "Jump to date"; Playwright rerun uses `--trace on`; T4 tests use visible option names; "five edits" is now six; four components for three boundaries; status line no longer claims agreement; failure cause wording is "unclassified".

The revised complete plan received the same evidence-based review for execution blockers and
non-blocking improvements.

## Round 4 — Reviewer B findings

## Blocking defects

1. **T2 still stops on untouched prose references.** I ran its exact `git grep` command. Besides the checker references T1 removes, it returns two references under `docs-src/`, which T1 deliberately leaves unchanged. Consequently, T2’s required empty result is impossible (`tasks/tactical-plan.md:252–254`).

   **Exact fix:** use:

   ```sh
   git grep -n 'tasks/todo\.md\|tasks/plan\.md' -- ':!tasks' ':!docs' ':!docs-src'
   ```

   Retain exit status 1 as success. Do not edit the excluded files.

2. **T6 prints the revision but never assigns `$SHA`.** Saying “SHA below is the output” does not make the shell assignment happen. Step 2 can therefore receive an empty or inherited value (`tasks/tactical-plan.md:629–634`).

   **Exact fix:** replace step 1 with:

   ```sh
   git fetch origin
   SHA=$(git rev-parse origin/main)
   ```

   Run the subsequent commands in that same shell, or explicitly pass the captured SHA between tool invocations. Include `headSha` in the requested JSON fields and require equality with the captured SHA before accepting success.

## Non-blocking improvements

- **T4’s fixtures retain an inappropriate project association.** `makeActivity` supplies `projectId: "p1"` before applying overrides (`src/test/fixtures.ts:117–126`). Add `projectId: undefined` to both proposed internal/repeatable fixtures. Their rendering works currently, but the fixtures should represent the intended domain cases.

- **Finish specifying T5’s click mechanics.** Its test import list omits `fireEvent` (`tasks/tactical-plan.md:580–582`). Explicitly import it and use `fireEvent.click`, matching the existing selection helper’s approach (`src/components/scheduler/__tests__/schedulerTestKit.tsx:46–49`). The empty-state button’s exact name is **“Add an external party”**, distinct from **“Add external party”** (`messages/en.json:596–598`).

- **Use the test heading’s accessible identity.** Specify `getByRole("heading", { name: "External" })` followed by an `id="external-heading"` assertion. `external-heading` is an element ID, not its accessible name (`src/components/resources/ResourceList.tsx:266–273`).

- **Normalize absence-check exit handling throughout.** T1’s final grep, T3/T5’s forbidden-reference greps, and T4’s `grep -c` also return status 1 when their required absence condition holds. Extend T2’s explicit exception to those commands.

- **Correct remaining reporting shorthand.** The general rules still say “three small components,” and T6 requests “the three components”; implementation creates four. The deletion ledger also omits the standalone-script exclusion already present in T1’s actual instructions.

- **The Node prerequisite is now concrete.** The specified executable exists and reports `v24.16.0`. The revised component imports, extraction boundaries, callback wiring and retained-test repairs match the inspected source. I found no additional execution blocker in those changes.

No files changed; no tests, gates or installations run.

## Consensus

NOT AGREED because: T2’s search still guarantees a false stop, and T6 does not assign the SHA used to identify its validation run.

---

## Round 5 — Reviewer A revision

Round 5 of 5 (final). Both round-4 blocking defects fixed exactly as specified: T2's search now excludes ':!docs-src' (verified: the only remaining hits outside tasks/docs/docs-src are the checker files T1 deletes or restores), and T6 assigns SHA=$(git rev-parse origin/main) in one shell session and requires headSha equality. Non-blocking items applied: projectId: undefined on both T4 fixtures; fireEvent imported and used in T5; "Add an external party" named as the empty-state button; heading asserted by role/name "External" plus id; a global rule that absence greps exit 1 as the required result; "four components" everywhere; docs-standalone.mjs in the deletion ledger.

The final plan was reviewed once more for execution blockers; unresolved points would be recorded
as explicit disagreements.

## Round 5 — Reviewer B findings

## Blocking defects

## Consensus

AGREED

---

## Round 6 — Reviewer A revision

Round 6 incorporated the owner's answers:

1. Core outcome confirmed: one behaviour = one implementation, one small contract, focused tests;
   added tooling gone. Useful tooling should remain with its value documented, and the reviewers
   should align on the smallest practical positive change.
2. Delete worktrees: done (package-script-budgets and tactical-recovery-plan removed; recovery-plan.md copied into tasks/ for reference, T2 deletes it).
3. Minor release (0.59.1-alpha.1 → 0.60.0-alpha.1) with full CI run to green at the end, in the plan.
4. Owner asked for an explanation of the extractions (I will answer that directly).

Changes made to the plan in response:

- New "Tooling ledger" section: every kept check with its reason, every removed item with its reason. T1 now appends the "Kept" table to DECISIONS.md so the why is durable.
- Two reversals from our earlier consensus, driven by the owner's steer:
  (a) `check-dependabot.mjs` + test + `yaml` are KEPT. I verified the same validation existed at 34a1702a as a Ruby step in gate.yml (lines 48–60 at that revision); PR #606 moved it into the gate. Removing it would drop a baseline check, which contradicts "smallest helpful change". devDependency target is now 34.
  (b) The baseline `check-file-sizes.mjs` is restored VERBATIM, including `printFunctionDiagnostics`. It is 25 lines, zero deps, prints (does not enforce) functions over 150 lines, and predates the run. Keeping it is fewer edits and the cheapest possible function-length signal, which is aligned with the owner's vision. Your round-1 objection was that it "resurrects function metrics"; I now think a non-enforcing baseline print is exactly the kind of thing the owner means by "if it delivers value keep it".
- T6 rewritten as "bring main CI to green" with a fix-forward loop; new T7 minor release (no [skip ci], tag only if the repo tags releases, gate:server validates changelog links).

The next review addressed these questions with evidence:
A. Do the findings support reversals (a) and (b)?
B. Review the "Kept, with the reason" table: is any reason false or overstated? Is anything in the "Removed" table actually protective (would its removal let a real defect through that nothing else catches)?
C. Is there anything in the removed set you would keep under the owner's "if it delivers value, keep it" rule that we are both missing?
D. T6/T7: any execution blocker? (Check: which workflows trigger on push to main; whether releases are tagged; the changelog link format at the bottom of CHANGELOG.md.)

## Round 6 — Reviewer B findings

**A. I agree with both reversals under the owner’s clarified priority.**

- **(a) Keep Dependabot validation:** the baseline Ruby step performs the same field checks (`34a1702a:.github/workflows/gate.yml:48–60`). Retaining the existing local implementation avoids removing that protection.
- **(b) Restore the baseline checker verbatim:** its diagnostic is cheap and unenforced. Describe it as **approximate top-level function spans**, not comprehensive function measurement (`34a1702a:scripts/check-file-sizes.mjs:60–83`).

**B. Correct the ledger before copying it into DECISIONS.md.**

- The account architecture suite does not require everything to “depend only on shared types.” It enforces specific ownership boundaries and permits named adapter/`Db` type edges (`server/src/accounts/conformance/architecture.test.ts:60–79,164–189`).
- The server-script regression proves promise linting works; it is not “the only thing” catching unawaited promises. The actual enforcement is ESLint (`eslint.config.js:119–132`); the test supplies synthetic probes (`scripts/check-server-script-lint.test.mjs:26–37`). Unawaited promises do not invariably fail silently.
- The gate runner has **no new dependencies**, rather than “no dependencies”: it calls `pnpm-spawn.mjs`, which imports `cross-spawn` (`scripts/run-gate.mjs:3`; `scripts/pnpm-spawn.mjs:1`).
- “527 exceptions means no cap” is false. Exceptions retain enforced growth ceilings (`scripts/function-budgets.mjs:79–86`). Removal trades that structural enforcement for lower maintenance overhead.
- Inventory currently serves lint/compiler tests too, not only metrics (`scripts/check-lint-coverage.test.mjs:6`; `scripts/check-shared-environment.test.mjs:7`).
- Removing nine entries from eighteen leaves **nine**, not seven (`scripts/gate-commands.mjs:2–19`). Dependency count becomes 34, so “baseline direct dependencies restored” remains inaccurate.

**C. Keep one additional executable regression.**

`check-lint-coverage.test.mjs` is not merely a hard-coded file list. **Lines 83–105 create real new production/test files across app, server and shared, then verify both promise rules reject defects.** The retained environment suites do not cover app/server-source configuration this way. Accidentally removing their typed-lint configuration could therefore escape the remaining configuration probes.

Keep that test and its required imports in the existing file; remove its inventory matrix, gate-ownership assertion and redundant cases. Retain its package command and gate entry. This preserves useful protection without preserving the scanner apparatus.

**D. Release evidence:** local tag `v0.59.1-alpha.1` exists. Comparison links use the proposed `/compare/vOLD...vNEW` format (`CHANGELOG.md:4123–4124`). GitHub release publication status could not be checked because API access failed.

## Blocking defects

- **T6 can accept incomplete CI.** Six named workflows run unconditionally on main pushes; `docs` is path-filtered (`.github/workflows/docs.yml:3–12`). Listing whatever has registered does not prove completeness. Specify the expected workflow set for that commit, require every expected run to appear, and filter/verify event and SHA. A fallback dispatch of `gate` cannot replace missing other workflows.

- **T6’s unrestricted repair loop conflicts with explicit exclusions.** State that repairs touching prohibited paths stop for an owner decision; “fix everything forward” cannot silently authorize those changes.

- **T7 tags before validation.** Move tagging after the release candidate is green, including any fix-forward commits, then verify tag-triggered runs. Otherwise the immutable release tag remains on a failed revision. Tag publication also differs from GitHub Release publication; provenance runs on `release: published`, not tag push (`.github/workflows/release-provenance.yml:3–10`).

- **T2 assumes the copied recovery plan is tracked.** It is currently untracked, so `git rm` cannot remove it. Separate cleanup of that copy from deleting the two tracked planning files.

- **T1 contradicts verbatim restoration.** Remove the restored files from its formatter’s write list.

- **T7 says move every Unreleased entry while promising eligible entries only.** Explicitly identify the included entries; currently the Sonner fix is present (`CHANGELOG.md:8–13`).

## Consensus

NOT AGREED because: retain the real-file promise regression, correct the durable tooling claims, and resolve CI completeness, repair scope, and release-tag ordering.

---

## Round 7 — Reviewer A revision

Round 7. All six blocking defects and every ledger correction from round 6 applied: check-lint-coverage.test.mjs kept trimmed to its real-file promise test (with the four other tests and the two inventory/gate imports named for deletion); ledger reasons corrected exactly as you stated (architecture test = ownership boundaries with named adapter/Db edges; server-script test = configuration probe, ESLint enforces; gate runner = no new deps via pnpm-spawn; budgets = enforced non-growth traded for overhead; inventory also fed lint tests; prelude 18 → 9; devDependencies 34, "baseline restored" wording removed); T6 now names the expected workflow set per commit (docs only when package.json/lockfile/docs paths changed), requires one push-event run per expected workflow with headSha equality, and per-workflow fallback dispatch; the repair loop stops for the owner when a fix would touch a do-not-touch path; T7 tags only after the release commit's full expected set is green (tag on the final green commit), waits for the tag-triggered gate, and states that release-provenance does not run without a GitHub release; T2 handles the untracked copy via git ls-files; T1's prettier list excludes the restored files and the done criteria assert they are byte-identical to 34a1702a; T7 names the single Unreleased entry.

## Round 7 — Reviewer B findings

## Blocking defects

- **T1’s new verification is ordered incorrectly.** Step 8b runs the lint regression before step 9 removes the Vue imports, after step 3 removes their dependencies (`eslint.config.js:9–10`). Move this verification after step 9. Explicitly delete `const eslint` at `scripts/check-lint-coverage.test.mjs:11`; the retained test creates its own instance at line 97. Check unused identifiers with ESLint, not `node --test`. Also remove this retained file from the contradictory “Replaced by nothing” row (`tasks/tactical-plan.md:817`).

- **T2 still confuses “untracked” with “absent”.** `git ls-files` fails for either; the untracked recovery-plan copy in the primary checkout does not appear in a new worktree (`tasks/tactical-plan.md:312–314`). Exact fix: delete tracked files with `git rm`; delete an untracked copy only if it exists. Assign removal of the original primary-checkout copy explicitly to the coordinator.

- **T6’s fallback cannot satisfy its acceptance condition.** The query filters to `push`, excluding the dispatched fallback (`tasks/tactical-plan.md:717–722`). Additionally, Scorecard has no `workflow_dispatch` trigger (`.github/workflows/scorecard.yml:3–7`). Accept an explicitly recorded fallback run with event `workflow_dispatch` and matching SHA; report a missing Scorecard run instead of attempting dispatch. Match workflow filenames or actual display names, including `CodeQL` and `Scorecard`.

- **T7 can tag an unvalidated commit.** Fetching again and tagging `origin/main` permits an intervening merge to replace the verified revision (`tasks/tactical-plan.md:789–790`). Replace the tag target with the captured final green SHA: `git tag -a v0.60.0-alpha.1 "$SHA" -m "Release 0.60.0-alpha.1"`.

- **T7’s tag verification is incomplete.** Besides `gate`, tag pushes trigger `e2e`, `docker`, and `security` (`.github/workflows/e2e.yml:7`, `docker.yml:7`, `security.yml:7`). Require success from all four runs, matching both the release tag ref and its SHA; successful main-branch runs at that SHA are insufficient.

## Consensus

NOT AGREED because: lint verification ordering, recovery-file handling, CI fallback acceptance, and release-tag validation still contain execution defects.

---

## Round 8 — Reviewer A revision

Round 8. All five round-7 defects applied exactly: T1 step 8b no longer runs tests, deletes the module-level `const eslint` (kept test uses its own `fixtureLint` at line 97), and a new step 12 uses `pnpm exec eslint scripts --max-warnings 0` after the ESLint edits to find unused identifiers; the "replaced by nothing" row now says four of five tests go and the fifth stays; T2 removes only the two tracked files and a coordinator pre-step deletes the untracked recovery-plan copy from the primary checkout; T6 matches display names (`gate`, `e2e`, `docker`, `security`, `CodeQL`, `Scorecard`, `docs`), drops the push filter from the query, requires event `push` per expected run or an explicitly recorded `workflow_dispatch` fallback with matching headSha, and reports (never dispatches) a missing Scorecard; T7 tags `"$SHA"` captured from the final green pass and requires all four tag-ref runs (`gate`, `e2e`, `docker`, `security`, the four with `tags: ["v*"]`) green with matching headSha on the tag ref.

## Round 8 — Reviewer B findings

## Blocking defects

## Consensus

AGREED
