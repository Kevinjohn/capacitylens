# Standing decisions

This is the short, present-tense record of decisions that constrain future work.

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
- Undo and redo are held on the server in one history row per company for its last writer, keyed
  to that writer's sign-in, the page's history id and the company revision. The row holds up to 50
  changes, and its stored inverses never leave the server. Deleted planning rows remain in their
  own tables under package-managed soft deletion, bound to a session, actor and company through the
  recovery ledger. Restore is one atomic operation under current authorization;
  internal deletion fields and hidden values never leave the server.
  Restoration groups are removed in the same transaction as anonymisation and import.
  A change to a client or project privacy or code-name field, or to an activity kind, also clears that company's
  pending tombstones in the change transaction. Those retained records can contain names or
  relationships that should no longer be restorable under the new visibility rules. Unchanged
  privacy fields and ordinary settings edits keep the groups. Changing this rule later requires
  a way to prove old hidden recovery data remains safe to restore.
  Before a change clears pending recovery data, one confirmation shows the number of saved
  deleted records: “This change clears N restorable items”. Links to surviving rows are excluded.
  Zero-item and no-change saves skip the warning. Cancellation leaves data and recovery unchanged;
  confirmation stays bound to the original company revision and current cleanup count.
  Undo and redo write audit rows. History survives a same-revision refetch and is cleared by anyone
  else's change, a context change, a reload, a lost reply, a privacy, code-name or activity-kind
  change, anonymisation, import, a change with no inverse and a refused step. There is no
  cross-device undo.
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
- Editor and up may change company-wide planning and display configuration (company name,
  scheduling mode, disciplines, colour mode, feature visibility). Identity, membership, privacy,
  lifecycle, import and erasure keep their Owner/Admin gates.
- Time zone and week start are chosen when the company is created and cannot be changed
  afterwards; a field that was never stored accepts its first value.
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
- Migrations start from one baseline, are forward-only and run through Lucid. `app:upgrade` writes
  an online backup before migrating; the backup is the rollback. There are no down migrations and
  no checksum ledger.
- An online SQLite backup runs at startup and every 24 hours; count-based retention keeps the
  configured number of verified bundles on local storage. Pre-migration bundles and reset archives
  stay outside scheduled retention. Failures are logged or returned by the operator command.
- Account operations record receipts inside the caller's transaction. Receipts are scoped to one
  actor's operation, so the same idempotency and command id headers sent by another actor or for another operation run
  as a new operation.
- Completed request receipts are deleted 24 hours after their last update, at startup and hourly.
  Pending receipts stay. An operation retried after its receipt is deleted runs as a new operation.

## Browser data

- Scheduling records and identity snapshots are never persisted in the browser. The planning
  slice is a non-persisted cache replaced from server reads, or advanced by the rows a committed
  write's receipt returns; it is never authoritative.
  Server failures stay visible and retryable. There is no offline mode, write queue or fallback.
- Each server dataset has one home in the browser. The store owns the planning cache and every
  dataset that store logic reads, such as the company directory. TanStack Query owns server reads
  that one screen reads and no store logic reads: archive recovery, the ownership transfer
  candidates, and the team members and invitations. No dataset is held in both. Undo history is
  held by the server; the planning cache keeps only the page's history id.
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
- A password confirmation is single-use, lasts five minutes and binds the real user, Kit
  session, live credential revision, company, action and exact intent. It verifies the current
  password and is spent in the same transaction as the change, including ownership transfer's
  idempotency execution boundary.
- Both the check before confirming and the check inside the transaction require a confirmed
  address, admission, a live Owner and no view-as mode. Credential writes stay with Account Kit.
- Wrong passwords are limited per account before hashing: five failures per minute, then a
  20-minute block. A successful confirmation resets only that account's budget.
- Cleaning up old confirmations never fails the confirmation being issued.
- Deleting an account also requires a password confirmation for that action, scoped to the person
  with no company permission and spent just before the deletion.
- Password hashing uses the framework's default hasher through the kit. There is no breach
  screening and no custom hashing queue.
- Production requires an HTTPS public URL; plain HTTP is accepted only for loopback development.
- The first identity comes from the operator's bootstrap invitation. Accepting it sets that person's
  password; on an empty installation the sole admitted identity then enters a company name in the
  browser and becomes its Owner. The current session, absence of companies/memberships and
  sole-user identity are checked under the transaction lock, and defaults, Internal client,
  membership, revision and audit commit together. The server refuses open sign-up until the first
  company exists, even when open sign-up is enabled in configuration, and rechecks this under the
  transaction lock used by identity creation. The controlled first identity can still sign in and
  finish setup. Once the first company exists, the configured sign-up rules apply. The
  stopped-server operator initialiser remains a recovery option, never the normal install path, and
  also requires an admitted identity. Neither path creates credentials or changes identity
  admission. No environment variable grants company ownership.
  A development-only demo command may, on an empty disposable database, create the demo company and make the development bootstrap identity its Owner. Production refuses it. It is not an install path and grants nothing through an environment variable.
