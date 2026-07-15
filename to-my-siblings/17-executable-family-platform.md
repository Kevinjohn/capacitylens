# 17 — Internal reuse without polluting the product

The SmallSass knowledge base exists for its owner and coding agents. It is not part of the
CapacityLens product proposition.

That distinction is load-bearing:

- somebody downloading CapacityLens should see a focused agency capacity scheduler;
- a CapacityLens contributor should not need to understand a private portfolio strategy;
- the public README and changelog should describe CapacityLens;
- the CapacityLens build must not depend on internal sibling material;
- internal agents still need enough precision to create a closely related product quickly.

This chapter defines how to achieve both goals.

## The two audiences

| Audience | Needs | Must not be burdened with |
| --- | --- | --- |
| CapacityLens user/operator | product capabilities, installation, security, operation and support | sibling strategy, internal generators and family package plans |
| CapacityLens contributor | architecture, tests and product decisions required to change CapacityLens safely | portfolio-wide compatibility ceremonies |
| SmallSass owner/agent | reusable decisions, reference code, provenance and conversion workflow | pretending internal material is a public CapacityLens feature |
| New sibling maintainer | a runnable starting point and explicit adaptation list | CapacityLens domain assumptions presented as universal rules |

When a document serves the first two audiences, keep it in the normal product documentation. When
it serves the last two, keep it under `to-my-siblings/`.

## Repository boundary

The internal folder may read and quote the product. The product must not depend on the internal
folder.

```text
CapacityLens source + product docs + product gates
                    │
                    │ observed and distilled by
                    ▼
             to-my-siblings/
          handbook + reference kit
                    │
                    │ deliberately copied by owner/agent
                    ▼
             new sibling repository
```

The arrow is one-way. CapacityLens does not import `to-my-siblings/reference-kit`, run its scripts
from `pnpm run gate`, or advertise it in the public README/changelog.

## What “compatible” means internally

Compatibility is a working preference, not a public certification.

A sibling is internally aligned when an agent can demonstrate that it:

- uses the same semantic design vocabulary unless a documented product need differs;
- uses the same account and tenant model;
- preserves server-side authorization independently of UI visibility;
- follows the same authentication, invitation and session posture;
- offers the same hosted/self-hosted topology where relevant;
- follows the same defensive coding and data-repair boundaries;
- keeps device preferences separate from account data;
- refuses queued offline writes;
- uses comparable operator docs and green gates;
- records intentional deviations rather than silently drifting.

This does **not** mean two products share every domain type, route, label or component. An invoice
tool should not inherit scheduling terminology merely to score well on a checklist.

## What agents can reuse today

### Directly copyable reference material

The internal [reference kit](reference-kit/README.md) contains snapshots for:

- the entity envelope: id, timestamps and `accountId`;
- the Owner → Admin → Editor → Viewer account hierarchy;
- member-management interlocks;
- semantic Tailwind theme values;
- the approved colour swatches and contrast helpers;
- promise-safety and ignore-list ESLint fragments;
- an example family manifest;
- a safe golden-copy generator.

These files are intentionally not wired into CapacityLens. Before copying, compare each snapshot to
the live product using the reference map because the product may have advanced since the snapshot.

### Reference implementation seams

The following are documented, tested CapacityLens implementations that a sibling may initially
copy:

- Better Auth password and experimental SSO setup;
- pre-authorised invitation flow;
- account creation and selection;
- tenant-scoped SQLite API;
- role-authorized server routes;
- onboarding and getting-started shell;
- desktop navigation and mobile constraints;
- opt-in read-only offline snapshots;
- self-hosting, backup and runbook structure;
- Vitest, Playwright and accessibility gates.

They are not stable shared libraries. Copying them creates provenance and a migration responsibility;
it does not create an API guarantee.

### Product-specific code

Do not treat these as SmallSass defaults:

- scheduling entities and calculations;
- utilisation, over-capacity and 14-day warning semantics;
- scheduler grids, allocation bars and draw interactions;
- CapacityLens labels, routes, seed data and test ids;
- scheduling-specific privacy fields;
- domain-specific mobile limitations.

The reference map identifies their current locations so agents can remove them deliberately.

## Why snapshots rather than live dependencies

A shared package is valuable only after its abstraction is proven. With one product, extracting
everything produces CapacityLens-shaped APIs with a SmallSass name.

The current snapshot approach avoids four problems:

1. public contributors do not inherit internal tooling;
2. CapacityLens cannot be broken by an internal kit release;
3. sibling two is free to expose false assumptions;
4. the eventual shared package can be designed from real duplication.

Use the rule of two consumers and the rule of three changes:

- two products must use the same semantics before extracting a package;
- the same change should have been needed repeatedly before centralising it;
- product-specific adapters must remain outside the package;
- the package must live and release independently of either product.

Candidate future packages remain `@smallsass/contract`, `@smallsass/tokens`,
`@smallsass/auth`, `@smallsass/server`, `@smallsass/ui` and
`@smallsass/testing`. These are design targets, not current CapacityLens dependencies.

