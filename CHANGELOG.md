# Changelog

All notable changes to CapacityLens are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/) — while pre-1.0, **minor** versions carry
new features and **patch** versions carry fixes.

> Entries before 0.6.0 use the project's former name **"Floaty"** (and the `FLOATY_*` env prefix),
> since renamed to **CapacityLens** / `CAPACITYLENS_*`.

## [Unreleased]

### Changed

- **Schedule filters now stay out of the way until needed.** A filter-icon button beside the
  Schedule heading expands and collapses the existing filter row, which starts hidden. The Work /
  Time off draw-mode control now lives with those filters while navigation and history controls
  remain immediately available (#196).

## [0.39.2-alpha.1] — 2026-08-11

Schedule zoom levels now end at the selected calendar-week boundary. Wide one-week views and zoom
levels whose day widths do not divide evenly into the viewport no longer reveal the following date.

### Fixed

- **Schedule zooms no longer show a date beyond the selected range.** Week columns now cover the
  viewport at every zoom by distributing leftover pixels within each week. This preserves integer
  scroll positions while preventing part or all of the following day from appearing (#197).

## [0.39.1-alpha.1] — 2026-08-10

### Added

- **Documentation screenshots open full size when clicked.** Every screenshot in the docs is now a
  lightbox: click it to see it filling the window, then click anywhere — or press Escape — to
  close. The screenshots are captured well above the width of the text column, so this shows detail
  that was previously only legible by opening the image file directly. Opening and closing is pure
  CSS, because the published docs are built to open straight from disk; the Escape key is handled by
  the one small inline script the build keeps, and the lightbox still works without it (#187).

### Fixed

- **Documentation breadcrumb links work again.** The trail above each page linked to addresses
  without a `.html` on the end, which only a web server can resolve — so in the published docs,
  which are built to open straight from disk, every breadcrumb link led nowhere. Pages filed under
  a sub-section (the security review records) also showed a bare "Home / Page" trail instead of
  naming the section they belong to (#184).
- **The security review records are reachable from the sidebar again.** Their group was set to
  start collapsed, and expanding it needs JavaScript the published docs deliberately ship without
  — so six pages sat behind a control that could never open. The group now starts expanded (#184).
- **The machine-readable cryptography inventory linked from "Control inventories" is now published
  with the docs.** The link pointed at a file the build never copied into the site (#184).
- **Documentation pages no longer show an empty "Last updated:" label.** The date was filled in by
  the client-side app, which the published docs deliberately ship without, so every page carried the
  label with nothing after it. Showing a real date again means rendering it at build time (#187).

## [0.39.0-alpha.1] — 2026-08-10

Owners can now verify that an invitation or access reset resulted in a successful sign-in without
collecting a last-login timestamp or tracking activity across the site. The setting is deliberately
off by default, records only a per-membership yes/not-yet confirmation, and erases its observations
when switched off.

### Added

- **Owners can optionally record whether each member has signed in.** The privacy setting is off by
  default and stores only a yes/not-yet value per membership—never a sign-in time or activity
  history. When enabled, the members table adds a **Signed in** column beside each person's name and
  email, while the edit and settings controls remain separate at the right-hand edge. Turning the
  setting off deletes every confirmation. Changing access state, issuing a password-reset link or
  revoking sessions clears the affected confirmation until that member successfully signs in again
  (#180).

## [0.38.2-alpha.1] — 2026-08-10

### Changed

- Kept source-owned shadcn primitives at the registry-aligned 80-column width so dry-run diffs
  emphasize substantive drift while repository formatting remains enforced (#164).

## [0.38.1-alpha.1] — 2026-08-10

### Fixed

- Refreshed outdated documentation screenshots so member actions, Settings controls and schedule labels are consistent.

## [0.38.0-alpha.1] — 2026-08-10

Allocation creation now supports atomic weekly and monthly repeat batches for the next three
calendar months, with a complete preview and one-step Undo. No recurrence schema or API change is
introduced; the generated allocations remain ordinary independent records.

### Added

- **New allocations can repeat weekly or monthly for the next three calendar months.** The create
  form now offers Weekly, 2/3/4-week and Monthly choices, previews the number of independent
  allocations and final start date, and aggregates capacity/time-off warnings across the generated
  group. The complete group saves atomically and is removed by one Undo; afterwards every allocation
  can be edited or deleted independently. Edit and Duplicate remain single-allocation flows (#174).

## [0.37.0-alpha.1] — 2026-08-10

Team & access now has a focused member directory with reversible disable, archive and restore
actions, last-login visibility, and server-enforced handling for every non-active membership path.
No database migration or account-contract version change is required.

### Added

- **A member's access can now be turned off instead of only removed.** Each row's new gear menu
  offers **Disable user** and **Archive user**, both reversible from the same menu with **Restore
  access**. A disabled membership keeps its role and history but authorizes nothing — the server
  refuses that person's reads until they are restored — while the administrative directory keeps
  listing them, so the change is visible and undoable. Neither the Owner nor yourself can be
  disabled, in the UI or at the API. (#175)
- **Disabling holds on every path, and costs an administrator nothing.** A disabled member cannot
  redeem an invite back into the company — the attempt is refused and the invite is left unused, so
  only an Owner or Admin can restore access — and the role pencil is withdrawn from non-active rows
  so a role change can never quietly reinstate someone. In the other direction, **Reset password**,
  **Revoke sessions** and **Remove** all keep working against a disabled member, because turning off
  a compromised account first and rotating its credentials second is exactly the sequence this is
  for. Re-applying the status a member already holds succeeds and changes nothing, so a second admin
  on a stale screen cannot silently kill a reset link the first admin just handed out. (#175)
- **Members who are no longer active have their own collapsed group.** The main table lists the
  team; disabled and archived memberships sit behind **No longer active (N)**, closed until someone
  opens it. They are still one click from **Restore access** or **Remove**, but they no longer pad
  out the list of people you actually work with. The group disappears entirely when it is empty.
  (#175)
- **Members are listed by join date, then by name.** People appear in the order they joined the
  company, and anyone who joined at the same moment — a bulk import, say — is ordered
  alphabetically rather than by internal id. (#175)
- **The members table shows Last login.** It is derived from retained sessions, so a member with no
  retained session reads **Unknown** rather than "Never": that read cannot tell "never signed in"
  apart from "session aged out", and the page does not claim the stronger of the two. (#175)

### Changed

- **Team & access is a table, not a wall of cards.** The capability tick list is collapsed behind
  **See full capabilities**, the two explainer cards that carried no controls are gone, inviting
  someone has its own panel, and the member list is a real table of Name, Member role, Last login and
  Actions. Each row ends in a pencil that changes the role and a gear holding the rest. (#175)
- **The per-member transfer-ownership button is gone.** Handing a company over is a rare, deliberate
  act and no longer sits on every row; the owner-only API operation is unchanged, and transfer will
  get its own section in a follow-up. Your access no longer offers to transfer ownership either — it
  now reads "Full company access. You are the single Owner of this company.", because promising a
  control that has no screen behind it is worse than saying nothing. (#175)

## [0.36.0-alpha.1] — 2026-08-10

The source-owned shadcn primitives now match the current registry where appropriate while keeping
CapacityLens's documented behaviour, semantic colour language and accessibility guarantees.

### Changed

- Shared role and status badges now use the current shadcn pill silhouette, invalid-state styling
  and link-aware variants while retaining CapacityLens's brand and contrast-tuned semantic colours
  (#163).
- Removed inert React Server Component directives from the Vite-owned UI primitives and documented
  the sidebar's deliberate shortcut guards and omitted cookie persistence so future registry
  comparisons preserve those choices (#162).

## [0.35.7-alpha.1] — 2026-08-10

A demo-data rename: the seeded people, companies, clients and projects are now recognisable,
obviously-fictional comic-book names, and every documentation screenshot was recaptured to match.
Display strings only — no schema change, no API change, no identifier change.

### Changed

- **The demo dataset's people, companies, clients and projects were renamed.** The two seeded
  companies are now **Wayne Enterprises** (Bruce Wayne, Diana Prince, Clark Kent, Barry Allen, with
  Kord Industries as the external partner) and **Stark Industries** (Steve Rogers) — recognisable,
  obviously-fictional names in place of the previous invented ones, so nobody mistakes a demo row
  for a real person. Clients and projects moved with them (Queen Consolidated, LexCorp, Rand
  Corporation; Project Watchtower, Metropolis Rebrand, Rand Mobile App), and the access lab's four
  demo sign-ins are now Lucius Fox, Alfred Pennyworth, Barbara Gordon and James Gordon. Their
  sign-in **email addresses are unchanged** (`owner@`, `alex.admin@`, `erin.editor@`, `vic.viewer@`),
  so every documented credential still works.
- **The private-client code-name example is now "Nightwing".** The `Code name` field's placeholder
  read `e.g. Northstar`, which collided with the demo dataset's former external partner; the
  example is now `e.g. Nightwing` and the same name is used consistently wherever the private-names
  feature is documented or tested.
- No identifiers changed. Seed ids, `data-testid` values, routes, the export schema and the database
  schema are all untouched, and the released database fixtures keep the names they shipped with —
  this is a display-string change only. Existing installations are unaffected: the seed only runs
  on first start, and no migration renames anything.
- Every documentation screenshot was recaptured from the running app against the new dataset.

## [0.35.6-alpha.1] — 2026-08-09

The schedule's top bar: one **Weeks visible** dropdown in place of five week buttons, icon-only
Prev/Next, and the jump-to-date picker hidden pending a better far-ahead affordance. No schema
change, no API change.

### Changed

- **The schedule's week range is now a dropdown.** The row of `1w` / `2w` / `4w` / `6w` / `8w`
  buttons is replaced by a single **Weeks visible** dropdown offering the same five spans, written
  out ("4 weeks") rather than abbreviated. Nothing about the spans or the week-start snap changed —
  the control is just one thing instead of five, and the closed dropdown states which span you are
  looking at (#173).
- **Prev and Next are now icon-only chevrons.** The words are gone; the left/right chevrons carry
  the meaning, with the same "Back one week" / "Forward one week" tooltips. **Today** is unchanged
  (#173).
- **The jump-to-date picker is no longer shown on the schedule.** People rarely look far ahead, and
  when they do a month list is likely the better answer than a date field — so the picker is hidden
  while that design is worked out. Navigate with **Today** and the chevrons. Nothing was removed
  from the product: the control's code is retained and still covered by tests (#173).
- The **Weeks visible** dropdown announces itself as "Weeks visible, 4 weeks" — the words you can
  see are part of its accessible name, so voice control can act on what is on screen
  (WCAG 2.5.3 Label in Name).
- Every documentation screenshot of the schedule was recaptured from the running app, and the
  Schedule guide, the user stories and `DECISIONS.md` were rewritten around the new top bar.

## [0.35.5-alpha.1] — 2026-08-09

Sidebar rework: the administration destinations move out of the day-to-day list, and
import/export becomes a Settings card. No schema change.

### Changed

- **The left sidebar now gets out of the way of the actual work.** Its day-to-day destinations —
  Schedule, Resources, Disciplines, Clients, Projects, Activities, Time off — sit together at the
  top, and **Team & access** and **Settings** are pinned as a separate administration group at the
  bottom of the list, below a divider. Both are still ordinary destinations with the same icons,
  labels and command-palette entries; only their placement changed. Team & access moved because it
  is role-gated in practice, so it shouldn't sit among everyone's destinations (#172).
- **Import/export moved out of the sidebar into Settings.** The old "Data" section is now an
  **Import & export** card at the very bottom of the Settings page, below Archived & deleted.
  Exporting a backup or replacing a company's data is a rare administrative act and no longer takes
  permanent navigation real estate. Nothing about the export or the confirm-before-replace import
  flow itself changed, including the owner-only import gate on authenticated deployments (#169).
- **The bottom of the sidebar now shows who you are.** Below Switch company, a **Sign out** row
  carries your avatar — your identity provider's picture when it supplied one, your initials
  otherwise. It appears on any auth-enabled deployment as well as the demo build; previously only
  the demo build offered sign-out from the sidebar (#169).
- Every documentation screenshot that shows the left sidebar was recaptured from the running app,
  so the docs and the README heroes match the new navigation instead of showing the old mid-list
  Team & access and the retired sidebar "Data" section.

## [0.35.4-alpha.1] — 2026-08-09

Security hardening from a Codex CLI scan and a follow-up code review. No schema change.

### Security

- OAuth/OIDC refresh and access tokens are now encrypted at rest (`encryptOAuthTokens`), and
  implicit account-linking is disabled (`disableImplicitLinking`) so a federated identity can only
  attach to an existing account through an explicit, verified link. This is a content-only change
  with no schema migration: tokens stored before the upgrade keep working and are transparently
  re-encrypted the next time they are refreshed — no re-authentication or operator action required.
- The strict-OIDC discovery handler now resolves each advertised endpoint
  (`token_endpoint`, `jwks_uri`, `userinfo_endpoint`) and, for a publicly-reachable issuer, rejects
  any that fall off the issuer origin and resolve to a private or reserved network address (RFC 1918,
  loopback, link-local including the cloud metadata range, CGNAT, and the IPv6 equivalents — mapped,
  compatible, 6to4 and NAT64 forms are classified by their embedded IPv4), closing an SSRF pivot a
  compromised or misconfigured provider could otherwise use. A deployment whose issuer is itself on an
  internal network is treated as intentionally internal, so split-origin on-prem IdPs keep working
  with no configuration.
- The nginx reverse proxy now suppresses its access log for the invite **preview** route in
  addition to accept/signup, keeping the URL-path invite bearer out of logs on every hop; a unit
  test couples the nginx suppression list to the application's log-redaction pattern so the two
  cannot drift apart.
- Private local reference material (`/_input/`, `/to-my-siblings/`) is excluded from the Docker
  build context so it can never be baked into an image layer or builder cache.

## [0.35.3-alpha.1] — 2026-08-09

Documentation polish. No application behaviour changed.

### Changed

- Code samples in the documentation are now dark (github-dark syntax theme), so terminal
  commands read as terminals on the light page; the non-functional copy button is hidden
  in the standalone build.
- The glossary is a term/meaning table instead of one heading per term, with every
  deep-link anchor preserved.
- Documentation tables span the full text column, table cells are top-aligned, and
  breadcrumb separators have three times the breathing room.
- The configuration page now explains why account settings carry the `SMALLSASS_ACCOUNT_`
  prefix while app settings use `CAPACITYLENS_`.

## [0.35.2-alpha.1] — 2026-08-09

Mutation-testing follow-up. No application behaviour changed.

### Added

- Direct unit coverage for `isDomainErrorCode` and `DomainError` (name, code, message), and for
  `assertScopedRefs` rejecting a non-string reference id — closing gaps a Stryker mutation run
  found in `shared/src/domain/errors.ts` and `mutations.ts`.

## [0.35.1-alpha.1] — 2026-08-09

Documentation tooling housekeeping. No application behaviour changed.

### Changed

- Prettier and ESLint now leave both documentation folders alone: `docs/` is generated
  output, and the `docs-src/` prose (with its runbook-pinned phrasing) is hand-maintained.

### Removed

- The GitHub Pages deploy job. The docs workflow now only validates the build (dead
  links, standalone rewriting); the documentation ships committed in `docs/` and was
  never actually hosted.

## [0.35.0-alpha.1] — 2026-08-09

Standalone documentation build. No application behaviour changed.

### Changed

- The documentation build is now truly standalone static HTML: no JavaScript, relative
  links throughout, and every page opens straight from disk (`docs/index.html`) without a
  web server. A post-build step (`scripts/docs-standalone.mjs`, no new dependencies)
  strips the VitePress client scripts and rewrites absolute URLs; the same output still
  deploys to GitHub Pages. Search and the mobile sidebar menu, which needed JavaScript,
  are gone.
- The docs folders swapped roles: the Markdown sources moved from `docs/` to `docs-src/`,
  and the committed HTML build moved from `site/` to `docs/`.

### Fixed

- Formatted the documentation sources with Prettier; they had slipped past the previous
  release's format check.

## [0.34.0-alpha.1] — 2026-08-09

Documentation site. One user-visible wording fix; no behaviour changed.

### Added

- Rebuilt the documentation as a VitePress site under `docs/` (committed build in `site/`,
  deployed to GitHub Pages by the new `docs.yml` workflow). The disparate Markdown and HTML
  guides became one navigable site: Getting started, Using CapacityLens, Company login (SSO),
  Self-hosting, Security and privacy, and Reference sections, with local search, breadcrumbs
  and a glossary. `docs/STYLE.md` records the writing standard.
- Added `docs/self-hosting/install-without-docker.md`, a bare-metal walkthrough (Node 24,
  systemd unit, nginx examples), nginx/Caddy reverse-proxy examples in TLS and networking,
  Docker equivalents for the incident-recovery commands, and the audit-file variables to the
  configuration reference.
- Added screenshots throughout, captured from the access lab: the Projects page, allocation
  forms, resource forms, time-off draw mode, team access and the SSO connect/cutover flows.

### Changed

- Replaced the standalone HTML guides (`setup-guide.html`, `company-login-guide.html`,
  `sso-cutover-guide.html`, `features.html`) and the flat operator Markdown files with the
  site's pages; repository references now point at the new paths.
- One tone-of-voice and terminology pass across every page: consistent en-GB spelling,
  "company login provider" per the style guide's word table, and "company" wherever the
  internal word "account" had leaked into user-facing prose.

### Fixed

- The offline-access setting description now says "the last company you opened" instead of
  "the last account you opened", matching the product's user-facing vocabulary.

## [0.33.1-alpha.1] — 2026-08-08

Documentation only. No product code changed.

### Added

- Added `docs/company-login-guide.html`, a jargon-free walkthrough for pointing CapacityLens at the
  identity provider an agency already uses. It covers the redirect URI, the three values to collect,
  and click-by-click steps for Google Workspace, Microsoft 365 / Entra ID, Okta and Keycloak, plus a
  requirements checklist for any other OpenID Connect provider and a symptom-to-fix table for the
  refusals operators actually hit. Linked from the setup guide, the cutover guide and
  `authentication.md`.

### Changed

- Reworked the nine steps in `docs/sso-cutover-guide.html` into collapsible panels, so the procedure
  reads as a nine-line overview and expands one step at a time. Steps keep their own anchors
  (`#step-6`), expand on print, and work without JavaScript.
- Rewrote the self-hoster-facing HTML guides in plain language, replacing "OIDC app in your IdP",
  "container image", "SQLite file" and similar with terms an agency owner installing this themselves
  would recognise, and defining the operator and Owner/Admin roles where the steps begin. The
  operator-facing Markdown references keep their existing vocabulary.

## [0.33.0-alpha.1] — 2026-08-08

This release adds the supported self-hosted password-to-SSO cutover workflow. It preserves existing
principals and workspace access while staging strict OIDC links, blocks unsafe activation, provides
operator preflight and repair tooling, and seals the first SSO-only startup with durable revocation
and audit evidence. It advances the SQLite schema to v25 and the account security contract to 1.1.0;
operators should follow the documented mixed-mode preflight and backup procedure before switching an
existing installation to SSO-only mode.

### Added

- Added the supported password-to-SSO migration path for self-hosted installations. Mixed mode now
  lets each existing member connect the configured strict-OIDC identity without changing their
  principal, memberships, Owner role, or scheduling data; Team & access shows all-company cutover
  readiness and provides fresh, identity-global email and wrong-link repair. The operator
  `cutover:preflight` command names every blocking person, orphan, company, ceremony and incompatible
  sign-in path. A stopped-server `cutover:repair` command handles exact duplicate/multi-provider
  rows, alternative-provider links, providerless or credential-only orphans, ownerless companies and explicitly
  confirmed empty-company deprovisioning without manual identity-table edits.
  Preflight also blocks legacy, unverified strict-provider links held by non-members before a later
  invitation can turn one into an SSO-only restart failure.
- Added the SSO-only startup interlock. After migrations it reconciles committed link observations,
  proves readiness before atomically revoking first-cutover state and recording a durable
  application-scoped activation marker with its audit; clean SSO-only
  restarts preserve sessions already issued with federated assurance. It refuses to listen if any
  company or member is not ready. Required
  provider self-unlink, raw provider-link routes, password-reset redemption, open signup and
  bearer-only invitations are closed in SSO-only mode. Existing experimental named social-provider
  configuration remains compatible for existing principals without allowing new social-only local
  identities, while invitation acceptance requires the strict provider and company provisioning does the same, so a social-only admission cannot break
  later restarts. Link failures return to their initiating settings flow without retaining provider
  diagnostics in browser history. Live reset ceremonies are
  reported by preflight and revoked by first cutover instead of deadlocking that revocation. Credentials remain dormant
  for the documented revert-to-mixed-and-restart break-glass path.
- Added database migration v25 and released-shape off/password fixtures. The migration records
  durable verified link observations in the same statement as every external account row and adds
  unique indexes for provider/subject and principal/provider coordinates, closing direct-admission,
  crash-gap and concurrent link races. Legacy external rows without verified-admission proof must
  be removed and relinked in mixed mode; existing duplicates refuse with exact repair coordinates.
- Fixed SSO staging and repair so provider-link initiation forwards Better Auth's signed state
  cookie, verification failures return through the browser redirect, exact duplicate-link races
  are distinguished from provider outages, stale unconfigured-provider links block readiness with
  repair coordinates, and stopped-server repair can remove an otherwise unrecoverable final bad
  provider row without exposing password credentials through that endpoint.
- A `security` workflow run that fails — or is cancelled without completing — on a schedule or on
  `main` now opens a `security-scan-failure` issue naming the affected jobs and linking the run,
  and comments on that issue instead of filing a duplicate if one is already open. The weekly scan
  broke on 2026-08-04 and stayed red for two days because nothing surfaces a branch-event failure:
  there is no pull request to turn red and no reviewer waiting on it. Pull-request failures are
  deliberately excluded, since they are already in front of the person who caused them.

  Cancellations are included because the 2026-08-06 GitHub Actions outage showed that the run
  least likely to be noticed is the one that never executed: jobs sat queued for ninety minutes and
  were then cancelled having produced no logs at all. A cancellation is only reported when the
  commit is still the tip of its branch — when a newer push superseded it, `cancel-in-progress`
  was working as intended and the report stays silent. A clean run closes the open report, so a
  transient failure tidies up after itself and an issue that stays open means something still needs
  attention. The judgement calls live in `scripts/report-workflow-outcome.mjs` and are covered by
  `pnpm run policy:workflow-report:test`, which the gate runs.

### Changed

- Strict OIDC now requires `email_verified: true` for first admission and explicit link callbacks;
  returning linked subjects remain available when an IdP omits the claim only when their exact row
  carries durable verified-admission proof. Mixed-mode federated
  sessions use their actual provider for fresh-session step-up and satisfy a local required-MFA
  gate; they are no longer sent to an unusable password-only confirmation.
- SSO cutover now ignores expired reset rows, records activation even when staging left no live
  sessions, leaves provider outages as availability failures instead of link conflicts, and avoids
  write-locking callback reconciliation when there is nothing to reconcile.
- Settings waits for authoritative provider-link status before offering Connect, and Better Auth's
  public proxy now exposes only explicitly classified sign-in, session, callback, password, and MFA
  routes—including the existing MFA disable and backup-code renewal operations—so dependency-added
  account mutations remain closed by default.
- Advanced the account contract, conformance, and minimum security baseline to `1.1.0` /
  `ACCOUNT-SEC-2026-08-07-01` for the identity-global SSO cutover and repair guarantees.
- Replaced the secret scanner's per-fingerprint exception list with a reviewed allowlist of the
  deterministic fixture values themselves (`.gitleaks.toml`). Gitleaks fingerprints are
  commit-scoped, so the previous list had to be re-approved whenever an unrelated commit rewrote
  the line a fixture sat on — which twice left the scan failing on values already signed off, and
  trained reviewers to wave findings through. Scoping by value rather than by file keeps a genuine
  credential pasted into a test file reportable. The allowlist is itself gated: because a mistake
  in it makes the scanner report less while still looking green, the build now asserts that its
  patterns compile, that every reviewed fixture is still covered, that credential-shaped values
  and near-misses are not, that the scanner-supported singular global table is used, and that no
  file-level path exclusion has crept back in.

## [0.32.0-alpha.1] — 2026-08-06

This release adds an operator recovery path for the one credential state no one inside the product
can repair: a workspace's sole active Owner losing their password. Because non-Owners cannot
administer an Owner and the single-active-Owner rule guarantees there is no second Owner to help,
recovery is a deliberate stopped-server command-line ceremony rather than a product feature. It
changes no data and leaves the portable export and SQLite database schema versions unchanged.

### Added

- Added `pnpm reset:owner-password`, a self-hosting operator command that issues a password-reset
  link to the sole active Owner of a workspace. It drives the ordinary reset ceremony — same token
  store, expiry, single-use consumption, password policy and session revocation — so it never
  writes a credential directly and never relaxes in-app policy. It refuses unless it can take an
  exclusive SQLite lock (the server really must be stopped, enforced rather than promised), unless
  the database and authentication schemas are already current, unless exactly one identity matches
  the address, and unless that identity is the sole active Owner of at least one workspace —
  anyone else already has an in-product reset path. If anything fails after the link is minted,
  the ceremony is revoked rather than left outstanding. The procedure is documented in the runbook
  and the standing decision behind it in `DECISIONS.md`.
- Added the `identity.owner_recovery_issued` audit action, so incident review can tell an
  operator-issued recovery apart from an ordinary admin-issued reset. The event records the target
  identity and a digest of the ceremony — never the reset token itself — and deliberately carries
  no actor, because the absence of an in-product actor is the auditable fact.

### Fixed

- Restored the continuous-integration gates, which the previous release left failing: the recovery
  command's source was missing from the reviewed cryptographic inventory, and three files were
  committed unformatted. Both slipped through because the commits that introduced them skipped CI.

## [0.31.4-alpha.1] — 2026-08-05

This security patch makes the 30-minute session inactivity timeout actually work — it had been
silently ineffective, leaving idle sessions valid until the 12-hour absolute expiry. After
upgrading, sessions idle for more than 30 minutes are signed out on their next request, so users
returning from a long break will be asked to sign in again — that is the intended behaviour,
newly enforced. It changes no data and leaves the portable export and SQLite database schema
versions unchanged.

### Fixed

- Fixed the 30-minute session inactivity timeout, which was silently a no-op in production. The
  idle-timeout enforcement assumed Better Auth stores `session.updatedAt` as integer epoch
  milliseconds (an assumption recorded in a comment, never verified against a real row), but its
  node:sqlite adapter stores ISO-8601 text. Every SQL comparison that bound a number against that
  text column could not match — SQLite sorts every integer before every string — so the expiry
  delete never deleted and the activity touch never wrote. The test suite stayed green because its
  fixtures wrote integer timestamps, a representation production rows never have. The enforcement
  now reads the raw stored value, accepts either representation, compares-and-sets against the raw
  value, writes touches back in the representation the row already uses, and fails closed (session
  refused, row deleted) on anything unparseable — so a future storage-format change in the library
  degrades loudly instead of silently disabling the timeout again.
- Made the step-up freshness gate for privileged actions inclusive at its deadline: a session
  sitting exactly on the 15-minute freshness bound is now stale, matching the inactivity bound's
  "last safe instant" rule instead of granting one extra tick.
- Hardened the tests that guard both bounds: the inactivity boundary cases (one millisecond
  before, exactly at, one millisecond after) now run in both storage representations against a
  column declared like the real schema, integration fixtures age sessions using the production
  ISO form, and the freshness gate gained exact-boundary coverage. Reported by a cross-repo
  review; the same fix ships in the sibling tally-time project.

## [0.31.3-alpha.1] — 2026-08-01

This patch loosens the bundle budget. It changes no application behaviour and leaves the portable
export and SQLite database schema versions unchanged.

### Changed

- Raised the entry-bundle ceiling to 1 MB gzip (with the raw limit derived from the bundle's own
  ~3.2:1 compression ratio). The previous limits sat about 0.2% above the measured size, so nearly
  every feature tripped them and cost a rebase commit over a few hundred bytes. The check is meant
  to catch one careless import adding hundreds of KB, not to police normal growth; at ~165 KB gzip
  today the app has roughly six times the headroom it needs, and the measured sizes are still logged
  on every build so real drift stays visible.

## [0.31.2-alpha.1] — 2026-08-01

This patch adds a Compact view density toggle for the schedule. The schedule now ships with roomier
vertical spacing by default; Compact view restores the previous, tighter layout. It changes no data
and leaves the portable export and SQLite database schema versions unchanged.

### Added

- Added a "Compact view" toggle to Settings → Schedule, off by default. With it off the schedule
  and the left-hand navigation get roughly double the vertical spacing, which is now the default
  layout; turning it on restores the previous tighter spacing for anyone who would rather fit more
  people on screen. The choice is per-device, like the other schedule display preferences, and does
  not travel in an export.

  Three things deliberately do not follow the general scale. Allocation bars keep the same height at
  both densities, so no label loses room. Discipline band headers keep theirs too — a band holds one
  short label and nothing else, so padding it out would only make a tall empty stripe. And the gap
  between two overlapping allocations on the same person scales harder than everything else (4px to
  16px rather than 8px), because at the shared rate the surrounding row padding swamped it and the
  two projects still read as touching.

  Horizontal geometry is untouched throughout, and the collapsed icon rail is unaffected: only gaps
  and padding move, never any control's height.

## [0.31.1-alpha.1] — 2026-08-01

This patch makes the selected segment of a segmented control visible. It changes no behaviour and
leaves the portable export and SQLite database schema versions unchanged.

### Fixed

- Gave the selected segment of a segmented control a brand tint, paired ink and outline in place of
  the stock accent fill, which resolved to the base surface token and left the active option at
  1.09:1 in light and 1.08:1 in dark — effectively invisible. The schedule's zoom and work/time-off
  groups and the four Settings groups now identify their selection well clear of the 3:1 that WCAG
  1.4.11 asks of the visual information conveying a control's state.

### Tests and documentation

- Regenerated the light and dark schedule screenshots, which still showed the pre-palette bar
  colours from before the preset swatches landed and so misrepresented label contrast on the bars.

## [0.31.0-alpha.1] — 2026-07-31

This minor release resolves all 15 findings from the 31 July whole-repository maintainability
review. It corrects the last blocks-mode capacity disagreement, stops audit-degradation warnings
being dropped on destructive writes, and converts several convention-enforced rules — the viewer
read-only gate, merged-row validation, account write policy and email validation — into
structurally enforced ones, so new code gets them by default. The SQLite schema remains at v24 and
the portable export schema remains at v9.

### Fixed

- Projected existing allocations through the scheduling mode in the allocation modal's capacity
  advisory, so blocks-mode accounts no longer see the modal warn about load the grid and drag
  surfaces correctly ignore; the advisory also filters by resource itself instead of trusting
  callers to pre-filter.
- Surfaced audit-degradation warnings on the dedicated lifecycle archive and unarchive routes and
  on account bootstrap requests, which previously dropped the warning header that batch mutations
  already announce.
- Validated the timezone branch of today's-date resolution against the four-digit ISO year domain,
  so an out-of-range system clock raises the promised error instead of silently corrupting
  lexicographic date comparisons.
- Serialized rehearsal Playwright runs against the shared SQLite fixture, matched the rehearsal
  spec set to the db-backed project by construction, and restored normal parallelism to the
  isolated e2e projects on CI.

### Changed

- Moved account writes onto dedicated API routes, replacing about twenty-five per-verb special
  cases in the generic entity handlers; the generic routes now fail closed for accounts and the
  batch path shares the same policy predicates so the two cannot drift.
- Enforced the viewer read-only gate structurally in the store — thirty-one hand-placed guards
  became two wrappers that gate before validation by construction — and generalized merged-row
  validation into one shared update helper covering a fourth site the review had not flagged.
- Replaced three divergent inline email checks (sign-in, invitation acceptance and member
  pre-authorization) with the shared account email validator, so byte-limit and disallowed-character
  policy applies identically everywhere.

### Performance

- Bucketed each scheduler row's allocations and time off by covered day once per model build
  instead of rescanning full lists for every timeline day, and memoized the dragged-row lookup so
  it runs once per drag rather than once per autoscroll frame.

### Removed

- Deleted the unimplemented cross-tab persistence subscription seam and its unreachable
  reconciliation consumer, which advertised multi-tab adoption no adapter provides.

### Tests

- Added a differential cascade-parity suite that runs the same fixtures through the shared
  TypeScript cascades and a real SQLite database, failing on any divergence between domain-core
  deletes, foreign-key clauses and lifecycle purge restamps; corrected the cascade mapping
  comment's stale file references.

## [0.30.0-alpha.1] — 2026-07-31

This minor release closes every policy, contract and security follow-up from the 30 July
whole-repository review, building on the 84 validated findings completed in 0.29.0-alpha.1. It
aligns session expiry and revocation coordinates, isolates configured authentication providers,
enforces attributable contribution sign-offs, and closes the three deferred security boundaries
around private-name projection, browser retry handles and audit-file permissions. The SQLite schema
remains at v24 and the portable export schema remains at v9.

### Fixed

- Failed closed for quoted private names with missing code names, isolated retained account-command
  retries by authenticated identity, and repaired audit-file permissions before appending.
- Bound DCO sign-off checks to each commit's author or committer identity instead of accepting an
  unrelated but syntactically valid trailer.
- Rejected generic OIDC aliases that reuse built-in identity or authentication-plugin namespaces,
  preventing native-provider metadata and issuer bindings from being silently overwritten.
- Expired sessions at the exact inactivity deadline instead of refreshing them, and pinned the
  application-local session handle across verification, listing and revocation independently of
  Better Auth's database row identifier.

## [0.29.0-alpha.1] — 2026-07-31

This minor release completes all four remediation stages from the 30 July whole-repository review:
all 84 validated findings are resolved. It strengthens audit durability and recovery, migration
compatibility, authentication and lifecycle boundaries, browser-state reconciliation,
accessibility, operational tooling and regression evidence. The SQLite schema advances from v23 to
v24 to bound used invitation history; the portable export schema remains at v9.

### Fixed

- Bounded used-invitation history to 200 rows and 365 days per company, and indexed live
  pre-authorized invitation admission lookups.
- Used proper singular and plural nouns in archive-impact confirmations, and rejected invalid
  retry-delay metadata at the shared account boundary.
- Pinned all account feature-selector defaults and exercised malformed offline payload validators
  through valid authenticated-encryption envelopes.
- Closed every SQLite handle in tenant-store and restore-drill tests, and added real-adapter
  coverage for lifecycle purges, note scrubbing and indexed validation lookups.
- Enforced unique SQLite column declarations, centralized global overlay layers, narrowed shared
  package exports, exposed released database fixtures to normal Git workflows, and aligned the
  supported shadcn tooling version.
- Bounded legacy erasure-lock snapshot retries, retained aggregate invalid-timezone diagnostics,
  distinguished context-word password failures from breached-password matches, and returned the
  blocking replay entry's actual retry horizon.
- Kept partial-workweek allocations within the persisted calendar limit, normalized combined
  activity filters, preserved mixed numeric/string segmented values, and rejected API origins with
  slash-only fragments.
- Contained exceptional application-binding objects at the shared validation boundary, rejected
  array-shaped branding, and refused Internal-client repair beyond the supported timestamp domain.
- Built duplicate activity labels once in linear time per source change, and showed conventional
  Command or Control shortcut guidance according to the user's platform.
- Made lifecycle soft-deletion irreversible for people, clients and projects, and reported scheduled
  backups as pending until the first verified snapshot has actually been published.
- Rejected unsafe one-time-token payloads and blank created-company identities, refused edits with
  unincrementable revisions, and ordered invitation history by represented instant.
- Restored login controls when an external provider returns without navigating, removed inline
  activity creation after a live viewer downgrade, and locked duplicate device-clear confirmation.
- Cleared tenant-owned interaction state during forced company fallback and removed stale project
  filters whenever their selected client is cleared.
- Made packaged internal-TLS renewal a coordinated, generation-verified operation so nginx and the
  API cannot continue with different certificate generations after rotation.
- Required the development bootstrap owner password to be operator-managed before startup, avoiding
  irretrievable post-commit credentials, and cancelled rejected OIDC response bodies explicitly.
- Gave every repeated list-row edit/delete control a target-specific accessible name, prevented
  stale overlapping session requests from replacing newer results, and clarified backup clamping.
- Bounded audit-log replay reconstruction to a fixed tail window instead of loading complete log
  generations, and recovered large SQLite audit backlogs progressively between event-loop turns.
- Added a preserve-first offline audit-outbox recovery command that inspects malformed head rows,
  durably exports exact evidence and requires an explicit ID before quarantining one corrupt row.
- Retained normalized account-administration and reconciliation events in the durable audit outbox,
  committing them with their local command outcome and replaying them after sink recovery.
- Reported canonical same-batch Internal-client echoes as accepted no-ops instead of overstating the
  changed count and recording a phantom client creation.
- Required rediscovered audit deliveries to complete a fresh file and directory durability flush
  before their retained SQLite outbox rows can be removed after an earlier flush failure.

### Tests and documentation

- Corrected lifecycle, invitation, persistence and contributor guidance; made all lifecycle
  affordance predicates publicly testable; and added repository checks for release links,
  documentation targets and single-sourced localized branding.
- Compared every retained pre-migration row value and relationship against the upgraded database,
  with explicit historical-repair allowances, and documented the immutable v13 malformed-colour
  compatibility behavior using real v12 upgrade cases.
- Bounded stalled rehearsal proxy requests, released paired sockets on disconnect, and surfaced
  unexpected static-file faults separately from genuine missing paths.
- Preserved literal Playwright arguments in cross-browser wrappers and made demo, WebKit and
  Firefox package entry points portable across POSIX and Windows shells.
- Restored the released database-v23 compatibility matrix for both auth-off and password
  deployments, retaining sanitised historical fixtures and their exact generation provenance.

## [0.28.6-alpha.1] — 2026-07-30

This patch strengthens destructive imports, browser lifecycle synchronization and company-directory
reconciliation. It closes the remaining P1 review finding and six related P2 concurrency and
reliability findings without changing the portable export or SQLite database schema versions.

### Fixed

- Prevented stale or partially malformed company-directory responses from falsely closing the
  active company, and reconciled ambiguous post-erasure `403` responses against the authoritative
  directory using the command client's original outcome classification.
- Made page-teardown lifecycle archives part of the browser session's ordered atomic sync batch,
  preventing an older in-flight creation from resurrecting a removed row and ensuring a surviving
  page's undo durably unarchives the row before persistence reports clean.
- Bounded concurrent and queued server import preparation, cancelled abandoned worker jobs, and
  exposed temporary saturation as a retryable response instead of spawning unbounded workers.
- Refused a destructive server import when the company changes during background import
  preparation, preserving the newer committed work and prompting the owner to retry from current
  data instead of silently overwriting it.

### Tests and documentation

- Aligned the allocation-deletion user story with its confirmation flow and strengthened browser
  coverage for cancellation, confirmed removal and exact undo restoration.
- Corrected user-story counts and browser-spec coverage mappings, and brought six abbreviated
  stories into the documented goal, rationale, workflow and acceptance-criteria structure.
- Registered the source-owned UI primitive integrity checker in the cryptographic inventory so the
  repository gate recognizes its non-secret SHA-256 file digests.

## [0.28.5-alpha.1] — 2026-07-30

This patch closes the 37-record P3 Architecture and maintainability review row. Fourteen residual
issues were repaired and twenty-three were verified already fixed on current source. The portable
export and SQLite database schema versions are unchanged.

### Architecture and maintainability

- Coordinated sign-out and offline write boundaries across sibling tabs so stale tenant state is
  hidden immediately, while preserving the existing mandatory reload and server-session cleanup.
- Revalidated enabled offline access against the installed service worker, promoted shell metadata,
  cache existence and cached root document, falling closed when browser storage was cleared.
- Preserved authoritative tenant offline-read state against lower-authority identity and account
  refreshes, and made each offline-state writer's ownership explicit.
- Extracted shared private-name fields and state handling from client and project forms, and shared
  process lifecycle helpers between the full-stack and access-lab development runners.
- Made external-identity admission dependencies explicit at the composition root, removed obsolete
  lifecycle and access exports, and exposed account mutations through the command-ledger boundary.
- Centralised Playwright run-mode resolution, rejected contradictory engine modes, and made the
  configured project set independently testable for standard, browser-only, OIDC and rehearsal runs.
- Added a pinned shadcn registry command and a source-owned primitive integrity gate so deliberate
  local primitive behavior cannot be silently replaced by a registry refresh.

### Changed

- Replaced repository-specific private-path exclusions with generic ignored-file handling in lint
  and cryptographic inventory discovery.
- Updated UI tests to assert semantic application state rather than styling implementation details.
- Reconfirmed current-source ownership transfer, account authorization, route composition, domain
  seams and other architecture records that already satisfied their review outcomes.

### Tests

- Added focused regressions for sibling-tab sign-out, offline shell revalidation and writer
  authority, external admission composition, account-command architecture, shared form fields,
  development process cleanup, UI primitive integrity and Playwright mode selection.
- Passed the complete server gate, 152 frontend/shared files and 2,633 tests with coverage and
  production budgets, plus all 196 default Chromium, database-backed and password-auth E2E cases.

## [0.28.4-alpha.1] — 2026-07-30

This patch closes the 22-record P3 Performance review row. Sixteen residual issues were repaired
and six were verified already fixed on current source. The portable export and SQLite database
schema versions are unchanged.

### Performance

- Recomputed only visible-window utilisation while horizontally scrolling the scheduler, shared
  scoped and active projections across component call sites, and avoided rebuilding unchanged
  tables after server acknowledgements.
- Skipped redundant offline-slice encryption, eliminated encrypted-value reads during sign-out,
  cancelled superseded inactive-data requests, and made focus refreshes recover promptly without
  duplicating successful company-switch loads.
- Moved large import remapping to a worker thread, bundled the production API and import worker as
  JavaScript during image construction, and replaced whole-account validation reads with indexed
  point and reverse lookups for ordinary single-row writes.
- Delivered audit-outbox pages through one file durability boundary, amortised command/session
  housekeeping, bounded date-array materialisation, and removed the remaining whole-database read
  from authentication-off account listing.
- Split Chromium, Firefox and WebKit E2E into independent CI matrix jobs and excluded documentation,
  tests, review state and generated output from Docker build context invalidation.

### Changed

- Added the server runtime bundle to the server gate and moved build-only `tsx` out of production
  dependencies.
- Rebased the raw entry-bundle ceiling from 528 KB to 529 KB for the shared projection cache and
  incremental scheduler projection; the stricter 165 KB compressed-transfer ceiling is unchanged.
- Reconfirmed current-source database indexes, batch validation projection, structural-sharing
  undo/redo, streaming migration digests and indexed migration id remapping.

### Tests

- Added focused regressions for scheduler projection equivalence, offline rewrite suppression,
  focus-refresh cadence, audit batching, date materialisation and production runtime construction.
- Passed the complete server gate, 152 frontend/shared files and 2,648 tests with coverage and
  production budgets, plus all 196 default Chromium, database-backed and password-auth E2E cases.

## [0.28.3-alpha.1] — 2026-07-30

This patch closes the 18-record P3 Observability review row. Twelve residual issues were repaired
and six were verified already fixed on current source. The portable export and SQLite database
schema versions are unchanged.

### Observability

- Added privacy-safe persistence diagnostics for failed saves, retries, reconciliations,
  superseded reloads, rebased edits, discarded edits and write suspension, exposed through a
  collapsed Settings disclosure alongside build provenance.
- Made accepted-connection drops produce a rate-limited operator event, excluded CORS preflights
  from authentication success events, and retained verified principal attribution for real sign-in
  and sign-out events.
- Recorded one local-identity deprovision event per erased principal and added per-table row counts
  to irreversible purge audit records without placing tenant values in the audit trail.
- Routed transaction rollback failures through an injectable structured reporting seam while
  guaranteeing that a failing reporter cannot mask the original transaction error.

### Fixed

- Distinguished a still-stale session after successful reauthentication, preserved offline-key and
  lifecycle-reconciliation causes, and surfaced a rejected conditional terminal-ledger write.
- Kept displayed utilisation values on the correct side of the strict 100% capacity boundary,
  including screen-reader, person, discipline and overall summaries.
- Distinguished E2E test failures from runners that could not start, were killed by a signal or
  ended without a status, with a shared status classifier used by both multi-browser runners.
- Reconfirmed current-source coverage for role-gated member reads, audit-warning propagation,
  web/SPA health probing, atomic rejected reassignment, SQLite integrity classification and
  rate-limited invalid-timezone warnings.

### Tests

- Added focused regressions for persistence counters, step-up retry failures, overload events,
  authentication preflights, utilisation boundaries, runner termination, rollback diagnostics,
  offline-key causes, terminal-ledger rejection, identity erasure and purge audit counts.
- Passed the complete server gate, 152 frontend/shared files and 2,644 tests with coverage and
  production budgets, plus all 196 default Chromium, database-backed and password-auth E2E cases.

## [0.28.2-alpha.1] — 2026-07-30

This patch closes the 18-record P3 Accessibility review row. Six residual issues were repaired and
the other twelve were verified already fixed on current source. The portable export and SQLite
database schema versions are unchanged.

### Accessibility

- Made preset colour selection a true single-tab-stop radio group with arrow-key selection, while
  preserving outside-click focus and updating browser coverage to assert the exposed semantics.
- Focused invalid allocation and time-off fields or their form-level alert, scrolled the target into
  view, and cleared stale errors on the next edit. Reauthentication now exposes only one error alert.
- Kept type-to-confirm company deletion keyboard-focusable while blocked, linked it to its hint, and
  retained a hard activation guard until the exact company name is entered.
- Preserved focus during member-management actions by moving it to the live busy status before a
  dialog trigger becomes disabled.
- Kept keyboard-moved allocation bars within the rendered timeline, followed successful nudges and
  restored bar focus after the scheduler re-rendered.
- Announced scheduler draw-mode changes, omitted misleading work counts in Time-off mode, and added
  keyboard row actions for time-off creation while excluding ineligible external resources.

### Changed

- Added a modal edit hook so validation errors can clear consistently for native and composed form
  controls without duplicating per-field handlers.
- Rebased the raw entry-bundle ceiling from 525 KB to 528 KB for the localized screen-reader copy;
  the stricter 165 KB compressed-transfer ceiling is unchanged.

### Tests

- Added and updated focused regressions for colour radios, field-error focus, destructive-action
  semantics, member-action focus, keyboard bar movement and Time-off mode behavior.
- Passed the complete server gate, 151 frontend/shared files and 2,632 tests with coverage and
  production budgets, plus all 196 default Chromium, database-backed and password-auth E2E cases.

## [0.28.1-alpha.1] — 2026-07-30

This patch closes the 15-record P3 Operations review row and incorporates the repairs found while
reviewing its changed-code checkpoint. It improves startup diagnostics, browser recovery and
committed-write reconciliation without changing the portable export or SQLite database schema.

### Operations

- Clamped out-of-range backup retention and interval settings to their documented bounds, rounded
  fractional values down consistently, and emitted startup warnings that name both the requested
  and applied values.
- Reconfirmed the remaining operational controls on current source, including credential-profile
  warnings, domain-separated reconciliation references, abandoned backup cleanup, audit-rotation
  signals, container Node preflight, backup permissions and restore guidance, production-startup
  framing, dependency auditing and the documented localisation build dependency.

### Changed

- Split the first-run introduction and damaged-storage recovery screens from the returning-user
  entry bundle while retaining visible loading and first-action focus behavior.
- Made the onboarding tour single-flight, gave lazy invitation and password-reset routes a visible
  loading state, removed the misleading demo “Use another account” action, and removed unused
  starter assets.
- Moved server import coordination and invitation presentation into focused modules, and made the
  repository's pnpm subprocess helper portable across operating systems.

### Fixed

- Added a dedicated damaged-browser-storage recovery path that can preserve raw bytes, clears local
  and offline stores together, reports partial reset failures, and never routes local corruption to
  the server connection retry screen.
- Prevented pre-import edits from being replayed over a committed server replacement; uncertain
  import and lifecycle outcomes now keep writes blocked until an authoritative refresh or explicit
  reload proves the current state.
- Hardened external invitation hand-off, page-lifecycle navigation, API error extraction, legacy
  theme migration and browser-download failure wording against aborts, hostile values and outcomes
  that the browser cannot observe.
- Restored command-palette dirty-form protection without breaking its own Ctrl/Command+K toggle,
  and retained modal ownership when another dialog is open.

### Tests

- Added coordinator-level import persistence coverage, storage-recovery and page-reload seams,
  lifecycle outcome tests, invitation hand-off regressions, backup-boundary tests and browser-level
  tour and command-palette checks.

## [0.28.0-alpha.1] — 2026-07-29

This minor prerelease consolidates the completed security-assurance, correctness, durability,
concurrency, reliability, and API-compatibility programme. It strengthens how CapacityLens protects
tenant data, acknowledges writes, recovers from interruption, coordinates concurrent work, and
reports failures across the browser and SQLite server. The portable export and SQLite database
schema versions are unchanged.

### Security

- Verified server-side purge authorization across every lifecycle route and retained fail-closed
  migration-rehearsal checks for newly introduced or renamed secret-bearing columns.
- Kept account membership, identity erasure, invitation, session, reauthentication, and
  cross-tenant behavior aligned with server-enforced authorization boundaries.

### Changed

- Made write acknowledgement and recovery explicit: ambiguous commits trigger authoritative
  reconciliation, stale seed generations cannot apply completed revisions, and superseded saves no
  longer resolve as though they were durable.
- Strengthened concurrency boundaries for cross-tab offline state, exact-revision writes,
  reauthentication prompts, and persistence suspension during sign-out and refresh.
- Standardized API outcomes for imports, sessions, invitations, command headers, retry delays,
  frozen fields, cross-tenant requests, authentication outages, optional clears, and export errors.
- Restricted offline fallback to genuine network loss and made skipped snapshot writes observable
  to the settings experience.

### Fixed

- Repaired client/server reconciliation, lifecycle recovery, imported and migrated data repair,
  account-state projection, scheduler boundaries, and account-management error states.
- Preserved complete offline snapshots, reported discarded suspended edits, preflighted aggregate
  teardown payload limits, and made rollback-journal and internal-TLS replacement operations safer.
- Hardened database startup and migration rehearsal, password-processing backpressure, and
  browser/server error classification.
- Forwarded Playwright wrapper arguments and expanded regression coverage across the affected
  frontend, shared-domain, server, migration, and browser paths.

## [0.27.3-alpha.6] — 2026-07-29

This patch closes the P3 API and compatibility review row. It makes refusal, retry, session,
cross-tenant and offline-cache outcomes explicit while preserving the portable export and SQLite
database schema versions.

### Fixed

- Normalized zero-record imports, cross-tenant writes, frozen-field batches, authentication 503s,
  session listing/revocation and invitation validation to explicit, consistent HTTP contracts.
- Required account command headers as a pair and narrowed retry-delay typing so contradictory
  retry metadata cannot be constructed.
- Made offline cache skips and superseded queued saves observable instead of resolving like durable
  writes, and made shared API error reads non-consuming for standard responses.
- Forwarded Playwright wrapper arguments and localized complete-export failures.
- Rejected `null` for required direct-write columns while retaining documented optional clears.

## [0.27.3-alpha.5] — 2026-07-29

This patch closes the P3 reliability review row. It tightens offline fallback, page-teardown
persistence budgeting and password-processing backpressure without changing the portable export
schema or SQLite database schema versions.

### Fixed

- Restricted read-only offline snapshot fallback to genuine browser network failures; reachable
  server errors and client request deadlines now retain the retry screen instead of substituting
  potentially stale data.
- Preflighted the aggregate browser keepalive quota across the atomic teardown batch and every
  sibling lifecycle archive before dispatching any request.
- Mapped password-hash queue saturation to the same retryable service-unavailable contract used by
  password verification.

## [0.27.3-alpha.4] — 2026-07-29

This patch closes the P3 concurrency review row. It strengthens cross-tab coordination, write
preconditions, reauthentication and persistence suspension without changing the portable export
schema or SQLite database schema versions.

### Fixed

- Synchronized offline preference and cache-boundary changes across tabs, clearing stale page-local
  state while retaining the durable stale-writer guard.
- Made full and batch writes require the exact stored revision while retaining compatible PATCH
  omission and recovery from corrupt legacy revisions.
- Added a reauthentication resolution epoch so late sibling freshness failures reuse an already
  completed success or cancellation instead of opening another prompt.
- Prevented sign-out, refresh and flush overlap from starting or acknowledging persistence work
  while internal suspension is active.

## [0.27.3-alpha.3] — 2026-07-29

This patch closes the P3 durability review row. It strengthens acknowledged-write, offline-cache,
database-startup, migration-rehearsal and internal-TLS behavior without changing the portable
export schema or SQLite database schema versions.

### Fixed

- Reported dispatched batch transport failures as uncertain commits and prevented stale seed
  generations from applying completed revisions locally.
- Preserved the last complete offline snapshot when scoped reads or account-role summaries are
  incomplete, and surfaced edits discarded during page suspension.
- Repaired rollback-journal permissions and made control-table startup checks reject unexpected
  schema drift.
- Made internal-TLS replacement atomic on the destination filesystem while preserving reusable
  certificate authorities.
- Strengthened interrupted-migration rehearsal and rejected invalid Playwright report-phase aliases.

## [0.27.3-alpha.2] — 2026-07-29

This patch closes the remaining P3 correctness review records. It strengthens existing behavior
without changing the portable export schema or SQLite database schema versions.

### Fixed

- Reconciled client state authoritatively after incomplete or ambiguous persistence responses, and
  tightened revision, retry and lifecycle handling so committed writes are not silently lost or
  misreported.
- Kept account membership, identity erasure, authorization and private-name projection coherent
  across inactive, malformed and server-authored states.
- Rejected or repaired invalid imported and migrated domain data, including malformed dates,
  references, scheduling spans and entity-kind relationships, while preserving recoverable rows.
- Corrected scheduler viewport, gesture, lane-packing and visible-span boundary behavior, with
  focused regressions for invalid dates, clipping and interaction termination.
- Aligned UI error, invitation, permission and account-management states with the server contracts,
  and expanded regression coverage across the affected frontend, shared-domain and server paths.

## [0.27.3-alpha.1] — 2026-07-29

This patch closes the remaining P3 security-assurance review records. Current-source verification
confirmed that both controls and their regressions were already present, so this release changes no
runtime behavior, portable export schema or SQLite database schema.

### Security

- Confirmed that purge authorization is enforced by the server for every lifecycle route: viewers,
  editors and non-members cannot purge, while administrators and owners can.
- Confirmed that retained migration-rehearsal snapshots reject unclassified columns before copying
  data, covering newly added or renamed secret-bearing fields.

## [0.27.2-alpha.1] — 2026-07-29

This patch release resolves the remaining correctness, durability, compatibility, operational,
accessibility, performance, test-assurance and documentation findings from the repository review.
It does not change the portable export schema or SQLite database schema versions.

### Fixed

- **Offline read mode now precaches lazy-loaded screens.** Enabling offline access stages the full
  production asset graph atomically, so an unvisited supported route can still open after the
  network disappears.
- **Production rehearsal now matches nginx for missing static files.** Missing file-like paths
  return 404 instead of being hidden by the SPA fallback.
- Rejected hidden time-off writes, stale resource edits and contradictory client/project filters,
  while keeping archive expiry, offline preference changes and account deletion controls coherent
  during long-running screens and concurrent actions.
- Made legacy client migration collision-safe, bounded demo dates and server revisions to the
  supported four-digit timestamp domain, and serialized first-run seeding and bootstrap ownership.
- Retained malformed audit records for investigation, bounded delivered-audit deduplication state,
  made session activity updates monotonic and reported malformed internal TLS expiry as unhealthy.
- Tightened invitation timestamp and provider-failure handling, expanded account and persistence
  contract tests, and aligned scheduler, accessibility, OIDC and release documentation with the
  implemented product contracts.

- Serialized account, identity, lifecycle and tenant writes at their SQLite boundaries, while
  retaining exact-command replay after completed company erasure.
- Hardened database startup, migration rehearsal, TLS configuration, container health checks and
  shutdown persistence against partial, malformed or concurrent state.
- Kept authentication, MFA, invitation, management and account-selection failure states actionable
  instead of clearing state, rendering stale controls or leaving the interface busy.
- Made scheduler keyboard, pointer and viewport gestures terminate safely at invalid dates, bounds,
  lost capture and secondary-button release, with undoable client and project removal.
- Tightened API input and response contracts for scoped slices, inactive reads, lifecycle errors,
  server-authored fields and persistence completion.
- Bounded unauthenticated CSP telemetry and warning cardinality, and expanded the reviewed
  cryptographic-path inventory to cover workflow, container and lifecycle identifiers.
- Removed residual personal role data from deleted-resource tombstones and lengthened their opaque
  display identifiers.
- Revalidated shared authentication sessions when a background tab returns to the foreground, so
  sign-out or revocation in another tab cannot leave stale tenant controls visible indefinitely.
- Hardened persistence boundaries against cross-company snapshots, raw server error bodies,
  divergent batch validation, duplicate live persistence owners and incomplete response receipts.
- Consolidated scheduler geometry test helpers and snap timing around semantic hooks, reducing
  brittle coupling to Tailwind classes and duplicated pixel constants.
- Made lifecycle, account-failure, scoped-reference, import-field and read-slice policies more
  exhaustive so future entity or field additions fail compilation or focused conformance tests.
- Kept duplicate working-weekday input consistent across date calculations and removed duplicated
  brand and import-notice strings from the translation catalogue.
- Made allocation deletion explicit and permission-aware, improved app-entry and form-error focus,
  and reduced the colour palette to one keyboard Tab stop with arrow-key navigation.
- Improved rolling-version API compatibility, bounded operational diagnostics and dependency
  auditing, and reduced persistence acknowledgement work to the tables that actually changed.
- Preserved unique durable audit evidence for every company creation and forced authoritative
  reconciliation when an older server commits a batch without returning every row revision.
- Rejected non-round-trippable year-zero dates, restored phrase searches spanning resource names
  and roles, and made outstanding invitations expire live while Team & access remains open.

## [0.27.1-alpha.1] — 2026-07-28

This patch adopts Prettier as the repository's formatter and applies it everywhere in one pass.
There is no application, application-data, export-schema or database-schema change: the reformat is
mechanical, and the single behavioural change is to a test that was asserting on formatting rather
than on the invariant it guards. Contributors now spend no review attention on whitespace, quoting
or line breaks, and the gate rejects an unformatted tree in seconds rather than after the suite.

### Added

- Adopted Prettier for every supported file type in the repository, configured with stock defaults
  and a single project setting, `printWidth: 120`. The codebase already matched Prettier's defaults
  for arrow parentheses, JSX quoting and trailing commas, so the line width is the only choice worth
  stating.
- Added `pnpm run format` and `pnpm run format:check`, and a Formatting section in the contributor
  guide recording that style is no longer reviewable: if Prettier produced it, it is correct.
- Added `.git-blame-ignore-revs` naming the reformat commit, so `git blame` continues to attribute
  each line to the commit that last changed its meaning. GitHub honours the file automatically;
  local clones opt in once with `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

### Changed

- Applied Prettier across 639 files covering the browser application, shared domain, SQLite server,
  end-to-end specs, build scripts, workflows and documentation, as an isolated mechanical commit
  that changes no behaviour.
- Made `format:check` part of both gates. It runs early, so an unformatted tree fails before the
  test suite rather than after it; `gate:server` checks the server and shared packages only, since
  it is also run on its own.
- Excluded generated and vendored paths from formatting, including the compiled Paraglide message
  output, the lockfile, dependency patches, build output and coverage reports.

### Fixed

- Fixed account-boundary architecture conformance checks that scanned source text for route paths
  and policy thresholds wrapped in hardcoded single quotes. They tracked the formatter rather than
  the invariant, so a change of quote style would have let the route-ownership assertions pass by
  absence instead of by proof. They now match either quote style.

### Verification

- Certified the reformat against the complete local suite on Node 24: both gates, the portable
  account-boundary conformance check, migration rehearsal, and the full browser matrix — 195
  Chromium tests including the database- and authentication-backed projects, 179 on WebKit and 179
  on Firefox — plus the strict OIDC suite against the digest-pinned reference provider. Mutation
  certification was not re-run, as no production logic changed.
- Confirmed the formatted tree is a fixed point rather than merely formatted once: an initial pass
  left fourteen files that a second pass still altered, so formatting was run to convergence before
  the commit was recorded.

## [0.27.0-alpha.1] — 2026-07-28

This minor release consolidates verified product-review fixes across the application. It strengthens
tenant isolation, account and identity durability, atomic scheduling writes, migration integrity,
offline and teardown recovery, accessibility, operational hardening, and regression coverage across
the browser, shared domain and SQLite server.

### Fixed

- Oversized page-closing saves now explain that the page must remain open until saving recovers.
- Missing member mutations now return the same structured not-found response across account routes.
- Exact-capacity fractional allocations no longer produce order-dependent over-capacity warnings.
- Fatal post-migration server boot failures now use the operator-facing startup-refusal diagnostic.
- Account-flow failure audits now cover compensated and dependency-failure outcomes and classify
  policy refusals as denials.
- Security events now use the same trusted client IP as reverse-proxy rate limiting.
- Background refreshes no longer discard undo history when company data is unchanged.
- Focused Playwright runs that name only core specs no longer boot unused database and auth stacks.
- Lifecycle actions now update only their target row and affected cascade set instead of rewriting
  an account's complete scheduling dataset.
- Domain validation rejections now carry stable codes through browser and server paths and resolve
  their user-facing text through the translation layer.
- Identity names and labels now apply character limits in Unicode code points, while email length
  uses its documented UTF-8 byte ceiling.
- Offline settings now warn when an opted-in device cannot save recent snapshots and recover the
  health indication after the next successful write.
- Password-security queues now expire stale waiters and emit saturation security events.
- Scheduler edit forms now load on demand, restoring measured first-load bundle headroom.
- Application boot now validates its mount point before side effects and detaches cleanly on HMR.
- Oversized sync failures now stay quiet across focus and online events until data changes again.
- Deep health now reports scheduled-backup degradation and last-success freshness.
- Authentication failure walls now expose a descriptive page title and announce their detail.
- Lifecycle responses now finish fallible redaction before their mutation transaction commits.
- Product audit records now name only requested fields that the write pipeline actually changed.
- Client and project archive warnings now include phases hidden by the archive.
- Malformed legacy lifecycle tombstones now recover through the nearest valid state instead of becoming permanently stranded.
- Invalid programmatic rate-limit values now fail server construction instead of silently disabling protection.
- Team-access member actions now expose their in-progress state to assistive technology.
- Unavailable password-reset endpoints now provide terminal administrator guidance instead of retry advice.
- Account configuration aliases now normalize surrounding whitespace consistently without altering secrets.
- Viewer sessions no longer show resource-section create actions they cannot use.
- Activity-row delete controls now include the activity name for assistive technology.
- Invite acceptance now announces every asynchronous flow state and preserves keyboard focus through completion.
- Successful company erasure now confirms that the named company was permanently deleted.
- The command palette now exposes its initial and changing highlighted option to assistive technology.
- New demo, access-lab and opt-in seeded deployments now place their schedule scenarios in the current week.
- Forced shutdown logs now distinguish repeated operator signals from concurrent process failures.
- Direct access-lab setup now applies the same isolated authentication environment as its launcher.
- Destructive access-lab setup now refuses a symlinked database fixture path.
- Team directories now tolerate absent additive fields and isolate unsupported version-skew rows.
- Migration rehearsal now refuses unclassified columns before retaining anonymised snapshots.
- Abandoned requests now withdraw their queued password-security work before it consumes capacity.
- External sign-in callback details are removed from the address bar before app hydration.
- One-time invitation and password-reset links now preserve URL-significant token characters.
- Offline database connections now yield promptly to future encrypted-cache upgrades.
- Pending scheduler search text now survives changes to the other toolbar filters.
- Scheduler selectors now distinguish same-named projects and activities with context.
- Encrypted offline directory writes now preserve the newest accepted company list.
- Dependabot pull requests retain their DCO exemption when a maintainer re-runs the workflow.
- Coverage reporting outages no longer fail the otherwise-complete application gate.
- Archived settings never render rows fetched for a previous company or reload generation.
- Persistent forms now clear stale field errors after edits, resets, and successful submissions.
- SQLite open failures now preserve the original permission error during connection cleanup.
- The onboarding guide now accurately documents ownerless-company migration promotion order.
- Lifecycle conflicts now use typed classifications instead of matching error-message prose.
- Authentication environment-alias documentation now consistently uses the 0.26/0.28 window.
- Calendar timezone and week-start defaults now come from primitive shared selectors.
- Step-up authentication now safely replays `Request` bodies after confirmation.
- SQLite write acknowledgements now use an explicitly verified `synchronous=FULL` policy.
- Client wire decoders now reject duplicate account, provider, member and invitation identities.
- Viewer authorization E2E checks now exercise populated client rows and a real resource lane.
- Undo and redo now skip serialization for structurally shared unchanged tenant rows.
- The build-stamp story now documents the actual `demo` persistence suffix.
- The resource-archive story filename and index no longer imply destructive cascade deletion.
- The project-archive story filename and index no longer imply destructive cascade deletion.
- The mobile-navigation story now distinguishes portrait off-canvas and landscape icon modes.
- The client-archive story filename and index no longer imply destructive cascade deletion.
- The add-activity acceptance story now matches the allocation picker's project filtering.
- Server shutdown now force-exits non-zero when request or backup draining exceeds ten seconds.
- The scheduler resource column keeps an accessible name when total utilisation is hidden.
- The shared account API barrel now resolves from `@capacitylens/shared/account`.
- JavaScript-disabled loads now show one structured terminal explanation instead of loading copy.
- Company switches now clear stale resource navigation, drag, form-guard and notice state.
- Server startup now latches termination signals and stops at safe database checkpoints.
- Authentication, MFA enrollment and password-reset states now consistently use the message catalogue.
- UI mutation boundaries now surface store integrity failures without closing their dialogs.
- Select fields now round-trip every opaque option value without empty-sentinel collisions.
- Sectioned lists now reserve global first-item onboarding for wholly empty visible pages.
- SQLite foreign-key child lookups now use verified indexes for bounded cascade planning.
- Scheduler stories now use the required Utilisation terminology and current zoom-aware label.
- Import sanitisation now preserves intentionally blank optional resource roles.
- Resource soft-delete audits now name the allocation and time-off note fields they scrub.
- Repository tooling and contributor instructions now use pnpm consistently.
- Reconciliation-required command outcomes now carry a required command-correlated observation receipt.
- The public bug-report form now warns contributors to redact sensitive log content.
- Allocation gesture feedback failures no longer masquerade as rejected mutations.
- Pending command reconciliation now reports an observation time instead of a completion time.
- Authenticated session responses without a usable email now fail at the client protocol boundary.
- The parallel tenant-isolation login test now creates its own known-existing control company.
- Batch receipts now distinguish accepted operations from operations that actually changed state.
- Non-square profile photos now preserve their aspect ratio inside circular avatars.
- Migration rehearsal now preserves the original anonymisation error if rollback also fails.
- Malformed identity-provider session timestamps now fail as permanent contract errors instead of outages.
- MFA enrollment now moves keyboard focus into the newly revealed verification step.
- Local imports now clear remapped entity filters and selections while preserving display preferences.
- Lifecycle transitions now reject invalid archive times and preserve monotonic archive/delete history.
- Pre-rebrand theme preferences now migrate without flashing or resetting on the first CapacityLens load.
- Account-port timestamps now have an executable canonical UTC ISO-instant contract.
- Invitation acceptance and recovery copy now consistently uses the localisation catalogue.
- Invitation and password validation errors now identify and describe their offending form fields
  for assistive technology.
- Interrupting the strict-OIDC E2E harness now closes its fault proxy and removes its Dex container.
- Imports now supply safe names for nameless people and external companies while retaining
  deliberately nameless placeholder resources.
- Failed database migrations now restore foreign-key enforcement on the retained SQLite handle.
- Completed invitation commands with explicit expiries now replay their stable result after the
  invitation expires instead of being reclassified as invalid input.
- Email validation now applies its length limit after case normalization too, preventing Unicode
  case expansion from creating an oversized invitation or identity address.
- Allocation drags can now scroll to and reassign work onto resource rows outside the initially
  rendered virtual window while retaining the active source gesture.
- Shared date geometry helpers now safely reject invalid pixel widths and non-integer working-day
  counts instead of returning negative geometry or a plausible wrong date.
- Discipline delete controls now include their row name for screen-reader and voice-control users.
- Undo and redo integrity failures now appear as persistent scheduler errors instead of escaping
  the toolbar event handler without user-visible feedback.
- Session checks and lazily loaded sign-in, MFA and confirmation screens now show accessible loading
  status instead of leaving the page or action blank.
- Invalid production authentication modes now use the server's concise framed startup refusal
  instead of escaping as an unhandled configuration exception.
- Damaged imports containing null or primitive table rows now show a stable file-validation error
  instead of leaking an internal property-access failure.
- Authentication requests with malformed proxy authority headers now receive a bounded client
  error instead of generating an internal-server-error response.
- Refusing a SQLite file owned by another application no longer changes that unrelated file's
  permissions before CapacityLens establishes its identity.
- Keep scheduler scrolling responsive for large teams by locating the visible row window without
  scanning from the first row on every frame.
- Empty schedules now expose an ARIA row count and row index that include the rendered empty-state
  row, keeping screen-reader grid metadata consistent with the DOM.
- Lifecycle archive syncing now treats only an explicit already-inactive conflict as convergence;
  protected-row and other HTTP 409 responses remain visible and retryable.
- Database startup now rejects unlabelled SQLite files unless they match the distinctive legacy
  CapacityLens table, column and foreign-key chain, avoiding claims on unrelated databases.
- Allocation drops now refresh row hit-testing after viewport or lane resizes, preventing a
  mid-drag layout change from assigning work to the wrong person or no person.
- Scheduler model rebuilds now compute each resource-day capacity once even when the visible
  utilisation, fixed over-soon and timeline windows overlap.
- Client builds now canonicalise configured API origins, reject non-origin endpoint values and
  safely validate and encode feedback mailboxes instead of emitting malformed links.
- Trusted application branding now rejects oversized labels and excessive or oversized password
  context words before they reach identity configuration and password screening.
- Schedule filters now treat only matching work in the displayed timeline as a match, avoiding
  full-opacity rows with no matching bar.
- A new edit made during a company switch no longer hides the sticky loss notice for an older
  failed write; the new edit is preserved while the discarded one remains visible for re-entry.
- Drops exactly between adjacent schedule rows now select the following row instead of resolving to
  the preceding row through overlapping hit regions.
- Blocks dragged from an External row to a person now remain zero-hour blocks instead of gaining a
  hidden full working day of stored load.
- Company erasure now stops after bounded membership re-snapshot attempts and returns a retryable
  conflict instead of looping while membership keeps changing.
- Unmatched and stale URLs now open a branded Page not found screen with a route back to the
  schedule instead of a reload-only 404 recovery loop.
- Command-palette Internal projects now follow their schedule visibility preference, while Internal
  activities remain searchable because they open the complete management list.
- Mandatory-MFA enrollment now explains why an invitation or password-reset link is being held,
  including the sign-out path that reopens a reset link without the current session.
- Server-mode startup now verifies the session and any mandatory MFA gate before loading company
  data, avoiding doomed signed-out requests and misleading save-failure banners on login walls.
- Legacy Internal-client id adoption now requires a fresh Admin/Owner session for both direct and
  atomic batch writes, preventing Editors from replacing the server-managed singleton.
- Offline identity, company-directory and snapshot keys now include the canonical configured API
  origin, preventing a repointed frontend from restoring another backend's cached data.
- Failed lazy loads or startup errors in the getting-started tour now produce a persistent,
  localised error instead of an unhandled promise rejection.
- Invitation admission, preview, redemption and pruning now share fail-closed instant-based expiry
  semantics instead of comparing stored timestamp text.
- Leaving an invitation route while its post-acceptance company refresh is pending no longer lets
  the late completion replace the company selected on the destination route.
- Own-session revocation receipts now distinguish a deleted session from an idempotent no-op.
- Soft-deletes now remain chronologically ordered when an imported archive timestamp is ahead of
  the local clock, so later import repair cannot silently restore the deleted record to archived.
- Pending “Confirm it's you” actions now cancel when their authenticated host disappears and have a
  bounded fallback, preventing session expiry from leaving administrative controls busy forever.
- Invalid invitation pre-authorisation emails now mark and describe the offending field for
  assistive technology instead of relying only on the one-shot error announcement.
- Sign-in and mandatory MFA enrollment walls now replace stale in-app browser-tab titles with their
  own page purpose.
- Allocation and time-off writes and imports now reject calendar spans beyond the finite scheduling
  limit before capacity logic can expand them day by day.
- The canonical colour palette is now runtime-immutable, preventing swatches and membership checks
  from diverging after an unsafe consumer mutation.
- Project and phase writes now reject absent required parents at the shared domain boundary instead
  of relying on a later SQLite constraint error.
- Security settings now expose their card title as a heading, and their labels, password feedback
  and session-management notices use the translation catalogue.
- Legacy Internal-client repair now removes duplicate builtin rows even when corrupt input gives
  them the same primary id.
- Principal erasure now deletes scalar verification ceremonies inside SQLite and parses only
  structured candidates, avoiding a full verification-table transfer into JavaScript.
- Authenticated account-directory and permission refreshes now share one request per membership
  generation instead of issuing duplicate boot, company-switch and invalidation reads.
- Unexpected server failures whose wording mentions a constraint now remain logged 500 responses;
  only structured SQLite constraint errors are classified as caller-fault 400 responses.
- Member-management session results, unknown-command guidance and invitation-list failures now use
  the translation catalogue, and invite-read diagnostics name the list that is actually stale.
- Team-directory reads now evaluate identity-administration authority for all members from one
  company/actor snapshot instead of re-deriving the actor's full authority for every row.
- Activity, project, resource and time-off management lists now index relationship labels once per
  data change instead of scanning the complete related table again for every rendered row.
- Days and Blocks scheduling now reject spans that would extend beyond 31 December 9999, while
  defensive date derivation stays inside the supported four-digit-year domain.
- Invitation account validation now marks and describes only the credential field that failed,
  rather than announcing one field's error from every name, email and password control.
- Legacy Internal-client repair now preserves an ordinary client that already owns the generated
  id and selects a collision-free id for the protected singleton instead of failing migration.
- Demo and SQLite imports now discard properties outside each declared entity schema, preventing
  hand-edited fields from surviving only in the in-memory persistence mode.
- Colour contrast, palette snapping and bar styling now reject trailing non-hex nibbles instead of
  partially parsing malformed bytes into invalid CSS colours.
- Audit, offline-setup and failed-download warnings now resolve through the translation catalogue
  instead of leaking literal English into otherwise localised error surfaces.
- Time-off forms now hide and omit protected notes for Editors and Viewers, matching the server's
  role-based field projection instead of accepting input it would discard.
- Legacy account-variable deprecation warnings now appear once for each independently resolved
  environment instead of being suppressed globally after the first hosted instance warns.
- Import file reads now preserve the latest selection when an older, slower read finishes last.
- Atomic batches now reject a malformed duplicate of the Internal client generated during company
  creation instead of reporting that its ignored fields were applied.
- The mobile menu button now announces whether the sidebar sheet is open and whether activating it
  will expand or collapse the menu.
- The getting-started checklist now completes “Add your first person” only for an actual person,
  rather than treating a placeholder or external company as a person.
- Ambiguous company create and delete notices now use the translation catalog, keeping critical
  verify-before-retry guidance localisable alongside the rest of the company picker.
- Clearing device data now removes malformed or incompatible offline encryption keys as well as
  cached records, so encrypted offline access can recover without manually deleting browser data.
- Company-directory refreshes now share one monotonic sequence, preventing an older overlapping
  response from hiding a newly created or joined company or restoring a removed one in the picker.
- Sign-out now rejects blocked offline-cache upgrades and bounds browser-data cleanup, so a stale
  tab cannot indefinitely prevent the server sign-out request and mandatory reload.
- Legacy or direct-API companies missing language, week-start or time-zone settings can now set
  each value once, while malformed replacement values are ignored instead of returning a
  misleading immutable-field conflict.
- Returning from an offline cached company now keeps permissions pending and read-only until a
  fresh membership lookup resolves, rather than briefly restoring the pre-offline role.
- A session-expiry sign-in wall now warns when server-backed changes were still unsaved, instead of
  hiding that loss when it replaces the application and later reloads after sign-in.
- Working-day counts during long allocation gestures now parse the range start once instead of
  repeatedly parsing and formatting it for every day in the span.
- Returning focus now retries a stranded server write before refreshing, and a skipped refresh no
  longer suppresses the next visibility-based recovery attempt for 30 seconds.
- The local access-lab launcher now resolves the pnpm command on Windows for setup, compilation and
  both long-running development processes.
- Page teardown now dispatches no lifecycle archives when the ordering-dependent batch exceeds its
  operation or keepalive byte limit, preserving upserts-before-deletes as one dispatch decision.
- Member-management role, security and ownership controls now include their target member in their
  accessible names, and simultaneous reset/invitation copy buttons identify which link they copy.
- Duplicating an allocation now uses and validates the values currently shown in the form, instead
  of discarding unsaved edits or creating a zero-hour row that Save would reject.
- Allocation gestures now suppress success, capacity and undo feedback when a mid-gesture Viewer
  downgrade or vanished target causes the store to refuse the write.
- A cached-identity miss can no longer revoke a concurrently verified live identity's offline-cache
  scope and silently prevent account snapshots from being maintained for the rest of the session.
- Continuously visible server sessions now refresh their active company once per minute, so changes
  from other tabs or members appear without waiting for a focus event or a conflicting write.
- IndexedDB aborts now settle invalid-record deletion and current-user offline cleanup promptly,
  preventing cache reads or sign-out from waiting indefinitely on a transaction-only failure.
- Activity and discipline edit forms now stay open and report a conflict if the record changed or
  disappeared while it was being edited, instead of silently reporting a successful save.
- Global undo and redo shortcuts now yield for the full lifetime of an open modal, including clean
  forms whose focus is on a button, switch or other non-text control.
- The operator variable register now warns that disabling audit is development-only and that
  production refuses to start with `CAPACITYLENS_AUDIT=off`.
- Placeholder project rebinds and activity project changes now reject edits that would
  retroactively invalidate existing allocations, across local, direct-API and batch writes.
- Deep health now warns throughout the internal API certificate's 30-day renewal window, and the
  Compose smoke test plus upgrade guidance require coordinated renewal before expiry.
- Docker Compose now pins a stable project identity so checkout-directory renames cannot silently
  select fresh database, backup and internal-TLS volumes; upgrade guidance preserves legacy prefixes.
- Built-in Internal clients can no longer inherit archive or deletion tombstones through a
  legacy-id replacement; database v22 also reactivates any singleton damaged by an older server.
- Overlapping focus refresh and company-switch recovery can no longer pair one company's rendered
  data with another's sync snapshot, and generic sync batches can no longer request company erasure.
- Today and jump-to-date navigation now recenter from the newly rendered timeline geometry instead
  of using the previous view's horizontal offset for one commit.
- A batch rejected because another editor archived one of its referenced records now reconciles
  from server truth instead of retrying the permanently invalid edit on every recovery event.
- Ownerless-company repair now publishes its security outcome only after the corresponding database
  migration commits, avoiding successful-promotion logs for changes SQLite later rolls back.
- Sign-out now disables offline acceptance when browser storage is temporarily unavailable, so a
  stale cached identity cannot become eligible again merely because IndexedDB later returns.
- Existing scheduled and pre-migration backup directories are now tightened to mode `0700` before
  use, matching the documented privacy boundary instead of relying on creation-time permissions.
- Allocation drops immediately after scrolling now use the lanes' latest screen positions instead
  of committing against the pre-scroll layout.
- Switching between a specific activity and an all-activities-of-a-kind schedule filter now clears
  the previous activity lens, keeping the scheduler filter state unambiguous.
- Password-verification overload now surfaces the scrypt capacity failure instead of reporting a
  correct credential as a wrong password and obscuring the operational cause.
- Trusted reverse-proxy configuration now explicitly names and documents both of its security
  effects: forwarded client identity for rate limits and forwarded scheme for CSRF origin checks.
- Reduced-motion mode now bounds infinite spinner, skeleton and future utility animations to one
  near-instant iteration instead of repeatedly sampling them as a rapid flicker.
- The responsive Sidebar now forwards its documented class, style, accessibility and data props to
  the mobile sheet content just as it does to the desktop sidebar container.
- The first-run checklist now accepts wheel and touch scrolling when its floating card overflows a
  short viewport, while the schedule remains interactive outside the non-modal card.
- Guided-tour copy and its close control now use the AA-contrast muted ink token in both themes,
  while dimmed allocation bars retain the intended neutral-grey treatment in Time-off draw mode.
- Plaintext invitation and password-reset replay values now leave process memory after a bounded
  five-minute response-loss window instead of remaining cached for their full bearer lifetime;
  replay pressure refuses new issuance with retryable backpressure instead of silently evicting a
  completed response.
- Demo and local writes now reject new descendants and allocations beneath transitively archived or
  deleted parents, matching the scheduler's active-only visibility without blocking unrelated edits.
- Workspace erasure now classifies installation-wide verification state once for the complete set
  of orphaned principals instead of rescanning and reparsing it for every former member.
- Viewer allocation details are now reachable with Tab and dismissible with Escape, expose complete
  project/client and note context to assistive technology, and no longer advertise forbidden edits.
- Tailwind border-colour utilities now override the shared bare-border default, restoring intended
  transparent, warning, input, primary and destructive borders across the UI primitives.
- Long-lived schedules now advance the company-local today marker and fixed 14-day over-capacity
  warning at midnight and immediately after a backgrounded page resumes.
- Recent-authentication prompts now accept a stored recovery code as well as an authenticator code,
  preserving the user's in-progress work when their authenticator is unavailable.
- Sign-in metadata now drops unsupported named social providers at the untrusted server boundary,
  preventing version-skewed entries from rendering buttons that can only fail.
- Breached-password concurrency limits now remain held through bounded response-body consumption,
  preventing slow upstream streams from escaping the documented eight-active-call ceiling.
- Authentication security events now attribute successful sign-ins and authenticated operations
  to verified session principals, while failed credential submissions remain unattributed.
- Tenant-scoped SQLite reads and slice replacements now use per-table company indexes instead of
  scanning unrelated companies' rows, through the checksummed database-v21 migration.
- Unchecked switches now retain a visible thumb boundary in the light theme, meeting the 3:1
  non-text contrast threshold without changing their state or target size.
- Server shutdown now stops accepting requests while an active backup drains, while keeping SQLite
  open until both the request drain and backup stop have settled.
- Identity and invitation boundaries now reject control, zero-width, bidi and other disallowed
  Unicode characters before malformed or visually deceptive names and email addresses can persist.
- Password-reset timeout and server-error responses now show unknown-outcome guidance and direct the
  user to verify the new password, instead of reopening a consumed single-use token for retry.
- Redo after a synced lifecycle undo now unarchives the retained client, project or person before
  applying dependent edits, instead of issuing a generic write that leaves the row hidden.
- Offline read-only mode now marks membership resolution unavailable instead of presenting its safe
  Viewer projection as an authoritative role lookup.
- Password length checks now count Unicode code points consistently across setup, invitations,
  changes and resets, so astral characters no longer halve the documented 15–128-character range.
- Disabling offline access now removes every encrypted identity and account snapshot from the
  browser, and cache maintenance physically removes records older than seven days.
- Offline opt-in now waits for the application-shell worker to activate successfully before saving
  the device preference or reporting that offline access is ready.
- Trusted-local member role, removal and ownership-transfer routes now report that member
  management is unavailable instead of returning success for an inert request.
- Failed Google, Microsoft and GitHub sign-ins now return through the same marked, scrubbed error
  path as strict OIDC on both the login wall and recent-sign-in dialog.
- Partially migrated imports that contain both legacy tasks and current activities now merge
  distinct work and preserve dependent allocations, with current rows winning id conflicts.
- Database migration v8 now derives its repair and assertion contract from its immutable DDL,
  preventing fields owned by later schema versions from appearing before their ledger steps.
- Concurrent same-version API boots now recheck and validate migration state after acquiring the
  SQLite writer lock, so the process that waited treats the winner's committed step as a clean no-op.
- Member removal, password-reset issuance and session revocation now require a named confirmation,
  with explicit consequences when the operator targets their own access or current session.
- Local identity erasure now fails atomically on malformed object-shaped verification state instead
  of reporting success while retaining an uninterpretable principal link.
- Mandatory MFA enrollment now rejects malformed successful setup responses without replacing the
  recoverable password form or crashing while rendering recovery codes.
- MFA enrollment and step-up credential errors now mark and describe the input that needs
  correction, so assistive technology can rediscover the failure after its initial announcement.
- Batch validation now reuses indexed entity and dependent lookups, preventing max-size updates
  from rescanning a large tenant table once per operation while holding the SQLite transaction.
- Scheduled backups now use UTC-sortable names and protect the just-published recovery point during
  retention, preventing daylight-saving fall-back from deleting the snapshot reported as successful.
- Lifecycle import and purge guards now reject implementation-defined date shorthand and rolled
  calendar instants, preventing corrupt timestamps from unlocking destructive cleanup.
- Confirmed lifecycle actions now run in order behind an in-flight transition and its authoritative
  reload instead of silently dropping a second archive, restore, delete or purge.
- Lifecycle writes now reconcile HTTP timeout and server-error responses against authoritative
  company data before a destructive retry can proceed.
- Command-palette jumps now expand the target person's scheduler group before scrolling, so people
  inside collapsed disciplines no longer appear unreachable.
- Post-invitation company handoffs are now consumed after their first verified activation, so a
  later company-list refresh cannot pull the user away from their current company.
- Invitation creation now rejects ISO-shaped nonexistent calendar instants instead of silently
  rolling them into a different expiry date.
- Outstanding invitation expiry dates now use the viewer's local calendar instead of a bare UTC
  slice, avoiding an off-by-one displayed day near timezone boundaries.
- Import and load repair now reactivate a tombstoned built-in Internal client, preserving the
  visible singleton and its project-less work grouping after legacy or hand-edited data is read.
- HTTP 408 account-command responses now retain the existing retry identity, including invitation
  acceptance, preventing ambiguous timeouts from becoming duplicate semantic commands.
- The global sidebar shortcut now yields to text entry, IME composition and open modals instead of
  shifting page chrome and suppressing the active control's Cmd/Ctrl+B chord.
- Allocation drag and keyboard feedback now excludes retained work hidden beneath archived or
  deleted schedule parents, keeping capacity warnings aligned with the visible scheduler.
- Fractional backup-retention values once again floor within the supported range, preventing a
  configured `100.5` snapshots from silently reverting to 48 and pruning restore points early.
- Keyboard-focusable composed primitives now receive the same opaque, WCAG-conforming focus
  outline as native controls instead of relying on a faint half-alpha ring.
- Server hydration now commits a missing built-in Internal client before exposing repaired data,
  while duplicate-Internal repair gives every rewired project a fresh sync revision.
- Generic entity writes now reject descendants of archived or soft-deleted clients, projects and
  resources, preventing successful saves that immediately disappear from ordinary company views.
- Current-version database startup now rejects entity-table drift that would make normal writes
  fail, including unknown required columns, incompatible types, keys, constraints and table modes.
- Scoped PATCH and DELETE routes now return indistinguishable responses for absent and foreign-row
  ids, closing authenticated cross-company row-existence probes without changing auth-off deletes.
- Command reconciliation now fails closed on malformed or incomplete durable repair metadata,
  preserving the raw row instead of fabricating generic or null operator coordinates.
- Compose now provides an explicit static-only web service for in-memory demos and remote-API
  builds, with no local API dependency, certificate mount or API-based healthcheck.
- Completed company erasures now replay through their authenticated DELETE route after membership
  removal, while ambiguous post-delete 403 responses retain the browser's retry command.
- Administrative retries now retain their idempotency identity in page memory when browser session
  storage is blocked, preventing an unknown outcome from becoming a duplicate command.
- Sign-out now clears retained administrative retry identities, and the server rejects command
  replay across principals, preventing a shared tab from carrying one user's ceremony to another.
- First-company setup no longer exposes a spurious empty company list to assistive technology.
- Archived-item lifecycle controls now lock as a group while a mutation settles, preventing
  duplicate restore requests and giving slow operations a visible busy state.
- Lock-contended batches now classify create, update and delete audit records from the state that
  their transaction observes, preventing stale verbs or omitted mutation lines.
- Account-command integration guidance now requires independently generated, unguessable retry
  identities and explains the globally unique 30-day reconciliation namespace.
- Fresh mixed-auth deployments now show configured external providers beside first-owner password
  setup, making the documented OIDC bootstrap path reachable without a temporary local identity.
- Large atomic batches now maintain their validation mirror through indexed upserts and cascades,
  eliminating quadratic full-array rebuilding at the supported 5,000-operation boundary.
- Batch validation and account import now read only the tenant slices they mutate, preventing small
  requests from synchronously materialising every company's scheduling data.
- Scheduled backups now sync their completed file and published name before pruning older recovery
  points, then sync retention deletions, making successful snapshots durable across power loss.
- Avatar initials now preserve emoji and other astral-plane leading characters instead of
  rendering a broken replacement glyph.
- Authenticated batches now resolve repeated same-company permissions once per authorization
  snapshot, avoiding thousands of duplicate membership reads while retaining the post-lock recheck.
- Audit rotation now accounts for the next serialized line before writing and rejects an individual
  over-cap entry into the durable outbox, enforcing the configured two-generation disk bound.
- Unreadable or unrecognised account-command conflict responses now retain the original browser
  retry identity, preventing an ambiguous response from minting a duplicate administrative command.
- Rejected allocation deletions now keep the editor open and surface the safe failure reason instead
  of throwing past the modal error boundary.
- Destructive alert body text now uses the opaque danger token, clearing WCAG AA contrast on the
  light card surface instead of becoming sub-AA through transparency.
- Authenticated company switches now publish the new tenant with a fail-closed local role, closing
  the interval in which an imperative write could inherit the previous company's authority.
- Stalled state requests that reach their client deadline now use an eligible seven-day offline
  snapshot instead of bypassing read-only recovery with a timeout error.
- Unsaved-change guards now aggregate each open form independently, so a clean overlapping dialog
  cannot disable reload, palette or undo protection for an editor that is still dirty.
- Rejected cross-row allocation drags now leave their dates and hours unchanged instead of silently
  committing the horizontal part of the gesture on the original row.
- Batch sync now requires one authoritative server revision for every written row and reloads the
  company before further writes when a successful receipt is absent, partial or mismatched.
- Imports now reject a present malformed schema version instead of interpreting it as a legacy
  file and potentially normalising away data from an incompatible format.
- Server shutdown now attempts backup stop, request drain and database close independently, then
  exits non-zero if any stage failed instead of abandoning all later cleanup.
- Failed service-worker upgrades can no longer mix a new application entry point with missing
  hashed assets; each shell is staged privately and promoted only after it is complete.
- Detaching a persistence owner now suppresses its late save callbacks, conflict reloads and retry
  timers, preventing an obsolete lifecycle from writing stale state over its replacement.
- Scheduled-backup retention now excludes the open database by path and filesystem identity, so a
  snapshot-shaped live filename in the backup directory can never be pruned as an old restore point.
- SQLite now rejects cross-company parent references and immutable-tenant changes at the database
  boundary, preventing otherwise valid foreign-key cascades from mutating the wrong company.
- Sign-out and device-data cleanup now invalidate offline-cache writes that were already encrypting,
  preventing a late identity, company list or company snapshot from recreating cleared data.
- Pre-migration rollback snapshots now sync their completed file and published directory entry
  before startup may begin forward-only schema changes.
- Company-setting updates now reject a non-active company target and leave undo/redo untouched for
  a stale missing id, closing a cross-company local-store seam.
- The local store's viewer guard now covers company creation as well as scoped edits, preventing an
  ungated caller from adding a company, built-in client or picker summary in read-only state.
- Creating another company through an existing Owner/Admin role now requires a fresh administrative
  session before granting the caller a new Owner membership.
- Company erasure now preserves in-flight and repair-required command records, so a concurrent
  password-invitation signup can still compensate or expose exact reconciliation state.
- Invalid password-invitation signup requests now validate their bearer token before reserving a
  durable command, preventing unauthenticated requests from amplifying SQLite writes.
- Single-row SQLite writes now commit their entity and first-write marker atomically, so a marker
  failure cannot persist a create or update while the API reports that it failed.
- Scheduled SQLite snapshots are now integrity-checked before publication and retention, preventing
  an invalid copy from replacing the last known-good restore point under a success log.
- Replacing the active company slice can no longer retain a company id that the slice omits;
  CapacityLens returns to the picker and rejects scoped edits instead of creating orphaned rows.
- Command reconciliation now serializes with the command's live executor before aging stale pending
  work, preventing a reset or session-revocation side effect from occurring after the ledger has
  already declared that same execution abandoned.
- Parallel background and page-teardown saves are now ordered per browser session, preserving the
  newest edit or undo regardless of request arrival order while retaining conflicts for intervening
  external writes.
- Page-teardown sync now excludes unchanged rows whose server revisions were already acknowledged,
  keeping the final keepalive delta focused on genuinely unsaved changes.
- Editing an existing allocation in Blocks mode now preserves its historical hours, so switching
  back to Hours or Days restores the prior capacity instead of leaving the allocation at zero.
- Company-picker errors and warnings now render in the global notification host, including refused
  or uncertain company deletions before a company has been opened.
- Packaged Docker Compose deployments now resolve the default audit path to the persistent database
  volume instead of passing an empty filename that degrades the local audit sink on its first write.
- Invitation management no longer fails for upgraded companies that retain an already-used legacy
  Owner invite; live and supported historical invitations remain visible and revocable.
- Hashed browser assets in the packaged web image now retain their one-year immutable cache policy
  instead of being captured by the generic file-extension location and served as `no-store`.
- Password-reset and invitation links now follow the router's trailing-slash and case-insensitive
  matching rules before sign-in, preventing valid link variants from falling back to the login wall.
- Command-palette person jumps are now consumed after the target row is reached, preventing later
  schedule edits or layout changes from scrolling back over the user's newer position.
- Command-palette search now folds case and decomposable diacritics, so unaccented queries find
  accented people, projects, clients, activities, pages and actions.
- The operations runbook now provides an executable, ownership-preserving restore and rollback
  procedure for the database and snapshot volumes created by Docker Compose.
- Authentication request timeouts now use the documented offline read-only identity fallback when
  available and otherwise report a connectivity failure instead of a malformed server response.
- Repeated attempts at a failing database migration now atomically refresh one verified rollback
  snapshot per version pair instead of accumulating a full database copy on every process restart.
- The first-owner bootstrap-claim table now advances through checksummed database migration v20,
  so upgrades are snapshotted and exact schema drift is refused before authentication starts.
- Imported and direct-API entity colours now snap to their nearest preset through the same shared
  mapping as interactive edits, preserving distinct legacy hues instead of flattening them to blue.
- Database upgrades from every shipped v8–v15 schema now reach v16 in order, and the retained
  auth-off/password fixture matrix verifies data preservation, schema convergence, integrity and
  idempotent reopen for every released top-level version.
- Allocation capacity advice is now memoised and bounded; Hours-mode and External date spans over
  36,500 days are rejected before a render can enumerate millions of calendar days.
- Migration rehearsals now preserve anonymised verification-to-user linkage and assert the exact
  invite and verification rows that migrations are expected to revoke, so destructive repairs can
  no longer become silent no-ops or false preservation failures in the release gate.
- A cached company-directory fallback no longer marks an already-open live company read-only or
  displays the directory cache timestamp as if it described the rendered company data.
- Client and project edit forms now reject a stale Save when a background refresh has loaded a
  newer copy, preventing unchanged form fields from silently overwriting concurrent edits.
- Product mutations now commit a data-minimised audit event to a SQLite outbox in the same
  transaction, then deliver ordered, fsynced and replay-idempotent JSONL records across restarts.
- Password invitation onboarding now commits the local user, credential link and command-to-
  principal correlation in one SQLite transaction, preventing crash-orphaned identities.
- Archived-and-deleted exports now use the central purge-tier authorization gate, including its
  fresh-session requirement and structured step-up refusal event.
- Account erasure now fails closed when a corrupt id-only relationship would cascade a delete or
  unbind into another company, preserving both tenants for explicit operator repair.
- Imports now remove allocation and time-off notes attached to deleted people, matching the privacy
  erasure performed by the interactive resource-deletion path.
- Page-teardown persistence now waits for lifecycle archive receipts before marking deletions clean,
  so a surviving page surfaces and retries a dropped keepalive request instead of losing the intent.
- The installation-wide test reset route is now unavailable whenever authentication is enabled,
  preventing any signed-in principal from wiping unrelated tenants on a staging or development host.

## [0.26.0-alpha.1] — 2026-07-21

This minor release lands the fixes from a full-codebase review: multi-user sync correctness
(phantom writes, purge revision stamping), scheduler data-loss and HiDPI display bugs, restored
keyboard dismissal of the allocation popover, and a consolidation of the server's write pipeline
that also removes full-database scans from single-entity writes.

### Fixed

- Stopped the sync layer re-sending unchanged rows after a save was acknowledged. The
  acknowledged-revision translation is now durable instead of consume-once, so an edited-once row
  no longer generates phantom writes for the rest of the session — writes that could advance the
  row's server revision and cause another user's legitimate edit to be rejected and discarded.
- Purging a project or client now stamps a fresh revision onto the rows the delete cascade
  mutates (placeholder resources unbound from the project, activities unbound from a phase).
  Previously those rows kept their old timestamp, so a colleague's already-open session could
  fail validation with an unrecoverable error and be stuck unable to save until a manual reload;
  now it gets the normal conflict-and-reload path.
- Resizing a days-mode allocation that currently spans only non-working days no longer silently
  zeroes its hours per day; the stored value is preserved.
- Scheduler visible-window calculations now round sub-pixel scroll positions (as the week-snap
  path already did), so utilisation percentages on HiDPI screens are computed over exactly the
  window on screen rather than one day earlier.
- Escape closes the allocation detail popover again while keeping focus on the bar — restoring
  the keyboard dismissal that the alpha.9 click-behaviour fix removed — without reintroducing
  click-to-dismiss for viewers.
- Repairs to the built-in Internal client (name, colour, builtin flag) made during data
  migration now persist to the server instead of being re-applied in memory on every load.

### Changed

- Consolidated the server's four separately-maintained generic-entity write paths (create,
  replace, patch and batch) into a single shared pipeline. Error messages that had drifted
  between the copies are unified, and malformed array request bodies are now rejected on create
  and patch as they already were on replace.
- Centralised the role-gated field policy (time-off notes, private client/project names) into
  one declarative map that drives read redaction, write-side pinning and export visibility, so a
  future gated field cannot be wired into fewer than all three.
- Single-entity writes now validate against the writing account's data slice instead of loading
  the entire multi-tenant database on every request, so write latency scales with the account,
  not the server.
- The scheduler model computes its capacity and utilisation day windows once per rebuild instead
  of once per resource, and date-range expansion parses its input once instead of per day —
  removing thousands of redundant date operations per scroll step on large teams.

## [0.25.0-alpha.9] — 2026-07-21

This patch release fixes regressions from the alpha.8 scheduler popover migration (accessibility,
click behaviour, layering, toolbar breakpoint) and keeps its intentional improvements.

### Fixed

- Kept the scheduler allocation popover on-screen by repositioning it near viewport edges instead
  of letting it clip offscreen.
- Sized dialogs against the visible viewport height so they fit correctly when mobile browser
  chrome is showing.

## [0.25.0-alpha.8] — 2026-07-21

This patch release completes the shadcn consolidation by removing overlapping UI abstractions and
aligning form, feedback and scheduler controls on shared primitives. It does not change the portable
export or SQLite database schema versions.

### Changed

- Unified shadcn primitives and CapacityLens UI compositions on one semantic colour system and
  removed the parallel generic Button, feedback and string-icon APIs.
- Simplified the colour picker around the standard shadcn Popover lifecycle and reused the shared
  segmented-control composition in the scheduler toolbar.
- Updated browser coverage to exercise Radix select, toggle-group, alert-dialog and portalled
  popover behaviour through their accessible semantics.

### Fixed

- Restored visible invalid states for text inputs and text areas, and ensured Select-only edits
  activate the unsaved-form guard.
- Made empty-state edit permissions explicit instead of inferring them from presentation icons.
- Preserved inline activity creation and selection inside allocation forms after adopting the
  controlled shadcn Select lifecycle.

## [0.25.0-alpha.7] — 2026-07-21

This patch release standardises the application navigation on the shadcn Sidebar while preserving
CapacityLens's existing destinations, account controls and compact scheduler layout. It does not
change the portable export or SQLite database schema versions.

### Added

- Added the shadcn Sidebar, Sheet and Skeleton primitives as the shared application-navigation
  foundation.
- Added focused browser coverage for desktop collapse, compact landscape navigation and the
  portrait off-canvas menu.

### Changed

- Rebuilt the application menu with shadcn groups, menu items, semantic tokens and tooltips while
  retaining import/export, account switching, sign-out and permission context.
- Kept collapsed destinations as real links and moved portrait navigation into an off-canvas Sheet
  that closes after selecting a destination.

### Fixed

- Ensured the mobile menu toggle reports the Sheet's actual expanded state to assistive technology.
- Updated sidebar comments and tests to describe the current navigation model instead of the
  retired icon-rail implementation.

## [0.25.0-alpha.6] — 2026-07-21

This patch release completes the alpha UI alignment around shadcn primitives while preserving the
scheduler's purpose-built timeline. It replaces the remaining parallel component patterns in the
agreed surfaces without changing the portable export or SQLite database schema versions.

### Added

- Added the shadcn Item family as the shared composition for compact management and administrative
  rows.

### Changed

- Migrated management lists, Members, Archived, Team, account selection and invitation surfaces to
  shadcn Item, Card, Field, Alert and Badge compositions.
- Replaced the scheduler's remaining native text, date, select, checkbox, toggle and row-action
  controls with shadcn and Radix primitives while retaining the bespoke timeline grid.
- Aligned operator documentation with the existing rate-limit exemption for the public health
  probe.

### Fixed

- Kept empty member-directory copy outside ARIA list semantics and added regression coverage.
- Updated component comments and operator documentation to describe current behavior rather
  than retired implementation details.

## [0.25.0-alpha.5] — 2026-07-21

This patch release completes the alpha UI consolidation around shadcn primitives outside the
scheduler's purpose-built dense editing surface. It reduces the amount of custom interaction code,
standardises accessibility semantics and keeps product-specific wrappers focused on domain behavior.
It does not change the portable export or SQLite database schema versions.

### Added

- Added shadcn Alert Dialog, Avatar, Card, Checkbox, Field, Label, Select, Spinner, Toggle and Toggle
  Group primitives as the shared vocabulary for application UI composition.

### Changed

- Migrated authentication, onboarding, account selection, invitations, member administration,
  settings, command palette, app-shell utilities and recovery screens to shadcn cards, fields,
  controls and overlays.
- Rebuilt shared form fields, segmented controls, confirmations and modal behavior as thin
  compositions over shadcn and Radix primitives, including native alert-dialog, combobox, radio and
  switch semantics.
- Retained native selects only in the scheduler allocation workflow, where compact keyboard-heavy
  editing benefits from the browser control and remains covered by the existing scheduler contract.
- Simplified comments around the migrated UI foundations so they describe current constraints and
  behavior instead of past implementation decisions.
- Updated interaction tests to exercise the public shadcn/Radix semantics rather than native-select
  internals or bespoke dialog markup.

### Verification

- Passed TypeScript compilation and ESLint with zero warnings.
- Passed all 1,779 application tests across 114 test files.
- Passed the production build and bundle budget at 151,198 bytes gzip for the main bundle.

## [0.25.0-alpha.4] — 2026-07-21

This patch release removes the local SmallSass sibling handbook and extraction workspace from the
published CapacityLens repository. The files remain available locally but are now ignored by Git,
keeping product changes and release commits focused on CapacityLens.

### Changed

- Added `/to-my-siblings/` to `.gitignore` so the local handbook, reference kit, planning records
  and extraction work no longer appear as application changes.
- Removed the previously tracked sibling material from the Git index without deleting the local
  working copy or rewriting repository history.

## [0.25.0-alpha.3] — 2026-07-21

This patch release consolidates the browser UI on shadcn primitives and trims stale implementation
history from source comments and architecture guidance. It does not change the portable export or
SQLite schema versions.

### Changed

- Added shadcn Alert, Dialog, Empty and Switch primitives, then composed product callouts, empty
  states, toggle fields and compatible modal behavior from them.
- Replaced bespoke link-button styling with the shadcn Button composition API and clarified that
  `components/ui` owns generic primitives while `components/common` owns product-specific behavior.
- Updated access, persistence, tenancy, invitation and password-reset comments to describe their
  current contracts without obsolete phase or ticket narratives.
- Updated contributor guidance to keep implementation history in version control and reserve
  source comments for current invariants, constraints and operationally necessary compatibility.

### Removed

- Removed the unused temporary-worker badge component and its tests, matching the standing product
  decision not to display employment-type badges in the roster or schedule.

### Verification

- Passed the application and server gates, including 2,546 unit/integration tests, coverage,
  type-checking, lint, production build and bundle budget.
- Passed all 186 Playwright browser tests, including modal, empty-state and accessibility coverage.

## [0.25.0-alpha.2] — 2026-07-18

This Alpha 2 minor release completes the provider-neutral account boundary, strict OIDC support and
the separation-of-concerns pass across the application shell, scheduler, persistence and server
lifecycle paths. It also promotes the local release checklist into independently visible CI gates
and records a complete local certification across unit, integration, migration, browser, OIDC,
dependency-audit and mutation suites.

The portable export format remains at schema v8. SQLite databases advance from v14 to v15 to add
durable account-command and reconciliation state; existing databases receive the normal verified
pre-migration rollback snapshot before the forward-only migration runs.

### Added

- Added provider-neutral identity and account-administration ports, a policy-owned command
  coordinator and idempotent/reconcilable cross-port flows. Architecture tests keep product routes,
  orchestration and account policy away from raw identity and membership storage.
- Added Better Auth, trusted-local and vendor-free identity implementations behind one capability-
  aware contract suite, with normalized unsupported-capability and correlated command outcomes.
- Added durable SQLite account-boundary state for command attempts, compensation and reconciliation,
  together with an operator reconciliation command and explicit database migration v15.
- Added first-class strict OIDC with exact issuer/discovery pinning, bounded no-redirect discovery
  and user-info fetches, signed ID-token verification, JWKS rotation, subject binding, verified-email
  admission and pre-authorised invitation/bootstrap controls.
- Added a digest-pinned Dex browser matrix covering successful sign-in, invitation admission,
  provider denial, malformed discovery and provider unavailability without weakening password mode.
- Added a first-class **Team & access** destination, persistent role summaries, safe invitation
  previews, write-once invite/reset links and an isolated Owner/Admin/Editor/Viewer access lab.
- Added focused app-entry, shell, team-directory, scheduler-viewport and allocation-gesture
  controllers; runtime-preference and scheduler-navigation store slices; and a shared server
  lifecycle transition pipeline for archive, restore, soft-delete and purge.
- Added independent GitHub jobs for workflow analysis, application/server gates, account-boundary
  conformance, released-database migration rehearsal, production dependency audit, cross-browser
  E2E, strict OIDC, container smoke/security scans, CodeQL, Scorecard, SBOM and hardened ZAP checks.

### Changed

- Routed browser account operations, invitation signup, member administration, password/session
  reset, workspace provisioning and erasure through the account boundary while preserving server-
  side authorization as the independent tenant backstop.
- Made `SMALLSASS_ACCOUNT_*` the canonical account configuration namespace. Existing CapacityLens
  and Better Auth spellings remain temporary warning aliases; conflicting canonical and legacy
  values refuse startup.
- Promoted strict OIDC from experimental status. Hosted deployments can enforce an OIDC-only
  profile, while named social providers remain experimental and password authentication remains
  the stable default.
- Single-sourced application-data keys and parent-before-child write order across imports, browser
  persistence and SQLite, with compile-time completeness checks for every scoped table.
- Replaced independent persistence callbacks with one identity-safe coordinator and separated
  application entry, global shell effects, scheduler rendering, viewport measurement and allocation
  gestures into cohesive modules with explicit interfaces.
- Centralised exact pre-authentication route classification and account-keyed Team & access state,
  and made controlled form dirtiness an explicit contract for button-driven controls.
- Kept mutation certification focused on pure domain and helper logic; React hook effects and event
  orchestration remain covered by component and cross-browser behavior tests.

### Fixed

- Fixed privileged Team & access drafts, confirmations, locks, notices and write-once bearer links
  surviving a company switch or being replaced by late member, invitation, reset, session or
  clipboard completions from the previous company.
- Fixed invitation-refresh failures erasing the last authoritative same-company list, and kept
  administrative controls fail-closed while permissions or the current directory are unresolved.
- Fixed controlled radio, switch and colour no-ops marking forms dirty, the immediate-Escape dirty-
  state race, and one-use joined-company query cleanup affecting later navigation.
- Fixed Firefox ResizeObserver updates dispatching during Strict Mode replay, WebKit lazy-route
  import races, cold-start database fetch races and shared-SQLite Playwright resets interrupting
  another test's account read.
- Fixed E2E date determinism without virtualising animation frames or timers, and removed inherited
  colour-control and account-deployment variables from isolated browser/OIDC/access-lab processes.

### Security

- Enforced durable federated identity linking by `(issuer, subject)`, verified-email admission and
  unused pre-authorised invitations; local erasure never deletes an upstream identity.
- Kept identity deletion, account membership/invitation erasure and scheduling-data erasure under
  separate owners, with compensating/reconcilable command outcomes instead of cross-boundary SQL.
- Enforced exactly one active Owner per member-bearing company, with deterministic legacy repair,
  a definition-checked partial unique index and ownership changes only through atomic transfer.
- Coupled password-reset and session-revocation authority to identity-global execution revisions,
  kept bearer capabilities out of command/audit records and redacted invitation tokens from request
  and structured security logs.
- Hardened database startup and upgrades with application-id checks, future-version refusal,
  immutable migration-ledger checksums, production configuration validation and verified rollback
  snapshots before DDL.

### Verification

- Passed 1,782 application tests with enforced coverage and production bundle budgets, 767 server
  tests, 120 account-conformance tests and the released v7→v15 migration/recovery rehearsal.
- Passed 528 Chromium, Firefox and WebKit E2E tests plus the strict-OIDC healthy, malformed-discovery
  and unavailable-provider phases.
- Found no known high-severity production dependency vulnerability.
- Reviewed 3,068 pure-logic mutants: 2,823 killed by assertions, 11 timed out, 190 survived, 44 had
  no coverage and none errored, for a 92.37% score against the 85% release threshold.

## [0.24.1-alpha.2] — 2026-07-18

This Alpha 2 patch hardens the local release-certification path after running the complete gate
across the application, server, migrations, all supported browsers, strict OIDC and production
dependencies, followed by a reviewed 92.37% pure-logic mutation score. There is no application-data,
export-schema or database-schema change.

### Changed

- Made browser dates deterministic without virtualising timers or animation frames, keeping
  date-sensitive schedule assertions stable while preserving native interaction timing.
- Made Playwright wait for the proxied API health endpoint before starting database, password-auth
  and OIDC browser tests, and serialised the shared-SQLite project so one reset cannot interrupt
  another test's account read.
- Moved auth-backed E2E and the isolated access lab onto the canonical `SMALLSASS_ACCOUNT_*`
  configuration names, stripping hostile inherited account settings before applying the lab's
  fixed loopback-only posture.
- Kept mutation certification focused on pure domain and helper logic by explicitly excluding React
  hook orchestration, whose effects and events remain covered by component and cross-browser tests.

### Fixed

- Fixed a Firefox development-mode render-phase warning caused by redundant ResizeObserver updates;
  viewport and sticky-header measurements now dispatch only when dimensions actually change.
- Fixed a WebKit lazy-module import race by removing a redundant navigation from the command-palette
  test, and fixed cold-start database fetch failures by verifying the complete Vite-to-API path.
- Fixed inherited colour-control variables producing contradictory runner warnings in the full
  cross-browser and strict-OIDC launchers while retaining deterministic non-colour output.

## [0.24.0-alpha.2] — 2026-07-18

This Alpha 2 release completes a broad separation-of-concerns pass over the application shell,
scheduler, account administration, persistence and server lifecycle paths. Behaviour remains
compatible with the previous alpha: there is no export-schema or database-schema change.

### Added

- Added a typed Team & access client that validates untrusted member, invitation and one-time-token
  responses once, then exposes semantic success, rejection, unknown-outcome and invalid-response
  results to the UI.
- Added focused controllers for the account-keyed team directory, app entry sequence and global
  shell effects, including route titles, invite handoff, notices, unload protection and shortcuts.
- Added dedicated scheduler viewport and allocation-gesture hooks, separating DOM measurement,
  scroll anchoring, virtualisation and drag/reassignment behaviour from rendering.
- Added runtime-preference and scheduler-navigation store slices, and extracted the server's
  archive, restore, soft-delete and purge routes into one lifecycle transition pipeline.
- Added regression coverage for account switches during privileged operations, invitation reload
  failures, write-once bearer-link cleanup, controlled dirty forms and one-use URL handoffs.

### Changed

- Single-sourced the complete application-data key set and parent-before-child write order across
  migration, browser sync and SQLite persistence, with compile-time completeness checks.
- Replaced four independent persistence callbacks with one identity-safe coordinator registration,
  keeping refresh, flush, suspension and unsaved-write state under one lifecycle owner.
- Centralised exact pre-authentication route classification for invitation and password-reset URLs,
  so malformed or nested variants continue to fail closed behind the login wall.
- Made form dirtiness an explicit contract for button-driven controls while retaining a safe native
  event fallback for ordinary inputs and third-party controls.

### Fixed

- Fixed Team & access state crossing company boundaries: drafts, confirmations, action locks and
  freshly minted invite/reset links are now discarded immediately when the active company changes.
- Fixed late member, invitation, password-reset, session and clipboard completions updating the
  newly selected company or replacing its notices.
- Fixed an invitation-list refresh failure erasing the last authoritative same-company list, and
  kept privileged directory controls fail-closed until the current company has been authorised.
- Fixed no-op radio, switch and colour selections falsely marking a modal dirty, while closing the
  immediate-Escape race before a controlled dirty prop can re-render.
- Fixed the joined-company handoff cleanup stripping query parameters from later navigation; the
  bootstrap query is now consumed exactly once.

### Security

- Prevented stale cross-company administration outcomes and write-once bearer capabilities from
  remaining visible or surfacing feedback after an account switch.
- Kept member-management rendering fail-closed during permission loading and directory errors; the
  server remains the independent authorization backstop for every tenant operation.

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
  CapacityLens/Better Auth spellings remain warning aliases until both two stable minor releases and
  90 days have elapsed from the first stable release carrying the namespace. The alpha does not
  start that clock; conflicting values now refuse startup.
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
  surfaces a plain-language notice — _change or delete fewer items at a time_ — and stops
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
  during an in-flight import is intentionally _not_ flushed on tab-close (flushing it would insert
  stale pre-import rows into the freshly imported data), and data written by a _newer_ app version
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
  _overrides_ the backend origin rather than switching the server on, and an empty value means
  "same-origin", not "localStorage". The in-browser localStorage app is demoted to an explicit
  opt-in.
- **`pnpm run dev` is now full-stack.** It boots the SQLite API (`:8787`) and the web app
  (`:5173`) together through a dev proxy, and requires **Node 24** (`node:sqlite`).
  `pnpm run dev:web` is the previous Vite-only, server-mode command.
- **Docker / Compose default to a portable same-origin server build.** An empty
  `VITE_CAPACITYLENS_API` now builds an image that works on any host with no per-host rebuild
  (nginx proxies `/api` same-origin); the demo image is built with `VITE_CAPACITYLENS_DEMO=1`.

### Added

- **`VITE_CAPACITYLENS_DEMO=1` demo build** — the only route to the zero-setup, no-backend,
  no-login in-browser localStorage app (the old default). It wins over `VITE_CAPACITYLENS_API`
  when both are set. A build served without a same-origin `/api` backend (a static host,
  `vite preview`) must use this flag, or it boots into a "can't reach the server" state.
- **`pnpm run dev:demo`** — a Vite-only localStorage preview (no server, no Node 24) for a
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

- **Task kinds — Project, Internal, and Repeatable.** Every task now has a kind. _Project_ tasks
  belong to a project (as before); _Internal_ tasks are your own non-client work (admin, internal
  reviews); and _Repeatable_ tasks are reusable across many projects (Design, Workshop, Meeting).
  The Tasks page groups them into three sections, and the Add/Edit task form lets you pick the kind —
  a project is required only for _Project_ tasks.
- **Filter the schedule by task.** A new **Filter by task** dropdown gives you a "task view" of the
  schedule — see all of a repeatable or internal task's work (e.g. _all design_, _all internal time_)
  across every project at once. It's a standalone lens: picking a task clears the client/project
  filter and vice-versa, so you're always looking through exactly one.

### Changed

- **"General tasks" are now "Repeatable tasks".** Existing project-less tasks become _Repeatable_ on
  upgrade — your data migrates in place. Reclassify any that are really _Internal_ via the task form.

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

- **Demo sign-in screen.** A Google-style _"Choose an account"_ screen now appears before the
  company picker in the default deploy, to preview the intended "sign in, then pick a company"
  flow. It is **not** real authentication — there's no password and no popup; clicking the
  account just continues. You stay "signed in" across reloads, with **Sign out** on the picker
  and in the sidebar to return to it. It never appears when the optional real login wall
  (`CAPACITYLENS_AUTH`, formerly `FLOATY_AUTH`) is enabled.

## [0.4.0] — 2026-06-16

Cross-browser end-to-end test coverage.

### Added

- **Firefox/Gecko E2E coverage.** `pnpm run e2e:firefox` runs the core specs on Firefox
  (mirroring the existing Safari/WebKit twin), and the new **`pnpm run e2e:browsers`** runs them
  on all three engines — Chromium + WebKit, then Firefox. Both stay opt-in, so Chromium remains
  the default `pnpm run e2e` inner loop, and the multi-engine runs need only Vite (no SQLite/auth
  server, no Node 24). Firefox always runs after WebKit and unconditionally; a run fails if any
  engine fails. `pnpm run e2e:all` now adds Firefox on top of its WebKit + server-backed coverage.

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

[Unreleased]: https://github.com/Kevinjohn/capacitylens/compare/v0.39.2-alpha.1...HEAD
[0.39.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.39.1-alpha.1...v0.39.2-alpha.1
[0.39.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.39.0-alpha.1...v0.39.1-alpha.1
[0.39.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.38.2-alpha.1...v0.39.0-alpha.1
[0.38.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.38.1-alpha.1...v0.38.2-alpha.1
[0.38.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.38.0-alpha.1...v0.38.1-alpha.1
[0.38.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.37.0-alpha.1...v0.38.0-alpha.1
[0.37.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.36.0-alpha.1...v0.37.0-alpha.1
[0.36.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.7-alpha.1...v0.36.0-alpha.1
[0.35.7-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.6-alpha.1...v0.35.7-alpha.1
[0.35.6-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.5-alpha.1...v0.35.6-alpha.1
[0.35.5-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.4-alpha.1...v0.35.5-alpha.1
[0.35.4-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.3-alpha.1...v0.35.4-alpha.1
[0.35.3-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.2-alpha.1...v0.35.3-alpha.1
[0.35.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.1-alpha.1...v0.35.2-alpha.1
[0.35.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.35.0-alpha.1...v0.35.1-alpha.1
[0.35.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.34.0-alpha.1...v0.35.0-alpha.1
[0.34.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.33.1-alpha.1...v0.34.0-alpha.1
[0.33.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.33.0-alpha.1...v0.33.1-alpha.1
[0.33.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.32.0-alpha.1...v0.33.0-alpha.1
[0.32.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.31.4-alpha.1...v0.32.0-alpha.1
[0.31.4-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.31.3-alpha.1...v0.31.4-alpha.1
[0.31.3-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.31.2-alpha.1...v0.31.3-alpha.1
[0.31.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.31.1-alpha.1...v0.31.2-alpha.1
[0.31.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.31.0-alpha.1...v0.31.1-alpha.1
[0.31.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.30.0-alpha.1...v0.31.0-alpha.1
[0.30.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.29.0-alpha.1...v0.30.0-alpha.1
[0.29.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.6-alpha.1...v0.29.0-alpha.1
[0.28.6-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.5-alpha.1...v0.28.6-alpha.1
[0.28.5-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.4-alpha.1...v0.28.5-alpha.1
[0.28.4-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.3-alpha.1...v0.28.4-alpha.1
[0.28.3-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.2-alpha.1...v0.28.3-alpha.1
[0.28.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.1-alpha.1...v0.28.2-alpha.1
[0.28.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.28.0-alpha.1...v0.28.1-alpha.1
[0.28.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.3-alpha.6...v0.28.0-alpha.1
[0.27.3-alpha.6]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.3-alpha.5...v0.27.3-alpha.6
[0.27.3-alpha.5]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.3-alpha.4...v0.27.3-alpha.5
[0.27.3-alpha.4]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.3-alpha.3...v0.27.3-alpha.4
[0.27.3-alpha.3]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.3-alpha.2...v0.27.3-alpha.3
[0.27.3-alpha.2]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.3-alpha.1...v0.27.3-alpha.2
[0.27.3-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.2-alpha.1...v0.27.3-alpha.1
[0.27.2-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.1-alpha.1...v0.27.2-alpha.1
[0.27.1-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.27.0-alpha.1...v0.27.1-alpha.1
[0.27.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.26.0-alpha.1...v0.27.0-alpha.1
[0.26.0-alpha.1]: https://github.com/Kevinjohn/capacitylens/compare/v0.25.0-alpha.9...v0.26.0-alpha.1
[0.25.0-alpha.9]: https://github.com/Kevinjohn/capacitylens/commit/308ed761b00fb9976b3269129266c88afd4509cb
[0.25.0-alpha.8]: https://github.com/Kevinjohn/capacitylens/commit/bd4058e3b14f9f31c907ac0935612a8b0f49cfeb
[0.25.0-alpha.7]: https://github.com/Kevinjohn/capacitylens/commit/b4394254a843e1f868bf1ac4ccace74e043847bb
[0.25.0-alpha.6]: https://github.com/Kevinjohn/capacitylens/commit/d0506d5ff809411ebf34429d3d5280d3dbe4e13d
[0.25.0-alpha.5]: https://github.com/Kevinjohn/capacitylens/commit/4e9d325a4ebdb06a522e53a7749abfd55bdd2e9a
[0.25.0-alpha.4]: https://github.com/Kevinjohn/capacitylens/commit/67f4a75d2a8c2c140304a65e67653324cb4e55a0
[0.25.0-alpha.3]: https://github.com/Kevinjohn/capacitylens/commit/c9aeedd5009891b53f0ff72326d04176bc382976
[0.25.0-alpha.2]: https://github.com/Kevinjohn/capacitylens/compare/v0.24.1-alpha.2...v0.25.0-alpha.2
[0.24.1-alpha.2]: https://github.com/Kevinjohn/capacitylens/compare/v0.24.0-alpha.2...v0.24.1-alpha.2
[0.24.0-alpha.2]: https://github.com/Kevinjohn/capacitylens/compare/v0.23.4-alpha.0...v0.24.0-alpha.2
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
[0.17.2]: https://github.com/Kevinjohn/capacitylens/commit/b81aecfe80c73df807139abe93e7233ab207c212
[0.17.1]: https://github.com/Kevinjohn/capacitylens/commit/53cadc102c0c8e741c30271562ec58faeb7773b4
[0.17.0]: https://github.com/Kevinjohn/capacitylens/commit/0930dd377ae66443475099942509378ffff68e00
[0.16.0]: https://github.com/Kevinjohn/capacitylens/commit/0930dd377ae66443475099942509378ffff68e00
[0.15.8]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.8
[0.15.7]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.7
[0.15.6]: https://github.com/Kevinjohn/capacitylens/releases/tag/v0.15.6
[0.15.5]: https://github.com/Kevinjohn/capacitylens/commit/0930dd377ae66443475099942509378ffff68e00
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
