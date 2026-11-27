const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

/** Keep request methods bounded before they enter structured diagnostics. */
export function normalizeRequestMethod(method: string): string {
  const normalized = method.toUpperCase()
  return SAFE_METHODS.has(normalized) ? normalized : 'OTHER'
}

/** Log only framework route patterns, never caller-controlled unmatched paths. */
export function normalizeRoutePattern(pattern: string | undefined): string {
  if (!pattern || pattern.length > 256 || !pattern.startsWith('/')) return '[unmatched]'
  return pattern
}

export { describeFailure } from '#config/logger'
