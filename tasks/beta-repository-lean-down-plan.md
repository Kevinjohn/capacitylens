# Beta repository lean-down plan

## Purpose

Prepare CapacityLens for beta by aligning the repository with the product that exists now: preserve
intentional capability and proven safeguards, while removing duplicated ownership, accidental
layers, obsolete working artefacts, and process-driven complexity that does not improve the user
experience or the safety of future changes.

This is not primarily a line-count reduction exercise, a feature-removal programme, or an attempt to
make a working application aesthetically tidy. It asks whether the repository's complexity reflects
the product or the process that produced it.

The programme should make it possible to look at any part of the repository and answer:

- Which module owns this behaviour?
- Does this seam represent real variation?
- Does this compatibility path serve a real user or operator?
- Does this test protect a distinct guarantee?
- Is this document still authoritative?
- Can a maintainer change the behaviour in one coherent place and obtain proportionate evidence
  that the result is safe?

Success is not a smaller repository by itself. Success is a repository that feels intentionally
designed: each behaviour has one obvious owner, callers cross small and useful interfaces, retained
complexity earns its place, and historical implementation machinery does not silently become a
permanent obligation.

## Fixed exclusions

This programme does not decide or change:

- OIDC or SSO architecture;
- Better Auth configuration or integration design;
- authentication modes or deployment profiles;
- provider linking or federated-identity behaviour;
- password, MFA or session policy;
- SSO readiness, cutover or recovery behaviour;
- database schemas or released migrations;
- public routes, payloads or persisted identifiers.

An SSO-related import may move as part of a directory move, but its implementation and behaviour
remain untouched. Removing or retaining OIDC is a separate product and architecture decision.

## Working principles

1. **Reduce concepts, not merely files.** A change must reduce the responsibilities, interfaces or
   reading context a maintainer encounters. Moving code without clarifying ownership is not enough.
2. **Preserve deliberate duplication.** Client permission projection and server authorization,
   in-memory and SQLite adapters, Members and scheduled Resources, and released migration evidence
   have distinct responsibilities.
3. **Allow a no-change result.** An investigation may conclude that an existing seam or test is
   justified. The programme must not manufacture refactoring work to satisfy a deletion target.
4. **Keep structural and behavioural changes separate.** If cleanup exposes a defect, prove and fix
   that defect in its own change rather than hiding it inside a refactor.
5. **Do not replace old complexity with new frameworks.** No new dependency-injection framework,
   result vocabulary, command executor, compatibility wrapper or governance layer should be added
   without a demonstrated reduction in caller knowledge.
6. **Preserve valid intermediate states.** Each pull request must leave `main` releasable and must
   follow the repository's ordinary delivery rules.
7. **Judge tests by guarantees.** Similar-looking tests at different layers may prove different
   properties. Remove a test only when retained evidence catches the same failure.

## Programme shape

The programme consists of three recommended implementation candidates, one evidence-gated
investigation, and two optional follow-ons. It is not a fixed pull-request count: investigation may
correctly produce no code change.

| Order | Work                                              | Expected result                                    | Risk                                     | Commitment                      |
| ----: | ------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- | ------------------------------- |
|     0 | Verify current ownership and validation baselines | Exact implementation footprint                     | Low                                      | Required                        |
|     1 | Move Team implementation out of Settings          | Clear product ownership                            | Low–medium                               | Recommended                     |
|     2 | Deduplicate verification within an integrated run | Faster, clearer validation                         | Medium                                   | Recommended                     |
|     3 | Assess the existing Team client seam              | Proved simplification or explicit no-change result | Low investigation; medium implementation | Evidence-gated                  |
|     4 | Review affected Team tests                        | Remove only demonstrated overlap                   | Medium                                   | Follow-on                       |
|     5 | Retire completed tracked task records             | Less stale context                                 | Medium                                   | Recommended after status checks |
|     6 | Reassess the file-size policy                     | Evidence-based decision                            | Low investigation                        | Optional                        |
|     7 | Review scheduler tests                            | Separate capability-specific audit                 | Medium                                   | Deferred                        |

