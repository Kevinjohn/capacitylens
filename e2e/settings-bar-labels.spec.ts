import { test, expect } from "./fixtures";
import { openApp } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Covers US-SET-02. The bar label reads Client · Project · Activity; the two parts are
// device-global Settings toggles (Allocation bars section), both on by default.
test.describe("Allocation bar labels", () => {
  test("bars show client and project before the activity by default", async ({ page }) => {
    await openApp(page, "Wayne Enterprises");
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await expect(bar).toContainText("Queen Consolidated · Project Watchtower · Wireframes");
  });

  test("switches in Settings default on and strip the client, then the project, from bars", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    const clientSwitch = page.getByRole("switch", { name: "Show client name" });
    const projectSwitch = page.getByRole("switch", { name: "Show project name" });
    await expect(clientSwitch).toHaveAttribute("aria-checked", "true");
    await expect(projectSwitch).toHaveAttribute("aria-checked", "true");

    // Client off → bars keep the project context only.
    await clientSwitch.click();
    await expect(clientSwitch).toHaveAttribute("aria-checked", "false");
    await page.getByRole("link", { name: "Schedule" }).click();
    const bar = page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" });
    await expect(bar).toContainText("Project Watchtower · Wireframes");
    await expect(bar).not.toContainText("Queen Consolidated");

    // Project off too → just the activity name.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("switch", { name: "Show project name" }).click();
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(bar).toBeVisible();
    await expect(bar).not.toContainText("Project Watchtower");
  });
});
