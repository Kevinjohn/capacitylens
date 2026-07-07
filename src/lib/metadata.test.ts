import { describe, it, expect } from 'vitest'
import { m } from '@/i18n'
import {
  allocationStatusLabels,
  allocationStatusOptions,
  employmentTypeLabels,
  employmentTypeOptions,
  resourceKindLabels,
  resourceKindOptions,
  timeOffTypeLabels,
  timeOffTypeOptions,
  resourceDisplayName,
  placeholderDisplayName,
} from './metadata'
import type { Resource } from '@capacitylens/shared/types/entities'

const makeResource = (over: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  accountId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  kind: 'person',
  role: 'Developer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#000',
  ...over,
})

describe('employmentTypeLabels', () => {
  it('maps every EmploymentType to its resolved message', () => {
    expect(employmentTypeLabels()).toEqual({
      permanent: m.enum_employment_type_permanent(),
      freelancer: m.enum_employment_type_freelancer(),
      contractor: m.enum_employment_type_contractor(),
    })
  })
})

describe('timeOffTypeLabels', () => {
  it('maps every TimeOffType to its resolved message', () => {
    expect(timeOffTypeLabels()).toEqual({
      holiday: m.enum_time_off_type_holiday(),
      sick: m.enum_time_off_type_sick(),
      unpaid: m.enum_time_off_type_unpaid(),
      other: m.enum_time_off_type_other(),
    })
  })
})

describe('resourceKindLabels', () => {
  it('maps every ResourceKind to its resolved message', () => {
    expect(resourceKindLabels()).toEqual({
      person: m.enum_resource_kind_person(),
      placeholder: m.enum_resource_kind_placeholder(),
      external: m.enum_resource_kind_external(),
    })
  })
})

describe('allocationStatusLabels', () => {
  it('maps every AllocationStatus to its resolved message', () => {
    expect(allocationStatusLabels()).toEqual({
      confirmed: m.enum_allocation_status_confirmed(),
      tentative: m.enum_allocation_status_tentative(),
      completed: m.enum_allocation_status_completed(),
    })
  })
})

describe('toOptions-derived option lists', () => {
  it('resourceKindOptions turns the label map into {value,label} pairs', () => {
    const options = resourceKindOptions()
    expect(options).toEqual([
      { value: 'person', label: m.enum_resource_kind_person() },
      { value: 'placeholder', label: m.enum_resource_kind_placeholder() },
      { value: 'external', label: m.enum_resource_kind_external() },
    ])
  })

  it('employmentTypeOptions / allocationStatusOptions / timeOffTypeOptions each round-trip their label map', () => {
    for (const [value, label] of Object.entries(employmentTypeLabels())) {
      expect(employmentTypeOptions()).toContainEqual({ value, label })
    }
    for (const [value, label] of Object.entries(allocationStatusLabels())) {
      expect(allocationStatusOptions()).toContainEqual({ value, label })
    }
    for (const [value, label] of Object.entries(timeOffTypeLabels())) {
      expect(timeOffTypeOptions()).toContainEqual({ value, label })
    }
  })
})

describe('resourceDisplayName / placeholderDisplayName', () => {
  it('shows the literal "Placeholder" name for a placeholder resource', () => {
    const r = makeResource({ kind: 'placeholder', name: 'Slot 1' })
    expect(resourceDisplayName(r)).toBe(placeholderDisplayName())
    expect(resourceDisplayName(r)).not.toBe('Slot 1')
  })

  it('shows the resource\'s own name for a non-placeholder resource', () => {
    const r = makeResource({ kind: 'person', name: 'Tyler Nix' })
    expect(resourceDisplayName(r)).toBe('Tyler Nix')
  })

  it('falls back to role when a non-placeholder resource is unnamed', () => {
    const r = makeResource({ kind: 'external', name: undefined, role: 'Consultant' })
    expect(resourceDisplayName(r)).toBe('Consultant')
  })
})
