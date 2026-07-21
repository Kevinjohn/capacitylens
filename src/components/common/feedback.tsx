import { type ReactNode } from 'react'
import { Alert, AlertDescription } from '../ui/alert'

// Product feedback compositions. Transient notices use Sonner from AppShell; inline notices use
// shadcn Alert so their accessibility and layout stay consistent with the primitive system.

/** Non-blocking inline note. `warn` = amber advisory (e.g. over-capacity); the
 *  user can still proceed. Colours come from semantic tokens. */
export function Callout({ tone = 'warn', children }: { tone?: 'warn'; children: ReactNode }) {
  const toneClass = tone === 'warn' ? 'border-warn/40 bg-warn/10 text-ink' : undefined
  return (
    <Alert role="status" className={toneClass}>
      <AlertDescription className="text-xs font-medium text-ink">{children}</AlertDescription>
    </Alert>
  )
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-sm font-medium text-danger">
      {children}
    </p>
  )
}
