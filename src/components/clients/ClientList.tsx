import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { isBuiltinClient } from '@floaty/shared/data/internalClient'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { ClientForm } from './ClientForm'
import type { Client } from '@floaty/shared/types/entities'

export function ClientList() {
  // The built-in Internal client is a behind-the-scenes data anchor (project-less internal/repeatable
  // activities bucket under it; it can own real projects), NOT a user-managed client — so it is HIDDEN
  // from this management list. It stays a REAL, persisted client everywhere it's actually used:
  // selectable in ProjectForm's client picker, a "Filter by client" option in the scheduler, and a
  // Clients entry in the command palette (all of which read `useScopedData().clients` directly, not
  // this view) — and a project under Internal still resolves its client label. See DECISIONS.md.
  const clients = useScopedData().clients.filter((c) => !isBuiltinClient(c))
  const deleteClient = useStore((s) => s.deleteClient)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Client>()

  return (
    <ListPage title="Clients" addLabel="Add client" onAdd={() => setCreating(true)}>
      {clients.length === 0 ? (
        <EmptyState
          icon="briefcase"
          description="Clients are the companies your team does work for."
          action={{ label: 'Add your first client', onClick: () => setCreating(true) }}
        >
          No clients yet.
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
          message={`Delete "${confirming.name}" and all of its projects, phases, activities and allocations? You can undo this with ⌘Z.`}
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
