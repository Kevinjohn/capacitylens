# 12 — Open source and small SaaS

The family model is a complete open-source application plus a paid hosted convenience, not a hollow
“community edition”.

## Product boundary between community and hosted

Community repository includes:

- complete core product workflow;
- server persistence and authentication;
- self-hosting;
- data import/export;
- backup/restore documentation;
- security and privacy controls needed to operate it;
- upgrade path;
- tests and contribution policy.

Hosted service may add outside this repository:

- provisioning and fleet management;
- billing/subscriptions/tax;
- managed domains/TLS;
- managed backups and monitoring;
- support/SLA;
- email delivery;
- usage metering/entitlement glue;
- multi-instance administration;
- proprietary operational integrations.

Do not remove reliability, backup, auth or export from self-hosters merely to create hosted value.
People pay to avoid operating software, not because the repository is intentionally incomplete.

## Licence default

CapacityLens is `AGPL-3.0-only`. For a networked application, modified deployments must make the
corresponding source available under the licence terms.

Family implications:

- preserve licence headers/notices as required;
- hosted modifications to the covered networked application remain subject to AGPL;
- truly separate billing/deployment services may live elsewhere, but integration boundaries need
  professional review;
- dependencies and assets must be licence-compatible;
- do not promise a proprietary dual-licence strategy unless contributor rights support it.

This handbook is not legal advice. Obtain professional advice before commercial launch, licence
changes, dual licensing or contributor-policy changes.

## Contributions

CapacityLens uses:

- DCO sign-off on every commit;
- no CLA;
- no copyright assignment;
- maintainer-led merge authority;
- substantial changes begin as issues;
- small focused pull requests;
- no new dependency without discussion.

This is a pragmatic solo/small-community default. It lowers contributor friction while retaining a
clear provenance statement.

## Governance

Write who decides:

- product direction;
- merge/release authority;
- security response;
- maintainer appointment/removal;
- conflict-of-interest handling.

CapacityLens explicitly states that changes benefiting hosted service at self-hosters' expense
should be disclosed. Preserve that norm across siblings.

## Public project files

Every sibling should start with:

- `LICENSE`;
- `README.md`;
- `CONTRIBUTING.md`;
- `CODE_OF_CONDUCT.md`;
- `GOVERNANCE.md`;
- `SECURITY.md`;
- `SUPPORT.md`;
- `TRADEMARKS.md`;
- `CHANGELOG.md`;
- issue forms;
- pull-request template;
- Dependabot configuration.

Adapt project names, links, support promises and product non-goals. Do not copy stale CapacityLens
URLs.

## Support boundary

Community support is best effort:

- reproducible bugs through issue form;
- setup questions through discussion/support issue;
- private security reporting;
- no promised administration of a user's private server;
- no recovery guarantee for untested backups;
- no custom integrations or response SLA unless separately contracted;
- latest release and current main are the supported security surface by default.

Hosted support/SLA is a commercial policy and must not silently rewrite the public community promise.

## Trademark boundary

Software licence rights do not automatically grant product name/logo rights.

- Allow accurate “based on” statements.
- Require modified/hosted versions not to imply official endorsement.
- Siblings each need a distinct product name and mark.
- Keep reusable code/style separate from a specific logo.
- Obtain professional trademark clearance before launch.

The shared semantic design language can create family resemblance without presenting every fork as
the official product.

## Privacy separation

The open-source technical privacy document describes software as shipped.

The hosted service additionally needs:

- privacy notice;
- controller/processor roles;
- lawful basis;
- retention schedule;
- subprocessors;
- hosting regions/transfers;
- DPA;
- cookie/session notice where required;
- support and incident data handling;
- billing provider data;
- telemetry policy;
- erasure across backups/logs/support systems.

Do not copy the self-hosting privacy page and call it a SaaS privacy notice.

## Entitlements

If the hosted product has paid plans:

- keep entitlement vocabulary in a small server policy seam;
- authorization and entitlement are different—payment never substitutes for tenant membership;
- fail closed for paid-only hosted operations without hiding core self-hosted capability;
- do not contaminate pure domain entities with billing-provider ids;
- keep hosted plan enforcement outside the portable community data export where possible;
- define downgrade and grace-period behaviour;
- test billing webhooks for replay/idempotency.

CapacityLens already has a small server entitlement seam; siblings can expand it only when plans
exist.

## Hosted architecture restraint

Do not replace the simple self-hosted architecture pre-emptively. A hosted control plane can run
many isolated instances or a carefully designed multi-tenant service later. The first commercial
value is often:

- automated deploy;
- upgrades;
- monitored health;
- encrypted backups;
- restore support;
- managed auth/provider setup;
- reliable availability.

These are operational competencies, not reasons to put Kafka in the domain core.

## Business-model decision record

Before charging, document:

1. What remains completely available self-hosted?
2. What convenience/service is paid?
3. Where hosted-only code lives?
4. What source obligations apply?
5. What data the hosted layer adds?
6. What support and availability are promised?
7. How users export and leave?
8. How plan downgrade behaves?
9. How community contributions affect the hosted service?
10. Which legal/privacy/trademark questions received professional review?

## Trust principles

- No product analytics by default in community core.
- No hidden outbound email or telemetry.
- Same data export regardless of hosted plan, subject only to role privacy.
- Clear build/version stamp.
- Public changelog and security process.
- No dark patterns in self-host setup.
- Hosted service competes on care, convenience and confidence.
