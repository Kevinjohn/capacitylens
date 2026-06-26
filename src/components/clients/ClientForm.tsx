import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateHex, validateName } from '../../lib/validation'
import { m } from '@/i18n'
import { Button, ColorField, FieldError, Modal, RequiredLegend, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Client } from '@capacitylens/shared/types/entities'

/** Add (no `client`) or edit a client: name + preset colour. `onClose` fires on save or cancel. */
export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)
  const [name, setName] = useState(client?.name ?? '')
  const [color, setColor] = useState(client?.color ?? DEFAULT_COLORS.client)
  const { error, errorField, errorId, fail } = useFieldError()

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    if (!validateHex(color, fail)) return
    // The store throws (with a display-safe message) on a tenancy/integrity rejection — surface it
    // as a form error rather than letting it escape as an uncaught React error. (See the store CRUD
    // contract.) Today the form's own validation precedes it, but the SQLite server seam adds real
    // failure modes, and a caught-and-shown message is the standard.
    try {
      if (client) updateClient(client.id, { name: trimmed, color })
      else addClient({ name: trimmed, color })
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
      <RequiredLegend />
      <TextField label={m.form_client_name_label()} value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <ColorField label={m.form_client_colour_label()} value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
