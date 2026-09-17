import { expect, test } from "./fixtures";
import { openApp } from "./helpers";

test("reviews the four-week capacity ledger and filters available rows", async ({ page }) => {
  await openApp(page, "Wayne Enterprises");

  const capacityLink = page.getByRole("link", { name: "Overview" });
  await expect(capacityLink).toBeVisible();
  await expect(capacityLink).toHaveAttribute("href", "/overview");
  await capacityLink.click();

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Capacity across the next 4 weeks")).toBeVisible();
  const table = page.getByRole("table", { name: "Overview" });
  await expect(table.getByRole("columnheader")).toHaveCount(5);
  await expect(table.getByRole("columnheader", { name: "3 – 7 Jun" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "8 – 14 Jun" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "15 – 21 Jun" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "22 – 28 Jun" })).toBeVisible();

  await expect(page.getByRole("radio", { name: "Ledger" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Tentative" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Has availability" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Totals" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Tentative" }).click();
  await page.getByRole("button", { name: "Has availability" }).click();
  await expect(page.getByRole("button", { name: "Tentative" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Has availability" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Totals" }).click();
  await expect(page.getByRole("button", { name: "Totals" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("capacity-overview-totals-cell")).toHaveCount(4);

  await page.getByRole("radio", { name: "Load curve" }).click();
  await expect(page.getByRole("radio", { name: "Load curve" })).toHaveAttribute("aria-checked", "true");
  await expect(table.getByTestId("capacity-load-curve").first()).toBeVisible();

  await table.getByRole("button", { name: "View Bruce Wayne's schedule" }).click();
  await expect(page.getByRole("dialog", { name: "Bruce Wayne's schedule" })).toBeVisible();
  await expect(page.getByTestId("person-schedule-sheet")).toHaveCount(1);
});

test("shows twelve single weeks in a focusable table region without toolbar overflow", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("capacitylens/rotateHintDismissed", "1"));
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page, "Wayne Enterprises", "/overview");
  await page.getByRole("radio", { name: "12 weeks" }).click();
  await expect(page.getByText("Capacity across the next 12 weeks")).toBeVisible();

  const toolbar = page.getByTestId("capacity-overview-toolbar");
  const toolbarOverflow = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(toolbarOverflow.scrollWidth).toBeLessThanOrEqual(toolbarOverflow.clientWidth + 1);

  const region = page.getByTestId("capacity-overview-table-region");
  await expect(region).toHaveAttribute("tabindex", "0");
  await expect(region.getByRole("columnheader")).toHaveCount(13);
  await expect(region.getByRole("columnheader", { name: "29 Jun – 5 Jul" })).toBeAttached();
  await expect(region.getByRole("columnheader", { name: "17 – 23 Aug" })).toBeAttached();

  const regionOverflow = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(regionOverflow.scrollWidth).toBeGreaterThan(regionOverflow.clientWidth);
  await region.focus();
  await expect(region).toBeFocused();

  const initialScrollLeft = await region.evaluate((element) => element.scrollLeft);
  await region.press("ArrowRight");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(initialScrollLeft);

  for (let press = 0; press < 40; press += 1) await region.press("ArrowRight");
  const finalColumn = region.getByRole("columnheader", { name: "17 – 23 Aug" });
  const [regionBox, finalColumnBox] = await Promise.all([region.boundingBox(), finalColumn.boundingBox()]);
  expect(regionBox).not.toBeNull();
  expect(finalColumnBox).not.toBeNull();
  expect(finalColumnBox!.x).toBeGreaterThanOrEqual(regionBox!.x);
  // Sub-pixel table layout can round the last edge a fraction past the region; allow one pixel.
  expect(finalColumnBox!.x + finalColumnBox!.width).toBeLessThanOrEqual(regionBox!.x + regionBox!.width + 1);
});

test.describe("Overview layout stability", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const columnWidths = (page: import("@playwright/test").Page) =>
    page
      .getByRole("table", { name: "Overview" })
      .getByRole("columnheader")
      .evaluateAll((headers) => headers.map((header) => header.getBoundingClientRect().width));

  test("keeps every column width when Totals and the cell mode change", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/overview");
    const table = page.getByRole("table", { name: "Overview" });
    await expect(table).toBeVisible();
    const baseline = await columnWidths(page);
    expect(baseline[0]).toBeGreaterThanOrEqual(230);

    await page.getByRole("button", { name: "Totals" }).click();
    await expect(page.getByTestId("capacity-overview-totals-cell")).toHaveCount(4);
    expect(await columnWidths(page)).toEqual(baseline);

    await page.getByRole("radio", { name: "Load curve" }).click();
    await expect(table.getByTestId("capacity-load-curve").first()).toBeVisible();
    expect(await columnWidths(page)).toEqual(baseline);

    // Every totals cell shares one height: no figure wraps at this width.
    const totalsHeights = await page
      .getByTestId("capacity-overview-totals-cell")
      .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().height));
    expect(new Set(totalsHeights).size).toBe(1);
  });
});
