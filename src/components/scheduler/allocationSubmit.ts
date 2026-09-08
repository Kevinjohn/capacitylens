import { m } from "@/i18n";
import { newId } from "@capacitylens/shared/lib/id";
import { validateAllocationAssignment } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_NOTE_LENGTH } from "@capacitylens/shared/lib/strings";
import { resolveDomainErrorMessage, resolveErrorMessage } from "../../lib/errorMessage";
import { buildRepeatedAllocationDrafts, resolveRepeatPattern } from "../../lib/repeatingAllocations";
import { validateText } from "../../lib/validation";
import type { useStore } from "../../store/useStore";
import { resolveEndDate, validateAllocationDraft } from "./allocationDraft";
import { resolveEffectiveWeekCreationBlockReason } from "./creationAvailability";

import type { FieldError } from "../../hooks/useFieldError";
import type { AllocationModalSnapshot } from "./allocationModalSnapshot";
type CommandInput = Omit<AllocationModalSnapshot, "editId" | "repeatUntilMinimum"> &
  Pick<
    ReturnType<typeof useStore.getState>,
    "addAllocation" | "addAllocations" | "updateAllocation" | "deleteAllocation" | "deleteAllocationSeriesFrom"
  > & {
    fail: FieldError["fail"];
    canEdit: boolean;
    onClose: () => void;
    setConfirmDelete: (value: boolean) => void;
  };
type ValidatedDraft = Parameters<CommandInput["addAllocation"]>[0];

function validateAssignment(input: CommandInput): boolean {
  if (!input.selectedResource || !input.selectedActivity) return true;
  const check = validateAllocationAssignment(input.selectedResource, input.selectedEffectiveProjectId);
  if (check.ok) return true;
  const firstCode = check.codes[0];
  if (!firstCode) throw new Error("Invalid allocation assignment did not provide an error code.");
  input.fail("activity", resolveDomainErrorMessage(firstCode));
  return false;
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

function validateCommandDraft(input: CommandInput): ValidatedDraft | null {
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
  const cleanNote = validateText(input.note, input.fail, {
    field: "note",
    required: false,
    multiline: !input.noteEdited,
    maxLength: MAX_NOTE_LENGTH,
  });
  if (cleanNote === null || !validateAssignment(input)) return null;
  return {
    resourceId: input.resourceId,
    activityId: input.activityId,
    startDate: input.startDate,
    endDate: resolveDraftEndDate(input),
    hoursPerDay: input.effHoursPerDay,
    status: input.status,
    ...(cleanNote ? { note: cleanNote } : {}),
    ...(input.attributedProjectId ? { projectId: input.attributedProjectId } : {}),
    ignoreWeekends: input.isExternal ? true : input.ignoreWeekends,
  };
}

function rejectsNewPlacement(input: CommandInput, draft: ValidatedDraft, newPlacement: boolean): boolean {
  if (!newPlacement || !input.selectedResource || input.selectedEffectiveWeek === undefined) return false;
  if (input.selectedEffectiveWeek.kind !== "days") {
    input.fail("resource", m.form_allocation_err_no_effective_working_days());
    return true;
  }
  const blocked = resolveEffectiveWeekCreationBlockReason({
    resource: input.selectedResource,
    date: draft.startDate,
    timeOff: input.data.timeOff,
    effectiveWeek: input.selectedEffectiveWeek,
    closures: input.data.closures,
  });
  if (blocked === "non-working") input.fail("startDate", m.form_allocation_err_start_non_working());
  if (blocked === "time-off") input.fail("startDate", m.form_allocation_err_start_time_off());
  return blocked !== null;
}

function saveDraft(input: CommandInput, draft: ValidatedDraft): void {
  if (input.editing) {
    const { hoursPerDay, ...fields } = draft;
    input.updateAllocation(input.editing.id, {
      ...fields,
      projectId: draft.projectId,
      ...(!input.isBlocks || input.isExternal ? { hoursPerDay } : {}),
    });
    return;
  }
  if (input.repeat === "none") {
    input.addAllocation(draft);
    return;
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
  const seriesId = newId();
  input.addAllocations(drafts.map((occurrence) => ({ ...occurrence, seriesId })));
}

function reportSaveError(input: CommandInput, error: unknown): void {
  if (input.repeat !== "none" && error instanceof RangeError) {
    input.fail("repeatUntil", m.form_allocation_err_repeat_date_domain());
    return;
  }
  input.fail(null, error instanceof Error ? resolveErrorMessage(error) : m.form_allocation_err_save_failed());
}

export function createAllocationCommands(input: CommandInput) {
  const validateDraft = () => validateCommandDraft(input);
  const submit = () => {
    if (!input.canEdit) return;
    const draft = validateDraft();
    if (!draft || rejectsNewPlacement(input, draft, !input.editing || input.editing.resourceId !== draft.resourceId))
      return;
    try {
      saveDraft(input, draft);
      input.onClose();
    } catch (e) {
      reportSaveError(input, e);
    }
  };
  const duplicateAllocation = () => {
    if (!input.editing) return;
    const draft = validateDraft();
    if (!draft || rejectsNewPlacement(input, draft, true)) return;
    try {
      input.addAllocation(draft);
      input.onClose();
    } catch (e) {
      input.fail(null, e instanceof Error ? resolveErrorMessage(e) : m.form_allocation_err_save_failed());
    }
  };
  const deleteSelectedAllocation = (scope: "one" | "future" = "one") => {
    if (!input.editing || !input.canEdit) return;
    input.setConfirmDelete(false);
    try {
      if (scope === "future") input.deleteAllocationSeriesFrom(input.editing.id);
      else input.deleteAllocation(input.editing.id);
    } catch (e) {
      input.fail(null, e instanceof Error ? resolveErrorMessage(e) : m.form_allocation_err_delete_failed());
    }
  };
  return {
    validatedDraft: validateDraft,
    submit,
    onDuplicate: duplicateAllocation,
    onDelete: deleteSelectedAllocation,
  };
}
