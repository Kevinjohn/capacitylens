import { expect, type Locator, type Page } from "@playwright/test";
import { WEEK_SNAP_IDLE_MS } from "../src/lib/schedulerConfig";

// The seed dataset lives in the first half of June 2026 — the over-allocated day is
// 3-4 June and every demo bar falls between 1-9 June. The scheduler is anchored to
// "today": the default origin snaps to the current week's Monday and the utilisation
// window runs forward from today. So once the real wall-clock drifts past that window
// the seeded bars scroll into the past and off-screen, and every spec that clicks,
// hovers or drags a seed bar (or asserts the 3-4 June over-marker) starts failing for
// reasons that have nothing to do with the code under test. Freeze Date/Date.now to a
// date inside the seed window so the suite is deterministic whenever it runs. Do not use
// Playwright's page.clock here: in Firefox it virtualises requestAnimationFrame too, and its
// timer pump can fire a pending scheduler scroll frame during React's Strict Mode layout-effect
// replay. Noon gives a wide margin against host/browser timezone offsets.
const FIXED_NOW = "2026-06-03T12:00:00";

/** Freeze only the browser's Date constructor and Date.now, leaving every timer API native. */
export async function freezeBrowserDate(page: Page): Promise<void> {
  await page.addInitScript((fixedNow) => {
    const NativeDate = Date;
    const fixedMs = new NativeDate(fixedNow).getTime();

    function FixedDate(this: Date, ...args: unknown[]) {
      if (!new.target) return new NativeDate(fixedMs).toString();
      return Reflect.construct(NativeDate, args.length ? args : [fixedMs], new.target);
    }

    Object.setPrototypeOf(FixedDate, NativeDate);
    FixedDate.prototype = NativeDate.prototype;
    Object.defineProperty(FixedDate, "name", { value: "Date" });
    Object.defineProperty(FixedDate, "now", { value: () => fixedMs });
    globalThis.Date = FixedDate as unknown as DateConstructor;
  }, FIXED_NOW);
}

/** Remove CSS motion before an assertion that reads rendered colours or geometry.
 *
 * `reducedMotion: 'reduce'` shortens the app's animations, but WebKit can briefly retain a
 * composited opacity frame after the animation reports as finished. Axe then samples the blended
 * frame and reports false low-contrast violations. Installing the override before opening the
 * animated surface and waiting for two paint frames makes those assertions deterministic without
 * weakening the accessibility rules being checked. */
export async function disableCssMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Choose an option through a ShadCN Select's visible listbox, by stored value or visible label. */
export async function selectShadOption(trigger: Locator, option: string | { label: string }): Promise<void> {
  await trigger.click();
  const content = trigger.page().locator('[data-slot="select-content"][data-state="open"]');
  if (typeof option === "string") {
    await content.locator(`[role="option"][data-value="${option}"]`).click();
  } else {
    await content.getByRole("option", { name: option.label, exact: true }).click();
  }
  // Don't hand back control until the popup has actually gone: while it is open Radix puts
  // `pointer-events: none` on the body, so the caller's very next click can silently miss.
  await expect(content).toHaveCount(0);
}

/** Set the schedule toolbar's "Weeks visible" dropdown. Centralised so every zoom-dependent spec
 *  goes through one locator. */
export async function setZoom(page: Page, weeks: 1 | 2 | 4 | 6 | 8): Promise<void> {
  await selectShadOption(page.getByRole("combobox", { name: "Weeks visible" }), String(weeks));
}

/** Reveal the schedule's secondary filter row when a flow needs one of its controls. */
export async function showScheduleFilters(page: Page): Promise<void> {
  const show = page.getByRole("button", { name: "Show filters" });
  const hide = page.getByRole("button", { name: "Hide filters" });
  await show.or(hide).first().waitFor();
  if (await show.isVisible()) await show.click();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
}

/** Re-anchor the schedule on the seeded week. `freezeBrowserDate` pins the clock to 2026-06-03,
 *  whose week start is 2026-06-01, so **Today** puts the seed week's Monday at the left edge. */
