# US-ACT-03 — Edit an activity

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "edits an activity name"

## Goal
Change an activity's name and project, and see the change reflected in the Activities list and in the allocation pickers.

## Why
Work gets re-scoped: an activity is renamed or moved to another project. Those edits must propagate so the manager always allocates against accurate, current activity options.

## How (end-to-end)
**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). The activity *CMS Review* belongs to *Project Lightning*.
1. On the **CMS Review** row, click the **Edit** (pencil) icon. The dialog opens pre-filled.
2. Change **Name** = `CMS Build`.
3. Change **Project** = *Brand Themes*.
4. Click **Save**. The dialog closes.
5. Open the **Schedule** (`/`), start an allocation, set the **Project** to *Brand Themes*, and open the **Activity** picker.

## Acceptance criteria
- ✅ The Activities list row now reads **CMS Build** under *Brand Themes* (no longer under *Project Lightning*).
- ✅ When allocating with **Project** = *Brand Themes*, **CMS Build** appears in the **Activity** picker.
- ✅ When allocating with **Project** = *Project Lightning*, **CMS Build** no longer appears (it moved off that project).
- ✅ Clearing **Name** to empty and clicking **Save** is rejected (required-field error, dialog stays open).
