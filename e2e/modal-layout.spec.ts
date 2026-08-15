import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { dismissLandscapeHint, openApp } from "./helpers";

async function expectCompactRows(dialog: Locator, expectedCount: number) {
  const rows = dialog.locator('[data-product-layout="label-control"]');
  await expect(rows).toHaveCount(expectedCount);
  for (const row of await rows.all()) {
    const rowBox = await row.boundingBox();
    const controlBox = await row.locator(":scope > :nth-child(2)").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    const controlStart = (controlBox!.x - rowBox!.x) / rowBox!.width;
    expect(controlStart).toBeGreaterThan(0.24);
    expect(controlStart).toBeLessThan(0.32);
  }
}

async function openDialog(page: Page, section: string, button: string, title: string, compactRows: number) {
  await page.getByRole("link", { name: section, exact: true }).click();
  await page.getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await expectCompactRows(dialog, compactRows);
  await dialog.getByRole("button", { name: "Cancel" }).click();
}

async function openStackedDialog(page: Page, section: string, button: string, title: string, compactRows: number) {
  // The sidebar is deliberately rail-only at this width. Navigate at desktop width, then exercise
  // the real dialog at 360px; the rotate hint has already been dismissed for this browser session.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("link", { name: section, exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title });
  const rows = dialog.locator('[data-product-layout="label-control"]');
  await expect(rows).toHaveCount(compactRows);
  for (const row of await rows.all()) {
    const rowBox = await row.boundingBox();
    const labelBox = await row.locator(":scope > :first-child").boundingBox();
    const controlBox = await row.locator(":scope > :nth-child(2)").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height);
    expect(controlBox!.x).toBeGreaterThanOrEqual(rowBox!.x - 1);
    expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await dialog.getByRole("button", { name: "Cancel" }).click();
}

test.describe("compact input modal layouts", () => {
  test("uses the Resource form's 25/75 rows across the six management flows", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("switch", { name: "Show external resources" }).click();

    await openDialog(page, "Resources", "Add external party", "Add external party", 2);
    await openDialog(page, "Disciplines", "Add discipline", "Add discipline", 2);
    await openDialog(page, "Clients", "Add client", "Add client", 3);
    await openDialog(page, "Projects", "Add project", "Add project", 4);
    await openDialog(page, "Activities", "Add activity", "Add activity", 3);
    await openDialog(page, "Time off", "Add time off", "Add time off", 5);
  });

  test("stacks and contains every scoped form at 360px", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("switch", { name: "Show external resources" }).click();
    await dismissLandscapeHint(page);

    await openStackedDialog(page, "Resources", "Add external party", "Add external party", 2);
    await openStackedDialog(page, "Disciplines", "Add discipline", "Add discipline", 2);
    await openStackedDialog(page, "Clients", "Add client", "Add client", 3);
    await openStackedDialog(page, "Projects", "Add project", "Add project", 4);
    await openStackedDialog(page, "Activities", "Add activity", "Add activity", 3);
    await openStackedDialog(page, "Time off", "Add time off", "Add time off", 5);
  });

  test("wraps a long label, stacks on a narrow screen, and preserves required-error association", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/clients");
    await page.getByRole("button", { name: "Add client" }).click();
    const dialog = page.getByRole("dialog", { name: "Add client" });
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
    const name = dialog.locator('input[type="text"]').first();
    const field = name.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
    const label = field.locator('[data-slot="field-label"]');

    await label.evaluate((element) => {
      element.textContent = "Vertraulicher vollständiger Kundenname";
    });
    const normalFieldBox = await field.boundingBox();
    const normalControlBox = await name.boundingBox();
    const normalLabelBox = await label.boundingBox();
    expect(normalFieldBox).not.toBeNull();
    expect(normalControlBox).not.toBeNull();
    expect(normalLabelBox).not.toBeNull();
    expect((normalControlBox!.x - normalFieldBox!.x) / normalFieldBox!.width).toBeGreaterThan(0.24);
    expect(normalLabelBox!.height).toBeGreaterThan(normalControlBox!.height);

    await dismissLandscapeHint(page);
    const narrowFieldBox = await field.boundingBox();
    const narrowControlBox = await name.boundingBox();
    const narrowLabelBox = await label.boundingBox();
    expect(narrowFieldBox).not.toBeNull();
    expect(narrowControlBox).not.toBeNull();
    expect(narrowLabelBox).not.toBeNull();
    expect(narrowControlBox!.y).toBeGreaterThanOrEqual(narrowLabelBox!.y + narrowLabelBox!.height);
    expect(Math.abs(narrowControlBox!.x - narrowFieldBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(narrowControlBox!.width - narrowFieldBox!.width)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);

    await dialog.getByRole("button", { name: "Save" }).click();
    const alert = dialog.getByRole("alert");
    const alertId = await alert.getAttribute("id");
    expect(alertId).toBeTruthy();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", alertId!);
    await expect(alert).toContainText(/name is required/i);
    await expect(dialog).toBeVisible();
  });
});
