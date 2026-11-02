import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { ArchiveRecoveryRow } from '@capacitylens/shared/domain/lifecycle';
import { useArchiveRecovery } from '@/hooks/useArchiveRecovery';
import { useLifecycleActions } from '@/hooks/useLifecycleActions';
import { useExclusiveAction } from '@/hooks/useExclusiveAction';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from '@/components/ui/item';
import { useStore } from '@/store/useStore';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { m } from '@/i18n';

const headings = {
  resources: () => m.list_resources_archived_heading(),
  clients: () => m.list_clients_archived_heading(),
  projects: () => m.list_projects_archived_heading(),
  activities: () => m.list_activities_archived_heading(),
};
const groups = {
  studio: () => m.list_resources_archived_studio_heading(),
  supplementary: () => m.list_resources_archived_supplementary_heading(),
  external: () => m.list_resources_archived_external_heading(),
  placeholders: () => m.list_resources_archived_placeholders_heading(),
};

/** Shows only identity labels and existing typed restore actions, without inactive details. */
export function ArchiveRecoverySection({ entity }: { entity: ArchiveRecoveryRow['entity'] }) {
  const { data, error } = useArchiveRecovery();
  const actions = useLifecycleActions();
  const { busy, run } = useExclusiveAction();
  const setNotice = useStore((state) => state.setNotice);
  const rows = data?.rows.filter((row) => row.entity === entity) ?? [];
  if (error) return <p role="alert">{error}</p>;
  if (!rows.length) return null;
  const renderRows = (selected: ArchiveRecoveryRow[]) => (
    <ItemGroup className="rounded-md border bg-card">
      {selected.map((row, index) => (
        <Fragment key={row.id}>
          {index > 0 && <ItemSeparator />}
          <Item
            id={`archived-${row.id}`}
            size="sm"
            role="listitem"
            data-testid="archived-row"
            className="rounded-none"
          >
            <ItemContent className="min-w-0">
              <span className="font-medium">{row.label}</span>
              {row.parent && (
                <span className="text-xs text-muted-foreground">
                  {m.list_hidden_by_archived_parent({
                    type:
                      row.parent.entity === 'clients'
                        ? m.settings_archived_type_clients()
                        : m.settings_archived_type_projects(),
                    name: row.parent.label,
                  })}
                </span>
              )}
            </ItemContent>
            <ItemActions>
              {row.archived && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={m.settings_archived_restore_aria({ name: row.label })}
                  onClick={() =>
                    run(
                      () => actions.unarchive(entity, row.id),
                      (failure) => setNotice(resolveErrorMessage(failure), 'error'),
                    )
                  }
                >
                  {m.settings_archived_restore()}
                </Button>
              )}
              {row.parent && (
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/${row.parent.entity}#archived-${encodeURIComponent(row.parent.id)}`}>
                    {m.list_archived_restore_parent()}
                  </Link>
                </Button>
              )}
            </ItemActions>
          </Item>
        </Fragment>
      ))}
    </ItemGroup>
  );
  return (
    <section className="mt-8 space-y-3" data-testid={`archived-${entity}-section`}>
      {entity === 'resources' ? (
        (Object.keys(groups) as (keyof typeof groups)[]).map((group) => {
          const selected = rows.filter((row) => row.entity === 'resources' && row.group === group);
          return selected.length ? (
            <section
              key={group}
              className="space-y-3"
              data-testid={`archived-resources-${group}-group`}
            >
              <h2 className="text-lg font-semibold">
                {groups[group]()} ({selected.length})
              </h2>
              {renderRows(selected)}
            </section>
          ) : null;
        })
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            {headings[entity]()} ({rows.length})
          </h2>
          {renderRows(rows)}
        </>
      )}
    </section>
  );
}