Calendar estimates should follow the initial inventory. A fixed estimate made before the import,
validation and historical-plan footprints are known would not be reliable.

## Stage 0: verify the evidence

This is a short read-only preparation step, not a new repository document or enforcement project.

### Tasks

1. Refresh `origin/main` and record the exact base revision.
2. Build the current import graph for:
   - `src/components/team`;
   - Team-related files under `src/components/settings`;
   - `src/account/teamAccessClient.ts`;
   - `src/account/accountClient.ts`;
   - `src/account/accessResult.ts`;
   - Team hooks and mutation modules.
3. Catalogue path-sensitive machinery:
   - file-size exceptions;
   - coverage inventories;
   - architecture tests;
   - security inventories when relevant;
   - mocks using literal module paths;
   - documentation and story references.
4. Inventory the actual validation entry points:
   - local aggregate commands;
   - standalone application and server gates;
   - pre-push hooks;
   - GitHub workflows;
   - release workflows;
   - documentation checks.
5. Confirm whether the work is governed by the special `tasks/plan.md` programme. The default
   assumption is that it is not.

### Output

Prepare a short implementation brief for the first pull request containing:

- base commit;
- exact file footprint;
- preserved interfaces;
- focused tests;
- path-sensitive ledgers;
- known exclusions.

### Acceptance

No consequential implementation assumption remains based only on filenames or the initial audit.

## PR 1: give Team & access clear repository ownership

### Outcome

Ordinary Team administration lives under `src/components/team`, matching the `/team` route and the
product's current information architecture. This is a source move, not a Team redesign.

### Initial move set

Use the following as a seed list, then complete the footprint through imports and references:

- `MembersSection`;
- `MemberRow`;
- `MemberActionsDialog`;
- `MemberConfirmations`;
- `MemberResourceLink`;
- `InviteMemberPanel`;
- `buildMemberDirectoryPresentation`;
- `createMemberAccessReconciliation`;
- `createMemberCredentialMutations`;
- `createMemberMutations`;
- `memberActionDependencies`;
- `memberConfirmationCopy`;
- `useMemberInvites`;
- `useMembersOrchestration`;
- `useTeamDirectory`;
- associated tests and test support.

### Explicit exception

Leave these files in their existing location for now:

- `SsoReadinessPanel`;
- `ssoReadiness`;
- their tests.

The Team module may continue importing that bounded SSO implementation. Do not invent a new adapter
merely to make the directories perfectly pure.

### Execution

1. Create an isolated feature worktree from current `origin/main` and activate the `.nvmrc` Node
   version.
2. Move production files and their tests together.
3. Update imports, mocks and literal path assertions.
4. Update file-size exception paths and other path-keyed inventories when applicable.
5. Update architecture and coverage rules that name the old paths.
6. Update the relevant Task navigation entry in `docs-src/reference/development.md`.
7. Do not add forwarding modules at the old paths.
8. Do not rename translation keys in this change.
9. Do not alter visible labels, test IDs, permissions or network requests.

### Preserved guarantees

- Owner, Admin, Editor and Viewer visibility and actions remain unchanged.
- Initial directory `403` remains distinct from loss of access after a directory was loaded.
- A transient failure with an authorized cached directory remains distinct from revoked access.
- Account changes continue to suppress stale results.
- Invitation secrets remain write-once.
- Client visibility remains a courtesy; server authorization remains authoritative.
- SSO readiness behaviour remains unchanged.

### Acceptance criteria

- `TeamAccessView` imports ordinary Team administration from its own module.
- Settings no longer owns member, invitation, role or Resource-association UI.
- No production implementation exists at both old and new paths.
- The unchanged SSO dependency is explicitly documented as an exception.
- No server route, wire contract, visible label or test ID changes.

### Verification

Run focused checks first:

