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

  const [name, setName] = useState(project?.name ?? '')
  const [clientId, setClientId] = useState(project?.clientId ?? '')
  const [color, setColor] = useState(project?.color ?? DEFAULT_COLORS.project)
  const { error, errorField, errorId, fail } = useFieldError()

  const clientOptions: Option[] = clients.map((c) => ({ value: c.id, label: c.name }))

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
      <SelectField label="Client" value={clientId} onChange={setClientId} options={clientOptions} placeholder="— Select client —" required invalid={errorField === 'client'} describedById={errorId} />
      <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
