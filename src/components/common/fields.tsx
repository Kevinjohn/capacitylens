import { useEffect, useId, useRef, useState } from 'react'
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings'
import { SWATCHES, SWATCH_COLUMNS, swatchLabel, colorName } from '../../lib/palette'
// Control styling lives in ./controls (a non-component module) so its style OBJECT can
// be exported without tripping react-refresh/only-export-components on this file.
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover'
import { Switch } from '../ui/switch'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '../ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'
import { m } from '@/i18n'
import type { Weekday } from '@capacitylens/shared/types/entities'
import { useMarkFormDirty } from './formDirty'
import { inputClass, selectChevronClass, selectChevronStyle } from './controls'

// Product field APIs composed from ShadCN's Field family.
function RequiredFieldLabel({ label, required, htmlFor }: { label: string; required?: boolean; htmlFor: string }) {
  return (
    <FieldLabel
      htmlFor={htmlFor}
      className={required ? "after:text-danger after:content-['_*']" : undefined}
      title={required ? m.field_required() : undefined}
    >
      {label}
    </FieldLabel>
  )
}

/** Place at the bottom of a form to explain the asterisk + red accent convention. */
export function RequiredLegend() {
  return (
    <p className="text-xs text-muted">
      <span className="font-medium text-danger">*</span> {m.field_required_legend()}
    </p>
  )
}

