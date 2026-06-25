import type { AllocationStatus, EmploymentType, Resource, ResourceKind, TimeOffType } from '@floaty/shared/types/entities'

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
  external: 'External / 3rd party',
}

export const TIME_OFF_TYPE_LABELS: Record<TimeOffType, string> = {
  holiday: 'Holiday',
  sick: 'Sick',
  unpaid: 'Unpaid',
  other: 'Other',
}

/** Primary display name for a placeholder ("slot") resource: the literal word "Placeholder"
 *  (per the product acceptance — derives from the word itself). The resource's own role/discipline
 *  is shown as SECONDARY text by the callers, so we deliberately do NOT fold the role in here or
 *  invent per-slot numbering. One source so the schedule lane, the assignee picker, the command
 *  palette and the Resources list can't drift on what a placeholder is called. The placeholder
 *  feature is gated behind the per-account `placeholdersEnabled` setting on the Account (default off). */
export function placeholderDisplayName(): string {
  return 'Placeholder'
}

/** The display name for ANY resource: the literal word "Placeholder" for a placeholder ("slot")
 *  resource (per `placeholderDisplayName` above), otherwise the resource's own name (falling back
 *  to its role when unnamed). One source so every render site — the schedule lane + its add button,
 *  the assignee picker, the command palette, and the Resources list (row AND its delete confirm) —
 *  agrees on what a resource is called, and a placeholder can't read as its role in one place while
 *  reading as "Placeholder" everywhere else. No behaviour change for non-placeholders. */
export function resourceDisplayName(r: Resource): string {
  return r.kind === 'placeholder' ? placeholderDisplayName() : (r.name ?? r.role)
}

export const ALLOCATION_STATUS_OPTIONS = toOptions(ALLOCATION_STATUS_LABELS)
export const EMPLOYMENT_TYPE_OPTIONS = toOptions(EMPLOYMENT_TYPE_LABELS)
export const RESOURCE_KIND_OPTIONS = toOptions(RESOURCE_KIND_LABELS)
export const TIME_OFF_TYPE_OPTIONS = toOptions(TIME_OFF_TYPE_LABELS)
