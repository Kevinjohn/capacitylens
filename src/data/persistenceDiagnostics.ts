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

export function incrementPersistenceDiagnostic(counter: Counter): void {
  publish({ ...diagnostics, [counter]: diagnostics[counter] + 1 });
}

export function setPersistenceSuspended(suspended: boolean): void {
  if (diagnostics.suspended === suspended) return;
  publish({ ...diagnostics, suspended });
}

export function persistenceDiagnosticsSnapshot(): PersistenceDiagnostics {
  return diagnostics;
}

export function subscribePersistenceDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset process-local counters when attaching a fresh application lifecycle or test fixture. */
export function resetPersistenceDiagnostics(): void {
  publish({ ...initialDiagnostics });
}
