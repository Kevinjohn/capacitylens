import { test, expect } from "./fixtures";
import { openApp } from "./appEntrySupport";

test.describe("Demo lifecycle", () => {
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
});
