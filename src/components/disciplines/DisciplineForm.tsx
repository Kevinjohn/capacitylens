import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { validateHex, validateName } from '../../lib/validation'
import { Button, ColorField, FieldError, Modal, NumberField, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
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
  const { error, errorField, errorId, fail } = useFieldError()

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    if (!validateHex(color, fail)) return
    if (discipline) update(discipline.id, { name: trimmed, color, sortOrder })
    else add({ name: trimmed, color, sortOrder })
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
