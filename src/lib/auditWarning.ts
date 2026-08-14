export const AUDIT_WARNING_EVENT = "capacitylens:audit-warning";

/** The response header an API server sets when audit delivery became degraded. */
export const AUDIT_WARNING_HEADER = "x-capacitylens-audit-warning";

/** Notify mounted operational-warning surfaces that audit delivery became degraded. */
export function announceAuditWarning(): void {
  globalThis.dispatchEvent?.(new Event(AUDIT_WARNING_EVENT));
}

/**
 * Announce the audit-degradation warning when a response carries {@link AUDIT_WARNING_HEADER}.
 * The one place the header name and its "true" spelling live, shared by apiFetch and the sync
 * adapter's dedicated routes (which bypass apiFetch and would otherwise drop the header silently).
 *
 * `defer` picks the DISPATCH TIMING, which is not cosmetic:
 *   - `true` (apiFetch's direct user actions) waits a macrotask so the action's own success notice
 *     has already run; otherwise that notice immediately overwrites the more important persistent
 *     audit warning in the single-notice store.
 *   - the default announces SYNCHRONOUSLY, as the background sync paths always have: they raise no
 *     competing success notice, and the caller usually throws or returns straight after.
 */
export function noteAuditWarning(
  res: { headers?: { get?: (name: string) => string | null } },
  opts: { defer?: boolean } = {},
): void {
  if (res.headers?.get?.(AUDIT_WARNING_HEADER) !== "true") return;
  if (opts.defer) globalThis.setTimeout(() => announceAuditWarning(), 0);
  else announceAuditWarning();
}
