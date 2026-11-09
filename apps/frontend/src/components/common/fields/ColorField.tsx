import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  SWATCHES,
  SWATCH_COLUMNS,
  resolveSwatchLabel,
  resolveColorName,
  resolveSwatchIndex,
} from '@/lib/palette';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Field, FieldLabel } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { m } from '@/i18n';
import { useMarkFormDirty } from '@/components/common/formDirty';
import { buildProductFieldLayoutProps } from './buildProductFieldLayoutProps';
import type { ProductFieldLayout } from './fieldTypes';

type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedById?: string;
  disabled?: boolean;
  layout?: ProductFieldLayout;
};

type SwatchGridProps = {
  label: string;
  value: string;
  selectedIndex: number;
  markDirty: () => void;
  onChange: (value: string) => void;
  onClose: () => void;
  disabled: boolean;
};

type ColorTriggerProps = Pick<ColorFieldProps, 'label' | 'value'> & {
  invalid: boolean | undefined;
  describedById: string | undefined;
  disabled: boolean;
};

function resolveSwatchDelta(key: string): number | null {
  if (key === 'ArrowRight') return 1;
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowDown') return SWATCH_COLUMNS;
  if (key === 'ArrowUp') return -SWATCH_COLUMNS;
  return null;
}

function ColorTrigger({ label, value, invalid, describedById, disabled }: ColorTriggerProps) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        disabled={disabled}
        variant="outline"
        aria-label={m.swatch_trigger_label({ label, color: resolveColorName(value) })}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? describedById : undefined}
        className="w-full justify-between"
      >
        <span
          className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: value }}
        />
      </Button>
    </PopoverTrigger>
  );
}

function SwatchGrid({
  label,
  value,
  selectedIndex,
  markDirty,
  onChange,
  onClose,
  disabled,
}: SwatchGridProps) {
  return (
    <PopoverContent
      role="radiogroup"
      aria-label={m.swatch_group_label({ label })}
      side="top"
      align="start"
      className="grid w-max gap-1.5 p-2"
      style={{ gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))` }}
    >
      {SWATCHES.map((hex, index) => (
        <SwatchButton
          key={hex}
          hex={hex}
          index={index}
          value={value}
          selectedIndex={selectedIndex}
          markDirty={markDirty}
          onChange={onChange}
          onClose={onClose}
          disabled={disabled}
        />
      ))}
    </PopoverContent>
  );
}

type SwatchButtonProps = Omit<SwatchGridProps, 'label' | 'value'> & {
  hex: string;
  index: number;
  value: string;
};

function SwatchButton({
  hex,
  index,
  value,
  selectedIndex,
  markDirty,
  onChange,
  onClose,
  disabled,
}: SwatchButtonProps) {
  const selected = hex.toLowerCase() === value.toLowerCase();

  function selectNextSwatch(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const delta = resolveSwatchDelta(event.key);
    if (delta === null) return;
    event.preventDefault();
    const next = (index + delta + SWATCHES.length) % SWATCHES.length;
    const nextHex = SWATCHES[next];
    if (!nextHex) return;
    if (next !== selectedIndex) {
      markDirty();
      onChange(nextHex);
    }
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }

  function selectSwatch() {
    if (disabled) return;
    if (!selected) markDirty();
    onChange(hex);
    onClose();
  }

  return (
    <button
      type="button"
      disabled={disabled}
      role="radio"
      aria-label={resolveSwatchLabel(index)}
      data-form-dirty-managed
      aria-checked={selected}
      tabIndex={index === selectedIndex ? 0 : -1}
      onKeyDown={selectNextSwatch}
      onClick={selectSwatch}
      className={cn(
        'size-6 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110',
        selected && 'outline outline-2 outline-offset-1 outline-brand-strong',
      )}
      style={{ backgroundColor: hex }}
    />
  );
}

/** Restricts colour selection to the supported swatches. */
export function ColorField({
  label,
  value,
  onChange,
  invalid,
  describedById,
  disabled = false,
  layout = 'stacked',
}: ColorFieldProps) {
  const markDirty = useMarkFormDirty();
  return (
    <Field data-invalid={invalid ? true : undefined} {...buildProductFieldLayoutProps(layout)}>
      <FieldLabel>{label}</FieldLabel>
      <ColorPopover
        key={disabled ? 'disabled' : 'enabled'}
        label={label}
        value={value}
        onChange={onChange}
        invalid={invalid}
        describedById={describedById}
        disabled={disabled}
        markDirty={markDirty}
      />
    </Field>
  );
}

function ColorPopover({
  label,
  value,
  onChange,
  invalid,
  describedById,
  disabled,
  markDirty,
}: Omit<ColorFieldProps, 'invalid' | 'describedById' | 'disabled'> & {
  invalid: boolean | undefined;
  describedById: string | undefined;
  disabled: boolean;
  markDirty: () => void;
}) {
  const [open, setOpen] = useState(false);
  const effectiveOpen = open && !disabled;
  const selectedIndex = Math.max(0, resolveSwatchIndex(value));

  return (
    <Popover
      open={effectiveOpen}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
    >
      <ColorTrigger
        label={label}
        value={value}
        invalid={invalid}
        describedById={describedById}
        disabled={disabled}
      />
      <SwatchGrid
        label={label}
        value={value}
        selectedIndex={selectedIndex}
        markDirty={markDirty}
        onChange={onChange}
        onClose={() => setOpen(false)}
        disabled={disabled}
      />
    </Popover>
  );
}
