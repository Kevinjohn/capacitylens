import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
// Radix Dialog via the `radix-ui` umbrella (same idiom as src/components/ui/*), which
// re-exports @radix-ui/react-dialog at the identical version — one Radix import surface.
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { m } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button as ShadButton } from '../ui/button'
import { Dialog, DialogTitle } from '../ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty'
import { Icon, type IconName } from './Icon'
// FOCUSABLE_SELECTOR + restoreFocus + wrapTabWithin live in ./focus (shared with
// CommandPalette, and react-refresh forbids exporting non-component helpers from this
// component file).
import { FOCUSABLE_SELECTOR, restoreFocus, wrapTabWithin } from './focus'
import { FormDirtyContext } from './formDirty'

// Product dialog and page compositions. The generic controls come from shadcn; Modal keeps the
// product's dirty-form guard and non-modal accessibility behavior.

type ButtonVariant = 'primary' | 'ghost' | 'danger'

// CapacityLens's three action meanings map onto shadcn's Button scaffold. The colours bind to
// CapacityLens's --c-* brand/danger tokens (the bg-brand* /
// bg-danger* utilities) rather than shadcn's slate --primary. `primary` is the positive-action
// fill: green makes create/save/continue actions immediately distinct from blue navigation and
// identity accents. `danger` is the destructive read: capacitylens's AA-safe
// SOFT red pairing (bg-danger-soft + danger-soft-ink), which clears AA in BOTH themes —
// solid bg-danger + white would only read ~2.7:1 against the light-coral dark token. `ghost`
// is the quiet outline.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-ok-strong text-ok-strong-ink hover:bg-ok-strong-hover shadow-xs',
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
    // shadcn Button supplies the layout, focus ring and disabled behavior. The product prop API
    // maps descriptive names onto native aria/data attributes.
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

// ─── Row / create action buttons ────────────────────────────────────────────
// The management lists share three tiny button shells so the iconography stays uniform:
//  • AddButton    — a create affordance with a leading "+" glyph (e.g. "+ Add client").
//  • EditButton   — an icon-only pencil; the label is the accessible name + hover title.
//  • DeleteButton — an icon-only trash, in the danger variant.
// The glyph is always decorative (aria-hidden, via Icon); the accessible NAME comes from the
// label text (AddButton) or the aria-label (Edit/Delete), so existing
// getByRole('button', { name: … }) selectors are unaffected by the text→icon swap.

/** A create button with a leading "+" before the label. The label stays the accessible name
 *  (the plus is decorative), so `getByRole('button', { name: 'Add …' })` matches. Variant
 *  defaults to the solid primary fill; pass `ghost` for inline/secondary add affordances. */
export function AddButton({
  label,
  onClick,
  variant = 'primary',
  testId,
}: {
  label: string
  onClick: () => void
  variant?: ButtonVariant
  testId?: string
}) {
  return (
    <Button variant={variant} onClick={onClick} testId={testId}>
      <Icon name="plus" />
      {label}
    </Button>
  )
}

/** Icon-only Edit button for a list row. `label` is BOTH the accessible name and the hover
 *  tooltip — it defaults to "Edit" so per-row selectors keep matching; pass a contextual label
 *  (e.g. "Edit Acme") where rows need to disambiguate. It is hidden from viewers; server
 *  authorization remains the security boundary. */
export function EditButton({
  label = m.form_edit(),
  onClick,
  testId,
}: {
  label?: string
  onClick: () => void
  testId?: string
}) {
  if (!useCanEdit()) return null
  return (
    <Button variant="ghost" ariaLabel={label} title={label} onClick={onClick} testId={testId}>
      <Icon name="edit" />
    </Button>
  )
}

/** Icon-only Delete button for a list row — the danger-variant twin of EditButton. `label`
 *  defaults to "Delete" (so per-row selectors keep matching); pass a contextual label where
 *  rows need to disambiguate (e.g. "Delete Studio North" on the company picker). It is hidden from
 *  viewers. */
export function DeleteButton({
  label = m.form_delete(),
  onClick,
  testId,
}: {
  label?: string
  onClick: () => void
  testId?: string
}) {
  if (!useCanEdit()) return null
  return (
    <Button variant="danger" ariaLabel={label} title={label} onClick={onClick} testId={testId}>
      <Icon name="delete" />
    </Button>
  )
}

