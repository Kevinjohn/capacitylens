import { useEffect, useRef, useState, type ReactNode } from 'react'
// Radix Dialog via the `radix-ui` umbrella (same idiom as src/components/ui/*), which
// re-exports @radix-ui/react-dialog at the identical version — one Radix import surface.
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useStore } from '../../store/useStore'
import { cn } from '@/lib/utils'
import { Button as ShadButton } from '../ui/button'

// Dialogs & page layout slice of the shared kit (re-exported from ./ui). Colours come
// from semantic tokens (see index.css), so everything adapts to dark mode automatically.

type ButtonVariant = 'primary' | 'ghost' | 'danger'

// The set of natively-focusable controls inside the dialog — shared by the manual Tab-trap
// (window keydown) and the initial-focus fallback (onOpenAutoFocus) so the two can't drift.
// The Tab-trap additionally drops disabled elements at runtime; initial focus uses the
// `:not([disabled])` variant below so it never lands on a disabled control (which would
// silently drop focus to <body>).
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Restore focus to `prev` (the element that had focus before the dialog opened) on close.
 *  But .focus() on a node that's been detached from the DOM is a silent no-op that drops
 *  focus to <body>, stranding keyboard/SR users (WCAG 2.4.3) — an action like delete can
 *  unmount the row/button that opened the dialog. So fall back to the <main> landmark (made
 *  programmatically focusable) to keep focus in the content. */
function restoreFocus(prev: HTMLElement | null) {
  if (prev?.isConnected) {
    prev.focus?.()
  } else {
    const main = document.querySelector<HTMLElement>('main')
    if (main) {
      main.tabIndex = -1
      main.focus()
    }
  }
}

