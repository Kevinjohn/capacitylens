// Graceful shutdown for the daemon (production plan P1.2). The Forge deploy restarts the
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
): () => Promise<void> {
  let draining = false
  return async () => {
    if (draining) {
      exit(1) // forced: the drain was cut short, so don't report a clean stop
      return
    }
    draining = true
    try {
      await app.close()
      db.close()
      exit(0)
    } catch (err) {
      console.error(err)
      exit(1)
    }
  }
}
