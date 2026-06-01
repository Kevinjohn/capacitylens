import { useEffect, useId, useState } from 'react'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { parseDate, todayISO } from '@floaty/shared/lib/dateMath'
import { daysOfWorkFor, endDateForSpan, hoursPerDayFor, spanDays } from '@floaty/shared/lib/schedulingDays'
import { validateAllocationAssignment } from '@floaty/shared/lib/integrity'
import {
  Button,
  DateField,
  FieldError,
  inputClass,
  Modal,
  NumberField,
  RequiredLegend,
  SelectField,
  TextAreaField,
  type Option,
} from '../common/ui'
import { ALLOCATION_STATUS_OPTIONS } from '../../lib/metadata'
import type { AllocationStatus, ISODate } from '@floaty/shared/types/entities'

/** Snap a seeded days-of-work value to 6 decimals: enough to erase float round-trip
 *  noise (e.g. 8 × 3/7 × 7/8 = 2.9999…) WITHOUT distorting a legitimate fraction
 *  (½ → 0.5, ⅛-day → 1.875). Keeping the seed exact means re-deriving hours on a
 *  no-op save returns the original value rather than drifting it. */
const roundDays = (n: number) => Math.round(n * 1e6) / 1e6
/** 2-dp rounding for the human-readable "…h/day" hint only — never fed back into a value. */
const round2 = (n: number) => Math.round(n * 100) / 100

type AllocationModalProps =
  | { allocationId: string; onClose: () => void }
  | { create: { resourceId: string; startDate: ISODate; endDate: ISODate }; onClose: () => void }

