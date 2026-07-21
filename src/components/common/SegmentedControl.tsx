import type { ReactNode } from 'react'
import { useMarkFormDirty } from './formDirty'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'

/** One selectable segment: the value it sets and the label shown on its button. */
export type SegmentedOption<T> = { value: T; label: ReactNode; title?: string }

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
  /** Optional layout classes for the group container. */
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
      className={className}
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
        <ToggleGroupItem key={String(opt.value)} value={String(opt.value)} title={opt.title} data-form-dirty-managed>
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
