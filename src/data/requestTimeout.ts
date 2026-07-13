import { announceAuditWarning } from '../lib/auditWarning'

// Two deadline tiers, because one bound can't fit every call. Interactive calls (a single
// entity write, an auth check, a `hasData` probe) must fail FAST — a wedged socket should
// surface within seconds. But the three BULK operations — the whole-slice `GET /api/state`
// load/hydrate, the atomic `POST /api/batch` write, and the full inactive-slice export — can
// legitimately take far longer on a large tenant against a healthy-but-slow server, and the
// batch is the dangerous one: aborting a still-in-flight batch makes `drain` NOT advance
// `lastSynced`, so persist.ts retries the identical diff forever (the banner never clears) even
// though nothing is actually broken. So bulk calls get a much longer bound.
export const API_REQUEST_TIMEOUT_MS = 15_000
export const API_BULK_TIMEOUT_MS = 120_000

// Combine abort signals with a fallback for engines that ship `AbortSignal.timeout` but not the
// newer `AbortSignal.any` (e.g. Safari 17.0–17.3): without this guard the FIRST API call throws
// `AbortSignal.any is not a function` and the whole app can neither hydrate nor save. The fallback
// mirrors `any` — a controller that aborts as soon as any input signal does.
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/**
 * Build the abort signal for an API call. `timeoutMs` picks the deadline tier:
 *   - omitted → the interactive {@link API_REQUEST_TIMEOUT_MS} (15s) bound;
 *   - {@link API_BULK_TIMEOUT_MS} (or any number) → that longer bound, for whole-slice reads/writes;
 *   - `null` → NO client deadline at all — for the keepalive unload flush, where a timeout is
 *     self-contradictory (the request is meant to OUTLIVE the page). The durable write journal, not
 *     a wall-clock, is the guard there.
 * A caller `signal` is always honoured; the result aborts as soon as EITHER it or the timeout does.
 */
export function requestSignal(
  signal?: AbortSignal | null,
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs)
  if (timeout && signal) return anySignal([signal, timeout])
  if (timeout) return timeout
  if (signal) return signal
  // No timeout and no caller signal: a signal that never aborts (equivalent to omitting one).
  return new AbortController().signal
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const response = await fetch(input, { ...init, signal: requestSignal(init.signal, timeoutMs) })
  // Defer until the direct action's own success notice has run; otherwise that notice immediately
  // overwrites the more important persistent audit warning in the single-notice store.
  if (response.headers?.get?.('x-capacitylens-audit-warning') === 'true') {
    globalThis.setTimeout(() => announceAuditWarning(), 0)
  }
  return response
}
