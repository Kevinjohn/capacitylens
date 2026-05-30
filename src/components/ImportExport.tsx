import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useScopedData } from '../store/useScopedData'
import { parseData, serializeData } from '../data/transfer'
import { ConfirmDialog } from './common/ui'
import type { AppData } from '../types/entities'

// Refuse files past this size before reading them into memory (self-DoS guard).
const MAX_IMPORT_BYTES = 10_000_000

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
  // Export only the active account's data (the `accounts` list itself is omitted,
  // since import re-stamps everything into whichever account is active).
  const data = useScopedData()
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
    // Reject an oversized file before reading it into memory (self-DoS guard).
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice(`That file is too large to import (max ${MAX_IMPORT_BYTES / 1_000_000}MB).`)
      return
    }
    try {
      const parsed = parseData(await file.text())
      setPendingImport({ data: parsed, name: file.name })
    } catch {
      setNotice('Could not import that file — it is not valid Floaty JSON.')
    }
  }

  const confirmImport = () => {
    if (!pendingImport) return
    const { imported, skipped } = importData(pendingImport.data)
    // Report the delta honestly: the store drops allocations/time-off with broken
    // ranges or dangling refs, so "imported 40" can become 31 in the store.
    const skippedNote = skipped > 0 ? ` (${skipped} invalid ${skipped === 1 ? 'record' : 'records'} skipped)` : ''
    setNotice(`Imported ${imported} ${imported === 1 ? 'record' : 'records'}${skippedNote}. Press ⌘Z to undo.`)
    setPendingImport(null)
  }

  const linkClass = 'block w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-canvas'

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
              <span className="font-medium text-ink">replaces this company’s data</span> with{' '}
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
