import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateName } from '../../lib/validation'
import { Button, FieldError, Modal, RequiredLegend, SelectField, TextField, type Option } from '../common/ui'
import type { Task, TaskKind } from '@floaty/shared/types/entities'

const KIND_OPTIONS: { value: TaskKind; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'internal', label: 'Internal' },
  { value: 'repeatable', label: 'Repeatable' },
]

/** Add (no `task`) or edit a task. Pick a kind first: a `project` task takes a project (and keeps
 *  its phase); `internal`/`repeatable` are project-less, so the project picker is hidden and their
 *  project/phase forced empty. `onClose` fires on save or cancel. */
export function TaskForm({ task, onClose }: { task?: Task; onClose: () => void }) {
  const add = useStore((s) => s.addTask)
  const update = useStore((s) => s.updateTask)
  const data = useScopedData()
  const projects = data.projects
  const clients = data.clients

  const [name, setName] = useState(task?.name ?? '')
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'project')
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  // Phase UI is hidden for now, but we keep an existing task's phase so editing a
  // task doesn't silently ungroup it; changing the project (or kind) still clears it.
  const [phaseId, setPhaseId] = useState(task?.phaseId ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const projectOptions: Option[] = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId)
    return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
  })

  const onKindChange = (next: TaskKind) => {
    setKind(next)
    // Internal/repeatable tasks are project-less — drop any project/phase the form held so a
    // toggle can't submit an incoherent task (the store would reject it anyway).
    if (next !== 'project') {
      setProjectId('')
      setPhaseId('')
    }
  }

  const onProjectChange = (v: string) => {
    setProjectId(v)
    setPhaseId('')
  }

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    // A project task MUST have a project; internal/repeatable are project-less (projectId/phaseId
    // undefined). Surface the project requirement as a field error rather than relying on the
    // store throw, so the invalid control is marked.
    if (kind === 'project' && !projectId) {
      fail('project', 'A project task must be assigned to a project.')
      return
    }
    const patch = {
      name: trimmed,
      kind,
      projectId: kind === 'project' ? projectId || undefined : undefined,
      phaseId: kind === 'project' ? phaseId || undefined : undefined,
    }
    // Surface a store-side rejection as a form error rather than an uncaught React error — see the
    // store CRUD contract.
    try {
      if (task) update(task.id, patch)
      else add(patch)
      onClose()
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <Modal
      title={task ? 'Edit task' : 'Add task'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </>
      }
    >
      <RequiredLegend />
      <TextField label="Name" value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <div className="mb-3">
        <p className="mb-1.5 text-sm font-medium text-ink">Kind</p>
        <div role="radiogroup" aria-label="Task kind" className="inline-flex rounded-md border border-line p-0.5">
          {KIND_OPTIONS.map((opt) => {
            const selected = kind === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onKindChange(opt.value)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                  selected ? 'bg-brand-soft text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      {kind === 'project' && (
        <SelectField label="Project" value={projectId} onChange={onProjectChange} options={projectOptions} placeholder="— Select project —" required invalid={errorField === 'project'} describedById={errorId} />
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
