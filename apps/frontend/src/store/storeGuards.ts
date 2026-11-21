import type { StoreApi } from 'zustand';
import { getOwned as findOwnedIn } from '@capacitylens/shared/domain/mutations';
import { m } from '@/i18n';
import { canWritePlanning } from '@/data/planning/planningAccess';
import type { AppData, ID, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import type { StoreState } from './types';

/** Create guards that enforce company scoping and entity invariants. */
export function createGuards(get: StoreApi<StoreState>['getState']) {
  // Every scoped add* stamps the active company. A non-null selection alone is insufficient. The
  // company must either exist in the published data or in the server-authorised summaries while a
  // switch is loading its slice. Typed command context and revision checks still gate writes; this
  // guard only prevents stamping an orphan companyId into the slice.
  const requireCompany = (): ID => {
    const state = get();
    const id = state.activeCompanyId;
    if (!id) throw new Error('No active company is selected.');
    if (
      !state.data.accounts.some((company) => company.id === id) &&
      !state.companySummaries.some((company) => company.id === id)
    ) {
      throw new Error('The active account is not loaded — cannot mutate scoped data.');
    }
    return id;
  };

  // Refuse writes during masquerade or unless the last accepted planning read may write.
  // Return a notice instead of throwing because callers use this guard for interactive mutations.
  const isBlockedByViewer = (): boolean => {
    const state = get();
    if (state.masquerade.kind !== 'inactive') {
      state.setNotice(m.notice_masquerade_read_only(), 'error');
      return true;
    }
    if (canWritePlanning(state.planning.authority)) return false;
    let message = m.notice_viewer_read_only();
    if (state.planning.authority === null) {
      message =
        state.planning.phase.kind === 'failed'
          ? m.access_unavailable_summary()
          : m.access_checking_summary();
    }
    state.setNotice(message, 'error');
    return true;
  };

  return buildGuards({ requireCompany, isBlockedByViewer });
}

interface BuildGuardsInput {
  requireCompany: () => ID;
  isBlockedByViewer: () => boolean;
}

function buildGuards({ requireCompany, isBlockedByViewer }: BuildGuardsInput) {
  const resolveOwnedRow = <K extends ScopedEntityKey>(
    data: AppData,
    key: K,
    id: ID,
  ): AppData[K][number] | null => findOwnedIn(data, requireCompany(), key, id);

  return { requireCompany, isBlockedByViewer, resolveOwnedRow };
}
