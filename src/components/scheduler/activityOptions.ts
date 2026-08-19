import type { Activity, Phase, Project } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import type { Option } from "../common/ui";

export function groupLabelForKind(kind: Activity["kind"]): string {
  return kind === "repeatable" ? m.scheduler_filter_all_projects() : m.form_activity_kind_project();
}

export function sortGroupedOptions(options: readonly Option[]): Option[] {
  const allProjectsGroupLabel = m.scheduler_filter_all_projects();
  return options.toSorted((left, right) => {
    const groupOrder = left.groupLabel === allProjectsGroupLabel ? 0 : 1;
    const rightGroupOrder = right.groupLabel === allProjectsGroupLabel ? 0 : 1;
    return (
      groupOrder - rightGroupOrder ||
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      left.value.localeCompare(right.value)
    );
  });
}

/** Build alphabetized, distinct activity labels from pre-indexed project and phase metadata. */
export function buildActivityOptions(
  activities: readonly Activity[],
  phases: readonly Phase[],
  projects: readonly Project[],
  kind: Activity["kind"],
  projectId?: string,
): Option[] {
  const groupedProjectScope = kind === "project" && projectId !== undefined;
  const repeatable = groupedProjectScope ? activities.filter((activity) => activity.kind === "repeatable") : [];
  const scoped = activities.filter(
    (activity) => activity.kind === kind && (kind !== "project" || activity.projectId === projectId),
  );
  const eligible = groupedProjectScope ? [...repeatable, ...scoped] : scoped;
  const phaseById = new Map(phases.map((phase) => [phase.id, phase.name]));
  const projectById = new Map(projects.map((project) => [project.id, project.name]));
  const nameCounts = new Map<string, number>();
  for (const activity of eligible) nameCounts.set(activity.name, (nameCounts.get(activity.name) ?? 0) + 1);

  const resolved = eligible
    .map((activity) => {
      if (nameCounts.get(activity.name) === 1) return { activity, baseLabel: activity.name };
      const context =
        (activity.phaseId ? phaseById.get(activity.phaseId) : undefined) ??
        (activity.kind === "internal"
          ? m.form_activity_kind_internal()
          : activity.kind === "repeatable"
            ? m.form_activity_kind_repeatable()
            : (projectById.get(activity.projectId ?? "") ?? "Project"));
      return { activity, baseLabel: `${activity.name} / ${context}` };
    })
    .sort(
      (left, right) =>
        left.baseLabel.localeCompare(right.baseLabel, undefined, { sensitivity: "base" }) ||
        left.activity.id.localeCompare(right.activity.id),
    );

  const labelCounts = new Map<string, number>();
  for (const { baseLabel } of resolved) labelCounts.set(baseLabel, (labelCounts.get(baseLabel) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  const options = resolved.map(({ activity, baseLabel }) => {
    const occurrence = (occurrences.get(baseLabel) ?? 0) + 1;
    occurrences.set(baseLabel, occurrence);
    return {
      value: activity.id,
      label: (labelCounts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} (${occurrence})` : baseLabel,
    };
  });
  if (!groupedProjectScope) return options;

  const repeatableIds = new Set(repeatable.map((activity) => activity.id));
  return sortGroupedOptions(
    options.map((option) => ({
      ...option,
      groupLabel: groupLabelForKind(repeatableIds.has(option.value) ? "repeatable" : "project"),
    })),
  );
}
