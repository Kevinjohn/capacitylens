import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyAppData, SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';
import {
  loadPlanningData,
  makeAccount,
  makeActivity,
  makeAllocation,
  makeClient,
  makeClosure,
  makeProject,
  makeResource,
  makeTimeOff,
  requireValue,
} from '@/test/fixtures';
import { resolveSharedScopedData, useActiveScopedData, useScopedData } from './useScopedData';
import { useStore } from './useStore';

const ACCOUNT_A = 'a-studio';
const ACCOUNT_B = 'a-loft';

function accountRows() {
  return [
    makeAccount({ id: ACCOUNT_A, name: 'Wayne Enterprises' }),
    makeAccount({ id: ACCOUNT_B, name: 'Stark Industries' }),
  ];
}

function clientRows() {
  return [
    makeClient({ id: 'c-a', accountId: ACCOUNT_A, name: 'Wayne Foundation' }),
    makeClient({ id: 'c-b', accountId: ACCOUNT_B, name: 'Stark Industries' }),
  ];
}

function twoAccountData(): AppData {
  return {
    ...emptyAppData(),
    accounts: accountRows(),
    disciplines: [
      {
        id: 'd-a',
        accountId: ACCOUNT_A,
        createdAt: 't',
        updatedAt: 't',
        name: 'Design',
        sortOrder: 1,
        color: null,
      },
      {
        id: 'd-b',
        accountId: ACCOUNT_B,
        createdAt: 't',
        updatedAt: 't',
        name: 'Engineering',
        sortOrder: 1,
        color: null,
      },
    ],
    resources: [
      makeResource({ id: 'r-a', accountId: ACCOUNT_A, name: 'Bruce Wayne' }),
      makeResource({ id: 'r-b', accountId: ACCOUNT_B, name: 'Tony Stark' }),
    ],
    clients: clientRows(),
    projects: [
      makeProject({ id: 'p-a', accountId: ACCOUNT_A, clientId: 'c-a', name: 'Batcave Upgrade' }),
      makeProject({ id: 'p-b', accountId: ACCOUNT_B, clientId: 'c-b', name: 'Arc Reactor' }),
    ],
    phases: [
      {
        id: 'phase-a',
        accountId: ACCOUNT_A,
        createdAt: 't',
        updatedAt: 't',
        name: 'Discovery',
        projectId: 'p-a',
      },
      {
        id: 'phase-b',
        accountId: ACCOUNT_B,
        createdAt: 't',
        updatedAt: 't',
        name: 'Delivery',
        projectId: 'p-b',
      },
    ],
    activities: [
      makeActivity({
        id: 'activity-a',
        accountId: ACCOUNT_A,
        projectId: 'p-a',
        phaseId: 'phase-a',
      }),
      makeActivity({
        id: 'activity-b',
        accountId: ACCOUNT_B,
        projectId: 'p-b',
        phaseId: 'phase-b',
      }),
    ],
    allocations: [
      makeAllocation({
        id: 'allocation-a',
        accountId: ACCOUNT_A,
        resourceId: 'r-a',
        activityId: 'activity-a',
      }),
      makeAllocation({
        id: 'allocation-b',
        accountId: ACCOUNT_B,
        resourceId: 'r-b',
        activityId: 'activity-b',
      }),
    ],
    timeOff: [
      makeTimeOff({ id: 'time-off-a', accountId: ACCOUNT_A, resourceId: 'r-a' }),
      makeTimeOff({ id: 'time-off-b', accountId: ACCOUNT_B, resourceId: 'r-b' }),
    ],
    closures: [
      makeClosure({ id: 'closure-a', accountId: ACCOUNT_A }),
      makeClosure({ id: 'closure-b', accountId: ACCOUNT_B }),
    ],
  };
}

