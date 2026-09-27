import type { Db } from "../db";
import { authTransactionGateFor } from "../authTransactionGate";

type LibraryTransaction = (callback: (adapter: unknown) => Promise<unknown>) => Promise<unknown>;

/** Better Auth keeps sign-up, provider sign-in, linking and verification transactions open on the
 * shared handle across awaits. Run each one exclusively through the gate the HTTP layer holds, so
 * concurrent requests wait for it rather than meeting an open transaction in tx(). */
export function gateLibraryTransactions(instance: unknown, db: Db): void {
  const { $context } = instance as { $context: Promise<{ adapter: { transaction: LibraryTransaction } }> };
  const gate = authTransactionGateFor(db);
  // Every request awaits $context after this handler was registered, so the wrapper is in place
  // before the first library transaction. Those requests also surface an initialisation failure.
  void $context.then(
    ({ adapter }) => {
      const transaction = adapter.transaction.bind(adapter);
      adapter.transaction = (callback) => gate.runExclusive(() => transaction(callback));
    },
    (error: unknown) => void error,
  );
}
