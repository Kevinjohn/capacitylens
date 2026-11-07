import { ArchiveRecoverySection } from './ArchiveRecoverySection';
import { Fragment, useMemo, useState } from 'react';
import { lifecycleStatus } from '@capacitylens/shared/domain/lifecycle';
import type { Resource } from '@capacitylens/shared/types/entities';
import { Link } from 'react-router-dom';
import { useInactiveAccountData } from '@/hooks/useInactiveAccountData';
import { useLifecycleActions } from '@/hooks/useLifecycleActions';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from '@/components/ui/item';
import { ConfirmDialog } from './dialogs';
import { m } from '@/i18n';
import { useExclusiveAction } from '@/hooks/useExclusiveAction';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useStore } from '@/store/useStore';
import { useCan } from '@/auth/permissionContext';
import {
  buildArchivedRows,
  buildResourceArchivedGroups,
  entityConfig,
  rowName,
} from './archivedEntityRows';
import type { ArchivedEntity, ArchivedRowModel, LifecycleRow } from './archivedEntityRows';

function ArchivedRow({
  entity,
  model: { row, ancestor },
  busy,
  onRestore,
  onAnonymise,
  mayAnonymise,
}: {
  entity: ArchivedEntity;
  model: ArchivedRowModel;
  busy: boolean;
  onRestore: () => void;
  onAnonymise: () => void;
  mayAnonymise: boolean;
}) {
  const direct = lifecycleStatus(row) === 'archived';
  const name = rowName(row);
  return (
    <Item
      id={`archived-${row.id}`}
      size="sm"
      role="listitem"
      data-testid="archived-row"
      className="rounded-none"
    >
      <ItemContent className="min-w-0">
        <span className="font-medium">{name}</span>
        {entity === 'resources' && (
          <span className="text-sm text-muted-foreground">{(row as Resource).role}</span>
        )}
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
            {entity === 'resources' && mayAnonymise && (
              <Button
                size="sm"
                variant="danger-soft"
                disabled={busy}
                aria-label={m.settings_archived_anonymise_aria({ name })}
                onClick={onAnonymise}
              >
                {m.settings_archived_anonymise()}
              </Button>
            )}
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
  onAnonymise,
  mayAnonymise,
}: {
  entity: ArchivedEntity;
  rows: ArchivedRowModel[];
  busy: boolean;
  onRestore: (model: ArchivedRowModel) => void;
  onAnonymise: (model: ArchivedRowModel) => void;
  mayAnonymise: boolean;
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
            onAnonymise={() => onAnonymise(model)}
            mayAnonymise={mayAnonymise}
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
  onAnonymise,
  mayAnonymise,
}: {
  entity: ArchivedEntity;
  rows: ArchivedRowModel[];
  groups: ReturnType<typeof buildResourceArchivedGroups>;
  busy: boolean;
  onRestore: (model: ArchivedRowModel) => void;
  onAnonymise: (model: ArchivedRowModel) => void;
  mayAnonymise: boolean;
}) {
  if (entity !== 'resources') {
    return (
      <ArchivedRows
        entity={entity}
        rows={rows}
        busy={busy}
        onRestore={onRestore}
        onAnonymise={onAnonymise}
        mayAnonymise={mayAnonymise}
      />
    );
  }
  return groups.map((group) => (
    <section
      key={group.key}
      className="space-y-3"
      data-testid={`archived-resources-${group.key}-group`}
    >
      <h2 className="text-lg font-semibold">
        {group.heading()} ({group.rows.length})
      </h2>
      <ArchivedRows
        entity={entity}
        rows={group.rows}
        busy={busy}
        onRestore={onRestore}
        onAnonymise={onAnonymise}
        mayAnonymise={mayAnonymise}
      />
    </section>
  ));
}

/** Shows archived records only when the current role can view inactive data. */
function PrivilegedArchivedEntitySection({ entity }: { entity: ArchivedEntity }) {
  const { data, mayViewInactive } = useInactiveAccountData();
  const actions = useLifecycleActions();
  const [anonymising, setAnonymising] = useState<{
    accountId: string | null;
    row: LifecycleRow;
  } | null>(null);
  const mayAnonymise = useCan('resources:anonymise');
  const setNotice = useStore((state) => state.setNotice);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { busy, run, locked } = useExclusiveAction();
  const rows = useMemo(() => (data ? buildArchivedRows(data, entity) : []), [data, entity]);
  const groups = useMemo(
    () => (entity === 'resources' ? buildResourceArchivedGroups(rows) : []),
    [entity, rows],
  );

  const onRestore = (model: ArchivedRowModel) =>
    run(
      () => actions.unarchive(entity, model.row.id),
      (error) => setNotice(resolveErrorMessage(error), 'error'),
    );
  const onAnonymise = (model: ArchivedRowModel) => {
    if (entity === 'resources' && mayAnonymise && !locked()) {
      setAnonymising({ accountId: activeAccountId, row: model.row });
    }
  };

  if (!mayViewInactive || !data || rows.length === 0) return null;
  return (
    <section
      className={`mt-8 ${entity === 'resources' ? 'space-y-8' : 'space-y-3'}`}
      data-testid={`archived-${entity}-section`}
    >
      {entity !== 'resources' && (
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
        onAnonymise={onAnonymise}
        mayAnonymise={mayAnonymise}
      />
      {anonymising && anonymising.accountId === activeAccountId && (
        <ConfirmDialog
          title={m.settings_archived_anonymise_title()}
          message={m.settings_archived_anonymise_message({ name: rowName(anonymising.row) })}
          confirmLabel={m.settings_archived_anonymise()}
          onConfirm={() => {
            run(
              () => actions.anonymise(anonymising.row.id),
              (error) => setNotice(resolveErrorMessage(error), 'error'),
            );
            setAnonymising(null);
          }}
          onCancel={() => setAnonymising(null)}
        />
      )}
    </section>
  );
}

/** Keeps the full inactive browser privileged while Editors receive recovery identities only. */
export function ArchivedEntitySection({ entity }: { entity: ArchivedEntity }) {
  const mayAnonymise = useCan('resources:anonymise');
  const mayWrite = useCan('planning:write');
  if (mayAnonymise) return <PrivilegedArchivedEntitySection entity={entity} />;
  if (mayWrite) return <ArchiveRecoverySection entity={entity} />;
  return null;
}
