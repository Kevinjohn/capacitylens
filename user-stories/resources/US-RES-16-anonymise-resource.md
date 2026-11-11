# US-RES-16 — Anonymise an archived resource

As an Owner or Admin, I want to anonymise an archived resource so that identifying details and dependent notes are removed while its planning links remain.

**Status:** Current
**Access:** Owner and Admin
**Entry:** Resources screen → archived resource row → Anonymise
**Documentation:** [Resources guide](../../docs-src/using/resources.md#archive-someone-who-leaves)
**Source:** [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx) · [DECISIONS.md](../../DECISIONS.md)

## Acceptance criteria

- Selecting **Anonymise** opens **Anonymise resource?** (“Anonymise {name} and remove their personal details? This cannot be undone.”) with **Anonymise** and **Cancel**; no password is requested.
- **Cancel** leaves the resource unchanged. **Anonymise** replaces the name with **Removed person #{id tag}** and the role with **Removed resource**, clears the avatar and clears the notes on its allocations and time off, while keeping the resource and its links.
- The action appears only for Owners and Admins, and only on a directly archived resource row.
