# Changelog

All notable changes to CapacityLens are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/) — while pre-1.0, **minor** versions carry
new features and **patch** versions carry fixes.

> Entries before 0.6.0 use the project's former name **"Floaty"** (and the `FLOATY_*` env prefix),
> since renamed to **CapacityLens** / `CAPACITYLENS_*`.

## [Unreleased]

## [0.23.4-alpha.0] — 2026-07-18

### Added

- Added a provider-neutral account contract with separate identity and account-administration ports,
  an orchestration-only command coordinator, idempotent/reconcilable cross-port flows and architecture
  checks that keep product routes away from raw account and identity storage.
- Added first-class strict OIDC with exact issuer/discovery pinning, endpoint validation before
  redirect or secret use, bounded no-redirect provider fetches, signed ID-token audience and
  timestamp verification, asymmetric JWKS rotation, user-info subject binding, verified-email
  admission and a pinned reference-IdP browser certification matrix covering the complete callback,
  denial, malformed-discovery and provider-unavailable paths.
- Added named account deployment profiles, independent contract/conformance/security versions, a
  sibling implementation register and a severity-based security-fix propagation checklist.
- Added a first-class **Team & access** destination for every role, plain-language capability
  summaries, persistent sidebar role labels, safe invite previews with explicit acceptance, and an
  optional onboarding link.
- Added an isolated one-command password-auth access lab with Owner, Admin, Editor and Viewer
  personas, confidential-field fixtures and the Studio North demo schedule.
- Added a per-company Internal work colour setting: internal activities and Internal-owned projects
  are grey by default, while palette mode restores saved project colours and the project picker.
- Added an explicit, one-way SQLite migration runner with an independent database version,
  CapacityLens application identifier, transactional `BEGIN IMMEDIATE` steps, control/auth schema
  verification and sanitised released-v7 compatibility fixtures.
- Added a database-side migration ledger with immutable version/name/SHA-256 checksum validation,
  plus a release-rehearsal command that anonymises a temporary online snapshot and verifies normal
  upgrade, rollback snapshot, injected disk exhaustion, forced process termination and idempotence.
- Added mandatory verified pre-migration rollback snapshots for existing on-disk databases. They
  are written before DDL even when periodic backups are disabled and are never retention-pruned
  automatically.

### Changed

- Moved every browser account request behind one account client and routed invitation signup,
  member administration, password reset, session revocation, workspace provisioning and erasure
  through the account boundary while preserving the public CapacityLens URLs.
- Made `SMALLSASS_ACCOUNT_*` the canonical account configuration namespace. Existing
  CapacityLens/Better Auth spellings remain warning aliases for at least two minor releases and 90
  days; conflicting values now refuse startup.
- Promoted strict OIDC out of experimental status. Named social providers remain experimental;
  hosted deployments enforce OIDC-only and reject password/open-signup configuration.
- Hardened the account boundary so identity deletion SQL is owned only by the identity adapter,
  membership and invitation erasure are owned by the account-administration adapter, and the
  orchestration layer can reach neither storage implementation directly or transitively.
- Single-sourced administrative authorization—including workspace erasure—in account policy while
  retaining CapacityLens-owned scheduling, purge and field-visibility policy. An executable seam
  check prevents the product and account decisions from drifting.
- Moved member and invitation management out of Settings and made app members versus scheduled
  Resources explicit throughout the access flow.
- Moved the required-field legend in data-entry modals to the bottom of each form, above the
  action buttons.
- Renamed the activity labels **Repeatable** and **Project** to **Cross-project** and
  **Project-specific** to make the distinction about project scope clear. The stored activity kind
  remains `repeatable` for compatibility.
- Database startup now refuses unrelated SQLite files and future database versions before schema
  DDL, validates production/auth configuration before applying migrations, and defines rollback as
  the old image plus its matching pre-migration snapshot rather than a down migration.

### Security

- Made workflow static analysis, application/server gates, account-boundary conformance, released-
  database migration rehearsal, production dependency audit, cross-browser E2E and strict-OIDC/Dex
  certification independently visible CI jobs. Failed browser jobs now retain phase-specific HTML,
  JUnit, trace and reference-IdP log evidence.
- Enforced durable federated linking by `(issuer, subject)` rather than email, removed invitation
  storage access from the auth-vendor hook, and ensured local erasure never deletes an upstream IdP
  identity.
- Added one capability-aware `IdentityPort` contract suite run unchanged against Better Auth,
  trusted-local and a vendor-free fake, plus whole-tree and transitive dependency checks. Unsupported
  credential, reset and administrative-revocation capabilities now fail with the normalized
  `UNSUPPORTED_CAPABILITY` contract and command correlation.
- Routed OIDC callback, denial and provider-initialization failures back to the appropriate signed-
  out, invitation or authenticated-step-up product surface without reflecting provider-controlled
  details; the browser removes those query values after displaying stable retry guidance.
- Made password invitation signup all-or-compensated, persisted double failures for reconciliation,
  coupled reset/revocation authority to execution revisions, and kept bearer values out of command
  and audit records.
- Documented the hosted IdP-offboarding limit: disabling an upstream identity blocks new sign-ins
  but existing local sessions can remain for up to twelve hours absolute or thirty minutes idle.
- Enforced exactly one active Owner per member-bearing company with deterministic legacy repair, a
  definition-checked partial unique index and a boot-time zero/co-owner assertion. Owner invitations
  and ordinary Owner role assignment/removal are rejected; ownership changes only through the
  existing atomic transfer operation.
- Redacted bearer invite tokens from both request logs and structured authentication/security-event
  paths, including failures that occur before an invite handler runs.

## [0.23.3-alpha.0] — 2026-07-17

### Security

- Added database migration v14, which revokes outstanding password-reset/verification ceremonies for
  every active member. The v10-era owner repairs demoted co-owners with raw SQL, so a reset link
  minted while they held Owner privilege survived the owners-only v12 revocation; the destroyed v11
  role history makes targeted revocation impossible, and reset links are re-issuable on demand.
- The fifteen-minute freshness gate on privileged actions now fails closed: a session whose creation
  timestamp is missing or unparseable is treated as not fresh and receives the standard
  `SESSION_NOT_FRESH` re-authentication challenge instead of bypassing step-up.

## [0.23.0-alpha.0] — 2026-07-17

Two adversarial review rounds over the recent security-hardening work, fixing regressions the
hardening introduced and closing the gaps the fixes themselves opened. Policy decisions made here
are recorded in `DECISIONS.md`.

### Added

