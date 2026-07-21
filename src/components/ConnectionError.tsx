import { Button } from './common/ui'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

// Shown when bootstrap could not load state from the server (it's down or
// unreachable). Distinct from StorageRecovery (corrupt LOCAL data): there is nothing
// to reset here — the data lives on the server — so the only recourse is to retry.
// Autosave is deliberately not attached in this state, so an edit on top of the empty
// render can't be pushed as a destructive diff once the server returns.
export function ConnectionError() {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle><h1>{m.conn_title()}</h1></CardTitle>
          <CardDescription>{m.conn_body({ app: APP_NAME })}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {m.conn_retry()}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
