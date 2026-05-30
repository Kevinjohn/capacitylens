# US-DAT-05 — Data persists across a full reload

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/data.spec.ts` → "persists a newly added entity across a full page reload"

## Goal
Add something, fully reload the page, and find it still there — Floaty saves to `localStorage` automatically.

## Why
Local-only means there's no server doing the saving; the browser is the database. A manager must be able to close the tab or reload mid-session and trust nothing is lost — otherwise the tool can't be relied on for real planning.

## How (end-to-end)
**Precondition:** Seeded app open; click **Clients** in the sidebar (`/clients`).
1. Click **Add client**, set **Name** = `Reload Test Co.`, and **Save**. The new client appears in the list.
2. Do a **full browser reload** (e.g. ⌘R / F5 — not just an in-app navigation), so the app re-bootstraps from `localStorage`.
3. After the app finishes loading, return to **Clients** (`/clients`) and look for the row.

## Acceptance criteria
- ✅ Before reload, **Reload Test Co.** appears in the Clients list.
- ✅ After a full page reload, **Reload Test Co.** is still present in the Clients list (it was written to `localStorage`, under the key `floaty/v1`, and re-loaded on bootstrap).
- ✅ The rest of the seed data is also intact after reload (the reload restores the whole persisted dataset, not just the new entity).
- ✅ This holds for an edit immediately before reload too: the persistence layer flushes pending writes on tab hide/close, so a change made just before reloading is not lost inside the save debounce window.