export async function goToSeedWeek(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Today", exact: true }).click();
}

/** Click through the once-per-device "What CapacityLens is" intro page if this load shows it
 *  (`capacitylens/introSeen` — skipped once dismissed). Waits for the intro's Continue button OR
 *  `landedOn`, whichever renders first, and clicks Continue only when the intro is up, so neither
 *  case hangs.
 *
 *  PITFALL (found by invite.auth.spec): `landedOn` must be a locator UNIQUE to the DESTINATION
 *  screen. A generic `role=main` / `<main>` locator also matches interstitial pages (the invite
 *  page renders its own main), so a main-based wait resolves BEFORE the navigation lands and the
 *  intro check races. In-app callers use the AppShell's `#main` landmark (the only id="main" in
 *  the tree and present on every route regardless of whether the Sidebar is expanded, in icon mode,
 *  or rendered as the mobile Sheet);
 *  flows that start OUTSIDE the shell first wait for destination navigation, then pass `#main`;
 *  invite previews can already contain the joined company's name before navigation. */
export async function dismissIntroIfPresent(page: Page, landedOn: Locator): Promise<void> {
  const introContinue = page.getByTestId("intro-continue");
  await introContinue.or(landedOn).first().waitFor();
  if (await introContinue.isVisible()) await introContinue.click();
}

// Multi-tenancy shows a full-screen account picker on every load (the active
// account is never persisted). Almost every spec wants to land in the app for
// the seeded company, so they navigate through `openApp` instead of `goto('/')`.
export async function openApp(page: Page, company = "Wayne Enterprises", path = "/"): Promise<void> {
  // Must precede goto so the app reads the frozen date on its first render.
  await freezeBrowserDate(page);
  await page.goto(path);
  // A cosmetic demo "fake sign-in" gate now precedes the company picker in the default
  // (auth-off) deploy. It is skipped once "signed in" (the flag persists), so wait for
  // whichever screen this load lands on, and click through the sign-in if it's up.
  const signIn = page.getByTestId("fake-sign-in");
  const companyButton = page.getByRole("button", { name: company, exact: true });
  await signIn.or(companyButton).first().waitFor();
  if (await signIn.isVisible()) await signIn.click();
  // The picker lists the seeded companies; the open button's accessible name is
  // exactly the company name (the Delete button is "Delete <company>").
  // Picking an account leaves the URL intact, so a deep link like `/resources`
  // still lands on that route once the tenant gate clears.
  await companyButton.click();
  // A post-login "What CapacityLens is" intro page now follows the company pick; click through it
  // if it's up. The "already in the app" sentinel is the AppShell's `#main` landmark (see
  // dismissIntroIfPresent's doc comment for why #main and not role=main or the nav link).
  await dismissIntroIfPresent(page, page.locator("#main"));
}

// A few specs (getting-started, onboarding) need a FRESH, empty company rather than one of the
// seeded ones, so they can't go through `openApp`'s "pick an existing company" step — they walk
// the picker's "New company" create form instead. That walk splits into two halves so a spec can
// inspect/interact with the open form (onboarding asserts its default fields and changes them)
// before filling in the name and submitting: `openNewCompanyForm` gets to the open form, and
// `createCompany` fills the name, submits, and clears the same post-create intro gate as `openApp`.
export async function openNewCompanyForm(page: Page): Promise<void> {
  // Must precede goto so the app reads the frozen date on its first render.
  await freezeBrowserDate(page);
  await page.goto("/");
  // Same cosmetic demo "fake sign-in" gate as `openApp`, ahead of the picker here too.
  const signIn = page.getByTestId("fake-sign-in");
  const newCompany = page.getByRole("button", { name: "New company" });
  await signIn.or(newCompany).first().waitFor();
  if (await signIn.isVisible()) await signIn.click();
  await newCompany.click();
}

/** Fill in the company name on an already-open create-company form (see `openNewCompanyForm`),
 *  submit it, and clear through to the app — including the same post-create intro gate as
 *  `openApp` — so callers land with `#main` visible. */
