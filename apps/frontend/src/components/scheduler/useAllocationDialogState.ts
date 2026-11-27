import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose'
import { m } from '@/i18n'
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays'
import { parseDate } from '@capacitylens/shared/lib/dateMath'
import { hasHourlyLoad } from '@capacitylens/shared/types/entities'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanEdit } from '@/auth/permissionContext'
import { isSoleAcknowledgedAdvance } from '@/data/planning/planningReadiness'
import { useCompanyToday } from '@/hooks/useCompanyToday'
import { useFieldError, useFieldErrorFocus } from '@/hooks/useFieldError'
import { formatWeekdayScheduleDate } from '@/lib/dateDisplay'
import { resolveResourceDisplayName } from '@/lib/metadata'
import {
  hasExternalResourcesEnabled,
  canCreateInlineActivity,
  hasVisibleTaskFieldInSchedule,
  hasPlaceholdersEnabled,
  resolveSchedulingMode,
} from '@/store/selectors'
import { useActiveScopedData } from '@/store/useScopedData'
import { useStore } from '@/store/useStore'
import { buildAllocationDialogSeed } from './buildAllocationDialogSeed'
import type { AllocationDialogProps, AllocationDialogSnapshot } from './AllocationDialogSnapshot'
import { buildRepeatExpansion } from './buildRepeatExpansion'
import { createAllocationIntents } from './allocationSubmit'
import { useAllocationScheduleState } from './useAllocationScheduleState'
import { useAllocationTargetState } from './useAllocationTargetState'

function useAllocationStoreActions() {
  return {
    addAllocation: useStore((state) => state.addAllocation),
    addRepeatedAllocation: useStore((state) => state.addRepeatedAllocation),
    duplicateAllocation: useStore((state) => state.duplicateAllocation),
    updateAllocation: useStore((state) => state.updateAllocation),
    deleteAllocation: useStore((state) => state.deleteAllocation),
    deleteAllocationSeriesFrom: useStore((state) => state.deleteAllocationSeriesFrom),
    addActivity: useStore((state) => state.addActivity),
    setNotice: useStore((state) => state.setNotice),
  }
}

function useSchedulingContext() {
  const mode = useStore((state) => resolveSchedulingMode(state.data, state.activeCompanyId))
  const activeCompany = useStore((state) =>
    state.data.companies.find((company) => company.id === state.activeCompanyId)
  )
  const companyWorkingDays = useMemo(
    () => normalizeCompanyWorkingDays(activeCompany?.workingDays, activeCompany?.weekStartsOn ?? 1),
    [activeCompany]
  )
  return { mode, companyWorkingDays }
}

function useAllocationDialogInputs(props: AllocationDialogProps) {
  const onClose = useFormLifetimeClose(props.onClose)
  const canEdit = useCanEdit()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const writing = useRef(false)
  const draftBasis = useRef({
    context: useStore.getState().planning.context,
    revision: useStore.getState().planning.revision,
  })
  const isCurrentDraft = () => {
    const planning = useStore.getState().planning
    return (
      planning.context === draftBasis.current.context &&
      planning.revision === draftBasis.current.revision
    )
  }
  const data = useActiveScopedData()
  const actions = useAllocationStoreActions()
  const addActivity: typeof actions.addActivity = async (draft) => {
    const basis = draftBasis.current
    const canAdvance = isCurrentDraft()
    const result = await actions.addActivity(draft)
    const after = useStore.getState().planning
    // Only this editor's sole acknowledged addition may advance its draft. A later read or
    // another mutation must leave the original revision stale, even if creation succeeded.
    if (canAdvance && result.kind === 'created' && isSoleAcknowledgedAdvance(basis, after)) {
      draftBasis.current = { context: after.context, revision: after.revision }
    }
    return result
  }
  const { mode, companyWorkingDays } = useSchedulingContext()
  // Read the active company row directly because the scoped entity projection omits companies.
  const placeholdersEnabled = useStore((state) =>
    hasPlaceholdersEnabled(state.data, state.activeCompanyId)
  )
  const externalEnabled = useStore((state) =>
    hasExternalResourcesEnabled(state.data, state.activeCompanyId)
  )
  const inlineActivityCreateEnabled = useStore((state) =>
    canCreateInlineActivity(state.data, state.activeCompanyId)
  )
  const showTaskFieldInSchedule = useStore((state) =>
    hasVisibleTaskFieldInSchedule(state.data, state.activeCompanyId)
  )
  const today = useCompanyToday()
  const isDays = mode === 'days'
  const isBlocks = !hasHourlyLoad(mode)

  const editId = props.kind === 'edit' ? props.allocationId : undefined
  const create = props.kind === 'create' ? props.create : undefined
  const editing = editId
    ? data.allocations.find((allocation) => allocation.id === editId)
    : undefined

  const resourcesById = useMemo(
    () => new Map(data.resources.map((resource) => [resource.id, resource])),
    [data.resources]
  )
  const seed = buildAllocationDialogSeed({
    editing,
    create,
    data,
    mode,
    resourceById: resourcesById,
    companyWorkingDays,
    today,
  })
  const fieldError = useFieldError()
  // Register focus before the schedule hook registers its repeat-adjustment effect.
  useFieldErrorFocus(fieldError)

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose()
  }, [editId, editing, onClose])

  return {
    onClose,
    canEdit,
    confirmDelete,
    setConfirmDelete,
    writing,
    isCurrentDraft,
    data,
    ...actions,
    addActivity,
    mode,
    companyWorkingDays,
    placeholdersEnabled,
    externalEnabled,
    inlineActivityCreateEnabled,
    showTaskFieldInSchedule,
    today,
    isDays,
    isBlocks,
    editId,
    create,
    editing,
    resourcesById,
    seed,
    fieldError,
  }
}

