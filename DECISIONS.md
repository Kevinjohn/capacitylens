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

- SQLite-backed server persistence is the default. Missing API access is an error, never a silent
  browser-storage fallback.
- Portable JSON/export versions and physical SQLite versions are separate contracts. SQLite
  migrations are append-only from the Adonis baseline; released definitions are SHA-256 pinned in
  `database/released.json`, and boot refuses a database containing a migration unknown to the
  running build. Each migration file rolls back as one unit, and the pre-upgrade online backup is
  the recovery point. Never edit a released migration definition.
- New builds upgrade older databases. Older builds never write a newer database: they refuse it.
  Rollback means the old image plus the verified pre-migration snapshot, never a down migration.
- SQLite upgrades are coordinated single-server restarts. CapacityLens does not promise mixed-version
  or rolling writers; a future multi-instance architecture must adopt expand/contract migrations.
- Every schema-bearing release is rehearsed on released fixtures and an anonymised online snapshot
  of a representative long-lived installation. The rehearsal covers success, rollback-snapshot
  restoration, injected disk exhaustion, forced process termination and idempotent reopen.
- The demo adapter is in-memory and resets on refresh.
- Every scoped entity carries `accountId`; the active account is transient and never persisted.
- Server session + membership is the security boundary. Client scoping is defense in depth and UI
  hygiene, not authorization.
- Authenticated batches take two independent authorization snapshots: one before waiting for
  workspace locks and one after acquisition immediately before the transaction. Repeated checks
  for the same company and action reuse their result within one snapshot, but authorization state
  is never cached across the lock wait.
- Batch validation projections and account imports materialise only the account slices named by the
  request. Cross-table relationship checks load every required table within those slices. Batch
  projections maintain id and reverse-foreign-key indexes as operations advance, so upserts,
  deletes and cascades do not rebuild unaffected arrays; whole-installation state is never used as
  a shortcut.
- Planning reads resolve current product authority, one integer company revision and the complete
  confidentially projected company slice inside one Lucid transaction. Typed mutations compare the
  captured `baseRevision` inside their write transaction; a mismatch returns 409 without replay.
  Every changed planning or product-authority transaction advances the company revision once.
  No-change typed operations return 400 without an audit entry, marker or revision advance.
- A durable planning mutation marker is unique per company and mutation UUID, belongs to its actor,
  and commits with the data, revision and audit entry. Lookup returns only committed revision or
  unknown; an absent marker cannot prove failure. Reusing a committed identity returns 409, never
  a stored response. Company erasure removes its markers with its other product data.
- Existing state, batch, import and lifecycle callers coexist temporarily with typed resource
  operations and participate in the same company revision discipline. Typed operations do not pass
  through the arbitrary-table batch engine. Session-bound delete restoration and cleanup remain
  unavailable until the supported public session contract is verified.
- Browser account-command retry identities survive transport failures, HTTP 408 and server
  failures, concurrent execution and unreadable or unrecognised 409 responses. Success or a
  successfully decoded known terminal caller/policy rejection may close the retry ceremony;
  ambiguous responses never do.
  A page-local memory copy is authoritative while the page lives, with session storage extending
  the same identity across reloads when browser policy permits it.
- The retired server's local JSONL audit mirror was hard-bounded by its configured rotation size;
  an oversized entry stayed queued in that server's durable outbox and degraded audit health rather
  than consuming unbounded space or truncating security evidence. In the Adonis application,
  `AuditEntry` is written inside the mutation's Lucid transaction. Post-commit logging is diagnostic
  only; the retired outbox and delivery recovery are not current mechanisms.
- A scheduled SQLite snapshot is file-synced and its published directory entry is synced before
  retention may remove an older recovery point. Retention metadata is synced again after deletes;
  a failure at that second barrier warns but does not deny an already-durable new snapshot, because
  the safe crash outcome is retention of extra old recovery points. New snapshot names use UTC;
  legacy local-time names remain retention-compatible through their publication timestamps, and
  the snapshot being returned is never eligible for its own retention pass.
