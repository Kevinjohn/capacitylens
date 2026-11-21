import { resetSchedulerView } from '@/store/storeConstants';
import { readCurrentWeekAnchor } from './schedulerSlice';
import { buildVisibleRange } from '@/store/selectors';
import { PlanningSaveCancelledError } from '@/data/planning/PlanningSaveCancelledError';
import { requestRestorationCleanup } from '@/data/planning/restorationCleanupConfirmation';
import type { StateCreator } from 'zustand';
import { getMasqueradeToken } from '@/api/masqueradeToken';
import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import { createPlanningCache, createPlanningCacheState } from '@/data/planning/planningCache';
import type { PlanningCacheState, PlanningTransport } from '@/data/planning/planningCacheTypes';
import type { PlanningIntentRequest } from '@/data/planning/planningIntents';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { isPlanningReadyForChange } from '@/data/planning/planningReadiness';
import type { StoreInternals } from '@/store/storeInternal';
import type { StoreState } from '@/store/types';

type PlanningSessionSlice = Pick<
  StoreState,
  | 'planning'
  | 'sendPlanningIntent'
  | 'refreshPlanning'
  | 'clearPlanning'
  | 'suspendPlanningIntents'
  | 'planningReadyForReplacement'
  | 'undoPlanning'
  | 'redoPlanning'
>;

// Planning identity is page-local: sign-in and sign-out reload the page, and authority changes
// within it arrive through the transport's access key.
const PAGE_IDENTITY = Symbol('page planning identity');

/** Publish only the active company's canonical snapshot; a new or cleared context publishes no rows. */
function publishPlanning(
  state: StoreState,
  next: Partial<PlanningCacheState>,
): Partial<StoreState> {
  const planning = next.planning ?? state.planning;
  if (!next.data) return { planning };
  if (planning.context === null) {
    return {
      data: createEmptyAppData(),
      planning,
      activeCompanyId: null,
      companySummaries: [],
      companySummariesComplete: false,
      companySummariesRequestId: state.companySummariesRequestId + 1,
    };
  }
  // A new context publishes nothing yet: its first canonical read replaces its scoped rows.
  if (state.planning.context?.companyId !== planning.context.companyId) {
    return { planning, data: createEmptyAppData() };
  }
  // The cache publishes only a read accepted for this company, so the rows need no filter.
  const companyId = planning.context.companyId;
  const data = next.data;
  const company = data.accounts.find((row) => row.id === companyId);
  return {
    planning,
    data,
    ...(company && !state.data.accounts.some((row) => row.id === companyId)
      ? { ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(data, companyId, planning.today)) }
      : {}),
    ...(company
      ? {
          companySummaries: state.companySummaries.map((summary) =>
            summary.id === companyId ? { ...summary, name: company.name } : summary,
          ),
        }
      : {}),
  };
}

/**
 * The planning session: the cache, context changes, refresh and reconciliation, intent
 * suspension, replacement readiness, undo/redo and the one write path every entity uses.
 */
export function createPlanningSessionSlice(
  isBlockedByViewer: StoreInternals['isBlockedByViewer'],
  transport: PlanningTransport,
): StateCreator<StoreState, [], [], PlanningSessionSlice> {
  return (set, get) => {
    const cache = createPlanningCache({
      getState: () => ({ data: get().data, planning: get().planning }),
      setState: (update) =>
        set((state) =>
          publishPlanning(state, update({ data: state.data, planning: state.planning })),
        ),
      transport,
      onAuthLoss: () => clearPrivatePlanning(true),
      confirmRestorationCleanup: requestRestorationCleanup,
      readMasqueradeToken: getMasqueradeToken,
      // The grid holds a placeholder week until the first read anchors it, so that read asks for
      // the server's default window, which is the anchored grid's window.
      readCapacityWindow: () => {
        if (get().planning.today === null) return undefined;
        const { start, end } = buildVisibleRange(get().ui);
        return { from: start, to: end };
      },
    });
    let tokenEpoch = 0;
    let contextCompanyId: string | null = null;
    const intentLocks = new Set<symbol>();
    let activeRead: { companyId: string; promise: Promise<boolean> } | null = null;
    const syncContext = (companyId: string | null) => {
      const current = get().planning.context;
      if (contextCompanyId === companyId && current?.companyId === (companyId ?? undefined)) return;
      contextCompanyId = companyId;
      tokenEpoch += 1;
      intentLocks.clear();
      activeRead = null;
      cache.setContext(companyId === null ? null : { identity: PAGE_IDENTITY, companyId });
    };
    const clearPrivatePlanning = (authLost = false) => {
      syncContext(null);
      set((state) => ({
        data: createEmptyAppData(),
        activeCompanyId: null,
        companySummaries: [],
        companySummariesComplete: false,
        companySummariesRequestId: state.companySummariesRequestId + 1,
        ...(authLost ? { planningAuthLossVersion: state.planningAuthLossVersion + 1 } : {}),
      }));
    };
    const checkIntentsSuspended = () => {
      syncContext(get().activeCompanyId);
      return intentLocks.size > 0;
    };
    const isReplacementReady = () => {
      const companyId = get().activeCompanyId;
      const planning = get().planning;
      return (
        companyId !== null &&
        intentLocks.size === 0 &&
        planning.context?.companyId === companyId &&
        isPlanningReadyForChange(planning)
      );
    };
    const send = async (
      intentRequest: PlanningIntentRequest,
    ): Promise<PlanningMutationSuccess | undefined> => {
      if (isBlockedByViewer()) return;
      if (checkIntentsSuspended()) {
        throw new Error('Planning intents are suspended while company data changes.');
      }
      const receipt = await cache.execute(
        cache.begin(),
        intentRequest.intent,
        intentRequest.expectedUpdatedAt,
        intentRequest.endsHistory,
      );
      if (!receipt) throw new PlanningSaveCancelledError();
      return receipt;
    };

    return {
      planning: createPlanningCacheState().planning,
      sendPlanningIntent: send,
      refreshPlanning: (options) => {
        const companyId = get().activeCompanyId;
        if (companyId === null) {
          syncContext(null);
          return Promise.resolve(false);
        }
        syncContext(companyId);
        if (!options?.fresh && activeRead?.companyId === companyId) return activeRead.promise;
        const promise = cache
          .refresh({ quiet: options?.quiet === true })
          .then(
            (accepted) =>
              accepted && get().activeCompanyId === companyId && contextCompanyId === companyId,
          );
        activeRead = { companyId, promise };
        void promise.finally(() => {
          if (activeRead?.promise === promise) activeRead = null;
        });
        return promise;
      },
      clearPlanning: () => clearPrivatePlanning(),
      suspendPlanningIntents: () => {
        const companyId = get().activeCompanyId;
        syncContext(companyId);
        const planning = get().planning;
        if (
          companyId === null ||
          planning.context?.companyId !== companyId ||
          planning.phase.kind === 'writing' ||
          intentLocks.size > 0
        ) {
          return null;
        }
        const epoch = tokenEpoch;
        const token = Symbol('planning suspension');
        intentLocks.add(token);
        return () => {
          if (epoch === tokenEpoch) intentLocks.delete(token);
        };
      },
      planningReadyForReplacement: () => isReplacementReady(),
      undoPlanning: () =>
        isBlockedByViewer() || checkIntentsSuspended() ? Promise.resolve(false) : cache.undo(),
      redoPlanning: () =>
        isBlockedByViewer() || checkIntentsSuspended() ? Promise.resolve(false) : cache.redo(),
    };
  };
}
