import { AsyncLocalStorage } from "node:async_hooks";

interface RequestWorkContext {
  signal: AbortSignal;
  reportQueueSaturation?: (queue: string, reason: "full" | "wait_timeout") => void;
}

const requestAbortContext = new AsyncLocalStorage<RequestWorkContext>();

/**
 * Runs work with the request’s abort signal and queue-saturation reporter in async-local context.
 */
export function runWithRequestAbortSignal<T>(
  signal: AbortSignal,
  callback: () => T,
  reportQueueSaturation?: RequestWorkContext["reportQueueSaturation"],
): T {
  return requestAbortContext.run(
    { signal, ...(reportQueueSaturation === undefined ? {} : { reportQueueSaturation }) },
    callback,
  );
}

/**
 * Returns the abort signal associated with the current asynchronous request, if one was set.
 */
export function readCurrentRequestAbortSignal(): AbortSignal | undefined {
  return requestAbortContext.getStore()?.signal;
}

/**
 * Reports queue saturation through the reporter registered for the current request.
 */
export function reportCurrentRequestQueueSaturation(queue: string, reason: "full" | "wait_timeout"): void {
  requestAbortContext.getStore()?.reportQueueSaturation?.(queue, reason);
}
