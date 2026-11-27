import env from '#start/env'
import app from '@adonisjs/core/services/app'
import type { LoggerConfig, LoggerManagerConfig } from '@adonisjs/logger/types'
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger'

/** Marks an unexpected product exception so the `err` serializer recognises it without importing `app/`. */
export const UNEXPECTED_EXCEPTION = Symbol.for('capacitylens.unexpected_exception')

interface UnexpectedErrorShape extends Error {
  readonly [UNEXPECTED_EXCEPTION]: true
  readonly errorType?: string
  readonly status?: number
}

function isUnexpectedException(error: unknown): error is UnexpectedErrorShape {
  return error instanceof Error && UNEXPECTED_EXCEPTION in error
}

/** The class, stack frames and cause classes of an error, without any message text. */
export function describeFailure(error: unknown): {
  errorName: string
  stack: string[]
  causes: string[]
} {
  if (!(error instanceof Error)) return { errorName: typeof error, stack: [], causes: [] }
  // Frame lines start with whitespace and `at `; the first line, which carries the message, does not.
  const stack =
    typeof error.stack === 'string'
      ? error.stack
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 30)
      : []
  const causes: string[] = []
  let cause: unknown = error.cause
  while (causes.length < 5 && cause !== undefined && cause !== null) {
    causes.push(cause instanceof Error ? cause.constructor.name : typeof cause)
    cause = cause instanceof Error ? cause.cause : undefined
  }
  return { errorName: error.constructor.name, stack, causes }
}

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

/** The class name and an upper-case error code, never a message or a caller-controlled value. */
export function describeErrorIdentity(error: unknown): { errorName: string; code?: string } {
  if (!(error instanceof Error)) return { errorName: typeof error }
  const code = 'code' in error ? error.code : undefined
  return typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code)
    ? { errorName: error.constructor.name, code }
    : { errorName: error.constructor.name }
}

type AppLoggerConfig = LoggerConfig & {
  enabled: true
  name: string | undefined
  level: string
  destination?: LoggerConfig['destination']
  transport: { targets: [ReturnType<typeof targets.file>] }
}

type CapacityLensLoggerConfig = LoggerManagerConfig<{ app: AppLoggerConfig }>

const loggerConfig: CapacityLensLoggerConfig = defineConfig<{ app: AppLoggerConfig }>({
  default: 'app',

  loggers: {
    app: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: env.get('LOG_LEVEL'),

      /**
       * Keep Pino's standard `err` fields from exposing private messages. A reported unexpected
       * error carries its cause's class, stack frames and cause classes, never a message.
       */
      serializers: {
        err(error: unknown) {
          if (isUnexpectedException(error)) {
            return {
              errorType: error.errorType ?? classifyLogError(error.cause),
              status: error.status,
              ...describeFailure(error.cause),
            }
          }
          return { category: classifyLogError(error), ...describeErrorIdentity(error) }
        },
      },

      /** Remove native request/response payload containers. */
      redact: {
        paths: [
          'req.headers',
          'req.body',
          'res.headers',
          'res.body',
          'request.headers',
          'request.body',
          'response.headers',
          'response.body',
        ],
        remove: true,
      },

      // A synchronous destination outside production flushes each line at once.
      destination: !app.inProduction ? await syncDestination() : undefined,

      transport: {
        targets: [targets.file({ destination: 1 })],
      },
    },
  },
})

export default loggerConfig

declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
