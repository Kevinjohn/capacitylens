import { test, expect } from "./fixtures";
import {
  boundingBoxOrThrow as box,
  disableWeekSnap,
  nudgeScheduler as nudge,
  openApp,
  probeSchedulerGeometry as probe,
  settledSchedulerLeftDate as settledLeftDate,
  setZoom,
  waitForWeekSnap,
} from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Turn the free-scroll week snap off (a test-only override) and land on the Schedule at 1w. With the
// free-scroll snap off, a mid-week nudge sticks, so any later left-edge move is attributable to the
// thing under test (a resize / a minimise toggle), and we can prove that thing does not snap.
async function openWithFreeScrollSnapOff(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 800 });
  await disableWeekSnap(page);
  await openApp(page);
  await setZoom(page, 1);
}

// Covers US-SET-05. "Minimise weekends" (device-global, default on) shrinks the
// Sat/Sun columns to a sliver and labels both "S"; off restores full-width Sat/Sun columns.
// All label assertions are scoped to the date header (role=columnheader "Dates") so a stray
// "S" elsewhere (e.g. an avatar initial) can't match. 1w zoom = the widest, clearest columns.
function registerDefaultWeekendColumnsNarrowLabelledTest() {
  test('ON by default: weekend columns are narrow and labelled "S"', async ({ page }) => {
    await openApp(page);
    await setZoom(page, 1);
    const header = page.getByRole("columnheader", { name: "Dates" });

    expect(await header.getByText("Wed", { exact: true }).count()).toBeGreaterThan(0);
    expect(await header.getByText("S", { exact: true }).count()).toBeGreaterThanOrEqual(2);
    await expect(header.getByText("Sat", { exact: true })).toHaveCount(0);
    await expect(header.getByText("Sun", { exact: true })).toHaveCount(0);

    const weekend = await box(header.getByText("S", { exact: true }).first().locator(".."));
    const weekday = await box(header.getByText("Wed", { exact: true }).first().locator(".."));
    expect(weekend.width).toBeLessThan(weekday.width);
  });
}

// WCAG 2.5.8 (Target Size, AA): the preference switch must be at least 24 by 24 pixels.
// SettingsView.test.tsx can only assert the h-6 class (jsdom runs no layout), so this measures the
// real rendered geometry the build ships, a class rename that drops below 24px is caught here.
function registerPreferenceSwitchRendersLeast24pxTest() {
  test("the preference switch renders at least 24px tall (WCAG 2.5.8 target size)", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    const sw = page.getByRole("switch", { name: "Minimise weekends" });
    const b = await box(sw);
    expect(b.height).toBeGreaterThanOrEqual(24);
    expect(b.width).toBeGreaterThanOrEqual(24);
  });
}

function registerTogglingOffSettingsRestoresFullTest() {
  test("toggling it off in Settings restores full-width Sat/Sun columns", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    const toggle = page.getByRole("switch", { name: "Minimise weekends" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);
    const header = page.getByRole("columnheader", { name: "Dates" });

    await expect(header.getByText("Sat", { exact: true }).first()).toBeVisible();
    await expect(header.getByText("Sun", { exact: true }).first()).toBeVisible();
    await expect(header.getByText("S", { exact: true })).toHaveCount(0);

    const weekend = await box(header.getByText("Sat", { exact: true }).first().locator(".."));
    const weekday = await box(header.getByText("Wed", { exact: true }).first().locator(".."));
    expect(Math.abs(weekend.width - weekday.width)).toBeLessThan(2);
  });
}

function registerChoiceSurvivesReloadDeviceGlobalTest() {
  test("the choice survives a reload (device-global pref)", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("switch", { name: "Minimise weekends" }).click();
    await page.reload();
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole("button", { name: "Wayne Enterprises", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Minimise weekends" })).toHaveAttribute("aria-checked", "false");
  });
}

function registerZoomFitsSelectedWeeksExposingTest() {
  test("every zoom fits its selected weeks without exposing a trailing day", async ({ page }) => {
    // Keep even the 8-week zoom above the per-day-column threshold so the probe can count the
    // same date cells shown in the wide-screen reproduction screenshots.
    await page.setViewportSize({ width: 1920, height: 800 });
    await openApp(page);
    for (const weeks of [1, 2, 4, 6, 8] as const) {
      await setZoom(page, weeks);
      const { visibleDays } = await probe(page);
      expect(visibleDays, `${weeks}-week zoom`).toBe(weeks * 7);
    }
  });
}

function registerZoomFlipsPreserveLeftEdgeTest() {
  test("zoom flips preserve the left-edge date (no drift onto the weekend)", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 1);
    // Read `before` only once the 1w zoom-click scroll has come to rest, so it's the real settled
    // Monday and not a transient mid-scroll cell (which the equality below would then chase forever).
    const before = await settledLeftDate(page);
    // Round-trip the zoom; the integer-pixel geometry must round-trip the left-edge date exactly.
    await setZoom(page, 2);
    await setZoom(page, 1);
    // Poll for the captured left-edge date so genuine drift times out instead of passing on an unsettled frame.
    await expect.poll(async () => settledLeftDate(page), { timeout: 15_000 }).toBe(before);
    // And it must be a weekday (the focused Monday), never drifted back onto the narrow "S" weekend.
    expect(before).not.toMatch(/S$/);
  });
}

