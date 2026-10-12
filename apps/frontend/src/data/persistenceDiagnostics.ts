/** Counters and status exposed for persistence troubleshooting. */
export interface PersistenceDiagnostics {
  savesFailed: number;
  retriesArmed: number;
  reconciliationsResolved: number;
  reloadsSuperseded: number;
  editsRebased: number;
  editsDiscarded: number;
  suspended: boolean;
}

type Counter = Exclude<keyof PersistenceDiagnostics, "suspended">;

const initialDiagnostics: PersistenceDiagnostics = {
  savesFailed: 0,
  retriesArmed: 0,
  reconciliationsResolved: 0,
  reloadsSuperseded: 0,
  editsRebased: 0,
  editsDiscarded: 0,
  suspended: false,
};

let diagnostics = initialDiagnostics;
const listeners = new Set<() => void>();

function publish(next: PersistenceDiagnostics): void {
  if (Object.is(next, diagnostics)) return;
  diagnostics = next;
  for (const listener of listeners) listener();
}

/** Increments one persistence diagnostic counter and notifies subscribers. */
export function incrementPersistenceDiagnostic(counter: Counter): void {
  publish({ ...diagnostics, [counter]: diagnostics[counter] + 1 });
}

/** Updates the suspended status in the diagnostics snapshot. */
export function setPersistenceSuspended(suspended: boolean): void {
  if (diagnostics.suspended === suspended) return;
  publish({ ...diagnostics, suspended });
}

/** Returns the current persistence diagnostics snapshot. */
export function readPersistenceDiagnosticsSnapshot(): PersistenceDiagnostics {
  return diagnostics;
}

/** Subscribes to persistence diagnostic changes. */
export function subscribePersistenceDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset process-local counters when attaching a fresh application lifecycle or test fixture. */
export function resetPersistenceDiagnostics(): void {
  publish({ ...initialDiagnostics });
}
