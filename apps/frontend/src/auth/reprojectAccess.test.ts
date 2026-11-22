import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidateMemberships, refreshCompanySummaries, refreshPlanning, state } = vi.hoisted(
  () => ({
    invalidateMemberships: vi.fn(),
    refreshCompanySummaries: vi.fn(),
    refreshPlanning: vi.fn(),
    state: { activeCompanyId: 'a-studio' },
  }),
);

vi.mock('@/store/useStore', () => ({
  useStore: { getState: () => ({ invalidateMemberships, refreshPlanning, ...state }) },
}));
vi.mock('./useCompanySummaries', () => ({ refreshCompanySummaries }));

import { reprojectAccess } from './reprojectAccess';

describe('reprojectAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshCompanySummaries.mockResolvedValue([]);
    refreshPlanning.mockResolvedValue(true);
  });

  it('invalidates actor-dependent membership data before reloading the active account', async () => {
    await expect(reprojectAccess('a-studio')).resolves.toBe(true);
    expect(invalidateMemberships).toHaveBeenCalledOnce();
    expect(refreshCompanySummaries).toHaveBeenCalledWith({
      preserveActiveCompanyIfMissing: true,
    });
    expect(refreshPlanning).toHaveBeenCalledExactlyOnceWith({ fresh: true });
  });

  it('stops when authoritative account summaries cannot be loaded', async () => {
    refreshCompanySummaries.mockResolvedValue(null);

    await expect(reprojectAccess('a-studio')).resolves.toBe(false);
    expect(refreshPlanning).not.toHaveBeenCalled();
  });

  it('reports an account-set reload failure', async () => {
    refreshPlanning.mockResolvedValue(false);

    await expect(reprojectAccess('a-studio')).resolves.toBe(false);
  });
});
