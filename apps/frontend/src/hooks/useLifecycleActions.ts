import { useCallback, useMemo, useRef } from "react";
import { can } from "@capacitylens/shared/domain/access";
import { newId } from "@capacitylens/shared/lib/id";
import { API_BASE, isServerConfigured } from "@/data/apiConfig";
import { flushPendingWrites, refreshActiveAccountSlice, suspendServerWrites } from "@/data/persist";
import {
  assertPlanningWritesAllowed,
  getPlanningController,
  hasPlanningRuntime,
} from "@/data/planning/planningRuntime";
import type { PlanningClientContext } from "@/data/planning/planningCacheController";
import { useStore } from "@/store/useStore";
import type { LifecycleEntity } from "@/store/useStore";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { m } from "@/i18n";
import { apiFetchReauth } from "@/auth/apiFetchReauth";
import { API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { notifyInactiveDataChanged } from "@/data/inactiveDataEvents";
import type { ReauthAction } from "@/auth/reauthCoordinator";

// Lifecycle actions are asynchronous so callers can wait for server commitment. Demo
// builds still apply the shared domain transitions locally.

/** A lifecycle transition verb. */
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

// A lifecycle refresh must use the attached planning coordinator so accepted rows stay
// paired with their revision and access context.
type LifecycleReloadOutcome =
  { kind: "reloaded" } | { kind: "skipped" } | { kind: "failed" } | { kind: "stale-account" };

async function reloadFromServer(accountId: string): Promise<LifecycleReloadOutcome> {
  // A lifecycle POST can finish after a company switch. Check ownership before reload
  // so its old tenant slice cannot replace the current tenant, including the unattached fallback.
  if (useStore.getState().activeAccountId !== accountId) return { kind: "stale-account" };
  // The coordinator outcome distinguishes a canonical reload from a stale or failed read.
  const outcome = await refreshActiveAccountSlice(accountId);
  // `skipped` also covers an orchestrator superseded by a tenant switch. Re-check ownership so the
  // caller can keep that deliberate stale-tenant outcome silent while treating a same-tenant skip
  // (normally a failed save that must not be overwritten) as committed-but-stale.
  if (useStore.getState().activeAccountId !== accountId) return { kind: "stale-account" };
  if (outcome.kind !== "unattached") return outcome;
  // Production always attaches the planning controller before admitting this UI. A detached
  // fallback must not publish rows outside its revision and access-generation checks.
  return { kind: "failed" };
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

interface CapturedLifecycleContext {
  activeAccountId: string;
  entity: LifecycleEntity;
  id: string;
  planningContext: PlanningClientContext;
  generation: number;
  accessKey: string | null;
  membershipRevision: number;
  masquerade: ReturnType<typeof useStore.getState>["masquerade"];
  activeRole: ReturnType<typeof useStore.getState>["activeRole"];
  canWrite: boolean;
}

function canRunServerLifecycle(state: ReturnType<typeof useStore.getState>): boolean {
  return (
    state.planning.canWrite &&
    state.masquerade.kind === "inactive" &&
    (state.activeRole === null || can(state.activeRole, "purge"))
  );
}

function captureServerLifecycleContext(
  activeAccountId: string,
  entity: LifecycleEntity,
  id: string,
): CapturedLifecycleContext {
  const state = useStore.getState();
  if (
    state.activeAccountId !== activeAccountId ||
    !hasPlanningRuntime() ||
    state.planning.context === null ||
    state.planning.pending !== null ||
    !canRunServerLifecycle(state)
  ) {
    throw new Error(
      state.planning.pending
        ? "A company change is still in progress. Wait for it to finish before deleting or purging."
        : "Lifecycle actions are unavailable for the current company or access level.",
    );
  }
  assertPlanningWritesAllowed();
  const draft = getPlanningController().begin({ entity: entity, id: id });
  if (draft.context !== state.planning.context) throw new Error("The company or access context changed. Try again.");
  return {
    activeAccountId,
    entity,
    id,
    planningContext: state.planning.context,
    generation: draft.generation,
    accessKey: state.planning.accessKey,
    membershipRevision: state.membershipRevision,
    masquerade: state.masquerade,
    activeRole: state.activeRole,
    canWrite: state.planning.canWrite,
  };
}

function stillOwnsLifecycleScope(captured: CapturedLifecycleContext): boolean {
  const state = useStore.getState();
  if (
    state.activeAccountId !== captured.activeAccountId ||
    state.planning.context !== captured.planningContext ||
    state.planning.accessKey !== captured.accessKey ||
    state.membershipRevision !== captured.membershipRevision ||
    state.masquerade !== captured.masquerade ||
    state.activeRole !== captured.activeRole ||
    state.planning.canWrite !== captured.canWrite ||
    !canRunServerLifecycle(state)
  ) {
    return false;
  }
  return true;
}

function hasCurrentLifecycleGeneration(captured: CapturedLifecycleContext, generation: number): boolean {
  if (!stillOwnsLifecycleScope(captured)) return false;
  if (captured.generation !== generation) return false;
  try {
    const draft = getPlanningController().begin({ entity: captured.entity, id: captured.id });
    return draft.context === captured.planningContext && draft.generation === generation;
  } catch {
    return false;
  }
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

async function dispatchProtectedServerLifecycle(
  context: ServerLifecycleContext,
  captured: CapturedLifecycleContext,
  transition: { verb: "delete" | "purge"; entity: LifecycleEntity; id: string },
): Promise<boolean> {
  const { activeAccountId, setNotice } = context;
  const reloadRequiredMessage = reloadRequiredByAccount.get(activeAccountId);
  if (reloadRequiredMessage) {
    setNotice(reloadRequiredMessage, "error");
    return false;
  }

  let resumeWrites: ReturnType<typeof suspendServerWrites> | null = null;
  let mutationConfirmed = false;
  const capturedGeneration = captured.generation;
  try {
    const flushed = await flushPendingWrites();
    if (!stillOwnsLifecycleScope(captured)) return false;
    if (flushed.kind !== "clean") {
      const details = flushed.kind === "failed" ? ` ${resolveErrorMessage(flushed.error)}` : "";
      setNotice(`Pending company changes must finish saving before this action.${details}`, "error");
      return false;
    }

    // Recheck after the async flush, then capture the controller generation that this action owns.
    assertPlanningWritesAllowed();
    const draft = getPlanningController().begin({ entity: transition.entity, id: transition.id });
    if (
      !stillOwnsLifecycleScope(captured) ||
      draft.context !== captured.planningContext ||
      draft.generation !== capturedGeneration
    ) {
      return false;
    }
    // No async gap remains between the handoff check and suspension, so a replacement operation
    // cannot begin with the old company revision between these calls.
    assertPlanningWritesAllowed();
    resumeWrites = suspendServerWrites();

    const response = await apiFetchReauth(
      `${API_BASE}/api/${transition.entity}/${encodeURIComponent(transition.id)}/${transition.verb}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newId() },
        body: JSON.stringify({ accountId: activeAccountId }),
      },
      {
        timeoutMs: API_BULK_TIMEOUT_MS,
        action: `lifecycle-${transition.verb}` satisfies ReauthAction,
      },
    );
    if (isLifecycleOutcomeUnknown(response)) {
      throw new Error(`HTTP ${response.status} did not confirm whether the lifecycle mutation committed.`);
    }
    if (!response.ok && response.status !== 204) {
      const message = (await readApiError(response)) ?? m.settings_archived_err_action({ status: response.status });
      if (stillOwnsLifecycleScope(captured)) setNotice(message, "error");
      return false;
    }
    mutationConfirmed = true;

    if (!stillOwnsLifecycleScope(captured)) return false;
    const outcome = await reloadFromServer(activeAccountId);
    if (!stillOwnsLifecycleScope(captured)) return false;
    if (outcome.kind === "stale-account") return false;
    if (outcome.kind !== "reloaded") {
      const message = buildCommittedButStaleMessage(outcome.kind);
      reloadRequiredByAccount.set(activeAccountId, message);
      setNotice(message, "error");
      return false;
    }
    if (!hasCurrentLifecycleGeneration(captured, capturedGeneration)) return false;
    useStore.getState().clearUndoHistory();
    return true;
  } catch (cause) {
    if (!stillOwnsLifecycleScope(captured)) return false;
    if (mutationConfirmed) {
      const message = buildCommittedButStaleMessage("failed", cause);
      reloadRequiredByAccount.set(activeAccountId, message);
      setNotice(message, "error");
      return false;
    }

    try {
      const outcome = await reloadFromServer(activeAccountId);
      if (!stillOwnsLifecycleScope(captured)) return false;
      if (outcome.kind !== "reloaded") {
        throw new Error(`Authoritative reload did not complete (${outcome.kind}).`, { cause });
      }
      if (!hasCurrentLifecycleGeneration(captured, capturedGeneration)) return false;
      // An uncertain delete may have committed; the canonical read reconciles it, so old history
      // must not remain available against the refreshed server projection.
      useStore.getState().clearUndoHistory();
      setNotice(
        `The lifecycle request had an unknown outcome, so the latest company data was reloaded. ${resolveErrorMessage(cause)}`,
        "warning",
      );
      return true;
    } catch (reloadError) {
      if (!stillOwnsLifecycleScope(captured)) return false;
      const message = `The lifecycle request had an unknown outcome and could not be reconciled. Reload before retrying. ${resolveErrorMessage(reloadError)} Original request: ${resolveErrorMessage(cause)}`;
      reloadRequiredByAccount.set(activeAccountId, message);
      setNotice(message, "error");
      return false;
    }
  } finally {
    resumeWrites?.();
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

/** Returns lifecycle actions that await server completion or apply domain transitions
 * locally in demo builds. onReloaded fires after the active company view is current.
 */
export function useLifecycleActions(onReloaded?: () => void): LifecycleActions {
  const lifecycleBusy = useRef(false);
  const setNotice = useStore((state) => state.setNotice);
  const archiveEntity = useStore((state) => state.archiveEntity);
  const unarchiveEntity = useStore((state) => state.unarchiveEntity);
  const softDeleteEntity = useStore((state) => state.softDeleteEntity);
  const purgeEntity = useStore((state) => state.purgeEntity);

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
      if (lifecycleBusy.current) {
        setNotice("A lifecycle action is already in progress. Try again when it finishes.", "info");
        return Promise.resolve();
      }
      lifecycleBusy.current = true;
      const activeAccountId = useStore.getState().activeAccountId;
      const reloadRequiredMessage = activeAccountId ? reloadRequiredByAccount.get(activeAccountId) : undefined;
      if (isServerConfigured() && reloadRequiredMessage) {
        lifecycleBusy.current = false;
        setNotice(reloadRequiredMessage, "error");
        return Promise.resolve();
      }
      let captured: CapturedLifecycleContext | null = null;
      if (isServerConfigured() && (verb === "delete" || verb === "purge") && activeAccountId) {
        try {
          captured = captureServerLifecycleContext(activeAccountId, entity, id);
        } catch (error) {
          lifecycleBusy.current = false;
          setNotice(resolveErrorMessage(error), "error");
          return Promise.resolve();
        }
      }

      const execute = async () => {
        try {
          if (isServerConfigured()) {
            if (!activeAccountId) return;
            const reloaded = captured
              ? await dispatchProtectedServerLifecycle({ activeAccountId, setNotice }, captured, {
                  verb: verb as "delete" | "purge",
                  entity,
                  id,
                })
              : await dispatchServerLifecycle({ activeAccountId, setNotice }, { verb, entity, id });
            const stillCurrent = captured
              ? stillOwnsLifecycleScope(captured)
              : useStore.getState().activeAccountId === activeAccountId;
            if (reloaded && stillCurrent) {
              notifyInactiveDataChanged(activeAccountId);
              onReloaded?.();
            }
          } else {
            dispatchLocal(verb, entity, id);
          }
        } catch (e) {
          // Preserve the never-reject contract if dispatch or configuration fails outside the inner operation boundary.
          setNotice(resolveErrorMessage(e), "error");
        } finally {
          lifecycleBusy.current = false;
        }
      };
      return execute();
    },
    [dispatchLocal, onReloaded, setNotice],
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
