import { useCallback, useMemo, useRef } from "react";
import { API_BASE, isServerConfigured } from "@/data/apiConfig";
import { useStore } from "@/store/useStore";
import type { LifecycleEntity } from "@/store/useStore";
import type { PlanningCommand } from "@/data/planning/planningCommands";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { m } from "@/i18n";
import { apiFetch } from "@/data/requestTimeout";
import { API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import { notifyInactiveDataChanged } from "@/data/inactiveDataEvents";

// Archive and restore use typed planning commands. Anonymisation has a named server route;
// uncertain results require authoritative recovery before another irreversible attempt.

type LifecycleVerb = "archive" | "unarchive" | "anonymise";

// A timeout or intermediary failure cannot prove whether the dispatched write committed.
function isLifecycleOutcomeUnknown(response: Response): boolean {
  return response.status === 408 || response.status >= 500;
}

/**
 * The dispatch surface returned by {@link useLifecycleActions}. Each method runs one lifecycle
 * transition for one entity row. Planning operations use the shared typed command controller;
 * anonymisation uses the server or volatile demo store. The promise never rejects. A failure is surfaced as a notice and the promise still
 * resolves, so a caller can `void` it without an unhandled rejection (the MembersSection idiom).
 */
export interface LifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => Promise<void>;
  unarchive: (entity: LifecycleEntity, id: string) => Promise<void>;
  anonymise: (id: string) => Promise<void>;
}

// A lifecycle response is followed by the same canonical read as typed planning writes.
type LifecycleReloadOutcome =
  { kind: "reloaded" } | { kind: "skipped" } | { kind: "failed" } | { kind: "stale-account" };

async function reloadFromServer(context: ServerLifecycleContext): Promise<LifecycleReloadOutcome> {
  // A lifecycle POST can finish after a company switch. The planning controller rejects
  // reads from a departed context before publication.
  if (!ownsLifecycleContext(context)) return { kind: "stale-account" };
  const accepted = await useStore.getState().refreshPlanning({ fresh: true });
  if (!ownsLifecycleContext(context)) return { kind: "stale-account" };
  return accepted ? { kind: "reloaded" } : { kind: "failed" };
}

function buildCommittedButStaleMessage(outcome: "skipped" | "failed", cause?: unknown): string {
  const guidance =
    outcome === "skipped"
      ? m.settings_archived_committed_refresh_skipped()
      : m.settings_archived_committed_refresh_failed();
  return cause === undefined ? guidance : `${guidance} ${resolveErrorMessage(cause)}`;
}

// A confirmed anonymisation without its mandatory refresh must stay gated across route/component
// remounts: the same stale store slice is shared across those surfaces. Module lifetime matches the
// required recovery boundary, a full page reload boots, hydrates, and creates a fresh gate map.
const reloadRequiredByAccount = new Map<string, string>();

type SetNotice = ReturnType<typeof useStore.getState>["setNotice"];

interface ServerLifecycleContext {
  activeAccountId: string;
  planningContext: ReturnType<typeof useStore.getState>["planning"]["context"];
  setNotice: SetNotice;
}

function ownsLifecycleContext(context: ServerLifecycleContext): boolean {
  const state = useStore.getState();
  return state.activeAccountId === context.activeAccountId && state.planning.context === context.planningContext;
}

type ReconcileLifecycleFailureOptions = { context: ServerLifecycleContext; mutationConfirmed: boolean; cause: unknown };
async function reconcileLifecycleFailure({
  context,
  mutationConfirmed,
  cause,
}: ReconcileLifecycleFailureOptions): Promise<boolean> {
  const { activeAccountId, setNotice } = context;
  if (!ownsLifecycleContext(context)) return false;
  if (mutationConfirmed) {
    const message = buildCommittedButStaleMessage("failed", cause);
    reloadRequiredByAccount.set(activeAccountId, message);
    setNotice(message, "error");
    return false;
  }
  try {
    const outcome = await reloadFromServer(context);
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
    if (!ownsLifecycleContext(context)) return false;
    const message = `The lifecycle request had an unknown outcome and could not be reconciled. Reload before retrying. ${resolveErrorMessage(reloadError)} Original request: ${resolveErrorMessage(cause)}`;
    reloadRequiredByAccount.set(activeAccountId, message);
    setNotice(message, "error");
    return false;
  }
}

