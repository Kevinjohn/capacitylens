# US-DAT-01 — Export the dataset to JSON

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/crud.spec.ts` → "exports the dataset and re-imports it (round-trip)"

## Goal
Download the entire current dataset as a `floaty-data.json` file, as a one-click backup and a way to hand a snapshot to someone else.

## Why
Floaty is local-first by default — everything lives in this browser's `localStorage`. Before clearing the browser, switching machines, or sharing a plan, the manager needs a portable copy. Export writes a single self-describing JSON file they can keep or re-import later.

## How (end-to-end)
**Precondition:** Seeded app open (any screen). The **Data** section is at the bottom of the left sidebar.
1. In the sidebar **Data** section, click **Export JSON** (`data-testid="export-data"`).
2. The browser downloads a file named **`floaty-data.json`** (no dialog; the download starts immediately).
3. Open the downloaded file in a text editor to inspect its contents.

## Acceptance criteria
- ✅ Clicking **Export JSON** triggers a download named exactly **`floaty-data.json`** of MIME type `application/json`.
- ✅ The file's top level is a wrapper object `{ "schemaVersion": <number>, "data": { … } }` — not a bare entity array.
- ✅ The `data` object holds the current entities under the keys `resources`, `disciplines`, `clients`, `projects`, `phases`, `tasks`, `allocations`, `timeOff` (each an array).
- ✅ For the seeded dataset, `data.resources` includes the seed people/placeholder (e.g. `r-tyler`, `r-nike`, `r-alex`, `r-ph-designer`) and `data.timeOff` includes Tyler's 10–12 June holiday — i.e. the file reflects the live state, not an empty template.
- ✅ Keep this downloaded file — it is the input for US-DAT-02 (Import) and US-DAT-03 (Undo import).
