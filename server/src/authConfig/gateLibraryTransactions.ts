import type { Db } from "../db";
import { authTransactionGateFor } from "../authTransactionGate";

type LibraryTransaction = (callback: (adapter: unknown) => Promise<unknown>) => Promise<unknown>;
type ConsumeVerificationValue = (...args: unknown[]) => Promise<unknown>;

/** Better Auth keeps sign-up, provider sign-in, linking and verification transactions open on the
 * shared handle across awaits. Run each one exclusively through the gate the HTTP layer holds, so
 * concurrent requests wait for it rather than meeting an open transaction in tx(). */
export function gateLibraryTransactions(instance: unknown, db: Db): void {
  const { $context } = instance as {
    $context: Promise<{
      adapter: { transaction: LibraryTransaction };
      internalAdapter: { consumeVerificationValue: ConsumeVerificationValue };
    }>;
  };
  const gate = authTransactionGateFor(db);
  // Every request awaits $context after this handler was registered, so the wrapper is in place
  // before the first library transaction. Those requests also surface an initialisation failure.
  void $context.then(
    ({ adapter, internalAdapter }) => {
      const transaction = adapter.transaction.bind(adapter);
      adapter.transaction = (callback) => gate.runExclusive(() => transaction(callback));
      // Better Auth takes a per-token lock before its consume transaction. Two requests presenting
      // the same token (a reset link) would otherwise deadlock: one holds the lock waiting for the
      // gate, the other holds a shared slot waiting for the lock. Take the gate first.
      const consume = internalAdapter.consumeVerificationValue.bind(internalAdapter);
      internalAdapter.consumeVerificationValue = (...args) => gate.runExclusive(() => consume(...args));
    },
    (error: unknown) => void error,
  );
}
