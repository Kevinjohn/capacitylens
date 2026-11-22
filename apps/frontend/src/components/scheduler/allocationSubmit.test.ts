import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings';
import type { Allocation } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { resolveDomainErrorMessage } from '@/lib/errorMessage';
import {
  makeActivity,
  makeAllocation,
  makeClosure,
  makeResource,
  makeTimeOff,
} from '@/test/fixtures';
import { createAllocationIntents } from './allocationSubmit';

// Lets a test return an assignment failure without codes, which the real validator never does.
const assignment = vi.hoisted(() => ({ withoutCode: false }));
vi.mock('@capacitylens/shared/lib/integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitylens/shared/lib/integrity')>();
  return {
    ...actual,
    validateAllocationAssignment: (
      ...args: Parameters<typeof actual.validateAllocationAssignment>
    ) =>
      assignment.withoutCode
        ? { ok: false, errors: [], codes: [] }
        : actual.validateAllocationAssignment(...args),
  };
});

type IntentInput = Parameters<typeof createAllocationIntents>[0];

function created<T>(value: T) {
  return { kind: 'created' as const, value };
}

// A Monday-to-Tuesday hourly creation for a person working Monday to Friday. Every test changes
// only the fields it needs from this valid baseline and asserts which store action ran.
function validInput(overrides: Partial<IntentInput> = {}): IntentInput {
  return {
    data: { activities: [], allocations: [], closures: [], timeOff: [] },
    create: { resourceId: 'r1', startDate: '2027-01-04', endDate: '2027-01-05' },
    editing: undefined,
    mode: 'hourly',
    resourceId: 'r1',
    activityId: 't1',
    selectedResource: makeResource(),
    selectedActivity: makeActivity(),
    selectedEffectiveProjectId: 'p1',
    attributedProjectId: undefined,
    selectedEffectiveWeek: { kind: 'days', days: [1, 2, 3, 4, 5] },
    startDate: '2027-01-04',
    endDate: '2027-01-05',
    effEndDate: '2027-01-05',
    hoursPerDay: 4,
    effHoursPerDay: 4,
    daysOver: 2,
    initialDaysOver: 2,
    daysOfWork: 2,
    ignoreWorkingDays: false,
    status: 'confirmed',
    note: '',
    noteEdited: false,
    task: '',
    repeat: 'none',
    repeatUntil: '',
    repeatToday: '2027-01-01',
    repeatUntilMaximum: '2027-12-31',
    isBlocks: false,
    isDays: false,
    isExternal: false,
    usesTypedDateRange: true,
    typedDateSpanTooLong: false,
    validDaysOver: true,
    spanFitsDateDomain: true,
    spanLimitedByDateDomain: false,
    maximumDaysOver: 30,
    addAllocation: vi.fn<IntentInput['addAllocation']>(() =>
      Promise.resolve(created(makeAllocation())),
    ),
    addRepeatedAllocation: vi.fn<IntentInput['addRepeatedAllocation']>(() =>
      Promise.resolve(created([makeAllocation()])),
    ),
    duplicateAllocation: vi.fn<IntentInput['duplicateAllocation']>(() =>
      Promise.resolve(created(makeAllocation())),
    ),
    updateAllocation: vi.fn<IntentInput['updateAllocation']>(() => Promise.resolve({})),
    deleteAllocation: vi.fn<IntentInput['deleteAllocation']>(() => Promise.resolve()),
    deleteAllocationSeriesFrom: vi.fn<IntentInput['deleteAllocationSeriesFrom']>(() =>
      Promise.resolve(),
    ),
    setNotice: vi.fn(),
    fail: vi.fn(),
    canEdit: true,
    onClose: vi.fn(),
    setConfirmDelete: vi.fn(),
    writing: { current: false },
    ...overrides,
  };
}

// An edit of the stored row the baseline describes.
function editInput(overrides: Partial<IntentInput> = {}): IntentInput {
  const editing: Allocation = makeAllocation({
    id: 'a9',
    resourceId: 'r1',
    activityId: 't1',
    startDate: '2027-01-04',
    endDate: '2027-01-05',
    hoursPerDay: 4,
  });
  return validInput({ create: undefined, editing, ...overrides });
}

