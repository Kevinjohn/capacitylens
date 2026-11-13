# Standing decisions

This is the short, present-tense record of decisions that constrain future work.

## Product

- CapacityLens is a week-granularity capacity overview for small agencies.
- Budgets, money, timesheets, hour-by-hour workflows and mobile scheduling are non-goals.
- “Utilisation” is the product term.
- Clients own projects; projects and internal work contain activities; allocations connect a
  resource to an activity over a date range.
- Activities are `project`, `internal` or `repeatable` (the user-facing label is **Project-specific**,
  **Internal** or **All projects**). Only project-specific activities may reference a project or
  phase. An all-projects activity stays project-less, but each of its allocations may optionally
  attribute the booking to a project; project-specific and internal allocations must not.
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
  The sidebar action can reopen it at any time. Dismissal is a versioned device preference scoped
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
  keyboard and while any modal is open; those contexts keep both the chord and page layout stable.
- English is the only locale. The message layer and the company `language` field stay: the field
  selects the runtime locale, is shown when a company is created and cannot be changed afterwards.

## Scheduling invariants

- A day is over capacity only when allocated capacity is strictly greater than available capacity.
- A person's effective working week is the intersection of the company's global working days and
  their personal pattern; external parties use the company set verbatim. A company must keep at
  least one working day — an empty stored selection is repaired to the week-start default.
- Normal allocations do not consume days outside the effective working week. `ignoreWorkingDays`
  (the **Ignore working days** checkbox) is the explicit exception; it never bypasses time off.
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
- `overSoon` is calculated over a fixed forward 14-day window from today and never changes with
  zoom or pan.
- The visible span is chosen from a **Weeks visible** dropdown, not a row of always-on buttons; the
  schedule's top bar is reserved for the controls people reach for every session.
- The schedule's jump-to-date picker is not shown. The control remains in the codebase and under
  test.
- Narrowing a resource's availability (working pattern, weekly capacity or employment type)
  leaves existing allocations in place; capacity and utilisation are recalculated so they show
  as over-capacity rather than being moved, split or deleted.

## Data and tenancy

- Every server requires an authenticated, authorised company member. There is no sign-in mode
  setting or anonymous persisted access. The development demo runs the full server with a printed
  sign-in and one sample company on disposable SQLite storage. Refresh retains changes; restarting
  the command resets the sample data. Each invocation owns a temporary directory beneath the backend
  temporary-data directory, with `.demo.db` as its basename. Cleanup removes it only after the
  owned process groups have exited. Uncertain crash residue is retained and never reset by a later
  invocation; Windows also retains storage when descendant exit cannot be verified.
- SQLite is the only product database. One process owns one database file through a pool of one
  connection. Missing API access is an error, never a silent browser-storage fallback.
- Every scoped row carries its company id. The server authorises every tenant read and write from
  session membership; client scoping is UI hygiene, not authorisation. Database triggers reject
  cross-company references within the scheduling graph; control links are checked transactionally
  against the member and resource. Every installation serves one company. First-install setup
  creates that company; the UI offers no company switcher or additional-company creation. Tenant
  scoping, memberships and the account directory remain enforced, and ambiguous installations
  report an error.
- Planning reads return current authority, one integer company revision and the complete,
  confidentially projected company slice from one transaction. Every typed mutation carries the
  `baseRevision` it was drafted against; a mismatch returns 409 and the client refetches. No
  automatic rebase or replay. A revision advances once per transaction that changes planning data,
  planning projection or membership authority; session activity, mail and configuration edits that
  change neither do not advance it.
- A planning mutation is identified by a client-minted UUID recorded with the audit row in the
  same transaction. A later lookup answers "committed at revision N" or "unknown"; absence while the
  request may still be executing is not failure. Reusing a committed identity returns 409.
- Undo and redo are typed inverse operations held page-locally in the browser. Deleted planning
  rows remain in their own tables under package-managed soft deletion, bound to a session, actor
  and company through the recovery ledger. Restore is one atomic operation under current authority;
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
  Undo and redo write audit rows. History survives a same-revision refetch and is cleared by an
  external revision change, a context change or a reload. There is no cross-device undo.
- Ordinary writes reject invalid supplied input; nothing is repaired on the way in. Blind writers
  cannot echo hidden names or notes, so an unrelated edit preserves protected stored values.
  Unknown request fields are stripped by the validator.
- The portable export is this product's own document and the only import source. Import is
  Owner-only, atomic and not undoable. A malformed or foreign document is rejected, never repaired.
  Identity, sessions, membership and admission records are never part of the export.
