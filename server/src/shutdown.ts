// Graceful shutdown for the daemon. A process supervisor restarts the
// process with a signal; without a drain, an in-flight request can die mid-transaction.
// First signal: stop background work and stop accepting + drain in-flight requests (app.close) in
// parallel, then close the DB and exit. Every stage is attempted even if another one fails. A
// ten-second deadline or a second signal while draining force-exits 1 instead of hanging.
// Dependencies are injected so the concurrency and ordering are tested.

interface ClosableApp {
  close(): Promise<unknown>;
}
interface ClosableDb {
  close(): void;
}

export const DEFAULT_SHUTDOWN_DEADLINE_MS = 10_000;
export type ShutdownReason =
  | `signal:${NodeJS.Signals}`
  | `process_failure:${LastResortFailureKind}`
  | "listen_failure"
  | "requested";

/** A failed listener is fatal, but it happens after background work may have started. Preserve the
 * ordinary shutdown contract so snapshots drain and SQLite closes before the process exits. */
export async function handleListenFailure(
  error: unknown,
  shutdown: (exitCode?: number, reason?: ShutdownReason) => Promise<void>,
  logError: (error: unknown) => void = console.error,
): Promise<void> {
  logError(error);
  await shutdown(1, "listen_failure");
}

export function createShutdownHandler(
  app: ClosableApp,
  db: ClosableDb,
  exit: (code: number) => void,
  stopBackgroundWork?: () => Promise<unknown>,
  deadlineMs = DEFAULT_SHUTDOWN_DEADLINE_MS,
): (exitCode?: number, reason?: ShutdownReason) => Promise<void> {
  let draining = false;
  return async (exitCode = 0, reason = "requested") => {
    if (draining) {
      console.error(
        `capacitylens-server: shutdown re-entered during drain (reason=${reason}); forcing exit`,
      );
      exit(1); // forced: the drain was cut short, so don't report a clean stop
      return;
    }
    draining = true;
    // Match the repeated-signal escape hatch without closing SQLite underneath a request that
    // Fastify still considers live. In production exit(1) terminates the process and the OS closes
    // its handles; the supervisor therefore has time to replace it before Compose's 15s SIGKILL.
    const deadline = setTimeout(() => {
      console.error(
        `capacitylens-server: shutdown exceeded ${deadlineMs}ms; forcing exit`,
      );
      exit(1);
    }, deadlineMs);
    deadline.unref();
    type ShutdownFailure = { stage: string; error: unknown };
    const failures: ShutdownFailure[] = [];
    const attempt = async (stage: string, action: () => Promise<unknown>) => {
      try {
        await action();
        return null;
      } catch (error) {
        return { stage, error } satisfies ShutdownFailure;
      }
    };

    // Calling both attempt() functions before awaiting either makes Fastify stop accepting new
    // requests immediately, while backup stop synchronously clears its timer/refuses new work and
    // then drains any accepted snapshot. SQLite remains open until both paths have settled.
    const backgroundStop = stopBackgroundWork
      ? attempt("background-work stop", stopBackgroundWork)
      : Promise.resolve(null);
    const requestDrain = attempt("request drain", () => app.close());
    for (const failure of await Promise.all([backgroundStop, requestDrain])) {
      if (failure) failures.push(failure);
    }
    try {
      db.close();
    } catch (error) {
      failures.push({ stage: "database close", error });
    }

    if (failures.length > 0) {
      clearTimeout(deadline);
      try {
        for (const failure of failures) {
          console.error(
            `capacitylens-server: shutdown ${failure.stage} failed`,
            failure.error,
          );
        }
      } finally {
        exit(1);
      }
      return;
    }
    clearTimeout(deadline);
    exit(exitCode);
  };
}

export type LastResortFailureKind =
  | "uncaught_exception"
  | "unhandled_rejection";

/**
 * Process-wide last resort for failures outside Fastify's request error boundary. Continuing after
 * an uncaught exception can leave application invariants corrupt, so log the full local error,
 * emit only a non-sensitive classification to the security stream, drain, and exit non-zero. The
 * deployment supervisor is responsible for restoring availability.
 */
export function createLastResortErrorHandler(
  shutdown: (exitCode?: number, reason?: ShutdownReason) => Promise<void>,
  securityLog: (event: Record<string, unknown>) => void,
  logError: (message: string, error: Error) => void,
): (kind: LastResortFailureKind, reason: unknown) => Promise<void> {
  return async (kind, reason) => {
    const error =
      reason instanceof Error
        ? reason
        : new Error(`Non-Error rejection: ${String(reason)}`);
    try {
      logError(`capacitylens-server: last-resort ${kind}`, error);
    } catch {
      // Logging must never prevent the safe drain/restart path.
    }
    try {
      securityLog({ event: "process_failure", outcome: "failure", kind });
    } catch {
      // The local detail log above is primary; a broken forwarding path must not block shutdown.
    }
    await shutdown(1, `process_failure:${kind}`);
  };
}
