# US-NAV-21 — Recover unreadable browser storage

As a demo user, I want to download the browser data and confirm a reset when local data cannot be read so that I can preserve a copy before recovery.

**Status:** Current

**Access:** Anyone whose local browser data triggers the storage recovery screen; no company role applies.

**Entry:** Browser storage recovery screen → Download data or Reset stored data.

**Documentation:** [When something goes wrong](../../docs-src/self-hosting/incidents.md)

**Source:** [StorageRecovery.tsx](../../apps/frontend/src/components/StorageRecovery.tsx); [AppEntryGate.tsx](../../apps/frontend/src/components/AppEntryGate.tsx); [clearLocalStorage.ts](../../apps/frontend/src/data/clearLocalStorage.ts)

## Acceptance criteria

- Download data saves a JSON copy of CapacityLens browser storage. Reset stored data requires explicit confirmation, clears the local application data, and reloads; cancelling leaves stored bytes unchanged. Download and reset failures remain visible.
