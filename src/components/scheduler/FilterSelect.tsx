import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { FilterOption } from "./toolbarFilterOptions";

/**
 * One "filter by <entity>" dropdown. The discipline / client / project lenses are the same control
 * three times over — a flat list with an "All …" row on top — differing only in their label, their
 * accessible name and their options, so they share this rather than repeating the Select scaffold.
 *
 * It also owns the ONE mapping the three had to get right independently: the store's `null` ("no
 * filter") against Radix's `"all"` sentinel, in both directions. The grouped activity lens is
 * deliberately NOT folded in — its encoded `kind:` values and section headers are a different
 * control that happens to look similar.
 *
 * `ariaLabel`/`allLabel` are UNCALLED message functions, invoked during render. A caller passing
 * `m.x()` instead would resolve the string once, at module scope, and never follow a locale change.
 */
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
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
