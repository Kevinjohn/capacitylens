const listeners = new Set<(accountId: string) => void>();

/** Notifies listeners that an inactive account slice changed. */
export function notifyInactiveDataChanged(accountId: string): void {
  for (const listener of listeners) listener(accountId);
}

/** Subscribes to inactive account slice changes and returns an unsubscribe function. */
export function subscribeToInactiveDataChanges(listener: (accountId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
