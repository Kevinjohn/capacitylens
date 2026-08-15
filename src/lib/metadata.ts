import type { AllocationStatus, Resource, ResourceEngagement, TimeOffType } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";

// Single source of truth for enum presentation. Each enum gets ONE message table, exhaustive by
// type — add a union member without an entry and tsc fails — and everything else (the single-value
// label getter, the label map, the <select> option array) is DERIVED from that table, so there's
// nothing to keep in sync. (Enum *unions* stay in types/entities.ts; only their labels here.)
//
// i18n: a table holds its message functions UNCALLED, and every exported accessor invokes them, so
// the active locale is resolved at CALL time. The runtime switches locale without a reload
// (syncLocaleFromAccount), so a resolved string captured at module load would freeze the boot-time
// language; keeping resolution lazy here is what keeps an account/locale switch live across every
// select and label render.

/** A `<select>`/segmented-control option. `V` carries the enum union through the derivation, so a
 *  caller binding `options={allocationStatusOptions()}` gets `value: AllocationStatus` rather than a
 *  widened `string` it would have to re-assert. */
export interface LabelOption<V extends string = string> {
  value: V;
  label: string;
}

/** One uncalled message reference per union member — the per-enum source list. Exported alongside
 *  {@link labelsFrom} so a caller outside this file can name the shape it must build. */
export type LabelMessages<K extends string> = Record<K, () => string>;

/** Resolve a whole message table to strings, in its declaration order. Exported so a surface with an
 *  enum table of its OWN (a settings section's per-option copy, say) derives its labels through the
 *  same lazy-resolution rule rather than hand-rolling a second `Object.keys` loop that a locale
 *  switch would then have to be re-audited against. */
export function labelsFrom<K extends string>(messages: LabelMessages<K>): Record<K, string> {
  const labels = {} as Record<K, string>;
  for (const key of Object.keys(messages) as K[]) labels[key] = messages[key]();
  return labels;
}

/** Turn a resolved label map into `<select>` options, preserving key order. Exported for the same
 *  reason as {@link labelsFrom}: option lists built elsewhere keep this file's `LabelOption` shape
 *  and its value-typing, instead of a parallel `.map` that widens `value` back to `string`. */
export function toOptions<K extends string>(labels: Record<K, string>): LabelOption<K>[] {
  return (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));
}

const allocationStatusMessages: LabelMessages<AllocationStatus> = {
  confirmed: m.enum_allocation_status_confirmed,
  tentative: m.enum_allocation_status_tentative,
  completed: m.enum_allocation_status_completed,
};

const resourceEngagementMessages: LabelMessages<ResourceEngagement> = {
  studio: m.enum_resource_engagement_studio,
  supplementary: m.enum_resource_engagement_supplementary,
};

const timeOffTypeMessages: LabelMessages<TimeOffType> = {
  holiday: m.enum_time_off_type_holiday,
  sick: m.enum_time_off_type_sick,
  unpaid: m.enum_time_off_type_unpaid,
  other: m.enum_time_off_type_other,
};

/** Label for ONE allocation status — for the render sites that hold a single status and would
 *  otherwise build (and discard) the whole map to read one key out of it. */
export function allocationStatusLabel(status: AllocationStatus): string {
  return allocationStatusMessages[status]();
}

/** Label for ONE time-off type. See {@link allocationStatusLabel}. */
export function timeOffTypeLabel(type: TimeOffType): string {
  return timeOffTypeMessages[type]();
}

export function allocationStatusLabels(): Record<AllocationStatus, string> {
  return labelsFrom(allocationStatusMessages);
}

export function timeOffTypeLabels(): Record<TimeOffType, string> {
  return labelsFrom(timeOffTypeMessages);
}

/** Primary display name for a placeholder ("slot") resource: the literal word "Placeholder"
 *  (per the product acceptance — derives from the word itself). The resource's own role/discipline
 *  is shown as SECONDARY text by the callers, so we deliberately do NOT fold the role in here or
 *  invent per-slot numbering. One source so the schedule lane, the assignee picker, the command
 *  palette and the Resources list can't drift on what a placeholder is called. The placeholder
 *  feature is gated behind the per-account `placeholdersEnabled` setting on the Account (default off). */
export function placeholderDisplayName(): string {
  return m.placeholder_display_name();
}

/** The display name for ANY resource: the literal word "Placeholder" for a placeholder ("slot")
 *  resource (per `placeholderDisplayName` above), otherwise the resource's own name (falling back
 *  to its role when unnamed). One source so every render site — the schedule lane + its add button,
 *  the assignee picker, the command palette, and the Resources list (row AND its delete confirm) —
 *  agrees on what a resource is called, and a placeholder can't read as its role in one place while
 *  reading as "Placeholder" everywhere else. No behaviour change for non-placeholders. */
export function resourceDisplayName(r: Resource): string {
  if (r.kind === "placeholder") return placeholderDisplayName();
  const name = r.name?.trim();
  return name || r.role;
}

export function allocationStatusOptions(): LabelOption<AllocationStatus>[] {
  return toOptions(allocationStatusLabels());
}
export function resourceEngagementOptions(): LabelOption<ResourceEngagement>[] {
  return toOptions(labelsFrom(resourceEngagementMessages));
}
export function timeOffTypeOptions(): LabelOption<TimeOffType>[] {
  return toOptions(timeOffTypeLabels());
}
