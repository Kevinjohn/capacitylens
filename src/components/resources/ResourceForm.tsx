import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { disciplinesEnabledFor } from '../../store/selectors'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { errorMessage } from '../../lib/errorMessage'
import { validateText, validateWorkingDays } from '../../lib/validation'
import { m } from '@/i18n'
import {
  Button,
  FieldError,
  Modal,
  NumberField,
  RequiredLegend,
  SelectField,
  TextField,
  WeekdayPicker,
  type Option,
} from '../common/ui'
import { EMPLOYMENT_TYPE_OPTIONS } from '../../lib/metadata'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { EmploymentType, Resource, ResourceKind, Weekday } from '@capacitylens/shared/types/entities'

/**
 * Add/edit a person or a placeholder. The richest validation path in the app.
 *
 * @param resource the resource to edit, or undefined to add a new one.
 * @param kind     the kind for a NEW resource ('person' | 'placeholder'); ignored when editing
 *   (an existing resource's own `kind` wins). The form opens LOCKED to one kind — people and
 *   placeholders have separate add buttons, so there's no in-modal type switcher.
 * @param onClose  called after a successful save, or on cancel.
 *
 * Non-obvious rules enforced here: a PERSON requires a name (a placeholder's is optional); a
 * PLACEHOLDER must be bound to a project; working hours/day must be > 0 and at least one working
 * day must be selected (a zero-capacity resource reads as permanently over-allocated); and a
 * resource's colour is DERIVED from its discipline (no per-resource colour control — see DECISIONS).
 */
export function ResourceForm({ resource, kind: kindProp, onClose }: { resource?: Resource; kind?: ResourceKind; onClose: () => void }) {
  const add = useStore((s) => s.addResource)
  const update = useStore((s) => s.updateResource)
  const data = useScopedData()
  // When the account doesn't use disciplines, hide the picker. Any existing disciplineId
  // on an edited resource is left untouched (the field just isn't shown).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  const disciplines = data.disciplines
  const projects = data.projects
  const clients = data.clients

  const kind = resource?.kind ?? kindProp ?? 'person'
  const isPlaceholder = kind === 'placeholder'
  const [name, setName] = useState(resource?.name ?? '')
  const [role, setRole] = useState(resource?.role ?? '')
  const [disciplineId, setDisciplineId] = useState(resource?.disciplineId ?? '')
  const [employmentType, setEmploymentType] = useState<EmploymentType>(resource?.employmentType ?? 'permanent')
  const [hours, setHours] = useState(resource?.workingHoursPerDay ?? 8)
  const [workingDays, setWorkingDays] = useState<Weekday[]>(resource?.workingDays ?? [1, 2, 3, 4, 5])
  const [projectId, setProjectId] = useState(resource?.projectId ?? '')
  const { error, errorField, errorId, fail } = useFieldError()

  const disciplineOptions: Option[] = disciplines.map((d) => ({ value: d.id, label: d.name }))
  const projectOptions: Option[] = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId)
    return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
  })

  const submit = () => {
    // A person needs a name; a placeholder's is optional. Either way, reject emoji/junk.
    const cleanName = validateText(name, fail, {
      field: 'name',
      required: !isPlaceholder,
      requiredMessage: m.form_resource_err_name_required(),
    })
    if (cleanName === null) return
    const cleanRole = validateText(role, fail, { field: 'role', required: false })
    if (cleanRole === null) return
    if (isPlaceholder && !projectId) {
      fail('projectId', m.form_resource_err_placeholder_project())
      return
    }
    if (!(hours > 0)) {
      fail('hours', m.form_resource_err_hours_gt_zero())
      return
    }
    // A resource with zero working days has zero capacity every day (reads as
    // permanently over-allocated), so at least one weekday must be selected.
    if (!validateWorkingDays(workingDays, fail)) return
    const patch = {
      kind,
      name: cleanName ? cleanName : undefined,
      role: cleanRole,
      disciplineId: disciplineId || undefined,
      employmentType: isPlaceholder ? ('permanent' as const) : employmentType,
      workingHoursPerDay: hours,
      workingDays,
      projectId: isPlaceholder ? projectId : undefined,
      // Resources no longer carry their own colour — the scheduler/list derive it
      // from the discipline. Keep a stable fallback so the entity stays valid.
      color: resource?.color ?? DEFAULT_COLORS.resource,
    }
    // Surface a store-side rejection (e.g. a dangling disciplineId/placeholder projectId, or the
    // empty-working-days backstop) as a form error rather than an uncaught React error — see the
    // store CRUD contract.
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
      title={
        resource
          ? isPlaceholder
            ? m.form_resource_edit_placeholder_title()
            : m.form_resource_edit_resource_title()
          : isPlaceholder
            ? m.form_resource_add_placeholder_title()
            : m.form_resource_add_resource_title()
      }
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
      <TextField label={isPlaceholder ? m.form_resource_name_optional_label() : m.form_resource_name_label()} value={name} onChange={setName} required={!isPlaceholder} invalid={errorField === 'name'} describedById={errorId} />
      <TextField label={m.form_resource_role_label()} value={role} onChange={setRole} placeholder={m.form_resource_role_placeholder()} invalid={errorField === 'role'} describedById={errorId} />
      {disciplinesEnabled && (
        <SelectField label={m.form_resource_discipline_label()} value={disciplineId} onChange={setDisciplineId} options={disciplineOptions} placeholder={m.form_resource_discipline_none_placeholder()} />
      )}
      {!isPlaceholder && (
        <SelectField
          label={m.form_resource_employment_label()}
          value={employmentType}
          onChange={(v) => setEmploymentType(v as EmploymentType)}
          options={EMPLOYMENT_TYPE_OPTIONS}
        />
      )}
      {isPlaceholder && (
        <SelectField label={m.form_resource_bound_project_label()} value={projectId} onChange={setProjectId} options={projectOptions} placeholder={m.form_resource_select_project_placeholder()} required invalid={errorField === 'projectId'} describedById={errorId} />
      )}
      <NumberField label={m.form_resource_working_hours_label()} value={hours} onChange={setHours} min={0} max={24} invalid={errorField === 'hours'} describedById={errorId} />
      <WeekdayPicker label={m.form_resource_working_days_label()} value={workingDays} onChange={setWorkingDays} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
