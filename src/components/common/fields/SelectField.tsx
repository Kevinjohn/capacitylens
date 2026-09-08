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
import { buildProductFieldLayoutProps } from "./buildProductFieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

// Radix reserves the empty string for its placeholder state. Encode every caller value into a
// separate non-empty domain instead of reserving one otherwise-legal string as a sentinel.
const SELECT_VALUE_PREFIX = "__capacitylens_option__:";
const encodeSelectValue = (value: string): string => `${SELECT_VALUE_PREFIX}${value}`;
const decodeSelectValue = (value: string): string => value.slice(SELECT_VALUE_PREFIX.length);

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
};

type OptionGroup = { key?: string; label?: string; options: Option[] };

function buildOptionGroups(options: Option[]): OptionGroup[] {
  return options.reduce<OptionGroup[]>((groups, option) => {
    const previous = groups.at(-1);
    const key = option.groupKey ?? option.groupLabel;
    if (previous && previous.key === key) previous.options.push(option);
    else
      groups.push({
        ...(key ? { key } : {}),
        ...(option.groupLabel ? { label: option.groupLabel } : {}),
        options: [option],
      });
    return groups;
  }, []);
}

function SelectFieldOptions({ optionGroups }: { optionGroups: OptionGroup[] }) {
  return optionGroups.map((group, index) => (
    <SelectGroup key={`${group.key ?? "ungrouped"}-${index}`}>
      {group.label && <SelectLabel>{group.label}</SelectLabel>}
      {group.options.map((option) => (
        <Fragment key={option.value}>
          {option.separatorBefore && <SelectSeparator />}
          <SelectItem
            value={encodeSelectValue(option.value)}
            data-value={option.value}
            {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
          >
            {option.label}
          </SelectItem>
        </Fragment>
      ))}
    </SelectGroup>
  ));
}

function trueOrUndefined(value: boolean | undefined): true | undefined {
  return value ? true : undefined;
}

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
}: SelectFieldProps) {
  const id = useId();
  const markDirty = useMarkFormDirty();
  const selectedOption = options.find((option) => option.value === value);
  const unresolvedValue = value !== "" && selectedOption === undefined;
  const optionGroups = buildOptionGroups(options);
  return (
    <Field
      data-invalid={trueOrUndefined(invalid)}
      data-disabled={trueOrUndefined(disabled)}
      {...buildProductFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel htmlFor={id} label={label} {...(required !== undefined ? { required } : {})} />
      <Select
        value={selectedOption || unresolvedValue ? encodeSelectValue(value) : ""}
        {...(disabled !== undefined ? { disabled } : {})}
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
          aria-required={trueOrUndefined(required)}
          aria-invalid={trueOrUndefined(invalid)}
          aria-describedby={invalid ? describedById : undefined}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder}>{selectedOption?.label ?? placeholder ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectFieldOptions optionGroups={optionGroups} />
        </SelectContent>
      </Select>
    </Field>
  );
}
