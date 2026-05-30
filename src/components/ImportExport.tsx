import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { parseData, serializeData } from '../data/transfer'
import { ConfirmDialog } from './common/ui'
import type { AppData } from '../types/entities'

// Order + labels for the "what's in this file" import summary.
const SUMMARY: [keyof AppData, string][] = [
  ['resources', 'resources'],
  ['disciplines', 'disciplines'],
  ['clients', 'clients'],
  ['projects', 'projects'],
  ['phases', 'phases'],
  ['tasks', 'tasks'],
  ['allocations', 'allocations'],
  ['timeOff', 'time-off entries'],
]

function summarize(data: AppData): string {
  const parts = SUMMARY.filter(([k]) => data[k].length > 0).map(([k, label]) => `${data[k].length} ${label}`)
  return parts.length ? parts.join(', ') : 'no entities'
}

export function ImportExport() {
  const data = useStore((s) => s.data)
  const importData = useStore((s) => s.importData)
  const setNotice = useStore((s) => s.setNotice)
  const fileRef = useRef<HTMLInputElement>(null)
  // A parsed-but-not-yet-applied import, awaiting the user's confirmation. Import
  // is a full replace, so we never apply it silently — confirm first, and the
  // apply goes through the undoable history path so ⌘Z restores the old data.
  const [pendingImport, setPendingImport] = useState<{ data: AppData; name: string } | null>(null)

  const onExport = () => {
    const blob = new Blob([serializeData(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floaty-data.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImport = async (file: File) => {
    try {
      const parsed = parseData(await file.text())
      setPendingImport({ data: parsed, name: file.name })
    } catch {
      setNotice('Could not import that file — it is not valid Floaty JSON.')
    }
  }

  const confirmImport = () => {
    if (!pendingImport) return
    importData(pendingImport.data)
    setNotice(`Imported ${pendingImport.name}. Press ⌘Z to undo.`)
    setPendingImport(null)
  }

  const linkClass = 'block w-full rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-base'

  return (
    <div className="mt-6 border-t border-line pt-3">
      <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-faint">Data</div>
      <button type="button" data-testid="export-data" onClick={onExport} className={linkClass}>
        Export JSON
      </button>
      <button type="button" data-testid="import-data" onClick={() => fileRef.current?.click()} className={linkClass}>
        Import JSON
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        data-testid="import-input"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImport(f)
          e.target.value = ''
        }}
      />

      {pendingImport && (
        <ConfirmDialog
          title="Import data?"
          confirmLabel="Replace data"
          message={
            <>
              Import <span className="font-medium text-ink">{pendingImport.name}</span> — this{' '}
              <span className="font-medium text-ink">replaces all current data</span> with{' '}
              {summarize(pendingImport.data)}. You can undo this with ⌘Z.
            </>
          }
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  )
}
