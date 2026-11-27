import { NULLABLE_FIELDS } from '../types/nullableFields.js'
import type { Resource } from '../types/entities.js'

export const makePlaceholder = (over: Partial<Resource> = {}): Resource => ({
  ...NULLABLE_FIELDS.resources,
  id: 'ph1',
  companyId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  kind: 'placeholder',
  jobTitle: 'Senior Designer',
  employmentType: 'permanent',
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#000',
  projectId: 'p1',
  ...over,
  halfDays: over.halfDays ?? [],
})

export const makeUnboundPlaceholder = (): Resource => {
  const resource = makePlaceholder()
  resource.projectId = null
  return resource
}

export const makePerson = (over: Partial<Resource> = {}): Resource => {
  const base = makePlaceholder(over)
  base.projectId = null
  return { ...base, kind: 'person', ...over }
}
