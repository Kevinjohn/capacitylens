import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { TaskForm } from './TaskForm'
import type { Task } from '@floaty/shared/types/entities'

export function TaskList() {
  const data = useScopedData()
  const tasks = data.tasks
  const projects = data.projects
  const clients = data.clients
  const del = useStore((s) => s.deleteTask)
  const { creating, setCreating, editing, setEditing, confirming, setConfirming } = useCrudListState<Task>()

  const projectLabel = (id: string) => {
    const p = projects.find((x) => x.id === id)
    if (!p) return '(no project)'
    const c = clients.find((x) => x.id === p.clientId)
    return c ? `${c.name} / ${p.name}` : p.name
  }

  return (
    <ListPage title="Tasks" addLabel="Add task" onAdd={() => setCreating(true)}>
      {tasks.length === 0 ? (
        <EmptyState>No tasks yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {tasks.map((t) => (
            <li key={t.id} data-testid="task-row" className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-medium">{t.name}</span>
                <span className="text-sm text-muted">
                  {' '}
                  · {projectLabel(t.projectId)}
                </span>
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => setConfirming(t)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <TaskForm onClose={() => setCreating(false)} />}
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete task?"
          message={`Delete "${confirming.name}" and any allocations of it?`}
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
