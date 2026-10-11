import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import type { MasqueradeErrorCode } from "@capacitylens/shared/domain/masquerade";
import { noteAuditWarning } from "@/lib/auditWarning";
import { readApiErrorCode } from "@/lib/readApiError";

let masqueradeEndedHandler: (() => void) | null = null;

/** Register the session-projection recovery hook without coupling the common fetch layer to React. */
export function setMasqueradeEndedHandler(handler: (() => void) | null): void {
  masqueradeEndedHandler = handler;
}

// Interactive calls fail quickly; whole-slice reads and writes need a longer deadline
// to complete on a healthy but slow server. A timed-out batch has an uncertain commit
// boundary and requires authoritative reconciliation before another write.
/** Default deadline for interactive API requests. */
export const API_REQUEST_TIMEOUT_MS = 15_000;
/** Longer deadline for whole-slice API reads and writes. */
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

/** Builds a request signal using the supplied millisecond deadline, or the interactive
 * default when omitted. Null disables the client deadline for keepalive teardown.
 * A caller signal is always honored and can abort before the deadline.
 */
export function createRequestSignal(
  signal?: AbortSignal | null,
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
  if (timeout && signal) return AbortSignal.any([signal, timeout]);
  if (timeout) return timeout;
  if (signal) return signal;

  return new AbortController().signal;
}

/** Read a recognized masquerade failure code without consuming the caller's response body. */
export async function readMasqueradeErrorCode(response: Response): Promise<MasqueradeErrorCode | null> {
  const code = await readApiErrorCode(response);
  return Object.values(MASQUERADE_ERROR_CODES).some((candidate) => candidate === code)
    ? (code as MasqueradeErrorCode)
    : null;
}

/** Fetches an API response with a caller signal and the selected deadline. */
export async function apiFetch(
  input: RequestInfo | URL,
  requestOptions: RequestInit = {},
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const response = await fetch(input, {
    ...requestOptions,
    signal: createRequestSignal(requestOptions.signal, timeoutMs),
  });
  // Defer until the direct action's own success notice has run; otherwise that notice immediately
  // overwrites the more important persistent audit warning in the single-notice store.
  noteAuditWarning(response, { defer: true });
  if (response.status === 403) {
    const code = await readMasqueradeErrorCode(response);
    if (code === MASQUERADE_ERROR_CODES.ended) masqueradeEndedHandler?.();
  }
  return response;
}
