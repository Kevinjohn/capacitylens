# US-DAT-05 — Server data persists across reload

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/persistence.db.spec.ts`

## Goal

Create or edit a record in the server-backed app, reload, and see the committed value again.

## Acceptance

- A saved client survives a full reload through SQLite.
- A saved rename survives a full reload.
- An archived row remains hidden after reload and still exists in inactive data.
- The in-memory demo is deliberately different: reload restores its canonical seed.
