import { Fragment, useId } from "react";
import { Field } from "../../ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { useMarkFormDirty } from "../formDirty";
import { RequiredFieldLabel } from "./fieldLayout";
import type { Option } from "./fieldTypes";
import { productFieldLayoutProps } from "./fieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

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
