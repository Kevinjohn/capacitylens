import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useMarkFormDirty } from "./formDirty";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

/** One selectable segment: the value it sets and the label shown on its button. */
export type SegmentedOption<T> = { value: T; label: ReactNode; title?: string };
export type SegmentedGeometry = "gapped" | "connected";
export type SegmentedSize = "sm" | "md" | "lg";

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
// The `data-[state=on]:hover:*` pair re-pins the colours because the outline variant's
// `hover:bg-accent` would otherwise flip the selected segment back to grey on hover.
//
// Static across renders (no prop/state input) — hoisted out of the component body.
const selectedSegmentClass = [
  "data-[state=on]:bg-brand-soft data-[state=on]:text-brand-soft-ink",
  "data-[state=on]:hover:bg-brand-soft data-[state=on]:hover:text-brand-soft-ink",
  "data-[state=on]:relative data-[state=on]:z-10 data-[state=on]:border-brand",
].join(" ");

// Nested-radius contract: padding is ALWAYS 2px; the item radius is therefore exactly the track
// radius minus 2px at every size. Inactive items reserve the selected border with transparent ink,
// so moving selection cannot change either the track width or an item's box by 2px.
const sizeClasses: Record<SegmentedSize, { track: string; item: string }> = {
  sm: { track: "rounded-[6px]", item: "h-6 rounded-[4px] px-3 text-[12.5px]" },
  md: { track: "rounded-[7px]", item: "h-7 rounded-[5px] px-[15px] text-[13.5px]" },
  lg: { track: "rounded-[8px]", item: "h-8 rounded-[6px] px-4 text-[14.5px]" },
};

// Connected groups use inset separators so the active item's real 1px border never competes for
// layout space. Clear the rule on the active item and its immediate successor to avoid a doubled
// edge. Focus rises above selection so the shared focus outline is never clipped by a neighbour.
const connectedItemClass = [
  "not-first:shadow-[inset_1px_0_0_var(--color-line)]",
  "data-[state=on]:shadow-none [[data-state=on]+&]:shadow-none",
].join(" ");

/** Single-select option group backed by ShadCN ToggleGroup. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledby,
  className,
  itemClassName,
  geometry = "gapped",
  fullWidth = false,
  size = "md",
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
  /** Optional layout classes applied to every segment. */
  itemClassName?: string;
  /** Visual relationship between items. `gapped` leaves 2px channels; `connected` uses inset rules. */
  geometry?: SegmentedGeometry;
  /** Give every option an equal-width cell across the available track width. */
  fullWidth?: boolean;
  /** Track/item scale. Track padding remains 2px at every size. */
  size?: SegmentedSize;
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
      size={size === "md" ? "default" : size}
      // 0.5 Tailwind spacing units = the geometry contract's fixed 2px. Connected overrides the
      // visual gap to zero without selecting ToggleGroup's spacing=0 border-stripping behaviour.
      spacing={0.5}
      data-segmented-control
      data-segmented-size={size}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn(
        "h-auto border border-input bg-background p-[2px] shadow-xs",
        sizeClasses[size].track,
        geometry === "gapped" ? "gap-0.5" : "gap-0",
        fullWidth && "flex w-full",
        className,
      )}
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
          className={cn(
            "min-w-0 shrink-0 border border-transparent leading-none shadow-none focus:relative focus:z-20 focus-visible:relative focus-visible:z-20",
            sizeClasses[size].item,
            selectedSegmentClass,
            geometry === "connected" && connectedItemClass,
            fullWidth && "flex-1 basis-0 min-w-0 justify-center truncate",
            itemClassName,
          )}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
