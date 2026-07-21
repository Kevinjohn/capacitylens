import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { m } from '@/i18n'
import { Pencil, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '../ui/button'
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
import { restoreFocus } from './focus'
import { FormDirtyContext } from './formDirty'

// Product dialog and page compositions. Modal adds the dirty-form guard used by editor forms.

function hasOpenNestedOverlay(): boolean {
  return document.querySelector(
    '[data-slot="popover-content"][data-state="open"], [data-slot="select-content"][data-state="open"]',
  ) !== null
}

// ─── Row / create action buttons ────────────────────────────────────────────
// The management lists share three small ShadCN Button compositions:
//  • AddButton    — a create affordance with a leading plus glyph (e.g. "+ Add client").
//  • EditButton   — an icon-only pencil; the label is the accessible name + hover title.
//  • DeleteButton — an icon-only trash, in the danger variant.
// Lucide glyphs are decorative; the accessible name comes from visible label text or aria-label.

/** A create button with a decorative leading plus and a visible accessible label. */
export function AddButton({
  label,
  onClick,
  testId,
}: {
  label: string
  onClick: () => void
  testId?: string
}) {
  return (
    <Button size="sm" type="button" onClick={onClick} data-testid={testId}>
      <Plus data-icon="inline-start" />
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
    <Button type="button" variant="outline" size="icon-sm" aria-label={label} title={label} onClick={onClick} data-testid={testId}>
      <Pencil />
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
    <Button type="button" variant="danger-soft" size="icon-sm" aria-label={label} title={label} onClick={onClick} data-testid={testId}>
      <Trash2 />
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
        aria-describedby={undefined}
        className="max-h-[90vh] max-w-md gap-0 overflow-y-auto p-0"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          requestClose()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          if (hasOpenNestedOverlay()) return
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
  confirmVariant = 'danger-soft',
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  confirmVariant?: 'default' | 'outline' | 'danger-soft'
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
            variant={confirmVariant}
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

/** Product empty-state composition with an optional icon, description and single action. */
export function EmptyState({
  children,
  icon,
  description,
  action,
}: {
  children: ReactNode
  icon?: LucideIcon
  description?: ReactNode
  action?: { label: string; onClick: () => void; icon?: LucideIcon; requiresEdit?: boolean }
}) {
  const canEdit = useCanEdit()
  const showAction = action && (canEdit || !action.requiresEdit)
  const EmptyIcon = icon
  const ActionIcon = action?.icon
  return (
    <Empty className="border">
      <EmptyHeader>
      {EmptyIcon && (
        <EmptyMedia variant="icon">
          <EmptyIcon />
        </EmptyMedia>
      )}
        <EmptyTitle>{children}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {showAction && action && (
        <EmptyContent>
          <Button size="sm" type="button" onClick={action.onClick}>
            {ActionIcon && <ActionIcon data-icon="inline-start" />}
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}
