import { useEffect, useRef, useState } from 'react'
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings'
import { SWATCHES, SWATCH_COLUMNS, swatchLabel, colorName } from '../../lib/palette'
// Control styling lives in ./controls (a non-component module) so its style OBJECT can
// be exported without tripping react-refresh/only-export-components on this file.
import { controlBase, inputClass, selectChevronClass, selectChevronStyle } from './controls'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover'
import { cn } from '@/lib/utils'
import type { Weekday } from '@capacitylens/shared/types/entities'

// Form fields slice of the shared kit (re-exported from ./ui). The text/number/date
// fields and the textarea are built on shadcn's Input/Textarea (../ui); the SelectField
// stays a NATIVE <select> on purpose (32 e2e selectOption() calls + user.selectOptions
// depend on it). Colours come from semantic tokens (see index.css), so everything adapts
// to dark mode automatically.

const labelClass = 'mb-1 block text-xs font-medium text-muted'

// Two deliberately distinct red treatments so "required" never reads as "errored":
//   required (at rest) → a thin red left-edge accent — a quiet marker.
//   invalid (failed Save) → a full danger border + ring — the field you missed pops.
// invalid wins when both apply, so a required field that fails shows the error state.
// These are the capacitylens ACCENTS only; the shared `controlBase` (controls.ts) supplies the
// bg-surface/text-ink/placeholder/px-2.5 py-1.5/shadow-sm field look (the SAME base the
// native SelectField uses, so the migrated shadcn fields sit flush beside it), and twMerge
// lets controlBase + these accents win over the shadcn Input/Textarea base where they
// overlap (incl. dark mode — the base no longer carries bg-transparent/dark:bg-input/30).
function fieldAccent(invalid?: boolean, required?: boolean) {
  if (invalid) return 'border-danger ring-1 ring-danger'
  if (required) return 'border-l-2 border-l-danger/60'
  return ''
}

