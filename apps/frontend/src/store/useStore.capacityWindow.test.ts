import { describe, expect, it } from 'vitest';
import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import { useStore } from './useStore';
import { buildVisibleRange } from './selectors';
import { makeAccount, makeAppData, resetStoreWithData } from '@/test/fixtures';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { capacityDays } from '@/test/capacityFixtures';

const gridWindow = () => {
  const { start, end } = buildVisibleRange(useStore.getState().ui);
  return { from: start, to: end };
};

describe('planning read capacity window', () => {
  it('asks for the default window until a read anchors the grid, then for the grid window', async () => {
    await resetStoreWithData(makeAppData({ accounts: [makeAccount()] }));
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
    await resetStoreWithData(makeAppData({ accounts: [makeAccount()] }));
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
});