- Ordinary company-wide planning and display configuration shares the normal write capability:
  Editor and up may rename the company and change scheduling mode, disciplines, colour mode and
  feature-visibility settings. Editors are already trusted to shape the shared schedule, so these
  reversible account settings do not introduce a separate Admin-only `configureAccount` tier.
  Identity, membership, privacy, lifecycle, whole-slice import and company-erasure operations keep
  their existing stricter Admin/Owner gates. Typed settings operations may change time zone and week
  start; language is not an editable setting. The retained legacy settings transport keeps its
  calendar-field restrictions until its callers move to typed operations.
  The compatibility path that adopts a legacy id for the server-managed Internal client and
  reparents its projects is an ordinary Admin/Owner operation; it does not require a fresh
  session (2026-09-11).
- Command-palette entity visibility follows the destination, not every similarly named preference:
  omit resources or Internal projects whose selection would jump to a hidden schedule row/bar, but
  retain Internal activities because their selection opens the complete Activities management list.
- An unmatched URL is navigation state, not an application crash: it gets a branded not-found page
  with a schedule link, while valid reset/invitation bearer paths keep their exact one-token matcher
  and malformed signed-out entries remain behind the sign-in wall.
- Forms and ordinary server writes reject malformed supplied values before any repair. They share
  NFC and the existing whitespace policy for editable text; explicit availability null clears a
  bound, while omission preserves it. Import alone repairs safe values and drops unsafe rows.
  Both paths preserve referential integrity and account scope. Blind writers cannot echo hidden
  names or notes, so server confidentiality pins preserve the stored values on unrelated edits.
  JSON request/import parsing bounds depth and rejects duplicate decoded keys, non-finite numbers
  and unsafe integers; authentication-provider protocol bodies retain their framework parser.
- Optimistic-concurrency conflicts require both timestamps: a write is stale only when the stored
  and incoming `updatedAt` both parse and the incoming one is older. A missing or unparseable
  timestamp on either side is never a conflict, so partial PATCHes and legacy rows stay writable
  under last-writer-wins.
- On state reads (whole-tree and scoped), a known table key missing from the payload hydrates as
  empty via normalisation, with a console warning naming the missing keys — a version-skewed
  older server during an upgrade must not cause a total client outage. A key that is present but
  not an array is a corrupt payload and fails hard; it must never masquerade as empty data. The
  backup/export slice path keeps its full-completeness contract.
- Client-originated deletions of lifecycle entities (clients/projects/resources) never ride the
  atomic batch. Sync converges them by archiving only — reversible, editor-allowed, safe for
  background sync — so the row parks in the archived list. Soft-delete (irreversible; it
  obfuscates resource PII) and purge are deliberate, admin-gated, freshness-gated UI actions and
  are never emitted by sync. A failed archive surfaces and retries alone; on unload a single
  best-effort keepalive archive fires per pending deletion.
- Account colours are constrained to the preset palette. Legacy out-of-palette colours were
  snapped once to their nearest preset by migration v13, which carries its own frozen palette
  snapshot inside its checksummed definition (a live-palette dependency would let a future
  palette edit silently change a shipped migration). The released v13 parser historically accepted
  a valid hexadecimal prefix in each two-character chunk (and one embedded `#`), so malformed values
  such as `#1z2z3z` do not take the shared mapper's fallback. That outcome is frozen for deterministic
  compatibility: changing v13 would invalidate its released checksum, and an already-snapped value
  no longer contains the original bytes needed for a later correction. Real v12 upgrade tests pin
  both malformed outcomes. Ordinary server writes reject non-preset supplied colours; imports and
  the one-time migration retain snapping. Any future frozen colour parser must first require
  `/^#[0-9a-f]{6}$/i` before parsing.
- Server imports are atomic, not undoable and owner-only; a non-owner's redacted export is not a
  safe source for a whole-slice replacement of owner-confidential client/project identities.
