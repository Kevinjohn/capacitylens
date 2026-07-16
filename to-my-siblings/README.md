# The sibling handbook

This directory is the reusable product, design, engineering and operating system extracted from
CapacityLens. It exists so the next small open-source/SaaS product starts with a tested set of
decisions instead of an empty repository and a hundred familiar arguments.

It is written primarily for coding agents and maintainers. A new sibling should borrow aggressively,
but not blindly: keep the proven mechanics, replace the CapacityLens domain, and record every
intentional departure.

## What this handbook is

- A **reference implementation guide**: every important recommendation points back to working
  CapacityLens code, tests or operator documentation.
- An **inheritance contract**: it distinguishes family-wide defaults from product-specific examples.
- A **decision reducer**: it supplies defaults for architecture, naming, colours, onboarding,
  navigation, auth, tenancy, self-hosting, offline behaviour, quality gates and open-source policy.
- An **agent runbook**: it gives future agents an order of operations, source hierarchy and
  definition of done.

Optional copy-ready code and the internal golden-copy generator live in
[`reference-kit/`](reference-kit/README.md). They are internal aids, not CapacityLens dependencies,
public compatibility claims or product gates. The handbook explains intent; each sibling owns and
tests the implementation it adopts until multiple products justify independently released packages.

## The three inheritance levels

Every rule in this handbook should be read as one of:

1. **Family invariant** — copy unless a written decision says otherwise. Examples: server-side
   tenant authorization, semantic colour tokens, visible error handling, strict TypeScript, the
   local green gates, no production data in fixtures.
2. **Family default** — begin here, then change deliberately when the product demands it. Examples:
   React/Vite/Fastify/SQLite, a collapsible sidebar, password auth, a read-only offline snapshot,
   AGPL licensing.
3. **CapacityLens example** — learn the pattern, replace the noun or rule. Examples: week
   granularity, clients/projects/activities, utilisation, the four-step capacity-planning checklist.

The distinction prevents two common failures: cargo-culting a scheduler-specific rule into an
unrelated product, and discarding a security or operability invariant because its example used
scheduler vocabulary.

## Recommended reading paths

### Starting a product

Read in this order:

1. [Sibling contract](00-sibling-contract.md)
2. [Product and scope](01-product-and-scope.md)
3. [New sibling playbook](14-new-sibling-playbook.md)
4. [Executable family platform](17-executable-family-platform.md)
5. [Repository and architecture](02-repository-and-architecture.md)
6. [Design system](07-design-system.md)
7. [Agent operating manual](15-agent-operating-manual.md)

### Building the application shell

Read:

- [Authentication, accounts and permissions](04-authentication-accounts-and-permissions.md)
- [Onboarding and empty states](05-onboarding-and-empty-states.md)
- [Navigation, shell and process flow](06-navigation-shell-and-process-flow.md)
- [Responsive, mobile and accessibility](08-responsive-mobile-accessibility.md)

### Preparing to ship

Read:

- [State, persistence, offline and errors](09-state-persistence-offline-errors.md)
- [Self-hosting, operations and security](10-self-hosting-operations-security.md)
- [Testing, quality and delivery](11-testing-quality-and-delivery.md)
- [Database migrations and upgrade safety](18-database-migrations-and-upgrades.md)
- [Open source and small SaaS](12-open-source-and-saas.md)

### Making a code change

Read:

- [Naming and coding standards](13-naming-and-coding-standards.md)
- [Agent operating manual](15-agent-operating-manual.md)
- [CapacityLens reference map](16-capacitylens-reference-map.md)
- [Executable family platform](17-executable-family-platform.md)
- [Database migrations and upgrade safety](18-database-migrations-and-upgrades.md)

## Contents

