import { m } from '@/i18n';
import { validateAllocationAssignment } from '@capacitylens/shared/lib/integrity';
import { generateRepeatingStartDates } from '@capacitylens/shared/lib/repeatingDates';
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings';
import { resolveDomainErrorMessage, resolveErrorMessage } from '@/lib/errorMessage';
import { resolveRepeatPattern } from '@/lib/repeatingAllocations';
import { parseText } from '@/lib/validation';
import type { useStore } from '@/store/useStore';
import { resolveEndDate, validateAllocationDraft } from './allocationDraft';
import { resolveEffectiveWeekPlacementBlockReason } from './creationAvailability';
import { listRenderableDateRanges } from '@/lib/renderableDateRanges';
import { formatCapacityAdvisory } from '@/lib/capacity/advisoryCopy';
import type { AllocationSaveAdvisory } from '@/store/StoreEntityActions';

import type { FieldError } from '@/hooks/useFieldError';
import type { AllocationModalSnapshot } from './AllocationModalSnapshot';
type CommandInput = Omit<AllocationModalSnapshot, 'editId' | 'repeatUntilMinimum'> &
  Pick<
    ReturnType<typeof useStore.getState>,
    | 'addAllocation'
    | 'addRepeatedAllocation'
    | 'duplicateAllocation'
    | 'updateAllocation'
    | 'deleteAllocation'
    | 'deleteAllocationSeriesFrom'
    | 'setNotice'
  > & {
    fail: FieldError['fail'];
    canEdit: boolean;
    isCurrentDraft?: () => boolean;
    onClose: () => void;
    setConfirmDelete: (value: boolean) => void;
    /** True while this dialog's typed write is in flight; a second submit is ignored. */
    writing: { current: boolean };
  };
type ValidatedDraft = Parameters<CommandInput['addAllocation']>[0];

interface RejectNewPlacementInput {
  command: CommandInput;
  draft: ValidatedDraft;
  operation: 'save' | 'duplicate';
}

function resolveAssignmentError(input: CommandInput): string | null {
  if (!input.selectedResource || !input.selectedActivity) return null;
  const check = validateAllocationAssignment(
    input.selectedResource,
    input.selectedEffectiveProjectId,
  );
  if (check.ok) return null;
  const firstCode = check.codes[0];
  if (!firstCode) throw new Error('Invalid allocation assignment did not provide an error code.');
  return resolveDomainErrorMessage(firstCode);
}

function resolveDraftEndDate(input: CommandInput) {
  return resolveEndDate({
    editing: input.editing,
    isBlocks: input.isBlocks,
    isDays: input.isDays,
    resourceId: input.resourceId,
    startDate: input.startDate,
    ignoreWorkingDays: input.ignoreWorkingDays,
    daysOver: input.daysOver,
    initialDaysOver: input.initialDaysOver,
    effectiveEndDate: input.effEndDate,
  });
}

function parseOptionalTask(input: CommandInput): string | undefined | null {
  const task = parseText(input.task, input.fail, {
    field: 'task',
    required: false,
    multiline: false,
    maxLength: MAX_NAME_LENGTH,
  });
  if (task === null) return null;
  return task === '' ? undefined : task;
}

function parseAllocationCommandDraft(input: CommandInput): ValidatedDraft | null {
  const repeat =
    input.create && input.repeat !== 'none'
      ? {
          selection: input.repeat,
          until: input.repeatUntil,
          today: input.repeatToday,
          maximum: input.repeatUntilMaximum,
        }
      : null;
  const valid = validateAllocationDraft(
    {
      resourceId: input.resourceId,
      activityId: input.activityId,
      startDate: input.startDate,
      endDate: input.endDate,
      usesTypedDateRange: input.usesTypedDateRange,
      typedDateSpanTooLong: input.typedDateSpanTooLong,
      isBlocks: input.isBlocks,
      isDays: input.isDays,
      isExternal: input.isExternal,
      validDaysOver: input.validDaysOver,
      spanFitsDateDomain: input.spanFitsDateDomain,
      spanLimitedByDateDomain: input.spanLimitedByDateDomain,
      maximumDaysOver: input.maximumDaysOver,
      daysOfWork: input.daysOfWork,
      hoursPerDay: input.hoursPerDay,
      effHoursPerDay: input.effHoursPerDay,
      repeat,
    },
    input.fail,
  );
  if (!valid) return null;
  const cleanNote = parseText(input.note, input.fail, {
    field: 'note',
    required: false,
    multiline: !input.noteEdited,
    maxLength: MAX_NOTE_LENGTH,
  });
  if (cleanNote === null) return null;
  const cleanTask = parseOptionalTask(input);
  if (cleanTask === null) return null;
  const assignmentError = resolveAssignmentError(input);
  if (assignmentError) {
    input.fail('activity', assignmentError);
    return null;
  }
  return {
    resourceId: input.resourceId,
    activityId: input.activityId,
    startDate: input.startDate,
    endDate: resolveDraftEndDate(input),
    hoursPerDay: input.effHoursPerDay,
    status: input.status,
    ...(cleanNote ? { note: cleanNote } : {}),
    // Include the field even when empty so editing can intentionally clear an existing task.
    task: cleanTask ?? null,
    ...(input.attributedProjectId ? { projectId: input.attributedProjectId } : {}),
    ignoreWorkingDays: input.isExternal ? true : input.ignoreWorkingDays,
  };
}

