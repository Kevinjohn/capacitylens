import { test, expect } from "./fixtures";

test("app boots and mounts the React root", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toBeVisible();
  await expect(page).toHaveTitle(/CapacityLens/);
});
