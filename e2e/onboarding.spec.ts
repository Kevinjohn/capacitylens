import { test, expect } from "./fixtures";
import { openNewCompanyForm, createCompany } from "./helpers";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// Onboarding capture (P1.14): the create-company form captures week-start, time zone and language
// (the three fields the server FREEZES after creation), then lands in the app; Settings shows those
// three controls DISABLED. Runs in the default OFF/in-memory demo build (the create flow is identical
// to server mode — it routes through the same addAccount).

test.describe("onboarding: capture-then-freeze language / week-start / time zone", () => {
  test("create a company capturing week-start + timezone → Settings shows the read-only summary", async ({ page }) => {
    // Same frozen-clock + fake-sign-in + "New company" walk as helpers.ts's `openApp`/
    // `openNewCompany`, stopping short so this spec can inspect and change the open form's
    // fields before submitting it.
    await openNewCompanyForm(page);

    // The three frozen-after-creation fields are present with concrete defaults.
    await expect(page.getByRole("radio", { name: "Monday" })).toHaveAttribute("aria-checked", "true");
    const tz = page.getByLabel("Timezone");
    await expect(tz).toContainText(/(?:London|UTC|GMT)/);
    await tz.click();
    await expect(page.getByRole("option", { name: /(?:GMT|UTC)/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /London.*Europe\/London/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-language")).toHaveText("English");

    // Capture a non-default week-start and time zone, then create.
    await page.getByRole("radio", { name: "Sunday" }).click();
    await tz.click();
    await page.getByRole("combobox", { name: "Search time zones" }).fill("Europe/London");
    await page.getByRole("option", { name: /London.*Europe\/London/ }).click();
    await createCompany(page, "Onboarded Co");

    // Navigate to Settings via the in-app nav (a full reload would drop the never-persisted
    // active account and bounce back to the picker). Settings shows the captured values read-only.
    await page.getByRole("link", { name: "Settings" }).click();
    const accountOptions = page
      .getByRole("heading", { name: "Account Options Selected at Creation" })
      .locator('xpath=ancestor::*[@data-slot="card"]');
    await expect(accountOptions.getByRole("row", { name: "Company name Onboarded Co" })).toBeVisible();
    await expect(accountOptions.getByRole("row", { name: "Week starts on Sunday" })).toBeVisible();
    await expect(accountOptions.getByRole("row", { name: /Time zone London.*Europe\/London.*BST/ })).toBeVisible();
    await expect(page.getByTestId("settings-language")).toHaveText("English");
  });
});
