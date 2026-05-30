import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { Button, ColorField, FieldError, Modal, NumberField, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import { isHexColor } from '../../lib/color'
import type { Discipline } from '../../types/entities'

export function DisciplineForm({ discipline, onClose }: { discipline?: Discipline; onClose: () => void }) {
  const add = useStore((s) => s.addDiscipline)
  const update = useStore((s) => s.updateDiscipline)
  // Default a new discipline's sortOrder to one past the current maximum, not the
  // count — using the count collides with an existing order after any deletion or
  // custom ordering, which then falls back to the name tiebreak and lands the new
  // row out of place.
  const disciplines = useScopedData().disciplines
  const nextSortOrder = disciplines.reduce((max, d) => Math.max(max, d.sortOrder + 1), 0)
  const [name, setName] = useState(discipline?.name ?? '')
  const [color, setColor] = useState(discipline?.color ?? DEFAULT_COLORS.discipline)
  const [sortOrder, setSortOrder] = useState(discipline?.sortOrder ?? nextSortOrder)
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
