import { test, expect, type Locator, type Page } from "./fixtures";
import { goToSeedWeek, openApp, setZoom } from "./helpers";

function dated(lane: Locator, testId: string, date: string): Locator {
  return lane.locator(`[data-testid="${testId}"][data-date="${date}"]`);
}

async function expectBottomHalf(overlay: Locator, lane: Locator): Promise<void> {
  const [overlayBox, laneBox] = await Promise.all([overlay.boundingBox(), lane.boundingBox()]);
  expect(overlayBox).not.toBeNull();
  expect(laneBox).not.toBeNull();
  expect(Math.abs(overlayBox!.height * 2 - laneBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(overlayBox!.y - (laneBox!.y + laneBox!.height / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(overlayBox!.y + overlayBox!.height - (laneBox!.y + laneBox!.height))).toBeLessThanOrEqual(1);
}

async function expectFullHeight(overlay: Locator, lane: Locator): Promise<void> {
  const [overlayBox, laneBox] = await Promise.all([overlay.boundingBox(), lane.boundingBox()]);
  expect(overlayBox).not.toBeNull();
  expect(laneBox).not.toBeNull();
  expect(Math.abs(overlayBox!.height - laneBox!.height)).toBeLessThanOrEqual(1);
}

async function pointInBottomHalf(page: Page, lane: Locator, date: string): Promise<{ x: number; y: number }> {
  const [dayBox, laneBox] = await Promise.all([
    page.locator(`[data-date="${date}"]`).first().boundingBox(),
    lane.boundingBox(),
  ]);
  if (!dayBox || !laneBox) throw new Error("Expected visible day and lane geometry.");
  return { x: dayBox.x + dayBox.width / 2, y: laneBox.y + laneBox.height * 0.75 };
}

test("saved half days tint the lower cell while preserving schedule signals and creation", async ({
  page,
}, testInfo) => {
  await openApp(page, "Wayne Enterprises", "/resources");
  const bruce = page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" });
  await bruce.getByRole("button", { name: "Edit Bruce Wayne" }).click();
  const editor = page.getByRole("dialog", { name: "Edit resource" });
  await editor.getByRole("radio", { name: "Tuesday Half day" }).click();
  await editor.getByRole("radio", { name: "Wednesday Half day" }).click();
  await editor.getByRole("button", { name: "Save" }).click();

  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await setZoom(page, 1);
  await goToSeedWeek(page);

  const row = page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" });
  const lane = row.getByTestId("resource-lane");
  const overHalfDay = dated(lane, "half-day", "2026-06-03");
  await expect(overHalfDay).toBeVisible();
  await expect(overHalfDay).toHaveClass(/pointer-events-none/);
  await expect(overHalfDay).toHaveAttribute("aria-hidden", "true");
  await expectBottomHalf(overHalfDay, lane);
  await expect(dated(lane, "half-day", "2026-06-01")).toHaveCount(0); // ordinary full day
  const nonWorkingDay = dated(lane, "unavailable-day", "2026-06-06");
  await expect(nonWorkingDay).toBeVisible();
  await expectFullHeight(nonWorkingDay, lane);
  await expect(row).toContainText(/half working days\./);

  const marker = dated(lane, "over-marker", "2026-06-03");
  await expect(marker).toBeVisible();
  expect(
    await lane.evaluate((element) => {
      const overlay = element.querySelector('[data-testid="half-day"][data-date="2026-06-03"]');
      const markerElement = element.querySelector('[data-testid="over-marker"][data-date="2026-06-03"]');
      return Boolean(
        overlay && markerElement && overlay.compareDocumentPosition(markerElement) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("issue_316_half_day_light.png") });

  await setZoom(page, 2);
  await goToSeedWeek(page);
  const emptyHalfDay = dated(lane, "half-day", "2026-06-09");
  await expect(emptyHalfDay).toBeVisible();
  await expectBottomHalf(emptyHalfDay, lane);
  const timeOffDay = dated(lane, "unavailable-day", "2026-06-10");
  await expect(timeOffDay).toBeVisible();
  await expectFullHeight(timeOffDay, lane);
  await expect(dated(lane, "half-day", "2026-06-10")).toHaveCount(0); // time off stays fully unavailable
  await expect(lane.getByTestId("timeoff-block")).toContainText("Holiday");

  const point = await pointInBottomHalf(page, lane, "2026-06-09");
  await page.mouse.move(point.x, point.y);
  await expect(lane.getByTestId("day-add-hint")).toBeVisible();
  await page.mouse.click(point.x, point.y);
  const allocation = page.getByRole("dialog", { name: "New allocation" });
  await expect(allocation).toBeVisible();
  await expect(allocation.getByLabel("Start Date")).toHaveValue("2026-06-09");
  await expect(allocation.getByLabel(/^End/)).toHaveValue("2026-06-09");
  await allocation.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(dated(page.locator('[data-resource-id="r-tyler"]'), "half-day", "2026-06-09")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("issue_316_half_day_dark.png") });
});
