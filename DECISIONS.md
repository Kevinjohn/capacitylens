# Standing decisions

This is the short, present-tense record of the product rules the owner has set and of the places
the code still differs from the framework. How a behaviour works in detail is in the user stories
and the tests, not here.

## Product

- CapacityLens is a week-granularity capacity overview for small agencies.
- Budgets, money, timesheets, hour-by-hour workflows and mobile scheduling are non-goals.
- “Utilisation” is the product term.
- Clients own projects; projects and internal work contain activities; allocations connect a
  resource to an activity over a date range.
- Activities are **Project-specific**, **Internal** or **All projects**. Only project-specific
  activities may reference a project or phase. An all-projects activity stays project-less, but each
  of its allocations may optionally attribute the booking to a project; project-specific and
  internal allocations must not.
- Resources are people, placeholders or external parties. External parties have no capacity and
  do not contribute to utilisation.
- Personal time-off creation may repeat into a finite batch of independent dated, whole-day records;
  each resulting entry is edited or deleted on its own and carries no series field. Company closures
  do not recur. Working patterns never move or filter time-off dates.
- Company closures are separate entities from personal time off, not a variant of it. A closure
  covers every person and placeholder, never an external party, and carries no resource reference.
- Shared role and status badges use a compact pill silhouette. Their semantic colours continue to
  distinguish brand/default, neutral, warning, danger and outline states.
- Employment type is recorded for people but does not add a visual badge to the schedule or roster.
- Product orientation is non-blocking and shown automatically to eligible users until dismissed.
  The **How CapacityLens works** button on Help can reopen it at any time. Dismissal is a versioned device preference scoped
  to the signed-in person and company (with a stable no-company scope), never
  company data or export data. Reopening focuses the guidance; automatic background state changes
  do not repeatedly steal focus. A copy change may bump the version to show materially changed
  guidance again.
- A new setting needs a user who cannot proceed without it. Prefer deriving a value from what the
  operator or company already told us.
- Inline **Add activity** and the **Task** field stay opt-in company settings, off by default, as
  deliberate friction against task tracking.
- CapacityLens is a single product with one repository and one set of releases.
- The global sidebar shortcut (⌘B / Ctrl+B) yields while text entry or IME composition owns the
  keyboard and while any dialog is open; those contexts keep both the chord and page layout stable.
- English is the only locale. The message layer, the company language field and the locale sync
  stay for a later second locale: the field selects the runtime locale and is not shown when a
  company is created while English is the only locale. It cannot be changed afterwards; a field that
  was never stored accepts its first value.

## Scheduling invariants

- A day is over capacity only when allocated capacity is strictly greater than available capacity.
- A person's effective working week is the intersection of the company's global working days and
  their personal pattern; external parties use the company set verbatim. A company must keep at
  least one working day: writes reject an empty selection; an unset selection reads as the
  week-start default.
- Normal allocations do not consume days outside the effective working week. The **Ignore working
  days** checkbox is the explicit exception; it never bypasses time off.
- A company closure is a literal inclusive date span: no working-week filtering, whole days only
  and no per-person exception. Closures and personal time off are independent and may overlap
  freely, with no merging or precedence.
- New allocations must start on an effective working day (create and duplicate always enforce
  it). Reassignment also enforces it unless **Ignore working days** is on; the override still
  respects availability dates. Other edits to existing allocations stay permissive. Later occurrences of a repeat batch
  may start on non-effective days and are counted in an advisory, not blocked.
- Changing global working days reinterprets existing allocations: stored dates never move, while
  capacity, utilisation and conflicts are recalculated.
- Displayed utilisation is calculated over the visible 1/2/4/6/8-week window.
- The "overbooked in the next two weeks" signal is calculated over a fixed forward 14-day window
  from today and never changes with zoom or pan.
- Today is the company's calendar date, resolved by the server in the company time zone and sent
  with the planning read; the browser never reads its own clock for it.
- The visible span is chosen from a **Weeks visible** dropdown, not a row of always-on buttons; the
  schedule's top bar is reserved for the controls people reach for every session.
- The schedule has no jump-to-date picker.
- Narrowing a resource's availability (working pattern, weekly capacity or employment type)
  leaves existing allocations in place; capacity and utilisation are recalculated so they show
  as over-capacity rather than being moved, split or deleted.

