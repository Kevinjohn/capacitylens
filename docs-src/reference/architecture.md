---
title: Architecture
description: Where each CapacityLens capability lives, how a planning write travels from route to commit, and which tests establish each guarantee.
---

# Architecture

This page is for contributors reading the code for the first time. It names the module that owns
each capability, the transaction it runs in, where authority is checked, where the response is
projected, and the tests that pin it. Product rules and framework departures are recorded in
[`DECISIONS.md`](https://github.com/Kevinjohn/capacitylens/blob/main/DECISIONS.md); naming and
error rules are in [Code standards](./code-standards.md). The page cites files, not line numbers.

## Responsibility map

The repository has three workspaces. `packages/shared` is pure domain and wire-contract code and
never imports backend code.

```text
apps/backend/
  app/controllers/        HTTP contracts: one controller per route family
  app/validators/         Vine schemas; the only runtime schema for request bodies
  app/services/
    planning.ts           planning facade: read, archive read, mutate, lookup
    planning/             planning internals: execute, writer, restoration, entity policy
    planning_revision.ts  company planning revision (shared by every product writer)
    state_repository.ts   reads one company's rows on a given transaction
    auth/                 withActor, live company role, view-as, password confirmation, sign-in glue
    account_kit/          product callbacks the Account Kit calls (admission, invitations)
    admission/            admission HTTP mapping and errors
    membership/           member directory, role and status changes, ownership transfer
    member_resources/     member-to-resource links and avatars
    operations/           stopped-server operator work: reset, owner recovery, initialisation
    health/               database readiness check
  app/models/             Lucid models; every scoped row carries its company id
  app/transformers/       role-based projection of company state
  app/middleware/         view-as read-only gate, trusted-local session gate, headers, logging
  app/exceptions/         global error-to-HTTP mapping
  start/                  routes, kernel middleware stacks, env schema, Node version gate
  config/                 Account Kit, admission, masquerade, backup, session and mail config
  providers/              boot-time configuration checks and the backup scheduler lifecycle
  commands/               app:upgrade, app:reset, company:initialize,
                          owner:reset-password
  database/               migrations, schema rules and seeders
  tests/                  Japa: functional (HTTP and SQLite) and unit suites
apps/frontend/src/
  components/             screens and editors, grouped by feature
  data/planning/          planning cache controller, command builders, two transports
  store/                  zustand store; slices wire the controller into the UI
  auth/                   session status, access screens, view-as and permission context
  lib/                    pure UI helpers
  api/planningContracts.ts  planning wire types derived from the generated route registry
packages/shared/src/
  domain/                 roles and access thresholds, lifecycle, tenancy, placement rules
  types/                  entity types
  lib/                    dates, working days, colours, ids, integrity checks
  account/, api/, data/   account policy, HTTP error shapes, export format and seed data
```

The rest of `apps/backend/app/services` includes single-purpose modules: `anonymise.ts`,
`beta_account_transfer.ts` (export import), `first_company_setup.ts`,
`initial_company_defaults.ts`, `account_commands.ts` (command headers and error adapter), `audit.ts`,
`cors_policy.ts`, `logging_safety.ts`, `schema_integrity.ts` and `with_transaction.ts`.

## One planning write, end to end

Diana Prince's booking on the Themyscira rebrand changes from 4 to 6 hours a day. The browser
sends one typed request:

```http
PATCH /api/accounts/:accountId/allocations/:id
{ "mutationId": "<uuid>", "baseRevision": 41,
  "intent": { "operation": "allocation.update", "id": "<id>", "changes": { "hoursPerDay": 6 } } }
```

Two middleware gates run before the controller and can refuse:

- P1. `apps/backend/app/middleware/masquerade_read_only_middleware.ts` (server stack) resolves
  view-as mode, requires the context header on unsafe methods (428
  `MASQUERADE_CONTEXT_REQUIRED`) and refuses every unsafe request while viewing as another
  member (403 `MASQUERADE_READ_ONLY`).
- P2. `apps/backend/app/middleware/trusted_local_middleware.ts` (router stack) returns 401
  `{ error: 'Sign-in required.' }` with no code when there is no valid session.

Then, in order:

1. `apps/backend/start/planning_routes.ts` maps the route (`api.planning.allocation.update`) to
   `PlanningController.allocationUpdate`.
2. `apps/backend/app/controllers/planning_controller.ts` validates the body with
   `ctx.request.validateUsing(allocationMutationValidator)` from
   `apps/backend/app/validators/planning/allocation.ts`.
3. The controller's `execute` checks that the intent's operation equals the route's operation,
   that a catalogue intent names the route's entity, and that the target id equals the route id.
   A mismatch is `VALIDATION_ERROR`.
4. `mutatePlanning` in `apps/backend/app/services/planning.ts` takes over.
5. `withActor` (`apps/backend/app/services/auth/current_actor.ts`) opens the Account Kit
   `withCurrent` transaction. The Kit checks the session, credential revision and registry row
   under the account lock; the product then requires an active, confirmed, admitted account and
   binds the captured view-as context. Every later step uses this one transaction handle.
6. `currentAuthority` resolves the effective principal (view-as re-check in
   `apps/backend/app/services/auth/masquerade.ts`), the live membership role
   (`activeMembership` in `apps/backend/app/services/auth/authorization.ts`), the Access Control
   Bouncer `planning:read` ability and the company row. `canWrite` is the `planning:write` ability,
   false under view-as.
7. The write is refused unless `canWrite` holds.
8. Idempotency: a row in `planning_mutations` with this `mutationId` means `MUTATION_ID_REUSED`.
9. `assertPlanningBaseRevision` (`apps/backend/app/services/planning_revision.ts`) refuses a stale
   `baseRevision` with `STALE_REVISION`.
10. Before image: `readStateWithClient` (`apps/backend/app/services/state_repository.ts`).
11. `executePlanningIntent` (`apps/backend/app/services/planning/execute.ts`) re-checks the write
    capability, then `writeRow` (`apps/backend/app/services/planning/writer.ts`) applies the
    privacy gate, existence check, `prepareEntityWrite` from
    `apps/backend/app/services/planning/entity_policy.ts`, the working-day gate when the
    resource changes, and the SQL update.
12. After image: `readStateWithClient` again.
13. `NO_CHANGE` guard: if the before and after images are semantically equal, the throw rolls the
    update back.
14. Restoration guard: a catalogue change to privacy, code name or activity kind that would clear
    pending restoration groups needs an exact confirmation count. An hours change skips it.
15. `advancePlanningRevision` moves the company revision forward once.
16. The commitment marker is inserted into `planning_mutations`.
17. Projection: `projectionChanges` diffs `transformState` (from
    `apps/backend/app/transformers/state_transformer.ts`) of the active before and after rows, so
    the patch carries only what this member's role may see.
18. `writeAudit` (`apps/backend/app/services/audit.ts`) records the operation with fields from the
    projected change. An audit failure rolls back rows, revision and marker together.
19. The response is `{ status: 'committed', mutationId, revision, restoration, projection }`.
    `withCurrent` commits when the callback returns.
20. Any throw goes through the controller's `refusal` mapping (next section).

## Planning failures

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Malformed body, route and intent disagree, or a domain rule refused |
| `AUTHORIZATION_DENIED` | 403 | Role, privacy field, settings access or restoration ownership refused |
| `ACCOUNT_MEMBERSHIP_LOST` | 403 | No active membership, or the company row is gone |
| `STALE_REVISION` | 409 | `baseRevision` is not the current company revision; nothing was written |
| `MUTATION_ID_REUSED` | 409 | This `mutationId` already committed; look it up instead of resending |
| `NO_CHANGE` | 400 | The intent would change nothing; no revision, marker or audit |
| `RESTORATION_CONFIRMATION_REQUIRED` | 409 | Pending restoration groups would be cleared; body has `restorableItemCount` |
| `RESTORATION_CONFIRMATION_STALE` | 409 | The confirmed count no longer matches; body has the new count |
| No code (`conflict` and others) | 409 | Built-in client, frozen setting or restoration conflict; an error message without a code |
| `MASQUERADE_*` | 403, 409, 428 | Refused by the view-as middleware before the controller |
| Account Kit codes | Kit | Session, address or admission refusals (`ADMISSION_REQUIRED` 403) pass through |
| No code | 401 | No valid session (trusted-local middleware) |
| None | 500 | Unexpected fault; the transaction rolled back |

The forwarded codes are listed in `planningMutationErrorCodes` in
`apps/backend/app/validators/planning/contracts.ts`; any other `PlanningOperationError` code is
sent with its status and no `code`.

A request that times out or loses its response is not a failure. The browser marks it
`uncertain`, sends nothing new, and asks
`GET /api/accounts/:accountId/planning/mutations/:mutationId`. The answer is `committed` (with
the revision and any restoration handle) or `unknown`. The lookup is scoped to the same company
and actor, so another member always sees `unknown`. `unknown` keeps the write uncertain and the
editor locked until a later lookup proves commitment or the context changes.

## Planning internals other modules import

`apps/backend/app/services/planning/` is private to the facade and the planning controller, with
four deliberate exceptions:

- `errors.ts` `BatchRequestError`: thrown by export import and example data, mapped by their
  controllers.
- `data_policy.ts` `BatchCapabilities`: the capability type the planning engine consumes.
- `entity_policy.ts` `TABLE_NAMES`: the scoped table list for export import and example data.
- `server_timestamp.ts` `createServerRevision`: row timestamps for anonymisation.

`planning_revision.ts` and `state_repository.ts` sit outside the directory on purpose: every
product writer advances the revision, and export, import and anonymisation read rows the same way.

## Browser ownership

One `createPlanningCacheController` in
`apps/frontend/src/data/planning/planningCacheController.ts` owns the confirmed planning cache,
page-local Undo/Redo history (50 entries) and the single pending or uncertain write. The store
wires it in `apps/frontend/src/store/slices/allocationSlice.ts`; nothing else writes planning rows
in the browser, and nothing is persisted.

- `apps/frontend/src/data/planning/planningCommands.ts` builds intent and inverse pairs from a
  gesture. A build with no difference returns `null` and nothing is sent.
- Runtime planning uses HTTP in `apps/frontend/src/data/planning/planningTransport.ts`. Unit tests
  use an explicit response stub without planning rules; shared domain, backend and browser tests
  cover scheduling and mutation rules against the server.
- Wire types come from the generated Tuyau route registry through
  `apps/frontend/src/api/planningContracts.ts`. They are type aliases only; the backend Vine
  validators are the only runtime schema.

Controller statuses are `idle`, `loading`, `ready`, `pending`, `refused`, `uncertain` and `error`.

| From | Event | To |
| --- | --- | --- |
| any | new company, identity or view-as context | `loading` (`idle` with no context) |
| ready, refused, error | background read starts | `loading` |
| loading | read succeeds | `ready`; history kept only at the same revision and access |
| loading, ready | read fails (network, 5xx, 403) | `error`; rows and history kept |
| any | 401 | `idle`; cache and history cleared |
| ready, refused | write sent | `pending` |
| pending | valid receipt, then canonical read | `ready`; history moves |
| pending | `STALE_REVISION` or other 409 | `refused`, then refetch |
| pending | `NO_CHANGE`, `VALIDATION_ERROR`, 403 | `refused`; rows and history kept |
| pending | `RESTORATION_CONFIRMATION_REQUIRED` | dialog; one resend with the count, or back on cancel |
| pending | network failure, 408, 5xx or invalid receipt | `uncertain` |
| pending | `MUTATION_ID_REUSED` | `uncertain`, then immediate lookup |
| uncertain | lookup `committed` | `pending`, then read, then `ready` |
| uncertain | lookup `unknown` or lookup fails | `uncertain` |
| uncertain | canonical read fails | `error`; the write stays `uncertain` and writes stay locked until a lookup proves the commit or the context changes |
| ready, refused | Undo or Redo with an eligible entry | `pending` with a fresh `mutationId` |

These transitions are pinned in `apps/frontend/src/data/planning/planningCacheController.test.ts`,
`apps/frontend/src/data/planning/planningCacheController.access.test.ts`,
`apps/frontend/src/data/planning/planningCacheController.contextTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCacheController.historyTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCacheController.readTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCacheController.reconciliationTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCacheController.writeTransitions.test.ts`,
`apps/frontend/src/data/planning/restorationConfirmation.test.ts`,
`apps/frontend/src/data/planning/typedPlanningFlow.test.ts`,
`apps/frontend/src/test/createTestPlanningTransport.test.ts`,
`apps/frontend/src/store/useStore.planningOwnership.test.ts` and
`apps/frontend/src/components/ImportExport.test.tsx`.

## Capability map

Backend paths are relative to `apps/backend/`. Every product transaction is the Account Kit
`withCurrent` transaction opened by `withActor` unless the row says otherwise; "live role" means
`activeCompanyRole` or `assertCompanyAction` read inside that transaction.

| Capability | Entry | Owning module | Transaction owner | Live authority check | Projection point | Failure codes | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Planning read | `GET …/planning`; scheduler | `app/services/planning.ts` `readPlanning` | Read-only `withActor`; authority, revision and rows on one handle | `currentAuthority`: view-as principal, live membership, `planning:read` ability | `transformState` by role | `ACCOUNT_MEMBERSHIP_LOST`, `AUTHORIZATION_DENIED`, 401, Kit codes | `tests/functional/planning/http_contract.spec.ts`, `tests/functional/planning/transactions.spec.ts`, `tests/unit/state_transformer.spec.ts` |
| Archive recovery read | `GET …/planning/archive`; archive screens | `app/services/planning.ts` `readArchiveRecovery` | Read-only `withActor` | `currentAuthority` plus `canWrite` (false under view-as) | `archiveRecovery` identity-only rows | `AUTHORIZATION_DENIED`, `MASQUERADE_READ_ONLY`, `ACCOUNT_MEMBERSHIP_LOST` | `tests/functional/planning/archive_recovery.spec.ts` |
| Allocation intents | `POST`/`PATCH …/allocations…`; scheduler | `app/services/planning/execute.ts`, `app/services/planning/writer.ts` | `withActor` in `mutatePlanning` | `currentAuthority`, `planning:write` ability, capability re-check, privacy gate | `projectionChanges` | Planning failure table | `tests/functional/planning/http_contract.spec.ts`, `tests/functional/planning/availability.spec.ts`, `tests/functional/planning/tenant_bulk.spec.ts` |
| Catalogue intents | `…/clients`, `/projects`, `/activities`, `/phases`, `/disciplines`; catalogue editors | `app/services/planning/execute.ts`, `app/services/planning/entity_policy.ts` | `withActor` in `mutatePlanning` | As allocation, plus owner-only privacy fields and the built-in client | `projectionChanges`; refetch on privacy, code name or kind change | Failure table, restoration confirmation, codeless 409 | `tests/functional/planning/operations.spec.ts`, `tests/functional/planning/independent_operations.spec.ts` |
| Resource intents | `…/resources`; people screens | `app/services/planning/execute.ts` | `withActor` in `mutatePlanning` | As allocation | `projectionChanges` | `VALIDATION_ERROR`, `AUTHORIZATION_DENIED`, `NO_CHANGE` | `tests/functional/planning/operations.spec.ts`, `tests/unit/planning_typed_operations.spec.ts` |
| Time-off intents | `…/time-off`; time-off screen | `app/services/planning/execute.ts`, `app/services/planning/restoration.ts` | `withActor` in `mutatePlanning` | As allocation, plus note visibility | `projectionChanges`; notes nulled by role | `VALIDATION_ERROR`, `AUTHORIZATION_DENIED`, `NO_CHANGE` | `tests/functional/planning/restoration.spec.ts`, `tests/functional/planning_operations.spec.ts` |
| Closure intents | `…/closures`; time-off screen | `app/services/planning/execute.ts` | `withActor` in `mutatePlanning` | As allocation | `projectionChanges` | `VALIDATION_ERROR`, `AUTHORIZATION_DENIED`, `NO_CHANGE` | `tests/functional/planning_operations.spec.ts` |
| Settings intent | `PATCH …/settings`; settings | `app/services/planning/writer.ts` `updateSettings` | `withActor` in `mutatePlanning` | As allocation; capacity overview access needs Owner or Admin | `projectionChanges` | `AUTHORIZATION_DENIED`, `NO_CHANGE`, codeless 409 frozen setting | `tests/functional/planning/settings_frozen.spec.ts`, `tests/functional/planning_operations.spec.ts` |
| Restore group | `POST …/planning/restore-group`; Undo | `app/services/planning/restoration.ts` `restoreGroup` | `withActor`; group consumption and reinsertion share it | As allocation, plus same actor and session as the deleting one | `projectionChanges` and the consumed handle | `AUTHORIZATION_DENIED`, `STALE_REVISION`, codeless 409 | `tests/functional/planning/restoration.spec.ts`, `tests/functional/planning/retained_restoration.spec.ts` |
| Mutation lookup | `GET …/planning/mutations/:mutationId` | `app/services/planning.ts` `lookupPlanningMutation` | Read-only `withActor` | `currentAuthority` read; marker scoped to company and actor | `committed` or `unknown` only | `VALIDATION_ERROR`, `ACCOUNT_MEMBERSHIP_LOST` | `tests/functional/planning/http_contract.spec.ts`, `tests/functional/planning/transactions.spec.ts` |
| Sign-in, session, revocation | `/api/auth/*`; sign-in and reset screens | Account Kit; `app/services/auth/password_sign_in.ts`, `app/controllers/credential_controller.ts` | Kit `login`, `logout`, password change and reset transactions; tracking in `withActor` | Kit session, revision and registry check under the account lock on every request | `app/services/auth/user_projection.ts` | 401, 429, `SIGN_UP_CLOSED`, `CURRENT_PASSWORD_INCORRECT`, `INVALID_TOKEN` | `tests/functional/auth/password_sessions.spec.ts`, `tests/functional/auth/recovery.spec.ts` |
| Admission | `/api/admission*`; limited screens | Kit `AccountAdmission`; `app/services/account_kit/policy.ts`, `app/services/membership/admission_membership.ts` | Kit admission transaction; completion in `withActor` | Live role holds `invitations:manage`; admission rechecked in `withActor` on the next request | `decision` in `/api/auth/me` and `/api/admission` | `ADMISSION_REQUIRED`, `COMPANY_SETUP_REQUIRED`, `MEMBERSHIP_SUSPENDED` | `tests/functional/auth/admission.spec.ts` |
| Invitations | `/api/invites*`; Team & access, invite screen | Kit invitations; `app/controllers/invitations_controller.ts` | Kit transactions; acceptance inserts the membership inside the Kit's; mail after commit | `assertCompanyAction` `invitations:manage`, re-checked by Kit callbacks; Owner never invitable | Controller `projection`; `no-store` on token routes | `MAIL_UNAVAILABLE`, `INVALID_TOKEN`, `IDENTITY_AUTHORITY_DENIED`, 202 committed | `tests/functional/auth/invitations.spec.ts` |
| Membership and roles | `…/members*`; Team & access | `app/services/membership/member_mutations.ts` | `withActor` with `@kevinjohn/adonisjs-duplicate-request-guard` receipts | `assertCompanyAction` `members:manage`; Access Control management rules | `readMemberDirectory` | `FORBIDDEN`, `OWNER_TRANSFER_REQUIRED`, `IDENTITY_AUTHORITY_DENIED` | `tests/functional/membership/member_administration.spec.ts`, `tests/functional/membership/member_access_tracking.spec.ts` |
| Member↔resource links | `…/members/:principalId/resource-link`; Team & access | `app/services/member_resources/links.ts` | `withActor` with `@kevinjohn/adonisjs-duplicate-request-guard` receipts | `members:manage`; active member; available person; occupancy | `{ resourceId, revision }` | `CONFLICT`, `FORBIDDEN`, `INVALID_INPUT` | `tests/functional/auth/admission_resource_links.spec.ts` |
| First company | `POST /api/installation/company`; setup screen | `app/services/first_company_setup.ts`, `app/services/initial_company_defaults.ts` | `withActor` plus `account_transaction_lock`; all rows in one transaction | Admitted sole principal, no company or membership, checked under the lock | `companySetupRequired`; 201 `{ accountId }` | `COMPANY_SETUP_UNAVAILABLE`, `FIRST_COMPANY_PENDING`, `SIGN_UP_CLOSED` | `tests/functional/auth/first_company_setup.spec.ts` |
| Ownership transfer | `POST …/ownership-transfer`; Team & access | `app/services/membership/ownership_transfer.ts` | One `withActor`: receipt, password confirmation, Access Control ownership transfer, revision, audit | Live single Owner, not viewing as; Admin target; single-use password confirmation | Receipt `{ fromUserId, toUserId }` | `TARGET_INELIGIBLE`, `PASSWORD_CONFIRMATION_REQUIRED`, `IDENTITY_AUTHORITY_DENIED` | `tests/functional/membership/ownership_transfer.spec.ts`, `tests/functional/privacy/password_confirmation_bindings.spec.ts` |
| View-as | `/api/masquerade`, `…/masquerade`; Team & access | `@kevinjohn/adonisjs-masquerade`; `app/services/auth/masquerade.ts` | Package control-store transaction, outside product transactions | Package policy; middleware refuses writes; target role re-checked in each product transaction | `currentMasquerade` | `MASQUERADE_READ_ONLY`, `MASQUERADE_CONTEXT_CHANGED`, `MASQUERADE_CONTEXT_REQUIRED` | `tests/functional/auth/masquerade.spec.ts` |
| Export | `GET /api/state`; import/export screen | `app/controllers/exports_controller.ts` | Read-only `withActor` | Effective principal and live role; inactive rows need `members:manage` | `transformState` by role | 400, 401, 403 | `tests/functional/data_routes.spec.ts`, `tests/functional/auth/native_authorization.spec.ts` |
| Transfer preview and apply | `POST /api/transfer/{preview,apply}`; import screen | `app/services/beta_account_transfer.ts` | Parse outside; preview read-only `withActor`; apply spends the password confirmation, replaces rows, audits in one `withActor` | Live Owner, not viewing as; password confirmation bound to company, session and document | `{ imported, changed, revision }` | `PASSWORD_CONFIRMATION_REQUIRED`, `IMPORT_SNAPSHOT_STALE`, `IMPORT_ID_COLLISION` | `tests/functional/transfer_apply.spec.ts`, `tests/functional/privacy/password_confirmation_bindings.spec.ts` |
| Anonymise resource | `POST …/resources/:id/anonymise` | `app/services/anonymise.ts` | `withActor`: scrub, restoration purge, audit, revision | Not viewing as; `resources:anonymise` ability (Owner or Admin) | 204 | 403, 404 | `tests/functional/anonymise.spec.ts`, `tests/functional/auth/native_authorization.spec.ts` |
| Anonymise company | `POST …/anonymise` | `app/services/anonymise.ts` | `withActor`: password confirmation spend then scrub, audit, revision | Live Owner and a single-use password confirmation | 204 | `PASSWORD_CONFIRMATION_REQUIRED` | `tests/functional/anonymise.spec.ts`, `tests/functional/privacy/password_confirmation_bindings.spec.ts` |
| Backup, restore, upgrade | `db:backup create/list/verify/prune/restore-prepare`, daily scheduler, `app:upgrade`; [Backups and restore](../self-hosting/backups-and-restore.md) | `@kevinjohn/adonisjs-sqlite-backup`, `providers/backup_provider.ts`, `commands/app_upgrade.ts` | Package one-step online copy and verification; reset borrows the exclusive operator handle; upgrade uses Lucid per-migration transactions; restore stages a verified copy before upgrade | Operator shell access; private local root outside the live database; stop the service for recovery | READY bundles; maximum manifest creation time as `newestSnapshotAt` | Non-zero `db:backup`/upgrade exit, scheduled errors logged | `tests/unit/backup_provider.spec.ts`, `tests/unit/backup_config.spec.ts`, `tests/unit/upgrade_command.spec.ts`, `tests/unit/app_reset_command.spec.ts` |
| Diagnostics | `GET /api/diagnostics`, `/health/ready`; diagnostics screen | `start/routes.ts`, `app/services/health/database_readiness_check.ts` | Diagnostics: read-only `withActor`; readiness: no transaction, `select 1` and schema check | Owner or Admin in some company; readiness is public and returns no paths | Server facts without paths | 401, 403, 503 | `tests/functional/backup_diagnostics.spec.ts` |

## Which tests establish which guarantee

Backend test paths are relative to `apps/backend/`.

- **Authority.** `tests/functional/planning/operations.spec.ts` (Viewer and route mismatches),
  `tests/functional/auth/native_authorization.spec.ts` (four-role matrix, next-transaction role
  changes), `tests/functional/auth/password_sessions.spec.ts` (revocation between admission and
  write), `tests/functional/auth/admission.spec.ts`, `tests/functional/auth/invitations.spec.ts`,
  `tests/functional/membership/ownership_transfer.spec.ts`,
  `tests/functional/privacy/password_confirmation_bindings.spec.ts` (password confirmation bindings).
- **Tenant isolation.** `tests/functional/planning/tenant_bulk.spec.ts` (bulk intents change only
  the caller's company), `tests/functional/data_routes.spec.ts` (export stays in one company),
  `tests/functional/membership/control_data_isolation.spec.ts`, `tests/unit/tenant_scope.spec.ts`.
- **Atomicity and rollback.** `tests/functional/planning/transactions.spec.ts` (audit failure
  rolls back rows, revision and marker; competing drafts commit once),
  `tests/functional/planning/availability.spec.ts` (group rollback),
  `tests/functional/transfer_apply.spec.ts`, `tests/functional/anonymise.spec.ts`,
  `tests/functional/auth/first_company_setup.spec.ts`,
  `tests/functional/transaction_faults.spec.ts` (the transaction primitive itself).
- **Idempotency and lookup.** `tests/functional/planning/http_contract.spec.ts` (stale and duplicate
  identities never commit again; lookup is actor and company scoped),
  `tests/functional/planning/restoration.spec.ts` (late duplicates never re-apply),
  `tests/functional/membership/member_administration.spec.ts` (command receipt replay).
- **Projection and confidentiality.** `tests/unit/state_transformer.spec.ts`,
  `tests/functional/planning/archive_recovery.spec.ts`,
  `tests/functional/planning/operations.spec.ts` (confidential values preserved for Editors),
  `tests/functional/auth/masquerade.spec.ts` (target role for reads, real actor for audit).
- **Recovery.** `tests/functional/planning/restoration.spec.ts`,
  `tests/functional/planning/retained_restoration.spec.ts`, `tests/unit/backup_provider.spec.ts`,
  `tests/unit/upgrade_command.spec.ts`, `tests/unit/app_reset_command.spec.ts`,
  `tests/unit/owner_reset_command.spec.ts`, `tests/unit/company_initialize_command.spec.ts`.
- **Browser coordinator.** The frontend files listed under
  [Browser ownership](#browser-ownership), plus `e2e/planning-controller.auth.spec.ts` and
  `e2e/scheduler-persistence.auth.spec.ts`, which drive real typed routes against SQLite.