- Added an in-place **"Confirm it's you"** re-authentication dialog: security-sensitive actions
  (member/invite management, deletion, purge, ownership transfer) on a session older than fifteen
  minutes now raise a step-up prompt that re-authenticates without a reload, preserves working
  state, and retries the blocked action. Previously the raw server error was shown and a full
  sign-out was the only remedy.
- Added a degraded-configuration notice to the sign-in wall: when the authentication status
  response is malformed (broken proxy, HTML error body), the password form is shown as a fallback
  with an explicit advisory instead of silently masquerading as a password-mode instance.

### Fixed

- Fixed the cross-site write gate rejecting explicitly allow-listed CORS origins: an Origin on the
  credentialed allow-list now passes regardless of Fetch Metadata, and a TLS-terminating reverse
  proxy (Origin `https`, backend socket `http`, same host) is recognised as same-origin. A
  malformed `Host` header now fails closed with a 403 instead of an unhandled 500.
- Fixed optimistic-concurrency conflicts firing on writes without timestamps: a missing or
  unparseable `updatedAt` on either side is never a conflict again (per the documented contract),
  so partial PATCHes succeed and legacy rows are no longer permanently write-locked.
- Fixed undo of a just-synced client/project/resource permanently poisoning sync: lifecycle
  deletions no longer ride the atomic batch and instead converge by archiving the row (reversible
  and permitted for every role that can create one). Closing the tab mid-undo fires a best-effort
  keepalive archive instead of silently resurrecting the row.
- Fixed version-skew outages during rolling deploys: a known table missing from the state payload
  (whole-tree and per-account loads) hydrates as empty with a diagnostic console warning, while a
  present-but-malformed table still fails hard. A 401 with an unreadable body now lands on the
  sign-in wall instead of a terminal error screen.
- Fixed `/api/health` sharing the request rate-limit budget: the uptime-monitor exemption is
  restored, so health checks are never told 429.
- Fixed the production posture guard accepting rate-limit values the runtime parser rejects
  (whitespace, scientific notation, values beyond the cap), which silently booted production with
  rate limiting disabled; both now share one strict parser and bad values refuse startup.
- Fixed legacy account colours snapping to a fixed purple on unrelated writes: a one-time
  migration (v13) maps stored colours to their nearest palette preset, the write-time guard snaps
  to nearest on both client and server via one shared mapper, and the migration carries a frozen
  palette snapshot inside its checksummed definition so future palette edits cannot alter it.
- Fixed the amended v11 owner-repair migration refusing to boot databases that had already run its
  original definition: the migration ledger accepts the superseded v11 checksum through an
  explicit per-version allow-list while any other checksum drift still refuses startup.

### Security

- The v11 ownerless-company repair no longer promotes the oldest member regardless of role — it
  promotes the highest role tier (tie-broken by earliest membership), promotes a viewer only when
  no higher tier exists, and emits a security event for every promotion with escalated logging
  below admin tier. Previously a viewer could be silently elevated to full Owner authority during
  a routine upgrade.
- Lifecycle soft-delete and purge remain admin-gated and step-up-gated after review confirmed
  soft-delete is irreversible and obfuscates resource PII; background sync never emits either.
  Ordinary archive/unarchive stay available to editors without a freshness check.

## [0.20.1-alpha.0] — 2026-07-15

### Changed

- Consolidated the Alpha 2 documentation and maintainer material with Alpha 3's optional deployment
  hardening on the `0.20.1` prerelease line. No application behaviour changed from Alpha 3.

## [0.20.0-alpha.3] — 2026-07-15

### Fixed

- Restored production startup for straightforward Forge, bare-metal and community deployments by
  treating deployment-dependent hardening as explicit warnings instead of fatal configuration
  errors. Required TOTP MFA, audit streaming/external log forwarding, encrypted-storage
  attestation and a private internal API certificate can now be adopted incrementally.
- Allowed a trusted same-host reverse proxy to reach the loopback-only API over HTTP when both
  internal TLS paths are omitted. A partial, empty or unreadable certificate/key configuration
  still fails closed rather than silently downgrading a requested encrypted connection.

### Changed

- Made required TOTP MFA opt-in and off by default, including in Docker Compose. Breached-password
  screening remains enabled by default but isolated/offline installations may disable it with a
  visible production warning.
- Made scheduled snapshots, off-host backup copies and external log collection optional operator
  choices. The application continues to require local audit integrity, and attestation variables
  report real infrastructure controls rather than enabling them.

### Security

- Retained fail-closed production checks for authentication, positive rate limiting, local audit
  logging, first-owner setup and unsafe bootstrap credentials, while documenting the configurable
  profile against all 345 OWASP ASVS 5.0 requirements. Password-only defaults are explicitly below
  strict ASVS Level 2; enabling required MFA and breached-password screening provides the intended
  stronger authentication profile.

## [0.20.0-alpha.2] — 2026-07-15

### Changed

- Published a documentation-only alpha patch. No application behaviour changed.

## [0.20.0-alpha.1] — 2026-07-15

### Security

- Hardened production password authentication with 15–128 character OWASP-aligned credentials,
  breached-password screening, versioned scrypt, mandatory TOTP MFA, host-only cookies, fixed and
  idle session limits, fresh privileged actions and user/administrator session revocation.
- Added root-level CSRF/origin enforcement, non-cacheable API responses, stronger browser headers,
  safe provider endpoints, constant/rate-limited health and fail-closed production posture checks.
- Encrypted opt-in offline snapshots with AES-256-GCM and restrictive device-key handling; enforced
  restrictive database, WAL, audit and backup permissions plus separate security/audit forwarding.
- Added full-history secret scanning, dependency review, CodeQL, SBOM, container scanning, OWASP
  ZAP, release provenance and cross-browser E2E automation, with actions and base images pinned.
- Minimized the API production dependency graph, removed unused package managers and curl from the
  runtime images, eliminated vulnerable base-image packages, and made the strict CSP compatible by
  serving Sonner's published styles as a static hashed asset rather than an injected style element.
- Added a threat model, security/control inventories and a complete 345-requirement OWASP ASVS 5.0.0
  ledger covering Pass, Partial, Gap and Not Applicable outcomes without claiming certification.
- Reviewed every surviving and uncovered mutant in the security-relevant shared core, fixed a
  fail-open allocation edge case for missing/cross-company activity projects, and added adversarial
  assertions for inactive references, private-name fallback, imports, lifecycle repair and form data.
- Upgraded the pinned package manager to pnpm 11 so production dependency audits use npm's supported
  bulk-advisory API after the registry retired the legacy endpoints used by pnpm 10; clean installs
  now fail closed on dependency lifecycle scripts, with only esbuild explicitly reviewed and allowed.
