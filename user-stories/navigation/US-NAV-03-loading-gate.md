# US-NAV-03 — Content is gated on hydration

**Area:** Navigation & shell · **Persona:** User · **Coverage:** `src/components/AppShell.test.tsx`

## Goal

Wait for the selected data source to hydrate before seeing account content.

## Why

Rendering an empty schedule while real data is still loading looks like data loss and briefly exposes
controls against an incomplete state. A loading gate makes that boundary explicit.

## How (end-to-end)

**Precondition:** Open the app with hydration deliberately delayed in the test harness.

1. Begin loading the selected server or demo adapter.
2. Observe **Loading…** in the content area while hydration is pending.
3. Complete hydration and observe the requested schedule or list replace the loading state.

## Acceptance criteria

- ✅ The content area shows **Loading…** until the selected persistence adapter hydrates the store.
- ✅ No empty schedule or list flashes before data arrives.
- ✅ Server mode waits for the API load; demo mode waits for the in-memory seed.
