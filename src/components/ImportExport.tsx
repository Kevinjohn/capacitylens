import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useScopedData } from '../store/useScopedData'
import { parseData, serializeData } from '@capacitylens/shared/data/transfer'
import { downloadTextFile } from '../lib/download'
import { errorMessage } from '../lib/errorMessage'
import { ConfirmDialog } from './common/ui'
import type { AppData } from '@capacitylens/shared/types/entities'
import { APP_NAME } from '@capacitylens/shared/brand'

// Refuse files past this size before reading them into memory (self-DoS guard).
const MAX_IMPORT_BYTES = 10_000_000

// Order + labels for the "what's in this file" import summary.
const SUMMARY: [keyof AppData, string][] = [
  ['resources', 'resources'],
  ['disciplines', 'disciplines'],
  ['clients', 'clients'],
  ['projects', 'projects'],
  ['phases', 'phases'],
  ['activities', 'activities'],
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
    // downloadTextFile throws if the download couldn't start — surface it rather than letting it
    // escape as an uncaught handler error, so the user knows the export did NOT save.
    try {
      downloadTextFile('capacitylens-data.json', serializeData(data))
    } catch (e) {
      setNotice(errorMessage(e), 'error')
    }
  }

  const onImport = async (file: File) => {
    // Reject an oversized file before reading it into memory (self-DoS guard).
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice(`That file is too large to import (max ${MAX_IMPORT_BYTES / 1_000_000}MB).`, 'error')
      return
    }
    try {
      const parsed = parseData(await file.text())
      setPendingImport({ data: parsed, name: file.name })
    } catch (e) {
      // parseData throws PRECISE, user-ready messages ("This file isn't valid JSON.", "This file is
      // damaged: a data table is not a list.", "This file has too many records (…)", "This file
      // contains no CapacityLens records.") — surface the REAL reason instead of a generic catch-all, so
      // the user (and a contributor) knows why the file was rejected.
      setNotice(errorMessage(e) || `Could not import that file — it is not valid ${APP_NAME} JSON.`, 'error')
    }
  }

  const confirmImport = () => {
    if (!pendingImport) return
    // importData → requireAccount() throws if there's no active account, but ImportExport only ever
    // renders behind AppShell's tenant gate, so an account is always active here — confirmImport
    // can't throw on that path today. (Cross-file invariant; if this panel is ever rendered outside
    // the gate, add a guard. Don't wrap importData in a swallowing try/catch — its throws matter.)
    const { imported, skipped } = importData(pendingImport.data)
    setPendingImport(null)
    // When EVERY record was dropped (imported === 0) the store no-ops — it pushes NO undo
    // entry — so we must NOT tell the user to press ⌘Z (that would revert their PREVIOUS,
    // unrelated edit). Report the failure instead.
    if (imported === 0) {
      const why = skipped > 0 ? ` — ${skipped} invalid ${skipped === 1 ? 'record' : 'records'} skipped` : ''
      setNotice(`No records imported${why}.`, 'error')
      return
    }
    // Report the delta honestly: the store drops allocations/time-off with broken
    // ranges or dangling refs, so "imported 40" can become 31 in the store.
    const skippedNote = skipped > 0 ? ` (${skipped} invalid ${skipped === 1 ? 'record' : 'records'} skipped)` : ''
    setNotice(`Imported ${imported} ${imported === 1 ? 'record' : 'records'}${skippedNote}. Press ⌘Z to undo.`)
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
