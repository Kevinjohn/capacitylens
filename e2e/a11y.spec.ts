import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openApp } from './helpers'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// Disable entrance animations so axe samples settled colours (mid-fade reads as
// false low-contrast). The app honours prefers-reduced-motion.
test.use({ reducedMotion: 'reduce' })

// Axe is the a11y oracle: getByRole proves an attribute exists, not that the
// structure/contrast is valid. This guards the whole a11y pass against regressions.
test('scheduler has no serious or critical accessibility violations', async ({ page }) => {
  await openApp(page)
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('scheduler in dark mode has no serious or critical violations', async ({ page }) => {
  // Dark is now an explicit preference (default is light), so seed the stored theme
  // rather than emulating the OS scheme — otherwise axe would sample the light palette.
  await page.addInitScript(() => localStorage.setItem('capacitylens/theme', 'dark'))
  await openApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

// Time-off draw mode recedes the work bars (dimmed neutral fill) and makes booked time-off
// glow. That re-skin must stay a11y-clean too: the receded bars and the amber glow are new
// colour treatments axe has never sampled. Studio North's seed carries one time-off block
// (Tyler Nix, 10-12 Jun); 4w + scrollLeft=0 brings both it and the work bars into view, the
// same way timeoff.spec proves the block renders.
async function openDrawMode(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  await page.getByRole('button', { name: '4w', exact: true }).click()
  await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
  await page.getByRole('button', { name: 'Time off', exact: true }).click()
  await expect(page.getByTestId('scheduler-grid')).toHaveAttribute('data-draw-mode', 'timeoff')
  // The toggle's pressed fill cross-fades (0.15s); let it settle so axe samples the final
  // brand-strong + white pairing, not a mid-fade blend that reads as false low-contrast.
  await page.waitForTimeout(350)
  await expect(page.getByTestId('allocation-bar').first()).toBeVisible()
  await expect(page.locator('[data-resource-id="r-tyler"]').getByTestId('timeoff-block')).toBeVisible()
}

test('scheduler in time-off draw mode has no serious or critical violations', async ({ page }) => {
  await openDrawMode(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('scheduler in time-off draw mode (dark) has no serious or critical violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('capacitylens/theme', 'dark'))
  await openDrawMode(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

// The allocation editor opens from INSIDE the scheduler's role="grid" (SchedulerGrid's
// `{modal && …}`). The shared Modal portals to <body> so its role="dialog" subtree is NOT a DOM
// descendant of the grid — an owned dialog would be axe-critical `aria-required-children` (a grid
// may only own row/rowgroup). This scan opens that editor and locks the portal in: a regression to
// inline rendering would re-nest the dialog under the grid and trip the critical in BOTH themes.
// Selector mirrors allocation.spec / accessibility.spec: the 'Wireframes' seed bar is visible at 4w
// with scroll reset; clicking it opens the "Edit allocation" dialog.
async function openAllocationEditor(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await page.getByRole('button', { name: '4w', exact: true }).click()
  await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
  // Robust open (it timed out once under parallel load): wait for the bar to actually be present and
  // visible before acting, scroll it into the viewport (it can sit under the sticky chrome at the
  // grid edge), then click. `force` is a last resort only if the normal click's actionability check
  // can't settle in time — the assertion intent (a non-portal regression trips axe-critical) is
  // unchanged; this just stops the open itself from flaking.
  const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' }).first()
  await expect(bar).toBeVisible()
  await bar.scrollIntoViewIfNeeded()
  try {
    await bar.click({ timeout: 5000 })
  } catch {
    // Under heavy parallel load the bar can be transiently covered by a hover popover / mid-scroll;
    // a forced click still exercises the same open path the assertion below verifies.
    await bar.click({ force: true })
  }
  await expect(page.getByRole('dialog', { name: 'Edit allocation' })).toBeVisible()
  await page.waitForTimeout(350) // let the entrance animation settle (mid-fade reads as false low-contrast)
}

test('the allocation editor modal has no serious or critical violations', async ({ page }) => {
  await openAllocationEditor(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('the allocation editor modal (dark) has no serious or critical violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('capacitylens/theme', 'dark'))
  await openAllocationEditor(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('a resource form modal has no serious or critical violations', async ({ page }) => {
  await openApp(page, 'Studio North', '/resources')
  await page.getByRole('button', { name: 'Add resource' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(350) // let the entrance animation settle (mid-fade colours read as false low-contrast)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

// A ConfirmDialog in DARK mode specifically: its `danger` confirm button is the only place the
// danger button variant shows, and dark is where a solid bg-danger + white ink fails WCAG AA
// (the dark --c-danger is a light coral, ~2.7:1). The variant uses capacitylens's AA-safe SOFT red
// pairing (bg-danger-soft + danger-soft-ink) instead; this scan locks that in so the button
// can't silently regress to the failing solid fill.
test('a confirm dialog (dark) danger button has no serious or critical violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('capacitylens/theme', 'dark'))
  await openApp(page, 'Studio North', '/clients')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // P2.5b: the row's destructive action archives; the confirm dialog's "Archive" button is still the
  // danger variant (ConfirmDialog renders confirm as danger regardless of label), so this scan covers it.
  await page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' }).getByRole('button', { name: 'Archive Acme Inc.' }).click()
  const dialog = page.getByRole('dialog', { name: 'Archive client?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Archive', exact: true })).toBeVisible() // the danger-variant confirm button
  await page.waitForTimeout(350) // let the entrance animation settle (mid-fade colours read as false low-contrast)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

// The EMPTY schedule renders the shared EmptyState inside a sticky role="row" > role="gridcell" — a
// new ARIA shape axe has never sampled (grid > row > gridcell must stay valid with no resources). A
// search that matches nobody is the simplest way to reach it; this locks in the structure + the
// card's contrast in both themes so the empty state can't silently regress.
test('the empty schedule has no serious or critical violations', async ({ page }) => {
  await openApp(page)
  await page.getByLabel('Search people').fill('zzznobody')
  await expect(page.getByTestId('scheduler-empty')).toBeVisible()
  await page.waitForTimeout(200)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('the empty schedule (dark) has no serious or critical violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('capacitylens/theme', 'dark'))
  await openApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('Search people').fill('zzznobody')
  await expect(page.getByTestId('scheduler-empty')).toBeVisible()
  await page.waitForTimeout(200)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

// WCAG 1.4.10 Reflow (AA): at 320 CSS px the scheduler CHROME (toolbar title/nav/zoom/draw row +
// filters row) must not force horizontal scrolling. Before the fix the primary row was a
// non-wrapping flex, so the controls packed past 320px and overflowed; adding flex-wrap lets it
// reflow into stacked lines. We scope the check to the toolbar container (scrollWidth <= clientWidth,
// +1px tolerance for subpixel rounding) — the timeline GRID below is legitimately 2-D scrolling data
// (exempt under 1.4.10), so it is deliberately NOT asserted here.
test('the scheduler toolbar reflows without horizontal scroll at 320px', async ({ page }) => {
  // 320×480 is the WCAG reflow target (320 CSS px wide). The 480 height keeps it PORTRAIT, so
  // pre-dismiss the session-scoped rotate hint (it covers the app on portrait phones) rather than
  // dodging it with a contrived landscape height — we want the real narrow-viewport toolbar.
  await page.addInitScript(() => sessionStorage.setItem('capacitylens/rotateHintDismissed', '1'))
  await page.setViewportSize({ width: 320, height: 480 })
  await openApp(page)
  const toolbar = page.getByTestId('scheduler-toolbar')
  await expect(toolbar).toBeVisible()
  const overflow = await toolbar.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  expect(overflow.scrollWidth, `toolbar overflows by ${overflow.scrollWidth - overflow.clientWidth}px at 320 CSS px`)
    .toBeLessThanOrEqual(overflow.clientWidth + 1)
})

// WCAG 2.4.11 Focus Not Obscured (Minimum, AA): a focused allocation bar must not be fully hidden
// behind the grid's sticky chrome (the two-tier date header on top, the utilisation column on the
// left). On focus the browser scrolls the bar into view; its scroll-margin (top tracks the header's
// REAL measured height via --sched-sticky-top, left = the leftColWidth constant) must stop it clear
// of BOTH. We force the obscured case: a SHORT viewport gives the few-row grid genuine vertical
// scroll range, then we scroll the grid to its far BOTTOM-RIGHT corner so the top-left seed bar
// (Tyler's first allocation — row 1, the timeline's earliest day) ends up off-screen ABOVE the
// header AND LEFT of the utilisation column. Focusing it must then scroll UP and LEFT to surface it
// clear of both. We assert (a) the focus actually MOVED the scroll (proving a scroll-into-view ran —
// without this the test false-passes on an already-visible bar) and (b) the bar's box clears the
// header bottom and the column right. All chrome dimensions are MEASURED from the DOM, never
// hardcoded, so the check tracks the header even as it grows with zoom/font-size — and FAILS if the
// reserved margin shrinks below the header's real height (verified by temporarily zeroing it).
test('a focused allocation bar is not obscured by the sticky header or left column', async ({ page }) => {
  // The Studio North seed has only a handful of rows, so at a tall desktop viewport the grid never
  // overflows VERTICALLY (maxScrollTop ≈ 0) and the header-obscured case can't be reached. A short
  // viewport forces vertical scroll range. 480px height keeps it portrait, so pre-dismiss the
  // session rotate hint (it would otherwise cover the grid). Width stays wide so the timeline still
  // scrolls horizontally past the bar.
  await page.addInitScript(() => sessionStorage.setItem('capacitylens/rotateHintDismissed', '1'))
  await page.setViewportSize({ width: 1000, height: 420 })
  await openApp(page)
  await page.getByRole('button', { name: '4w', exact: true }).click()
  const grid = page.getByTestId('scheduler-grid')
  await expect(grid).toBeVisible()

  // The top-left seed bar: Tyler Nix's first allocation (a-tyler-1, the Wireframes bar) is in the
  // FIRST resource row and starts on the timeline's earliest seeded day — so scrolling to the
  // bottom-right corner pushes it off-screen up AND left, and focusing it requires an upward +
  // leftward scroll-into-view (the exact path 2.4.11 governs). data-alloc-id is the stable hook.
  const bar = grid.locator('[data-alloc-id="a-tyler-1"]')
  await expect(bar).toBeVisible()

  // Scroll the grid to its far bottom-right corner so the target bar is fully obscured before focus.
  const before = await grid.evaluate((el) => {
    const g = el as HTMLElement
    g.scrollTop = g.scrollHeight
    g.scrollLeft = g.scrollWidth
    return { scrollTop: g.scrollTop, scrollLeft: g.scrollLeft }
  })
  await page.waitForTimeout(150) // let the row-virtualisation window settle after the jump
  // Sanity: the grid actually HAS scroll range on both axes (else the obscured case isn't set up).
  expect(before.scrollTop, 'grid must have vertical scroll range to obscure the bar behind the header').toBeGreaterThan(0)
  expect(before.scrollLeft, 'grid must have horizontal scroll range to obscure the bar behind the column').toBeGreaterThan(0)

  // Focus the bar (the real keyboard path) — the browser scrolls it into view, honouring its
  // scroll-margin so it lands clear of the sticky chrome.
  await bar.focus()
  await expect(bar).toBeFocused()
  await page.waitForTimeout(250) // let the focus-triggered scroll-into-view settle before measuring

  const after = await grid.evaluate((el) => ({ scrollTop: (el as HTMLElement).scrollTop, scrollLeft: (el as HTMLElement).scrollLeft }))
  // (a) Focusing must have CHANGED the scroll — proof a real scroll-into-view ran, so the
  //     header/left-column clearance below is genuinely exercised (not a no-op on an in-view bar).
  expect(after.scrollTop !== before.scrollTop || after.scrollLeft !== before.scrollLeft,
    `focus must scroll the bar into view (top ${before.scrollTop}→${after.scrollTop}, left ${before.scrollLeft}→${after.scrollLeft})`).toBe(true)

  // (b) Measure the sticky chrome from the DOM: the header is the grid's first role="row" (sticky
  //     top), the left column its role="columnheader" (sticky left). Their box edges are the
  //     obscuring lines the focused bar must sit clear of.
  const headerBox = (await grid.locator('[role="row"]').first().boundingBox())!
  const headerBottom = headerBox.y + headerBox.height
  const leftColBox = (await grid.locator('[role="columnheader"]').first().boundingBox())!
  const leftColRight = leftColBox.x + leftColBox.width
  const barBox = (await bar.boundingBox())!

  // The focused bar's top edge must clear the sticky header's bottom, and its left edge the sticky
  // column's right (1px subpixel tolerance). If either fails, the bar scrolled in behind the chrome —
  // which is exactly what happens if scroll-margin-top under-reserves the two-tier header's height.
  expect(barBox.y, `bar top ${barBox.y} is behind sticky header bottom ${headerBottom}`).toBeGreaterThanOrEqual(headerBottom - 1)
  expect(barBox.x, `bar left ${barBox.x} is behind sticky column right ${leftColRight}`).toBeGreaterThanOrEqual(leftColRight - 1)
})
