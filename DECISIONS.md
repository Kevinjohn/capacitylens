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
  to the signed-in person and company (with stable demo, local and no-company scopes), never
  company data or export data. Reopening focuses the guidance; automatic background state changes
  do not repeatedly steal focus. A copy change may bump the version to show materially changed
  guidance again.
- A new setting needs a user who cannot proceed without it. Prefer deriving a value from what the
  operator or company already told us.
- Intentional friction against task tracking: inline **Add activity** and the **Task** field stay
  opt-in company settings, off by default. Early users treated activities as a task list; one
  company reached about 300 activities and scheduled hour by hour instead of blocking days on a
  project. CapacityLens is a week-granularity capacity view, and the friction is deliberate.
- CapacityLens is a single product. The earlier sibling-product framing is retired; there is one
  product, one repository and one set of releases.
- The global sidebar shortcut (⌘B / Ctrl+B) yields while text entry or IME composition owns the
  keyboard and while any modal is open; those contexts keep both the chord and page layout stable.

## Scheduling invariants

- A day is over capacity only when allocated capacity is strictly greater than available capacity.
- A person's effective working week is the intersection of the company's global working days and
  their personal pattern; external parties use the company set verbatim. A company must keep at
  least one working day — an empty stored selection is repaired to the week-start default.
- Normal allocations do not consume days outside the effective working week. `ignoreWeekends`
  (the **Ignore working days** checkbox) is the explicit exception; it never bypasses time off.
- A company closure is a literal inclusive date span: no working-week filtering, whole days only
  and no per-person exception. Closures and personal time off are independent and may overlap
  freely, with no merging or precedence.
- New allocations must start on an effective working day (create, duplicate and reassignment all
  enforce it); edits to existing allocations stay permissive. Later occurrences of a repeat batch
  may start on non-effective days and are counted in an advisory, not blocked.
- Changing global working days reinterprets existing allocations: stored dates never move, while
  capacity, utilisation and conflicts are recalculated.
- Displayed utilisation is calculated over the visible 1/2/4/6/8-week window.
- `overSoon` is calculated over a fixed forward 14-day window from today and never changes with
  zoom or pan.
- The visible span is chosen from a **Weeks visible** dropdown, not a row of always-on buttons. The
  five spans are unchanged; the schedule's top bar is reserved for the controls people reach for
  every session.
- The schedule's jump-to-date picker is not shown. Planners rarely look far ahead, and when they do
  a month list is the likelier affordance; that design is deferred rather than decided. The control
  remains in the codebase and under test so restoring or reusing it is a one-line change.
- Narrowing a resource's availability (working pattern, weekly capacity or employment type)
  leaves existing allocations in place; capacity and utilisation are recalculated so they show
  as over-capacity rather than being moved, split or deleted (2026-09-11). Follow-up:
  https://github.com/Kevinjohn/capacitylens/issues/802.

## Data and tenancy

- CapacityLens has two access experiences: `VITE_CAPACITYLENS_DEMO=1` is an editable, in-memory
  demo whose scheduling data resets on reload; every persisted server requires an authenticated,
  authorised company member. There is no sign-in mode setting; nothing enables anonymous persisted
  access.
- SQLite is the only product database. One process owns one database file through a pool of one
  connection. Missing API access is an error, never a silent browser-storage fallback.
- Every scoped row carries its company id. The server authorises every tenant read and write from
  session membership; client scoping is UI hygiene, not authorisation. Database triggers reject
  cross-company references within the scheduling graph; control links are checked transactionally
  against the member and resource. One production installation holds one company; the demo may hold
  several.
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
- A person deletes their own account from **Account** with their current password. Account Kit
  removes the identity, sessions and tokens; in the same transaction CapacityLens removes every
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
  `requestKey` name (9 November 2026). Receipts are scoped to one actor's operation, so the same
  command headers sent by another actor or for another operation run as a new command. The
  migration does not carry `command_results` receipts over: a command retried across that upgrade
  runs again.

## Browser data

- Scheduling records and identity snapshots are never persisted in the browser. The Zustand
  planning slice is a non-persisted cache patched from server responses; it is never authoritative.
  Server failures stay visible and retryable. There is no offline mode, write queue or fallback.
- Ordinary device preferences live in localStorage. The demo is volatile and in-memory.

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
- Ownership transfer, whole-company import and company-wide people anonymisation require proof for
  each action, and no time-based fresh-session window replaces it. Each proof is
  single-use, bound to the real principal, Kit session, company and exact operation, verifies the
  current password and is spent in the same transaction as the change. The pinned confirm-action-with-password package owns issuance, credential/session/request binding, expiry and
  transactional consumption; product code owns live company authority and the response contract.
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
- Package events are authoritative for new view-as lifecycle audit. Historical product audit stays
  intact, but new events do not retain a company ID or separate explicit/company-switch/sign-out
  classifications. Control state and events stay in database backups, outside scheduling exports.
  Upgrades end legacy projections without converting their tokens into new authority.
