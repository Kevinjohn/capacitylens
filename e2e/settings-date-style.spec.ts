import { test, expect } from "./fixtures";
import { openApp } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Covers US-SET-17. The date-style preference (account-wide, default "day-month") governs how
// dates and ranges read across the app. This spec asserts the Settings control and one
// representative surface — the Time off list, whose weekday form reorders
// without losing its ordinal. Range collapsing itself is covered exhaustively in
// src/lib/dateDisplay.test.ts, so it is not re-asserted here through the browser.
test.describe("Settings — date style", () => {
  test("defaults to '9 Sep' and switching updates the control", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    const dayMonth = page.getByRole("radio", { name: "9 Sep", exact: true });
    const monthDay = page.getByRole("radio", { name: "Sep 9", exact: true });
    await expect(dayMonth).toHaveAttribute("aria-checked", "true");
    await expect(monthDay).toHaveAttribute("aria-checked", "false");

    await monthDay.click();
    await expect(monthDay).toHaveAttribute("aria-checked", "true");
    await expect(dayMonth).toHaveAttribute("aria-checked", "false");
  });

  test("switching to 'Sep 9' updates the Time off list's date reading", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("radio", { name: "Sep 9", exact: true }).click();

    await page.getByRole("link", { name: "Time off" }).click();
    const row = page
      .getByTestId("timeoff-group")
      .filter({ has: page.getByRole("heading", { name: "Bruce Wayne", exact: true }) })
      .getByTestId("timeoff-row")
      .first();
    // Weekday form always carries the ordinal; the style only reorders day/month — Bruce's first
    // seeded row reads "Wed Jun 10th" under 'month-day' and "Wed 10th Jun" under the default.
    await expect(row).toContainText("Wed Jun 10th");
  });

  test("reformats a collapsed range on the schedule", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("radio", { name: "Sep 9", exact: true }).click();

    await page.getByRole("link", { name: "Schedule", exact: true }).click();
    await page.getByRole("button", { name: "View Bruce Wayne's schedule" }).click();
    const sheet = page.getByRole("dialog", { name: "Bruce Wayne's schedule" });
    // The header's range collapses the repeated month at both styles; only the order moves, so
    // this is the assertion that would catch a call site left on a hand-built range.
    // "Jun" is a pin, not an accident: `freezeBrowserDate` (e2e/helpers.ts) holds the clock at
    // 2026-06-03, so a regression that rendered the window against the wrong month would show here.
    await expect(sheet.getByTestId("person-schedule-header")).toContainText(/Jun \d{1,2} – \d{1,2}/);
    await expect(sheet.getByTestId("person-schedule-header")).not.toContainText(/\d{1,2} – \d{1,2} Jun/);
  });
});
