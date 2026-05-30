import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { Button, FieldError, Modal, SelectField, TextField, type Option } from '../common/ui'
import type { Task } from '../../types/entities'

export function TaskForm({ task, onClose }: { task?: Task; onClose: () => void }) {
  const add = useStore((s) => s.addTask)
  const update = useStore((s) => s.updateTask)
  const projects = useStore((s) => s.data.projects)
  const clients = useStore((s) => s.data.clients)
  const phases = useStore((s) => s.data.phases)

  const [name, setName] = useState(task?.name ?? '')
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  const [phaseId, setPhaseId] = useState(task?.phaseId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }

  const projectOptions: Option[] = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId)
    return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
  })
  const phaseOptions: Option[] = phases
    .filter((ph) => ph.projectId === projectId)
    .map((ph) => ({ value: ph.id, label: ph.name }))

  const onProjectChange = (v: string) => {
    setProjectId(v)
    setPhaseId('') // phase belongs to a project; reset when the project changes
  }

  const submit = () => {
    if (!name.trim()) {
      fail('name', 'Name is required.')
      return
    }
    if (!projectId) {
      fail('projectId', 'A task must belong to a project.')
      return
    }
    const patch = { name: name.trim(), projectId, phaseId: phaseId || undefined }
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
      <TextField label="Name" value={name} onChange={setName} autoFocus invalid={errorField === 'name'} describedById={errorId} />
      <SelectField label="Project" value={projectId} onChange={onProjectChange} options={projectOptions} placeholder="— Select project —" invalid={errorField === 'projectId'} describedById={errorId} />
      <SelectField label="Phase" value={phaseId} onChange={setPhaseId} options={phaseOptions} placeholder="— No phase —" />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