- moved Team component and hook tests;
- `TeamAccessView.test.tsx`;
- invitation and member orchestration tests;
- import-cycle policy;
- file-size policy;
- affected Team browser tests.

Before submission, run the repository's ordinary required application, server, browser and
documentation checks on the final revision.

### Risk and impact

**Risk: low–medium.** Runtime logic should remain unchanged, but path-based tests and policy ledgers
may encode old filenames.

**Impact: high.** This removes the clearest product/repository ownership mismatch and establishes a
coherent place for later Team work.

## PR 2: deduplicate verification within an integrated run

### Outcome

Shared structural checks do not execute twice during one normal integrated validation run.
Standalone commands retain clear, documented guarantees.

The objective is not to make every check run exactly once everywhere. Independently runnable CI
jobs may legitimately overlap for isolation, security or clearer failure reporting.

### Preparation

Catalogue every current caller of:

- `pnpm run gate`;
- `pnpm run gate:server`;
- structural policy commands;
- the crypto inventory;
- dependency checks;
- format, type-check and lint commands.

For each entry point, identify whether it promises complete repository verification, application
verification, server verification, one narrow policy check or isolated CI evidence.

### Design direction

Preserve familiar public command names unless changing them provides a demonstrated benefit.
Prefer the minimum internal factoring required to provide:

- one callable shared structural sequence;
- one unambiguous full local validation path;
- independently useful application and server checks with accurately documented scope.

Do not introduce a new hierarchy of commands merely for aesthetic consistency.

### Execution

1. Produce a table of checks and current entry points.
2. Identify duplicate execution within the normal local full-validation path.
3. Identify duplicate execution within individual CI jobs.
4. Extract only the genuinely common sequence.
5. Preserve independently isolated CI checks where they provide a real benefit.
6. Update all affected callers atomically, including:
   - `package.json`;
   - `scripts/gate-commands.mjs`;
   - runner tests;
   - GitHub workflows;
   - pre-push configuration;
   - the pull-request template;
   - `AGENTS.md`;
   - contributor documentation.
7. Add a table-driven test that asserts every required guarantee remains present.
8. Test non-zero exit propagation from every composed command.
9. Measure the normal full-validation path before and after.

### Acceptance criteria

- No check disappears from the normal full-validation path.
- Standalone command guarantees are documented accurately.
- The same structural sequence does not run twice within one recorded local validation.
- Results are never reused after the working revision changes.
- Failure propagation and fail-fast behaviour remain correct.
- CI job independence is preserved where intentional.
- Crypto inventory placement is explicitly resolved rather than accidentally duplicated or
  removed.

### Risk and impact

**Risk: medium.** Rearranging orchestration can silently weaken a gate while every individual
script continues to exist.

**Impact: potentially high.** The change should proceed only if the inventory confirms meaningful
duplicate work in the actual developer or CI path.

## Investigation 3: assess the existing Team client seam

### Corrected premise

The repository already has:

- a typed Team boundary in `teamAccessClient`;
- a shared discriminated `TeamAccessResult`;
- central command construction and outcome tracking;
- operation-specific reconciliation in Team mutation modules.

The question is therefore not how to create a typed interface. It is whether the existing
`accountClient` to `teamAccessClient` split adds unnecessary reading context or represents a useful
transport/decoding separation.

### Tasks

1. List every production caller of:
   - `accountClient`;
   - `teamAccessClient`;
   - `accessResult`;
   - `commandRequest`;
   - `commandOutcome`.
2. For every Team operation, record:
   - transport owner;
   - response-decoding owner;
   - command-outcome owner;
   - operation-specific reconciliation owner;
   - user-message owner.
3. Identify only concrete leaks or duplication:
   - Team callers branching on raw HTTP statuses;
   - repeated response decoding;
   - repeated operation-key construction;
   - multiple implementations of unknown-outcome detection;
   - forwarding methods that add no policy or reuse.
4. Apply the deletion test: if a module were deleted, would its complexity disappear or spread into
   several callers?
