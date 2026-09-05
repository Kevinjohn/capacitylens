import { ChevronLeft, ChevronRight } from "lucide-react";
import { m } from "@/i18n";
import { ZOOM_LEVELS, type WeeksZoom } from "../../lib/schedulerConfig";
import { JumpToDateInput } from "./JumpToDateInput";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

/**
 * The jump-to-date picker is deliberately not rendered: reaching a far-off date is rare enough that
 * it doesn't earn toolbar space, and a month list is the likelier affordance for it. {@link
 * JumpToDateInput} stays live and tested so re-surfacing it is a one-line flip — see DECISIONS.md.
 * Typed `boolean` (not the `false` literal) so the render below is a condition, not dead code.
 */
const SHOW_JUMP_TO_DATE: boolean = false;

/** A visible span in words — "1 week" / "4 weeks". Shared by the dropdown's options and its
 *  accessible name so the two can't drift apart. */
const zoomLabel = (weeks: number) =>
  weeks > 1 ? m.scheduler_weeks_option_other({ count: weeks }) : m.scheduler_weeks_option_one({ count: weeks });

export interface ToolbarDateNavigationProps {
  zoom: WeeksZoom;
  onZoomChange: (zoom: WeeksZoom) => void;
  onPanDays: (days: number) => void;
  onToday: () => void;
}

export function ToolbarDateNavigation({ zoom, onZoomChange, onPanDays, onToday }: ToolbarDateNavigationProps) {
  return (
    <>
      {/* Prev/Next are icon-only: the chevrons carry the meaning. There is no visible text to
          contradict it, so aria-label alone names them "Prev"/"Next". */}
      <Button
        size="icon-sm"
        variant="outline"
        onClick={() => onPanDays(-7)}
        aria-label={m.scheduler_nav_prev()}
        title={m.scheduler_nav_prev_title()}
      >
        <ChevronLeft />
      </Button>
      <Button size="sm" variant="outline" onClick={onToday}>
        {m.scheduler_nav_today()}
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        onClick={() => onPanDays(7)}
        aria-label={m.scheduler_nav_next()}
        title={m.scheduler_nav_next_title()}
      >
        <ChevronRight />
      </Button>
      {SHOW_JUMP_TO_DATE && <JumpToDateInput />}
      {/* Weeks visible. The trigger shows only the span ("4 weeks"), so the accessible name adds
          the purpose AND repeats that visible text — "Weeks visible, 4 weeks". A bare
          "Weeks visible" label would hide the words the user can see from speech input
          (WCAG 2.5.3 Label in Name). */}
      <Select value={String(zoom)} onValueChange={(value) => onZoomChange(Number(value) as WeeksZoom)}>
        <SelectTrigger
          size="sm"
          aria-label={m.scheduler_weeks_visible_aria({ span: zoomLabel(zoom) })}
          className="ml-2 w-auto"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {ZOOM_LEVELS.map((w) => (
              <SelectItem key={w} value={String(w)}>
                {zoomLabel(w)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
