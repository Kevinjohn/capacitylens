import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { ActivityForm } from './ActivityForm'
import type { Activity } from '@floaty/shared/types/entities'

export function ActivityList() {
  const data = useScopedData()
  const activities = data.activities
  const projects = data.projects
  const clients = data.clients
  const del = useStore((s) => s.deleteActivity)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Activity>()

  // A project-less activity (internal/repeatable) is bucketed under the account's built-in
  // Internal client for display — so its label reads "Internal", not "(no project)".
  const projectLabel = (id: string | undefined) => {
    if (!id) return 'Internal'
    const p = projects.find((x) => x.id === id)
    if (!p) return 'Internal'
    const c = clients.find((x) => x.id === p.clientId)
    return c ? `${c.name} / ${p.name}` : p.name
  }

  // Three kinds, three tables. Internal first (the owner's ordering), then repeatable
  // (reusable across projects — the rename of "general"), then project work.
  const internalActivities = activities.filter((t) => t.kind === 'internal')
  const repeatableActivities = activities.filter((t) => t.kind === 'repeatable')
  const projectActivities = activities.filter((t) => t.kind === 'project')

  const renderRow = (t: Activity, showLabel: boolean) => (
    <li key={t.id} data-testid="activity-row" className="flex items-center justify-between px-3 py-2">
      <span>
        <span className="font-medium">{t.name}</span>
        {showLabel && (
          <span className="text-sm text-muted">
            {' '}
            · {projectLabel(t.projectId)}
          </span>
        )}
      </span>
      <span className="flex gap-2">
        <Button variant="ghost" onClick={() => setEditing(t)}>
          Edit
        </Button>
        <Button variant="danger" onClick={() => setConfirming(t)}>
          Delete
        </Button>
      </span>
    </li>
  )

  const box = (rows: Activity[], showLabel: boolean, empty: string, testid: string) =>
    rows.length === 0 ? (
      <EmptyState>{empty}</EmptyState>
    ) : (
      <ul data-testid={testid} className="divide-y divide-line rounded border border-line bg-surface">
        {rows.map((t) => renderRow(t, showLabel))}
      </ul>
    )

  return (
    <ListPage title="Activities" addLabel="Add activity" onAdd={() => setCreating(true)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Internal activities</h2>
      </div>
      {box(internalActivities, false, 'No internal activities yet.', 'internal-activities')}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Repeatable activities</h2>
      </div>
      {box(repeatableActivities, false, 'No repeatable activities yet.', 'repeatable-activities')}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Project activities</h2>
      </div>
      {box(projectActivities, true, 'No project activities yet.', 'project-activities')}

      {creating && <ActivityForm onClose={() => setCreating(false)} />}
      {editing && <ActivityForm activity={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete activity?"
          message={`Delete "${confirming.name}" and any allocations of it?`}
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