function useTargetSchedule(context: ReturnType<typeof useAllocationDialogInputs>) {
  const target = useAllocationTargetState({
    data: context.data,
    seed: context.seed,
    resourceById: context.resourcesById,
    canEdit: context.canEdit,
    placeholdersEnabled: context.placeholdersEnabled,
    externalEnabled: context.externalEnabled,
    inlineActivityCreateEnabled: context.inlineActivityCreateEnabled,
    ...context.fieldError,
    addActivity: context.addActivity,
  })
  const schedule = useAllocationScheduleState({
    selectedResource: target.selectedResource,
    mode: context.mode,
    companyWorkingDays: context.companyWorkingDays,
    today: context.today,
    seed: context.seed,
  })
  // One snapshot of the current form values feeds the repeat preview and the submit intents.
  const snapshot: AllocationDialogSnapshot = {
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
  }
  const repeatExpansion = buildRepeatExpansion(snapshot)
  // A typed span can produce an invalid date; guard formatWeekdayScheduleDate() to avoid crashing the dialog.
  const parsedEndDate = parseDate(schedule.effEndDate)
  const endDateHint = Number.isNaN(parsedEndDate.getTime())
    ? null
    : formatWeekdayScheduleDate(schedule.effEndDate)
  return { target, schedule, snapshot, repeatExpansion, endDateHint }
}

/** Coordinates allocation dialog fields, validation, and submission. */
export function useAllocationDialogState(props: AllocationDialogProps) {
  const context = useAllocationDialogInputs(props)
  return buildDialogState(context, useTargetSchedule(context))
}

function buildDialogState(
  context: ReturnType<typeof useAllocationDialogInputs>,
  state: ReturnType<typeof useTargetSchedule>
) {
  const { target, schedule, snapshot, repeatExpansion, endDateHint } = state
  const { submit, onDuplicate, onDelete } = createAllocationIntents({
    ...snapshot,
    fail: context.fieldError.fail,
    canEdit: context.canEdit,
    onClose: context.onClose,
    setConfirmDelete: context.setConfirmDelete,
    writing: context.writing,
    isCurrentDraft: context.isCurrentDraft,
    addAllocation: context.addAllocation,
    addRepeatedAllocation: context.addRepeatedAllocation,
    duplicateAllocation: context.duplicateAllocation,
    updateAllocation: context.updateAllocation,
    deleteAllocation: context.deleteAllocation,
    deleteAllocationSeriesFrom: context.deleteAllocationSeriesFrom,
    setNotice: context.setNotice,
  })

  const createName = resolveCreateName({
    isCreate: context.create !== undefined,
    resource: context.seed.initialResource,
  })
  const repeatLastStart = repeatExpansion?.startDates.at(-1)
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
      repeatExpansion,
      repeatLastStart,
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
    },
  }
}

type ResolveCreateNameOptions = {
  isCreate: boolean
  resource: Parameters<typeof resolveResourceDisplayName>[0] | undefined
}
function resolveCreateName({ isCreate, resource }: ResolveCreateNameOptions) {
  if (!isCreate) return undefined
  return resource
    ? resolveResourceDisplayName(resource)
    : m.form_allocation_advisory_resource_name()
}

/** State and handlers returned to the allocation dialog view. */
export type AllocationDialogState = ReturnType<typeof useAllocationDialogState>
