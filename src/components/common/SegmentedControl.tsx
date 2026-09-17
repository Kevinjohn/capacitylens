import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useMarkFormDirty } from "./formDirty";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

/** One selectable segment: the value it sets and the label shown on its button. */
export type SegmentedOption<T> = { value: T; label: ReactNode; title?: string };
export type SegmentedGeometry = "gapped" | "connected";
export type SegmentedSize = "sm" | "md" | "lg";
export type SegmentedDensity = "default" | "compact";
/**
 * `recessed` sinks the track and lifts only the selected item; it is what every product surface
 * uses. `outline` is the older bordered treatment, kept as the primitive's default so an embedder
 * of this control opts into elevation deliberately.
 */
export type SegmentedVariant = "outline" | "recessed";

interface SegmentedControlProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Accessible name for the group; supply this OR `ariaLabelledby`. */
  ariaLabel?: string;
  /** Id of an existing visible label, as an alternative to `ariaLabel`. */
  ariaLabelledby?: string;
  /** Id of visible help text that describes the group. */
  ariaDescribedby?: string;
  /** Optional layout classes for the group container. */
  className?: string;
  /** Visual relationship between items. `gapped` leaves 2px channels; `connected` uses inset rules. */
  geometry?: SegmentedGeometry;
  /** Give every option an equal-width cell across the available track width. */
  fullWidth?: boolean;
  /** Track/item scale. Track padding remains 2px at every size. */
  size?: SegmentedSize;
  /** Named spacing treatment for labels that need less horizontal room. */
  density?: SegmentedDensity;
  /** Disable every segment while preserving the selected value. */
  disabled?: boolean;
  /** Visual treatment of the track and its selected item. */
  variant?: SegmentedVariant;
}

function encodeValue(value: string | number): string {
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
  "data-[state=on]:border-brand",
].join(" ");

// Nested-radius contract: padding is ALWAYS 2px; the item radius is therefore exactly the track
// radius minus 2px at every size. Inactive items reserve the selected border with transparent ink,
// so moving selection cannot change either the track width or an item's box by 2px.
const sizeClasses: Record<SegmentedSize, { radius: string; item: string }> = {
  sm: { radius: "[--segment-radius:4px]", item: "h-6 px-3 text-[12.5px]" },
  md: { radius: "[--segment-radius:5px]", item: "h-7 px-[15px] text-[13.5px]" },
  lg: { radius: "[--segment-radius:6px]", item: "h-8 px-4 text-[14.5px]" },
};

// Connected groups use inset separators so the active item's real 1px border never competes for
// layout space. Clear the rule on the active item and its immediate successor to avoid a doubled
// edge. Focus rises above selection so the shared focus outline is never clipped by a neighbour.
const connectedItemClass = [
  "not-first:shadow-[inset_1px_0_0_var(--color-line)]",
  "data-[state=on]:shadow-none [[data-state=on]+&]:shadow-none",
].join(" ");

// Recessed treatment: the track is the recessed surface, so selection is carried by elevation (a
// lifted surface-coloured item with a soft drop shadow) rather than a tinted fill and a coloured
// border. Its hairline is the item's own border, not an inset shadow: an inset paints inside the
// border box, and the 1px transparent border every variant reserves for stable sizing shows the
// item's white background, so the two together read as a white ring around the hairline.
// Unselected items are borderless muted text on the track.
// Only colours change: size, density and geometry keep their meaning on both variants.
const recessedTrackClass = "border-line bg-muted shadow-none";
const recessedSegmentClass = [
  "font-medium text-muted-foreground hover:bg-transparent hover:text-ink",
  "data-[state=on]:bg-surface data-[state=on]:text-brand-soft-ink data-[state=on]:border-line",
  "data-[state=on]:hover:bg-surface data-[state=on]:hover:text-brand-soft-ink",
  "data-[state=on]:shadow-[0_1px_2px_rgba(20,22,26,0.10)]",
].join(" ");

function getSegmentClass({
  size,
  density,
  geometry,
  fullWidth,
  variant,
}: Pick<Required<SegmentedControlProps<string>>, "size" | "density" | "geometry" | "fullWidth" | "variant">) {
  return cn(
    "min-w-0 shrink-0 rounded-(--segment-radius) border border-transparent leading-none shadow-none data-[state=on]:relative data-[state=on]:z-10",
    sizeClasses[size].item,
    density === "compact" && "px-1.5 tracking-tighter",
    variant === "recessed" ? recessedSegmentClass : selectedSegmentClass,
    // Connected separators and their shadow reset belong to the outline treatment, where items
    // carry real borders that would otherwise double up. On a recessed track the separators draw
    // rules through a surface that has none, and the reset cancels the lift that carries selection.
    geometry === "connected" && variant !== "recessed" && connectedItemClass,
    fullWidth && "flex-1 basis-0 min-w-0 justify-center truncate",
  );
}

/** Single-select option group backed by ShadCN ToggleGroup. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  className,
  geometry = "gapped",
  fullWidth = false,
  size = "md",
  density = "default",
  disabled = false,
  variant = "outline",
}: SegmentedControlProps<T>) {
  const markDirty = useMarkFormDirty();
  const recessed = variant === "recessed";
  return (
    <ToggleGroup
      type="single"
      variant={recessed ? "default" : "outline"}
      data-segmented-control
      data-geometry={geometry}
      data-density={density}
      data-size={size}
      data-variant={variant}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      className={cn(
        "h-auto rounded-[calc(var(--segment-radius)+2px)] border border-input bg-background p-[2px] shadow-xs",
        sizeClasses[size].radius,
        geometry === "gapped" ? "gap-0.5" : "gap-0",
        recessed && recessedTrackClass,
        fullWidth && "flex w-full",
        className,
      )}
      value={encodeValue(value)}
      disabled={disabled}
      onValueChange={(next) => {
        if (!next) return;
        const option = options.find((candidate) => encodeValue(candidate.value) === next);
        if (!option) return;
        if (value !== option.value) markDirty();
        onChange(option.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={encodeValue(option.value)}
          value={encodeValue(option.value)}
          title={option.title}
          data-form-dirty-managed
          className={getSegmentClass({ size, density, geometry, fullWidth, variant })}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
