# US-NAV-04 — Persistence-failure banner

**Area:** Navigation & shell · **Persona:** Studio manager · **Linked E2E:** manual + unit (`src/data/persist.test.ts` seed-fail — a failed write surfaces the error that flips the banner)

## Goal
Get an unmistakable warning when CapacityLens can't save to browser storage, while still
being able to keep working in-memory for the rest of the session.

## Why
All data lives in `localStorage`. In private/incognito mode, or when the storage quota
is exhausted, writes silently fail — and a manager could spend an afternoon scheduling
work that evaporates on reload. A persistent red banner makes the data-loss risk
visible the moment a save fails, instead of discovering it too late.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`). The save is debounced, so the
banner appears shortly after the change that triggers the failed write.

**Simulating a save failure (pick one):**
- *Override `setItem` (most reliable):* open DevTools → Console and run
  `localStorage.setItem = () => { throw new Error('quota') }`. Then make any change
  (steps below) to trigger a write.
- *Private mode / fill quota:* open the app in a private window, or fill `localStorage`
  near its quota in another tab, so the next write rejects.

1. With `setItem` overridden (or in private mode), go to **Clients** → **Add client**.
2. Fill **Name** = `Quota Test` and click **Save**.
3. Wait ~1s for the debounced persist to attempt its write and fail.
4. A red banner appears at the top of the content area reading:
   **"Changes aren't being saved — your browser storage is full or unavailable."**
5. Confirm the app still works in-memory: the *Quota Test* row is present and you can
   keep navigating and editing (the data just won't survive a reload).

## Acceptance criteria
- ✅ On a failed write, a red banner (`role="alert"`) shows the exact text
  "Changes aren't being saved — your browser storage is full or unavailable."
- ✅ The banner appears at the top of the main content area, above the current screen.
- ✅ The app remains usable in-memory after the failure: the just-made change is still
  visible and further navigation/edits work.
- ✅ With storage healthy (no override, normal window), the banner does **not** appear.
