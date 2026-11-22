import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  modelLoaded: vi.fn(),
  transitionCompany: vi.fn(),
  start: vi.fn(),
  adoptStatus: vi.fn(),
  captureStatusReconciliation: vi.fn(),
  status: vi.fn(),
  retryProjection: vi.fn(),
  end: vi.fn(),
  activeCompanyId: 'a-studio' as string | null,
}));

vi.mock('@/store/useStore', () => ({
  useStore: {
    getState: () => ({
      activeCompanyId: mocks.activeCompanyId,
    }),
  },
}));

vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: mocks.status },
}));

vi.mock('./masqueradeModelInstance', () => ({
  masqueradeModel:
    (mocks.modelLoaded(),
    {
      transitionCompany: mocks.transitionCompany,
      start: mocks.start,
      adoptStatus: mocks.adoptStatus,
      captureStatusReconciliation: mocks.captureStatusReconciliation,
      retryProjection: mocks.retryProjection,
      end: mocks.end,
    }),
}));

describe('account transition boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.modelLoaded.mockReset();
    mocks.transitionCompany.mockReset();
    mocks.start.mockReset();
    mocks.adoptStatus.mockReset();
    mocks.captureStatusReconciliation.mockReset();
    mocks.status.mockReset();
    mocks.retryProjection.mockReset();
    mocks.end.mockReset();
    mocks.activeCompanyId = 'a-studio';
  });

  it('rechecks refresh ownership after the model finishes loading', async () => {
    const isCurrent = vi.fn(() => mocks.modelLoaded.mock.calls.length === 0);
    const boundary = await import('./companyTransition');

    await expect(
      boundary.adoptMasqueradeStatus({ active: false, masqueradeToken: 'idle-context' }, isCurrent),
    ).resolves.toBe(false);
    expect(mocks.modelLoaded).toHaveBeenCalledOnce();
    expect(isCurrent).toHaveBeenCalledOnce();
    expect(mocks.adoptStatus).not.toHaveBeenCalled();
  });

  it('delegates account changes to the masquerade transition boundary', async () => {
    mocks.transitionCompany.mockResolvedValue(true);
    const boundary = await import('./companyTransition');

    await expect(boundary.transitionCompany('a-loft')).resolves.toBe(true);
    expect(mocks.transitionCompany).toHaveBeenCalledWith('a-loft');
  });

  it('delegates account clearing through the same boundary', async () => {
    mocks.transitionCompany.mockResolvedValue(false);
    const boundary = await import('./companyTransition');

    await expect(boundary.transitionCompany(null)).resolves.toBe(false);
    expect(mocks.transitionCompany).toHaveBeenCalledWith(null);
  });

  it('starts masquerade through the same lazy model boundary', async () => {
    mocks.start.mockResolvedValue(true);
    const boundary = await import('./companyTransition');

    await expect(boundary.startMasquerade('a-studio', 'u-viewer')).resolves.toBe(true);
    expect(mocks.start).toHaveBeenCalledWith('a-studio', 'u-viewer');
  });

  it('adopts server status through the lazy model boundary', async () => {
    const status = { active: false as const, masqueradeToken: 'idle-context' };
    const boundary = await import('./companyTransition');

    await expect(boundary.adoptMasqueradeStatus(status)).resolves.toBe(true);

    expect(mocks.adoptStatus).toHaveBeenCalledWith(status);
  });

  it('ignores a status response that arrives after its captured projection becomes stale', async () => {
    let isCurrent = true;
    let resolveStatus!: (status: { active: false; masqueradeToken: string }) => void;
    mocks.captureStatusReconciliation.mockReturnValue(() => isCurrent);
    mocks.status.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const boundary = await import('./companyTransition');
    const reconciliation = boundary.reconcileMasqueradeStatus();

    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledWith('a-studio'));
    isCurrent = false;
    resolveStatus({ active: false, masqueradeToken: 'stale-idle-context' });

    await expect(reconciliation).resolves.toBeUndefined();
    expect(mocks.adoptStatus).not.toHaveBeenCalled();
  });

  it('retries projection through the lazy model boundary', async () => {
    mocks.retryProjection.mockResolvedValue(true);
    const boundary = await import('./companyTransition');

    await expect(boundary.retryMasqueradeProjection()).resolves.toBe(true);
    expect(mocks.retryProjection).toHaveBeenCalledOnce();
  });

  it('ends masquerade through the lazy model boundary', async () => {
    mocks.end.mockResolvedValue(true);
    const navigate = vi.fn();
    const boundary = await import('./companyTransition');

    await expect(boundary.endMasquerade('explicit', navigate)).resolves.toBe(true);
    expect(mocks.end).toHaveBeenCalledWith('explicit', navigate);
  });
});
