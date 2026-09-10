const listeners = new Set<(accountId: string) => void>();

export function notifyInactiveDataChanged(accountId: string): void {
  for (const listener of listeners) listener(accountId);
}

export function subscribeToInactiveDataChanges(listener: (accountId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
