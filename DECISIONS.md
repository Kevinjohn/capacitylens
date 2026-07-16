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
- The demo adapter is in-memory and resets on refresh.
- Every scoped entity carries `accountId`; the active account is transient and never persisted.
- Server session + membership is the security boundary. Client scoping is defense in depth and UI
  hygiene, not authorization.
- Forms reject invalid input. Import and server boundaries repair safe values, drop unsafe rows
  and preserve referential integrity.
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
- Email/password is stable. Social and generic OIDC providers are experimental and clearly marked.
- Provider support is additive in password mode; `CAPACITYLENS_AUTH=sso` is the SSO-only posture.
- Email self-registration is closed by default. External identities require a verified email and
  a live invitation; initial SSO ownership requires an operator email allow-list.
- Secure-cookie behavior follows the public `BETTER_AUTH_URL`, including behind a TLS proxy.
- Password mode defaults to breached-password screening; required TOTP MFA is an operator opt-in.
  Sessions have a fixed twelve-hour lifetime; privileged actions require a session no older than
  fifteen minutes regardless of MFA policy.
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
