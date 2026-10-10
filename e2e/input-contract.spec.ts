import { test, expect } from "./fixtures";
import { openApp } from "./browserTestSupport";

test("a decomposed name at the canonical maximum saves intact", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  const rawName = "\u1100\u1161\u11A8".repeat(100);
  const canonicalName = "각".repeat(100);
  const dialog = page.getByRole("dialog");
  const nameInput = dialog.getByLabel("Name", { exact: true });
  await nameInput.pressSequentially(rawName);
  await expect(nameInput).toHaveValue(rawName);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(canonicalName, { exact: true })).toBeVisible();
});