- Theme and per-device view preferences are device-global and outside account exports. The date
  format is deliberately NOT among them: a company reads one convention, so it is an account setting
  (editor and up), present in export and undoable like any other account change. It governs planning
  calendar dates and ranges. Server instants — session creation and expiry, password-reset expiry,
  invitation expiry in the Team & access member panel and on the invitee's Accept invite page —
  instead use the viewer's browser locale and local time zone, including when an instant is displayed
  as a date only. Existing
  date-and-time and compact date-only shapes remain distinct; never recover a local date by slicing
  the stored UTC timestamp.
- Client/project privacy is opt-in and owner-managed. Real names and raw code names remain stored;
  only account owners receive them. Every other role receives the quoted code name, and non-owner
  writes preserve the protected stored fields. The built-in Internal client is always public and
  active; import/load repair clears any impossible lifecycle tombstones on the singleton.
- Capacity Overview access is a page-visibility preference, not a confidentiality control
  (2026-09-11): `GET /api/state` already serves every allocation and resource to any member, so a
  server-side gate on the route could not withhold those figures. The setting only decides who can
  open the page and see the aggregated view; it does not narrow the data every member already
  receives via the scoped state.

## Browser data

- Scheduling records and identity snapshots are never persisted in the browser. Server failures
  remain visible and retryable; there is no persistent fallback or queued write journal.
- Ordinary device preferences remain in localStorage. The demo stays volatile and in-memory.

## Authentication and security

- Production refuses to start with authentication off unless an operator explicitly accepts the
  open-instance risk.
- Each authenticated company has exactly one Owner. Owner is not an invite or ordinary role-change
  option; ownership moves only through an explicit atomic transfer to an existing member, with the
  former Owner becoming Admin.
- Sole-Owner credential recovery is an operator command, not a product feature. It uses the ordinary
  recovery ceremony, an exclusive database lock and an audit event, and refuses unless the target
  is the sole active Owner. Admins cannot administer an Owner, and credential recovery never moves
  ownership.
- App members and scheduled Resources are separate records. Adding a Resource never grants access,
  and inviting a member never creates a schedulable person.
- Team & access is a first-class destination visible to every role so members can understand their
  own access; only Owner/Admin receive directory, invitation and access-management controls.
- Masquerade is a session-keyed, in-memory read projection within one company, not another login or
  write authority. Only an Owner or Admin may start it; no fresh session is required, and an active
  projection cannot be replaced. Every unsafe method and account, membership or authentication
  route is refused. Explicit end, account switch, sign-out, expiry, revocation or caller/target
  invalidation ends it; restart loss fails closed. Start and end are audited, and the projection is
  bounded by the session expiry.
- Native Adonis authentication, sessions, Bouncer, Ally and Mail own their framework capabilities.
  The account-kit owns password/recovery primitives where their contracts preserve product
  guarantees. Company invitations, membership and admission remain product-owned and transactional.
- Each installation owns its local principals, sessions and memberships and never shares account
  records with another installation. Federated correlation uses the exact provider
  and provider-owned stable identifier, never email; local deprovisioning cannot delete an upstream
  provider identity.
- Email/password and Google company sign-in are supported for self-hosting. Microsoft is not a
  current sign-in option, and GitHub sign-in is retired. Generic OIDC support and the
  `hosted-oidc-only` profile were removed; their names are now unknown configuration, so
  `hosted-oidc-only` is an invalid profile like any other unrecognised value.
  Deterministic and library evidence never substitutes for live-provider checks.
- Named profiles are `self-hosted-password`, `self-hosted-mixed`, `self-hosted-sso-only` and
  `hosted-sso-only`. Hosted SSO requires `mode=sso-only`, complete Google configuration, and
  refuses passwords, open signup or incomplete provider
  settings. Its shared conformance capability is `companyProviderRequired`; it has an independent
  contract version. A future product grouping layer must use the public named-provider boundary,
  never account internals.
