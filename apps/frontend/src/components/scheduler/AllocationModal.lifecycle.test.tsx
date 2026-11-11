import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationModal } from './AllocationModal';
import { useStore } from '@/store/useStore';
import { makeResourceDraft } from '@/test/fixtures';
import { chooseOption } from './__tests__/schedulerTestKit';
import {
  ACC,
  addPerson,
  closestForm,
  completeAssignment,
  person,
  resetAllocationModalStore,
} from './__tests__/allocationModalTestKit';

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

describe('AllocationModal Enter key submission', () => {
  it('operates the Hours / day select with the keyboard', async () => {
    const resource = await requireCreated(
      useStore.getState().addResource(makeResourceDraft({ name: 'Bruce', color: '#111' })),
    );
    const resourceId = resource.id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');

    const hours = screen.getByRole('combobox', { name: 'Hours / day' });
    hours.focus();
    fireEvent.keyDown(hours, { key: 'ArrowDown' });
    await user.keyboard('2{Enter}');
    expect(hours).toHaveTextContent('2 h - quarter day');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toEqual([
      expect.objectContaining({ hoursPerDay: 2 }),
    ]);
  });

  it('submits when Enter is pressed in the single-line Note input', async () => {
    const resource = await requireCreated(
      useStore.getState().addResource(makeResourceDraft({ name: 'Bruce', color: '#111' })),
    );
    const resourceId = resource.id;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');

    const noteInput = screen.getByLabelText('Note');
    expect(noteInput).toHaveAttribute('type', 'text');
    await user.click(noteInput);
    await user.keyboard('{Enter}');

    expect(onClose).toHaveBeenCalled();
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });

  it('pressing Enter in the new-activity input calls onAddActivity, not submit', async () => {
    const resource = await requireCreated(
      useStore.getState().addResource(makeResourceDraft({ name: 'Bruce', color: '#111' })),
    );
    const resourceId = resource.id;
    await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <AllocationModal
        kind="create"
        create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByLabelText('New activity name'));
    await user.type(screen.getByLabelText('New activity name'), 'Brand new activity');
    await user.keyboard('{Enter}');

    expect(onClose).not.toHaveBeenCalled();
    const activities = useStore.getState().data.activities;
    expect(activities.find((activity) => activity.name === 'Brand new activity')).toMatchObject({
      kind: 'internal',
    });
    expect(screen.getByRole('combobox', { name: 'Activity' })).toHaveTextContent(
      'Brand new activity',
    );
  });
});

describe('AllocationModal submit exclusion', () => {
  it('saves once when two real submit events target a form closed by the first', async () => {
    const resource = await addPerson();
    const addAllocation = vi.spyOn(useStore.getState(), 'addAllocation');
    const user = userEvent.setup();
    let closeModal = () => {};
    const view = render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={() => closeModal()}
      />,
    );
    closeModal = view.unmount;
    await completeAssignment(user);
    const form = closestForm(screen.getByRole('button', { name: 'Save' }));

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(addAllocation).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(useStore.getState().data.allocations).toHaveLength(1));
    addAllocation.mockRestore();
  });
});

