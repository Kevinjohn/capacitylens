import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateText } from '../../lib/validation'
import { m } from '@/i18n'
import { Button, FieldError, Modal, RequiredLegend, TextField } from '../common/ui'
import { NEUTRAL_COLOR } from '../../lib/palette'
import { externalCapacityDefaults } from '@capacitylens/shared/types/entities'
import type { Resource } from '@capacitylens/shared/types/entities'

/**
 * Add/edit an external / 3rd-party party — a trimmed resource form. It captures only a COMPANY
 * name (required) and an optional descriptor. The capacity fields (hours, working days, discipline,
 * employment, project) don't apply — externals have no capacity — so they're stored as unused
 * silent defaults the rest of the app never reads. Colour is the single neutral swatch (no picker),
 * per DECISIONS.md "external kind". Store rejections surface as a form error, like ResourceForm.
 */
export function ExternalForm({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const add = useStore((s) => s.addResource)
  const update = useStore((s) => s.updateResource)
  const [name, setName] = useState(resource?.name ?? '')
  const [role, setRole] = useState(resource?.role ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const submit = () => {
    const cleanName = validateText(name, fail, {
      field: 'name',
      required: true,
      requiredMessage: m.form_external_err_company_required(),
    })
    if (cleanName === null) return
    const cleanRole = validateText(role, fail, { field: 'role', required: false })
    if (cleanRole === null) return
    const patch = {
      kind: 'external' as const,
      name: cleanName,
      role: cleanRole,
      // Capacity fields don't apply to an external — store the unused silent defaults (ONE source,
      // shared with seed + fixtures) so the entity stays valid (the store asserts a non-empty working
      // week + positive hours) while the scheduler / forms never show or read them.
      ...externalCapacityDefaults(),
      color: NEUTRAL_COLOR,
    }
    try {
      if (resource) update(resource.id, patch)
      else add(patch)
      onClose()
    } catch (e) {
      fail(null, errorMessage(e))
    }
  }

  return (
    <Modal
      title={resource ? m.form_external_edit_title() : m.form_external_add_title()}
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
      <TextField label={m.form_external_company_label()} value={name} onChange={setName} required invalid={errorField === 'name'} describedById={errorId} />
      <TextField label={m.form_external_descriptor_label()} value={role} onChange={setRole} placeholder={m.form_external_descriptor_placeholder()} invalid={errorField === 'role'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </Modal>
  )
}
