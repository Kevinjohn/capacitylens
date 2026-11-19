import type { StateCreator } from 'zustand';
import { m } from '@/i18n';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { ID } from '@capacitylens/shared/types/entities';
import { buildClearedSession, resetSchedulerView } from '@/store/storeConstants';
import { readCurrentWeekAnchor } from './schedulerSlice';
import type { StoreState } from '@/store/types';

type CompanySlice = Pick<
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

type CompanySliceCreator = StateCreator<StoreState, [], [], CompanySlice>;
type CompanySliceSet = Parameters<CompanySliceCreator>[0];
type CompanySliceGet = Parameters<CompanySliceCreator>[1];

function resolveCompanySelection(
  rawId: ID | null,
  get: CompanySliceGet,
): { id: ID | null; unknown: boolean } {
  if (
    rawId === null ||
    get().data.accounts.some((company) => company.id === rawId) ||
    get().companySummaries.some((company) => company.id === rawId)
  ) {
    return { id: rawId, unknown: false };
  }
  console.warn(
    `setActiveCompany: no company with id ${JSON.stringify(rawId)} — clearing selection`,
  );
  return { id: null, unknown: true };
}

type BuildCompanyNoticeTransitionOptions = { switching: boolean; unknown: boolean };
function buildCompanyNoticeTransition({
  switching,
  unknown,
}: BuildCompanyNoticeTransitionOptions): Partial<StoreState> {
  if (unknown) {
    return {
      ...buildClearedSession(),
      notice: { message: m.notice_company_not_found(), tone: 'error' },
    };
  }
  return switching ? { notice: null, ...buildClearedSession() } : {};
}

function createSetActiveCompanyAction(
  set: CompanySliceSet,
  get: CompanySliceGet,
): StoreState['setActiveCompany'] {
  return (rawId) => {
    const { id, unknown } = resolveCompanySelection(rawId, get);
    set((state) => {
      const switching = id !== state.activeCompanyId;
      return {
        activeCompanyId: id,
        ...buildCompanyNoticeTransition({ switching, unknown }),
        ui: resetSchedulerView(
          state.ui,
          readCurrentWeekAnchor(state.data, id, state.planning.today),
        ),
      };
    });
  };
}

function createSetCompanySummariesAction(
  set: CompanySliceSet,
  get: CompanySliceGet,
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

/** Create company selection and directory actions for the store. */
export function createCompanySlice(): StateCreator<StoreState, [], [], CompanySlice> {
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