## Optional golden-copy workflow

Run from the CapacityLens checkout:

```sh
node to-my-siblings/reference-kit/scripts/create-sibling.mjs \
  --name "Invoice Nudge" \
  --slug invoice-nudge \
  ../invoice-nudge
```

The generator:

1. requires an absent or empty external target;
2. copies the current working full-stack reference;
3. excludes Git history, dependencies, output, databases, logs and secrets;
4. retains `.env.example`;
5. rebrands the obvious product name, package scope, environment prefix and storage prefix;
6. resets root/shared/server product versions to `0.1.0`;
7. records generation provenance inside `to-my-siblings/`;
8. performs no install, Git, network or publishing action.

Smoke-test the internal generator after modifying it:

```sh
node to-my-siblings/reference-kit/scripts/smoke-test-generator.mjs
```

This command is deliberately absent from CapacityLens's package scripts and normal green gate.

## Conversion workflow

A generated sibling is a runnable CapacityLens-shaped reference, not a half-finished product that
may be shipped unchanged.

### Phase 1: define the new promise

Record:

- exact user;
- exact recurring pain;
- single primary outcome;
- non-goals;
- smallest useful workflow;
- hosted and self-hosted expectations;
- whether demo/offline/SSO are actually needed.

### Phase 2: inventory the inherited domain

Search for:

- CapacityLens/capacitylens/CAPACITYLENS;
- schedule, allocation, resource, discipline, client, project and time off;
- environment variables and storage keys;
- routes, test ids and seeded identities;
- database migrations and export formats;
- screenshots, metadata and operator examples.

Classify every match as retain, adapt, replace, historical/do-not-rewrite, or internal-only.

### Phase 3: replace vertical slices

For each new domain concept, work in this order:

```text
shared type
  → complete fixture
  → SQLite schema/column
  → sanitisation and repair
  → tenant authorization
  → API contract
  → client state
  → form and workflow
  → unit/integration test
  → browser acceptance story
  → operator/user documentation
```

Keep the repository runnable after every slice. Delete the old scheduling slice only when its
replacement is covered.

### Phase 4: adapt the family-shaped shell

Review, do not blindly retain:

- role/action vocabulary;
- account/member/invite flows;
- auth modes and deployment guards;
- menu information architecture;
- onboarding and empty states;
- semantic colour application;
- mobile/read-only limitations;
- export/import and offline policy;
- self-hosting defaults;
- security and privacy documentation.

Document every intentional divergence in the new product's internal notes.

### Phase 5: prove the product

The sibling must define and pass its own product gates. The default starting expectation is:

```sh
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

A copied CapacityLens test suite proves only that the inherited reference still behaves like
CapacityLens. Replace scheduler-specific tests with acceptance stories for the new promise.

## Updating the internal knowledge base

When CapacityLens gains a genuinely reusable improvement:

1. make and verify the CapacityLens change for CapacityLens's own reasons;
2. keep the public documentation product-focused;
3. update the relevant handbook chapter;
4. refresh a reference snapshot only when copying the code would help a sibling;
5. note the source file and date/commit in the sibling reference map;
6. smoke-test internal tooling separately;
7. do not add internal checks to the CapacityLens gate.

Examples:

- a stronger password/session posture belongs in CapacityLens operator docs **and** may be distilled
  into the auth chapter;
- a scheduler zoom fix belongs only to CapacityLens unless another time-grid product needs it;
- a semantic colour accessibility fix belongs in CapacityLens source and should also refresh the
  token snapshot;
- a SmallSass generator improvement belongs only under `to-my-siblings/`.

## Drift management

Until real shared packages exist, drift is managed by deliberate review:

- provenance says which reference created a sibling;
- each sibling records deviations;
- agents compare live implementations before copying;
- repeated identical patches become package candidates;
- security fixes are reviewed across every sibling;
- public product gates remain independent.

This is less automatic than forcing every product to consume a local package, but it respects the
product boundary and produces better evidence for future extraction.

## Agent decision test

Before changing CapacityLens for SmallSass reuse, ask:

1. Would this change still benefit CapacityLens if no sibling ever existed?
2. Does a CapacityLens user, operator or contributor need to know it?
3. Can the reuse goal be met by documenting or snapshotting instead?
4. Would this add a dependency, command or failure mode to the public product?
5. Has another real product proved the abstraction?

If the answer to question 1 is no, keep the change under `to-my-siblings/`.
If question 4 is yes and question 5 is no, do not integrate it into CapacityLens.

## Definition of done

The internal knowledge base is healthy when:

- CapacityLens remains understandable without reading it;
- no CapacityLens runtime or normal gate imports it;
- public README and changelog remain product-focused;
- an agent can locate reusable decisions and code snapshots quickly;
- the generator refuses unsafe targets and secrets;
- generated siblings carry provenance;
- new products replace inherited domain code before release;
- deviations are explicit;
- future shared packages are extracted only from proven duplication.
