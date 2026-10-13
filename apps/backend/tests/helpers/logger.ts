import logger from '@adonisjs/core/services/logger'

type ChildLogger = ReturnType<typeof logger.child>

/** Apply a test interceptor to both the request logger and each native nested child. */
export function interceptChildLoggers(intercept: (child: ChildLogger) => void): () => void {
  const originalChild = logger.child

  const instrument = (child: ChildLogger): ChildLogger => {
    intercept(child)
    const originalNestedChild = child.child
    child.child = ((...args: Parameters<typeof child.child>) =>
      instrument(originalNestedChild.apply(child, args))) as typeof child.child
    return child
  }

  logger.child = ((...args: Parameters<typeof logger.child>) =>
    instrument(originalChild.apply(logger, args))) as typeof logger.child

  return () => {
    logger.child = originalChild
  }
}
