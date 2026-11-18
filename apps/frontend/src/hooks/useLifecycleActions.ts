import { useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/store/useStore';
import type { LifecycleEntity } from '@/lib/entityDrafts';
import type { PlanningCommand } from '@/data/planning/planningCommands';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { runResourceAnonymisation } from '@/store/resourceAnonymisation';
import { notifyInactiveDataChanged } from '@/data/inactiveDataEvents';
import { buildArchiveImpactNotice } from '@/lib/archiveImpactCopy';

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
      const reloaded = await runResourceAnonymisation(activeAccountId, id, setNotice);
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
                  ? { intent: { operation: 'resource.archive', id } }
                  : { intent: { operation: 'resource.unarchive', id } }
                : verb === 'archive'
                  ? { intent: { operation: 'catalogue.archive', entity: { entity, id } } }
                  : { intent: { operation: 'catalogue.unarchive', entity: { entity, id } } };
            const receipt = await useStore.getState().sendPlanningCommand(command);
            if (activeAccountId) notifyInactiveDataChanged(activeAccountId);
            if (entity !== 'resources' && verb === 'archive' && receipt?.archived) {
              const notice = buildArchiveImpactNotice(entity, receipt.archived);
              if (notice) setNotice(notice);
            }
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
