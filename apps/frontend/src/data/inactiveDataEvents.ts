const listeners = new Set<(companyId: string) => void>();

/** Notifies listeners that an inactive company set changed. */
export function notifyInactiveDataChanged(companyId: string): void {
  for (const listener of listeners) listener(companyId);
}

/** Subscribes to inactive company set changes and returns an unsubscribe function. */
export function subscribeToInactiveDataChanges(listener: (companyId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
