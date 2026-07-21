# Standing decisions

This is the short, present-tense record of decisions that constrain future work.

## Product

- CapacityLens is a week-granularity capacity overview for small agencies.
- Budgets, money, timesheets, hour-by-hour workflows and mobile scheduling are non-goals.
- “Utilisation” is the product term.
- Clients own projects; projects and internal work contain activities; allocations connect a
  resource to an activity over a date range.
- Activities are `project`, `internal` or `repeatable` (the user-facing label is **Project-specific**,
  **Internal** or **Cross-project**). Only project-specific activities may reference a project or
  phase.
- Resources are people, placeholders or external parties. External parties have no capacity and
  do not contribute to utilisation.
- Employment type is recorded for people but does not add a visual badge to the schedule or roster.
- The product introduction is acknowledged once per device, not once per sign-in.

## Scheduling invariants

- A day is over capacity only when allocated capacity is strictly greater than available capacity.
- Normal allocations do not consume a resource's non-working weekdays. `ignoreWeekends` is the
  explicit exception.
- Displayed utilisation is calculated over the visible 1/2/4/8-week window.
- `overSoon` is calculated over a fixed forward 14-day window from today and never changes with
  zoom or pan.

## Data and tenancy

- SQLite-backed server persistence is the default. Missing API access is an error, never a silent
  browser-storage fallback.
- Portable JSON/export versions and physical SQLite versions are separate contracts. SQLite uses
  an immutable, one-way migration list and `PRAGMA user_version`; a database-side history ledger
  records each version, name, SHA-256 definition checksum and application timestamp. Missing or
  altered history refuses startup. Every released older database fixture remains upgrade-tested
  indefinitely.
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
- Forms reject invalid input. Import and server boundaries repair safe values, drop unsafe rows
  and preserve referential integrity.
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
  palette edit silently change a shipped migration). Write-time snapping on both server and
  client uses the same shared nearest-preset mapper so the two can never disagree, and the client
  never silently repairs a colour on a rejected write.
- Server imports are atomic, not undoable and owner-only; a non-owner's redacted export is not a
  safe source for a whole-slice replacement of owner-confidential client/project identities.
- Theme and display preferences are device-global and outside account exports.
- Client/project privacy is opt-in and owner-managed. Real names and raw code names remain stored;
  only account owners receive them. Every other role receives the quoted code name, and non-owner
  writes preserve the protected stored fields. The built-in Internal client is always public.

## Offline

- Offline reading is explicit per-device opt-in, expires after seven days and stores snapshots in
  IndexedDB encrypted with a non-extractable per-browser AES-GCM key.
- Offline state is always viewer/read-only. The app never queues offline mutations.
- Sign-out and the device-data control erase cached identity/account snapshots.

## Authentication and security

- Production refuses to start with authentication off unless an operator explicitly accepts the
  open-instance risk.
- Each authenticated company has exactly one Owner. Owner is not an invite or ordinary role-change
  option; ownership moves only through an explicit atomic transfer to an existing member, with the
  former Owner becoming Admin.
- App members and scheduled Resources are separate records. Adding a Resource never grants access,
  and inviting a member never creates a schedulable person.
- Team & access is a first-class destination visible to every role so members can understand their
  own access; only Owner/Admin receive directory, invitation and access-management controls.
- The account layer is an embedded repository-local boundary: neutral contracts, `IdentityPort`,
  `AccountAdminPort` and an orchestration-only `AccountFlows` coordinator. It permanently shares the
  product process, SQLite file and checksummed product migration ledger unless a separately approved
  future trigger changes topology.
- Each installation owns its local principals, sessions and memberships. Siblings share
  implementation/conformance, never account records. Federated correlation is exact
  `(issuer, subject)`, never email; local deprovisioning cannot delete an upstream IdP identity.
- Email/password is stable for self-hosting. Strict OIDC is first-class; named Google, Microsoft and
  GitHub providers remain experimental. Arbitrary generic OAuth is unsupported.
- Named profiles are `self-hosted-password`, `self-hosted-mixed`, `self-hosted-sso-only` and
  `hosted-oidc-only`. Hosted is SSO-only and refuses password configuration. A future product
  grouping layer may integrate only as an external OIDC provider, never through account internals.
- IdP disablement stops new authentication but not an already-issued local session. Hosted accepts
  the bounded lag of thirty minutes inactivity or twelve hours absolute; back-channel logout or an
  equivalent must be reconsidered before hosted GA.
- Email self-registration is closed by default. External identities require a verified email and
  a live invitation; initial SSO ownership requires an operator email allow-list.
- Secure-cookie behavior follows the public `SMALLSASS_ACCOUNT_PUBLIC_URL`, including behind a TLS
  proxy. Legacy product/vendor-prefixed account variables remain warning aliases until both two
  stable minor releases and 90 days have elapsed from the first stable release carrying the
  canonical namespace. The 0.25 alpha does not start that clock; after 0.25.0 stable, removal is no
  earlier than 0.27.0 and 90 days after its recorded release date. Conflicting aliases refuse startup.
- Password mode defaults to breached-password screening; required TOTP MFA is an operator opt-in.
  Sessions have a fixed twelve-hour lifetime; privileged actions require a session no older than
  fifteen minutes regardless of MFA policy. The client answers the freshness refusal with an
  in-place "confirm it's you" re-authentication dialog that mints a fresh session and retries,
  never a full sign-out that discards working state.
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
  diagnosable rather than a silent password-retry loop.
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
  deployment hardening. Their operator attestations produce warnings rather than blocking startup.
- The packaged production proxy/API hop uses a private per-install CA and verified TLS 1.2/1.3.
  Bare-metal deployments may instead use HTTP only across a same-host loopback proxy hop.
- CSP violations enter the bounded, data-minimised security stream. Socket, scrypt and HIBP work
  limits are finite and fail closed under overload.
- Better Auth telemetry is disabled. CapacityLens ships no product analytics or outbound email.
- Errors on data paths are surfaced, not swallowed. See `DEFENSIVE-CODING.md`.

## Open source and hosted service

- The community repository is AGPL-3.0-only. The hosted service may add deployment/billing layers
  outside this repository, but changes to this networked application remain subject to the AGPL.
- Contributions use DCO sign-off; there is no CLA or copyright assignment.
- CapacityLens names and logos are not granted by the software licence. See `TRADEMARKS.md`.
- Licensing, privacy terms and trademark boundaries require professional legal review before the
  hosted service launches.

## Continuous integration

- Local green gates are the pre-launch source of truth. Automatic GitHub runner jobs are skipped
  while the repository is private; maintainers run the complete remote gate manually when it adds
  value rather than on every development push.
- Making the repository public automatically restores CI for pull requests, `main`, release tags
  and the scheduled canary. Public-repository standard runners are the intended long-term posture.
- Private CodeQL is not enabled. CodeQL stays dormant until the repository is public rather than
  consuming runner time on an upload GitHub will reject.
- Dependabot continues its monthly root-workspace updates independently of the runner policy.
