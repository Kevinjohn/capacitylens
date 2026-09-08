import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isServerConfigured } from "../../data/apiConfig";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "../../data/fetchInactiveSlice";
import { useStore, type LifecycleEntity } from "../../store/useStore";
import { useInactiveScopedData } from "../../store/useScopedData";
import { useLifecycleActions } from "../../hooks/useLifecycleActions";
import { useCan } from "../../auth/permissionContext";
import { useExclusiveAction } from "../../hooks/useExclusiveAction";
import { useDeadlineClock } from "../../hooks/useDeadlineClock";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { ConfirmDialog } from "../common/ui";
import { Button } from "../ui/button";
import { m } from "@/i18n";
import { canPurge, lifecycleStatus, PURGE_MIN_AGE_DAYS } from "@capacitylens/shared/domain/lifecycle";
import { nameForQuotedContext } from "@capacitylens/shared/domain/privateNames";
import type { AppData, Client, Project, Resource } from "@capacitylens/shared/types/entities";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "../ui/item";
import { SettingsSection } from "./SettingsSection";
interface Row {
  entity: LifecycleEntity;
  id: string;
  name: string;
  raw: Resource | Client | Project;
}
function resolveRowName(entity: LifecycleEntity, inactiveRow: Resource | Client | Project): string {
  if (entity === "resources") {
    const resource = inactiveRow as Resource;
    return resource.name ?? resource.role;
  }
  return (inactiveRow as Client | Project).name;
}
function listInactiveRows(data: AppData): Row[] {
  const out: Row[] = [];
  const push = (entity: LifecycleEntity, list: (Resource | Client | Project)[]) => {
    for (const inactiveRow of list) {
      if (lifecycleStatus(inactiveRow) !== "active")
        out.push({ entity, id: inactiveRow.id, name: resolveRowName(entity, inactiveRow), raw: inactiveRow });
    }
  };
  push("resources", data.resources);
  push("clients", data.clients);
  push("projects", data.projects);
  return out;
}
function resolveConfirmationName(row: Row): string {
  if (row.entity === "resources") return row.name;
  return (row.raw as Client | Project).isPrivate === true ? nameForQuotedContext(row.name) : row.name;
}
function pickNextPurgeDeadline(deleted: Row[], clock: number): number | null {
  return deleted.reduce<number | null>((nearest, row) => {
    const deletedAt = row.raw.deletedAt ? Date.parse(row.raw.deletedAt) : Number.NaN;
    if (!Number.isFinite(deletedAt)) return nearest;
    const candidate = deletedAt + PURGE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (candidate <= clock) return nearest;
    return nearest === null || candidate < nearest ? candidate : nearest;
  }, null);
}
const TYPE_LABEL: Record<LifecycleEntity, () => string> = {
  resources: () => m.settings_archived_type_resources(),
  clients: () => m.settings_archived_type_clients(),
  projects: () => m.settings_archived_type_projects(),
};
type Confirmation = { kind: "delete" | "purge"; row: Row };
type LifecycleActions = ReturnType<typeof useLifecycleActions>;
interface ArchivedRowActionsProps {
  row: Row;
  mayPurge: boolean;
  lifecycleBusy: boolean;
  actions: LifecycleActions;
  runLifecycle(action: () => Promise<void>): void;
  locked(): boolean;
  setConfirming(value: Confirmation | null): void;
}
interface DeletedRowActionsProps {
  row: Row;
  mayPurge: boolean;
  lifecycleBusy: boolean;
  purgeClock: number;
  hintBaseId: string;
  locked(): boolean;
  setConfirming(value: Confirmation | null): void;
}
interface LifecycleConfirmationProps {
  confirming: Confirmation;
  actions: LifecycleActions;
  runLifecycle(action: () => Promise<void>): void;
  setConfirming(value: Confirmation | null): void;
}
interface ArchivedRowsDataProps {
  server: boolean;
  mayPurge: boolean;
  activeAccountId: string | null;
  localData: AppData;
  setNotice(message: string, kind: "error"): void;
}
function resolveRenderedRows({
  server,
  serverRows,
  activeAccountId,
  reloadKey,
  localData,
}: {
  server: boolean;
  serverRows: { accountId: string; reloadKey: number; rows: Row[] } | null;
  activeAccountId: string | null;
  reloadKey: number;
  localData: AppData;
}): Row[] {
  if (!server) return listInactiveRows(localData);
  if (serverRows?.accountId !== activeAccountId || serverRows.reloadKey !== reloadKey) return [];
  return serverRows.rows;
}
function partitionRows(rows: Row[]): { archived: Row[]; deleted: Row[] } {
  const archived: Row[] = [];
  const deleted: Row[] = [];
  for (const row of rows) {
    const status = lifecycleStatus(row.raw);
    if (status === "archived") archived.push(row);
    if (status === "deleted") deleted.push(row);
  }
  return { archived, deleted };
}
function ArchivedRowActions({
  row,
  mayPurge,
  lifecycleBusy,
  actions,
  runLifecycle,
  locked,
  setConfirming,
}: ArchivedRowActionsProps) {
  return (
    <ItemActions>
      <Button
        size="sm"
        variant="outline"
        data-testid="archived-restore"
        disabled={lifecycleBusy}
        aria-label={m.settings_archived_restore_aria({ name: row.name })}
        onClick={() => runLifecycle(() => actions.unarchive(row.entity, row.id))}
      >
        {m.settings_archived_restore()}
      </Button>
      {mayPurge && (
        <Button
          size="sm"
          variant="danger-soft"
          data-testid="archived-delete"
          disabled={lifecycleBusy}
          aria-label={m.settings_archived_delete_aria({ name: row.name })}
          onClick={() => {
            if (!locked()) setConfirming({ kind: "delete", row: row });
          }}
        >
          {m.settings_archived_delete()}
        </Button>
      )}
    </ItemActions>
  );
}
function DeletedRowActions({
  row,
  mayPurge,
  lifecycleBusy,
  purgeClock,
  hintBaseId,
  locked,
  setConfirming,
}: DeletedRowActionsProps) {
  if (!mayPurge) return null;
  const purgeable = canPurge(row.raw, new Date(purgeClock).toISOString());
  const hintId = `${hintBaseId}-${row.entity}-${row.id}`;
  return (
    <ItemActions>
      {!purgeable && (
        <span id={hintId} className="text-xs text-muted-foreground">
          {m.settings_archived_purge_locked_hint({ days: PURGE_MIN_AGE_DAYS })}
        </span>
      )}
      <Button
        size="sm"
        variant="danger-soft"
        data-testid="archived-purge"
        disabled={lifecycleBusy || !purgeable}
        aria-label={m.settings_archived_purge_aria({ name: row.name })}
        aria-describedby={!purgeable ? hintId : undefined}
        onClick={() => {
          if (!locked()) setConfirming({ kind: "purge", row: row });
        }}
      >
        {m.settings_archived_purge()}
      </Button>
    </ItemActions>
  );
}
function LifecycleConfirmation({ confirming, actions, runLifecycle, setConfirming }: LifecycleConfirmationProps) {
  const name = resolveConfirmationName(confirming.row);
  let title = m.settings_archived_purge_title();
  let message = m.settings_archived_purge_message({ name });
  let confirmLabel = m.settings_archived_purge_confirm();
  if (confirming.kind === "delete") {
    title = m.settings_archived_delete_title();
    message = m.settings_archived_delete_message({ name });
    confirmLabel = m.settings_archived_delete();
  }
  const confirm = () => {
    const { kind, row } = confirming;
    if (kind === "delete") runLifecycle(() => actions.softDelete(row.entity, row.id));
    else runLifecycle(() => actions.purge(row.entity, row.id));
    setConfirming(null);
  };
  return (
    <ConfirmDialog
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      onConfirm={confirm}
      onCancel={() => setConfirming(null)}
    />
  );
}
function LifecycleGroup({
  heading,
  rows,
  rowTestId,
  rowActions,
}: {
  heading: string;
  rows: Row[];
  rowTestId: string;
  rowActions: (row: Row) => ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="mb-1 text-xs font-semibold text-ink">{heading}</h3>
      <ItemGroup>
        {rows.map((row, index) => (
          <Fragment key={`${row.entity}-${row.id}`}>
            {index > 0 && <ItemSeparator />}
            <Item size="sm" role="listitem" className="rounded-none px-0" data-testid={rowTestId}>
              <ItemContent className="min-w-0">
                <span className="text-sm text-ink">{row.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">· {TYPE_LABEL[row.entity]()}</span>
              </ItemContent>
              {rowActions(row)}
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </div>
  );
}
function useArchivedRowsData({ server, mayPurge, activeAccountId, localData, setNotice }: ArchivedRowsDataProps) {
  const [serverRows, setServerRows] = useState<{ accountId: string; reloadKey: number; rows: Row[] } | null>(null);
  const [gate, setGate] = useState<"loading" | "shown" | "hidden">(server ? "loading" : "shown");
  const [reloadKey, setReloadKey] = useState(0);
  const requestGeneration = useRef(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  useEffect(() => {
    if (!server || !mayPurge || !activeAccountId) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    let cancelled = false;
    const isCurrent = () => !cancelled && requestGeneration.current === generation;
    void (async () => {
      try {
        const body = await fetchInactiveSlice(activeAccountId, controller.signal);
        if (!isCurrent()) return;
        setServerRows({ accountId: activeAccountId, reloadKey, rows: listInactiveRows(body) });
        setGate("shown");
      } catch (error) {
        if (!isCurrent()) return;
        setServerRows(null);
        if (error instanceof InactiveSliceHttpError && error.status === 403) {
          setGate("hidden");
          return;
        }
        setGate("shown");
        if (error instanceof InactiveSliceHttpError)
          setNotice(error.serverMessage ?? m.settings_archived_err_load({ status: error.status }), "error");
        else if (error instanceof InactiveSliceShapeError) setNotice(m.settings_archived_err_incomplete(), "error");
        else setNotice(m.settings_err_server({ error: resolveErrorMessage(error) }), "error");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [server, mayPurge, activeAccountId, reloadKey, setNotice]);
  const rows = useMemo(
    () => resolveRenderedRows({ server, serverRows, activeAccountId, reloadKey, localData }),
    [server, serverRows, activeAccountId, reloadKey, localData],
  );
  return { gate, reload, rows };
}
interface ArchivedGroupsProps {
  rows: Row[];
  archived: Row[];
  deleted: Row[];
  mayPurge: boolean;
  lifecycleBusy: boolean;
  actions: LifecycleActions;
  runLifecycle(action: () => Promise<void>): void;
  locked(): boolean;
  setConfirming(value: Confirmation | null): void;
  purgeClock: number;
  hintBaseId: string;
}
function ArchivedGroups({
  rows,
  archived,
  deleted,
  mayPurge,
  lifecycleBusy,
  actions,
  runLifecycle,
  locked,
  setConfirming,
  purgeClock,
  hintBaseId,
}: ArchivedGroupsProps) {
  return (
    <>
      {rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">{m.settings_archived_empty()}</p>}
      <LifecycleGroup
        heading={m.settings_archived_group_archived()}
        rows={archived}
        rowTestId="archived-row"
        rowActions={(row) => (
          <ArchivedRowActions
            row={row}
            mayPurge={mayPurge}
            lifecycleBusy={lifecycleBusy}
            actions={actions}
            runLifecycle={runLifecycle}
            locked={locked}
            setConfirming={setConfirming}
          />
        )}
      />
      <LifecycleGroup
        heading={m.settings_archived_group_deleted()}
        rows={deleted}
        rowTestId="deleted-row"
        rowActions={(row) => (
          <DeletedRowActions
            row={row}
            mayPurge={mayPurge}
            lifecycleBusy={lifecycleBusy}
            purgeClock={purgeClock}
            hintBaseId={hintBaseId}
            locked={locked}
            setConfirming={setConfirming}
          />
        )}
      />
    </>
  );
}
interface ArchivedSectionProps {
  collapsible?: boolean;
  defaultOpen?: boolean;
}
export function ArchivedSection({ collapsible = false, defaultOpen = true }: ArchivedSectionProps = {}) {
  const server = isServerConfigured();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);
  const hintBaseId = useId();
  // A null role must stay permitted for OFF/local mode; useCan owns that policy.
  const mayPurge = useCan("purge");
  const sectionEnabled = !server || mayPurge;
  const localData = useInactiveScopedData();
  const { gate, reload, rows } = useArchivedRowsData({ server, mayPurge, activeAccountId, localData, setNotice });
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const { busy: lifecycleBusy, run, locked } = useExclusiveAction();
  const actions = useLifecycleActions(reload);
  const runLifecycle = useCallback(
    (action: () => Promise<void>) => run(action, (error: unknown) => setNotice(resolveErrorMessage(error), "error")),
    [run, setNotice],
  );
  const { archived, deleted } = partitionRows(rows);
  const purgeClock = useDeadlineClock({
    pickNextDeadline: (clock) => pickNextPurgeDeadline(deleted, clock),
    readNow: Date.now,
  });
  if (!sectionEnabled) return null;
  if (server && gate !== "shown") return null;
  return (
    <>
      <SettingsSection
        title={m.settings_archived_heading()}
        help={m.settings_archived_intro()}
        testId="archived-section"
        collapsible={collapsible}
        defaultOpen={defaultOpen}
        contentClassName="gap-4"
      >
        <ArchivedGroups
          rows={rows}
          archived={archived}
          deleted={deleted}
          mayPurge={mayPurge}
          lifecycleBusy={lifecycleBusy}
          actions={actions}
          runLifecycle={runLifecycle}
          locked={locked}
          setConfirming={setConfirming}
          purgeClock={purgeClock}
          hintBaseId={hintBaseId}
        />
      </SettingsSection>
      {confirming && (
        <LifecycleConfirmation
          confirming={confirming}
          actions={actions}
          runLifecycle={runLifecycle}
          setConfirming={setConfirming}
        />
      )}
    </>
  );
}
