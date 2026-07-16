# 15 — Agent operating manual

This chapter tells a coding agent how to work in a sibling repository without rediscovering its
architecture or eroding its invariants.

## First fifteen minutes

Read completely:

1. root `AGENTS.md`;
2. `DECISIONS.md`;
3. `DEFENSIVE-CODING.md`;
4. relevant `user-stories/REFERENCE.md` section;
5. relevant operator/development docs;
6. canonical shared types and policy;
7. tests nearest the requested behaviour.

Then inspect:

```bash
git status --short
git log -8 --oneline --decorate
rg --files <relevant-directories>
rg -n '<route|label|field|type|invariant>' .
```

Assume existing uncommitted changes belong to the user. Preserve them.

## Source-of-truth order

When prose conflicts:

1. executable behaviour/tests;
2. current implementation;
3. root agent/standing/defensive rules;
4. exact user-story reference;
5. operator docs;
6. sibling handbook/general pattern.

Do not quietly choose one. Repair stale documentation as part of the change when in scope.

## Classify the request

- **Answer/review**: inspect and report; do not mutate.
- **Diagnose**: find cause and evidence; do not implement unless asked.
- **Change/build**: implement, test and document.
- **Release/publish**: confirm version/CI policy and external side effects.
- **Operate external system**: stay within explicitly authorised systems/actions.

Do not turn “review” into a refactor or “fix CI” into unrelated cleanup.

## Make an impact map before editing

For a visible feature list:

- canonical domain type;
- shared rule/validator;
- fixtures/migrations/sanitiser;
- store/data adapter;
- server schema/route/auth;
- UI/routes/messages;
- unit/server/E2E tests;
- user-story reference;
- changelog/operator docs;
- family handbook rule if reusable.

For a bug, trace from observed surface to the authoritative rule. Fix the narrowest correct layer.

## Architecture placement questions

Ask:

- Must browser and server agree? Put pure policy in `shared/`.
- Is it client orchestration/history/id/time? Put it in the store.
- Is it transport/cache/retry? Put it in `src/data/`.
- Is it visual/local interaction? Put it in component/hook.
- Is it authorization/transaction/authoritative revision? Put it on server.
- Is it device-only? Keep it outside account data.
- Is it operator-only? Environment/runbook, not Settings.
- Is it genuinely identical across proven siblings? Record it as an extraction candidate; do not
  add an internal dependency to the public product before another consumer exists.

Reject convenient duplication across layers.

## Data-path change protocol

1. Define missing/default semantics.
2. Update shared type.
3. Update every full fixture.
4. Update server columns.
5. Decide portable export and physical database version changes independently.
6. Add the next immutable physical migration/checksum and historical database fixture when needed.
7. Update import sanitisation.
8. Update interactive validation.
9. Update relationship and tenant enforcement.
10. Update privacy projection.
11. Test round-trip, malformed, migration and cross-tenant paths.
12. For schema changes, run the release rehearsal against a released fixture and an anonymised
    representative installation.
13. Update docs/changelog.

Search every field literal to find forgotten transfer, conflict or echo paths.

## Auth/security change protocol

- Threat-model identity, membership, action and field visibility separately.
- UI gate and server authorization both change.
- Unknown/malformed state fails closed.
- Test every role.
- Test direct/forged requests.
- Test cross-account ids.
- Test write echoes, conflict responses, exports and inactive reads for leakage.
- Preserve last-owner/privilege interlocks.
- Validate provider/env configuration at boot.
- Update auth/self-host/privacy docs.

Never weaken server checks because a button is hidden.

## UI change protocol

- Use canonical message function; no scattered visible literal when it belongs in messages.
- Use semantic tokens; no raw chrome colour.
- Use common component kit.
- Provide visible/accessibility name.
- Associate errors.
- Handle viewer/feature-off/empty/loading/error/offline.
- Preserve focus, Escape, keyboard and dirty-form ownership.
- Check light/dark and compact viewport.
- Update route title/nav/palette/tour together when applicable.
- Update user-story reference first for route/label/test-id/seed change.

