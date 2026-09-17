import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TogglePillProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  /** Optional swatch rendered before the label, such as the tentative hatch. */
  swatch?: ReactNode;
  className?: string;
}

/**
 * A single on/off pill for a boolean choice, replacing the "Show X / Hide X" segmented pairs.
 * Selection is carried by the brand-soft fill and its paired ink; the resting state is a plain
 * surface pill with muted text, so an off pill never reads as a second selected option.
 */
export function TogglePill({ pressed, onPressedChange, children, swatch, className }: TogglePillProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-line px-[11px] py-[7px] text-[12.5px] font-medium leading-4 whitespace-nowrap transition-colors outline-none",
        "hover:border-faint focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        pressed ? "bg-brand-soft text-brand-soft-ink" : "bg-surface text-muted-foreground",
        className,
      )}
    >
      {swatch}
      {children}
    </button>
  );
}
