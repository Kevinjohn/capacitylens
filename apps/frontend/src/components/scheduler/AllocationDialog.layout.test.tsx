import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
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

function expectLabelControl(control: HTMLElement) {
  expect(control.closest('[data-slot="field"]')).toHaveAttribute(
    'data-product-layout',
    'label-control',
  );
}

function expectInAllocationControlColumn(control: HTMLElement) {
  expect(control.closest('[data-allocation-control-column]')).toBeInTheDocument();
}

function expectAllocationSpanRow(controls: HTMLElement[]) {
  const row = controls[0]?.closest('[data-allocation-span-row]');
  expect(row).toBeInTheDocument();
  expect(
    row?.querySelectorAll(":scope > [data-allocation-span-controls] > [data-slot='field']"),
  ).toHaveLength(controls.length);
  for (const control of controls) {
    expect(control.closest('[data-allocation-span-row]')).toBe(row);
    expect(control.closest('[data-allocation-control-column]')).not.toBeInTheDocument();
  }
}

describe('AllocationDialog compact layout', () => {
  it('aligns Hours-mode create fields, the full-width scheduling row, inline creation and repeat hints', async () => {
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Barbara'), workingDays: [1, 2, 3, 4, 5] }),
    );
    await useStore.getState().updateCompany(ACC, { inlineActivityCreateEnabled: true });
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={vi.fn()}
      />,
    );

    for (const control of [
      screen.getByRole('combobox', { name: 'Project' }),
      screen.getByRole('combobox', { name: 'Activity' }),
      screen.getByRole('combobox', { name: 'Repeat' }),
      screen.getByRole('radiogroup', { name: 'Status' }),
      screen.getByLabelText('Note'),
      screen.getByRole('checkbox', { name: 'Ignore working days' }),
    ]) {
      expectLabelControl(control);
    }
    expect(screen.getByRole('radiogroup', { name: 'Status' })).toHaveClass('w-full');
    expectAllocationSpanRow([
      screen.getByLabelText('Start Date'),
      screen.getByLabelText('End'),
      screen.getByLabelText('Hours / day'),
    ]);
    expectInAllocationControlColumn(screen.getByRole('textbox', { name: 'New activity name' }));

    await chooseOption(user, 'Project', 'Ferris / Lightning');
    await chooseOption(user, 'Activity', 'Wireframes');
    await chooseOption(user, 'Repeat', 'Weekly');
    expectLabelControl(screen.getByLabelText('Repeat until'));
    expectInAllocationControlColumn(screen.getByText(/Creates \d+ linked allocations/));
  });

  it('adds Assignee to the shared rows in edit mode without adding Repeat', async () => {
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Barbara'), workingDays: [1, 2, 3, 4, 5] }),
    );
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
    renderAsOwner(<AllocationDialog kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    expectLabelControl(screen.getByRole('combobox', { name: 'Assignee' }));
    expect(screen.queryByRole('combobox', { name: 'Repeat' })).not.toBeInTheDocument();
    expectAllocationSpanRow([
      screen.getByLabelText('Start Date'),
      screen.getByLabelText('End'),
      screen.getByLabelText('Hours / day'),
    ]);
  });

  it.each([
    ['days', ['Start Date', 'Days of work', 'Days over']],
    ['blocks', ['Start Date', 'Days over']],
  ] as const)('uses a full-width scheduling row for %s mode', async (mode, labels) => {
    await useStore.getState().updateCompany(ACC, { schedulingMode: mode });
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Barbara'), workingDays: [1, 2, 3, 4, 5] }),
    );
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );

    expectAllocationSpanRow(labels.map((label) => screen.getByLabelText(label)));
    expect(screen.getByText(/^Ends /).closest('[data-allocation-span-row]')).toBeInTheDocument();
  });

  it('keeps External dates aligned and the placeholder hint under the control area', async () => {
    const external = await requireCreated(
      useStore.getState().addResource({
        kind: 'external',
        name: 'Kord Industries',
        jobTitle: 'Partner studio',
        employmentType: 'permanent',
        engagement: 'studio',
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: '#9ca3af',
      }),
    );
    const externalView = renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: external.id, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );
    expectAllocationSpanRow([screen.getByLabelText('Start Date'), screen.getByLabelText('End')]);
    expect(screen.queryByRole('checkbox', { name: 'Ignore working days' })).not.toBeInTheDocument();
    externalView.unmount();

    const placeholder = await requireCreated(
      useStore.getState().addResource({
        kind: 'placeholder',
        jobTitle: 'Designer',
        employmentType: 'permanent',
        engagement: 'studio',
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: '#a855f7',
        projectId: 'p1',
      }),
    );
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: placeholder.id, startDate: '2026-06-01', endDate: '2026-06-03' }}
        onClose={vi.fn()}
      />,
    );
    expectInAllocationControlColumn(screen.getByText('Placeholder — locked to its bound project.'));
  });
});
