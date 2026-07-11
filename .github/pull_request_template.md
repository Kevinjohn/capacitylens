## What & why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm run gate` passes locally (typecheck, lint, unit tests, build)
- [ ] `pnpm run gate:server` passes if `server/` or `shared/` changed (needs Node 24)
- [ ] E2E (`pnpm run e2e`) passes if UI behaviour changed
- [ ] Kept the PR small and focused (see CONTRIBUTING.md)
- [ ] No new dependencies without discussion
