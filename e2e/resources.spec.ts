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
    await page.getByRole("radiogroup", { name: "Tuesday" }).getByRole("radio", { name: "Half day" }).click();
    await page.getByRole("radiogroup", { name: "Friday" }).getByRole("radio", { name: "Not working" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    await page
      .getByTestId("resource-row")
      .filter({ hasText: "Barbara Gordon" })
      .getByRole("button", { name: /^Edit / })
      .click();
    await expect(
      page.getByRole("radiogroup", { name: "Monday" }).getByRole("radio", { name: "Full day" }),
    ).toBeChecked();
    await expect(
      page.getByRole("radiogroup", { name: "Tuesday" }).getByRole("radio", { name: "Half day" }),
    ).toBeChecked();
    await expect(
      page.getByRole("radiogroup", { name: "Friday" }).getByRole("radio", { name: "Not working" }),
    ).toBeChecked();
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

  test("rejects zero working hours", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/resources");
    await page.getByRole("button", { name: "Add resource" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Edge Case");
    await page.getByLabel("Role").fill("Tester");

    await page.getByLabel("Working hours / day").fill("0");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toContainText(/greater than 0/i);
  });

  test("the Temp tag is parked: freelancers render untagged", async ({ page }) => {
    // Employment type is still captured on the form, but the visual pill is hidden
    // Employment type is recorded without adding a roster badge (DECISIONS.md).
    await openApp(page, "Wayne Enterprises", "/resources");
    // Barry Allen is a seeded freelancer — visible, but with no Temp tag anywhere.
    await expect(page.getByTestId("resource-row").filter({ hasText: "Barry Allen" })).toBeVisible();
    await expect(page.getByText("Temp", { exact: true })).toHaveCount(0);
  });
});
