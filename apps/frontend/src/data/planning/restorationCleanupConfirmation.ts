type Request = { count: number; resolve: (confirmed: boolean) => void; detach: () => void };
let pending: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Opens one cleanup decision; context cancellation releases it without authorizing a retry. */
export function requestRestorationCleanup(count: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || pending) return Promise.resolve(false);
  return new Promise((resolve) => {
    const abort = () => completeRestorationCleanup(false);
    pending = { count, resolve, detach: () => signal.removeEventListener("abort", abort) };
    signal.addEventListener("abort", abort, { once: true });
    emit();
  });
}

/** Completes only the currently displayed decision and releases its abort listener. */
export function completeRestorationCleanup(confirmed: boolean): void {
  const request = pending;
  if (!request) return;
  pending = null;
  request.detach();
  emit();
  request.resolve(confirmed);
}

/** Stable primitive snapshot for React's external-store subscription. */
export const readRestorationCleanupCount = (): number | null => pending?.count ?? null;
/** Subscribes the sole dialog host to the current cleanup decision. */
export function subscribeRestorationCleanup(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
