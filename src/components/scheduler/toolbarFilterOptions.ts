import type { AppData } from "@capacitylens/shared/types/entities";
import { byName, createClientProjectDisplayNameComparator } from "../../lib/displayOrder";
import { byDisciplineOrder } from "../../store/selectors";

/** One entity option in a {@link FilterSelect} — the stored id and the text the menu shows. */
export interface FilterOption {
  id: string;
  label: string;
  /** Optional client context rendered with lower visual emphasis for project options. */
  contextLabel?: string;
  primaryLabel?: string;
}

export function buildFilterOptions(
  data: AppData,
  selectedClientId: string | null = null,
  selectedProjectId: string | null = null,
) {
  const clients = [...data.clients].sort(
    (a, b) => Number(b.builtin === true) - Number(a.builtin === true) || byName(a, b),
  );
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  return {
    disciplineOptions: [...data.disciplines]
      .sort(byDisciplineOrder)
      .map((discipline) => ({ id: discipline.id, label: discipline.name })),
    clientOptions: clients.map((client) => ({ id: client.id, label: client.name })),
    projectOptions: [...data.projects]
      // A selected project stays listed even when it no longer belongs to the selected client
      // (its client was edited after the filter was set), so the stale choice remains visible and
      // correctable instead of rendering an empty select over an empty grid.
      .filter(
        (project) =>
          selectedClientId === null || project.clientId === selectedClientId || project.id === selectedProjectId,
      )
      .sort(createClientProjectDisplayNameComparator(data.clients))
      .map((project) => {
        const clientName = clientNames.get(project.clientId);
        return {
          id: project.id,
          label: clientName ? `${clientName} / ${project.name}` : project.name,
          ...(clientName ? { contextLabel: `${clientName} /`, primaryLabel: project.name } : {}),
        };
      }),
    // The activity lens covers only the project-LESS kinds — project-specific activities are
    // reached via the Projects dropdown above.
    internalActivities: data.activities.filter((activity) => activity.kind === "internal").sort(byName),
    repeatableActivities: data.activities.filter((activity) => activity.kind === "repeatable").sort(byName),
  };
}
