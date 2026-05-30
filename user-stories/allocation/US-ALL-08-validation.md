# US-ALL-08 — The modal rejects bad input

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "rejects invalid allocation input with field-associated errors"

## Goal
Stop an allocation being saved with missing or nonsensical input, and point the manager at the offending field with a clear message.

## Why
A booking with no resource, no task, empty or reversed dates, or zero hours is meaningless and would corrupt capacity maths (e.g. a NaN-width bar). Catching it at save time, with the error tied to the right field, keeps the data trustworthy and the fix obvious.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. Open **New allocation** from a row **+**.
1. With **Assignee** cleared (`— Select resource —`), click **Save** → rejected.
2. Set an Assignee, leave **Task** empty (`— Select task —`), click **Save** → rejected.
3. Choose a Task, then clear **Start** (or **End**), click **Save** → rejected.
4. Set **End** earlier than **Start**, click **Save** → rejected.
5. Set **Hours / day** = `0`, click **Save** → rejected.

## Acceptance criteria
- ✅ No resource: dialog stays open, message **"Choose a resource."**, and the **Assignee** field is marked `aria-invalid`.
- ✅ No task: dialog stays open, message **"Choose (or add) a task."**, **Task** marked `aria-invalid`.
- ✅ Empty date: dialog stays open, message **"Start and end dates are required."**, **Start**/**End** marked `aria-invalid`; no bar with a NaN width is created.
- ✅ Reversed dates (end < start): dialog stays open, message **"End date cannot be before the start date."** on the date fields.
- ✅ Zero hours: dialog stays open, message **"Hours per day must be greater than 0."**, **Hours / day** marked `aria-invalid`.
- ✅ In every invalid case the dialog stays open and no new bar appears on the schedule until the input is valid.
