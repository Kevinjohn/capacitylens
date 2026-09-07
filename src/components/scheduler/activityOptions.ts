import type { Activity, Phase, Project } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import type { Option } from "../common/ui";
import { compareDisplayNames } from "@/lib/displayOrder";

interface BuildActivityOptionsInput {
  activities: readonly Activity[];
  phases: readonly Phase[];
  projects: readonly Project[];
  kind: Activity["kind"];
  projectId?: string | undefined;
}

export type ActivityGroupKey = "all-projects" | "project";

export function resolveGroupKeyForKind(kind: Activity["kind"]): ActivityGroupKey {
  return kind === "repeatable" ? "all-projects" : "project";
}

export function resolveGroupLabelForKind(kind: Activity["kind"]): string {
  return kind === "repeatable" ? m.scheduler_filter_all_projects() : m.form_activity_kind_project();
}

function resolveGroupOrder(groupKey: Option["groupKey"]): number {
  return groupKey === "all-projects" ? 0 : 1;
}

export function sortGroupedOptions(options: readonly Option[]): Option[] {
  return options.toSorted((left, right) => {
    return (
      resolveGroupOrder(left.groupKey) - resolveGroupOrder(right.groupKey) ||
      compareDisplayNames({ leftName: left.label, leftId: left.value, rightName: right.label, rightId: right.value })
    );
  });
}

/** Build alphabetized, distinct activity labels from pre-indexed project and phase metadata. */
export function buildActivityOptions({
  activities,
  phases,
  projects,
  kind,
  projectId,
}: BuildActivityOptionsInput): Option[] {
  const groupedProjectScope = kind === "project" && projectId !== undefined;
  const eligible = activities.filter((activity) =>
    groupedProjectScope
      ? activity.kind === "repeatable" || (activity.kind === "project" && activity.projectId === projectId)
      : activity.kind === kind && (kind !== "project" || activity.projectId === projectId),
  );
  const phaseById = new Map(phases.map((phase) => [phase.id, phase.name]));
  const projectNamesById = new Map(projects.map((project) => [project.id, project.name]));
  const nameCountsByName = new Map<string, number>();
  for (const activity of eligible) nameCountsByName.set(activity.name, (nameCountsByName.get(activity.name) ?? 0) + 1);

  const resolved = eligible.map((activity) => {
    if (nameCountsByName.get(activity.name) === 1) {
      return { activity, kind: activity.kind, baseLabel: activity.name };
    }
    const context =
      (activity.phaseId ? phaseById.get(activity.phaseId) : undefined) ??
      (activity.kind === "internal"
        ? m.form_activity_kind_internal()
        : activity.kind === "repeatable"
          ? m.form_activity_kind_repeatable()
          : (projectNamesById.get(activity.projectId ?? "") ?? "Project"));
    return { activity, kind: activity.kind, baseLabel: `${activity.name} / ${context}` };
  });

  const labelCountsByLabel = new Map<string, number>();
  for (const { baseLabel } of resolved) labelCountsByLabel.set(baseLabel, (labelCountsByLabel.get(baseLabel) ?? 0) + 1);
  const occurrenceCountsByLabel = new Map<string, number>();
  resolved.sort(
    (left, right) =>
      (groupedProjectScope
        ? resolveGroupOrder(resolveGroupKeyForKind(left.kind)) - resolveGroupOrder(resolveGroupKeyForKind(right.kind))
        : 0) ||
      compareDisplayNames({
        leftName: left.baseLabel,
        leftId: left.activity.id,
        rightName: right.baseLabel,
        rightId: right.activity.id,
      }),
  );
  return resolved.map(({ activity, kind: resolvedKind, baseLabel }) => {
    const occurrence = (occurrenceCountsByLabel.get(baseLabel) ?? 0) + 1;
    occurrenceCountsByLabel.set(baseLabel, occurrence);
    return {
      value: activity.id,
      label: (labelCountsByLabel.get(baseLabel) ?? 0) > 1 ? `${baseLabel} (${occurrence})` : baseLabel,
      ...(groupedProjectScope
        ? { groupKey: resolveGroupKeyForKind(resolvedKind), groupLabel: resolveGroupLabelForKind(resolvedKind) }
        : {}),
    };
  });
}