async function activateFixtureAccount(data: AppData, accountId: string): Promise<void> {
  loadPlanningData(data);
  useStore.getState().clearPlanning();
  useStore.getState().setAccountSummaries({
    list: data.accounts.map(({ id, name }) => ({ id, name, role: 'owner' })),
  });
  useStore.getState().setActiveAccount(accountId);
  expect(await useStore.getState().refreshPlanning({ fresh: true })).toBe(true);
}

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().setActiveAccount(null);
});

describe('scoped data', () => {
  it('returns only every selected-account collection through the imperative resolver', () => {
    const scoped = resolveSharedScopedData(twoAccountData(), ACCOUNT_A);

    expect(scoped.accounts).toEqual([]);
    for (const table of SCOPED_KEYS) {
      expect(scoped[table]).toHaveLength(1);
      expect(scoped[table].every((row) => row.accountId === ACCOUNT_A)).toBe(true);
    }
  });

  it('returns one stable empty projection without an active account', () => {
    const data = twoAccountData();

    const first = resolveSharedScopedData(data, null);
    const second = resolveSharedScopedData({ ...data }, null);

    expect(second).toBe(first);
    expect(first).toEqual(emptyAppData());
  });

  it('memoises projections by source-data identity and account', () => {
    const data = twoAccountData();
    const a = resolveSharedScopedData(data, ACCOUNT_A);
    const b = resolveSharedScopedData(data, ACCOUNT_B);

    expect(resolveSharedScopedData(data, ACCOUNT_A)).toBe(a);
    expect(b).not.toBe(a);
    expect(resolveSharedScopedData({ ...data, clients: [...data.clients] }, ACCOUNT_A)).not.toBe(a);
  });
});

describe('scoped data hooks', () => {
  it('updates useScopedData on account changes without retaining the previous account rows', async () => {
    const data = twoAccountData();
    await act(async () => activateFixtureAccount(data, ACCOUNT_A));
    const { result } = renderHook(() => useScopedData());

    expect(result.current.clients.map((client) => client.id)).toEqual(['c-a']);

    await act(async () => {
      useStore.getState().setActiveAccount(ACCOUNT_B);
      expect(await useStore.getState().refreshPlanning({ fresh: true })).toBe(true);
    });

    expect(result.current.clients.map((client) => client.id)).toEqual(['c-b']);
    expect(result.current.clients).not.toContainEqual(
      expect.objectContaining({ accountId: ACCOUNT_A }),
    );
  });

  it('projects archived and soft-deleted rows out of active data', async () => {
    const data = twoAccountData();
    data.resources.push(
      makeResource({ id: 'r-a-active', accountId: ACCOUNT_A, name: 'Diana Prince' }),
    );
    data.clients.push(
      makeClient({ id: 'c-a-active', accountId: ACCOUNT_A, name: 'Queen Industries' }),
    );
    data.projects.push(
      makeProject({
        id: 'p-a-active',
        accountId: ACCOUNT_A,
        clientId: 'c-a-active',
        name: 'Themyscira Archive',
      }),
    );
    data.resources[0] = {
      ...requireValue(data.resources[0]),
      archivedAt: '2026-01-01T00:00:00.000Z',
    };
    data.clients[0] = { ...requireValue(data.clients[0]), deletedAt: '2026-01-02T00:00:00.000Z' };
    await act(async () => activateFixtureAccount(data, ACCOUNT_A));
    const { result } = renderHook(() => useActiveScopedData());

    expect(result.current.resources.map((resource) => resource.id)).toEqual(['r-a-active']);
    expect(result.current.clients.map((client) => client.id)).toEqual(['c-a-active']);
    expect(result.current.projects.map((project) => project.id)).toEqual(['p-a-active']);
  });

  it('preserves the hook projection reference across unrelated store changes', async () => {
    await act(async () => activateFixtureAccount(twoAccountData(), ACCOUNT_A));
    const { result } = renderHook(() => useScopedData());
    const before = result.current;

    act(() => useStore.getState().setNotice('Unrelated'));

    expect(result.current).toBe(before);
  });
});
