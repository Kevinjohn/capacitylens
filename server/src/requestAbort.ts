import { AsyncLocalStorage } from "node:async_hooks";

interface RequestWorkContext {
  signal: AbortSignal;
  reportQueueSaturation?: (queue: string, reason: "full" | "wait_timeout") => void;
}

const requestAbortContext = new AsyncLocalStorage<RequestWorkContext>();

export function runWithRequestAbortSignal<T>(
  signal: AbortSignal,
  callback: () => T,
  reportQueueSaturation?: RequestWorkContext["reportQueueSaturation"],
): T {
  return requestAbortContext.run({ signal, reportQueueSaturation }, callback);
}

export function currentRequestAbortSignal(): AbortSignal | undefined {
  return requestAbortContext.getStore()?.signal;
}

export function reportCurrentRequestQueueSaturation(queue: string, reason: "full" | "wait_timeout"): void {
  requestAbortContext.getStore()?.reportQueueSaturation?.(queue, reason);
}
