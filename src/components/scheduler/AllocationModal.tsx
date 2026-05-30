import { useEffect, useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { todayISO } from '../../lib/dateMath'
import { validateAllocationAssignment } from '../../lib/integrity'
import {
  Button,
  DateField,
  FieldError,
  Modal,
  NumberField,
  SelectField,
  TextAreaField,
  type Option,
} from '../common/ui'
import { ALLOCATION_STATUS_OPTIONS } from '../../lib/metadata'
import type { AllocationStatus, ISODate } from '../../types/entities'

type AllocationModalProps =
  | { allocationId: string; onClose: () => void }
  | { create: { resourceId: string; startDate: ISODate; endDate: ISODate }; onClose: () => void }

export function AllocationModal(props: AllocationModalProps) {
  const { onClose } = props
  const data = useStore((s) => s.data)
  const addAllocation = useStore((s) => s.addAllocation)
  const updateAllocation = useStore((s) => s.updateAllocation)
  const deleteAllocation = useStore((s) => s.deleteAllocation)
  const addTask = useStore((s) => s.addTask)

  const editId = 'allocationId' in props ? props.allocationId : undefined
  const create = 'create' in props ? props.create : undefined
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined

  const initialTask = editing ? data.tasks.find((t) => t.id === editing.taskId) : undefined
  const initialResourceId = editing?.resourceId ?? create?.resourceId ?? ''
  const initialResource = data.resources.find((r) => r.id === initialResourceId)
  const initialLocked = initialResource?.kind === 'placeholder' ? initialResource.projectId : undefined

  const [resourceId, setResourceId] = useState(initialResourceId)
  const [projectId, setProjectId] = useState(initialLocked ?? initialTask?.projectId ?? '')
  const [phaseId, setPhaseId] = useState(initialTask?.phaseId ?? '')
  const [taskId, setTaskId] = useState(editing?.taskId ?? '')
  const [startDate, setStartDate] = useState<ISODate>(editing?.startDate ?? create?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState<ISODate>(editing?.endDate ?? create?.endDate ?? todayISO())
  const [hoursPerDay, setHoursPerDay] = useState(editing?.hoursPerDay ?? initialResource?.workingHoursPerDay ?? 8)
  const [status, setStatus] = useState<AllocationStatus>(editing?.status ?? 'confirmed')
  const [note, setNote] = useState(editing?.note ?? '')
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

  const resourceOptions: Option[] = data.resources.map((r) => ({
    value: r.id,
    label: `${r.name ?? r.role}${r.kind === 'placeholder' ? ' (slot)' : ''}`,
  }))
  const projectOptions: Option[] = data.projects
    .filter((p) => (lockedProjectId ? p.id === lockedProjectId : true))
    .map((p) => {
      const client = data.clients.find((c) => c.id === p.clientId)
      return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
    })
  const phaseOptions: Option[] = data.phases.filter((ph) => ph.projectId === projectId).map((ph) => ({ value: ph.id, label: ph.name }))
  const taskOptions: Option[] = data.tasks
    .filter((t) => t.projectId === projectId && (phaseId ? t.phaseId === phaseId : true))
    .map((t) => ({ value: t.id, label: t.name }))

  const onAssigneeChange = (v: string) => {
    setResourceId(v)
    const r = data.resources.find((x) => x.id === v)
    if (r?.kind === 'placeholder' && r.projectId) {
      // A placeholder forces its bound project; reset downstream selections.
      setProjectId(r.projectId)
      setPhaseId('')
      setTaskId('')
    }
  }
  const onProjectChange = (v: string) => {
    setProjectId(v)
    setPhaseId('')
    setTaskId('')
  }
  const onPhaseChange = (v: string) => {
    setPhaseId(v)
    setTaskId('')
  }
  const onAddTask = () => {
    if (!newTaskName.trim() || !projectId) return
    const task = addTask({ name: newTaskName.trim(), projectId, phaseId: phaseId || undefined })
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
    const task = data.tasks.find((t) => t.id === taskId)
    if (selectedResource && task) {
      const check = validateAllocationAssignment(selectedResource, task.projectId)
      if (!check.ok) {
        fail('task', check.errors[0])
        return
      }
    }
    const fields = { taskId, startDate, endDate, hoursPerDay, status, note: note.trim() ? note.trim() : undefined }
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
      })
      onClose()
    } catch (e) {
      fail(null, e instanceof Error ? e.message : 'Could not save this allocation.')
    }
  }

  return (
    <Modal
      title={editing ? 'Edit allocation' : 'New allocation'}
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
      <SelectField label="Assignee" value={resourceId} onChange={onAssigneeChange} options={resourceOptions} placeholder="— Select resource —" invalid={errorField === 'resource'} describedById={errorId} />
      {isPlaceholder && <p className="text-xs text-muted">Placeholder — locked to its bound project.</p>}

      <SelectField
        label="Project"
        value={projectId}
        onChange={onProjectChange}
        options={projectOptions}
        placeholder={lockedProjectId ? undefined : '— Select project —'}
        disabled={!!lockedProjectId}
      />
      <SelectField label="Phase" value={phaseId} onChange={onPhaseChange} options={phaseOptions} placeholder="— Any / none —" />
      <SelectField label="Task" value={taskId} onChange={setTaskId} options={taskOptions} placeholder="— Select task —" invalid={errorField === 'task'} describedById={errorId} />
      {projectId && (
        <div className="flex gap-2">
          <input
            className="w-full rounded-md border bg-surface px-2 py-1 text-sm text-ink placeholder:text-faint"
            value={newTaskName}
            placeholder="…or add a new task"
            aria-label="New task name"
            onChange={(e) => setNewTaskName(e.target.value)}
          />
          <Button variant="ghost" onClick={onAddTask}>
            Add task
          </Button>
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <DateField label="Start" value={startDate} onChange={setStartDate} invalid={errorField === 'dates'} describedById={errorId} />
        </div>
        <div className="flex-1">
          <DateField label="End" value={endDate} onChange={setEndDate} invalid={errorField === 'dates'} describedById={errorId} />
        </div>
      </div>

      <NumberField label="Hours / day" value={hoursPerDay} onChange={setHoursPerDay} min={0} max={24} invalid={errorField === 'hours'} describedById={errorId} />
      <SelectField label="Status" value={status} onChange={(v) => setStatus(v as AllocationStatus)} options={ALLOCATION_STATUS_OPTIONS} />
      <TextAreaField label="Note" value={note} onChange={setNote} />

      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
