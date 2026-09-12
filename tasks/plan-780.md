# Issue #780: three-step ownership transfer consent ceremony

Status: revision 3, reviewed adversarially twice (7 P0 / 11 P1 found, verified against the tree, and
reconciled below). Base: `ba1bb056` (origin/main, 2026-09-11).
Issue: https://github.com/Kevinjohn/capacitylens/issues/780 — a design proposal that closed with
"not implementation-ready; reconcile against six repository seams first". This plan is that
reconciliation plus the execution order. Covers #179 (placement) and #185 (consent).
Milestone: "Ownership transfer consent ceremony (#780)".
Validation policy: AGENTS.md defaults (not the `tasks/plan.md` programme exception).
Task navigation: none in `docs-src/reference/development.md` covers ownership transfer.

## Seam reconciliation

### 1. Replay must survive the caller demoting itself

`authorizeMemberMutation` (`server/src/accounts/routes/createReplyHelpers.ts:70-77`) calls
`authorize`, which checks current role (`routes/appAuthorization.ts:177`) and freshness (`:178`)
before the handler runs — both before `beginCommand`. The replay branch
(`accounts/sqliteAccountAdminPort.ts:152-165`) returns before any port-side assertion, so a
completed receipt _can_ replay; the question is only what the route gate does first.

**Resolution — no bespoke gate.** Every ceremony route uses the ordinary
`authorizeMemberMutation` with a new **admin-tier** action `actOnOwnershipTransfer`. A former Owner
demoted by their own completion is still an active Admin, so the gate passes and the receipt
replays; freshness passes too, because a lost-response retry uses the same session that was fresh
seconds earlier. Owner-only authority and participant identity are asserted inside `execute`, after
the replay branch. This keeps the `securityEvent` denial trail, `resolveEffectiveRole`'s ended-
masquerade 403 (`appAuthorization.ts:170-176`), the OFF-mode 400 and non-member concealment, all of
which a hand-rolled gate would have lost. Rejected alternative: a bespoke membership-only check
(revision 1) — strictly worse, and it was the source of three separate review findings.

A former Owner _removed_ from the account cannot replay. That is accepted and recorded.

### 2. A business-terminal outcome must commit, not roll back

`executeMutation` (`sqliteAccountAdminPort.ts:129-146`) wraps `execute` + `completeCommand` + audit
in one `tx(..., "immediate")`. A throw rolls all three back and `recordFailedMutation` (`:106-127`)
writes only a _compensated_ row in a separate transaction, which later replays as a thrown
`CONFLICT` (`accounts/commands.ts:132-137`). So an invalidation written before a throw is lost.

**Resolution.** `execute` returns a discriminated result — `{ kind: "applied", … }` or
`{ kind: "terminal", state, reason }` — and the terminal branch commits. Three constraints, all
fixed decisions, each from a review finding:

- **A terminal result may only be returned before the first membership write.** Returning instead
  of throwing commits whatever `execute` already wrote; completion demotes the Owner first
  (`adminPort/membership.ts:239-245`), so a terminal decision taken after that statement would
  commit a zero-Owner account and the boot assertion
  (`controlTables/assert.ts` `assertSingleOwnerControlPlaneCurrent`) would then refuse to open the
  database. Completion's last in-transaction statement re-reads
  `COUNT(*) WHERE accountId = ? AND role = 'owner' AND status = 'active'` and throws unless it is 1.
- **The audit outcome must be derived from the result.** `writeMutationAudit` is called with a
  hard-coded `"success"` (`sqliteAccountAdminPort.ts:142`). `MutationOptions.audit` therefore gains
  a function form, `(result) => { action, changedFields, outcome, eventKey } | null`, resolved by
  `writeMutationAudit`. A terminal outcome emits its _own_ event — `ownership_transfer.expired` or
  `.invalidated` with outcome `"success"`, because the terminalisation genuinely happened — and no
  event for the transition that was refused. The object form keeps working unchanged.
