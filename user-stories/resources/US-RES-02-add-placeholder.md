# US-RES-02 — Add a placeholder bound to a project

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "adds a placeholder bound to a project and shows a slot tag"

## Goal
Add an unnamed **placeholder** (a reserved slot) bound to one project, so unstaffed work
can be blocked out before a real person is hired or assigned.

## Why
A studio manager often needs to plan capacity for a role that isn't filled yet — "a senior
designer on Project Lightning". A placeholder reserves that slot on the schedule and keeps
its allocations attached to a single project until a real resource takes over.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. Click **Add resource**. The "Add resource" dialog opens.
2. Set **Type** = *Placeholder*. The **Name** field becomes *Name (optional)*, the
   **Employment** field is hidden, and a **Bound project** field appears.
3. Leave **Name** empty (optional) and set **Role** = `Senior Developer`.
4. Choose **Bound project** = *Acme Inc. / Project Lightning*.
5. Set **Working hours / day** = `8`; ensure Mon–Fri in **Working days**.
6. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ After Save, a placeholder row appears in the Resources list, labelled by its role
  (*Senior Developer*) with a "placeholder" tag.
- ✅ On **Schedule**, the placeholder's row carries a **"slot"** tag next to its name.
- ✅ The **Employment** field is hidden while **Type** = *Placeholder* (placeholders are
  always permanent — no "Temp" tag).
- ✅ Saving a placeholder with no **Bound project** keeps the dialog open and is rejected
  with the inline error "A placeholder must be bound to a project." on the Bound project
  field (`aria-invalid`).
