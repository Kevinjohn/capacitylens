import { m } from "@/i18n";
import { useStore } from "@/store/useStore";
import { Input } from "@/components/ui/input";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";

/** A native date picker that reanchors the schedule only after a valid date is selected. */
export function JumpToDateInput() {
  const goToDate = useStore((state) => state.goToDate);
  const focusDate = useStore((state) => state.ui.focusDate);

  return (
    <Input
      type="date"
      value={focusDate}
      // A partial/malformed value (browsers emit these mid-edit, and a programmatic write can be
      // anything) must not reach the store: goToDate re-anchors the whole grid off it.
      onChange={(e) => isValidISODate(e.target.value) && goToDate(e.target.value)}
      aria-label={m.scheduler_jump_to_date()}
      title={m.scheduler_jump_to_date()}
      className="w-auto"
    />
  );
}
