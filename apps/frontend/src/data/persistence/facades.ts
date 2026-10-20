import { persistenceCoordinator } from "./coordinator";

/** Reports an unresolved planning command for beforeunload and session handoff decisions. */
export function hasUnsavedPersistenceWrites(): boolean {
  return persistenceCoordinator.hasUnsavedWrites();
}

/**
 * Suspend planning commands during an external replacement operation and return a resume function.
 * Commands attempted while suspended are refused; they are never queued against the old company
 * revision. No-op when the planning runtime is not attached. The optional resume argument is
 * retained for replacement callers; there are no parked edits to discard.
 */
export function suspendServerWrites(): (options?: { dropParkedEdits?: boolean }) => void {
  return persistenceCoordinator.suspendWrites();
}

/**
 * Outcomes from requesting a persistence refresh.
 *
 * - `reloaded`: The controller installed the canonical server slice.
 * - `skipped`: A stale account or pending command prevented replacement.
 * - `failed`: The authoritative load failed; the current slice remains available for recovery.
 * - `unattached`: No planning runtime is active.
 */
export type RefreshOutcome = { kind: "reloaded" } | { kind: "skipped" } | { kind: "failed" } | { kind: "unattached" };
/** Outcome of resolving any in-flight planning commitment. */
export type FlushPendingWritesResult = { kind: "clean" } | { kind: "blocked" } | { kind: "failed"; error: unknown };

/**
 * Resolve any pending planning commitment before an operation that replaces the company slice.
 *
 * @returns clean when no command remains unresolved, failed when reconciliation throws, or
 * blocked while the server still cannot establish the outcome. Clean without an attached runtime.
 */
export async function flushPendingWrites(): Promise<FlushPendingWritesResult> {
  return persistenceCoordinator.flushPending();
}

/**
 * Re-hydrate the active account's slice through the planning controller. The controller reconciles
 * any uncertain command before accepting a canonical read.
 *
 * @returns a {@link RefreshOutcome}. Callers whose follow-up claims "the view now shows committed
 * state" (the server-mode import's success notice) must gate on 'reloaded'; 'skipped'
 * and 'failed' mean the store still holds its current slice.
 */
export async function refreshActiveAccountSlice(id: string): Promise<RefreshOutcome> {
  return persistenceCoordinator.refreshActive(id);
}

/** Switch the selected company and await its controller hydration. An unresolved command refuses
 * the switch with skipped, including a null selection. Callers must first resolve the commitment
 * through flushPendingWrites; no new read races the pending command. */
export async function switchAndAwaitHydration(id: string | null): Promise<RefreshOutcome> {
  return persistenceCoordinator.switchAndAwaitHydration(id);
}

/** Retry the selected account's failed switch hydration without changing the selection. */
export async function retryActiveAccountLoad(id: string): Promise<RefreshOutcome> {
  return persistenceCoordinator.retryActiveAccountLoad(id);
}
