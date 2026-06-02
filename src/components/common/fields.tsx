import { useEffect, useRef, useState } from 'react'
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@floaty/shared/lib/strings'
import { SWATCHES, SWATCH_COLUMNS } from '../../lib/palette'
// Control styling lives in ./controls (a non-component module) so its style OBJECT can
// be exported without tripping react-refresh/only-export-components on this file.
import { inputClass, selectChevronClass, selectChevronStyle } from './controls'
import type { Weekday } from '@floaty/shared/types/entities'

// Form fields slice of the shared kit (re-exported from ./ui). Colours come from
// semantic tokens (see index.css), so everything adapts to dark mode automatically.

const labelClass = 'mb-1 block text-xs font-medium text-muted'

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
  maxLength = MAX_NAME_LENGTH,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  invalid?: boolean
  required?: boolean
  describedById?: string
  maxLength?: number
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <input
        className={controlClass(invalid, required)}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Mark the intended autofocus target so Modal's focus trap honours it instead of
        // grabbing the first focusable (often a leading button).
        data-autofocus={autoFocus ? '' : undefined}
        // Native cap is a backstop; the form validator also rejects emoji/junk + length.
        maxLength={maxLength}
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

export function TextAreaField({
  label,
  value,
  onChange,
  invalid,
  describedById,
  maxLength = MAX_NOTE_LENGTH,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  describedById?: string
  maxLength?: number
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <textarea
        className={controlClass(invalid)}
        rows={2}
        value={value}
        maxLength={maxLength}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
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
        className={`${controlClass(invalid, required)} ${selectChevronClass} disabled:opacity-60`}
        style={selectChevronStyle}
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

// A swatch picker, not a hex/RGB tool: a trigger showing the current colour opens a
// 13×4 grid of preset swatches (see SWATCHES). Picking one is the only way to set the
// value, so the stored colour is always a valid hex — no text/hex entry.
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on a click anywhere outside the control. The trigger lives inside `ref`, so
  // its own click toggles via onClick rather than tripping this listener.
  //
  // Capture phase: an outside press is seen before it reaches its target. We swallow it
  // ONLY when it landed outside the dialog panel (i.e. on the modal backdrop) — so
  // dismissing the popup doesn't also arm the Modal's backdrop close. A press on ANOTHER
  // control inside the SAME dialog is left to propagate, so the first click both closes
  // the popup AND lands on that control (no swallowed "first click did nothing").
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return // inside the control — its own handler toggles
      setOpen(false)
      const panel = ref.current?.closest('[role="dialog"]')
      if (panel && !panel.contains(target)) e.stopPropagation()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open])

  return (
    <div className="block">
      <span className={labelClass}>{label}</span>
      <div
        ref={ref}
        className="relative"
        // Escape anywhere within the control (trigger or a focused swatch) closes the popup
        // and is consumed so it doesn't bubble up to the Modal's Escape-to-close.
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={`${label} (${value})`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? describedById : undefined}
          className={`${controlClass(invalid)} ${selectChevronClass} flex items-center gap-2 text-left`}
          style={selectChevronStyle}
        >
          <span
            className="h-4 w-4 shrink-0 rounded ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: value }}
          />
        </button>
        {open && (
          <div
            role="group"
            aria-label={`${label} swatches`}
            // Opens upward (bottom-full): the colour field is the last field in every
            // form, and the Modal's overflow-y-auto would clip a downward popup.
            className="absolute bottom-full left-0 z-10 mb-1 grid w-max gap-1.5 rounded-md border bg-elevated p-2 shadow-pop ring-1 ring-line"
            style={{ gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))` }}
          >
            {SWATCHES.map((hex) => {
              const selected = hex.toLowerCase() === value.toLowerCase()
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={hex}
                  // aria-pressed both conveys selection and lets the Modal's dirty-guard
                  // register the pick as an edit (a plain button click fires no change).
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(hex)
                    setOpen(false)
                  }}
                  className={`h-6 w-6 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110 ${
                    selected ? 'outline outline-2 outline-offset-1 outline-brand-strong' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
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
              className={`w-12 rounded-md border px-2 py-1 text-center text-xs font-medium transition ${
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
