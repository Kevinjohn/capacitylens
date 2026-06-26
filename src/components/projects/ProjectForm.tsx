import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateHex, validateName } from '../../lib/validation'
import { validateProjectClient } from '@capacitylens/shared/lib/integrity'
import { DEFAULT_COLORS } from '../../lib/palette'
import { m } from '@/i18n'
import { Button, ColorField, FieldError, Modal, RequiredLegend, SelectField, TextField, type Option } from '../common/ui'
import type { Project } from '@capacitylens/shared/types/entities'

/** Add (no `project`) or edit a project: name, REQUIRED client, preset colour. `onClose` fires on
 *  save or cancel. */
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
    // Surface a store-side rejection (e.g. a clientId that isn't in this company) as a form error
    // instead of an uncaught React error — see the store CRUD contract.
    try {
      if (project) update(project.id, { name: trimmed, clientId, color })
      else add({ name: trimmed, clientId, color })
      onClose()
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <Modal
      title={project ? m.form_project_edit_title() : m.form_project_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {m.form_cancel()}
          </Button>
          <Button type="submit">{m.form_save()}</Button>
        </>
      }
    >
      <RequiredLegend />
      <TextField label={m.form_project_name_label()} value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <SelectField label={m.form_project_client_label()} value={clientId} onChange={setClientId} options={clientOptions} placeholder={m.form_project_select_client_placeholder()} required invalid={errorField === 'client'} describedById={errorId} />
      <ColorField label={m.form_project_colour_label()} value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
