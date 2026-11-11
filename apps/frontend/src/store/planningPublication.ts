import { emptyAppData, SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { PlanningCacheState } from '@/data/planning/planningCacheController';
import type { StoreState } from '@/store/types';

/**
 * Publishes the controller's company slice without replacing rows belonging to other companies.
 * Losing authority clears the whole cache and both histories.
 */
export function publishPlanning(
  state: StoreState,
  next: Partial<PlanningCacheState>,
  preserveOtherCompanies: boolean,
): Partial<StoreState> {
  const planning = next.planning ?? state.planning;
  if (!next.data) return { planning };
  if (planning.context === null) {
    if (preserveOtherCompanies) return { planning, past: [], future: [] };
    return {
      data: emptyAppData(),
      planning,
      past: [],
      future: [],
      activeAccountId: null,
      previousAccountId: null,
      accountSummaries: [],
      accountSummariesComplete: false,
      accountSummariesRequestId: state.accountSummariesRequestId + 1,
    };
  }
  // A new context publishes nothing yet: its first canonical read replaces its scoped rows.
  if (state.planning.context?.companyId !== planning.context.companyId) {
    return preserveOtherCompanies
      ? { planning }
      : { planning, data: emptyAppData(), past: [], future: [] };
  }
  const companyId = planning.context.companyId;
  const data = preserveOtherCompanies ? { ...state.data } : emptyAppData();
  data.accounts = [
    ...(preserveOtherCompanies
      ? state.data.accounts.filter((account) => account.id !== companyId)
      : []),
    ...next.data.accounts.filter((account) => account.id === companyId),
  ];
  for (const key of SCOPED_KEYS) {
    const rows = [
      ...(preserveOtherCompanies
        ? state.data[key].filter((row) => row.accountId !== companyId)
        : []),
      ...next.data[key].filter((row) => row.accountId === companyId),
    ];
    Object.assign(data, { [key]: rows });
  }
  const account = data.accounts.find((row) => row.id === companyId);
  return {
    planning,
    data,
    ...(account
      ? {
          accountSummaries: state.accountSummaries.map((summary) =>
            summary.id === companyId ? { ...summary, name: account.name } : summary,
          ),
        }
      : {}),
  };
}
