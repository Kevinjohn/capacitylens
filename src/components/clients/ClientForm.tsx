import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { Button, ColorField, FieldError, Modal, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Client } from '../../types/entities'

export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)
  const [name, setName] = useState(client?.name ?? '')
  const [color, setColor] = useState(client?.color ?? DEFAULT_COLORS.client)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!name.trim()) {
      setError('Name is required.')
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
      <TextField label="Name" value={name} onChange={setName} autoFocus />
      <ColorField label="Colour" value={color} onChange={setColor} />
      <FieldError>{error}</FieldError>
    </Modal>
  )
}
