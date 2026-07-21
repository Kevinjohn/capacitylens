import { useStore } from '../../store/useStore'
import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { ActivityForm } from './ActivityForm'
import type { Activity } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'
import { Fragment } from 'react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from '../ui/item'

export function ActivityList() {
  const data = useActiveScopedData()
  const activities = data.activities
  const projects = data.projects
  const clients = data.clients
  const del = useStore((s) => s.deleteActivity)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Activity>()

  // A project-less activity (internal/cross-project) is bucketed under the account's built-in
  // Internal client for display — so its label reads "Internal", not "(no project)".
  const projectLabel = (id: string | undefined) => {
    if (!id) return m.list_activities_internal_label()
    const p = projects.find((x) => x.id === id)
    if (!p) return m.list_activities_no_project()
    const c = clients.find((x) => x.id === p.clientId)
    return c ? `${c.name} / ${p.name}` : p.name
  }

  // Three kinds, three tables. Internal first (the owner's ordering), then cross-project
  // (stored as `repeatable` for compatibility), then project-specific work.
  const internalActivities = activities.filter((a) => a.kind === 'internal')
  const repeatableActivities = activities.filter((a) => a.kind === 'repeatable')
  const projectActivities = activities.filter((a) => a.kind === 'project')

  const renderRow = (activity: Activity, showLabel: boolean) => (
    <Item size="sm" role="listitem" data-testid="activity-row" className="rounded-none">
      <ItemContent>
        <span className="font-medium">{activity.name}</span>
        {showLabel && (
          <span className="text-sm text-muted">
            {' '}
            · {projectLabel(activity.projectId)}
          </span>
        )}
      </ItemContent>
      <ItemActions>
        <EditButton onClick={() => setEditing(activity)} />
        <DeleteButton onClick={() => setConfirming(activity)} />
      </ItemActions>
    </Item>
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
      <ItemGroup data-testid={testid} className="rounded-md border bg-card">
        {rows.map((activity, index) => (
          <Fragment key={activity.id}>
            {index > 0 && <ItemSeparator />}
            {renderRow(activity, showLabel)}
          </Fragment>
        ))}
      </ItemGroup>
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
      {box(repeatableActivities, false, m.list_activities_repeatable_empty(), 'cross-project-activities')}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.list_activities_project_heading()}</h2>
      </div>
      {box(projectActivities, true, m.list_activities_project_empty(), 'project-specific-activities')}

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
