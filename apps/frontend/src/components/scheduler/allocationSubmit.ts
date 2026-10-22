import { m } from "@/i18n";
import { validateAllocationAssignment } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@capacitylens/shared/lib/strings";
import { resolveDomainErrorMessage, resolveErrorMessage } from "@/lib/errorMessage";
import { buildRepeatedAllocationDrafts, resolveRepeatPattern } from "@/lib/repeatingAllocations";
import { parseText } from "@/lib/validation";
import type { useStore } from "@/store/useStore";
import { resolveEndDate, validateAllocationDraft } from "./allocationDraft";
import { resolveEffectiveWeekCreationBlockReason } from "./creationAvailability";

import type { FieldError } from "@/hooks/useFieldError";
import type { AllocationModalSnapshot } from "./AllocationModalSnapshot";
type CommandInput = Omit<AllocationModalSnapshot, "editId" | "repeatUntilMinimum"> &
  Pick<
    ReturnType<typeof useStore.getState>,
    | "addAllocation"
    | "addAllocations"
    | "duplicateAllocation"
    | "updateAllocation"
    | "deleteAllocation"
    | "deleteAllocationSeriesFrom"
  > & {
    fail: FieldError["fail"];
    canEdit: boolean;
    onClose: () => void;
    setConfirmDelete: (value: boolean) => void;
    /** True while this dialog's typed write is in flight; a second submit is ignored. */
    writing: { current: boolean };
  };
type ValidatedDraft = Parameters<CommandInput["addAllocation"]>[0];

interface RejectNewPlacementInput {
  command: CommandInput;
  draft: ValidatedDraft;
  newPlacement: boolean;
}

function resolveAssignmentError(input: CommandInput): string | null {
  if (!input.selectedResource || !input.selectedActivity) return null;
  const check = validateAllocationAssignment(input.selectedResource, input.selectedEffectiveProjectId);
  if (check.ok) return null;
  const firstCode = check.codes[0];
  if (!firstCode) throw new Error("Invalid allocation assignment did not provide an error code.");
  return resolveDomainErrorMessage(firstCode);
}

function resolveDraftEndDate(input: CommandInput) {
  return resolveEndDate({
    editing: input.editing,
    isBlocks: input.isBlocks,
    isDays: input.isDays,
    resourceId: input.resourceId,
    startDate: input.startDate,
    ignoreWeekends: input.ignoreWeekends,
    daysOver: input.daysOver,
    initialDaysOver: input.initialDaysOver,
    effectiveEndDate: input.effEndDate,
  });
}

function parseOptionalTask(input: CommandInput): string | undefined | null {
  const task = parseText(input.task, input.fail, {
    field: "task",
    required: false,
    multiline: false,
    maxLength: MAX_NAME_LENGTH,
  });
  if (task === null) return null;
  return task === "" ? undefined : task;
}

function parseAllocationCommandDraft(input: CommandInput): ValidatedDraft | null {
  const repeat =
    input.create && input.repeat !== "none"
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
    field: "note",
    required: false,
    multiline: !input.noteEdited,
    maxLength: MAX_NOTE_LENGTH,
  });
  if (cleanNote === null) return null;
  const cleanTask = parseOptionalTask(input);
  if (cleanTask === null) return null;
  const assignmentError = resolveAssignmentError(input);
  if (assignmentError) {
    input.fail("activity", assignmentError);
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
    ignoreWeekends: input.isExternal ? true : input.ignoreWeekends,
  };
}

function rejectsNewPlacement({ command, draft, newPlacement }: RejectNewPlacementInput): boolean {
  if (!newPlacement || !command.selectedResource || command.selectedEffectiveWeek === undefined) return false;
  if (command.selectedEffectiveWeek.kind !== "days") {
    command.fail("resource", m.form_allocation_err_no_effective_working_days());
    return true;
  }
  const blocked = resolveEffectiveWeekCreationBlockReason({
    resource: command.selectedResource,
    date: draft.startDate,
    timeOff: command.data.timeOff,
    effectiveWeek: command.selectedEffectiveWeek,
    closures: command.data.closures,
  });
  if (blocked === "non-working") command.fail("startDate", m.form_allocation_err_start_non_working());
  if (blocked === "time-off") command.fail("startDate", m.form_allocation_err_start_time_off());
  return blocked !== null;
}