- Beta transfer uses the versioned full company document, binds the exported company scope to
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
- A person deletes their own account from **Account** with their current password. The password
  is checked through a `delete-account` password confirmation scoped to the person, then Account
  Kit removes the identity, sessions and tokens; in the same transaction CapacityLens removes every
  membership through the Access Control package and the member/person link. An Owner must transfer
  ownership first. Invitations the person sent stay acceptable with their inviter cleared. The person
  resource and audit rows keep the former user id as history.
- Editor and up may change company-wide planning and display configuration (company name,
  scheduling mode, disciplines, colour mode, feature visibility, time zone, week start). Identity,
  membership, privacy, lifecycle, import and erasure keep their Owner/Admin gates.
- Account colours come from the preset palette. Ordinary writes reject anything else.
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
- A native online SQLite backup runs at startup and every 24 hours; count-based retention keeps the
  configured number of verified READY bundles on local storage. The package owns copying, verification, retention and restore preparation; the web provider owns scheduling. Pre-migration bundles and reset archives stay outside scheduled retention. Failures are logged or returned by the operator command.
- Account commands record receipts with `@kevinjohn/adonisjs-duplicate-request-guard`
  (`request_receipts`) inside the caller's transaction. The wire contract keeps the standard
  `Idempotency-Key` header, and CapacityLens's own names follow it (`idempotencyKey`,
  `isAccountIdempotencyKey`, `IDEMPOTENCY_CONFLICT`); only values passed to the package use its
  `requestKey` name. Receipts are scoped to one actor's operation, so the same command headers sent
  by another actor or for another operation run as a new command.
- Completed request receipts are deleted 24 hours after their last update, at startup and hourly.
  Pending receipts stay. A command retried after its receipt is deleted runs as a new command.

## Browser data

- Scheduling records and identity snapshots are never persisted in the browser. The Zustand
  planning slice is a non-persisted cache patched from server responses; it is never authoritative.
  Server failures stay visible and retryable. There is no offline mode, write queue or fallback.
- Ordinary device preferences live in localStorage. The disposable demo uses the same server-owned
  planning data path as an installation.

## Accounts, admission and security

- Account Kit owns accounts: password sign-in, registration, address confirmation, password
  change and reset, invitations, sessions and admission. CapacityLens owns company membership,
  roles, the member↔resource link, Bouncer policies and every screen and word that renders a kit
  outcome. Password sign-in is the only sign-in method; there are no identity providers.
- Company memberships are stored and ruled by `@kevinjohn/adonisjs-access-control`: its
  `memberships` table, the roles viewer < editor < admin < owner, and the permission keys declared
  once in `packages/shared/src/domain/access.ts`. The server authorizes through the package's
  Bouncer abilities with the membership read in the request transaction; the browser reads the same
  declaration only to show or hide controls. A membership is active or suspended. Nobody manages
  their own membership, and an Admin cannot manage the Owner.
- Admission is cumulative and owned by the kit: an optional allowed email domain
  (`CAPACITYLENS_ALLOWED_EMAIL_DOMAINS`), invitation evidence and Owner or Admin approval, all from
  static configuration (restart to change). Accepting an emailed invitation records the evidence,
  confirms the address and creates the membership with the invited role; approval is still required. A person who is signed in but not admitted
  reaches only the limited screens, which show the step that applies. Approval, rejection and
  revocation are enforced on the next request; nothing is pushed to the browser. An admitted person
  without a membership (operator-granted evidence or an approved registration) joins explicitly,
  with the invited role or Viewer, never Owner. A suspended member cannot rejoin this way; only an
  Owner or Admin restores them. A new identity always needs fresh invitation evidence and approval.
- Invitations are emailed only; the acceptance link is never shown in the product. One configured
  lifetime (seven days) applies to every invitation. Accepting creates a new identity and refuses an
  already-registered address; identities are never merged by email. When an existing limited
  account needs invitation evidence, the operator uses the kit's `grant-invitation` command. An
  invitation never proposes or creates a Resource; link the member to a Resource after they join.
- Invitations, address confirmation and password resets need configured mail delivery. Without
  it they are refused with an explanation rather than falling back to a copyable link.
- Sessions use the kit's database-backed registry with a 14-day idle expiry. Changing or resetting
  a password ends every session, including the current one. Administrator password resets and
  session revocation for other members are deferred; the operator's kit commands cover recovery.
- Ownership transfer, whole-company import and company-wide people anonymisation each require a
  password confirmation for that action; no time-based fresh-session window replaces it.
- A password confirmation is single-use, lasts five minutes and binds the real principal, Kit
  session, live credential revision, company, action and exact intent. It verifies the current
  password and is spent in the same transaction as the change, including ownership transfer's
  idempotency execution boundary.
