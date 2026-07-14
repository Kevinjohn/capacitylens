# US-NAV-03 — Content is gated on hydration

**Area:** Navigation & shell · **Linked test:** `src/components/AppShell.test.tsx`

The content area shows **Loading…** until the selected persistence adapter has hydrated the store.
No empty schedule/list flashes before data arrives. In server mode this covers the API load; in demo
mode it covers the in-memory seed.
