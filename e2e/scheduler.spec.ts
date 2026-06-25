import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

// Read the leftmost visible date-header cell text (e.g. "7Mon" = day number + 3-letter weekday)
// and the width of one weekday column, used to nudge the grid by a deterministic number of columns
// so the left-edge week-snap is testable without flaky pixel guesses. Mirrors the probe in
// e2e/minimise-weekends.spec.ts. (At fine zoom the header day cells carry the weekday label.)
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="scheduler-grid"]') as HTMLElement
    const header = document.querySelector('[role="columnheader"][aria-label="Dates"]') as HTMLElement
    const dayTier = header?.querySelector('.flex.flex-auto')
    const cells = dayTier ? Array.from(dayTier.children) : []
    const gridRect = grid.getBoundingClientRect()
    const laneLeft = gridRect.left + 256 // past the sticky left column
    let leftDate = ''
    let weekdayWidth = 0
    for (const c of cells) {
      const r = (c as HTMLElement).getBoundingClientRect()
      if (!leftDate && r.right > laneLeft + 1) leftDate = (c.textContent || '').trim()
      // A weekday column is the wide one (weekends collapse to a sliver when minimised) — take the
      // widest visible cell as a robust "one weekday column" measure for nudging.
      if (r.right > laneLeft && r.left < gridRect.right) weekdayWidth = Math.max(weekdayWidth, r.width)
    }
    return { leftDate, weekdayWidth }
  })
}