- **`failureCode` is never used for a terminal result.** The ledger CHECK
  (`accounts/state/schema.ts:25-29`) requires `status='completed'` to have
  `resultJson IS NOT NULL AND failureCode IS NULL`. The reason lives inside `resultJson`.

Authorisation rejection and retryable infrastructure failure keep throwing and stay non-mutating.

### 3. `MembershipRevision` cannot express account-scoped consent

`shared/src/account/types.ts:13-15` declares it identity-global; `account_security_revisions`
(`accounts/state/schema.ts:5-9`) is keyed by `principalId` only, and all four bump sites are in
`controlTables/members.ts:53,110,260,285`.

**Resolution.** No new column, and no captured revision. Consent is bound _eagerly_: the membership
write choke point terminalises any live request naming the written `(accountId, userId)`, in the
same transaction as the write that caused it. Demotion, re-promotion, status change and removal each
kill the request when they happen, so a later transition cannot resurrect consent.

Two constraints:

- **The choke point holds no audit writer** (`members.ts:1-12` imports only `../auth`,
  `../accounts/state`, `../accounts/memberSignInTracking`). `upsertMember`, `setMemberStatus` and
  `removeMember` therefore _return_ the ids they terminalised, and the calling port operation — which
  has the audit writer and is inside the same transaction — emits one
  `ownership_transfer.invalidated` per id. State correctness stays unforgettable at the choke point;
  audit stays atomic with the write.
- **The hook runs inside completion's zero-Owner window.** After the demote statement the account
  momentarily has no active Owner. The hook may read only `(accountId, userId)` and the transfer
  table — never the Owner set.

**Known bypasses, both bounded and recorded rather than assumed:**

- `controlTables/ownershipMigrations.ts:125,189,208` writes memberships with raw SQL, deliberately
  bypassing `upsertMember`. Its sole callers are migrations v10–v14 (`db/migrations/index.ts`),
  reached only from `db/open.ts`. The transfer table is created at v40, so no live request can exist
  when they run. Pinned by a test.
- `accounts/memberSignInTracking.ts:106-148` UPDATEs `account_members` outside `members.ts`, but only
  the non-authority `signInConfirmed` column. It does not affect consent. The repo's "single
  membership-write choke point" comment (`members.ts:47-48`) is an overclaim; this plan does not
  repeat it.

### 4. Completion must not invalidate its own request

`withOwnershipTransferExemption(requestId, fn)` in the control-table module sets a module-private
token for one synchronous call. Everything inside `tx` is synchronous (`server/src/txn.ts:11-12`
`SynchronousCallback`, `assertSynchronousResult` `:53-58`), so the token cannot span operations, and
it is unreachable from any port input or HTTP body. The helper is itself typed `SynchronousCallback`,
clears the token in a `finally`, and throws on nesting. Completion's own two `upsertMember` calls are
exempt; any _other_ live request naming either principal is still terminalised. The request row's
terminal UPDATE matches on `(id, accountId, state, revision)` only — never on membership values the
same transaction bumps.

### 5. Ownerless operator repair

`assignWorkspaceOwner` (`server/src/cutoverRepair.ts:136-176`) refuses unless the workspace has no
active Owner (`:145-147`) and has no session or actor at all. That is **necessary but not
sufficient**: a live request plus a disabled or archived Owner leaves zero _active_ Owners while the
request is still live, and the CLI then promotes any **active member — Admin tier is not required**
(`adminPort/cutover.ts:65-67`) — defeating a consented nomination. Its `upsertMember` call fires the
choke point only for the promoted principal, who is usually not a participant.

**Resolution.** Account-wide terminalisation of every live request inside the CLI's existing
transaction, with `ownership_transfer.invalidated` and reason `owner_repaired`. This is mandatory,
not belt-and-braces.

### 6. Erasure deletes before invalidating

`eraseWorkspaceAdministrationInTx` (`adminPort/cutover.ts:105-113`) removes members then invites
inside the single erasure transaction (`accounts/flows/workspaceErasure.ts:45-86`).

