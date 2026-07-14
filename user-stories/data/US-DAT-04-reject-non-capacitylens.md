# US-DAT-04 — Reject a non-CapacityLens file safely

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "rejects a non-CapacityLens file with a notice and preserves existing data"

## Goal
Pick the wrong file and have CapacityLens refuse it with a clear notice, leaving the current data exactly as it was — never a silent wipe.

## Why
Import replaces everything, so feeding it a random JSON or a non-CapacityLens file must be a no-op, not a catastrophe. A guard checks the file actually looks like CapacityLens data before doing anything; if it doesn't, the manager gets a plain explanation and keeps their work.

## How (end-to-end)
**Precondition:** Seeded app open. Prepare a file that is **not** recognisable CapacityLens data. Use one of:
- a plain-text/garbage file (e.g. contents `hello world`, which isn't even valid JSON), or
- a JSON object with none of CapacityLens's entity keys, e.g. `{ "hello": "world" }`.
  (Note: a file like `{ "resources": [] }` *would* be accepted — the guard recognises any of `resources`, `disciplines`, `clients`, `projects`, `phases`, `activities`, `allocations`, `timeOff` as an array — so the test file must contain none of those keys as arrays.)
1. Note the current data (e.g. Clients shows *Acme Inc.* and *Globex*; the Schedule has the seed bars).
2. In the sidebar **Data** section, click **Import JSON** and choose the non-CapacityLens file.
3. Observe the result — no confirmation dialog appears; instead a notice toast is shown.

## Acceptance criteria
- ✅ Choosing an unrecognised file shows a rejection toast naming the SPECIFIC reason — **"This file is not CapacityLens data."** for a JSON object with none of CapacityLens's entity keys, or **"That file isn't valid JSON."** for a non-JSON/garbage file — and does **not** open the "Import data?" confirmation dialog. (The toast surfaces the real reason rather than one generic message, so the manager knows what was wrong with the file.)
- ✅ The current dataset is fully preserved — no entities are removed or changed (the Clients list still shows *Acme Inc.* and *Globex*; the seed schedule is intact). There is no silent wipe.
- ✅ A subsequent valid import still works normally (the failed attempt doesn't leave the import flow stuck).