## Data and company separation

- Every server requires an authenticated, authorised company member. There is no sign-in mode
  setting or anonymous persisted access. The development demo runs the full server with a printed
  sign-in and one demo company on disposable SQLite storage. Refresh retains changes; restarting
  the command resets the demo data. Each invocation owns its own storage. Cleanup removes it only
  after the owned processes are verified to have exited. Uncertain crash residue is retained and
  never reset by a later invocation.
- SQLite is the only product database. One process owns one database file through a pool of one
  connection. Missing API access is an error, never a silent browser-storage fallback.
- Every scoped row carries its company id. The server authorises every company read and write from
  session membership; client scoping is UI hygiene, not authorisation. Database triggers reject
  cross-company references within the scheduling graph; control links are checked transactionally
  against the member and resource. Every installation serves one company. First-install setup
  creates that company; the UI offers no company switcher or additional-company creation. Company
  scoping, memberships and the account directory remain enforced, and ambiguous installations
  report an error.
- The one-company rule has one server home. Every server check of the limit, or of whether a
  company exists yet, reads through it. The client shows the server's refusal and does not count
  companies itself.
- Code that works across several companies stays on purpose: view-as searches every membership when
  no company is named. An export always names its company.
- A planning read returns the current access grant, one integer company revision and the complete,
  confidentially projected company slice, or no slice when the reader names the revision it already
  holds and that revision is current, from one transaction. Every typed mutation carries the
  company revision it was drafted against; a mismatch returns 409 and the client refetches. An edit
  form's update also carries the row's `updatedAt` from when the form opened, and a mismatch
  returns the same 409. No automatic rebase or replay. A revision advances once per transaction
  that changes planning data, planning projection or membership access; session activity, mail
  and configuration edits that change neither do not advance it.
- A planning mutation is identified by a client-minted UUID recorded with the audit row in the
  same transaction; reusing a committed identity returns 409. When a write's reply is lost, the
  browser refetches, shows the server's state, clears undo history and asks the person to check
  that their change is there. It never replays the write.
- Undo and redo are held on the server, per company, for its last writer. Stored inverses never
  leave the server, undo and redo write audit rows, and there is no cross-device undo.
- Deleted planning rows stay restorable through package-managed soft deletion. Restore is one
  atomic operation under current authorisation; internal deletion fields and hidden values never
  leave the server. A change to a client or project privacy or code-name field, or to an activity
  kind, clears that company's restorable rows in the same transaction, after one confirmation that
  states how many; anonymisation and import clear them too. Relaxing this needs a way to prove
  old hidden recovery data is still safe to restore.
- Ordinary writes reject invalid supplied input; nothing is repaired on the way in. Blind writers
  cannot echo hidden names or notes, so an unrelated edit preserves protected stored values.
  Unknown request fields are stripped by the validator. Identity, membership and import routes
  refuse unknown fields.
- The portable export is this product's own document and the only import source. Import is
  Owner-only, atomic and not undoable. A malformed or foreign document is rejected, never repaired.
  Identity, sessions, membership and admission records are never part of the export. The server
  builds the export for the reader's role, labels it full or redacted and serves it as a download;
  the browser only saves the file.
- Beta import uses the versioned full company export, binds the exported company scope to
  the selected destination company, preserves scheduling IDs and existing member links, and replaces
  supported company settings. Validate every source row against the exported company before binding;
  retain the destination company ID and its identity, membership, session and admission records.
  This permits an unchanged full beta export to restore planning into a fresh installation.
  A redacted document cannot be imported. The Owner
  previews the destination revision before applying; changed imports advance it and audit once,
  while unchanged imports do neither.
- Resource and catalogue lifecycle uses archive/restore (Editor and up). Resource anonymisation
  (Owner/Admin) irreversibly removes identifying details and dependent notes while retaining the
  resource and its links. The **Anonymise all people** action applies the same scrub to every resource and requires
  action-specific proof. Client, project and activity catalogue fields, the company, Owner and
  memberships remain unchanged. There is no company
  deletion, soft-delete or purge action.
- A person deletes their own account from **Account** with their current password, checked
  through a password confirmation scoped to the person. One transaction removes the identity,
  sessions and tokens, every membership and the member/person link. An Owner must transfer
  ownership first. Invitations the person sent stay acceptable with their inviter cleared. The person
  resource and audit rows keep the former user id as history.
