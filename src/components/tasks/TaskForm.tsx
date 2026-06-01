import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { validateName } from '../../lib/validation'
import { Button, FieldError, Modal, RequiredLegend, SelectField, TextField, type Option } from '../common/ui'
import type { Task } from '@floaty/shared/types/entities'

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
    if (!projectId) {
      fail('projectId', 'A task must belong to a project.')
      return
    }
    const patch = { name: trimmed, projectId, phaseId: phaseId || undefined }
    if (task) update(task.id, patch)
    else add(patch)
    onClose()
  }

  return (
    <Modal
      title={task ? 'Edit task' : 'Add task'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </>
      }
    >
      <RequiredLegend />
      <TextField label="Name" value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <SelectField label="Project" value={projectId} onChange={onProjectChange} options={projectOptions} placeholder="— Select project —" required invalid={errorField === 'projectId'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
