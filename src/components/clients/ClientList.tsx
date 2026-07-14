import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { isBuiltinClient } from '@capacitylens/shared/data/internalClient'
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { ClientForm } from './ClientForm'
import type { AppData, Client } from '@capacitylens/shared/types/entities'
import { archiveImpact } from '@capacitylens/shared/domain/lifecycle'
import { useLifecycleActions } from '../../hooks/useLifecycleActions'
import { m } from '@/i18n'

/** Build the archive-confirm message for a client, appending the descendant-count cascade warning
 *  ("this also hides N projects and M allocations") when the client has active work beneath it — so
 *  the admin sees exactly what an archive pulls out of the schedule (counts via the pure
 *  archiveImpact, which diffs the same activeOnly projection the view uses). */
function clientArchiveMessage(data: AppData, client: Client): string {
  const base = m.list_clients_archive_message({ name: client.name })
  const { projects, allocations } = archiveImpact(data, 'clients', client.id)
  return projects + allocations > 0
    ? `${base} ${m.list_clients_archive_cascade({ projects, allocations })}`
    : base
}

export function ClientList() {
  // The built-in Internal client is a behind-the-scenes data anchor (project-less internal/repeatable
  // activities bucket under it; it can own real projects), NOT a user-managed client — so it is HIDDEN
  // from this management list. It stays a REAL, persisted client everywhere it's actually used:
  // selectable in ProjectForm's client picker, a "Filter by client" option in the scheduler, and a
  // Clients entry in the command palette (all of which read `useActiveScopedData().clients` directly,
  // not this view) — and a project under Internal still resolves its client label. See DECISIONS.md.
  const scoped = useActiveScopedData()
  const clients = scoped.clients.filter((c) => !isBuiltinClient(c))
  // The per-row action ARCHIVES (soft-delete is reached later from Settings → Archived & deleted);
  // `archive` branches server/local + reloads the active slice in server mode (see useLifecycleActions).
  const { archive } = useLifecycleActions()
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
                <DeleteButton label={m.list_clients_archive_aria({ name: c.name })} onClick={() => setConfirming(c)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ClientForm onClose={() => setCreating(false)} />}
      {editing && <ClientForm client={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_clients_archive_title()}
          message={clientArchiveMessage(scoped, confirming)}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive('clients', confirming.id)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  )
}
