import { m } from "@/i18n";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { parseDate, todayISO } from "@capacitylens/shared/lib/dateMath";
import { carriesHourlyLoad } from "@capacitylens/shared/types/entities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanEdit } from "@/auth/permissionContext";
import { capturePlanningDraft } from "@/data/planning/planningActions";
import { isPlanningHistoryReady } from "@/data/planning/planningCacheController";
import type { PlanningControllerMetadata, PlanningDraft } from "@/data/planning/planningCacheController";
import { usePlanningActions, usePlanningDraft } from "@/data/planning/usePlanningActions";
import { useFieldError, useFieldErrorFocus } from "@/hooks/useFieldError";
import { formatWeekdayScheduleDate } from "@/lib/dateDisplay";
import { resolveResourceDisplayName } from "@/lib/metadata";
import {
  hasExternalResourcesEnabled,
  canCreateInlineActivity,
  hasVisibleTaskFieldInSchedule,
  hasPlaceholdersEnabled,
  resolveSchedulingMode,
  resolveTimeZone,
} from "@/store/selectors";
import { useActiveScopedData } from "@/store/useScopedData";
import { useStore } from "@/store/useStore";
import { buildAllocationAdvisory } from "./buildAllocationAdvisory";
import { buildAllocationModalSeed } from "./buildAllocationModalSeed";
import type { AllocationModalProps } from "./allocationModalTypes";
import { buildRepeatProjection } from "./buildRepeatProjection";
import { createAllocationCommands } from "./allocationSubmit";
import { useAllocationScheduleState } from "./useAllocationScheduleState";
import { useAllocationTargetState } from "./useAllocationTargetState";

/** A form may advance its captured revision only when its own single-step activity write is acknowledged. */
export function isInlineActivityAcknowledgement(draft: PlanningDraft, planning: PlanningControllerMetadata): boolean {
  return (
    planning.context === draft.context &&
    planning.revision === draft.baseRevision + 1 &&
    isPlanningHistoryReady(planning) &&
    planning.outcome?.kind === "acknowledged" &&
    planning.outcome.revision === planning.revision
  );
}

function useSchedulingContext() {
  const mode = useStore((state) => resolveSchedulingMode(state.data, state.activeAccountId));
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  const accountWorkingDays = useMemo(
    () => normalizeAccountWorkingDays(activeAccount?.workingDays, activeAccount?.weekStartsOn ?? 1),
    [activeAccount],
  );
  return { mode, accountWorkingDays };
}

function useAllocationModalContext(props: AllocationModalProps) {
  const { onClose } = props;
  const canEdit = useCanEdit();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useActiveScopedData();
  const { mode, accountWorkingDays } = useSchedulingContext();
  // Read the active account row directly because the scoped entity projection omits accounts.
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const externalEnabled = useStore((state) => hasExternalResourcesEnabled(state.data, state.activeAccountId));
  const inlineActivityCreateEnabled = useStore((state) => canCreateInlineActivity(state.data, state.activeAccountId));
  const showTaskFieldInSchedule = useStore((state) => hasVisibleTaskFieldInSchedule(state.data, state.activeAccountId));
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const isDays = mode === "days";
  const isBlocks = !carriesHourlyLoad(mode);

  const editId = props.kind === "edit" ? props.allocationId : undefined;
  const create = props.kind === "create" ? props.create : undefined;
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
    today: todayISO(calendarTimeZone),
  });
  const fieldError = useFieldError();
  // Register focus before the schedule hook registers its repeat-adjustment effect.
  useFieldErrorFocus(fieldError);

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose();
  }, [editId, editing, onClose]);

  return {
    onClose,
    canEdit,
    confirmDelete,
    setConfirmDelete,
    data,
    mode,
    accountWorkingDays,
    placeholdersEnabled,
    externalEnabled,
    inlineActivityCreateEnabled,
    showTaskFieldInSchedule,
    calendarTimeZone,
    isDays,
    isBlocks,
    editId,
    create,
    editing,
    resourcesById,
    seed,
    fieldError,
  };
}

function useTargetSchedule(
  context: ReturnType<typeof useAllocationModalContext>,
  addActivity: ReturnType<typeof usePlanningActions>["addActivity"],
  runWhileBusy: <Result>(command: () => Promise<Result>) => Promise<Result | undefined>,
  onInlineActivityCreated: () => boolean,
) {
  const target = useAllocationTargetState({
    data: context.data,
    seed: context.seed,
    resourceById: context.resourcesById,
    canEdit: context.canEdit,
    placeholdersEnabled: context.placeholdersEnabled,
    externalEnabled: context.externalEnabled,
    inlineActivityCreateEnabled: context.inlineActivityCreateEnabled,
    ...context.fieldError,
    addActivity,
    runWhileBusy,
    onInlineActivityCreated,
  });
  const schedule = useAllocationScheduleState({
    selectedResource: target.selectedResource,
    mode: context.mode,
    accountWorkingDays: context.accountWorkingDays,
    calendarTimeZone: context.calendarTimeZone,
    seed: context.seed,
  });
  const repeatProjection = useRepeatProjection(buildRepeatProjectionInput(context, target, schedule));
  const advisory = useAllocationAdvisory(buildAdvisoryInput({ context, target, schedule, repeatProjection }));
  // A typed span can produce an invalid date; guard formatWeekdayScheduleDate() to avoid crashing the modal.
  const parsedEndDate = parseDate(schedule.effEndDate);
  const endDateHint = Number.isNaN(parsedEndDate.getTime()) ? null : formatWeekdayScheduleDate(schedule.effEndDate);
  return { target, schedule, repeatProjection, advisory, endDateHint };
}

