import { useState } from 'react'
import { storageAdapter } from '../data/storageAdapter'
import { Button, ConfirmDialog } from './common/ui'

// Shown when bootstrap found stored data it could NOT read (corrupt JSON / failed
// migrate). Autosave is deliberately not attached in that state, so the original
// bytes are still on disk — this screen lets the user salvage them ("Download raw")
// before resetting, rather than silently starting from empty and overwriting them.
export function StorageRecovery() {
  const [confirming, setConfirming] = useState(false)

  const downloadRaw = () => {
    const raw = storageAdapter.readRaw() ?? ''
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floaty-corrupt-backup.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Clear the unreadable data and reload — bootstrap then reseeds from scratch.
  const reset = () => {
    storageAdapter.clear()
    window.location.reload()
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-ink">Stored data could not be read</h1>
        <p className="mb-4 text-sm text-muted">
          Your saved Floaty data is present but unreadable, so it hasn’t been loaded. To protect it,
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
      </div>

      {confirming && (
        <ConfirmDialog
          title="Reset stored data?"
          confirmLabel="Reset"
          message={
            <>
              This permanently discards the unreadable data and starts Floaty fresh. Download a raw copy
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
