import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { ProjectForm } from './ProjectForm'
import type { Project } from '../../types/entities'

export function ProjectList() {
  const projects = useStore((s) => s.data.projects)
  const clients = useStore((s) => s.data.clients)
  const del = useStore((s) => s.deleteProject)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [confirming, setConfirming] = useState<Project | null>(null)

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? '(no client)'

  return (
    <ListPage title="Projects" addLabel="Add project" onAdd={() => setCreating(true)}>
      {projects.length === 0 ? (
        <EmptyState>No projects yet.</EmptyState>
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
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => setConfirming(p)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <ProjectForm onClose={() => setCreating(false)} />}
      {editing && <ProjectForm project={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete project?"
          message={`Delete "${confirming.name}" with its phases, tasks and allocations? Placeholders bound to it will be unbound.`}
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
