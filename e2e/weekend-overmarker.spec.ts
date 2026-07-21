import { test, expect, type Page } from '@playwright/test'
import { openApp, selectShadOption } from './helpers'

// Covers US-SCH-09 (weekend criteria): the per-day over-marker is weekend-aware. A bar that merely
// SPANS a weekend adds no over-marker; opting the allocation into weekends turns those days red; and
// work on a TIME-OFF working day still flags (a real conflict, distinct from a spanned weekend).
//
// Seed bars live 1–9 June 2026 (clock frozen to 2026-06-03), so a fresh allocation Fri 12 → Mon 15
// June (spanning the empty weekend 13–14) collides with nothing. Nike Spiros is Mon–Fri. Over-marker
// + unavailable-day cells render across the whole timeline DOM (absolutely positioned, both via the
// SAME `left: geom.x(i)`), so the counts AND `style.left` comparisons below are scroll-independent.
// The spec drives the modal in the seed's default HOURLY scheduling mode (Start/End + Hours / day).
test.describe('Weekend over-marker', () => {
  const nikeLane = (page: Page) => page.locator('[data-resource-id="r-nike"]')
  const nikeOverMarkers = (page: Page) => nikeLane(page).getByTestId('over-marker')
  // The inline `left` is the geom column offset — stable identity for "which day" a marker sits on.
  const leftsOf = (loc: ReturnType<Page['locator']>) =>
    loc.evaluateAll((els) => els.map((e) => (e as HTMLElement).style.left))

  test('a spanned weekend is not over; include-weekends and time-off are', async ({ page }) => {
    await openApp(page)
    await page.getByRole('radio', { name: '2w', exact: true }).click()

    const baseline = await nikeOverMarkers(page).count() // Nike has no seed over-days

    // A fresh allocation spanning the weekend, default (weekend-aware).
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const create = page.getByRole('dialog', { name: 'New allocation' })
    await selectShadOption(create.getByLabel('Project', { exact: true }), 'p-acme')
    await create.getByLabel('New activity name').fill('Weekend Verify')
    await create.getByRole('button', { name: 'Add activity' }).click()
    await create.getByLabel(/^Start/).fill('2026-06-12') // Fri
    await create.getByLabel(/^End/).fill('2026-06-15') // Mon
    await create.getByLabel('Hours / day').fill('8') // exactly at capacity, so the working days are NOT over
    await page.getByRole('button', { name: 'Save' }).click()

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Weekend Verify' })
    await expect(bar).toBeVisible()

    // Sat 13 / Sun 14 are merely spanned → NOT over (no new marker).
    await expect(nikeOverMarkers(page)).toHaveCount(baseline)
    const weekendAwareLefts = await leftsOf(nikeOverMarkers(page))

    // Opt into weekends → the two weekend days now carry work against 0 capacity → over.
    await bar.click()
    const edit = page.getByRole('dialog', { name: 'Edit allocation' })
    await edit.getByText('Include weekends as working days').click()
    // The modal advisory must MIRROR the grid (not stay silent as it did before): Sat+Sun = 2 days.
    await expect(edit.getByText(/over capacity on 2 days/i)).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(nikeOverMarkers(page)).toHaveCount(baseline + 2)
    // POSITION (not just count): the two NEW markers sit on non-working (weekend) columns — the same
    // `left` as Nike's grey unavailable-day cells — so a regression that flagged Fri/Mon instead would
    // fail even though the count of 2 held.
    const includeWeekendsLefts = await leftsOf(nikeOverMarkers(page))
    const newWeekendLefts = includeWeekendsLefts.filter((l) => !weekendAwareLefts.includes(l))
    const unavailableLefts = await leftsOf(nikeLane(page).getByTestId('unavailable-day'))
    expect(newWeekendLefts).toHaveLength(2)
    expect(newWeekendLefts.every((l) => unavailableLefts.includes(l))).toBe(true)

    // Back to weekend-aware → the weekend clears again.
    await bar.click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByText('Include weekends as working days').click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(nikeOverMarkers(page)).toHaveCount(baseline)

    // Time off on Mon 15 (a working day the allocation covers) → still over (a real conflict).
    await page.getByRole('link', { name: 'Time off' }).click()
    await page.getByRole('button', { name: 'Add time off' }).click()
    const timeOff = page.getByRole('dialog', { name: 'Add time off' })
    await selectShadOption(timeOff.getByLabel('Resource'), { label: 'Nike Spiros' })
    await timeOff.getByLabel('Start').fill('2026-06-15')
    await timeOff.getByLabel('End').fill('2026-06-15')
    await page.getByRole('button', { name: 'Save' }).click()

    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(nikeOverMarkers(page)).toHaveCount(baseline + 1)
    // POSITION: the single new over-marker sits on the time-off day (Mon 15), not a weekend — assert
    // it shares the time-off block's column offset.
    //
    // Retry until the column geometry settles. We just navigated Time off → back to Schedule, which
    // REMOUNTS the grid; its `dayWidth` is derived from the MEASURED container width, applied a tick
    // after first paint. WebKit lays the remounted grid out a frame later than Chromium/Firefox, so a
    // single `style.left` read here can catch the over-marker at an intermediate dayWidth before the
    // measure effect lands (the marker is on the right DAY throughout — only its px settles; the count
    // assertion above doesn't gate the pixel). toPass() re-reads BOTH lefts each attempt, comparing
    // them from one settled snapshot — they re-render to the final geometry in lockstep. Chromium/
    // Firefox pass on the first attempt; a real wrong-day regression still fails the inner toEqual.
    await expect(async () => {
      const newTimeOffLefts = (await leftsOf(nikeOverMarkers(page))).filter((l) => !weekendAwareLefts.includes(l))
      const timeOffBlockLeft = await nikeLane(page).getByTestId('timeoff-block').first().evaluate((e) => (e as HTMLElement).style.left)
      expect(newTimeOffLefts).toEqual([timeOffBlockLeft])
    }).toPass()
  })
})