// The native <select> isn't a shadcn primitive (kept native by design), so it keeps
// capacitylens's own full inputClass base plus the accent — unchanged from before.
function selectClass(invalid?: boolean, required?: boolean) {
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
      <Input
        // Reuse capacitylens's shared controlBase (the SAME field look the native SelectField
        // carries) so this shadcn-backed input matches it exactly — bg-surface in BOTH
        // themes, text-ink, placeholder:text-faint, px-2.5 py-1.5, shadow-sm — instead of
        // shadcn's bg-transparent/text-base. The accent (required/invalid) layers on top.
        className={cn(controlBase, fieldAccent(invalid, required))}
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
      <Textarea
        // Shared controlBase (matches the native SelectField + the other fields); see TextField.
        className={cn(controlBase, fieldAccent(invalid))}
        rows={2}
        value={value}
        maxLength={maxLength}
        // No aria-label: this field carries no required-asterisk (plain <span> label, not
        // FieldLabel), so the wrapping <label> IS the accessible name with nothing to leak.
        // The asterisk-bearing fields (TextField/Number/Date/Select) keep aria-label so the
        // decorative " *" never bleeds into their name. (2.13 de-dup, conservative scope.)
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
      <Input
        type="number"
        // Shared controlBase (matches the native SelectField + the other fields); see TextField.
        className={cn(controlBase, fieldAccent(invalid, required))}
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        // Number('') and Number('abc') are NaN, so this INTENTIONALLY emits a transient NaN to the
        // parent while the field is empty/part-typed. That's contained, not a bug: onBlur (below)
        // clamps it to a real number, and the form's submit-time numeric guards are the real
        // backstop (e.g. ResourceForm's `!(hours > 0)` rejects a NaN because `NaN > 0` is false).
        // Don't "fix" this by blocking the NaN here — the empty/intermediate state must round-trip.
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
      <Input
        type="date"
        // Shared controlBase (matches the native SelectField + the other fields); see TextField.
        className={cn(controlBase, fieldAccent(invalid, required))}
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
        className={cn(selectClass(invalid, required), selectChevronClass, 'disabled:opacity-60')}
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
      {/* Radix Popover supplies ONLY the shell + anchored positioning (Phase 8 reskin). CapacityLens's
          own dismiss collaboration is kept verbatim as the SINGLE dismiss path — the capture-phase
          mousedown above and the Escape onKeyDown below. Radix's competing dismissals are
          neutralised on the Content (onInteractOutside / onPointerDownOutside / onEscapeKeyDown →
          preventDefault) so it can never double-close or change ordering, and Radix's auto-focus is
          suppressed so opening doesn't yank focus off the trigger. `open` (capacitylens's state) drives
          Popover.Root; onOpenChange only mirrors a Radix-initiated close (none, since all of them
          are neutralised) back into capacitylens's state as a backstop. */}
      <Popover open={open} onOpenChange={setOpen}>
        <div
          ref={ref}
          // Escape anywhere within the control (trigger or a focused swatch) closes the popup
          // and is consumed so it doesn't bubble up to the Modal's Escape-to-close.
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={open}
              aria-label={`${label} (${colorName(value)})`}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? describedById : undefined}
              className={cn(selectClass(invalid), selectChevronClass, 'flex items-center gap-2 text-left')}
              style={selectChevronStyle}
            >
              <span
                className="h-4 w-4 shrink-0 rounded ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: value }}
              />
            </button>
          </PopoverAnchor>
          {open && (
            // portal={false} renders Content WITHOUT a Portal so the panel stays inside this
            // control's DOM subtree (and so inside the enclosing [role="dialog"]) — the capture-phase
            // listener walks up to that dialog to classify a backdrop press, which a portalled popup
            // would escape. side="top" + avoidCollisions={false} reproduces the old bottom-full/left-0
            // placement deterministically: the colour field is the last field in every form and the
            // Modal's overflow-y-auto would clip a downward popup, so the popup must ALWAYS open
            // upward — without avoidCollisions={false} Radix would flip it down when room is tight,
            // re-introducing exactly that clipping. forceMount-free: Radix only renders Content while
            // Root is open, and capacitylens's `open` already gates it, so mount/unmount tracks the popup
            // exactly as before.
            <PopoverContent
              portal={false}
              role="group"
              aria-label={`${label} swatches`}
              side="top"
              align="start"
              sideOffset={4}
              avoidCollisions={false}
              // CapacityLens's panel look (bg-elevated/ring-line/shadow-pop), NOT shadcn's bg-popover, so
              // the swatch grid keeps its exact prior surface + the grid layout is unchanged. The
              // capacitylens-pop motion matches CommandPalette/Modal (tw-animate-css isn't installed, so
              // shadcn's animate-in classes would be inert no-ops here).
              className="grid w-max gap-1.5 rounded-md border bg-elevated p-2 shadow-pop ring-1 ring-line animate-[capacitylens-pop_0.14s_ease-out]"
              style={{ gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))` }}
              // CapacityLens owns dismissal (the capture-phase mousedown + the Escape onKeyDown above), so
              // neutralise every Radix dismiss path — one dismiss path, unchanged ordering.
              onInteractOutside={(e) => e.preventDefault()}
              onPointerDownOutside={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => e.preventDefault()}
              // Don't let Radix's FocusScope move focus on open/close — the trigger keeps focus on
              // open (matching the old hand-rolled popup, which never auto-focused the grid), so the
              // "Escape while a swatch is focused" + outside-click tests behave exactly as before.
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {SWATCHES.map((hex, i) => {
                const selected = hex.toLowerCase() === value.toLowerCase()
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={swatchLabel(i)}
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
            </PopoverContent>
          )}
        </div>
      </Popover>
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
    // A real <fieldset>/<legend> groups the day toggles. Each day is a plain <button>
    // (NOT a Radix ToggleGroup): the Weekday[] model (0–6, Sun=0) is the source of truth
    // and aria-pressed reflects it directly. Plain buttons keep every chip individually
    // Tab-reachable — a roving-tabindex toolbar would put only ONE of the seven in the tab
    // order, regressing keyboard reach for no gain (capacitylens drives the model, not Radix).
    <fieldset className="block">
      <legend className={labelClass}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map(({ day, label: dl }) => {
          const on = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-label={dl}
              aria-pressed={on}
              onClick={() => toggle(day)}
              className={cn(
                'w-12 rounded-md border px-2 py-1 text-center text-xs font-medium transition',
                on ? 'border-brand bg-brand-strong text-white' : 'bg-surface text-muted hover:bg-canvas',
              )}
            >
              {dl}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
