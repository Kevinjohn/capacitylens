import { m } from "@/i18n";
import { newId } from "@capacitylens/shared/lib/id";
import { validateAllocationAssignment } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_NOTE_LENGTH } from "@capacitylens/shared/lib/strings";
import type { ISODate } from "@capacitylens/shared/types/entities";
import { domainErrorMessage, errorMessage } from "../../lib/errorMessage";
import { projectAllocationDates, repeatPatternForSelection } from "../../lib/repeatingAllocations";
import { validateText } from "../../lib/validation";
import type { useStore } from "../../store/useStore";
import { deriveEndDate, validateAllocationDraft } from "./allocationDraft";
import { creationBlockedForEffectiveWeek } from "./creationAvailability";

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
export function createAllocationCommands(input: CommandInput) {
  const {
    resourceId,
    activityId,
    startDate,
    endDate,
    usesTypedDateRange,
    typedDateSpanTooLong,
    isBlocks,
    isDays,
    isExternal,
    validDaysOver,
    spanFitsDateDomain,
    spanLimitedByDateDomain,
    maximumDaysOver,
    daysOfWork,
    hoursPerDay,
    effHoursPerDay,
    create,
    repeat,
    repeatUntil,
    repeatToday,
    repeatUntilMaximum,
    note,
    noteEdited,
    selectedResource,
    selectedActivity,
    selectedEffectiveProjectId,
    editing,
    ignoreWeekends,
    daysOver,
    initialDaysOver,
    effEndDate,
    status,
    attributedProjectId,
    selectedEffectiveWeek,
    data,
    mode,
    addAllocation,
    addAllocations,
    updateAllocation,
    deleteAllocation,
    deleteAllocationSeriesFrom,
    fail,
    canEdit,
    onClose,
    setConfirmDelete,
  } = input;
  // Save and Duplicate operate on the same visible draft. Keeping validation and effective-value
  // derivation here prevents Duplicate from silently discarding edits or persisting a shape that
  // Save would reject (for example, a historical zero-hour block viewed in Hours mode). The rules
  // themselves live in allocationDraft.ts; this routes the first problem to the offending field and
  // adds the two checks that need the modal's own machinery (the note sanitiser owns `fail`, and the
  // assignment check needs the activity list).
  const validatedDraft = () => {
    const problem = validateAllocationDraft({
      resourceId,
      activityId,
      startDate,
      endDate,
      usesTypedDateRange,
      typedDateSpanTooLong,
      isBlocks,
      isDays,
      isExternal,
      validDaysOver,
      spanFitsDateDomain,
      spanLimitedByDateDomain,
      maximumDaysOver,
      daysOfWork,
      hoursPerDay,
      effHoursPerDay,
      repeat:
        create && repeat !== "none"
          ? { selection: repeat, until: repeatUntil, today: repeatToday, maximum: repeatUntilMaximum }
          : null,
    });
    if (problem) {
      fail(problem.field, problem.message);
      return null;
    }
    const cleanNote = validateText(note, fail, {
      field: "note",
      required: false,
      multiline: !noteEdited,
      maxLength: MAX_NOTE_LENGTH,
    });
    if (cleanNote === null) return null;
    if (selectedResource && selectedActivity) {
      const check = validateAllocationAssignment(selectedResource, selectedEffectiveProjectId);
      if (!check.ok) {
        fail("activity", domainErrorMessage(check.codes[0]));
        return null;
      }
    }
    return {
      resourceId,
      activityId,
      startDate,
      endDate: deriveEndDate({
        editing,
        isBlocks,
        isDays,
        resourceId,
        startDate,
        ignoreWeekends,
        daysOver,
        initialDaysOver,
        effectiveEndDate: effEndDate,
      }),
      hoursPerDay: effHoursPerDay,
      status,
      note: cleanNote || undefined,
      ...(attributedProjectId ? { projectId: attributedProjectId } : {}),
      // Externals have no working week — weekends are plain calendar days for them, so a span is
      // literal (ignoreWeekends: true) and the toggle is hidden below.
      ignoreWeekends: isExternal ? true : ignoreWeekends,
    };
  };

  /** The calendar gates for NEW placement only: create, duplicate, or an assignee-changing edit.
   *  A normal edit on the original assignee remains valid after calendar settings change (its
   *  stale start stays editable). Routed through the grid's own start gate so a typed date obeys
   *  exactly the rules a click or draw does: no effective week means no new work at all, a start
   *  must land on a company and personal working day, and never on time off — with NO exemption
   *  for Ignore working days (there is no ignored-creation escape hatch; the override affects
   *  spans and moves of saved allocations only). Repeat OCCURRENCES are the deliberate exception
   *  (advisory-counted instead, decision 9). */
  const rejectNewPlacementCalendarConflicts = (draft: ReturnType<typeof validatedDraft>, newPlacement: boolean) => {
    if (!draft || !newPlacement || !selectedResource || !selectedEffectiveWeek) return false;
    if (selectedEffectiveWeek.kind !== "days") {
      fail("resource", m.form_allocation_err_no_effective_working_days());
      return true;
    }
    const blocked = creationBlockedForEffectiveWeek(
      selectedResource,
      draft.startDate,
      data.timeOff,
      selectedEffectiveWeek,
      data.closures,
    );
    if (blocked === "non-working") {
      fail("startDate", m.form_allocation_err_start_non_working());
      return true;
    }
    if (blocked === "time-off") {
      fail("startDate", m.form_allocation_err_start_time_off());
      return true;
    }
    return false;
  };

  const submit = () => {
    if (!canEdit) return;
    const draft = validatedDraft();
    if (!draft) return;
    if (rejectNewPlacementCalendarConflicts(draft, !editing || editing.resourceId !== draft.resourceId)) return;
    try {
      if (editing) {
        // Blocks-mode edits deliberately omit hoursPerDay so the store preserves the allocation's
        // historical hourly load; zero load is persisted for a new or duplicated block. Reassigning
        // to an external still writes 0 because that invariant takes precedence over preservation.
        const { hoursPerDay: draftHoursPerDay, ...fields } = draft;
        updateAllocation(editing.id, {
          ...fields,
          // The store treats an own `undefined` value as a request to delete the persisted key.
          projectId: draft.projectId,
          ...(!isBlocks || isExternal ? { hoursPerDay: draftHoursPerDay } : {}),
        });
      } else if (repeat === "none") {
        addAllocation(draft);
      } else {
        if (!selectedResource || !selectedEffectiveWeek) {
          throw new Error("The selected resource could not be resolved for repeat projection.");
        }
        const { startDates } = generateRepeatingStartDates(
          draft.startDate,
          repeatUntil as ISODate,
          repeatPatternForSelection(repeat),
        );
        const drafts = projectAllocationDates(draft, startDates, {
          schedulingMode: mode,
          daysOver,
          resource: selectedResource,
          effectiveWeek: selectedEffectiveWeek,
        });
        const seriesId = newId();
        addAllocations(drafts.map((occurrence) => ({ ...occurrence, seriesId })));
      }
      onClose();
    } catch (e) {
      if (repeat !== "none" && e instanceof RangeError) {
        fail("repeatUntil", m.form_allocation_err_repeat_date_domain());
      } else {
        fail(null, e instanceof Error ? errorMessage(e) : m.form_allocation_err_save_failed());
      }
    }
  };

  const onDuplicate = () => {
    if (!editing) return;
    const draft = validatedDraft();
    if (!draft) return;
    if (rejectNewPlacementCalendarConflicts(draft, true)) return;
    try {
      addAllocation(draft);
      onClose();
    } catch (e) {
      fail(null, e instanceof Error ? errorMessage(e) : m.form_allocation_err_save_failed());
    }
  };

  const onDelete = (scope: "one" | "future" = "one") => {
    if (!editing || !canEdit) return;
    setConfirmDelete(false);
    try {
      if (scope === "future") deleteAllocationSeriesFrom(editing.id);
      else deleteAllocation(editing.id);
    } catch (e) {
      fail(null, e instanceof Error ? errorMessage(e) : m.form_allocation_err_delete_failed());
    }
  };

  return { validatedDraft, submit, onDuplicate, onDelete };
}