/** Coordinates allocation dialog fields, validation, and submission. */
export function useAllocationModalState(props: AllocationModalProps) {
  const context = useAllocationModalContext(props);
  const initialDraft = usePlanningDraft(context.editing);
  const [draft, setDraft] = useState(initialDraft);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const runWhileBusy = useCallback(async <Result>(command: () => Promise<Result>): Promise<Result | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await command();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  const onInlineActivityCreated = useCallback(() => {
    if (!draft) return true;
    const acknowledged = useStore.getState().planning;
    if (!isInlineActivityAcknowledgement(draft, acknowledged)) return false;
    const nextDraft = capturePlanningDraft(draft.originalWritable);
    if (
      !nextDraft ||
      nextDraft.context !== draft.context ||
      nextDraft.generation !== draft.generation ||
      nextDraft.baseRevision !== acknowledged.revision
    )
      return false;
    setDraft(nextDraft);
    return true;
  }, [draft]);
  const actions = usePlanningActions(draft);
  const state = buildModalState(
    context,
    useTargetSchedule(context, actions.addActivity, runWhileBusy, onInlineActivityCreated),
    actions,
    busy,
  );
  return {
    ...state,
    busy,
    shell: { ...state.shell, submit: () => runWhileBusy(state.shell.submit) },
    footer: {
      ...state.footer,
      onDelete: (scope?: "one" | "future") => runWhileBusy(() => state.footer.onDelete(scope)),
      onDuplicate: () => runWhileBusy(state.footer.onDuplicate),
    },
  };
}

function buildModalState(
  context: ReturnType<typeof useAllocationModalContext>,
  state: ReturnType<typeof useTargetSchedule>,
  actions: ReturnType<typeof usePlanningActions>,
  busy: boolean,
) {
  const { target, schedule, repeatProjection, advisory, endDateHint } = state;
  const { submit, onDuplicate, onDelete } = createAllocationCommands({
    ...target.fields,
    ...target,
    ...schedule.fields,
    ...schedule,
    data: context.data,
    create: context.create,
    editing: context.editing,
    mode: context.mode,
    isDays: context.isDays,
    isBlocks: context.isBlocks,
    initialDaysOver: context.seed.initialDaysOver,
    fail: context.fieldError.fail,
    canEdit: context.canEdit,
    onClose: context.onClose,
    setConfirmDelete: context.setConfirmDelete,
    addAllocation: actions.addAllocation,
    duplicateAllocation: actions.duplicateAllocation,
    addAllocations: actions.addAllocations,
    updateAllocation: actions.updateAllocation,
    deleteAllocation: actions.deleteAllocation,
    deleteAllocationSeriesFrom: actions.deleteAllocationSeriesFrom,
  });

  const createName = resolveCreateName({
    isCreate: context.create !== undefined,
    resource: context.seed.initialResource,
  });
  const repeatLastStart = repeatProjection?.startDates.at(-1);
  return {
    shell: {
      editing: context.editing,
      createName,
      onClose: context.onClose,
      submit,
      clear: context.fieldError.clear,
    },
    targetFields: target.fields,
    scheduleFields: {
      ...schedule.fields,
      showTaskFieldInSchedule: context.showTaskFieldInSchedule,
      endDateHint,
      create: context.create,
      repeatProjection,
      repeatLastStart,
      advisory,
      error: context.fieldError.error,
      errorField: context.fieldError.errorField,
      errorId: context.fieldError.errorId,
    },
    footer: {
      editing: context.editing,
      canEdit: context.canEdit,
      confirmDelete: context.confirmDelete,
      setConfirmDelete: context.setConfirmDelete,
      onDelete,
      onDuplicate,
      onClose: context.onClose,
      busy,
    },
  };
}

function buildRepeatProjectionInput(
  context: ReturnType<typeof useAllocationModalContext>,
  target: ReturnType<typeof useAllocationTargetState>,
  schedule: ReturnType<typeof useAllocationScheduleState>,
): Parameters<typeof buildRepeatProjection>[0] {
  return {
    activityId: target.fields.activityId,
    create: context.create,
    attributedProjectId: target.attributedProjectId,
    daysOfWork: schedule.fields.daysOfWork,
    daysOver: schedule.fields.daysOver,
    effEndDate: schedule.effEndDate,
    effHoursPerDay: schedule.fields.effHoursPerDay,
    ignoreWeekends: schedule.fields.ignoreWeekends,
    isBlocks: context.isBlocks,
    isDays: context.isDays,
    isExternal: schedule.fields.isExternal,
    mode: context.mode,
    note: schedule.fields.note,
    task: schedule.fields.task,
    repeat: schedule.fields.repeat,
    repeatUntil: schedule.fields.repeatUntil,
    repeatUntilMaximum: schedule.fields.repeatUntilMaximum,
    repeatUntilMinimum: schedule.fields.repeatUntilMinimum,
    resourceId: target.fields.resourceId,
    selectedActivity: target.selectedActivity,
    selectedEffectiveProjectId: target.selectedEffectiveProjectId,
    selectedResource: target.selectedResource,
    selectedEffectiveWeek: schedule.selectedEffectiveWeek,
    spanFitsDateDomain: schedule.spanFitsDateDomain,
    startDate: schedule.fields.startDate,
    status: schedule.fields.status,
    validDaysOver: schedule.validDaysOver,
  };
}

interface BuildAdvisoryInput {
  context: ReturnType<typeof useAllocationModalContext>;
  target: ReturnType<typeof useAllocationTargetState>;
  schedule: ReturnType<typeof useAllocationScheduleState>;
  repeatProjection: ReturnType<typeof useRepeatProjection>;
}

function buildAdvisoryInput({
  context,
  target,
  schedule,
  repeatProjection,
}: BuildAdvisoryInput): Parameters<typeof buildAllocationAdvisory>[0] {
  return {
    attributedProjectId: target.attributedProjectId,
    create: context.create,
    editId: context.editId,
    effEndDate: schedule.effEndDate,
    effHoursPerDay: schedule.fields.effHoursPerDay,
    ignoreWeekends: schedule.fields.ignoreWeekends,
    isBlocks: context.isBlocks,
    isExternal: schedule.fields.isExternal,
    repeat: schedule.fields.repeat,
    repeatProjection,
    resourceId: target.fields.resourceId,
    selectedResource: target.selectedResource,
    selectedEffectiveWeek: schedule.selectedEffectiveWeek,
    startDate: schedule.fields.startDate,
    data: { allocations: context.data.allocations, closures: context.data.closures, timeOff: context.data.timeOff },
  };
}

function useRepeatProjection(input: Parameters<typeof buildRepeatProjection>[0]) {
  // prettier-ignore
  const { activityId, create, attributedProjectId, daysOfWork, daysOver, effEndDate, effHoursPerDay,
    ignoreWeekends, isBlocks, isDays, isExternal, mode, note, task, repeat, repeatUntil, repeatUntilMaximum,
    repeatUntilMinimum, resourceId, selectedActivity, selectedEffectiveProjectId, selectedResource,
    selectedEffectiveWeek, spanFitsDateDomain, startDate, status, validDaysOver } = input;
  return useMemo(
    () =>
      buildRepeatProjection({
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
        task,
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
    // prettier-ignore
    [activityId, create, attributedProjectId, daysOfWork, daysOver, effEndDate, effHoursPerDay,
      ignoreWeekends, isBlocks, isDays, isExternal, mode, note, task, repeat, repeatUntil, repeatUntilMaximum,
      repeatUntilMinimum, resourceId, selectedActivity, selectedEffectiveProjectId, selectedResource,
      selectedEffectiveWeek, spanFitsDateDomain, startDate, status, validDaysOver],
  );
}

function useAllocationAdvisory(input: Parameters<typeof buildAllocationAdvisory>[0]) {
  // prettier-ignore
  const { attributedProjectId, create, editId, effEndDate, effHoursPerDay, ignoreWeekends, isBlocks,
    isExternal, repeat, repeatProjection, resourceId, selectedResource, selectedEffectiveWeek, startDate, data } = input;
  const { allocations, closures, timeOff } = data;
  return useMemo(
    () =>
      buildAllocationAdvisory({
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
        data: { allocations, closures, timeOff },
      }),
    // prettier-ignore
    [attributedProjectId, create, editId, effEndDate, effHoursPerDay, ignoreWeekends, isBlocks,
      isExternal, repeat, repeatProjection, resourceId, selectedResource, selectedEffectiveWeek,
      startDate, allocations, closures, timeOff],
  );
}

type ResolveCreateNameOptions = {
  isCreate: boolean;
  resource: Parameters<typeof resolveResourceDisplayName>[0] | undefined;
};
function resolveCreateName({ isCreate, resource }: ResolveCreateNameOptions) {
  if (!isCreate) return undefined;
  return resource ? resolveResourceDisplayName(resource) : m.form_allocation_advisory_resource_name();
}

/** State and handlers returned to the allocation dialog view. */
export type AllocationModalState = ReturnType<typeof useAllocationModalState>;
