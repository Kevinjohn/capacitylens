import { Fragment, useId, useState } from "react";
import { MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { SWATCHES, SWATCH_COLUMNS, swatchLabel, colorName, swatchIndexOf } from "../../lib/palette";
// Control styling lives in ./controls (a non-component module) so its style OBJECT can
// be exported without tripping react-refresh/only-export-components on this file.
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { cn } from "@/lib/utils";
import { m } from "@/i18n";
import type { Weekday } from "@capacitylens/shared/types/entities";
import { weekdayLabel } from "../../lib/weekdays";
import { useMarkFormDirty } from "./formDirty";
import {
  SegmentedControl,
  type SegmentedDensity,
  type SegmentedGeometry,
  type SegmentedOption,
  type SegmentedSize,
} from "./SegmentedControl";

// Product field APIs composed from ShadCN's Field family.
export type ProductFieldLayout = "stacked" | "label-control";

const labelControlLayout = "sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:items-center";

// Shared data-attribute + class pair every product field spreads onto its <Field> so the
// opt-in compact "label-control" row layout (see ProductFieldLayout) is applied identically
// everywhere instead of being copy-pasted per field.
function productFieldLayoutProps(layout: ProductFieldLayout) {
  const compact = layout === "label-control";
  return {
    "data-product-layout": compact ? layout : undefined,
    className: cn(compact && labelControlLayout),
  } as const;
}

function RequiredFieldLabel({ label, required, htmlFor }: { label: string; required?: boolean; htmlFor: string }) {
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {required && (
        <span aria-hidden="true" className="text-danger" title={m.field_required()}>
          *
        </span>
      )}
    </div>
  );
}

/** Place at the bottom of a form to explain the asterisk + red accent convention. */
export function RequiredLegend() {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-danger">*</span> {m.field_required_legend()}
    </p>
  );
}

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

