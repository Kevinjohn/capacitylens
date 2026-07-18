## What & why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm run gate` passes locally (typecheck, lint, unit tests, build)
- [ ] `pnpm run gate:server` passes if `server/` or `shared/` changed (needs Node 24)
- [ ] `pnpm run test:account-conformance` passes if authentication, accounts, invitations, membership, authorization, session or erasure behavior changed
- [ ] E2E (`pnpm run e2e`) passes if UI behaviour changed
- [ ] Strict OIDC E2E (`pnpm run e2e:oidc`) passes if identity-provider, login, callback, invitation-admission or session behavior changed
- [ ] `pnpm run rehearse:migrations` passes if database migrations, persisted auth shape or Better Auth changed
- [ ] Account-security changes update the applicable contract, conformance or minimum-security version and propagation evidence
- [ ] Kept the PR small and focused (see CONTRIBUTING.md)
- [ ] No new dependencies without discussion
- [ ] Added a changelog entry for user-visible behavior
- [ ] Considered security, privacy, accessibility and migration impact
- [ ] Every commit has a `Signed-off-by` trailer (`git commit -s`)
