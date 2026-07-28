# Contributing to CapacityLens

Thank you for helping. Small, focused pull requests with tests are easiest to review and merge.
For feature proposals, first check the deliberate scope in [DECISIONS.md](DECISIONS.md): budgets,
timesheets, hour-by-hour workflows and mobile scheduling are not planned.

## Set up

```bash
nvm use
corepack enable
pnpm install
pnpm run dev
```

`pnpm run dev:demo` starts the temporary in-memory demo without SQLite or authentication. The
workspace contains the web app, the pure `@capacitylens/shared` domain package, and the server.

## Before opening a pull request

```bash
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

Authentication, account, invitation, membership, authorization, session and erasure changes must
also run the portable account boundary check. Identity-provider and OIDC changes additionally run
the pinned reference-provider browser suite. The OIDC suite requires a working Docker installation
because it starts the digest-pinned Dex reference provider in a local container:

```bash
pnpm run test:account-conformance
pnpm run e2e:oidc
```

Run `pnpm run rehearse:migrations` whenever a change touches a database migration, persisted
authentication shape or Better Auth version.

### Account-security versioning

When account-security behavior changes, update the version at the boundary that owns the rule:

- portable identity behavior: the account contract and every `IdentityPort` conformance fixture;
- database/auth-library behavior: the minimum-security or schema version and its migration/rehearsal evidence;
- browser/server propagation: the shared command version and the tests proving every implementation accepts it.

The pull-request description should name the changed version and link the conformance, migration,
or propagation test that proves all implementations moved together. If no version changes, explain
why the change preserves the existing contract.

## Formatting

Prettier owns whitespace, quoting and line breaks. The only project setting is `printWidth: 120`;
everything else is stock. Run `pnpm run format` before committing — `pnpm run gate` fails on
unformatted files.

Style is not reviewable: if Prettier produced it, it is correct. Reach for `// prettier-ignore`
only when a hand-aligned block genuinely reads better, and say why in the patch.

Run the applicable cross-browser suite for interaction or layout changes:

```bash
pnpm run e2e:webkit
pnpm run e2e:firefox
pnpm run e2e:browsers
pnpm run e2e:all
```

These conditions are local-development guidance for choosing extra checks before opening a pull
request. Pull-request CI deliberately runs account conformance, released-database rehearsal, the
complete Chromium/Firefox/WebKit suite and strict OIDC conformance on every change, regardless of
paths, so required checks always exist and cross-cutting regressions cannot evade them.

User-visible changes should update `user-stories/REFERENCE.md`, the matching story and its E2E
spec. New domain fields must flow through shared types, full fixtures, server table columns and
sanitisation so the compile-time exhaustiveness checks can protect them.

## Engineering standard

Read [DEFENSIVE-CODING.md](DEFENSIVE-CODING.md) before changing a data path. In brief:

- Surface errors; never silently swallow them.
- Keep account reads scoped and let the server enforce membership on every write.
- Put environment-independent domain rules in `shared/`; do not duplicate them in UI/server code.
- Preserve the three distinct workload signals and their time windows.
- Add tests that fail without the change.
- Never commit secrets, production data, generated output or personal deployment notes.

Authentication and offline-cache changes need explicit threat-oriented tests. Social/OIDC support
is experimental, so provider-specific changes must remain secure when configuration is missing,
partial or malicious.

## Pull requests

- Explain what changed and why.
- Link an issue when one exists.
- Keep unrelated formatting and refactors out of the patch.
- Note operational, migration, privacy or accessibility impact.
- Add an entry under `CHANGELOG.md` → `Unreleased` for user-visible changes.

Every commit must include a [Developer Certificate of Origin](https://developercertificate.org/)
sign-off:

```bash
git commit -s -m "Describe the change"
```

By contributing, you agree that your contribution is licensed under AGPL-3.0-only. The project
does not currently require a copyright assignment or CLA.

## Community and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). For ordinary help use
[SUPPORT.md](SUPPORT.md). Never disclose a vulnerability in a public issue; use the private route
in [SECURITY.md](SECURITY.md).
