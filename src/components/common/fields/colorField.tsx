import { useState } from "react";
import { SWATCHES, SWATCH_COLUMNS, swatchLabel, colorName, swatchIndexOf } from "../../../lib/palette";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { Field, FieldLabel } from "../../ui/field";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/i18n";
import { useMarkFormDirty } from "../formDirty";
import { productFieldLayoutProps } from "./fieldLayoutProps";
import type { ProductFieldLayout } from "./fieldTypes";

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
