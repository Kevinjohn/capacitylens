import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateName } from '../../lib/validation'
import { Button, FieldError, Modal, RequiredLegend, SelectField, TextField, type Option } from '../common/ui'
import type { Task } from '@floaty/shared/types/entities'

/** Add (no `task`) or edit a task: name + OPTIONAL project (a general task has none; changing the
 *  project clears the phase, which belonged to the old one). `onClose` fires on save or cancel. */
export function TaskForm({ task, onClose }: { task?: Task; onClose: () => void }) {
  const add = useStore((s) => s.addTask)
  const update = useStore((s) => s.updateTask)
  const data = useScopedData()
  const projects = data.projects
  const clients = data.clients

  const [name, setName] = useState(task?.name ?? '')
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  // Phase UI is hidden for now, but we keep an existing task's phase so editing a
  // task doesn't silently ungroup it; changing the project still clears it (the
  // phase belongs to the old project).
  const [phaseId, setPhaseId] = useState(task?.phaseId ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const projectOptions: Option[] = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId)
    return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
  })

  const onProjectChange = (v: string) => {
    setProjectId(v)
    setPhaseId('')
  }

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    // A task may be general (no project) or project-bound — project is optional.
    const patch = { name: trimmed, projectId: projectId || undefined, phaseId: phaseId || undefined }
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
      <SelectField label="Project" value={projectId} onChange={onProjectChange} options={projectOptions} placeholder="— No project (general task) —" />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
