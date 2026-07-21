import { useActiveScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { ColorSwatch, ConfirmDialog, DeleteButton, EditButton, EmptyState, ListPage } from '../common/ui'
import { ProjectForm } from './ProjectForm'
import type { AppData, Project } from '@capacitylens/shared/types/entities'
import { archiveImpact } from '@capacitylens/shared/domain/lifecycle'
import { useLifecycleActions } from '../../hooks/useLifecycleActions'
import { m } from '@/i18n'
import { nameForQuotedContext } from '@capacitylens/shared/domain/privateNames'
import { resolveProjectColor } from '@capacitylens/shared/lib/color'
import { useStore } from '../../store/useStore'
import { internalColourModeFor } from '../../store/selectors'
import { Fragment } from 'react'
import { Folder, Plus } from 'lucide-react'
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from '../ui/item'

/** Build the archive-confirm message for a project, appending the allocation-count cascade warning
 *  when the project has active allocations that archiving would pull out of the schedule. */
function projectArchiveMessage(data: AppData, project: Project): string {
  const name = project.isPrivate === true ? nameForQuotedContext(project.name) : project.name
  const base = m.list_projects_archive_message({ name })
  const { allocations } = archiveImpact(data, 'projects', project.id)
  return allocations > 0 ? `${base} ${m.list_projects_archive_cascade({ allocations })}` : base
}

export function ProjectList() {
  const data = useActiveScopedData()
  const projects = data.projects
  const clients = data.clients
  const internalColourMode = useStore((s) => internalColourModeFor(s.data, s.activeAccountId))
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
          icon={Folder}
          description={m.list_projects_empty_desc()}
          action={{ label: m.list_projects_empty_action(), onClick: () => setCreating(true), icon: Plus, requiresEdit: true }}
        >
          {m.list_projects_empty()}
        </EmptyState>
      ) : (
        <ItemGroup className="rounded-md border bg-card">
          {projects.map((p, index) => (
            <Fragment key={p.id}>
            {index > 0 && <ItemSeparator />}
            <Item size="sm" role="listitem" data-testid="project-row" className="rounded-none">
              <ItemContent className="flex-row items-center gap-2">
                <ColorSwatch
                  color={resolveProjectColor(p, clients.find((client) => client.id === p.clientId), internalColourMode)}
                />
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground">· {clientName(p.clientId)}</span>
              </ItemContent>
              <ItemActions>
                <EditButton onClick={() => setEditing(p)} />
                <DeleteButton label={m.list_projects_archive_aria({ name: p.name })} onClick={() => setConfirming(p)} />
              </ItemActions>
            </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}

      {creating && <ProjectForm onClose={() => setCreating(false)} />}
      {editing && <ProjectForm project={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title={m.list_projects_archive_title()}
          message={projectArchiveMessage(data, confirming)}
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
