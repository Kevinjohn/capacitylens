import type { AllocationStatus, Resource, ResourceEngagement, TimeOffType } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";

// Exhaustive message-function tables keep enum presentation synchronized. Resolve
// functions only at lookup so account locale changes cannot reuse import-time copy.

/** A `<select>`/segmented-control option. `V` carries the enum union through the derivation, so a
 * caller binding `options={buildAllocationStatusOptions()}` gets `value: AllocationStatus` rather than a
 * widened `string` it would have to re-assert. */
export interface LabelOption<V extends string = string> {
  value: V;
  label: string;
}

/** One uncalled localized message function per enum member. */
export type LabelMessages<K extends string> = Record<K, () => string>;

/** Resolves a message table in declaration order using the current locale. */
export function buildLabels<K extends string>(messages: LabelMessages<K>): Record<K, string> {
  const labels = {} as Record<K, string>;
  for (const key of Object.keys(messages) as K[]) labels[key] = messages[key]();
  return labels;
}

/** Converts labels into typed control options while preserving key order. */
export function buildLabelOptions<K extends string>(labels: Record<K, string>): LabelOption<K>[] {
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

function resolveMessage<K extends string>(messages: Partial<LabelMessages<K>>, key: K): string {
  return messages[key]?.() ?? "";
}

function resolveTrimmedValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? fallback : trimmed;
}

/** Label for one allocation status, for the render sites that hold a single status and would
 * otherwise build (and discard) the whole map to read one key out of it. An unrecognised runtime
 * value from legacy or hand-edited data renders blank instead of taking down the scheduler. */
export function resolveAllocationStatusLabel(status: AllocationStatus): string {
  return resolveMessage(allocationStatusMessages, status);
}

/** Resolve the status text shown on detail surfaces. Confirmed is the implicit default, so it
 * needs no annotation; exceptional statuses retain their translated labels. */
export function resolveAllocationStatusAnnotation(status: AllocationStatus): string | null {
  const label = resolveAllocationStatusLabel(status);
  return status === "confirmed" || label === "" ? null : label;
}

/** Label for one time-off type, with the same blank fallback as {@link resolveAllocationStatusLabel}. */
export function resolveTimeOffTypeLabel(type: TimeOffType): string {
  return resolveMessage(timeOffTypeMessages, type);
}

/** Builds localised labels for every allocation status. */
export function buildAllocationStatusLabels(): Record<AllocationStatus, string> {
  return buildLabels(allocationStatusMessages);
}

/** Builds localised labels for every time-off type. */
export function buildTimeOffTypeLabels(): Record<TimeOffType, string> {
  return buildLabels(timeOffTypeMessages);
}

/** Returns the localized placeholder label; role and discipline remain separate secondary text. */
export function resolvePlaceholderDisplayName(): string {
  return m.placeholder_display_name();
}

/** Returns the placeholder label for slots, otherwise the resource name with role fallback. */
export function resolveResourceDisplayName(resource: Resource): string {
  if (resource.kind === "placeholder") return resolvePlaceholderDisplayName();
  return resolveTrimmedValue(resource.name, resource.role);
}

/** Builds allocation status choices for form controls. */
export function buildAllocationStatusOptions(): LabelOption<AllocationStatus>[] {
  return buildLabelOptions(buildAllocationStatusLabels());
}
/** Builds resource engagement choices for form controls. */
export function buildResourceEngagementOptions(): LabelOption<ResourceEngagement>[] {
  return buildLabelOptions(buildLabels(resourceEngagementMessages));
}
/** Builds time-off type choices for form controls. */
export function buildTimeOffTypeOptions(): LabelOption<TimeOffType>[] {
  return buildLabelOptions(buildTimeOffTypeLabels());
}
