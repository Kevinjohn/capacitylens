import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AppData } from '@capacitylens/shared/types/entities';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { useStore } from '@/store/useStore';
import {
  makeAppData,
  makeAccount,
  makeClient,
  makeProject,
  makeActivity,
  makeResource,
  makeAllocation,
  makeTimeOff,
  makeClosure,
  DEFAULT_ACCOUNT_ID,
  resetStoreWithData,
} from '@/test/fixtures';
import { ClientList } from '@/components/clients/ClientList';
import { ProjectList } from '@/components/projects/ProjectList';
import { ActivityList } from '@/components/activities/ActivityList';
import { DisciplineList } from '@/components/disciplines/DisciplineList';
import { ResourceList } from '@/components/resources/ResourceList';
import { TimeOffList } from '@/components/timeoff/TimeOffList';
import { CompanyClosureSection } from '@/components/timeoff/CompanyClosureSection';
import { SchedulerGrid } from '@/components/scheduler/SchedulerGrid';

const hold = vi.hoisted(() => ({
  release: null as Promise<void> | null,
  entered: null as (() => void) | null,
  writes: 0,
}));

function requirePlanningMutationSuccess(value: unknown): PlanningMutationSuccess {
  // The mocked volatile transport returns the PlanningTransport success contract.
  return value as PlanningMutationSuccess;
}

vi.mock('@/data/planning/storePlanningTransport', async () => {
  const actual = await vi.importActual<typeof import('@/test/createTestPlanningTransport')>(
    '@/test/createTestPlanningTransport',
  );
  return {
    createStorePlanningTransport: (read: () => AppData) => {
      return actual.createTestPlanningTransport(read, (transport) => ({
        ...transport,
        execute: async (...args: Parameters<typeof transport.execute>) => {
          const receipt: PlanningMutationSuccess = requirePlanningMutationSuccess(
            await transport.execute(...args),
          );
          if (hold.release) {
            hold.writes += 1;
            const release = hold.release;
            hold.entered?.();
            await release;
          }
          return receipt;
        },
      }));
    },
  };
});
const accountId = DEFAULT_ACCOUNT_ID;
beforeAll(async () => {
  // Resolve the real lazy editor before testing the lifetime of an opening's pending Save.
  await import('@/components/scheduler/AllocationModal');
});
beforeEach(async () => {
  hold.release = null;
  hold.entered = null;
  hold.writes = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ avatars: [] })),
  );
  const data = makeAppData({
    accounts: [makeAccount({ externalEnabled: true })],
    clients: [makeClient({ accountId, name: 'Wayne Enterprises', color: '#2d75da' })],
    projects: [makeProject({ accountId, name: 'Gotham', color: '#da2d92' })],
    activities: [makeActivity({ accountId, name: 'Design' })],
    resources: [
      makeResource({ accountId, name: 'Bruce Wayne' }),
      makeResource({
        id: 'external',
        accountId,
        kind: 'external',
        name: 'Kord Industries',
        workingDays: [],
        halfDays: [],
        workingHoursPerDay: 0,
      }),
    ],
    disciplines: [
      {
        id: 'd1',
        accountId,
        name: 'Design',
        color: '#2d75da',
        sortOrder: 0,
        createdAt: 't',
        updatedAt: 't',
      },
    ],
    allocations: [makeAllocation({ accountId })],
    timeOff: [makeTimeOff({ accountId })],
    closures: [
      makeClosure({
        accountId,
        name: 'Summer closure',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      }),
    ],
  });
  await resetStoreWithData(data, accountId);
  useStore.getState().clearFilters();
  useStore.getState().goToDate('2026-06-01');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const families = [
  {
    family: 'client',
    Component: ClientList,
    edit: () => screen.getByRole('button', { name: 'Edit Wayne Enterprises' }),
    field: 'Name',
  },
  {
    family: 'project',
    Component: ProjectList,
    edit: () => screen.getByRole('button', { name: 'Edit Gotham' }),
    field: 'Name',
  },
  {
    family: 'activity',
    Component: ActivityList,
    edit: () => screen.getByRole('button', { name: 'Edit Design' }),
    field: 'Name',
  },
  {
    family: 'discipline',
    Component: DisciplineList,
    edit: () => screen.getByRole('button', { name: 'Edit Design' }),
    field: 'Name',
  },
  {
    family: 'external',
    Component: ResourceList,
    edit: () => screen.getByRole('button', { name: 'Edit Kord Industries' }),
    field: 'Company',
  },
  {
    family: 'time off',
    Component: TimeOffList,
    edit: () => within(screen.getByTestId('timeoff-row')).getByRole('button', { name: /^Edit/ }),
    field: 'End',
  },
  {
    family: 'closure',
    Component: CompanyClosureSection,
    edit: () => screen.getByRole('button', { name: /^Edit Summer closure/ }),
    field: 'Name',
  },
  {
    family: 'scheduler time off',
    Component: SchedulerGrid,
    edit: () => {
      act(() => useStore.getState().setDrawMode('timeoff'));
      return screen.getByRole('button', { name: 'Add time off for Bruce Wayne' });
    },
    field: 'End',
  },
  {
    family: 'allocation',
    Component: SchedulerGrid,
    edit: () => screen.getByTestId('allocation-bar'),
    field: 'End',
  },
];

