# US-DAT-06 — Explore temporary demo data

As a demo user, I want to explore temporary demo data so that I can try the product without creating durable company data.

**Status:** Demo
**Access:** Demo user
**Entry:** Open in-memory demo → choose company
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [fakeAuth.ts](../../apps/frontend/src/lib/fakeAuth.ts)

## Acceptance criteria

- Demo changes last only for the open page.
- Reload restores the canonical demo seed; real server data is not automatically seeded.
