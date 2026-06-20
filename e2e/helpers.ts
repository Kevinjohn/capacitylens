import type { Page } from '@playwright/test'

// The seed dataset lives in the first half of June 2026 — the over-allocated day is
// 3-4 June and every demo bar falls between 1-9 June. The scheduler is anchored to
// "today": the default origin snaps to the current week's Monday and the utilisation
// window runs forward from today. So once the real wall-clock drifts past that window
// the seeded bars scroll into the past and off-screen, and every spec that clicks,
// hovers or drags a seed bar (or asserts the 3-4 June over-marker) starts failing for
// reasons that have nothing to do with the code under test. Freeze the browser clock
// to a date inside the seed window so the suite is deterministic whenever it runs.
// `setFixedTime` pins only Date/now — timers (scroll, drag, popovers) keep running —
// and noon gives a wide margin against host/browser timezone offsets.
const FIXED_NOW = new Date('2026-06-03T12:00:00')

// Multi-tenancy shows a full-screen account picker on every load (the active
// account is never persisted). Almost every spec wants to land in the app for
// the seeded company, so they navigate through `openApp` instead of `goto('/')`.
export async function openApp(page: Page, company = 'Studio North', path = '/'): Promise<void> {
  // Must precede goto so the app reads the frozen date on its first render.
  await page.clock.setFixedTime(FIXED_NOW)
  await page.goto(path)
  // A cosmetic demo "fake sign-in" gate now precedes the company picker in the default
  // (auth-off) deploy. It is skipped once "signed in" (the flag persists), so wait for
  // whichever screen this load lands on, and click through the sign-in if it's up.
  const signIn = page.getByTestId('fake-sign-in')
  const companyButton = page.getByRole('button', { name: company, exact: true })
  await signIn.or(companyButton).first().waitFor()
  if (await signIn.isVisible()) await signIn.click()
  // The picker lists the seeded companies; the open button's accessible name is
  // exactly the company name (the Delete button is "Delete <company>").
  // Picking an account leaves the URL intact, so a deep link like `/resources`
  // still lands on that route once the tenant gate clears.
  await companyButton.click()
  // A post-login "What Floaty is" intro page now follows the company pick (once per device,
  // `floaty/introSeen`). It is skipped once dismissed, so wait for whichever screen this load
  // lands on — the intro, or (if already seen) the app proper — then click Continue through only
  // when the intro is up. Guarded exactly like the fake-sign-in above so neither case hangs.
  // The "already in the app" sentinel is the AppShell's `#main` landmark (it wraps the routed
  // Outlet and is the ONLY id="main" in the tree). It's viewport-AGNOSTIC: present on every route
  // and in both sidebar states — unlike the "Schedule" nav LINK, which a collapsed/small-viewport
  // sidebar replaces with aria-hidden `nav-rail-item` BUTTONS, so a link sentinel would hang there.
  const introContinue = page.getByTestId('intro-continue')
  const appMain = page.locator('#main')
  await introContinue.or(appMain).first().waitFor()
  if (await introContinue.isVisible()) await introContinue.click()
}