export function TextField({
  label,
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
  layout = "stacked",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  description?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
  disabled?: boolean;
  maxLength?: number;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  minLength?: number;
  ariaLabel?: string;
  testId?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const id = useId();
  const descriptionId = useId();
  const input = (
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
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={
        [description ? descriptionId : undefined, invalid ? describedById : undefined].filter(Boolean).join(" ") ||
        undefined
      }
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <Field
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      {...productFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
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
  onChange: (v: number) => void;
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
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      {...productFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
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
          let n = Number(e.target.value);
          if (!Number.isFinite(n)) n = min ?? 0;
          if (min !== undefined) n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          if (n !== value) onChange(n);
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
  layout = "stacked",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
  min?: string;
  max?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const id = useId();
  return (
    <Field data-invalid={invalid || undefined} {...productFieldLayoutProps(layout)}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="date"
        value={value}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export interface Option {
  value: string;
  label: string;
  /** Labels a contiguous option group for assistive technology and visual scanning. */
  groupLabel?: string;
  /** Stable semantic identity for a translated group label. */
  groupKey?: "all-projects" | "project";
  /** Adds a structural, non-selectable divider immediately before this option. */
  separatorBefore?: boolean;
  /** Renders the option un-pickable while still SELECTABLE-by-value: a select whose current value
   *  is a disabled option keeps showing it (the "(current, archived)" parent case — the unchanged
   *  id must round-trip), but the user can't move BACK to it after choosing something else. */
  disabled?: boolean;
}

// Radix reserves the empty string for its placeholder state. Encode every caller value into a
// separate non-empty domain instead of reserving one otherwise-legal string as a sentinel.
const SELECT_VALUE_PREFIX = "__capacitylens_option__:";
const encodeSelectValue = (value: string): string => `${SELECT_VALUE_PREFIX}${value}`;
const decodeSelectValue = (value: string): string => value.slice(SELECT_VALUE_PREFIX.length);

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
  required,
  describedById,
  ariaLabel,
  testId,
  layout = "stacked",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
  ariaLabel?: string;
  testId?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const id = useId();
  const markDirty = useMarkFormDirty();
  const selectedOption = options.find((option) => option.value === value);
  const unresolvedValue = value !== "" && selectedOption === undefined;
  const optionGroups = options.reduce<Array<{ key?: string; label?: string; options: Option[] }>>((groups, option) => {
    const previous = groups.at(-1);
    const key = option.groupKey ?? option.groupLabel;
    if (previous && previous.key === key) previous.options.push(option);
    else groups.push({ key, label: option.groupLabel, options: [option] });
    return groups;
  }, []);
  return (
    <Field
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      {...productFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Select
        value={selectedOption || unresolvedValue ? encodeSelectValue(value) : ""}
        disabled={disabled}
        onValueChange={(next) => {
          const resolved = decodeSelectValue(next);
          if (resolved === value) return;
          markDirty();
          onChange(resolved);
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? describedById : undefined}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder}>{selectedOption?.label ?? placeholder ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {optionGroups.map((group, index) => (
            <SelectGroup key={`${group.key ?? "ungrouped"}-${index}`}>
              {group.label && <SelectLabel>{group.label}</SelectLabel>}
              {group.options.map((o) => (
                <Fragment key={o.value}>
                  {o.separatorBefore && <SelectSeparator />}
                  <SelectItem value={encodeSelectValue(o.value)} data-value={o.value} disabled={o.disabled}>
                    {o.label}
                  </SelectItem>
                </Fragment>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// A swatch picker, not a hex/RGB tool: a trigger showing the current colour opens a
// 13×4 grid of preset swatches (see SWATCHES). Picking one is the only way to set the
// value, so the stored colour is always a valid hex — no text/hex entry.
export function ColorField({
  label,
  value,
  onChange,
  invalid,
  describedById,
  layout = "stacked",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedById?: string;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
}) {
  const markDirty = useMarkFormDirty();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, swatchIndexOf(value));

  return (
    <Field data-invalid={invalid || undefined} {...productFieldLayoutProps(layout)}>
      <FieldLabel>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={m.swatch_trigger_label({
              label,
              color: colorName(value),
            })}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? describedById : undefined}
            className="w-full justify-between"
          >
            <span
              className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: value }}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          role="radiogroup"
          aria-label={m.swatch_group_label({ label })}
          side="top"
          align="start"
          className="grid w-max gap-1.5 p-2"
          style={{
            gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))`,
          }}
        >
          {SWATCHES.map((hex, i) => {
            const selected = hex.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-label={swatchLabel(i)}
                data-form-dirty-managed
                aria-checked={selected}
                tabIndex={i === selectedIndex ? 0 : -1}
                onKeyDown={(event) => {
                  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
                  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
                  if (!horizontal && !vertical) return;
                  event.preventDefault();
                  const delta = horizontal
                    ? event.key === "ArrowRight"
                      ? 1
                      : -1
                    : event.key === "ArrowDown"
                      ? SWATCH_COLUMNS
                      : -SWATCH_COLUMNS;
                  const next = (i + delta + SWATCHES.length) % SWATCHES.length;
                  const nextHex = SWATCHES[next];
                  const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next];
                  if (!nextHex) return;
                  if (next !== selectedIndex) {
                    markDirty();
                    onChange(nextHex);
                  }
                  target?.focus();
                }}
                onClick={() => {
                  if (!selected) markDirty();
                  onChange(hex);
                  setOpen(false);
                }}
                className={cn(
                  "size-6 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110",
                  selected && "outline outline-2 outline-offset-1 outline-brand-strong",
                )}
                style={{ backgroundColor: hex }}
              />
            );
          })}
        </PopoverContent>
      </Popover>
    </Field>
  );
}

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

// Picker order: Monday-first, Sunday last. Labels resolve through Paraglide at render so they
// localise and follow a locale switch without a reload. Kept separate from the model order so the
// order isn't re-stated per locale.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

type WorkingDayOption = "full" | "half" | "off";

function workingDayOptions(): Array<{ value: WorkingDayOption; label: string }> {
  return [
    { value: "full", label: m.form_resource_working_day_full() },
    { value: "half", label: m.form_resource_working_day_half() },
    { value: "off", label: m.form_resource_working_day_off() },
  ];
}

export function WorkingDayPicker({
  label,
  workingDays,
  halfDays,
  onChange,
  invalid,
  describedById,
}: {
  label: string;
  workingDays: Weekday[];
  halfDays: Weekday[];
  onChange: (workingDays: Weekday[], halfDays: Weekday[]) => void;
  // Mirror the sibling fields (TextField/SelectField/NumberField): mark the GROUP errored so the
  // required-error (no day selected) re-announces when a SR navigates to the fieldset (WCAG 3.3.1).
  invalid?: boolean;
  describedById?: string;
}) {
  const markDirty = useMarkFormDirty();
  const groupId = useId();
  const options = workingDayOptions();
  const optionFor = (day: Weekday): WorkingDayOption =>
    !workingDays.includes(day) ? "off" : halfDays.includes(day) ? "half" : "full";
  const choose = (day: Weekday, option: WorkingDayOption) => {
    const nextWorkingDays =
      option === "off"
        ? workingDays.filter((candidate) => candidate !== day)
        : [...new Set([...workingDays, day])].sort((a, b) => a - b);
    const nextHalfDays =
      option === "half"
        ? [...new Set([...halfDays, day])]
            .filter((candidate) => nextWorkingDays.includes(candidate))
            .sort((a, b) => a - b)
        : halfDays.filter((candidate) => candidate !== day);
    markDirty();
    onChange(nextWorkingDays, nextHalfDays);
  };

  return (
    <FieldSet
      className="min-w-0"
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? describedById : undefined}
    >
      <FieldLegend variant="label">{label}</FieldLegend>
      <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className="sr-only">
                {m.form_resource_working_day_weekday()}
              </th>
              {options.map((option) => (
                <th
                  key={option.value}
                  id={`${groupId}-${option.value}-heading`}
                  scope="col"
                  className="min-w-24 whitespace-nowrap px-3 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {option.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_ORDER.map((day) => {
              const dayLabel = weekdayLabel(day);
              const rowHeadingId = `${groupId}-${day}-heading`;
              return (
                <tr key={day} className="border-b last:border-b-0">
                  <th
                    id={rowHeadingId}
                    scope="row"
                    className="min-w-24 whitespace-nowrap px-3 py-2 text-left font-medium"
                  >
                    {dayLabel}
                  </th>
                  {options.map((option) => {
                    const radioId = `${groupId}-${day}-${option.value}`;
                    return (
                      <td key={option.value} className="px-3 py-1 text-center">
                        <Label htmlFor={radioId} className="flex min-h-8 cursor-pointer justify-center">
                          <input
                            id={radioId}
                            type="radio"
                            name={`${groupId}-${day}`}
                            value={option.value}
                            checked={optionFor(day) === option.value}
                            aria-labelledby={`${rowHeadingId} ${groupId}-${option.value}-heading`}
                            data-form-dirty-managed
                            className="size-4 cursor-pointer"
                            onChange={() => choose(day, option.value)}
                          />
                        </Label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FieldSet>
  );
}
