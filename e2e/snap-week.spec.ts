import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 800 } })

// Read the leftmost visible date-header day cell: its WEEKDAY label (the "Mon"/"Tue"… suffix span)
// and the width of a weekday column (so a test can derive a deterministic, column-relative nudge).
// Scoped to the date header (role=columnheader "Dates") so a stray label elsewhere can't match.
// Mirrors minimise-weekends.spec.ts's probe(), but returns the weekday label rather than the
// concatenated cell text — the snap floors onto a *weekday boundary*, so the label is the oracle.
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    // Sample AFTER two animation frames so layout has settled to the current scrollLeft. Reading
    // header cell rects mid-relayout (heavy parallel load on Firefox widens that window) can pair a
    // stale, mid-timeline cell's text with a leftmost layout position and return a torn left-edge
    // value. The double-rAF lets the scroll/relayout settle before we measure. (Paired with the
    // expect.poll reads below, which retry until the value settles on the known-correct day.)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const grid = document.querySelector('[data-testid="scheduler-grid"]') as HTMLElement
    const header = document.querySelector('[role="columnheader"][aria-label="Dates"]') as HTMLElement
    const dayTier = header?.querySelector('.flex.flex-auto')
    const cells = dayTier ? Array.from(dayTier.children) : []
    const gridRect = grid.getBoundingClientRect()
    const laneLeft = gridRect.left + 256 // past the sticky left column
    // The weekday label is the cell's last <span> ("Mon"/"S"/…); the first is the date number.
    const weekdayLabel = (c: Element) => {
      const spans = c.querySelectorAll('span')
      return (spans[spans.length - 1]?.textContent || '').trim()
    }
    let leftWeekday = ''
    let leftDate = '' // full leftmost cell text, e.g. "1Mon" — its leading number is the DATE
    let weekdayWidth = 0
    for (const c of cells) {
      const r = (c as HTMLElement).getBoundingClientRect()
      const label = weekdayLabel(c)
      // First cell whose right edge clears the sticky column → the visible left edge.
      if (!leftWeekday && r.right > laneLeft + 1) {
        leftWeekday = label
        leftDate = (c.textContent || '').trim()
      }
      // Any weekday (3-letter label, NOT the narrowed "S" weekend) gives a representative width.
      if (!weekdayWidth && label.length === 3) weekdayWidth = r.width
    }
    return { leftWeekday, leftDate, weekdayWidth }
  })
}

// Wait until the grid's horizontal scroll has STOPPED moving, then read the settled left-edge date.
// The left-edge probe derives the date from header cell rects at the *current* scroll position, so
// sampling while a programmatic scroll (zoom re-anchor / idle snap) is still in flight returns the
// date of a transient position — a Monday one-to-three weeks off. Under heavy parallel load on
// Firefox/WebKit that window is wide enough that a plain poll on the date can keep sampling mid-
// scroll. Polling scrollLeft to a fixed point first guarantees we measure only at rest.
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

// Reset the horizontal scroll to a known week boundary (the focus Monday is flush at scrollLeft on
// open) and clear the rAF-quantized left-edge state, then nudge by a fixed number of weekday
// columns so the left edge would land mid-week. The nudge width is derived from a PROBED weekday
// column so it's resolution-independent (at 1w on a 1440 viewport the weekday columns are wide).
async function nudge(page: import('@playwright/test').Page, columns: number) {
  const { weekdayWidth } = await probe(page)
  const el = page.getByTestId('scheduler-grid')
  await el.evaluate((node, dx) => {
    ;(node as HTMLElement).scrollLeft += dx
  }, Math.round(weekdayWidth * columns))
}

