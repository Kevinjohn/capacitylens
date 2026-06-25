import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One selectable segment: the value it sets and the label shown on its button. */
export type SegmentedOption<T> = { value: T; label: ReactNode }

/**
 * The single home for floaty's pill-style segmented choosers — the four that were
 * hand-rolled identically: Settings' Scheduling-input, Week-starts-on and Theme pickers,
 * plus ActivityForm's Kind picker. Centralising them keeps that markup from drifting.
 *
 * It renders the EXACT semantics those four carried, deliberately:
 *  - a `role="radiogroup"` wrapper with `role="radio" aria-checked` buttons (a single-select
 *    radio group, the correct a11y idiom here — NOT the toolbar's aria-pressed toggles, which
 *    are a different question and are left alone).
 *  - each radio is a plain, individually-focusable `<button type="button">` (no roving
 *    tabindex). That is load-bearing: ActivityForm's Kind control lives inside `Modal`, whose
 *    Tab-trap and unsaved-changes guard enumerate focusable buttons — making the unselected
 *    radios un-focusable (roving tabindex) would change that path. The radios are NOT
 *    `aria-pressed`, so (as today) clicking one does not trip the Modal dirty-guard; that guard
 *    watches input/change events and aria-pressed clicks, neither of which a radio fires.
 *  - identical Tailwind classes, so there is zero visual change.
 *
 * `onChange` carries the option's typed value; binding/side-effects stay at the call site.
 */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledby,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  /** Accessible name for the group; supply this OR `ariaLabelledby`. */
  ariaLabel?: string
  /** Id of an existing visible label, as an alternative to `ariaLabel`. */
  ariaLabelledby?: string
  /**
   * Extra classes merged onto the wrapper via `cn()` (twMerge-resolved, so a conflicting
   * utility passed here OVERRIDES the base rather than doubling it). The four current call
   * sites pass none.
   */
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn('inline-flex rounded-md border border-line p-0.5', className)}
    >
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition',
              selected ? 'bg-brand-soft text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
