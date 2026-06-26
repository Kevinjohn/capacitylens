import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { disciplinesEnabledFor, externalEnabledFor, placeholdersEnabledFor } from '../../store/selectors'
import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { AddButton, ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { Separator } from '../ui/separator'
import { resourceDisplayName } from '../../lib/metadata'
import { ResourceForm } from './ResourceForm'
import { ExternalForm } from '../external/ExternalForm'
import { EXTERNAL_EXPLAINER } from '../../lib/externalCopy'
import { isExternalResource } from '@capacitylens/shared/types/entities'
import type { Resource, ResourceKind } from '@capacitylens/shared/types/entities'
import { useLifecycleActions } from '../../hooks/useLifecycleActions'
import { m } from '@/i18n'

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
    <li key={r.id} data-testid="resource-row" className="flex items-center justify-between px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <ColorSwatch color={swatchColor(r)} />
        <span className="font-medium">{resourceDisplayName(r)}</span>
        {r.kind === 'placeholder' && (
          <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">{m.list_resources_placeholder_badge()}</span>
        )}
        <span className="text-sm text-muted">
          {` · ${r.role}${disciplinesEnabled ? ` · ${disciplineName(r.disciplineId)}` : ''} · ${m.list_resources_hours_per_day({ hours: r.workingHoursPerDay })}`}
        </span>
      </span>
      <span className="flex gap-2">
        <EditButton onClick={() => setEditing(r)} />
        <DeleteButton label={m.list_resources_archive_aria({ name: resourceDisplayName(r) })} onClick={() => setConfirming(r)} />
      </span>
    </li>
  )

  // `enrich` carries the icon/description/CTA for the *genuinely-empty* People box. The
  // placeholder box passes none — its bare message is left as-is (its own "Add placeholder"
  // button sits right above it). The `empty` text stays the load-bearing children either way.
  const box = (
    rows: Resource[],
    empty: string,
    enrich?: { icon: 'people'; description: string; action: { label: string; onClick: () => void; icon?: 'plus' } },
  ) =>
    rows.length === 0 ? (
      <EmptyState icon={enrich?.icon} description={enrich?.description} action={enrich?.action}>
        {empty}
      </EmptyState>
    ) : (
      <ul className="divide-y divide-line rounded border border-line bg-surface">{rows.map(renderRow)}</ul>
    )

  return (
    <ListPage title={m.list_resources_title()} addLabel={m.list_resources_add()} onAdd={() => setCreatingKind('person')}>
      {box(people, m.list_resources_empty(), {
        icon: 'people',
        description: m.list_resources_empty_desc(),
        action: { label: m.list_resources_empty_action(), onClick: () => setCreatingKind('person'), icon: 'plus' },
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
          <p className="mb-4 max-w-prose text-sm text-muted">{EXTERNAL_EXPLAINER}</p>
          {externals.length === 0 ? (
            <EmptyState
              icon="people"
              description={m.list_resources_external_empty_desc()}
              action={{ label: m.list_resources_external_empty_action(), onClick: () => ext.setCreating(true), icon: 'plus' }}
            >
              {m.list_resources_external_empty()}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded border border-line bg-surface">
              {externals.map((r) => (
                <li key={r.id} data-testid="external-row" className="flex items-center justify-between px-3 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <ColorSwatch color={r.color} />
                    <span className="font-medium">{r.name ?? r.role}</span>
                    {r.name && r.role && <span className="text-sm text-muted">· {r.role}</span>}
                  </span>
                  <span className="flex gap-2">
                    <EditButton onClick={() => ext.setEditing(r)} />
                    <DeleteButton label={m.list_resources_archive_aria({ name: r.name ?? r.role })} onClick={() => ext.setConfirming(r)} />
                  </span>
                </li>
              ))}
            </ul>
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