- The development bootstrap identity is the one account created outside the kit, already
  confirmed and with a known password; the kit creates an account only unconfirmed, with a mailed
  proof. Production refuses the setting that enables it.
- Each company has exactly one Owner. Ownership moves only by one atomic transfer to an existing
  member; the former Owner becomes Admin. Admins cannot administer an Owner. Credential recovery
  for a locked-out Owner is the kit's operator command, never an in-product action.
- Members and schedulable Resources are separate records linked explicitly. Adding a Resource never
  grants access; inviting a member never creates a person. Team & access is visible to every role;
  only Owner/Admin see invitation and access-management controls.
- View as member is identity-wide and read-only, with durable lifecycle audit and a fixed 15-minute
  expiry. Every signed-in session observes the same mode on its next request; focus and visibility
  reconciliation refresh the browser. Company navigation ends the mode globally; signing out ends
  only the current session. Each company request checks both real-actor and target permissions. No
  failed target check falls back to actor permissions. A member may be viewed only by someone whose
  role in that company ranks at or above theirs, so an Admin cannot view as the Owner. The rank is
  rechecked on every request; a target promoted above the viewer ends the view for that company.
- The product transaction revalidates the real actor/session and the company/target access
  captured before it. Already-admitted operator requests may finish after start; already-admitted
  target requests remain read-only after stop. Covered writes require the context captured for the
  action, including idle-mode writes; stale actions are refused and never automatically replayed.
- Every route is gated by name before its handler runs: public routes pass, limited routes need a
  valid sign-in, and every other route also needs a confirmed address and admission. A named route
  in no list gets the strictest check; unnamed routes (the health probes and the application shell)
  have no gate. The gate adds an early refusal; it does not replace the check inside the product
  transaction.
- Each route declares its view-as rule where it is registered. No route allows writes under
  view-as; some reads are refused outright, and a request carrying a stale view-as context is
  refused, reads included.
- View-as control state and events stay in database backups, outside scheduling exports.
- View-as events are kept for 365 days; a regular pass ends expired modes and deletes older events.
- Unsafe requests are accepted only from the public URL's origin or a configured extra origin;
  outside production with none configured, the local development origins are trusted. A refusal
  still carries the security headers. HSTS is sent only when the public URL is HTTPS. There is no
  CSP report route.
- The audit table is written inside the mutation's transaction. Post-commit logging is diagnostic.
- Every request gets a server-generated id for log correlation; no client text becomes the id.
- Validation and domain errors use one flat error contract; the browser presents them by code.
- Authentication and the API are rate limited.
- CapacityLens ships no analytics. Mail delivers addressed invitations, address confirmations and
  password resets only.
- Errors on data paths are surfaced, not swallowed.

## AdonisJS framework departures

The AdonisJS documentation is the structural reference. These choices deliberately differ from
framework defaults; any other departure needs a decision recorded here first. An entry that ends
with "Revisit" was recorded on 2026-11-21 after the framework comparison in #2334 and may be
reopened there.

1. The shared package is imported by the backend and the SPA. It contains pure domain rules and wire
   types, never backend code.
2. Every error leaves in the product's flat error contract, not the framework's default body; the
   exception handler maps each error itself and does not call `super.handle` or `super.report`,
   because they would log the error message and answer in a second shape. Empty strings are not
   converted to null; empty optionals are `null` on the wire, in storage and in the export.
   Revisit: #2334 item 3.
3. Product models fail closed without an explicit company scope. Retained bulk services authorise
   the company and scope their queries inside a transaction because model hooks do not cover bulk
   updates and deletes.
4. Columns are snake_case. The row transformer produces the camelCase wire format from each
   model's column serialisation and the state transformer projects it for the reader's role.
   Calendar dates are date-only strings and flags are boolean columns. Product instants are Lucid
   date-time columns that store and serialise the canonical UTC ISO string with milliseconds, not
   Lucid's SQLite date-time format.
5. Product environment variables use the `CAPACITYLENS_` prefix; framework variables keep the
   framework's names.
6. The backend serves the SPA with the product security headers and a history fallback rather than
   a separate static-file proxy.
7. The SQLite pool is one connection, configured when it is created. Network, mail and password
   hashing stay outside transactions.
