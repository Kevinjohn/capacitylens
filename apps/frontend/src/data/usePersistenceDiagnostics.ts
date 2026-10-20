import { useSyncExternalStore } from "react";
import { readPersistenceDiagnosticsSnapshot, subscribePersistenceDiagnostics } from "./persistenceDiagnostics";

/** Reactive view of the process-local persistence counters (failed saves, rebased edits, whether
 * persistence is suspended) that the Diagnostics page adds to its support report. */
export function usePersistenceDiagnostics() {
  return useSyncExternalStore(
    subscribePersistenceDiagnostics,
    readPersistenceDiagnosticsSnapshot,
    readPersistenceDiagnosticsSnapshot,
  );
}
