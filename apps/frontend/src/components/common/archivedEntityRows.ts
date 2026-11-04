import { inspectLifecycleAncestry, lifecycleStatus } from '@capacitylens/shared/domain/lifecycle';
import type { LifecycleAncestryRow } from '@capacitylens/shared/domain/lifecycle';
import type {
  Activity,
  AppData,
  Client,
  Project,
  Resource,
} from '@capacitylens/shared/types/entities';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import type { LifecycleEntity } from '@/store/useStore';
import { m } from '@/i18n';

// Row models for the archived-entity section: which rows are listed, their hiding ancestor, the
// resource groups and the sort order.

export type LifecycleRow = Resource | Client | Project | Activity;
export type ArchivedEntity = LifecycleEntity;

export const entityConfig: Record<
  ArchivedEntity,
  { heading: () => string; list: (data: AppData) => LifecycleRow[] }
> = {
  resources: { heading: () => m.list_resources_archived_heading(), list: (data) => data.resources },
  clients: { heading: () => m.list_clients_archived_heading(), list: (data) => data.clients },
  projects: { heading: () => m.list_projects_archived_heading(), list: (data) => data.projects },
  activities: {
    heading: () => m.list_activities_archived_heading(),
    list: (data) => data.activities,
  },
};

export function rowName(row: LifecycleRow): string {
  if ('name' in row && row.name) return row.name;
  if ('role' in row) return row.role;
  return '';
}

export type Ancestor = { name: string; href?: string; message: string };
export type ArchivedRowModel = { row: LifecycleRow; ancestor: Ancestor | null };
type ResourceArchivedGroupKey = 'studio' | 'supplementary' | 'external' | 'placeholders';

const resourceArchivedGroups: readonly {
  key: ResourceArchivedGroupKey;
  heading: () => string;
  matches: (resource: Resource) => boolean;
}[] = [
  {
    key: 'studio',
    heading: () => m.list_resources_archived_studio_heading(),
    matches: (resource) => resource.kind === 'person' && resource.engagement === 'studio',
  },
  {
    key: 'supplementary',
    heading: () => m.list_resources_archived_supplementary_heading(),
    matches: (resource) => resource.kind === 'person' && resource.engagement === 'supplementary',
  },
  {
    key: 'external',
    heading: () => m.list_resources_archived_external_heading(),
    matches: (resource) => resource.kind === 'external',
  },
  {
    key: 'placeholders',
    heading: () => m.list_resources_archived_placeholders_heading(),
    matches: (resource) => resource.kind === 'placeholder',
  },
];

function archivedAncestor(
  indexes: Map<AppDataKey, Map<string, LifecycleAncestryRow>>,
  entity: ArchivedEntity,
  row: LifecycleRow,
): Ancestor | null {
  const result = inspectLifecycleAncestry(
    entity,
    row as unknown as LifecycleAncestryRow,
    (table, id) => indexes.get(table)?.get(id),
  );
  if (result.kind === 'visible') return null;
  const ancestor = result.inactiveAncestor;
  const parent = indexes.get(ancestor.table)?.get(ancestor.id);
  const name =
    parent && typeof parent.name === 'string' ? parent.name : m.list_archived_unknown_parent();
  const noun =
    ancestor.table === 'clients'
      ? m.settings_archived_type_clients()
      : m.settings_archived_type_projects();
  if (ancestor.state === 'deleted') {
    return { name, message: m.list_hidden_by_deleted_parent({ type: noun, name }) };
  }
  return {
    name,
    href: `/${ancestor.table}#archived-${ancestor.id}`,
    message: m.list_hidden_by_archived_parent({ type: noun, name }),
  };
}

export function buildArchivedRows(data: AppData, entity: ArchivedEntity): ArchivedRowModel[] {
  const indexes = new Map<AppDataKey, Map<string, LifecycleAncestryRow>>();
  for (const key of ['resources', 'clients', 'projects', 'activities', 'phases'] as const) {
    indexes.set(
      key,
      new Map(
        data[key].map((candidate) => [candidate.id, candidate as unknown as LifecycleAncestryRow]),
      ),
    );
  }
  return entityConfig[entity]
    .list(data)
    .filter((row) => lifecycleStatus(row) !== 'deleted')
    .map((row) => ({ row, ancestor: archivedAncestor(indexes, entity, row) }))
    .filter(({ row, ancestor }) => lifecycleStatus(row) === 'archived' || ancestor !== null)
    .toSorted(
      (left, right) =>
        rowName(left.row).localeCompare(rowName(right.row), undefined, { sensitivity: 'base' }) ||
        left.row.id.localeCompare(right.row.id),
    );
}

export function buildResourceArchivedGroups(rows: ArchivedRowModel[]) {
  return resourceArchivedGroups
    .map((group) => ({ ...group, rows: rows.filter(({ row }) => group.matches(row as Resource)) }))
    .filter((group) => group.rows.length > 0);
}
