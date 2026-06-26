import { Button } from './common/ui'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'

// Shown when bootstrap could not load state from the server (it's down or
// unreachable). Distinct from StorageRecovery (corrupt LOCAL data): there is nothing
// to reset here — the data lives on the server — so the only recourse is to retry.
// Autosave is deliberately not attached in this state, so an edit on top of the empty
// render can't be pushed as a destructive diff once the server returns.
export function ConnectionError() {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-ink">{m.conn_title()}</h1>
        <p className="mb-4 text-sm text-muted">{m.conn_body({ app: APP_NAME })}</p>
        <div className="flex items-center justify-end">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {m.conn_retry()}
          </Button>
        </div>
      </div>
    </div>
  )
}
