import { Fragment, useMemo, useState } from "react";
import {
  inspectLifecycleAncestry,
  lifecycleStatus,
  type LifecycleAncestryRow,
} from "@capacitylens/shared/domain/lifecycle";
import type { Activity, AppData, Client, Project, Resource } from "@capacitylens/shared/types/entities";
import type { AppDataKey } from "@capacitylens/shared/types/entities";
import { Link } from "react-router-dom";
import { useInactiveAccountData } from "../../hooks/useInactiveAccountData";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import type { LifecycleEntity } from "../../store/useStore";
import { Button } from "../ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { ConfirmDialog } from "./dialogs";
import { m } from "@/i18n";
import { useExclusiveAction } from "../../hooks/useExclusiveAction";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { useStore } from "../../store/useStore";
import { nameForQuotedContext } from "@capacitylens/shared/domain/privateNames";

type LifecycleRow = Resource | Client | Project | Activity;
type ArchivedEntity = LifecycleEntity;

const entityConfig: Record<ArchivedEntity, { heading: () => string; list: (data: AppData) => LifecycleRow[] }> = {
  resources: { heading: () => m.list_resources_archived_heading(), list: (data) => data.resources },
  clients: { heading: () => m.list_clients_archived_heading(), list: (data) => data.clients },
  projects: { heading: () => m.list_projects_archived_heading(), list: (data) => data.projects },
  activities: { heading: () => m.list_activities_archived_heading(), list: (data) => data.activities },
};

function rowName(row: LifecycleRow): string {
  if ("name" in row && row.name) return row.name;
  if ("role" in row) return row.role;
  return "";
}

function confirmationName(row: LifecycleRow): string {
  if ("isPrivate" in row && row.isPrivate) return nameForQuotedContext(rowName(row));
  return rowName(row);
}

type Ancestor = { name: string; href?: string; message: string };
type ArchivedRowModel = { row: LifecycleRow; ancestor: Ancestor | null };
type ResourceArchivedGroupKey = "studio" | "supplementary" | "external" | "placeholders";

const resourceArchivedGroups: readonly {
  key: ResourceArchivedGroupKey;
  heading: () => string;
  matches: (resource: Resource) => boolean;
}[] = [
  {
    key: "studio",
    heading: () => m.list_resources_archived_studio_heading(),
    matches: (resource) => resource.kind === "person" && resource.engagement === "studio",
  },
  {
    key: "supplementary",
    heading: () => m.list_resources_archived_supplementary_heading(),
    matches: (resource) => resource.kind === "person" && resource.engagement === "supplementary",
  },
  {
    key: "external",
    heading: () => m.list_resources_archived_external_heading(),
    matches: (resource) => resource.kind === "external",
  },
  {
    key: "placeholders",
    heading: () => m.list_resources_archived_placeholders_heading(),
    matches: (resource) => resource.kind === "placeholder",
  },
];

function archivedAncestor(
  indexes: Map<AppDataKey, Map<string, LifecycleAncestryRow>>,
  entity: ArchivedEntity,
  row: LifecycleRow,
): Ancestor | null {
  const result = inspectLifecycleAncestry(entity, row as unknown as LifecycleAncestryRow, (table, id) =>
    indexes.get(table)?.get(id),
  );
  const ancestor = result.inactiveAncestor;
  if (!ancestor) return null;
  const parent = indexes.get(ancestor.table)?.get(ancestor.id);
  const name = parent && typeof parent.name === "string" ? parent.name : m.list_archived_unknown_parent();
  const noun = ancestor.table === "clients" ? m.settings_archived_type_clients() : m.settings_archived_type_projects();
  if (ancestor.state === "deleted") return { name, message: m.list_hidden_by_deleted_parent({ type: noun, name }) };
  return {
    name,
    href: `/${ancestor.table}#archived-${ancestor.id}`,
    message: m.list_hidden_by_archived_parent({ type: noun, name }),
  };
}

function buildArchivedRows(data: AppData, entity: ArchivedEntity): ArchivedRowModel[] {
  const indexes = new Map<AppDataKey, Map<string, LifecycleAncestryRow>>();
  for (const key of ["resources", "clients", "projects", "activities", "phases"] as const)
    indexes.set(
      key,
      new Map(data[key].map((candidate) => [candidate.id, candidate as unknown as LifecycleAncestryRow])),
    );
  return entityConfig[entity]
    .list(data)
    .filter((row) => lifecycleStatus(row) !== "deleted")
    .map((row) => ({ row, ancestor: archivedAncestor(indexes, entity, row) }))
    .filter(({ row, ancestor }) => lifecycleStatus(row) === "archived" || ancestor !== null)
    .toSorted(
      (left, right) =>
        rowName(left.row).localeCompare(rowName(right.row), undefined, { sensitivity: "base" }) ||
        left.row.id.localeCompare(right.row.id),
    );
}

function buildResourceArchivedGroups(rows: ArchivedRowModel[]) {
  return resourceArchivedGroups
    .map((group) => ({ ...group, rows: rows.filter(({ row }) => group.matches(row as Resource)) }))
    .filter((group) => group.rows.length > 0);
}

