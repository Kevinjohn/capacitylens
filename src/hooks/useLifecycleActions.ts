import { useCallback, useMemo, useRef } from "react";
import { newId } from "@capacitylens/shared/lib/id";
import { API_BASE, isServerConfigured } from "@/data/apiConfig";
import { persistenceAdapter } from "@/data/storageAdapter";
import { refreshActiveAccountSlice } from "@/data/persist";
import { useStore } from "@/store/useStore";
import type { LifecycleEntity } from "@/store/useStore";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { m } from "@/i18n";
import { apiFetchReauth } from "@/auth/apiFetchReauth";
import { API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { notifyInactiveDataChanged } from "@/data/inactiveDataEvents";
import type { ReauthAction } from "@/auth/reauthCoordinator";

// Lifecycle writes use dedicated server routes and then reload through persistence
// coordination to keep the store and sync baseline paired. Uncertain write outcomes
// require authoritative recovery before another destructive attempt. Demo builds
// use the same domain transitions locally.

/** A lifecycle transition verb. Mirrors the four dedicated server routes + the four store actions. */
export type LifecycleVerb = "archive" | "unarchive" | "delete" | "purge";

// A timeout or intermediary failure cannot prove whether the dispatched write committed.
function isLifecycleOutcomeUnknown(response: Response): boolean {
  return response.status === 408 || response.status >= 500;
}

/**
 * The dispatch surface returned by {@link useLifecycleActions}. Each method runs one lifecycle
 * transition for one entity row, branching server vs local internally. They are async because the
 * server path awaits the route POST + the reload; in the demo build they resolve synchronously after the
 * store mutation. The promise never rejects. A failure is surfaced as a notice and the promise still
 * resolves, so a caller can `void` it without an unhandled rejection (the MembersSection idiom).
 */
export interface LifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => Promise<void>;
  unarchive: (entity: LifecycleEntity, id: string) => Promise<void>;
  /** Soft-delete (archived → tombstone; a resource's name is scrubbed server- or store-side). */
  softDelete: (entity: LifecycleEntity, id: string) => Promise<void>;
  /** Hard-purge a ≥30-day tombstone (admin-only / purge tier server-side). */
  purge: (entity: LifecycleEntity, id: string) => Promise<void>;
}

// Reload through the persistence orchestrator so pending ordinary edits settle before
// a lifecycle write reseeds the baseline. An unattached fallback has no queued writes
// to race; a failed save preserves the optimistic edit until recovery.
type LifecycleReloadOutcome =
  { kind: "reloaded" } | { kind: "skipped" } | { kind: "failed" } | { kind: "stale-account" };

async function reloadFromServer(accountId: string): Promise<LifecycleReloadOutcome> {
  // A lifecycle POST can finish after a company switch. Check ownership before reload
  // so its old tenant slice cannot replace the current tenant, including the unattached fallback.
  if (useStore.getState().activeAccountId !== accountId) return { kind: "stale-account" };
  // Anything but 'unattached' means the orchestrator owned the call, including 'skipped' (a
  // failed save's edits win; the committed change appears on the next successful refresh) and
  // 'failed' (surfaced via the persist banner). Only the no-orchestrator case may fall back.
  const outcome = await refreshActiveAccountSlice(accountId);
  // `skipped` also covers an orchestrator superseded by a tenant switch. Re-check ownership so the
  // caller can keep that deliberate stale-tenant outcome silent while treating a same-tenant skip
  // (normally a failed save that must not be overwritten) as committed-but-stale.
  if (useStore.getState().activeAccountId !== accountId) return { kind: "stale-account" };
  if (outcome.kind !== "unattached") return outcome;
  const slice = await persistenceAdapter.loadAll(accountId);
  // The bare load is asynchronous too. A switch can happen after the pre-load guard but before the
  // old slice arrives, so check ownership again at the exact store-install boundary.
  if (useStore.getState().activeAccountId !== accountId) return { kind: "stale-account" };
  useStore.getState().replaceAll(slice);
  return { kind: "reloaded" };
}

