import { useStore } from '../../store/useStore'
import { placeholdersEnabledFor } from '../../store/selectors'
import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { resourceDisplayName } from '../../lib/metadata'
import { formatShortDate, formatDayCount } from '../../lib/dateDisplay'
import { TimeOffForm } from './TimeOffForm'
import type { TimeOff } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'
import { Fragment } from 'react'
import { Calendar, Plus } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from '../ui/item'

export function TimeOffList() {
  const data = useActiveScopedData()
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
    return r ? resourceDisplayName(r) : m.list_timeoff_unknown_resource()
  }

  return (
    <ListPage title={m.list_timeoff_title()} addLabel={m.list_timeoff_add()} onAdd={() => setCreating(true)}>
      {timeOff.length === 0 ? (
        <EmptyState
          icon={Calendar}
          description={m.list_timeoff_empty_desc()}
          action={{ label: m.list_timeoff_empty_action(), onClick: () => setCreating(true), icon: Plus, requiresEdit: true }}
        >
          {m.list_timeoff_empty()}
        </EmptyState>
      ) : (
        <ItemGroup className="rounded-md border bg-card">
          {timeOff.map((t, index) => (
            <Fragment key={t.id}>
            {index > 0 && <ItemSeparator />}
            <Item size="sm" role="listitem" data-testid="timeoff-row" className="rounded-none">
              <ItemContent>
                <span className="font-medium">{resourceName(t.resourceId)}</span>
                {/* Deliberately spare: the start date (terse) and how many days. The end date, type
                    and note are stored (and surfaced on the schedule's time-off block) but left off
                    this list — it's a "who's away, from when, for how long" scan, not a detail view. */}
                <span className="text-sm text-muted-foreground">
                  {' '}
                  · {formatShortDate(t.startDate)} · {formatDayCount(t.startDate, t.endDate)}
                </span>
              </ItemContent>
              <ItemActions>
                <EditButton onClick={() => setEditing(t)} />
                <DeleteButton onClick={() => setConfirming(t)} />
              </ItemActions>
            </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}

      {creating && <TimeOffForm onClose={() => setCreating(false)} />}
      {editing && <TimeOffForm timeOff={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_timeoff_delete_title()}
          message={m.list_timeoff_delete_message()}
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
