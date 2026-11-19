import type { StateCreator } from 'zustand';
import { m } from '@/i18n';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { ID } from '@capacitylens/shared/types/entities';
import { buildClearedSession, resetSchedulerView } from '@/store/storeConstants';
import { readCurrentWeekAnchor } from './schedulerSlice';
import type { StoreState } from '@/store/types';

type AccountSlice = Pick<
  StoreState,
  | 'data'
  | 'activeCompanyId'
  | 'companySummaries'
  | 'companySummariesComplete'
  | 'companySummariesAmbiguous'
  | 'companySummariesRequestId'
  | 'setActiveCompany'
  | 'beginCompanySummariesRequest'
  | 'setCompanySummaries'
>;

type AccountSliceCreator = StateCreator<StoreState, [], [], AccountSlice>;
type AccountSliceSet = Parameters<AccountSliceCreator>[0];
type AccountSliceGet = Parameters<AccountSliceCreator>[1];

function resolveAccountSelection(
  rawId: ID | null,
  get: AccountSliceGet,
): { id: ID | null; unknown: boolean } {
  if (
    rawId === null ||
    get().data.accounts.some((account) => account.id === rawId) ||
    get().companySummaries.some((account) => account.id === rawId)
  ) {
    return { id: rawId, unknown: false };
  }
  console.warn(
    `setActiveCompany: no company with id ${JSON.stringify(rawId)} — clearing selection`,
  );
  return { id: null, unknown: true };
}

type BuildAccountNoticeTransitionOptions = { switching: boolean; unknown: boolean };
function buildAccountNoticeTransition({
  switching,
  unknown,
}: BuildAccountNoticeTransitionOptions): Partial<StoreState> {
  if (unknown) {
    return {
      ...buildClearedSession(),
      notice: { message: m.notice_company_not_found(), tone: 'error' },
    };
  }
  return switching ? { notice: null, ...buildClearedSession() } : {};
}

function createSetActiveCompanyAction(
  set: AccountSliceSet,
  get: AccountSliceGet,
): StoreState['setActiveCompany'] {
  return (rawId) => {
    const { id, unknown } = resolveAccountSelection(rawId, get);
    set((state) => {
      const switching = id !== state.activeCompanyId;
      return {
        activeCompanyId: id,
        activeCompanyLoadFailed:
          id === null ||
          (state.activeCompanyLoadFailed !== null && state.activeCompanyLoadFailed !== id)
            ? null
            : state.activeCompanyLoadFailed,
        activeRole: switching && state.activeRole !== null ? 'viewer' : state.activeRole,
        activeRoleStatus:
          switching && state.activeRole !== null ? 'pending' : state.activeRoleStatus,
        activePermissions: switching ? [] : state.activePermissions,
        ...buildAccountNoticeTransition({ switching, unknown }),
        ui: resetSchedulerView(
          state.ui,
          readCurrentWeekAnchor(state.data, id, state.planning.today),
        ),
      };
    });
  };
}

function createSetCompanySummariesAction(
  set: AccountSliceSet,
  get: AccountSliceGet,
): StoreState['setCompanySummaries'] {
  return ({ list, requestId, complete = true, ambiguous = false }) => {
    if (requestId !== undefined) {
      if (requestId !== get().companySummariesRequestId) return false;
      set({
        companySummaries: list,
        companySummariesComplete: complete,
        companySummariesAmbiguous: ambiguous,
      });
      return true;
    }
    set((state) => ({
      companySummaries: list,
      companySummariesComplete: complete,
      companySummariesAmbiguous: ambiguous,
      companySummariesRequestId: state.companySummariesRequestId + 1,
    }));
    return true;
  };
}

/** Create account selection and directory actions for the store. */
export function createAccountSlice(): StateCreator<StoreState, [], [], AccountSlice> {
  return (set, get) => {
    return {
      data: emptyAppData(),
      activeCompanyId: null,
      companySummaries: [],
      companySummariesComplete: false,
      companySummariesAmbiguous: false,
      companySummariesRequestId: 0,
      setActiveCompany: createSetActiveCompanyAction(set, get),

      // Directory state is transient and never part of AppData/export.
      beginCompanySummariesRequest: () => {
        const requestId = get().companySummariesRequestId + 1;
        set({ companySummariesRequestId: requestId });
        return requestId;
      },
      setCompanySummaries: createSetCompanySummariesAction(set, get),
    };
  };
}