async function dispatchServerLifecycle(context: ServerLifecycleContext, id: string): Promise<boolean> {
  const { activeAccountId, setNotice } = context;
  const reloadRequiredMessage = reloadRequiredByAccount.get(activeAccountId);
  if (reloadRequiredMessage) {
    setNotice(reloadRequiredMessage, "error");
    return false;
  }
  if (!useStore.getState().planningReadyForReplacement()) {
    setNotice("Finish loading or resolving company changes before anonymising a person.", "error");
    return false;
  }
  const release = useStore.getState().suspendPlanningCommands();
  if (!release) {
    setNotice("Finish loading or resolving company changes before anonymising a person.", "error");
    return false;
  }
  context.planningContext = useStore.getState().planning.context;
  let mutationConfirmed = false;
  let keepBlocked = false;
  try {
    const response = await apiFetch(
      `${API_BASE}/api/accounts/${encodeURIComponent(activeAccountId)}/resources/${encodeURIComponent(id)}/anonymise`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      API_BULK_TIMEOUT_MS,
    );
    if (!ownsLifecycleContext(context)) return false;
    if (isLifecycleOutcomeUnknown(response)) {
      throw new Error(`HTTP ${response.status} did not confirm whether the lifecycle mutation committed.`);
    }
    if (!response.ok && response.status !== 204) {
      const message = (await readApiError(response)) ?? m.settings_archived_err_action({ status: response.status });
      if (ownsLifecycleContext(context)) setNotice(message, "error");
      return false;
    }
    mutationConfirmed = true;
    const outcome = await reloadFromServer(context);
    if (outcome.kind === "stale-account") return false;
    if (outcome.kind !== "reloaded") {
      const message = buildCommittedButStaleMessage(outcome.kind);
      reloadRequiredByAccount.set(activeAccountId, message);
      keepBlocked = true;
      setNotice(message, "error");
      return false;
    }
    return true;
  } catch (cause) {
    // Reconcile the lifecycle result using whether mutation was confirmed so a refresh failure cannot be mistaken for a refused write.
    const reconciled = await reconcileLifecycleFailure({ context, mutationConfirmed, cause });
    keepBlocked = !reconciled && ownsLifecycleContext(context);
    return reconciled;
  } finally {
    if (!keepBlocked) release();
  }
}

interface LocalLifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => void;
  unarchive: (entity: LifecycleEntity, id: string) => void;
  anonymise: (id: string) => void;
}

function dispatchLocalLifecycle(
  actions: LocalLifecycleActions,
  setNotice: SetNotice,
  transition: { verb: LifecycleVerb; entity: LifecycleEntity; id: string },
): void {
  const { verb, entity, id } = transition;
  try {
    if (verb === "anonymise") actions.anonymise(id);
    else actions[verb](entity, id);
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
  const anonymiseResource = useStore((state) => state.anonymiseResource);

  const dispatchServer = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (!activeAccountId) return;
      if (verb !== "anonymise" || entity !== "resources") throw new Error("Unsupported anonymisation target.");
      const reloaded = await dispatchServerLifecycle(
        { activeAccountId, planningContext: useStore.getState().planning.context, setNotice },
        id,
      );
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
        { archive: archiveEntity, unarchive: unarchiveEntity, anonymise: anonymiseResource },
        setNotice,
        { verb, entity, id },
      );
    },
    [archiveEntity, unarchiveEntity, anonymiseResource, setNotice],
  );

  const run = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string): Promise<void> => {
      const execute = async () => {
        try {
          if (!activeAccountId || useStore.getState().activeAccountId !== activeAccountId) return;
          if (verb === "archive" || verb === "unarchive") {
            const command: PlanningCommand =
              entity === "resources"
                ? verb === "archive"
                  ? { intent: { operation: "resource.archive", id }, inverse: null }
                  : { intent: { operation: "resource.unarchive", id }, inverse: null }
                : verb === "archive"
                  ? {
                      intent: { operation: "catalogue.archive", entity: { entity, id } },
                      inverse: null,
                    }
                  : {
                      intent: { operation: "catalogue.unarchive", entity: { entity, id } },
                      inverse: null,
                    };
            await useStore.getState().sendPlanningCommand(command);
            if (activeAccountId) notifyInactiveDataChanged(activeAccountId);
          } else if (isServerConfigured()) {
            await dispatchServer(verb, entity, id);
          } else {
            dispatchLocal(verb, entity, id);
          }
        } catch (e) {
          // Preserve the never-reject contract if dispatch or configuration fails outside the inner operation boundary.
          setNotice(resolveErrorMessage(e), "error");
        }
      };

      // Anonymisation mutates outside typed planning sync, and each operation must complete its
      // authoritative reload before the next starts. Queue confirmed intent instead of silently
      // discarding a second click while the first transition is still settling.
      const scheduled = mutationQueue.current.then(execute, execute);
      mutationQueue.current = scheduled;
      return scheduled;
    },
    [activeAccountId, dispatchServer, dispatchLocal, setNotice],
  );

  // Stabilize the returned surface so consumers do not rerender solely because its object identity changes.
  return useMemo<LifecycleActions>(
    () => ({
      archive: (entity, id) => run("archive", entity, id),
      unarchive: (entity, id) => run("unarchive", entity, id),
      anonymise: (id) => run("anonymise", "resources", id),
    }),
    [run],
  );
}
