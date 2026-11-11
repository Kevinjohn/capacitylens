# US-DAT-07 — Preserve private names safely in transfer

As an Owner, I want private names preserved safely in export and import so that confidential identities remain protected and restorable.

**Status:** Current
**Access:** Owner for import; role-tiered export
**Entry:** Settings → Data and support → Import and export
**Documentation:** [Settings](../../docs-src/using/settings.md#import-and-export)
**Source:** [beta_account_transfer.ts](../../apps/backend/app/services/beta_account_transfer.ts)

## Acceptance criteria

- Owner and demo exports keep each private client’s or project’s real name and code name, so they can be imported. Other roles’ exports are marked redacted: a private record’s name is replaced by its quoted code name and the separate code name is left empty.
- A redacted export cannot replace company data; invalid private fields are rejected.
