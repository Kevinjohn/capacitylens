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
- Product orientation is non-blocking and permanently reopenable from the sidebar. Dismissal is a
  versioned device preference scoped to the signed-in person and company (with stable demo, local
  and no-company scopes), never company data or export data. A copy change may bump the version to
  show materially changed guidance again.
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
  session membership; client scoping is UI hygiene, not authorisation. Cross-tenant references are
  refused by database triggers. One production installation holds one company; the demo may hold
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
- Undo and redo are typed inverse operations held page-locally in the browser. Hard-deleted planning
  rows are kept in a server tombstone table bound to session, actor and company so that restore
  is one atomic operation under current authority and hidden fields never leave the server.
  Restoration groups are removed in the same transaction as anonymisation and import.
  A change to a client or project privacy or code-name field, or to an activity kind, also clears that company's
  pending tombstones in the change transaction. Those saved before-images can contain names or
  relationships that should no longer be restorable under the new visibility rules. Unchanged
  privacy fields and ordinary settings edits keep the groups. Changing this rule later requires
  a way to prove old hidden before-images remain safe to restore.
  Before a change clears pending recovery copies, one confirmation shows the number of saved
  deleted records: “This change clears N restorable items”. Links to surviving rows are excluded.
  Zero-item and no-change saves skip the warning. Cancellation leaves data and copies unchanged;
  confirmation stays bound to the original company revision and current cleanup count.
  Undo and redo write audit rows. History survives a same-revision refetch and is cleared by an
  external revision change, a context change or a reload. There is no cross-device undo.
- Ordinary writes reject invalid supplied input; nothing is repaired on the way in. Blind writers
  cannot echo hidden names or notes, so an unrelated edit preserves protected stored values.
  Unknown request fields are stripped by the validator.
- The portable export is this product's own document and the only import source. Import is
  Owner-only, atomic and not undoable. A malformed or foreign document is rejected, never repaired.
  Identity, sessions, membership and admission records are never part of the export.
- Beta transfer uses the versioned full company document, preserves scoped IDs and member links,
  and replaces supported company settings. A redacted document cannot be imported. The Owner
  previews the destination revision before applying; changed imports advance it and audit once,
  while unchanged imports do neither.
- Resource and catalogue lifecycle uses archive/restore (Editor and up). Resource anonymisation
  (Owner/Admin) irreversibly removes identifying details and dependent notes while retaining the
  resource and its links. The **Anonymise all people** action applies the same scrub to every resource and requires
  action-specific proof. Client, project and activity catalogue fields, the company, Owner and
  memberships remain unchanged. There is no company
  deletion, soft-delete or purge action.
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
  configured number of snapshots. Failures are logged or returned by the operator command.

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
- Admission is cumulative and owned by the kit: an optional allowed email domain
  (`CAPACITYLENS_ALLOWED_EMAIL_DOMAINS`), invitation evidence and Owner or Admin approval, all from
  static configuration (restart to change). Accepting an emailed invitation records the evidence,
  confirms the address and creates the membership with the invited role; approval is still required. A person who is signed in but not admitted
  reaches only the limited screens, which show the step that applies. Approval, rejection and
  revocation are enforced on the next request; nothing is pushed to the browser. An admitted person
  without a membership (operator-granted evidence or an approved registration) joins explicitly,
  with the invited role or Viewer, never Owner. Removal records an access restriction, so only an
  Owner or Admin can bring a removed person back.
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
  current password and is spent in the same transaction as the change. Retain this bounded proof
  system for the first release. Prefer replacing it with a supported shared Account Kit primitive
  once equivalent action/session/principal/company binding and transactional consumption exist.
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
- View-as-member is a read-only projection for Owner/Admin, audited on start and end. Every write
  under a projection is refused server-side.
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

The `qs` floor addresses GHSA-q8mj-m7cp-5q26, fixed at 6.15.2. `typed-rest-client@2.3.1` requests
`qs@6.15.1` exactly, so this is a reviewed compatibility exception. Other security overrides are
limited to affected version ranges and keep the consumer's supported major line. VitePress 1.x
declares Vite 5 while its Vue plugin accepts Vite 6; its documentation-build override uses the
patched Vite 6 line.
