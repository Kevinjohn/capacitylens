# 00 — Sibling contract

This is the compact internal agreement every sibling should review before product code begins. It
is stronger than a style guide, but it is not a public CapacityLens compatibility scheme. Each
product records its adopted defaults and proves its behaviour through its own tests and gates.

## Family promise

Sibling products should feel as if the same thoughtful team built and operates them:

- narrow product scope and explicit non-goals;
- a small, legible TypeScript architecture;
- familiar navigation, form, feedback and onboarding behaviour;
- the same semantic Tailwind language and accessibility bar;
- secure multi-tenant boundaries enforced on the server;
- a self-hostable core that remains useful without the hosted service;
- loud failures on data paths and recoverable operations;
- local quality gates that make a green change meaningful;
- documentation written for a newcomer and an agent reading the repository cold.

Consistency is a feature. It lowers training cost for users, implementation cost for agents, and
operating cost for the maintainer.

## Non-negotiable family invariants

### Product

- State the one job of the product and the granularity at which it works.
- Publish non-goals before accepting features.
- Prefer one coherent workflow over a broad suite.
- Use the product's chosen noun consistently; do not ship two labels for the same concept.
- Treat empty, first-run and failure states as product surfaces, not afterthoughts.

### Architecture

- Keep a pure shared domain core independent of React, HTTP and SQLite.
- Keep client state orchestration at a named seam rather than scattered across components.
- Keep server persistence and authorization authoritative in normal deployments.
- Use an explicit in-memory demo adapter; a missing server must never silently become local
  persistence.
- Depend inward: UI and server may import shared policy; shared policy imports neither.

### Data and security

- Every tenant-owned entity carries its tenant id.
- The selected tenant is transient and never persisted as account data.
- Server authorization derives from the authenticated session and membership on every operation.
- UI permission gates improve UX; they never replace server authorization.
- Validate all untrusted input, including successful HTTP response bodies.
- Interactive forms reject invalid input. Import and server boundaries may sanitise only when the
  repair is safe, explicit and tested.
- Multi-row replacements are transactional.
- Unknown roles, malformed auth data and ambiguous security state fail closed.
- Secrets, real customer data and production identifiers never enter fixtures, screenshots or logs.

### Reliability

- Surface errors. No empty catch on a data path.
- Preserve error causes when adding context.
- An operation with an unknown network outcome must reconcile authoritative state before offering a
  retry.
- Do not overwrite unsaved local work with a refresh.
- Backups are online snapshots copied off-host and restore-tested.
- Offline access, if offered, is an explicit, expiring, read-only snapshot. Never queue offline
  writes unless a future product deliberately accepts the conflict model.

### Design and accessibility

- Use semantic tokens (`canvas`, `surface`, `ink`, `brand`, `danger`), never scattered palette
  literals in components.
- Blue is identity/navigation, green is positive action, red is destructive/error.
- Colour is additional meaning, never the only meaning.
- Light and dark themes are first-class and share the same semantic API.
- Interactive controls have accessible names, keyboard behaviour and visible focus.
- Errors are associated with the relevant field or surfaced persistently.
- Reduced motion, landmarks, skip links, page titles and modal focus are part of the baseline.

### Engineering

- Strict TypeScript, zero lint warnings and type-aware promise rules.
- Co-locate unit/component tests; keep E2E specs browser-agnostic.
- Use fictional test data.
- New persisted fields flow through type → fixtures → SQL columns → migration/sanitisation → tests.
- User-visible route, label, test-id or seed changes update the reference contract first.
- User-visible behaviour updates the changelog.
- No dependency is added merely to avoid writing a small, clear helper.

### Open source and hosted service

- The community application must remain independently useful.
- Hosted billing, fleet management and proprietary deployment glue stay outside the community core.
- Do not make the self-hosted edition artificially unreliable to advantage the hosted service.
- State licence, contribution, governance, support, privacy and trademark boundaries plainly.

## Defaults that may be changed deliberately

The current family defaults are:

| Area | Default |
| --- | --- |
| Web | React, TypeScript, Vite |
| Styling | Tailwind CSS v4 semantic tokens; shadcn `new-york` primitives where useful |
| Client state | Zustand |
| Domain | Pure TypeScript workspace package |
| API | Fastify |
| Authentication | Better Auth; password stable, OIDC/social experimental until proven |
| Database | Node built-in SQLite, WAL, foreign keys |
| Validation | Pure validators plus throwing write boundaries |
| Tests | Vitest, Testing Library, Playwright, axe, mutation tests for selected pure logic |
| Deployment | Same-origin web/API behind TLS, Docker Compose or Node/nginx |
| Offline | Opt-in, seven-day, read-only snapshot |
| Licence | AGPL-3.0-only for the networked community application |
| Governance | Maintainer-led while the community is small |

Change a default when the product has evidence, not because a new library is fashionable. Record the
reason, migration consequence, operating consequence and reversal cost.

## CapacityLens-specific facts that siblings replace

Do not inherit these literally unless the sibling is also a capacity scheduler:

- clients → projects → activities;
- resources → allocations → time off;
- week-granularity planning;
- visible-window utilisation and a fixed fourteen-day warning;
- external resources having no capacity;
- the exact sidebar destinations;
- the first-client/project/person/allocation checklist;
- the word `Utilisation`.

Inherit the pattern: canonical nouns, explicit relationships, pure invariants, state-derived
onboarding steps and distinct signals with distinct windows.

## Exception protocol

When a sibling deviates from a family invariant or default:

1. Name the user or operator problem.
2. Identify the inherited rule.
3. Explain why the rule does not fit this product.
4. State the replacement rule in present tense.
5. Cover security, privacy, accessibility, migration and self-hosting effects.
6. Add acceptance evidence.
7. Record it in that sibling's `DECISIONS.md`.

“This product is different” is not enough. The exception should teach the next sibling something.

## Decision hierarchy

Use the following order when rules collide:

1. User safety, tenant isolation and data integrity.
2. The sibling's explicit product boundary.
3. The sibling's written standing decisions.
4. Family invariants in this handbook.
5. Family defaults.
6. Local implementation convenience.

## Definition of family resemblance

A sibling is recognisably part of this family when a maintainer can answer yes to all of these:

- Can a newcomer identify what the product deliberately does not do?
- Can an agent find the canonical type, policy and write boundary in minutes?
- Can an operator deploy it from one complete environment register?
- Does a failed server save remain visible and recoverable?
- Does every tenant request prove membership server-side?
- Do forms, buttons, tokens and feedback feel familiar?
- Can keyboard and screen-reader users complete the primary flow?
- Can a self-hoster back up, restore and upgrade it without private knowledge?
- Does the local green gate cover the actual delivery shape?
- Is the community edition whole, rather than a teaser for the SaaS?

## Definition of internal technical alignment

Family resemblance is a human judgement. For internal planning, a sibling is technically aligned
when its own evidence shows the adopted account envelope, access hierarchy, semantic tokens,
authentication posture, self-hosting topology and defensive rules remain true. The product's own
tests and three green gates are authoritative.

The optional manifest/schema in `reference-kit/` can record provenance and intended defaults, but it
does not certify compatibility and must not be added to CapacityLens's public build merely to make
the internal label machine-checkable. Chapter 17 explains when repeated code has earned extraction
into a genuine shared package.