8. CSRF is the Origin / Sec-Fetch-Site check, not Shield's XSRF token.
9. The TanStack Query cache is used for account and admin reads only; planning data lives in the
   planning slice (see Browser data).
10. Product services are modules of exported functions and do not use `@inject`. A mutating
    service receives its transaction as an argument; package services are resolved with
    `app.container.make` where they are used. Service files carry no `_service` suffix.
    Revisit: #2334 item 6.
11. A company permission is authorised inside the product transaction through the Access
    Control package, after the route middleware has checked membership. Controllers do not
    call Bouncer and the product has no policies or abilities of its own.
12. Reads of planning tables that have a company-scoped model go through that model. Writes,
    eligibility checks inside a write, checks that must see other companies or soft-deleted
    rows, and tables without a model use the query builder on the caller's connection. Account
    Kit creates identities through the `User` model.
13. Ordinary planning edits go through one mutation route whose validated intent names the
    operation, plus undo and redo. Import, anonymisation and example data have their own
    routes. There are no per-entity resource routes.
14. Planning entities, companies and users have string primary keys. Bookkeeping and
    package-owned tables keep their own keys.
15. The Node server is created by `bin/server.ts` with fixed connection limits, and a
    client-supplied request id is discarded (`start/resource_limits.ts`).
16. The backend's runtime framework packages are pinned to exact versions; it is not published.
17. Every database test group starts from wipe and migrate. Groups that send no HTTP request and
    never reach Account Kit then run each test inside a global transaction; the rest reset rows
    through fixture helpers, because Account Kit refuses a connection already in a transaction and
    the rate limiter's database store waits for the one pooled connection the transaction holds.
18. Routes are registered from one file per area in `start/`. Prettier keeps semicolons.
19. The exception handler shows debug output in development only (`debug = app.inDev`), so the
    test environment answers with the same error bodies as production.
20. A type used by one file stays in it. A type shared across files goes in the feature's
    `types.ts` or `app/types/`; there is no `types/` folder for every declaration. Revisit: #2334
    item 7.
21. Before the first release there is one baseline migration without `down()`, and it is edited
    in place: no installed database exists, and the alpha tags that carried it do not make it
    released (#2345 decision D4). Released migrations are append-only. Production refuses rollbacks
    (`disableRollbacksInProduction`). Revisit: #2334 item 8.
22. A validator reads one request source: the body for a write and the query string for a read,
    passed as `validateUsing(validator, { data })`. It never validates the merged `request.all()`,
    so a credential is never accepted from a URL. Revisit: #2334 item 15.
23. Operator commands are tested by starting the CLI in its own process, with its own database
    file, environment and exit code, because their lock and exit-code contract is a process
    boundary. They are not tested in process with `ace.create`. Revisit: #2334 item 17.
24. Account Kit checks credentials. The `User` model does not compose `withAuthFinder`, and no
    product code calls `verifyCredentials`: sign-in, sessions and password checks are the kit's.
    Provisional: accepted on 2026-11-21 so work can proceed, and to be reviewed again before the
    first release. Revisit: #2334 item 1.

## Installation

- Installation is one runnable release archive, and the installed server runs with production
  defaults. Its install script, which runs the manual steps as root on a systemd host, is the
  default path. It never rewrites an existing environment file; running a newer release's script
  without arguments is the upgrade. Backup scheduling stays in the web provider. The manual steps
  remain the documented fallback. Company naming then happens in the browser. The hosting operator
  owns upgrades, backups and service maintenance; the company Owner is not expected to maintain
  hosting alone.
- Native Node with a loopback TLS proxy on the same machine is the expected installation. The
  operator owns that proxy; the server's HSTS header is host-only. Existing container support is
  optional. A proxy on a separate machine is unsupported for the first release. The Compose stack's
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
  unit, functional and browser tests. No coverage floor, file-size cap, test-size cap, suppression
  ratchet or custom structural rule. Add a focused check only when experience shows it protects a
  concrete invariant.
- Local commands and CI validate the same behaviour. A test run passes only when its process exits.
- The browser-test reset switch stays: it is the only switch that loads the browser-test worker
  reset harness, and production refuses to start with it set. There is no HTTP reset route.

## Module boundaries

- A module owns one named behaviour. Follow the framework's and the surrounding code's conventions
  for structure and names. Preserve visible orchestration, transaction order and failure
  propagation when extracting.
- Public wire fields, stable identifiers and shipped data formats are not renamed as part of
  structural cleanup.

## Open for review

Decisions taken during delivery that the owner has not yet confirmed; an entry leaves this section
when confirmed or reversed.

- None recorded.