// Intents are fire-and-forget; let every awaited write settle before asserting.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function submit(input: IntentInput) {
  createAllocationIntents(input).submit();
  await settle();
}

function expectFailed(input: IntentInput, field: string | null, message: string) {
  expect(input.fail).toHaveBeenCalledExactlyOnceWith(field, message);
}

function expectNothingWritten(input: IntentInput) {
  expect(input.addAllocation).not.toHaveBeenCalled();
  expect(input.addRepeatedAllocation).not.toHaveBeenCalled();
  expect(input.updateAllocation).not.toHaveBeenCalled();
  expect(input.duplicateAllocation).not.toHaveBeenCalled();
  expect(input.onClose).not.toHaveBeenCalled();
}

const blocks = { isBlocks: true, usesTypedDateRange: false } as const;
const placeholder = makeResource({ kind: 'placeholder', projectId: 'p2' });

beforeEach(() => {
  assignment.withoutCode = false;
});

describe('createAllocationIntents submit', () => {
  it('creates the validated draft and closes the dialog', async () => {
    const input = validInput();
    await submit(input);
    expect(input.addAllocation).toHaveBeenCalledExactlyOnceWith({
      resourceId: 'r1',
      activityId: 't1',
      startDate: '2027-01-04',
      endDate: '2027-01-05',
      hoursPerDay: 4,
      status: 'confirmed',
      task: null,
      ignoreWorkingDays: false,
    });
    expect(input.onClose).toHaveBeenCalledOnce();
    expect(input.fail).not.toHaveBeenCalled();
    expect(input.writing.current).toBe(false);
  });

  it('keeps the dialog open when the create is blocked', async () => {
    const input = validInput({
      addAllocation: vi.fn<IntentInput['addAllocation']>(() =>
        Promise.resolve({ kind: 'blocked' }),
      ),
    });
    await submit(input);
    expect(input.addAllocation).toHaveBeenCalledOnce();
    expect(input.onClose).not.toHaveBeenCalled();
  });

  it('does nothing when the viewer cannot edit', async () => {
    const input = validInput({ canEdit: false, resourceId: '' });
    await submit(input);
    expect(input.fail).not.toHaveBeenCalled();
    expectNothingWritten(input);
  });

  it('ignores a second intent while a write is in flight', async () => {
    const input = validInput({ writing: { current: true } });
    await submit(input);
    expectNothingWritten(input);
    expect(input.writing.current).toBe(true);
  });

  it('reports draft validation problems without writing', async () => {
    const input = validInput({ resourceId: '' });
    await submit(input);
    expectFailed(input, 'resource', m.form_allocation_err_choose_resource());
    expectNothingWritten(input);
  });

  it('refuses a stale edit only when the draft says it is no longer current', async () => {
    const stale = editInput({ isCurrentDraft: () => false });
    await submit(stale);
    expectFailed(stale, null, m.form_allocation_err_changed());
    expectNothingWritten(stale);

    const current = editInput({ isCurrentDraft: () => true });
    await submit(current);
    expect(current.updateAllocation).toHaveBeenCalledOnce();

    const unchecked = editInput();
    await submit(unchecked);
    expect(unchecked.updateAllocation).toHaveBeenCalledOnce();

    // A creation has no stored row to go stale against.
    const creation = validInput({ isCurrentDraft: () => false });
    await submit(creation);
    expect(creation.addAllocation).toHaveBeenCalledOnce();
  });

  it('updates an edit with its hours, attribution and closes', async () => {
    const input = editInput({ attributedProjectId: 'p1' });
    await submit(input);
    expect(input.updateAllocation).toHaveBeenCalledExactlyOnceWith('a9', {
      resourceId: 'r1',
      activityId: 't1',
      startDate: '2027-01-04',
      endDate: '2027-01-05',
      status: 'confirmed',
      task: null,
      projectId: 'p1',
      ignoreWorkingDays: false,
      hoursPerDay: 4,
    });
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it('clears a stored attribution when an edit chooses none', async () => {
    const input = editInput();
    await submit(input);
    const patch = vi.mocked(input.updateAllocation).mock.calls[0]?.[1];
    expect(patch).toBeDefined();
    expect(Object.keys(patch ?? {})).toContain('projectId');
    expect(patch?.projectId).toBeUndefined();
  });

  it('leaves stored hours alone when editing blocks, except for an external resource', async () => {
    const internal = editInput({ ...blocks, effEndDate: '2027-01-05' });
    await submit(internal);
    expect(vi.mocked(internal.updateAllocation).mock.calls[0]?.[1]).not.toHaveProperty(
      'hoursPerDay',
    );

    const external = editInput({ ...blocks, isExternal: true });
    await submit(external);
    expect(vi.mocked(external.updateAllocation).mock.calls[0]?.[1]).toHaveProperty(
      'hoursPerDay',
      4,
    );
  });
});

describe('createAllocationIntents text fields', () => {
  it('trims the task, keeps a cleared task as null and omits an empty note', () => {
    expect(createAllocationIntents(validInput({ task: '  Review  ' })).validatedDraft()).toEqual(
      expect.objectContaining({ task: 'Review' }),
    );
    const draft = createAllocationIntents(validInput()).validatedDraft();
    expect(draft).toHaveProperty('task', null);
    expect(draft).not.toHaveProperty('note');
  });

  it('attributes the project only when one is chosen', () => {
    expect(createAllocationIntents(validInput()).validatedDraft()).not.toHaveProperty('projectId');
    expect(
      createAllocationIntents(validInput({ attributedProjectId: 'p1' })).validatedDraft(),
    ).toHaveProperty('projectId', 'p1');
  });

  it('always ignores weekends for an external resource', () => {
    const external = validInput({ isExternal: true, hoursPerDay: 0, effHoursPerDay: 0 });
    expect(createAllocationIntents(external).validatedDraft()).toHaveProperty(
      'ignoreWorkingDays',
      true,
    );
  });

  it('parses the task as a single-line name', async () => {
    const multiline = validInput({ task: 'Review\nagain' });
    await submit(multiline);
    expectFailed(multiline, 'task', m.validation_text_invalid());
    expectNothingWritten(multiline);

    const tooLong = validInput({ task: 'x'.repeat(MAX_NAME_LENGTH + 1) });
    await submit(tooLong);
    expectFailed(tooLong, 'task', m.validation_text_too_long());
    expectNothingWritten(tooLong);

    const longest = validInput({ task: 'x'.repeat(MAX_NAME_LENGTH) });
    expect(createAllocationIntents(longest).validatedDraft()).not.toBeNull();
  });

  it('accepts a multiline note until the user edits it', async () => {
    expect(
      createAllocationIntents(validInput({ note: 'Bring\nthe deck' })).validatedDraft(),
    ).toEqual(expect.objectContaining({ note: 'Bring\nthe deck' }));

    const edited = validInput({ note: 'Bring\nthe deck', noteEdited: true });
    await submit(edited);
    expectFailed(edited, 'note', m.validation_text_invalid());
    expectNothingWritten(edited);
  });

  it('limits the note to the note length, not the name length', async () => {
    const longNote = validInput({ note: 'x'.repeat(MAX_NAME_LENGTH + 1) });
    expect(createAllocationIntents(longNote).validatedDraft()).not.toBeNull();

    const tooLong = validInput({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) });
    await submit(tooLong);
    expectFailed(tooLong, 'note', m.validation_text_too_long());
    expectNothingWritten(tooLong);
  });
});

describe('createAllocationIntents assignment', () => {
  it('reports a placeholder bound to another project on the activity', async () => {
    const input = validInput({ selectedResource: placeholder });
    await submit(input);
    expectFailed(input, 'activity', resolveDomainErrorMessage('placeholder_project_mismatch'));
    expectNothingWritten(input);
  });

  it('skips the assignment rule until both resource and activity are resolved', () => {
    const noActivity = validInput({ selectedResource: placeholder, selectedActivity: undefined });
    expect(createAllocationIntents(noActivity).validatedDraft()).not.toBeNull();
    expect(noActivity.fail).not.toHaveBeenCalled();
  });

  it('accepts a placeholder bound to the selected project', () => {
    const input = validInput({
      selectedResource: makeResource({ kind: 'placeholder', projectId: 'p1' }),
    });
    expect(createAllocationIntents(input).validatedDraft()).not.toBeNull();
  });

  it('throws when a failed assignment check carries no code', () => {
    assignment.withoutCode = true;
    expect(() => createAllocationIntents(validInput()).validatedDraft()).toThrow(
      'Invalid allocation assignment did not provide an error code.',
    );
  });
});

describe('createAllocationIntents new placement', () => {
  it('rejects a new placement on a resource with no effective working days', async () => {
    const input = validInput({ selectedEffectiveWeek: { kind: 'none' } });
    await submit(input);
    expectFailed(input, 'resource', m.form_allocation_err_no_effective_working_days());
    expectNothingWritten(input);
  });

  it('skips the placement check when the resource or its week is unresolved', async () => {
    const noResource = validInput({
      selectedResource: undefined,
      selectedEffectiveWeek: { kind: 'none' },
    });
    await submit(noResource);
    expect(noResource.addAllocation).toHaveBeenCalledOnce();

    // A Saturday start would be refused if the check ran.
    const noWeek = validInput({
      selectedEffectiveWeek: undefined,
      startDate: '2027-01-09',
      endDate: '2027-01-09',
    });
    await submit(noWeek);
    expect(noWeek.addAllocation).toHaveBeenCalledOnce();
  });

  it('rejects a start on a non-working day', async () => {
    const input = validInput({ startDate: '2027-01-09', endDate: '2027-01-09' });
    await submit(input);
    expectFailed(input, 'startDate', m.form_allocation_err_start_non_working());
    expectNothingWritten(input);
  });

  it('rejects a start on time off or a closure', async () => {
    const timeOff = validInput({
      data: {
        activities: [],
        allocations: [],
        closures: [],
        timeOff: [makeTimeOff({ startDate: '2027-01-04', endDate: '2027-01-04' })],
      },
    });
    await submit(timeOff);
    expectFailed(timeOff, 'startDate', m.form_allocation_err_start_time_off());
    expectNothingWritten(timeOff);

    const closure = validInput({
      data: {
        activities: [],
        allocations: [],
        closures: [makeClosure({ startDate: '2027-01-04', endDate: '2027-01-04' })],
        timeOff: [],
      },
    });
    await submit(closure);
    expectFailed(closure, 'startDate', m.form_allocation_err_start_time_off());
  });

  it('checks an edit only when it moves the allocation to another resource', async () => {
    const sameResource = editInput({ selectedEffectiveWeek: { kind: 'none' } });
    await submit(sameResource);
    expect(sameResource.updateAllocation).toHaveBeenCalledOnce();

    const moved = editInput({
      resourceId: 'r2',
      selectedResource: makeResource({ id: 'r2' }),
      selectedEffectiveWeek: { kind: 'none' },
    });
    await submit(moved);
    expectFailed(moved, 'resource', m.form_allocation_err_no_effective_working_days());
    expectNothingWritten(moved);
  });
});

describe('createAllocationIntents repeats', () => {
  const weekly = { repeat: 'weekly', repeatUntil: '2027-01-25' } as const;

  it('sends the first occurrence and the pattern in one group write and closes', async () => {
    const input = validInput(weekly);
    await submit(input);
    expect(input.addAllocation).not.toHaveBeenCalled();
    expect(input.addRepeatedAllocation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ startDate: '2027-01-04' }),
      { pattern: { kind: 'weeks', interval: 1 }, until: '2027-01-25' },
    );
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it('keeps the dialog open when the group write is blocked', async () => {
    const input = validInput({
      ...weekly,
      addRepeatedAllocation: vi.fn<IntentInput['addRepeatedAllocation']>(() =>
        Promise.resolve({ kind: 'blocked' }),
      ),
    });
    await submit(input);
    expect(input.addRepeatedAllocation).toHaveBeenCalledOnce();
    expect(input.onClose).not.toHaveBeenCalled();
  });

  it('reports a repeat range failure on the repeat cutoff', async () => {
    const input = validInput({
      ...weekly,
      addRepeatedAllocation: vi.fn<IntentInput['addRepeatedAllocation']>(() =>
        Promise.reject(new RangeError('Beyond the calendar.')),
      ),
    });
    await submit(input);
    expectFailed(input, 'repeatUntil', m.form_allocation_err_repeat_date_domain());
    expect(input.onClose).not.toHaveBeenCalled();
  });

  it('reports a range failure without a repeat at form level with its own message', async () => {
    const input = validInput({
      addAllocation: vi.fn<IntentInput['addAllocation']>(() =>
        Promise.reject(new RangeError('Beyond the calendar.')),
      ),
    });
    await submit(input);
    expectFailed(input, null, 'Beyond the calendar.');
  });

  it('reports a non-Error rejection with the generic save message', async () => {
    const input = validInput({
      addAllocation: vi.fn<IntentInput['addAllocation']>(() => Promise.reject('nope' as never)),
    });
    await submit(input);
    expectFailed(input, null, m.form_allocation_err_save_failed());
  });
});

describe('createAllocationIntents duplicate', () => {
  it('requires an allocation being edited', async () => {
    const input = validInput();
    createAllocationIntents(input).onDuplicate();
    await settle();
    expect(input.duplicateAllocation).not.toHaveBeenCalled();
    expect(input.fail).not.toHaveBeenCalled();
  });

  it('duplicates the validated draft and closes only after it is created', async () => {
    const input = editInput();
    createAllocationIntents(input).onDuplicate();
    await settle();
    expect(input.duplicateAllocation).toHaveBeenCalledExactlyOnceWith(
      'a9',
      expect.objectContaining({ resourceId: 'r1', startDate: '2027-01-04' }),
    );
    expect(input.onClose).toHaveBeenCalledOnce();

    const blocked = editInput({
      duplicateAllocation: vi.fn<IntentInput['duplicateAllocation']>(() =>
        Promise.resolve({ kind: 'blocked' }),
      ),
    });
    createAllocationIntents(blocked).onDuplicate();
    await settle();
    expect(blocked.onClose).not.toHaveBeenCalled();
  });

  it('treats a duplicate as a new placement even on the same resource', async () => {
    const input = editInput({ selectedEffectiveWeek: { kind: 'none' } });
    createAllocationIntents(input).onDuplicate();
    await settle();
    expectFailed(input, 'resource', m.form_allocation_err_no_effective_working_days());
    expect(input.duplicateAllocation).not.toHaveBeenCalled();
  });

  it('does not duplicate an invalid draft', async () => {
    const input = editInput({ activityId: '' });
    createAllocationIntents(input).onDuplicate();
    await settle();
    expectFailed(input, 'activity', m.form_allocation_err_choose_activity());
    expect(input.duplicateAllocation).not.toHaveBeenCalled();
  });

  it('reports a failed duplication at form level', async () => {
    const input = editInput({
      duplicateAllocation: vi.fn<IntentInput['duplicateAllocation']>(() =>
        Promise.reject(new Error('Duplicate refused.')),
      ),
    });
    createAllocationIntents(input).onDuplicate();
    await settle();
    expectFailed(input, null, 'Duplicate refused.');

    const opaque = editInput({
      duplicateAllocation: vi.fn<IntentInput['duplicateAllocation']>(() =>
        Promise.reject('nope' as never),
      ),
    });
    createAllocationIntents(opaque).onDuplicate();
    await settle();
    expectFailed(opaque, null, m.form_allocation_err_save_failed());
  });
});

describe('createAllocationIntents delete', () => {
  it('requires an edit the viewer may change', async () => {
    const creation = validInput();
    createAllocationIntents(creation).onDelete();
    const readOnly = editInput({ canEdit: false });
    createAllocationIntents(readOnly).onDelete();
    await settle();
    for (const input of [creation, readOnly]) {
      expect(input.setConfirmDelete).not.toHaveBeenCalled();
      expect(input.deleteAllocation).not.toHaveBeenCalled();
    }
  });

  it('deletes one allocation by default and the rest of the series on request', async () => {
    const one = editInput();
    createAllocationIntents(one).onDelete();
    await settle();
    expect(one.setConfirmDelete).toHaveBeenCalledExactlyOnceWith(false);
    expect(one.deleteAllocation).toHaveBeenCalledExactlyOnceWith('a9');
    expect(one.deleteAllocationSeriesFrom).not.toHaveBeenCalled();

    const future = editInput();
    createAllocationIntents(future).onDelete('future');
    await settle();
    expect(future.deleteAllocationSeriesFrom).toHaveBeenCalledExactlyOnceWith('a9');
    expect(future.deleteAllocation).not.toHaveBeenCalled();
  });

  it('reports a failed deletion at form level', async () => {
    const input = editInput({
      deleteAllocation: vi.fn<IntentInput['deleteAllocation']>(() =>
        Promise.reject(new Error('Delete refused.')),
      ),
    });
    createAllocationIntents(input).onDelete();
    await settle();
    expectFailed(input, null, 'Delete refused.');

    const opaque = editInput({
      deleteAllocation: vi.fn<IntentInput['deleteAllocation']>(() =>
        Promise.reject('nope' as never),
      ),
    });
    createAllocationIntents(opaque).onDelete();
    await settle();
    expectFailed(opaque, null, m.form_allocation_err_delete_failed());
  });
});

describe('createAllocationIntents save advisory', () => {
  const overTwo = { overDays: 2, timeOffDays: 1 };
  const overTwoNotice =
    'Saved. This allocation is over capacity on 2 days and on time off for 1 day.';

  it('shows the reply advisory for a create, an edit and a duplicate after closing', async () => {
    const create = validInput({
      addAllocation: vi.fn<IntentInput['addAllocation']>(() =>
        Promise.resolve({ ...created(makeAllocation()), advisory: overTwo }),
      ),
    });
    await submit(create);
    expect(create.onClose).toHaveBeenCalledOnce();
    expect(create.setNotice).toHaveBeenCalledExactlyOnceWith(overTwoNotice, 'warning');

    const edit = editInput({
      updateAllocation: vi.fn<IntentInput['updateAllocation']>(() =>
        Promise.resolve({ advisory: overTwo }),
      ),
    });
    await submit(edit);
    expect(edit.setNotice).toHaveBeenCalledExactlyOnceWith(overTwoNotice, 'warning');

    const duplicate = editInput({
      duplicateAllocation: vi.fn<IntentInput['duplicateAllocation']>(() =>
        Promise.resolve({ ...created(makeAllocation()), advisory: overTwo }),
      ),
    });
    createAllocationIntents(duplicate).onDuplicate();
    await settle();
    expect(duplicate.onClose).toHaveBeenCalledOnce();
    expect(duplicate.setNotice).toHaveBeenCalledExactlyOnceWith(overTwoNotice, 'warning');
  });

  it('stays silent when the reply has nothing to report', async () => {
    const clear = validInput({
      addAllocation: vi.fn<IntentInput['addAllocation']>(() =>
        Promise.resolve({
          ...created(makeAllocation()),
          advisory: { overDays: 0, timeOffDays: 0 },
        }),
      ),
    });
    await submit(clear);
    expect(clear.onClose).toHaveBeenCalledOnce();
    expect(clear.setNotice).not.toHaveBeenCalled();

    const edit = editInput();
    await submit(edit);
    expect(edit.onClose).toHaveBeenCalledOnce();
    expect(edit.setNotice).not.toHaveBeenCalled();
  });

  it('counts a repeat by allocation from its repeat advisory', async () => {
    const input = validInput({
      repeat: 'weekly',
      repeatUntil: '2027-01-18',
      addRepeatedAllocation: vi.fn<IntentInput['addRepeatedAllocation']>(() =>
        Promise.resolve({
          ...created([makeAllocation()]),
          repeatAdvisory: {
            overCapacityAllocations: 1,
            timeOffAllocations: 2,
            nonEffectiveStartAllocations: 0,
          },
        }),
      ),
    });
    await submit(input);
    expect(input.setNotice).toHaveBeenCalledExactlyOnceWith(
      'Saved. For this repeat, 1 allocation exceeds capacity and 2 allocations overlap time off.',
      'warning',
    );
  });
});
