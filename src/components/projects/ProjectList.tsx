import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { ProjectForm } from './ProjectForm'
import type { Project } from '@capacitylens/shared/types/entities'
import { useLifecycleActions } from '../../hooks/useLifecycleActions'
import { m } from '@/i18n'

export function ProjectList() {
  const data = useActiveScopedData()
  const projects = data.projects
  const clients = data.clients
  // The per-row action ARCHIVES (soft-delete is reached later from Settings → Archived & deleted);
  // `archive` branches server/local + reloads the active slice in server mode (see useLifecycleActions).
  const { archive } = useLifecycleActions()
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Project>()

  const clientName = (id: string) => {
    const c = clients.find((x) => x.id === id)
    return c?.name ?? m.list_projects_no_client()
  }

  return (
    <ListPage title={m.list_projects_title()} addLabel={m.list_projects_add()} onAdd={() => setCreating(true)}>
      {projects.length === 0 ? (
        <EmptyState
          icon="folder"
          description={m.list_projects_empty_desc()}
          action={{ label: m.list_projects_empty_action(), onClick: () => setCreating(true), icon: 'plus' }}
        >
          {m.list_projects_empty()}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {projects.map((p) => (
            <li key={p.id} data-testid="project-row" className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2">
                <ColorSwatch color={p.color} />
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted">· {clientName(p.clientId)}</span>
              </span>
              <span className="flex gap-2">
                <EditButton onClick={() => setEditing(p)} />
                <DeleteButton label={m.list_projects_archive_aria({ name: p.name })} onClick={() => setConfirming(p)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ProjectForm onClose={() => setCreating(false)} />}
      {editing && <ProjectForm project={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_projects_archive_title()}
          message={m.list_projects_archive_message({ name: confirming.name })}
          confirmLabel={m.list_archive()}
          onConfirm={() => {
            void archive('projects', confirming.id)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </ListPage>
  )
}
