import env from '#start/env'
import app from '@adonisjs/core/services/app'
import type { LoggerConfig, LoggerManagerConfig } from '@adonisjs/logger/types'
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger'

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
