export const AUDIT_WARNING_EVENT = "capacitylens:audit-warning";

/** Notify mounted operational-warning surfaces that audit delivery became degraded. */
export function announceAuditWarning(): void {
  globalThis.dispatchEvent?.(new Event(AUDIT_WARNING_EVENT));
}
