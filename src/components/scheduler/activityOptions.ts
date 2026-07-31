import type { Activity, Phase, Project } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import type { Option } from "../common/ui";

/** Build distinct activity labels in linear time from pre-indexed project and phase metadata. */
export function buildActivityOptions(
  activities: readonly Activity[],
  phases: readonly Phase[],
  projects: readonly Project[],
  projectId: string,
): Option[] {
  const eligible = activities.filter((activity) =>
    projectId ? activity.projectId === projectId : !activity.projectId,
  );
  const phaseById = new Map(phases.map((phase) => [phase.id, phase.name]));
  const projectById = new Map(projects.map((project) => [project.id, project.name]));
  const nameCounts = new Map<string, number>();
  for (const activity of eligible) nameCounts.set(activity.name, (nameCounts.get(activity.name) ?? 0) + 1);

  const resolved = eligible.map((activity) => {
    if (nameCounts.get(activity.name) === 1) return { activity, baseLabel: activity.name };
    const context =
      (activity.phaseId ? phaseById.get(activity.phaseId) : undefined) ??
      (activity.kind === "internal"
        ? m.form_activity_kind_internal()
        : activity.kind === "repeatable"
          ? m.form_activity_kind_repeatable()
          : (projectById.get(activity.projectId ?? "") ?? "Project"));
    return { activity, baseLabel: `${activity.name} / ${context}` };
  });

  const labelCounts = new Map<string, number>();
  for (const { baseLabel } of resolved) labelCounts.set(baseLabel, (labelCounts.get(baseLabel) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return resolved.map(({ activity, baseLabel }) => {
    const occurrence = (occurrences.get(baseLabel) ?? 0) + 1;
    occurrences.set(baseLabel, occurrence);
    return {
      value: activity.id,
      label: (labelCounts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} (${occurrence})` : baseLabel,
    };
  });
}
