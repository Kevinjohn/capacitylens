import type { ReactNode } from "react";
import { useMarkFormDirty } from "./formDirty";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

/** One selectable segment: the value it sets and the label shown on its button. */
export type SegmentedOption<T> = { value: T; label: ReactNode; title?: string };

function encodedValue(value: string | number): string {
  return `${typeof value === "number" ? "n" : "s"}:${String(value)}`;
}

// Selected-segment styling, overriding the primitive's stock `data-[state=on]:bg-accent`.
// `--accent` is `--c-base`, which is #f4f5f8 on a white toolbar (1.04:1) and #0e1016 on the
// #161922 dark surface (1.2:1) — the fill alone left "which segment is on" effectively invisible
// in both themes (WCAG 1.4.11 wants 3:1 for the visual info that identifies a control's state).
// Switch to the brand-soft tint + its paired ink — the same "this one is active" language the
// sidebar nav already uses (`--sidebar-primary: var(--c-brand-soft)`) — and outline the segment in
// --c-brand so the state survives as a shape, not only as a tint.
//
// Closing that outline takes two pieces. `border-brand` covers top/right/bottom, but the
// connected-control CSS strips each item's left border (`data-[spacing=0]:…:border-l-0`) so
// adjacent segments share one hairline — re-adding `border-l` would both lose on specificity (two
// data-attributes to one) and widen the group by 1px whenever the selection moves. So the left
// edge comes from an inset shadow instead: it costs no layout. Only non-first segments need that
// shadow because the first retains its real left border, and the shadow is left-only so it does
// not double the weight of the real top/right/bottom borders. z-10 lifts the selected segment
// above the neighbour whose right border would otherwise overdraw its left edge. The shadow
// carries both data-attributes so it outranks the primitive's `data-[spacing=0]:shadow-none`.
//
// The `data-[state=on]:hover:*` pair re-pins the colours because the outline variant's
// `hover:bg-accent` would otherwise flip the selected segment back to grey on hover.
//
// Static across renders (no prop/state input) — hoisted out of the component body.
const selectedSegmentClass = [
  "data-[state=on]:bg-brand-soft data-[state=on]:text-brand-soft-ink",
  "data-[state=on]:hover:bg-brand-soft data-[state=on]:hover:text-brand-soft-ink",
  "data-[state=on]:border-brand data-[state=on]:z-10",
  "data-[spacing=0]:not-first:data-[state=on]:shadow-[inset_1px_0_0_var(--color-brand)]",
].join(" ");

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
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Accessible name for the group; supply this OR `ariaLabelledby`. */
  ariaLabel?: string;
  /** Id of an existing visible label, as an alternative to `ariaLabel`. */
  ariaLabelledby?: string;
  /** Optional layout classes for the group container. */
  className?: string;
  /**
   * When true, the group gives every segment the native `disabled` attribute, so the selected value
   * remains visible but cannot receive sequential focus or change. Used for the frozen week-start
   * control in Settings. Default false.
   */
  disabled?: boolean;
}) {
  const markDirty = useMarkFormDirty();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={className}
      value={encodedValue(value)}
      disabled={disabled}
      onValueChange={(next) => {
        if (!next) return;
        const option = options.find((candidate) => encodedValue(candidate.value) === next);
        if (!option) return;
        if (value !== option.value) markDirty();
        onChange(option.value);
      }}
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={encodedValue(opt.value)}
          value={encodedValue(opt.value)}
          title={opt.title}
          data-form-dirty-managed
          className={selectedSegmentClass}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
