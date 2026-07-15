# Internal SmallSass reference kit

This directory supports Kevin and future coding agents when creating another tightly scoped
SmallSass product. It is intentionally stored under `to-my-siblings/` because it is **internal
product-family material**, not a CapacityLens feature, public compatibility promise or contributor
requirement.

CapacityLens must continue to build, test, document and release without importing anything in this
directory. Do not link this kit from the public CapacityLens README or changelog. Do not add its
checks to the CapacityLens gate.

## What this kit is

It is a copy-ready reference library containing:

- framework-free entity and account-access examples;
- the current semantic Tailwind theme and preset colour helpers;
- reusable ESLint settings;
- an example family manifest and its schema;
- an optional golden-copy generator;
- migration notes and a first-session checklist.

These files are **reference snapshots**. They are not installed workspace packages today. Package
names such as `@smallsass/contract` describe the intended future extraction boundary and make the
examples easy to promote later; they do not mean CapacityLens currently publishes or consumes those
packages.

## Boundary with CapacityLens

| CapacityLens public repository surface | Internal sibling surface |
| --- | --- |
| Product README, changelog and user/operator docs | This handbook and reference kit |
| CapacityLens source, tests and normal gates | Optional copy/generator commands run deliberately |
| CapacityLens names, routes and domain decisions | Cross-product defaults and adaptation guidance |
| No SmallSass compatibility claim | Internal provenance and review notes |

A source change may still be made in CapacityLens because it improves CapacityLens itself. If that
change is also reusable, document or refresh the corresponding snapshot here. Never change the
public product merely to make this internal kit look cleaner.

## Reference packages

- `packages/contract` contains the proposed shared entity envelope and account permission matrix.
- `packages/tokens` contains a snapshot of semantic theme values, swatches and colour helpers.
- `packages/config` contains reusable lint configuration fragments.
- `examples/family.example.json` records product identity and architectural defaults without
  changing the product's root files.

Before copying any snapshot into a sibling, compare it with the current CapacityLens implementation
using the reference map. CapacityLens remains the source of truth until a real shared package has
two consumers and its own release process.

## Optional golden-copy generator

From the CapacityLens checkout:

```sh
node to-my-siblings/reference-kit/scripts/create-sibling.mjs \
  --name "Invoice Nudge" \
  --slug invoice-nudge \
  ../invoice-nudge
```

The generator copies and rebrands the current working reference into an empty directory. Its input
comes from Git's tracked and non-ignored file set, so ignored operator notes and other local-only
material cannot leak into a sibling. It also excludes Git history, dependencies, build output,
databases, logs, private keys and real environment files. It does not install dependencies,
initialise Git, contact a network or publish anything.

The generator is internal convenience, not part of `pnpm run gate`. Smoke-test it deliberately
after changing it:

```sh
node to-my-siblings/reference-kit/scripts/smoke-test-generator.mjs
```

## Promotion rule

Do not publish or wire a reference package into CapacityLens merely because it looks reusable.

Promote a snapshot to a real shared package only when:

1. at least two products use the same semantics;
2. both products need the same implementation rather than merely similar code;
3. ownership, versioning, migrations and rollback are defined outside either product repository;
4. each product can upgrade independently;
5. removing the shared package would reveal meaningful duplication.

Until then, copy with provenance, adapt explicitly, and record differences in the sibling's internal
notes.