- IdP disablement stops new authentication but not an already-issued local session. Hosted accepts
  the bounded lag of thirty minutes inactivity or twelve hours absolute; back-channel logout or an
  equivalent must be reconsidered before hosted GA.
- Email self-registration is closed by default. External identities require a verified email and
  a live invitation; initial SSO ownership requires an operator email allow-list.
- External-identity admission and explicit linking are distinct. Creating a new local principal
  requires verified control of an email plus a live pre-authorised invitation (or the first-principal
  bootstrap allow-list). Google bootstrap uses `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS`; later new
  Google identities need an unused invitation addressed to the verified Google email. An
  already-admitted principal may explicitly link Google without a second invitation, through their
  own fresh session and matching verified email. Linking also requires the local address to be
  verified. Google identities use Google's stable identifier and are never merged by email.
- A Google callback that creates a principal does not create company membership or consume an
  invitation. The user must explicitly accept the addressed invitation or complete a company join;
  the server rechecks current authorization and company policy at completion.
- Repeated invitation or password-reset issuance with the same command id returns
  `409 IDEMPOTENCY_CONFLICT`. Secret bearers are never replayed or stored in command results;
  completed non-secret results may replay, and a payload mismatch is refused.
- Self-hosted provider-required access uses `self-hosted-sso-only` and requires a configured Google
  session, including for invitation acceptance. Password sessions cannot satisfy that requirement.
  Existing password credentials remain available if an operator returns the installation to
  `mode=password-only`; that restores the password entrance but does not reset credentials or
  change provider connections. Operators and teams verify Google access directly before changing
  mode; deterministic checks do not establish live-provider acceptance.
- The named-provider replacement supersedes the earlier generic OIDC and staged-cutover decisions
  below. Those dated entries preserve implementation history, not current configuration or
  operator procedure. No identity conversion or deleted-staging migration is required.
- The earlier generic-OIDC email-claim policy below is historical and superseded. Google admission
  and linking require verified-email evidence; identities are never merged by email.
- CapacityLens cannot infer an upstream multi-factor policy from a Google link, so operator
  enforcement and testing at Google is required.
- Secure-cookie behavior follows the public `CAPACITYLENS_PUBLIC_URL`, including behind a TLS
  proxy. Legacy account environment names were removed before beta with no migration window; they
  are now unknown and ignored like any other unrecognised variable.
- Password mode defaults to breached-password screening. Password sign-in offers no
  authenticator-code step to enable or require. Local MFA implementation was removed
  (2026-10-09). Google owns any MFA policy, enrolment and recovery; enabling company sign-in alone
  does not enable MFA, and a federated session does not prove
  that an upstream MFA challenge occurred. Sessions have a fixed twelve-hour lifetime; privileged actions
  require a session no older than fifteen minutes. The client answers the freshness refusal with an
  in-place "confirm it's you" re-authentication dialog that mints a fresh session and retries,
  never a full sign-out that discards working state.
- Administrative session freshness (the fifteen-minute step-up gate) applies only to ownership
  transfer, resetting another member's password, revoking another member's sessions, deleting a
  company, import/purge and SSO identity link/repair (2026-09-11). Every other administrative read
  or action — invite create, invite revoke, role change, status change, member removal, the
  sign-in-tracking toggle, masquerade start and internal-client adoption — needs only the actor's
  role, not a fresh session. The transfer's explicit Owner confirmation is separate from this
  freshness decision.
- Cross-site writes are gated by Fetch Metadata and Origin, with two deliberate exemptions: an
  Origin on the credentialed CORS allow-list always passes (the allow-list is the operator's
  explicit cross-site contract), and an Origin whose host:port matches the request Host and
  differs only by claiming `https` while the socket is `http` counts as same-origin (the standard
  TLS-termination proxy pattern; browsers, not callers, set the Origin host). All other
  cross-site signals are refused.
