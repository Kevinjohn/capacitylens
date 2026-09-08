import { useMemo } from "react";
import { isExternalResource, type Resource } from "@capacitylens/shared/types/entities";
import { useStore } from "../../store/useStore";
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasResourceEngagementGrouping,
  hasPlaceholdersEnabled,
} from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { resolveResourceDisplayName } from "../../lib/metadata";
import {
  createDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from "../../lib/displayOrder";

const byFavouriteDisplayName = createFavouriteDisplayNameComparator<Resource>(resolveResourceDisplayName);
const byEngagementFavouriteDisplayName =
  createEngagementFavouriteDisplayNameComparator<Resource>(resolveResourceDisplayName);
const byDisplayName = createDisplayNameComparator<Resource>(resolveResourceDisplayName);

function partitionResources(resources: Resource[], groupByEngagement: boolean) {
  const people: Resource[] = [];
  const placeholders: Resource[] = [];
  const externals: Resource[] = [];
  for (const resource of resources) {
    if (resource.kind === "person") people.push(resource);
    else if (resource.kind === "placeholder") placeholders.push(resource);
    else if (isExternalResource(resource)) externals.push(resource);
  }
  people.sort(groupByEngagement ? byEngagementFavouriteDisplayName : byFavouriteDisplayName);
  placeholders.sort(byDisplayName);
  externals.sort(byFavouriteDisplayName);
  return {
    people,
    studioPeople: people.filter((resource) => resource.engagement === "studio"),
    supplementaryPeople: people.filter((resource) => resource.engagement === "supplementary"),
    placeholders,
    externals,
  };
}

export function useResourceListModel() {
  const { resources, disciplines } = useActiveScopedData();
  const disciplinesById = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );
  const disciplinesEnabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  const groupByEngagement = useStore((state) => hasResourceEngagementGrouping(state.data, state.activeAccountId));
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const externalEnabled = useStore((state) => hasExternalResourcesEnabled(state.data, state.activeAccountId));
  const groups = useMemo(() => partitionResources(resources, groupByEngagement), [resources, groupByEngagement]);
  const resolveDisciplineName = (id?: string) => (id ? disciplinesById.get(id)?.name : undefined);
  const resolveSwatchColor = (resource: Resource) =>
    (disciplinesEnabled && resource.disciplineId ? disciplinesById.get(resource.disciplineId)?.color : undefined) ??
    resource.color;
  const buildMetadata = (resource: Resource) =>
    [resource.role, disciplinesEnabled ? resolveDisciplineName(resource.disciplineId) : undefined]
      .filter(Boolean)
      .join(" · ");
  const visibleCount =
    groups.people.length +
    (placeholdersEnabled ? groups.placeholders.length : 0) +
    (externalEnabled ? groups.externals.length : 0);
  return {
    ...groups,
    groupByEngagement,
    placeholdersEnabled,
    externalEnabled,
    visibleCount,
    resolveSwatchColor,
    buildMetadata,
  };
}

export type ResourceListModel = ReturnType<typeof useResourceListModel>;
