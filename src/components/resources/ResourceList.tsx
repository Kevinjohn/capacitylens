import { Fragment, useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { disciplinesEnabledFor, externalEnabledFor, placeholdersEnabledFor } from '../../store/selectors'
import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { AddButton, ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { Separator } from '../ui/separator'
import { resourceDisplayName } from '../../lib/metadata'
import { ResourceForm } from './ResourceForm'
import { ExternalForm } from '../external/ExternalForm'
import { externalExplainer } from '../../lib/externalCopy'
import { NEUTRAL_COLOR } from '../../lib/palette'
import { isExternalResource } from '@capacitylens/shared/types/entities'
import type { Resource, ResourceKind } from '@capacitylens/shared/types/entities'
import { useLifecycleActions } from '../../hooks/useLifecycleActions'
import { m } from '@/i18n'
import { Badge } from '../ui/badge'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from '../ui/item'

export function ResourceList() {
  const data = useActiveScopedData()
  const resources = data.resources
  const disciplines = data.disciplines
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  // Per-account view pref (default OFF). When off the placeholder feature is hidden, so the
  // Placeholders section and its "Add placeholder" affordance don't render. Existing placeholder
  // resources stay in the data untouched — they simply aren't shown until the pref is turned on.
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId))
  // Per-account view pref (default OFF), EXACT analog of placeholdersEnabled. When off the External
  // section (rows + "Add external party" affordance) doesn't render; existing externals stay in the
  // data untouched and reappear when re-enabled (Settings → External).
  const externalEnabled = useStore((s) => externalEnabledFor(s.data, s.activeAccountId))
  // The per-row action now ARCHIVES (soft-delete is reached LATER from Settings → Archived & deleted
  // on an archived row). `archive` branches server/local in useLifecycleActions — and crucially, in
  // SERVER mode it reloads the active slice so the archived row vanishes from this list + the schedule.
  const { archive } = useLifecycleActions()
  const { editing, setEditing, confirming, setConfirming } = useCrudListState<Resource>()
  // External rows get their OWN create/edit/confirm state + the trimmed ExternalForm (no capacity
  // fields), kept separate from the person/placeholder triple above so the two modals never collide.
  const ext = useCrudListState<Resource>()
  // People and placeholders each have their own add button; remember which kind is
  // being created so the right modal opens.
  const [creatingKind, setCreatingKind] = useState<ResourceKind | null>(null)

  // Resources, placeholders, and externals all live on THIS tab now. Externals (the External section
  // below) are gated behind the per-account `externalEnabled` pref; people/placeholders split by kind.
  const people = resources.filter((r) => r.kind === 'person')
  const placeholders = resources.filter((r) => r.kind === 'placeholder')
  const externals = resources.filter(isExternalResource)

  const disciplineName = (id?: string) => disciplines.find((d) => d.id === id)?.name ?? '—'
  // A resource's colour follows its discipline (resources no longer pick their own);
  // fall back to the stored colour for the disciplineless ones — and for everyone when
  // the account doesn't use disciplines.
  const swatchColor = (r: Resource) =>
    (disciplinesEnabled ? disciplines.find((d) => d.id === r.disciplineId)?.color : undefined) ?? r.color

  const renderRow = (r: Resource) => (
    <Item size="sm" role="listitem" data-testid="resource-row" className="rounded-none">
      <ItemContent className="flex-row flex-wrap items-center gap-2">
        <ColorSwatch color={swatchColor(r)} />
        <span className="font-medium">{resourceDisplayName(r)}</span>
        {r.kind === 'placeholder' && (
          <Badge variant="outline">{m.list_resources_placeholder_badge()}</Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {` · ${r.role}${disciplinesEnabled ? ` · ${disciplineName(r.disciplineId)}` : ''} · ${m.list_resources_hours_per_day({ hours: r.workingHoursPerDay })}`}
        </span>
      </ItemContent>
      <ItemActions>
        <EditButton onClick={() => setEditing(r)} />
        <DeleteButton label={m.list_resources_archive_aria({ name: resourceDisplayName(r) })} onClick={() => setConfirming(r)} />
      </ItemActions>
    </Item>
  )

  // `enrich` carries the icon/description/CTA for the *genuinely-empty* People box. The
  // placeholder box passes none — its bare message is left as-is (its own "Add placeholder"
  // button sits right above it). The `empty` text stays the load-bearing children either way.
  const box = (
    rows: Resource[],
    empty: string,
    enrich?: { description: string; action: { label: string; onClick: () => void } },
  ) =>
    rows.length === 0 ? (
      <EmptyState
        icon={enrich ? Users : undefined}
        description={enrich?.description}
        action={enrich?.action ? { ...enrich.action, icon: Plus, requiresEdit: true } : undefined}
      >
        {empty}
      </EmptyState>
    ) : (
      <ItemGroup className="rounded-md border bg-card">
        {rows.map((resource, index) => (
          <Fragment key={resource.id}>
            {index > 0 && <ItemSeparator />}
            {renderRow(resource)}
          </Fragment>
        ))}
      </ItemGroup>
    )

  return (
    <ListPage title={m.list_resources_title()} addLabel={m.list_resources_add()} onAdd={() => setCreatingKind('person')}>
      {box(people, m.list_resources_empty(), {
        description: m.list_resources_empty_desc(),
        action: { label: m.list_resources_empty_action(), onClick: () => setCreatingKind('person') },
      })}

      {/* The whole placeholder feature is behind the per-account `placeholdersEnabled` pref
          (default off, Settings → Placeholders). When off, the management section + "Add
          placeholder" affordance are hidden; existing placeholder data is preserved untouched. */}
      {placeholdersEnabled && (
        <>
          {/* Decorative rule closing off the People section before Placeholders (Phase 8) — a
              shadcn Separator in place of the bare mt-8 gap. decorative (no a11y role) so it
              adds a visual divider without a spurious separator in the accessibility tree. */}
          <Separator className="mt-8" />
          <div className="mb-4 mt-8 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{m.list_resources_placeholders_heading()}</h2>
            <AddButton label={m.list_resources_add_placeholder()} onClick={() => setCreatingKind('placeholder')} />
          </div>
          {box(placeholders, m.list_resources_placeholders_empty())}
        </>
      )}

      {/* External / 3rd parties moved INTO this tab (from the old standalone /external page) behind the
          per-account `externalEnabled` pref (default off, Settings → External). When off, the whole
          section is hidden; existing external data is preserved untouched and returns when re-enabled. */}
      {externalEnabled && (
        <section aria-labelledby="external-heading">
          {/* Decorative rule before the External section (Phase 8) — see the People→Placeholders
              Separator above. */}
          <Separator className="mt-8" />
          <div className="mb-2 mt-8 flex items-center justify-between">
            <h2 id="external-heading" className="text-lg font-semibold">
              {m.list_resources_external_heading()}
            </h2>
            <AddButton label={m.list_resources_add_external()} onClick={() => ext.setCreating(true)} />
          </div>
          {/* Explainer copy (editable, shared with Settings → External — see lib/externalCopy.ts). */}
          <p className="mb-4 max-w-prose text-sm text-muted-foreground">{externalExplainer()}</p>
          {externals.length === 0 ? (
            <EmptyState
              icon={Users}
              description={m.list_resources_external_empty_desc()}
              action={{ label: m.list_resources_external_empty_action(), onClick: () => ext.setCreating(true), icon: Plus, requiresEdit: true }}
            >
              {m.list_resources_external_empty()}
            </EmptyState>
          ) : (
            <ItemGroup className="rounded-md border bg-card">
              {externals.map((r, index) => (
                <Fragment key={r.id}>
                {index > 0 && <ItemSeparator />}
                <Item size="sm" role="listitem" data-testid="external-row" className="rounded-none">
                  <ItemContent className="flex-row flex-wrap items-center gap-2">
                    <ColorSwatch color={NEUTRAL_COLOR} />
                    <span className="font-medium">{r.name ?? r.role}</span>
                    {r.name && r.role && <span className="text-sm text-muted-foreground">· {r.role}</span>}
                  </ItemContent>
                  <ItemActions>
                    <EditButton onClick={() => ext.setEditing(r)} />
                    <DeleteButton label={m.list_resources_archive_aria({ name: r.name ?? r.role })} onClick={() => ext.setConfirming(r)} />
                  </ItemActions>
                </Item>
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </section>
      )}

      {creatingKind && <ResourceForm kind={creatingKind} onClose={() => setCreatingKind(null)} />}
      {editing && <ResourceForm resource={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_resources_archive_title()}
          message={m.list_resources_archive_message({ name: resourceDisplayName(confirming) })}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive('resources', confirming.id)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {/* External create/edit reuse the trimmed ExternalForm; the row action archives (soft-delete is
          reached later from Settings → Archived & deleted). */}
      {ext.creating && <ExternalForm onClose={() => ext.setCreating(false)} />}
      {ext.editing && <ExternalForm resource={ext.editing} onClose={() => ext.setEditing(null)} />}
      {ext.confirming && (
        <ConfirmDialog
          title={m.list_resources_archive_title()}
          message={m.list_resources_archive_message({ name: ext.confirming.name ?? ext.confirming.role })}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive('resources', ext.confirming!.id)
            ext.setConfirming(null)
          }}
          onCancel={() => ext.setConfirming(null)}
        />
      )}
    </ListPage>
  )
}
