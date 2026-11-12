import { describe, it, expect } from 'vitest';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import type { Weekday } from '@capacitylens/shared/types/entities';
import type { DragMode } from '@/lib/gestureMath';
import { makeAllocation, makeBar } from '@/test/fixtures';
import { buildColumnGeometry } from './columnGeometry';
import type { ColumnGeometry } from './columnGeometry';
import { buildGesturePreviewDates, buildGesturePreviewGeometry } from './gestureGeometry';

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];

interface PreviewInput {
  startDate: string;
  endDate: string;
  ignoreWeekends: boolean;
  mode: DragMode;
  deltaDays: number;
  previewDays: Weekday[] | undefined;
  geometry: ColumnGeometry;
}

// Runs the same date-then-pixel steps the gesture controller uses for one preview frame.
function previewPixels(input: PreviewInput): { left: number; width: number } {
  const allocation = makeAllocation({
    startDate: input.startDate,
    endDate: input.endDate,
    ignoreWeekends: input.ignoreWeekends,
  });
  const result = buildGesturePreviewDates({
    allocation,
    mode: input.mode,
    deltaDays: input.deltaDays,
    previewDays: input.previewDays,
    isReassignment: false,
  });
  if (result.kind !== 'ready') throw new Error(`Expected a ready preview, got ${result.kind}`);
  const { left, width } = buildGesturePreviewGeometry(makeBar({ allocation }), input.geometry, {
    mode: input.mode,
    deltaDays: input.deltaDays,
    deltaY: 0,
    dates: result.dates,
  });
  return { left, width };
}

describe('gesture preview geometry', () => {
  const geom = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 20, {
    minimiseWeekends: false,
    weekendWidth: 12,
  });

  it('places a calendar-day move at the snapped start and keeps its width', () => {
    expect(
      previewPixels({
        startDate: '2026-06-01',
        endDate: '2026-06-04',
        ignoreWeekends: true,
        mode: 'move',
        deltaDays: 2,
        previewDays: undefined,
        geometry: geom,
      }),
    ).toEqual({ left: 2 * 20, width: 4 * 20 });
  });

  it('applies the working week, so a weekend-aware move differs from a calendar-day move', () => {
    // Snapped geometry must honour working-calendar options so previews match committed ranges across a weekend.
    const move = {
      startDate: '2026-06-04',
      endDate: '2026-06-05',
      mode: 'move' as const,
      deltaDays: 1,
      previewDays: WEEKDAYS,
      geometry: geom,
    };
    const naive = previewPixels({ ...move, ignoreWeekends: true });
    const weekendAware = previewPixels({ ...move, ignoreWeekends: false });

    expect(naive).toEqual({ left: 4 * 20, width: 2 * 20 });
    expect(weekendAware).not.toEqual(naive);
  });

  it('keeps the preview pixel-identical to the committed range across a narrow weekend', () => {
    // Narrow-weekend geometry must measure each real column so a range crossing the weekend cannot use uniform day widths.
    const narrow = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 20, {
      minimiseWeekends: true,
      weekendWidth: 8,
    });
    const committed = {
      left: narrow.xForDateInGeom('2026-06-05'),
      width: narrow.widthForDates('2026-06-05', '2026-06-08'),
    };

    const preview = previewPixels({
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      ignoreWeekends: false,
      mode: 'resize-end',
      deltaDays: 1,
      previewDays: WEEKDAYS,
      geometry: narrow,
    });

    expect(preview).toEqual(committed);
    expect(preview.width).toBe(56);
  });
});
