import type { AllocationStatus, EmploymentType, Resource, ResourceKind, TimeOffType } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'

// Single source of truth for enum presentation. The label maps are exhaustive by type — add a union
// member without a label and tsc fails — and the <select> option arrays are DERIVED from them, so
// there's nothing to keep in sync. (Enum *unions* stay in types/entities.ts; only their labels here.)
//
// i18n: each map and option list is a FUNCTION (not a module const) so it resolves the active
// locale at CALL time. The runtime switches locale without a reload (syncLocaleFromAccount), so a
// const captured at module load would freeze the boot-time language; calling `m.*()` lazily here is
// what keeps an account/locale switch live across every select and label render.

export interface LabelOption {
  value: string
  label: string
}

function toOptions(labels: Record<string, string>): LabelOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export function allocationStatusLabels(): Record<AllocationStatus, string> {
  return {
    confirmed: m.enum_allocation_status_confirmed(),
    tentative: m.enum_allocation_status_tentative(),
    completed: m.enum_allocation_status_completed(),
  }
}

export function employmentTypeLabels(): Record<EmploymentType, string> {
  return {
    permanent: m.enum_employment_type_permanent(),
    freelancer: m.enum_employment_type_freelancer(),
    contractor: m.enum_employment_type_contractor(),
  }
}

export function resourceKindLabels(): Record<ResourceKind, string> {
  return {
    person: m.enum_resource_kind_person(),
    placeholder: m.enum_resource_kind_placeholder(),
    external: m.enum_resource_kind_external(),
  }
}

export function timeOffTypeLabels(): Record<TimeOffType, string> {
  return {
    holiday: m.enum_time_off_type_holiday(),
    sick: m.enum_time_off_type_sick(),
    unpaid: m.enum_time_off_type_unpaid(),
    other: m.enum_time_off_type_other(),
  }
}

/** Primary display name for a placeholder ("slot") resource: the literal word "Placeholder"
 *  (per the product acceptance — derives from the word itself). The resource's own role/discipline
 *  is shown as SECONDARY text by the callers, so we deliberately do NOT fold the role in here or
 *  invent per-slot numbering. One source so the schedule lane, the assignee picker, the command
 *  palette and the Resources list can't drift on what a placeholder is called. The placeholder
 *  feature is gated behind the per-account `placeholdersEnabled` setting on the Account (default off). */
export function placeholderDisplayName(): string {
  return m.placeholder_display_name()
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

export function allocationStatusOptions(): LabelOption[] {
  return toOptions(allocationStatusLabels())
}
export function employmentTypeOptions(): LabelOption[] {
  return toOptions(employmentTypeLabels())
}
export function resourceKindOptions(): LabelOption[] {
  return toOptions(resourceKindLabels())
}
export function timeOffTypeOptions(): LabelOption[] {
  return toOptions(timeOffTypeLabels())
}
