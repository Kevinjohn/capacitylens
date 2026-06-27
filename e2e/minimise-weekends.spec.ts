import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

// Read the leftmost visible date-header cell + how many day columns are on screen. Used to
// guard (a) the zoom scroll-anchor (the left-edge date must not drift onto the weekend) and
// (b) the weekend-aware fit (a "1-week" view must show ~1 week, not ~1.5).
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    // Sample AFTER two animation frames so the date header has been re-laid-out to match the current
    // scrollLeft. The header scroll is rAF-synced to the body, so reading cell rects mid-relayout
    // (which heavy parallel load on Firefox makes a wide window) pairs a stale, mid-timeline cell's
    // text with a leftmost layout position — yielding a torn left-edge date like a non-existent
    // "18Mon". The double-rAF lets layout settle before we measure. (See also the expect.poll reads.)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const grid = document.querySelector('[data-testid="scheduler-grid"]') as HTMLElement
    const header = document.querySelector('[role="columnheader"][aria-label="Dates"]') as HTMLElement
    const dayTier = header?.querySelector('.flex.flex-auto')
    const cells = dayTier ? Array.from(dayTier.children) : []
    const gridRect = grid.getBoundingClientRect()
    const laneLeft = gridRect.left + 256 // past the sticky left column
    // The weekday label is the cell's last <span> ("Mon"/"S"/…); a 3-letter label marks a weekday.
    const weekdayLabel = (c: Element) => {
      const spans = c.querySelectorAll('span')
      return (spans[spans.length - 1]?.textContent || '').trim()
    }
    let leftDate = ''
    let visibleDays = 0
    let weekdayWidth = 0
    for (const c of cells) {
      const r = (c as HTMLElement).getBoundingClientRect()
      if (!leftDate && r.right > laneLeft + 1) leftDate = (c.textContent || '').trim()
      if (r.right > laneLeft && r.left < gridRect.right) visibleDays++
      // First wide (3-letter) weekday cell gives a representative column width for column-relative nudges.
      if (!weekdayWidth && weekdayLabel(c).length === 3) weekdayWidth = r.width
    }
    return { leftDate, visibleDays, weekdayWidth }
  })
}

// Wait until the grid's horizontal scroll has STOPPED moving, then read the settled left-edge date.
// The left-edge probe derives the date from header cell rects at the *current* scroll position, so
// sampling while a programmatic scroll (zoom re-anchor) is still in flight returns the date of a
// transient position — a Monday one-to-three weeks off, e.g. a stray "18Mon". Under heavy parallel
// load on Firefox/WebKit that in-flight window is wide enough that a plain poll can keep sampling
// mid-scroll and never converge in time. Polling scrollLeft to a fixed point first guarantees we
// measure only once the view has settled, so the returned date is the real left edge.
async function settledLeftDate(page: import('@playwright/test').Page): Promise<string> {
  const grid = page.getByTestId('scheduler-grid')
  let last = NaN
  await expect
    .poll(async () => {
      const x = await grid.evaluate((n) => (n as HTMLElement).scrollLeft)
      const stable = x === last // two consecutive equal reads ⇒ the scroll has come to rest
      last = x
      return stable
    }, { timeout: 15_000 })
    .toBe(true)
  return (await probe(page)).leftDate
}

// Nudge the grid by a fixed number of weekday columns (derived from a probed column width, so it's
// resolution-independent), mirroring e2e/snap-week.spec.ts's nudge().
async function nudge(page: import('@playwright/test').Page, columns: number) {
  const { weekdayWidth } = await probe(page)
  await page.getByTestId('scheduler-grid').evaluate((node, dx) => {
    ;(node as HTMLElement).scrollLeft += dx
  }, Math.round(weekdayWidth * columns))
}

// Turn the device-global "Snap to week start" pref OFF and land on the Schedule at 1w. With the
// free-scroll snap off, a mid-week nudge STICKS — so any later left-edge move is attributable to the
// thing under test (a resize / a minimise toggle), and we can prove that thing does NOT snap.
async function openWithFreeScrollSnapOff(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 800 })
  await openApp(page, 'Studio North', '/settings')
  const snap = page.getByRole('switch', { name: 'Snap to week start' })
  await snap.click()
  await expect(snap).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('link', { name: 'Schedule' }).click()
  await page.getByRole('button', { name: '1w', exact: true }).click()
}

