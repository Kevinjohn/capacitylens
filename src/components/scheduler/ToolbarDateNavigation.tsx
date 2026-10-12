import { ChevronLeft, ChevronRight } from "lucide-react";
import { m } from "@/i18n";
import { ZOOM_LEVELS } from "@/lib/schedulerConfig";
import type { WeeksZoom } from "@/lib/schedulerConfig";
import { JumpToDateInput } from "./JumpToDateInput";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The toolbar deliberately hides jump-to-date so its existing date controls retain space.
const SHOW_JUMP_TO_DATE: boolean = false;

const buildZoomLabel = (weeks: number) =>
  weeks > 1 ? m.scheduler_weeks_option_other({ count: weeks }) : m.scheduler_weeks_option_one({ count: weeks });

/** Zoom and date navigation callbacks for the schedule toolbar. */
export interface ToolbarDateNavigationProps {
  zoom: WeeksZoom;
  onZoomChange: (zoom: WeeksZoom) => void;
  onPanDays: (days: number) => void;
  onToday: () => void;
}

/** Lets users move the visible window, change zoom, or return to today. */
export function ToolbarDateNavigation({ zoom, onZoomChange, onPanDays, onToday }: ToolbarDateNavigationProps) {
  return (
    <>
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
      {/* The accessible zoom name includes the visible span so speech input can target the words shown on screen. */}
      <Select value={String(zoom)} onValueChange={(value) => onZoomChange(Number(value) as WeeksZoom)}>
        <SelectTrigger
          size="sm"
          aria-label={m.scheduler_weeks_visible_aria({ span: buildZoomLabel(zoom) })}
          className="ml-2 w-auto"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {ZOOM_LEVELS.map((w) => (
              <SelectItem key={w} value={String(w)}>
                {buildZoomLabel(w)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
