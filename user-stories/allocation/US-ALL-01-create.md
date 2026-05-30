# US-ALL-01 — Create an allocation via the modal

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "creates an allocation from the modal and shows the bar" · `e2e/scheduler.spec.ts` → "draws a new allocation on an empty part of a lane"

## Goal
Book a person onto a task for a date range, with a chosen hours/day and status, so the work shows as a bar on the schedule.

## Why
Scheduling work is the core job of the app. A studio manager plans who does what and when; every capacity and utilisation cue downstream is computed from these allocations. The modal is the precise, keyboard-friendly way to enter one (as opposed to a rough lane draw).

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01` so the June bars are visible.
1. On the **Tyler Nix** row, click the **+** (`Add allocation`) button at the right of the name column. The **New allocation** dialog opens with **Assignee** already set to *Tyler Nix*.
2. Choose **Project** = *Acme Inc. / Project Lightning*.
3. Optionally choose **Phase** = *Discovery* (or leave *— Any / none —*).
4. Choose **Task** = *Wireframes*.
5. Set **Start** = `2026-06-16` and **End** = `2026-06-18`.
6. Set **Hours / day** = `6`.
7. Set **Status** = *Confirmed*.
8. Optionally type a **Note**.
9. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ After Save, a new `allocation-bar` appears on the **Tyler Nix** row spanning 16–18 June, labelled with the task (*Wireframes*) and `· 6h`.
- ✅ The bar carries `data-status="confirmed"`.
- ✅ When the modal is opened from the row **+**, the **Assignee** is preselected to that row's resource (here *Tyler Nix*) before any other field is touched.
- ✅ Choosing a **Project** repopulates **Phase**/**Task** to that project; **Task** only lists that project's tasks.
- ✅ Drawing a left-to-right gesture on an empty part of a lane (in **Work** draw mode) instead opens the same **New allocation** dialog, preset to that lane's resource and the drawn dates.
