import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { validateHex, validateName } from '../../lib/validation'
import { Button, ColorField, FieldError, Modal, RequiredLegend, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Client } from '@floaty/shared/types/entities'

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
    if (client) updateClient(client.id, { name: trimmed, color })
    else addClient({ name: trimmed, color })
    onClose()
  }

  return (
    <Modal
      title={client ? 'Edit client' : 'Add client'}
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
      <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
