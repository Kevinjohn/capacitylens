import { test, expect } from "./fixtures";

test("app boots and renders its seeded company picker", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("company-role").first()).toBeVisible();
  await expect(page).toHaveTitle(/CapacityLens/);
});