/** Accessible on/off field shared by settings and privacy controls. */
export function SwitchField({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const markDirty = useMarkFormDirty()
  const descriptionId = useId()
  const controlId = useId()
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
        {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      </FieldContent>
      <Switch
        id={controlId}
        data-form-dirty-managed
        checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        onCheckedChange={(next) => { markDirty(); onChange(next) }}
        disabled={disabled}
      />
    </Field>
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
  disabled,
  maxLength = MAX_NAME_LENGTH,
  type = 'text',
  autoComplete,
  minLength,
  ariaLabel,
  testId,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  invalid?: boolean
  required?: boolean
  describedById?: string
  disabled?: boolean
  maxLength?: number
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  minLength?: number
  ariaLabel?: string
  testId?: string
}) {
  const id = useId()
  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Mark the intended autofocus target so Modal's focus trap honours it instead of
        // grabbing the first focusable (often a leading button).
        data-autofocus={autoFocus ? '' : undefined}
        maxLength={maxLength}
        minLength={minLength}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
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
  const id = useId()
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={2}
        value={value}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
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
  const id = useId()
  return (
    <Field data-invalid={invalid || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        // For <input type="number"> the browser reports `value` as EITHER a valid numeric string
        // OR "" — it sanitises away part-typed junk ("1.", "-", "1e"), so Number(value) is a finite
        // number or Number("") === 0, and NEVER NaN. (The obvious guess that "" or "abc" reaches
        // here as NaN is wrong: "abc" can't be typed into a number input, and Number("") is 0.)
        // Emitting 0 for an empty field is the deliberate tradeoff — the value round-trips as a
        // number, at the cost that the field can't be held visually blank mid-edit (clearing it
        // reads as 0). onBlur (below) is the real clamp; its non-finite guard is cheap defence
        // against a stray programmatic NaN in `value`, not something this onChange can produce.
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
    </Field>
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
  const id = useId()
  return (
    <Field data-invalid={invalid || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="date"
        value={value}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

export interface Option {
  value: string
  label: string
  /** Renders the option un-pickable while still SELECTABLE-by-value: a select whose current value
   *  is a disabled option keeps showing it (the "(current, archived)" parent case — the unchanged
   *  id must round-trip), but the user can't move BACK to it after choosing something else. */
  disabled?: boolean
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
  ariaLabel,
  testId,
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
  ariaLabel?: string
  testId?: string
}) {
  const id = useId()
  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Select
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? describedById : undefined}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

/** Native select retained for the scheduler's dense editing surface. */
export function NativeSelectField({
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
  const id = useId()
  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <select
        id={id}
        className={cn(inputClass, selectChevronClass)}
        style={selectChevronStyle}
        value={value}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
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
  const markDirty = useMarkFormDirty()
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
    <Field data-invalid={invalid || undefined}>
      <FieldLabel>{label}</FieldLabel>
      {/* Radix Popover supplies the shell and anchored positioning. CapacityLens owns dismissal through
          the capture-phase
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={open}
              aria-label={m.swatch_trigger_label({ label, color: colorName(value) })}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? describedById : undefined}
              className="w-full justify-between"
            >
              <span
                className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: value }}
              />
            </Button>
          </PopoverAnchor>
          {open && (
            // portal={false} renders Content WITHOUT a Portal so the panel stays inside this
            // control's DOM subtree (and so inside the enclosing [role="dialog"]) — the capture-phase
            // listener walks up to that dialog to classify a backdrop press, which a portalled popup
            // would escape. side="top" + avoidCollisions={false} keeps placement deterministic: the
            // colour field is the last field in every form and the
            // Modal's overflow-y-auto would clip a downward popup, so the popup must ALWAYS open
            // upward — without avoidCollisions={false} Radix would flip it down when room is tight,
            // re-introducing exactly that clipping. forceMount-free: Radix only renders Content while
            // Root is open, and capacitylens's `open` already gates it, so mount/unmount tracks the popup
            // exactly as before.
            <PopoverContent
              portal={false}
              role="group"
              aria-label={m.swatch_group_label({ label })}
              side="top"
              align="start"
              sideOffset={4}
              avoidCollisions={false}
              // The swatch grid uses the product's elevated panel tokens and fixed grid layout. The
              // capacitylens-pop motion matches CommandPalette/Modal (tw-animate-css isn't installed, so
              // shadcn's animate-in classes would be inert no-ops here).
              className="grid w-max gap-1.5 rounded-md border bg-elevated p-2 shadow-pop ring-1 ring-line animate-[capacitylens-pop_0.14s_ease-out]"
              style={{ gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))` }}
              // CapacityLens owns dismissal (the capture-phase mousedown + the Escape onKeyDown above), so
              // neutralise every Radix dismiss path so there is one dismissal owner.
              onInteractOutside={(e) => e.preventDefault()}
              onPointerDownOutside={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => e.preventDefault()}
              // Don't let Radix's FocusScope move focus on open/close. The trigger keeps focus, so the
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
                    // aria-pressed conveys selection; the explicit context signal below registers
                    // only a real value change, while the marker prevents Modal's raw-toggle
                    // compatibility fallback from treating the selected swatch as an edit.
                    data-form-dirty-managed
                    aria-pressed={selected}
                    onClick={() => {
                      if (!selected) markDirty()
                      onChange(hex)
                      setOpen(false)
                    }}
                    className={cn(
                      'size-6 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110',
                      selected && 'outline outline-2 outline-offset-1 outline-brand-strong',
                    )}
                    style={{ backgroundColor: hex }}
                  />
                )
              })}
            </PopoverContent>
          )}
        </div>
      </Popover>
    </Field>
  )
}

// Picker order: Monday-first, Sunday last. The 3-letter LABELS resolve through Paraglide at render
// (weekdayShortLabel) so they localise AND follow a locale switch without a reload (mirrors
// metadata.ts) — and each label doubles as the chip's accessible name, so a screen-reader user hears
// the localised day too. Kept separate from the model order so the order isn't re-stated per locale.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

/** The localised 3-letter label for a weekday (Sun=0 … Sat=6). Exhaustive over Weekday. */
function weekdayShortLabel(day: Weekday): string {
  switch (day) {
    case 1:
      return m.weekday_short_mon()
    case 2:
      return m.weekday_short_tue()
    case 3:
      return m.weekday_short_wed()
    case 4:
      return m.weekday_short_thu()
    case 5:
      return m.weekday_short_fri()
    case 6:
      return m.weekday_short_sat()
    case 0:
      return m.weekday_short_sun()
  }
}

export function WeekdayPicker({
  label,
  value,
  onChange,
  invalid,
  describedById,
}: {
  label: string
  value: Weekday[]
  onChange: (v: Weekday[]) => void
  // Mirror the sibling fields (TextField/SelectField/NumberField): mark the GROUP errored so the
  // required-error (no day selected) re-announces when a SR navigates to the fieldset (WCAG 3.3.1).
  invalid?: boolean
  describedById?: string
}) {
  const markDirty = useMarkFormDirty()
  return (
    <FieldSet aria-invalid={invalid || undefined} aria-describedby={invalid ? describedById : undefined}>
      <FieldLegend variant="label">{label}</FieldLegend>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={2}
        value={value.map(String)}
        onValueChange={(next) => {
          markDirty()
          onChange(next.map(Number) as Weekday[])
        }}
      >
        {WEEKDAY_ORDER.map((day) => (
          <ToggleGroupItem key={day} value={String(day)} aria-label={weekdayShortLabel(day)}>
            {weekdayShortLabel(day)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
  )
}
