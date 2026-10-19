import { EventEmitter } from 'node:events'

export type CspSecurityEvent = Record<string, unknown>

/** Internal observability hook for sanitized CSP reports. */
export const cspSecurityEvents = new EventEmitter()

const directive = (value: unknown) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/i.test(value) ? value : undefined

const origin = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  if (['inline', 'eval', 'self', 'data', 'blob'].includes(value)) return value
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol)
      ? parsed.origin
      : `scheme:${parsed.protocol}`
  } catch {
    return undefined
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** Sanitizes and emits at most one CSP security event from either browser report format. */
export function reportCspViolation(payload: unknown): CspSecurityEvent | undefined {
  const candidate = Array.isArray(payload) ? payload[0] : payload
  const wrapper = record(candidate)
  if (!wrapper) return undefined
  const legacy = record(wrapper['csp-report'])
  const modern = wrapper.type === 'csp-violation' ? record(wrapper.body) : undefined
  const body = legacy ?? modern
  if (!body) return undefined
  const event: CspSecurityEvent = { event: 'csp_violation', outcome: 'reported' }
  const fields = {
    documentOrigin: origin(body['document-uri'] ?? body.documentURL),
    blockedOrigin: origin(body['blocked-uri'] ?? body.blockedURL),
    effectiveDirective: directive(body['effective-directive'] ?? body.effectiveDirective),
    violatedDirective: directive(body['violated-directive']),
    disposition:
      body.disposition === 'report' || body.disposition === 'enforce'
        ? body.disposition
        : undefined,
  }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) event[key] = value
  cspSecurityEvents.emit('report', event)
  return event
}
