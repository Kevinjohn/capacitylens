import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage, TemporaryTag } from '../common/ui'
import { ResourceForm } from './ResourceForm'
import type { Resource } from '@floaty/shared/types/entities'

export function ResourceList() {
  const data = useScopedData()
  const resources = data.resources
  const disciplines = data.disciplines
  const del = useStore((s) => s.deleteResource)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Resource>()

  const disciplineName = (id?: string) => disciplines.find((d) => d.id === id)?.name ?? '—'

  return (
    <ListPage title="Resources" addLabel="Add resource" onAdd={() => setCreating(true)}>
      {resources.length === 0 ? (
        <EmptyState>No resources yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {resources.map((r) => (
            <li key={r.id} data-testid="resource-row" className="flex items-center justify-between px-3 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <ColorSwatch color={r.color} />
                <span className="font-medium">{r.name ?? r.role}</span>
                {r.kind === 'placeholder' && (
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">placeholder</span>
                )}
                <TemporaryTag resource={r} />
                <span className="text-sm text-muted">
                  · {r.role} · {disciplineName(r.disciplineId)} · {r.workingHoursPerDay}h/day
                </span>
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => setConfirming(r)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ResourceForm onClose={() => setCreating(false)} />}
      {editing && <ResourceForm resource={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete resource?"
          message={`Delete "${confirming.name ?? confirming.role}" and all of their allocations and time off? You can undo this with ⌘Z.`}
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
