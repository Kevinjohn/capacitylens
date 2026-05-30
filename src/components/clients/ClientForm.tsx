import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { Button, ColorField, FieldError, Modal, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import { isHexColor } from '../../lib/color'
import type { Client } from '../../types/entities'

export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)
  const [name, setName] = useState(client?.name ?? '')
  const [color, setColor] = useState(client?.color ?? DEFAULT_COLORS.client)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  // Associate the error with the offending field (aria-invalid + aria-describedby)
  // so it's announced when navigating to that field, not only via the alert.
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }

  const submit = () => {
    if (!name.trim()) {
      fail('name', 'Name is required.')
      return
    }
    if (!isHexColor(color)) {
      fail('color', 'Enter a valid 6-digit hex colour, e.g. #3b82f6.')
      return
    }
    if (client) updateClient(client.id, { name: name.trim(), color })
    else addClient({ name: name.trim(), color })
    onClose()
  }

  return (
    <Modal
      title={client ? 'Edit client' : 'Add client'}
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
      <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