- Editor and up may change company-wide planning and display configuration (scheduling mode,
  disciplines, colour mode, feature visibility). Identity, membership, privacy,
  lifecycle, import and erasure keep their Owner/Admin gates.
- Time zone and week start are chosen when the company is created and cannot be changed
  afterwards; a field that was never stored accepts its first value. The company name is set at
  setup and shown in Settings, which has no rename control; the settings update on the server
  still accepts a name (#2461, deferred).
- Colours come from the preset palette. Ordinary writes reject anything else.
- Client/project privacy is opt-in and Owner-managed. Real names remain stored; only Owners receive
  them. Every other role receives the quoted code name, and non-Owner writes preserve the protected
  fields. The built-in Internal client is always public and active.
- Theme and per-device view preferences are device-global and outside the export. The date format
  is the deliberate exception: a company reads one convention, so it is a company setting (Editor
  and up), exported and undoable. It governs planning calendar dates. Server instants use the
  viewer's locale and time zone; never derive a local date by slicing a UTC timestamp.
- Capacity Overview access is a page-visibility preference, not a confidentiality control: every
  member already receives every allocation and resource in the planning read.
- Command-palette entity visibility follows the destination: omit resources or Internal projects
  whose selection would land on a hidden row, keep Internal activities because they open the
  Activities list.
- An unmatched URL is navigation state: a branded not-found page with a schedule link. Valid
  reset and invitation bearer paths keep their exact matcher; malformed signed-out entries stay
  behind the sign-in wall.
- Migrations create one table each, are forward-only and run through Lucid. `app:upgrade` writes
  an online backup before migrating; the backup is the rollback. Production refuses `down()`, and
  there is no checksum ledger. Startup, readiness, diagnostics and the operator commands refuse a database
  that has not recorded every migration the running build ships; nothing compares the schema itself.
- An online SQLite backup runs at startup and on a schedule, with count-based retention of
  verified bundles on local storage. Pre-migration bundles and reset archives stay outside
  scheduled retention. Failures are logged or returned by the operator command.
- Account operations record receipts inside the caller's transaction, scoped to one actor's
  operation. Completed receipts are pruned on a schedule; an operation retried after its receipt
  is gone runs as a new operation.

## Browser data

- Scheduling records and identity snapshots are never persisted in the browser. The planning
  slice is a non-persisted cache replaced from server reads, or advanced by the rows a committed
  write's receipt returns; it is never authoritative.
  Server failures stay visible and retryable. There is no offline mode, write queue or fallback.
- Each server dataset has one home in the browser. TanStack Query owns server reads. The store
  owns the planning cache and the company directory, which store logic reads. No dataset is held
  in both. Undo history is held by the server; the planning cache keeps only the page's history
  id.
- Ordinary device preferences live in localStorage. The disposable demo uses the same server-owned
  planning data path as an installation.

## Accounts, admission and security

- Account Kit owns accounts: password sign-in, registration, address confirmation, password
  change and reset, invitations, sessions and admission. CapacityLens owns company membership,
  roles, the member↔resource link, the permission keys, the access-control services and every
  screen and word that renders a kit outcome. CapacityLens has no authorisation policies of its
  own. Password sign-in is the only sign-in method; there are no identity providers.
- Roles rank viewer < editor < admin < owner, and the permission keys are declared once. A route
  with the company in its path refuses a caller without an active membership before its handler,
  with the refusal the handler would give. The server always authorises inside the request
  transaction; a route that takes the company from the request body has only that check. The
  server sends the effective member's permission keys and the private-name and time-off-note flags
  with the company directory and the view-as state; the browser shows or hides permission-gated
  controls from them, and a view-as sends only `planning:read`. The browser's Owner-or-Admin,
  Capacity Overview and sole-Owner checks and the view-as rank check still read the role. A
  membership is active or suspended. Nobody manages their own membership, and an Admin cannot manage the Owner.
- Admission is cumulative and owned by the kit: an optional allowed email domain, invitation
  evidence and Owner or Admin approval, all from static configuration (restart to change).
  Accepting an emailed invitation records the evidence, confirms the address and creates the
  membership with the invited role; approval is still required. A person who is signed in but not
  admitted reaches only the limited screens, which show the step that applies. Approval, rejection
  and revocation are enforced on the next request; nothing is pushed to the browser. An admitted
  person without a membership (operator-granted evidence or an approved sign-up) joins
  explicitly, with the invited role or Viewer, never Owner. A suspended member cannot rejoin this
  way; only an Owner or Admin restores them. A new identity always needs fresh invitation evidence
  and approval.
- Invitations are emailed only; the acceptance link is never shown in the product. One configured
  lifetime (seven days) applies to every invitation. Accepting creates a new identity and refuses an
  already-registered address; identities are never merged by email. When an existing limited
  account needs invitation evidence, the operator grants it. An invitation never proposes or creates
  a Resource; link the member to a Resource after they join.
- A company invitation carries its company id. It creates the invited membership with its audit
  entry and planning revision in one transaction, and deleting an account removes its memberships. An invitation without a company,
  such as the operator's, creates no membership.
- Invitations, address confirmation and password resets need configured mail delivery. Without
  it they are refused with an explanation rather than falling back to a copyable link.
- Sessions end after 14 days without use. Changing or resetting a password ends every session,
  including the current one. Password resets and session revocation by an Owner or Admin for other
  members are deferred; the operator's kit commands cover recovery.
- Ownership transfer, whole-company import and company-wide people anonymisation each require a
  password confirmation for that action; no time-based fresh-session window replaces it.
- A password confirmation is single-use and short-lived, and binds the real user, Kit session,
  live credential revision, company, action and exact intent. It verifies the current password
  and is spent in the same transaction as the change. Wrong passwords are rate-limited per
  account. Credential writes stay with Account Kit.
- Deleting an account also requires a password confirmation for that action, scoped to the person
  with no company permission and spent just before the deletion.
- Password hashing uses the framework's default hasher through the kit. There is no breach
  screening and no custom hashing queue.
- Production requires an HTTPS public URL; plain HTTP is accepted only for loopback development.
- The first identity comes from the operator's bootstrap invitation. On an empty installation
  that sole admitted identity names the company in the browser and becomes its Owner, in one
  transaction. Open sign-up is refused until the first company exists, whatever the
  configuration. The stopped-server operator initialiser is a recovery option, never the install
  path, and also requires an admitted identity. Neither path creates credentials or changes
  identity admission. No environment variable grants company ownership.
- A development-only demo command may create the demo company on an empty disposable database
  and make the development bootstrap identity its Owner. That identity is the one account created
  outside the kit. Production refuses both the command and the setting that enables the identity.
- Each company has exactly one Owner. Ownership moves only by one atomic transfer to an existing
  member; the former Owner becomes Admin. Admins cannot administer an Owner. Credential recovery
  for a locked-out Owner is the kit's operator command, never an in-product action.
- Members and schedulable Resources are separate records linked explicitly. Adding a Resource never
  grants access; inviting a member never creates a person. Team & access is visible to every role;
  only Owner/Admin see invitation and access-management controls.
- View as member is identity-wide, read-only, audited and time-limited. A member may be viewed
  only by someone whose role in that company ranks at or above theirs, so an Admin cannot view as
  the Owner; the rank is rechecked on every request. Each company request checks both the real
  actor's and the target's permissions, and a failed target check never falls back to the
  actor's. No route allows a write under view-as, and a request carrying a stale view-as context
  is refused, reads included.
- Every route is gated by name before its handler runs: public routes pass, limited routes need a
  valid sign-in, and every other route also needs a confirmed address and admission. A named route
  in no list gets the strictest check. The gate adds an early refusal; it does not replace the
  check inside the product transaction.
- View-as control state and events stay in database backups, outside scheduling exports. Events
  are pruned on a schedule.
- Unsafe requests are accepted only from the public URL's origin or a configured extra origin;
  outside production with none configured, the local development origins are trusted. A refusal
  still carries the security headers. HSTS is sent only when the public URL is HTTPS. There is no
  CSP report route.
- The audit table is written inside the mutation's transaction. Post-commit logging is diagnostic.
- Every request gets a server-generated id for log correlation; no client text becomes the id.
- Domain errors use one flat error contract, and the browser presents them by code. Validation
  failures, request or domain, take the framework's 422 answer `{ errors }` (#2457, #2490).
- Authentication and the API are rate limited.
- CapacityLens ships no analytics. Mail delivers addressed invitations, address confirmations and
  password resets only.
- Errors on data paths are surfaced, not swallowed.

## Data design

These are the product's own data choices. They are not views on the framework, and a later product
does not inherit them.

- Ordinary planning edits go through one mutation route whose validated intent names the
  operation, plus undo and redo, because each edit carries the company revision and writes one
  audit row and one history step. Import, anonymisation and example data have their own routes.
  There are no per-entity resource routes for planning edits.
- Planning entities, companies and users have string primary keys; the browser mints the id of
  a row a person creates. Bookkeeping and package-owned tables keep their own keys.

## AdonisJS framework departures

The AdonisJS documentation is the reference. A departure is a cost every later product built
from this codebase inherits, so prefer aligning. A new departure is decided in an issue, before the code that needs it; the owner rules only when
it changes behaviour users see, scope, a public interface or data. An
entry marked **Aligning** is being removed by the issue it names; the code may still differ until
that issue lands. Every other entry is kept for the reason it gives. Numbers are stable: a
removed entry retires its number.

1. The shared package is imported by the backend and the SPA. It contains pure domain rules and wire
   types, never backend code.
2. Empty strings are not converted to null; empty optionals are `null` on the wire, in storage
   and in the export. (The exception handler's own error mapping, once part of this entry, is
   withdrawn by #2457: the handler follows the framework.)
3. Product models fail closed without an explicit company scope. Retained bulk services authorise
   the company and scope their queries inside a transaction because model hooks do not cover bulk
   updates and deletes.
4. Columns are snake_case. The row transformer produces the camelCase wire format from each
   model's column serialisation and the state transformer projects it for the reader's role.
   Calendar dates are date-only strings and flags are boolean columns. Product instants are
   stored and sent as the canonical UTC ISO string with milliseconds, through one helper,
   `timestampColumn`, on Lucid's `prepare`/`consume`/`serialize` column options: Lucid's SQLite
   date-time format drops milliseconds, and `updatedAt` is an edit token compared for equality.
   Flags keep `booleanColumn` because the SQLite driver reads them back as 0 and 1. Soft-delete
   markers use the package's own Lucid column and format (#2442).
5. Product environment variables use the `CAPACITYLENS_` prefix; framework variables keep the
   framework's names.
6. The backend serves the SPA with the product security headers and a history fallback rather than
   a separate static-file proxy.
7. The SQLite pool is one connection, configured when it is created. A mutating service receives
   its transaction as a method argument. Network, mail and password hashing stay outside
   transactions.
8. CSRF is the Origin / Sec-Fetch-Site check, not Shield's XSRF token.
9. Retired. See Browser data.
10. Retired (#2458). Product services are container-resolved `*Service` classes.
11. A company permission is authorised inside the product transaction through the Access
    Control package, after the route middleware has checked membership. Controllers do not
    call Bouncer and the product has no policies or abilities of its own.
12. Retired (#2459). Product writes go through the Lucid models. See Data design.
13. Retired. See Data design.
14. Retired. See Data design.
15. The Node server is created by `bin/server.ts` with fixed connection limits, and a
    client-supplied request id is discarded (`start/resource_limits.ts`).
16. The backend's runtime framework packages are pinned to exact versions; it is not published.
17. Every database test group starts from wipe and migrate. Groups that send no HTTP request and
    never reach Account Kit then run each test inside a global transaction; the rest reset rows
    through fixture helpers, because Account Kit refuses a connection already in a transaction and
    the rate limiter's database store waits for the one pooled connection the transaction holds.
18. Retired. One routes file per area is not a departure, and formatting belongs to the
    Prettier configuration.
19. The exception handler shows debug output in development only (`debug = app.inDev`), so the
    test environment answers with the same error bodies as production.
20. A type used by one file stays in it. A type shared across files goes in the feature's
    `types.ts` or `app/types/`; there is no `types/` folder for every declaration.
21. Before the first release the migrations are edited in place: no installed database exists,
    and the alpha tags that carried them do not make them released (#2345 decision D4). Released
    migrations are append-only. Production refuses rollbacks (`disableRollbacksInProduction`).
22. A validator reads one request source: the body for a write and the query string for a read,
    passed as `validateUsing(validator, { data })`. It never validates the merged `request.all()`,
    so a credential is never accepted from a URL.
23. Operator commands are tested by starting the CLI in its own process, with its own database
    file, environment and exit code, because their lock and exit-code contract is a process
    boundary. They are not tested in process with `ace.create`.
24. **Aligning (#2352, waiting on package releases).** Account Kit checks credentials. The
    `User` model does not compose `withAuthFinder`, and no product code calls
    `verifyCredentials`: sign-in, sessions and password checks are the kit's.
25. Retired. Every controller action destructures the HTTP context (CTL-4); the view-as control
    actions delegate to the request-scoped `MasqueradeControlService`, which receives `HttpContext`
    from the container to pass to the Masquerade package.
26. Retired. Every product wire code is E_UPPER_SNAKE (EXC-7).
27. Retired. Every API route is under `/api/v1`; the health probes stay at `/health/live` and
    `/health/ready`.
28. Retired. The root `package.json` sets `@adonisjs/prettier-config` unchanged (TOOL-2).
29. **Aligning (#2550).** The `dbAssertions` plugin is not registered; tests read rows with the
    query builder and check them with `assert`.
30. **Aligning (#2550).** A provider connects or spawns in `start` behind an `app.getMode()`
    check.
31. **Aligning (#2550).** `bin/test.ts` holds the test values computed per port lane; the rest are
    in `.env.test`.
32. Retired. The licence file is `LICENSE.md` (TOOL-6).
33. **Aligning (#2553).** Ten `catch` blocks in nine controllers answer with the product's
    own error body (a status of 400 or above) instead of letting the exception reach the exception
    handler. The answers on the wire do not change when they move.
34. Retired (#2554). The health check controllers are single action controllers.
35. Sessions use the database store in every environment, tests included; `.env.test` does not
    set `SESSION_DRIVER=memory`, because the Account Kit session protection in
    `config/session.ts` accepts only the database store. The `loginAsSession` test plugin signs
    API tests in with `.loginAs(user)` on that store (#2572).
36. Retired (#2578). The backend imports `tooling/` by its package name, `@capacitylens/tooling`.
37. Tests insert rows into tables that have no Lucid model with the query builder, because a model
    factory needs a model. This covers `db.table(...).insert` and `multiInsert` under
    `apps/backend/tests` into any table without a model in `app/models`: today `memberships`,
    the Account Kit tables (`account_*`, `password_reset_tokens`), `adonis_schema`,
    `deleted_groups`, `deleted_rows`, `planning_mutations`, `audit_entries`, `request_receipts`,
    `company_settings` and `company_planning_revisions` (#2572).
38. Tests that write a stored row on purpose insert it raw, not through a model factory (#2572):
    - schema CHECK constraints and encoded rows read back: `tests/functional/state/database_contract.spec.ts`;
    - database triggers fed invalid cross-company references: `tests/functional/state/database_contract_cases.ts`;
    - the operator command's own SQLite file, which a child process opens:
      `tests/helpers/operator_command_helpers.ts`, `tests/helpers/unit/operator_databases.ts` and
      `tests/unit/owner_reset_command.spec.ts`;
    - the stored format a migration converts: `tests/functional/deletion_marker_migration.spec.ts`;
    - 32,767 allocation rows written in bulk, where one model insert per row would dominate the
      suite: `tests/functional/planning/restoration_allocations.spec.ts`.
39. `tests/functional/state/read_path.spec.ts` sends each recorded request from
    `tests/fixtures_main_responses.json` by its recorded method and path, not by route name: the
    path is the fixture's data (#2572).
40. `tests/helpers/unit/mail_config.ts`, used by `tests/unit/mail_config.spec.ts`, replaces
    `transports.smtp` with `mock.method` and restores it in `finally`. The test checks the options
    `config/mail.ts` passes when the file is imported, a call that neither the container `swap`
    nor `mail.fake()` can observe (#2572).

41. `config/masquerade.ts` resolves `lucid.db`, and `providers/backup_provider.ts` resolves
    `sqlite.backup`, from the container instead of importing their `services` modules (IMP-6). The
    masquerade package opens its store while providers boot, before the `db` service import
    resolves, and the backup provider's tests bind a fake backup in the container.
42. Tests replace methods of the Account Kit, confirm-action and masquerade services by assignment
    and restore them in `finally` (SVC-4, TST-9), because those packages resolve their services once
    at boot and controllers import them directly, so a container `swap` does not reach them. This
    covers `tests/functional/auth/masquerade.spec.ts`, `authentication_events.spec.ts`,
    `auth/request_contracts.spec.ts`, `auth/admission.spec.ts`, `auth/invitations.spec.ts` and
    `privacy/password_confirmation_adoption.spec.ts`.
43. The database readiness check logs with the logger service, not `ctx.logger` (OPS-1): the
    framework's health check runner gives a check no request, and a check's result is serialised
    into the public probe body, which must not name migrations.
44. Retired. Each table has its own migration with its tableName (DB-6).
45. **Aligning (Kevinjohn/oss-adonisjs-confirm-action-with-password#117).**
    `password_confirmations.sign_in_id` keeps the name the confirm-action package reads and writes,
    instead of `account_session_id` (MOD-5).
46. **Aligning (Kevinjohn/oss-adonisjs-masquerade#501).** Routes are marked for view-as mode with
    the masquerade package's `sensitive()` marker inside `.use(...)`, not a named middleware
    (RTE-5).
47. `config/logger.ts` imports the `err` serializer's dependencies from the application
    (`#exceptions/unexpected_exception`, `#services/logging_safety`) (CFG-4): Pino serializers are
    part of the logger configuration, and the error classification they use is shared with the
    services that report failures.

## Installation

- Installation is from the repository: clone it at a release tag, install, build and run. The
  installed server runs with production defaults. There is no release archive and no install
  script (#2436 removes them); the documented steps are the installation. The upgrade is the same
  steps at a newer tag, then `app:upgrade`. Backup scheduling stays in the web provider. Company
  naming then happens in the browser. The hosting operator owns upgrades, backups and service
  maintenance; the company Owner is not expected to maintain hosting alone.
- The repository and the tagged container images are the only distribution channels. Another
  channel, packaging format or platform build needs an owner decision recorded here first.
- Native Node with a loopback TLS proxy on the same machine is the expected installation. The
  operator owns that proxy; the server's HSTS header is host-only. Container images are optional
  and are a release output only: they are built, smoke-tested and published when a release is
  tagged, never on pull requests or pushes to `main` (#2436 brings the workflows into line). A
  proxy on a separate machine is unsupported for the first release. The Compose stack's
  own nginx hop is supported: its API trusts forwarded headers from private-network peers, so each
  client keeps its own request limits.
- Account Kit's empty tables for capabilities the product does not use stay: the kit visits them
  in its hourly prune, account deletion and every credential change, whichever capabilities are
  enabled.
- Production deployment omits optional dependencies, which keeps the framework's build tooling and
  its unpatched transitive dependency out of shipped runtimes. The production audit uses the same
  optional-free graph and fails on high severity.
- SMTP is the only mail transport.

## Open source

- The repository is GPL-3.0-or-later. CapacityLens names and logos are not granted by the licence.

## Continuous integration

- Patch and minor dependency updates preserve the declared Node runtime floors, the TypeScript
  compiler baseline, the browser build target and the production host boundary. Raising any
  of them is a separate product decision supported by validation, never a side effect of updating a
  package.
- Keep formatting, type checking, lint, dependency security checks, product builds and meaningful
  unit, functional and browser tests. No coverage floor, file-size cap, test-size cap or
  suppression ratchet. A mechanical check is added only for a rule the owner has set (the
  terminology check, #2435, is one) or when experience shows it protects a concrete invariant.
- Local commands and CI validate the same behaviour. A test run passes only when its process exits.
- The browser-test reset switch stays: it is the only switch that loads the browser-test worker
  reset harness, and production refuses to start with it set. There is no HTTP reset route: the
  harness's one control request, `POST /__e2e/epoch`, restores nothing. It sets the current
  test's request tag and answers once no `/api/` handler is running; the harness then refuses any
  `/api/` request carrying another tag. The test restores the database itself, through SQLite.

## Module boundaries

- A module owns one named behaviour. Follow the framework's and the surrounding code's conventions
  for structure and names. Preserve visible orchestration, transaction order and failure
  propagation when extracting.
- External names (wire fields, route paths, environment variables, storage keys, error codes, the
  export format, table and column names) follow the terminology dictionary. They are frozen at the
  first beta release: after it, a rename needs a functional reason and a migration, never wording
  alone, and is a breaking change that needs the owner's ruling.
