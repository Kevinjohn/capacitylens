import { describe, it, expect } from 'vitest'
import { laneTop, packLanes, rowHeightForLanes, type Interval } from './lanePacking'

const iv = (id: string, startDate: string, endDate: string): Interval => ({ id, startDate, endDate })

function laneOf(result: ReturnType<typeof packLanes>, id: string): number {
  return result.lanes.find((l) => l.id === id)!.lane
}

describe('packLanes', () => {
  it('returns no lanes for an empty list', () => {
    expect(packLanes([])).toEqual({ lanes: [], laneCount: 0 })
  })

  it('puts a single item in lane 0', () => {
    const r = packLanes([iv('a', '2026-05-01', '2026-05-05')])
    expect(r.laneCount).toBe(1)
    expect(laneOf(r, 'a')).toBe(0)
  })

  it('reuses lane 0 for non-overlapping items with a gap', () => {
    const r = packLanes([iv('a', '2026-05-01', '2026-05-03'), iv('b', '2026-05-05', '2026-05-08')])
    expect(r.laneCount).toBe(1)
    expect(laneOf(r, 'a')).toBe(0)
    expect(laneOf(r, 'b')).toBe(0)
  })

  it('treats touching inclusive ends as overlapping (separate lanes)', () => {
    // a ends 05-03, b starts 05-03 -> they share day 05-03 -> must not share a lane
    const r = packLanes([iv('a', '2026-05-01', '2026-05-03'), iv('b', '2026-05-03', '2026-05-05')])
    expect(r.laneCount).toBe(2)
    expect(laneOf(r, 'a')).toBe(0)
    expect(laneOf(r, 'b')).toBe(1)
  })

  it('reuses a lane when the next item starts the day after (no overlap)', () => {
    const r = packLanes([iv('a', '2026-05-01', '2026-05-03'), iv('b', '2026-05-04', '2026-05-06')])
    expect(r.laneCount).toBe(1)
  })

  it('stacks three mutually-overlapping items into three lanes', () => {
    const r = packLanes([
      iv('a', '2026-05-01', '2026-05-10'),
      iv('b', '2026-05-02', '2026-05-11'),
      iv('c', '2026-05-03', '2026-05-12'),
    ])
    expect(r.laneCount).toBe(3)
    expect(new Set([laneOf(r, 'a'), laneOf(r, 'b'), laneOf(r, 'c')])).toEqual(new Set([0, 1, 2]))
  })

  it('packs a staircase back down to 2 lanes', () => {
    // a[1-5], b[2-6] overlap (2 lanes). c[6-9] starts after a ends -> reuses lane 0.
    const r = packLanes([
      iv('a', '2026-05-01', '2026-05-05'),
      iv('b', '2026-05-02', '2026-05-06'),
      iv('c', '2026-05-06', '2026-05-09'),
    ])
    expect(r.laneCount).toBe(2)
    expect(laneOf(r, 'a')).toBe(0)
    expect(laneOf(r, 'b')).toBe(1)
    expect(laneOf(r, 'c')).toBe(0)
  })
})

describe('row geometry', () => {
  const layout = { barHeight: 24, laneGap: 4, rowPadding: 6 }

  it('rowHeightForLanes is at least one lane tall', () => {
    expect(rowHeightForLanes(0, layout)).toBe(24 + 12)
    expect(rowHeightForLanes(1, layout)).toBe(24 + 12)
    expect(rowHeightForLanes(2, layout)).toBe(48 + 4 + 12)
  })

  it('laneTop offsets each lane by bar height + gap', () => {
    expect(laneTop(0, layout)).toBe(6)
    expect(laneTop(1, layout)).toBe(6 + 28)
    expect(laneTop(2, layout)).toBe(6 + 56)
  })
})
