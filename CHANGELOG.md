# Changelog

All notable changes to CapacityLens are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/) — while pre-1.0, **minor** versions carry
new features and **patch** versions carry fixes.

## [Unreleased]

### Changed

- Removed local multi-factor enrolment, challenges and recovery codes. Google and Microsoft company providers now own any multi-factor policy; password sign-in and existing credentials remain available in modes that allow them.

### Documentation

- Added complete Editor and Viewer starting routes, expanded Owner, Admin, joining, Account and discipline journeys, and added current screenshots for role-specific controls. Corrected operator guidance for MFA, provider linking, backups and monitoring.

### Added

- A role-based schedule tour that begins with the caller's role, includes lower-role guidance, and
  disables its Getting started launcher while permissions are unresolved or an offline snapshot is read-only (#969).
- A shared Help page above Account in the sidebar and command palette. Every role can start its
  tour there and browse the user guides, including Viewers and people who dismissed Getting started (#1430).
- The README states the project's status, and the documentation gains three pages: how
  CapacityLens compares with other tools, how it is tested, and the product philosophy.
- A new company can start with example data: a **Start with example data** box on the create-company
  form (ticked for a first company), or **Settings, Example data** while the company is empty. It adds
  two people, a client, a project and a few bookings across this week and next, as ordinary rows. An
  Owner or Admin can add it, and the server refuses a company that already has people, clients,
  projects or allocations (#1388).
- A **Diagnostics** page for Owners and Admins, listed under Settings in the sidebar and the command
  palette. Its support report adds the sign-in mode, this browser session's save counters and the
  browser's user agent, viewport, time zone and language to the build and server status, and
  **Copy diagnostics** copies it. It contains no names, email addresses, identifiers or company data
  (#1408).
- `node server/dist/index.mjs init --public-url <url> --db <path>` generates the session secret and
  setup token and prints the five-line environment file, or writes it with `--out <file>`, readable
  only by its owner and never over an existing file. The install guides use it instead of `openssl`
  (#1407).

### Changed

- Require Node 24.19.0 or newer within 24.x for the supported runtime. Admit Node 26.9.0 or
  newer within 26.x experimentally, with a focused local compatibility check and no scheduled
  Node 26 CI. Source and packaged entrypoints enforce the same minimums (#710).
- The documentation is reshaped into four role guides (day-to-day use, Owner, Admin, and install
  and run), each with its own landing page and sidebar, and one canonical page per topic: 70 pages
  instead of 91. The detailed `guide/` pages are merged into the matching day-to-day pages,
  installation and operations pages into `self-hosting/` with one install page, and dated security
  reviews move under `security/reviews/`. Old documentation paths are not redirected (#1408).
- Server error messages are consistent sentence-case sentences ending with a full stop, for example
  "Internal server error." and "Rate limit exceeded.". A rejected import reply says "The import data
  is not valid CapacityLens data." instead of echoing the parser's reason, which the server now logs
  (#1409).
- Settings gathers the remaining company switches (**Use disciplines**, **Show placeholders**, **Show
  external resources**, **Inline activity creation** and **Show task field in schedule**) in one
  **Company features** section (#1408).
- People are grouped into Studio and Supplementary only while the company has an active
  Supplementary person. A Studio-only team sees one list on Resources and one schedule band, titled
  Resources when disciplines are off and Unassigned for people without a discipline (#1408).
- Internal projects and activities are always shown and always use neutral grey (#1408).
- The schedule always snaps a free scroll back to the week start and always uses the roomier row
  spacing (#1408).
- Under `NODE_ENV=production`, an unset `CAPACITYLENS_CORS_ORIGIN` now allows the origin of
  `CAPACITYLENS_PUBLIC_URL` instead of the local development origins. An explicitly empty value
  still allows none, and Docker Compose keeps passing it empty (#1407).
- `.env.example` is regrouped as the operator reference: required, common, company providers, mail
  and operations. Development and test variables moved to the development guide (#1407).
- Every `SMALLSASS_ACCOUNT_*` setting is renamed to `CAPACITYLENS_*` with the same suffix, for
  example `SMALLSASS_ACCOUNT_SECRET` becomes `CAPACITYLENS_SECRET`. Rename these variables in your
  `.env` before upgrading; the old names are no longer read (#1407).

### Removed

- Settings no longer offers **Group resources by engagement**, **Internal work colours**, **Show
  internal projects**, **Show internal activities**, **Snap to week start** or **Compact view**, and
  no longer shows the read-only Language row or the persistence diagnostics in **Build details**
  (#1408).
- Settings no longer has the **Diagnostics** row: Editors and Viewers report problems with the
  **Build details** stamp, and Owners and Admins use the new Diagnostics page (#1408).
- Startup no longer recognises the removed account variable names, the generic OIDC settings or the
  `hosted-oidc-only` profile; they are unknown settings now, and `hosted-oidc-only` is an invalid
  profile. Docker Compose stops forwarding them (#1407).
- `CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED` is gone; use `CAPACITYLENS_TRUST_PROXY_HEADERS` (#1407).
- `CAPACITYLENS_OPTIMISTIC_CONCURRENCY` is gone: stale writes are always rejected (#1407).
- Password MFA is hidden: `SMALLSASS_ACCOUNT_REQUIRE_MFA` is no longer read, the enrolment screen no
  longer appears, and Account no longer shows MFA status. Its startup warning is gone (#1407).
- `SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED`, `CAPACITYLENS_STORAGE_ENCRYPTED` and
  `CAPACITYLENS_SECURITY_LOG_FORWARDING` and their startup warnings are gone. Requiring multi-factor
  sign-in at the provider, encrypting storage and forwarding logs remain operator tasks described in
  the guides. A missing internal TLS identity still warns, now on its own line (#1407).

### Fixed

- Password sign-in reaches the company picker without requesting an unscoped state snapshot (#1338).
- Update Better Auth to 1.7.7 for upstream security fixes and match its namespaced OAuth state
  lookup so provider errors keep their configured callback route. Restart provider sign-in or
  linking flows that were in progress during the upgrade (#1404).
- Update the transitive `source-map-js` package to 1.2.2 for the indexed source-map
  denial-of-service advisory (#1404).

### Security

- Updated the transitive `source-map-js` dependency to 1.2.2, resolving a high-severity
  event-loop denial-of-service advisory (GHSA-68fv-2mgg-jv7q).

## [0.73.0-alpha.1] - 2026-10-01

### Added

- Each release publishes a runnable server archive, `capacitylens-X.Y.Z.tar.gz`, with a `.sha256`
  checksum. It holds the built web app, the server and its runtime dependencies, an environment
  example with three lines to fill in, a systemd unit, nginx and Caddy site files and an
  `INSTALL.md` with the five install steps. Node 24 is the only prerequisite (#1383).
- Run from the archive, the server also serves the web app, with the same caching and security
  headers as the packaged nginx, so one reverse-proxy line in front of it is enough. Request logs
  hide the token in `/invite/` and `/reset-password/` links. `CAPACITYLENS_WEB_DIR` points the
  server at another build, or turns serving off when set empty (#1383).
- The archive includes the owner-password recovery tool, so recovering a sole Owner no longer needs
  a source checkout (#1383).

### Changed

- Under `NODE_ENV=production`, unset settings take the recommended values: sign-in mode
  `password-only`, a rate limit of 300 requests a minute, request logging, deep health checks,
  audit records on stdout and hourly backups in `backups/` beside the database file. Explicit
  values still win, and sign-in mode `off` still needs `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1`
  (#1383).
- The server's HSTS header, and the one in the archive's nginx site file, is host-only, without
  `includeSubDomains`. The server sends it automatically when the public URL is `https`;
  `CAPACITYLENS_HTTPS=0` turns it off. The Docker Compose nginx is unchanged (#1383).

### Fixed

- Docker installations now refuse retired generic company-login settings at startup instead of
  silently omitting them. Repeat Compose starts now reuse the existing internal certificate
  after an API restart or database restore, and the installation guide follows the current
  password setup flow (#1387).
- Docker web targets now keep account-route redirects on the public origin, and the documented
  audit-outbox recovery command accepts pnpm's argument separator (#1387).
- Stop warning logs from copying response payloads, omit corrupt cell contents from SQLite read errors, and strip query strings and fragments from request URLs.

## [0.72.0-alpha.1] - 2026-09-30

### Added

- Password users can verify their email by link to join through an open or approved-domain
  company policy when email delivery is enabled (#1300).

- Optional SMTP delivery for addressed invitations and **Forgot password?** email recovery.
  Admin password-reset copy-links remain available without email (#1312).

### Fixed

- Creating a company with a malformed request body now returns a validation error without creating partial company data (#1371).
- Switching companies while a member view is waiting to save pending changes now cancels that
  start before it can load the previous company's view (#1370).
- Selecting a company that is no longer available returns to the picker and clears the previous
  company's dirty form, drag and screen-reader announcement state while keeping the not-found notice.
- The documentation 404 page now explains the missing page and returns hosted visitors
  to the documentation home, including from nested routes (#1368).
- Invitation guidance now reflects conditional SMTP delivery and the copy-link fallback, and
  explains that Disable Access follows recreated identities only with durable mailbox proof (#1367).
- Connecting a company sign-in provider now offers identity confirmation when a
  session has aged and explains how to recover from an unverified local account
  email (#1364).
- A first start on an empty database no longer logs a "Database schema mismatch" error telling
  the operator to run `npx auth migrate`. The server creates those tables itself, and still refuses
  to start if they cannot be brought up to date (#1353).
- Dev tooling now reserves explicitly selected port lanes, reports missing `lsof`, and stops with
  instructions instead of terminating a process that occupies a lane (#1316, #1317, #1322).
  `pnpm run lanes` lists what holds each lane, and `--stop-orphans` stops leftover servers.
- Pending offline snapshots no longer restore data after offline access is disabled (#1320).
- Offline cache warnings stay visible until the failed snapshot is saved successfully (#1321).
- Offline snapshots can be retried immediately after a concurrent device-cache cleanup discards an earlier write (#1372).
- Invitation emails are limited to five an hour per address from each company and fifty an hour
  per company, and joining-verification emails to five an hour per address, so they cannot be
  used to flood a mailbox or
  exhaust the mail quota. Over the budget an invitation is still created with its copy link
  (#1324).
- A save made while someone else was signing up could be confirmed and then lost if that
  sign-up failed. Sign-up now checks and hashes the password before it starts writing, and a save
  that still overlaps a sign-in is refused instead of being tied to it (#1305).
- A save that overlapped a sign-up or company sign-in could fail with a server error. It now waits
  for the sign-in to finish and then saves (#1307).

### Security

- Git now ignores `.env` and `.env.*` (except `.env.example`), so the secret and setup token an
  install writes to `.env` cannot be committed by `git add .` (#1358).
- Sign-in and other credential limits now count each client by the address the server trusts.
  A client could previously avoid them by sending its own forwarding header, and without one
  every client shared a single allowance (#1308).
- In the Docker deployment, three sign-in attempts by anyone locked every user out of signing in
  for 10 seconds, because all requests reached the server from the host proxy's address. The
  packaged nginx now passes on the browser's address from a proxy on the host or a private
  network (#1311).
- Updated the transitive `undici` dependency to 7.29.1, resolving two high-severity advisories
  (a WebSocket denial of service and a TLS certificate validation bypass).

## [0.71.0-alpha.1] - 2026-09-27

### Added

- Let each company's Owner choose invitation-only, open, approved-domain, or approved-domain-or-invitation joining in **Team & access**. Admins can review the policy. Existing identities with trusted address proof join as Viewers by policy; addressed invitations can grant another role. Google, Microsoft and eligible GitHub sign-in follow the same company-bound rules (#1291).
- Let Owners and Admins Disable Access to one company and explicitly Enable it later. The
  restriction survives membership removal and verified-email re-registration; ordinary archive
  and removal still allow a later invitation. Verified GitHub addresses in mixed mode use the
  same restriction, while GitHub remains experimental (#1290).
- Use Google or Microsoft for company sign-in, including first-owner setup, invitations and
  explicit connection to an existing account. Microsoft verifies your company email once when
  needed, with retry and recovery for expired or undelivered verification links (#1216, #1240).

### Changed

- Make sign-in modes explicit: password only, company sign-in only, or both. Existing installations
  must update `SMALLSASS_ACCOUNT_MODE` alongside the application; see the upgrade guide (#1288).
- Place every configured sign-in provider in one consistent-width stack above the password form,
  preserving provider order, branding and first-owner setup behavior (#1289).
- Give consistent reasons when checking whether passwords can be disabled, with one or several
  company sign-in providers configured. Keep existing sign-in and recovery safeguards (#1248).
- Present Google and Microsoft together above the password fallback. Provider-required
  installations reject password and GitHub sign-in; mixed installations retain existing
  password and GitHub behavior. Microsoft live-tenant validation remains pending (#1219).
- Require named Google and/or tenant-specific Microsoft configuration for hosted SSO. Retire
  generic OIDC settings and the in-app member-readiness panel. Keep the read-only preflight and
  guarded stopped-server repair commands for named-provider preparation and recovery (#1218).

### Fixed

- Close an enlarged documentation screenshot when Tab is pressed, so keyboard focus no longer moves
  behind the overlay where its focus ring cannot be seen (#1278).
- Keep company switches from leaving earlier attempts unresolved, reconcile uncertain member links
  and ownership confirmations with the latest access, and offer a retry when the ownership request
  cannot be read (#1253).
- Show linked sign-in pictures consistently on Schedule and Overview when a person has no explicit
  avatar, and explain that provider reauthentication requires resubmitting the original action
  (#1253).
- Reject malformed successful breach-check responses, retain safe Microsoft mail-delivery
  diagnostics, and keep database inspection read-only while hardening files during initialization
  (#1253).
- Make validation launchers report interrupted children as failures and keep concurrent port-lane
  claims distinct (#1253).
- Keep failed company-sign-in connection messages visible after returning from the provider,
  and clear the previous failure when retrying (#1216).
- Exclude external / 3rd-party people from a group's average utilisation, as the headline
  figure already does (#1257).
- Label the sidebar theme button by the scheme actually displayed, so with Match system on a
  dark device it offers light mode and switches to it (#1260).
- Clear a new invitation link when the invite dialog closes, so reopening it shows an empty
  form instead of the previous link (#1262).
- Show a notice when an invite finishes creating after its dialog was closed, since its
  one-time link could not be shown (#1262).

### Removed

- Remove the list of active sessions from Account → Security. Individual sessions can no longer
  be viewed or signed out from the app; changing your password still signs out other sessions
  (#1234, #1255).
- Report degraded backup health when the backup directory goes missing or becomes unwritable after
  an earlier successful snapshot, instead of continuing to report ok (#1277).

## [0.70.1-alpha.1] - 2026-09-23

**Alpha 7 — Final Alpha.** This is the final Alpha release and the pinned baseline before the
planned company-sign-in simplification. For everything added since the published Alpha 6,
read this section together with the 0.70.0 and 0.69.0 entries below.

### Changed

- Follow five Getting started milestones based on your company's actual scheduling data, see
  progress from every page, and dismiss the checklist for the whole company (#1229, #1230).
- Set up the first Owner and company with clearer, shorter instructions. The timezone picker
  remains usable in narrow windows, and language selection accurately shows English as the
  available choice (#1227, #1228, #1232).
- Find Account details and actions in aligned columns, reveal a long email address by hovering
  or focusing it, and change your password in a focused dialog. MFA status appears when required
  (#1231, #1236).
- Manage invitations and members in matching Team & access tables, with invitations first and
  stable row actions while dialogs are open. Link people to scheduled Resources more directly,
  manage company ownership in a dialog, and review SSO cutover readiness in its own Settings
  table (#1198).
- Switch quickly between light and dark appearance using the sidebar button. The full
  **Match system** preference remains in Settings (#1146).
- Recognise Google, Microsoft and GitHub sign-in actions through consistent branded buttons
  on sign-in, invitation and reauthentication screens. Named providers remain experimental;
  this presentation update does not complete the planned company-sign-in changes (#1189).
- Use refreshed Overview, Schedule, Settings and form guides with screenshots of the current
  controls, including the Overview's individual weeks, Ledger and Load curve displays
  (#1143, #1144).
- Managed-VPS deployments now activate a smaller production runtime without retaining build
  and test dependencies in each deployed release (#1182).
- Update Better Auth to 1.7.5 and refresh application dependencies. Company-login admission
  rules remain in place; the callback registration changes are described below (#1223, #1225).

### Fixed

- Keep Google sign-in actions sharp on high-density screens, with consistent spacing and no
  oversized shadow around the button (#1164).
- Show the Google-branded company-login button and password fallback in the intended order
  when strict OIDC is explicitly configured with Google branding (#1152).
- Warn operators when a Google- or Microsoft-branded company login points to a different
  provider, helping avoid a misleading sign-in button (#1154).
- Make Team & access member actions easier to scan and keep the Account **Sign out** action
  visibly distinct (#1150, #1151).
- Align the Change password dialog with the application's other forms and action footers
  (#1236).
- Include the internal-TLS renewal verifier in the production API image, so existing Compose
  deployments can validate coordinated certificate renewal (#1192).
- Pass company-login branding settings through Compose so existing container installations
  can display the configured Google, Microsoft or generic sign-in treatment (#1170).

### Upgrading and rollback

- Rename retired account environment settings to their `SMALLSASS_ACCOUNT_*` replacements
  before restarting. The server refuses old names and identifies the required replacement;
  see the [upgrade guide](docs-src/self-hosting/upgrades.md) for the complete mapping (#1201).
- For generic company login, register `/api/auth/callback/<provider-id>` in place of
  `/api/auth/oauth2/callback/<provider-id>` before upgrading. The usual provider ID is `sso`.
  Existing native Microsoft identities need the conditional identity-compatibility check
  described in the upgrade guide; installations without those identities need no conversion.
- Back up the SQLite database and deployment configuration before upgrading from Alpha 6.
  Database schema 44 advances to 45; portable exports remain at format 23. Use the pinned
  Node.js 24 runtime and pnpm version.
- Keep this release and a matching configuration/database backup as the final Alpha recovery
  baseline. To return from a later release, restore a compatible backup and configuration
  with the older build; do not open a newer migrated database with it. Restoring a backup
  also restores the data to that backup's point in time.

## [0.70.0-alpha.1] - 2026-09-17

### Fixed

- Keep selected and keyboard-focused recessed segments above their neighbours, and keep allocation
  detail popovers centred on the visible portion of a bar after horizontal schedule scrolling
  (#1145).

### Changed

- Carry the same control treatment into dialogs and forms: the allocation **Status**, activity
  **Kind**, resource **Engagement** and company **Week starts on** choices sit on the recessed
  track, so no control in the product still marks its selection with a blue border (#1128).
- Carry the Overview's control treatment into Schedule and Settings: segmented choices sit on a
  recessed track with only the selected option lifted, and the Schedule's **Show tentative** /
  **Hide tentative** pair becomes a single **Tentative** pill that is on by default (#1128).
- Redesign the Overview page as a single capacity ledger: each week cell shows free days out of
  capacity with a colour-graded bar and a grey tentative hatch, an optional **Totals** header row
  reports each week's committed percentage and free days, a **Load curve** display shows shape only,
  and the horizon offers 4, 8 or 12 single weeks. Boolean toolbar choices become single pills. The
  per-group totals rows, including the combined unassigned-demand figure, are removed: totals cover
  the people shown and placeholder rows carry their own demand (#1130).

## [0.69.0-alpha.1] - 2026-09-17

### Fixed

- Align Team & access member actions as distinct masquerade, role-edit, Resource-link and settings
  controls, and show **None** for members without a linked Resource (#1132).
- Use Google's recognizable mark and exact **Sign in with Google** action copy across configured
  Google social sign-in, invitation and reauthentication buttons, including their disabled states (#1124).
- Keep successful Google and other external sign-in handoffs in a neutral, accessible redirecting
  state instead of showing a false failure (#1123).
- Align labels with their controls in the Client and Project modals, and place the clearer code-name
  privacy explanation beneath the conditional input (#1120).
- Keep profile-picture ownership with each person's Account by removing Avatar URL from the resource
  modal, and place Start date and End date together on one responsive row (#1108).
- Centre allocation detail popovers over the visible segment of a schedule bar when horizontal
  scrolling clips the bar (#1107).
- Size schedule rows for overlapping allocations in the visible date window, so historical
  overlaps do not leave otherwise single-lane rows unnecessarily tall (#858).

### Changed

- Put a configured Google social sign-in action first in mixed password mode, with an explicit
  **or use your password** fallback separator while keeping password and other provider doors available (#1125).
- Rework day-to-day, Admin and Owner documentation around visible screens and useful actions.
  Prioritise personal scheduled work, complete Admin tasks and the Owner-to-Admin handover.
  Add real application screenshots for each guide, including role-specific access and first-company setup.

- Clarify the first-booking, installation and operations journeys with visual stages,
  route-specific navigation and safer verification and recovery guidance (#1100).

- Align Team & access member and outstanding-invite rows with the managed-resource list, move member
  actions and Resource linking into centered dialogs, and rename the association controls to **Link
  to Resource** (#1104).

- Start Overview in **Bar & number** mode and give the 12-week table extra breathing room only at
  the Week 4 to Weeks 5–8 strategic boundary (#1102).
- Remove member-link guidance and entry points from Resources, and add a consistent pointer cursor
  to enabled action controls across the resource and directory pages (#1103).
- Consolidate the sidebar footer to one avatar-led **Account** row, move real and demo sign-out to
  Account, and hide product-orientation navigation and unnecessary single-company context (#1105).
- Make the documentation home easier to scan, replace the day-to-day application tour entry with
  the task-focused Overview guide, and keep the current page marked in the static sidebar and
  narrow-screen guide menu.
- Reorganise the documentation into self-contained day-to-day, Owner, Admin, installation,
  and operations guides, each with its own task path and FAQ. Add a plain-language introduction,
  first-booking quick start, script-free narrow-screen guide navigation, and an open-source and
  contributing page (#1099).

## [0.68.0-alpha.1] - 2026-09-15

### Changed

- Keep member links and invitations in Team & access, with a **Manage team links** entry point
  from Resources (#1088).

- Let Owners and Admins optionally propose an account-scoped scheduled person for an invitation;
  admission attempts the link atomically and reports actionable exceptions without exposing proposal
  state to invitees (#1087).

- Keep scheduled-person kinds immutable, clear member links during destructive scheduling imports
  and permanent lifecycle removal, and make Team & access link changes retry-safe and auditable (#1086).

- Simplify onboarding from first-Owner and company setup through the first useful schedule, with
  plain-language labels, three outcome-based setup steps and a non-blocking explanation that can
  always be reopened from the sidebar (#837).
- Organise Settings into Company setup, Scheduling features, My display, and Data and support,
  with compact responsive rows, clearer labels and visible company/device scope (#965).
- Name the Settings build and persistence row so build stamps, feedback and diagnostic breadcrumbs
  have a clear support context, and keep the personal Account controls outside Data and support (#1042).

### Added

- Let Owners and Admins explicitly link account members to scheduled people, using a validated
  sign-in avatar only when that person has no explicit avatar URL (#1084).
- Allow scheduled people to use an externally hosted HTTPS avatar, with initials as the loading and
  error fallback and no-referrer browser requests (#1083).
- Add an optional **12 weeks** strategic horizon to Overview, while keeping the four-week tactical
  view as the default and the person schedule drawer at 28 days (#968).
- Add a current visual tour of every application page to the documentation.

### Fixed

- Refresh every documentation screenshot against the current interface, correct the Settings and
  navigation captures, and pin sensitive invitation imagery for bearer-value publication review
  (#923, #924, #925).
- Bring the published guides, contributor guidance, historical implementation records and
  user-story test references back into line with the shipped product, including installation,
  sign-in, permissions, date formatting and ownership-transfer details (#913, #914, #915, #916,
  #917, #918, #919, #920, #926, #928, #930, #934, #935, #937, #940, #941, #944, #1010).
- Clarify that the company date format governs planning dates, while session, reset,
  invitation and ownership timestamps use each viewer's browser locale and local time zone
  (#927, #939).
- Clarify first-owner and company-login onboarding recovery, company calendar choices and
  All-projects setup guidance, and repair the first-steps orientation link (#1023, #1024, #1025,
  #1060, #1061, #1062, #1063).
- Keep the command palette's Overview page result consistent with the sidebar and its role-based
  company access setting (#1000).
- Include the Account page in the command palette's Pages results (#938).
- Keep ownership-transfer revisions strictly increasing by refusing to advance an exhausted or
  corrupted stored revision, including during membership-driven invalidation (#906).
- Replace manual ownership-transfer recovery SQL with a stopped-server command that checks the
  exact request and revision, takes an exclusive lock and records the cancellation for delivery (#996).
- Preserve distinct application namespaces while anonymising command-ledger rows so migration
  rehearsal copies cannot fail when applications share operation coordinates (#958).
- Refresh personal time off and company closures when the company week rolls over, so newly
  historical rows no longer remain visible until an unrelated page update (#902, #903).
- Treat confirmed allocation work as the implicit default in schedule popovers and accessible bar
  names, while retaining explicit annotations for tentative and completed work (#851).
- Keep the original retry identity when concurrent copies of the same account command include an
  unknown outcome, preventing a later retry from submitting a second semantic mutation (#942).
- Hide the previously open company's data when a newly selected company cannot load, and offer
  explicit retry or company-selection recovery actions (#945).
- Prevent simultaneous identity-email repairs from sharing an audit event ID and rolling back an
  otherwise valid administrator correction (#905).
- Emit a static Overview route document so direct links work on strict static deployments (#943).
- Make the managed-VPS deployment examples stop on build failures, limit Supervisor privileges to
  one installation's process group, and describe the initial pending backup health state accurately
  (#921, #933, #936).
- Use a subtle neutral grey for Overview Bar mode's unavailable cells and add 6px horizontal and
  vertical breathing room between cells for easier scanning (#963).
- Release an ownership-transfer step's retry handle (accept, withdraw, decline, cancel or complete)
  once the server reports that request already reached a terminal outcome, instead of letting a
  retry with the same identity replay the earlier terminal receipt (#908).
- Allow migration rehearsal copies to anonymise federated provider bindings when several
  applications use the same provider identifier (#904).
- Make the bare-metal installation select Node from the repository's `.nvmrc`, then run the
  systemd service from a root-owned copy of that verified binary, including upgrade and runtime
  checks (#931, #932).
- Scale Overview capacity bars against the company working days in each column, so people with
  different working patterns remain visually comparable (#890).
- Keep the Overview's ordered week-column headers compact across a year boundary, so the one
  cross-year week does not make the header row taller than its neighbours (#861).

### Changed

- Reorganise the documentation around quick start, technical installation, Owner setup,
  administration and day-to-day work, with a guided path from a fresh installation through team
  setup and ownership transfer (#841, #850).
- Document a backup-first, transactional operator procedure on its own runbook page for inspecting
  and cancelling an ownership-transfer request whose revision is corrupt or exhausted (#990, #997).
- Replace the browser favicon's lightning mark with a magnifying glass (#966).
- Local development and test servers now take their ports from a lane claimed for the duration of
  each command, so several checkouts can run the suites at the same time without colliding on a
  port or inheriting a crashed run's orphaned server. Each run also reserves a share of the
  machine's CPUs, which stops concurrent runs from each assuming they own every core. A single
  checkout keeps the ports it always had (#886).

## [0.67.0-alpha.1] - 2026-09-12

### Added

- Handing a company to someone else is a three-step ceremony again, replacing the one-click
  transfer that was removed. The Owner nominates another Admin, that person agrees, and only then
  does the Owner confirm the exchange — so nobody is made Owner without having said yes, and the
  Owner cannot be moved aside by a single mis-click. Either side can pull out until the moment it
  completes: the nominee can decline or withdraw an agreement, the Owner can cancel or nominate
  someone else, and a request that nobody acts on expires on a stated date. Team settings shows
  whose turn it is and why a previous attempt ended (#780).

## [0.66.0-alpha.1] - 2026-09-12

### Fixed

- Keep an allocation's length when it is dragged to someone with different working days: the
  duration is now measured against the working week it came from and re-placed in the new one,
  so a two-day booking stays two days instead of being re-read against the destination's calendar.
  The drag preview shows the resulting length before release (#338).

### Added

- Add a **Show totals** / **Hide totals** toggle to the Overview toolbar, hiding group header
  figures by default (#794).
- Add a **Bar** / **Bar & number** / **Number** capacity display toggle to the Overview toolbar,
  filling each cell from the bottom with free (green) or overbooked (red) capacity proportioned
  against that week's own availability (#795).
- Open a person's read-only schedule drawer from their avatar on Overview rows, using the same
  hover/focus-to-eye trigger and 28-day drawer as the Schedule (#790).

### Changed

- Rename "Capacity Overview" to "Overview" in the sidebar, page heading, table, settings and
  route (`/overview`); no redirect from the old `/capacity-overview` path (#791).

## [0.65.0-alpha.1] - 2026-09-12

### Fixed

- Restore importing and exporting after the account date-format change: the export schema version
  had moved ahead of the migration steps, so every import and export failed with an internal
  migration message (#866).

### Changed

- The date format is a company setting rather than a per-browser one, so everyone in an account
  reads the schedule in the same convention. An editor or above sets it in Settings → **Date
  format**; a viewer sees it, disabled. It applies immediately, without a reload, and it is part of
  the account — present in Export JSON and undoable like any other account change (#866). It never
  shipped as the device preference the Added entry below first described.

## [0.64.1-alpha.1] - 2026-09-12

### Fixed

- Highlight company closures the same way as personal time off when the schedule's draw mode is
  switched to Time off, instead of leaving the closure band unchanged (#787).
- Keep an allocation bar's label inside the part of the bar on screen, so a booking that started
  before the visible window is no longer unlabelled (#786).
- Show a company closure's name in the standard text colour and keep it centred in the part of the
  band on screen, so the closure stays named after scrolling a long list of people (#788).

## [0.64.0-alpha.1] - 2026-09-12

### Fixed

- Show both years on a date range that crosses one, instead of a repeated month that read as a
  single day (#819).
- Carry the year into the screen-reader names and the "series through" line for a booking or a
  time-off entry that crosses a year, so a spoken `28 Dec to 8 Jan` can no longer read as a range
  running backwards through the year (#793).
- Name the company-closure Edit and Delete buttons with the date range shown on the row they act
  on, so a voice-control user can speak what is on screen (#793).
- Reduced memory pressure during direct deployment builds by keeping test and build-tool type-checking
  in validation while checking only browser-shipped sources in `pnpm run build`.

- Keep schedule group headers above company closure shading (#766).
- Warn how many active allocations an activity archive would pull out of the schedule, matching the
  existing client and project archive copy (#805).
- Show a notice instead of failing silently when a member view is started while another start is
  already in flight, and show the generic persistence message instead of a raw internal error when a
  resource save fails through batch reconciliation (#806).
- Keep the archive confirmation on screen when the row stops being active while the dialog is open,
  instead of losing the page to an error (#817).

### Changed

- Ask for the password again only for high-impact administration — ownership transfer, resetting
  another member's password, revoking another member's sessions, company deletion, import/purge and
  SSO cutover/identity link and repair — and drop the re-prompt from invites, role and status changes,
  member removal, the sign-in-tracking toggle, masquerade start and internal-client adoption (#807).
- Default the sidebar to collapsed below 1024px viewport width so it no longer crowds the
  schedule on tablet-sized screens; a saved open/closed choice still wins (#792).
- Make company creation actions responsive and spaced, use equal-width week-start choices, and
  replace the overwhelming timezone select with a searchable browser-aware IANA combobox that
  presents local/common zones first and reflects daylight-saving abbreviations (#740).
- Clarify manual invitation delivery, keep the one-time link confirmation inline, and separate
  sign-in and account-creation journeys with fully readable permissions, local expiry and recipient
  email hints that hide the domain (#746).
- Clarify first-owner setup with the exact setup-token setting and secure handoff guidance, then
  continue directly to first-company creation without invitation guidance (#739).
- Keep Team & access member and invitation directories available as read-only information without a
  fresh-session prompt; require fresh confirmation only for initiated sensitive actions and name the
  action in that confirmation (#737).
- Rename Global working days to Company-wide working days, clarify company, personal and device
  preference scope, and group independent Placeholder and External visibility switches under
  Additional resourcing options. New companies now default to Days input with inline activity
  creation off (#743).
- Narrow the Schedule project filter choices to the selected client while retaining **All projects**
  and resetting incompatible project selections (#716).
- Explain every empty activity category and keep creation actions beside the Activities and Time off headings (#742).
- Open an individual's schedule from their avatar, with matching hover and keyboard-focus cues,
  and simplify drawer entries to a compact activity-first agenda (#753, #754).
- Make first-run setup-token pastes resilient to edge whitespace and reject invisible characters
  before request construction, without exposing token values in client logs (#738).
- Keep the Add person dialog open when a self-hosted save is rejected, and allow people whose
  optional Role is blank to persist (#736).
- Simplify resource add/edit forms with always-visible Studio/Supplementary choices, compact Start date and End date labels,
  and separators around the date group (#765).
- Collapse the repeated month in date ranges across the schedule, Capacity Overview, Time off and company
  closures: "9 – 14 Sep" rather than "9 Sep – 14 Sep" (#793).

### Added

- Move company ownership through a three-step consent ceremony in **Team & access**: the Owner
  nominates an Admin, the nominated Admin agrees, and the same Owner confirms. Nothing changes until
  all three have happened, either side can stop it, a request expires after seven days, and a request
  ends by itself if either participant's membership changes. Both participants — and nobody else —
  can see it, and a participant who was away learns how it ended (#780).

- Document deploying on a managed VPS platform such as Forge, Ploi or RunCloud (#734).
- Add a personal Account page for identity, password, MFA status and active sessions, linked beside
  the current-user control on every main page (#744).
- Add a privacy-safe Diagnostics card to Settings with a fixed allowlist of app and observable
  server health metadata that can be copied for support reports (#745).
- Add a Date format company setting, choosing between 9 Sep, 9th Sep, Sep 9 and Sep 9th (#793, #866).
- Expand first-run guidance into a persistent setup checklist with import-or-scratch choice,
  activity creation, company-settings review and direct links to each action (#741).
- Publish the documentation site to GitHub Pages after each tagged release or through a deliberate,
  manually triggered workflow (#752).
- Review free capacity, overload and unassigned demand across a fixed four-week Capacity Overview,
  with tentative and availability filters plus company-controlled role access (#722).
- Add an optional account-wide allocation **Task** field, with preserved text when the field is
  hidden and task details above Notes in schedule popovers and person drawers (#720).
- Add optional inclusive **Start date** and **End date** fields for Studio and
  Supplementary people. Capacity is zero outside a person's range while existing allocated work
  remains visible; new or placement-changing work cannot be placed outside the range (#723).

## [0.63.0-alpha.1] - 2026-09-10

This minor release adds a focused way to understand one person's near-term commitments without
losing the wider planning context.

### Added

- Open a read-only four-week schedule from the eye action beside any visible person's name.
- Review confirmed and tentative allocations, repeated work, hours, attribution, notes and eligible
  personal time off together, independently of the current grid dates and filters.
- Keep the underlying schedule exactly where it was while the drawer is open, including its dates,
  filters and scroll position, then return keyboard focus to the same person when it closes.
- Respect private client and project code names for non-owners, and limit personal time-off notes to
  owners and administrators in authenticated companies (#709).

## [0.62.1-alpha.1] - 2026-09-10

### Changed

- Made inline activity creation opt-in, aligned the Schedule filter controls, and sorted project
  choices and the Projects page consistently by client then project, including code names
  (#724, #712, #713, #718).

## [0.62.0-alpha.5] - 2026-09-10

CapacityLens Alpha 5 makes archived work easier to find and recover. This public milestone also
includes repeated personal time off, project attribution for shared activities and a read-only
member access preview introduced since Alpha 4.

### Added

- Find archived resources, clients, projects and activities directly below their usual lists.
  Owners and administrators can restore an accidentally archived item without searching Settings.
- Browse archived resources in familiar groups: **Archived Studio**, **Archived Supplementary** and
  **Archived External**, with archived placeholders kept separately when present. Empty groups stay hidden.
- Archive activities reversibly, just like the other planning data. Archived items offer **Restore**
  and **Delete**; deleted items remain in Settings during the 30-day retention period before permanent deletion.

## [0.61.0-alpha.1] - 2026-09-10

This minor release adds repeated personal time off as a complete planning flow, from preview to
independent saved entries on one schedule. It also hardens overlapping actions and updates
security-sensitive dependencies.

### Added

- Plan repeated personal time off with weekly, monthly-date or last-weekday patterns and preview
  every generated range before saving. One save creates a finite, all-or-nothing batch with one-step
  undo. The entries remain separately editable and deletable while appearing together on the
  person's single schedule row (#705).

### Changed

- Expanded the Time off guide with genuine screenshots that follow one repeat from its generated
  date preview to the individual saved entries and the person's combined schedule.

### Fixed

- Hardened imports, account updates, invitation signup, masquerade transitions, scheduler
  interactions and development launchers against overlapping actions and stale asynchronous
  completions.

### Security

- Updated transitive `browserslist` and `qs` dependencies to patched releases, resolving four
  denial-of-service advisories reported by OpenSSF Scorecard.

## [0.60.2-alpha.1] - 2026-09-07

### Added

- A code conventions page to the development reference covering function verbs,
  variable naming, parameter style and result shapes.

### Changed

- Lint now enforces identifier casing, rejects negated boolean names and caps functions at
  three parameters in the typed packages, with existing violations baselined in
  `eslint-suppressions.json` so the count can only fall.

## [0.60.1-alpha.1] - 2026-09-06

### Security

- Updated fastify to 5.12.3, resolving GHSA-w2qp-rph6-63g4 and GHSA-3m5p-2c4r-xxw2.

### Changed

- Updated direct dependencies to their latest patch releases, including Better Auth 1.6.30 and jose 6.2.12.

## [0.60.0-alpha.1] - 2026-09-05

### Changed

- Removed the structural-measurement tooling added in September 2026 (function budgets, exception ledger, shell and Vue metrics, source inventory) and kept the checks that protect the code; see DECISIONS.md.

### Fixed

- Update toast notifications to Sonner 2.0.8 while retaining the CSP-compatible stylesheet patch,
  restoring dependency update checks and incorporating upstream notification fixes.

## [0.59.1-alpha.1] - 2026-09-05

### Changed

- Separate the migration rehearsal ledger, anonymiser and checks from the command-line driver,
  with direct tests for schema coverage and anonymisation helpers.

### Fixed

- Migration rehearsal failed closed for databases newer than schema v16 because the anonymiser
  ledger lagged the schema.

## [0.59.0-alpha.1] - 2026-09-04

Maintainability release: every non-test source file in the app, server and shared packages is now
at most 400 lines, enforced by a ratcheting gate. No user-visible behaviour changes; the public
module paths, HTTP contracts, database schema and released migrations are unchanged.

### Added

- A file-size gate in both `pnpm run gate` and `pnpm run gate:server` fails any non-test source
  file over 400 lines. Temporary exceptions live in `scripts/file-size-exceptions.json` with a
  frozen baseline per file; the list ratcheted from 45 entries to zero during this release and only
  the shadcn-generated sidebar remains as a permanent exception.
  — 2026-09-04
- The account-boundary conformance test resolves imports to files before directories, follows
  runtime re-exports, checks `controlTables` importers by resolved dependency rather than by file
  name, denies the identity, admin-port, control-table and auth-config directories to the account
  coordinator as whole directories, and bans direct imports of any account-state sub-module, with
  calibration cases for each rule.
  — 2026-09-04
- An import-cycle gate in both `pnpm run gate` and `pnpm run gate:server` fails on any runtime
  import cycle between source modules; type-only imports are ignored. The tree has zero such cycles.
  — 2026-09-04
- Focused tests for every newly extracted module that had none, including seed-factory isolation,
  per-port compensation-key isolation, persistence overlap, scheduler grid row identity, and the
  boot refusal helpers.
  — 2026-09-04

### Changed

- Forty-five oversized modules were decomposed into focused files behind their original paths, so
  every existing import keeps working: shared domain (`lifecycle`, `mutations`, `sanitizeImport`,
  `seed`, `migrate`, entity helpers), scheduler model, toolbar, grid, allocation modal and gesture
  hooks, common form fields, command palette, store internals and types, auth provider and login
  screen, settings and account picker, invite acceptance, account client, offline cache, server
  sync adapter, persistence, and on the server `db`, `controlTables`, `app`, `auth`,
  `strictOidc`, the identity and account-admin ports, account flows and routes, batch and
  account-entity routes, `audit`, `validate`, `backup`, `schema`, `tables`, and account state.
  — 2026-09-04
- The server's environment-variable reference moved from a comment block in `server/src/index.ts`
  to the self-hosting configuration guide.
  — 2026-09-04
- Ownership allowlists in the conformance test name the exact implementation files that now carry
  identity and membership SQL, and the crypto inventory follows every moved primitive.
  — 2026-09-04
- Facades no longer value-import from their own sub-modules: shared constants and helpers moved
  into leaf modules so every split is free of the ESM initialisation-order hazard.
  — 2026-09-04
- The file-size gate enumerates tracked files through Git, so an untracked scratch file can no
  longer fail it.
  — 2026-09-04

## [0.58.0-alpha.1] - 2026-09-02

Consolidation release for member masquerade: the feature shipped in 0.57.0-alpha.19 has been
reviewed and simplified end to end, and the two transition bugs that surfaced in review are fixed.

### Fixed

- Switching company while a masquerade start is still in flight now reports "Wait for the current
  masquerade transition to finish." instead of silently doing nothing.
  — 2026-09-01
- Ending a masquerade that another tab has already replaced re-adopts the newer masquerade and no
  longer navigates away from the current page.
  — 2026-09-01

### Changed

- Masquerade start and end failures now surface the server's own error sentence in the notice
  rather than a bare HTTP status.
  — 2026-09-01
- The account list, whole-state read and masquerade status endpoints resolve the masquerade
  projection once per request instead of once per membership, and masquerade status no longer
  loads the full member directory to name the target member.
  — 2026-09-01
- Masquerade audit events flow through the same durable outbox path as every other account event,
  so their outbox ids equal their event ids.
  — 2026-09-01
- Account activation in the app goes through a single entry point that ends any active masquerade
  before switching, so a future account-switch surface cannot bypass that guarantee.
  — 2026-09-01

## [0.57.0-alpha.19] - 2026-09-01

### Added

- Owners and Admins can open a server-enforced, read-only view of another active member's account
  access from Team & access, with a persistent status bar, audited lifecycle and automatic end on
  account switch or session invalidation.
  — 2026-09-01

## [0.57.0-alpha.18] - 2026-08-24

### Fixed

- The migration preservation oracle now refuses a populated column that a migration drops without
  an explicit, reviewed approval — previously the disappearance was skipped silently, so rehearsal
  could certify an upgrade that discards stored values. The entire released chain passes unchanged.
  — 2026-08-24

### Fixed

- Narrowed the audit-recovery degradation latch to genuinely malformed lines: a well-formed line
  without an auditId is skipped silently again (records may legitimately omit delivery metadata),
  so ordinary rotation and id-less records no longer trip degraded health.
  — 2026-08-23

### Fixed

- Frozen-account-field documentation corrected: the batch path returns the same 409 as the direct
  routes (CONFLICT via statusForAccountFailure), not a 400.
  — 2026-08-23

### Fixed

- Invite documentation corrected: the raw token is never stored — only its hash is persisted, and
  the hash (not the raw token) is the invites table's primary key.
  — 2026-08-23

### Fixed

- Selecting an unknown company while already on the account picker now shows the not-found notice
  instead of failing silently (the picker-to-picker case detected no "switch").
  — 2026-08-23

### Fixed

- The codified restore drill now mirrors the runbook's actual restore sequence (temporary copy,
  mode/owner verification, atomic rename, sidecar removal) instead of a plain overwrite, so the
  procedure operators run is what CI continuously verifies.
  — 2026-08-23

### Fixed

- The shared package's exports test anchors its package manifest on the test file's own location,
  so the package's own `pnpm test` works from any working directory.
  — 2026-08-23

### Fixed

- Principal-wide session revocation now sweeps session-assurance rows after the provider revocation
  completes, so a sign-in landing inside the revocation window can no longer leave orphaned
  assurance for an already-revoked session.
  — 2026-08-23

### Fixed

- A failing foreign-keys cleanup PRAGMA during database initialization no longer masks the original
  init failure; the cleanup error surfaces only when initialization itself had succeeded. (Covers
  both review findings DBR-0011 and DBR-0014, which share this root cause.)
  — 2026-08-23

### Fixed

- The stdout audit stream is now retry-idempotent: when a sibling destination fails and the outbox
  redelivers, already-emitted records are no longer re-printed, so a file-sink failure no longer
  amplifies duplicate stdout copies on every drain.
  — 2026-08-23

### Fixed

- Allocation edits clamp hours/day through the shared clamp BEFORE domain validation, so an
  over-day drag-resize lands on 24 like creation and import instead of being rejected; the
  external-resource zero-load rule still rejects after clamping.
  — 2026-08-23

### Fixed

- Account PUT/DELETE audit records are now always attributed to the mutated account's own id; a
  caller-supplied accountId (body assertion or query parameter) can no longer choose which tenant's
  ledger records the mutation.
  — 2026-08-23

### Fixed

- PATCH /api/accounts/:id now rejects a body asserting another account's accountId with the same
  404 the PUT route returns, instead of silently ignoring the claim.
  — 2026-08-23

### Fixed

- Scalar membership-role readers now surface a stored-but-unreadable role as control-table
  corruption instead of silently degrading the membership to "no role" (genuine absence and legacy
  non-active rows still return null).
  — 2026-08-23

### Fixed

- Quarantined the shared SQLite handle when a ROLLBACK fails while the transaction remains active,
  so no later write can be acknowledged outside a durability boundary; the original error and the
  rollback failure are both still surfaced.
  — 2026-08-23

### Fixed

- Audit recovery now surfaces a complete malformed or auditId-less JSONL line by latching degraded
  health and logging one redacted line, instead of silently accepting file corruption; affected
  outbox rows replay (the safe direction).

### Changed

- Made the allocation guide's Internal, All-projects and Project-specific activity model explicit,
  with real allocation-form screenshots showing where each kind is available.

## [0.57.0-alpha.2] - 2026-08-23

### Fixed

- Hardened the vitest setup's `localStorage`/`sessionStorage` pinning so the suite passes on Node
  releases shipping the experimental global storage accessor (Node >= 25), not only the pinned
  Node 24 gate.

## [0.57.0-alpha.1] - 2026-08-19

- Protected `main` against deletion and force pushes while retaining the low-noise post-merge CI
  model, remediated the known dependency advisories without audit exceptions, and made packaged
  builds, SPDX SBOMs and recognized provenance bundles part of every published release.

### Fixed

- Saving several changes at once now applies them strictly in order: a booking attributed to a
  project after its activity was changed back to **All projects** in the same save keeps that
  attribution instead of silently losing it.
- Re-attributing a booking while an earlier save is still in flight no longer discards that edit
  when the server's reply arrives; the edit is kept and saved with the next change.
- Changing an activity's kind away from **All projects** no longer fails with a spurious
  "changed while you were editing" conflict when its bookings carried project attribution.
- A booking whose activity record is missing no longer appears under the Internal client filter.
- A saved edit that changes an activity's kind can no longer leave one of its bookings attributed
  to a project, whatever order the changes reach the server in, and other sessions now learn about
  bookings the server un-attributes on its own.
- Creating an activity inline in the allocation dialog now places it inside its group instead of
  splitting the list with a duplicate group heading.
- Other sessions no longer hit spurious "changed while you were editing" conflicts after the
  server un-attributes bookings during an activity kind change - the save receipt now carries
  those rewrites and every session applies them.
- Editing a placeholder's booking whose activity record is missing opens in the placeholder's
  bound project again instead of the Internal scope.

- Reassessed alpha4 against OWASP ASVS 5.0.0, the OWASP Top 10 and API Security Top 10; refreshed
  the threat model and security control inventories, recorded the fixed session/OIDC findings, and
  reconciled all 345 ASVS controls with current source and verification evidence.

### Changed

- **Installation docs now start with the deployment choice.** Docker Compose and direct
  Node 24 installation are presented as separate, supported routes, and Docker is no
  longer described as a general prerequisite.

## [0.56.0-alpha.1] - 2026-08-19

### Changed

- **Shared activities can count towards real projects.** An **All projects** activity can be booked
  under any project; each allocation keeps that attribution for labels, colours, filters, repeat
  series and lifecycle changes, while **No specific project** remains an unattributed option.
- Renamed **Cross-project** activities to **All projects** throughout the product and documentation.

## [0.55.0-alpha.4] - 2026-08-17

Alpha 4 brings the capacity-model, closure and schedule-control work completed since the Alpha 3
milestone into one supported prerelease, on top of a codebase-wide simplification pass.

### Added

- **Book whole-agency closures once.** Bank holidays and shutdowns are recorded as first-class
  company closures from their own Time off section, drawn as a single named schedule band across
  every person and placeholder, new hires included. Availability drops to zero on those dates while
  allocation dates and hours are left alone, so planned work raises the ordinary red conflict
  instead of quietly disappearing.
- **Read half days at a glance.** A half working day tints the bottom half of its schedule cell at
  fine zoom and is called out in the accessible row summary, without changing how allocations are
  created.

### Changed

- **Company working days now govern capacity.** A person's effective week is the company's global
  working days intersected with their own pattern, and normal allocations schedule, load and count
  utilisation only on those days. Changing the selection reinterprets existing work — stored dates
  never move, while capacity, utilisation and conflicts recalculate. New work must start on an
  effective working day, **Ignore working days** remains the per-allocation escape hatch, and the
  company selection can no longer be emptied.
- **Placeholders behave like the capacity they stand in for.** They follow the company's working
  days at full-day capacity rather than carrying a separate personal pattern, and their form no
  longer shows fields they cannot use.
- **Allocation hours are four clear day fractions.** Free-form hourly entry is replaced by explicit
  choices led by their hour values; existing allocations whose stored hours fall outside those
  choices are preserved.
- **The schedule is quicker to drive.** The filter bar is ordered search-first with an explicit
  Show/Hide control for tentative work, aligned on one size scale, hiding the discipline filter
  until a discipline exists. The sidebar, toolbar, filter bar and data canvas sit on distinct depth
  tiers in both themes, and segmented controls divide into exactly equal cells.
- **Forms use the room they have.** Allocation scheduling controls, time-off dates, activity kinds,
  privacy explanations, working-day tables and short text fields all follow the same responsive
  layout rules at normal and narrow widths.
- **The documentation shows the current product.** Guides gained visuals for closures, working-day
  guards, device-only schedule preferences, the repeat cue and day-fraction choices, and every
  product screenshot is now captured in the light theme.
- **The whole codebase went through a simplification pass** — domain core, client utilities, data
  and store layers, scheduler, settings, shared components, authentication and the server account
  boundary — with wire formats, audit actions, SQL schema and error text unchanged.

### Fixed

- **Conflicts stay visible where capacity is zero.** Blocks overlapping time off take the red
  conflict marker and accessible summary, and vertical reassignment rejects personal or company
  non-working start dates unless **Ignore working days** is set.
- **Dragging tracks the pointer.** Vertical dragging no longer lags behind an animation, and the
  schedule's add hint no longer reappears in a stale column after a drag.
- **Damaged data no longer takes the schedule down.** Legacy or malformed allocation-status and
  time-off-type values are handled rather than crashing the view.
- **Smaller correctness repairs.** Offline-snapshot retention is enforced on every cache
  connection, keyboard shortcuts respect non-editable regions nested in editable content, purge
  deadlines more than ~25 days out unlock at the boundary, and the full "Project-specific" activity
  label stays visible in Firefox.

### Security

- Password fields in the security section cap input at 256 characters, and the archived section no
  longer requests inactive account data for roles that cannot purge it — the server rejection is
  kept as the backstop.

## [0.54.0-alpha.1] - 2026-08-17

### Added

- Replaced the hidden Everyone time-off choice with first-class company closures: a dedicated
  Time off section and form, plus one named schedule band covering every person and placeholder
  across each literal inclusive date span (#407).

### Changed

- Pre-existing company-wide time-off entries are not carried over to first-class company closures (#407).
- Led allocation hours-per-day options with their hour values for quicker comparison (#398).
- Reordered the schedule filter bar around search-first filtering and replaced the tentative checkbox
  with an explicit Show/Hide segmented control (#406).

### Fixed

- Placed the Start and End fields together on one full-width row in the time-off modal (#404).
- Hid unusable Discipline fields from resource forms and removed presumed company working-day
  guidance from placeholder forms (#394).
- Aligned the schedule filter bar vertically and standardised its controls on the small size scale;
  the discipline filter now stays hidden until at least one discipline exists (#405, #406).

## [0.53.7-alpha.1] - 2026-08-17

### Changed

- Standardised product screenshots on the light theme and refreshed authenticated app-shell
  captures after the latest navigation and schedule depth changes (#374).

## [0.53.6-alpha.1] - 2026-08-17

### Changed

- Expanded the user guides with Everyone time-off visuals, device-only schedule
  preferences, the allocation repeat cue, the hourly day-fraction select and a clearer
  explanation of company-wide calendar choices that are frozen after creation (#375).

## [0.53.5-alpha.1] - 2026-08-17

### Changed

- Clarified working-day documentation with a concrete company-and-person example, the calendar
  behaviour of placeholders and external parties, and screenshots of both entry-point guards
  (#376).

## [0.53.4-alpha.1] - 2026-08-17

### Changed

- Replaced free-form hourly allocation entry with four clear day-fraction choices while preserving
  existing allocations whose stored hours do not match those choices (#378).

## [0.53.3-alpha.1] - 2026-08-17

### Fixed

- Gave the allocation modal's scheduling controls the full row width, with equal columns at normal
  widths and a stacked layout on narrow screens (#377).

## [0.53.2-alpha.1] - 2026-08-16

### Changed

- Gave the schedule distinct sidebar, toolbar, filter-bar and data-canvas depth tiers in both
  themes, with controls seated on a consistent raised or inset surface (#379).

### Fixed

- Reworked segmented controls with concentric size-specific radii, stable reserved borders and
  explicit gapped or connected layouts; full-width groups now divide into exactly equal cells (#380).

## [0.53.1-alpha.1] - 2026-08-16

### Changed

- Placeholders now follow the company's working days and always use full-day capacity (#382), rather than
  carrying a separate personal working pattern. Their resource form shows the company days as
  read-only guidance and directs changes to Settings.

## [0.53.0-alpha.1] - 2026-08-16

### Added

- Company-wide time off (#372): the time-off form's assignee picker gains an **Everyone** option
  that records one closure — a bank holiday or whole-agency shutdown — covering every
  capacity-tracked person and placeholder, new hires included. On affected dates availability is
  zero while allocation dates and hours are untouched, so planned work flags the existing red
  conflict instead of silently disappearing; personal and company overlap counts once, and days
  that are also recurring non-working days stay grey with the closure marker. Everyone entries
  allow only holiday/other (imports repair other values), render first in the time-off list with
  per-row type labels, and gate new-allocation starts for every resource — externals included,
  though their rows still draw no time-off. Ignore working days never bypasses a closure.
  Stored data widens `TimeOff.resourceId` to nullable (export schema v16, database schema v33
  with a preserving table rebuild).

## [0.52.0-alpha.1] - 2026-08-16

### Changed

- Global working days now govern capacity (#257). A person's effective working week is the
  company's global working days intersected with their personal pattern (external parties use the
  company set verbatim): normal allocations schedule and load hours only on effective days,
  Days/Blocks spans count their length in effective days, and utilisation excludes non-effective
  days from both sides of the ratio. Changing the selection reinterprets existing allocations —
  stored dates never move, while capacity, utilisation and conflicts recalculate. **Ignore working
  days** remains the per-allocation escape hatch (calendar-day span; never bypasses time off), and
  a company non-working day that an allocation used to load now shows no work instead of a red
  conflict unless that override is on.
- New allocations must start on an effective working day: creation (click/draw and typed dates),
  duplication and reassignment all reject non-effective starts, with no override at creation —
  closed-day work is reached by creating on an open day with Ignore working days ticked, then
  dragging or extending onto closed days. Repeat batches still generate later occurrences on
  non-effective days and count them in the batch advisory. Edits to existing allocations stay
  permissive, though a person with no effective days cannot have their normal allocations moved
  or resized until a working day returns.
- The company working-days selection can no longer be emptied: Settings disables the last checked
  day with a visible explanation, the store rejects an empty week, and empty or malformed stored
  selections repair to the week-start default at every boundary (import, server write, startup).
  The Settings copy now states the real contract and warns that changing the selection
  recalculates existing allocations.

### Fixed

- Prevented the schedule lane’s add hint from reappearing in a stale column after a drag.
- Enforced the seven-day offline-snapshot retention boundary on every cache connection.
- Prevented legacy or damaged allocation-status and time-off-type values from crashing the schedule.
- Kept the full “Project-specific” activity-kind label visible in Firefox at desktop and narrow
  dialog widths.

## [0.51.1-alpha.1] - 2026-08-15

### Changed

- Simplified the Playwright e2e suite (#352) with coverage and assertion strength unchanged or
  strictly stronger — no test deleted or merged, selector text and asserted strings identical:
  - Promoted verbatim copy-paste blocks into the existing helper files: `resetSchedulerScroll`
    (the scheduler-grid `scrollLeft = 0` reset, 26 sites across 13 files), `bootstrapOrg` (the
    org-bootstrap POST + 201 assertion, 8 sites), `dismissLandscapeHint` (6 sites;
    `mobile.spec.ts` untouched since it tests the gate itself), `boundingBoxOrThrow` (4 local
    `box()` copies), and `showPlaceholders` (5 sites; `placeholders.spec.ts` keeps its inline
    toggling because it asserts the toggle's own behaviour).
  - Adopted existing helpers at hand-rolled sites: `dismissIntroIfPresent` in
    `navigation.spec.ts` and the two auth specs' local `signInAndOpen`s, `showScheduleFilters`
    in `getting-started.spec.ts`, and `db-helpers.ts`'s now-exported `API` constant in two db
    specs.
  - `a11y.spec.ts`: folded the ten identical violation-filter + assert blocks into `settledAxe`
    and deleted five fixed sleeps it makes redundant (`disableCssMotion` already snaps
    animations to their end state); the two virtualization-settling waits are untouched.
  - Parallelized independent test-user sign-ups (`Promise.all`) in four auth specs.

### Fixed

- CI gate: added unit coverage for the account-flow operation vocabulary
  (`shared/src/account/ports.ts`), which 0.51.0-alpha.1 turned from a types-only file into one
  with executable code, tripping the wholly-untested-module coverage check.

## [0.51.0-alpha.1] - 2026-08-15

### Changed

- Simplified the account boundary (`server/src/accounts` + `server/src/routes`, ~15k lines) with
  no behaviour change (#351), applied findings-first with four independent review angles and
  independent arbitration on contested items:
  - `accountRoutes.ts`: an `auditUnlessReplayed` helper replaces ten copy-pasted
    audit-after-flow sites, and shared `authorizeMemberMutation` / `requireMembership` guards
    replace six duplicated role-check blocks; the account-flow operation list moved to the
    shared contract (`ACCOUNT_FLOW_OPERATIONS` beside the existing `ACCOUNT_ROLES` idiom) and
    the single-company-cap message is single-sourced in the shared account policy.
  - `localAccountFlows.ts`: the workspace-erasure snapshot→lock→re-snapshot bounded-retry
    algorithm, duplicated in two places, is extracted once with each call site's
    `commandId` reporting preserved; both hand-rolled transaction catch blocks route through
    `persistTerminalOutcome`; the single-company-cap decision is shared between the two
    provisioning entry points with the original in-transaction write order kept byte-identical.
  - Identity ports: all 21 table-existence probes reuse auth.ts's cached
    `cachedTableExists` idiom; the compensation-handle check reuses the existing constant-time
    `secretTokenMatches`; the operation-receipt builder is single-sourced in
    `accountFlowRuntime.ts` and adopted by all three ports.
  - `state.ts`: the session-authentication SELECT (every authenticated request) uses a
    per-handle cached prepared statement via a module-local cache that keeps the
    coordinator/control-table architecture boundary intact; a provably dead reconciliation
    branch is deleted; `normalizedTableCreateSql` is extracted and reused by the
    sign-in-tracking schema assertion.
  - Entity/lifecycle/SSO routes: the triplicated ownsRow/frozen-fields/stale-write guard
    sequence in entity PUT/PATCH is collapsed into `accountWriteGuards` (PUT's interleaved
    replay attempt kept in place); two byte-identical strict-provider guards in the frozen SSO
    cutover flow extracted mechanically; email normalization goes through the shared
    `normalizeAccountEmail` everywhere.
  - `sqliteAccountAdminPort.ts`: `listMemberships` no longer issues one security-revision
    query per member — revisions are batched with the repository's existing 500-item `IN`
    chunking pattern (five new tests pin ordering, defaults, empty lists and the chunk
    boundary); a redundant workspace-existence double-check in invitation creation is removed.
  - Conformance suites deduplicated (shared db setup, port/command factories, a `deferred()`
    latch, an `it.each` merge) with the test count unchanged at 110.

  Wire formats, API bodies and status codes, audit action strings, SQL results, transaction
  and lock ordering, and error text are all unchanged; the intentionally-divergent invitation
  claim flows and the persisted-hash helper trio were left separate on purpose.

## [0.50.0-alpha.1] - 2026-08-15

### Changed

- Simplified the flat `server/src` root directory (~42k lines) with no behaviour change (#350),
  applied findings-first with four independent review angles and a final arbitration:
  - Hot read/write helpers (`upsertRow`, `getRow`, `loadState`, `readSlice`, membership-role
    lookups, audit-outbox drain, sync-ordering checks) now reuse per-handle cached prepared
    statements instead of re-preparing identical SQL on every call, following the existing
    `WeakMap<Db, …>` idiom; `initializeOpenDb` drops a handle's cache before returning, since
    node:sqlite statements freeze their column set at prepare time and migrations are the only
    schema-change boundary.
  - Migrations 9, 16 and 27–32 share one `tableHasColumns` guard; `hasColumn` is exported from
    the schema module and reused by the control-table checks.
  - The per-account read now derives both gated-field redactions (time-off note, private names)
    from the same `GATED_FIELD_POLICIES` catalogue the write-pin and export paths already use.
  - Route-layer dedup in `app.ts`: shared audit-record builder, SQLite constraint-collision
    predicate, cached table-existence checks, password-queue backpressure wrapper, and the
    `/api/batch` changed-count now derived from the audit records (one new test pins the
    same-batch re-archive case).
  - `secretTokenMatches` and `isLoopbackHostname` are exported once and reused (mechanical
    dedup only; strict-OIDC flow untouched).
  - Leaf-module cleanups across 16 files: dead code removed; erasure's cross-tenant edge SQL
    generated from tenantIntegrity's canonical relationship list (inline snapshot pins the
    text); shared audit-event builder for the cutover-repair literals; `tenantStore`'s
    related-allocations N+1 collapsed to one query and the admin row-count probe to one
    UNION ALL; backup's duplicated snapshot-verify sequence extracted with each call site
    keeping its own failure semantics; work-queue waiting-list removal narrowed into one
    helper with two new dequeue-boundary regression tests.

  Wire formats, audit action strings, SQL schema, transaction ordering and error text are
  byte-identical; JSON export and SQLite database schema versions are unchanged.

## [0.49.0-alpha.1] - 2026-08-15

### Changed

- Simplified the authentication and account-client layer (`src/auth`, `src/account`) with no
  behaviour change (#349):
  - The auth context value is now memoised (matching the sibling permission context), so the
    authenticated shell no longer re-renders on tab focus/visibility revalidation when the
    session status is unchanged.
  - The OIDC/social provider sign-in dispatch shared by the login screen and the step-up
    re-auth dialog now lives in one helper (`dispatchExternalProviderSignIn`) with focused
    tests pinning the exact Better Auth arguments; both callers keep their own error and
    busy-state handling.
  - The external sign-in error → message mapping, provider duplicate-identity check, and the
    team-access client's success-body decoding each collapsed onto one shared home instead of
    two copies.

## [0.48.0-alpha.1] - 2026-08-15

### Changed

- Simplified the small feature-component layer (accounts, invites, resources, activities,
  projects, clients, time off, disciplines, team, external, import-export) with no behaviour
  changes: extracted the stale-edit check duplicated across all seven entity forms into a shared
  `isStaleEdit` helper; deduplicated the delete-confirm error path shared by three lists behind a
  small hook; memoised per-render option rebuilds in the entity forms and the create-company
  timezone list (~400 locale-formatting calls per keystroke previously), keeping locale-sensitive
  labels render-scoped; memoised the resource/project/client/discipline list partitions and sorts;
  narrowed a whole-store subscription in the delete-company dialog to an event-time read; and made
  four unimported view-model types module-internal (#348).

## [0.47.0-alpha.1] - 2026-08-15

### Changed

- Simplified the shared component layer (`src/components/common` + unpinned `src/components/ui`
  files) with no behaviour changes: extracted the field-layout prop derivation duplicated across
  all nine form-field components into one helper; removed the unused `TextAreaField` component and
  its tests; routed the crash-recovery reload button through the existing `reloadPage` seam;
  memoised the avatar badge (recomputed per scheduler row on every grid re-render) and hoisted a
  static segmented-control class string; and replaced the colour field's linear palette scan with
  a precomputed index lookup (#347).

## [0.46.0-alpha.1] - 2026-08-15

### Changed

- Simplified the settings component layer (`src/components/settings`) with no intended behaviour
  changes beyond the three flagged below: extracted shared hooks for deadline-driven re-renders
  (`useDeadlineClock`) and double-click-safe exclusive actions (`useExclusiveAction`); moved the
  member-role edit predicate into the shared account policy (with full role-matrix equivalence
  tests); adopted the canonical per-account store selectors in the settings view; consolidated
  duplicated member-action envelopes, rejection-message fallbacks, option tables, timestamp
  formatting, OIDC-provider selection, and page-reload seams behind shared helpers; merged the
  archived section's two confirmation dialogs and near-identical group renderings; and
  consolidated the members test suite behind a shared route-table mock (net −360 test lines,
  assertions unchanged) (#346).
- The archived section no longer fetches the account's inactive data for roles that cannot purge:
  the request previously always fired and was rejected server-side; it is now gated client-side
  with the server 403 kept as backstop (#346).
- Purge deadlines more than ~25 days out now enable the purge action at the boundary; previously
  a timer overflow guard meant the row stayed locked until an unrelated re-render (#346).
- Password fields in the security section now cap input length at 256 characters (previously
  unbounded) (#346).

## [0.45.0-alpha.1] - 2026-08-14

### Changed

- Simplified the scheduler component layer (`src/components/scheduler`) with no behaviour changes:
  merged the duplicated external/internal day-state build paths behind an explicit capacity-source
  seam (verified by differential fuzzing — 182,370 day states, zero mismatches); moved derived
  column facts (weekdays, per-day mode, scroll-index rounding) onto the shared geometry object;
  collapsed the grid's per-field store subscriptions and the toolbar's repeated option derivations;
  extracted pure allocation-draft validation, a shared date-overlap helper, and a locale-aware
  short-date formatter; merged the allocation modal's create/edit render arms; and consolidated
  scheduler test fixtures behind shared factories (net −508 test lines, assertions unchanged)
  (#345).

### Fixed

- Restored the `0.43.0-alpha.1` release heading below, which was accidentally dropped from this
  changelog during the `0.44.0-alpha.1` release edit.

## [0.44.0-alpha.1] - 2026-08-14

### Changed

- Simplified the client data layer (`src/data` + `src/store`) with no behaviour changes:
  extracted shared row-key, batch-receipt, and FK-descriptor helpers in the sync adapter (with a
  compile-time completeness witness for account-scope edges); single-pass sync-op application and
  revision pruning; throttled the offline-cache expiry sweep and deduplicated its IndexedDB
  transaction plumbing; table-driven store cascades, tenant-boundary resets, and account selectors;
  shared weekday validators in the domain core; and removal of dead exports and test-only
  selectors (#344).

## [0.43.0-alpha.1] - 2026-08-14

### Changed

- Simplified the client utility layer (`src/lib` + `src/hooks`) with no behaviour changes:
  deduplicated capacity, gesture, fuzzy-search, and label helpers; faster weekday, capacity-window,
  and repeating-allocation paths; table-driven i18n label and error-message lookups; and removal of
  dead exports (#343).

## [0.42.0-alpha.1] - 2026-08-14

### Changed

- Simplified the shared domain core (`shared/src`) with no behaviour changes: deduplicated
  validation, lifecycle, and colour helpers; table-driven migration steps and import sanitising;
  faster active-ancestry, weekend, and colour-contrast paths; and removal of dead exports (#342).

### Fixed

- Vertical allocation reassignment now rejects personal or company non-working start dates unless
  **Ignore working days** is enabled, and vertical dragging follows the pointer without an animation
  delay (#336, #337).

## [0.41.9-alpha.1] - 2026-08-12

### Changed

- Documentation now illustrates the latest compact forms and Settings layout, half-day schedule
  cues, and time-off conflict markers with current product screenshots.

## [0.41.8-alpha.1] - 2026-08-12

### Changed

- Global working days now use a compact two-row weekday table in the company's configured week order
  (#317).

## [0.41.7-alpha.1] - 2026-08-12

### Changed

- Time-off notes now use the same compact single-line input as the other short form fields (#309).

## [0.41.6-alpha.1] - 2026-08-12

### Fixed

- Client and Project privacy explanations now sit with their controls in the right-hand form column
  (#307).

## [0.41.5-alpha.1] - 2026-08-12

### Changed

- Allocation create/edit forms now match the other product modals with responsive 25/75
  label-to-control rows, contained compound controls and aligned supporting hints, without changing
  allocation values or behaviour (#306).

## [0.41.4-alpha.1] - 2026-08-12

### Fixed

- The Activity Kind control now fills its form column with three equal-width options at normal and
  narrow widths.

## [0.41.3-alpha.1] - 2026-08-12

### Added

- Half working days now tint the bottom half of their schedule cell at fine zoom and are included
  in the accessible row summary, while preserving full-cell allocation creation (#316).

## [0.41.2-alpha.1] - 2026-08-12

### Fixed

- Allocation forms now label the calendar-day override as **Ignore working days**, accurately
  describing that it includes every personal non-working weekday while preserving existing
  allocation data and behaviour (#313).

## [0.41.1-alpha.1] - 2026-08-12

### Fixed

- Blocks that overlap a person's time off now receive the schedule's red conflict marker and
  accessible row summary while continuing to contribute zero hourly capacity and utilisation
  (#305).
- Keyboard shortcuts now respect non-editable regions nested inside editable content.

## [0.41.0-alpha.3] - 2026-08-12

Alpha 3 brings the planning, team-management and production-reliability work completed since the
Alpha 2 milestone into one supported prerelease.

### Added

- **Plan recurring work as a series.** New allocations can repeat weekly, every two to four weeks
  or monthly up to an explicit cutoff date. The form previews the batch, the schedule identifies
  repeated work, and deleting one occurrence can remove either that item or the rest of its series.
- **Model real working patterns.** Companies can choose their global working days, while each person
  has an explicit Full day, Half day or Not working choice for Monday through Sunday. Capacity uses
  a predictable 8/4/0-hour model and blocks new work from starting on unavailable days or time off.
- **Organise people the way agencies work.** People can be grouped into Studio and Supplementary
  teams, marked as favourites and ordered consistently. Discipline views retain useful fallbacks
  for unassigned people, and external partners remain clearly separated.

### Changed

- **The schedule is faster to read and control.** Filters start out of the way, follow the same
  order as the planning grid and can be cleared in one action. Date headings, zoom boundaries,
  selection states, pressed feedback and allocation guidance are clearer without crowding the
  working view.
- **Everyday management is easier to scan.** Resources, disciplines, clients and projects are
  alphabetical; activities and current/future time off are grouped meaningfully; forms use compact,
  consistent layouts; and Settings keeps detailed explanations available on demand.
- **Team access has safer day-to-day controls.** Owners and administrators can disable, archive,
  restore and remove members, optionally confirm whether someone has signed in, revoke sessions and
  issue reset links without weakening server-side permissions.
- **The documentation now shows the product as well as describing it.** Expanded visual walkthroughs
  cover schedule filters, unallocated people, Studio/Supplementary choices, grouped lists, working
  patterns, Settings and the main planning flow.

### Fixed

- **Saved planning choices now remain saved.** Fresh server-backed sessions preserve engagement and
  half-day values instead of replacing them with legacy defaults.
- **Bookmarks and browser refreshes work in production.** Fixed application routes and arbitrary
  extensionless paths return the application shell while genuine missing assets, files and API
  requests remain real 404s. Single-company sign-ins also resume the requested page automatically.
- **Capacity conflicts remain visible.** Work scheduled during time off keeps its red over-capacity
  warning above the holiday treatment, and filters, forms and working-day layouts retain their
  expected state at narrow and wide sizes.

### Security

- Expanded the self-hosted sign-in and recovery paths with strict OIDC cutover tooling, a deliberate
  sole-Owner password-recovery command, identity-global session controls and stronger automated
  security, migration and cross-browser verification.

Releases before 0.41.0-alpha.3 are in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).

[Unreleased]: https://github.com/Kevinjohn/capacitylens/compare/v0.73.0-alpha.1...HEAD
[0.73.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.72.0-alpha.1...v0.73.0-alpha.1
[0.72.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.71.0-alpha.1...v0.72.0-alpha.1
[0.71.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.70.1-alpha.1...v0.71.0-alpha.1
[0.70.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.68.0-alpha.1...v0.70.1-alpha.1
[0.70.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.69.0-alpha.1...v0.70.0-alpha.1
[0.69.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.68.0-alpha.1...v0.69.0-alpha.1
[0.68.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.67.0-alpha.1...v0.68.0-alpha.1
[0.67.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.66.0-alpha.1...v0.67.0-alpha.1
[0.66.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.65.0-alpha.1...v0.66.0-alpha.1
[0.65.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.64.1-alpha.1...v0.65.0-alpha.1
[0.64.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.64.0-alpha.1...v0.64.1-alpha.1
[0.64.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.63.0-alpha.1...v0.64.0-alpha.1
[0.63.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.62.1-alpha.1...v0.63.0-alpha.1
[0.62.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.62.0-alpha.5...v0.62.1-alpha.1
[0.62.0-alpha.5]: https://github.com/Kevinjohn/capacitylens/compare/v0.55.0-alpha.4...v0.62.0-alpha.5
[0.61.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.60.2-alpha.1...v0.61.0-alpha.1
[0.60.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.60.1-alpha.1...v0.60.2-alpha.1
[0.60.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.60.0-alpha.1...v0.60.1-alpha.1
[0.60.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.59.1-alpha.1...v0.60.0-alpha.1
[0.59.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.59.0-alpha.1...v0.59.1-alpha.1
[0.59.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.58.0-alpha.1...v0.59.0-alpha.1
[0.58.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.19...v0.58.0-alpha.1
[0.57.0-alpha.19]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.18...v0.57.0-alpha.19
[0.57.0-alpha.18]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.17...v0.57.0-alpha.18
[0.57.0-alpha.17]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.16...v0.57.0-alpha.17
[0.57.0-alpha.16]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.15...v0.57.0-alpha.16
[0.57.0-alpha.15]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.14...v0.57.0-alpha.15
[0.57.0-alpha.14]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.13...v0.57.0-alpha.14
[0.57.0-alpha.13]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.12...v0.57.0-alpha.13
[0.57.0-alpha.12]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.11...v0.57.0-alpha.12
[0.57.0-alpha.11]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.10...v0.57.0-alpha.11
[0.57.0-alpha.10]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.9...v0.57.0-alpha.10
[0.57.0-alpha.9]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.8...v0.57.0-alpha.9
[0.57.0-alpha.8]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.7...v0.57.0-alpha.8
[0.57.0-alpha.7]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.6...v0.57.0-alpha.7
[0.57.0-alpha.6]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.5...v0.57.0-alpha.6
[0.57.0-alpha.5]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.4...v0.57.0-alpha.5
[0.57.0-alpha.4]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.3...v0.57.0-alpha.4
[0.57.0-alpha.3]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.2...v0.57.0-alpha.3
[0.57.0-alpha.2]: https://github.com/Kevinjohn/capacitylens/compare/v0.57.0-alpha.1...v0.57.0-alpha.2
[0.57.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.56.0-alpha.1...v0.57.0-alpha.1
[0.56.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.55.0-alpha.4...v0.56.0-alpha.1
[0.55.0-alpha.4]: https://github.com/Kevinjohn/capacitylens/compare/v0.54.0-alpha.1...v0.55.0-alpha.4
[0.54.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.7-alpha.1...v0.54.0-alpha.1
[0.53.7-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.6-alpha.1...v0.53.7-alpha.1
[0.53.6-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.5-alpha.1...v0.53.6-alpha.1
[0.53.5-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.4-alpha.1...v0.53.5-alpha.1
[0.53.4-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.3-alpha.1...v0.53.4-alpha.1
[0.53.3-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.2-alpha.1...v0.53.3-alpha.1
[0.53.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.1-alpha.1...v0.53.2-alpha.1
[0.53.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.53.0-alpha.1...v0.53.1-alpha.1
[0.53.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.52.0-alpha.1...v0.53.0-alpha.1
[0.52.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.51.1-alpha.1...v0.52.0-alpha.1
[0.51.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.51.0-alpha.1...v0.51.1-alpha.1
[0.51.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.50.0-alpha.1...v0.51.0-alpha.1
[0.50.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.49.0-alpha.1...v0.50.0-alpha.1
[0.49.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.48.0-alpha.1...v0.49.0-alpha.1
[0.48.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.47.0-alpha.1...v0.48.0-alpha.1
[0.47.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.46.0-alpha.1...v0.47.0-alpha.1
[0.46.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.45.0-alpha.1...v0.46.0-alpha.1
[0.45.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.44.0-alpha.1...v0.45.0-alpha.1
[0.44.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.43.0-alpha.1...v0.44.0-alpha.1
[0.43.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.42.0-alpha.1...v0.43.0-alpha.1
[0.42.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.9-alpha.1...v0.42.0-alpha.1
[0.41.9-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.8-alpha.1...v0.41.9-alpha.1
[0.41.8-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.7-alpha.1...v0.41.8-alpha.1
[0.41.7-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.6-alpha.1...v0.41.7-alpha.1
[0.41.6-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.5-alpha.1...v0.41.6-alpha.1
[0.41.5-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.4-alpha.1...v0.41.5-alpha.1
[0.41.4-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.3-alpha.1...v0.41.4-alpha.1
[0.41.3-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.2-alpha.1...v0.41.3-alpha.1
[0.41.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.1-alpha.1...v0.41.2-alpha.1
[0.41.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.41.0-alpha.3...v0.41.1-alpha.1
[0.41.0-alpha.3]: https://github.com/Kevinjohn/capacitylens/compare/ab823d3a1a33df5a00957551cc65b1f169f993b3...v0.41.0-alpha.3