export async function createCompany(page: Page, name: string): Promise<void> {
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  const appMain = page.locator("#main");
  await dismissIntroIfPresent(page, appMain);
  await expect(appMain).toBeVisible();
}

/** Land in a brand-new empty company (through the fake-sign-in, picker create form, and intro
 *  gates) in one call, for specs that don't need to touch the create form itself. */
export async function openNewCompany(page: Page, name: string): Promise<void> {
  await openNewCompanyForm(page);
  await createCompany(page, name);
}

export interface SchedulerGeometryProbe {
  leftDate: string;
  leftWeekday: string;
  visibleDays: number;
  weekdayWidth: number;
}

/** Read settled scheduler geometry through semantic test hooks. Shared by every scroll/zoom spec so
 * sticky-column measurement, double-rAF settling and weekday-width selection cannot drift. */
export async function probeSchedulerGeometry(page: Page): Promise<SchedulerGeometryProbe> {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const grid = document.querySelector('[data-testid="scheduler-grid"]') as HTMLElement;
    const resourceHeader = document.querySelector('[data-testid="scheduler-resource-header"]') as HTMLElement;
    const dayTier = document.querySelector('[data-testid="scheduler-day-tier"]') as HTMLElement;
    const cells = dayTier ? Array.from(dayTier.children) : [];
    const gridRect = grid.getBoundingClientRect();
    const laneLeft = resourceHeader.getBoundingClientRect().right;
    const weekdayLabel = (cell: Element) => {
      const spans = cell.querySelectorAll("span");
      return (spans[spans.length - 1]?.textContent || "").trim();
    };
    let leftDate = "";
    let leftWeekday = "";
    let visibleDays = 0;
    let weekdayWidth = 0;
    for (const cell of cells) {
      const rect = (cell as HTMLElement).getBoundingClientRect();
      const label = weekdayLabel(cell);
      if (!leftDate && rect.right > laneLeft + 1) {
        leftDate = (cell.textContent || "").trim();
        leftWeekday = label;
      }
      if (rect.right > laneLeft && rect.left < gridRect.right) visibleDays += 1;
      if (!weekdayWidth && label.length === 3) weekdayWidth = rect.width;
    }
    return { leftDate, leftWeekday, visibleDays, weekdayWidth };
  });
}

export async function settledSchedulerLeftDate(page: Page): Promise<string> {
  const grid = page.getByTestId("scheduler-grid");
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const current = await grid.evaluate((node) => (node as HTMLElement).scrollLeft);
        const stable = current === last;
        last = current;
        return stable;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return (await probeSchedulerGeometry(page)).leftDate;
}

export async function nudgeScheduler(page: Page, columns: number): Promise<void> {
  const { weekdayWidth } = await probeSchedulerGeometry(page);
  await page.getByTestId("scheduler-grid").evaluate(
    (node, delta) => {
      (node as HTMLElement).scrollLeft += delta;
    },
    Math.round(weekdayWidth * columns),
  );
}

/** The month label covering the left edge of the visible timeline (e.g. "Jun 2026"). The date header
 * always renders EVERY month in the window, so `getByText("Jul 2026")` proves nothing about where
 * the window sits — this reads the month block that actually spans the first visible column. */
export async function schedulerLeftMonthLabel(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const header = document.querySelector('[role="columnheader"][aria-colindex="2"]') as HTMLElement;
    const resourceHeader = document.querySelector('[data-testid="scheduler-resource-header"]') as HTMLElement;
    const laneLeft = resourceHeader.getBoundingClientRect().right;
    const monthTier = header.firstElementChild as HTMLElement;
    for (const block of Array.from(monthTier.children)) {
      if (block.getBoundingClientRect().right > laneLeft + 1) return (block.textContent || "").trim();
    }
    return "";
  });
}

/** Leave the production idle timer plus layout/paint margin before asserting snap or no-snap. */
export async function waitForWeekSnap(page: Page): Promise<void> {
  await page.waitForTimeout(WEEK_SNAP_IDLE_MS + 280);
}
