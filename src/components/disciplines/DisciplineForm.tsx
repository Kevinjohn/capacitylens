import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useActiveScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateHex, validateName } from '../../lib/validation'
import { m } from '@/i18n'
import { Button, ColorField, FieldError, Modal, RequiredLegend, TextField } from '../common/ui'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { Discipline } from '@capacitylens/shared/types/entities'

/** Add (no `discipline`) or edit a discipline: name + colour. `sortOrder` is auto-assigned (one past
 *  the current max, not the count — see below). `onClose` fires on save or cancel. */
export function DisciplineForm({ discipline, onClose }: { discipline?: Discipline; onClose: () => void }) {
  const add = useStore((s) => s.addDiscipline)
  const update = useStore((s) => s.updateDiscipline)
  // sortOrder is assigned automatically (no longer user-editable): a new discipline
  // lands one past the current maximum — not the count, which would collide with an
  // existing order after a deletion and fall back to the name tiebreak out of place.
  // An existing discipline keeps whatever order it already had.
  const disciplines = useActiveScopedData().disciplines
  const nextSortOrder = disciplines.reduce((max, d) => Math.max(max, d.sortOrder + 1), 0)
  const [name, setName] = useState(discipline?.name ?? '')
  const [color, setColor] = useState(discipline?.color ?? DEFAULT_COLORS.discipline)
  const sortOrder = discipline?.sortOrder ?? nextSortOrder
  const { error, errorField, errorId, fail } = useFieldError()

  const submit = () => {
    const trimmed = validateName(name, fail)
    if (!trimmed) return
    if (!validateHex(color, fail)) return
    // Surface a store-side rejection as a form error rather than an uncaught React error — see the
    // store CRUD contract.
    try {
      if (discipline) update(discipline.id, { name: trimmed, color, sortOrder })
      else add({ name: trimmed, color, sortOrder })
      onClose()
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <Modal
      title={discipline ? m.form_discipline_edit_title() : m.form_discipline_add_title()}
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
      <TextField label={m.form_discipline_name_label()} value={name} onChange={setName} autoFocus required invalid={errorField === 'name'} describedById={errorId} />
      <ColorField label={m.form_discipline_colour_label()} value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </Modal>
  )
}