describe('AllocationModal lifecycle', () => {
  it('closes when the allocation being edited disappears from the store', async () => {
    const resource = await requireCreated(useStore.getState().addResource(person('Barbara')));
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    const onClose = vi.fn();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);

    await act(() => useStore.getState().deleteAllocation(allocation.id));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit drafted at the older canonical revision instead of overwriting a refreshed field', async () => {
    const resource = await addPerson();
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    const onClose = vi.fn();
    render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-06-05' } });
    const revision = useStore.getState().planning.revision;
    await act(async () => {
      useStore.setState((state) => ({
        data: {
          ...state.data,
          allocations: state.data.allocations.map((row) =>
            row.id === allocation.id
              ? { ...row, hoursPerDay: 4, updatedAt: '2026-06-04T12:00:00Z' }
              : row,
          ),
        },
      }));
      await useStore.getState().refreshPlanning();
    });
    expect(useStore.getState().planning.revision).toBe((revision ?? 0) + 1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/changed/);
    expect(screen.getByLabelText('End')).toHaveValue('2026-06-05');
    expect(
      useStore.getState().data.allocations.find((row) => row.id === allocation.id),
    ).toMatchObject({
      endDate: '2026-06-03',
      hoursPerDay: 4,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().planning.revision).toBe((revision ?? 0) + 1);
  });

  it.each(['none', 'before', 'during'] as const)(
    'saves after its own inline activity only when canonical allocation remains current (concurrent edit: %s)',
    async (concurrent) => {
      const resource = await addPerson();
      await useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: true });
      const allocation = requireCreated(
        await useStore.getState().addAllocation({
          resourceId: resource.id,
          activityId: 't1',
          startDate: '2026-06-01',
          endDate: '2026-06-03',
          hoursPerDay: 8,
          status: 'confirmed',
        }),
      );
      const original = useStore.getState().addActivity;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let creation: ReturnType<typeof original> | undefined;
      let acknowledged = false;
      const addActivity = vi
        .spyOn(useStore.getState(), 'addActivity')
        .mockImplementation((draft) => {
          creation = (async () => {
            const result = await original(draft);
            acknowledged = true;
            await held;
            return result;
          })();
          return creation;
        });
      const onClose = vi.fn();
      render(<AllocationModal kind="edit" allocationId={allocation.id} onClose={onClose} />);
      fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-06-05' } });
      fireEvent.change(screen.getByLabelText('New activity name'), {
        target: { value: 'Gotham review' },
      });
      if (concurrent === 'before') {
        await act(async () => {
          await useStore.getState().updateAllocation(allocation.id, { hoursPerDay: 4 });
        });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
      try {
        await vi.waitFor(() => expect(acknowledged).toBe(true));
        if (concurrent === 'during') {
          await act(async () => {
            await useStore.getState().updateAllocation(allocation.id, { hoursPerDay: 4 });
          });
        }
        await act(async () => {
          release();
          await creation;
        });
        expect(screen.getByRole('combobox', { name: 'Activity' })).toHaveTextContent(
          'Gotham review',
        );
        const revision = useStore.getState().planning.revision;
        await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
        const row = useStore.getState().data.allocations.find((row) => row.id === allocation.id);
        if (concurrent !== 'none') {
          expect(screen.getByRole('alert')).toHaveTextContent(/changed/);
          expect(screen.getByLabelText('End')).toHaveValue('2026-06-05');
          expect(row).toMatchObject({ endDate: '2026-06-03', hoursPerDay: 4, activityId: 't1' });
          expect(onClose).not.toHaveBeenCalled();
          expect(useStore.getState().planning.revision).toBe(revision);
        } else {
          expect(row).toMatchObject({
            endDate: '2026-06-05',
            hoursPerDay: 8,
            activityId: useStore
              .getState()
              .data.activities.find((activity) => activity.name === 'Gotham review')?.id,
          });
          expect(onClose).toHaveBeenCalledOnce();
          expect(useStore.getState().planning.revision).toBe((revision ?? 0) + 1);
        }
      } finally {
        await act(async () => {
          release();
          await creation;
        });
        addActivity.mockRestore();
        useStore.setState({ addActivity: original });
      }
    },
  );

  it('preserves a partially edited draft across equivalent parent props', async () => {
    const resource = await requireCreated(useStore.getState().addResource(person('Barbara')));
    const onClose = vi.fn();
    const view = render(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-06-05' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Hours / day' }));
    fireEvent.click(screen.getByRole('option', { name: '4 h - half day' }));

    view.rerender(
      <AllocationModal
        kind="create"
        create={{ resourceId: resource.id, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText('End')).toHaveValue('2026-06-05');
    expect(screen.getByRole('combobox', { name: 'Hours / day' })).toHaveTextContent(
      '4 h - half day',
    );
  });
});
