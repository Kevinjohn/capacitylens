import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { validateText } from '../../lib/validation'
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
import type { EmploymentType, Resource, ResourceKind, Weekday } from '@floaty/shared/types/entities'

// People and placeholders now have their own add buttons, so the form opens locked
// to a single kind (taken from the resource being edited, or the `kind` the caller
// chose for a new one) — no in-modal type switcher.
export function ResourceForm({ resource, kind: kindProp, onClose }: { resource?: Resource; kind?: ResourceKind; onClose: () => void }) {
  const add = useStore((s) => s.addResource)
  const update = useStore((s) => s.updateResource)
  const data = useScopedData()
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
      requiredMessage: 'Name is required for a person.',
    })
    if (cleanName === null) return
    const cleanRole = validateText(role, fail, { field: 'role', required: false })
    if (cleanRole === null) return
    if (isPlaceholder && !projectId) {
      fail('projectId', 'A placeholder must be bound to a project.')
      return
    }
    if (!(hours > 0)) {
      fail('hours', 'Working hours per day must be greater than 0.')
      return
    }
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
    if (resource) update(resource.id, patch)
    else add(patch)
    onClose()
  }

  return (
    <Modal
      title={`${resource ? 'Edit' : 'Add'} ${isPlaceholder ? 'placeholder' : 'resource'}`}
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
      <RequiredLegend />
      <TextField label={isPlaceholder ? 'Name (optional)' : 'Name'} value={name} onChange={setName} required={!isPlaceholder} invalid={errorField === 'name'} describedById={errorId} />
      <TextField label="Role" value={role} onChange={setRole} placeholder="e.g. Senior Designer" invalid={errorField === 'role'} describedById={errorId} />
      <SelectField label="Discipline" value={disciplineId} onChange={setDisciplineId} options={disciplineOptions} placeholder="— None —" />
      {!isPlaceholder && (
        <SelectField
          label="Employment"
          value={employmentType}
          onChange={(v) => setEmploymentType(v as EmploymentType)}
          options={EMPLOYMENT_TYPE_OPTIONS}
        />
      )}
      {isPlaceholder && (
        <SelectField label="Bound project" value={projectId} onChange={setProjectId} options={projectOptions} placeholder="— Select project —" required invalid={errorField === 'projectId'} describedById={errorId} />
      )}
      <NumberField label="Working hours / day" value={hours} onChange={setHours} min={0} max={24} invalid={errorField === 'hours'} describedById={errorId} />
      <WeekdayPicker label="Working days" value={workingDays} onChange={setWorkingDays} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
