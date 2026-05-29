import { useEffect, useRef, type ReactNode } from 'react'
import { isTemporary } from '../../lib/integrity'
import type { Resource, Weekday } from '../../types/entities'

// Shared presentational kit. Colours come from semantic tokens (see index.css),
// so everything adapts to dark mode automatically.

type ButtonVariant = 'primary' | 'ghost' | 'danger'

const buttonClasses: Record<ButtonVariant, string> = {
  // brand-strong resting keeps white text >= ~4.5:1 in both light and dark.
  primary: 'bg-brand-strong text-white hover:bg-brand shadow-sm',
  ghost: 'border bg-surface text-ink hover:bg-base',
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

  // Read onClose through a ref so the focus effect can run exactly once on open —
  // otherwise a store mutation while the dialog is open (e.g. "Add task") mints a
  // fresh onClose, re-fires the effect, yanks focus back to the first control, and
  // clobbers the "restore focus on close" target. (Empty deps, ref for the latest.)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
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
        onCloseRef.current()
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-elevated text-ink shadow-pop ring-1 ring-line outline-none animate-[floaty-pop_0.16s_ease-out]"
      >
        <header className="border-b px-4 py-3 text-base font-semibold">{title}</header>
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

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm font-medium text-danger">
      {children}
    </p>
  )
}

/** Transient bottom-centre message (rejected drag, failed import…). Caller owns dismissal. */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-surface shadow-pop ring-1 ring-black/10 animate-[floaty-pop_0.16s_ease-out]"
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 rounded px-1 leading-none opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

const labelClass = 'mb-1 block text-xs font-medium text-muted'
const inputClass =
  'w-full rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint shadow-sm transition-colors'

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input className={inputClass} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
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
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input type="number" className={inputClass} value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input type="date" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select
        className={`${inputClass} disabled:opacity-60`}
        value={value}
        disabled={disabled}
        aria-label={label}
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

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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
                on ? 'border-brand bg-brand-strong text-white' : 'bg-surface text-muted hover:bg-base'
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
    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn">
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
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: color }}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-surface"
    >
      {initials}
    </span>
  )
}
