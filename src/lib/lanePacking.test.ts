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

  it('an empty-date record does not poison packing for the valid items', () => {
    // A bad/empty record sorts first; it must not become the origin and NaN-out
    // every other item's day-index. Valid items still pack correctly.
    const r = packLanes([
      iv('bad', '', ''),
      iv('a', '2026-05-01', '2026-05-03'),
      iv('b', '2026-05-05', '2026-05-08'),
    ])
    expect(laneOf(r, 'a')).toBe(0)
    expect(laneOf(r, 'b')).toBe(0) // a and b don't overlap -> share a lane
    expect(laneOf(r, 'bad')).toBe(0) // unpositionable -> parked in lane 0
    // If the origin picked up the bad record's empty startDate instead of the first valid
    // one, every dayIndex would come back NaN and a/b would also be parked without ever
    // touching laneEnds, dropping laneCount to 0.
    expect(r.laneCount).toBe(1)
  })

  it('does not crash when every record has an empty startDate (origin fallback)', () => {
    const r = packLanes([iv('a', '', ''), iv('b', '', '')])
    expect(r.lanes).toHaveLength(2)
    expect(laneOf(r, 'a')).toBe(0)
    expect(laneOf(r, 'b')).toBe(0)
    expect(r.laneCount).toBe(0) // both unpositionable -> laneEnds never touched
  })

  it('sorts unsorted input by startDate before packing (not insertion order)', () => {
    // p/q/r overlap in a staircase; fed in scrambled order. If the array weren't actually
    // sorted ascending by startDate first, the greedy packer would produce a different
    // lane layout (and a different lane count) than processing them p, q, r in order.
    const p = iv('p', '2026-05-01', '2026-05-05')
    const q = iv('q', '2026-05-03', '2026-05-08')
    const r = iv('r', '2026-05-06', '2026-05-10')
    const result = packLanes([r, q, p])
    expect(laneOf(result, 'p')).toBe(0)
    expect(laneOf(result, 'q')).toBe(1)
    expect(laneOf(result, 'r')).toBe(0)
    expect(result.laneCount).toBe(2)
  })

  it('breaks a startDate tie by endDate ascending', () => {
    // a and b share a startDate; b's shorter endDate must sort first. c only overlaps
    // whichever of a/b is processed second, so the resulting lanes pin down the order.
    const a = iv('a', '2026-05-01', '2026-05-10') // long
    const b = iv('b', '2026-05-01', '2026-05-03') // short, same start
    const c = iv('c', '2026-05-04', '2026-05-12')
    const result = packLanes([a, b, c])
    // Correct order: b (end 05-03) first -> lane 0, a (end 05-10) second -> lane 1
    // (overlaps b's old lane end), c third -> reuses lane 0 (free once b ended).
    expect(laneOf(result, 'b')).toBe(0)
    expect(laneOf(result, 'a')).toBe(1)
    expect(laneOf(result, 'c')).toBe(0)
    expect(result.laneCount).toBe(2)
  })

  it('breaks a startDate+endDate tie by id ascending', () => {
    // All three share identical start/end, so they must all overlap and each need a
    // distinct lane, ordered by id ascending regardless of input order.
    const items = [iv('z', '2026-05-01', '2026-05-05'), iv('x', '2026-05-01', '2026-05-05'), iv('y', '2026-05-01', '2026-05-05')]
    const result = packLanes(items)
    expect(laneOf(result, 'x')).toBe(0)
    expect(laneOf(result, 'y')).toBe(1)
    expect(laneOf(result, 'z')).toBe(2)
    expect(result.laneCount).toBe(3)
  })

  it('parks a record with an unparseable endDate without corrupting laneEnds', () => {
    // Only the end is invalid (start is fine), so `s` is finite and `e` is not — this
    // distinguishes the `||` from a mutated `&&` in the unpositionable check.
    const r = packLanes([iv('a', '2026-05-01', '')])
    expect(laneOf(r, 'a')).toBe(0)
    expect(r.laneCount).toBe(0) // never reached laneEnds.push
  })

  it('updates laneEnds when reusing a lane, so a later item sees the new end', () => {
    const a = iv('a', '2026-05-01', '2026-05-03')
    const b = iv('b', '2026-05-05', '2026-05-10') // reuses a's lane (no overlap)
    const c = iv('c', '2026-05-06', '2026-05-12') // overlaps b, must NOT reuse that lane
    const result = packLanes([a, b, c])
    expect(laneOf(result, 'a')).toBe(0)
    expect(laneOf(result, 'b')).toBe(0)
    expect(laneOf(result, 'c')).toBe(1)
    expect(result.laneCount).toBe(2)
  })

  it('returns exactly one lane entry per input item (no phantom entries)', () => {
    const items = [iv('a', '2026-05-01', '2026-05-03'), iv('b', '2026-05-05', '2026-05-08')]
    const result = packLanes(items)
    expect(result.lanes).toHaveLength(items.length)
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
