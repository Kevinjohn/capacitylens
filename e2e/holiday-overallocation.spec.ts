import { test, expect, type Locator, type Page } from "./fixtures";
import { openApp, resetSchedulerScroll, selectShadOption, setZoom } from "./helpers";

async function addTimeOff(page: Page, resource: string, start: string, end = start) {
  await page.getByRole("button", { name: "Add time off" }).click();
  const dialog = page.getByRole("dialog", { name: "Add time off" });
  await selectShadOption(dialog.getByLabel("Resource"), { label: resource });
  await dialog.getByLabel("Start").fill(start);
  await dialog.getByLabel("End").fill(end);
  await dialog.getByRole("button", { name: "Save" }).click();
}

async function markerOnFirstTimeOff(lane: Locator) {
  const block = lane.getByTestId("timeoff-block").first();
  const left = await block.evaluate((element) => (element as HTMLElement).style.left);
  const markers = lane.getByTestId("over-marker");
  const markerIndex = await markers.evaluateAll(
    (elements, expectedLeft) => elements.findIndex((element) => (element as HTMLElement).style.left === expectedLeft),
    left,
  );
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const marker = markers.nth(markerIndex);
  await expect(marker).toHaveClass(/bg-danger\/55/);

  const order = await lane.evaluate((element, expectedLeft) => {
    const blockElement = element.querySelector<HTMLElement>('[data-testid="timeoff-block"]');
    const markerElement = [...element.querySelectorAll<HTMLElement>('[data-testid="over-marker"]')].find(
      (candidate) => candidate.style.left === expectedLeft,
    );
    const barElement = element.querySelector<HTMLElement>('[data-testid="allocation-bar"]');
    if (!blockElement || !markerElement || !barElement) return null;
    return {
      blockBeforeMarker: Boolean(
        blockElement.compareDocumentPosition(markerElement) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      markerBeforeBar: Boolean(markerElement.compareDocumentPosition(barElement) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  }, left);
  expect(order).toEqual({ blockBeforeMarker: true, markerBeforeBar: true });
  return marker;
}

test("modal edits, drag and repeat creation show work on holiday as over allocation", async ({ page }, testInfo) => {
  await openApp(page);
  await page.getByRole("link", { name: "Time off" }).click();
  await addTimeOff(page, "Clark Kent", "2026-06-08", "2026-06-12");
  await addTimeOff(page, "Diana Prince", "2026-06-17");

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);

  const bruceLane = page.locator('[data-resource-id="r-tyler"]');
  const clarkLane = page.locator('[data-resource-id="r-nike"]');
  const dianaLane = page.locator('[data-resource-id="r-pam"]');

  // A holiday with no allocation is unavailable but not over capacity.
  await expect(dianaLane.getByTestId("timeoff-block")).toBeVisible();
  await expect(dianaLane.getByTestId("over-marker")).toHaveCount(0);

  // Route 1: edit an existing allocation's dates directly onto Bruce's seeded holiday.
  await bruceLane.getByTestId("allocation-bar").filter({ hasText: "Visual Design" }).click();
  const editor = page.getByRole("dialog", { name: "Edit allocation" });
  await editor.getByLabel("Start Date").fill("2026-06-10");
  await editor.getByLabel(/^End/).fill("2026-06-10");
  await editor.getByRole("button", { name: "Save" }).click();
  await markerOnFirstTimeOff(bruceLane);
  await page.screenshot({ path: testInfo.outputPath("issue_283_after.png") });

  // Route 2: drag Clark's existing five-day allocation directly onto his five-day holiday.
  const clarkBar = clarkLane.getByTestId("allocation-bar").filter({ hasText: "CMS Review" });
  const [barBox, holidayBox] = await Promise.all([
    clarkBar.boundingBox(),
    clarkLane.getByTestId("timeoff-block").boundingBox(),
  ]);
  expect(barBox).not.toBeNull();
  expect(holidayBox).not.toBeNull();
  const startX = barBox!.x + barBox!.width / 2;
  const y = barBox!.y + barBox!.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + holidayBox!.x - barBox!.x, y, { steps: 10 });
  await page.mouse.up();
  await markerOnFirstTimeOff(clarkLane);

  // Route 3: a generated weekly occurrence lands on Diana's holiday.
  await page.getByRole("button", { name: "Add allocation for Diana Prince" }).click();
  const create = page.getByRole("dialog", { name: "New allocation" });
  await selectShadOption(create.getByLabel("Project", { exact: true }), "p-acme");
  await selectShadOption(create.getByRole("combobox", { name: "Activity", exact: true }), "t-wires");
  await create.getByLabel("Start Date").fill("2026-06-10");
  await create.getByLabel(/^End/).fill("2026-06-10");
  await selectShadOption(create.getByRole("combobox", { name: "Repeat" }), "weekly");
  await create.getByLabel("Repeat until").fill("2026-06-17");
  await create.getByRole("button", { name: "Save" }).click();
  await markerOnFirstTimeOff(dianaLane);
  await expect(page.getByTestId("scheduler-row").filter({ hasText: "Diana Prince" })).toContainText(
    "Over capacity on 1 day.",
  );

  await page.screenshot({ path: testInfo.outputPath("issue_283_holiday_conflict.png") });

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await markerOnFirstTimeOff(page.locator('[data-resource-id="r-nike"]'));
  await page.screenshot({ path: testInfo.outputPath("issue_283_holiday_conflict_dark.png") });
});

test("editing a zero-load block onto time off shows the visible and non-colour conflict signals", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Time off" }).click();
  await addTimeOff(page, "Diana Prince", "2026-06-17");

  await page.getByRole("link", { name: "Settings" }).click();
  const blocks = page.getByRole("radio", { name: "Blocks", exact: true });
  await blocks.click();
  await expect(blocks).toHaveAttribute("aria-checked", "true");

  await page.getByRole("link", { name: "Schedule" }).click();
  await setZoom(page, 4);
  await resetSchedulerScroll(page);

  const bruceLane = page.locator('[data-resource-id="r-tyler"]');
  const clarkLane = page.locator('[data-resource-id="r-nike"]');
  const dianaLane = page.locator('[data-resource-id="r-pam"]');

  // Zero-load blocks on ordinary dates are clean, and time off without a block is not red.
  await expect(bruceLane.getByTestId("over-marker")).toHaveCount(0);
  await expect(clarkLane.getByTestId("over-marker")).toHaveCount(0);
  await expect(dianaLane.getByTestId("timeoff-block")).toBeVisible();
  await expect(dianaLane.getByTestId("over-marker")).toHaveCount(0);

  // Move a five-working-day block over Bruce's three-day holiday. Its date span also crosses his
  // personal weekend; only the three time-off dates are conflicts (#257 remains out of scope).
  await bruceLane.getByTestId("allocation-bar").filter({ hasText: "Visual Design" }).click();
  const editor = page.getByRole("dialog", { name: "Edit allocation" });
  await editor.getByLabel("Start Date").fill("2026-06-10");
  await editor.getByLabel("Days over").fill("5");
  await editor.getByRole("button", { name: "Save" }).click();

  await markerOnFirstTimeOff(bruceLane);
  await expect(bruceLane.getByTestId("over-marker")).toHaveCount(3);
  const bruceRow = page.getByTestId("scheduler-row").filter({ hasText: "Bruce Wayne" });
  await expect(bruceRow).toContainText("Over capacity on 3 days.");
  await expect(bruceRow.getByTestId("utilization")).toHaveText("0%");
  await expect(page.getByTestId("overall-utilization")).toHaveText("0%");
});
