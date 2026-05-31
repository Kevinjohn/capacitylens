import { Button } from './common/ui'

// Shown when bootstrap could not load state from the server (it's down or
// unreachable). Distinct from StorageRecovery (corrupt LOCAL data): there is nothing
// to reset here — the data lives on the server — so the only recourse is to retry.
// Autosave is deliberately not attached in this state, so an edit on top of the empty
// render can't be pushed as a destructive diff once the server returns.
export function ConnectionError() {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-ink">Can’t reach the server</h1>
        <p className="mb-4 text-sm text-muted">
          Floaty couldn’t load your data — the server is unavailable or your connection is down. Your
          saved data is safe on the server; nothing has been changed. Check your connection and try
          again.
        </p>
        <div className="flex items-center justify-end">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