## Async mutation audit

Before calling done, reason through:

- double click/submit;
- component unmount;
- tenant switch;
- stale earlier response after newer response;
- timeout after server commit;
- retrying non-idempotent action;
- pending ordinary save;
- role/session change;
- import/reload replacement;
- failure surface and recovery.

Use sequence/account tags and authoritative reconciliation where needed.

## Error audit

Search affected files for `catch`. For each:

- visible surface or justified preference fallback?
- full cause preserved?
- generic copy discarding safe detail?
- deterministic error retried forever?
- unknown outcome asserted as failure?
- programmer/integrity throw swallowed?
- secret/value logged?

Follow the repository's defensive standard, not blanket try/catch.

## Testing sequence

Run narrow first:

```bash
pnpm exec vitest run path/to/test
pnpm --filter <server-package> exec vitest run path/to/test
pnpm exec playwright test e2e/relevant.spec.ts
```

Then the required green gate:

```bash
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

For schema-bearing work, also run the repository's migration rehearsal command and record the
source/target versions plus table/row counts. See chapter 18.

Use the repository's actual scripts and pinned Node version. Stop conflicting dev servers before
Playwright; never reuse a server of the wrong persistence flavour.

For docs-only changes, still verify links/format and run the repository-prescribed gate unless the
user explicitly narrows verification.

## Test design

- Prove the edge that caused or could cause the bug.
- Prefer role/name interactions.
- Use full fictional fixtures.
- Control clocks/promises.
- Test server authorization independently of UI.
- Keep E2E browser-agnostic.
- Do not relax coverage/lint to make a change pass.
- Do not update screenshots without inspecting them.

## Documentation sequence

- Standing rule → `DECISIONS.md`.
- Agent-size invariant → `AGENTS.md`.
- Exact visible fact → `user-stories/REFERENCE.md` then story/index.
- Public capability/non-goal → `README.md`.
- Contributor implementation → `docs/development.md`.
- Operator action → self-host/auth/offline/privacy/runbook.
- User-visible change → `CHANGELOG.md` Unreleased.
- Reusable family lesson → this handbook.
- Reusable internal lesson → update this handbook or a reference snapshot without changing public
  product surfaces unnecessarily.

Avoid duplicating one detailed procedure in five files; link to its authority.

## Git discipline

- Inspect status before and after.
- Edit with patches; keep scope small.
- Never reset/checkout over user changes.
- Avoid mass formatting unrelated files.
- Do not commit unless requested.
- Do not push/open PR unless requested.
- Follow version-specific GitHub CI policy.
- Report new/modified files and verification accurately.

## Handoff format

Lead with outcome:

- what changed;
- key decisions/invariants;
- verification run and result;
- any deliberately unrun expensive/external check;
- any remaining blocker/risk;
- links to the most useful files.

Do not claim “all tests pass” if only a narrow test ran.

## Red flags that require stopping

- requested action would destroy or overwrite unrelated user changes;
- missing user choice materially changes product/security result;
- production secret/provider/host access is required but not authorised;
- licence/legal decision is being inferred;
- database migration cannot be made backward/forward safe under known constraints;
- same blocking condition persists after safe alternatives are exhausted.

Ask a concise question only when a reasonable assumption would be risky.

## Agent quality checklist

- I read the local instructions fully.
- I preserved the product boundary.
- I located the authoritative policy.
- I did not make the public product depend on unproven internal family machinery.
- I kept tenant/security checks server-side.
- I validated untrusted success and failure data.
- I handled async ambiguity/races.
- I used semantic design and accessible interaction.
- I updated all persistence/migration fixtures for new fields.
- I kept portable and physical schema versions separate and did not edit a shipped migration.
- For schema changes, the checksum ledger, rollback snapshot and failure rehearsal passed.
- I updated exact visible docs and changelog.
- I ran proportionate narrow and broad checks.
- I preserved unrelated user work.
- My handoff distinguishes facts, assumptions and unrun checks.
