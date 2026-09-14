import { expect, test } from "./fixtures";
import { openApp } from "./helpers";

test("reviews the fixed four-week capacity window and filters available rows", async ({ page }) => {
  await openApp(page, "Wayne Enterprises");

  const capacityLink = page.getByRole("link", { name: "Overview" });
  await expect(capacityLink).toBeVisible();
  await expect(capacityLink).toHaveAttribute("href", "/overview");
  await capacityLink.click();

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const table = page.getByRole("table", { name: "Overview" });
  await expect(table.getByRole("columnheader")).toHaveCount(5);
  await expect(table.getByRole("columnheader", { name: "3 – 7 Jun" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "8 – 14 Jun" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "15 – 21 Jun" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "22 – 28 Jun" })).toBeVisible();

  await expect(table.getByRole("row", { name: /All eligible people/ })).toHaveCount(0);
  await expect(table.getByText("Fully booked")).toHaveCount(0);
  await expect(table.getByText("Unavailable")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Show tentative" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Everyone" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Hide totals" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Hide tentative" }).click();
  await page.getByRole("radio", { name: "Has availability" }).click();
  await expect(page.getByRole("radio", { name: "Hide tentative" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Has availability" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Show totals" }).click();
  await expect(page.getByRole("radio", { name: "Show totals" })).toHaveAttribute("aria-checked", "true");

  await expect(page.getByRole("radio", { name: "Number", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Bar", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Bar", exact: true })).toHaveAttribute("aria-checked", "true");

  await table.getByRole("button", { name: "View Bruce Wayne's schedule" }).click();
  await expect(page.getByRole("dialog", { name: "Bruce Wayne's schedule" })).toBeVisible();
  await expect(page.getByTestId("person-schedule-sheet")).toHaveCount(1);
});

test("shows strategic periods in a focusable table region without toolbar overflow", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("capacitylens/rotateHintDismissed", "1"));
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page, "Wayne Enterprises");
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("radio", { name: "12 weeks" }).click();

  const toolbar = page.getByTestId("capacity-overview-toolbar");
  const toolbarOverflow = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(toolbarOverflow.scrollWidth).toBeLessThanOrEqual(toolbarOverflow.clientWidth + 1);

  const region = page.getByTestId("capacity-overview-table-region");
  await expect(region).toHaveAttribute("tabindex", "0");
  await expect(region.getByRole("columnheader")).toHaveCount(7);
  await expect(region.getByRole("columnheader", { name: "Weeks 5–8, 29 Jun – 26 Jul" })).toBeVisible();
  await expect(region.getByRole("columnheader", { name: "Weeks 9–12, 27 Jul – 23 Aug" })).toBeVisible();

  const regionOverflow = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(regionOverflow.scrollWidth).toBeGreaterThan(regionOverflow.clientWidth);
  await region.focus();
  await expect(region).toBeFocused();

  const initialScrollLeft = await region.evaluate((element) => element.scrollLeft);
  await region.press("ArrowRight");
  const afterArrowScrollLeft = await region.evaluate((element) => element.scrollLeft);
  expect(afterArrowScrollLeft).toBeGreaterThan(initialScrollLeft);

  for (let press = 0; press < 20; press += 1) await region.press("ArrowRight");
  const finalColumn = region.getByRole("columnheader", { name: "Weeks 9–12, 27 Jul – 23 Aug" });
  const [regionBox, finalColumnBox] = await Promise.all([region.boundingBox(), finalColumn.boundingBox()]);
  expect(regionBox).not.toBeNull();
  expect(finalColumnBox).not.toBeNull();
  expect(finalColumnBox!.x).toBeGreaterThanOrEqual(regionBox!.x);
  expect(finalColumnBox!.x + finalColumnBox!.width).toBeLessThanOrEqual(regionBox!.x + regionBox!.width);
});
