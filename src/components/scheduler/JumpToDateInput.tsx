import { m } from "@/i18n";
import { useStore } from "../../store/useStore";
import { Input } from "../ui/input";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";

/**
 * The schedule toolbar's jump-to-date picker (native `<input type="date">`).
 *
 * Not currently rendered: the toolbar gates it behind `SHOW_JUMP_TO_DATE` in
 * `ToolbarDateNavigation.tsx`. It is kept live and covered by its own tests — see DECISIONS.md.
 */
export function JumpToDateInput() {
  const goToDate = useStore((s) => s.goToDate);
  const focusDate = useStore((s) => s.ui.focusDate);

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
