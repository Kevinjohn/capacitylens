import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { validateHex, validateName } from '../../lib/validation'
import { Button, ColorField, FieldError, Modal, RequiredLegend, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Discipline } from '@floaty/shared/types/entities'

export function DisciplineForm({ discipline, onClose }: { discipline?: Discipline; onClose: () => void }) {
  const add = useStore((s) => s.addDiscipline)
  const update = useStore((s) => s.updateDiscipline)
  // sortOrder is assigned automatically (no longer user-editable): a new discipline
  // lands one past the current maximum — not the count, which would collide with an
  // existing order after a deletion and fall back to the name tiebreak out of place.
  // An existing discipline keeps whatever order it already had.
  const disciplines = useScopedData().disciplines
  const nextSortOrder = disciplines.reduce((max, d) => Math.max(max, d.sortOrder + 1), 0)
  const [name, setName] = useState(discipline?.name ?? '')
  const [color, setColor] = useState(discipline?.color ?? DEFAULT_COLORS.discipline)
  const sortOrder = discipline?.sortOrder ?? nextSortOrder
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
