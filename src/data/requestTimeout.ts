import { MASQUERADE_ERROR_CODES, type MasqueradeErrorCode } from "@capacitylens/shared/domain/masquerade";
import { noteAuditWarning } from "../lib/auditWarning";

let masqueradeEndedHandler: (() => void) | null = null;

/** Register the session-projection recovery hook without coupling the common fetch layer to React. */
export function setMasqueradeEndedHandler(handler: (() => void) | null): void {
  masqueradeEndedHandler = handler;
}

// Two deadline tiers, because one bound can't fit every call. Interactive calls (a single
// entity write, an auth check, a `hasData` probe) must fail FAST — a wedged socket should
// surface within seconds. But the three BULK operations — the whole-slice `GET /api/state`
// load/hydrate, the atomic `POST /api/batch` write, and the full inactive-slice export — can
// legitimately take far longer on a large tenant against a healthy-but-slow server, and the
// batch is the dangerous one: aborting a still-in-flight batch makes `drain` NOT advance
// `lastSynced`, so persist.ts retries the identical diff forever (the banner never clears) even
// though nothing is actually broken. So bulk calls get a much longer bound.
export const API_REQUEST_TIMEOUT_MS = 15_000;
export const API_BULK_TIMEOUT_MS = 120_000;

/** Browser fetch failures that mean the service was unreachable rather than semantically invalid. */
export function isTransportFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

/**
 * Build the abort signal for an API call. `timeoutMs` picks the deadline tier:
 *   - omitted → the interactive {@link API_REQUEST_TIMEOUT_MS} (15s) bound;
 *   - {@link API_BULK_TIMEOUT_MS} (or any number) → that longer bound, for whole-slice reads/writes;
 *   - `null` → NO client deadline at all — for the keepalive unload flush, where a timeout is
 *     self-contradictory (the request is meant to outlive the page as far as the browser permits).
 * A caller `signal` is always honoured; the result aborts as soon as EITHER it or the timeout does.
 */
export function requestSignal(
  signal?: AbortSignal | null,
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
  if (timeout && signal) return AbortSignal.any([signal, timeout]);
  if (timeout) return timeout;
  if (signal) return signal;
  // No timeout and no caller signal: a signal that never aborts (equivalent to omitting one).
  return new AbortController().signal;
}

/** Read a recognized masquerade failure code without consuming the caller's response body. */
export async function masqueradeErrorCode(response: Response): Promise<MasqueradeErrorCode | null> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    // Error classification is best-effort; the caller still handles the original HTTP failure.
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  if (typeof code !== "string") return null;
  return Object.values(MASQUERADE_ERROR_CODES).some((candidate) => candidate === code)
    ? (code as MasqueradeErrorCode)
    : null;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const response = await fetch(input, { ...init, signal: requestSignal(init.signal, timeoutMs) });
  // Defer until the direct action's own success notice has run; otherwise that notice immediately
  // overwrites the more important persistent audit warning in the single-notice store.
  noteAuditWarning(response, { defer: true });
  if (response.status === 403) {
    const code = await masqueradeErrorCode(response);
    if (code === MASQUERADE_ERROR_CODES.ended) masqueradeEndedHandler?.();
  }
  return response;
}
