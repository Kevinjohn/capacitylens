import env from '#start/env';
import app from '@adonisjs/core/services/app';
import type { LoggerConfig, LoggerManagerConfig } from '@adonisjs/logger/types';
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger';

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
]);

/** Return a fixed error category without retaining caller controlled exception values. */
export function classifyLogError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unexpected';
  try {
    const code = 'code' in error ? error.code : undefined;
    return typeof code === 'string' ? (ERROR_CATEGORIES.get(code) ?? 'unexpected') : 'unexpected';
  } catch {
    return 'unexpected';
  }
}

type AppLoggerConfig = LoggerConfig & {
  enabled: true;
  name: string | undefined;
  level: string;
  destination?: LoggerConfig['destination'];
  transport: { targets: [ReturnType<typeof targets.file>] };
};

type CapacityLensLoggerConfig = LoggerManagerConfig<{ app: AppLoggerConfig }>;

const loggerConfig: CapacityLensLoggerConfig = defineConfig<{ app: AppLoggerConfig }>({
  default: 'app',

  loggers: {
    app: {
      enabled: true,
      name: env.get('APP_NAME'),
      level: env.get('LOG_LEVEL'),

      /** Keep Pino's standard `err` fields from exposing private messages or stacks. */
      serializers: {
        err(error: unknown) {
          return { category: classifyLogError(error) };
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
});

export default loggerConfig;

declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
