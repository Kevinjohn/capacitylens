import type { AppData } from "@capacitylens/shared/types/entities";
import { byName } from "../../lib/displayOrder";
import { byDisciplineOrder } from "../../store/selectors";

/** One entity option in a {@link FilterSelect} — the stored id and the text the menu shows. */
export interface FilterOption {
  id: string;
  label: string;
}

export function buildFilterOptions(data: AppData) {
  const clients = [...data.clients].sort(
    (a, b) => Number(b.builtin === true) - Number(a.builtin === true) || byName(a, b),
  );
  const internalClientId = clients.find((client) => client.builtin === true)?.id;
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  return {
    disciplineOptions: [...data.disciplines].sort(byDisciplineOrder).map((d) => ({ id: d.id, label: d.name })),
    clientOptions: clients.map((client) => ({ id: client.id, label: client.name })),
    projectOptions: [...data.projects]
      .sort((a, b) => Number(b.clientId === internalClientId) - Number(a.clientId === internalClientId) || byName(a, b))
      .map((project) => {
        const clientName = clientNames.get(project.clientId);
        return { id: project.id, label: clientName ? `${clientName} / ${project.name}` : project.name };
      }),
    // The activity lens covers only the project-LESS kinds — project-specific activities are
    // reached via the Projects dropdown above.
    internalActivities: data.activities.filter((t) => t.kind === "internal").sort(byName),
    repeatableActivities: data.activities.filter((t) => t.kind === "repeatable").sort(byName),
  };
}
