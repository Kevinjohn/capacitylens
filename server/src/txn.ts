import type { Db } from "./db";

let savepointId = 0;
const activeTransactionModes = new WeakMap<Db, "deferred" | "immediate">();

export type SynchronousCallback<Fn extends () => unknown> = Fn &
  ([Extract<ReturnType<Fn>, PromiseLike<unknown>>] extends [never] ? unknown : never);

export interface RollbackFailure {
  scope: "transaction" | "savepoint";
  error: unknown;
}

export type RollbackFailureReporter = (failure: RollbackFailure) => void;

const defaultRollbackFailureReporter: RollbackFailureReporter = ({ scope }) => {
  // This helper is also used before a request logger exists. Emit one parseable, privacy-safe line;
  // callers with correlation context can inject their structured reporter through tx().
  console.error(JSON.stringify({ level: "error", event: "transaction_rollback_failed", scope }));
};

function reportRollbackFailureSafely(reporter: RollbackFailureReporter, failure: RollbackFailure): void {
  try {
    reporter(failure);
  } catch (reportingError) {
    // A diagnostic transport cannot replace the transaction error. Fall back to the same
    // privacy-safe line; if stderr itself is unavailable, preserve the original throw regardless.
    try {
      defaultRollbackFailureReporter(failure);
    } catch (fallbackError) {
      void reportingError;
      void fallbackError;
    }
  }
}

function assertSynchronousResult(result: unknown): void {
  const resultType = typeof result;
  if ((resultType === "object" && result !== null) || resultType === "function") {
    if (typeof (result as { then?: unknown }).then === "function") {
      throw new TypeError("Transaction callback must be synchronous; received a Promise-like result.");
    }
  }
}

/** Run fn atomically, rolling back (and rethrowing) on any throw.
 *
 * A top-level caller may request `IMMEDIATE` when it must reserve SQLite's single writer before
 * inspecting/mutating schema. Nested callers use SAVEPOINTs, which lets one explicit database
 * migration wrap the older focused helpers (table rebuilds, control-table repair, data repair)
 * without attempting an invalid nested BEGIN. A nested `immediate` requirement is accepted only
 * when the enclosing transaction was itself opened as immediate by this helper; otherwise it
 * throws instead of silently weakening the caller's requested reservation.
 */
export function tx<Fn extends () => unknown>(
  db: Db,
  fn: SynchronousCallback<Fn>,
  mode: "deferred" | "immediate" = "deferred",
  reportRollbackFailure: RollbackFailureReporter = defaultRollbackFailureReporter,
): ReturnType<Fn> {
  if (db.isTransaction) {
    if (mode === "immediate" && activeTransactionModes.get(db) !== "immediate") {
      throw new Error("A nested immediate transaction requires its enclosing tx() transaction to be immediate.");
    }
    const savepoint = `capacitylens_tx_${++savepointId}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = fn();
      assertSynchronousResult(result);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result as ReturnType<Fn>;
    } catch (e) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (rollbackError) {
        reportRollbackFailureSafely(reportRollbackFailure, { scope: "savepoint", error: rollbackError });
      }
      throw e;
    }
  }

  db.exec(mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN");
  activeTransactionModes.set(db, mode);
  try {
    const result = fn();
    assertSynchronousResult(result);
    db.exec("COMMIT");
    return result as ReturnType<Fn>;
  } catch (e) {
    // Roll back, but NEVER let a ROLLBACK failure MASK the original error. If BEGIN never armed a
    // transaction or the connection is gone, db.exec('ROLLBACK') itself throws — swallow ONLY that
    // (after logging), then always rethrow `e`, the real cause, so the diagnostic chain stays
    // intact. The rare acceptable nested swallow: the original failure is still surfaced.
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      reportRollbackFailureSafely(reportRollbackFailure, { scope: "transaction", error: rollbackError });
    }
    throw e;
  } finally {
    activeTransactionModes.delete(db);
  }
}
