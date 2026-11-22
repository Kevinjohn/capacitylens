import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationDialog } from './AllocationDialog';
import { useStore } from '@/store/useStore';
import { chooseOption } from '@/test/schedulerTestKit';
import {
  ACC,
  person,
  resetAllocationDialogStore,
  renderAsOwner,
} from '@/test/allocationDialogTestKit';

beforeEach(async () => {
  await resetAllocationDialogStore();
});

const enableBlocks = () => useStore.getState().updateCompany(ACC, { schedulingMode: 'blocks' });

describe('AllocationDialog blocks mode', () => {
  it('asks only for start + days over, and persists a zero-load span', async () => {
    await enableBlocks();
    const r = await requireCreated(
      useStore.getState().addResource({ ...person('Bruce'), workingDays: [1, 2, 3, 4, 5] }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{
          resourceId: r.id,
          startDate: '2026-06-01',
          endDate: '2026-06-01',
        }}
        onClose={onClose}
      />,
    );

    expect(screen.queryByLabelText('End')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hours / day')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Days of work')).not.toBeInTheDocument();

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');
    fireEvent.change(screen.getByLabelText('Days over'), {
      target: { value: '10' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClose).toHaveBeenCalled();

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-12',
      hoursPerDay: 0,
    });
  });

  it('rejects a block span that would leave the four-digit-year date domain', async () => {
    await enableBlocks();
    const r = await requireCreated(
      useStore.getState().addResource({ ...person('Bruce'), workingDays: [1, 2, 3, 4, 5] }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{
          resourceId: r.id,
          startDate: '9999-12-31',
          endDate: '9999-12-31',
        }}
        onClose={onClose}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');
    fireEvent.change(screen.getByLabelText('Days over'), {
      target: { value: '2' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot extend beyond 31 December 9999/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });

  it('seeds days over from the drawn span and saves with start alone', async () => {
    await enableBlocks();
    const r = await requireCreated(
      useStore.getState().addResource({ ...person('Bruce'), workingDays: [1, 2, 3, 4, 5] }),
    );
    const user = userEvent.setup();

    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{
          resourceId: r.id,
          startDate: '2026-06-01',
          endDate: '2026-06-05',
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Days over')).toHaveValue(5);

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      hoursPerDay: 0,
    });
  });

  it('preserves historical hours when editing an existing allocation', async () => {
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Bruce'), workingDays: [1, 2, 3, 4, 5] }),
    );
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: 't1',
        startDate: '2026-06-01',
        endDate: '2026-06-07',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    await enableBlocks();
    const user = userEvent.setup();
    renderAsOwner(<AllocationDialog kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Note'), 'Still scheduled');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id),
    ).toMatchObject({
      endDate: '2026-06-07',
      hoursPerDay: 8,
      note: 'Still scheduled',
    });
  });

  it('rejects a fractional Days over value instead of rounding the saved span', async () => {
    await enableBlocks();
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Bruce'), workingDays: [1, 2, 3, 4, 5] }),
    );
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{
          resourceId: resource.id,
          startDate: '2026-06-01',
          endDate: '2026-06-01',
        }}
        onClose={vi.fn()}
      />,
    );

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');
    fireEvent.change(screen.getByLabelText('Days over'), {
      target: { value: '1.5' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/whole number from 1/i);
    expect(useStore.getState().data.allocations).toHaveLength(0);
  });
});