- A 401 from the auth-status endpoint always lands the user on the sign-in wall — it is never
  worse to let a signed-out user attempt sign-in. The 401 body is parsed leniently (providers
  default to empty; a malformed or proxy-generated body falls back to the password form) while
  `needsSetup` and all non-401 failures remain fail-closed. A genuinely malformed body (non-JSON
  or junk mode — as opposed to a well-formed older-server response) additionally renders a
  degraded-configuration notice above the form so an SSO-only instance behind a broken proxy is
  diagnosable rather than a silent password-retry loop. In server mode, tenant persistence starts
  only after this auth check returns an admitted status; login and setup walls never issue
  speculative company-data requests or publish persistence errors.
- When a database upgrade finds an account with active members but no active Owner, the repair
  migration promotes the member with the highest role tier, tie-broken by earliest membership. A
  viewer is promoted only when the account holds nothing but viewers, and every promotion emits a
  security event (escalated logging below admin tier). Chosen over refuse-and-halt so upgrades
  cannot brick startup; REVISIT before a stable release if an operator-driven repair path lands.
  This replaced the oldest-member rule in place during the alpha line: the ledger accepts the
  superseded v11 checksum via an explicit per-version allow-list (any other drift still refuses
  startup), and databases that ran the old rule may carry a wrongly-tiered owner — accepted under
  the same revisit flag.
- Migration v14 (2026-07-17) revokes outstanding reset/verification ceremonies for every active
  member, not just Owners. The v10-era owner repairs demoted co-owners with raw SQL, bypassing the
  central membership-write invalidation, and the owners-only v12 revocation left a demoted
  co-owner's Owner-era reset link redeemable. The scope is deliberately blanket: the original v11
  destroyed role history in place (the reason it is superseded), so identifying which identities
  were demoted is provably impossible — the same destroyed-information reasoning as the v11
  supersession. Over-revoking is harmless because reset links are re-issuable on demand;
  under-revoking is the vulnerability.
- The step-up freshness gate treats a missing or unparseable session-creation timestamp as stale
  (2026-07-17): the privileged action receives the standard `SESSION_NOT_FRESH` refusal rather
  than bypassing the fifteen-minute check — fail-closed, matching the CSRF-parse and `needsSetup`
  posture. Recovery is the existing re-authentication dialog; a fresh sign-in always mints a
  session with a timestamp, so no one is hard-stuck.
- Production posture validation uses the exact same parsers as the runtime features it attests
  (e.g. the rate limiter), so a value the runtime would silently ignore refuses startup instead.
- Encrypted persistent storage and logically separate security-log forwarding are recommended
  deployment hardening that operators provide; CapacityLens has no setting or warning for them.
- TLS terminates at the packaged edge or the operator's trusted external proxy. Internal TLS
  generation and renewal are retired; bare-metal HTTP is limited to a same-host loopback proxy hop.
- Adonis Shield owns HSTS, `nosniff` and frame protection. HSTS is enabled only when HTTPS is
  explicitly enabled and the configured public URL uses HTTPS. The application CSP has one
  middleware owner; the Origin / Sec-Fetch-Site guard remains active, without a CSP report route.
- Socket, scrypt and HIBP work limits are finite and fail closed under overload.
- CapacityLens ships no product analytics. Optional mail delivers addressed invitations and
  password resets.
- Errors on data paths are surfaced, not swallowed.

## AdonisJS framework departures

The AdonisJS documentation is the structural reference. These product choices deliberately differ
from framework defaults; other departures require an explicit decision.

1. `packages/shared` is imported by the backend and SPA. It contains pure domain rules and wire
   types, never backend code.
2. Adonis BodyParser owns request parsing and its supported defaults. Compiled Vine validators
   validate supplied values and strip unknown object properties by default. Empty strings are not
   silently converted to null. Ordinary validation errors use the flat `{ error, code? }` contract
   with status 400.