test.describe('Scheduler', () => {
  test('shows seeded resources, grouping and capacity cues', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await expect(page.getByTestId('discipline-group').filter({ hasText: 'Design' })).toBeVisible()
    // Seed over-allocates Tyler on 3-4 June; weekends/time off are unavailable.
    const overMarker = page.getByTestId('over-marker').first()
    await expect(overMarker).toBeVisible()
    // The over-capacity day reads as a CLEAR, saturated red background (the dedicated
    // `danger-cell` token), not a faint blush. Resolve the computed fill to true sRGB bytes
    // by painting it onto a canvas and reading the pixel back — robust whether the engine
    // serialises the `color-mix(in oklab,…)` result as `rgb(…)`, `oklab(…)`, or `color(…)`.
    const rgba = await overMarker.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const ctx = c.getContext('2d')!
      // Opaque base so a (regressed) translucent fill blends toward white, not black —
      // a near-invisible alpha tint then reads as a near-white pixel and FAILS the gate.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, a }
    })
    // Opaque fill (the old /12 alpha would composite away above; the cell itself is solid).
    expect(rgba.a).toBe(255)
    // Real saturation: R must lead the other channels by a wide margin. Light `danger-cell`
    // is ~rgb(251,158,161) → R − max(G,B) ≈ 90; a blush like rgb(255,230,230) (≈25) FAILS.
    expect(rgba.r - Math.max(rgba.g, rgba.b)).toBeGreaterThan(60)
    await expect(page.getByTestId('unavailable-day').first()).toBeVisible()
    await expect(page.getByTestId('utilization').first()).toBeVisible()
  })

  test('draws a new allocation on an empty part of a lane', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()

    const before = await page.getByTestId('allocation-bar').count()

    // reset horizontal scroll (scroll-to-today shifts the grid on mount)
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
    })
    const lane = page.getByTestId('resource-lane').first()
    const b = await box(lane)
    const y = b.y + b.height / 2
    // The far-left of the lane (timeline origin) is empty for the first resource.
    await page.mouse.move(b.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(b.x + 6 + 48 * 2, y, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByRole('dialog', { name: 'New allocation' })).toBeVisible()
    await page.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await page.getByLabel('Activity', { exact: true }).selectOption('t-wires')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByTestId('allocation-bar')).toHaveCount(before + 1)
  })

  test('drags a bar to move it later', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })
    const b0 = await box(bar)
    const cx = b0.x + b0.width / 2
    const cy = b0.y + b0.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 60, cy, { steps: 8 }) // ~1 day right
    await page.mouse.up()

    const b1 = await box(bar)
    expect(b1.x).toBeGreaterThan(b0.x + 20)
  })

  test('resizes a bar via its end handle', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()

    // "Wireframes" (4 days) keeps its right edge on-screen, unlike the 9-day "Brand System".
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    const b0 = await box(bar)
    const handle = bar.getByTestId('resize-end')
    const h = await box(handle)

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, { steps: 8 }) // extend ~1 day
    await page.mouse.up()

    const b1 = await box(bar)
    expect(b1.width).toBeGreaterThan(b0.width + 20)
  })

  test('zooming to more weeks shrinks the day columns (same bar gets narrower)', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })

    await page.getByRole('button', { name: '1w', exact: true }).click()
    await expect(page.getByRole('button', { name: '1w', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '4w', exact: true })).toHaveAttribute('aria-pressed', 'false')
    const wide = await box(bar)
    await page.screenshot({ path: 'test-results/floaty-1week.png' })

    await page.getByRole('button', { name: '8w', exact: true }).click()
    await expect(page.getByRole('button', { name: '8w', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '1w', exact: true })).toHaveAttribute('aria-pressed', 'false')
    const narrow = await box(bar)
    await page.screenshot({ path: 'test-results/floaty-8week.png' })

    // Same 9-day allocation is physically narrower when more weeks are visible.
    expect(narrow.width).toBeLessThan(wide.width)
  })

  test('clicking Today re-centres the timeline after scrolling away', async ({ page }) => {
    await openApp(page)
    const grid = page.getByTestId('scheduler-grid')
    await expect(grid).toBeVisible()

    // Scroll far to the right, then ask to go back to Today.
    await grid.evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 5000
    })
    const scrolled = await grid.evaluate((el) => (el as HTMLElement).scrollLeft)
    expect(scrolled).toBeGreaterThan(800)

    await page.getByRole('button', { name: 'Today', exact: true }).click()

    // The grid re-scrolls back towards today (much smaller scrollLeft than where we were).
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(scrolled - 400)
  })

  test('jumping to a date moves the timeline to that month', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()

    await page.getByLabel('Jump to date').fill('2026-08-10')
    await expect(page.getByLabel('Jump to date')).toHaveValue('2026-08-10')
    await expect(page.getByText('Aug 2026')).toBeVisible()
  })

  test('shows a detail popover on hover (US-SCH-15)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).hover()
    const pop = page.getByTestId('allocation-popover')
    await expect(pop).toBeVisible()
    await expect(pop).toContainText('Brand Themes') // project name in the popover
  })

  test('shows overall and per-discipline utilisation summaries (US-SCH-14)', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('overall-utilization')).toContainText('%')
    await expect(page.getByTestId('discipline-group').first()).toContainText(/avg utilisation/)
  })

  test('the week-range toggle recomputes utilisation over the visible window (US-SCH-14)', async ({ page }) => {
    await openApp(page)
    const overall = page.getByTestId('overall-utilization')
    const pct = async () => Number.parseInt((await overall.textContent())?.replace('%', '') ?? '', 10)

    // Per-person % for a known seeded resource row (Tyler Nix). Its utilisation lives in the row
    // header's `utilization` testid, scoped to Tyler's scheduler-row so it can't pick up another
    // person's cell. Tyler is FRONT-LOADED in the seed (8h/day Mon–Thu of the frozen-clock week +
    // a tentative bar) → dense week 1 that idle later weeks dilute as the span widens.
    const tylerUtil = page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' }).getByTestId('utilization')
    const tylerPct = async () => Number.parseInt((await tylerUtil.textContent())?.replace('%', '') ?? '', 10)

    // Read the overall + Tyler % for a given zoom AFTER it settles: click the toggle, wait for the
    // label to track the zoom, then poll BOTH numbers to a STABLE value (two equal reads in a row) —
    // the visible window re-anchors via a rAF after the scroll settles, so a bare read can race that.
    const readAtZoom = async (weeks: 1 | 2 | 4 | 8): Promise<{ overall: number; tyler: number }> => {
      await page.getByRole('button', { name: `${weeks}w`, exact: true }).click()
      await expect(page.getByRole('button', { name: `${weeks}w`, exact: true })).toHaveAttribute('aria-pressed', 'true')
      // The label tracks the zoom (no longer a fixed "next 2w").
      await expect(page.getByText(`Utilisation · ${weeks}w`)).toBeVisible()
      await expect(tylerUtil).toBeVisible() // selector resolves to exactly Tyler's per-person cell
      let prev = { overall: NaN, tyler: NaN }
      await expect
        .poll(async () => {
          const next = { overall: await pct(), tyler: await tylerPct() }
          const stable = next.overall === prev.overall && next.tyler === prev.tyler
          prev = next
          return stable
        })
        .toBe(true)
      return prev
    }

    // The seed concentrates work in week 1 (early June, the frozen-clock week) and tapers off, so the
    // utilisation read over the visible window FALLS as the span widens (idle later weeks dilute the
    // dense first week). Monotone non-increasing because every span shares the same left edge.
    const wk1 = await readAtZoom(1)
    const wk2 = await readAtZoom(2)
    const wk4 = await readAtZoom(4)
    const wk8 = await readAtZoom(8)
    expect(wk1.overall).toBeGreaterThan(0)
    // Changing the toggle genuinely changes the OVERALL number to reflect the visible span.
    expect(wk1.overall).toBeGreaterThan(wk8.overall)
    expect(wk2.overall).toBeLessThanOrEqual(wk1.overall)
    expect(wk4.overall).toBeLessThanOrEqual(wk2.overall)
    expect(wk8.overall).toBeLessThanOrEqual(wk4.overall)
    // Per-person % moves in the SAME direction for a front-loaded resource: Tyler's dense week 1
    // reads higher at 1w than at 8w (the idle later weeks dilute it). Direction/inequality only —
    // no flaky exact-number race for the intermediate spans.
    expect(wk1.tyler).toBeGreaterThan(0)
    expect(wk1.tyler).toBeGreaterThanOrEqual(wk8.tyler)
  })

  test('stacks overlapping allocations onto a taller row (US-SCH-08)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    // Tyler has two overlapping seed bars (3-4 June) -> 2 lanes; Nike has one -> 1 lane.
    const tylerBars = page.locator('[data-resource-id="r-tyler"]').getByTestId('allocation-bar')
    expect(await tylerBars.count()).toBe(2)
    const tylerRow = await page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' }).boundingBox()
    const nikeRow = await page.getByTestId('scheduler-row').filter({ hasText: 'Nike Spiros' }).boundingBox()
    expect(tylerRow!.height).toBeGreaterThan(nikeRow!.height) // stacked -> taller
  })

  test('marks today with a vertical line when in range (US-SCH-12)', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('today-line').first()).toBeVisible()
  })

  test('allocation status and note are visually distinct on the bar (US-SCH-19)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })

    // Seed: Tyler's Visual Design bar is tentative (the placeholder also has a confirmed one).
    await expect(
      page.locator('[data-resource-id="r-tyler"]').getByTestId('allocation-bar').filter({ hasText: 'Visual Design' }),
    ).toHaveAttribute('data-status', 'tentative')

    // Mark Wireframes completed + add a note -> ✓ prefix and • marker.
    await page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    await dialog.getByLabel('Status').selectOption({ label: 'Completed' })
    await dialog.getByLabel('Note').fill('Handed off to QA')
    await page.getByRole('button', { name: 'Save' }).click()

    const done = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await expect(done).toHaveAttribute('data-status', 'completed')
    await expect(done).toContainText('✓')
    await expect(done).toContainText('•')
  })

  // Feature 1 (ALWAYS on): a zoom click and a Prev/Next pan re-anchor the grid's left edge to the
  // week start (account weekStartsOn, default Monday). A free-scroll nudge to a mid-week day is NOT
  // snapped on its own (no free-scroll snapping yet — that's a later setting), so the nudge persists
  // until the next navigation, which is exactly what lets us observe the re-anchor here.
  test('navigation re-anchors the left edge to the week start', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await openApp(page)

    // Header day cells read "<dayNum><EEE>", e.g. "7Mon"; a minimised weekend collapses to "<n>S".
    // We assert on the weekday suffix.
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const start = await probe(page)
    // The focused left edge is the current week's Monday (the default view is flush to it).
    expect(start.leftDate).toMatch(/Mon$/)

    // Nudge the grid so the left edge sits on a mid-week day: scroll past ~2.5 weekday columns.
    const grid = page.getByTestId('scheduler-grid')
    const nudge = Math.round(start.weekdayWidth * 2.5)
    await grid.evaluate((el, px) => { (el as HTMLElement).scrollLeft = px }, nudge)
    const nudged = await probe(page)
    expect(nudged.leftDate).not.toMatch(/Mon$/) // sanity: we're no longer parked on the Monday

    // A zoom click snaps the left edge back to the week start.
    await page.getByRole('button', { name: '2w', exact: true }).click()
    await expect.poll(async () => (await probe(page)).leftDate).toMatch(/Mon$/)

    // A Prev/Next pan snaps too: nudge to mid-week again, then click Next.
    await grid.evaluate((el, px) => { (el as HTMLElement).scrollLeft = px }, nudge)
    expect((await probe(page)).leftDate).not.toMatch(/Mon$/)
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.poll(async () => (await probe(page)).leftDate).toMatch(/Mon$/)
  })
})
