import { useStore } from '../../store/useStore'
import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { isBuiltinClient } from '@capacitylens/shared/data/internalClient'
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { ClientForm } from './ClientForm'
import type { Client } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'

export function ClientList() {
  // The built-in Internal client is a behind-the-scenes data anchor (project-less internal/repeatable
  // activities bucket under it; it can own real projects), NOT a user-managed client — so it is HIDDEN
  // from this management list. It stays a REAL, persisted client everywhere it's actually used:
  // selectable in ProjectForm's client picker, a "Filter by client" option in the scheduler, and a
  // Clients entry in the command palette (all of which read `useActiveScopedData().clients` directly,
  // not this view) — and a project under Internal still resolves its client label. See DECISIONS.md.
  const clients = useActiveScopedData().clients.filter((c) => !isBuiltinClient(c))
  const deleteClient = useStore((s) => s.deleteClient)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Client>()

  return (
    <ListPage title={m.list_clients_title()} addLabel={m.list_clients_add()} onAdd={() => setCreating(true)}>
      {clients.length === 0 ? (
        <EmptyState
          icon="briefcase"
          description={m.list_clients_empty_desc()}
          action={{ label: m.list_clients_empty_action(), onClick: () => setCreating(true), icon: 'plus' }}
        >
          {m.list_clients_empty()}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {clients.map((c) => (
            <li key={c.id} data-testid="client-row" className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2">
                <ColorSwatch color={c.color} />
                {c.name}
              </span>
              <span className="flex gap-2">
                <EditButton onClick={() => setEditing(c)} />
                <DeleteButton onClick={() => setConfirming(c)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ClientForm onClose={() => setCreating(false)} />}
      {editing && <ClientForm client={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_clients_delete_title()}
          message={m.list_clients_delete_message({ name: confirming.name })}
          onConfirm={() => {
            deleteClient(confirming.id)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  )
}
