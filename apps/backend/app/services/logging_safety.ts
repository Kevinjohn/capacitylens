import type { HttpContext } from '@adonisjs/core/http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** Keep request methods bounded before they enter structured diagnostics. */
export function normalizeRequestMethod(method: string): string {
  const normalized = method.toUpperCase();
  return SAFE_METHODS.has(normalized) ? normalized : 'OTHER';
}

/** Log only framework route patterns, never caller-controlled unmatched paths. */
export function normalizeRoutePattern(pattern: string | undefined): string {
  if (!pattern || pattern.length > 256 || !pattern.startsWith('/')) return '[unmatched]';
  return pattern;
}

/** The class, stack frames and cause classes of an error, without any message text. */
export function describeFailure(error: unknown): {
  errorName: string;
  stack: string[];
  causes: string[];
} {
  if (!(error instanceof Error)) return { errorName: typeof error, stack: [], causes: [] };
  // Frame lines start with whitespace and `at `; the first line, which carries the message, does not.
  const stack =
    typeof error.stack === 'string'
      ? error.stack
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 30)
      : [];
  const causes: string[] = [];
  let cause: unknown = error.cause;
  while (causes.length < 5 && cause !== undefined && cause !== null) {
    causes.push(cause instanceof Error ? cause.constructor.name : typeof cause);
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return { errorName: error.constructor.name, stack, causes };
}

/** Report private account failures without exception text or changing the HTTP outcome. */
export function reportPrivateFailure(
  ctx: HttpContext,
  fields: {
    event: string;
    errorType: string;
    method?: string;
    path?: string;
    status?: number;
    errorName?: string;
    stack?: string[];
    causes?: string[];
  },
  message: string
) {
  try {
    ctx.logger.error(fields, message);
  } catch {
    console.error('Private diagnostic logger failed');
  }
}
