import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'
import { Button } from '../ui/button'

/** Purpose-built recovery for an unmatched URL. This is navigation, not an application error, so
 * offer a stable in-app destination instead of a reload that would repeat the same 404. */
export function NotFound() {
  useEffect(() => {
    document.title = `${m.not_found_title()} · ${APP_NAME}`
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
      <h1 className="text-xl font-semibold">{m.not_found_title()}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{m.not_found_message()}</p>
      <Button asChild>
        <Link to="/">{m.not_found_home()}</Link>
      </Button>
    </main>
  )
}
