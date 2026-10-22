import { test, expect } from "./fixtures";
import type { Page } from "./fixtures";
import { enableInlineActivityCreation, selectShadOption, setZoom } from "./browserTestSupport";
import { openApp } from "./appEntrySupport";

// Covers US-SCH-09 (weekend criteria): the per-day over-marker is weekend-aware. A bar that merely
// spans a weekend adds no over-marker; ignoring its working pattern turns those days red; and
// work on a time-off working day still flags (a real conflict, distinct from a spanned weekend).
//
// Seed bars live 1–9 June 2026 (clock frozen to 2026-06-03), so a fresh allocation Fri 12 → Mon 15
// June (spanning the empty weekend 13–14) collides with nothing. Clark Kent is Mon–Fri. Over-marker
// + unavailable-day cells render across the whole timeline DOM (absolutely positioned, both via the
// same `left: geom.x(i)`), so the counts and `style.left` comparisons below are scroll-independent.
// The spec drives the modal in the seed's default hourly scheduling mode (Start/End + Hours / day).
const clarkLane = (page: Page) => page.locator('[data-resource-id="r-nike"]');
const clarkOverMarkers = (page: Page) => clarkLane(page).getByTestId("over-marker");
// The inline `left` is the geom column offset, stable identity for "which day" a marker sits on.
const leftsOf = (loc: ReturnType<Page["locator"]>) =>
  loc.evaluateAll((els) => els.map((e) => (e as HTMLElement).style.left));

async function openScheduleWithInlineActivityCreation(page: Page) {
  await openApp(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await enableInlineActivityCreation(page);
  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 2);
}

function registerSpannedWeekendOverIgnoredWorkingTests() {
  test("a spanned weekend is not over; ignored working days and time off are", async ({ page }) => {
    await openScheduleWithInlineActivityCreation(page);

    await expect(clarkOverMarkers(page)).toHaveCount(0);
    const baseline = 0;

    await page.getByRole("button", { name: "Add allocation for Clark Kent" }).click();
    const create = page.getByRole("dialog", { name: "New allocation" });
    await selectShadOption(create.getByLabel("Project", { exact: true }), "p-acme");
    await create.getByLabel("New activity name").fill("Weekend Verify");
    await create.getByRole("button", { name: "Add activity" }).click();
    await create.getByLabel(/^Start/).fill("2026-06-12");
    await create.getByLabel(/^End/).fill("2026-06-15");
    // The 8-hour allocation matches Clark's daily capacity, so working days should not be over capacity.
    await selectShadOption(create.getByRole("combobox", { name: "Hours / day" }), "8");
    await page.getByRole("button", { name: "Save" }).click();

    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Weekend Verify" });
    await expect(bar).toBeVisible();

    await expect(clarkOverMarkers(page)).toHaveCount(baseline);
    const weekendAwareLefts = await leftsOf(clarkOverMarkers(page));

    // Ignore the personal working pattern → the two weekend days now carry work against 0 capacity → over.
    await bar.click();
    const edit = page.getByRole("dialog", { name: "Edit allocation" });
    await edit.getByRole("checkbox", { name: "Ignore working days" }).click();
    await expect(edit.getByText(/over capacity on 2 days/i)).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(clarkOverMarkers(page)).toHaveCount(baseline + 2);
    // Check marker positions as well as count: both new markers should sit on non-working weekend columns, the same
    // `left` as Clark's grey unavailable-day cells, so a regression that flagged Fri/Mon instead would
    // fail even though the count of 2 held.
    const ignoredWorkingDaysLefts = await leftsOf(clarkOverMarkers(page));
    const newWeekendLefts = ignoredWorkingDaysLefts.filter((l) => !weekendAwareLefts.includes(l));
    const unavailableLefts = await leftsOf(clarkLane(page).getByTestId("unavailable-day"));
    expect(newWeekendLefts).toHaveLength(2);
    expect(newWeekendLefts.every((l) => unavailableLefts.includes(l))).toBe(true);

    await bar.click();
    await page
      .getByRole("dialog", { name: "Edit allocation" })
      .getByRole("checkbox", { name: "Ignore working days" })
      .click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(clarkOverMarkers(page)).toHaveCount(baseline);

    await page.getByRole("link", { name: "Time off" }).click();
    await page.getByRole("button", { name: "Add time off" }).click();
    const timeOff = page.getByRole("dialog", { name: "Add time off" });
    await selectShadOption(timeOff.getByLabel("Resource"), {
      label: "Clark Kent",
    });
    await timeOff.getByLabel("Start").fill("2026-06-15");
    await timeOff.getByLabel("End").fill("2026-06-15");
    await page.getByRole("button", { name: "Save" }).click();

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(clarkOverMarkers(page)).toHaveCount(baseline + 1);
    // The single new over-marker should share the time-off block's column offset on Monday 15, not a weekend.
    //
    // Retry until the column geometry settles. We just navigated Time off → back to Schedule, which
    // remounts the grid; its `dayWidth` is derived from the measured container width, applied a tick
    // after first paint. WebKit lays the remounted grid out a frame later than Chromium/Firefox, so a
    // single `style.left` read here can catch the over-marker at an intermediate dayWidth before the
    // measure effect lands (the marker is on the right day throughout, only its px settles; the count
    // assertion above doesn't gate the pixel). toPass() re-reads both lefts each attempt, comparing
    // them from one settled snapshot because both re-render to the final geometry in lockstep. Chromium/
    // Firefox pass on the first attempt; a real wrong-day regression still fails the inner toEqual.
    await expect(async () => {
      const newTimeOffLefts = (await leftsOf(clarkOverMarkers(page))).filter((l) => !weekendAwareLefts.includes(l));
      const timeOffBlockLeft = await clarkLane(page)
        .getByTestId("timeoff-block")
        .first()
        .evaluate((e) => (e as HTMLElement).style.left);
      expect(newTimeOffLefts).toEqual([timeOffBlockLeft]);
    }).toPass();
  });
}

test.describe("Weekend over-marker", () => {
  registerSpannedWeekendOverIgnoredWorkingTests();
});