| Chapter | What it settles |
| --- | --- |
| [00 — Sibling contract](00-sibling-contract.md) | What is inherited, what is adaptable, and how exceptions are recorded |
| [01 — Product and scope](01-product-and-scope.md) | Product thesis, nouns, non-goals and decision discipline |
| [02 — Repository and architecture](02-repository-and-architecture.md) | Workspace shape, dependency direction and implementation seams |
| [03 — Domain, data and tenancy](03-domain-data-and-tenancy.md) | Entity rules, account scoping, lifecycle, validation, import and privacy |
| [04 — Auth, accounts and permissions](04-authentication-accounts-and-permissions.md) | Better Auth posture, first owner, invitations, roles and authorization |
| [05 — Onboarding and empty states](05-onboarding-and-empty-states.md) | Login-to-value journey, intro, checklist, tour and empty-state rules |
| [06 — Navigation, shell and process flow](06-navigation-shell-and-process-flow.md) | Menu behaviour, routing, state machines and feedback surfaces |
| [07 — Design system](07-design-system.md) | Exact semantic tokens, Tailwind language, components, copy and i18n |
| [08 — Responsive, mobile and accessibility](08-responsive-mobile-accessibility.md) | Honest mobile scope, compact navigation, touch and WCAG patterns |
| [09 — State, persistence, offline and errors](09-state-persistence-offline-errors.md) | Store orchestration, adapters, atomic sync, recovery and offline reading |
| [10 — Self-hosting, operations and security](10-self-hosting-operations-security.md) | Production topology, configuration, backups, incidents and privacy |
| [11 — Testing, quality and delivery](11-testing-quality-and-delivery.md) | Test pyramid, local gates, CI, releases and documentation changes |
| [12 — Open source and small SaaS](12-open-source-and-saas.md) | Community/hosted boundary, AGPL, governance, support and trademarks |
| [13 — Naming and coding standards](13-naming-and-coding-standards.md) | File, symbol, domain, copy, comment and dependency conventions |
| [14 — New sibling playbook](14-new-sibling-playbook.md) | Idea-to-first-release sequence and copy/adapt checklists |
| [15 — Agent operating manual](15-agent-operating-manual.md) | How agents orient, implement, verify and hand off changes |
| [16 — Reference map](16-capacitylens-reference-map.md) | Pattern-to-source/test/doc lookup table |
| [17 — Internal reuse boundary](17-executable-family-platform.md) | Reference snapshots, generator, provenance and keeping family machinery out of public product surfaces |
| [18 — Database migrations](18-database-migrations-and-upgrades.md) | SQLite versioning, checksummed history, rollback snapshots, fixtures and release rehearsals |
| [Templates](templates/README.md) | Ready-to-adapt repository instructions, decisions and proposals |

## Source hierarchy

When this handbook and the implementation disagree, do not guess. Use this order:

1. Executable tests and the current product implementation.
2. Root [`AGENTS.md`](../AGENTS.md), [`DECISIONS.md`](../DECISIONS.md) and
   [`DEFENSIVE-CODING.md`](../DEFENSIVE-CODING.md).
3. [`user-stories/REFERENCE.md`](../user-stories/REFERENCE.md) for exact visible behaviour.
4. Operator documentation in [`docs/`](../docs).
5. This handbook.

Then update the stale layer. The handbook is useful only if drift is repaired, not rationalised.

## Maintenance rule

A CapacityLens change may update this handbook and a reference snapshot when it changes a genuinely
reusable decision:

- authentication or invitation posture;
- tenancy, data lifecycle, import/export or persistence behaviour;
- onboarding, navigation, responsive or accessibility patterns;
- semantic tokens, component conventions or user-facing language;
- self-hosting, backup, security, privacy, CI or release practice;
- the expected way an agent changes the repository.

Do not make handbook maintenance a requirement for ordinary public contributions. The owner or an
internal agent should distil reusable lessons deliberately, without adding a dependency or failure
mode to CapacityLens. See chapter 17 for the one-way boundary.

## Baseline

This edition was reconstructed from CapacityLens `0.19.5` on 14 July 2026 and updated through the
`0.20.1` prerelease work on 15 July 2026, including the public security review, tiered community/
hardened self-hosting posture and explicit SQLite migration framework. It also includes private-name
projection, first-run onboarding polish, semantic colour language, deployment handoff and split CI
signals.
