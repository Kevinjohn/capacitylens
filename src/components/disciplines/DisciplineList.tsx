import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { NEUTRAL_COLOR } from '../../lib/palette'
import { byDisciplineOrder } from '../../store/selectors'
import { DisciplineForm } from './DisciplineForm'
import type { Discipline } from '@floaty/shared/types/entities'

export function DisciplineList() {
  const disciplines = useScopedData().disciplines
  const del = useStore((s) => s.deleteDiscipline)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Discipline>()

  const sorted = [...disciplines].sort(byDisciplineOrder)

  return (
    <ListPage title="Disciplines" addLabel="Add discipline" onAdd={() => setCreating(true)}>
      {sorted.length === 0 ? (
        <EmptyState
          icon="tag"
          description="Disciplines group your people and give them a colour on the schedule."
          action={{ label: 'Add your first discipline', onClick: () => setCreating(true) }}
        >
          No disciplines yet.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {sorted.map((d) => (
            <li key={d.id} data-testid="discipline-row" className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2">
                <ColorSwatch color={d.color ?? NEUTRAL_COLOR} />
                {d.name}
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(d)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => setConfirming(d)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <DisciplineForm onClose={() => setCreating(false)} />}
      {editing && <DisciplineForm discipline={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete discipline?"
          message={`Delete "${confirming.name}"? Resources in it will be ungrouped (not deleted).`}
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
