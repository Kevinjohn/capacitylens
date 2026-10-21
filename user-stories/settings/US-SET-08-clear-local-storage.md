# US-SET-08 — Device preferences

**Area:** Device data · **Persona:** User · **Linked coverage:** `apps/frontend/src/data/clearLocalStorage.test.ts`

**Documentation:** [Settings](../../docs-src/using/settings.md#my-display)

## Goal

Keep browser-owned preferences separate from company scheduling data.

## Why

Display preferences belong to this browser. The server owns the company schedule; a failed request
must never substitute a saved browser copy or queue writes.

## How (end-to-end)

1. Change a display preference such as theme or allocation labels.
2. Reload and confirm the preference remains while scheduling data is read from the server.
3. If the server cannot be reached, use the visible retry control after reconnecting.

## Acceptance criteria

- Ordinary display preferences remain saved in this browser and stay outside company exports.
- Scheduling records and identity snapshots are never saved in IndexedDB.
- A failed server read or save remains visible and never falls back to browser persistence.
- The demo remains in memory and resets on reload.
- Settings does not display the Device data section or a clear-all action.
