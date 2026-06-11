import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'

// Dialogs & page layout slice of the shared kit (re-exported from ./ui). Colours come
// from semantic tokens (see index.css), so everything adapts to dark mode automatically.

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const buttonClasses: Record<ButtonVariant, string> = {
  // Pastel, not saturated: soft tint + per-theme coloured ink (the *-soft / *-soft-ink
  // token pairs keep AA in both themes). Hover deepens the tint a notch.
  primary: 'bg-brand-soft text-brand-soft-ink hover:bg-brand/25 shadow-sm',
  ghost: 'border bg-surface text-ink hover:bg-canvas',
  danger: 'bg-danger-soft text-danger-soft-ink hover:bg-danger/25 shadow-sm',
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  title,
  ariaLabel,
  describedById,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  type?: 'button' | 'submit'
  disabled?: boolean
  title?: string
  ariaLabel?: string
  /** Id of an element that explains WHY the button is disabled (e.g. the type-to-confirm
   *  hint on the delete-company dialog), so a screen reader announces the precondition. */
  describedById?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-describedby={describedById}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ${buttonClasses[variant]}`}
    >
      {children}
    </button>
  )
}

export function Modal({
  title,
  onClose,
  onSubmit,
  children,
  footer,
  guardDirty = true,
}: {
  title: ReactNode
  onClose: () => void
  /** When provided, wraps the body + footer in a <form> so pressing Enter in any
   *  text input submits. Always rendered (even when undefined) so that implicit
   *  form submission / page navigation is always suppressed. */
  onSubmit?: () => void
  children: ReactNode
  footer?: ReactNode
  /** When false, the unsaved-changes guard is disabled so Escape/backdrop always close.
   *  Use for confirmation-only dialogs (e.g. delete-company), whose inputs are a gate,
   *  not savable form data — guarding them only makes aborting harder. */
  guardDirty?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const downOnBackdropRef = useRef(false)
  const titleId = useId()
  const setNotice = useStore((s) => s.setNotice)
  const setDirtyForm = useStore((s) => s.setDirtyForm)

  // Unsaved-changes guard: the dialog goes "dirty" on the first edit to any control
  // inside it (native input/change events bubble to the panel). While dirty, an
  // ACCIDENTAL dismissal — backdrop click or Escape — is refused with a hint;
  // the explicit Cancel/Save footer buttons (which call onClose directly) still close.
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!guardDirty) return // confirmation-only dialog: nothing to guard, stays non-dirty
    const node = panelRef.current
    if (!node) return
    const markDirty = () => setDirty(true)
    // Native form controls fire input/change. Button-driven toggle controls
    // (e.g. WeekdayPicker) don't — they mutate state on click — so also treat a
    // click on any aria-pressed toggle inside the panel as an edit. (Plain action
    // buttons like Cancel/Save/Add aren't aria-pressed, so they don't false-flag.)
    const onClick = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest('[aria-pressed]')) setDirty(true)
    }
    node.addEventListener('input', markDirty)
    node.addEventListener('change', markDirty)
    node.addEventListener('click', onClick)
    return () => {
      node.removeEventListener('input', markDirty)
      node.removeEventListener('change', markDirty)
      node.removeEventListener('click', onClick)
    }
  }, [guardDirty])
  // Publish dirtiness so other surfaces (beforeunload) can guard; always clear on unmount.
  useEffect(() => {
    setDirtyForm(dirty)
  }, [dirty, setDirtyForm])
  useEffect(() => () => setDirtyForm(false), [setDirtyForm])

  const requestClose = () => {
    if (guardDirty && dirty) {
      setNotice('You have unsaved changes — use Cancel or Save to close this dialog.')
      return
    }
    onClose()
  }

  // Read onClose/requestClose through refs so the focus effect can run exactly once
  // on open — otherwise a store mutation while the dialog is open (e.g. "Add task")
  // mints a fresh onClose, re-fires the effect, yanks focus back to the first control,
  // and clobbers the "restore focus on close" target. (Empty deps, ref for the latest.)
  const onCloseRef = useRef(onClose)
  const requestCloseRef = useRef(requestClose)
  useEffect(() => {
    onCloseRef.current = onClose
    requestCloseRef.current = requestClose
  })

  // Accessible dialog: trap Tab, focus the first control on open, restore on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const node = panelRef.current
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute('disabled'))
        : []
    // Honour an explicit data-autofocus target (e.g. a confirm field) over the first
    // focusable in the DOM, which is often a leading button.
    ;(node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? node)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Restore focus to the trigger — but ONLY if it's still in the DOM. An action like delete can
      // unmount the element that opened the dialog (a row/button), and .focus() on a detached node
      // is a silent no-op that drops focus to <body>, stranding keyboard/SR users (WCAG 2.4.3). Fall
      // back to the <main> landmark (made programmatically focusable) so focus stays in the content.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus?.()
      } else {
        const main = document.querySelector<HTMLElement>('main')
        if (main) {
          main.tabIndex = -1
          main.focus()
        }
      }
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-[floaty-fade_0.15s_ease-out]"
      // Close only when the press both STARTS and ENDS on the backdrop — a drag that
      // begins inside an input and releases over the backdrop must not dismiss (and
      // mouseup, not mousedown, so a stray 3px press can't nuke an in-progress form).
      onMouseDown={(e) => {
        downOnBackdropRef.current = e.target === e.currentTarget
      }}
      onMouseUp={(e) => {
        if (downOnBackdropRef.current && e.target === e.currentTarget) requestClose()
        downOnBackdropRef.current = false
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-elevated text-ink shadow-pop ring-1 ring-line outline-none animate-[floaty-pop_0.16s_ease-out]"
      >
        <header className="border-b px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
        </header>
        <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}>
          <div className="space-y-3 p-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
        </form>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  )
}

export function ListPage({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string
  addLabel?: string
  onAdd?: () => void
  children?: ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        {onAdd && <Button onClick={onAdd}>{addLabel ?? 'Add'}</Button>}
      </div>
      {children}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-surface px-4 py-10 text-center text-sm text-muted">
      {children}
    </div>
  )
}
