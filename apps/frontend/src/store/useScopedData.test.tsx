import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';
import {
  loadPlanningData,
  makeCompany,
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

const COMPANY_A = 'a-studio';
const COMPANY_B = 'a-loft';

function companyRows() {
  return [
    makeCompany({ id: COMPANY_A, name: 'Wayne Enterprises' }),
    makeCompany({ id: COMPANY_B, name: 'Stark Industries' }),
  ];
}

function clientRows() {
  return [
    makeClient({ id: 'c-a', companyId: COMPANY_A, name: 'Wayne Foundation' }),
    makeClient({ id: 'c-b', companyId: COMPANY_B, name: 'Stark Industries' }),
  ];
}

function twoCompanyData(): AppData {
  return {
    ...createEmptyAppData(),
    companies: companyRows(),
    disciplines: [
      {
        id: 'd-a',
        companyId: COMPANY_A,
        createdAt: 't',
        updatedAt: 't',
        name: 'Design',
        sortOrder: 1,
        color: null,
      },
      {
        id: 'd-b',
        companyId: COMPANY_B,
        createdAt: 't',
        updatedAt: 't',
        name: 'Engineering',
        sortOrder: 1,
        color: null,
      },
    ],
    resources: [
      makeResource({ id: 'r-a', companyId: COMPANY_A, name: 'Bruce Wayne' }),
      makeResource({ id: 'r-b', companyId: COMPANY_B, name: 'Tony Stark' }),
    ],
    clients: clientRows(),
    projects: [
      makeProject({ id: 'p-a', companyId: COMPANY_A, clientId: 'c-a', name: 'Batcave Upgrade' }),
      makeProject({ id: 'p-b', companyId: COMPANY_B, clientId: 'c-b', name: 'Arc Reactor' }),
    ],
    phases: [
      {
        id: 'phase-a',
        companyId: COMPANY_A,
        createdAt: 't',
        updatedAt: 't',
        name: 'Discovery',
        projectId: 'p-a',
      },
      {
        id: 'phase-b',
        companyId: COMPANY_B,
        createdAt: 't',
        updatedAt: 't',
        name: 'Delivery',
        projectId: 'p-b',
      },
    ],
    activities: [
      makeActivity({
        id: 'activity-a',
        companyId: COMPANY_A,
        projectId: 'p-a',
        phaseId: 'phase-a',
      }),
      makeActivity({
        id: 'activity-b',
        companyId: COMPANY_B,
        projectId: 'p-b',
        phaseId: 'phase-b',
      }),
    ],
    allocations: [
      makeAllocation({
        id: 'allocation-a',
        companyId: COMPANY_A,
        resourceId: 'r-a',
        activityId: 'activity-a',
      }),
      makeAllocation({
        id: 'allocation-b',
        companyId: COMPANY_B,
        resourceId: 'r-b',
        activityId: 'activity-b',
      }),
    ],
    timeOff: [
      makeTimeOff({ id: 'time-off-a', companyId: COMPANY_A, resourceId: 'r-a' }),
      makeTimeOff({ id: 'time-off-b', companyId: COMPANY_B, resourceId: 'r-b' }),
    ],
    closures: [
      makeClosure({ id: 'closure-a', companyId: COMPANY_A }),
      makeClosure({ id: 'closure-b', companyId: COMPANY_B }),
    ],
  };
}

async function activateFixtureCompany(data: AppData, companyId: string): Promise<void> {
  loadPlanningData(data);
  useStore.getState().clearPlanning();
  useStore.getState().setCompanySummaries({
    list: data.companies.map(({ id, name }) => ({ id, name, role: 'owner' })),
  });
  useStore.getState().setActiveCompany(companyId);
  expect(await useStore.getState().refreshPlanning({ fresh: true })).toBe(true);
}

beforeEach(() => {
  loadPlanningData(createEmptyAppData());
  useStore.getState().setActiveCompany(null);
});

describe('scoped data', () => {
  it("selects another company's dataset as empty", () => {
    const data = { ...createEmptyAppData(), companies: [makeCompany({ id: COMPANY_B })] };

    expect(resolveSharedScopedData(data, COMPANY_A)).toEqual(createEmptyAppData());
    expect(resolveSharedScopedData(data, COMPANY_B)).toBe(data);
  });

  it('returns one stable empty projection without an active account', () => {
    const data = twoCompanyData();

    const first = resolveSharedScopedData(data, null);
    const second = resolveSharedScopedData({ ...data }, null);

    expect(second).toBe(first);
    expect(first).toEqual(createEmptyAppData());
  });
});

describe('scoped data hooks', () => {
  it('updates useScopedData on account changes without retaining the previous account rows', async () => {
    const data = twoCompanyData();
    await act(async () => activateFixtureCompany(data, COMPANY_A));
    const { result } = renderHook(() => useScopedData());

    expect(result.current.clients.map((client) => client.id)).toEqual(['c-a']);

    await act(async () => {
      useStore.getState().setActiveCompany(COMPANY_B);
      expect(await useStore.getState().refreshPlanning({ fresh: true })).toBe(true);
    });

    expect(result.current.clients.map((client) => client.id)).toEqual(['c-b']);
    expect(result.current.clients).not.toContainEqual(
      expect.objectContaining({ companyId: COMPANY_A }),
    );
  });

  it('projects archived and soft-deleted rows out of active data', async () => {
    const data = twoCompanyData();
    data.resources.push(
      makeResource({ id: 'r-a-active', companyId: COMPANY_A, name: 'Diana Prince' }),
    );
    data.clients.push(
      makeClient({ id: 'c-a-active', companyId: COMPANY_A, name: 'Queen Industries' }),
    );
    data.projects.push(
      makeProject({
        id: 'p-a-active',
        companyId: COMPANY_A,
        clientId: 'c-a-active',
        name: 'Themyscira Archive',
      }),
    );
    data.resources[0] = {
      ...requireValue(data.resources[0]),
      archivedAt: '2026-01-01T00:00:00.000Z',
    };
    data.clients[0] = { ...requireValue(data.clients[0]), deletedAt: '2026-01-02T00:00:00.000Z' };
    await act(async () => activateFixtureCompany(data, COMPANY_A));
    const { result } = renderHook(() => useActiveScopedData());

    expect(result.current.resources.map((resource) => resource.id)).toEqual(['r-a-active']);
    expect(result.current.clients.map((client) => client.id)).toEqual(['c-a-active']);
    expect(result.current.projects.map((project) => project.id)).toEqual(['p-a-active']);
  });

  it('preserves the hook projection reference across unrelated store changes', async () => {
    await act(async () => activateFixtureCompany(twoCompanyData(), COMPANY_A));
    const { result } = renderHook(() => useScopedData());
    const before = result.current;

    act(() => useStore.getState().setNotice('Unrelated'));

    expect(result.current).toBe(before);
  });
});
