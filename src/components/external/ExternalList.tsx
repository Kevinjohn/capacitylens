import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { ExternalForm } from './ExternalForm'
import { isExternalResource } from '@floaty/shared/types/entities'
import type { Resource } from '@floaty/shared/types/entities'

/**
 * The External / 3rd-party tab: outsourcing partners you assign work to but don't track the hours
 * of. They live on their OWN tab (deliberately out of the Resources tab), are assignable to any
 * task, and render in a neutral band at the bottom of the schedule with no capacity/utilisation.
 * Delete reuses the store's resource cascade (drops the party's allocations), so it's undoable.
 */
export function ExternalList() {
  const externals = useScopedData().resources.filter(isExternalResource)
  const del = useStore((s) => s.deleteResource)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Resource>()

  return (
    <ListPage title="External / 3rd parties" addLabel="Add external party" onAdd={() => setCreating(true)}>
      {externals.length === 0 ? (
        <EmptyState>No external parties yet.</EmptyState>
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

      {creating && <ExternalForm onClose={() => setCreating(false)} />}
      {editing && <ExternalForm resource={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete external party?"
          message={`Delete "${confirming.name ?? confirming.role}" and all of its allocations? You can undo this with ⌘Z.`}
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
