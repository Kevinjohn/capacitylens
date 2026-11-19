import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import { useStore, WINDOW_READ_DELAY_MS } from './useStore';
import { buildVisibleRange } from './selectors';
import { makeCompany, makeAppData, resetStoreWithData } from '@/test/fixtures';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { capacityDays } from '@/test/capacityFixtures';

const gridWindow = () => {
  const { start, end } = buildVisibleRange(useStore.getState().ui);
  return { from: start, to: end };
};

describe('planning read capacity window', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the default window until a read anchors the grid, then for the grid window', async () => {
    await resetStoreWithData(makeAppData({ accounts: [makeCompany()] }));
    const transport = getStubPlanningTransport();
    // The first read's anchoring moves the grid onto the server's default window, so no second read.
    await Promise.resolve();
    expect(transport.readWindows.length).toBeGreaterThan(0);
    expect(transport.readWindows.every((window) => window === undefined)).toBe(true);
    const anchoredReads = transport.readWindows.length;

    useStore.getState().panDays(7);
    await expect.poll(() => transport.readWindows.length).toBe(anchoredReads + 1);
    expect(transport.readWindows.at(-1)).toEqual(gridWindow());

    await useStore.getState().refreshPlanning({ fresh: true });
    expect(transport.readWindows.at(-1)).toEqual(gridWindow());
  });

  it('keeps the figures of the read it accepts', async () => {
    await resetStoreWithData(makeAppData({ accounts: [makeCompany()] }));
    const window = gridWindow();
    const horizon = { from: window.from, to: addDaysISO(window.from, 6) };
    const capacity = {
      window,
      horizon,
      resources: {
        'r-bruce': {
          overSoon: true,
          window: capacityDays(window, {}, { [window.from]: { allocated: 9, over: true } }),
          horizon: capacityDays(horizon),
        },
      },
    };
    getStubPlanningTransport().setCapacity(capacity);

    await useStore.getState().refreshPlanning({ fresh: true });

    expect(useStore.getState().planning.capacity).toEqual(capacity);
  });

  it('reads once, for the last window, after several quick moves', async () => {
    await resetStoreWithData(makeAppData({ accounts: [makeCompany()] }));
    const transport = getStubPlanningTransport();
    const reads = transport.readWindows.length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    useStore.getState().panDays(7);
    useStore.getState().panDays(7);
    useStore.getState().panDays(7);
    await vi.advanceTimersByTimeAsync(WINDOW_READ_DELAY_MS - 1);
    expect(transport.readWindows).toHaveLength(reads);
    await vi.advanceTimersByTimeAsync(1);

    expect(transport.readWindows).toHaveLength(reads + 1);
    expect(transport.readWindows.at(-1)).toEqual(gridWindow());
  });

  it('keeps planning ready while the moved window is read', async () => {
    await resetStoreWithData(makeAppData({ accounts: [makeCompany()] }));
    const transport = getStubPlanningTransport();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const release = transport.holdNextRead();
    const reads = transport.readWindows.length;

    useStore.getState().panDays(7);
    await vi.advanceTimersByTimeAsync(WINDOW_READ_DELAY_MS);
    expect(transport.readWindows).toHaveLength(reads + 1);
    expect(useStore.getState().planning.status).toBe('ready');

    release();
    await vi.waitFor(() =>
      expect(useStore.getState().planning.capacity?.window).toEqual(gridWindow()),
    );
  });

  it('reads the moved window during a read in flight, which then resolves with the newer read', async () => {
    await resetStoreWithData(makeAppData({ accounts: [makeCompany()] }));
    const transport = getStubPlanningTransport();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const release = transport.holdNextRead();
    const first = useStore.getState().refreshPlanning({ fresh: true });
    const reads = transport.readWindows.length;

    useStore.getState().panDays(7);
    await vi.advanceTimersByTimeAsync(WINDOW_READ_DELAY_MS);
    expect(transport.readWindows).toHaveLength(reads + 1);
    expect(transport.readWindows.at(-1)).toEqual(gridWindow());

    release();
    await expect(first).resolves.toBe(true);
    expect(useStore.getState().planning.status).toBe('ready');
    expect(useStore.getState().planning.error).toBeNull();
  });
});