// Covers US-SET-05. "Minimise weekends" (device-global, default ON) shrinks the
// Sat/Sun columns to a sliver and labels both "S"; off restores full-width Sat/Sun columns.
// All label assertions are scoped to the date header (role=columnheader "Dates") so a stray
// "S" elsewhere (e.g. an avatar initial) can't match. 1w zoom = the widest, clearest columns.
test.describe('Minimise weekends', () => {
  test('ON by default: weekend columns are narrow and labelled "S"', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const header = page.getByRole('columnheader', { name: 'Dates' })

    // Weekdays keep their three-letter label; both weekend days collapse to a single "S".
    expect(await header.getByText('Wed', { exact: true }).count()).toBeGreaterThan(0)
    expect(await header.getByText('S', { exact: true }).count()).toBeGreaterThanOrEqual(2)
    await expect(header.getByText('Sat', { exact: true })).toHaveCount(0)
    await expect(header.getByText('Sun', { exact: true })).toHaveCount(0)

    // A weekend column is visibly narrower than a weekday column.
    const weekend = await box(header.getByText('S', { exact: true }).first().locator('..'))
    const weekday = await box(header.getByText('Wed', { exact: true }).first().locator('..'))
    expect(weekend.width).toBeLessThan(weekday.width)
  })

  // WCAG 2.5.8 (Target Size, AA): the preference switch must be ≥24×24px. The unit test in
  // SettingsView.test.tsx can only assert the h-6 class (jsdom runs no layout), so this measures the
  // REAL rendered geometry the build ships — a class rename that drops below 24px is caught here.
  test('the preference switch renders at least 24px tall (WCAG 2.5.8 target size)', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const sw = page.getByRole('switch', { name: 'Minimise weekends' })
    const b = await box(sw)
    expect(b.height).toBeGreaterThanOrEqual(24)
    expect(b.width).toBeGreaterThanOrEqual(24) // a non-degenerate target in both dimensions
  })

  test('toggling it off in Settings restores full-width Sat/Sun columns', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const toggle = page.getByRole('switch', { name: 'Minimise weekends' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true') // default on

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const header = page.getByRole('columnheader', { name: 'Dates' })

    // Weekends now read Sat/Sun, and nothing is collapsed to "S".
    await expect(header.getByText('Sat', { exact: true }).first()).toBeVisible()
    await expect(header.getByText('Sun', { exact: true }).first()).toBeVisible()
    await expect(header.getByText('S', { exact: true })).toHaveCount(0)

    // Weekend and weekday columns are now the same width.
    const weekend = await box(header.getByText('Sat', { exact: true }).first().locator('..'))
    const weekday = await box(header.getByText('Wed', { exact: true }).first().locator('..'))
    expect(Math.abs(weekend.width - weekday.width)).toBeLessThan(2)
  })

  test('the choice survives a reload (device-global pref)', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    await page.getByRole('switch', { name: 'Minimise weekends' }).click() // → off
    await page.reload()
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('switch', { name: 'Minimise weekends' })).toHaveAttribute('aria-checked', 'false')
  })

  test('a 1-week zoom shows ~1 week (weekend-aware fit), not ~1.5', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await openApp(page) // minimise on by default
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const { visibleDays } = await probe(page)
    // With the fit, the working week fills the viewport: ~7 days. The narrow-weekend under-fill
    // bug showed ~11–12. A 2-week zoom of the same width would show ~14, so <=9 pins "~1 week".
    expect(visibleDays).toBeGreaterThanOrEqual(6)
    expect(visibleDays).toBeLessThanOrEqual(9)
  })

  test('zoom flips preserve the left-edge date (no drift onto the weekend)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '1w', exact: true }).click()
    // Read `before` only once the 1w zoom-click scroll has come to rest, so it's the real settled
    // Monday and not a transient mid-scroll cell (which the equality below would then chase forever).
    const before = await settledLeftDate(page)
    // Round-trip the zoom; the integer-pixel geometry must round-trip the left-edge date exactly.
    await page.getByRole('button', { name: '2w', exact: true }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()
    // After the flip settles, the left-edge date must return to `before` (the known-correct value),
    // so a genuinely drifted grid times out and fails — not vacuous. Replaces the bare single read
    // that flaked under parallel load on Firefox/WebKit.
    await expect.poll(async () => settledLeftDate(page), { timeout: 15_000 }).toBe(before)
    // And it must be a weekday (the focused Monday), never drifted back onto the narrow "S" weekend.
    expect(before).not.toMatch(/S$/)
  })

  test('a bar dragged across the narrowed weekend commits a later date (no crash)', async ({ page }) => {
    await openApp(page) // minimise on by default
    await page.getByRole('button', { name: '1w', exact: true }).click()

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await bar.click()
    let dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    const startBefore = await dialog.getByLabel('Start Date', { exact: true }).inputValue()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // Drag the body well to the right — far enough to cross the narrow Sat/Sun columns.
    const b0 = await box(bar)
    const cy = b0.y + b0.height / 2
    await page.mouse.move(b0.x + b0.width / 2, cy)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 + 300, cy, { steps: 10 })
    await page.mouse.up()

    await bar.click()
    dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    const startAfter = await dialog.getByLabel('Start Date', { exact: true }).inputValue()
    expect(startAfter > startBefore).toBe(true) // ISO dates sort chronologically
  })

  // Feature 1's navigation snap (zoom / Prev-Next / date-picker) re-anchors the left edge to the week
  // start. A pure RESIZE and a minimise-weekends TOGGLE both re-fit the day width WITHOUT a zoom or a
  // day-range change — so the snap=false branch must run: the left-edge DATE is preserved exactly, not
  // floored to a Monday. We turn the F2 free-scroll snap OFF first so its idle snap can't masquerade
  // as a navigation snap and mask a regression. The nudge lands on a mid-week WEEKDAY ("…Wed"/"…Thu")
  // so a (wrong) Monday-snap would be plainly visible as a changed date.
  test('a pure resize preserves the mid-week left-edge date (no navigation snap)', async ({ page }) => {
    await openWithFreeScrollSnapOff(page)

    await nudge(page, 2.5) // → a mid-week weekday
    const leftDate = (await probe(page)).leftDate
    expect(leftDate).not.toMatch(/Mon$/) // sanity: parked mid-week, so a Monday-snap would change it

    // A pure resize re-fits dayWidth but changes neither zoom nor day-range → snap must NOT fire.
    await page.setViewportSize({ width: 1180, height: 800 })

    // Let the refit (rAF) fully settle past the free-scroll idle window so a (wrong) snap WOULD have
    // landed by now. A single post-settle read — NOT expect.poll, which would short-circuit on the
    // stale pre-resize value before the snap could fire and pass this no-change assertion vacuously.
    await page.waitForTimeout(400) // > WEEK_SNAP_IDLE_MS (120ms) + the refit frame
    expect((await probe(page)).leftDate).toBe(leftDate) // exact date unchanged (no snap to Monday)
  })

  // The same snap=false (preserve-exact-date) branch, but with "Minimise weekends" OFF — proving the
  // navigation snap is gated on a zoom/pan, NOT on the minimise geometry. We flip minimise off FIRST
  // (a Settings round-trip remounts the grid and recentres it to the focus Monday — that's mount
  // behaviour, separate from the snap branch under test), THEN nudge to a mid-week WEEKDAY and do a
  // pure in-component RESIZE: a refit that is neither a zoom nor a pan must preserve the exact date.
  test('with minimise OFF, a pure resize still preserves the mid-week left-edge date (no snap)', async ({ page }) => {
    await openWithFreeScrollSnapOff(page)

    // Turn minimise weekends off (so this exercises the OTHER geometry), then return to the grid.
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('switch', { name: 'Minimise weekends' }).click()
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()

    await nudge(page, 2.5) // → a mid-week weekday
    const leftDate = (await probe(page)).leftDate
    expect(leftDate).not.toMatch(/Mon$/) // sanity: parked mid-week

    // A pure resize re-fits dayWidth without a zoom/day-range change → snap must NOT fire.
    await page.setViewportSize({ width: 1180, height: 800 })

    // Let the refit (rAF) fully settle past the free-scroll idle window so a (wrong) snap WOULD have
    // landed by now. A single post-settle read — NOT expect.poll, which would short-circuit on the
    // stale pre-resize value before the snap could fire and pass this no-change assertion vacuously.
    await page.waitForTimeout(400) // > WEEK_SNAP_IDLE_MS (120ms) + the refit frame
    expect((await probe(page)).leftDate).toBe(leftDate) // exact mid-week date preserved (no Monday-floor)
  })
})