function buildCommittedButStaleMessage(outcome: "skipped" | "failed", cause?: unknown): string {
  const guidance =
    outcome === "skipped"
      ? m.settings_archived_committed_refresh_skipped()
      : m.settings_archived_committed_refresh_failed();
  return cause === undefined ? guidance : `${guidance} ${resolveErrorMessage(cause)}`;
}

// A confirmed mutation without its mandatory refresh must stay gated across route/component
// remounts: the same stale store slice is shared across those surfaces. Module lifetime matches the
// required recovery boundary, a full page reload boots, hydrates, and creates a fresh gate map.
const reloadRequiredByAccount = new Map<string, string>();

type SetNotice = ReturnType<typeof useStore.getState>["setNotice"];

interface ServerLifecycleContext {
  activeAccountId: string;
  setNotice: SetNotice;
}

type ReconcileLifecycleFailureOptions = { context: ServerLifecycleContext; mutationConfirmed: boolean; cause: unknown };
async function reconcileLifecycleFailure({
  context,
  mutationConfirmed,
  cause,
}: ReconcileLifecycleFailureOptions): Promise<boolean> {
  const { activeAccountId, setNotice } = context;
  if (useStore.getState().activeAccountId !== activeAccountId) return false;
  if (mutationConfirmed) {
    const message = buildCommittedButStaleMessage("failed", cause);
    reloadRequiredByAccount.set(activeAccountId, message);
    setNotice(message, "error");
    return false;
  }
  try {
    const outcome = await reloadFromServer(activeAccountId);
    if (outcome.kind === "stale-account") return false;
    if (outcome.kind !== "reloaded") {
      throw new Error(`Authoritative reload did not complete (${outcome.kind}).`, { cause });
    }
    setNotice(
      `The lifecycle request had an unknown outcome, so the latest company data was reloaded. ${resolveErrorMessage(cause)}`,
      "warning",
    );
    return true;
  } catch (reloadError) {
    // If authoritative recovery fails after an uncertain mutation, retain the reload-required block so another destructive attempt cannot race unknown server state.
    if (useStore.getState().activeAccountId !== activeAccountId) return false;
    const message = `The lifecycle request had an unknown outcome and could not be reconciled. Reload before retrying. ${resolveErrorMessage(reloadError)} Original request: ${resolveErrorMessage(cause)}`;
    reloadRequiredByAccount.set(activeAccountId, message);
    setNotice(message, "error");
    return false;
  }
}

