import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useFieldError } from '../../hooks/useFieldError'
import { validateHex } from '../../lib/validation'
import {
  Button,
  ColorField,
  FieldError,
  Modal,
  NumberField,
  SelectField,
  TextField,
  WeekdayPicker,
  type Option,
} from '../common/ui'
import { EMPLOYMENT_TYPE_OPTIONS, RESOURCE_KIND_OPTIONS } from '../../lib/metadata'
import { DEFAULT_COLORS } from '../../lib/palette'
import type { EmploymentType, Resource, ResourceKind, Weekday } from '@floaty/shared/types/entities'

export function ResourceForm({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const add = useStore((s) => s.addResource)
  const update = useStore((s) => s.updateResource)
  const data = useScopedData()
  const disciplines = data.disciplines
  const projects = data.projects
  const clients = data.clients

  const [kind, setKind] = useState<ResourceKind>(resource?.kind ?? 'person')
  const [name, setName] = useState(resource?.name ?? '')
  const [role, setRole] = useState(resource?.role ?? '')
  const [disciplineId, setDisciplineId] = useState(resource?.disciplineId ?? '')
  const [employmentType, setEmploymentType] = useState<EmploymentType>(resource?.employmentType ?? 'permanent')
  const [hours, setHours] = useState(resource?.workingHoursPerDay ?? 8)
  const [workingDays, setWorkingDays] = useState<Weekday[]>(resource?.workingDays ?? [1, 2, 3, 4, 5])
  const [projectId, setProjectId] = useState(resource?.projectId ?? '')
  const [color, setColor] = useState(resource?.color ?? DEFAULT_COLORS.resource)
  const { error, errorField, errorId, fail } = useFieldError()

  const disciplineOptions: Option[] = disciplines.map((d) => ({ value: d.id, label: d.name }))
  const projectOptions: Option[] = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId)
    return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
  })

  const submit = () => {
    if (!role.trim()) {
      fail('role', 'Role is required.')
      return
    }
    if (kind === 'person' && !name.trim()) {
      fail('name', 'Name is required for a person.')
      return
    }
    if (kind === 'placeholder' && !projectId) {
      fail('projectId', 'A placeholder must be bound to a project.')
      return
    }
    if (!(hours > 0)) {
      fail('hours', 'Working hours per day must be greater than 0.')
      return
    }
    if (!validateHex(color, fail)) return
    const patch = {
      kind,
      name: name.trim() ? name.trim() : undefined,
      role: role.trim(),
      disciplineId: disciplineId || undefined,
      employmentType: kind === 'placeholder' ? ('permanent' as const) : employmentType,
      workingHoursPerDay: hours,
      workingDays,
      projectId: kind === 'placeholder' ? projectId : undefined,
      color,
    }
    if (resource) update(resource.id, patch)
    else add(patch)
    onClose()
  }

  return (
    <Modal
      title={resource ? 'Edit resource' : 'Add resource'}
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
      <SelectField label="Type" value={kind} onChange={(v) => setKind(v as ResourceKind)} options={RESOURCE_KIND_OPTIONS} />
      <TextField label={kind === 'placeholder' ? 'Name (optional)' : 'Name'} value={name} onChange={setName} invalid={errorField === 'name'} describedById={errorId} />
      <TextField label="Role" value={role} onChange={setRole} placeholder="e.g. Senior Designer" invalid={errorField === 'role'} describedById={errorId} />
      <SelectField label="Discipline" value={disciplineId} onChange={setDisciplineId} options={disciplineOptions} placeholder="— None —" />
      {kind === 'person' && (
        <SelectField
          label="Employment"
          value={employmentType}
          onChange={(v) => setEmploymentType(v as EmploymentType)}
          options={EMPLOYMENT_TYPE_OPTIONS}
        />
      )}
      {kind === 'placeholder' && (
        <SelectField label="Bound project" value={projectId} onChange={setProjectId} options={projectOptions} placeholder="— Select project —" invalid={errorField === 'projectId'} describedById={errorId} />
      )}
      <NumberField label="Working hours / day" value={hours} onChange={setHours} min={0} max={24} invalid={errorField === 'hours'} describedById={errorId} />
      <WeekdayPicker label="Working days" value={workingDays} onChange={setWorkingDays} />
      <ColorField label="Colour" value={color} onChange={setColor} invalid={errorField === 'color'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
