# Beta repository lean-down plan

Status: revision 2, agreed 19 September 2026 after independent review. Base: `61695e1b`.
AGENTS.md governs delivery, validation and everything this plan does not say. This plan is not
governed by the `tasks/plan.md` programme exception. Retire this file when the completion criteria
below are met.

## Purpose

Align the repository with the product that exists now: preserve intentional capability and proven
safeguards, remove duplicated ownership, obsolete working artefacts and process-driven complexity.
Success is a repository where each behaviour has one obvious owner, retained complexity earns its
place, and historical implementation machinery does not become a permanent obligation. A smaller
repository by itself is not the goal; a no-change conclusion is a valid result for any
investigation.

## Fixed exclusions

This programme does not decide or change:

- OIDC or SSO architecture, readiness, cutover or recovery behaviour;
- Better Auth configuration or integration design;
- authentication modes, deployment profiles, provider linking or federated identity;
- password, MFA or session policy;
- database schemas or released migrations;
- public routes, payloads, persisted identifiers, visible labels, test IDs or translation keys.

An SSO-related import may be repointed as part of a directory move; its implementation stays where
it is and its behaviour is untouched.

## Working principles

1. Reduce concepts, not merely files. A change must reduce the responsibilities, interfaces or
   reading context a maintainer encounters.
2. Preserve deliberate duplication: client permission projection and server authorization,
   in-memory and SQLite adapters, Members and scheduled Resources, released migration evidence.
3. Keep structural and behavioural changes separate. A defect exposed by cleanup is proved and fixed
   in its own change.
4. Add no new framework: no dependency-injection layer, result vocabulary, command executor,
   compatibility wrapper, forwarding module or governance layer.
5. Every pull request leaves `main` releasable.
6. Remove a test only when retained evidence catches the same failure.

## Programme shape

Three pull requests, one read-only investigation, one conditional follow-on. Order reflects
evidence already in hand, cheapest and highest-value first.

| Order | Work                                           | Commitment                               |
| ----: | ---------------------------------------------- | ---------------------------------------- |
|     1 | PR A: retire completed tracked task records    | Required                                 |
|     2 | PR B: move Team administration out of Settings | Required                                 |
|     3 | Investigation C: Team client seam              | Required, read-only; no-change permitted |
|     4 | PR D: single-pass gate mode                    | Conditional on one measurement           |
|     5 | Follow-on E: Team tests by guarantee           | Only after B and C; retain-all permitted |

Dependencies: A, B and D are independent of each other. C depends on nothing (the client modules
live in `src/account/` and do not move). E depends on B and C so tests are not rewritten twice.

Deferred, not scheduled: file-size policy reassessment (select only if a concrete change is blocked
by the 400-line rule and `scripts/file-size-exceptions.json` cannot resolve it); scheduler test
structure (select only under a scheduler-invariant driven audit, never a general size goal).

## PR A: retire completed tracked task records

Facts (at `61695e1b`):

- `tasks/plan-780.md` declares itself landed and historical; #780 is closed.
- `tasks/plan-793.md` declares itself superseded; #793 is closed.
- `tasks/plan-968.md` still reads "implementation-ready"; #968 is closed.
- `tasks/test-coverage-plan.md` declares itself completed 2026-09-09.
- `tasks/documentation-screenshots.md` is the completed capture checklist for #1100; its control
  refresh section records #1143 and #1144, both closed.
- Issues #891, #926, #927 and #930 were filed against stale text in `plan-793` and `plan-780`.
- `AGENTS.md:316` names `tasks/plan.md`; `DECISIONS.md:384` names `tasks/conventions-audit.md`;
  `tasks/plan.md` names the other `conventions-*` files and #647 governs
  `strictness-structure-baseline.md`.

Fixed decisions:

- Delete `plan-780.md`, `plan-793.md`, `plan-968.md`, `test-coverage-plan.md`,
  `documentation-screenshots.md`.
- Keep `plan.md`, the four `conventions-*` files and `strictness-structure-baseline.md`; their
  programme is active authority until the owner closes it.
- Before each deletion, grep the repository for incoming references and read the file for a standing
  decision absent from `AGENTS.md`, `DECISIONS.md`, `docs-src/`, `user-stories/` or executable
  policy. Promote any such decision in the same PR; otherwise delete without an archive directory.
- Untracked files in any working checkout are out of scope.

Files: the five deletions plus any file holding an incoming reference. Done: no broken reference,
formatting and link review pass, delivery summary lists each promoted decision or states none.

## PR B: move Team administration out of Settings

Facts (at `61695e1b`):

- `src/components/team/` holds `TeamAccessView`, `OwnershipTransferCard`, `useOwnershipTransfer`
  and their tests. All Member and Invite modules live in `src/components/settings/`.
- Outside settings, only `src/components/team/TeamAccessView.tsx:8` and the mock at
  `TeamAccessView.test.tsx:17` import a settings member module.
- `src/components/settings/useMembersOrchestration.ts:14,20` import `useWorkspaceReadiness` and the
  `WorkspaceReadiness` type from `ssoReadiness`; `MembersSection.tsx:12` and
  `MemberConfirmations.tsx` import the SSO modules. These become cross-directory imports.
- `scripts/file-size-exceptions.json` names no settings member, team or `src/account` file.
- `docs-src/reference/development.md` has no Task-navigation entry keyed to these paths.
- `user-stories/REFERENCE.md:1225` and `docs-src/sso-cutover-design.md:1093-1095` name
  `settings/MembersSection.tsx` and `MembersSection.sso.test.tsx`.

