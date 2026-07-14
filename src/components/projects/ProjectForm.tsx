import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useActiveScopedData, useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateHex, validateName } from '../../lib/validation'
import { normalizeCodeName } from '@capacitylens/shared/domain/privateNames'
import { canSeePrivateNames } from '@capacitylens/shared/domain/access'
import { useRole } from '../../auth/permissionContext'
import { validateProjectClient } from '@capacitylens/shared/lib/integrity'
import { DEFAULT_COLORS } from '../../lib/palette'
import { m } from '@/i18n'
import { Button, ColorField, FieldError, Modal, RequiredLegend, SelectField, SwitchField, TextField, type Option } from '../common/ui'
import type { Project } from '@capacitylens/shared/types/entities'

/** Add (no `project`) or edit a project: name, REQUIRED client, preset colour. `onClose` fires on
 *  save or cancel. */
export function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const add = useStore((s) => s.addProject)
  const update = useStore((s) => s.updateProject)
  const role = useRole()
  const canManagePrivacy = role === null || canSeePrivateNames(role)
  const protectedName = project?.isPrivate === true && !canManagePrivacy
  const data = useActiveScopedData()
  const clients = data.clients
  // The RAW scoped slice, for the archived-parent label only (see clientOptions below): in the demo
  // build an archived client is still in the raw slice (so we can show its name); in server mode the
  // per-account read strips it entirely, so the label degrades to the generic "(current, archived)".
  const rawClients = useScopedData().clients

  const [name, setName] = useState(project?.name ?? '')
  const [clientId, setClientId] = useState(project?.clientId ?? '')
  const [color, setColor] = useState(project?.color ?? DEFAULT_COLORS.project)
  const [isPrivate, setIsPrivate] = useState(project?.isPrivate ?? false)
  const [codeName, setCodeName] = useState(project?.codeName ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const clientOptions: Option[] = clients.map((c) => ({ value: c.id, label: c.name }))
  // Editing a project whose client is ARCHIVED: the active-only options above don't contain it, so
  // without this the select would silently blank and an unrelated edit (rename, colour) couldn't
  // round-trip the unchanged clientId. Append the current id as a DISABLED option — it stays
  // selected/submittable as the current value (the store's unchanged-parent relaxation accepts it),
  // but can't be picked back once the user chooses an active client.
  if (project && !clients.some((c) => c.id === project.clientId)) {
    const raw = rawClients.find((c) => c.id === project.clientId)
    clientOptions.push({
      value: project.clientId,
      label: raw ? m.list_label_archived({ name: raw.name }) : m.form_option_current_archived(),
      disabled: true,
    })
  }

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    const cleanCodeName = isPrivate && canManagePrivacy
      ? validateName(normalizeCodeName(codeName), fail, 'codeName')
      : null
    if (isPrivate && canManagePrivacy && !cleanCodeName) return
    const check = validateProjectClient(clientId)
    if (!check.ok) {
      fail('client', check.errors[0])
      return
    }
    if (!validateHex(color, fail)) return
    // Surface a store-side rejection (e.g. a clientId that isn't in this company) as a form error
    // instead of an uncaught React error — see the store CRUD contract.
    try {
      const privacy = canManagePrivacy
        ? {
            isPrivate: isPrivate || undefined,
            codeName: isPrivate ? cleanCodeName ?? undefined : undefined,
          }
        : {}
      if (project) update(project.id, { name: trimmed, clientId, color, ...privacy })
      else add({ name: trimmed, clientId, color, ...privacy })
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
      <TextField label={m.form_project_name_label()} value={name} onChange={setName} autoFocus={!protectedName} required disabled={protectedName} invalid={errorField === 'name'} describedById={errorId} />
      {protectedName && <p className="text-xs text-muted">{m.form_private_owner_only_hint()}</p>}
      {canManagePrivacy && (
        <SwitchField
          label={m.form_private_toggle_label()}
          description={m.form_private_toggle_description()}
          checked={isPrivate}
          onChange={setIsPrivate}
        />
      )}
      {canManagePrivacy && isPrivate && (
        <>
          <TextField
            label={m.form_private_code_name_label()}
            value={codeName}
            onChange={setCodeName}
            placeholder={m.form_private_code_name_placeholder()}
            required
            invalid={errorField === 'codeName'}
            describedById={errorId}
          />
          <p className="text-xs text-muted">{m.form_private_code_name_hint()}</p>
        </>
      )}
      <SelectField label={m.form_project_client_label()} value={clientId} onChange={setClientId} options={clientOptions} placeholder={m.form_project_select_client_placeholder()} required invalid={errorField === 'client'} describedById={errorId} />
      <ColorField label={m.form_project_colour_label()} value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