- `@kevinjohn/adonisjs-confirm-action-with-password` 0.1.1, used with exactly Account Kit 0.3.4,
  owns issuance, credential/session/request binding, expiry and transactional consumption. Product
  code owns live company authority and the response contract; its pre-flight and transactional
  policy require a confirmed email, admission, a live Owner and no view-as mode. Credential writes
  remain Account Kit-owned.
- Wrong passwords are limited per account before hashing: five failures per minute, then a
  20-minute block. A successful confirmation resets only that account's budget.
- Confirmations are pruned globally after successful issuance, outside every transaction; a pruning
  failure cannot fail the issuance response.
- Account deletion issues and spends its own `delete-account` confirmation, scoped to the person's
  id with no company authority, just before Account Kit's deletion transaction. The Kit's own
  current-password check stays because it cannot be turned off. A confirmation's scope carries no
  foreign key to `accounts`.
- The wire names are `POST /api/auth/password-confirmation`, `confirmationId`,
  `PASSWORD_CONFIRMATION_REQUIRED` and `PASSWORD_CONFIRMATION_DENIED`.
- Password hashing uses the framework's default hasher through the kit. There is no breach
  screening and no custom hashing queue.
- Production requires an HTTPS public URL; plain HTTP is accepted only for loopback development.
- The first identity comes from the operator's bootstrap invitation, printed by
  `account-kit:admission:bootstrap`. Accepting it sets that person's password; on an empty
  installation the sole admitted identity then enters a company name in the browser and becomes its
  Owner. The current session, absence of companies/memberships and sole-principal identity are
  checked under the transaction lock, and defaults, Internal client, membership, revision and audit
  commit together. The server refuses open signup until the first company exists, even when open
  signup is enabled in configuration. The stopped-server operator initializer remains a recovery
  option and also requires an admitted identity. No environment variable grants company ownership.
  A development-only demo command may, on an empty disposable database, create the sample company and make the development bootstrap identity its Owner. Production refuses it. It is not an install path and grants nothing through an environment variable.
- Each company has exactly one Owner. Ownership moves only by one atomic transfer to an existing
  member; the former Owner becomes Admin. Admins cannot administer an Owner. Credential recovery
  for a locked-out Owner is the kit's operator command, never an in-product action.
- Members and schedulable Resources are separate records linked explicitly. Adding a Resource never
  grants access; inviting a member never creates a person. Team & access is visible to every role;
  only Owner/Admin see invitation and access-management controls.
- View-as-member uses the pinned Masquerade package for identity-wide, read-only modes and durable
  lifecycle audit, with a fixed 15-minute expiry. Every signed-in session observes the same mode on
  its next request; focus and visibility reconciliation refresh the browser. Company navigation
  ends the mode globally; signing out ends only the current session. Each company request checks
  both real-actor and target permissions. No failed target check falls back to actor permissions.
- Package admission captures the request identity before product transactions. The product
  transaction revalidates the same real actor/session and company/target access. Already-admitted
  operator requests may finish after start; already-admitted target requests remain read-only after
  stop. Package operations never run inside the single-connection product transaction. Covered
  writes require the context captured for the action, including idle-mode writes; stale actions are
  refused and never automatically replayed.
- One global server middleware enforces view-as policy before routing: while a mode is active it
  refuses every unsafe request and the listed identity, membership and administration reads. The
  package's effective guard and route markers are not used, because product routes resolve their
  actor through `withActor`, not the AdonisJS auth middleware those markers depend on. A new
  sensitive read route must be added to the middleware's list. Revisit if product routes adopt the
  auth middleware.
- Package events are authoritative for view-as lifecycle audit. They carry no company ID and no
  separate explicit, company-switch or sign-out classification. Control state and events stay in
  database backups, outside scheduling exports.
- View-as events are kept for 365 days. The server runs the package's `masquerade:prune` at
  startup and hourly: it ends expired modes and deletes older events. A failed pass is logged and
  retried on the next one. The operator can also run `masquerade:prune`, `masquerade:status` and
  `masquerade:stop`.
- Unsafe requests are accepted only from the public URL's origin or a `CAPACITYLENS_CORS_ORIGIN`
  entry; when that is unset outside production, the built-in `localhost` and `127.0.0.1` origins on
  ports 5173 and 5273 are trusted. With no Origin, only `Sec-Fetch-Site: same-origin` is accepted.
  Shield owns HSTS, `nosniff`, frame protection and the CSP. HSTS is sent only when the public URL
  is HTTPS. There is no CSP report route. Secure-cookie behaviour follows `CAPACITYLENS_PUBLIC_URL`.
