import { m } from "@/i18n";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { parseDate } from "@capacitylens/shared/lib/dateMath";
import { carriesHourlyLoad } from "@capacitylens/shared/types/entities";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useCanEdit } from "../../auth/permissionContext";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { resourceDisplayName } from "../../lib/metadata";
import {
  externalEnabledFor,
  inlineActivityCreateEnabledFor,
  placeholdersEnabledFor,
  schedulingModeFor,
  timeZoneFor,
} from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { advisoryFor } from "./allocationAdvisory";
import { allocationModalSeed } from "./allocationModalSeed";
import type { AllocationModalProps } from "./allocationModalTypes";
import { projectRepeat } from "./allocationRepeatProjection";
import { createAllocationCommands } from "./allocationSubmit";
import { useAllocationScheduleState } from "./useAllocationScheduleState";
import { useAllocationTargetState } from "./useAllocationTargetState";
export function useAllocationModalState(props: AllocationModalProps) {
  const { onClose } = props;
  const canEdit = useCanEdit();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useActiveScopedData();
  const addAllocation = useStore((s) => s.addAllocation);
  const addAllocations = useStore((s) => s.addAllocations);
  const updateAllocation = useStore((s) => s.updateAllocation);
  const deleteAllocation = useStore((s) => s.deleteAllocation);
  const deleteAllocationSeriesFrom = useStore((s) => s.deleteAllocationSeriesFrom);
  const addActivity = useStore((s) => s.addActivity);
  const mode = useStore((s) => schedulingModeFor(s.data, s.activeAccountId));
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  // Not accountWorkingDaysFor: the modal's scoped data blanks `accounts`, so it subscribes to the
  // account row itself and runs the selector's one repair seam directly.
  const accountWorkingDays = useMemo(
    () => normalizeAccountWorkingDays(activeAccount?.workingDays, activeAccount?.weekStartsOn ?? 1),
    [activeAccount],
  );
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId));
  const externalEnabled = useStore((s) => externalEnabledFor(s.data, s.activeAccountId));
  const inlineActivityCreateEnabled = useStore((s) => inlineActivityCreateEnabledFor(s.data, s.activeAccountId));
  const calendarTimeZone = useStore((s) => timeZoneFor(s.data, s.activeAccountId));
  const isDays = mode === "days";
  const isBlocks = !carriesHourlyLoad(mode);

  const editId = "allocationId" in props ? props.allocationId : undefined;
  const create = "create" in props ? props.create : undefined;
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined;

  const resourceById = useMemo(() => new Map(data.resources.map((r) => [r.id, r])), [data.resources]);
  const seed = allocationModalSeed({ editing, create, data, mode, resourceById, accountWorkingDays, calendarTimeZone });
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  // Register focus before the schedule hook registers its repeat-adjustment effect.
  useFieldErrorFocus(fieldError);

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose();
  }, [editId, editing, onClose]);

  const target = useAllocationTargetState({
    data,
    seed,
    resourceById,
    canEdit,
    placeholdersEnabled,
    externalEnabled,
    inlineActivityCreateEnabled,
    ...fieldError,
    addActivity,
  });
  const { selectedResource, selectedActivity, attributedProjectId, selectedEffectiveProjectId } = target;
  const { resourceId, activityId } = target.fields;
  const schedule = useAllocationScheduleState({ selectedResource, mode, accountWorkingDays, calendarTimeZone, seed });
  const { selectedEffectiveWeek, effEndDate, validDaysOver, spanFitsDateDomain } = schedule;
  const {
    daysOfWork,
    daysOver,
    effHoursPerDay,
    ignoreWeekends,
    isExternal,
    note,
    repeat,
    repeatUntil,
    repeatUntilMaximum,
    repeatUntilMinimum,
    startDate,
    status,
  } = schedule.fields;
  const repeatProjection = useMemo(
    () =>
      projectRepeat({
        activityId,
        create,
        attributedProjectId,
        daysOfWork,
        daysOver,
        effEndDate,
        effHoursPerDay,
        ignoreWeekends,
        isBlocks,
        isDays,
        isExternal,
        mode,
        note,
        repeat,
        repeatUntil,
        repeatUntilMaximum,
        repeatUntilMinimum,
        resourceId,
        selectedActivity,
        selectedEffectiveProjectId,
        selectedResource,
        selectedEffectiveWeek,
        spanFitsDateDomain,
        startDate,
        status,
        validDaysOver,
      }),
    [
      activityId,
      create,
      attributedProjectId,
      daysOfWork,
      daysOver,
      effEndDate,
      effHoursPerDay,
      ignoreWeekends,
      isBlocks,
      isDays,
      isExternal,
      mode,
      note,
      repeat,
      repeatUntil,
      repeatUntilMaximum,
      repeatUntilMinimum,
      resourceId,
      selectedActivity,
      selectedEffectiveProjectId,
      selectedResource,
      selectedEffectiveWeek,
      spanFitsDateDomain,
      startDate,
      status,
      validDaysOver,
    ],
  );
  const advisory = useMemo(
    () =>
      advisoryFor({
        attributedProjectId,
        create,
        editId,
        effEndDate,
        effHoursPerDay,
        ignoreWeekends,
        isBlocks,
        isExternal,
        repeat,
        repeatProjection,
        resourceId,
        selectedResource,
        selectedEffectiveWeek,
        startDate,
        data: { allocations: data.allocations, closures: data.closures, timeOff: data.timeOff },
      }),
    [
      attributedProjectId,
      create,
      data.allocations,
      data.closures,
      data.timeOff,
      editId,
      effEndDate,
      effHoursPerDay,
      ignoreWeekends,
      isBlocks,
      isExternal,
      repeat,
      repeatProjection,
      resourceId,
      selectedResource,
      selectedEffectiveWeek,
      startDate,
    ],
  );
  // A typed span can produce an invalid date; guard format() to avoid crashing the modal.
  const parsedEndDate = parseDate(effEndDate);
  const endDateHint = Number.isNaN(parsedEndDate.getTime()) ? null : format(parsedEndDate, "EEE d MMM yyyy");

  const { submit, onDuplicate, onDelete } = createAllocationCommands({
    ...target.fields,
    ...target,
    ...schedule.fields,
    ...schedule,
    data,
    create,
    editing,
    mode,
    isDays,
    isBlocks,
    initialDaysOver: seed.initialDaysOver,
    fail,
    canEdit,
    onClose,
    setConfirmDelete,
    addAllocation,
    addAllocations,
    updateAllocation,
    deleteAllocation,
    deleteAllocationSeriesFrom,
  });
  // In create mode the assignee is already chosen (the user clicked the + next to
  // their row), so we drop the Assignee select and name them in the title instead.
  const createName = create
    ? seed.initialResource
      ? resourceDisplayName(seed.initialResource)
      : m.form_allocation_advisory_resource_name()
    : undefined;
  const repeatLastStart = repeatProjection?.startDates.at(-1);
  return {
    shell: { editing, createName, onClose, submit, clear },
    targetFields: target.fields,
    scheduleFields: {
      ...schedule.fields,
      endDateHint,
      create,
      repeatProjection,
      repeatLastStart,
      advisory,
      error,
      errorField,
      errorId,
    },
    footer: { editing, canEdit, confirmDelete, setConfirmDelete, onDelete, onDuplicate, onClose },
  };
}

export type AllocationModalState = ReturnType<typeof useAllocationModalState>;
