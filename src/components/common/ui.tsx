import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { isTemporary } from '@floaty/shared/lib/integrity'
import { ensureBarColors, isHexColor } from '@floaty/shared/lib/color'
import { useStore } from '../../store/useStore'
import { Icon } from './Icon'
import type { Resource, Weekday } from '@floaty/shared/types/entities'

// Shared presentational kit. Colours come from semantic tokens (see index.css),
// so everything adapts to dark mode automatically.

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const buttonClasses: Record<ButtonVariant, string> = {
  // brand-strong resting keeps white text >= ~4.5:1 in both light and dark.
  primary: 'bg-brand-strong text-white hover:bg-brand shadow-sm',
  ghost: 'border bg-surface text-ink hover:bg-canvas',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  title,
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  type?: 'button' | 'submit'
  disabled?: boolean
  title?: string
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ${buttonClasses[variant]}`}
    >
      {children}
    </button>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
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
  }, [])
  // Publish dirtiness so other surfaces (beforeunload) can guard; always clear on unmount.
  useEffect(() => {
    setDirtyForm(dirty)
  }, [dirty, setDirtyForm])
  useEffect(() => () => setDirtyForm(false), [setDirtyForm])

  const requestClose = () => {
    if (dirty) {
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
    ;(focusables()[0] ?? node)?.focus()

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
      previouslyFocused?.focus?.()
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
        <div className="space-y-3 p-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
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

const labelClass = 'mb-1 block text-xs font-medium text-muted'
/** Shared control styling (sans width). Exported so non-label controls (toolbar
 *  search/date/selects, inline add-task/phase inputs) match field height + rounding
 *  instead of drifting to their own px-2 py-1. */
export const controlBase =
  'rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint shadow-sm transition-colors'
export const inputClass = `w-full ${controlBase}`

// Two deliberately distinct red treatments so "required" never reads as "errored":
//   required (at rest) → a thin red left-edge accent — a quiet marker.
//   invalid (failed Save) → a full danger border + ring — the field you missed pops.
// invalid wins when both apply, so a required field that fails shows the error state.
function controlClass(invalid?: boolean, required?: boolean) {
  if (invalid) return `${inputClass} border-danger ring-1 ring-danger`
  if (required) return `${inputClass} border-l-2 border-l-danger/60`
  return inputClass
}

/** Field label with an optional red asterisk for required fields. The asterisk is
 *  decorative (the input carries aria-required); we still give it a title for hover. */
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className={labelClass}>
      {label}
      {required && (
        <span className="text-danger" title="Required" aria-hidden>
          {' *'}
        </span>
      )}
    </span>
  )
}

/** Drop near the top of a form to explain the asterisk + red accent convention. */
export function RequiredLegend() {
  return (
    <p className="text-xs text-muted">
      <span className="font-medium text-danger">*</span> Required field
    </p>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  invalid,
  required,
  describedById,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  invalid?: boolean
  required?: boolean
  describedById?: string
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <input
        className={controlClass(invalid, required)}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Name the control off the bare label so the required asterisk (decorative,
        // aria-hidden) never leaks into the accessible name. Mirrors SelectField.
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <textarea className={inputClass} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  invalid,
  required,
  describedById,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  invalid?: boolean
  required?: boolean
  describedById?: string
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <input
        type="number"
        className={controlClass(invalid, required)}
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        // Clamp to [min, max] on blur — type=number's own min/max are advisory and
        // aren't enforced on paste/typing, so a stray entry would otherwise stick.
        onBlur={(e) => {
          let n = Number(e.target.value)
          if (!Number.isFinite(n)) n = min ?? 0
          if (min !== undefined) n = Math.max(min, n)
          if (max !== undefined) n = Math.min(max, n)
          if (n !== value) onChange(n)
        }}
      />
    </label>
  )
}

export function DateField({
  label,
  value,
  onChange,
  invalid,
  required,
  describedById,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  required?: boolean
  describedById?: string
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <input
        type="date"
        className={controlClass(invalid, required)}
        value={value}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export interface Option {
  value: string
  label: string
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
  required,
  describedById,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  required?: boolean
  describedById?: string
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <select
        className={`${controlClass(invalid, required)} disabled:opacity-60`}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ColorField({
  label,
  value,
  onChange,
  invalid,
  describedById,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  describedById?: string
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
          className="h-8 w-10 cursor-pointer rounded border bg-surface"
        />
        <input
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
          aria-invalid={invalid || !isHexColor(value)}
          aria-describedby={invalid ? describedById : undefined}
          pattern="#[0-9a-fA-F]{6}"
          title="6-digit hex colour, e.g. #3b82f6"
        />
      </span>
    </label>
  )
}

const WEEKDAYS: { day: Weekday; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
]

export function WeekdayPicker({ label, value, onChange }: { label: string; value: Weekday[]; onChange: (v: Weekday[]) => void }) {
  const toggle = (day: Weekday) => {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day])
  }
  return (
    <fieldset className="block">
      <legend className={labelClass}>{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map(({ day, label: dl }) => {
          const on = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-label={dl}
              aria-pressed={on}
              onClick={() => toggle(day)}
              className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
                on ? 'border-brand bg-brand-strong text-white' : 'bg-surface text-muted hover:bg-canvas'
              }`}
            >
              {dl}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function TemporaryTag({ resource }: { resource: Resource }) {
  if (!isTemporary(resource)) return null
  return (
    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink">
      Temp
    </span>
  )
}

export function ColorSwatch({ color }: { color: string }) {
  return <span className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10" style={{ backgroundColor: color }} />
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '—'
  // Keep the initials legible (white-on-mid-tone often fails AA) by nudging the fill.
  const { bg, ink } = ensureBarColors(color)
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: bg, color: ink }}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-2xs font-semibold ring-2 ring-surface"
    >
      {initials}
    </span>
  )
}