3. Product models fail closed without an explicit tenant scope. Bulk updates and deletes use a
   scoped helper because model hooks do not cover them.
4. Product sessions record authentication and last-activity times. Middleware enforces absolute and
   inactive expiry independently of the session store's sliding age; freshness uses authentication
   time.
5. Validation and domain errors use the flat `{ error, code? }` contract. Structured admission
   decisions may accompany that object when the future Account Kit integration provides one.
6. Product timestamps are ISO strings on the wire and in columns. The company planning revision is
   an integer; retained legacy row receipts use timestamp strings. Columns
   use snake_case, explicit transformers own camelCase wire fields, and empty optional values are
   null.
7. Product environment variables use the `CAPACITYLENS_` prefix; framework variables retain
   framework names.
8. The Adonis backend serves the SPA from `public/` with product security headers and a history
   fallback rather than relying on a separate static-file proxy.
9. Off mode uses the validated product guard. SQLite has a pool of one connection, configured when
   it is created. Network and mail work stays outside transactions.

## Installation

- Installation is one runnable release archive. Secrets are generated by the documented environment
  command, and the server takes production defaults when `NODE_ENV=production`. There is no root
  installer. The operator owns the TLS proxy, and the server's HSTS header is host-only.

## Open source and hosted service

- The community repository is AGPL-3.0-only. The hosted service may add deployment/billing layers
  outside this repository, but changes to this networked application remain subject to the AGPL.
- Contributions use DCO sign-off; there is no CLA or copyright assignment.
- CapacityLens names and logos are not granted by the software licence. See `TRADEMARKS.md`.
- Licensing, privacy terms and trademark boundaries require professional legal review before the
  hosted service launches.

## Continuous integration

- Keep formatting, type checking, plain lint, dependency security checks, product builds and
  meaningful unit, functional and browser tests. Coverage reports may help identify gaps, but no
  aggregate floor, per-file floor or suppression ratchet is required.
- Use framework conventions and the checks that protect current product behavior. Avoid fixed file
  or test-size limits and custom structural rules; add a focused check only when experience shows
  that it protects a concrete invariant.
- Local commands and CI workflows should validate the same relevant behavior. Test results include
  successful process completion; investigate hangs or leaked resources when they occur without
  prescribing historical worker or shard layouts.
- CodeQL runs in the public-repository security workflow. Private-repository runner/upload
  limitations are no longer part of the active CI policy.
- Dependabot continues its monthly root-workspace updates independently of the runner policy.

## Maintainable module boundaries

- A module owns one named behavior or cohesive capability. Extractions must reduce the context
  needed for a representative change: implementation, explicit consumed inputs and focused tests.
  Shorter files alone are not evidence of improved modularity. Preserve visible orchestration,
  state-owner invariants, transaction order and failure propagation.
- Modules and names should make their behavior and ownership clear. Follow the framework and
  language conventions used by the surrounding code.
- Existing product account names, portable workspace/principal aliases and vendor provider-account
  names describe different contracts. Keep those distinctions and existing semantic aliases;
  do not introduce branded IDs or rename public fields as part of structural cleanup.
- Compatibility exceptions remain where a public contract, dependency or shipped data format
  requires them. They are documented at the owning boundary.

### Production mail dependency compatibility

Production deployment omits optional dependencies, keeping the assembler and its unpatched braces
transitive dependency out of shipped runtimes. Development tooling still contains that advisory;
this is not a claim that every workspace dependency is patched. The production audit uses the same
optional-free graph and retains its high-severity failure threshold.

The exact `@adonisjs/mail>nodemailer` override to 10.1.1 is a reviewed major-version exception for
the mail security fixes. CapacityLens configures SMTP only. Authenticated TLS delivery, attachment
encoding, authentication and recipient refusal, and pooled connection closure are verified through
the public Adonis SMTP adapter. Nodemailer 10 is incompatible with the unused Postmark transport's
internal MIME import; Postmark is unsupported and must be reassessed before enabling that transport.
