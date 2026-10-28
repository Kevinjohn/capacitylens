# US-DAT-05 — Server data persists across reload

**Area:** Data management · **Persona:** Studio manager · **Linked E2E:** `e2e/persistence.db.spec.ts`

## Goal

Create or edit a record in the server-backed app, reload, and see the committed value again.

## Why

A successful save must mean the server owns the change durably. Reloading is the simplest
user-visible proof that the value came back from SQLite rather than surviving only in page memory.

## How (end-to-end)

**Precondition:** Sign in to the server-backed app and open its company.

1. Add a client and save it.
2. Reload the page and confirm the server opens the same company with the client still present.
3. Rename that client, save, and reload again.
4. Archive the client, reload, and inspect active and inactive views.
5. In a second session, change the same company while the first session is open. In the first
   session, try an edit based on its older company revision and review the conflict response.

## Acceptance criteria

- ✅ A saved client survives a full reload through SQLite.
- ✅ A saved rename survives a full reload.
- ✅ An archived row remains hidden after reload and still exists in inactive data.
- ✅ A stale planning mutation is refused on revision conflict and the client reloads the current
  company slice so the user can review and reapply the intended change.
- ✅ If the response to a mutation is uncertain, its mutation id is looked up before the user retries;
  absence is not treated as failure while the request may still be executing.
- ✅ The in-memory demo stays editable, including booking changes and Undo/Redo, but stores its data
  only for the current page. Reload restores its canonical seed and clears its history.
