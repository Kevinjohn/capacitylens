import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterOption } from "./toolbarFilterOptions";

/** Selects a nullable entity filter through the application's all sentinel. Resolve supplied label functions during render so account locale changes update the options. */
export function FilterSelect({
  value,
  onValueChange,
  ariaLabel,
  allLabel,
  options,
}: {
  value: string | null;
  onValueChange: (value: string | null) => void;
  ariaLabel: () => string;
  allLabel: () => string;
  options: FilterOption[];
}) {
  return (
    <Select value={value ?? "all"} onValueChange={(selected) => onValueChange(selected === "all" ? null : selected)}>
      <SelectTrigger size="sm" aria-label={ariaLabel()} className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">{allLabel()}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id} className={option.contextLabel ? "group" : undefined}>
              {option.contextLabel && option.primaryLabel ? (
                <>
                  <span
                    data-slot="project-option-client"
                    className="text-muted-foreground group-focus:text-accent-foreground/70"
                  >
                    {option.contextLabel}
                  </span>{" "}
                  <span data-slot="project-option-name" className="text-current">
                    {option.primaryLabel}
                  </span>
                </>
              ) : (
                option.label
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
