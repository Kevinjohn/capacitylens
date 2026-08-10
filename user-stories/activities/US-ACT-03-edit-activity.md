# US-ACT-03 — Edit an activity

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "edits an activity name"

## Goal

Change an activity's name and project, and see the change reflected in the Activities list and in the allocation pickers.

## Why

Work gets re-scoped: an activity is renamed or moved to another project. Those edits must propagate so the manager always allocates against accurate, current activity options.

## How (end-to-end)

**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). The activity _CMS Review_ belongs to _Project Watchtower_.

1. On the **CMS Review** row, click the **Edit** (pencil) icon. The dialog opens pre-filled.
2. Change **Name** = `CMS Build`.
3. Change **Project** = _Metropolis Rebrand_.
4. Click **Save**. The dialog closes.
5. Open the **Schedule** (`/`), start an allocation, set the **Project** to _Metropolis Rebrand_, and open the **Activity** picker.

## Acceptance criteria

- ✅ The Activities list row now reads **CMS Build** under _Metropolis Rebrand_ (no longer under _Project Watchtower_).
- ✅ When allocating with **Project** = _Metropolis Rebrand_, **CMS Build** appears in the **Activity** picker.
- ✅ When allocating with **Project** = _Project Watchtower_, **CMS Build** no longer appears (it moved off that project).
- ✅ Clearing **Name** to empty and clicking **Save** is rejected (required-field error, dialog stays open).
