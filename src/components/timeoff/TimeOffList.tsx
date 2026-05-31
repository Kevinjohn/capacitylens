import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { TIME_OFF_TYPE_LABELS } from '../../lib/metadata'
import { TimeOffForm } from './TimeOffForm'
import type { TimeOff } from '@floaty/shared/types/entities'

export function TimeOffList() {
  const data = useScopedData()
  const timeOff = data.timeOff
  const resources = data.resources
  const del = useStore((s) => s.deleteTimeOff)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<TimeOff>()

  const resourceName = (id: string) => {
    const r = resources.find((x) => x.id === id)
    return r ? (r.name ?? r.role) : '(unknown)'
  }

  return (
    <ListPage title="Time off" addLabel="Add time off" onAdd={() => setCreating(true)}>
      {timeOff.length === 0 ? (
        <EmptyState>No time off booked.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {timeOff.map((t) => (
            <li key={t.id} data-testid="timeoff-row" className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-medium">{resourceName(t.resourceId)}</span>
                <span className="text-sm text-muted">
                  {' '}
                  · {t.startDate} → {t.endDate} · {TIME_OFF_TYPE_LABELS[t.type]}
                  {t.note ? ` · ${t.note}` : ''}
                </span>
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
          ))}
        </ul>
      )}

      {creating && <TimeOffForm onClose={() => setCreating(false)} />}
      {editing && <TimeOffForm timeOff={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete time off?"
          message="Remove this time-off entry?"
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
