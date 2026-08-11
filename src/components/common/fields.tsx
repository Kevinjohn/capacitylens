import { useId, useState } from "react";
import { MAX_NAME_INPUT_CODE_UNITS, MAX_NOTE_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { SWATCHES, SWATCH_COLUMNS, swatchLabel, colorName } from "../../lib/palette";
// Control styling lives in ./controls (a non-component module) so its style OBJECT can
// be exported without tripping react-refresh/only-export-components on this file.
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/i18n";
import type { Weekday } from "@capacitylens/shared/types/entities";
import { useMarkFormDirty } from "./formDirty";

// Product field APIs composed from ShadCN's Field family.
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
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const markDirty = useMarkFormDirty();
  const descriptionId = useId();
  const controlId = useId();
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
        {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      </FieldContent>
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
    </Field>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
}) {
  const id = useId();
  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
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
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  invalid,
  describedById,
  maxLength = MAX_NOTE_INPUT_CODE_UNITS,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedById?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={2}
        value={value}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
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
  describedById,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
}) {
  const id = useId();
  return (
    <Field data-invalid={invalid || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  required?: boolean;
  describedById?: string;
}) {
  const id = useId();
  return (
    <Field data-invalid={invalid || undefined}>
      <RequiredFieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="date"
        value={value}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedById : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export interface Option {
  value: string;
  label: string;
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
}) {
  const id = useId();
  const markDirty = useMarkFormDirty();
  const selectedOption = options.find((option) => option.value === value);
  const unresolvedValue = value !== "" && selectedOption === undefined;
  return (
    <Field data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
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
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={encodeSelectValue(o.value)} data-value={o.value} disabled={o.disabled}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedById?: string;
}) {
  const markDirty = useMarkFormDirty();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    SWATCHES.findIndex((hex) => hex.toLowerCase() === value.toLowerCase()),
  );

  return (
    <Field data-invalid={invalid || undefined}>
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

// Picker order: Monday-first, Sunday last. Labels resolve through Paraglide at render so they
// localise and follow a locale switch without a reload. Kept separate from the model order so the
// order isn't re-stated per locale.
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** The localised full label for a weekday (Sun=0 … Sat=6). Exhaustive over Weekday. */
function weekdayLabel(day: Weekday): string {
  switch (day) {
    case 1:
      return m.weekday_long_mon();
    case 2:
      return m.weekday_long_tue();
    case 3:
      return m.weekday_long_wed();
    case 4:
      return m.weekday_long_thu();
    case 5:
      return m.weekday_long_fri();
    case 6:
      return m.weekday_long_sat();
    case 0:
      return m.weekday_long_sun();
  }
}

type WorkingDayOption = "full" | "half" | "off";

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
    <FieldSet aria-invalid={invalid || undefined} aria-describedby={invalid ? describedById : undefined}>
      <FieldLegend variant="label">{label}</FieldLegend>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="sr-only">
            <tr>
              <th scope="col">{m.form_resource_working_day_weekday()}</th>
              <th scope="col">{m.form_resource_working_day_availability()}</th>
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_ORDER.map((day) => {
              const rowId = `${groupId}-${day}`;
              return (
                <tr key={day} className="border-b last:border-b-0">
                  <th id={rowId} scope="row" className="px-3 py-2 text-left font-medium">
                    {weekdayLabel(day)}
                  </th>
                  <td className="px-2 py-1.5">
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={optionFor(day)}
                      aria-labelledby={rowId}
                      onValueChange={(next) => {
                        if (next) choose(day, next as WorkingDayOption);
                      }}
                    >
                      <ToggleGroupItem value="full">{m.form_resource_working_day_full()}</ToggleGroupItem>
                      <ToggleGroupItem value="half">{m.form_resource_working_day_half()}</ToggleGroupItem>
                      <ToggleGroupItem value="off">{m.form_resource_working_day_off()}</ToggleGroupItem>
                    </ToggleGroup>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FieldSet>
  );
}
