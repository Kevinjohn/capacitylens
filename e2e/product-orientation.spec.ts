import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { freezeBrowserDate } from "./browserTestSupport";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// US-NAV-12: the demo opens on the company picker, and entering a company shows the non-blocking
// product orientation until Got it dismisses it.
test("picking a company shows the product orientation; Got it dismisses it", async ({ page }) => {
  await freezeBrowserDate(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
  await page.getByRole("button", { name: "Wayne Enterprises", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How CapacityLens works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking,
    JSON.stringify(
      blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      null,
      2,
    ),
  ).toEqual([]);

  // Dismissal removes the orientation itself; the surrounding app was already usable behind it,
  // so the schedule link is not evidence of the dismissal.
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("product-orientation")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How CapacityLens works" })).toHaveCount(0);
});