- The audit table is written inside the mutation's transaction. Post-commit logging is diagnostic.
- Logs correlate a request by the framework's `request_id`. The server always generates it (a
  UUID, echoed in the `X-Request-Id` response header); a client-supplied `X-Request-Id` is
  discarded before the framework reads it, so no client text becomes the id.
- Validation and domain errors use the flat `{ error, code? }` contract. Vine runs behind one
  response adapter; the SPA keys its presentation on `code`.
- Rate limits on authentication and the API use `@adonisjs/limiter`.
- CapacityLens ships no analytics. Mail delivers addressed invitations, address confirmations and
  password resets only.
- Errors on data paths are surfaced, not swallowed.

## AdonisJS framework departures

The AdonisJS documentation is the structural reference. These choices deliberately differ from
framework defaults; any other departure needs a decision recorded here first.

1. `packages/shared` is imported by the backend and the SPA. It contains pure domain rules and wire
   types, never backend code.
2. Validation errors use the flat `{ error, code? }` contract with status 400, not Vine's 422
   `errors[]`. Empty strings are not converted to null; empty optionals are `null` on the wire,
   in storage and in the export.
3. Product models fail closed without an explicit tenant scope. Retained bulk services authorise
   the company and scope their queries inside a transaction because model hooks do not cover bulk
   updates and deletes.
4. Columns are snake_case; transformers own the camelCase wire format. Calendar dates are date-only
   strings; instants may use Lucid date-time columns and serialise to ISO.
5. Product environment variables use the `CAPACITYLENS_` prefix; framework variables keep the
   framework's names.
6. The backend serves the SPA from `public/` with the product security headers and a history
   fallback rather than a separate static-file proxy.
7. The SQLite pool is one connection, configured when it is created. Network, mail and password
   hashing stay outside transactions.
8. CSRF is the Origin / Sec-Fetch-Site check, not Shield's XSRF token.
9. The TanStack Query cache is used for account and admin reads only; planning data lives in the
   Zustand planning slice (see Browser data).

## Installation

- Installation is one runnable release archive, and the server takes production defaults when
  `NODE_ENV=production`. Its `install.sh` script, which runs the manual steps as root on a systemd
  host, is the default path. It never rewrites an existing environment file; running a newer
  release's script without arguments is the upgrade. Backup scheduling stays
  in the web provider. The manual steps remain the documented fallback.
  Company naming then happens in the browser. The hosting operator owns upgrades, backups and service
  maintenance; the company Owner is not expected to maintain hosting alone.
- Native Node with a loopback TLS proxy on the same machine is the expected installation. The
  operator owns that proxy; the server's HSTS header is host-only. Existing container support is
  optional. A proxy on a separate machine is unsupported for the first release. The Compose stack's
  own nginx hop is supported: its API trusts forwarded headers from private-network peers
  (`CAPACITYLENS_TRUST_PROXY_HEADERS=private`), so each client keeps its own request limits.
- The empty `social_*` tables and `login_link_tokens` stay: Account Kit 0.3.4 visits them in its
  hourly prune, account deletion and every credential change, whichever capabilities are enabled.
- Production deployment omits optional dependencies, which keeps the assembler and its unpatched
  `braces` transitive dependency out of shipped runtimes. The production audit uses the same
  optional-free graph and fails on high severity.
- SMTP is the only mail transport. Nodemailer stays on 10.x at 10.1.4 or later; the Postmark
  transport is unsupported because it is incompatible with Nodemailer 10.

## Open source

- The repository is AGPL-3.0-only. CapacityLens names and logos are not granted by the licence; see
  `TRADEMARKS.md`.

## Continuous integration

- Patch and minor dependency updates preserve the declared Node runtime floors, the TypeScript
  5.9.3 compiler baseline, the browser build target and the production host boundary. Raising any
  of them is a separate product decision supported by validation, never a side effect of updating a
  package.
- Keep formatting, type checking, lint, dependency security checks, product builds and meaningful
  unit, functional and browser tests. No coverage floor, file-size cap, test-size cap, suppression
  ratchet or custom structural rule. Add a focused check only when experience shows it protects a
  concrete invariant.
- Local commands and CI validate the same behaviour. A test run passes only when its process exits.
- `CAPACITYLENS_ALLOW_RESET` stays: it is the only switch that loads the browser-test worker reset
  harness, and production refuses to start with it set. There is no HTTP reset route.

## Module boundaries

- A module owns one named behaviour. Follow the framework's and the surrounding code's conventions
  for structure and names. Preserve visible orchestration, transaction order and failure
  propagation when extracting.
- Public wire fields, stable identifiers and shipped data formats are not renamed as part of
  structural cleanup.
