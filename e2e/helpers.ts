import { expect, type Locator, type Page } from '@playwright/test'

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

// KNOWN HARNESS GAP (deliberate, low priority): the suite has NO global `page.on('pageerror')`
// / `console.error` gate, so a route that throws but still renders the element a spec asserts on
// could pass silently. In practice most specs assert specific post-nav content, so a hard crash
// (which drops to the ErrorBoundary) already fails them — the gap is only the narrow "threw but
// the asserted node happened to render anyway" case. We do NOT close it with a naive listener:
// (1) it would have to be a `test.extend` fixture and all 45 spec files import `{ test }` straight
// from '@playwright/test', so retrofitting is broad churn for a P4; and (2) a naive gate FLAKES on
// WebKit's benign dev-server "Importing a module script failed" chunk race (caught by the
// ErrorBoundary, absent from the prod bundle), so any real gate must allowlist that exact message,
// scoped to WebKit. If a route-crash regression ever slips through, THAT is the trigger to add the
// allowlisted fixture — not before.

/** Click through the once-per-device "What CapacityLens is" intro page if this load shows it
 *  (`capacitylens/introSeen` — skipped once dismissed). Waits for the intro's Continue button OR
 *  `landedOn`, whichever renders first, and clicks Continue only when the intro is up, so neither
 *  case hangs.
 *
 *  PITFALL (found by invite.auth.spec): `landedOn` must be a locator UNIQUE to the DESTINATION
 *  screen. A generic `role=main` / `<main>` locator also matches interstitial pages (the invite
 *  page renders its own main), so a main-based wait resolves BEFORE the navigation lands and the
 *  intro check races. In-app callers use the AppShell's `#main` landmark (the only id="main" in
 *  the tree, present on every route and in both sidebar states — unlike the "Schedule" nav LINK,
 *  which a collapsed/small-viewport sidebar replaces with aria-hidden `nav-rail-item` buttons);
 *  flows that start OUTSIDE the shell pass something only the destination shows (e.g. the joined
 *  company's name). */
export async function dismissIntroIfPresent(page: Page, landedOn: Locator): Promise<void> {
  const introContinue = page.getByTestId('intro-continue')
  await introContinue.or(landedOn).first().waitFor()
  if (await introContinue.isVisible()) await introContinue.click()
}

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
  // A post-login "What CapacityLens is" intro page now follows the company pick; click through it
  // if it's up. The "already in the app" sentinel is the AppShell's `#main` landmark (see
  // dismissIntroIfPresent's doc comment for why #main and not role=main or the nav link).
  await dismissIntroIfPresent(page, page.locator('#main'))
}

// A few specs (getting-started, onboarding) need a FRESH, empty company rather than one of the
// seeded ones, so they can't go through `openApp`'s "pick an existing company" step — they walk
// the picker's "New company" create form instead. That walk splits into two halves so a spec can
// inspect/interact with the open form (onboarding asserts its default fields and changes them)
// before filling in the name and submitting: `openNewCompanyForm` gets to the open form, and
// `createCompany` fills the name, submits, and clears the same post-create intro gate as `openApp`.
export async function openNewCompanyForm(page: Page): Promise<void> {
  // Must precede goto so the app reads the frozen date on its first render.
  await page.clock.setFixedTime(FIXED_NOW)
  await page.goto('/')
  // Same cosmetic demo "fake sign-in" gate as `openApp`, ahead of the picker here too.
  const signIn = page.getByTestId('fake-sign-in')
  const newCompany = page.getByRole('button', { name: 'New company' })
  await signIn.or(newCompany).first().waitFor()
  if (await signIn.isVisible()) await signIn.click()
  await newCompany.click()
}

/** Fill in the company name on an already-open create-company form (see `openNewCompanyForm`),
 *  submit it, and clear through to the app — including the same post-create intro gate as
 *  `openApp` — so callers land with `#main` visible. */
export async function createCompany(page: Page, name: string): Promise<void> {
  await page.getByLabel('Company name').fill(name)
  await page.getByRole('button', { name: 'Create company' }).click()
  const appMain = page.locator('#main')
  await dismissIntroIfPresent(page, appMain)
  await expect(appMain).toBeVisible()
}

/** Land in a brand-new empty company (through the fake-sign-in, picker create form, and intro
 *  gates) in one call, for specs that don't need to touch the create form itself. */
export async function openNewCompany(page: Page, name: string): Promise<void> {
  await openNewCompanyForm(page)
  await createCompany(page, name)
}