async function saveDraft(input: CommandInput, draft: ValidatedDraft): Promise<boolean> {
  if (input.editing) {
    const { hoursPerDay, ...fields } = draft;
    await input.updateAllocation(input.editing.id, {
      ...fields,
      projectId: draft.projectId,
      ...(!input.isBlocks || input.isExternal ? { hoursPerDay } : {}),
    });
    return true;
  }
  if (input.repeat === "none") {
    return (await input.addAllocation(draft)).kind === "created";
  }
  if (!input.selectedResource || input.selectedEffectiveWeek === undefined) {
    throw new Error("The selected resource could not be resolved for repeat projection.");
  }
  const { startDates } = generateRepeatingStartDates(
    draft.startDate,
    input.repeatUntil,
    resolveRepeatPattern(input.repeat),
  );
  const drafts = buildRepeatedAllocationDrafts(draft, startDates, {
    schedulingMode: input.mode,
    daysOver: input.daysOver,
    resource: input.selectedResource,
    effectiveWeek: input.selectedEffectiveWeek,
  });
  // One typed group write creates the repeated set; the server assigns its series id.
  return (await input.addAllocations(drafts)).kind === "created";
}

function reportSaveError(input: CommandInput, error: unknown): void {
  if (input.repeat !== "none" && error instanceof RangeError) {
    input.fail("repeatUntil", m.form_allocation_err_repeat_date_domain());
    return;
  }
  input.fail(null, error instanceof Error ? resolveErrorMessage(error) : m.form_allocation_err_save_failed());
}

/** Builds validated create and update commands for the allocation dialog. */
export function createAllocationCommands(input: CommandInput) {
  const validateDraft = () => parseAllocationCommandDraft(input);
  const submit = async () => {
    if (!input.canEdit) return;
    const draft = validateDraft();
    if (
      !draft ||
      rejectsNewPlacement({
        command: input,
        draft,
        newPlacement: !input.editing || input.editing.resourceId !== draft.resourceId,
      })
    )
      return;
    try {
      if (await saveDraft(input, draft)) input.onClose();
    } catch (e) {
      // Route save rejection through the dialog error policy so invalid allocations remain editable.
      reportSaveError(input, e);
    }
  };
  const duplicateAllocation = async () => {
    if (!input.editing) return;
    const draft = validateDraft();
    if (!draft || rejectsNewPlacement({ command: input, draft, newPlacement: true })) return;
    try {
      if ((await input.duplicateAllocation(input.editing.id, draft)).kind === "created") input.onClose();
    } catch (e) {
      // Surface a failed duplication at form level without closing the dialog.
      input.fail(null, e instanceof Error ? resolveErrorMessage(e) : m.form_allocation_err_save_failed());
    }
  };
  const deleteSelectedAllocation = async (scope: "one" | "future" = "one") => {
    if (!input.editing || !input.canEdit) return;
    input.setConfirmDelete(false);
    try {
      if (scope === "future") await input.deleteAllocationSeriesFrom(input.editing.id);
      else await input.deleteAllocation(input.editing.id);
    } catch (e) {
      // Surface a failed deletion at form level without closing the dialog.
      input.fail(null, e instanceof Error ? resolveErrorMessage(e) : m.form_allocation_err_delete_failed());
    }
  };
  // Each command awaits its typed write and reports every failure in the dialog, so none escapes.
  // One write runs at a time: a repeated submit before the dialog closes must not save twice.
  const exclusive = async (command: () => Promise<void>) => {
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
    submit: () => void exclusive(submit),
    onDuplicate: () => void exclusive(duplicateAllocation),
    onDelete: (scope?: "one" | "future") => void exclusive(() => deleteSelectedAllocation(scope)),
  };
}
