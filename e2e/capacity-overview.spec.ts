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
