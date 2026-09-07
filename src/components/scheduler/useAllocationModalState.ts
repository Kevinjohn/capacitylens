import { m } from "@/i18n";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { parseDate } from "@capacitylens/shared/lib/dateMath";
import { carriesHourlyLoad } from "@capacitylens/shared/types/entities";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useCanEdit } from "../../auth/permissionContext";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { resolveResourceDisplayName } from "../../lib/metadata";
import {
  hasExternalResourcesEnabled,
  canCreateInlineActivity,
  hasPlaceholdersEnabled,
  resolveSchedulingMode,
  resolveTimeZone,
} from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { buildAllocationAdvisory } from "./buildAllocationAdvisory";
import { buildAllocationModalSeed } from "./buildAllocationModalSeed";
import type { AllocationModalProps } from "./allocationModalTypes";
import { buildRepeatProjection } from "./buildRepeatProjection";
import { createAllocationCommands } from "./allocationSubmit";
import { useAllocationScheduleState } from "./useAllocationScheduleState";
import { useAllocationTargetState } from "./useAllocationTargetState";
export function useAllocationModalState(props: AllocationModalProps) {
  const { onClose } = props;
  const canEdit = useCanEdit();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useActiveScopedData();
  const addAllocation = useStore((state) => state.addAllocation);
  const addAllocations = useStore((state) => state.addAllocations);
  const updateAllocation = useStore((state) => state.updateAllocation);
  const deleteAllocation = useStore((state) => state.deleteAllocation);
  const deleteAllocationSeriesFrom = useStore((state) => state.deleteAllocationSeriesFrom);
  const addActivity = useStore((state) => state.addActivity);
  const mode = useStore((state) => resolveSchedulingMode(state.data, state.activeAccountId));
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  // Not accountWorkingDaysFor: the modal's scoped data blanks `accounts`, so it subscribes to the
  // account row itself and runs the selector's one repair seam directly.
  const accountWorkingDays = useMemo(
    () => normalizeAccountWorkingDays(activeAccount?.workingDays, activeAccount?.weekStartsOn ?? 1),
    [activeAccount],
  );
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const externalEnabled = useStore((state) => hasExternalResourcesEnabled(state.data, state.activeAccountId));
  const inlineActivityCreateEnabled = useStore((state) => canCreateInlineActivity(state.data, state.activeAccountId));
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const isDays = mode === "days";
  const isBlocks = !carriesHourlyLoad(mode);

  const editId = "allocationId" in props ? props.allocationId : undefined;
  const create = "create" in props ? props.create : undefined;
  const editing = editId ? data.allocations.find((allocation) => allocation.id === editId) : undefined;

  const resourcesById = useMemo(
    () => new Map(data.resources.map((resource) => [resource.id, resource])),
    [data.resources],
  );
  const seed = buildAllocationModalSeed({
    editing,
    create,
    data,
    mode,
    resourceById: resourcesById,
    accountWorkingDays,
    calendarTimeZone,
  });
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
    resourceById: resourcesById,
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
  const { selectedEffectiveWeek, effEndDate: effectiveEndDate, validDaysOver, spanFitsDateDomain } = schedule;
  const {
    daysOfWork,
    daysOver,
    effHoursPerDay: effectiveHoursPerDay,
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
      buildRepeatProjection({
        activityId,
        create,
        attributedProjectId,
        daysOfWork,
        daysOver,
        effEndDate: effectiveEndDate,
        effHoursPerDay: effectiveHoursPerDay,
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
      effectiveEndDate,
      effectiveHoursPerDay,
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
      buildAllocationAdvisory({
        attributedProjectId,
        create,
        editId,
        effEndDate: effectiveEndDate,
        effHoursPerDay: effectiveHoursPerDay,
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
      effectiveEndDate,
      effectiveHoursPerDay,
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
  const parsedEndDate = parseDate(effectiveEndDate);
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
      ? resolveResourceDisplayName(seed.initialResource)
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
