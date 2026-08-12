import { test, expect } from "./fixtures";
import { goToSeedWeek, openApp, selectShadOption, setZoom } from "./helpers";

// Covers US-RES-01..10 (Resources area). Each test starts from the seeded app
// (Playwright gives every test a fresh page → fresh in-memory seed).

test.describe("Resources", () => {
  test("adds a person and shows them in the list and schedule", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page.getByRole("button", { name: "Add resource" }).click();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Dana Lee");
    await page.getByLabel("Role").fill("Motion Designer");
    await selectShadOption(page.getByLabel("Discipline"), { label: "Design" });
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Dana Lee")).toBeVisible();
    // It appears on the schedule under the Design group.
    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByTestId("scheduler-row").filter({ hasText: "Dana Lee" })).toBeVisible();
  });

  test("keeps resource details compact at normal widths and stacks them on a narrow screen", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page.getByRole("button", { name: "Add resource" }).click();

    const dialog = page.getByRole("dialog", { name: "Add resource" });
    const compactFields = dialog.locator('[data-product-layout="label-control"]');
    await expect(compactFields).toHaveCount(4);

    const fieldGroupBox = await dialog.locator('[data-slot="field-group"]').boundingBox();
    const workingDaysBox = await dialog.getByRole("group", { name: "Working days" }).boundingBox();
    expect(fieldGroupBox).not.toBeNull();
    expect(workingDaysBox).not.toBeNull();
    expect(Math.abs(fieldGroupBox!.width - workingDaysBox!.width)).toBeLessThanOrEqual(2);

    for (const label of ["Name", "Role", "Discipline", "Engagement"]) {
      const control = dialog.getByLabel(label, { exact: true });
      const field = control.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
      const fieldBox = await field.boundingBox();
      const controlBox = await control.boundingBox();
      expect(fieldBox).not.toBeNull();
      expect(controlBox).not.toBeNull();
      const controlStart = (controlBox!.x - fieldBox!.x) / fieldBox!.width;
      const controlShare = controlBox!.width / fieldBox!.width;
      expect(controlStart).toBeGreaterThan(0.24);
      expect(controlStart).toBeLessThan(0.32);
      expect(controlShare).toBeGreaterThan(0.68);
      expect(controlShare).toBeLessThan(0.76);
    }

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("dialog", { name: "Best in landscape" }).getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toBeVisible();
    for (const label of ["Name", "Role", "Discipline", "Engagement"]) {
      const control = dialog.getByLabel(label, { exact: true });
      const field = control.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
      const labelBox = await field.locator(":scope > :first-child").boundingBox();
      const fieldBox = await field.boundingBox();
      const controlBox = await control.boundingBox();
      expect(labelBox).not.toBeNull();
      expect(fieldBox).not.toBeNull();
      expect(controlBox).not.toBeNull();
      expect(controlBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height);
      expect(Math.abs(controlBox!.x - fieldBox!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(controlBox!.width - fieldBox!.width)).toBeLessThanOrEqual(1);
    }
  });

  test('adds a placeholder bound to a project and shows it as "Placeholder" on the schedule', async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    // Placeholders are hidden by default (per-account pref) — turn them on so the management
    // section + "Add placeholder" button appear on the Resources page.
    await page.getByRole("switch", { name: "Show placeholders" }).click();
    await page.getByRole("link", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add placeholder" }).click();

    await page.getByLabel("Role").fill("Junior Dev");
    await selectShadOption(page.getByLabel("Bound project"), "p-acme"); // Queen Consolidated / Project Watchtower
    await page.getByRole("button", { name: "Save" }).click();

    await page.getByRole("link", { name: "Schedule" }).click();
    // A placeholder shows as the literal name "Placeholder" in the schedule view; its role
    // ("Junior Dev") is the secondary text below.
    const row = page.getByTestId("scheduler-row").filter({ hasText: "Placeholder" }).filter({ hasText: "Junior Dev" });
    await expect(row).toBeVisible();
  });

  test("rejects a placeholder with no bound project", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/settings");
    await page.getByRole("switch", { name: "Show placeholders" }).click();
    await page.getByRole("link", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add placeholder" }).click();
    await page.getByLabel("Role").fill("Unbound slot");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toContainText(/must be bound to a project/i);
  });

  test("edits a resource and the change persists", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page
      .getByTestId("resource-row")
      .filter({ hasText: "Clark Kent" })
      .getByRole("button", { name: /^Edit / })
      .click();
    const role = page.getByLabel("Role");
    await role.fill("Lead Developer");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Lead Developer")).toBeVisible();
  });

  test("persists a mixed full, half and non-working weekday pattern", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page.getByRole("button", { name: "Add resource" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Barbara Gordon");
    const dialog = page.getByRole("dialog", { name: "Add resource" });
    await expect(dialog.getByRole("columnheader", { name: "Full day" })).toBeVisible();
    await expect(dialog.getByRole("columnheader", { name: "Half day" })).toBeVisible();
    await expect(dialog.getByRole("columnheader", { name: "Not working" })).toBeVisible();
    const tableBox = await dialog.getByRole("table").boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(tableBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(Math.abs(dialogBox!.x + dialogBox!.width - (tableBox!.x + tableBox!.width))).toBeLessThanOrEqual(30);
    const mondayFull = dialog.getByRole("radio", { name: "Monday Full day" });
    await mondayFull.click();
    await mondayFull.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Monday Half day" })).toBeChecked();
    await dialog.getByRole("radio", { name: "Monday Half day" }).press("ArrowLeft");
    await expect(mondayFull).toBeChecked();
    await dialog.getByRole("radio", { name: "Tuesday Half day" }).click();
    await dialog.getByRole("radio", { name: "Friday Not working" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    await page
      .getByTestId("resource-row")
      .filter({ hasText: "Barbara Gordon" })
      .getByRole("button", { name: /^Edit / })
      .click();
    await expect(page.getByRole("radio", { name: "Monday Full day" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Tuesday Half day" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Friday Not working" })).toBeChecked();
  });

  test("favourites a person and keeps them first in the resource list and discipline group", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");

    const clarkRow = page.getByTestId("resource-row").filter({ hasText: "Clark Kent" });
    const favourite = clarkRow.getByRole("button", { name: "Add Clark Kent to favourites" });
    await expect(favourite).toHaveAttribute("aria-pressed", "false");

    await favourite.click();

    const unfavourite = page.getByRole("button", { name: "Remove Clark Kent from favourites" });
    await expect(unfavourite).toHaveAttribute("aria-pressed", "true");
    await expect(unfavourite.locator(".lucide-star")).toHaveClass(/fill-warn/);
    await expect(page.getByTestId("resource-row").first()).toContainText("Clark Kent");

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect
      .poll(async () => {
        const rows = await page.getByTestId("scheduler-row").allTextContents();
        return [
          rows.findIndex((row) => row.includes("Clark Kent")),
          rows.findIndex((row) => row.includes("Barry Allen")),
        ];
      })
      .toEqual([1, 2]);
  });

  test("groups Studio before Supplementary and restores one People order when disabled", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supplementary" })).toBeVisible();

    const barry = page.getByTestId("resource-row").filter({ hasText: "Barry Allen" });
    await barry.getByRole("button", { name: "Edit Barry Allen" }).click();
    await selectShadOption(page.getByLabel("Engagement"), { label: "Supplementary" });
    await page.getByRole("button", { name: "Save" }).click();
    await barry.getByRole("button", { name: "Add Barry Allen to favourites" }).click();

    const supplementary = page.getByRole("heading", { name: "Supplementary" }).locator("..");
    await expect(supplementary.getByTestId("resource-row")).toContainText("Barry Allen");

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect
      .poll(async () => {
        const rows = await page.getByTestId("scheduler-row").allTextContents();
        return [
          rows.findIndex((row) => row.includes("Clark Kent")),
          rows.findIndex((row) => row.includes("Barry Allen")),
        ];
      })
      .toEqual([1, 2]);

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("switch", { name: "Group resources by engagement" }).click();
    await page.getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { name: "Studio" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Supplementary" })).toHaveCount(0);
    await expect(page.getByTestId("resource-row").first()).toContainText("Barry Allen");

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect
      .poll(async () => {
        const rows = await page.getByTestId("scheduler-row").allTextContents();
        return [
          rows.findIndex((row) => row.includes("Barry Allen")),
          rows.findIndex((row) => row.includes("Clark Kent")),
        ];
      })
      .toEqual([1, 2]);
  });

  // P2.5b: the per-row destructive action ARCHIVES (hidden from list + schedule, fully retained),
  // not a hard cascade-delete. Archiving is undoable via the local store (it goes through mutate()).
  test("archiving a resource hides it from the list + schedule, and undo restores it", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await goToSeedWeek(page);
    const bruceBars = page.locator('[data-resource-id="r-tyler"]').getByTestId("allocation-bar");
    await expect(bruceBars.first()).toBeVisible();

    await page.getByRole("link", { name: "Resources" }).click();
    await page
      .getByTestId("resource-row")
      .filter({ hasText: "Bruce Wayne" })
      .getByRole("button", { name: "Archive Bruce Wayne" })
      .click();
    await page
      .getByRole("alertdialog", { name: "Archive resource?" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" })).toHaveCount(0);

    // Undo restores the resource (back to active → reappears in the list + schedule).
    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" })).toBeVisible();
  });

  test("uses fixed working hours without showing an hours field", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page.getByRole("button", { name: "Add resource" }).click();
    await expect(page.getByLabel("Working hours / day")).toHaveCount(0);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Fixed Hours");
    await page.getByLabel("Role").fill("Tester");
    await page.getByRole("button", { name: "Save" }).click();

    const row = page.getByTestId("resource-row").filter({ hasText: "Fixed Hours" });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(/\d+h\/day/);
  });

  test("edits Engagement while Employment stays hidden and unbadged", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    const bruce = page.getByTestId("resource-row").filter({ hasText: "Bruce Wayne" });
    await bruce.getByRole("button", { name: "Edit Bruce Wayne" }).click();

    await expect(page.getByLabel("Employment")).toHaveCount(0);
    await expect(page.getByLabel("Engagement")).toContainText("Studio");
    await selectShadOption(page.getByLabel("Engagement"), { label: "Supplementary" });
    await page.getByRole("button", { name: "Save" }).click();

    await bruce.getByRole("button", { name: "Edit Bruce Wayne" }).click();
    await expect(page.getByLabel("Engagement")).toContainText("Supplementary");
    await expect(page.getByText("Temp", { exact: true })).toHaveCount(0);
  });
});
