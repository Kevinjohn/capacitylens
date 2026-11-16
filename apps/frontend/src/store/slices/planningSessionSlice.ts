import { resetSchedulerView } from '@/store/storeConstants';
import { readCurrentWeekAnchor } from './schedulerSlice';
import { PlanningSaveCancelledError } from '@/data/planning/PlanningSaveCancelledError';
import { requestRestorationCleanup } from '@/data/planning/restorationCleanupConfirmation';
import type { StateCreator } from 'zustand';
import { getMasqueradeContextToken } from '@/auth/masqueradeContext';
import { emptyAppData, SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import {
  createPlanningCacheController,
  createPlanningCacheState,
} from '@/data/planning/planningCacheController';
import type {
  PlanningCacheState,
  PlanningTransport,
} from '@/data/planning/planningCacheController';
import type { PlanningCommand } from '@/data/planning/planningCommands';
import type { StoreInternals } from '@/store/storeInternal';
import type { StoreState } from '@/store/types';

type PlanningSessionSlice = Pick<
  StoreState,
  | 'planning'
  | 'sendPlanningCommand'
  | 'refreshPlanning'
  | 'clearPlanning'
  | 'suspendPlanningCommands'
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
      data: emptyAppData(),
      planning,
      activeAccountId: null,
      accountSummaries: [],
      accountSummariesComplete: false,
      accountSummariesRequestId: state.accountSummariesRequestId + 1,
    };
  }
  // A new context publishes nothing yet: its first canonical read replaces its scoped rows.
  if (state.planning.context?.companyId !== planning.context.companyId) {
    return { planning, data: emptyAppData() };
  }
  const companyId = planning.context.companyId;
  const data = emptyAppData();
  data.accounts = next.data.accounts.filter((account) => account.id === companyId);
  for (const key of SCOPED_KEYS) {
    const rows = next.data[key].filter((row) => row.accountId === companyId);
    Object.assign(data, { [key]: rows });
  }
  const account = data.accounts.find((row) => row.id === companyId);
  return {
    planning,
    data,
    ...(account && !state.data.accounts.some((row) => row.id === companyId)
      ? { ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(data, companyId)) }
      : {}),
    ...(account
      ? {
          accountSummaries: state.accountSummaries.map((summary) =>
            summary.id === companyId ? { ...summary, name: account.name } : summary,
          ),
        }
      : {}),
  };
}

/**
 * The planning session: the cache controller, context changes, refresh and reconciliation, command
 * suspension, replacement readiness, undo/redo and the one write path every entity uses.
 */
export function createPlanningSessionSlice(
  blockedByViewer: StoreInternals['blockedByViewer'],
  transport: PlanningTransport,
): StateCreator<StoreState, [], [], PlanningSessionSlice> {
  return (set, get) => {
    const controller = createPlanningCacheController({
      getState: () => ({ data: get().data, planning: get().planning }),
      setState: (update) =>
        set((state) =>
          publishPlanning(state, update({ data: state.data, planning: state.planning })),
        ),
      transport,
      onAuthLoss: () => clearPrivatePlanning(true),
      confirmRestorationCleanup: requestRestorationCleanup,
      readMasqueradeContextToken: getMasqueradeContextToken,
    });
    let contextEpoch = 0;
    let contextCompanyId: string | null = null;
    const commandLocks = new Set<symbol>();
    let activeRead: { companyId: string; promise: Promise<boolean> } | null = null;
    const syncContext = (companyId: string | null) => {
      const current = get().planning.context;
      if (contextCompanyId === companyId && current?.companyId === (companyId ?? undefined)) return;
      contextCompanyId = companyId;
      contextEpoch += 1;
      commandLocks.clear();
      activeRead = null;
      controller.setContext(companyId === null ? null : { identity: PAGE_IDENTITY, companyId });
    };
    const clearPrivatePlanning = (authLost = false) => {
      syncContext(null);
      set((state) => ({
        data: emptyAppData(),
        activeAccountId: null,
        accountSummaries: [],
        accountSummariesComplete: false,
        accountSummariesRequestId: state.accountSummariesRequestId + 1,
        ...(authLost ? { planningAuthLossVersion: state.planningAuthLossVersion + 1 } : {}),
      }));
    };
    const commandsSuspended = () => {
      syncContext(get().activeAccountId);
      return commandLocks.size > 0;
    };
    const replacementReady = () => {
      const companyId = get().activeAccountId;
      const planning = get().planning;
      return (
        companyId !== null &&
        commandLocks.size === 0 &&
        planning.context?.companyId === companyId &&
        planning.canWrite &&
        planning.revision !== null &&
        planning.pending === null &&
        (planning.status === 'ready' || planning.status === 'refused')
      );
    };
    const send = async (command: PlanningCommand): Promise<void> => {
      if (blockedByViewer()) return;
      if (commandsSuspended()) {
        throw new Error('Planning commands are suspended while company data changes.');
      }
      const receipt = await controller.execute(controller.begin(), command.intent, command.inverse);
      if (!receipt) throw new PlanningSaveCancelledError();
    };

    return {
      planning: createPlanningCacheState().planning,
      sendPlanningCommand: send,
      refreshPlanning: (options) => {
        const companyId = get().activeAccountId;
        if (companyId === null) {
          syncContext(null);
          return Promise.resolve(false);
        }
        syncContext(companyId);
        if (!options?.fresh && activeRead?.companyId === companyId) return activeRead.promise;
        // A canonical read alone never settles an uncertain write; only its commitment lookup can,
        // so every refresh trigger (focus, interval, legacy save) reconciles first.
        const settle =
          get().planning.outcome?.kind === 'uncertain'
            ? controller.reconcile()
            : Promise.resolve(false);
        const promise = settle
          .then((settled) => settled || controller.refresh())
          .then(
            (accepted) =>
              accepted && get().activeAccountId === companyId && contextCompanyId === companyId,
          );
        activeRead = { companyId, promise };
        void promise.finally(() => {
          if (activeRead?.promise === promise) activeRead = null;
        });
        return promise;
      },
      clearPlanning: () => clearPrivatePlanning(),
      suspendPlanningCommands: () => {
        const companyId = get().activeAccountId;
        syncContext(companyId);
        const planning = get().planning;
        if (
          companyId === null ||
          planning.context?.companyId !== companyId ||
          planning.pending !== null ||
          commandLocks.size > 0
        ) {
          return null;
        }
        const epoch = contextEpoch;
        const token = Symbol('planning suspension');
        commandLocks.add(token);
        return () => {
          if (epoch === contextEpoch) commandLocks.delete(token);
        };
      },
      planningReadyForReplacement: () => replacementReady(),
      undoPlanning: () =>
        blockedByViewer() || commandsSuspended() ? Promise.resolve(false) : controller.undo(),
      redoPlanning: () =>
        blockedByViewer() || commandsSuspended() ? Promise.resolve(false) : controller.redo(),
    };
  };
}
