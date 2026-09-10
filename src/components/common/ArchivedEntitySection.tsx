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

export function ArchivedEntitySection({ entity }: { entity: ArchivedEntity }) {
  const { data, mayViewInactive } = useInactiveAccountData();
  const actions = useLifecycleActions();
  const [deleting, setDeleting] = useState<{ accountId: string | null; row: LifecycleRow } | null>(null);
  const setNotice = useStore((state) => state.setNotice);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { busy, run, locked } = useExclusiveAction();
  const rows = useMemo(() => (data ? buildArchivedRows(data, entity) : []), [data, entity]);

  if (!mayViewInactive || !data || rows.length === 0) return null;
  return (
    <section className="mt-8 space-y-3" data-testid={`archived-${entity}-section`}>
      <h2 className="text-lg font-semibold">
        {entityConfig[entity].heading()} ({rows.length})
      </h2>
      <ItemGroup className="rounded-md border bg-card">
        {rows.map((model, index) => (
          <Fragment key={model.row.id}>
            {index > 0 && <ItemSeparator />}
            <ArchivedRow
              entity={entity}
              model={model}
              busy={busy}
              onRestore={() =>
                run(
                  () => actions.unarchive(entity, model.row.id),
                  (error) => setNotice(resolveErrorMessage(error), "error"),
                )
              }
              onDelete={() => {
                if (!locked()) setDeleting({ accountId: activeAccountId, row: model.row });
              }}
            />
          </Fragment>
        ))}
      </ItemGroup>
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
