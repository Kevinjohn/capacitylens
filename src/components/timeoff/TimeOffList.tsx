import { useStore } from '../../store/useStore'
import { placeholdersEnabledFor } from '../../store/selectors'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { resourceDisplayName } from '../../lib/metadata'
import { formatShortDate, formatDayCount } from '../../lib/dateDisplay'
import { TimeOffForm } from './TimeOffForm'
import type { TimeOff } from '@floaty/shared/types/entities'

export function TimeOffList() {
  const data = useScopedData()
  const resources = data.resources
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId))
  const del = useStore((s) => s.deleteTimeOff)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<TimeOff>()

  // Placeholders are gated behind a per-account pref (default OFF). When off, HIDE time-off whose
  // resource is a placeholder — a pure view filter: the entries stay in the store (export/import and
  // the schedule are untouched), they're just not rendered while placeholders are hidden everywhere
  // else. An empty result here still falls through to the existing empty-state below.
  const timeOff = placeholdersEnabled
    ? data.timeOff
    : data.timeOff.filter((t) => resources.find((r) => r.id === t.resourceId)?.kind !== 'placeholder')

  const resourceName = (id: string) => {
    const r = resources.find((x) => x.id === id)
    return r ? resourceDisplayName(r) : '(unknown)'
  }

  return (
    <ListPage title="Time off" addLabel="Add time off" onAdd={() => setCreating(true)}>
      {timeOff.length === 0 ? (
        <EmptyState
          icon="calendar"
          description="Book holidays and other time away so the schedule shows real availability."
          action={{ label: 'Book time off', onClick: () => setCreating(true), icon: 'plus' }}
        >
          No time off booked.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {timeOff.map((t) => (
            <li key={t.id} data-testid="timeoff-row" className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-medium">{resourceName(t.resourceId)}</span>
                {/* Deliberately spare: the start date (terse) and how many days. The end date, type
                    and note are stored (and surfaced on the schedule's time-off block) but left off
                    this list — it's a "who's away, from when, for how long" scan, not a detail view. */}
                <span className="text-sm text-muted">
                  {' '}
                  · {formatShortDate(t.startDate)} · {formatDayCount(t.startDate, t.endDate)}
                </span>
              </span>
              <span className="flex gap-2">
                <EditButton onClick={() => setEditing(t)} />
                <DeleteButton onClick={() => setConfirming(t)} />
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
