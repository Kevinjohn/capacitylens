# 11 — Testing, quality and delivery

The family quality model is layered: pure rules prove edge semantics, components prove accessible
interaction, server tests prove authorization/transactions, and browser tests prove the shipped
topology.

## Local green gate

Every sibling should expose three obvious commands:

```bash
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

CapacityLens `gate`:

- compiles typed messages;
- type-checks;
- lints with zero warnings;
- runs Vitest with coverage floors;
- builds production SPA;
- enforces main-entry bundle budget.

`gate:server`:

- type-checks server/shared;
- runs server tests;
- lints server/shared with type-aware rules.

`e2e`:

- Chromium demo flows;
- database-backed flows;
- password-auth flows.

The commands are intentionally memorable. A contributor should not need tribal knowledge to run the
real check.

## Test layers

### Pure domain tests

Cover:

- equality/boundary semantics;
- date math;
- lifecycle transitions;
- role/action matrix;
- cross-tenant references;
- cascade rules;
- migration/sanitisation;
- colour contrast;
- import remapping;
- projection of private fields.

These are fast and should enumerate edge cases densely.

### Store/data tests

Cover:

- every CRUD mutation;
- tenant scoping and selected-tenant transience;
- undo/redo;
- persistence diff ordering;
- retries/conflict/oversize;
- refresh/switch races;
- import suspension;
- offline expiry/scoping;
- malformed successful response bodies.

Race tests should control promises explicitly rather than rely on timing.

### Component tests

Use Testing Library from user semantics:

- role/name queries;
- field/error association;
- visible permission affordances;
- dirty-dialog behaviour;
- focus/keyboard;
- state-derived onboarding;
- conditional feature screens;
- light integration with store/provider.

Do not assert implementation class strings unless the visual language itself is the contract.

### Server tests

Exercise Fastify by injection against temporary/in-memory SQLite:

- auth modes and boot refusals;
- each role/action;
- cross-account access;
- full response redaction, including errors/conflicts/write echoes;
- atomic batch/import rollback;
- optimistic concurrency;
- last-owner and cross-account credential interlocks;
- lifecycle routes;
- account erasure;
- health, rate limits, headers, logging/audit;
- backups and restore.

Test every creation vector when enforcing a global invariant such as single-company cap.

### Browser tests

Separate flavours:

- **demo**: fast core UI, no server/auth;
- **db-backed**: same-origin proxy to SQLite;
- **auth-backed**: fresh password server and real session flows;
- **rehearsal**: optional production build/topology.

Keep core specs browser-agnostic. Run WebKit and Firefox against the same demo specs periodically or
before meaningful releases.

## Accessibility and visual evidence

- Axe checks on primary pages and modal states.
- Dedicated keyboard acceptance flows.
- Light/dark screenshot oracles for complex visuals.
- Contrast helper tests for semantic/user colours.
- No reliance on native title/hover where focus/touch needs the explanation.

E2E should select by role/name first. Stable `data-testid` is acceptable for visual/canvas/state
hooks that have no useful accessible query; user-visible changes to those hooks update the reference.

## Coverage and mutation

Coverage floors make accidental untested growth visible; CapacityLens currently enforces roughly:

- statements 84%;
- branches 78%;
- functions 85%;
- lines 86%.

Do not chase coverage by testing getters or implementation trivia. Raise/retain meaningful floors and
exclude generated/boot/config-only files deliberately.

Use mutation testing selectively for pure decision-heavy helpers: validation, dates, calculations,
onboarding completeness and filters. It catches tests that execute a comparison without proving
`>` versus `>=`.

## Fixture rules

- Use fully populated fixtures, not `as Entity` partial lies.
- Use fictional names, domains, ids and notes.
- Never copy production/customer data into screenshots or stories.
- Keep immutable sanitised database fixtures from every released physical schema version and each
  supported auth shape; tests copy them before migration and never rewrite the committed artifact.
- Keep time-sensitive seed dates frozen in E2E or derive them explicitly.
- One fixture factory per canonical shape where useful.
- When a field is added, compiler/test failures should reveal every full fixture needing a decision.

## User stories as acceptance index

CapacityLens keeps:

- `user-stories/REFERENCE.md`: exact routes, labels, test ids, seed facts and shared rules;
- individual runnable stories;
- `user-stories/README.md`: story-to-test index.

Update the reference first for visible route/label/test-id/seed changes. This reduces stale browser
tests and gives agents an exact observable contract.

A sibling can use a smaller version, but should retain one authoritative visible-behaviour document.

## Defensive-code review

Review every catch:

- does it preserve cause;
- does a human see the failure;
- is the fallback truly non-load-bearing;
- could it convert a failed write into silent loss;
- is a pure function being wrapped unnecessarily?

Review every async mutation:

- double submit;
- unknown outcome;
- stale account/result;
- unmount/cancellation;
- lost response after commit;
- retry determinism/idempotency;
- permission change mid-flight.

## Documentation gate

For each change ask:

- `AGENTS.md` invariant changed?
- `DECISIONS.md` standing decision changed?
- user-story reference/stories changed?
- public README changed?
- operator docs/environment changed?
- changelog entry required?
- sibling handbook family rule changed?

Public README explains product/use. Implementation detail belongs in development/operator docs.

## CI shape

Recommended independent signals:

- gate/typecheck/lint/unit/build/audit;
- E2E;
- Docker Compose production smoke;
- CodeQL;
- OpenSSF Scorecard;
- dependency updates.

Pin CI actions to immutable SHAs. Use concurrency cancellation. Upload failure artifacts briefly.
Separate badges so “gate green” does not imply E2E/container smoke ran.

### CapacityLens pre-launch/private policy

The repo deliberately skips automatic runner jobs while private; manual dispatch runs the complete
remote gate. Making it public restores PR/main/tag/scheduled runs.

Repository-specific release instruction:

- patch-version-only change: skip GitHub CI by default;
- minor version: ask whether to run GitHub CI;
- major version: GitHub CI must run.

Each sibling should copy this only while it has the same private-runner economics, and record its own
policy in `AGENTS.md`.

## Release process

- Semantic Versioning.
- Before 1.0, minor may break; changelog must say how to migrate.
- User-visible changes under Unreleased as they land.
- Patch is fixes/docs/metadata; minor adds capability; major changes compatibility contract.
- Keep root/server/shared package versions aligned when released together.
- Tag immutable source.
- Read changelog, back up and smoke test deployment.
- For schema-bearing releases, run the migration rehearsal against a released fixture and an
  anonymised representative installation; retain its version/table/row result as release evidence.

Avoid version churn merely to make CI run. CI policy should not distort version meaning.

## Definition of done

A change is done when:

- scope matches the product boundary;
- canonical policy is in the right layer;
- unsafe/invalid states are rejected or repaired at the correct boundary;
- UI covers empty/loading/error/read-only/offline as relevant;
- server enforces tenant/role independently;
- tests prove happy, edge, failure and race paths in proportion to risk;
- accessibility names/focus/contrast work;
- docs/reference/changelog are current;
- relevant local gates pass;
- no unrelated user changes were overwritten;
- handoff names what changed and what was verified.
