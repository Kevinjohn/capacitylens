import { type ReactNode } from 'react'

// Feedback & callouts slice of the shared kit (re-exported from ./ui). Colours come from
// semantic tokens (see index.css), so everything adapts to dark mode automatically.
//
// Transient bottom-centre toasts are NOT here any more: the hand-rolled `Toast` was retired
// in the Sonner migration (shadcn Phase 5). The store's `notice`/`setNotice` API is unchanged;
// AppShell mounts Sonner's <Toaster/> and bridges `notice` → toast()/toast.error().

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
