import { type ReactNode } from 'react'
import { Icon } from './Icon'

// Feedback & callouts slice of the shared kit (re-exported from ./ui). Colours come from
// semantic tokens (see index.css), so everything adapts to dark mode automatically.

/** Non-blocking inline note. `warn` = amber advisory (e.g. over-capacity); the
 *  user can still proceed. Colours come from semantic tokens. */
export function Callout({ tone = 'warn', children }: { tone?: 'warn'; children: ReactNode }) {
  const toneClass = tone === 'warn' ? 'border-warn/40 bg-warn/10 text-ink' : ''
  return (
    <div role="status" className={`rounded-md border px-3 py-2 text-xs font-medium ${toneClass}`}>
      {children}
    </div>
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

/** Transient bottom-centre message (rejected drag, failed import…). Caller owns dismissal.
 *  `error` toasts get a danger ring (and the caller keeps them on screen until dismissed). */
export function Toast({ message, tone = 'info', onDismiss }: { message: string; tone?: 'info' | 'error'; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div
        role="alert"
        className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-surface shadow-pop ring-1 animate-[floaty-pop_0.16s_ease-out] ${
          tone === 'error' ? 'ring-2 ring-danger' : 'ring-black/10'
        }`}
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 flex shrink-0 items-center justify-center rounded-md p-1 opacity-70 transition hover:opacity-100"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  )
}