- Encrypted the packaged nginx-to-API hop with a private per-install CA, verified service identity,
  TLS 1.2/1.3, root/API/nginx-separated key permissions, automatic renewal and no plaintext fallback.
- Added bounded CSP violation reporting to the separate security stream and an automated
  cryptographic implementation-path inventory enforced by both green gates.
- Capped accepted API sockets, memory-expensive scrypt work and HIBP calls with documented
  fail-closed queue/timeout behavior; fixed same-origin writes through the trusted packaged proxy
  without weakening cross-site Origin or Fetch Metadata rejection.
- Added a last-resort uncaught-exception/rejection path that records a sanitized security event,
  drains safely and exits non-zero for supervisor restart; patched the mutation toolchain's
  transitive `qs` dependency for GHSA-q8mj-m7cp-5q26.
- Isolated Chromium/server, WebKit and Firefox E2E lifecycles to remove cross-engine dev-server
  races, and stopped enabled buttons transitioning through a temporarily sub-AA opacity.

## [0.19.4] — 2026-07-14

### Changed

- Added dedicated E2E, coverage, OpenSSF Scorecard and Docker build signals to the public project
  README and CI workflows.

## [0.19.3] — 2026-07-14

### Changed

- Published a metadata-only patch release after the acceptance-story documentation landed in
  0.19.2. No application behaviour changed.

## [0.19.2] — 2026-07-14

### Changed

- Expanded the public documentation and runnable user-story coverage for privacy, onboarding,
  timezone labels, first-run guidance and the semantic colour language.

## [0.19.1] — 2026-07-14

### Changed

- Documented the safe process handoff for release-directory deployments so long-running API
  services release the previous checkout before activation cleanup and restart from the stable
  release path afterward.

## [0.19.0] — 2026-07-14

- Polished company onboarding and first-run guidance: empty picker choices are now explicit, company
  colours use the default preset, timezones show their UTC offsets, and the checklist floats over the
  schedule without shifting its toolbar or grid.
- Refreshed the visual language with accessible blue identity accents, green positive-action buttons,
  and blue defaults for new companies and resources.

## [0.18.0] — 2026-07-14

Private work can now stay discreet across the agency without losing its real identity in
CapacityLens.

### Added

- Clients and projects can now be marked private and given an owner-managed code name. The account
  owner continues to see and edit the real name, while everyone else sees only the code name in
  quotes throughout the scheduling UI. Privacy is off by default, so existing workflows are
  unchanged until an owner deliberately enables it.

### Security

- Private names are protected at the server boundary as well as in the interface: reads, exports,
  write responses and conflict responses expose only code names to non-owners. Protected fields
  cannot be overwritten by redacted sync data, and whole-account imports are owner-only so a
  non-owner's redacted export can never replace the real client or project names.

## [0.17.2] — 2026-07-14

### Fixed

- Protected lifecycle entities and the built-in Internal client from generic deletion or mutation,
  required optimistic-concurrency preconditions, and hardened batch validation, account recreation,
  migrations, request logging, CORS and bounded server configuration.
- Made Blocks mode consume zero effective capacity throughout the scheduler, filtered off-screen
  records before layout, aligned cross-resource drag previews with their target working week, and
  refreshed horizontal utilisation after dragging.
- Reconciled account, import, invite, password-reset, lifecycle and membership mutations after any
  transport failure so a committed-but-lost response cannot invite an unsafe retry.

## [0.17.1] — 2026-07-14

### Fixed

- Prevented a pending week-snap callback from jumping the schedule back to its buffered start when
  changing the visible week range immediately after navigating to a date.
- Hardened persistence, offline snapshots, imports, membership administration and lifecycle actions
  so failed or stale asynchronous work cannot silently discard, cross tenant boundaries or overwrite
  newer state. Invalid form and API values are now rejected or repaired consistently at their shared
  boundaries.

### Security

- Hardened both Compose services with read-only root filesystems, dropped Linux capabilities and
  `no-new-privileges`. The web image now runs nginx as an unprivileged user, both base images are
  digest-pinned, and the web health check verifies the same-origin API proxy before reporting ready.

### Changed

- Split the Docker build graph so the API image no longer compiles the frontend and the web image
  no longer creates the server deployment bundle.

## [0.17.0] — 2026-07-14

The public-release hardening round. This release establishes a clean open-source baseline while
keeping the hosted product wrapper outside this repository.

### Added

- Opt-in, seven-day offline reading for previously opened accounts. Offline mode is explicitly
  read-only, scoped to the verified signed-in user and browser origin, and never queues writes.
- Experimental Google, GitHub, Microsoft and generic OIDC sign-in alongside the stable
  email/password flow. External identities require verified email and an existing invitation (or
  an explicit first-user bootstrap allowlist).
- Public governance, support, trademark, authentication and offline-operation documentation.
- DCO enforcement, CodeQL scanning, production dependency auditing, pinned CI actions and a
  production-container smoke test.

### Changed

- The public demo is now an editable in-memory sandbox. It stores no scheduling data and resets to
  the sample dataset on reload.
- Authentication configuration fails closed: incomplete provider credentials, unsafe public URLs
  and invalid SSO bootstrap configuration stop startup with an actionable error.
- The runtime API image contains production server dependencies only and runs as an unprivileged
  user. Browser E2E uses the same-origin API topology enforced by the production CSP.
- Public-facing documentation and fixtures were rewritten for a standalone open-source repository;
  internal review records, deployment archaeology and private project references were removed.

### Security

- Session-cookie security is derived from the validated public HTTPS URL rather than proxy request
  headers. Unknown roles degrade to read-only access.
- Import lifecycle timestamps are canonicalized, invalid chronology is repaired, and erased-resource
  personal data is obfuscated immediately.
- Entity identifiers are constrained to URL-safe bounded values; the CSP no longer permits arbitrary
  HTTP(S) connections.

## [0.16.0] — 2026-07-13

A high-effort code-review remediation round over the 0.15.8 tree: seven fixes, one reliability
hardening, and two deliberate-design decisions confirmed and left intact. The findings cluster in
the server-sync save path and the bulk-operation timeout tier.

### Fixed

- **Bulk operations no longer abort at the 15-second interactive timeout.** Whole-tenant company
  deletion (`DELETE /api/accounts/:id`) and atomic import (`POST /api/import`) now use the 120s
  bulk bound — the same as the whole-slice load, batch sync, and inactive-slice export — so a
  large but healthy tenant on a slow server isn't cut off part-way through. Company deletion also
  **reconciles the account list from the server** when the request times out (the erase may have
  committed server-side) instead of reporting a spurious "delete failed" and leaving a
  now-deleted company in the picker that errors when re-clicked.