5. Select at most one low-risk pilot if the evidence supports it.

### Behaviours to preserve

- Unsupported directory rows may be dropped while a wholly unusable response is rejected.
- Initial authorization failure differs from revoked access after a successful read.
- Transient failure with a valid cached directory does not impersonate revoked access.
- Account changes suppress stale asynchronous results.
- Existing stale-result suppression is not assumed to be transport cancellation.
- Unknown password-reset outcome differs from a successful response whose one-time token cannot be
  recovered.
- Self-session revocation retains its required reload behaviour.
- Changing the current member's role invalidates caller access appropriately.

### Excluded from an initial pilot

- password-reset administration;
- session administration;
- ownership transfer;
- provider operations;
- SSO readiness and repair;
- personal account security.

### Permitted outcomes

1. **No change.** The current separation is justified; record that conclusion in the delivery
   report and stop.
2. **Remove a pass-through.** Move one proven no-value forwarding method or decoder, update its
   callers and delete the superseded code.
3. **Correct a small seam.** Narrow an existing interface because callers currently learn transport
   details they should not know.

A second executor, result vocabulary or dependency-injection framework is not an acceptable
default outcome.

### Acceptance for any implementation

- The change demonstrates fewer responsibilities or fewer caller-known concepts.
- Existing result distinctions remain stable unless a separately proved defect requires change.
- Operation-specific reconciliation remains with its correct owner.
- No new cancellation model is introduced without separate justification.
- The pull request includes a before-and-after reading-context comparison.
- Required focused and full validation passes.

### Risk and impact

**Risk:** low if the result is no change; medium for a bounded pilot.

**Impact:** evidence-dependent. The work must not proceed from the assumption that consolidation is
automatically simpler.

## Follow-on 4: review Team tests by guarantee

Start this only after the Team move and the client assessment are complete.

### Scope

Review only tests affected by Team ownership or an accepted client pilot:

- `MembersSection.*`;
- `InviteMemberPanel`;
- `useMemberInvites`;
- `useTeamDirectory`;
- `TeamAccessView`;
- Team client tests;
- relevant member and invitation browser tests.

Scheduler tests are not included.

### Method

1. Create a temporary guarantee map during the review.
2. Map each test to the failure it detects.
3. Compare decoder/unit, hook/orchestration, component and browser coverage.
4. Remove a test only when retained evidence catches the same failure and the removed layer adds no
   distinct integration guarantee.
5. Use focused fault injection only where equivalence is uncertain.
6. Do not require mutation testing for every deletion.
7. Consolidate repeated fixture construction only when it improves clarity.
8. Allow retaining every test as a valid result.

### Acceptance criteria

- Every deletion names the retained evidence for its guarantee.
- Permission and role matrices remain complete.
- Initial authorization, revoked authorization, transient failure and account switching remain
  covered.
- Command uncertainty and one-time-secret behaviour remain covered at their owning layer.
- Browser tests retain their distinct end-to-end guarantees.
- No deletion target or line-count quota is used.

### Risk and impact

**Risk: medium.** Superficially similar tests often prove different seams.

**Impact: variable.** Continue only while the work produces a clear reduction in maintenance cost.

## PR 5: retire completed tracked task records

### Outcome

`tasks/` contains only active execution authority or genuinely useful operational references.

### Constraints

- `tasks/plan.md` currently has special authority in repository instructions; age does not prove it
  is complete.
- Do not touch untracked user files in the working checkout.
- Do not remove SSO design records in this programme.
- Prefer Git history to a new archive directory for completed implementation plans.

### Execution

For each tracked task document:

1. Find every incoming reference.
2. Check associated issue and pull-request state.
3. Determine whether implementation is actually complete.
4. Extract any standing decision not already present in:
   - `AGENTS.md`;
   - `DECISIONS.md`;
   - contributor documentation;
   - user stories;
   - executable policy.
5. Classify the document as active authority, operational reference, completed, superseded or
   unresolved.
