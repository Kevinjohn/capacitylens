import { Fragment, useId, useState } from 'react';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMarkFormDirty } from '@/components/common/formDirty';
import { RequiredFieldLabel } from './fieldLayout';
import type { Option } from './fieldTypes';
import { buildProductFieldLayoutProps } from './buildProductFieldLayoutProps';
import type { ProductFieldLayout } from './fieldTypes';

// Radix reserves the empty string for its placeholder state. Encode every caller value into a
// separate non-empty domain instead of reserving one otherwise-legal string as a sentinel.
const SELECT_VALUE_PREFIX = '__capacitylens_option__:';
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
  autoFocus?: boolean;
  /** Opt-in compact row that stacks below the small viewport breakpoint. */
  layout?: ProductFieldLayout;
};

type OptionGroup = { key?: string; label?: string; options: Option[] };

function buildOptionGroups(options: Option[]): OptionGroup[] {
  return options.reduce<OptionGroup[]>((groups, option) => {
    const previous = groups.at(-1);
    const key = option.groupKey ?? option.groupLabel;
    if (previous && previous.key === key) previous.options.push(option);
    else {
      groups.push({
        ...(key ? { key } : {}),
        ...(option.groupLabel ? { label: option.groupLabel } : {}),
        options: [option],
      });
    }
    return groups;
  }, []);
}

function SelectFieldOptions({
  optionGroups,
  disabled,
}: {
  optionGroups: OptionGroup[];
  disabled: boolean;
}) {
  return optionGroups.map((group, index) => (
    <SelectGroup key={`${group.key ?? 'ungrouped'}-${index}`}>
      {group.label && <SelectLabel>{group.label}</SelectLabel>}
      {group.options.map((option) => (
        <Fragment key={option.value}>
          {option.separatorBefore && <SelectSeparator />}
          <SelectItem
            value={encodeSelectValue(option.value)}
            data-value={option.value}
            disabled={disabled || option.disabled === true}
          >
            {option.label}
          </SelectItem>
        </Fragment>
      ))}
    </SelectGroup>
  ));
}

type TrueOrUndefinedOptions = { value: boolean | undefined };
function trueOrUndefined({ value }: TrueOrUndefinedOptions): true | undefined {
  return value ? true : undefined;
}

/** Renders a labelled select with field validation and layout options. */
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
  autoFocus,
  layout = 'stacked',
}: SelectFieldProps) {
  const id = useId();
  const markDirty = useMarkFormDirty();
  const selectedOption = options.find((option) => option.value === value);
  const unresolvedValue = value !== '' && selectedOption === undefined;
  const optionGroups = buildOptionGroups(options);
  return (
    <Field
      data-invalid={trueOrUndefined({ value: invalid })}
      data-disabled={trueOrUndefined({ value: disabled })}
      {...buildProductFieldLayoutProps(layout)}
    >
      <RequiredFieldLabel
        htmlFor={id}
        label={label}
        {...(required !== undefined ? { required } : {})}
      />
      <SelectFieldControl
        key={disabled ? 'disabled' : 'enabled'}
        id={id}
        value={value}
        selectedValue={selectedOption || unresolvedValue ? encodeSelectValue(value) : ''}
        selectedLabel={selectedOption?.label ?? placeholder ?? value}
        onChange={onChange}
        markDirty={markDirty}
        optionGroups={optionGroups}
        placeholder={placeholder}
        disabled={disabled === true}
        invalid={invalid}
        required={required}
        describedById={describedById}
        ariaLabel={ariaLabel}
        testId={testId}
        autoFocus={autoFocus}
      />
    </Field>
  );
}

type SelectFieldControlProps = {
  id: string;
  value: string;
  selectedValue: string;
  selectedLabel: string | undefined;
  onChange: (value: string) => void;
  markDirty: () => void;
  optionGroups: OptionGroup[];
  placeholder: string | undefined;
  disabled: boolean;
  invalid: boolean | undefined;
  required: boolean | undefined;
  describedById: string | undefined;
  ariaLabel: string | undefined;
  testId: string | undefined;
  autoFocus: boolean | undefined;
};

function SelectFieldControl({
  id,
  value,
  selectedValue,
  selectedLabel,
  onChange,
  markDirty,
  optionGroups,
  placeholder,
  disabled,
  invalid,
  required,
  describedById,
  ariaLabel,
  testId,
  autoFocus,
}: SelectFieldControlProps) {
  const [open, setOpen] = useState(false);
  const effectiveOpen = open && !disabled;

  return (
    <Select
      value={selectedValue}
      {...(disabled ? { disabled: true } : {})}
      open={effectiveOpen}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
      onValueChange={(next) => {
        if (disabled) return;
        const resolved = decodeSelectValue(next);
        if (resolved === value) return;
        markDirty();
        onChange(resolved);
      }}
    >
      <SelectTrigger
        id={id}
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? '' : undefined}
        className="w-full"
        aria-required={trueOrUndefined({ value: required })}
        aria-invalid={trueOrUndefined({ value: invalid })}
        aria-describedby={invalid ? describedById : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectFieldOptions optionGroups={optionGroups} disabled={disabled} />
      </SelectContent>
    </Select>
  );
}