- **Backup retention honours a fractional `CAPACITYLENS_BACKUP_KEEP` again.** A value like `100.5`
  now floors to `100` rather than silently reverting to the default of `48` — a smaller backup
  window than the operator configured, discovered only when an old restore point was already gone.
- **Undo/redo and cascade-deletes stay safe on very large tenants.** The revision-timestamp
  helper no longer spreads one argument per row into a function call, which on a big enough
  account could overflow the engine's argument limit and fail the action outright.

### Changed

- **An over-sized sync is now a clear terminal error, not a permanent retry loop.** A single
  change whose diff exceeds the atomic batch limit (5000 operations) previously retried the
  identical, never-landing diff forever behind a stuck "changes aren't saving" banner. It now
  surfaces a plain-language notice — *change or delete fewer items at a time* — and stops
  retrying; the pending change is preserved in the durable write journal and the banner clears
  once a smaller change syncs. The one-transaction atomicity guarantee is unchanged (the diff is
  never split into partially-committed pieces).

### Performance

- **Leaner server-sync save path.** The per-write PUT rebase is now O(operations + rows) via an
  id-keyed map instead of a linear table scan per operation (which was quadratic on a
  whole-table re-timestamp such as a large undo/redo); each batch is JSON-serialized once rather
  than twice; and a throwaway empty-data allocation per commit-receipt revision was removed.

### Notes

- Two behaviours the review flagged were confirmed **deliberate** and left as-is: an edit made
  during an in-flight import is intentionally *not* flushed on tab-close (flushing it would insert
  stale pre-import rows into the freshly imported data), and data written by a *newer* app version
  is intentionally refused rather than loaded with unknown fields silently dropped (which would
  lose them on the next save).

## [0.15.8] — 2026-07-13

The last four P3/P4 findings the review re-triaged as "overstated — verify before acting":
two turned out to need a fix, two needed a correction to the record rather than the code.

### Changed

- **`endDateForWorkingDays` is now an O(1) closed form** instead of a day-by-day scan. It's
  called per pointer-move during drag-resize, where a pathological input (a one-day working
  week over a ~100-year span) could previously spin ~255k iterations. Working-day offsets
  repeat with period 7, so the result is computed arithmetically; a brute-force cross-check
  test (7 starts × 6 patterns × 40 counts) locks it to the previous behaviour byte-for-byte.

### Documentation

- **Corrected the `NumberField` "transient NaN" comments** (fields.tsx and its AllocationModal
  echo). For `<input type=number>` the browser reports `value` as a valid numeric string or
  `""`, so `Number(value)` is finite or `Number("") === 0` — never `NaN`. The real residual is
  only that the field can't be held visually blank mid-edit; no behaviour changed.
- **Sharpened the `MAX_IMPORT_RECORDS` comment** to note the 200k cap is a live server-side
  backstop, not dead code: `parseData` also runs on `POST /api/import`, where a hostile body of
  many near-empty records exceeds the cap well inside the 5 MiB request-body limit.
- **Recorded the missing e2e page-error/console gate** as a deliberate known harness gap (in
  `e2e/helpers.ts`), with the reason it's deferred (a fixture would touch all 45 spec files, and
  a naive gate flakes on a benign WebKit dev-server chunk-load error) and the trigger to add it.

## [0.15.7] — 2026-07-13

Two ops-hardening items from the same P3/P4 backlog: the API container no longer runs as
root, and off-host backups are documented as a required, scheduled step rather than an aside.

### Changed

- **The `api` Docker container runs as the unprivileged `node` user** instead of root. The DB
  and backups volume mounts are created owned by `node` so a fresh volume initialises writable,
  and the corepack cache is pinned to a world-readable path (`COREPACK_HOME`) so the pinned
  `pnpm` still resolves offline at container start.

### Documentation

- **Off-host backups are now a recommended cron, not a passing mention.** The self-hosting and
  runbook guides state plainly that on-host snapshots die with the disk/droplet/volume and give
  a concrete scheduled `rsync` (with `restic`/`rclone`/`scp` as equivalents), because a copy on
  a second machine is the real backup.

## [0.15.6] — 2026-07-13

A remediation round drawn from the P3/P4 review backlog: one server-performance fix,
several accessibility/interaction fixes, and hardening of the lint and CI safety nets.

### Fixed

- **Batch writes no longer re-scan the whole database on every operation.** Each write in a
  batch used to reload the entire multi-tenant dataset to validate cross-entity references, so
  a large (authenticated) sync could grow quadratically and monopolise the single writer. The
  batch now loads state once and keeps an in-memory projection in lockstep with the database's
  cascade rules, validating each operation against the running result of the ones before it.
- **Changing only an activity's _kind_ is now guarded against silent loss.** Editing just the
  Project / Internal / Repeatable segment and then pressing Escape (or clicking the backdrop)
  now raises the unsaved-changes notice instead of discarding the change.
- **Purge availability uses the exact 30-day instant.** The "delete permanently" affordance
  compared against date-midnight, so it could stay disabled for up to a day past the real
  boundary; it now uses the precise timestamp the server enforces.

### Changed

- **The command palette is now a proper modal for assistive technology** — it sets `aria-modal`
  and marks the background `inert`, so screen-reader browse mode can no longer wander through
  the obscured application behind it.
- **Escape cancels an in-flight gesture on the schedule** — a drag/resize of an allocation, or a
  draw-to-create, can now be abandoned mid-gesture with Escape (reverting cleanly, no commit).

### Internal

- Type-aware ESLint (`no-floating-promises` / `no-misused-promises`) now covers the `server/`
  and `shared/` workspaces and runs as part of `gate:server`.
- CI builds the Docker images and smoke-tests the Compose + Nginx deployment (health endpoint,
  security headers, and the 6 MB request-body limit) on pull requests and on demand.

## [0.15.5] — 2026-07-13

A fix-only round on top of the invite-token-hashing / auth rework, closing two
`/code-review` passes (high effort, workflow-backed + independent verify).

### Fixed

- **Tiered API deadlines (no more slow-server sync wedge).** The rework applied one
  15s request timeout to every API call, including the three bulk operations. Aborting an
  in-flight `POST /api/batch` left the sync snapshot un-advanced, so the client retried the
  identical diff forever against a merely-slow (but healthy) server and the "saving…" banner
  never cleared. Requests are now tiered: interactive calls keep 15s; the whole-slice load,
  the atomic batch write, and the full inactive-slice export get a 120s bulk bound; and the
  keepalive unload flush gets no deadline at all (a timeout on a request meant to outlive the
  page is self-contradictory — the durable write journal is the guard there).
