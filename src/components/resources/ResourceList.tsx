import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { useCrudListState } from '../../hooks/useCrudListState'
import { Button, ColorSwatch, ConfirmDialog, EmptyState, ListPage } from '../common/ui'
import { ResourceForm } from './ResourceForm'
import type { Resource, ResourceKind } from '@floaty/shared/types/entities'

export function ResourceList() {
  const data = useScopedData()
  const resources = data.resources
  const disciplines = data.disciplines
  const del = useStore((s) => s.deleteResource)
  const { editing, setEditing, confirming, setConfirming } = useCrudListState<Resource>()
  // People and placeholders each have their own add button; remember which kind is
  // being created so the right modal opens.
  const [creatingKind, setCreatingKind] = useState<ResourceKind | null>(null)

  const people = resources.filter((r) => r.kind === 'person')
  const placeholders = resources.filter((r) => r.kind === 'placeholder')

  const disciplineName = (id?: string) => disciplines.find((d) => d.id === id)?.name ?? '—'
  // A resource's colour follows its discipline (resources no longer pick their own);
  // fall back to the stored colour for the disciplineless ones.
  const swatchColor = (r: Resource) => disciplines.find((d) => d.id === r.disciplineId)?.color ?? r.color

  const renderRow = (r: Resource) => (
    <li key={r.id} data-testid="resource-row" className="flex items-center justify-between px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <ColorSwatch color={swatchColor(r)} />
        <span className="font-medium">{r.name ?? r.role}</span>
        {r.kind === 'placeholder' && (
          <span className="rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">placeholder</span>
        )}
        <span className="text-sm text-muted">
          · {r.role} · {disciplineName(r.disciplineId)} · {r.workingHoursPerDay}h/day
        </span>
      </span>
      <span className="flex gap-2">
        <Button variant="ghost" onClick={() => setEditing(r)}>
          Edit
        </Button>
        <Button variant="danger" onClick={() => setConfirming(r)}>
          Delete
        </Button>
      </span>
    </li>
  )

  const box = (rows: Resource[], empty: string) =>
    rows.length === 0 ? (
      <EmptyState>{empty}</EmptyState>
    ) : (
      <ul className="divide-y divide-line rounded border border-line bg-surface">{rows.map(renderRow)}</ul>
    )

  return (
    <ListPage title="Resources" addLabel="Add resource" onAdd={() => setCreatingKind('person')}>
      {box(people, 'No resources yet.')}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Placeholders</h2>
        <Button onClick={() => setCreatingKind('placeholder')}>Add placeholder</Button>
      </div>
      {box(placeholders, 'No placeholders yet.')}

      {creatingKind && <ResourceForm kind={creatingKind} onClose={() => setCreatingKind(null)} />}
      {editing && <ResourceForm resource={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmDialog
          title="Delete resource?"
          message={`Delete "${confirming.name ?? confirming.role}" and all of their allocations and time off? You can undo this with ⌘Z.`}
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