- Cross-site writes are refused by the Origin / Sec-Fetch-Site check, with one exemption for a
  same-host Origin that claims `https` behind a TLS-terminating proxy. Shield owns HSTS, `nosniff`
  and frame protection; HSTS is sent only when the public URL is HTTPS. There is no CSP report
  route. Secure-cookie behaviour follows `CAPACITYLENS_PUBLIC_URL`.
- The audit table is written inside the mutation's transaction. Post-commit logging is diagnostic.
- Validation and domain errors use the flat `{ error, code? }` contract. Vine runs behind one
  response adapter; the SPA keys its presentation on `code`.
- Rate limits on authentication and the API use `@adonisjs/limiter`.
- CapacityLens ships no analytics. Mail delivers addressed invitations, address confirmations and
  password resets only.
- Errors on data paths are surfaced, not swallowed.

### Password confirmation package adoption (9 November 2026)

This supersedes the retention decision in the historical capability audit below. CapacityLens uses
`@kevinjohn/adonisjs-confirm-action-with-password` 0.1.0 with exactly Account Kit 0.3.3. Its five-minute confirmations bind
the user, sign-in, live credential revision, company, action and exact intent. Host pre-flight and
transactional policy retain confirmed-email, admission, live Owner and no-masquerade requirements.
The app's database limiter reserves attempts per account before hashing: five failures per minute,
then a 20-minute block. A successful confirmation resets only that account's budget.

Consumption shares the product transaction, including ownership transfer's idempotency execution
boundary. The forward-only migration replaces outstanding legacy proofs without copying, creates `password_confirmations` and adds
`scope -> accounts.id ON DELETE CASCADE`. Credential writes remain Account Kit-owned. Global pruning
runs after successful issuance outside every transaction and cannot fail the issuance response.

The product calls these password confirmations, not action proofs (9 November 2026): the endpoint is
`POST /api/auth/password-confirmation`, requests carry `confirmationId`, and refusals use
`PASSWORD_CONFIRMATION_REQUIRED` and `PASSWORD_CONFIRMATION_DENIED`. Behaviour is unchanged. The old
path has no alias: the API is pre-1.0 and its only client is in this repository.

### Password confirmation capability audit (26 October 2026)

Retain the product proof for ownership transfer, import and company-wide people anonymisation. The installed
Account Kit 0.1.2 has recent-password proofs, but its public contract does not provide all the
bindings and caller-owned transactional consumption needed by these operations. A time-based
confirmation or a different proof purpose is not an equivalent replacement.

This source audit checked application revision `f52bee5fe75604b33c1191294a80259825461aba` and
[`vendor/adonisjs-account-kit/adonisjs-account-kit-0.1.2.tgz`](vendor/adonisjs-account-kit/adonisjs-account-kit-0.1.2.tgz)
(SHA-256 `18696d27971605dbbada54ccb9066260499fc9ab3f258cd7684ed6098dacf573`).
The archive's `build/src/account_kit.d.ts`, `social_enums.d.ts`, `social_proofs.d.ts`, package
exports and bundled proof implementation establish the Kit column below. This is not a claim that
Kit runtime parity tests passed.

| Required guarantee                                          | Product implementation                                                                                                                                               | Installed Kit contract                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Confirm the real principal's current password               | Verifies the password, then rechecks the live principal and password before issuing                                                                                  | `socialAuthentication.provePassword` accepts the current principal, password and purpose; that optional capability is not enabled here |
| Bind the intended operation                                 | Binds `transfer-ownership`, `import` or `anonymise`                                                                                                                  | Fixed purposes cover social linking/unlinking, password/email changes and account export/deletion; not these product operations        |
| Bind the principal                                          | Stores and conditionally matches `user_id`                                                                                                                           | Stores and conditionally matches `user_id`                                                                                             |
| Bind the current session and company                        | Stores and conditionally matches both identifiers                                                                                                                    | No session or company binding in the inspected proof issuance/consumption contract                                                     |
| Reject a proof after its session ends                       | The session foreign key deletes its proofs; spending through `withActor` also rejects an ended session                                                               | Checks credential revision but has no issuing-session binding; credential invalidation is not session-specific revocation              |
| Bind the exact contents without storing the import document | Matches a SHA-256 hash of the action, company and canonical intent                                                                                                   | No exact-intent argument or stored binding in the inspected proof contract                                                             |
| Expiry and conditional single use                           | Five-minute expiry and one conditional spend                                                                                                                         | Internal implementation has expiry, single-use consumption and credential-revision checking; these alone do not establish full parity  |
| Spend with mutation and audit, rolling all back together    | Uses the caller's Lucid transaction                                                                                                                                  | Internal helpers accept a transaction, but they are not a supported exported caller-transaction API for arbitrary product mutations    |
| Recheck authority and refuse view-as                        | Requires a live Owner and refuses masquerade at issuance and before a new protected mutation; a committed ownership-transfer receipt may still replay after demotion | Product membership, role and projection policy must remain product-owned; no equivalent combined product operation is established      |