- **Used invites stay visible to admins.** The member-management invite list dropped used and
  expired links, and the prune step deleted used ones, so an accepted invite vanished from the
  admin view. Used invites now remain listed (only expired-and-unused links are pruned).
- **Archive confirmation now spells out the cascade.** Archiving a client or project opens a
  confirmation that names how many projects and allocations will drop out of the schedule
  underneath it (counts derived from the same active-view projection, so they can't drift).
- **Sign-out always returns to the login screen** — the page now reloads whether the
  `signOut` call succeeds or fails, so a failed network call can't strand a signed-out session
  in a logged-in-looking UI.
- **Audit-degradation warnings surface on lifecycle actions** (the archive/restore/delete path
  now flows through the shared `apiFetch`, which forwards the server's audit-warning header).
- **Bootstrap admin password stays a generated secret in production.** A test-only
  `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD` override pins it for the auth e2e server; production
  keeps the random secret, and the production guard warns if the override is ever set there.
- Smaller hardening: `AbortSignal.any` fallback for Safari 17.0–17.3; unknown-role accounts
  degrade to a safe default instead of disappearing; import size limit and error-recovery
  routing (`unavailable` vs `corrupt`) corrected; MiB (not MB) import-size math; nginx body
  limit aligned with the server cap.

## [0.15.1] — 2026-07-12

A fix-only round: an external 23-finding review (21 confirmed) plus a follow-up
/code-review over the fixes themselves. Verified green across gate (1433 unit),
gate:server (457), and Chromium e2e 183/183.

### Fixed

- **Silent data loss**: a failed save can no longer be clobbered by the focus-refresh or the
  archive/delete/purge reload (the retried edit used to diff to zero ops and vanish); lifecycle
  reloads flush pending edits first, and a reload resolving after a company switch can no longer
  install the previous tenant's data under the new one.
- **Companies, invites and deletes work end-to-end on auth-enabled deploys**: "New company" now
  uses the atomic `POST /api/orgs` (it used to appear to work, error, and vanish on reload);
  deleting a company whose data isn't loaded actually deletes it; the Delete button only shows
  for owner/admin roles; an accepted invite's Continue lands inside the joined company.
- **Large imports sync**: saves are chunked under the server's batch cap (an import over ~5000
  records used to fail forever and be lost on reload).
- **Confidential time-off notes** can no longer be erased or read back by editors through any
  write path — including write echoes, conflict payloads, and `/api/import` (now admin-only
  under auth, since it replaces the whole slice).
- **Boot resilience**: a full/blocked browser storage no longer locks a server-backed install
  behind the local-storage recovery screen (its data lives on the server); the demo build keeps
  the recovery flow.
- **Security headers & token hygiene** (self-hosting): the packaged nginx now sends the same
  clickjacking/sniffing headers as the API and keeps invite/reset tokens out of its access log.
- Smaller fixes: stale-write conflicts resolve cleanly (server-wins) instead of wedging the
  sync retry loop; command-palette focus returns to the invoking control and Tab stays
  contained; "Copy invite link" reports failure when the clipboard is unavailable; children of
  archived parents are labelled with the parent's name instead of "Internal"/"(no client)";
  backups can't collide or overlap; Docker Compose can genuinely disable backups; assorted
  stale operator docs brought up to the auth-on posture.

## [0.15.0] — 2026-07-11

The open-source launch-prep release: a stranger can now find, run, and trust the project
without reading the maintainer's mind. Verified green across gate (1403 unit), gate:server
(436), Chromium e2e 183/183, WebKit + Firefox core specs 168/168 each, and a 94.04%
mutation round.

### Added
- **First-run owner setup.** On a fresh password-auth instance (zero users) the login wall
  offers **Create the owner account**; sign-up is gated live per request and closes the
  moment the first user exists — the `ALLOW_OPEN_SIGNUP` first-login dance is retired.
  `/api/auth/me`'s 401 carries `needsSetup`, and losing the first-run race flips the form
  to sign-in with an explanation instead of dead-ending. A **"SETUP OPEN"** boot warning
  fires whenever password mode starts with zero users (until the owner exists, anyone who
  can reach the server can claim it — also called out in the self-hosting/deploy docs).
- **Headless bootstrap flag.** `--create-owner-admin-admin` / `CAPACITYLENS_CREATE_ADMIN_ADMIN=1`
  creates the well-known `admin@admin.admin` / `admin` owner on an **empty** user table only,
  through Better Auth's internal adapter (atomic, rolled back on failure; the instance-wide
  password floor is never touched). The boot prints a framed change-it-now warning and
  production adds a posture warning naming the credential.
- **CI and repo collateral.** A GitHub Actions gate (typecheck/lint/unit/build + server gate +
  Chromium e2e) on pull requests, manual dispatch, `v*` tags, and a monthly schedule —
  deliberately not on every push. Dependabot across all three workspace directories, issue
  forms, a PR template, and package metadata.
- **Node 24 preflight.** Every server entry script and the dev launcher now fail fast with a
  clear message naming `.nvmrc` / `nvm use` (and the `dev:demo` fallback) instead of a raw
  link-time `node:sqlite` crash from inside tsx.
- **README screenshots** (light + dark, theme-aware on GitHub) and `docs/development.md` for
  the dev-facing detail the README used to carry.

### Changed
- **Repository renamed** `floaty-v1` → `capacitylens` (GitHub redirects the old URL); all
  in-repo links updated.
- **README rewritten human-first** — pitch, quickstart with prerequisites, self-hosting,
  contributing, license; deployment documentation rewritten as an end-to-end production runsheet for the
  server-backed password-auth build.

### Fixed
- **Docker api image crash-loop**: the runtime stage never copied `server/scripts/`, so the
  new preflight died on MODULE_NOT_FOUND before the server booted.
- **Bootstrap lockout hazard**: a `linkAccount` failure after `createUser` used to strand a
  credential-less user row that permanently closed both bootstrap paths; the write is now
  atomic-with-rollback.
- **auth-e2e server reuse**: Playwright no longer adopts a stale `:8887` server whose DB was
  never wiped/bootstrapped.

## [0.14.0] — 2026-07-10

_(Section backfilled at 0.15.0 — the tag shipped without a changelog entry.)_

