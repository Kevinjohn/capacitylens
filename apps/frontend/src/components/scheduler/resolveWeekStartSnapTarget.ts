import { startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { resolveLeftEdgeDate } from "./columnGeometry";
import type { ColumnGeometry } from "./columnGeometry";
import type { ISODate } from "@capacitylens/shared/types/entities";

// Pure week-start snapping floors free scrolling backward and converges near an existing week boundary. Use the shared rounded scroll inverse so sub-pixel browser positions cannot select the prior week.

/** Column geometry and scroll position needed to find the prior week boundary. */
export interface WeekStartSnapTargetInput {
  geom: ColumnGeometry;
  days: ISODate[];
  scrollLeft: number;
  weekStartsOn: 0 | 1;
  epsilon?: number;
}

/**
 * Purely resolves the current week's starting pixel offset from aligned dates and geometry. Empty windows and positions within epsilon return null; unreadable dates return zero. The scroll inverse rounds sub-pixel positions before resolving their day so a near-boundary position cannot snap back a whole week.
 *
 * @throws Error when a non-empty date window and geometry are misaligned.
 */
export function resolveWeekStartSnapTarget({
  geom: geometry,
  days,
  scrollLeft,
  weekStartsOn,
  epsilon = 0.5,
}: WeekStartSnapTargetInput): number | null {
  if (days.length === 0) return null;

  const leftDay = resolveLeftEdgeDate(geometry, days, scrollLeft);
  if (!isValidISODate(leftDay)) return 0;
  const target = Math.max(0, geometry.xForDateInGeom(startOfWeekISO(leftDay, weekStartsOn)));
  // Already aligned (within the sub-pixel band) → null so the caller no-ops. Math.abs, not a signed
  // compare, so a (never-expected) forward target also converges rather than oscillates.
  return Math.abs(target - scrollLeft) <= epsilon ? null : target;
}