**Resolution.** Terminalise and audit live requests as its first step, before
`removeAllMembersForAccount`, then delete the workflow rows explicitly. There is no `accounts`
cascade to rely on — see the table shape below.

### Further reconciliations

- **Audit vocabulary is closed** (`shared/src/account/audit.ts:4-25`) and mirrored by a runtime
  exhaustiveness guard at `server/src/auditOutbox.ts:108-144`. Both must grow together.
- **Audit identity collides.** `id` is `` `${commandId}:${action}:${outcome}${targetSuffix}` ``
  (`accounts/accountFlowRuntime.ts:24`). One command can invalidate several requests. An optional
  `eventKey?: string` is added to `AccountAuditInput` and appended to `id`; the existing
  `identity.local_deprovisioned` suffix becomes one caller of it. The request id travels as that key.
- **Masquerade.** `applyMasqueradePolicy` (`routes/appSessionResolution.ts:136-146`) refuses unsafe
  methods, covering the six mutations. `GET` is safe and is **not** covered, so the read refuses
  explicitly under an active masquerade.
- **The table is operational.** It follows `account_members` / `invites` (`server/src/controlTables.ts:1-10`):
  own DDL const, own `assert*Current`, installed by its migration, absent from `AppData`,
  `APP_DATA_KEYS`, `SCOPED_KEYS`, `TABLE_DEFINITIONS`, `sanitizeImportedRecord`, `/api/:entity` and
  import/export. `EXPORT_SCHEMA_VERSION` does not change.
- **`ACCOUNT_FLOW_OPERATIONS`** (`shared/src/account/ports.ts:242-248`) stays frozen; the ceremony is
  not reachable through `POST /api/account-commands/reconcile` in v1.
- **Reauth.** The existing single `ReauthAction "transfer-ownership"`
  (`src/auth/reauthCoordinator.ts:22`, label `src/auth/ReauthDialog.tsx:331`) is reused for all seven
  operations. No new action, no new message key, no `paraglide:compile` for reauth.

## Authorisation matrix

Tier authority is necessary, never sufficient. Every mutation asserts participant identity inside
`execute`, after loading the row under lock; a mismatch is `FORBIDDEN` — an authorisation rejection,
which throws and mutates nothing.

