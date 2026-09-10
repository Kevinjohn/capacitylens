import { useId } from "react";
import { MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { Input } from "../../ui/input";
import { Field, FieldContent, FieldDescription } from "../../ui/field";
import { RequiredFieldLabel } from "./fieldLayout";
import { buildProductFieldLayoutProps } from "./buildProductFieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
  disabled?: boolean;
  maxLength?: number;
  type?: "text" | "email" | "password" | "date";
  autoComplete?: string;
  minLength?: number;
  ariaLabel?: string;
  testId?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
};

function resolveBooleanAttribute(value: boolean | undefined): true | undefined {
  return value ? true : undefined;
}

function resolveNonEmptyAttribute(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function TextFieldControl({
  value,
  onChange,
  placeholder,
  description,
  autoFocus,
  invalid,
  required,
  describedById,
  disabled,
  maxLength = MAX_NAME_INPUT_CODE_UNITS,
  type = "text",
  autoComplete,
  minLength,
  ariaLabel,
  testId,
  id,
  descriptionId,
}: TextFieldProps & { id: string; descriptionId: string }) {
  const ariaDescribedBy = resolveNonEmptyAttribute(
    [description ? descriptionId : undefined, invalid ? describedById : undefined].filter(Boolean).join(" "),
  );

  return (
    <Input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      // Mark the intended autofocus target so Modal's focus trap honours it instead of
      // grabbing the first focusable (often a leading button).
      data-autofocus={autoFocus ? "" : undefined}
      maxLength={maxLength}
      minLength={minLength}
      autoComplete={autoComplete}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      aria-required={resolveBooleanAttribute(required)}
      aria-invalid={resolveBooleanAttribute(invalid)}
      aria-describedby={ariaDescribedBy}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextField(props: TextFieldProps) {
  const { label, description, invalid, required, disabled, layout = "stacked" } = props;
  const id = useId();
  const descriptionId = useId();
  const input = <TextFieldControl {...props} id={id} descriptionId={descriptionId} />;

  return (
    <Field
      data-invalid={resolveBooleanAttribute(invalid)}
      data-disabled={resolveBooleanAttribute(disabled)}
      {...buildProductFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel htmlFor={id} label={label} {...(required !== undefined ? { required } : {})} />
      {description ? (
        <FieldContent>
          {input}
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        </FieldContent>
      ) : (
        input
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  invalid,
  required,
  disabled,
  describedById,
  layout = "stacked",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  describedById?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const id = useId();
  return (
    <Field
      data-invalid={resolveBooleanAttribute(invalid)}
      data-disabled={resolveBooleanAttribute(disabled)}
      {...buildProductFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel htmlFor={id} label={label} {...(required !== undefined ? { required } : {})} />
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-required={resolveBooleanAttribute(required)}
        aria-invalid={resolveBooleanAttribute(invalid)}
        aria-describedby={invalid ? describedById : undefined}
        // For <input type="number"> the browser reports `value` as EITHER a valid numeric string
        // OR "" — it sanitises away part-typed junk ("1.", "-", "1e"), so Number(value) is a finite
        // number or Number("") === 0, and NEVER NaN. (The obvious guess that "" or "abc" reaches
        // here as NaN is wrong: "abc" can't be typed into a number input, and Number("") is 0.)
        // Emitting 0 for an empty field is the deliberate tradeoff — the value round-trips as a
        // number, at the cost that the field can't be held visually blank mid-edit (clearing it
        // reads as 0). onBlur (below) is the real clamp; its non-finite guard is cheap defence
        // against a stray programmatic NaN in `value`, not something this onChange can produce.
        onChange={(e) => onChange(Number(e.target.value))}
        // Clamp to [min, max] on blur — type=number's own min/max are advisory and
        // aren't enforced on paste/typing, so a stray entry would otherwise stick.
        onBlur={(e) => {
          let numericValue = Number(e.target.value);
          if (!Number.isFinite(numericValue)) numericValue = min ?? 0;
          if (min !== undefined) numericValue = Math.max(min, numericValue);
          if (max !== undefined) numericValue = Math.min(max, numericValue);
          if (numericValue !== value) onChange(numericValue);
        }}
      />
    </Field>
  );
}

export function DateField({
  label,
  value,
  onChange,
  invalid,
  required,
  describedById,
  min,
  max,
  testId,
  layout = "stacked",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
  min?: string;
  max?: string;
  testId?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const id = useId();
  return (
    <Field data-invalid={resolveBooleanAttribute(invalid)} {...buildProductFieldLayoutProps(layout)}>
      <RequiredFieldLabel htmlFor={id} label={label} {...(required !== undefined ? { required } : {})} />
      <Input
        id={id}
        type="date"
        value={value}
        aria-required={resolveBooleanAttribute(required)}
        aria-invalid={resolveBooleanAttribute(invalid)}
        aria-describedby={invalid ? describedById : undefined}
        min={min}
        max={max}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
