import { useSyncExternalStore } from "react";
import {
  offlineReadEnabled,
  offlineStateSnapshot,
  subscribeOfflinePreference,
  subscribeOfflineState,
} from "./offlineCache";
import { persistenceDiagnosticsSnapshot, subscribePersistenceDiagnostics } from "./persistenceDiagnostics";

// React bindings for the data layer's plain subscribe/snapshot stores. Each store is deliberately
// framework-free (it is read from persistence code and the service worker, not just components), so
// the `useSyncExternalStore(subscribe, snapshot, snapshot)` wiring lives here — once per store —
// rather than being re-typed at every component that reads one. Passing the SAME snapshot function
// as the server snapshot is correct for all of them: these are device/process facts with no
// server-rendered counterpart, and each returns a stable reference between publishes (so
// useSyncExternalStore's identity check can't loop).

/** Reactive view of the device's read-only offline state. */
export function useOfflineState() {
  return useSyncExternalStore(subscribeOfflineState, offlineStateSnapshot, offlineStateSnapshot);
}

/** Reactive view of the offline-read PREFERENCE — has the user opted this device in? Distinct from
 *  {@link useOfflineState}, which reports whether offline reading is currently in EFFECT; this is the
 *  toggle's own value, and it fails closed when the preference cannot be read. */
export function useOfflineReadEnabled(): boolean {
  return useSyncExternalStore(subscribeOfflinePreference, offlineReadEnabled, offlineReadEnabled);
}

/** Reactive view of the process-local persistence counters (failed saves, rebased edits, whether
 *  persistence is suspended) that Settings surfaces as a diagnostics readout. */
export function usePersistenceDiagnostics() {
  return useSyncExternalStore(
    subscribePersistenceDiagnostics,
    persistenceDiagnosticsSnapshot,
    persistenceDiagnosticsSnapshot,
  );
}
