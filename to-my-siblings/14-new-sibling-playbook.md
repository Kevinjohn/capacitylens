# 14 — New sibling playbook

This is the shortest responsible route from a new idea to a recognisably related, operable product.
It front-loads decisions that are expensive to retrofit and postpones domain breadth.

## Before creating a repository

Write one page containing:

- working product name and distinct public mark;
- specific user;
- recurring decision/problem;
- primary granularity;
- smallest valuable outcome;
- four to six canonical nouns;
- five explicit non-goals;
- likely sensitive fields;
- self-hosted user and hosted buyer;
- why hosted convenience is worth paying for;
- mobile posture;
- one-company versus multi-company default.

If this page is vague, repository scaffolding creates motion, not progress.

## Create from the golden reference

Do not begin with an empty Vite application or hand-copy a checklist. From the current reference
checkout run:

```bash
node to-my-siblings/reference-kit/scripts/create-sibling.mjs \
  --name "Product Name" --slug product-name ../product-name
cd ../product-name
corepack enable
pnpm install
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

The generated repository is a working, rebranded CapacityLens fork with provenance. It deliberately
retains the scheduling domain as tested example code. Replace that domain slice-by-slice while
keeping the app deployable; read `to-my-siblings/reference-kit/starter/START-HERE.md` before editing.

## Phase 0 — Decide the inheritance

For each family default mark:

- **Copy** — same decision.
- **Adapt** — same pattern, new domain.
- **Replace** — different decision with written reason.
- **Defer** — not in first release.

Minimum table:

| Area | Copy/adapt/replace/defer | Decision |
| --- | --- | --- |
| Stack/workspace |  |  |
| Domain/tenant model |  |  |
| Auth modes |  |  |
| Roles |  |  |
| Onboarding |  |  |
| Navigation |  |  |
| Design tokens |  |  |
| Mobile |  |  |
| Offline |  |  |
| Self-hosting |  |  |
| Licence/hosted boundary |  |  |
| Quality/CI policy |  |  |

Record replacements in `DECISIONS.md`.

## Phase 1 — Establish public and agent contracts

Create/adapt:

- `README.md` — thesis, non-goals, quick start, stack, docs.
- `AGENTS.md` — short load-bearing repository guidance.
- `DECISIONS.md` — present-tense constraints.
- `DEFENSIVE-CODING.md` — copy family error/comment standard and rename examples.
- `CHANGELOG.md` — Keep a Changelog + SemVer.
- community/governance/security/support/trademark files.
- `user-stories/REFERENCE.md` — routes/labels/seed/test hooks even if initially small.

The generator creates these from the proven reference. Use [templates](templates/README.md) when
rewriting them for the new promise. Remove every inherited scheduler-specific noun/link before
shipping; retain deliberate CapacityLens attribution only in `to-my-siblings/smallsass.origin.json`
and migration history.

Definition of done:

- an agent can state scope, architecture, invariants and gate without opening implementation;
- a contributor knows licence and support boundary;
- an operator knows whether the product is production-ready yet.

## Phase 2 — Scaffold the architecture

The generator has already copied:

- pnpm workspace and pinned Node/package manager;
- root/web, `shared/` and `server/` packages;
- strict tsconfigs separated by environment;
- ESLint flat config with type-aware promise rules;
- Vite aliases/plugins;
- Vitest configurations;
- semantic `index.css` and component kit;
- Docker/Compose/nginx skeleton;
- `.env.example` structure;
- GitHub issue/PR/dependency/CI files.

Review and replace:

- CapacityLens package/repository/homepage URLs;
- brand strings/storage prefix/env prefix;
- scheduler components;
- seed people/companies;
- feature-specific routes;
- test port assumptions without reviewing collisions.

Perform a literal search after each conversion slice:

```bash
rg -n 'CapacityLens|capacitylens|CAPACITYLENS|Floaty|floaty|Kevinjohn'
```

The generator rebrands product identity automatically, so a remaining scheduling concept is more
important than a stale brand literal. Every hit and inherited domain noun must be either a deliberate
historical attribution or work still recorded in the conversion plan.

Use the optional internal manifest to record intended defaults if useful. Keep product policy in the
product, and do not create a shared package until another real consumer proves the same abstraction.

## Phase 3 — Define domain before screens

Create in `shared/`:

- entity base and tenant-scoped base;
- tenant/account type;
- canonical domain types;
- exhaustive table key unions;
- empty dataset factory;
- ids/date/string bounds;
- pure access matrix;
- relationship validators;
- lifecycle decision;
- migration version 1;
- import/export marker and sanitiser;
- fictional full fixtures.

Write pure tests for every “only”, “never”, equality edge and cross-tenant relationship.

Then create SQL table specs with compile-time field coverage. Do not create forms first and
back-infer the data model.

## Phase 4 — Build the safe vertical slice

Implement one thin end-to-end workflow:

1. start empty server;
2. create first identity/tenant;
3. create one root domain object;
4. create the relationship/outcome that delivers first value;
5. reload and see it;
6. view it as a Viewer;
7. export/import it;
8. archive/restore if lifecycle is in scope.

This proves:

- auth;
- tenancy;
- shared validation;
- store/data adapter;
- transaction/persistence;
- UI kit;
- navigation;
- error surfaces;
- testing topology.

Do not build every list before proving this slice.

## Phase 5 — Add shell and onboarding

Implement in order:

1. auth boot wall;
2. tenant picker/create;
3. product boundary intro;
4. app shell and navigation;
5. primary value route;
6. state-derived checklist;
7. loose orientation tour;
8. command palette;
9. Settings and device-data controls.

Decide each state scope explicitly. Test new tenant, established tenant, viewer and portrait phone.

## Phase 6 — Productionise

Before public launch:

- stable password auth and invitation flow;
- exact server authorization coverage;
- fail-closed production boot guard;
- same-origin TLS proxy topology;
- persistent DB/audit/snapshot volumes;
- scheduled off-host backup;
- successful restore drill;
- deep health and structured logs;
- rate/body limits and security headers;
- privacy/retention/erasure documentation;
- import size/atomicity;
- offline either omitted or read-only/expiring;
- dependency audit, CodeQL/scorecard posture;
- real browser/accessibility matrix.

Do not label SSO supported until the target provider/tenant is rehearsed.

## Phase 7 — Prepare hosted service

Keep community core whole. Add hosted concerns at explicit boundaries:

- provisioning/control plane;
- billing provider/webhooks;
- plan entitlement seam;
- managed backups/monitoring;
- support operations;
- hosted privacy/terms/DPA;
- outbound email adapter if needed;
- fleet upgrade/rollback.

Define export/offboarding before inviting paying users.

## Copy checklist by area

### Copy almost verbatim

- semantic colour/theme blocks;
- preset swatches and contrast helpers;
- strict TS/lint/promise posture;
- defensive coding standard;
- role/action matrix shape;
- account scoping shape;
- auth mode/config validation pattern;
- same-origin deployment and backup/runbook pattern;
- community policy file set;
- local gate structure.

### Copy then rename carefully

- brand constant;
- storage prefix;
- environment prefix;
- package names;
- Docker volume/image/service names;
- repository URLs/badges/security links;
- fake/demo persona;
- built-in record;
- account/company language;
- auth callback routes and email link copy.

### Adapt to domain

- entity graph and cascades;
- onboarding completion predicates;
- sidebar destinations;
- privacy-sensitive fields;
- field-level role projection;
- lifecycle-enabled entities;
- user-story reference;
- first-value E2E tests;
- import sanitisation/migration.

### Decide, do not inherit accidentally

- week/time granularity;
- mobile claim;
- multi-account default;
- offline availability;
- SSO provider support;
- email delivery;
- retention/purge delay;
- hosted plan boundaries;
- AGPL versus another reviewed licence.

## First-week implementation sequence

An efficient agent sequence:

1. Read this handbook and current CapacityLens sources in the reference map.
2. Draft product brief and inheritance table.
3. Create contracts/templates.
4. Scaffold workspace/config/design tokens.
5. Implement shared types/access/integrity with tests.
6. Implement SQLite schema/transactions/auth membership.
7. Implement explicit server/demo adapters.
8. Build auth → tenant → primary route vertical slice.
9. Add onboarding, navigation, Settings and permission affordances.
10. Add self-hosting/restore/gates before domain breadth.

## “Fifty percent there” definition

The reusable foundation is complete when a sibling has:

- coherent product boundary and nouns;
- branded, themed, accessible app shell;
- real auth and tenant picker;
- roles and server authorization;
- SQLite source of truth and explicit demo;
- safe save/retry/reconcile behaviour;
- import/export and lifecycle decision;
- state-derived onboarding;
- self-hosting with backup/restore;
- community policies;
- green local gates and representative E2E.

The remaining fifty percent should be the product's unique domain value, not another reinvention of
login screens, colours, error handling and Docker.

## Launch vetoes

Do not launch if any is true:

- auth can silently become off;
- one tenant can address another tenant's rows;
- failed save looks successful;
- backup has never been restored;
- production starts with demo/customer-like seed data;
- private fields are hidden only in UI;
- open registration/provider posture is undocumented;
- primary flow is not keyboard accessible;
- self-host guide omits secrets/TLS/persistence;
- hosted service has no privacy/export/offboarding plan.
