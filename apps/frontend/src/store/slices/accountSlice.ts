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
  | 'activeAccountId'
  | 'accountSummaries'
  | 'accountSummariesComplete'
  | 'accountSummariesAmbiguous'
  | 'accountSummariesRequestId'
  | 'setActiveAccount'
  | 'beginAccountSummariesRequest'
  | 'setAccountSummaries'
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
    get().accountSummaries.some((account) => account.id === rawId)
  ) {
    return { id: rawId, unknown: false };
  }
  console.warn(
    `setActiveAccount: no company with id ${JSON.stringify(rawId)} — clearing selection`,
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

function createSetActiveAccountAction(
  set: AccountSliceSet,
  get: AccountSliceGet,
): StoreState['setActiveAccount'] {
  return (rawId) => {
    const { id, unknown } = resolveAccountSelection(rawId, get);
    set((state) => {
      const switching = id !== state.activeAccountId;
      return {
        activeAccountId: id,
        activeAccountLoadFailed:
          id === null ||
          (state.activeAccountLoadFailed !== null && state.activeAccountLoadFailed !== id)
            ? null
            : state.activeAccountLoadFailed,
        activeRole: switching && state.activeRole !== null ? 'viewer' : state.activeRole,
        activeRoleStatus:
          switching && state.activeRole !== null ? 'pending' : state.activeRoleStatus,
        ...buildAccountNoticeTransition({ switching: switching, unknown: unknown }),
        ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(state.data, id)),
      };
    });
  };
}

function createSetAccountSummariesAction(
  set: AccountSliceSet,
  get: AccountSliceGet,
): StoreState['setAccountSummaries'] {
  return ({ list, requestId, complete = true, ambiguous = false }) => {
    if (requestId !== undefined) {
      if (requestId !== get().accountSummariesRequestId) return false;
      set({
        accountSummaries: list,
        accountSummariesComplete: complete,
        accountSummariesAmbiguous: ambiguous,
      });
      return true;
    }
    set((state) => ({
      accountSummaries: list,
      accountSummariesComplete: complete,
      accountSummariesAmbiguous: ambiguous,
      accountSummariesRequestId: state.accountSummariesRequestId + 1,
    }));
    return true;
  };
}

/** Create account selection and directory actions for the store. */
export function createAccountSlice(): StateCreator<StoreState, [], [], AccountSlice> {
  return (set, get) => {
    return {
      data: emptyAppData(),
      activeAccountId: null,
      accountSummaries: [],
      accountSummariesComplete: false,
      accountSummariesAmbiguous: false,
      accountSummariesRequestId: 0,
      setActiveAccount: createSetActiveAccountAction(set, get),

      // Directory state is transient and never part of AppData/export.
      beginAccountSummariesRequest: () => {
        const requestId = get().accountSummariesRequestId + 1;
        set({ accountSummariesRequestId: requestId });
        return requestId;
      },
      setAccountSummaries: createSetAccountSummariesAction(set, get),
    };
  };
}
