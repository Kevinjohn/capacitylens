import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useMarkFormDirty } from './formDirty'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'

/** One selectable segment: the value it sets and the label shown on its button. */
export type SegmentedOption<T> = { value: T; label: ReactNode }

/** Single-select option group backed by ShadCN ToggleGroup. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledby,
  className,
  disabled = false,
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
  /**
   * When true, every segment is a disabled button (native `disabled` + `aria-disabled`, muted +
   * cursor-not-allowed) so the selected value is shown but can't change. Used for the FROZEN
   * week-start control in Settings. Default false.
   */
  disabled?: boolean
}) {
  const markDirty = useMarkFormDirty()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn(className)}
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => {
        if (!next) return
        const option = options.find((candidate) => String(candidate.value) === next)
        if (!option) return
        if (value !== option.value) markDirty()
        onChange(option.value)
      }}
    >
      {options.map((opt) => (
        <ToggleGroupItem key={String(opt.value)} value={String(opt.value)} data-form-dirty-managed>
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
