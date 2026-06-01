import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { validateHex, validateName } from '../../lib/validation'
import { validateProjectClient } from '@floaty/shared/lib/integrity'
import { DEFAULT_COLORS } from '../../lib/palette'
import { Button, ColorField, FieldError, Modal, RequiredLegend, SelectField, TextField, type Option } from '../common/ui'
import type { Project } from '@floaty/shared/types/entities'

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
  const { error, errorField, errorId, fail } = useFieldError()
  const [newPhase, setNewPhase] = useState('')
  // Two-click inline confirm for phase removal (consistent with every other delete,
  // but modal-free so it doesn't nest a second dialog inside this one).
  const [confirmingPhase, setConfirmingPhase] = useState<string | null>(null)

  const clientOptions: Option[] = clients.map((c) => ({ value: c.id, label: c.name }))
  const myPhases = project ? phases.filter((p) => p.projectId === project.id) : []

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    const check = validateProjectClient(clientId)
    if (!check.ok) {
      fail('client', check.errors[0])
      return
    }
    if (!validateHex(color, fail)) return
    if (project) update(project.id, { name: trimmed, clientId, color })
    else add({ name: trimmed, clientId, color })
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
      <RequiredLegend />
      <TextField label="Name" value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <SelectField label="Client" value={clientId} onChange={setClientId} options={clientOptions} placeholder="— Select client —" required invalid={errorField === 'client'} describedById={errorId} />
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
                <li key={ph.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{ph.name}</span>
                  {confirmingPhase === ph.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted">Ungroup its tasks?</span>
                      <Button
                        variant="danger"
                        onClick={() => {
                          deletePhase(ph.id)
                          setConfirmingPhase(null)
                        }}
                      >
                        Confirm
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmingPhase(ph.id)}>
                      Remove
                    </Button>
                  )}
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
