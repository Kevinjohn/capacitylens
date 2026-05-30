# US-DAT-04 — Reject a non-Floaty file safely

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "rejects an unrecognised file with a notice and preserves existing data"

## Goal
Pick the wrong file and have Floaty refuse it with a clear notice, leaving the current data exactly as it was — never a silent wipe.

## Why
Import replaces everything, so feeding it a random JSON or a non-Floaty file must be a no-op, not a catastrophe. A guard checks the file actually looks like Floaty data before doing anything; if it doesn't, the manager gets a plain explanation and keeps their work.

## How (end-to-end)
**Precondition:** Seeded app open. Prepare a file that is **not** recognisable Floaty data. Use one of:
- a plain-text/garbage file (e.g. contents `hello world`, which isn't even valid JSON), or
- a JSON object with none of Floaty's entity keys, e.g. `{ "hello": "world" }`.
  (Note: a file like `{ "resources": [] }` *would* be accepted — the guard recognises any of `resources`, `disciplines`, `clients`, `projects`, `phases`, `tasks`, `allocations`, `timeOff` as an array — so the test file must contain none of those keys as arrays.)
1. Note the current data (e.g. Clients shows *Acme Inc.* and *Globex*; the Schedule has the seed bars).
2. In the sidebar **Data** section, click **Import JSON** and choose the non-Floaty file.
3. Observe the result — no confirmation dialog appears; instead a notice toast is shown.

## Acceptance criteria
- ✅ Choosing an unrecognised file shows the rejection toast **"Could not import that file — it is not valid Floaty JSON."** and does **not** open the "Import data?" confirmation dialog.
- ✅ The current dataset is fully preserved — no entities are removed or changed (the Clients list still shows *Acme Inc.* and *Globex*; the seed schedule is intact). There is no silent wipe.
- ✅ A subsequent valid import still works normally (the failed attempt doesn't leave the import flow stuck).
