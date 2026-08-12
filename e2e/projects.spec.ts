import { test, expect } from "./fixtures";
import { openApp, selectShadOption } from "./helpers";

// Covers US-PRJ-01..03. US-PRJ-04 remains manual while phase management is hidden.
test.describe("Projects", () => {
  test("rejects a project without a client and adds one with a client", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/projects");
    await page.getByRole("button", { name: "Add project" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Apollo");

    await page.getByLabel("Client").click();
    await expect(page.getByRole("option")).toHaveText(["Internal", "LexCorp", "Queen Consolidated"]);
    const separator = page.locator('[data-slot="select-separator"]');
    await expect(separator).toHaveCount(1);
    await expect(separator).toHaveAttribute("aria-hidden", "true");
    await expect(separator).not.toHaveAttribute("data-value");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "LexCorp" })).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toContainText(/must belong to a client/i);

    await selectShadOption(page.getByLabel("Client"), { label: "Queen Consolidated" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("project-row").filter({ hasText: "Apollo" })).toBeVisible();
  });

  test("edits a project name", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/projects");
    await page
      .getByTestId("project-row")
      .filter({ hasText: "Metropolis Rebrand" })
      .getByRole("button", { name: /^Edit / })
      .click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Brand Refresh");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("project-row").filter({ hasText: "Brand Refresh" })).toBeVisible();
  });

  // P2.5b: the per-row destructive action ARCHIVES (hidden from the active list, fully retained — NOT
  // a hard cascade-delete). Archiving is undoable via the local store.
  test("archiving a project hides it from the list, restorable with undo", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/projects");
    await page
      .getByTestId("project-row")
      .filter({ hasText: "Project Watchtower" })
      .getByRole("button", { name: "Archive Project Watchtower" })
      .click();
    await page
      .getByRole("alertdialog", { name: "Archive project?" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByTestId("project-row").filter({ hasText: "Project Watchtower" })).toHaveCount(0);

    // Undo restores the archived project to the active list.
    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("project-row").filter({ hasText: "Project Watchtower" })).toBeVisible();
  });
});