export function AllocationModal(props: AllocationModalProps) {
  const { onClose } = props
  const data = useScopedData()
  const addAllocation = useStore((s) => s.addAllocation)
  const updateAllocation = useStore((s) => s.updateAllocation)
  const deleteAllocation = useStore((s) => s.deleteAllocation)
  const addTask = useStore((s) => s.addTask)
  const isDays = useStore((s) => (s.data.accounts.find((a) => a.id === s.activeAccountId)?.schedulingMode ?? 'hourly') === 'days')

  const editId = 'allocationId' in props ? props.allocationId : undefined
  const create = 'create' in props ? props.create : undefined
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined

  const initialTask = editing ? data.tasks.find((t) => t.id === editing.taskId) : undefined
  const initialResourceId = editing?.resourceId ?? create?.resourceId ?? ''
  const initialResource = data.resources.find((r) => r.id === initialResourceId)
  const initialLocked = initialResource?.kind === 'placeholder' ? initialResource.projectId : undefined

  const [resourceId, setResourceId] = useState(initialResourceId)
  // When editing, the existing task's project wins (undefined → '' = general), so a
  // placeholder→general allocation reopens with the Task select correctly populated.
  // `initialLocked` is only the CREATE-time default for a placeholder's bound project.
  const [projectId, setProjectId] = useState(editing ? (initialTask?.projectId ?? '') : (initialLocked ?? ''))
  const [taskId, setTaskId] = useState(editing?.taskId ?? '')
  const [startDate, setStartDate] = useState<ISODate>(editing?.startDate ?? create?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState<ISODate>(editing?.endDate ?? create?.endDate ?? todayISO())
  const [hoursPerDay, setHoursPerDay] = useState(editing?.hoursPerDay ?? initialResource?.workingHoursPerDay ?? 8)
  const [status, setStatus] = useState<AllocationStatus>(editing?.status ?? 'confirmed')
  const [note, setNote] = useState(editing?.note ?? '')
  const [ignoreWeekends, setIgnoreWeekends] = useState(editing?.ignoreWeekends ?? false)
  // Days-mode inputs (used only when isDays). For an EXISTING allocation we invert
  // hours/dates against the assignee's working week; for a NEW one we honour the span
  // the user drew on the lane (start..end) at full-time load, mirroring how hourly
  // create defaults hours to a full working day across the same range.
  const initialWhpd = initialResource?.workingHoursPerDay ?? 8
  const initialStart = editing?.startDate ?? create?.startDate ?? todayISO()
  const seedEnd = editing?.endDate ?? create?.endDate
  const initialDaysOpts = { workingDays: initialResource?.workingDays, ignoreWeekends: editing?.ignoreWeekends ?? false }
  const initialDaysOver = seedEnd ? Math.max(1, spanDays(initialStart, seedEnd, initialDaysOpts)) : 1
  const [daysOver, setDaysOver] = useState(initialDaysOver)
  const [daysOfWork, setDaysOfWork] = useState(
    editing ? roundDays(daysOfWorkFor(editing.hoursPerDay, initialDaysOver, initialWhpd)) : initialDaysOver,
  )
  const [newTaskName, setNewTaskName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose()
  }, [editId, editing, onClose])

  const selectedResource = data.resources.find((r) => r.id === resourceId)
  const isPlaceholder = selectedResource?.kind === 'placeholder'
  const lockedProjectId = isPlaceholder ? selectedResource?.projectId : undefined

  // Effective range/hours fed to the capacity check and the store. In days mode the
  // end date and hours/day are DERIVED from (start, days of work, days over) against
  // the assignee's working week; in hourly mode the typed fields are used as-is.
  const workingHoursPerDay = selectedResource?.workingHoursPerDay ?? initialWhpd
  const daysOpts = { workingDays: selectedResource?.workingDays, ignoreWeekends }
  const effEndDate = isDays && startDate ? endDateForSpan(startDate, daysOver, daysOpts) : endDate
  const effHoursPerDay = isDays ? hoursPerDayFor(daysOfWork, daysOver, workingHoursPerDay) : hoursPerDay

  const resourceOptions: Option[] = data.resources.map((r) => ({
    value: r.id,
    label: `${r.name ?? r.role}${r.kind === 'placeholder' ? ' (slot)' : ''}`,
  }))
  // "No project" lets you pick general (no-project) tasks. A placeholder is offered
  // only its bound project plus the general option (it can take general tasks too).
  const projectOptions: Option[] = [
    { value: '', label: 'No project (general)' },
    ...data.projects
      .filter((p) => (lockedProjectId ? p.id === lockedProjectId : true))
      .map((p) => {
        const client = data.clients.find((c) => c.id === p.clientId)
        return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
      }),
  ]
  const taskOptions: Option[] = data.tasks
    .filter((t) => (projectId ? t.projectId === projectId : !t.projectId))
    .map((t) => ({ value: t.id, label: t.name }))

  const onAssigneeChange = (v: string) => {
    setResourceId(v)
    const r = data.resources.find((x) => x.id === v)
    if (r?.kind === 'placeholder' && r.projectId) {
      // A placeholder forces its bound project; reset downstream selections.
      setProjectId(r.projectId)
      setTaskId('')
    }
  }
  const onProjectChange = (v: string) => {
    setProjectId(v)
    setTaskId('')
  }
  const onAddTask = () => {
    // No project selected → create a general (no-project) task; otherwise bind it
    // to the chosen project. Was a silent no-op on a blank name — give feedback.
    if (!newTaskName.trim()) {
      fail('newtask', 'Enter a name for the new task.')
      return
    }
    const task = addTask({ name: newTaskName.trim(), projectId: projectId || undefined })
    setTaskId(task.id)
    setNewTaskName('')
  }

  const submit = () => {
    if (!resourceId) {
      fail('resource', 'Choose a resource.')
      return
    }
    if (!taskId) {
      fail('task', 'Choose (or add) a task.')
      return
    }
    if (isDays) {
      // End date is derived, so it can never be reversed; only the start is typed.
      if (!startDate) {
        fail('dates', 'Start date is required.')
        return
      }
      if (!(daysOfWork > 0)) {
        fail('daysOfWork', 'Days of work must be greater than 0.')
        return
      }
    } else {
      if (!startDate || !endDate) {
        fail('dates', 'Start and end dates are required.')
        return
      }
      if (endDate < startDate) {
        fail('dates', 'End date cannot be before the start date.')
        return
      }
      if (!(hoursPerDay > 0)) {
        fail('hours', 'Hours per day must be greater than 0.')
        return
      }
    }
    const task = data.tasks.find((t) => t.id === taskId)
    if (selectedResource && task) {
      const check = validateAllocationAssignment(selectedResource, task.projectId)
      if (!check.ok) {
        fail('task', check.errors[0])
        return
      }
    }
    // Both modes persist the same shape; days mode just feeds the DERIVED end/hours.
    const fields = { taskId, startDate, endDate: effEndDate, hoursPerDay: effHoursPerDay, status, note: note.trim() ? note.trim() : undefined, ignoreWeekends }
    try {
      if (editing) updateAllocation(editing.id, { resourceId, ...fields })
      else addAllocation({ resourceId, ...fields })
      onClose()
    } catch (e) {
      fail(null, e instanceof Error ? e.message : 'Could not save this allocation.')
    }
  }

  const onDuplicate = () => {
    if (!editing) return
    try {
      addAllocation({
        resourceId: editing.resourceId,
        taskId: editing.taskId,
        startDate: editing.startDate,
        endDate: editing.endDate,
        hoursPerDay: editing.hoursPerDay,
        status: editing.status,
        note: editing.note,
        ignoreWeekends: editing.ignoreWeekends,
      })
      onClose()
    } catch (e) {
      fail(null, e instanceof Error ? e.message : 'Could not save this allocation.')
    }
  }

  // In create mode the assignee is already chosen (the user clicked the + next to
  // their row), so we drop the Assignee select and name them in the title instead.
  const createName = create ? (initialResource?.name ?? initialResource?.role ?? 'resource') : undefined

  return (
    <Modal
      title={
        editing ? (
          'Edit allocation'
        ) : createName ? (
          <>New allocation for <strong>{createName}</strong></>
        ) : (
          'New allocation'
        )
      }
      onClose={onClose}
      footer={
        <>
          {editing && (
            <>
              <Button variant="danger" onClick={() => { deleteAllocation(editing.id); onClose() }}>
                Delete
              </Button>
              <Button variant="ghost" onClick={onDuplicate}>
                Duplicate
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </>
      }
    >
      <RequiredLegend />
      {!create && (
        <SelectField label="Assignee" value={resourceId} onChange={onAssigneeChange} options={resourceOptions} placeholder="— Select resource —" required invalid={errorField === 'resource'} describedById={errorId} />
      )}
      {isPlaceholder && <p className="text-xs text-muted">Placeholder — locked to its bound project.</p>}

      <SelectField
        label="Project"
        value={projectId}
        onChange={onProjectChange}
        options={projectOptions}
      />
      <SelectField label="Task" value={taskId} onChange={setTaskId} options={taskOptions} placeholder="— Select task —" required invalid={errorField === 'task'} describedById={errorId} />
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={newTaskName}
          placeholder={projectId ? '…or add a new task' : '…or add a new general task'}
          aria-label="New task name"
          aria-invalid={errorField === 'newtask' || undefined}
          onChange={(e) => setNewTaskName(e.target.value)}
        />
        <Button variant="ghost" onClick={onAddTask}>
          Add task
        </Button>
      </div>

      {isDays ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label="Start Date" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label="Days of work" value={daysOfWork} onChange={setDaysOfWork} min={0} step={0.5} required invalid={errorField === 'daysOfWork'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label="Days over" value={daysOver} onChange={setDaysOver} min={1} step={1} />
            </div>
          </div>
          {startDate && (
            <p className="text-xs text-muted">
              Ends {format(parseDate(effEndDate), 'EEE d MMM yyyy')} · {round2(effHoursPerDay)}h/day
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label="Start Date" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <DateField label="End" value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
          </div>

          <NumberField label="Hours / day" value={hoursPerDay} onChange={setHoursPerDay} min={0} max={24} required invalid={errorField === 'hours'} describedById={errorId} />
        </>
      )}
      <SelectField label="Status" value={status} onChange={(v) => setStatus(v as AllocationStatus)} options={ALLOCATION_STATUS_OPTIONS} />
      <TextAreaField label="Note" value={note} onChange={setNote} />

      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          className="rounded border-line"
          checked={ignoreWeekends}
          onChange={(e) => setIgnoreWeekends(e.target.checked)}
        />
        <span>Ignore weekends</span>
      </label>

      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