it.each(
  families.filter(({ family }) =>
    ['client', 'project', 'activity', 'discipline', 'external', 'time off', 'closure'].includes(
      family,
    ),
  ),
)(
  'freezes and retries the original $family draft after a rejected save',
  async ({ Component, edit, field, family }) => {
    let rejectSave!: () => void;
    const rejectedSave = new Promise<void>((_resolve, reject) => {
      rejectSave = () => reject(new Error('The save was rejected.'));
    });
    let requestCount = 0;
    const waitForFirstSave = async () => {
      requestCount += 1;
      await rejectedSave;
    };
    const store = useStore.getState();
    switch (family) {
      case 'client':
        vi.spyOn(store, 'updateClient').mockImplementationOnce(waitForFirstSave);
        break;
      case 'project':
        vi.spyOn(store, 'updateProject').mockImplementationOnce(waitForFirstSave);
        break;
      case 'activity':
        vi.spyOn(store, 'updateActivity').mockImplementationOnce(waitForFirstSave);
        break;
      case 'discipline':
        vi.spyOn(store, 'updateDiscipline').mockImplementationOnce(waitForFirstSave);
        break;
      case 'external':
        vi.spyOn(store, 'updateResource').mockImplementationOnce(waitForFirstSave);
        break;
      case 'time off':
        vi.spyOn(store, 'updateTimeOff').mockImplementationOnce(waitForFirstSave);
        break;
      case 'closure':
        vi.spyOn(store, 'updateClosure').mockImplementationOnce(waitForFirstSave);
        break;
      default:
        throw new Error(`Unexpected form family: ${family}`);
    }
    render(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );
    fireEvent.click(edit());
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(field) as HTMLInputElement;
    const draft = field === 'End' ? '2026-06-04' : 'Rejected draft';
    fireEvent.change(input, { target: { value: draft } });
    const form = within(dialog).getByRole('button', { name: 'Save' }).closest('form');
    if (!form) throw new Error('Expected editor form');
    fireEvent.submit(form);
    await waitFor(() => expect(input).toBeDisabled());
    expect(input).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.submit(form);
    expect(requestCount).toBe(1);

    await act(async () => rejectSave());
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue(draft);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The save was rejected.');

    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requestCount).toBe(1);
  },
);

it.each(families)(
  'keeps the reopened same-target $family draft when its previous Save completes',
  async ({ Component, edit, field, family }) => {
    render(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );
    if (family === 'allocation') fireEvent.keyDown(edit(), { key: 'Enter' });
    else fireEvent.click(edit());
    const first = await screen.findByRole('dialog');
    const original = within(first).getByLabelText(field) as HTMLInputElement;
    const firstValue = field === 'End' ? '2026-06-04' : 'Saved A';
    fireEvent.change(original, { target: { value: firstValue } });
    let release!: () => void;
    hold.release = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      hold.entered = resolve;
    });
    const beforeRevision = useStore.getState().planning.revision;
    fireEvent.submit(
      within(first).getByRole('button', { name: 'Save' }).closest('form') ??
        (() => {
          throw new Error('Expected editor form');
        })(),
    );
    try {
      await waitFor(() => expect(hold.writes).toBe(1));
      await entered;
      fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }));
      if (family === 'allocation') fireEvent.keyDown(edit(), { key: 'Enter' });
      else fireEvent.click(edit());
      const second = await screen.findByRole('dialog');
      const secondValue = field === 'End' ? '2026-06-05' : 'Dirty B';
      fireEvent.change(within(second).getByLabelText(field), { target: { value: secondValue } });
      await act(async () => release());
      await waitFor(() =>
        expect(useStore.getState().planning.revision).toBe((beforeRevision ?? 0) + 1),
      );
      expect(screen.getByRole('dialog')).toBe(second);
      expect(within(second).getByLabelText(field)).toHaveValue(secondValue);
      expect(hold.writes).toBe(1);
      if (family === 'scheduler time off') expect(useStore.getState().data.timeOff).toHaveLength(2);
    } finally {
      await act(async () => release());
      hold.release = null;
    }
  },
);

it.each(families)(
  'closes the current $family opening after its own save',
  async ({ Component, edit, field, family }) => {
    render(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );
    if (family === 'allocation') fireEvent.keyDown(edit(), { key: 'Enter' });
    else fireEvent.click(edit());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(field), {
      target: { value: field === 'End' ? '2026-06-04' : 'Saved current' },
    });
    const revision = useStore.getState().planning.revision;
    fireEvent.submit(
      within(dialog).getByRole('button', { name: 'Save' }).closest('form') ??
        (() => {
          throw new Error('Expected editor form');
        })(),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useStore.getState().planning.revision).toBe((revision ?? 0) + 1);
  },
);
