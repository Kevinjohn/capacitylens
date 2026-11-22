import { m } from '@/i18n';
import { formatUtilisationPercent } from '@/lib/formatUtilisationPercent';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { RowModel } from './schedulerModel';
import type { DrawMode } from '@/store/useStore';

/** View preferences and the visible window label used by the row's accessible summary. */
export interface RowSummaryContext {
  /** The per-person utilisation view pref, the same setting the visible figure uses. */
  showPersonalUtilisation: boolean;
  /** Long form of the visible span ("4 weeks"), so the % says what it was measured over. */
  visibleSpanLabel: string;
  drawMode: DrawMode;
}

/** Builds the text equivalent of materialized row capacity cues, plus optional personal utilisation for the visible window. Conflict and half-day counters follow the row model's timeline; the utilisation label states its own window. */
export function buildRowScreenReaderSummary(row: RowModel, context: RowSummaryContext): string {
  const parts: string[] = [];
  if (row.overSoon) parts.push(m.scheduler_sr_overbooked_two_weeks());
  if (row.conflictDayCount) {
    const count = row.conflictDayCount;
    parts.push(
      count > 1
        ? m.scheduler_sr_over_capacity_other({ count })
        : m.scheduler_sr_over_capacity_one({ count }),
    );
  }
  if (row.partialCapacityDayCount) {
    const count = row.partialCapacityDayCount;
    parts.push(
      count > 1 ? m.scheduler_sr_half_day_other({ count }) : m.scheduler_sr_half_day_one({ count }),
    );
  }
  if (row.timeOff.length) {
    const count = row.timeOff.length;
    parts.push(
      count > 1 ? m.scheduler_sr_time_off_other({ count }) : m.scheduler_sr_time_off_one({ count }),
    );
  }
  if (context.showPersonalUtilisation && isCapacityTracked(row.resource)) {
    parts.push(
      m.scheduler_sr_utilisation({
        percent: formatUtilisationPercent(row.utilisation),
        span: context.visibleSpanLabel,
      }),
    );
  }
  // Time-off draw mode is about absences, not bookings: an allocation count would be noise there.
  if (context.drawMode !== 'timeOff') {
    const count = row.bars.length;
    parts.push(
      count === 1
        ? m.scheduler_sr_allocations_one({ count })
        : m.scheduler_sr_allocations_other({ count }),
    );
  }
  return parts.join('');
}
