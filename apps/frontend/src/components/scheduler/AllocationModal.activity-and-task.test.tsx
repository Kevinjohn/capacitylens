import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationModal } from './AllocationModal';
import { useStore } from '@/store/useStore';
import { makeResourceDraft } from '@/test/fixtures';
import { PermissionContext } from '@/auth/permissionContext';
import { chooseOption } from './__tests__/schedulerTestKit';
import { first, ACC, resetAllocationModalStore } from './__tests__/allocationModalTestKit';

type CapacityAdvisoryMockInput =
  | Parameters<typeof import('@/lib/capacity').buildCapacityAdvisory>[0]
  | Parameters<typeof import('@/lib/capacity').buildCapacityAdvisoryFromLoad>[0];
const capacityAdvisoryMock = vi.hoisted(() =>
  vi.fn<(input: CapacityAdvisoryMockInput) => { overDays: number; timeOffDays: number }>(() => ({
    overDays: 0,
    timeOffDays: 0,
  })),
);
// Single and repeat advisory paths share one verdict stub so these modal tests exercise presentation rather than load calculations.
vi.mock('@/lib/capacity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/capacity')>()),
  buildCapacityAdvisory: capacityAdvisoryMock,
  buildCapacityAdvisoryFromLoad: capacityAdvisoryMock,
}));

beforeEach(async () => {
  await resetAllocationModalStore();
  capacityAdvisoryMock.mockClear();
  capacityAdvisoryMock.mockImplementation(() => ({ overDays: 0, timeOffDays: 0 }));
});

async function addInlineActivityTestPerson() {
  await useStore.getState().addResource(makeResourceDraft({ name: 'Bruce', color: '#111' }));
  return first(useStore.getState().data.resources).id;
}