### Added
- **Admin-issued password-reset links (P1.18).** Owners/admins mint a single-use 24 h reset
  link per member (no email infrastructure needed); a sessionless `/reset-password/:token`
  page redeems it and revokes existing sessions. Hardened by a review round: cross-account
  escalation closed (reset authority must hold in **every** account the target belongs to),
  revocation centralised in the single membership writer, the public request-password-reset
  route shadowed, and password bounds (min/max) single-sourced and test-pinned.

## [0.13.0] — 2026-06-27

A WCAG 2.2 AA accessibility pass that remediates every finding from a deep audit (#116–#123).
No behaviour change for existing flows — the focus is screen-reader, keyboard, contrast, and
reflow conformance, each shipped with a regression test.

### Fixed
- **Modal containment (1.3.1).** The shared modal renders through a portal, so the allocation
  editor is no longer an invalid child of the schedule's `role="grid"` (the one axe-critical the
  audit found).
- **Page titles (2.4.2).** Each route sets a descriptive `<Label> · CapacityLens` title instead
  of the static brand on every page.
- **Reflow + focus (1.4.10, 2.4.11).** The scheduler toolbar wraps at 320px, and a focused
  allocation bar scrolls clear of the sticky header / left column (the scroll-margin tracks the
  real two-tier header height).
- **Contrast (1.4.11, 1.4.3).** The allocation-bar focus ring is now a dual-tone (dark + light)
  ring that clears 3:1 against any background — including the over-capacity red — in both themes;
  the `--c-faint` token was darkened to clear AA on the canvas.
- **Target size (2.5.8).** Preferences toggles are now ≥ 24px.
- **Grid semantics (1.3.1).** The timeline grid honestly exposes its two columns
  (`aria-colcount` / `aria-colindex`, a named timeline cell).
- **Screen-reader text (1.1.1, 1.3.1).** Allocation labels read humanised status and formatted
  dates, announce a note when present, never drop a narrow time-off label, and surface the per-row
  utilisation to assistive tech.
- **Form errors (3.3.1).** The login fields and the working-days picker bind their errors to the
  controls (`aria-describedby` / `aria-invalid`).

### Added
- A polite live region announces the resulting over-capacity after a keyboard-driven allocation
  move/resize (4.1.3).
- A `warning` toast tone for data-mutating advisories (e.g. clamped hours) that persists until
  dismissed instead of auto-closing after 4s (2.2.1).

## [0.12.0] — 2026-06-27

A repo-wide clarity sweep over documentation, inline comments, and variable names. No
behaviour change beyond three user-facing copy strings — the focus is making the repo read
true to the shipped v0.11.0 reality.

### Changed
- **Finished the v0.11.0 persistence-flip doc sweep.** Contributor, privacy, deployment,
  server, planning, and user-story documentation now
  describe server-backed-by-default plus the explicit `VITE_CAPACITYLENS_DEMO=1` demo build,
  instead of the inverted localStorage-default model they had drifted into.
- **Copy.** The per-day over-marker tooltip now reads **"Over capacity"** (matching its own
  screen-reader text); the clear-data settings line says "company" not "account"; and the login
  subtitle drops the stray "workspace" wording.
- Refreshed stale "future work" source TSDocs to present tense (lifecycle tombstones,
  `useScopedData`, `membership`, the deep-health response shape, the audit-hook count), and
  renamed leftover Task-era `t` iterators to `act` / `a` on Activity rows.
- `TimeOffForm` now uses the shared `useFieldError()` hook like every other CRUD form.

### Fixed
- Corrected drifted references: the README version line, the CHANGELOG release-link footer, the
  README/CLAUDE docs maps (now list the deploy & ops cluster), and the utilisation zoom set
  (1/2/4/6/8w).

## [0.11.0] — 2026-06-26

Server-backed persistence is now the default everywhere; the in-browser localStorage build
becomes an explicit, named demo.

### Changed
- **Server-backed by default.** An unconfigured build now runs in server mode against a
  same-origin `/api` (the deployed product already did this). `VITE_CAPACITYLENS_API` now only
  *overrides* the backend origin rather than switching the server on, and an empty value means
  "same-origin", not "localStorage". The in-browser localStorage app is demoted to an explicit
  opt-in.
- **`npm run dev` is now full-stack.** It boots the SQLite API (`:8787`) and the web app
  (`:5173`) together through a dev proxy, and requires **Node 24** (`node:sqlite`).
  `npm run dev:web` is the previous Vite-only, server-mode command.
- **Docker / Compose default to a portable same-origin server build.** An empty
  `VITE_CAPACITYLENS_API` now builds an image that works on any host with no per-host rebuild
  (nginx proxies `/api` same-origin); the demo image is built with `VITE_CAPACITYLENS_DEMO=1`.

### Added
- **`VITE_CAPACITYLENS_DEMO=1` demo build** — the only route to the zero-setup, no-backend,
  no-login in-browser localStorage app (the old default). It wins over `VITE_CAPACITYLENS_API`
  when both are set. A build served without a same-origin `/api` backend (a static host,
  `vite preview`) must use this flag, or it boots into a "can't reach the server" state.
- **`npm run dev:demo`** — a Vite-only localStorage preview (no server, no Node 24) for a
  zero-setup look at the app.

## [0.10.2] — 2026-06-25

The Time off list reads at a glance — who's away, from when, and for how long.

### Changed
- **Time-off list rows are terser.** Each row now reads the resource, a readable start date
  and a day count (e.g. **Wed 10th Jun · 3 days**) in place of the raw `start → end` range,
  type and note. Those details are still stored and still shown on the schedule's time-off
  block — where the kind of absence and its exact span earn their place — so the list stays a
  quick "who's out" scan.

## [0.10.1] — 2026-06-25

The list-management screens get a lighter touch: row actions become icons, and every "Add" button shows a +.

### Changed
- **Edit and Delete on list rows are now icon buttons.** Each row across Resources, Clients,
  Projects, Disciplines, Activities, Time off (and the company picker) shows a **pencil** for Edit
  and a **trash** for Delete in place of the text buttons — quieter rows, same actions, with the
  label on hover. The confirmation dialogs keep their worded **Delete** / **Cancel** buttons.
- **Every "Add" button leads with a `+`.** The create buttons across the app — Add resource, Add
  client, New company, and the rest — now carry a leading plus, matching the schedule's existing
  per-row add control.

## [0.10.0] — 2026-06-25

New companies start lean, and the view settings that were once browser-wide now belong to each company.

### Changed
- **Placeholders and External are per-company.** They used to be a single switch shared across
  every company on the browser; now each company has its own, toggled in **Settings** (like
  Disciplines). Turning them on in one company no longer turns them on everywhere. Both stay
  **off by default**, and toggling only hides or shows — your placeholder and external data is
  untouched. As a result these settings now travel with **Export JSON**.