function registerBarDraggedAcrossNarrowedWeekendTest() {
  test("a bar dragged across the narrowed weekend commits a later date (no crash)", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 1);

    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await bar.click();
    let dialog = page.getByRole("dialog", { name: "Edit allocation" });
    const startBefore = await dialog.getByLabel(/^Start Date/).inputValue();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    const b0 = await box(bar);
    const cy = b0.y + b0.height / 2;
    await page.mouse.move(b0.x + b0.width / 2, cy);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 300, cy, { steps: 10 });
    await page.mouse.up();

    await bar.click();
    dialog = page.getByRole("dialog", { name: "Edit allocation" });
    const startAfter = await dialog.getByLabel(/^Start Date/).inputValue();
    expect(startAfter > startBefore).toBe(true);
  });
}

// Resize and weekend minimisation must preserve the exact left-edge date. Disable idle snapping so it cannot mask navigation snapping.
function registerPureResizePreservesMidWeekTest() {
  test("a pure resize preserves the mid-week left-edge date (no navigation snap)", async ({ page }) => {
    await openWithFreeScrollSnapOff(page);

    await nudge(page, 2.5);
    const leftDate = (await probe(page)).leftDate;
    expect(leftDate).not.toMatch(/Mon$/);

    await page.setViewportSize({ width: 1180, height: 800 });

    // Let the refit (rAF) fully settle past the free-scroll idle window so a (wrong) snap would have
    // landed by now. A single post-settle read, not expect.poll, which would short-circuit on the
    // stale pre-resize value before the snap could fire and pass this no-change assertion vacuously.
    await waitForWeekSnap(page);
    expect((await probe(page)).leftDate).toBe(leftDate);
  });
}

// The same snap=false (preserve-exact-date) branch, but with "Minimise weekends" off, proving the
// navigation snap is gated on a zoom/pan, not on the minimise geometry. We flip minimise off first
// (a Settings round-trip remounts the grid and recentres it to the focus Monday, that's mount
// behaviour, separate from the snap branch under test), then nudge to a mid-week weekday and do a
// pure in-component resize: a refit that is neither a zoom nor a pan must preserve the exact date.
function registerMinimiseOFFPureResizeStillTests() {
  test("with minimise OFF, a pure resize still preserves the mid-week left-edge date (no snap)", async ({ page }) => {
    await openWithFreeScrollSnapOff(page);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Minimise weekends" }).click();
    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 1);

    await nudge(page, 2.5);
    const leftDate = (await probe(page)).leftDate;
    expect(leftDate).not.toMatch(/Mon$/);

    await page.setViewportSize({ width: 1180, height: 800 });

    // Let the refit (rAF) fully settle past the free-scroll idle window so a (wrong) snap would have
    // landed by now. A single post-settle read, not expect.poll, which would short-circuit on the
    // stale pre-resize value before the snap could fire and pass this no-change assertion vacuously.
    await waitForWeekSnap(page);
    expect((await probe(page)).leftDate).toBe(leftDate);
  });
}

test.describe("Minimise weekends", () => {
  registerDefaultWeekendColumnsNarrowLabelledTest();
  registerPreferenceSwitchRendersLeast24pxTest();
  registerTogglingOffSettingsRestoresFullTest();
  registerChoiceSurvivesReloadDeviceGlobalTest();
  registerZoomFitsSelectedWeeksExposingTest();
  registerZoomFlipsPreserveLeftEdgeTest();
  registerBarDraggedAcrossNarrowedWeekendTest();
  registerPureResizePreservesMidWeekTest();
  registerMinimiseOFFPureResizeStillTests();
});
