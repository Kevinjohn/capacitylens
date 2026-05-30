import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { validateProjectClient } from '../../lib/integrity'
import { DEFAULT_COLORS } from '../../lib/palette'
import { isHexColor } from '../../lib/color'
import { Button, ColorField, FieldError, Modal, SelectField, TextField, type Option } from '../common/ui'
import type { Project } from '../../types/entities'

export function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const add = useStore((s) => s.addProject)
  const update = useStore((s) => s.updateProject)
  const data = useScopedData()
  const clients = data.clients
  const phases = data.phases
  const addPhase = useStore((s) => s.addPhase)
  const deletePhase = useStore((s) => s.deletePhase)

  const [name, setName] = useState(project?.name ?? '')
  const [clientId, setClientId] = useState(project?.clientId ?? '')
  const [color, setColor] = useState(project?.color ?? DEFAULT_COLORS.project)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }
  const [newPhase, setNewPhase] = useState('')

  const clientOptions: Option[] = clients.map((c) => ({ value: c.id, label: c.name }))
  const myPhases = project ? phases.filter((p) => p.projectId === project.id) : []

  const submit = () => {
    if (!name.trim()) {
      fail('name', 'Name is required.')
      return
    }
    const check = validateProjectClient(clientId)
    if (!check.ok) {
      fail('client', check.errors[0])
      return
    }
    if (!isHexColor(color)) {
      fail('color', 'Enter a valid 6-digit hex colour, e.g. #3b82f6.')
      return
    }
    if (project) update(project.id, { name: name.trim(), clientId, color })
    else add({ name: name.trim(), clientId, color })
    onClose()
  }

  return (
    <Modal
      title={project ? 'Edit project' : 'Add project'}
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
      <SelectField label="Client" value={clientId} onChange={setClientId} options={clientOptions} placeholder="— Select client —" invalid={errorField === 'client'} describedById={errorId} />
      <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>

      {project && (
        <div className="border-t pt-3">
          <div className="mb-1 text-sm font-medium text-ink">Phases</div>
          {myPhases.length === 0 ? (
            <p className="text-xs text-muted">No phases yet.</p>
          ) : (
            <ul className="mb-2 space-y-1">
              {myPhases.map((ph) => (
                <li key={ph.id} className="flex items-center justify-between text-sm">
                  <span>{ph.name}</span>
                  <Button variant="ghost" onClick={() => deletePhase(ph.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              className="w-full rounded border border-line px-2 py-1 text-sm"
              value={newPhase}
              placeholder="New phase"
              aria-label="New phase"
              onChange={(e) => setNewPhase(e.target.value)}
            />
            <Button
              onClick={() => {
                if (newPhase.trim()) {
                  addPhase({ name: newPhase.trim(), projectId: project.id })
                  setNewPhase('')
                }
              }}
            >
              Add phase
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
