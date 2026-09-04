import { useId } from "react";
import { Switch } from "../../ui/switch";
import { Checkbox } from "../../ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../ui/field";
import { useMarkFormDirty } from "../formDirty";
import { productFieldLayoutProps } from "./fieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

/** Accessible on/off field shared by settings and privacy controls. */
export function SwitchField({
  label,
  description,
  descriptionPlacement = "label",
  checked,
  onChange,
  disabled = false,
  layout = "stacked",
}: {
  label: string;
  description?: string;
  /** Keep the default beside the label, or group it below the control in compact rows. */
  descriptionPlacement?: "label" | "control";
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const markDirty = useMarkFormDirty();
  const descriptionId = useId();
  const controlId = useId();
  const descriptionInControl = description && descriptionPlacement === "control";
  const control = (
    <Switch
      id={controlId}
      data-form-dirty-managed
      checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      onCheckedChange={(next) => {
        markDirty();
        onChange(next);
      }}
      disabled={disabled}
    />
  );
  return (
    <Field
      orientation={layout === "label-control" ? "vertical" : "horizontal"}
      data-disabled={disabled || undefined}
      {...productFieldLayoutProps(layout)}
    >
      <FieldContent>
        <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
        {description && !descriptionInControl && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      </FieldContent>
      {descriptionInControl ? (
        <FieldContent className="min-h-9 justify-center">
          {control}
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        </FieldContent>
      ) : layout === "label-control" ? (
        <div className="flex min-h-9 items-center">{control}</div>
      ) : (
        control
      )}
    </Field>
  );
}

/** Accessible checkbox field with the same opt-in product layouts as the other form controls. */
export function CheckboxField({
  label,
  checked,
  onChange,
  disabled = false,
  layout = "stacked",
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const markDirty = useMarkFormDirty();
  const controlId = useId();
  const control = (
    <Checkbox
      id={controlId}
      data-form-dirty-managed
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        markDirty();
        onChange(next === true);
      }}
    />
  );
  return (
    <Field
      orientation={layout === "label-control" ? "vertical" : "horizontal"}
      data-disabled={disabled || undefined}
      {...productFieldLayoutProps(layout)}
    >
      {layout === "label-control" ? (
        <>
          <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
          <div className="flex min-h-9 items-center">{control}</div>
        </>
      ) : (
        <>
          {control}
          <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
        </>
      )}
    </Field>
  );
}