- **New companies open minimal.** A brand-new company now starts with **Disciplines off**,
  **scheduling set to Days**, and **Placeholders and External hidden**, so you opt into each
  feature as you need it. Existing companies keep their current settings.

## [0.9.1] — 2026-06-24

Weekends stop counting against capacity unless you opt an allocation into them.

### Fixed
- **A weekend a booking merely spans no longer reads as "over capacity".** An
  allocation that runs across a Saturday/Sunday (or any of a resource's non-working
  days) used to paint those days red, as if the person were overbooked. The work
  lands on working days, so the weekend now just shows as unavailable — not red.
  Ticking **"Include weekends as working days"** on an allocation still counts its
  weekend work (and flags it red against a weekday-only person's zero weekend
  capacity), and work scheduled on a **time-off / holiday** day is still flagged as
  the real conflict it is. The allocation editor's "over capacity on N days"
  advisory now agrees with what the schedule shows.

### Changed
- **Faster over-capacity repaint (internal).** The per-day over-marker no longer
  re-derives a date's weekday once per allocation, keeping timeline zoom/pan smooth
  for heavily-booked resources. No behaviour change.

## [0.9.0] — 2026-06-23

Correctness and integrity hardening from a deep code review, plus a smoother
Time-off draw mode.

### Fixed
- **Days-mode allocations never silently lose work.** Entering an allocation by
  "days of work" with the "Days over" field left blank no longer saves a silent
  0-hour allocation — it asks you to complete the field. And dragging or
  keyboard-resizing a days-mode allocation small enough to exceed a real working
  day now tells you the work volume was capped instead of quietly truncating it.
- **External / 3rd-party resources stay capacity-free, everywhere.** You can no
  longer turn a resource that already has work or time off into an external one
  (which would silently hide that work on the schedule). And editing an
  allocation or time-off entry that points at an external resource is now rejected
  consistently — the local-first app and the server agree instead of one accepting
  what the other rejects.

### Changed
- **Switching Time-off draw mode is smoother.** Toggling the schedule's draw mode
  no longer re-renders every allocation bar.
- **Write-boundary integrity hardening (internal).** A batch of code-review
  cleanups with no user-facing behaviour change: the "external resources carry no
  load" rule is now enforced unconditionally at the type level; import resolves
  each record once; draw-mode styling keys off semantic classes rather than test
  ids; and the built-in Internal client's single-instance contract is documented
  across the three write paths that enforce it.

## [0.8.1] — 2026-06-23

Clearer time-off planning, and tighter guards on bad data.

### Added
- **Time-off draw mode now shows you the landscape.** When you switch the schedule toggle to
  **Time off**, booked allocations recede and existing time-off blocks glow amber — so you can
  see who's already away at a glance before drawing a new absence. (The toggle previously only
  changed its own pressed state.)

### Fixed
- **Days-mode work volume is never silently trimmed.** When you enter an allocation as "days of
  work" over a span, a volume that would exceed a real working day now asks you to spread it over
  more days, instead of quietly capping it at 24h/day and losing the rest.
- **External / 3rd-party resources stay capacity-free everywhere.** They can no longer be given
  working hours or time off through import or the API — matching what the forms already enforced —
  so bad data can't slip in and then render invisibly on the schedule.
- **The built-in "Internal" client stays a single per-account anchor**, even on direct API writes,
  so it can't be accidentally duplicated.

## [0.8.0] — 2026-06-20

Clearer capacity at a glance, and a tidier home for non-client work.

### Added
- **A built-in "Internal" home for non-client work.** Activities that don't belong to a
  client project (internal admin, reusable activities) now group under a built-in
  **Internal** client on the schedule and in filters — so you can book project-less work
  without inventing a fake client. Internal is a behind-the-scenes anchor: it's selectable
  when you assign work and you can file projects under it, but it doesn't clutter your
  Clients list.
- **Over-capacity days turn red.** Any day where someone is booked beyond their capacity
  (strictly over — exactly at capacity is fine) now gets a clear red background, so overload
  jumps out at a glance.
- **A short "What Floaty is" welcome.** A minimal post-login page frames Floaty as a
  resourcing tool — who's busy, who's free — not a project manager. (Placeholder copy for now.)
- **Clear local storage (Settings).** A new destructive action wipes Floaty's browser-stored
  data and preferences after a confirmation — handy for resetting a device. On the hosted
  site your data lives in the database and reloads from there.

### Changed
- **"Tasks" are now "Activities"** throughout the UI, routes, types, API fields, and database.
  Existing local data and JSON exports/imports migrate automatically (in-place schema
  migration; server tables renamed in place).
- **Utilisation % now follows the weeks you're viewing.** The per-person and overall
  utilisation figures are computed over the visible window and recalculate when you switch the
  1/2/4/8-week range, so the number always matches what's on screen. (The "overbooked soon"
  red flag still watches a fixed forward window.)
- **Placeholders are now opt-in.** Unfilled-slot placeholders are off by default and enabled in
  Settings; when on they show with a "?" avatar and a "Placeholder" name. Existing placeholder
  data is hidden, not lost, when off.
- **External / 3rd parties moved into the Resources tab** and are opt-in (off by default,
  enabled in Settings), with a short explainer of what External is and isn't. The old
  `/external` page redirects to Resources.

## [0.7.0] — 2026-06-20

See who's doing what kind of work, across every project.

### Added
- **Task kinds — Project, Internal, and Repeatable.** Every task now has a kind. *Project* tasks
  belong to a project (as before); *Internal* tasks are your own non-client work (admin, internal
  reviews); and *Repeatable* tasks are reusable across many projects (Design, Workshop, Meeting).
  The Tasks page groups them into three sections, and the Add/Edit task form lets you pick the kind —
  a project is required only for *Project* tasks.
- **Filter the schedule by task.** A new **Filter by task** dropdown gives you a "task view" of the
  schedule — see all of a repeatable or internal task's work (e.g. *all design*, *all internal time*)
  across every project at once. It's a standalone lens: picking a task clears the client/project
  filter and vice-versa, so you're always looking through exactly one.

### Changed
- **"General tasks" are now "Repeatable tasks".** Existing project-less tasks become *Repeatable* on
  upgrade — your data migrates in place. Reclassify any that are really *Internal* via the task form.

## [0.6.0] — 2026-06-19

Track outsourced work without managing it.