async function dispatchServerLifecycle(
  context: ServerLifecycleContext,
  transition: { verb: LifecycleVerb; entity: LifecycleEntity; id: string },
): Promise<boolean> {
  const { activeAccountId, setNotice } = context;
  const { verb, entity, id } = transition;
  const reloadRequiredMessage = reloadRequiredByAccount.get(activeAccountId);
  if (reloadRequiredMessage) {
    setNotice(reloadRequiredMessage, "error");
    return false;
  }
  let mutationConfirmed = false;
  try {
    const response = await apiFetchReauth(
      `${API_BASE}/api/${entity}/${encodeURIComponent(id)}/${verb}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newId() },
        body: JSON.stringify({ accountId: activeAccountId }),
      },
      {
        timeoutMs: API_BULK_TIMEOUT_MS,
        action: (verb === "unarchive" ? "lifecycle-restore" : `lifecycle-${verb}`) satisfies ReauthAction,
      },
    );
    if (isLifecycleOutcomeUnknown(response)) {
      throw new Error(`HTTP ${response.status} did not confirm whether the lifecycle mutation committed.`);
    }
    if (!response.ok && response.status !== 204) {
      setNotice((await readApiError(response)) ?? m.settings_archived_err_action({ status: response.status }), "error");
      return false;
    }
    mutationConfirmed = true;
    const outcome = await reloadFromServer(activeAccountId);
    if (outcome.kind === "stale-account") return false;
    if (outcome.kind !== "reloaded") {
      const message = buildCommittedButStaleMessage(outcome.kind);
      reloadRequiredByAccount.set(activeAccountId, message);
      setNotice(message, "error");
      return false;
    }
    return true;
  } catch (cause) {
    // Reconcile the lifecycle result using whether mutation was confirmed so a refresh failure cannot be mistaken for a refused write.
    return reconcileLifecycleFailure({ context: context, mutationConfirmed: mutationConfirmed, cause: cause });
  }
}

interface LocalLifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => void;
  unarchive: (entity: LifecycleEntity, id: string) => void;
  delete: (entity: LifecycleEntity, id: string) => void;
  purge: (entity: LifecycleEntity, id: string) => void;
}

function dispatchLocalLifecycle(
  actions: LocalLifecycleActions,
  setNotice: SetNotice,
  transition: { verb: LifecycleVerb; entity: LifecycleEntity; id: string },
): void {
  const { verb, entity, id } = transition;
  try {
    actions[verb](entity, id);
  } catch (cause) {
    // Surface local lifecycle rejection so the calling event does not throw without user feedback.
    setNotice(resolveErrorMessage(cause), "error");
  }
}

/** Returns lifecycle actions that serialize server mutations with authoritative reloads
 * or apply domain transitions locally in demo builds. onReloaded fires after confirmed
 * server mutation and refresh so an independently loaded inactive list can refetch.
 */
export function useLifecycleActions(onReloaded?: () => void): LifecycleActions {
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);
  const archiveEntity = useStore((state) => state.archiveEntity);
  const unarchiveEntity = useStore((state) => state.unarchiveEntity);
  const softDeleteEntity = useStore((state) => state.softDeleteEntity);
  const purgeEntity = useStore((state) => state.purgeEntity);

  const dispatchServer = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (!activeAccountId) return;
      const reloaded = await dispatchServerLifecycle({ activeAccountId, setNotice }, { verb, entity, id });
      if (reloaded) {
        notifyInactiveDataChanged(activeAccountId);
        onReloaded?.();
      }
    },
    [activeAccountId, setNotice, onReloaded],
  );

  const dispatchLocal = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      dispatchLocalLifecycle(
        { archive: archiveEntity, unarchive: unarchiveEntity, delete: softDeleteEntity, purge: purgeEntity },
        setNotice,
        { verb, entity, id },
      );
    },
    [archiveEntity, unarchiveEntity, softDeleteEntity, purgeEntity, setNotice],
  );

  const run = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string): Promise<void> => {
      const execute = async () => {
        try {
          if (isServerConfigured()) {
            await dispatchServer(verb, entity, id);
          } else {
            dispatchLocal(verb, entity, id);
          }
        } catch (e) {
          // Preserve the never-reject contract if dispatch or configuration fails outside the inner operation boundary.
          setNotice(resolveErrorMessage(e), "error");
        }
      };

      // Lifecycle routes mutate outside snapshot-diff sync, and each operation must complete its
      // authoritative reload before the next starts. Queue confirmed intent instead of silently
      // discarding a second click while the first transition is still settling.
      const scheduled = mutationQueue.current.then(execute, execute);
      mutationQueue.current = scheduled;
      return scheduled;
    },
    [dispatchServer, dispatchLocal, setNotice],
  );

  // Stabilize the returned surface so consumers do not rerender solely because its object identity changes.
  return useMemo<LifecycleActions>(
    () => ({
      archive: (entity, id) => run("archive", entity, id),
      unarchive: (entity, id) => run("unarchive", entity, id),
      softDelete: (entity, id) => run("delete", entity, id),
      purge: (entity, id) => run("purge", entity, id),
    }),
    [run],
  );
}