export function Modal({
  title,
  onClose,
  onSubmit,
  children,
  footer,
  guardDirty = true,
  dirty: controlledDirty,
  onDirtyChange,
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
  /** Optional controlled dirty state. When omitted, Modal owns the flag and form controls signal it
   * through FormDirtyProvider/native form events. */
  dirty?: boolean
  onDirtyChange?: (dirty: boolean) => void
}) {
  // Radix Dialog supplies the accessible shell — role="dialog", the <h2> title wired via
  // aria-labelledby (DialogTitle), and the dismiss/focus scaffold. It runs in NON-modal mode
  // (`modal={false}`): the modal variant aria-hides ALL sibling subtrees (aria-hidden's
  // hideOthers), which would hide the page BEHIND the dialog from the a11y tree — but capacitylens
  // shows hints like RotateHint OVER content that must stay readable (mobile.spec relies on
  // the sign-in heading staying findable). So we keep capacitylens's own light-touch modal
  // semantics: a plain backdrop div (Radix's Overlay renders null in non-modal mode) wrapping the
  // panel, and the manual Tab-trap below. CapacityLens's dismiss/restore behaviours — which stock
  // Radix does NOT reproduce — are layered on top; Radix's competing paths are neutralised (see
  // each handler).
  //
  // The whole shell is PORTALLED to document.body (see the return). Callers mount the Modal as a
  // direct child of role="grid" (SchedulerGrid's `{modal && …}`) or of other ARIA-roled containers;
  // an in-DOM role="dialog" descendant of a grid is invalid ARIA (a grid may only own row/rowgroup
  // — axe critical `aria-required-children`). Rendering through a portal makes the dialog a child of
  // <body>, so it's no longer a DOM descendant of whatever roled element opened it. This relocates
  // WHERE it renders only; the panel's backdrop-parent relationship the ColorField press-swallow +
  // unit tests read (the portal target is body, but the backdrop still wraps the Content).
  const panelRef = useRef<HTMLDivElement>(null)
  const downOnBackdropRef = useRef(false)
  const setNotice = useStore((s) => s.setNotice)
  const setDirtyForm = useStore((s) => s.setDirtyForm)

  const [localDirty, setLocalDirty] = useState(false)
  const dirty = controlledDirty ?? localDirty
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const markDirty = useCallback(() => {
    if (!guardDirty || dirtyRef.current) return
    // React can surface one native edit through both input and change capture before the controlled
    // value re-renders. Flip the live guard immediately so one edit publishes one dirty transition.
    dirtyRef.current = true
    if (controlledDirty === undefined) setLocalDirty(true)
    onDirtyChange?.(true)
  }, [controlledDirty, guardDirty, onDirtyChange])
  // Publish dirtiness so other surfaces (beforeunload) can guard; always clear on unmount.
  useEffect(() => {
    setDirtyForm(dirty)
  }, [dirty, setDirtyForm])
  useEffect(() => () => setDirtyForm(false), [setDirtyForm])

  const requestClose = () => {
    // `dirtyRef` flips synchronously in markDirty, before a controlled parent has had a chance to
    // feed `dirty=true` back through props. Reading it here closes that one-render escape hatch.
    if (guardDirty && dirtyRef.current) {
      setNotice(m.dialog_unsaved_changes())
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
  //    sets trapFocus=false), so capacitylens keeps its own wrap — the shared wrapTabWithin
  //    (common/focus.ts, same wrap as the CommandPalette so the two can't drift; it also pulls
  //    focus back in if it somehow escaped the panel). Bound once, reading the latest via
  //    panelRef. (Empty deps; the trigger ref keeps the guard state current.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const node = panelRef.current
      if (!node) return
      wrapTabWithin(node, e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Capture the trigger before Radix's FocusScope moves focus, then restore to it on UNMOUNT
  // (the effect cleanup) — Radix has no Trigger here, and onCloseAutoFocus fires only on a
  // controlled open→closed transition, NOT on the hard unmount callers actually use
  // ({isOpen && <Modal/>}), so the restore lives in the unmount cleanup.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Restore synchronously, exactly once, here in the cleanup — callers use
    // {isOpen && <Modal/>} (a hard unmount), which does NOT fire onCloseAutoFocus. This is the
    // ONLY focus-restore path; onCloseAutoFocus deliberately does nothing but preventDefault
    // (so Radix's FocusScope can't fire a SECOND, delayed restore that would steal focus the
    // app moved after close).
    return () => restoreFocus(previouslyFocused)
  }, [])

  // Portal the entire shell to <body> so the role="dialog" subtree is never a DOM descendant of an
  // ARIA-roled opener (e.g. SchedulerGrid's role="grid", which may only own row/rowgroup — an owned
  // dialog is axe-critical aria-required-children). The app is client-only, so document.body always
  // exists by the time a Modal mounts; no SSR guard needed, but target body explicitly. The portal
  // changes only WHERE the tree lands — the backdrop still wraps the Content (so the panel's
  // parentElement is the backdrop, as the press-swallow logic and tests expect).
  return createPortal(
    // Controlled + always-open while mounted (callers gate with {isOpen && <Modal/>}).
    // modal={false}: see the shell note above. onOpenChange only fires if some path slips
    // past the neutralised Radix dismissals; route it through the same guard so it can never
    // bypass the dirty check.
    <Dialog open modal={false} onOpenChange={(next) => { if (!next) requestCloseRef.current() }}>
      {/* Plain backdrop div (not DialogPrimitive.Overlay — that renders null in non-modal
          mode). It wraps the panel, so the dialog's parentElement is this backdrop — the
          contract ColorField press-swallow + the unit tests rely on. */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-[capacitylens-fade_0.15s_ease-out]"
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
          // aria-modal is deliberately ABSENT. Radix's Content under modal={false} emits
          // role="dialog" without it, and that's the honest signal: aria-modal="true" asserts
          // the background is inert/hidden, but in non-modal mode the sibling subtrees are NOT
          // aria-hidden (deliberately — RotateHint etc. must stay readable, see the shell note
          // above). Claiming modal would tell AT browse mode the rest of the page is gone when
          // it isn't. role="dialog" without aria-modal is valid ARIA — don't re-add it unless
          // the background is actually isolated.
          //
          // No visible description chrome — silence Radix's "missing Description" warning.
          aria-describedby={undefined}
          // CapacityLens owns Escape (the window listener above) and the backdrop press (the backdrop
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
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-elevated text-ink shadow-pop ring-1 ring-line outline-none animate-[capacitylens-pop_0.16s_ease-out]"
        >
          <header className="border-b px-4 py-3">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          </header>
          <FormDirtyContext.Provider value={markDirty}>
            <form
              noValidate
              onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}
              onInputCapture={markDirty}
              onChangeCapture={markDirty}
              // Compatibility for raw toggle buttons supplied directly as Modal children. Product
              // controls call the context signal explicitly; this fallback keeps the public Modal
              // contract safe for native/custom controls outside the common field kit.
              onClickCapture={(e) => {
                const toggle = (e.target as HTMLElement).closest(
                  '[aria-pressed],[role="radio"],[role="switch"]',
                )
                if (toggle && !toggle.hasAttribute('data-form-dirty-managed')) markDirty()
              }}
            >
              <div className="flex flex-col gap-3 p-4">{children}</div>
              {footer && <footer className="flex items-center justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
            </form>
          </FormDirtyContext.Provider>
        </DialogPrimitive.Content>
      </div>
    </Dialog>,
    document.body,
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = m.form_delete(),
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  confirmVariant?: ButtonVariant
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
            {m.form_cancel()}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm}>
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
  // Gating here keeps every entity list's create affordance consistent for viewers. Server
  // authorization remains the security boundary.
  const canEdit = useCanEdit()
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        {canEdit && onAdd && <AddButton label={addLabel ?? m.form_add()} onClick={onAdd} />}
      </div>
      {children}
    </div>
  )
}

/** Empty-list placeholder. `children` stays the primary, load-bearing message (call sites +
 *  their getByText assertions depend on it); `icon`/`description`/`action` are optional polish.
 *  The action renders a single CTA — give it a label distinct from the page's top "Add X" button
 *  so the two don't collide as duplicate accessible names. An action may carry its own leading
 *  `icon` (e.g. `plus` for the "Add your first X" create CTAs); navigation actions like
 *  "Clear filters" leave it unset so they render label-only. */
export function EmptyState({
  children,
  icon,
  description,
  action,
}: {
  children: ReactNode
  icon?: IconName
  description?: ReactNode
  action?: { label: string; onClick: () => void; icon?: IconName }
}) {
  // Viewers see navigation actions but not create actions. A create CTA carries a leading `plus`
  // icon (per this component's
  // contract: create CTAs pass `icon: 'plus'`, navigation actions leave it unset), so drop ONLY
  // those for a non-editor. This also keeps the scheduler-empty "Clear filters" CTA focusable so the
  // grid stays axe-clean. The server 403 backstops a create regardless.
  const canEdit = useCanEdit()
  const showAction = action && (canEdit || action.icon !== 'plus')
  return (
    <Empty className="border border-line bg-surface">
      <EmptyHeader>
      {icon && (
        <EmptyMedia variant="icon">
          <Icon name={icon} size={20} />
        </EmptyMedia>
      )}
        <EmptyTitle className="text-sm text-ink">{children}</EmptyTitle>
        {description && <EmptyDescription className="text-muted">{description}</EmptyDescription>}
      </EmptyHeader>
      {showAction && action && (
        <EmptyContent>
          <Button onClick={action.onClick}>
            {action.icon && <Icon name={action.icon} />}
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}
