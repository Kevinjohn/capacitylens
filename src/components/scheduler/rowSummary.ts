import { m } from "@/i18n";
import { formatUtilizationPercent } from "../../lib/utilizationPercent";
import { isCapacityTracked } from "@capacitylens/shared/types/entities";
import type { RowModel } from "./schedulerModel";
import type { DrawMode } from "../../store/useStore";

/** What the row's screen-reader summary needs beyond the row itself: the two view prefs and the
 *  label for the window the utilisation % was measured over. */
export interface RowSummaryContext {
  /** The per-person utilisation view pref — the same gate the visible figure uses. */
  showPersonalUtilization: boolean;
  /** Long form of the visible span ("4 weeks"), so the % says what it was measured over. */
  visibleSpanLabel: string;
  drawMode: DrawMode;
}

/** Text equivalent of the row's colour-only capacity cues, assembled in one place so the wording
 *  can be asserted without rendering the grid.
 *
 *  The per-day red marker is otherwise colour/shape-only and unannounced (WCAG 1.1.1/1.3.1), so
 *  both hourly over-capacity days and explicit block/time-off conflicts are counted here — the
 *  non-colour pair to the red background. The half-day count likewise names the neutral
 *  partial-capacity treatment without relying on colour. The visible utilisation % conveys its
 *  meaning only via a `title` on a non-interactive span, which AT may not expose, so it is folded
 *  in too (WCAG 1.3.1) — the per-PERSON signal, kept distinct from the conflict count above and
 *  from `overSoon`. */
export function rowScreenReaderSummary(row: RowModel, ctx: RowSummaryContext): string {
  const parts: string[] = [];
  if (row.overSoon) parts.push(m.scheduler_sr_overbooked_two_weeks());
  if (row.conflictDayCount) {
    const count = row.conflictDayCount;
    parts.push(count > 1 ? m.scheduler_sr_over_capacity_other({ count }) : m.scheduler_sr_over_capacity_one({ count }));
  }
  if (row.partialCapacityDayCount) {
    const count = row.partialCapacityDayCount;
    parts.push(count > 1 ? m.scheduler_sr_half_day_other({ count }) : m.scheduler_sr_half_day_one({ count }));
  }
  if (row.timeOff.length) {
    const count = row.timeOff.length;
    parts.push(count > 1 ? m.scheduler_sr_timeoff_other({ count }) : m.scheduler_sr_timeoff_one({ count }));
  }
  if (ctx.showPersonalUtilization && isCapacityTracked(row.resource)) {
    parts.push(
      m.scheduler_sr_utilisation({ percent: formatUtilizationPercent(row.utilization), span: ctx.visibleSpanLabel }),
    );
  }
  // Time-off draw mode is about absences, not bookings: an allocation count would be noise there.
  if (ctx.drawMode !== "timeoff") {
    const count = row.bars.length;
    parts.push(count === 1 ? m.scheduler_sr_allocations_one({ count }) : m.scheduler_sr_allocations_other({ count }));
  }
  return parts.join("");
}
