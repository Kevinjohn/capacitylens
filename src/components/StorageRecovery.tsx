import { useState } from 'react'
import { storageAdapter } from '../data/storageAdapter'
import { downloadTextFile } from '../lib/download'
import { errorMessage } from '../lib/errorMessage'
import { Button, ConfirmDialog } from './common/ui'
import { APP_NAME } from '@capacitylens/shared/brand'

// Shown when bootstrap found stored data it could NOT read (corrupt JSON / failed
// migrate). Autosave is deliberately not attached in that state, so the original
// bytes are still on disk — this screen lets the user salvage them ("Download raw")
// before resetting, rather than silently starting from empty and overwriting them.
export function StorageRecovery() {
  const [confirming, setConfirming] = useState(false)
  // This is the data-SALVAGE screen, so a failure of the salvage itself must be VISIBLE here —
  // never a silent no-op or an uncaught handler error that leaves the user stranded with neither a
  // backup nor a reset.
  const [error, setError] = useState<string | null>(null)

  const downloadRaw = () => {
    const raw = storageAdapter.readRaw()
    if (raw === null) {
      // readRaw() returns null when storage can't be read at all — don't hand the user an EMPTY
      // file they'd mistake for a real backup. Tell them instead.
      setError('Couldn’t read the stored bytes — your browser may be blocking storage access. Check its storage/privacy settings and try again.')
      return
    }
    try {
      downloadTextFile('capacitylens-corrupt-backup.json', raw)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  // Clear the unreadable data and reload — bootstrap then reseeds from scratch. storageAdapter.clear()
  // swallows its own storage errors by design (the reload re-attempts and reseeds anyway), so this
  // can't throw; the reload always runs.
  const reset = () => {
    storageAdapter.clear()
    window.location.reload()
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-ink">Stored data could not be read</h1>
        <p className="mb-4 text-sm text-muted">
          Your saved {APP_NAME} data is present but unreadable, so it hasn’t been loaded. To protect it,
          nothing has been saved over it. Download a raw copy to keep (you can try to repair it), then
          reset to start fresh. After resetting you can import a backup from the Data menu.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={downloadRaw}>
            Download raw copy
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Reset data
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Reset stored data?"
          confirmLabel="Reset"
          message={
            <>
              This permanently discards the unreadable data and starts {APP_NAME} fresh. Download a raw copy
              first if you might want to recover it.
            </>
          }
          onConfirm={reset}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
