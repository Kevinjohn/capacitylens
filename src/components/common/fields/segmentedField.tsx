import { useId } from "react";
import { Field, FieldLabel } from "../../ui/field";
import {
  SegmentedControl,
  type SegmentedDensity,
  type SegmentedGeometry,
  type SegmentedOption,
  type SegmentedSize,
} from "../SegmentedControl";
import { productFieldLayoutProps } from "./fieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

/** Labelled segmented option set that shares the product field layouts. */
export function SegmentedField<T extends string | number>({
  label,
  value,
  onChange,
  options,
  ariaLabel,
  controlClassName,
  geometry = "gapped",
  fullWidth = false,
  size = "md",
  density = "default",
  layout = "stacked",
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Optional accessible name when it intentionally differs from the visible label. */
  ariaLabel?: string;
  /** Optional layout classes for this field's segmented control. */
  controlClassName?: string;
  /** Visual relationship between items. */
  geometry?: SegmentedGeometry;
  /** Give every option an equal-width cell across the available track width. */
  fullWidth?: boolean;
  /** Track/item scale. */
  size?: SegmentedSize;
  /** Named label spacing treatment. */
  density?: SegmentedDensity;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const labelId = useId();
  return (
    <Field {...productFieldLayoutProps(layout)}>
      <FieldLabel id={labelId}>{label}</FieldLabel>
      <SegmentedControl
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel={ariaLabel}
        ariaLabelledby={ariaLabel ? undefined : labelId}
        className={controlClassName}
        geometry={geometry}
        fullWidth={fullWidth}
        size={size}
        density={density}
      />
    </Field>
  );
}