// Covers US-SET-09. "Snap to week start" (device-global, default ON) floors the schedule's left
// edge back to the current week's first day after a FREE scroll settles, so a stray nudge can't
// park the view on a Tue/Wed. Off → the nudge sticks. Independent of Feature 1's always-on
// navigation snap (zoom / Prev-Next / date-picker), which is not under test here.
test.describe('Snap to week start', () => {
  test('the setting is on by default and persists across reload', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const toggle = page.getByRole('switch', { name: 'Snap to week start' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true') // default on

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await page.reload()
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('switch', { name: 'Snap to week start' })).toHaveAttribute('aria-checked', 'false')
  })

  test('with the setting ON, a stray scroll nudge snaps back to the week start', async ({ page }) => {
    await openApp(page) // snap on by default
    await page.getByRole('button', { name: '1w', exact: true }).click()

    // Pre-condition: the left edge opens flush on the week start (Monday, default weekStartsOn).
    // Poll, not a single read: under parallel load (Firefox especially) the zoom-click scroll +
    // header layout can still be settling on the first probe, sampling a transient sub-pixel
    // boundary that reads as the adjacent weekend column. Polling retries until it settles on the
    // known-correct Monday; a genuinely drifted grid never settles and times out (not vacuous).
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe('Mon')

    // Nudge ~2.5 weekday columns so the left edge would sit on a Wed/Thu.
    await nudge(page, 2.5)
    await page.waitForTimeout(300) // > WEEK_SNAP_IDLE_MS (120ms) + a frame, so the idle snap fires

    // The floor-snap has pulled the left edge back to this week's Monday.
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe('Mon')
  })

  test('the snap FLOORS to the current week (not NEAREST), even past the half-week', async ({ page }) => {
    await openApp(page) // snap on by default
    await page.getByRole('button', { name: '1w', exact: true }).click()

    // Pre-condition: the left edge opens flush on this week's Monday. Frozen clock 2026-06-03 (Wed),
    // week origin Monday 2026-06-01 → the leading day NUMBER here is "1". Read it only once the zoom-
    // click scroll has come to rest (settledLeftDate), so we capture the real Monday — not a transient
    // mid-scroll cell — and can prove the snap returns to the SAME Monday, not a different one.
    const mondayDate = await settledLeftDate(page) // "1Mon"
    expect(mondayDate).toMatch(/Mon$/)

    // Nudge 4.5 weekday columns forward → the left edge lands on a Fri (Jun 5), which is PAST the
    // half-week. A NEAREST implementation would round FORWARD to next Monday (Jun 8 → "8Mon"); a
    // correct FLOOR pulls BACK to this week's Monday (Jun 1 → "1Mon"). This is the distinguishing
    // case the old ~2.5-column (Wed) test couldn't make, since there floor == nearest.
    await nudge(page, 4.5)
    await page.waitForTimeout(300) // > WEEK_SNAP_IDLE_MS (120ms) + a frame, so the idle snap fires

    // The decisive assertion: SAME Monday date (floored back), NOT next Monday (rounded forward).
    // Poll the settled left edge onto the captured Monday — the floor-not-nearest oracle (it would
    // never settle to "1Mon" if the snap rounded forward to "8Mon"), so polling does not weaken it.
    await expect.poll(async () => settledLeftDate(page), { timeout: 15_000 }).toBe(mondayDate)
  })

  test('with a Sunday week-start, the free-scroll snap floors to Sunday (not a hardcoded Monday)', async ({ page }) => {
    // Switch the account week-start to Sunday, then open the schedule. With the snap ON, a free nudge
    // must floor onto a SUNDAY — guarding against a hardcoded-Monday floor. weekStartsOn is account
    // data; the snap pref is device-global (default ON), so we only flip the calendar radio here.
    await openApp(page, 'Studio North', '/settings')
    await page.getByRole('radio', { name: 'Sunday' }).click()
    await expect(page.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true')
    // Turn "Minimise weekends" OFF too: with it on, a week-start Sunday is a (collapsed) weekend
    // labelled "S", which is indistinguishable from a Saturday and makes the nudge column-width
    // probe unreliable. Off → the Sunday reads a full "Sun" and every column is the same width.
    await page.getByRole('switch', { name: 'Minimise weekends' }).click()

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()

    // The left edge now opens flush on a Sunday (the week start), not a Monday.
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe('Sun')

    // Nudge ~2.5 columns off the Sunday, let the idle settle, and confirm it floors back to Sunday.
    await nudge(page, 2.5)
    await page.waitForTimeout(300) // > WEEK_SNAP_IDLE_MS
    // Poll the settle on the known-correct Sunday (parallel-load Firefox can still be settling on a
    // single read); a grid that floored to the wrong day never settles here, so it isn't vacuous.
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe('Sun')
  })

  test('with the setting OFF, the nudge sticks (and so proves the nudge moves off Monday)', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const toggle = page.getByRole('switch', { name: 'Snap to week start' })
    await toggle.click() // → off
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()
    // Poll the open-flush precondition until the zoom-click scroll settles on Monday (parallel-load
    // Firefox can still be settling on a single read).
    await expect.poll(async () => (await probe(page)).leftWeekday).toBe('Mon')

    // Same nudge as the ON test — with the pref off it must STICK on the mid-week day. This
    // doubles as the proof that the nudge actually leaves Monday (otherwise the ON test is vacuous).
    await nudge(page, 2.5)
    await page.waitForTimeout(300) // > WEEK_SNAP_IDLE_MS — long enough that a snap WOULD have fired

    // A single post-settle read, NOT expect.poll: poll on a `not.toBe` would short-circuit on the
    // first transient non-Monday frame before any (wrong) snap could fire, passing vacuously.
    expect((await probe(page)).leftWeekday).not.toBe('Mon')
  })
})