describe('AllocationModal inline activity creation pref', () => {
  it('keeps a newer project and activity selection when inline creation resolves late', async () => {
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    let finishCreation!: () => void;
    const creationPending = new Promise<void>((resolve) => {
      finishCreation = resolve;
    });
    const addActivity = useStore.getState().addActivity;
    let pendingCreation: ReturnType<typeof addActivity> | undefined;
    const addActivitySpy = vi
      .spyOn(useStore.getState(), 'addActivity')
      .mockImplementation((draft) => {
        pendingCreation = (async () => {
          await creationPending;
          return addActivity(draft);
        })();
        return pendingCreation;
      });

    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Other');
    await user.type(screen.getByLabelText('New activity name'), 'Late activity');

    await user.click(screen.getByRole('button', { name: 'Add activity' }));
    expect(addActivitySpy).toHaveBeenCalledOnce();
    const activityCreation = pendingCreation;
    if (!activityCreation) throw new Error('Expected inline activity creation to be pending.');
    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');

    await act(async () => {
      finishCreation();
      await activityCreation;
    });

    expect(
      useStore.getState().data.activities.find(({ name }) => name === 'Late activity'),
    ).toMatchObject({
      name: 'Late activity',
      projectId: 'p2',
    });
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent(
      'Ferris / Lightning',
    );
    expect(screen.getByRole('combobox', { name: 'Activity' })).toHaveTextContent('Wireframes');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useStore.getState().data.allocations).toHaveLength(1);
    expect(useStore.getState().data.allocations[0]?.activityId).toBe('t1');
    expect(useStore.getState().data.allocations[0]?.activityId).not.toBe(
      useStore.getState().data.activities.find(({ name }) => name === 'Late activity')?.id,
    );
  });

  it('keeps a new activity name typed while an earlier inline creation is pending', async () => {
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    let finishCreation!: () => void;
    const creationPending = new Promise<void>((resolve) => {
      finishCreation = resolve;
    });
    const addActivity = useStore.getState().addActivity;
    let pendingCreation: ReturnType<typeof addActivity> | undefined;
    vi.spyOn(useStore.getState(), 'addActivity').mockImplementation((draft) => {
      pendingCreation = (async () => {
        await creationPending;
        return addActivity(draft);
      })();
      return pendingCreation;
    });

    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Other');
    const nameInput = screen.getByLabelText('New activity name');
    await user.type(nameInput, 'Late activity');
    await user.click(screen.getByRole('button', { name: 'Add activity' }));
    const activityCreation = pendingCreation;
    if (!activityCreation) throw new Error('Expected inline activity creation to be pending.');
    await user.clear(nameInput);
    await user.type(nameInput, 'Next activity');

    await act(async () => {
      finishCreation();
      await activityCreation;
    });

    expect(useStore.getState().data.activities.some(({ name }) => name === 'Late activity')).toBe(
      true,
    );
    expect(screen.getByLabelText('New activity name')).toHaveValue('Next activity');
  });

  it('renders the inline "Add activity" input + button when explicitly enabled', async () => {
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('New activity name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add activity' })).toBeInTheDocument();
  });

  it('places an inline-created project activity in the project-specific group', async () => {
    await useStore.getState().addActivity({ name: 'Planning', kind: 'repeatable' });
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await user.type(screen.getByLabelText('New activity name'), 'Alpha delivery');
    await user.click(screen.getByRole('button', { name: 'Add activity' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Activity' }), { key: 'ArrowDown' });

    const allProjectsGroup = screen.getByRole('group', { name: 'All projects' });
    const projectGroup = screen.getByRole('group', { name: 'Project-specific' });
    expect(screen.getAllByRole('group', { name: 'Project-specific' })).toHaveLength(1);
    expect(
      allProjectsGroup.compareDocumentPosition(projectGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Project-specific' })).getByRole('option', {
        name: 'Alpha delivery',
      }),
    ).toBeInTheDocument();
  });
  it('hides the inline "Add activity" controls by default while retaining the Activity picker', async () => {
    const resourceId = await addInlineActivityTestPerson();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('New activity name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add activity' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Activity' })).toBeInTheDocument();
  });

  it('hides the inline "Add activity" input + button when inlineActivityCreateEnabled is false — the Activity picker still works', async () => {
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: false });
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('New activity name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add activity' })).not.toBeInTheDocument();

    expect(screen.getByRole('combobox', { name: 'Activity' })).toBeInTheDocument();
  });

  it('removes inline activity creation when an open editor modal is downgraded to viewer', async () => {
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    const view = render(
      <PermissionContext.Provider value={{ role: 'editor' }}>
        <AllocationModal
          kind="create"
          create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
          onClose={vi.fn()}
        />
      </PermissionContext.Provider>,
    );
    await user.type(screen.getByLabelText('New activity name'), 'Unsaved viewer activity');

    view.rerender(
      <PermissionContext.Provider value={{ role: 'viewer' }}>
        <AllocationModal
          kind="create"
          create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
          onClose={vi.fn()}
        />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByLabelText('New activity name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add activity' })).not.toBeInTheDocument();
    expect(useStore.getState().data.activities).toHaveLength(2);
  });
});

describe('AllocationModal task field', () => {
  it('shows and saves an optional single-line task when the workspace setting is enabled', async () => {
    const resourceId = await addInlineActivityTestPerson();
    await useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: true });
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText('Task'), 'Launch review');
    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useStore.getState().data.allocations[0]?.task).toBe('Launch review');
  });
  it('allows an existing task to be cleared', async () => {
    const resourceId = await addInlineActivityTestPerson();
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId,
        activityId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
        task: 'Original task',
      }),
    );
    await useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: true });
    const user = userEvent.setup();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Task'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useStore.getState().data.allocations[0]).toHaveProperty('task', null);
  });
  it('preserves a hidden task while an unrelated allocation is edited and restores it when enabled', async () => {
    const resourceId = await addInlineActivityTestPerson();
    const taskAllocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId,
        activityId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
        task: 'Keep this task',
      }),
    );
    const unrelated = requireCreated(
      await useStore.getState().addAllocation({
        resourceId,
        activityId: 't1',
        startDate: '2026-06-08',
        endDate: '2026-06-10',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    await useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: false });
    const user = userEvent.setup();
    const view = render(
      <AllocationModal kind="edit" allocationId={unrelated.id} onClose={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Task')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Tentative' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    view.unmount();

    await useStore.getState().updateAccount(ACC, { showTaskFieldInSchedule: true });
    render(<AllocationModal kind="edit" allocationId={taskAllocation.id} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Task')).toHaveValue('Keep this task');
    expect(
      useStore.getState().data.allocations.find(({ id }) => id === taskAllocation.id)?.task,
    ).toBe('Keep this task');
  });
});
