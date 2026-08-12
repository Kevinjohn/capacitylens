import { test, expect } from "./fixtures";
import { openApp, selectShadOption, setZoom } from "./helpers";

// Covers the runnable US-ACT-01, US-ACT-03 and US-ACT-04 flows. US-ACT-02 remains manual while
// phase management is hidden.
test.describe("Activities", () => {
  test("adds an internal, a cross-project, and a project-specific activity into their three sections", async ({
    page,
  }) => {
    await openApp(page, "Wayne Enterprises", "/activities");

    // Internal kind → project picker hidden, lands in the "Internal activities" section.
    await page.getByRole("button", { name: "Add activity" }).click();
    await expect(page.getByRole("radiogroup", { name: "Activity kind" }).getByRole("radio")).toHaveText([
      "Internal",
      "Cross-project",
      "Project-specific",
    ]);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Internal sync");
    await page.getByRole("radio", { name: "Internal" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByTestId("internal-activities").getByTestId("activity-row").filter({ hasText: "Internal sync" }),
    ).toBeVisible();

    // Cross-project kind → project-less and usable across projects, lands in the "Cross-project activities" section.
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Discovery workshop");
    await page.getByRole("radio", { name: "Cross-project" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page
        .getByTestId("cross-project-activities")
        .getByTestId("activity-row")
        .filter({ hasText: "Discovery workshop" }),
    ).toBeVisible();

    // Project-specific kind (the default) → bound to a project, lands beneath one client heading
    // and one project heading in the "Project-specific activities" section.
    await page.getByRole("button", { name: "Add activity" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Spec review");
    await selectShadOption(page.getByLabel("Project"), "p-acme");
    await page.getByRole("button", { name: "Save" }).click();
    const projectActivities = page.getByTestId("project-specific-activities");
    await expect(projectActivities.getByRole("heading", { name: "Queen Consolidated", level: 3 })).toBeVisible();
    await expect(projectActivities.getByRole("heading", { name: "Project Watchtower", level: 4 })).toBeVisible();
    await expect(projectActivities.getByTestId("activity-row").filter({ hasText: "Spec review" })).toBeVisible();
  });

  test("groups and sorts project activities by client, project, then activity", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/activities");
    const section = page.getByTestId("project-specific-activities");

    await expect(section.getByRole("heading", { level: 3 })).toHaveText(["LexCorp", "Queen Consolidated"]);
    await expect(section.getByRole("heading", { level: 4 })).toHaveText(["Metropolis Rebrand", "Project Watchtower"]);
    await expect(section.getByTestId("activity-row")).toHaveText([
      "Brand System",
      "CMS Review",
      "Visual Design",
      "Wireframes",
    ]);
    await expect(section.getByText("LexCorp", { exact: true })).toHaveCount(1);
    await expect(section.getByText("Metropolis Rebrand", { exact: true })).toHaveCount(1);
  });

  test("edits an activity name", async ({ page }) => {
    await openApp(page, "Wayne Enterprises", "/activities");
    await page
      .getByTestId("activity-row")
      .filter({ hasText: "CMS Review" })
      .getByRole("button", { name: /^Edit / })
      .click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("CMS Build");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("activity-row").filter({ hasText: "CMS Build" })).toBeVisible();
  });

  test("deletes an activity and removes its allocation bars, restorable with undo", async ({ page }) => {
    await openApp(page);
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toBeVisible();

    await page.getByRole("link", { name: "Activities" }).click();
    await page
      .getByTestId("activity-row")
      .filter({ hasText: "Wireframes" })
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("alertdialog", { name: "Delete activity?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("activity-row").filter({ hasText: "Wireframes" })).toHaveCount(0);

    await page.getByRole("link", { name: "Schedule" }).click();
    await setZoom(page, 4);
    await page.getByTestId("scheduler-grid").evaluate((el) => {
      (el as HTMLElement).scrollLeft = 0;
    });
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toHaveCount(0);

    await page.keyboard.press("Meta+z");
    await expect(page.getByTestId("allocation-bar").filter({ hasText: "Wireframes" })).toBeVisible();
    await page.getByRole("link", { name: "Activities" }).click();
    await expect(page.getByTestId("activity-row").filter({ hasText: "Wireframes" })).toBeVisible();
  });
});
