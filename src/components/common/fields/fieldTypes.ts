// Product field APIs composed from ShadCN's Field family.

/** Shared label placement choices for product fields. */
export type ProductFieldLayout = "stacked" | "label-control";

/** A value and label accepted by a select field. */
export interface Option {
  value: string;
  label: string;
  /** Labels a contiguous option group for assistive technology and visual scanning. */
  groupLabel?: string;
  /** Stable semantic identity for a translated group label. */
  groupKey?: "all-projects" | "project";
  /** Adds a structural, non-selectable divider immediately before this option. */
  separatorBefore?: boolean;
  /** Renders the option un-pickable while still selectable-by-value: a select whose current value
   * is a disabled option keeps showing it (the "(current, archived)" parent case, the unchanged
   * id must round-trip), but the user can't move back to it after choosing something else. */
  disabled?: boolean;
}

/** A weekday can be full, half, or off. */
export type WorkingDayOption = "full" | "half" | "off";
