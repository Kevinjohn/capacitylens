import { useStore } from '../../store/useStore'
import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { NEUTRAL_COLOR } from '../../lib/palette'
import { byDisciplineOrder } from '../../store/selectors'
import { DisciplineForm } from './DisciplineForm'
import type { Discipline } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'

export function DisciplineList() {
  const disciplines = useActiveScopedData().disciplines
  const del = useStore((s) => s.deleteDiscipline)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Discipline>()

  const sorted = [...disciplines].sort(byDisciplineOrder)

  return (
    <ListPage title={m.list_disciplines_title()} addLabel={m.list_disciplines_add()} onAdd={() => setCreating(true)}>
      {sorted.length === 0 ? (
        <EmptyState
          icon="tag"
          description={m.list_disciplines_empty_desc()}
          action={{ label: m.list_disciplines_empty_action(), onClick: () => setCreating(true), icon: 'plus' }}
        >
          {m.list_disciplines_empty()}
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
                <EditButton onClick={() => setEditing(d)} />
                <DeleteButton onClick={() => setConfirming(d)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <DisciplineForm onClose={() => setCreating(false)} />}
      {editing && <DisciplineForm discipline={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_disciplines_delete_title()}
          message={m.list_disciplines_delete_message({ name: confirming.name })}
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
