import type { HttpContext } from '@adonisjs/core/http'

const ERROR_CATEGORIES = new Map<string, string>([
  ['E_VALIDATION_ERROR', 'validation'],
  ['E_ROUTE_NOT_FOUND', 'not_found'],
  ['E_REQUEST_ENTITY_TOO_LARGE', 'request_too_large'],
  ['E_ENCODING_UNSUPPORTED', 'unsupported_media_type'],
  ['SQLITE_CONSTRAINT_NOTNULL', 'database_constraint'],
  ['SQLITE_CONSTRAINT_PRIMARYKEY', 'database_constraint'],
  ['SQLITE_CONSTRAINT_UNIQUE', 'database_constraint'],
  ['SQLITE_CONSTRAINT_FOREIGNKEY', 'database_constraint'],
  ['SQLITE_CONSTRAINT_CHECK', 'database_constraint'],
])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

/** Return a fixed error category without retaining caller controlled exception values. */
export function classifyLogError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unexpected'
  try {
    const code = 'code' in error ? error.code : undefined
    return typeof code === 'string' ? (ERROR_CATEGORIES.get(code) ?? 'unexpected') : 'unexpected'
  } catch {
    return 'unexpected'
  }
}

/** Keep request methods bounded before they enter structured diagnostics. */
export function safeRequestMethod(method: string): string {
  const normalized = method.toUpperCase()
  return SAFE_METHODS.has(normalized) ? normalized : 'OTHER'
}

/** Log only framework route patterns, never caller-controlled unmatched paths. */
export function safeRoutePattern(pattern: string | undefined): string {
  if (!pattern || pattern.length > 256 || !pattern.startsWith('/')) return '[unmatched]'
  return pattern
}

/** Report private account failures without exception text or changing the HTTP outcome. */
export function reportPrivateFailure(
  ctx: HttpContext,
  fields: { event: string; errorType: string; method?: string; path?: string; status?: number },
  message: string
) {
  try {
    ctx.logger.error(fields, message)
  } catch {
    console.error('Private diagnostic logger failed')
  }
}
