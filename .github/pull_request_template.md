## What & why

<!-- One or two sentences. Link the issue if there is one. -->
<!-- Opening this PR does not authorise merging it. Leave it open until the maintainer explicitly
authorises the merge of this specific PR. -->

## Checklist

<!-- “if … changed” selects extra focused local checks. The full gate and browser suites run on
main pushes, schedules or by manual dispatch; check the workflow files for current PR checks. -->

- [ ] `pnpm run gate` passes locally (typecheck, lint, unit tests, build)
- [ ] `pnpm run gate:server` passes if `server/` or `shared/` changed (needs Node 24)
- [ ] `pnpm run test:account-conformance` passes if authentication, accounts, invitations, membership, authorization, session or erasure behavior changed
- [ ] E2E (`pnpm run e2e`) passes if UI behaviour changed
- [ ] Provider sign-in, callback, invitation-admission or session changes have focused authentication coverage
- [ ] `pnpm run rehearse:migrations` passes if database migrations, persisted auth shape or Better Auth changed
- [ ] Account-security changes update the applicable version and propagation evidence described in [CONTRIBUTING.md](../CONTRIBUTING.md#account-security-versioning)
- [ ] Kept the PR small and focused (see CONTRIBUTING.md)
- [ ] No new dependencies without discussion
- [ ] Added a changelog entry for user-visible behavior
- [ ] Considered security, privacy, accessibility and migration impact
- [ ] Every commit has my author/committer `Signed-off-by` trailer (`git commit -s`)
