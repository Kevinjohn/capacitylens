import type { StoreApi } from 'zustand';
import {
  assertAllocationRefs,
  getOwned as findOwnedIn,
} from '@capacitylens/shared/domain/mutations';
import { m } from '@/i18n';
import { can } from '@capacitylens/shared/domain/access';
import type { AppData, ID, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import type { StoreState } from './types';

/** Create guards that enforce account scoping and entity invariants. */
export function createGuards(get: StoreApi<StoreState>['getState']) {
  // Every scoped add* stamps the active account. A non-null selection alone is insufficient. The
  // account must either exist in the published data or in the server-authorised summaries while a
  // switch is loading its slice. Typed command context and revision checks still gate writes; this
  // guard only prevents stamping an orphan accountId into the slice.
  const requireAccount = (): ID => {
    const state = get();
    const id = state.activeAccountId;
    if (!id) throw new Error('No active company is selected.');
    if (state.activeAccountLoadFailed === id) {
      throw new Error('The active account is not loaded — cannot mutate scoped data.');
    }
    if (
      !state.data.accounts.some((account) => account.id === id) &&
      !state.accountSummaries.some((account) => account.id === id)
    ) {
      throw new Error('The active account is not loaded — cannot mutate scoped data.');
    }
    return id;
  };

  // Refuse writes during masquerade or until a concrete writable role is published.
  // Return a notice instead of throwing because callers use this guard for interactive mutations.
  const blockedByViewer = (): boolean => {
    const state = get();
    if (state.masquerade.kind !== 'inactive') {
      state.setNotice(m.notice_masquerade_read_only(), 'error');
      return true;
    }
    if (state.activeRole !== null && can(state.activeRole, 'planning:write')) return false;
    let message = m.notice_viewer_read_only();
    if (state.activeRoleStatus === 'pending') message = m.access_checking_summary();
    if (state.activeRoleStatus === 'unavailable' || state.activeRole === null) {
      message = m.access_unavailable_summary();
    }
    state.setNotice(message, 'error');
    return true;
  };

  return buildGuards({ requireAccount, blockedByViewer });
}

interface BuildGuardsInput {
  requireAccount: () => ID;
  blockedByViewer: () => boolean;
}

function buildGuards({ requireAccount, blockedByViewer }: BuildGuardsInput) {
  const resolveOwnedRow = <K extends ScopedEntityKey>(
    data: AppData,
    key: K,
    id: ID,
  ): AppData[K][number] | null => findOwnedIn(data, requireAccount(), key, id);
  const assertAllocation = assertAllocationRefs;

  return {
    requireAccount,
    blockedByViewer,
    resolveOwnedRow,
    assertAllocation,
  };
}
