import { useStore } from '../../store/useStore'
import { useActiveScopedData, useScopedData } from '../../store/useScopedData'
import { lifecycleStatus } from '@capacitylens/shared/domain/lifecycle'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { ActivityForm } from './ActivityForm'
import type { Activity } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'

export function ActivityList() {
  const data = useActiveScopedData()
  const activities = data.activities
  // Label resolution deliberately uses the RAW scoped slice (NOT the active-only projection): the
  // rows are active-only, but activities have no lifecycle field, so a `project`-kind activity can
  // outlive its ARCHIVED parent in this list (activeOnly does not orphan-prune — see
  // shared/domain/lifecycle.ts). Resolving labels against the full slice lets that parent's name
  // still render (with an "(archived)" hint) instead of mislabelling the activity "Internal".
  const raw = useScopedData()
  const projects = raw.projects
  const clients = raw.clients
  const del = useStore((s) => s.deleteActivity)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Activity>()

  // A project-less activity (internal/repeatable) is bucketed under the account's built-in
  // Internal client for display — so its label reads "Internal", not "(no project)".
  const projectLabel = (id: string | undefined) => {
    if (!id) return m.list_activities_internal_label()
    const p = projects.find((x) => x.id === id)
    // Unresolvable even against the FULL slice: in server mode the per-account read strips
    // archived/deleted parents, so this is an archived (or deleted) project — never "Internal"
    // (the activity's kind is 'project'; that label would be factually wrong).
    if (!p) return m.list_activities_archived_project()
    const c = clients.find((x) => x.id === p.clientId)
    const label = c ? `${c.name} / ${p.name}` : p.name
    // Any non-active ancestor (archived/deleted project OR client) gets the hint, so the user
    // knows why this project no longer appears on the Projects page.
    const dormant = lifecycleStatus(p) !== 'active' || (c !== undefined && lifecycleStatus(c) !== 'active')
    return dormant ? m.list_label_archived({ name: label }) : label
  }

  // Three kinds, three tables. Internal first (the owner's ordering), then repeatable
  // (reusable across projects — the rename of "general"), then project work.
  const internalActivities = activities.filter((a) => a.kind === 'internal')
  const repeatableActivities = activities.filter((a) => a.kind === 'repeatable')
  const projectActivities = activities.filter((a) => a.kind === 'project')

  const renderRow = (activity: Activity, showLabel: boolean) => (
    <li key={activity.id} data-testid="activity-row" className="flex items-center justify-between px-3 py-2">
      <span>
        <span className="font-medium">{activity.name}</span>
        {showLabel && (
          <span className="text-sm text-muted">
            {' '}
            · {projectLabel(activity.projectId)}
          </span>
        )}
      </span>
      <span className="flex gap-2">
        <EditButton onClick={() => setEditing(activity)} />
        <DeleteButton onClick={() => setConfirming(activity)} />
      </span>
    </li>
  )

  // Three kind-sections share this box, each always rendered. To avoid three identical CTAs
  // (and the duplicate accessible-name that creates) when the account is wholly empty, the
  // icon/description/CTA are attached to ONE section only (Internal, the first) via `enrich`;
  // the other two keep just their bare message. `empty` stays the load-bearing children.
  const box = (
    rows: Activity[],
    showLabel: boolean,
    empty: string,
    testid: string,
    enrich?: { description: string; action: { label: string; onClick: () => void; icon?: 'plus' } },
  ) =>
    rows.length === 0 ? (
      <EmptyState
        icon={enrich ? 'clipboard-check' : undefined}
        description={enrich?.description}
        action={enrich?.action}
      >
        {empty}
      </EmptyState>
    ) : (
      <ul data-testid={testid} className="divide-y divide-line rounded border border-line bg-surface">
        {rows.map((a) => renderRow(a, showLabel))}
      </ul>
    )

  return (
    <ListPage title={m.list_activities_title()} addLabel={m.list_activities_add()} onAdd={() => setCreating(true)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.list_activities_internal_heading()}</h2>
      </div>
      {box(internalActivities, false, m.list_activities_internal_empty(), 'internal-activities', {
        description: m.list_activities_empty_desc(),
        action: { label: m.list_activities_empty_action(), onClick: () => setCreating(true), icon: 'plus' },
      })}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.list_activities_repeatable_heading()}</h2>
      </div>
      {box(repeatableActivities, false, m.list_activities_repeatable_empty(), 'repeatable-activities')}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.list_activities_project_heading()}</h2>
      </div>
      {box(projectActivities, true, m.list_activities_project_empty(), 'project-activities')}

      {creating && <ActivityForm onClose={() => setCreating(false)} />}
      {editing && <ActivityForm activity={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_activities_delete_title()}
          message={m.list_activities_delete_message({ name: confirming.name })}
          onConfirm={() => {
            del(confirming.id)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  )
}
