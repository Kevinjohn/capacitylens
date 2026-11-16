import { useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/store/useStore';
import type { LifecycleEntity } from '@/store/entityDrafts';
import type { PlanningCommand } from '@/data/planning/planningCommands';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { m } from '@/i18n';
import { anonymiseResource } from '@/data/companyDataRequests';
import { runSuspendedReplacement } from '@/data/planning/suspendedReplacement';
import type { UncertainReplacementFailure } from '@/data/planning/suspendedReplacement';
import { notifyInactiveDataChanged } from '@/data/inactiveDataEvents';

// Archive and restore use typed planning commands. Anonymisation has a named server route;
// uncertain results require authoritative recovery before another irreversible attempt.

type LifecycleVerb = 'archive' | 'unarchive' | 'anonymise';

/**
 * The dispatch surface returned by {@link useLifecycleActions}. Each method runs one lifecycle
 * transition for one entity row. Planning operations use the shared typed command controller;
 * anonymisation uses the server. The promise never rejects. A failure is surfaced as a notice and the promise still
 * resolves, so a caller can `void` it without an unhandled rejection (the MembersSection idiom).
 */
export interface LifecycleActions {
  archive: (entity: LifecycleEntity, id: string) => Promise<void>;
  unarchive: (entity: LifecycleEntity, id: string) => Promise<void>;
  anonymise: (id: string) => Promise<void>;
}

// A confirmed anonymisation without its mandatory refresh must stay gated across route/component
// remounts: the same stale store slice is shared across those surfaces. Module lifetime matches the
// required recovery boundary, a full page reload boots, hydrates, and creates a fresh gate map.
const reloadRequiredByAccount = new Map<string, string>();

type SetNotice = ReturnType<typeof useStore.getState>['setNotice'];

function describeUncertainFailure(failure: UncertainReplacementFailure): string {
  return failure.kind === 'status'
    ? `HTTP ${failure.status} did not confirm whether the lifecycle mutation committed.`
    : resolveErrorMessage(failure.cause);
}

async function dispatchServerLifecycle(
  activeAccountId: string,
  id: string,
  setNotice: SetNotice,
): Promise<boolean> {
  const reloadRequiredMessage = reloadRequiredByAccount.get(activeAccountId);
  if (reloadRequiredMessage) {
    setNotice(reloadRequiredMessage, 'error');
    return false;
  }
  const outcome = await runSuspendedReplacement({
    send: () => anonymiseResource(activeAccountId, id),
    recovery: 'refresh',
  });
  switch (outcome.kind) {
    case 'blocked':
      setNotice(m.settings_anonymise_resource_blocked(), 'error');
      return false;
    case 'departed':
      return false;
    case 'refused':
      setNotice(
        outcome.message ?? m.settings_archived_err_action({ status: outcome.status }),
        'error',
      );
      return false;
    case 'committed':
      if (outcome.reloadRequired) {
        const message = m.settings_archived_committed_refresh_failed();
        reloadRequiredByAccount.set(activeAccountId, message);
        setNotice(message, 'error');
        return false;
      }
      return true;
    case 'uncertain': {
      const cause = describeUncertainFailure(outcome.failure);
      if (outcome.reloadRequired) {
        // Keep the gate so another destructive attempt cannot race the unknown server state.
        const message = `The lifecycle request had an unknown outcome and could not be reconciled. Reload before retrying. Authoritative reload did not complete (failed). Original request: ${cause}`;
        reloadRequiredByAccount.set(activeAccountId, message);
        setNotice(message, 'error');
        return false;
      }
      setNotice(
        `The lifecycle request had an unknown outcome, so the latest company data was reloaded. ${cause}`,
        'warning',
      );
      return true;
    }
  }
}

/** Returns lifecycle actions that serialize server mutations with authoritative reloads.
 * onReloaded fires after confirmed
 * server mutation and refresh so an independently loaded inactive list can refetch.
 */
export function useLifecycleActions(onReloaded?: () => void): LifecycleActions {
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);

  const dispatchServer = useCallback(
    async (verb: LifecycleVerb, entity: LifecycleEntity, id: string) => {
      if (!activeAccountId) return;
      if (verb !== 'anonymise' || entity !== 'resources') {
        throw new Error('Unsupported anonymisation target.');
      }
      const reloaded = await dispatchServerLifecycle(activeAccountId, id, setNotice);
      if (reloaded) {
        notifyInactiveDataChanged(activeAccountId);
        onReloaded?.();
      }
    },
    [activeAccountId, setNotice, onReloaded],
  );

  const run = useCallback(
    (verb: LifecycleVerb, entity: LifecycleEntity, id: string): Promise<void> => {
      const execute = async () => {
        try {
          if (!activeAccountId || useStore.getState().activeAccountId !== activeAccountId) return;
          if (verb === 'archive' || verb === 'unarchive') {
            const command: PlanningCommand =
              entity === 'resources'
                ? verb === 'archive'
                  ? { intent: { operation: 'resource.archive', id }, inverse: null }
                  : { intent: { operation: 'resource.unarchive', id }, inverse: null }
                : verb === 'archive'
                  ? {
                      intent: { operation: 'catalogue.archive', entity: { entity, id } },
                      inverse: null,
                    }
                  : {
                      intent: { operation: 'catalogue.unarchive', entity: { entity, id } },
                      inverse: null,
                    };
            await useStore.getState().sendPlanningCommand(command);
            if (activeAccountId) notifyInactiveDataChanged(activeAccountId);
          } else {
            await dispatchServer(verb, entity, id);
          }
        } catch (e) {
          // Preserve the never-reject contract if dispatch fails outside the inner operation boundary.
          setNotice(resolveErrorMessage(e), 'error');
        }
      };

      // Anonymisation mutates outside typed planning sync, and each operation must complete its
      // authoritative reload before the next starts. Queue confirmed intent instead of silently
      // discarding a second click while the first transition is still settling.
      const scheduled = mutationQueue.current.then(execute, execute);
      mutationQueue.current = scheduled;
      return scheduled;
    },
    [activeAccountId, dispatchServer, setNotice],
  );

  // Stabilize the returned surface so consumers do not rerender solely because its object identity changes.
  return useMemo<LifecycleActions>(
    () => ({
      archive: (entity, id) => run('archive', entity, id),
      unarchive: (entity, id) => run('unarchive', entity, id),
      anonymise: (id) => run('anonymise', 'resources', id),
    }),
    [run],
  );
}