### Added
- **External / 3rd-party resources.** A new resource type for work you've outsourced to another
  company — managed on a dedicated **External** tab, separate from your own people. Book an external
  party onto any task as a simple **start–end span**: no hours, no capacity, no utilisation (you
  don't track their time, just that the work is with them). They render in their own neutral band
  pinned to the **bottom** of the schedule and are left out of utilisation figures, over-allocation
  markers, and time off. Their booking dialog drops the hours and weekend fields, since weekends are
  just plain calendar days for them.

## [0.5.0] — 2026-06-16

A cosmetic preview of the planned sign-in step.

### Added
- **Demo sign-in screen.** A Google-style *"Choose an account"* screen now appears before the
  company picker in the default deploy, to preview the intended "sign in, then pick a company"
  flow. It is **not** real authentication — there's no password and no popup; clicking the
  account just continues. You stay "signed in" across reloads, with **Sign out** on the picker
  and in the sidebar to return to it. It never appears when the optional real login wall
  (`CAPACITYLENS_AUTH`, formerly `FLOATY_AUTH`) is enabled.

## [0.4.0] — 2026-06-16

Cross-browser end-to-end test coverage.

### Added
- **Firefox/Gecko E2E coverage.** `npm run e2e:firefox` runs the core specs on Firefox
  (mirroring the existing Safari/WebKit twin), and the new **`npm run e2e:browsers`** runs them
  on all three engines — Chromium + WebKit, then Firefox. Both stay opt-in, so Chromium remains
  the default `npm run e2e` inner loop, and the multi-engine runs need only Vite (no SQLite/auth
  server, no Node 24). Firefox always runs after WebKit and unconditionally; a run fails if any
  engine fails. `npm run e2e:all` now adds Firefox on top of its WebKit + server-backed coverage.

## [0.3.0] — 2026-06-16

A new display feature plus the scheduler-geometry work behind it.

### Added
- **Minimise weekends** (Settings → **Schedule**, on by default, per-browser). Shrinks the
  Saturday and Sunday columns to a sliver — just wide enough for the date number, labelled a
  single **"S"** — so the working week dominates the schedule. Weekends aren't removed:
  weekend work and bars that span a weekend still render across the narrowed columns, and a
  drag across a weekend lands on the right date. Turn it off for full-width Sat/Sun columns.

### Changed
- **The schedule fills the viewport more tightly at each zoom.** A "1-week" view now shows
  ~1 week and "2 weeks" ~2 weeks, accounting for the narrowed weekend columns; day columns
  can also grow wider on larger screens (the maximum column width was raised) so a one-week
  view fills the space instead of leaving slack on the right.

### Fixed
- **The left-edge date no longer drifts when you change zoom.** Switching zoom levels used to
  nudge the visible start date back a day onto the weekend; the timeline now holds the same
  date across zoom changes.

## [0.2.0] — 2026-06-16

An Alpha-feedback round: four scheduler / sidebar refinements.

### Added
- **Disciplines are now optional.** A per-company setting (Settings → **Disciplines →
  Use disciplines**, on by default). Turn it off and disciplines disappear from the
  whole app — the sidebar nav item and the `/disciplines` route, the Discipline field
  in the resource form, the schedule's discipline grouping **and** filter, the
  Resources list, the command palette, and the "Show Discipline Utilisation" toggle —
  with the schedule rendering as one flat list. The setting lives on the account, so it
  applies to everyone on that company; your discipline data is preserved and returns if
  you switch it back on.

### Changed
- **The month label stays visible while scrolling.** The month (e.g. "Jun 2026") now
  sticks to the left edge of the timeline as you move across it, instead of scrolling
  away with the 1st of the month.
- **Resource names stay at the top of their row.** On a tall row with several stacked
  allocations, the person's name and avatar stay pinned to the top (aligned with the
  first allocation) rather than drifting to the vertical centre as the row grows.
- **The company / "Switch company" block moved to the bottom of the sidebar.** This
  keeps the logo and collapse toggle as the first item in both the open menu and the
  collapsed icon rail, so the nav icons don't jump when the sidebar collapses.

### Fixed
- **Collapsed (mobile) sidebar alignment & polish.** The collapse toggle and the nav
  icons now share the same left column and the same row height in both the open menu
  and the collapsed rail, so nothing shifts horizontally or vertically when you collapse
  it. Disciplines are correctly hidden from the collapsed rail when turned off, and each
  rail icon now shows an instant hover tooltip of its section name.

## [0.1.0]

- Initial local-first, multi-tenant resource scheduler: week-grid schedule with
  drag/resize allocations, capacity & utilisation cues, time off, the CRUD pages
  (resources, disciplines, clients, projects, tasks), import/export, light/dark themes,
  the command palette, and an optional SQLite-backed server behind the persistence seam.

[Unreleased]: https://github.com/Kevinjohn/capacitylens/compare/v0.23.4-alpha.0...HEAD
[0.23.4-alpha.0]: https://github.com/Kevinjohn/capacitylens/compare/v0.23.3-alpha.0...v0.23.4-alpha.0
[0.23.3-alpha.0]: https://github.com/Kevinjohn/capacitylens/compare/v0.23.0-alpha.0...v0.23.3-alpha.0
[0.23.0-alpha.0]: https://github.com/Kevinjohn/capacitylens/compare/v0.20.1-alpha.0...v0.23.0-alpha.0
[0.20.1-alpha.0]: https://github.com/Kevinjohn/capacitylens/compare/v0.20.0-alpha.3...v0.20.1-alpha.0
[0.20.0-alpha.3]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.20.0-alpha.3
[0.20.0-alpha.2]: https://github.com/Kevinjohn/capacitylens/commit/a0078d6d1e45f98492fca3cd878b6d5e77ad4353
[0.20.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.20.0-alpha.1
[0.19.4]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.19.4
[0.19.3]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.19.3
[0.19.2]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.19.2
[0.19.1]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.19.1
[0.19.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.19.0
[0.18.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.18.0
[0.15.8]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.8
[0.15.7]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.7
[0.15.6]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.6
[0.15.1]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.1
[0.15.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.0
[0.14.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.14.0
[0.13.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.13.0
[0.12.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.12.0
[0.11.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.11.0
[0.10.2]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.10.2
[0.10.1]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.10.1
[0.10.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.10.0
[0.9.1]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.9.1
[0.9.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.9.0
[0.8.1]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.8.1
[0.8.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.8.0
[0.7.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.7.0
[0.6.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.6.0
[0.5.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.5.0
[0.4.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.4.0
[0.3.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.3.0
[0.2.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.2.0
[0.1.0]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.1.0
