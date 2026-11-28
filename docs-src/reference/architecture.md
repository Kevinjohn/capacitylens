---
title: Architecture
description: Where each CapacityLens capability lives, how a planning write travels from route to commit, and which tests establish each guarantee.
---

# Architecture

This page is for contributors reading the code for the first time. It names the module that owns
each capability, the transaction it runs in, where authorization is checked, where the response is
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
    planning_service.ts   planning facade: read, archive read, mutate
    planning/             planning internals: execute, writer, restoration, entity rules
    planning_revision_service.ts  company planning revision (shared by every product writer)
    state_repository_service.ts   reads one company's rows on a given transaction
    auth/                 withActor, live company role, view-as, password confirmation, sign-in glue
    account_kit/          product callbacks the Account Kit calls (admission, invitations)
    admission/            admission HTTP mapping and errors
    membership/           member directory, role and status changes, ownership transfer
    member_resources/     member-to-resource links
    operator/             stopped-server operator work: reset, owner recovery, initialisation
    health/               database readiness check
  app/models/             Lucid models; every scoped row carries its company id
  app/transformers/       role-based projection of company state
  app/middleware/         view-as context gate, trusted-local session gate, headers, logging
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
  data/planning/          planning cache, intent builders, two transports
  store/                  zustand store; slices wire the planning cache into the UI
  auth/                   session status, access screens, view-as and permission context
  lib/                    pure UI helpers
  api/planningContracts.ts  planning wire types derived from the generated route registry
packages/shared/src/
  domain/                 roles and access thresholds, lifecycle, company separation, placement rules
  types/                  entity types
  lib/                    dates, working days, colours, ids, integrity checks
  account/, api/, data/   account roles and validation, HTTP error shapes, export format and seed data
```

The rest of `apps/backend/app/services` includes single-purpose modules: `anonymisation_service.ts`,
`company_import_service.ts` (export import), `first_company_setup_service.ts`,
`initial_company_defaults_service.ts`, `account_operation_service.ts` (operation headers and error adapter), `audit_service.ts`,
`logging_safety.ts` and `schema_integrity_service.ts`.

## One planning write, end to end

Diana Prince's booking on the Themyscira rebrand changes from 4 to 6 hours a day. The browser
sends one typed request:

```http
POST /api/v1/companies/:companyId/planning/mutations
{ "mutationId": "<uuid>", "baseRevision": 41,
  "intent": { "operation": "allocation.update", "id": "<id>", "changes": { "hoursPerDay": 6 } } }
