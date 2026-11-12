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

## User flow

```mermaid
flowchart TD
  A["Resources screen → archived resource"] --> B["Select Anonymise"] --> C["Confirm anonymisation"]
  C -->|Cancel| A
  C -->|Anonymise| D["Identity and dependent notes are removed; planning links remain"]
```

## Code flow

```mermaid
flowchart TD
  A["ArchivedEntitySection Owner/Admin Anonymise control"] --> B["ConfirmDialog onConfirm → useLifecycleActions.anonymise"]
  B --> C{{"Server anonymisation"}}
  C --> D["POST resources/:id/anonymise → AnonymiseController.resource"] --> E["anonymiseResources transaction"] --> F["reloadFromServer calls refreshPlanning({ fresh: true })"]
  G --> H["obfuscateResource and clear linked notes"]
  H --> I["Archived resource view refreshes"]
  F --> I
```

**Code references:** [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx) · [useLifecycleActions.ts](../../apps/frontend/src/hooks/useLifecycleActions.ts) · [anonymise_routes.ts](../../apps/backend/start/anonymise_routes.ts) · [anonymise_controller.ts](../../apps/backend/app/controllers/anonymise_controller.ts) · [anonymise.ts](../../apps/backend/app/services/anonymise.ts)
