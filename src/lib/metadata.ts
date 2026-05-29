import type { AllocationStatus, EmploymentType, ResourceKind, TimeOffType } from '../types/entities'

// Single source of truth for enum presentation. The `Record<Enum, string>` maps
// are exhaustive by type — add a union member without a label and tsc fails — and
// the <select> option arrays are DERIVED from them, so there's nothing to keep in
// sync. (Enum *unions* stay in types/entities.ts; only their labels live here.)

export interface LabelOption {
  value: string
  label: string
}

function toOptions(labels: Record<string, string>): LabelOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  confirmed: 'Confirmed',
  tentative: 'Tentative',
  completed: 'Completed',
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  permanent: 'Permanent',
  freelancer: 'Freelancer',
  contractor: 'Contractor',
}

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  person: 'Person',
  placeholder: 'Placeholder',
}

export const TIME_OFF_TYPE_LABELS: Record<TimeOffType, string> = {
  holiday: 'Holiday',
  sick: 'Sick',
  unpaid: 'Unpaid',
  other: 'Other',
}

export const ALLOCATION_STATUS_OPTIONS = toOptions(ALLOCATION_STATUS_LABELS)
export const EMPLOYMENT_TYPE_OPTIONS = toOptions(EMPLOYMENT_TYPE_LABELS)
export const RESOURCE_KIND_OPTIONS = toOptions(RESOURCE_KIND_LABELS)
export const TIME_OFF_TYPE_OPTIONS = toOptions(TIME_OFF_TYPE_LABELS)