```

Three middleware gates run, in this order, before the controller and can refuse:

- P1. `apps/backend/app/middleware/masquerade_context_middleware.ts` (router stack) runs the Masquerade
  package's context middleware on routes using the effective guard (`middleware.auth({ guards: ['web_effective'] })` in `start/routes/*`). It
  admits the view-as mode, requires the current context header on unsafe methods (428
  `E_MASQUERADE_CONTEXT_REQUIRED`), refuses a stale header on any method (409
  `E_MASQUERADE_CONTEXT_CHANGED`), and refuses every unsafe request, and reads marked
  `sensitive()`, while viewing as another member (403 `E_MASQUERADE_READ_ONLY`).
- P2. The `accountGate` named middleware (`apps/backend/app/middleware/account_gate_middleware.ts`)
  runs the check that the route's group, or the route itself, names with the `access` option.
  Account Kit's `admissionMiddleware` refuses an `admitted` route unless the session is valid, the
  address is confirmed and the person is admitted; its `managedAccountMiddleware` asks only for a
  valid session on a `limited` route; a route without the gate is public. Without a valid session
  the answer is 401 `{ error: 'Sign-in required.', code: 'E_SIGN_IN_REQUIRED' }`.
- P3. On a route with `:companyId` in its path, `apps/backend/app/middleware/company_scope_middleware.ts`
  runs Access Control's `scope` middleware for the authenticated user (the viewed-as member under
  view-as) and refuses one without an active membership: 403 `E_ACCOUNT_MEMBERSHIP_LOST` on planning
  routes, 403 `E_IDENTITY_AUTHORIZATION_DENIED` elsewhere.

Then, in order:

1. `apps/backend/start/routes/planning.ts` maps the one mutation route
   (`api.planning_mutations.store`) to `PlanningMutationsController.store`; the body's intent, not
   the URL, names the operation.
2. `apps/backend/app/controllers/planning_mutations_controller.ts` validates the body with
   `ctx.request.validateUsing(planningMutationValidator)` from
   `apps/backend/app/validators/planning.ts`, whose union covers every operation.
3. The controller records the validated operation as `planningOperation` on the request's
   completion log line (`apps/backend/app/middleware/request_logging_middleware.ts`).
4. `mutatePlanning` in `apps/backend/app/services/planning_service.ts` takes over.
5. `withActor` (`apps/backend/app/services/auth/current_actor_service.ts`) opens the Account Kit
   `withCurrent` transaction. The Kit checks the session, credential revision and registry row
   under the account lock; the product then requires an active, confirmed, admitted account and
   binds the captured view-as context. Every later step uses this one transaction handle.
6. `resolvePlanningAccess` resolves the effective actor (view-as re-check in
   `apps/backend/app/services/auth/masquerade_mode_service.ts`), the live membership role
   (`getActiveMembership` in `apps/backend/app/services/auth/authorization_service.ts`), the Access Control
   `planning:read` permission for that role and the company row. `canWrite` is the `planning:write`
   permission, false under view-as.
7. The write is refused unless `canWrite` holds.
8. Idempotency: a row in `planning_mutations` with this `mutationId` means `E_MUTATION_ID_REUSED`.
   The hourly maintenance pass (`StorageMaintenanceService`) deletes markers 30 days after their
   commit, except one whose restoration group is still pending, and audit entries after 365 days.
9. `assertPlanningBaseRevision` (`apps/backend/app/services/planning_revision_service.ts`) refuses a stale
   `baseRevision` with `E_STALE_REVISION`.
10. Before image: `readStateWithClient` (`apps/backend/app/services/state_repository_service.ts`).
11. `executePlanningIntent` (`apps/backend/app/services/planning/planning_execution_service.ts`) re-checks the write
    permission, then `writeEntity` (`apps/backend/app/services/planning/entity_write_service.ts`) applies
    the privacy gate, existence check, the `expectedUpdatedAt` precondition, `prepareEntityWrite`
    from `apps/backend/app/services/planning/entity_rules.ts` and the working-day gate when the
    resource changes, and `writeRow` (`apps/backend/app/services/planning/planning_writer_service.ts`) runs the SQL
    update.
12. After image: `readStateWithClient` again.
13. `E_NO_CHANGE` guard: if the before and after images are semantically equal, the throw rolls the
    update back.
14. Restoration guard: a catalogue change to privacy, code name or activity kind that would clear
    pending restoration groups needs an exact confirmation count. An hours change skips it.
15. `advancePlanningRevision` moves the company revision forward once.
16. The commitment marker is inserted into `planning_mutations`.
17. `buildProjectionChanges` diffs the projected before and after rows for the audit fields, using
    `transformState` (from `apps/backend/app/transformers/state_transformer.ts`) of the active rows.
18. `writeAudit` (`apps/backend/app/services/audit_service.ts`) records the operation with fields from the
    projected change. An audit failure rolls back rows, revision and marker together.
19. The response is `{ status: 'committed', mutationId, revision, restoration, archived? }`.
    `withCurrent` commits when the callback returns.
20. Any throw goes through the controller's `refusal` mapping (next section).

## Planning failures

| Code | HTTP | Meaning |
| --- | --- | --- |
| none; body `{ errors: [{ message }] }` | 422 | Malformed body, route and intent disagree, or a domain rule refused |
| `E_AUTHORIZATION_DENIED` | 403 | Role, privacy field, settings access or restoration ownership refused |
| `E_ACCOUNT_MEMBERSHIP_LOST` | 403 | No active membership, or the company row is gone |
| `E_STALE_REVISION` | 409 | `baseRevision` is not the current company revision, or `expectedUpdatedAt` no longer matches the stored row; nothing was written |
| `E_MUTATION_ID_REUSED` | 409 | This `mutationId` already committed; look it up instead of resending |
| `E_NO_CHANGE` | 400 | The intent would change nothing; no revision, marker or audit |
| `E_RESTORATION_CONFIRMATION_REQUIRED` | 409 | Pending restoration groups would be cleared; body has `restorableItemCount` |
| `E_RESTORATION_CONFIRMATION_STALE` | 409 | The confirmed count no longer matches; body has the new count |
| `E_PLANNING_CONFLICT` | 409 | Built-in client, frozen setting or restoration conflict; the message names why |
| `E_EMPTY_HISTORY` | 409 | Undo or redo has no step in that direction; nothing was attempted |
| `E_MASQUERADE_*` | 403, 409, 428 | Refused by the view-as context middleware before the controller |
| Account Kit codes | Kit | Session, address or admission refusals (`E_ADMISSION_REQUIRED` 403) pass through |
| No code | 401 | No valid session (trusted-local middleware) |
| `E_INTERNAL_SERVER_ERROR` | 500 | Unexpected fault; the transaction rolled back |

The forwarded codes are listed in `planningMutationErrorCodes` in
`apps/backend/app/validators/planning/contracts.ts`. A `PlanningOperationException` states one of
them, `E_PLANNING_CONFLICT` or `E_EMPTY_HISTORY`, and is sent with its own status. The browser reads
those two 409s by status, like any other conflict.

A request that times out or loses its response may or may not have committed. The browser sends
nothing new: it refetches, shows the server's state, clears undo history and records an
`unconfirmed` outcome, which asks the person to check that their change is there.

## Planning internals other modules import

`apps/backend/app/services/planning/` is private to the facade and the planning controller, with
three deliberate exceptions:

- `access_grant.ts` `PlanningAccessGrant`: the access grant type the planning engine consumes.
- `entity_rules.ts` `TABLE_NAMES`: the scoped table list for export import and example data.
- `server_timestamp.ts` `createServerRevision`: row timestamps for anonymisation.

`planning_revision_service.ts` and `state_repository_service.ts` sit outside the directory on purpose: every
product writer advances the revision, and export, import and anonymisation read rows the same way.

## Browser ownership

One `createPlanningCache` in
`apps/frontend/src/data/planning/planningCache.ts` owns the confirmed planning cache,
the page's in-memory history id and the single pending write. The server holds the Undo/Redo history
for that id; each read reports only whether Undo and Redo are available. The store
wires it in `apps/frontend/src/store/slices/planningSessionSlice.ts`; nothing else writes planning rows
in the browser, and nothing is persisted.

- `apps/frontend/src/data/planning/planningIntents.ts` builds the intent for a
  gesture. A build with no difference returns `null` and nothing is sent.
- Runtime planning uses HTTP in `apps/frontend/src/data/planning/planningTransport.ts`. Unit tests
  use an explicit response stub without planning rules; shared domain, backend and browser tests
  cover scheduling and mutation rules against the server.
- Wire types come from the generated Tuyau route registry through
  `apps/frontend/src/api/planningContracts.ts`. They are type aliases only; the backend Vine
  validators are the only runtime schema.

Planning cache statuses are `idle`, `loading`, `ready`, `pending`, `refused` and `error`.

| From | Event | To |
| --- | --- | --- |
| any | new company, identity or view-as context | `loading` (`idle` with no context) |
| ready, refused, error | background read starts | `loading` |
| loading | read succeeds | `ready`; Undo and Redo availability as the read reports it |
| loading, ready | read fails (network, 5xx, 403) | `error`; rows and history kept |
| any | 401 | `idle`; cache and history cleared |
| ready, refused | write sent | `pending` |
| pending | valid receipt, then canonical read | `ready`; the read reports the moved history |
| pending | `E_STALE_REVISION` or other 409 | `refused`, then refetch |
| pending | `E_NO_CHANGE`, 422, 403 | `refused`; rows and history kept |
| pending | `E_RESTORATION_CONFIRMATION_REQUIRED` | dialog; one resend with the count, or back on cancel |
| pending | network failure, 408, 5xx, invalid receipt or `E_MUTATION_ID_REUSED` | `loading` with an `unconfirmed` outcome and a new history id, then read; `ready`, or `error` if the read fails |
| ready, refused | Undo or Redo the last read reported | `pending` with a fresh `mutationId` |
| pending | Undo or Redo refused | as a write, then refetch to show the ended history |

These transitions are pinned in `apps/frontend/src/data/planning/planningCache.test.ts`,
`apps/frontend/src/data/planning/planningCache.access.test.ts`,
`apps/frontend/src/data/planning/planningCache.accessChanges.test.ts`,
`apps/frontend/src/data/planning/planningCache.sessionScope.test.ts`,
`apps/frontend/src/data/planning/planningCache.scopeTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCache.history.test.ts`,
`apps/frontend/src/data/planning/planningCache.historyTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCache.readTransitions.test.ts`,
`apps/frontend/src/data/planning/planningCache.reconciliation.test.ts`,
`apps/frontend/src/data/planning/planningCache.uncertainWrites.test.ts`,
`apps/frontend/src/data/planning/planningCache.writeTransitions.test.ts`,
`apps/frontend/src/data/planning/restorationConfirmation.test.ts`,
`apps/frontend/src/data/planning/typedPlanningFlow.test.ts`,
`apps/frontend/src/test/createTestPlanningTransport.test.ts`,
`apps/frontend/src/store/useStore.planningOwnership.test.ts` and
`apps/frontend/src/components/ImportExport.test.tsx`.

## Capability map

Backend paths are relative to `apps/backend/`. Every product transaction is the Account Kit
`withCurrent` transaction opened by `withActor` unless the row says otherwise; "live role" means
`getActiveCompanyRole` or `assertCompanyPermission` read inside that transaction.

| Capability | Entry | Owning module | Transaction owner | Live authorization check | Projection point | Failure codes | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Planning read | `GET …/planning`; scheduler | `app/services/planning_service.ts` `readPlanning` | Read-only `withActor`; access, revision and rows on one handle; no rows when `ifRevision` is the current revision | `resolvePlanningAccess`: view-as actor, live membership, `planning:read` ability | `transformState` by role | `E_ACCOUNT_MEMBERSHIP_LOST`, `E_AUTHORIZATION_DENIED`, 401, Kit codes | `tests/functional/planning/http_contract.spec.ts`, `tests/functional/planning/transactions.spec.ts`, `tests/unit/state_transformer.spec.ts` |
| Archive recovery read | `GET …/planning/archive`; archive screens | `app/services/planning_service.ts` `readArchiveRecovery` | Read-only `withActor` | `resolvePlanningAccess` plus `canWrite` (false under view-as) | `archiveRecovery` identity-only rows | `E_AUTHORIZATION_DENIED`, `E_MASQUERADE_READ_ONLY`, `E_ACCOUNT_MEMBERSHIP_LOST` | `tests/functional/planning/archive_recovery.spec.ts` |
| Allocation intents | `POST …/planning/mutations`, `allocation.*`; scheduler | `app/services/planning/planning_execution_service.ts`, `app/services/planning/planning_writer_service.ts` | `withActor` in `mutatePlanning` | `resolvePlanningAccess`, `planning:write` ability, access grant re-check, privacy gate | `buildProjectionChanges` | Planning failure table | `tests/functional/planning/http_contract.spec.ts`, `tests/functional/planning/availability.spec.ts`, `tests/functional/planning/company_bulk.spec.ts` |
| Catalogue intents | `POST …/planning/mutations`, `catalogue.*`; catalogue editors | `app/services/planning/planning_execution_service.ts`, `app/services/planning/entity_rules.ts` | `withActor` in `mutatePlanning` | As allocation, plus owner-only privacy fields and the built-in client | `buildProjectionChanges` | Failure table, restoration confirmation, `E_PLANNING_CONFLICT` | `tests/functional/planning/operations.spec.ts`, `tests/functional/planning/independent_operations.spec.ts` |
| Resource intents | `POST …/planning/mutations`, `resource.*`; people screens | `app/services/planning/planning_execution_service.ts` | `withActor` in `mutatePlanning` | As allocation | `buildProjectionChanges` | 422, `E_AUTHORIZATION_DENIED`, `E_NO_CHANGE` | `tests/functional/planning/operations.spec.ts`, `tests/unit/planning/planning_typed_operations.spec.ts` |
| Time-off intents | `POST …/planning/mutations`, `timeOff.*`; time-off screen | `app/services/planning/planning_execution_service.ts`, `app/services/planning/restoration_service.ts` | `withActor` in `mutatePlanning` | As allocation, plus note visibility | `buildProjectionChanges`; notes nulled by role | 422, `E_AUTHORIZATION_DENIED`, `E_NO_CHANGE` | `tests/functional/planning/restoration_catalogue.spec.ts`, `tests/functional/planning/planning_operations.spec.ts` |
| Closure intents | `POST …/planning/mutations`, `closure.*`; time-off screen | `app/services/planning/planning_execution_service.ts` | `withActor` in `mutatePlanning` | As allocation | `buildProjectionChanges` | 422, `E_AUTHORIZATION_DENIED`, `E_NO_CHANGE` | `tests/functional/planning/planning_operations.spec.ts` |
| Settings intent | `POST …/planning/mutations`, `settings.update`; settings | `app/services/planning/planning_writer_service.ts` `updateSettings` | `withActor` in `mutatePlanning` | As allocation; capacity overview access needs Owner or Admin | `buildProjectionChanges` | `E_AUTHORIZATION_DENIED`, `E_NO_CHANGE`, `E_PLANNING_CONFLICT` for a frozen setting | `tests/functional/planning/settings_frozen.spec.ts`, `tests/functional/planning/planning_operations.spec.ts` |
| Restore group | `POST …/planning/mutations`, `planning.restoreGroup`; no browser caller | `app/services/planning/restoration_service.ts` `restoreGroup` | `withActor`; group consumption and reinsertion share it | As allocation, plus same actor and session as the deleting one | `buildProjectionChanges` and the consumed handle | `E_AUTHORIZATION_DENIED`, `E_STALE_REVISION`, `E_PLANNING_CONFLICT` | `tests/functional/planning/restoration_allocations.spec.ts`, `tests/functional/planning/restoration_sessions.spec.ts`, `tests/functional/planning/retained_restoration.spec.ts` |
| Undo and redo | `POST …/planning/undo`, `…/planning/redo`; scheduler Undo and Redo | `app/services/planning_service.ts` `stepPlanningHistory`, `app/services/planning/planning_history_service.ts`, `app/services/planning/inverse.ts` | `withActor`; the stored intent commits as an ordinary mutation; a refused step ends its history in a second `withActor` | As the stored intent, plus same actor, session, page history and revision as the last write | `canUndo` and `canRedo` only; stored intents never leave the server | `E_AUTHORIZATION_DENIED`, `E_STALE_REVISION`, `E_EMPTY_HISTORY`, `E_PLANNING_CONFLICT` | `tests/functional/planning/history.spec.ts`, `tests/functional/privacy/restricted_replies.spec.ts` |
| Sign-in, session, revocation | `/api/v1/auth/*`; sign-in and reset screens | Account Kit; `app/services/auth/password_sign_in_service.ts`, `app/controllers/password_resets_controller.ts`, `app/controllers/password_controller.ts` | Kit `login`, `logout`, password change and reset transactions; tracking in `withActor` | Kit session, revision and registry check under the account lock on every request | `app/services/auth/user_projection.ts` | 401, 429, `E_SIGN_UP_CLOSED`, `E_CURRENT_PASSWORD_INCORRECT`, `E_INVALID_TOKEN` | `tests/functional/auth/password_sessions.spec.ts`, `tests/functional/auth/recovery.spec.ts` |
| Admission | `/api/v1/admission*`; limited screens | Kit `AccountAdmission`; `app/services/account_kit/admission_rule_service.ts`, `app/services/membership/admission_membership.ts` | Kit admission transaction; completion in `withActor` | Live role holds `invitations:manage`; admission rechecked in `withActor` on the next request | `decision` in `/api/v1/auth/me` and `/api/v1/admission` | `E_ADMISSION_REQUIRED`, `E_COMPANY_SETUP_REQUIRED`, `E_MEMBERSHIP_SUSPENDED` | `tests/functional/auth/admission.spec.ts` |
| Invitations | `/api/v1/invitations*`; Team & access, invite screen | Kit invitations; `app/controllers/invitations_controller.ts` and the other `invitation_*_controller.ts` files | Kit transactions; acceptance inserts the membership inside the Kit's; mail after commit | `assertCompanyPermission` `invitations:manage`, re-checked by Kit callbacks; Owner never invitable | Controller `projection`; `no-store` on token routes | `E_MAIL_UNAVAILABLE`, `E_INVALID_TOKEN`, `E_IDENTITY_AUTHORIZATION_DENIED`, 202 committed | `tests/functional/auth/invitations.spec.ts` |
| Membership and roles | `…/members*`; Team & access | `app/services/membership/member_mutation_service.ts` | `withActor` with `@kevinjohn/adonisjs-duplicate-request-guard` receipts | `assertCompanyPermission` `members:manage`; Access Control management rules | `MemberDirectoryService.read` | `E_FORBIDDEN`, `E_OWNER_TRANSFER_REQUIRED`, `E_IDENTITY_AUTHORIZATION_DENIED` | `tests/functional/membership/member_administration.spec.ts`, `tests/functional/membership/member_access_tracking.spec.ts` |
| Member↔resource links | `…/members/:userId/resource-link`; Team & access | `app/services/member_resources/member_resource_link_service.ts` | `withActor` with `@kevinjohn/adonisjs-duplicate-request-guard` receipts | `members:manage`; active member; available person; occupancy | `{ resourceId, revision }` | `E_CONFLICT`, `E_FORBIDDEN`, 422 | `tests/functional/auth/admission_resource_links.spec.ts` |
| First company | `POST /api/v1/installation/company`; setup screen | `app/services/first_company_setup_service.ts`, `app/services/initial_company_defaults_service.ts` | `withActor` plus `account_transaction_lock`; all rows in one transaction | Admitted sole user, no company or membership, checked under the lock | `companySetupRequired`; 201 `{ companyId }` | `E_COMPANY_SETUP_UNAVAILABLE`, `E_FIRST_COMPANY_PENDING`, `E_SIGN_UP_CLOSED` | `tests/functional/auth/first_company_setup.spec.ts` |
| Ownership transfer | `POST …/ownership-transfer`; Team & access | `app/services/membership/ownership_transfer_service.ts` | One `withActor`: receipt, password confirmation, Access Control ownership transfer, revision, audit | Live single Owner, not viewing as; Admin target; single-use password confirmation | Receipt `{ fromUserId, toUserId }` | `E_TARGET_INELIGIBLE`, `E_PASSWORD_CONFIRMATION_REQUIRED`, `E_IDENTITY_AUTHORIZATION_DENIED` | `tests/functional/membership/ownership_transfer.spec.ts`, `tests/functional/privacy/password_confirmation_bindings.spec.ts` |
| View-as | `/api/v1/masquerade`, `…/masquerade`; Team & access | `@kevinjohn/adonisjs-masquerade`; `app/services/auth/masquerade_control_service.ts`, `app/services/auth/masquerade_mode_service.ts` | Package control-store transaction, outside product transactions | Package policy; middleware refuses writes; target role re-checked in each product transaction | `readCurrentMasquerade` | `E_MASQUERADE_READ_ONLY`, `E_MASQUERADE_CONTEXT_CHANGED`, `E_MASQUERADE_CONTEXT_REQUIRED` | `tests/functional/auth/masquerade.spec.ts` |
| Company state read | `GET /api/v1/state`; archived records | `app/controllers/company_state_controller.ts` `show` | Read-only `withActor` | Effective actor and live role; inactive rows need `members:manage` | `transformState` by role | 400, 401, 403 | `tests/functional/data_routes.spec.ts`, `tests/functional/auth/native_authorization.spec.ts` |
| Export | `GET /api/v1/companies/:companyId/export`; import/export screen | `app/controllers/company_export_controller.ts` `show` | Read-only `withActor` | Effective member through `resolvePlanningAccess`; inactive rows need `members:manage` | Serialised export document, `full` only for the Owner | 400 invalid export document `{ error }`, 401, 403 `E_ACCOUNT_MEMBERSHIP_LOST`, 409 `E_MASQUERADE_CONTEXT_CHANGED`, 428 `E_MASQUERADE_CONTEXT_REQUIRED` | `tests/functional/company_export.spec.ts` |
| Import preview and apply | `POST /api/v1/import/{preview,apply}`; import screen | `app/services/company_import_service.ts` | Parse outside; preview read-only `withActor`; apply spends the password confirmation, replaces rows, audits in one `withActor` | Live Owner, not viewing as; password confirmation bound to company, session and document | `{ baseRevision, imported, changed, companyName, counts }` (preview); `{ imported, changed, revision }` (apply) | `E_PASSWORD_CONFIRMATION_REQUIRED`, `E_IMPORT_SNAPSHOT_STALE`, `E_IMPORT_ID_COLLISION` | `tests/functional/import_apply.spec.ts`, `tests/functional/privacy/password_confirmation_bindings.spec.ts` |
| Anonymise resource | `POST …/resources/:id/anonymise` | `app/services/anonymisation_service.ts` | `withActor`: scrub, restoration purge, audit, revision | Not viewing as; `resources:anonymise` ability (Owner or Admin) | 204 | 403, 404 | `tests/functional/anonymise.spec.ts`, `tests/functional/auth/native_authorization.spec.ts` |
| Anonymise company | `POST …/anonymise` | `app/services/anonymisation_service.ts` | `withActor`: password confirmation spend then scrub, audit, revision | Live Owner and a single-use password confirmation | 204 | `E_PASSWORD_CONFIRMATION_REQUIRED` | `tests/functional/anonymise.spec.ts`, `tests/functional/privacy/password_confirmation_bindings.spec.ts` |
| Backup, restore, upgrade | `db:backup create/list/verify/prune/restore-prepare`, daily scheduler, `app:upgrade`; [Backups and restore](../self-hosting/backups-and-restore.md) | `@kevinjohn/adonisjs-sqlite-backup`, `providers/backup_provider.ts`, `commands/app_upgrade.ts` | Package one-step online copy and verification; reset borrows the exclusive operator handle; upgrade uses Lucid per-migration transactions; restore stages a verified copy before upgrade | Operator shell access; private local root outside the live database; stop the service for recovery | READY bundles; maximum manifest creation time as `newestBackupAt` | Non-zero `db:backup`/upgrade exit, scheduled errors logged | `tests/unit/backup_provider.spec.ts`, `tests/unit/backup_config.spec.ts`, `tests/unit/upgrade_command.spec.ts`, `tests/unit/app_reset_command.spec.ts` |
| Diagnostics | `GET /api/v1/diagnostics`, `/health/ready`; diagnostics screen | `start/routes.ts`, `app/services/health/database_readiness_check.ts` | Diagnostics: read-only `withActor`; readiness: no transaction, `select 1` and schema check | Owner or Admin in some company; readiness is public and returns no paths | Server facts without paths | 401, 403, 503 | `tests/functional/backup_diagnostics.spec.ts` |

## Which tests establish which guarantee

Backend test paths are relative to `apps/backend/`.

- **Authorization.** `tests/functional/planning/operations.spec.ts` (Viewer and route mismatches),
  `tests/functional/auth/native_authorization.spec.ts` (four-role matrix, next-transaction role
  changes), `tests/functional/auth/password_sessions.spec.ts` (revocation between admission and
  write), `tests/functional/auth/admission.spec.ts`, `tests/functional/auth/invitations.spec.ts`,
  `tests/functional/membership/ownership_transfer.spec.ts`,
  `tests/functional/privacy/password_confirmation_bindings.spec.ts` (password confirmation bindings).
- **Company isolation.** `tests/functional/planning/company_bulk.spec.ts` (bulk intents change only
  the caller's company), `tests/functional/data_routes.spec.ts` (export stays in one company),
  `tests/functional/membership/control_data_isolation.spec.ts`, `tests/unit/company_isolation.spec.ts`.
- **Atomicity and rollback.** `tests/functional/planning/transactions.spec.ts` (audit failure
  rolls back rows, revision and marker; competing drafts commit once),
  `tests/functional/planning/availability.spec.ts` (group rollback),
  `tests/functional/import_apply.spec.ts`, `tests/functional/anonymise.spec.ts`,
  `tests/functional/auth/first_company_setup.spec.ts`,
  `tests/functional/transaction_faults.spec.ts` (the transaction primitive itself).
- **Idempotency.** `tests/functional/planning/http_contract.spec.ts` (stale and duplicate
  identities never commit again),
  `tests/functional/planning/restoration_sessions.spec.ts` (late duplicates never re-apply),
  `tests/functional/membership/member_administration.spec.ts` (command receipt replay).
- **Projection and confidentiality.** `tests/unit/state_transformer.spec.ts`,
  `tests/functional/planning/archive_recovery.spec.ts`,
  `tests/functional/planning/operations.spec.ts` (confidential values preserved for Editors),
  `tests/functional/auth/masquerade.spec.ts` (target role for reads, real actor for audit).
- **Recovery.** `tests/functional/planning/restoration_allocations.spec.ts`,
  `tests/functional/planning/retained_restoration.spec.ts`, `tests/unit/backup_provider.spec.ts`,
  `tests/unit/upgrade_command.spec.ts`, `tests/unit/app_reset_command.spec.ts`,
  `tests/unit/owner_reset_command.spec.ts`, `tests/unit/company_initialize_command.spec.ts`.
- **Browser coordinator.** The frontend files listed under
  [Browser ownership](#browser-ownership), plus `e2e/planning-cache.auth.spec.ts` and
  `e2e/scheduler-persistence.auth.spec.ts`, which drive real typed routes against SQLite.

## Lucid soft-delete integration

The backend pins `@kevinjohn/adonisjs-lucid-soft-delete` version `0.4.0` by the asset URL of its
[tagged GitHub release](https://github.com/Kevinjohn/oss-adonisjs-lucid-soft-delete/releases/tag/v0.4.0).
Every `@kevinjohn/*` package is consumed the same way, from its own repository's release; the
lockfile records each archive's integrity. To change a pin, update the backend manifest URL and the
lockfile together; pnpm records the new archive's integrity.

Allocation, TimeOff, Closure, Phase and Discipline use the package for restorable deletion; their
Luxon `deletedAt` attribute is the package's own Lucid date-time column, stored in Lucid's
format, and stays on the server. Client, Project, Activity and Resource have no
deletion state: archive and restore are their only lifecycle. Product
`createdAt`, `updatedAt` and `archivedAt` are Luxon attributes too, declared with
`timestampColumn` (`app/services/models/scalar_column.ts`), which stores and serialises the same canonical
UTC ISO string. `database/schema_rules.ts` leaves every date-time column on Lucid's default
`DateTime` type except `users.created_at` and `users.updated_at`, which the `User` model writes as
strings.

A root `withTrashed()` does not change related queries; select the mode separately on every preload.
The shared `buildActiveData` projection owns descendant hiding, using the complete parent state.
The package hides a model's own tombstone and does not implement application ancestry rules.

Archive transitions, planning revisions, audit rows and session-bound restoration groups already
exist in AdonisJS. The package integration does not introduce a public soft-delete or purge action,
a retention policy or deletion undo tokens for lifecycle models. Planning deletes for bookings,
time off, closures, phases and disciplines use package lifecycle operations. Their rows stay in
their own tables; the recovery ledger contains only expected row IDs and surviving-child links.
These five types keep internal deletion fields out of serialisation and omit deleted rows even
from inactive-inclusive state reads. A group foreign key and mandatory company-matching
guards bind each retained row to its current deletion. Session and privacy cleanup cannot affect
a replacement or a later deletion. Package lifecycle operations and database bookkeeping share the caller's
transaction; after-hooks run before commit, so dispatch external effects only after that
transaction resolves.

[Issue #1640](https://github.com/Kevinjohn/capacitylens/issues/1640) records integration commands,
results; [issue #1653](https://github.com/Kevinjohn/capacitylens/issues/1653) records planning
recovery and cleanup acceptance.

## Beta import contract (implementation) {#beta-import-implementation}

The reader-facing rules are in [Settings](/using/settings#beta-import-contract); this section is the
implementation contract.

The beta-native document has `format: "capacitylens-beta"`, `schemaVersion: 2` and
`completeness: "full" | "redacted"`. Its version is independent of database and legacy export
versions. `data` contains exactly one company and all scoped tables, preserving IDs, timestamps
and supported company settings. It excludes identity, sessions, memberships, roles, admission
records and device preferences. Only a full-completeness document can be prepared for import.

Shared preparation strictly validates fields and references, including company scope and current
member-to-person links. It rejects invalid data instead of repairing or remapping it. Export callers
must redact confidential values before document construction; the completeness marker does not
redact data. A redacted export cannot be restored as a full replacement.

The public entry point is `@capacitylens/shared/data/companyExport`: `buildCompanyExport`,
`serializeCompanyExport`, `parseCompanyExport` and `prepareCompanyImport`. Preparation receives explicit
server-owned `{ companyId, memberResourceLinks }` context and returns `{ data, imported }`, where
`imported` includes the company row. Export callers must supply an authorised, confidentially
projected dataset; the completeness marker grants no permission.

Settings uses this contract for import/export, including the disposable demo. Preview and apply go
through `POST /api/v1/import/preview` and `POST /api/v1/import/apply`. Apply requires the live Owner and a single-use password
proof bound to the exact document, company and previewed revision. Inside the transaction it checks
the current revision and member links again, refuses scheduling IDs held by another company, then
replaces the company slice and supported settings atomically. It retains the destination company ID,
member links and durable planning mutation identities. A changed replacement clears pending
restoration groups, writes one audit row and advances the revision; an unchanged replacement does
none of these. Keep restoration cleanup in the same transaction as replacement, and do not route
prepared beta data through the legacy remapping writer.
