import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { m } from '@/i18n'
import { Button as ShadButton } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Icon, type IconName } from './Icon'
import { restoreFocus } from './focus'
import { FormDirtyContext } from './formDirty'

// Product dialog and page compositions. Modal adds the dirty-form guard used by editor forms.

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const BUTTON_VARIANT: Record<ButtonVariant, 'default' | 'outline' | 'danger-soft'> = {
  primary: 'default',
  ghost: 'outline',
  danger: 'danger-soft',
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
    <ShadButton
      size="sm"
      variant={BUTTON_VARIANT[variant]}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-describedby={describedById}
      data-testid={testId}
      className={className}
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
  const setNotice = useStore((s) => s.setNotice)
  const setDirtyForm = useStore((s) => s.setDirtyForm)
  const [invoker] = useState(() => document.activeElement as HTMLElement | null)

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
  useEffect(() => () => restoreFocus(invoker), [invoker])

  const requestClose = () => {
    // `dirtyRef` flips synchronously in markDirty, before a controlled parent has had a chance to
    // feed `dirty=true` back through props. Reading it here closes that one-render escape hatch.
    if (guardDirty && dirtyRef.current) {
      setNotice(m.dialog_unsaved_changes())
      return
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayProps={{ onMouseDown: (event) => { event.preventDefault(); requestClose() } }}
        aria-describedby={undefined}
        className="max-h-[90vh] max-w-md gap-0 overflow-y-auto p-0"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          requestClose()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          requestClose()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <FormDirtyContext.Provider value={markDirty}>
          <form
            noValidate
            onSubmit={(event) => { event.preventDefault(); onSubmit?.() }}
            onInputCapture={markDirty}
            onChangeCapture={markDirty}
            onClickCapture={(event) => {
              const toggle = (event.target as HTMLElement).closest(
                '[aria-pressed],[role="radio"],[role="switch"]',
              )
              if (toggle && !toggle.hasAttribute('data-form-dirty-managed')) markDirty()
            }}
          >
            <div className="flex flex-col gap-3 p-4">{children}</div>
            {footer && <DialogFooter className="border-t px-4 py-3">{footer}</DialogFooter>}
          </form>
        </FormDirtyContext.Provider>
      </DialogContent>
    </Dialog>
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
  const confirmingRef = useRef(false)
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !confirmingRef.current) onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{message}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.form_cancel()}</AlertDialogCancel>
          <AlertDialogAction
            variant={BUTTON_VARIANT[confirmVariant]}
            onClick={() => { confirmingRef.current = true; onConfirm() }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
