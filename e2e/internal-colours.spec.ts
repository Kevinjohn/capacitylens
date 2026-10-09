import { test, expect } from "./fixtures";
import { openApp, selectShadOption } from "./browserTestSupport";

// Covers US-SET-14: Internal work is always neutral grey, and Settings has no colour mode for it.
test("Internal work is always grey and hides the project colour picker", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/settings");
  await expect(page.getByRole("radiogroup", { name: "Internal work colours" })).toHaveCount(0);

  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Add project" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add project" });
  await addDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Quarterly planning");
  // The picker starts visible while no client is selected, then hides as soon as Internal owns it.
  await expect(addDialog.getByRole("button", { name: /^Colour/ })).toBeVisible();
  await selectShadOption(addDialog.getByLabel("Client"), { label: "Internal" });
  await expect(addDialog.getByRole("button", { name: /^Colour/ })).toHaveCount(0);
  await addDialog.getByRole("button", { name: "Save" }).click();

  const row = page.getByTestId("project-row").filter({ hasText: "Quarterly planning" });
  await expect(row.locator("span.inline-block.rounded-sm").first()).toHaveCSS("background-color", "rgb(156, 163, 175)");
  await row.getByRole("button", { name: /^Edit / }).click();
  await expect(page.getByRole("dialog", { name: "Edit project" }).getByRole("button", { name: /^Colour/ })).toHaveCount(
    0,
  );
});