| Operation                   | Route gate                       | In-`execute` assertions                                                                          |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET` (read)                | `actOnOwnershipTransfer` (admin) | participant filter in the read: non-participants receive nulls; refuse under masquerade          |
| initiate / replace          | `actOnOwnershipTransfer`         | `assertAccountAuthority("transfer-ownership")` (owner-only) + target is an active Admin ≠ caller |
| cancel                      | `actOnOwnershipTransfer`         | owner-only + `actor.principalId === row.initiatorUserId`                                         |
| complete                    | `actOnOwnershipTransfer`         | owner-only + `actor.principalId === row.initiatorUserId` + state `awaiting_owner`                |
| accept / withdraw / decline | `actOnOwnershipTransfer`         | `actor.principalId === row.targetUserId` + current active role is exactly `admin`                |

All seven also call `assertAdministrativeAssurance` (fresh session, 15 minutes via
`ACCOUNT_SESSION_FRESH_AGE_SECONDS`, plus configured MFA) as the first statement of `execute`.
`replayGuard` (`sqliteAccountAdminPort.ts:160`) re-asserts participant identity — not role — before
re-disclosing a receipt, mirroring `adminPort/invitations.ts:206-209`.

## Fixed decisions

Answering the issue's ten open decisions:

1. **Expiry** seven calendar days, server-generated, never extended by acceptance.
   `OWNERSHIP_TRANSFER_TTL_MS`; no second literal.
2. **Replacement** is permitted and atomic, naming `expectedRequestId` + `expectedRevision`. A stale
   predecessor is `CONFLICT` and cancels nothing.
3. **Withdrawal** is permitted: `awaiting_owner` → `awaiting_target`, clearing `targetAcceptedAt`.
4. **Visibility** is participants only, enforced server-side in the read.
5. **Assurance** on all seven operations as above. Trusted-local keeps its documented bypass; OFF
   mode persists nothing and every ceremony route returns the established 400.
6. **Sessions** are not blanket-revoked. Completion runs the choke point for both principals, which
   bumps both security revisions and burns both reset links.
7. **Notification** in-app only.
8. **Retention** — terminal rows kept 365 days (`OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS`), swept
   opportunistically from the ceremony's own initiate path under its account lock, then removed.
   Audit events remain under audit policy. The **replay horizon is 30 days**
   (`accounts/state/commandLedgerWrites.ts:13`), shorter than retention: after it, a repeated command
   re-executes as new and receives the current deterministic result. Recorded, not hidden.
9. **Old endpoint** removed, not deprecated. No existing users;
   `src/account/teamAccessClient.ts:305` has no component caller.
10. **Recovery** — no operator mutation in v1; `assign-workspace-owner` confined as in seam 5.

**Consent binding** is the eager choke-point terminalisation of seam 3. **Explicitly not bound:**
credential, federated-link or principal-identity changes do not themselves invalidate a request.
Rationale: acceptance and completion each require a session created within the last fifteen minutes,
so a materially changed login identity must re-authenticate before acting on an earlier acceptance.
This is the issue's cycle-3 P1 alternative ("remove the stronger identity-change claim explicitly"),
taken deliberately.

## State machine

`awaiting_target` → `awaiting_owner` | `declined` | `cancelled` | `expired` | `invalidated`
`awaiting_owner` → `awaiting_target` (withdraw) | `completed` | `cancelled` | `expired` | `invalidated`
All others terminal. Every successful transition increments `revision`; every new state-changing
command carries `expectedRevision` and a mismatch is `CONFLICT` with no mutation. Every command
begins, under the account lock, with a materialisation step: if the live row has `now >= expiresAt`
it commits `expired` plus its audit event and returns the terminal result instead of transitioning.

**Canonical command payload** (fixed — replay correctness depends on it entirely):
initiate `{ workspaceId, targetPrincipalId, expectedRequestId, expectedRevision }`; every other
operation `{ workspaceId, requestId, expectedRevision }`. Because `requestId` and `expectedRevision`
are in the hash, a retry naming a different request or revision receives `IDEMPOTENCY_CONFLICT`
(`commandLedgerWrites.ts:99-101`) rather than a wrong replay, and a same-key/same-payload retry is
genuinely the same intent, so replaying a terminal receipt forever is correct.

## Data contract

Table `account_ownership_transfers`, `STRICT`, installed by migration 40:

| column                                             | notes                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `id`                                               | TEXT PK                                                                      |
| `accountId`                                        | TEXT NOT NULL — **no foreign key**                                           |
| `initiatorUserId`, `targetUserId`                  | TEXT NOT NULL, CHECK different                                               |
| `state`                                            | TEXT NOT NULL CHECK in the seven states                                      |
| `revision`                                         | TEXT NOT NULL (integer string, matching the `membershipRevision` convention) |
| `createdAt`, `expiresAt`                           | TEXT NOT NULL, CHECK `createdAt < expiresAt`                                 |
| `targetAcceptedAt`, `terminalAt`, `terminalReason` | TEXT NULL                                                                    |

No FK to `accounts(id)`: `controlTables/retentionV24.ts:109-113` states that control-plane tables
carry none _by design_, so they stay out of the AppData cascade and `PRAGMA foreign_key_check`.
Deletion is explicit (seam 6). No membership FK either — removal must not cascade retained history.
Partial unique index on `(accountId) WHERE state IN ('awaiting_target','awaiting_owner')` gives the
one-live-request guarantee atomically rather than by read-then-insert; index on
`(accountId, targetUserId)`. No names or emails are copied into the row.
`server/src/db/lifecycle.ts:47-54` `wipe()` must clear it alongside `account_members` and `invites`.

## Tasks

Six stacked branches under milestone 5, each based on its predecessor, landing in order as one unit.
Per the goal, none is merged.

### T1 — shared contract and policy (`feature/780-t1`, base `origin/main`)

`shared/src/account/ownershipTransfer.ts` (states, transitions, request type, result unions,
terminal reasons), `shared/src/account/ownershipTransferPolicy.ts` (TTL, retention,
`canActOnOwnershipTransfer({ callerRole, isInitiator, isTarget, action })`),
`shared/src/account/policy.ts` (`AccountAdminAction` gains `act-on-ownership-transfer`, threshold
`admin`), `shared/src/domain/access.ts` (`Action` + `ACCOUNT_ADMIN_ACTION` row),
`shared/src/account/audit.ts` (nine ceremony actions), `server/src/auditOutbox.ts:108-144`
(`ACCOUNT_ACTION_VALUES` — the runtime exhaustiveness guard breaks without it),
`server/src/accounts/accountFlowRuntime.ts` (`AccountAuditInput.eventKey`, id suffix).
Test updates: `shared/src/domain/access.test.ts` role tables and the hard-coded
`expect(ACTIONS.length).toBe(10)` at `:112`; `shared/src/account/policy.test.ts`;
`server/src/accounts/conformance/architecture.test.ts:259-264` threshold patterns;
`src/auth/permissionContext.test.tsx` (add the missing count assertion so a new `Action` cannot
silently escape that sweep).
New tests: transition table; exhaustive caller × action × state matrix; expiry boundary
(`now < expiresAt` valid, `>=` expired); unknown role/state fails closed; revision monotonicity.
Done: `pnpm run gate` **and** `pnpm run gate:server` green. (T1 does touch the server — the audit
vocabulary is shared.)

### T2 — durability (`feature/780-t2`, base T1)

Source: `server/src/controlTables/ownershipTransfers.ts` (DDL const,
`assertOwnershipTransfersCurrent`, row type and mapper, storage functions),
`server/src/controlTables.ts` (barrel), `server/src/db/migrations/definitions.ts` + `index.ts`
(migration 40 `add-ownership-transfer-requests`), `server/src/db/constants.ts`
(`DB_SCHEMA_VERSION = 40`), `server/src/controlTables/assert.ts:120-171`
(`assertControlTablesCurrent` `expectedColumns` and `expectedIndexes` — it covers only
`account_members` and `invites` today), `server/src/db/lifecycle.ts:48-53` (`wipe()` — omitting it
leaves orphaned rows after a trusted-local reset; a silent defect, not a test failure).

**Version pins that assert v39 is the last migration — each a hard failure on v40:**
`server/src/cutoverRepair.ts:55` `REPAIR_COMPATIBLE_MIGRATIONS = new Set([25…39])` — **production
behaviour**: without `40` the `cutover:repair` CLI refuses to run on any database carrying the new
migration; `server/src/auth.test.ts:420-426` (pins version, name and checksum of the last migration)
and `:595-599` (`CAPACITY_OVERVIEW_MIGRATION` terminates a pinned pending list);
`server/src/db.migrate.test.ts` (V40 pin in four places); `server/src/backup.test.ts` (append 40).

**Rehearsal coverage fails closed:** `server/scripts/rehearse/anonymise.ts:17-26`
(`assertAnonymisationCoverage` throws `anonymiser does not cover table(s): …`),
`server/scripts/rehearse/knownColumns.ts` (entry complete at column granularity;
`KNOWN_TABLES` derives from its keys), `server/scripts/rehearse/anonymiseOperations.ts` (principal
and account coordinates remapped as for `account_members`; `terminalReason` is a bounded enum and is
retained), `server/src/rehearseAnonymise.test.ts:138-181` (asserts zero missing schema entries).

**Guards that silently stop guarding:** `server/src/accounts/conformance/architecture.test.ts:33`
`accountSql = /…(?:account_members|invites)\b/` and the route-layer `.prepare` ban at `:343`. SQL
touching `account_ownership_transfers` is invisible to the deny-by-default storage-ownership check
until the table name joins that alternation. Nothing fails; the guard just stops working. Add it.

Tests: fresh install and forward migration from every released fixture; checksum stability; one live
row per account under concurrent insert; terminal-state immutability; CHECK constraints; retention
sweep; `wipe()` clears it; **a new AppData-exclusion test** modelled on
`server/src/app.controlTables.test.ts:12-56` (its `invites` twin is `app.invites.test.ts:1340-1347`,
its export twin `app.export.test.ts:145-150`) proving the table 404s through `/api/:entity` and is
absent from `GET /api/state` — the plan asserts this exclusion, so it must evidence it.
`shared` `TABLE_DEFINITIONS` / `APP_DATA_KEYS` / `SCOPED_KEYS`, `server/src/tables.ts:29-35` and the
duplicated `SCOPED_KEYS` literal at `server/src/db.tenantStore.test.ts:176-196` must **not** change.
No fixture `.db` is added — `DATABASE_FIXTURE_VERSIONS` (`db.migrate.test.ts:257`) is not
per-version and omits 39.
Done: `pnpm run gate:server` green.

### T3 — port, kernel and choke point (`feature/780-t3`, base T2)

Additive only; nothing is removed, so the tree stays green.
`server/src/accounts/adminPort/ownershipTransfer.ts` (the seven operations over `runMutation`,
each returning the applied/terminal union; completion calls a private exchange kernel and ends with
the Owner-count assertion), `server/src/accounts/sqliteAccountAdminPort.ts` (wire the module; add
`audit` to `AdminPortContext`; make `MutationOptions.audit` result-derived and take the audit outcome
from the result), `shared/src/account/ports.ts` (add the ceremony surface),
`server/src/controlTables/members.ts` (terminalisation returning ids, plus
`withOwnershipTransferExemption`), `server/src/accounts/adminPort/membership.ts` (export the exchange
kernel privately to the ceremony module), `server/src/accounts/adminPort/cutover.ts` (erasure
terminalisation first), `server/src/cutoverRepair.ts` (ownerless-repair terminalisation),
`server/src/accounts/conformance/architecture.test.ts` (`controlTableImporters` gains the two new
importers — the allow-list is an exact `Set` and fails otherwise),
`server/src/accounts/conformance/accountFlows.conformance.test.ts` (port stubs).
Tests: every transition; both non-mutating classes (unauthorised caller, retryable read failure);
failure injected before, between and after both membership writes rolls back roles, security effects,
request, ledger and audit; Owner uniqueness before, during and after; the reverse write order raises;
reset-link and revision effects for both principals; exactly-once audit on success, replay and
failure; migration-era raw-SQL paths cannot see a live request.
Done: `pnpm run gate:server` green.

### T4 — HTTP boundary and removal of the bypass (`feature/780-t4`, base T3)

The port removal and the route removal are **one atomic task** — splitting them does not compile.
Add: `server/src/accounts/routes/handlers/ownershipTransfer.ts`;
`server/src/accounts/accountRoutes.ts` (seven routes).
Remove: `shared/src/account/ports.ts:189` (`transferOwnership`),
`server/src/accounts/adminPort/membership.ts:31,208-269`,
`server/src/accounts/routes/handlers/memberAdmin.ts:249-291`,
`server/src/accounts/accountRoutes.ts:18,120`,
`server/src/cutoverPreflight.test.ts:92`,
`server/src/accounts/conformance/accountFlows.conformance.test.ts:186,231`.
Update: `server/src/app.routes.test.ts` (both ordered inventories — `toEqual` asserts order),
`server/src/accounts/conformance/architecture.test.ts` (`extractedPaths`),
`server/src/app.members.test.ts:329,1166,1186,1232,1301` and the P1.11 block at `:1341`,
`server/src/app.authz.test.ts:1786-1787`,
`server/src/app.resetPassword.test.ts:440-453` — **re-point, never delete**: it is a security
property ("the promoted target's outstanding link dies") and must now assert it of completion.
Routes: `GET`, `POST`, `POST …/:requestId/accept|withdraw|decline|complete`, `DELETE …/:requestId`.
Tests: every authorisation-matrix row; malformed ids and bodies; cross-tenant probing
indistinguishable from absent (same status, same body); replay after self-demotion; same-key
different-payload; in-flight duplicate; concurrent cancel/accept and withdraw/complete; expiry on
every command path; masquerade refusal on all seven including `GET`; OFF mode inert.
Done: `pnpm run gate:server` green.

### T5 — client projection and UI (`feature/780-t5`, base T4)

`src/account/accountClient.ts` + `teamAccessClient.ts` (seven methods; remove `transferOwnership`
and update `src/account/accountClient.test.ts:151,176`), `src/components/team/OwnershipTransferCard.tsx`
and its controller modules, mounted below `MembersSection` in `src/components/team/TeamAccessView.tsx`.
New message keys require `pnpm run paraglide:compile`. The reauth action is the existing
`"transfer-ownership"`; the `ReauthAction` union is not changed, so `ReauthDialog.tsx:331` stays valid.
Reconciliation after every success or replay: re-read the live projection, then `refreshCallerAccess()`
(covering `invalidateMemberships` → `refreshAccountSummaries` → `refreshActiveAccountSlice`) and
`refreshDirectory()`.
Test ids: `ownership-transfer-card`, `-nominee`, `-start`, `-replace`, `-cancel`, `-accept`,
`-decline`, `-withdraw`, `-complete`, `-state`, `-outcome`.
Tests: card visibility for Owner, nominated Admin, other Admin, Editor and Viewer; picker lists only
active Admins; consequences name both people and the company; every projection state; controls
disable coherently while a command is pending; unknown outcome keeps command identity; errors never
optimistically change roles; completion refreshes all four projections.
Done: `pnpm run gate` green.

### T6 — stories, docs, e2e (`feature/780-t6`, base T5)

`user-stories/REFERENCE.md:1069,1113,1135` (first), `user-stories/settings/US-SET-10-member-management.md:92,149,150,174`,
a new story for the ceremony, `docs-src/getting-started/roles-and-permissions.md:34-60`,
`docs-src/reference/glossary.md:15,34`, `docs-src/sso-cutover-design.md:869,1341`,
`docs-src/reference/development.md:764-940` (the per-version migration log; `:801` step 8 mandates
the CHANGELOG plus operator notes), `docs-src/security/control-inventories.md:37` (the retention
inventory row a 365-day-retention identity-adjacent table needs),
`CHANGELOG.md` Unreleased, regenerated `docs/`, `e2e/ownership-transfer.auth.spec.ts`,
`e2e/members.auth.spec.ts:58,140` (retire the API-transfer helper).
E2E: two independent authenticated contexts perform the whole ceremony; direct API calls cannot
bypass consent or final approval; target demoted between acceptance and completion fails safely; old
Owner loses Owner-only controls without reload; new Owner gains authority after navigation; keyboard
and accessible-name coverage. Invented people follow the comic-book naming rule.
Screenshots are **not** captured: nothing merges, so Team & access captures would be of unlanded UI.
Recorded as a deliberate omission.
Done: `pnpm run gate`, `pnpm run gate:server`, `pnpm run e2e` green on the integrated tree.

## Permitted discretion

Local names, helper placement, file splitting to stay under the size policy, mock and fixture
adaptation, assertion mechanics that preserve the stated guarantee, and user-facing copy.

## Fixed constraints

Behaviour, the state machine, the authorisation matrix, the canonical payloads, endpoint shapes,
table shape, the seam reconciliations, the demote-before-promote order, and the names of new modules
are fixed. No change to `EXPORT_SCHEMA_VERSION`, `ACCOUNT_FLOW_OPERATIONS`, the `ReauthAction` union,
released migration definitions or checksums, or any shared type not listed. `git commit -s` on the
assigned branch only.
