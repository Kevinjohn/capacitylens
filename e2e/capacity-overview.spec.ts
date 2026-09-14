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

test.describe("Overview bar geometry", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const GEOMETRY_TOLERANCE_PX = 0.01;
  const expectGeometry = (actual: number, expected: number) => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  };

  test("keeps each bar inset by 3px with 6px gaps between adjacent bars", async ({ page }) => {
    await openApp(page, "Wayne Enterprises");
    await page.getByRole("link", { name: "Overview" }).click();

    const table = page.getByRole("table", { name: "Overview" });
    await expect(table).toBeVisible();
    await page.getByRole("radio", { name: "Bar", exact: true }).click();

    const geometry = await table.locator('[aria-hidden="true"].inset-\\[3px\\]').evaluateAll((elements) =>
      elements.map((element) => {
        const cell = element.closest("td");
        const row = element.closest("tr");
        if (!cell || !row) throw new Error("Expected every bar wrapper to belong to a table cell and row");
        const wrapper = element.getBoundingClientRect();
        const cellBounds = cell.getBoundingClientRect();
        return {
          left: wrapper.left,
          right: wrapper.right,
          top: wrapper.top,
          bottom: wrapper.bottom,
          leftInset: wrapper.left - cellBounds.left,
          rightInset: cellBounds.right - wrapper.right,
          topInset: wrapper.top - cellBounds.top,
          bottomInset: cellBounds.bottom - wrapper.bottom,
          rowIndex: Array.from(row.parentElement?.children ?? []).indexOf(row),
          cellIndex: Array.from(row.cells).indexOf(cell),
          rowBorderBottom: Number.parseFloat(getComputedStyle(row).borderBottomWidth),
        };
      }),
    );

    expect(geometry.length).toBeGreaterThan(0);
    for (const bar of geometry) {
      expectGeometry(bar.leftInset, 3);
      expectGeometry(bar.rightInset, 3);
      // Collapsed table borders contribute half a pixel to the cell's bounding rect, so the
      // browser-measured vertical inset is 3px or 3.5px while the CSS inset remains 3px.
      expect(bar.topInset).toBeGreaterThanOrEqual(3 - GEOMETRY_TOLERANCE_PX);
      expect(bar.topInset).toBeLessThanOrEqual(3.5 + GEOMETRY_TOLERANCE_PX);
      expect(bar.bottomInset).toBeGreaterThanOrEqual(3 - GEOMETRY_TOLERANCE_PX);
      expect(bar.bottomInset).toBeLessThanOrEqual(3.5 + GEOMETRY_TOLERANCE_PX);
    }

    const firstRowIndex = geometry[0]?.rowIndex;
    const firstRowBars = geometry.filter(({ rowIndex }) => rowIndex === firstRowIndex);
    expect(firstRowBars.length).toBeGreaterThan(1);
    for (let index = 1; index < firstRowBars.length; index += 1) {
      expectGeometry(firstRowBars[index]!.left - firstRowBars[index - 1]!.right, 6);
    }

    const adjacentRows = geometry.find((bar) =>
      geometry.some((nextBar) => nextBar.rowIndex === bar.rowIndex + 1 && nextBar.cellIndex === bar.cellIndex),
    );
    if (!adjacentRows) throw new Error("Expected two adjacent table rows with capacity bars");
    const nextRowBar = geometry.find(
      (bar) => bar.rowIndex === adjacentRows.rowIndex + 1 && bar.cellIndex === adjacentRows.cellIndex,
    );
    if (!nextRowBar) throw new Error("Expected the adjacent row to contain a matching capacity bar");
    // The collapsed row divider is separate from the breathing room between bars.
    expectGeometry(nextRowBar.top - adjacentRows.bottom - adjacentRows.rowBorderBottom, 6);
  });
});
