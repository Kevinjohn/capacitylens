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

  const projectLabel = (id: string | undefined) => {
    if (!id) return 'General'
    const p = projects.find((x) => x.id === id)
    if (!p) return '(no project)'
    const c = clients.find((x) => x.id === p.clientId)
    return c ? `${c.name} / ${p.name}` : p.name
  }

  // General tasks (no project) stand apart from client work, so they get their own
  // table up top — mirrors the people/placeholders split on the Resources page.
  const generalTasks = tasks.filter((t) => !t.projectId)
  const clientTasks = tasks.filter((t) => t.projectId)

  const renderRow = (t: Task, showLabel: boolean) => (
    <li key={t.id} data-testid="task-row" className="flex items-center justify-between px-3 py-2">
      <span>
        <span className="font-medium">{t.name}</span>
        {showLabel && (
          <span className="text-sm text-muted">
            {' '}
            · {projectLabel(t.projectId)}
          </span>
        )}
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
  )

  const box = (rows: Task[], showLabel: boolean, empty: string) =>
    rows.length === 0 ? (
      <EmptyState>{empty}</EmptyState>
    ) : (
      <ul className="divide-y divide-line rounded border border-line bg-surface">
        {rows.map((t) => renderRow(t, showLabel))}
      </ul>
    )

  return (
    <ListPage title="Tasks" addLabel="Add task" onAdd={() => setCreating(true)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">General tasks</h2>
      </div>
      {box(generalTasks, false, 'No general tasks yet.')}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Client tasks</h2>
      </div>
      {box(clientTasks, true, 'No client tasks yet.')}

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