Fixed decisions:

- Move to `src/components/team/`: `MembersSection.tsx`, its six `MembersSection.*.test.tsx` files
  and `MembersSection.testSupport.tsx`, `MemberRow`, `MemberActionsDialog`, `MemberConfirmations`,
  `MemberResourceLink`, `InviteMemberPanel` (+test), `buildMemberDirectoryPresentation`,
  `createMemberAccessReconciliation`, `createMemberCredentialMutations`, `createMemberMutations`,
  `memberActionDependencies`, `memberConfirmationCopy`, `useMemberInvites` (+test),
  `useMembersOrchestration`, `useTeamDirectory`.
- Stay in `src/components/settings/`: `SsoReadinessPanel`, `ssoReadiness` (+test),
  `useWorkspaceReadiness`. Moved modules import them via `../settings/...`. No adapter.
- Source move only: no forwarding modules, no renames, no behaviour, label, test ID, permission or
  request change. `src/account/` is untouched.
- Update `TeamAccessView.tsx`, `TeamAccessView.test.tsx`, `REFERENCE.md:1225`,
  `sso-cutover-design.md:1095`. Touch other ledgers only where a grep finds the old path.

Focused tests: the moved tests, `TeamAccessView.test.tsx`, `pnpm run policy:import-cycles`,
`pnpm run policy:file-sizes`, `e2e/members.auth.spec.ts`, `e2e/invite.auth.spec.ts`. Then the
Green gate.

Done: no production module exists under both paths; grep for `settings/Member`,
`settings/Invite`, `settings/useTeam`, `settings/useMembers` returns only the SSO exception
sites; the delivery summary names the SSO exception.

## Investigation C: assess the Team client seam

Premise: `teamAccessClient`, `accessResult`, `commandRequest` and `commandOutcome` already provide
a typed boundary. The question is whether the `accountClient` to `teamAccessClient` split adds
reading context without a transport/decoding benefit.

Method: list every production caller of the five modules; for each Team operation record the
transport, decoding, command-outcome, reconciliation and user-message owner; identify only concrete
leaks (callers branching on raw HTTP status, repeated decoding, repeated operation-key construction,
duplicate unknown-outcome detection, forwarding methods adding no policy). Apply the deletion test.

Behaviours any pilot preserves: partial directory rows dropped versus unusable response rejected;
initial 403 distinct from revoked access after a successful read; transient failure with a cached
directory distinct from revoked access; account changes suppress stale results without a new
cancellation model; unknown password-reset outcome distinct from success with unrecoverable token;
self-session revocation reload; role change of the current member invalidates caller access.

Excluded from any pilot: password-reset, session and provider administration, ownership transfer,
SSO readiness and repair, personal account security.

Permitted outcomes: no change (record in the delivery report); remove one proven pass-through; narrow
one interface that leaks transport detail. At most one pilot, as its own PR with a before/after
reading-context comparison. Done: report written, or pilot PR merged.

## PR D: single-pass gate mode

Facts (at `61695e1b`): `scripts/gate-commands.mjs` runs the 17 `structuralChecks` and
`security:crypto-inventory` in both `app` and `server` modes, so the Green gate's `pnpm run gate`
plus `pnpm run gate:server` executes those 18 commands twice. `check:push` and the isolated steps
in `.github/workflows/gate.yml:104-106` are separate guarantees and not part of this duplication.

Gate on measurement: time the 18 shared commands within one `gate` run on Node 24. Proceed only if
they are a material share of `gate` plus `gate:server` wall-clock; otherwise record the number and
stop.

Fixed decisions if proceeding:

- Add an `all` mode to `gateCommands` in `scripts/gate-commands.mjs`: shared commands once, then
  the app-only commands, then the server-only commands, in existing order. `app` and `server`
  remain byte-identical so standalone and CI semantics do not move.
- `scripts/run-gate.mjs` accepts the new mode; `scripts/run-gate.test.mjs` asserts every command
  present in `app` or `server` appears in `all` exactly once and that a non-zero exit stops the run.
- Expose it as `gate:all` in `package.json` and mention it in one line under AGENTS.md → Green gate
  and in `docs-src/reference/development.md` → "What `gate` checks". No caching of results.
- No change to workflows, pre-push, the PR template or the pull-request checklist.

Done: `pnpm run gate:all` passes on Node 24; measurement recorded in the PR.

## Follow-on E: review Team tests by guarantee

Start only after B and C. Scope: the moved `MembersSection.*` tests, `InviteMemberPanel`,
`useMemberInvites`, `useTeamDirectory`, `TeamAccessView`, `teamAccessClient` tests,
`members.auth` and `invite.auth` browser specs. Map each test to the failure it detects across
decoder, hook, component and browser layers. Delete a test only when a retained test catches the
same failure and the deleted layer adds no integration guarantee; name that retained test in the PR.
Role and permission matrices, initial/revoked/transient/account-switch coverage, command uncertainty
and one-time-secret behaviour stay covered at their owning layer. Retaining every test is a valid
result. No deletion quota.

## Completion criteria

- The five completed task records are gone and no standing decision was lost.
- Ordinary Team administration lives under `src/components/team/` with the SSO exception documented.
- The Team client seam has a written evidence-based conclusion.
- The gate duplication has a recorded measurement and, if material, a merged `gate:all`.
- No OIDC, SSO, Better Auth, database or public wire behaviour changed.
- This file is deleted in the last PR of the programme.
