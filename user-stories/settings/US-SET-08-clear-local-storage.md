# US-SET-08 — Device data and offline snapshots

**Area:** Device data · **Persona:** User · **Linked coverage:** `src/data/clearLocalStorage.test.ts` and offline cache cleanup tests

**Documentation:** [Settings](../../docs-src/using/settings.md)

## Goal

Keep browser-owned preferences and optional offline snapshots separate from company data. Settings
does not currently expose a control to wipe all CapacityLens data from this browser.

## Why

Offline snapshots clear when a user turns off offline access or signs out. Ordinary display
preferences remain saved in the browser.

## How (end-to-end)

**Precondition:** Offline access is enabled on this browser.

1. Turn off **Make this device available offline** or sign out to clear the cached company snapshot.
2. Confirm ordinary display preferences remain saved in this browser.

## Acceptance criteria

- ✅ Signing out clears the current user's offline snapshots; turning off offline access clears its
  cached snapshot.
- ✅ Settings does not display the Device data section or a clear-all action.
