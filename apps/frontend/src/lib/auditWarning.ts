/** Window event used to publish a supplementary server logging warning. */
export const AUDIT_WARNING_EVENT = 'capacitylens:audit-warning';

/** The response header an API server sets when supplementary server logging failed after the change committed. */
export const AUDIT_WARNING_HEADER = 'x-capacitylens-audit-warning';

/** Notify mounted operational-warning surfaces that supplementary server logging failed after the change committed. */
export function announceAuditWarning(): void {
  const dispatchTarget = globalThis as { dispatchEvent?: (event: Event) => boolean };
  if (typeof dispatchTarget.dispatchEvent === 'function') {
    dispatchTarget.dispatchEvent.call(globalThis, new Event(AUDIT_WARNING_EVENT));
  }
}

/** Announces a response audit warning after one macrotask to follow immediate action feedback. Actions
 * awaiting further work must also retain this response fact in their final notice.
 */
export function noteAuditWarning(res: {
  headers?: { get?: (name: string) => string | null };
}): void {
  if (res.headers === undefined || res.headers.get === undefined) return;
  if (res.headers.get(AUDIT_WARNING_HEADER) !== 'true') return;
  globalThis.setTimeout(() => announceAuditWarning(), 0);
}
