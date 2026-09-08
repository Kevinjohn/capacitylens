import type { Db } from "./db";

let savepointId = 0;
const activeTransactionModes = new WeakMap<Db, "deferred" | "immediate">();
// Handles whose rollback failed while the connection remained inside a transaction. SQLite never
// told us the transaction ended, so later acknowledged writes could land outside any durability
// boundary; the only safe continuation is refusal.
const poisonedHandles = new WeakSet<Db>();

export type SynchronousCallback<Fn extends () => unknown> = Fn &
  ([Extract<ReturnType<Fn>, PromiseLike<unknown>>] extends [never] ? unknown : never);

export interface RollbackFailure {
  scope: "transaction" | "savepoint";
  error: unknown;
}

export type RollbackFailureReporter = (failure: RollbackFailure) => void;

type TransactionMode = "deferred" | "immediate";

export interface TransactionOptions {
  mode?: TransactionMode;
  reportRollbackFailure?: RollbackFailureReporter;
}

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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return "then" in value && typeof value.then === "function";
}

function assertSynchronousResult(result: unknown): void {
  if (isPromiseLike(result)) {
    throw new TypeError("Transaction callback must be synchronous; received a Promise-like result.");
  }
}

type TransactionConfiguration =
  | []
  | [mode: TransactionMode | undefined]
  | [mode: TransactionMode | undefined, reportRollbackFailure: RollbackFailureReporter | undefined]
  | [options: TransactionOptions];

function resolveTransactionOptions(configuration: TransactionConfiguration): Required<TransactionOptions> {
  const [modeOrOptions, positionalReporter] = configuration;
  if (positionalReporter !== undefined) {
    return { mode: modeOrOptions ?? "deferred", reportRollbackFailure: positionalReporter };
  }
  if (typeof modeOrOptions === "string") {
    return { mode: modeOrOptions, reportRollbackFailure: defaultRollbackFailureReporter };
  }
  return {
    mode: modeOrOptions?.mode ?? "deferred",
    reportRollbackFailure: modeOrOptions?.reportRollbackFailure ?? defaultRollbackFailureReporter,
  };
}

function isTransactionActive(db: Db): boolean {
  return db.isTransaction;
}

function runNestedTransaction<Result>(db: Db, callback: () => Result, options: Required<TransactionOptions>): Result {
  if (options.mode === "immediate" && activeTransactionModes.get(db) !== "immediate") {
    throw new Error("A nested immediate transaction requires its enclosing tx() transaction to be immediate.");
  }
  const savepoint = `capacitylens_tx_${++savepointId}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = callback();
    assertSynchronousResult(result);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (e) {
    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      reportRollbackFailureSafely(options.reportRollbackFailure, { scope: "savepoint", error: rollbackError });
    }
    throw e;
  }
}

function runTopLevelTransaction<Result>(db: Db, callback: () => Result, options: Required<TransactionOptions>): Result {
  db.exec(options.mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN");
  activeTransactionModes.set(db, options.mode);
  try {
    const result = callback();
    assertSynchronousResult(result);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    // Roll back, but NEVER let a ROLLBACK failure MASK the original error. If BEGIN never armed a
    // transaction or the connection is gone, db.exec('ROLLBACK') itself throws — swallow ONLY that
    // (after logging), then always rethrow `e`, the real cause, so the diagnostic chain stays
    // intact. The rare acceptable nested swallow: the original failure is still surfaced.
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      // If SQLite says the transaction is STILL active after a failed ROLLBACK, later commits
      // cannot be trusted to sit on a durability boundary. Read through a function boundary because
      // native accessors may change during exec(), despite the earlier top-level branch narrowing.
      if (isTransactionActive(db)) poisonedHandles.add(db);
      reportRollbackFailureSafely(options.reportRollbackFailure, { scope: "transaction", error: rollbackError });
    }
    throw e;
  } finally {
    activeTransactionModes.delete(db);
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
export function tx<Result>(
  db: Db,
  callback: (() => Result) & ([Extract<Result, PromiseLike<unknown>>] extends [never] ? unknown : never),
  ...configuration: TransactionConfiguration
): Result {
  if (poisonedHandles.has(db)) {
    throw new Error(
      "This database handle is quarantined: an earlier ROLLBACK failed while the transaction stayed active, so no further writes can be acknowledged on it.",
    );
  }
  const resolvedOptions = resolveTransactionOptions(configuration);
  return db.isTransaction
    ? runNestedTransaction(db, callback, resolvedOptions)
    : runTopLevelTransaction(db, callback, resolvedOptions);
}
