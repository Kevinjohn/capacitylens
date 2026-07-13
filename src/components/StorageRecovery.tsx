import { useState } from 'react'
import { storageAdapter } from '../data/storageAdapter'
import { readLegacyRaw, removeLegacyKeys } from '../data/storageMigration'
import { downloadTextFile } from '../lib/download'
import { errorMessage } from '../lib/errorMessage'
import { Button, ConfirmDialog } from './common/ui'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'

// Shown when bootstrap found stored data it could NOT read (corrupt JSON / failed
// migrate) — or when the legacy-key migration failed to carry the primary blob forward
// (main.tsx's storageMigrationError branch, demo build only). Autosave is deliberately
// not attached in that state, so the original bytes are still on disk — this screen lets
// the user salvage them ("Download raw") before resetting, rather than silently starting
// from empty and overwriting them.
export function StorageRecovery() {
  const [confirming, setConfirming] = useState(false)
  // This is the data-SALVAGE screen, so a failure of the salvage itself must be VISIBLE here —
  // never a silent no-op or an uncaught handler error that leaves the user stranded with neither a
  // backup nor a reset.
  const [error, setError] = useState<string | null>(null)

  const downloadRaw = () => {
    // Legacy fallback: when this screen was reached via a FAILED key migration, `capacitylens/v3`
    // was never written — the recoverable bytes still live under the legacy `floaty/v3` key, so
    // fall back to it rather than telling the user there's nothing to save.
    const raw = storageAdapter.readRaw() ?? readLegacyRaw()
    if (raw === null) {
      // Neither key readable — don't hand the user an EMPTY file they'd mistake for a real backup.
      // Tell them instead.
      setError(m.storage_download_error())
      return
    }
    try {
      downloadTextFile('capacitylens-corrupt-backup.json', raw)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  // Clear the unreadable data and reload — bootstrap then reseeds from scratch. The legacy
  // `floaty/*` keys must go too: leaving them would let the next boot's migration re-copy the same
  // unreadable blob forward and land right back here (resurrect/re-loop). Both helpers swallow
  // their own storage errors by design (the reload re-attempts and reseeds anyway), so this can't
  // throw; the reload always runs.
  const reset = () => {
    storageAdapter.clear()
    removeLegacyKeys()
    window.location.reload()
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-ink">{m.storage_title()}</h1>
        <p className="mb-4 text-sm text-muted">{m.storage_body({ app: APP_NAME })}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={downloadRaw}>
            {m.storage_download()}
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {m.storage_reset()}
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
          title={m.storage_reset_confirm_title()}
          confirmLabel={m.storage_reset_confirm_label()}
          message={m.storage_reset_confirm_message({ app: APP_NAME })}
          onConfirm={reset}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
