import { describe, it, expect } from 'vitest'
import { buildSchedulerModel, type GroupModel } from './schedulerModel'
import { buildColumnGeometry } from './columnGeometry'
import { eachDayISO, addDaysISO } from '@capacitylens/shared/lib/dateMath'
import { emptyFilters } from '../../store/useStore'
import { activeOnly } from '@capacitylens/shared/domain/lifecycle'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'

const start = '2026-06-01'
const end = '2026-06-07'
const days = eachDayISO(start, end)
// Uniform geometry (minimise off) — the bar x/width values below match the legacy
// index*dayWidth grid exactly. The narrow-weekend variant is covered in columnGeometry.test.ts.
const geom = buildColumnGeometry(days, 48, { minimiseWeekends: false, weekendWidth: 22 })

function dataset(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [
      { id: 'd-design', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 },
      { id: 'd-dev', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Development', sortOrder: 1 },
    ],
    clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#1' }],
    projects: [
      { id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#2' },
      { id: 'p2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c1', color: '#3' },
    ],
    activities: [
      { id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T1', kind: 'project', projectId: 'p1' },
      { id: 't2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T2', kind: 'project', projectId: 'p2' },
    ],
    resources: [
      { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Designer Dana', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' },
      { id: 'r2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dev Sam', role: 'Developer', disciplineId: 'd-dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#5' },
    ],
    allocations: [
      { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't2', startDate: '2026-06-03', endDate: '2026-06-04', hoursPerDay: 4, status: 'tentative' },
      { id: 'a3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r2', activityId: 't2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [],
  }
}

// Tests default placeholdersEnabled / externalEnabled = true so existing assertions (which predate
// the per-account hide prefs) keep seeing placeholder + external rows; the OFF behaviour is
// covered by dedicated blocks below.
// Default both windows to the full [start, end] week so existing assertions keep their numbers; the
// visible-window vs fixed-window split is exercised by dedicated blocks (visStart/visEnd ≠ overStart/overEnd).
const build = (filters = emptyFilters(), disciplinesEnabled = true, placeholdersEnabled = true, externalEnabled = true) =>
  buildSchedulerModel(dataset(), geom, days, start, end, start, end, filters, disciplinesEnabled, placeholdersEnabled, externalEnabled)
const allBars = (model: GroupModel[]) => model.flatMap((g) => g.rows).flatMap((r) => r.bars)
const barIds = (model: GroupModel[]) => allBars(model).map((b) => b.allocation.id).sort()

// dataset() + one external party booked on a project activity over a weekend (zero-capacity for a
// person), plus a stray time-off row — to prove externals carry NO capacity signals at all.
function withExternal(): AppData {
  const d = dataset()
  d.resources.push({ id: 'ext1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'external', name: 'Northstar Partners', role: 'Partner studio', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9ca3af' })
  // 6/05 Fri–6/07 Sun: spans 2 zero-capacity days that WOULD flag over for a person. hoursPerDay 0.
  d.allocations.push({ id: 'aext', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ext1', activityId: 't1', startDate: '2026-06-05', endDate: '2026-06-07', hoursPerDay: 0, status: 'confirmed' })
  d.timeOff.push({ id: 'toext', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ext1', startDate: '2026-06-02', endDate: '2026-06-03', type: 'holiday' })
  return d
}

describe('buildSchedulerModel', () => {
  it('groups by discipline and positions bars (no filters)', () => {
    const model = build()
    expect(model.map((g) => g.title)).toEqual(['Design', 'Development'])
    expect(barIds(model)).toEqual(['a1', 'a2', 'a3'])
    const a1 = allBars(model).find((b) => b.allocation.id === 'a1')!
    expect(a1.x).toBe(0) // origin === start
    expect(a1.width).toBe(96) // 2 inclusive days * 48
  })

  it('orders people before placeholders within a discipline (regardless of data order)', () => {
    const d = dataset()
    // A placeholder listed BEFORE a person in the same discipline — the model must
    // still surface the person first.
    d.resources = [
      { id: 'ph', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'placeholder', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9' },
      ...d.resources, // r1 (person, Design), r2 (person, Dev)
    ]
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const design = model.find((g) => g.title === 'Design')!
    expect(design.rows.map((r) => r.resource.id)).toEqual(['r1', 'ph'])
  })

  // dataset() + a placeholder in Design with an overbooking allocation, to prove the per-account
  // placeholdersEnabled flag hides the row AND drops its load from utilisation when off.
  function withPlaceholder(): AppData {
    const d = dataset()
    d.resources.push({ id: 'ph', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'placeholder', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9', projectId: 'p1' })
    // A FULLY-booked placeholder (8h across the whole Mon–Fri window → 100% util) so that, were it
    // counted, it would push Design's discipline average ABOVE the person-only figure. This makes
    // "OFF excludes it from per-discipline utilisation" a directional assertion, not a coincidence.
    d.allocations.push({ id: 'a-ph', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ph', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' })
    return d
  }

  it('placeholdersEnabled OFF hides placeholder rows + their bars across the model', () => {
    const off = buildSchedulerModel(withPlaceholder(), geom, days, start, end, start, end, emptyFilters(), true, false, true)
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id)
    expect(ids).not.toContain('ph')
    // The placeholder's allocation is unreferenced, not errored — no bar for it anywhere.
    expect(allBars(off).map((b) => b.allocation.id)).not.toContain('a-ph')
  })

  it('placeholdersEnabled ON shows the placeholder row with its bar', () => {
    const on = buildSchedulerModel(withPlaceholder(), geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const ids = on.flatMap((g) => g.rows).map((r) => r.resource.id)
    expect(ids).toContain('ph')
    expect(allBars(on).map((b) => b.allocation.id)).toContain('a-ph')
  })

  it('placeholdersEnabled OFF excludes placeholders from per-discipline utilisation', () => {
    // Per-discipline utilisation is the mean of row.utilization over group.rows (SchedulerGrid).
    // The Design discipline holds r1 (a person) and ph (a placeholder); a hidden placeholder is
    // simply absent from group.rows, so its load can't leak into the discipline average.
    const off = buildSchedulerModel(withPlaceholder(), geom, days, start, end, start, end, emptyFilters(), true, false, true)
    const on = buildSchedulerModel(withPlaceholder(), geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const avg = (rows: { utilization: number }[]) => rows.reduce((s, r) => s + r.utilization, 0) / rows.length
    const designOff = off.find((g) => g.title === 'Design')!
    const designOn = on.find((g) => g.title === 'Design')!
    // The placeholder is fully booked over the window while r1 is lighter, so including it (ON)
    // raises the discipline average above the placeholders-OFF figure.
    expect(avg(designOn.rows)).toBeGreaterThan(avg(designOff.rows))
    // And OFF the discipline has only the one person row.
    expect(designOff.rows.map((r) => r.resource.id)).toEqual(['r1'])
  })

  it('hideTentative removes tentative bars, but capacity/utilisation still count them', () => {
    const model = build({ ...emptyFilters(), hideTentative: true })
    expect(barIds(model)).toEqual(['a1', 'a3'])
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    // a1 (8h×2) + a2 (4h×2, tentative) = 24h over 40 available -> 0.6, unaffected by the filter
    expect(r1.utilization).toBeCloseTo(0.6)
  })

  it('displayed utilisation % follows the VISIBLE window (visStart/visEnd), not the whole timeline', () => {
    // `days` spans the full week (6/1–6/7), but the VISIBLE window passed in is just 6/3–6/4.
    // Over that window r1 has only a2 (4h × 2 working days) / (8h × 2) = 0.5. (Pre-change the %
    // ran over a fixed window decoupled from the view; now it tracks the visible span, so this
    // assertion is inverted from its old form.)
    const model = buildSchedulerModel(dataset(), geom, days, '2026-06-03', '2026-06-04', start, end, emptyFilters(), true, true, true)
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    expect(r1.utilization).toBeCloseTo(0.5)
    // The visible model (bars/day-states) still covers the full `days` range, unaffected by the window.
    expect(r1.dayStates.length).toBe(days.length)
  })

  it('overSoon stays on the FIXED forward window — independent of the visible window', () => {
    const d = dataset()
    // Stack a second 8h allocation on r1's 6/1–6/2 (8 + 8 > 8 available -> over on those days).
    d.allocations.push({ id: 'a4', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    // VISIBLE window 6/3–6/4 has NO over day, but the FIXED overSoon window 6/1–6/2 does — overSoon
    // must read the fixed window, so r1 is flagged even though the visible window is clean.
    const rows = buildSchedulerModel(d, geom, days, '2026-06-03', '2026-06-04', '2026-06-01', '2026-06-02', emptyFilters(), true, true, true).flatMap((g) => g.rows)
    expect(rows.find((r) => r.resource.id === 'r1')!.overSoon).toBe(true)
    expect(rows.find((r) => r.resource.id === 'r2')!.overSoon).toBe(false) // 8h == 8h available, not over
  })

  it('project filter limits bars to that project (resources still listed)', () => {
    expect(barIds(build({ ...emptyFilters(), projectId: 'p2' }))).toEqual(['a2', 'a3'])
  })

  // dataset() + project-less activities (one internal, one repeatable) with an allocation each, so the
  // activity lens has something to filter. r1 picks up an internal bar, r2 a repeatable one.
  function withLensActivities(): AppData {
    const d = dataset()
    d.activities.push(
      { id: 't-int', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' },
      { id: 't-rep', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', kind: 'repeatable' },
    )
    d.allocations.push(
      { id: 'a-int', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't-int', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-rep', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r2', activityId: 't-rep', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
    )
    return d
  }
  const buildLens = (filters = emptyFilters()) =>
    buildSchedulerModel(withLensActivities(), geom, days, start, end, start, end, filters, true, true, true)

  it('activity lens: a specific activity id limits bars to that activity', () => {
    // Default (showUnmatched off): non-matching rows collapse out and matching rows show ONLY
    // their matching bars. (With showUnmatched on, dimmed rows show full real load by design.)
    const bars = buildLens({ ...emptyFilters(), activityId: 't-rep' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort()
    expect(bars).toEqual(['a-rep'])
  })

  it('activity lens: "Repeatable — All" (activityKind) shows only repeatable-activity allocations', () => {
    const bars = buildLens({ ...emptyFilters(), activityKind: 'repeatable' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort()
    expect(bars).toEqual(['a-rep'])
  })

  it('activity lens: "Internal — All" (activityKind) shows only internal-activity allocations', () => {
    const bars = buildLens({ ...emptyFilters(), activityKind: 'internal' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort()
    expect(bars).toEqual(['a-int'])
  })

  it('activity lens: dims (and by default hides) rows with no work on the filtered activity', () => {
    // activityKind 'repeatable' matches only r2's a-rep. By default (showUnmatched off) r1 collapses out.
    const rows = buildLens({ ...emptyFilters(), activityKind: 'repeatable' }).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r2'])
  })

  it('dims (not hides) a resource with no work on the active project when showUnmatched is opted in', () => {
    // r1 works on p1; r2 has only p2 work → with showUnmatched on, r2 is dimmed but
    // still shown (its a3 bar) so you can see it's available to staff onto p1.
    const rows = build({ ...emptyFilters(), projectId: 'p1', showUnmatched: true }).flatMap((g) => g.rows)
    expect(rows.find((r) => r.resource.id === 'r1')!.dimmed).toBe(false)
    const r2 = rows.find((r) => r.resource.id === 'r2')!
    expect(r2.dimmed).toBe(true)
    expect(r2.bars.map((b) => b.allocation.id)).toEqual(['a3'])
  })

  it('hides the unmatched (unallocated) rows by default', () => {
    // emptyFilters() ships showUnmatched: false — filtering collapses to matching rows.
    const rows = build({ ...emptyFilters(), projectId: 'p1' }).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r1'])
  })

  it('does not leave a full-opacity zero-bar ghost row when the only match is a hidden tentative allocation', () => {
    // r1's only p2 work (a2) is tentative; with hideTentative it's hidden, so r1 has no
    // VISIBLE match. It must be treated as unmatched (dimmed) — and filtered out when
    // showUnmatched is off — not rendered as a full-opacity row with zero bars.
    const filters = { ...emptyFilters(), projectId: 'p2', hideTentative: true, showUnmatched: false }
    const rows = build(filters).flatMap((g) => g.rows)
    expect(rows.map((r) => r.resource.id)).toEqual(['r2']) // r1 filtered out, not a ghost
    expect(rows.every((r) => r.dimmed || r.bars.length > 0)).toBe(true) // no non-dimmed zero-bar row
  })

  it('dims (showing real load) a tentative-only-match row when showUnmatched is on', () => {
    const filters = { ...emptyFilters(), projectId: 'p2', hideTentative: true, showUnmatched: true }
    const r1 = build(filters)
      .flatMap((g) => g.rows)
      .find((r) => r.resource.id === 'r1')!
    expect(r1.dimmed).toBe(true) // its only p2 work is hidden → dimmed, not full-opacity
    expect(r1.bars.map((b) => b.allocation.id)).toEqual(['a1']) // shows its real non-tentative load
  })

  it('discipline filter drops other groups', () => {
    const model = build({ ...emptyFilters(), disciplineId: 'd-dev' })
    expect(model.map((g) => g.title)).toEqual(['Development'])
    expect(barIds(model)).toEqual(['a3'])
  })

  it('search narrows to matching resources and drops now-empty groups', () => {
    const model = build({ ...emptyFilters(), search: 'dev sam' })
    expect(model.map((g) => g.title)).toEqual(['Development'])
  })

  it('disciplines off → one flat group holding every resource (no discipline bands)', () => {
    const model = build(emptyFilters(), false)
    expect(model).toHaveLength(1)
    expect(model[0].rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2'])
    expect(model[0].color).toBeUndefined() // no discipline colour → avatar falls back to resource colour
    expect(barIds(model)).toEqual(['a1', 'a2', 'a3'])
  })

  it('disciplines off → the discipline filter is ignored (everyone still shown)', () => {
    const model = build({ ...emptyFilters(), disciplineId: 'd-dev' }, false)
    expect(model).toHaveLength(1)
    expect(model[0].rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2'])
  })
})

// Visible-window utilisation: the displayed % is computed over [visStart, visEnd] and so must change
// EXACTLY with the 1/2/4/8-week range toggle. The fixture below books a different density each week so
// the four numbers genuinely differ (no coincidental equality), and an exact-span boundary booking
// proves the inclusive end (no off-by-one). A single Mon–Fri resource, 8h/day → 40h/week capacity.
describe('displayed utilisation % over the visible window (1/2/4/8 weeks)', () => {
  // 8 weeks of timeline starting Mon 2026-06-01, anchored at the left edge (visStart = 06-01).
  const winStart = '2026-06-01' // Monday
  const winDays = eachDayISO('2026-06-01', '2026-07-26') // 8 weeks (56 days) exactly
  const winGeom = buildColumnGeometry(winDays, 48, { minimiseWeekends: false, weekendWidth: 22 })

  function densityData(): AppData {
    return {
      ...emptyAppData(),
      clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#1' }],
      projects: [{ id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#2' }],
      activities: [{ id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T1', kind: 'project', projectId: 'p1' }],
      resources: [
        { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dana', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' },
      ],
      allocations: [
        // Week 1 (06-01..06-07): 8h/day Mon–Fri → 40/40 = 100%.
        { id: 'w1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
        // Week 2 (06-08..06-14): 4h/day Mon–Fri → 20/40 = 50%.
        { id: 'w2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-08', endDate: '2026-06-12', hoursPerDay: 4, status: 'confirmed' },
        // Weeks 3–4 (06-15..06-26): 2h/day Mon–Fri → 10/40 each.
        { id: 'w34', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-15', endDate: '2026-06-26', hoursPerDay: 2, status: 'confirmed' },
        // Weeks 5–8 (06-29..07-26): unbooked → 0%.
      ],
      timeOff: [],
    }
  }

  // Build with the visible window [winStart, visEnd], a no-op fixed overSoon window, and read r1's %.
  const utilOver = (visEnd: string): number => {
    const model = buildSchedulerModel(densityData(), winGeom, winDays, winStart, visEnd, winStart, winStart, emptyFilters(), false, true, true)
    return model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!.utilization
  }

  // Inclusive end = visStart + (zoom*7 - 1): 1w → +6, 2w → +13, 4w → +27, 8w → +55.
  it('1 week → 100% (week-1 density only)', () => {
    expect(utilOver('2026-06-07')).toBeCloseTo(1.0) // 40 / 40
  })
  it('2 weeks → 75% (weeks 1–2)', () => {
    expect(utilOver('2026-06-14')).toBeCloseTo(0.75) // (40 + 20) / 80
  })
  it('4 weeks → 50% (weeks 1–4)', () => {
    expect(utilOver('2026-06-28')).toBeCloseTo(0.5) // (40 + 20 + 10 + 10) / 160
  })
  it('6 weeks → 33% (weeks 1–6, weeks 5–6 idle)', () => {
    // 6-week inclusive end = visStart 06-01 + (6×7 − 1 = 41 days) = 07-12. Booked hours are weeks 1–4
    // only (40 + 20 + 10 + 10 = 80); weeks 5–6 are unbooked. Capacity = 6 weeks × 40h = 240. 80/240.
    expect(utilOver('2026-07-12')).toBeCloseTo(1 / 3) // 80 / 240
  })
  it('8 weeks → 25% (weeks 1–8, second half idle)', () => {
    expect(utilOver('2026-07-26')).toBeCloseTo(0.25) // 80 / 320
  })
  it('the five zoom spans produce five DISTINCT numbers (the toggle genuinely recalculates)', () => {
    // One per ZOOM_LEVELS entry (1/2/4/6/8 weeks): 100 / 75 / 50 / 33 / 25.
    const nums = [utilOver('2026-06-07'), utilOver('2026-06-14'), utilOver('2026-06-28'), utilOver('2026-07-12'), utilOver('2026-07-26')]
    expect(new Set(nums.map((n) => Math.round(n * 100))).size).toBe(5)
  })

  it('inclusive-end boundary: a booking on the visible window LAST day counts; the day AFTER does not', () => {
    // Unbooked base fixture so only the boundary booking moves the number. Window = 1 week
    // [06-01, 06-07]; capacity 40h. An 8h booking ON the last working day before/at the edge
    // counts; a booking the day AFTER the inclusive end (06-08, a Monday) is outside and excluded.
    const base = (): AppData => ({ ...densityData(), allocations: [] })
    const visEnd = '2026-06-07' // Sunday — 1-week inclusive end (visStart 06-01 + 6)
    // 06-05 (Friday) is INSIDE [06-01, 06-07]: 8h on one working day → 8 / 40 = 0.2.
    const inside = { ...base(), allocations: [{ id: 'in', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' as const }] }
    const inModel = buildSchedulerModel(inside, winGeom, winDays, winStart, visEnd, winStart, winStart, emptyFilters(), false, true, true)
    expect(inModel.flatMap((g) => g.rows)[0].utilization).toBeCloseTo(0.2)
    // 06-08 (Monday) is the day AFTER the inclusive end → outside the window → 0%.
    const after = { ...base(), allocations: [{ id: 'af', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-08', endDate: '2026-06-08', hoursPerDay: 8, status: 'confirmed' as const }] }
    const afterModel = buildSchedulerModel(after, winGeom, winDays, winStart, visEnd, winStart, winStart, emptyFilters(), false, true, true)
    expect(afterModel.flatMap((g) => g.rows)[0].utilization).toBe(0)
  })
})

describe('external / 3rd-party band', () => {
  const buildExt = (filters = emptyFilters(), disciplinesEnabled = true, externalEnabled = true) =>
    buildSchedulerModel(withExternal(), geom, days, start, end, start, end, filters, disciplinesEnabled, true, externalEnabled)

  it('renders external resources in a neutral band that is ALWAYS last', () => {
    const model = buildExt()
    // Discipline bands first, then the external band — never interleaved.
    expect(model.map((g) => g.key)).toEqual(['d-design', 'd-dev', 'external'])
    const last = model[model.length - 1]
    expect(last.title).toBe('External / 3rd party')
    expect(last.color).toBe('#9ca3af') // NEUTRAL_COLOR
    expect(last.rows.map((r) => r.resource.id)).toEqual(['ext1'])
  })

  it('external rows carry NO capacity: utilisation 0, never overSoon, no day markers, no time-off', () => {
    const ext = buildExt().at(-1)!.rows[0]
    expect(ext.utilization).toBe(0)
    expect(ext.overSoon).toBe(false)
    // Its booking spans a weekend (zero-capacity for a person), yet no day is flagged.
    expect(ext.dayStates.every((d) => !d.over && !d.unavailable)).toBe(true)
    expect(ext.timeOff).toEqual([]) // the stray time-off row is ignored for externals
  })

  it('external parties are still assignable — their activity bars still render', () => {
    const ext = buildExt().at(-1)!.rows[0]
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(['aext'])
  })

  it('disciplines off → external STILL forms its own trailing band (below the flat group)', () => {
    const model = buildExt(emptyFilters(), false)
    expect(model).toHaveLength(2) // flat (our people) + external
    expect(model[0].rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2'])
    expect(model[1].key).toBe('external')
    expect(model[1].rows.map((r) => r.resource.id)).toEqual(['ext1'])
  })

  it('externalEnabled OFF hides external rows + their bars across the model', () => {
    const off = buildExt(emptyFilters(), true, false)
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id)
    expect(ids).not.toContain('ext1')
    // The external's allocation is unreferenced, not errored — no bar for it anywhere.
    expect(off.flatMap((g) => g.rows).flatMap((r) => r.bars).map((b) => b.allocation.id)).not.toContain('aext')
  })

  it('externalEnabled OFF drops the (now-empty) External band header entirely (risk #2)', () => {
    // The trailing external band must NOT render as an empty header when externals are hidden — the
    // model's `rows.length > 0` filter drops the whole group, so no 'external' key survives.
    const off = buildExt(emptyFilters(), true, false)
    expect(off.map((g) => g.key)).not.toContain('external')
    // And with disciplines off too, only the flat people group remains (no empty external band).
    const offFlat = buildExt(emptyFilters(), false, false)
    expect(offFlat.map((g) => g.key)).not.toContain('external')
    expect(offFlat).toHaveLength(1)
  })

  it('externalEnabled ON shows the external row with its bar', () => {
    const on = buildExt(emptyFilters(), true, true)
    expect(on.map((g) => g.key)).toContain('external')
    const ext = on.at(-1)!.rows[0]
    expect(ext.resource.id).toBe('ext1')
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(['aext'])
  })
})

// dataset() + a built-in Internal client that owns a real project (pInt), plus a project-less
// internal activity. Both bucket under Internal: filtering by the Internal client id must show
// (a) the project-less activity AND (b) the Internal-owned project's activity.
function withInternal(): AppData {
  const d = dataset()
  d.clients.push({ id: 'c-internal', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Internal', color: '#9c3ace', builtin: true })
  // A REAL project owned by the Internal client, with a project activity on it.
  d.projects.push({ id: 'pInt', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Internal Project', clientId: 'c-internal', color: '#6' })
  d.activities.push({ id: 'tIntProj', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Internal Proj Activity', kind: 'project', projectId: 'pInt' })
  // A project-less internal activity (derives client = Internal in the view-model).
  d.activities.push({ id: 'tIntNoProj', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' })
  // r1 books both; a3 (under p1/Acme) is unrelated to Internal.
  d.allocations.push({ id: 'aIntProj', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 'tIntProj', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 4, status: 'confirmed' })
  d.allocations.push({ id: 'aIntNoProj', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 'tIntNoProj', startDate: '2026-06-03', endDate: '2026-06-04', hoursPerDay: 4, status: 'confirmed' })
  return d
}

describe('built-in Internal client bucketing + filter', () => {
  const internalId = 'c-internal'
  const buildInternal = (filters = emptyFilters()) =>
    buildSchedulerModel(withInternal(), geom, days, start, end, start, end, filters, true, true, true)
  const internalBarIds = (m: GroupModel[]) =>
    m.flatMap((g) => g.rows).flatMap((r) => r.bars).map((b) => b.allocation.id).sort()

  it('filtering by the Internal client shows BOTH the project-less activity AND the Internal-owned project activity', () => {
    const model = buildInternal({ ...emptyFilters(), clientId: internalId })
    // aIntProj (under the Internal-owned project pInt) + aIntNoProj (project-less, derived Internal);
    // a3 (under Acme's p1) and the other Acme work are excluded.
    expect(internalBarIds(model)).toEqual(['aIntNoProj', 'aIntProj'])
  })

  it('a project-less activity is NOT shown when filtering by a different (non-Internal) client', () => {
    const model = buildInternal({ ...emptyFilters(), clientId: 'c1' })
    // Only Acme (c1) work — never the project-less internal activity.
    expect(internalBarIds(model)).not.toContain('aIntNoProj')
    expect(internalBarIds(model)).not.toContain('aIntProj')
  })
})

// Pan invariant — the load-bearing reason a Back/Forward pan keeps the visible-window utilisation
// correct WITHOUT any layout measurement. `panDays(+7)` shifts the origin date by a week while
// PRESERVING scrollLeft and dayWidth, so the visible-window start is still resolved by the SAME
// position index `indexAt(scrollLeft)`. Because the geometry for the new (shifted) days array has
// identical column widths (the weekday/weekend pattern repeats every 7 days), `indexAt(px)` returns
// the same index before and after — and the date at that index has advanced by exactly +7. A future
// change to panDays/anchoring that breaks this position-based correctness will fail here.
describe('pan invariant: a +7-day Back/Forward pan moves the visible-window start by exactly +7', () => {
  // A 6-week window so any in-window pixel resolves to a real interior column (not an edge clamp).
  const daysOld = eachDayISO('2026-06-01', '2026-07-12') // Mon → 42 days
  const daysNew = daysOld.map((d) => addDaysISO(d, 7)) // same array shifted forward one week

  // Same dayWidth + weekend settings for both — exactly what panDays does (only originDate changes).
  for (const opts of [
    { minimiseWeekends: false, weekendWidth: 22 },
    { minimiseWeekends: true, weekendWidth: 22 }, // narrow weekends: widths still repeat weekly, so the index is stable
  ]) {
    const label = opts.minimiseWeekends ? 'minimise ON' : 'minimise OFF'
    const geomOld = buildColumnGeometry(daysOld, 48, opts)
    const geomNew = buildColumnGeometry(daysNew, 48, opts)

    it(`${label}: days_new[indexAt(px)] === addDaysISO(days_old[indexAt(px)], 7) on column boundaries`, () => {
      // Both geometries share identical widths (the weekly weekend pattern is invariant under a
      // 7-day shift), so the prefix-summed offsets — and thus indexAt — are identical.
      expect(geomNew.widths).toEqual(geomOld.widths)
      // Walk every column's left-edge pixel `px` (a real scrollLeft would land on these boundaries).
      for (let i = 0; i < daysOld.length; i++) {
        const px = geomOld.x(i)
        const idxOld = geomOld.indexAt(px)
        const idxNew = geomNew.indexAt(px)
        expect(idxNew).toBe(idxOld) // same position index before and after the pan
        // The resolved visible-start DATE advanced by exactly one week — no off-by-one, no drift.
        expect(daysNew[idxNew]).toBe(addDaysISO(daysOld[idxOld], 7))
      }
    })
  }
})

// P2.4: the scheduler renders the ACTIVE-ONLY projection (SchedulerGrid reads useActiveScopedData,
// which runs the SAME shared `activeOnly` exercised here). Prove that an archived resource and a
// soft-deleted resource produce NO lanes when the data is passed through `activeOnly`, while the
// active resources still do — pinning the production seam, not a re-implementation of the filter.
describe('buildSchedulerModel(activeOnly(data), …) — non-active resources vanish (P2.4)', () => {
  // dataset() has active people r1 (Design) + r2 (Development). Add an archived person and a
  // soft-deleted person, each in their OWN discipline so a dropped lane also empties its band.
  function withNonActive(): AppData {
    const d = dataset()
    d.disciplines.push(
      { id: 'd-ops', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Ops', sortOrder: 2 },
      { id: 'd-qa', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'QA', sortOrder: 3 },
    )
    d.resources.push(
      // archived (archivedAt set) — must NOT render.
      { id: 'r-arch', accountId: 'acct-test', createdAt: 't', updatedAt: 't', archivedAt: '2026-05-01T00:00:00.000Z', kind: 'person', name: 'Archived Ann', role: 'Ops', disciplineId: 'd-ops', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#6' },
      // soft-deleted (deletedAt set) — must NOT render.
      { id: 'r-del', accountId: 'acct-test', createdAt: 't', updatedAt: 't', archivedAt: '2026-05-01T00:00:00.000Z', deletedAt: '2026-05-20T00:00:00.000Z', kind: 'person', name: 'Deleted Del', role: 'QA', disciplineId: 'd-qa', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#7' },
    )
    // A booking on each non-active resource — the lane and its bars must drop together.
    d.allocations.push(
      { id: 'a-arch', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r-arch', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a-del', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r-del', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
    )
    return d
  }

  const buildActive = (d: AppData) =>
    buildSchedulerModel(activeOnly(d), geom, days, start, end, start, end, emptyFilters(), true, true, true)

  it('RAW data renders the archived + deleted lanes; the active-only projection does NOT', () => {
    const d = withNonActive()
    // Sanity: WITHOUT the projection, all four people + their bars render (the filter is what hides them).
    const raw = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const rawResourceIds = raw.flatMap((g) => g.rows).map((r) => r.resource.id)
    expect(rawResourceIds).toEqual(expect.arrayContaining(['r1', 'r2', 'r-arch', 'r-del']))

    // WITH activeOnly: the archived + soft-deleted lanes are gone; the active ones remain.
    const model = buildActive(d)
    const resourceIds = model.flatMap((g) => g.rows).map((r) => r.resource.id)
    expect(resourceIds).toEqual(['r1', 'r2']) // ONLY the active people
    expect(resourceIds).not.toContain('r-arch')
    expect(resourceIds).not.toContain('r-del')
    // No bars for the dropped resources (their allocations have nowhere to land).
    const barIdsAll = model.flatMap((g) => g.rows).flatMap((r) => r.bars).map((b) => b.allocation.id)
    expect(barIdsAll).not.toContain('a-arch')
    expect(barIdsAll).not.toContain('a-del')
    // Their now-empty discipline bands are dropped entirely (no empty Ops / QA headers).
    expect(model.map((g) => g.title)).not.toContain('Ops')
    expect(model.map((g) => g.title)).not.toContain('QA')
  })

  it('hides scheduled work beneath an archived client', () => {
    // An ACTIVE project whose client is ARCHIVED, plus an ACTIVE activity on it, booked to r1.
    // The retained storage rows must not leak into the normal scheduler projection.
    const d = dataset()
    d.clients.push({ id: 'c-arch', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Gone Co', color: '#8', archivedAt: '2026-05-01T00:00:00.000Z' })
    d.projects.push({ id: 'p-orphan', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Orphan P', clientId: 'c-arch', color: '#9' })
    d.activities.push({ id: 't-orphan', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Orphan T', kind: 'project', projectId: 'p-orphan' })
    d.allocations.push({ id: 'a-orphan', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't-orphan', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const model = buildActive(d)
    const barIdsAll = model.flatMap((g) => g.rows).flatMap((r) => r.bars).map((b) => b.allocation.id)
    expect(barIdsAll).not.toContain('a-orphan')
  })
})

// Mutation-testing gap-fill: each block below targets a specific line the exhaustive suites above
// happen not to exercise in a way that observes real output (a fallback path, an optional-chain
// guard, a Map built via array-pair entries, etc).
describe('buildSchedulerModel — mutation-testing gap-fill', () => {
  it('search is TRIMMED before matching (leading/trailing whitespace is not part of the term)', () => {
    const d = dataset()
    // A resource whose displayName/name/role all collapse to the SAME single word, so there's no
    // duplicate occurrence anywhere in the searched string to coincidentally rescue an un-trimmed
    // search — the only way 'zed ' (trailing space) matches is if it's trimmed to 'zed' first.
    d.resources.push({ id: 'r-zed', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Zed', role: 'Zed', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a' })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), search: 'zed ' }, true, true, true)
    const ids = model.flatMap((g) => g.rows).map((r) => r.resource.id)
    expect(ids).toContain('r-zed')
  })

  it('search falls back to an EMPTY string (not a literal placeholder) when resource.name is undefined', () => {
    const d = dataset()
    d.resources[0] = { ...d.resources[0], name: undefined }
    // Searching for a term that would only ever match via a bogus non-empty fallback string.
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), search: 'stryker' }, true, true, true)
    expect(model.flatMap((g) => g.rows).map((r) => r.resource.id)).not.toContain('r1')
  })

  it('a placeholder IS searchable by its own (unusual, but allowed) `name` field', () => {
    const d = dataset()
    d.resources.push({ id: 'ph-named', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'placeholder', name: 'Zibblequork', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#b' })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), search: 'zibblequork' }, true, true, true)
    expect(model.flatMap((g) => g.rows).map((r) => r.resource.id)).toContain('ph-named')
  })

  it('bar.project / bar.client resolve through the projectById / clientById maps (real lookups, not empty maps)', () => {
    const model = build()
    const a1 = allBars(model).find((b) => b.allocation.id === 'a1')!
    expect(a1.project).toBe('P1')
    expect(a1.client).toBe('Acme')
  })

  it('a project-less activity bar falls back to the RESOURCE colour via resourceById (not a broken/empty map)', () => {
    const d = dataset()
    d.activities.push({ id: 't-int', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'internal' })
    d.allocations.push({ id: 'a-int', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't-int', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const bar = allBars(model).find((b) => b.allocation.id === 'a-int')!
    expect(bar.color).toBe('#4') // r1's own colour — no project/client colour to fall back to first
  })

  it('does not throw when there are no clients at all (scopedAccountId derivation is optional-chained)', () => {
    const d = { ...dataset(), clients: [] }
    expect(() => buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)).not.toThrow()
  })

  it('positions time-off blocks with real fields (id/x/width/label/note), and marks only its OWN days unavailable', () => {
    const d = dataset()
    // TWO time-off rows for the SAME resource, so the resourceId -> TimeOff[] map must accumulate
    // (push into an existing bucket) rather than each write clobbering the last one.
    d.timeOff.push(
      { id: 'to1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', startDate: '2026-06-01', endDate: '2026-06-01', type: 'holiday', note: 'day one' },
      { id: 'to2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', startDate: '2026-06-02', endDate: '2026-06-02', type: 'sick' },
    )
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    expect(r1.timeOff).toHaveLength(2) // both accumulate — neither write drops the other
    const t1 = r1.timeOff.find((t) => t.id === 'to1')!
    expect(t1.x).toBe(geom.xForDateInGeom('2026-06-01'))
    expect(t1.width).toBe(geom.widthForDates('2026-06-01', '2026-06-01'))
    expect(t1.note).toBe('day one')
    expect(typeof t1.label).toBe('string')
    expect(t1.label.length).toBeGreaterThan(0)
    // Day-state unavailable is exactly cap.available === 0: true on the time-off day, false on a
    // plain working day with no time off (2026-06-03, a Wednesday r1 works).
    expect(r1.dayStates[0].unavailable).toBe(true) // 2026-06-01, on time off
    expect(r1.dayStates[2].unavailable).toBe(false) // 2026-06-03, ordinary working day
  })

  it('external rows use literal {over:false, unavailable:false} day-states (real booleans, not an empty object)', () => {
    const model = buildSchedulerModel(withExternal(), geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const ext = model.at(-1)!.rows[0]
    expect(ext.dayStates[0]).toEqual({ over: false, unavailable: false })
  })

  it('a dangling activityId (missing from `activities`) degrades to safe fallbacks, never throws', () => {
    const d = dataset()
    d.allocations.push({ id: 'a-ghost', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 'ghost-activity', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' })
    let model: GroupModel[] = []
    expect(() => {
      model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    }).not.toThrow()
    const bar = allBars(model).find((b) => b.allocation.id === 'a-ghost')!
    expect(bar.label).toBe('Activity') // fallback label, not a crash on the missing activity lookup
    expect(bar.project).toBeUndefined()
    expect(bar.client).toBeUndefined()
  })

  it('a dangling activityId does not throw when project/client/activity-kind filters are active, and is filtered out', () => {
    const d = dataset()
    d.allocations.push({ id: 'a-ghost2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 'ghost-activity-2', startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' })
    expect(() => buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), projectId: 'p1' }, true, true, true)).not.toThrow()
    expect(() => buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), clientId: 'c1' }, true, true, true)).not.toThrow()
    expect(() => buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), activityKind: 'internal' }, true, true, true)).not.toThrow()
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, { ...emptyFilters(), projectId: 'p1' }, true, true, true)
    expect(allBars(model).map((b) => b.allocation.id)).not.toContain('a-ghost2')
  })

  it('the ungrouped ("No discipline") bucket keys as "none" with title "No discipline" (not empty strings)', () => {
    const d = dataset()
    d.resources.push({ id: 'r-nodisc', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Noe', role: 'Floater', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#c' })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const nodisc = model.find((g) => g.rows.some((r) => r.resource.id === 'r-nodisc'))!
    expect(nodisc.key).toBe('none')
    expect(nodisc.title).toBe('No discipline')
  })

  it('group.external is a real boolean: true for the external band, false (not undefined) for a discipline group', () => {
    const model = buildSchedulerModel(withExternal(), geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const design = model.find((g) => g.title === 'Design')!
    const externalGroup = model.at(-1)!
    expect(design.external).toBe(false)
    expect(externalGroup.external).toBe(true)
  })

  it('placeholder ordering is stable WITHIN each kind: multiple persons keep their relative order, multiple placeholders too', () => {
    const d = dataset()
    d.resources = [
      { id: 'ph1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'placeholder', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9' },
      { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Dana', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' },
      { id: 'ph2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'placeholder', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#8' },
      { id: 'r2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Sam', role: 'Designer', disciplineId: 'd-design', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#5' },
    ]
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const design = model.find((g) => g.title === 'Design')!
    expect(design.rows.map((r) => r.resource.id)).toEqual(['r1', 'r2', 'ph1', 'ph2'])
  })

  it('positions overlapping bars on the SAME resource at DIFFERENT lane tops (laneById is a real Map, not empty)', () => {
    const d = dataset()
    // a1 already books r1 on 2026-06-01..02; a second, overlapping allocation forces a 2nd lane.
    d.allocations.push({ id: 'a-overlap', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const r1bars = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!.bars
    const tops = new Set(r1bars.filter((b) => b.allocation.id === 'a1' || b.allocation.id === 'a-overlap').map((b) => b.top))
    expect(tops.size).toBe(2)
  })

  it('overSoon truly SKIPS external resources — even one with real over-capacity hours', () => {
    const d = withExternal()
    // ext1's workingHoursPerDay is 8; this 20h booking on a working Monday WOULD read as over if
    // the external guard were bypassed.
    d.allocations.push({ id: 'aext2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ext1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 20, status: 'confirmed' })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    expect(model.at(-1)!.rows[0].overSoon).toBe(false)
  })

  it('overSoon requires a REAL working day (available > 0): an ignoreWeekends weekend booking is over per-day but does not trip overSoon', () => {
    const d = dataset()
    // r1 works Mon–Fri; 2026-06-06 is a Saturday (available = 0 for r1 regardless of ignoreWeekends
    // — that flag only affects whether the allocation counts hours there, not the resource's
    // availability). ignoreWeekends: true makes the allocation actually WORK that zero-capacity day.
    d.allocations.push({ id: 'a-sat', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-06', endDate: '2026-06-06', hoursPerDay: 8, status: 'confirmed', ignoreWeekends: true })
    const model = buildSchedulerModel(d, geom, days, start, end, start, end, emptyFilters(), true, true, true)
    const r1 = model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1')!
    expect(r1.overSoon).toBe(false)
  })
})
