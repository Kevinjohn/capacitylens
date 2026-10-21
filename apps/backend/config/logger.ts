import env from '#start/env'
import app from '@adonisjs/core/services/app'
import type { LoggerConfig, LoggerManagerConfig } from '@adonisjs/logger/types'
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger'
import { classifyLogError } from '#services/logging_safety'

type AppLoggerConfig = LoggerConfig & {
  enabled: true
  name: string | undefined
  level: string
  destination?: LoggerConfig['destination']
  transport: { targets: [ReturnType<typeof targets.file>] }
}

type CapacityLensLoggerConfig = LoggerManagerConfig<{ app: AppLoggerConfig }>

const loggerConfig: CapacityLensLoggerConfig = defineConfig<{ app: AppLoggerConfig }>({
  /**
   * Default logger name used by ctx.logger and app logger calls.
   */
  default: 'app',

  loggers: {
    app: {
      /**
       * Toggle this logger on/off.
       */
      enabled: true,

      /**
       * Logger name shown in log records.
       */
      name: env.get('APP_NAME'),

      /**
       * Minimum level to output (trace, debug, info, warn, error, fatal).
       */
      level: env.get('LOG_LEVEL'),

      /** Keep Pino's standard `err` fields from exposing private messages or stacks. */
      serializers: {
        err(error: unknown) {
          return { category: classifyLogError(error) }
        },
      },

      /** Remove native request/response payload containers and the framework's untrusted id. */
      redact: {
        paths: [
          'request_id',
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

      /**
       * Use sync destination in non-production for immediate flush.
       */
      destination: !app.inProduction ? await syncDestination() : undefined,

      /**
       * Configure where logs are written.
       */
      transport: {
        targets: [targets.file({ destination: 1 })],
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
