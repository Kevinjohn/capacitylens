export const AUDIT_WARNING_EVENT = 'capacitylens:audit-warning'

export function announceAuditWarning(): void {
  globalThis.dispatchEvent?.(new Event(AUDIT_WARNING_EVENT))
}
