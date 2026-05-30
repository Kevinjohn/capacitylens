import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { Button, ColorField, FieldError, Modal, NumberField, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import { isHexColor } from '../../lib/color'
import type { Discipline } from '../../types/entities'

export function DisciplineForm({ discipline, onClose }: { discipline?: Discipline; onClose: () => void }) {
  const add = useStore((s) => s.addDiscipline)
  const update = useStore((s) => s.updateDiscipline)
  const count = useStore((s) => s.data.disciplines.length)
  const [name, setName] = useState(discipline?.name ?? '')
  const [color, setColor] = useState(discipline?.color ?? DEFAULT_COLORS.discipline)
  const [sortOrder, setSortOrder] = useState(discipline?.sortOrder ?? count)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
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
    if (discipline) update(discipline.id, { name: name.trim(), color, sortOrder })
    else add({ name: name.trim(), color, sortOrder })
    onClose()
  }

  return (
    <Modal
      title={discipline ? 'Edit discipline' : 'Add discipline'}
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
      <NumberField label="Sort order" value={sortOrder} onChange={setSortOrder} min={0} />
      <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
