import { test, expect, type Locator, type Page } from "./fixtures";
import { goToSeedWeek, openApp, setZoom } from "./helpers";

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible element with geometry.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function lanePoint(page: Page, lane: Locator, date: string): Promise<{ x: number; y: number }> {
  const day = await centre(page.getByTestId("scheduler-day-tier").locator(`[data-date="${date}"]`));
  const laneBox = await lane.boundingBox();
  if (!laneBox) throw new Error("Expected a visible resource lane.");
  return { x: day.x, y: laneBox.y + laneBox.height / 2 };
}

async function expectBlockedStart(page: Page, lane: Locator, date: string): Promise<void> {
  const point = await lanePoint(page, lane, date);
  await page.mouse.move(point.x, point.y);
  await expect(lane.getByTestId("day-add-hint")).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("dialog", { name: "New allocation" })).toHaveCount(0);
}

test("sets global working days and gates schedule creation starts", async ({ page }, testInfo) => {
  await openApp(page, "Wayne Enterprises", "/settings");

  const weekdays = page.getByRole("group", { name: "Company working days" }).getByRole("checkbox");
  const table = page.getByRole("table", { name: "Company working days" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("columnheader")).toHaveText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  await expect(weekdays).toHaveCount(7);
  await expect
    .poll(() => weekdays.evaluateAll((controls) => controls.map((control) => control.id)))
    .toEqual([
      "account-working-day-1",
      "account-working-day-2",
      "account-working-day-3",
      "account-working-day-4",
      "account-working-day-5",
      "account-working-day-6",
      "account-working-day-0",
    ]);

  // Friday becomes globally unavailable; Saturday becomes globally available so Bruce's personal
  // Monday–Friday pattern is the independent reason that date remains blocked.
  await page.getByRole("checkbox", { name: "Friday" }).click();
  await page.getByRole("checkbox", { name: "Saturday" }).click();
  await page.screenshot({ path: testInfo.outputPath("global_working_days_settings.png") });

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await goToSeedWeek(page);

  const lane = page.locator('[data-resource-id="r-tyler"]');
  await expectBlockedStart(page, lane, "2026-06-05"); // globally non-working Friday
  await expectBlockedStart(page, lane, "2026-06-06"); // personally non-working Saturday
  await expectBlockedStart(page, lane, "2026-06-10"); // Bruce's holiday
  await page.screenshot({ path: testInfo.outputPath("global_working_days_schedule.png") });

  // An allowed Tuesday start may cross the holiday dates after it.
  const start = await lanePoint(page, lane, "2026-06-09");
  const end = await lanePoint(page, lane, "2026-06-12");
  await page.mouse.move(start.x, start.y);
  await expect(lane.getByTestId("day-add-hint")).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  const dialog = page.getByRole("dialog", { name: "New allocation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Start" })).toHaveValue("2026-06-09");
  await expect(dialog.getByRole("textbox", { name: "End" })).toHaveValue("2026-06-12");
});
