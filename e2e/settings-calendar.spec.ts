import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { openApp } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// These account values are captured at company creation and frozen thereafter. Settings presents
// them as a compact read-only summary; the server's 409 backstop remains in onboarding.db.spec.ts.
test.describe("Account options selected at creation", () => {
  test("vertically centres every section title with its help action", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    const titles = page.locator('[data-slot="card-title"] h2');
    const helpActions = page.locator('[data-slot="card-action"] button[aria-label^="About "]');
    const sectionCount = await titles.count();
    expect(sectionCount).toBeGreaterThan(0);
    await expect(helpActions).toHaveCount(sectionCount);

    for (let index = 0; index < sectionCount; index += 1) {
      const titleBox = await titles.nth(index).boundingBox();
      const helpBox = await helpActions.nth(index).boundingBox();
      expect(titleBox).not.toBeNull();
      expect(helpBox).not.toBeNull();

      const titleCentre = titleBox!.y + titleBox!.height / 2;
      const helpCentre = helpBox!.y + helpBox!.height / 2;
      expect(Math.abs(titleCentre - helpCentre)).toBeLessThanOrEqual(0.5);
    }
  });

  test("renders the four frozen values without disabled form controls", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");

    const heading = page.getByRole("heading", { name: "Account Options Selected at Creation" });
    const card = heading.locator('xpath=ancestor::*[@data-slot="card"]');
    await expect(card.getByRole("row", { name: "Company name Wayne Enterprises" })).toBeVisible();
    await expect(card.getByRole("row", { name: "Week starts on Monday" })).toBeVisible();
    await expect(card.getByRole("row", { name: "Time zone GMT (UTC+00:00)" })).toBeVisible();
    await expect(card.getByRole("row", { name: "Language English" })).toBeVisible();
    await expect(page.getByTestId("settings-language")).toHaveText("English");
    await expect(page.getByLabel("Company name")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Week starts on" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Time zone" })).toHaveCount(0);
  });

  test("opens the fuller frozen-value explanation from the question-mark action", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("button", { name: "About Account Options Selected at Creation" }).click();
    const dialog = page.getByRole("dialog", { name: "Account Options Selected at Creation" });
    await expect(dialog).toContainText(/cannot be changed here/i);
    await expect(dialog).toContainText(/sets which day starts the week/i);
  });

  test("Settings page passes axe accessibility check", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
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
  });
});
