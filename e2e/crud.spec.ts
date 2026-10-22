import { test, expect } from "./fixtures";
import { openApp } from "./browserTestSupport";

test.describe("CRUD + demo lifecycle", () => {
  test("a project cannot be saved without a client", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Projects" }).click();
    await page.getByRole("button", { name: "Add project" }).click();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Clientless Project");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("alert")).toContainText(/must belong to a client/i);
  });

  test("adding a client is intentionally reset by a demo reload", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Persisted Client");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Persisted Client")).toBeVisible();

    // The zero-setup demo is memory-only; reload restores the canonical seed.
    await page.waitForTimeout(500);
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByText("Persisted Client")).toHaveCount(0);
  });

  test("exports the dataset and re-imports it (round-trip)", async ({ page }) => {
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("RoundTrip Co");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("RoundTrip Co")).toBeVisible();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Import and export", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-data").click();
    const file = await (await downloadPromise).path();

    await page.waitForTimeout(400);
    // Reload restores the demo seed because account data is intentionally memory-only.
    await page.evaluate(() => localStorage.clear());
    await openApp(page);
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByText("RoundTrip Co")).toHaveCount(0);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Import and export", exact: true }).click();
    await page.getByTestId("import-input").setInputFiles(file);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alertdialog", { name: "Import data?" })).toBeVisible();
    await page.getByRole("button", { name: "Replace data" }).click();
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page.getByText("RoundTrip Co")).toBeVisible();
  });
});
