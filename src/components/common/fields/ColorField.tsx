import { useState, type KeyboardEvent } from "react";
import {
  SWATCHES,
  SWATCH_COLUMNS,
  resolveSwatchLabel,
  resolveColorName,
  resolveSwatchIndex,
} from "../../../lib/palette";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { Field, FieldLabel } from "../../ui/field";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/i18n";
import { useMarkFormDirty } from "../formDirty";
import { buildProductFieldLayoutProps } from "./buildProductFieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedById?: string;
  layout?: ProductFieldLayout;
};

type SwatchGridProps = {
  label: string;
  value: string;
  selectedIndex: number;
  markDirty: () => void;
  onChange: (value: string) => void;
  onClose: () => void;
};

type ColorTriggerProps = Pick<ColorFieldProps, "label" | "value"> & {
  invalid: boolean | undefined;
  describedById: string | undefined;
};

function resolveSwatchDelta(key: string): number | null {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowDown") return SWATCH_COLUMNS;
  if (key === "ArrowUp") return -SWATCH_COLUMNS;
  return null;
}

function ColorTrigger({ label, value, invalid, describedById }: ColorTriggerProps) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        aria-label={m.swatch_trigger_label({ label, color: resolveColorName(value) })}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? describedById : undefined}
        className="w-full justify-between"
      >
        <span className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/10" style={{ backgroundColor: value }} />
      </Button>
    </PopoverTrigger>
  );
}

function SwatchGrid({ label, value, selectedIndex, markDirty, onChange, onClose }: SwatchGridProps) {
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
        />
      ))}
    </PopoverContent>
  );
}

type SwatchButtonProps = Omit<SwatchGridProps, "label" | "value"> & {
  hex: string;
  index: number;
  value: string;
};

function SwatchButton({ hex, index, value, selectedIndex, markDirty, onChange, onClose }: SwatchButtonProps) {
  const selected = hex.toLowerCase() === value.toLowerCase();

  function selectNextSwatch(event: KeyboardEvent<HTMLButtonElement>) {
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
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  function selectSwatch() {
    if (!selected) markDirty();
    onChange(hex);
    onClose();
  }

  return (
    <button
      type="button"
      role="radio"
      aria-label={resolveSwatchLabel(index)}
      data-form-dirty-managed
      aria-checked={selected}
      tabIndex={index === selectedIndex ? 0 : -1}
      onKeyDown={selectNextSwatch}
      onClick={selectSwatch}
      className={cn(
        "size-6 rounded ring-1 ring-inset ring-black/10 transition hover:scale-110",
        selected && "outline outline-2 outline-offset-1 outline-brand-strong",
      )}
      style={{ backgroundColor: hex }}
    />
  );
}

// A swatch picker, not a hex/RGB tool: a trigger showing the current colour opens a
// 13×4 grid of preset swatches (see SWATCHES). Picking one is the only way to set the
// value, so the stored colour is always a valid hex — no text/hex entry.
export function ColorField({ label, value, onChange, invalid, describedById, layout = "stacked" }: ColorFieldProps) {
  const markDirty = useMarkFormDirty();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, resolveSwatchIndex(value));

  return (
    <Field data-invalid={invalid ? true : undefined} {...buildProductFieldLayoutProps(layout)}>
      <FieldLabel>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <ColorTrigger label={label} value={value} invalid={invalid} describedById={describedById} />
        <SwatchGrid
          label={label}
          value={value}
          selectedIndex={selectedIndex}
          markDirty={markDirty}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </Field>
  );
}
