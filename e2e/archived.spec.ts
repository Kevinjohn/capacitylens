import { test, expect } from "./fixtures";
import { openApp } from "./browserTestSupport";

// The temporary demo state exercises archive, restore and soft-delete without a server.
// Each action must update the scheduler and active list together.

const RESOURCE = "Barry Allen";

test.describe("Inline archives and deleted items (demo mode)", () => {
  test("archive a resource → it vanishes from the schedule + active list → inline restore → re-archive → soft-delete", async ({
    page,
  }) => {
    await openApp(page, "Wayne Enterprises", "/resources");

    const listRow = page.getByTestId("resource-row").filter({ hasText: RESOURCE });
    await expect(listRow).toBeVisible();

    await listRow.getByRole("button", { name: `Archive ${RESOURCE}` }).click();
    const archiveDialog = page.getByRole("alertdialog", { name: "Archive resource?" });
    await expect(archiveDialog).toBeVisible();
    await archiveDialog.getByRole("button", { name: "Archive", exact: true }).click();

    await expect(page.getByTestId("resource-row").filter({ hasText: RESOURCE })).toHaveCount(0);

    let section = page.getByTestId("archived-resources-section");
    await expect(section).toBeVisible();
    let archivedRow = section.getByTestId("archived-row").filter({ hasText: RESOURCE });
    await expect(archivedRow).toBeVisible();

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("scheduler-row").filter({ hasText: RESOURCE })).toHaveCount(0);

    await page.getByRole("link", { name: "Resources" }).click();
    section = page.getByTestId("archived-resources-section");
    archivedRow = section.getByTestId("archived-row").filter({ hasText: RESOURCE });

    await archivedRow.getByRole("button", { name: `Restore ${RESOURCE}` }).click();
    await expect(section.getByTestId("archived-row").filter({ hasText: RESOURCE })).toHaveCount(0);
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("scheduler-row").filter({ hasText: RESOURCE })).toBeVisible();
    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByTestId("resource-row").filter({ hasText: RESOURCE })).toBeVisible();

    await page
      .getByTestId("resource-row")
      .filter({ hasText: RESOURCE })
      .getByRole("button", { name: `Archive ${RESOURCE}` })
      .click();
    await page
      .getByRole("alertdialog", { name: "Archive resource?" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();

    const section2 = page.getByTestId("archived-resources-section");
    const archivedRow2 = section2.getByTestId("archived-row").filter({ hasText: RESOURCE });
    await expect(archivedRow2).toBeVisible();
    await archivedRow2.getByRole("button", { name: `Delete ${RESOURCE}` }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete this item?" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();

    // Soft-delete removes it from the inline archive. The tombstone remains in company data,
    // while Settings no longer exposes the Deleted items section.
    await expect(section2).toHaveCount(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Deleted items" })).toHaveCount(0);
  });
});
