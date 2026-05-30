import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { ClientForm } from './ClientForm'
import type { Client } from '../../types/entities'

export function ClientList() {
  const clients = useScopedData().clients
  const deleteClient = useStore((s) => s.deleteClient)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Client>()

  return (
    <ListPage title="Clients" addLabel="Add client" onAdd={() => setCreating(true)}>
      {clients.length === 0 ? (
        <EmptyState>No clients yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {clients.map((c) => (
            <li key={c.id} data-testid="client-row" className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2">
                <ColorSwatch color={c.color} />
                {c.name}
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => setConfirming(c)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ClientForm onClose={() => setCreating(false)} />}
      {editing && <ClientForm client={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete client?"
          message={`Delete "${confirming.name}" and all of its projects, phases, tasks and allocations? You can undo this with ⌘Z.`}
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
