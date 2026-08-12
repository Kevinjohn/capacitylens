# US-RES-07 — Studio or Supplementary engagement

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "edits Engagement while Employment stays hidden and unbadged"

## Goal

Classify a person as **Studio** or **Supplementary**, independently of their discipline or retained
employment data.

## Why

Contract status does not reliably describe whether someone is regarded as part of an agency's core
team. Engagement captures that relationship directly without discarding the existing employment
data that may be useful later.

## How (end-to-end)

**Precondition:** Seeded app open; click **Resources** in the sidebar.

1. On the **Bruce Wayne** row, click the **Edit** (pencil) icon.
2. Confirm **Engagement** defaults to _Studio_ and no **Employment** control is shown.
3. Change Engagement to _Supplementary_ and Save.
4. Edit **Bruce Wayne** again and confirm _Supplementary_ persisted.

## Acceptance criteria

- ✅ The person form shows **Engagement** with **Studio** and **Supplementary** choices, defaulting
  new and migrated resources to Studio.
- ✅ The hidden employment value is preserved when an existing person is edited; new people retain
  the permanent default.
- ✅ Engagement is distinct from Discipline and does not add a roster or schedule badge in this
  story.
- ✅ For a **Placeholder** the Engagement control is hidden and the stored value is always Studio.