function ArchivedRow({
  entity,
  model: { row, ancestor },
  busy,
  onRestore,
  onDelete,
}: {
  entity: ArchivedEntity;
  model: ArchivedRowModel;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const direct = lifecycleStatus(row) === "archived";
  const name = rowName(row);
  return (
    <Item id={`archived-${row.id}`} size="sm" role="listitem" data-testid="archived-row" className="rounded-none">
      <ItemContent className="min-w-0">
        <span className="font-medium">{name}</span>
        {entity === "resources" && <span className="text-sm text-muted-foreground">{(row as Resource).role}</span>}
        {ancestor && <span className="text-xs text-muted-foreground">{ancestor.message}</span>}
      </ItemContent>
      <ItemActions>
        {ancestor && !direct ? (
          ancestor.href && (
            <Button size="sm" variant="outline" asChild>
              <Link to={ancestor.href}>{m.list_archived_restore_parent()}</Link>
            </Button>
          )
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label={m.settings_archived_restore_aria({ name })}
              onClick={onRestore}
            >
              {m.settings_archived_restore()}
            </Button>
            {ancestor?.href && (
              <Button size="sm" variant="outline" asChild>
                <Link to={ancestor.href}>{m.list_archived_restore_parent()}</Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="danger-soft"
              disabled={busy}
              aria-label={m.settings_archived_delete_aria({ name })}
              onClick={onDelete}
            >
              {m.settings_archived_delete()}
            </Button>
          </>
        )}
      </ItemActions>
    </Item>
  );
}

function ArchivedRows({
  entity,
  rows,
  busy,
  onRestore,
  onDelete,
}: {
  entity: ArchivedEntity;
  rows: ArchivedRowModel[];
  busy: boolean;
  onRestore: (model: ArchivedRowModel) => void;
  onDelete: (model: ArchivedRowModel) => void;
}) {
  return (
    <ItemGroup className="rounded-md border bg-card">
      {rows.map((model, index) => (
        <Fragment key={model.row.id}>
          {index > 0 && <ItemSeparator />}
          <ArchivedRow
            entity={entity}
            model={model}
            busy={busy}
            onRestore={() => onRestore(model)}
            onDelete={() => onDelete(model)}
          />
        </Fragment>
      ))}
    </ItemGroup>
  );
}

function ArchivedContent({
  entity,
  rows,
  groups,
  busy,
  onRestore,
  onDelete,
}: {
  entity: ArchivedEntity;
  rows: ArchivedRowModel[];
  groups: ReturnType<typeof buildResourceArchivedGroups>;
  busy: boolean;
  onRestore: (model: ArchivedRowModel) => void;
  onDelete: (model: ArchivedRowModel) => void;
}) {
  if (entity !== "resources") {
    return <ArchivedRows entity={entity} rows={rows} busy={busy} onRestore={onRestore} onDelete={onDelete} />;
  }
  return groups.map((group) => (
    <section key={group.key} className="space-y-3" data-testid={`archived-resources-${group.key}-group`}>
      <h2 className="text-lg font-semibold">
        {group.heading()} ({group.rows.length})
      </h2>
      <ArchivedRows entity={entity} rows={group.rows} busy={busy} onRestore={onRestore} onDelete={onDelete} />
    </section>
  ));
}

export function ArchivedEntitySection({ entity }: { entity: ArchivedEntity }) {
  const { data, mayViewInactive } = useInactiveAccountData();
  const actions = useLifecycleActions();
  const [deleting, setDeleting] = useState<{ accountId: string | null; row: LifecycleRow } | null>(null);
  const setNotice = useStore((state) => state.setNotice);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { busy, run, locked } = useExclusiveAction();
  const rows = useMemo(() => (data ? buildArchivedRows(data, entity) : []), [data, entity]);
  const groups = useMemo(() => (entity === "resources" ? buildResourceArchivedGroups(rows) : []), [entity, rows]);

  const onRestore = (model: ArchivedRowModel) =>
    run(
      () => actions.unarchive(entity, model.row.id),
      (error) => setNotice(resolveErrorMessage(error), "error"),
    );
  const onDelete = (model: ArchivedRowModel) => {
    if (!locked()) setDeleting({ accountId: activeAccountId, row: model.row });
  };

  if (!mayViewInactive || !data || rows.length === 0) return null;
  return (
    <section
      className={`mt-8 ${entity === "resources" ? "space-y-8" : "space-y-3"}`}
      data-testid={`archived-${entity}-section`}
    >
      {entity !== "resources" && (
        <h2 className="text-lg font-semibold">
          {entityConfig[entity].heading()} ({rows.length})
        </h2>
      )}
      <ArchivedContent
        entity={entity}
        rows={rows}
        groups={groups}
        busy={busy}
        onRestore={onRestore}
        onDelete={onDelete}
      />
      {deleting && deleting.accountId === activeAccountId && (
        <ConfirmDialog
          title={m.settings_archived_delete_title()}
          message={m.settings_archived_delete_message({ name: confirmationName(deleting.row) })}
          confirmLabel={m.settings_archived_delete()}
          onConfirm={() => {
            run(
              () => actions.softDelete(entity, deleting.row.id),
              (error) => setNotice(resolveErrorMessage(error), "error"),
            );
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
