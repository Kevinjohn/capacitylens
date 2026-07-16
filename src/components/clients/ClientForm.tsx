import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateHex, validateName } from '../../lib/validation'
import { normalizeCodeName } from '@capacitylens/shared/domain/privateNames'
import { canSeePrivateNames } from '@capacitylens/shared/domain/access'
import { useRole } from '../../auth/permissionContext'
import { m } from '@/i18n'
import { Button, ColorField, FieldError, Modal, RequiredLegend, SwitchField, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Client } from '@capacitylens/shared/types/entities'

/** Add (no `client`) or edit a client: name + preset colour. `onClose` fires on save or cancel. */
export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)
  const role = useRole()
  const canManagePrivacy = role === null || canSeePrivateNames(role)
  const protectedName = client?.isPrivate === true && !canManagePrivacy
  const [name, setName] = useState(client?.name ?? '')
  const [color, setColor] = useState(client?.color ?? DEFAULT_COLORS.client)
  const [isPrivate, setIsPrivate] = useState(client?.isPrivate ?? false)
  const [codeName, setCodeName] = useState(client?.codeName ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    const cleanCodeName = isPrivate && canManagePrivacy
      ? validateName(normalizeCodeName(codeName), fail, 'codeName')
      : null
    if (isPrivate && canManagePrivacy && !cleanCodeName) return
    if (!validateHex(color, fail)) return
    // The store throws (with a display-safe message) on a tenancy/integrity rejection — surface it
    // as a form error rather than letting it escape as an uncaught React error. (See the store CRUD
    // contract.) Today the form's own validation precedes it, but the SQLite server seam adds real
    // failure modes, and a caught-and-shown message is the standard.
    try {
      const privacy = canManagePrivacy
        ? {
            isPrivate: isPrivate || undefined,
            codeName: isPrivate ? cleanCodeName ?? undefined : undefined,
          }
        : {}
      if (client) updateClient(client.id, { name: trimmed, color, ...privacy })
      else addClient({ name: trimmed, color, ...privacy })
      onClose()
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <Modal
      title={client ? m.form_client_edit_title() : m.form_client_add_title()}
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
      <TextField label={m.form_client_name_label()} value={name} onChange={setName} autoFocus={!protectedName} required disabled={protectedName} invalid={errorField === 'name'} describedById={errorId} />
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
      <ColorField label={m.form_client_colour_label()} value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </Modal>
  )
}
