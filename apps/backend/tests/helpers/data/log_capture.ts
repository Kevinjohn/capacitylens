import { LoggerFactory } from '@adonisjs/logger/factories';
import logger from '@adonisjs/core/services/logger';
import loggerConfig from '#config/logger';

/** Captures every line the request loggers write while `work` runs; `interceptChild` may alter each child logger. */
export async function captureLogs<T>(
  work: () => Promise<T>,
  interceptChild?: (child: ReturnType<typeof logger.child>) => void
): Promise<{ output: string; result: T }> {
  const lines: string[] = [];
  const capture = new LoggerFactory()
    .merge({ ...loggerConfig.loggers.app, level: 'trace' })
    .pushLogsTo(lines)
    .create();
  const instrument = (child: ReturnType<typeof capture.child>) => {
    interceptChild?.(child);
    const originalChild = child.child;
    child.child = ((...args: Parameters<typeof child.child>) =>
      instrument(originalChild.apply(child, args))) as typeof child.child;
    return child;
  };
  const originalChild = logger.child;
  logger.child = ((...args: Parameters<typeof logger.child>) =>
    instrument(capture.child(...args))) as typeof logger.child;
  try {
    const result = await work();
    return { output: lines.join('\n'), result };
  } finally {
    logger.child = originalChild;
  }
}

/** Captures authentication log lines while `work` runs; `failOutcomeLine` makes the outcome line throw. */
export async function captureAuthenticationLogs<T>(
  work: () => Promise<T>,
  { failOutcomeLine = false } = {}
) {
  const lines: string[] = [];
  const capture = new LoggerFactory()
    .merge({ ...loggerConfig.loggers.app, level: 'trace' })
    .pushLogsTo(lines)
    .create();
  const originalChild = logger.child;
  const instrument = (
    child: ReturnType<typeof capture.child>
  ): ReturnType<typeof capture.child> => {
    const nestedChild = child.child;
    child.child = ((...args: Parameters<typeof child.child>) =>
      instrument(nestedChild.apply(child, args))) as typeof child.child;
    if (failOutcomeLine) {
      const warn = child.warn;
      child.warn = ((...args: unknown[]) => {
        if (args[1] === 'Authentication outcome') throw new Error('logger failure');
        return (warn as (...rest: unknown[]) => void).apply(child, args);
      }) as typeof child.warn;
    }
    return child;
  };
  logger.child = ((...args: Parameters<typeof logger.child>) =>
    instrument(capture.child(...args))) as typeof logger.child;
  try {
    return { lines, result: await work() };
  } finally {
    logger.child = originalChild;
  }
}