6. Delete only records proved completed or superseded.
7. Remove or update live references.
8. Do not create an archive directory unless an external audit requirement demands one.

### Acceptance criteria

- Every deletion has completion evidence.
- No live incoming reference is broken.
- No standing rule is lost.
- Active programme authority remains intact.
- Untracked files remain untouched.
- Applicable formatting, content and link checks pass.

### Risk and impact

**Risk: medium.** Old plans can contain requirements that were never promoted into standing
documentation.

**Impact: medium.** Removing completed records reduces misleading context for future maintainers and
automated contributors.

## Optional investigation 6: reassess the file-size policy

Do not begin with a replacement threshold. First establish whether the 400-line rule has caused
harmful fragmentation.

### Sample

Inspect several near-limit clusters, including:

- `accountClient.ts`;
- `MembersSection.tsx`;
- scheduler viewport and gesture modules;
- server route modules;
- common dialog modules.

### Questions

- Is the interface larger because of the split?
- Do responsibilities cross file boundaries unnecessarily?
- How many files must be read to change one behaviour?
- Would a larger cohesive module improve locality?
- Do justified exceptions already solve the problem?

### Permitted outcomes

- keep the rule unchanged;
- retain the rule with specific justified exceptions;
- make the threshold advisory;
- propose a replacement only after concrete examples establish a better policy.

No file-size policy change is required for programme completion. In particular, do not replace one
arbitrary threshold with another unsupported threshold.

## Deferred investigation 7: scheduler test structure

Scheduler geometry and Team administration are unrelated capabilities and must not share a cleanup
pull request or completion criterion.

If later prioritised, review:

- the scheduler-model test ledger;
- gap-fill suites;
- allocation interaction suites;
- overlap with browser geometry tests.

Use scheduler invariants rather than general test-size goals to decide whether consolidation is
useful. Retaining the current structure remains a valid outcome.

## Dependency order

```text
Stage 0: Evidence inventory
    |
    +--> PR 1: Team ownership move
    |        |
    |        +--> Investigation 3: Team client seam
    |                  |
    |                  +--> Follow-on 4: Team test review
    |
    +--> PR 2: Validation deduplication
    |
    +--> PR 5: Completed task-record cleanup

Optional after evidence:
    - File-size policy reassessment
    - Scheduler test review
```

PR 2 can proceed independently of PR 1 after the Stage 0 inventory. The Team test review must wait
until the Team move and client assessment finish so tests are not rewritten twice. Task-record
cleanup must wait for issue, pull-request and programme-status confirmation.

## Delivery protocol

For every implementation change:

1. Fetch current `origin/main`.
2. Create a unique `feature/<description>` branch and isolated sibling worktree.
3. Activate the Node version from `.nvmrc` and verify it before Node or pnpm commands.
4. Run focused checks while implementing.
5. Review the complete branch diff and outgoing public content.
6. Run the repository's applicable full validation on the final revision.
7. Commit with the required sign-off.
8. Push and open one ready pull request for the cohesive change.
9. Merge only after required review and evidence pass.
10. Verify the merge, linked issue where applicable, remote branch deletion and safe local cleanup.

Do not inherit `tasks/plan.md`'s programme-specific reduced validation or skip-CI policy unless the
work is explicitly brought under that programme. Run resource-intensive browser suites serially.

## Programme completion criteria

The core programme is complete when:

- ordinary Team administration has one obvious repository owner;
- repository verification no longer repeats shared work unnecessarily within a normal integrated
  run;
- the existing Team client seam has been evaluated from evidence rather than replaced by
  assumption;
- any test deletion is supported by retained guarantee evidence;
- completed tracked plans no longer pollute live context;
- no OIDC, SSO, Better Auth, database or public wire behaviour has changed;
- every delivered pull request passes the repository's ordinary required validation on its final
  revision.

The programme must retain the freedom to conclude that a particular seam, test or policy already
earns its place. The objective is deliberate architecture, not refactoring volume.