function isNewPlacementRejected({ command, draft, operation }: RejectNewPlacementInput): boolean {
  const editing = operation === 'save' ? command.editing : null;
  if (
    editing?.resourceId === draft.resourceId ||
    !command.selectedResource ||
    command.selectedEffectiveWeek === undefined
  ) {
    return false;
  }
  const ignoreWorkingDays = Boolean(editing && draft.ignoreWorkingDays);
  if (!ignoreWorkingDays && command.selectedEffectiveWeek.kind !== 'days') {
    command.fail('resource', m.form_allocation_err_no_effective_working_days());
    return true;
  }
  const blocked = resolveEffectiveWeekPlacementBlockReason({
    resource: command.selectedResource,
    date: draft.startDate,
    timeOff: listRenderableDateRanges(command.data.timeOff),
    effectiveWeek: command.selectedEffectiveWeek,
    ignoreWorkingDays,
    closures: listRenderableDateRanges(command.data.closures),
  });
  if (blocked === 'non-working') {
    command.fail('startDate', m.form_allocation_err_start_non_working());
  }
  if (blocked === 'time-off') command.fail('startDate', m.form_allocation_err_start_time_off());
  return blocked !== null;
}

/** Saves the draft; resolves with the reply's capacity advisory, or null when nothing was created. */
async function saveDraft(
  input: CommandInput,
  draft: ValidatedDraft,
): Promise<AllocationSaveAdvisory | null> {
  if (input.editing) {
    const { hoursPerDay, ...fields } = draft;
    const saved = await input.updateAllocation(input.editing.id, {
      ...fields,
      projectId: draft.projectId,
      ...(!input.isBlocks || input.isExternal ? { hoursPerDay } : {}),
    });
    return saved || {};
  }
  if (input.repeat === 'none') {
    const result = await input.addAllocation(draft);
    return result.kind === 'created' ? result : null;
  }
  const repeat = { pattern: resolveRepeatPattern(input.repeat), until: input.repeatUntil };
  // The count tells the store how many ids to mint; the server places each occurrence.
  const { startDates } = generateRepeatingStartDates(draft.startDate, repeat.until, repeat.pattern);
  // One typed group write creates the repeated set; the server assigns its series id.
  const result = await input.addRepeatedAllocation(draft, repeat, startDates.length);
  return result.kind === 'created' ? result : null;
}

/** Shows the server's capacity advisory for a saved allocation once the dialog has closed. */
function showSaveAdvisory(input: CommandInput, saved: AllocationSaveAdvisory): void {
  const { advisory, repeatAdvisory } = saved;
  const message = repeatAdvisory
    ? formatCapacityAdvisory(
        {
          overDays: repeatAdvisory.overCapacityAllocations,
          timeOffDays: repeatAdvisory.timeOffAllocations,
          nonEffectiveStartAllocations: repeatAdvisory.nonEffectiveStartAllocations,
        },
        'repeat',
      )
    : advisory
      ? formatCapacityAdvisory(advisory, 'form')
      : '';
  if (message) input.setNotice(message, 'warning');
}

// Shows a failed write at form level, keeping the dialog open for another attempt.
function reportFailure(input: CommandInput, error: unknown, fallback: string): void {
  input.fail(null, error instanceof Error ? resolveErrorMessage(error) : fallback);
}

function reportSaveError(input: CommandInput, error: unknown): void {
  if (input.repeat !== 'none' && error instanceof RangeError) {
    input.fail('repeatUntil', m.form_allocation_err_repeat_date_domain());
    return;
  }
  reportFailure(input, error, m.form_allocation_err_save_failed());
}

/** Builds validated create and update commands for the allocation dialog. */
export function createAllocationCommands(input: CommandInput) {
  const validateDraft = () => parseAllocationCommandDraft(input);
  const submit = async () => {
    if (!input.canEdit) return;
    if (input.editing && input.isCurrentDraft && !input.isCurrentDraft()) {
      input.fail(null, m.form_allocation_err_changed());
      return;
    }
    const draft = validateDraft();
    if (!draft || isNewPlacementRejected({ command: input, draft, operation: 'save' })) return;
    try {
      const saved = await saveDraft(input, draft);
      if (!saved) return;
      input.onClose();
      showSaveAdvisory(input, saved);
    } catch (e) {
      // Route save rejection through the dialog error policy so invalid allocations remain editable.
      reportSaveError(input, e);
    }
  };
  const duplicateAllocation = async () => {
    if (!input.editing) return;
    const draft = validateDraft();
    if (!draft || isNewPlacementRejected({ command: input, draft, operation: 'duplicate' })) return;
    try {
      const result = await input.duplicateAllocation(input.editing.id, draft);
      if (result.kind !== 'created') return;
      input.onClose();
      showSaveAdvisory(input, result);
    } catch (e) {
      reportFailure(input, e, m.form_allocation_err_save_failed());
    }
  };
  const deleteSelectedAllocation = async (scope: 'one' | 'future' = 'one') => {
    if (!input.editing || !input.canEdit) return;
    input.setConfirmDelete(false);
    try {
      if (scope === 'future') await input.deleteAllocationSeriesFrom(input.editing.id);
      else await input.deleteAllocation(input.editing.id);
    } catch (e) {
      reportFailure(input, e, m.form_allocation_err_delete_failed());
    }
  };
  // Each command awaits its typed write and reports every failure in the dialog, so none escapes.
  // One write runs at a time: a repeated submit before the dialog closes must not save twice.
  const runExclusive = async (command: () => Promise<void>) => {
    if (input.writing.current) return;
    input.writing.current = true;
    try {
      await command();
    } finally {
      input.writing.current = false;
    }
  };
  return {
    validatedDraft: validateDraft,
    submit: () => void runExclusive(submit),
    onDuplicate: () => void runExclusive(duplicateAllocation),
    onDelete: (scope?: 'one' | 'future') =>
      void runExclusive(() => deleteSelectedAllocation(scope)),
  };
}
