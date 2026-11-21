import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationDialog } from './AllocationDialog';
import { useStore } from '@/store/useStore';
import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import { chooseOption } from '@/test/schedulerTestKit';
import { requireValue } from '@/test/fixtures';
import { queueAllocationGroupResponse } from '@/test/planning/queuePlanningTestKit';
import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { PlanningCacheError } from '@/data/planning/planningErrors';
import {
  ACC,
  person,
  addPerson,
  completeAssignment,
  resetAllocationDialogStore,
  restoreStoreAllocationActions,
  renderAsOwner,
} from '@/test/allocationDialogTestKit';

const juneWeeklyOccurrences = [
  ['2099-06-01', '2099-06-03'],
  ['2099-06-08', '2099-06-10'],
  ['2099-06-15', '2099-06-17'],
] as const;

beforeEach(async () => {
  await resetAllocationDialogStore();
});

// These cases drive many sequential user interactions and can exceed Vitest's 5 s default on CI hardware.
describe('AllocationDialog repeat creation', { timeout: 15_000 }, () => {
  it('shows all six create-only options, defaults to one-off and dirty-tracks repeat changes', async () => {
    const resource = await addPerson();
    const { unmount } = renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={vi.fn()}
      />,
    );
    const repeat = screen.getByRole('combobox', { name: 'Repeat' });
    expect(repeat).toHaveTextContent('Doesn’t repeat');
    fireEvent.keyDown(repeat, { key: 'ArrowDown' });
    for (const option of [
      'Doesn’t repeat',
      'Weekly',
      'Every 2 weeks',
      'Every 3 weeks',
      'Every 4 weeks',
      'Monthly',
    ]) {
      expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('option', { name: 'Weekly' }));
    const repeatUntil = screen.getByLabelText('Repeat until');
    expect(repeatUntil).toHaveValue('2099-08-31');
    expect(repeatUntil).toHaveAttribute('aria-required', 'true');
    expect(repeatUntil).toHaveAttribute('min', '2099-06-01');
    expect(repeatUntil).toHaveAttribute('max', '2099-12-01');
    expect(useStore.getState().dirtyForm).toBe(true);
    unmount();

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
    expect(screen.queryByRole('combobox', { name: 'Repeat' })).not.toBeInTheDocument();
  });

  it('defaults from the allocation start, follows untouched starts, and preserves a hand-edited cutoff', async () => {
    const resource = await addPerson();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2027-12-03', endDate: '2027-12-05' }}
        onClose={vi.fn()}
      />,
    );
    await chooseOption(user, 'Repeat', 'Weekly');
    const repeatUntil = screen.getByLabelText('Repeat until');
    expect(repeatUntil).toHaveValue('2028-02-29');

    const start = screen.getByLabelText('Start Date');
    await user.clear(start);
    await user.type(start, '2028-01-10');
    expect(repeatUntil).toHaveValue('2028-03-31');

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2028-04-15');
    await user.clear(start);
    await user.type(start, '2028-02-10');
    expect(repeatUntil).toHaveValue('2028-04-15');
  });

  it('fills the suggested cutoff once a valid start follows repeat being switched on', async () => {
    const resource = await addPerson();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2027-12-03', endDate: '2027-12-05' }}
        onClose={vi.fn()}
      />,
    );
    const start = screen.getByLabelText('Start Date');
    await user.clear(start);
    await chooseOption(user, 'Repeat', 'Weekly');
    const repeatUntil = screen.getByLabelText('Repeat until');
    expect(repeatUntil).toHaveValue('');

    await user.type(start, '2028-01-10');
    expect(repeatUntil).toHaveValue('2028-03-31');
  });

  it('clamps the suggested cutoff at the supported date boundary', async () => {
    const resource = await addPerson();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '9999-11-15', endDate: '9999-11-16' }}
        onClose={vi.fn()}
      />,
    );
    await chooseOption(user, 'Repeat', 'Monthly');
    expect(screen.getByLabelText('Repeat until')).toHaveValue('9999-12-31');
    expect(screen.getByLabelText('Repeat until')).toHaveAttribute('max', '9999-12-31');
  });

  it('previews every cadence with formatShortDate and creates weekly through one bulk call', async () => {
    const resource = await addPerson();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);

    for (const [choice, count, lastStart] of [
      ['Weekly', 14, 'Mon 31st Aug'],
      ['Every 2 weeks', 7, 'Mon 24th Aug'],
      ['Every 3 weeks', 5, 'Mon 24th Aug'],
      ['Every 4 weeks', 4, 'Mon 24th Aug'],
      ['Monthly', 4, 'Tue 1st Sep'],
    ] as const) {
      await chooseOption(user, 'Repeat', choice);
      await user.clear(screen.getByLabelText('Repeat until'));
      await user.type(screen.getByLabelText('Repeat until'), '2099-09-01');
      expect(
        await screen.findByText(
          `Creates ${count} linked allocations through Tue 1st Sep. Last start: ${lastStart}.`,
        ),
      ).toBeInTheDocument();
    }

    await chooseOption(user, 'Repeat', 'Weekly');
    await user.clear(screen.getByLabelText('Repeat until'));
    await user.type(screen.getByLabelText('Repeat until'), '2099-06-15');
    queueAllocationGroupResponse(juneWeeklyOccurrences, 'server-repeat-series');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const intent = getStubPlanningTransport().calls.at(-1);
    expect(intent?.operation).toBe('allocation.createGroup');
    if (intent?.operation !== 'allocation.createGroup') {
      throw new Error('Expected a typed repeated allocation group intent.');
    }
    // The browser sends the first occurrence and the pattern; the server places the rest.
    expect(intent.allocation).toMatchObject({ startDate: '2099-06-01', endDate: '2099-06-03' });
    expect(intent.repeat).toEqual({ pattern: { kind: 'weeks', interval: 1 }, until: '2099-06-15' });
    expect(intent).not.toHaveProperty('occurrenceIds');
    expect(intent).not.toHaveProperty('allocations');
    // The typed group write assigns one series id to every stored occurrence.
    expect('seriesId' in intent.allocation).toBe(false);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const seriesIds = useStore.getState().data.allocations.map(({ seriesId }) => seriesId);
    expect(seriesIds).toHaveLength(3);
    expect(seriesIds[0]).toEqual(expect.any(String));
    expect(new Set(seriesIds).size).toBe(1);
  });

  it.each([
    ['Internal', 'Operations', undefined],
    ['No specific project', 'Planning', undefined],
    ['Ferris / Lightning', 'Planning', 'p1'],
  ] as const)(
    "derives every repeated allocation's attribution for the %s scope",
    async (scope, activityName, projectId) => {
      await useStore.getState().addActivity({ name: 'Operations', kind: 'internal' });
      await useStore.getState().addActivity({ name: 'Planning', kind: 'repeatable' });
      const resource = await addPerson();
      const user = userEvent.setup();
      renderAsOwner(
        <AllocationDialog
          kind="create"
          create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
          onClose={vi.fn()}
        />,
      );

      await chooseOption(user, 'Project', scope);
      await chooseOption(user, 'Activity', activityName);
      await chooseOption(user, 'Repeat', 'Weekly');
      await user.clear(screen.getByLabelText('Repeat until'));
      await user.type(screen.getByLabelText('Repeat until'), '2099-06-15');
      queueAllocationGroupResponse(juneWeeklyOccurrences, 'server-repeat-series');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      const intent = getStubPlanningTransport().calls.at(-1);
      expect(intent?.operation).toBe('allocation.createGroup');
      if (intent?.operation !== 'allocation.createGroup') {
        throw new Error('Expected a typed repeated allocation group intent.');
      }
      expect(intent).not.toHaveProperty('occurrenceIds');
      expect(intent.allocation).toHaveProperty('projectId', projectId ?? null);
    },
  );

  it('previews the original monthly numeric day and sends the monthly pattern', async () => {
    // The numeric repeat anchor must be an effective working day, so use a seven-day calendar to isolate date preservation from the creation gate.
    await useStore.getState().updateCompany(ACC, { workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Barbara'), workingDays: [0, 1, 2, 3, 4, 5, 6] }),
    );
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-01-31', endDate: '2099-02-02' }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Monthly');
    await user.clear(screen.getByLabelText('Repeat until'));
    await user.type(screen.getByLabelText('Repeat until'), '2099-04-30');
    expect(
      await screen.findByText(
        'Creates 4 linked allocations through Thu 30th Apr. Last start: Thu 30th Apr.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/clamp|month-end|fallback/i)).not.toBeInTheDocument();
    queueAllocationGroupResponse(
      [
        ['2099-01-31', '2099-02-02'],
        ['2099-02-28', '2099-03-02'],
        ['2099-03-31', '2099-04-02'],
        ['2099-04-30', '2099-05-02'],
      ],
      'server-repeat-series',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const intent = getStubPlanningTransport().calls.at(-1);
    expect(intent?.operation).toBe('allocation.createGroup');
    if (intent?.operation !== 'allocation.createGroup') {
      throw new Error('Expected a typed repeated allocation group intent.');
    }
    expect(intent.allocation).toMatchObject({ startDate: '2099-01-31', endDate: '2099-02-02' });
    expect(intent.repeat).toEqual({ pattern: { kind: 'monthly-date' }, until: '2099-04-30' });
    expect(intent).not.toHaveProperty('occurrenceIds');
  });

  it.each(['days', 'blocks'] as const)(
    'keeps a %s repeat open when the server refuses a later occurrence beyond the date range',
    async (schedulingMode) => {
      await useStore
        .getState()
        .updateCompany(ACC, { schedulingMode, workingDays: [0, 1, 2, 3, 4, 5, 6] });
      const resource = await requireCreated(
        useStore.getState().addResource({
          ...person('Tyler'),
          workingDays: [0, 1, 2, 3, 4, 5, 6],
        }),
      );
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderAsOwner(
        <AllocationDialog
          kind="create"
          create={{ resourceId: resource.id, startDate: '9999-09-30', endDate: '9999-10-02' }}
          onClose={onClose}
        />,
      );
      await completeAssignment(user);
      await chooseOption(user, 'Repeat', 'Monthly');
      await user.clear(screen.getByLabelText('Repeat until'));
      await user.type(screen.getByLabelText('Repeat until'), '9999-12-30');

      // The server places later occurrences, so it owns this refusal.
      const refusal = 'A repeated working span extends beyond the supported date range.';
      getStubPlanningTransport().failNext(new PlanningCacheError(refusal, 'VALIDATION_ERROR', 400));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
      expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
        operation: 'allocation.createGroup',
        repeat: { pattern: { kind: 'monthly-date' }, until: '9999-12-30' },
      });
      expect(screen.queryByText(/creates 4 linked allocations/i)).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: /new allocation/i })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it('routes a zero-overlap repeat to the assignee/form error instead of Repeat until', async () => {
    await useStore.getState().updateCompany(ACC, { workingDays: [2] });
    const resource = await requireCreated(
      useStore.getState().addResource({ ...person('Tyler'), workingDays: [1] }),
    );
    const bulkSpy = vi.spyOn(useStore.getState(), 'addRepeatedAllocation');
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Weekly');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "This person has no working days within the company's current working week.",
    );
    expect(alert).not.toHaveTextContent(/repeat until|supported date range/i);
    expect(screen.getByLabelText('Repeat until')).not.toHaveAttribute('aria-invalid', 'true');
    expect(bulkSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    bulkSpy.mockRestore();
  });

  it('keeps one-off on addAllocation and leaves a rejected bulk dialog open', async () => {
    const resource = await addPerson();
    const oneSpy = vi.spyOn(useStore.getState(), 'addAllocation');
    const bulkSpy = vi.spyOn(useStore.getState(), 'addRepeatedAllocation');
    const user = userEvent.setup();
    const first = renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(oneSpy).toHaveBeenCalledTimes(1);
    expect(bulkSpy).not.toHaveBeenCalled();
    first.unmount();
    oneSpy.mockRestore();
    bulkSpy.mockRestore();
    restoreStoreAllocationActions();

    const rejectBulk = vi
      .spyOn(useStore.getState(), 'addRepeatedAllocation')
      .mockImplementation(() => {
        throw new Error('The generated batch was rejected.');
      });
    const onClose = vi.fn();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Every 3 weeks');
    await user.clear(screen.getByLabelText('Repeat until'));
    await user.type(screen.getByLabelText('Repeat until'), '2099-09-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('dialog', { name: /new allocation/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The generated batch was rejected.');
    expect(onClose).not.toHaveBeenCalled();
    rejectBulk.mockRestore();
  });

  it('validates the required, temporal and six-month Repeat until boundaries', async () => {
    await useStore.getState().updateCompany(ACC, { timezone: 'UTC' });
    const resource = await addPerson();
    const bulkSpy = vi.spyOn(useStore.getState(), 'addRepeatedAllocation');
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Weekly');
    const repeatUntil = screen.getByLabelText('Repeat until');
    const save = screen.getByRole('button', { name: 'Save' });

    await user.clear(repeatUntil);
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when the repeat should end.');

    await user.type(
      repeatUntil,
      addDaysISO(requireValue(useStore.getState().planning.today ?? undefined), -1),
    );
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent('Repeat until cannot be before today.');

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2099-05-31');
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Repeat until cannot be before the allocation start.',
    );

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2099-12-02');
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Repeat until cannot be later than Tue 1st Dec (six calendar months after the allocation start).',
    );

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2099-06-07');
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a later Repeat until date so this cadence includes at least one repeat.',
    );
    expect(bulkSpy).not.toHaveBeenCalled();
    bulkSpy.mockRestore();
  });

  it('includes an occurrence on the cutoff and supports the complete six-month weekly range', async () => {
    const resource = await addPerson();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Weekly');
    const repeatUntil = screen.getByLabelText('Repeat until');

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2099-06-08');
    expect(
      await screen.findByText(
        'Creates 2 linked allocations through Mon 8th Jun. Last start: Mon 8th Jun.',
      ),
    ).toBeInTheDocument();

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2099-12-01');
    expect(
      await screen.findByText(
        'Creates 27 linked allocations through Tue 1st Dec. Last start: Mon 30th Nov.',
      ),
    ).toBeInTheDocument();
  });

  it('dates both ends of the preview once the repeat runs into the next year', async () => {
    const resource = await addPerson();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-12-21', endDate: '2099-12-23' }}
        onClose={vi.fn()}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Weekly');
    const repeatUntil = screen.getByLabelText('Repeat until');

    await user.clear(repeatUntil);
    await user.type(repeatUntil, '2100-01-11');
    // Undated, this reads "through Mon 11th Jan. Last start: Mon 11th Jan.", a forward repeat that
    // appears to end eleven months before it starts.
    expect(
      await screen.findByText(
        'Creates 4 linked allocations through Mon 11th Jan 2100. Last start: Mon 11th Jan 2100.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the save reply repeat advisory after the dialog closes, with no preview', async () => {
    const resource = await addPerson();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAsOwner(
      <AllocationDialog
        kind="create"
        create={{ resourceId: resource.id, startDate: '2099-06-01', endDate: '2099-06-03' }}
        onClose={onClose}
      />,
    );
    await completeAssignment(user);
    await chooseOption(user, 'Repeat', 'Weekly');
    await user.clear(screen.getByLabelText('Repeat until'));
    await user.type(screen.getByLabelText('Repeat until'), '2099-06-15');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    queueAllocationGroupResponse(juneWeeklyOccurrences, 'server-repeat-series', {
      overCapacityAllocations: 1,
      timeOffAllocations: 2,
      nonEffectiveStartAllocations: 1,
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useStore.getState().notice).toEqual({
      message:
        'Saved. For this repeat, 1 allocation exceeds capacity and 2 allocations overlap time off and 1 allocation starts on a non-working day.',
      tone: 'warning',
    });
  });

  it('duplicates exactly one allocation through the single-row path and never exposes Repeat', async () => {
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
    const user = userEvent.setup();
    renderAsOwner(<AllocationDialog kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Repeat' })).not.toBeInTheDocument();
    queuePlanningPatch((execution) => {
      const intent = execution.intent;
      if (intent.operation !== 'allocation.duplicate') {
        throw new Error(`Expected allocation.duplicate, received ${intent.operation}.`);
      }
      const timestamp = new Date().toISOString();
      return {
        removed: [],
        upserts: [
          {
            entity: 'allocations',
            row: {
              ...allocation,
              ...intent.occurrence,
              companyId: ACC,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
        ],
      };
    });
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'allocation.duplicate',
      sourceAllocationId: allocation.id,
      occurrence: { startDate: allocation.startDate, endDate: allocation.endDate },
    });
    await vi.waitFor(() => expect(useStore.getState().data.allocations).toHaveLength(2));
  });

  it('surfaces an availability error when duplication would recreate retained conflicting dates', async () => {
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
    await useStore.getState().updateResource(resource.id, { firstAvailableDate: '2026-06-08' });
    const user = userEvent.setup();
    renderAsOwner(<AllocationDialog kind="edit" allocationId={allocation.id} onClose={vi.fn()} />);

    // The server owns availability and attribution; the browser surfaces its refusal.
    getStubPlanningTransport().failNext(
      new PlanningCacheError(
        'The allocation starts before this person is available.',
        'VALIDATION_ERROR',
        400,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/before this person is available/i);
    expect(useStore.getState().data.allocations).toHaveLength(1);
  });
});
