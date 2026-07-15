// Graceful shutdown for the daemon. A process supervisor restarts the
// process with a signal; without a drain, an in-flight request can die mid-transaction.
// First signal: stop accepting + drain in-flight requests (app.close), then close the DB,
// then exit 0. A second signal while draining force-exits 1 instead of hanging on a stuck
// drain. App/db/exit are injected so the ordering is unit-testable without real signals.

interface ClosableApp {
  close(): Promise<unknown>
}
interface ClosableDb {
  close(): void
}

export function createShutdownHandler(
  app: ClosableApp,
  db: ClosableDb,
  exit: (code: number) => void,
): (exitCode?: number) => Promise<void> {
  let draining = false
  return async (exitCode = 0) => {
    if (draining) {
      exit(1) // forced: the drain was cut short, so don't report a clean stop
      return
    }
    draining = true
    try {
      await app.close()
      db.close()
      exit(exitCode)
    } catch (err) {
      console.error(err)
      exit(1)
    }
  }
}

export type LastResortFailureKind = 'uncaught_exception' | 'unhandled_rejection'

/**
 * Process-wide last resort for failures outside Fastify's request error boundary. Continuing after
 * an uncaught exception can leave application invariants corrupt, so log the full local error,
 * emit only a non-sensitive classification to the security stream, drain, and exit non-zero. The
 * deployment supervisor is responsible for restoring availability.
 */
export function createLastResortErrorHandler(
  shutdown: (exitCode?: number) => Promise<void>,
  securityLog: (event: Record<string, unknown>) => void,
  logError: (message: string, error: Error) => void,
): (kind: LastResortFailureKind, reason: unknown) => Promise<void> {
  return async (kind, reason) => {
    const error = reason instanceof Error ? reason : new Error(`Non-Error rejection: ${String(reason)}`)
    try {
      logError(`capacitylens-server: last-resort ${kind}`, error)
    } catch {
      // Logging must never prevent the safe drain/restart path.
    }
    try {
      securityLog({ event: 'process_failure', outcome: 'failure', kind })
    } catch {
      // The local detail log above is primary; a broken forwarding path must not block shutdown.
    }
    await shutdown(1)
  }
}