// Floaty's three button NAMES mapped onto shadcn's button aesthetic (Button base in
// ../ui/button) via a plain Record lookup (floaty's original idiom — no second same-named
// cva). The colours bind to floaty's own --c-* brand/danger tokens (the bg-brand* /
// bg-danger* utilities) rather than shadcn's slate --primary, so the indigo brand identity
// holds. `primary` is a solid brand fill: brand-strong is tuned so white ink clears WCAG AA
// in light AND dark (see index.css). `danger` is the destructive read: floaty's AA-safe
// SOFT red pairing (bg-danger-soft + danger-soft-ink), which clears AA in BOTH themes —
// solid bg-danger + white would only read ~2.7:1 against the light-coral dark token. `ghost`
// is the quiet outline.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-strong text-white hover:bg-brand-strong/90 shadow-xs',
  ghost: 'border bg-surface text-ink hover:bg-canvas shadow-xs',
  danger: 'bg-danger-soft text-danger-soft-ink hover:bg-danger-soft/80 shadow-xs',
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
  testId,
  className,
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
  /** Optional test hook, forwarded to the underlying <button> so the testid lands on the
   *  interactive control itself (the house pattern) — not on a wrapping span. */
  testId?: string
  /** Extra classes merged AFTER the variant colours (via cn → twMerge), so a caller can
   *  adjust a one-off (e.g. width) without forking the Button. The current callers pass none. */
  className?: string
}) {
  return (
    // shadcn Button base supplies the layout/focus-ring/disabled scaffold (size="sm" keeps
    // floaty's compact footer height); we override its variant colours with floaty's brand
    // tokens via className. The floaty prop API (ariaLabel/describedById/testId) is mapped
    // onto the native aria-/data- attributes the base forwards.
    <ShadButton
      size="sm"
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-describedby={describedById}
      data-testid={testId}
      className={cn(VARIANT_CLASS[variant], className)}
    >
      {children}
    </ShadButton>
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
  // Radix Dialog supplies the accessible shell — role="dialog", the <h2> title wired via
  // aria-labelledby (DialogTitle), and the dismiss/focus scaffold. It runs in NON-modal mode
  // (`modal={false}`): the modal variant aria-hides ALL sibling subtrees (aria-hidden's
  // hideOthers), which would hide the page BEHIND the dialog from the a11y tree — but floaty
  // shows hints like RotateHint OVER content that must stay readable (mobile.spec relies on
  // the sign-in heading staying findable). So we keep floaty's own light-touch modal
  // semantics: a plain backdrop div (rendered INLINE, no Portal, so it's container.firstChild
  // and the panel's parentElement) and the manual Tab-trap below. Floaty's dismiss/restore
  // behaviours — which stock Radix does NOT reproduce — are layered on top; Radix's competing
  // paths are neutralised (see each handler).
  const panelRef = useRef<HTMLDivElement>(null)
  const downOnBackdropRef = useRef(false)
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

  // Read requestClose through a ref so the Escape listener can bind exactly once on open —
  // otherwise a store mutation while the dialog is open (e.g. "Add activity") mints a fresh
  // onClose, re-fires the effect, and the latest guard state would be missed. (Empty deps,
  // ref for the latest.)
  const requestCloseRef = useRef(requestClose)
  useEffect(() => {
    requestCloseRef.current = requestClose
  })

  // A WINDOW keydown listener owns two things stock Radix can't do here:
  //  • Escape → requestClose. NOT Radix's onEscapeKeyDown (a document-level handler the tests
  //    can't reach: they fire fireEvent.keyDown(window, …)). Radix's own Escape is neutralised
  //    on the Content (onEscapeKeyDown preventDefault) so there's a single dismiss path.
  //  • Tab focus-trap. Radix's FocusScope trap is OFF in non-modal mode (DialogContentNonModal
  //    sets trapFocus=false), so floaty keeps its own wrap — bound once, reading the latest
  //    via panelRef. (Empty deps; the trigger ref keeps the guard state current.)
  useEffect(() => {
    const focusables = () => {
      const node = panelRef.current
      return node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (el) => !el.hasAttribute('disabled'),
          )
        : []
    }
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
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Capture the trigger before Radix's FocusScope moves focus, then restore to it on UNMOUNT
  // (the effect cleanup) — Radix has no Trigger here, and onCloseAutoFocus fires only on a
  // controlled open→closed transition, NOT on the hard unmount callers actually use
  // ({isOpen && <Modal/>}). So the restore lives here, exactly as floaty did pre-Radix.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Restore synchronously, exactly once, here in the cleanup — callers use
    // {isOpen && <Modal/>} (a hard unmount), which does NOT fire onCloseAutoFocus. This is the
    // ONLY focus-restore path; onCloseAutoFocus deliberately does nothing but preventDefault
    // (so Radix's FocusScope can't fire a SECOND, delayed restore that would steal focus the
    // app moved after close).
    return () => restoreFocus(previouslyFocused)
  }, [])

  return (
    // Controlled + always-open while mounted (callers gate with {isOpen && <Modal/>}).
    // modal={false}: see the shell note above. onOpenChange only fires if some path slips
    // past the neutralised Radix dismissals; route it through the same guard so it can never
    // bypass the dirty check.
    <DialogPrimitive.Root open modal={false} onOpenChange={(next) => { if (!next) requestCloseRef.current() }}>
      {/* Plain backdrop div (not DialogPrimitive.Overlay — that renders null in non-modal
          mode). Rendered INLINE (no Portal) so it's container.firstChild and the panel's
          parentElement — the contract ColorField + the tests rely on. */}
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
        <DialogPrimitive.Content
          ref={panelRef}
          // Radix's Content under modal={false} emits role="dialog" WITHOUT aria-modal, so we
          // pass it back through (Content forwards unknown props) to restore the screen-reader
          // modality signal floaty's pre-Radix panel carried.
          aria-modal="true"
          // No visible description chrome — silence Radix's "missing Description" warning.
          aria-describedby={undefined}
          // Floaty owns Escape (the window listener above) and the backdrop press (the backdrop
          // handlers), so neutralise Radix's competing dismissals — one dismiss path each,
          // routed through requestClose's dirty guard.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          // Honour an explicit data-autofocus target (e.g. a confirm field) over the fallback:
          // the first focusable. The fallback must skip DISABLED controls (same as the Tab-trap)
          // — focusing a disabled element is a silent no-op that drops focus to <body>.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const node = panelRef.current
            const first = node
              ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
                  (el) => !el.hasAttribute('disabled'),
                )
              : undefined
            ;(node?.querySelector<HTMLElement>('[data-autofocus]') ?? first ?? node)?.focus()
          }}
          // ONLY preventDefault here — no restore body. The real focus-restore runs synchronously,
          // exactly once, in the unmount-effect cleanup above (callers use {isOpen && <Modal/>}).
          // On a hard unmount Radix's FocusScope ALSO fires this onCloseAutoFocus a tick later
          // (via setTimeout(0)); if it restored too, that delayed second move could steal focus
          // the app intentionally placed after close. Suppressing FocusScope's auto-restore here
          // leaves the synchronous cleanup as the single focus move.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-elevated text-ink shadow-pop ring-1 ring-line outline-none animate-[floaty-pop_0.16s_ease-out]"
        >
          <header className="border-b px-4 py-3">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
          </header>
          <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}>
            <div className="space-y-3 p-4">{children}</div>
            {footer && <footer className="flex items-center justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
          </form>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Root>
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