The owning product code is
[`password_confirmation.ts`](apps/backend/app/services/auth/password_confirmation.ts) and
[`password_confirmations_controller.ts`](apps/backend/app/controllers/password_confirmations_controller.ts).
Existing regression sources cover the protected mutation boundaries in
[`transfer_apply.spec.ts`](apps/backend/tests/functional/transfer_apply.spec.ts),
[`ownership_transfer.spec.ts`](apps/backend/tests/functional/membership/ownership_transfer.spec.ts)
and [`anonymise.spec.ts`](apps/backend/tests/functional/anonymise.spec.ts), including refusal and
audit-failure rollback paths. Inspecting those sources is not new runtime validation.

The result for [#1597](https://github.com/Kevinjohn/capacitylens/issues/1597) is **no migration**.
Reassess when a supported Kit release exposes equivalent principal/session/company/action/intent
binding and transactional consumption. Internal declarations are not an integration contract.

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

- Installation is one runnable release archive. Secrets are generated by the documented environment
  command, and the server takes production defaults when `NODE_ENV=production`. There is no root
  installer. Whoever manages hosting completes five installation steps ending with Open; company
  naming then happens in the browser. The hosting operator owns upgrades, backups and service
  maintenance; the company Owner is not expected to maintain hosting alone.
- Native Node with a loopback TLS proxy on the same machine is the expected installation. The
  operator owns that proxy; the server's HSTS header is host-only. Existing container support is
  optional. A proxy on a separate machine or container is unsupported for the first release;
  private-network forwarding support is deferred until after it.

## Open source

- The repository is AGPL-3.0-only. Contributions use DCO sign-off; there is no CLA or copyright
  assignment. CapacityLens names and logos are not granted by the licence; see `TRADEMARKS.md`.

## Continuous integration

- Keep dependencies current within the supported launch environment. Patch and minor updates must
  preserve the declared Node runtime floors, browser build target and production host boundary.
  Raising a minimum requirement is a separate product decision justified by a concrete benefit,
  not an incidental consequence of updating a package.
- The launch dependency baseline uses TypeScript 5.9.3, pinned in the root, backend and frontend
  manifests. Package consumer peer ranges may allow a newer compiler without changing this
  baseline. A dependency that requires a higher compiler, Node floor or browser target needs a
  separate launch-compatibility decision supported by validation ([issue #1731](https://github.com/Kevinjohn/capacitylens/issues/1731)).
- Keep formatting, type checking, lint, dependency security checks, product builds and meaningful
  unit, functional and browser tests. No coverage floor, file-size cap, test-size cap, suppression
  ratchet or custom structural rule. Add a focused check only when experience shows it protects a
  concrete invariant.
- Local commands and CI validate the same behaviour. A test run passes only when its process exits.
- CodeQL runs in the public security workflow. Dependabot proposes npm patch and minor updates
  weekly in separate groups and ignores automatic major updates. GitHub Actions and Docker
  updates remain monthly and patch-only. A monthly workflow reports newer major versions for
  installed direct workspace dependencies in one standing issue; it uses the pinned Node/pnpm
  toolchain, makes no dependency changes, and closes the issue when no newer majors remain.

## Module boundaries

- A module owns one named behaviour. Follow the framework's and the surrounding code's conventions
  for structure and names. Preserve visible orchestration, transaction order and failure
  propagation when extracting.
- Public wire fields, stable identifiers and shipped data formats are not renamed as part of
  structural cleanup.

### Production mail dependency compatibility

Production deployment omits optional dependencies, keeping the assembler and its unpatched braces
transitive dependency out of shipped runtimes. Development tooling still contains that advisory;
this is not a claim that every workspace dependency is patched. The production audit uses the same
optional-free graph and retains its high-severity failure threshold.

The `@adonisjs/mail>nodemailer` override keeps SMTP on Nodemailer 10 and at least 10.1.4, which fixes
three address-parser advisories. CapacityLens configures SMTP only. Authenticated TLS delivery,
attachment encoding, authentication and recipient refusal, and pooled connection closure are
verified through the public Adonis SMTP adapter. Nodemailer 10 is incompatible with the unused
Postmark transport's internal MIME import; Postmark is unsupported and must be reassessed before
enabling that transport.

The `qs` floor addresses GHSA-q8mj-m7cp-5q26, GHSA-4mjr-xmp4-gh2g and GHSA-x5fp-wj9c-mxmx, all fixed by 6.16.0. `typed-rest-client@2.3.1` requests
`qs@6.15.1` exactly, so this is a reviewed compatibility exception. Other security overrides are
limited to affected version ranges and keep the consumer's supported major line. VitePress 1.x
declares Vite 5 while its Vue plugin accepts Vite 6; its documentation-build override uses the
patched Vite 6 line.
