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
  /** A disabled current option remains displayable so an unchanged archived-parent ID can round-trip, but users cannot select it again after changing away. */
  disabled?: boolean;
}

/** A weekday can be full, half, or off. */
export type WorkingDayOption = "full" | "half" | "off";
