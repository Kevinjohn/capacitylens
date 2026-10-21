/** Window event used to publish a server audit warning. */
export const AUDIT_WARNING_EVENT = "capacitylens:audit-warning";

/** The response header an API server sets when audit delivery became degraded. */
export const AUDIT_WARNING_HEADER = "x-capacitylens-audit-warning";

/** Notify mounted operational-warning surfaces that audit delivery became degraded. */
export function announceAuditWarning(): void {
  const dispatchTarget = globalThis as { dispatchEvent?: (event: Event) => boolean };
  if (typeof dispatchTarget.dispatchEvent === "function") {
    dispatchTarget.dispatchEvent.call(globalThis, new Event(AUDIT_WARNING_EVENT));
  }
}

/** Announces a response audit warning. defer waits one macrotask so a direct action
 * success notice cannot overwrite the persistent warning; background sync announces
 * synchronously because it has no competing success notice.
 */
export function noteAuditWarning(
  res: { headers?: { get?: (name: string) => string | null } },
  options: { defer?: boolean } = {},
): void {
  if (res.headers === undefined || res.headers.get === undefined) return;
  if (res.headers.get(AUDIT_WARNING_HEADER) !== "true") return;
  if (options.defer) globalThis.setTimeout(() => announceAuditWarning(), 0);
  else announceAuditWarning();
}
